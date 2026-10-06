"""Measure GEMM tiles first, then grouping with the selected tile fixed.

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

SOURCE=Path(__file__).resolve().parent
MAIN_SHAPE='1024x1024x1024'
EDGE_SHAPES=['129x128x128','128x129x128','128x128x129']
VALIDATION_SHAPES=['256x1024x512','1024x256x512']


def triton_config(m: int,n: int,group: int) -> dict:
    return dict(id=f'triton-b{m}x{n}-g{group}',runtime='triton',version='baseline' if group==1 else 'grouped',block_m=m,block_n=n,block_k=32,num_warps=4,group_m=group,kernels=['matmul_kernel'])


CONFIGS=[dict(id='hip-naive-t16',runtime='hip',version='naive',tile=16,kernels=['matmul_naive']),
         *(dict(id=f'hip-tiled-t{tile}',runtime='hip',version='tiled',tile=tile,kernels=['matmul_tiled']) for tile in (16,8,32)),
         *(triton_config(m,n,1) for m,n in ((32,32),(32,64),(64,32)))]


def save(root: Path,m: dict) -> None:(root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')


def command(c: dict,root: Path,shape: str,warmup: int,repeat: int,seed: int) -> list[str]:
    m,n,k=shape.split('x')
    if c['runtime']=='hip':cmd=[str(root/'build/matmul_hip'),'--tile',str(c['tile'])]
    else:
        cmd=[sys.executable,str(root/'source/matmul_triton.py')]
        for key in ('block_m','block_n','block_k','num_warps','group_m'):cmd+=['--'+key.replace('_','-'),str(c[key])]
    return cmd+['--version',c['version'],'--m',m,'--n',n,'--k',k,'--warmup',str(warmup),'--repeat',str(repeat),'--seed',str(seed),'--config-id',c['id']]


def run(cmd: list[str],log: Path,root: Path,env: dict | None=None) -> None:
    print(f'running {log.stem}',flush=True)
    with (root/'commands.jsonl').open('a') as f:f.write(json.dumps({'time':datetime.now(timezone.utc).isoformat(),'argv':cmd,'log':str(log.relative_to(root))})+'\n')
    with log.open('w') as f:subprocess.run(cmd,cwd=root/'build',stdout=f,stderr=subprocess.STDOUT,check=True,env=env)


def edges(configs: list[dict],root: Path,m: dict) -> None:
    for shape in m['edge_shapes']:
        for c in configs:run(command(c,root,shape,0,1,m['benchmark']['seed']),root/'logs'/f'edge-{shape}-{c["id"]}.log',root)


def benchmark(configs: list[dict],root: Path,m: dict,shape: str) -> None:
    b=m['benchmark']
    for process in range(1,b['processes']+1):
        offset=(process-1)*max(1,len(configs)//3);order=configs[offset:]+configs[:offset]
        m['execution_order'].append({'shape':shape,'process':process,'configs':[c['id'] for c in order]});save(root,m)
        for c in order:
            stem=f'n{shape}-{c["id"]}-p{process}';sample=root/'samples'/f'{stem}.csv'
            if sample.exists():raise FileExistsError(sample)
            run(command(c,root,shape,b['warmup'],b['repeat'],b['seed'])+['--samples',str(sample),'--process',str(process)],root/'logs'/f'{stem}.log',root)


def initialize(root: Path,a: argparse.Namespace) -> dict:
    if root.exists():raise FileExistsError('choose a new output directory')
    for folder in ('source','build','samples','logs','profiles'):(root/folder).mkdir(parents=True,exist_ok=True)
    files={name:SOURCE/name for name in ('matmul_hip.hip','matmul_triton.py','run_rounds.py','summarize_rounds.py','rounds_identity.py')}
    files.update({name:SOURCE.parent/'chapter8'/name for name in ('collect_environment.sh','resolve_rocprofv3.py')})
    for name,path in files.items():shutil.copy2(path,root/'source'/name)
    import torch
    if version('rocm')!='10.0.0' or not torch.cuda.is_available() or torch.cuda.get_device_properties(0).gcnArchName.split(':')[0]!='gfx1201':raise RuntimeError('requires ROCm10/gfx1201')
    m={'schema_version':1,'experiment':'chapter11-controlled-matmul-rounds','started_at':datetime.now(timezone.utc).isoformat(),'hardware':torch.cuda.get_device_name(0),
       'software':{'rocm':version('rocm'),'hip':torch.version.hip,'torch':torch.__version__,'triton':version('triton')},
       'platform':{'os_pretty_name':platform.freedesktop_os_release().get('PRETTY_NAME'),'kernel':platform.release(),'execution':'native'},
       'environment':{'gpu':torch.cuda.get_device_name(0),'architecture':torch.cuda.get_device_properties(0).gcnArchName,'rocm_sdk':version('rocm'),'hip':torch.version.hip,'gpu_exclusive':False,'profiler_during_benchmark':False},
       'source_sha256':{name:sha(root/'source'/name) for name in files},
       'benchmark':{'shape':MAIN_SHAPE,'dtype':'float32','input':'dyadic-modular-v1','reference':'cpu-fp64-to-fp32','atol':1e-4,'rtol':1e-4,'seed':a.seed,'warmup':10,'repeat':50,'processes':3,'independent_runs':3,'scope':'gpu-event-full-operator','cache':'reuse arrays; no cache flush','timing':'pre-create events, enqueue timed intervals, then synchronize; no JIT/allocation/copy/reference/check in timing','correctness':'NaN output prefill, complete pre/post check, finite and abs_error <= atol+rtol*abs(reference)'},
       'configurations':CONFIGS,'edge_shapes':EDGE_SHAPES,'execution_order':[]}
    save(root,m);run(['bash',str(root/'source/collect_environment.sh')],root/'logs/environment.log',root)
    if shutil.which('amd-smi'):
        for sub in ('metric','process'):run(['amd-smi',sub],root/'logs'/f'gpu-{sub}-before.log',root)
    cmd=['hipcc','--offload-arch=gfx1201','-O3','-std=c++17','-save-temps','../source/matmul_hip.hip','-o','matmul_hip']
    run(cmd,root/'logs/compile.log',root);m['build']={'command':cmd,'binary_sha256':sha(root/'build/matmul_hip')};save(root,m)
    edges(m['configurations'],root,m)
    return m


def group_scan(root: Path,m: dict) -> None:
    rows=summarize(root,root/'summary')
    candidates=[r for r in rows if r['runtime']=='triton' and r['shape']==MAIN_SHAPE]
    selected=min(candidates,key=lambda r:r['median_ms'])
    configs=[triton_config(int(selected['block_m']),int(selected['block_n']),g) for g in (4,8)]
    m['tile_selection']={'rule':'lowest median of three process medians among primary group1 Triton tiles','candidates':[r['config_id'] for r in candidates],'selected_config_id':selected['config_id'],'block_m':int(selected['block_m']),'block_n':int(selected['block_n']),'group_scan_ids':[selected['config_id'],*[c['id'] for c in configs]],'group1_reuses_primary_measurement':True}
    m['configurations'].extend(configs);save(root,m);edges(configs,root,m);benchmark(configs,root,m,MAIN_SHAPE)


def select(root: Path,m: dict) -> list[dict]:
    rows=summarize(root,root/'summary');main=[r for r in rows if r['shape']==MAIN_SHAPE]
    hip=min((r for r in main if r['implementation']=='hip-tiled'),key=lambda r:r['median_ms'])['config_id']
    group=min((r for r in main if r['config_id'] in m['tile_selection']['group_scan_ids']),key=lambda r:r['median_ms'])['config_id']
    ids={'hip-naive-t16','hip-tiled-t16',hip,'triton-b32x32-g1',m['tile_selection']['selected_config_id'],group}
    m['selected_candidates']={'hip_tile':hip,'triton_tile':m['tile_selection']['selected_config_id'],'triton_group':group,'rule':'within-route measured median, not a global optimum'}
    return [c for c in m['configurations'] if c['id'] in ids]


def profile(root: Path,m: dict) -> None:
    m.setdefault('identity_checks',[]).append({'phase':'profile',**check_frozen_identity(root,m)})
    selection=json.loads(subprocess.check_output([sys.executable,str(root/'source/resolve_rocprofv3.py')],text=True))
    if not selection['available']:raise RuntimeError(selection['reason'])
    env=os.environ.copy();env['LD_LIBRARY_PATH']=os.pathsep.join(selection['library_dirs']+[env.get('LD_LIBRARY_PATH','')])
    m['profile']={'warmup':5,'repeat':10,'precheck_dispatches':1,'tool_kind':selection['kind'],'sdk':selection['rocprof_rocm']};save(root,m)
    for c in m['configurations']:
        cmd=[selection['executable'],'--rocm-root',selection['root'],'--kernel-trace','--output-directory',str(root/'profiles'),'--output-file',c['id'],'--output-format','csv','--']+command(c,root,MAIN_SHAPE,5,10,m['benchmark']['seed'])
        run(cmd,root/'logs'/f'profile-{c["id"]}.log',root,env)


def validation(root: Path,m: dict) -> None:
    m.setdefault('identity_checks',[]).append({'phase':'validation',**check_frozen_identity(root,m)});selected=select(root,m)
    m['validation_selection']={'shapes':VALIDATION_SHAPES,'config_ids':[c['id'] for c in selected],'rule':'route baselines, controlled intermediate and selected tiles/groups; duplicates removed'};save(root,m)
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
            m=initialize(root,a);benchmark(m['configurations'],root,m,MAIN_SHAPE);group_scan(root,m)
        else:m=json.loads((root/'manifest.json').read_text())
        if a.phase in ('profile','all'):profile(root,m)
        if a.phase in ('validation','all'):validation(root,m)
        m['updated_at']=datetime.now(timezone.utc).isoformat();save(root,m);summarize(root,root/'summary')


if __name__=='__main__':main()
