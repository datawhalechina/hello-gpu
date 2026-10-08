"""Freeze, measure and profile the controlled Chapter 12 Attention rounds.

The default main phase runs boundary checks and three-process benchmarks;
profiling and additional validation are explicit, optional phases.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import fcntl
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

from rounds_identity import check_frozen_identity, sha
from summarize_rounds import summarize

SOURCE = Path(__file__).resolve().parent
CONFIGS = [
    {'id':'hip-materialized-b256','runtime':'hip','version':'materialized','block':256,'kernels':['scores_kernel','softmax_rows_kernel','probability_value_kernel']},
    {'id':'hip-online-b256','runtime':'hip','version':'online','block':256,'kernels':['online_attention_kernel']},
    {'id':'triton-materialized-k32','runtime':'triton','version':'materialized','block_k':32,'num_warps':4,'kernels':['materialized_scores_kernel','materialized_softmax_kernel','materialized_pv_kernel']},
    *({'id':f'triton-online-k{k}','runtime':'triton','version':'online','block_k':k,'num_warps':4,'kernels':['online_attention_kernel']} for k in (16,32,64)),
]
MAIN_SHAPE = '128x64'
EDGE_CASES = [{'shape':shape,'input':'dyadic'} for shape in ('1x1','17x31','33x65','65x64')] + [{'shape':shape,'input':'rising-max'} for shape in ('65x64','129x64')]
VALIDATION_SHAPES = ['256x64','128x65']


def save(root: Path, m: dict) -> None:
    (root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')


def command(c: dict, root: Path, shape: str, warmup: int, repeat: int, seed: int, input_name: str='dyadic') -> list[str]:
    seq,dim=map(int,shape.split('x'))
    if c['runtime']=='hip':
        cmd=[str(root/'build/attention_hip'),'--block',str(c['block'])]
    else:
        cmd=[sys.executable,str(root/'source/attention_triton.py'),'--block-k',str(c['block_k']),'--num-warps',str(c['num_warps'])]
    return cmd+['--version',c['version'],'--seq',str(seq),'--dim',str(dim),'--warmup',str(warmup),'--repeat',str(repeat),'--seed',str(seed),'--input',input_name,'--config-id',c['id']]


def run(cmd: list[str], log: Path, root: Path, env: dict | None=None) -> None:
    print(f'running {log.stem}',flush=True)
    with (root/'commands.jsonl').open('a') as f:
        f.write(json.dumps({'time':datetime.now(timezone.utc).isoformat(),'argv':cmd,'log':str(log.relative_to(root))})+'\n')
    with log.open('w') as f:
        subprocess.run(cmd,cwd=root/'build',stdout=f,stderr=subprocess.STDOUT,check=True,env=env)


def benchmark(configs: list[dict], root: Path, m: dict, shape: str) -> None:
    b=m['benchmark']
    for process in range(1,b['processes']+1):
        offset=(process-1)*max(1,len(configs)//3)
        order=configs[offset:]+configs[:offset]
        m['execution_order'].append({'shape':shape,'process':process,'configs':[c['id'] for c in order]})
        save(root,m)
        for c in order:
            stem=f'n{shape}-{c["id"]}-p{process}'
            sample=root/'samples'/f'{stem}.csv'
            if sample.exists(): raise FileExistsError(sample)
            cmd=command(c,root,shape,b['warmup'],b['repeat'],b['seed'])
            cmd+=['--samples',str(sample),'--process',str(process)]
            run(cmd,root/'logs'/f'{stem}.log',root)


def initialize(root: Path, args: argparse.Namespace) -> dict:
    if root.exists(): raise FileExistsError('choose a fresh output directory')
    for folder in ('source','build','logs','samples','profiles'):(root/folder).mkdir(parents=True,exist_ok=True)
    files={name:SOURCE/name for name in ('attention_hip.hip','attention_triton.py','run_rounds.py','summarize_rounds.py','rounds_identity.py')}
    files.update({name:SOURCE.parent/'chapter8'/name for name in ('collect_environment.sh','resolve_rocprofv3.py')})
    for name,path in files.items(): shutil.copy2(path,root/'source'/name)
    import torch
    if version('rocm')!='10.0.0' or not torch.cuda.is_available() or torch.cuda.get_device_properties(0).gcnArchName.split(':')[0]!='gfx1201':
        raise RuntimeError('requires ROCm10/gfx1201')
    m={'schema_version':1,'experiment':'chapter12-controlled-attention-rounds','started_at':datetime.now(timezone.utc).isoformat(),
       'hardware':torch.cuda.get_device_name(0),
       'software':{'rocm':version('rocm'),'hip':torch.version.hip,'torch':torch.__version__,'triton':version('triton')},
       'platform':{'os_pretty_name':platform.freedesktop_os_release().get('PRETTY_NAME'),'kernel':platform.release(),'execution':'native'},
       'environment':{'gpu':torch.cuda.get_device_name(0),'architecture':torch.cuda.get_device_properties(0).gcnArchName,'rocm_sdk':version('rocm'),'hip':torch.version.hip,'gpu_exclusive':False,'profiler_during_benchmark':False},
       'source_sha256':{name:sha(root/'source'/name) for name in files},
       'benchmark':{'shape':MAIN_SHAPE,'dtype':'float32','input':'dyadic','reference':'fp64-attention-to-fp32','seed':args.seed,'warmup':10,'repeat':50,'processes':3,'independent_runs':3,'scope':'gpu-event-full-operator',
                    'atol':2e-5,'rtol':2e-4,'cache':'reuse arrays; no cache flush','timing':'synchronize after each event interval; entire 3-kernel or 1-kernel operator',
                    'correctness':'output/scores/P NaN prefill before precheck, full precheck and postcheck; finite, elementwise atol+rtol*abs(FP64 reference castFP32)'},
       'configurations':CONFIGS,'edge_cases':EDGE_CASES,'execution_order':[]}
    save(root,m)
    run(['bash',str(root/'source/collect_environment.sh')],root/'logs/environment.log',root)
    if shutil.which('amd-smi'):
        for sub in ('metric','process'):run(['amd-smi',sub],root/'logs'/f'gpu-{sub}-before.log',root)
    cmd=['hipcc','--offload-arch=gfx1201','-O3','-std=c++17','-save-temps','../source/attention_hip.hip','-o','attention_hip']
    run(cmd,root/'logs/compile.log',root)
    m['build']={'command':cmd,'binary_sha256':sha(root/'build/attention_hip')}
    save(root,m)
    for case in m['edge_cases']:
        for c in m['configurations']:
            run(command(c,root,case['shape'],0,1,args.seed,case['input']),root/'logs'/f'edge-{case["input"]}-{case["shape"]}-{c["id"]}.log',root)
    return m


def profile(root: Path,m: dict) -> None:
    m.setdefault('identity_checks',[]).append({'phase':'profile',**check_frozen_identity(root,m)})
    selection=json.loads(subprocess.check_output([sys.executable,str(root/'source/resolve_rocprofv3.py')],text=True))
    if not selection['available']:raise RuntimeError(selection['reason'])
    env=os.environ.copy();env['LD_LIBRARY_PATH']=os.pathsep.join(selection['library_dirs']+[env.get('LD_LIBRARY_PATH','')])
    m['profile']={'warmup':5,'repeat':10,'precheck_dispatches':1,'tool_kind':selection['kind'],'sdk':selection['rocprof_rocm']}
    save(root,m)
    for c in m['configurations']:
        cmd=[selection['executable'],'--rocm-root',selection['root'],'--kernel-trace','--output-directory',str(root/'profiles'),'--output-file',c['id'],'--output-format','csv','--']
        cmd+=command(c,root,MAIN_SHAPE,5,10,m['benchmark']['seed'])
        run(cmd,root/'logs'/f'profile-{c["id"]}.log',root,env)


def validation(root: Path,m: dict) -> None:
    m.setdefault('identity_checks',[]).append({'phase':'validation',**check_frozen_identity(root,m)})
    selected=m['configurations']
    m['validation_selection']={'shapes':VALIDATION_SHAPES,'config_ids':[c['id'] for c in selected],'rule':'all six measured configurations; sequence length and dimension tail validation'}
    save(root,m)
    for shape in VALIDATION_SHAPES:benchmark(selected,root,m,shape)


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--phase',choices=('main','profile','validation','all'),default='main',
                        help='main (default): boundary checks and three-process benchmarks; '
                             'profile: trace an existing run on demand; '
                             'validation: validate additional shapes in an existing run on demand; '
                             'all: run main, profile and validation')
    parser.add_argument('--seed',type=int,default=20260920)
    a=parser.parse_args();root=a.output.resolve()
    if not 0<=a.seed<=0xFFFFFFFF:parser.error('seed must fit uint32')
    with open('/tmp/hello-gpu-experiment.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if a.phase in ('main','all'):
            m=initialize(root,a);benchmark(m['configurations'],root,m,MAIN_SHAPE)
        else:m=json.loads((root/'manifest.json').read_text())
        if a.phase in ('profile','all'):profile(root,m)
        if a.phase in ('validation','all'):validation(root,m)
        m['updated_at']=datetime.now(timezone.utc).isoformat();save(root,m);summarize(root,root/'summary')


if __name__=='__main__':main()
