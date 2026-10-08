"""Freeze, measure and profile the controlled Chapter 13 RMSNorm rounds.

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
    {'id':'hip-serial-b256','runtime':'hip','version':'serial','block':256,'kernels':['rmsnorm_serial_kernel']},
    *({'id':f'hip-block-b{block}','runtime':'hip','version':'block','block':block,'kernels':['rmsnorm_block_kernel']} for block in (256,128,64)),
    *({'id':f'triton-r{rows}-w{warps}','runtime':'triton','version':'configured','rows_per_program':rows,'num_warps':warps,'kernels':['rmsnorm_kernel' if rows==1 else 'rmsnorm_rows_kernel']} for rows,warps in ((1,4),(1,8),(2,4),(4,4))),
]
MAIN_SHAPE = '4096x1024'
MAIN_IDS = [c['id'] for c in CONFIGS[:6]]
SHORT_SHAPE = '4096x128'
SHORT_IDS = ['triton-r1-w4','triton-r2-w4','triton-r4-w4']
OTHER_IDS = ['hip-block-b256','hip-block-b128','hip-block-b64','triton-r1-w4','triton-r1-w8']
VALIDATION_MATRIX = {SHORT_SHAPE:SHORT_IDS,'128x1024':OTHER_IDS,'4096x1025':OTHER_IDS}
EDGE_CASES = [{'shape':f'33x{cols}','input':mode} for cols in (1,129,257,4097) for mode in ('normal','zero','zero-weight','signed-weight')]


def save(root: Path, m: dict) -> None:
    (root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')


def command(c: dict, root: Path, shape: str, warmup: int, repeat: int, seed: int, input_name: str='normal', epsilon: float=9.999999747378752e-06) -> list[str]:
    rows,cols=map(int,shape.split('x'))
    if c['runtime']=='hip':
        cmd=[str(root/'build/rmsnorm_hip'),'--block',str(c['block'])]
    else:
        cmd=[sys.executable,str(root/'source/rmsnorm_triton.py'),'--rows-per-program',str(c['rows_per_program']),'--num-warps',str(c['num_warps'])]
    return cmd+['--version',c['version'],'--rows',str(rows),'--cols',str(cols),'--warmup',str(warmup),'--repeat',str(repeat),'--seed',str(seed),'--epsilon',str(epsilon),'--input',input_name,'--config-id',c['id']]


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
    files={name:SOURCE/name for name in ('rmsnorm_hip.hip','rmsnorm_triton.py','run_rounds.py','summarize_rounds.py','rounds_identity.py')}
    files.update({name:SOURCE.parent/'chapter8'/name for name in ('collect_environment.sh','resolve_rocprofv3.py')})
    for name,path in files.items(): shutil.copy2(path,root/'source'/name)
    import torch
    if version('rocm')!='10.0.0' or not torch.cuda.is_available() or torch.cuda.get_device_properties(0).gcnArchName.split(':')[0]!='gfx1201':
        raise RuntimeError('requires ROCm10/gfx1201')
    m={'schema_version':1,'experiment':'chapter13-controlled-rmsnorm-rounds','started_at':datetime.now(timezone.utc).isoformat(),
       'hardware':torch.cuda.get_device_name(0),
       'software':{'rocm':version('rocm'),'hip':torch.version.hip,'torch':torch.__version__,'triton':version('triton')},
       'platform':{'os_pretty_name':platform.freedesktop_os_release().get('PRETTY_NAME'),'kernel':platform.release(),'execution':'native'},
       'environment':{'gpu':torch.cuda.get_device_name(0),'architecture':torch.cuda.get_device_properties(0).gcnArchName,'rocm_sdk':version('rocm'),'hip':torch.version.hip,'gpu_exclusive':False,'profiler_during_benchmark':False},
       'source_sha256':{name:sha(root/'source'/name) for name in files},
       'benchmark':{'shape':MAIN_SHAPE,'dtype':'float32','input':'rmsnorm-dyadic-v1','input_mode':'normal','reference':'cpu-fp64-to-fp32','epsilon':9.999999747378752e-06,'seed':args.seed,'warmup':10,'repeat':50,'processes':3,'independent_runs':3,'scope':'gpu-event-full-operator',
                    'atol':2e-5,'rtol':2e-5,'cache':'reuse arrays; no cache flush','timing':'precreate event pairs; synchronize after every single-kernel full-operator interval',
                    'correctness':'output NaN prefill before precheck, full precheck and postcheck; finite, elementwise atol+rtol*abs(FP64 reference castFP32)'},
       'configurations':CONFIGS,'measurement_matrix':{MAIN_SHAPE:MAIN_IDS},'planned_validation_matrix':VALIDATION_MATRIX,'profile_cases':[{'shape':shape,'config_id':cid} for shape,ids in ((MAIN_SHAPE,MAIN_IDS),(SHORT_SHAPE,SHORT_IDS)) for cid in ids],'edge_cases':EDGE_CASES,'execution_order':[]}
    save(root,m)
    run(['bash',str(root/'source/collect_environment.sh')],root/'logs/environment.log',root)
    if shutil.which('amd-smi'):
        for sub in ('metric','process'):run(['amd-smi',sub],root/'logs'/f'gpu-{sub}-before.log',root)
    cmd=['hipcc','--offload-arch=gfx1201','-O3','-std=c++17','-save-temps','../source/rmsnorm_hip.hip','-o','rmsnorm_hip']
    run(cmd,root/'logs/compile.log',root)
    m['build']={'command':cmd,'binary_sha256':sha(root/'build/rmsnorm_hip')}
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
    cases=m['profile_cases']
    m['profile']={'warmup':5,'repeat':10,'precheck_dispatches':1,'tool_kind':selection['kind'],'sdk':selection['rocprof_rocm'],'cases':cases}
    save(root,m)
    configs={c['id']:c for c in m['configurations']}
    for case in m['profile']['cases']:
        c=configs[case['config_id']];stem=f'n{case["shape"]}-{c["id"]}'
        cmd=[selection['executable'],'--rocm-root',selection['root'],'--kernel-trace','--output-directory',str(root/'profiles'),'--output-file',stem,'--output-format','csv','--']
        cmd+=command(c,root,case['shape'],5,10,m['benchmark']['seed'])
        run(cmd,root/'logs'/f'profile-{stem}.log',root,env)


def validation(root: Path,m: dict) -> None:
    m.setdefault('identity_checks',[]).append({'phase':'validation',**check_frozen_identity(root,m)})
    configs={c['id']:c for c in m['configurations']}
    validation_matrix=m['planned_validation_matrix']
    m['measurement_matrix'].update(validation_matrix)
    m['validation_selection']={'shapes':list(validation_matrix),'config_ids':sorted(set(cid for ids in validation_matrix.values() for cid in ids)),'rule':'measurement_matrix specifies the exact per-shape configurations; short rows isolate rows/program at four warps; other shapes retain block/warp candidates'}
    save(root,m)
    for shape,ids in validation_matrix.items():benchmark([configs[cid] for cid in ids],root,m,shape)


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
    if not 0<=a.seed<=0xFFFFFFFFFFFFFFFF:parser.error('seed must fit uint64')
    with open('/tmp/hello-gpu-experiment.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if a.phase in ('main','all'):
            m=initialize(root,a);benchmark([c for c in m['configurations'] if c['id'] in m['measurement_matrix'][MAIN_SHAPE]],root,m,MAIN_SHAPE)
        else:m=json.loads((root/'manifest.json').read_text())
        if a.phase in ('profile','all'):profile(root,m)
        if a.phase in ('validation','all'):validation(root,m)
        m['updated_at']=datetime.now(timezone.utc).isoformat();save(root,m);summarize(root,root/'summary')


if __name__=='__main__':main()
