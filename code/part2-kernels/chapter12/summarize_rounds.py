"""Validate identity, configuration and correctness before publishing Attention statistics."""
from __future__ import annotations
import argparse
from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import shlex
import statistics

META=('config_id','implementation','runtime','shape','dtype','block','block_k','block_d','num_warps','launches','warmup','repeat','seed','scope','input','input_precision','atol','rtol','intermediate_allocated_bytes','intermediate_used_bytes')


def sha(path: Path) -> str:return hashlib.sha256(path.read_bytes()).hexdigest()


def csv_write(path: Path, rows: list[dict]) -> None:
    with path.open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)


def expected_meta(config: dict, shape: str, b: dict) -> dict:
    seq,dim=map(int,shape.split('x'));runtime=config['runtime']
    if runtime=='hip':
        dimensions=dict(block=config['block'],block_k=1 if config['version']=='online' else 0,block_d=0,num_warps=0)
    else:
        dimensions=dict(block=0,block_k=config['block_k'],block_d=1<<(dim-1).bit_length(),num_warps=config['num_warps'])
    return {key:str(v) for key,v in dict(config_id=config['id'],implementation=runtime+'-'+config['version'],runtime=runtime,shape=shape,launches=len(config['kernels']),input_precision='fp32',intermediate_allocated_bytes=2*seq*seq*4,intermediate_used_bytes=2*seq*seq*4 if config['version']=='materialized' else 0,**dimensions,**{key:b[key] for key in ('dtype','warmup','repeat','seed','scope','input','atol','rtol')}).items()}


def matches(actual: dict,expected: dict) -> bool:
    for key,value in expected.items():
        if key in ('atol','rtol'):
            try:
                if float(actual.get(key,'nan'))!=float(value):return False
            except ValueError:return False
        elif actual.get(key)!=value:return False
    return True

def log_result(path: Path, manifest: dict, metadata: dict) -> dict:
    text=path.read_text().splitlines();env_lines=[x for x in text if x.startswith('ENV ')];result_lines=[x for x in text if x.startswith('RESULT ')]
    if len(env_lines)!=1 or len(result_lines)!=1:raise ValueError(f'expected one ENV/RESULT: {path}')
    parse=lambda x:dict(token.split('=',1) for token in shlex.split(x)[1:])
    env,result=parse(env_lines[0]),parse(result_lines[0])
    expected_env={'runtime':metadata['runtime'],'gpu':manifest['environment']['gpu']}
    if metadata['runtime']=='triton':
        expected_env.update(torch=manifest['software']['torch'],torch_hip=manifest['software']['hip'],triton=manifest['software']['triton'].split('+')[0])
    else:
        expected_env.update(arch='gfx1201',wave_size='32')
    if any(env.get(k)!=v for k,v in expected_env.items()):raise ValueError(f'ENV mismatch: {path}')
    if not matches(result,metadata):raise ValueError(f'RESULT metadata mismatch: {path}')
    if any(result.get(k)!='OK' for k in ('correct','precheck','postcheck','output_finite')):raise ValueError(f'correctness failed: {path}')
    if result.get('reference')!=manifest['benchmark']['reference']:raise ValueError(f'reference mismatch: {path}')
    for key in ('max_abs_error','max_tolerance_ratio'):
        error=float(result[key])
        if not math.isfinite(error) or error<0 or (key=='max_tolerance_ratio' and error>1):raise ValueError(f'invalid correctness error: {path}')
    # Correctness is elementwise atol+rtol*abs(reference); a global max relative
    # error alone is not the acceptance criterion near zero.
    return result


def verify_identity(root: Path,m: dict,frozen_root: Path | None=None) -> dict:
    frozen=frozen_root or root
    for name,expected in m['source_sha256'].items():
        if sha(frozen/'source'/name)!=expected:raise ValueError(f'frozen source mismatch: {name}')
    if sha(frozen/'build/attention_hip')!=m['build']['binary_sha256']:raise ValueError('frozen binary mismatch')
    if m['benchmark']['scope']!='gpu-event-full-operator':raise ValueError('unexpected timing scope')
    configs={c['id']:c for c in m['configurations']}
    if len(configs)!=len(m['configurations']):raise ValueError('duplicate config ID')
    matrix={m['benchmark']['shape']:set(configs)}
    for shape in m.get('validation_selection',{}).get('shapes',[]):matrix[shape]=set(m['validation_selection']['config_ids'])
    planned={}
    for shape,ids in matrix.items():
        if not ids<=configs.keys():raise ValueError('unknown validation config')
        for process in range(1,m['benchmark']['processes']+1):
            for config_id in ids:planned[f'n{shape}-{config_id}-p{process}.csv']=(configs[config_id],shape,process)
    actual={p.name for p in (root/'samples').glob('*.csv')}
    if actual!=planned.keys():raise ValueError(f'matrix mismatch missing={planned.keys()-actual} extra={actual-planned.keys()}')
    previous_path=root/'summary/manifest.json'
    if previous_path.exists():
        previous=json.loads(previous_path.read_text())
        if previous['started_at']!=m['started_at'] or previous['source_sha256']!=m['source_sha256']:raise ValueError('prior publication identity mismatch')
        for key in ('sample_sha256','log_sha256','profile_sha256'):
            for name,expected in previous.get(key,{}).items():
                if sha(root/name)!=expected:raise ValueError(f'raw file changed: {name}')
    return planned


def summarize(root: Path,output: Path,*,frozen_root: Path | None=None) -> list[dict]:
    m=json.loads((root/'manifest.json').read_text());planned=verify_identity(root,m,frozen_root);b=m['benchmark']
    records=[];sample_hash={};log_hash={}
    for path in sorted((root/'samples').glob('*.csv')):
        c,shape,process=planned[path.name];metadata=expected_meta(c,shape,b)
        rows=list(csv.DictReader(path.open()))
        if len(rows)!=b['repeat'] or [int(r['sample']) for r in rows]!=list(range(b['repeat'])):raise ValueError(f'incomplete samples: {path}')
        for r in rows:
            if not matches(r,metadata) or r['process']!=str(process):raise ValueError(f'sample metadata mismatch: {path}')
        values=[float(r['ms']) for r in rows]
        if any(not math.isfinite(v) or v<=0 for v in values):raise ValueError(f'invalid sample duration: {path}')
        log=root/'logs'/f'{path.stem}.log';result=log_result(log,m,metadata);median=statistics.median(values)
        if result['process']!=str(process):raise ValueError(f'RESULT process mismatch: {log}')
        if abs(median-float(result['median_ms']))>5.1e-7:raise ValueError(f'sample/RESULT median mismatch: {path}')
        row=dict(metadata,process=process,sample_count=len(values),min_ms=min(values),median_ms=median,max_ms=max(values),mean_ms=statistics.fmean(values),correct='OK',max_abs_error=float(result['max_abs_error']),max_tolerance_ratio=float(result['max_tolerance_ratio']),sample_file=str(path.relative_to(root)),log_file=str(log.relative_to(root)))
        records.append(row);sample_hash[row['sample_file']]=sha(path);log_hash[row['log_file']]=sha(log)
    edge_expected={f'edge-{case["input"]}-{case["shape"]}-{c["id"]}.log':(case,c) for case in m.get('edge_cases',[]) for c in m['configurations']}
    if {p.name for p in (root/'logs').glob('edge-*.log')}!=edge_expected.keys():raise ValueError('edge matrix mismatch')
    for name,(case,c) in edge_expected.items():
        log=root/'logs'/name;log_result(log,m,expected_meta(c,case['shape'],{**b,'warmup':0,'repeat':1,'input':case['input']}));log_hash['logs/'+name]=sha(log)
    groups=defaultdict(list)
    for r in records:groups[tuple(r[k] for k in META)].append(r)
    summary=[]
    for key,group in sorted(groups.items()):
        if sorted(r['process'] for r in group)!=list(range(1,b['processes']+1)):raise ValueError('incomplete/duplicate processes')
        medians=[r['median_ms'] for r in group]
        row=dict(zip(META,key))
        row.update(run_count=len(group),correct='OK',median_ms=statistics.median(medians),median_ms_run_min=min(medians),median_ms_run_max=max(medians),max_abs_error=max(r['max_abs_error'] for r in group),max_tolerance_ratio=max(r['max_tolerance_ratio'] for r in group))
        summary.append(row)
    if not summary:raise ValueError('empty measurement')
    profile_rows=[];profile_hash={}
    if 'profile' in m:
        skip=m['profile']['warmup']+m['profile']['precheck_dispatches'];count=skip+m['profile']['repeat']
        seq,dim=map(int,b['shape'].split('x'))
        for c in m['configurations']:
            log=root/'logs'/f'profile-{c["id"]}.log';log_result(log,m,expected_meta(c,b['shape'],{**b,'warmup':m['profile']['warmup'],'repeat':m['profile']['repeat']}));log_hash[str(log.relative_to(root))]=sha(log)
            path=root/'profiles'/f'{c["id"]}_kernel_trace.csv';traces=list(csv.DictReader(path.open()));profile_hash[str(path.relative_to(root))]=sha(path)
            for stage,kernel in enumerate(c['kernels'],1):
                target=sorted([r for r in traces if kernel in r['Kernel_Name']],key=lambda r:int(r['Start_Timestamp']))
                if len(target)!=count:raise ValueError(f'expected {count} dispatches of {kernel}, got {len(target)}')
                times=[(int(r['End_Timestamp'])-int(r['Start_Timestamp']))/1e6 for r in target[skip:]]
                if any(t<=0 for t in times):raise ValueError('invalid trace duration')
                row=dict(config_id=c['id'],shape=b['shape'],stage=stage,kernel=kernel,scope='rocprofv3-kernel-trace',trace_dispatches=count,excluded_precheck_warmup=skip,timed_dispatches=len(times),trace_median_ms=statistics.median(times),trace_min_ms=min(times),trace_max_ms=max(times))
                for field in ('Grid_Size_X','Grid_Size_Y','Grid_Size_Z','Workgroup_Size_X','Workgroup_Size_Y','Workgroup_Size_Z','VGPR_Count','SGPR_Count','LDS_Block_Size','Scratch_Size'):
                    values={r[field] for r in target}
                    if len(values)!=1:raise ValueError(f'nonuniform {field}: {kernel}')
                    row[field]=values.pop()
                wx=c['block'] if c['runtime']=='hip' else 32*c['num_warps']
                gx=seq
                if c['runtime']=='hip' and c['version']=='materialized':
                    if stage==1:gx=(seq*seq+wx-1)//wx
                    elif stage==3:gx=(seq*dim+wx-1)//wx
                expected={'Grid_Size_X':gx*wx,'Grid_Size_Y':1,'Grid_Size_Z':1,'Workgroup_Size_X':wx,'Workgroup_Size_Y':1,'Workgroup_Size_Z':1}
                if any(int(row[key])!=value for key,value in expected.items()):raise ValueError(f'trace launch mismatch: {kernel}')
                profile_rows.append(row)
    m.update(sample_sha256=sample_hash,log_sha256=log_hash,profile_sha256=profile_hash,correctness_checks={'small_checks':len(edge_expected),'correct':'OK'},analysis={'summarizer_sha256':sha(Path(__file__)),'identity_check':'frozen source/binary; actual ENV; full matrix/metadata; correctness; trace grid/count; prior raw hashes'},statistics={'within_process':'median of event samples','across_processes':'median of process medians; min/max of process medians','range_is_confidence_interval':False,'sample_count':sum(r['sample_count'] for r in records)})
    output.mkdir(parents=True,exist_ok=True);csv_write(output/'summary.csv',summary);csv_write(output/'process-summary.csv',records);(output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    artifacts=['summary.csv','process-summary.csv','summary.json']
    if profile_rows:csv_write(output/'profile-summary.csv',profile_rows);artifacts.append('profile-summary.csv')
    m['artifacts_sha256']={name:sha(output/name) for name in artifacts};(output/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    print(f'summarized {len(summary)} configurations and {len(records)} processes -> {output}')
    return summary


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('run_dir',type=Path);parser.add_argument('--out',type=Path);parser.add_argument('--frozen-run',type=Path);a=parser.parse_args();summarize(a.run_dir,a.out or a.run_dir/'summary',frozen_root=a.frozen_run)
