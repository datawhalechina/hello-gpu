"""Freeze, measure and profile the controlled Chapter 10 Softmax rounds.

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
    {'id':'hip-serial-b256','runtime':'hip','version':'baseline','block':256,'kernels':['row_max_serial','row_exp_sum_serial','normalize_rows']},
    {'id':'hip-cooperative-b256','runtime':'hip','version':'cooperative','block':256,'kernels':['row_max_block','row_exp_sum_block','normalize_block']},
    {'id':'hip-fused-b256','runtime':'hip','version':'fused','block':256,'kernels':['softmax_fused_lds']},
    *({'id':f'triton-{prefix}{warps}','runtime':'triton','version':'t0' if multiplier==1 else 't1',
       'block_multiplier':multiplier,'num_warps':warps,'kernels':['softmax_row_kernel']}
      for prefix,multiplier in [('b',1),('2b',2)] for warps in (4,8)),
]
MAIN_SHAPE = '4096x1024'
EDGE_SHAPES = ['1x1','3x33','3x257','3x1025']
VALIDATION_SHAPES = ['4096x1023','4096x1025','128x1024']


def save(root: Path, m: dict) -> None:
    (root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')


def command(c: dict, root: Path, shape: str, warmup: int, repeat: int, seed: int) -> list[str]:
    rows,cols=map(int,shape.split('x'))
    if c['runtime']=='hip':
        cmd=[str(root/'build/softmax_hip'),'--block',str(c['block'])]
    else:
        cmd=[sys.executable,str(root/'source/softmax_triton.py')]
        block=(1<<(cols-1).bit_length())*c['block_multiplier']
        cmd += ['--t0-warps',str(c['num_warps']),'--t1-warps',str(c['num_warps']),'--t1-block',str(block)]
    return cmd+['--version',c['version'],'--rows',str(rows),'--cols',str(cols),'--warmup',str(warmup),'--repeat',str(repeat),'--seed',str(seed),'--config-id',c['id']]


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
    files={name:SOURCE/name for name in ('softmax_hip.hip','softmax_triton.py','run_rounds.py','summarize_rounds.py','rounds_identity.py')}
    files.update({name:SOURCE.parent/'chapter8'/name for name in ('collect_environment.sh','resolve_rocprofv3.py')})
    for name,path in files.items(): shutil.copy2(path,root/'source'/name)
    import torch
    if version('rocm')!='10.0.0' or not torch.cuda.is_available() or torch.cuda.get_device_properties(0).gcnArchName.split(':')[0]!='gfx1201':
        raise RuntimeError('requires ROCm10/gfx1201')
    m={'schema_version':1,'experiment':'chapter10-controlled-softmax-rounds','started_at':datetime.now(timezone.utc).isoformat(),
       'hardware':torch.cuda.get_device_name(0),
       'software':{'rocm':version('rocm'),'hip':torch.version.hip,'torch':torch.__version__,'triton':version('triton')},
       'platform':{'os_pretty_name':platform.freedesktop_os_release().get('PRETTY_NAME'),'kernel':platform.release(),'execution':'native'},
       'environment':{'gpu':torch.cuda.get_device_name(0),'architecture':torch.cuda.get_device_properties(0).gcnArchName,'rocm_sdk':version('rocm'),'hip':torch.version.hip,'gpu_exclusive':False,'profiler_during_benchmark':False},
       'source_sha256':{name:sha(root/'source'/name) for name in files},
       'benchmark':{'shape':MAIN_SHAPE,'dtype':'float32','input':'shifted-dyadic','reference':'fp64-softmax-to-fp32','seed':args.seed,'warmup':10,'repeat':50,'processes':3,'independent_runs':3,'scope':'gpu-event-full-operator',
                    'absolute_tolerance':2e-5,'row_sum_tolerance':2e-5,'cache':'reuse arrays; no cache flush','timing':'synchronize after each event interval; entire 3-kernel or 1-kernel operator',
                    'correctness':'output NaN prefill, full precheck and postcheck; finite, FP64 softmax castFP32 error, FP64 row sum'},
       'configurations':CONFIGS,'edge_shapes':EDGE_SHAPES,'execution_order':[]}
    save(root,m)
    run(['bash',str(root/'source/collect_environment.sh')],root/'logs/environment.log',root)
    if shutil.which('amd-smi'):
        for sub in ('metric','process'):run(['amd-smi',sub],root/'logs'/f'gpu-{sub}-before.log',root)
    cmd=['hipcc','--offload-arch=gfx1201','-O3','-std=c++17','-save-temps','../source/softmax_hip.hip','-o','softmax_hip']
    run(cmd,root/'logs/compile.log',root)
    m['build']={'command':cmd,'binary_sha256':sha(root/'build/softmax_hip')}
    save(root,m)
    for shape in m['edge_shapes']:
        for c in m['configurations']:
            run(command(c,root,shape,0,1,args.seed),root/'logs'/f'edge-{shape}-{c["id"]}.log',root)
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
    selected=[c for c in m['configurations'] if c['id']!='hip-serial-b256']
    m['validation_selection']={'shapes':VALIDATION_SHAPES,'config_ids':[c['id'] for c in selected],'rule':'cooperative/fused and all four Triton candidates; serial remains a teaching bridge'}
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
