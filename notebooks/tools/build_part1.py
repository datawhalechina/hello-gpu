"""Maintain the executable learning text for Part 1; outputs are generated remotely."""
from authoring import Notebook, ROOT
from html import escape

SETUP = '''import torch
import hello_gpu as gpu
from hello_gpu import learning, profiling
%load_ext hello_gpu
cfg = gpu.settings()
env = gpu.environment()
env'''
KERNEL = '''%%hip vector_add --entry vector_add
__global__ void vector_add(const float* a, const float* b, float* c, int n) {
    int64_t i = static_cast<int64_t>(blockIdx.x) * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}'''
PREPARE = '''a, b = learning.inputs(N, seed=cfg['seed'])
out = torch.empty_like(a)
run = vector_add.prepare(a, b, block=cfg['block'], out=out)
run()
torch.testing.assert_close(out, a + b)'''


def semantic_figure(name, title, columns, footer):
    """Write symbolic teaching diagrams; no sampled or historical performance data."""
    target = ROOT / 'notebooks' / 'assets' / f'learning-{name}.svg'
    target.parent.mkdir(parents=True, exist_ok=True)
    elements = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 250" role="img">',
                f'<title>{escape(title)}</title>',
                '<rect width="1240" height="250" fill="#f8faf9"/>',
                f'<text x="24" y="35" font-family="sans-serif" font-size="22" fill="#173d4e">{escape(title)}</text>']
    for index, lines in enumerate(columns):
        x = 24 + index * 305
        elements.append(f'<rect x="{x}" y="64" width="285" height="126" rx="9" fill="#edf4f5" stroke="#497789"/>')
        for line, label in enumerate(lines):
            elements.append(f'<text x="{x+12}" y="{95+line*32}" font-family="sans-serif" font-size="16" fill="#183c4a">{escape(label)}</text>')
    elements.append(f'<text x="24" y="226" font-family="sans-serif" font-size="15" fill="#445a62">{escape(footer)}</text></svg>')
    target.write_text('\n'.join(elements))
    return target


def chapter5():
    nb = Notebook('part1-profiling', 5)
    nb.md('''# 第5章 benchmark 与可信计时

修改一行 kernel 后，时间变短了。这是改动的收益，还是运行波动？我们先明确计时的起终点，再保留样本，用同一个加法观察单次计时和批量计时。

前置：[第4章](../../part0-intro/chapter4/chapter4.ipynb)。完整解释见[正文](../../../docs/part1-profiling/chapter5/index.md)。这里的输入规模、预热与重复次数来自 `notebooks/config.toml`，可以按设备显存调整。''')
    nb.md('''## 5.1 先确定计时的起点和终点

本章的输入和输出提前放在 GPU 上。起止 event 在同一个 stream 排队，CPU 在计时外等结束 event 完成。区间可能包含主机提交的间隙；它不自动等于 profiler 中 kernel 的起止差。''')
    nb.figure('docs/part0-intro/chapter4/images/event-timing.svg', 'event 先排队、后执行；读取结束时间前需要等待。', '主机提交与GPU执行的event时间线')
    nb.code(SETUP)
    nb.md('''## 5.2 运行一次完整的基准测试

沿用已经理解的向量加法。kernel 源码在本单元；公共包只管理编译和绑定。输入使用固定 seed 的非均匀数据，输出通过全量核对后才进入测量。''')
    nb.code(KERNEL)
    nb.code("N = cfg['n']\n" + PREPARE)
    nb.code('''single = gpu.benchmark(run, label='HIP single', warmup=cfg['warmup'], repeat=cfg['repeat'])
gpu.summary([single])''')
    nb.md('''## 5.3 从准备数据到记录一个样本

`prepare` 提前分配并核对 Tensor 元数据；实际调用仍包含 C++ 校验与启动。下面把计时步骤展开一次，观察 start→运算→end 的关系。初始化 event 放在正式计时之前。''')
    nb.code('''start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
start.record(); end.record(); end.synchronize()
start.record()
run()
end.record()
end.synchronize()
print('一次 event 区间：', start.elapsed_time(end), 'ms')''')
    nb.md('''多次测量能显示离群点。最小值是本次最快样本，中位数描述中心位置；两者都不保证下一次调用的时间。先看分布，再解释改动。''')
    nb.code('gpu.plot_samples(single)')
    nb.md('''## 5.4 单次样本与批量平均值

用一对 event 包住多次调用，再除以调用数，得到一个批平均值。下面重复测量多批；批平均值之间的分布也不能还原批内各次调用的分布。''')
    nb.figure('docs/part1-profiling/chapter5/images/event-sampling.svg', '同一个算子，两种采样边界。', '逐次计时与批量计时的event布局')
    nb.code('''batch = gpu.benchmark_batch(run, label='HIP batch mean', batch=20,
                            warmup=cfg['warmup'], repeat=cfg['repeat'])
gpu.summary([single, batch])''')
    nb.code('gpu.plot_samples([single, batch])')
    nb.md('''## 5.5 从时间算出有效带宽

加法的算法字节数是 $3Ns$；复制只有一次读、一次写，是 $2Ns$。GB/s 使用十进制字节。这些是逻辑有效字节，重复输入可能命中缓存，不能据此读取物理显存流量。

接着写一个短 Triton 复制 kernel。它不是用来与加法比较框架优劣，而是让读写总量的系数更清楚。''')
    nb.code('''import triton
import triton.language as tl
@triton.jit
def copy_kernel(x, y, n, BLOCK: tl.constexpr):
    offsets = tl.program_id(0) * BLOCK + tl.arange(0, BLOCK)
    valid = offsets < n
    tl.store(y + offsets, tl.load(x + offsets, mask=valid, other=0), mask=valid)''')
    nb.code('''copied = torch.empty_like(a)
def run_copy():
    copy_kernel[(triton.cdiv(a.numel(), 1024),)](a, copied, a.numel(), BLOCK=1024, num_warps=4)
run_copy()
torch.testing.assert_close(copied, a)
copy_time = gpu.benchmark_batch(run_copy, label='Triton copy batch', batch=20,
                               warmup=cfg['warmup'], repeat=cfg['repeat'])
print('加法 GB/s：', 3 * a.numel() * a.element_size() / single.median_ms / 1e6)
print('复制 GB/s：', 2 * a.numel() * a.element_size() / copy_time.median_ms / 1e6)''')
    nb.md('''## 5.6 复测、记录与练习

保留每次样本及其口径。新的输入规模或 dtype 要重新预热；正式计时与 profiling 分开执行。''')
    nb.code('''timings = gpu.summary([single, batch, copy_time])
launches = {
    'HIP single': {'block': cfg['block'], 'batch': 1},
    'HIP batch mean': {'block': cfg['block'], 'batch': 20},
    'Triton copy batch': {'BLOCK': 1024, 'num_warps': 4,
                          'grid': [triton.cdiv(a.numel(), 1024)], 'batch': 20},
}
record = learning.save_table('part1-profiling/chapter5', timings,
                            config={**cfg, 'n': a.numel(), 'correctness': 'full comparison passed'},
                            kernels=[vector_add], sources={'Triton copy batch': copy_kernel.src},
                            launches=launches)
record''')
    nb.md('''**练习**：把批大小从 20 改为 5，比较批平均值分布；把输入长度加倍，重新校验并测量；说明哪些现象可能由缓存或提交节奏引起，还需要什么证据。

## 本章小结

我们固定了输入、输出分配和采样方式，保留了原始样本，并把字节数与时间换算成逻辑有效带宽。下一章用 profiler 直接观察 kernel dispatch。

## 延伸阅读

- [第6章 notebook](../chapter6/chapter6.ipynb)
- [PyTorch HIP 语义](https://docs.pytorch.org/docs/stable/notes/hip.html)''')
    nb.write()


def chapter6():
    nb = Notebook('part1-profiling', 6)
    nb.md('''# 第6章 用 rocprof 找到慢在哪里

相同加法可以用不同线程分工执行。我们先测量两个正确实现，再让 rocprofv3 记录独立进程中的 kernel 启动，学习怎样筛记录、读时间和资源字段。

前置：[第5章](../chapter5/chapter5.ipynb)。对应[正文](../../../docs/part1-profiling/chapter6/index.md)。本 notebook 用整 block 的分工表达连续与跨步，不预设 wavefront 的固定宽度。''')
    nb.md('''## 6.1 先运行两个向量加法

连续版让每个线程算一个元素。linecross 教学反例让线程每轮跨着取元素，但所有输出仍各写一次。它同时改变每线程工作量和 block 数；时间差不能只归因于一种硬件机制。''')
    nb.code(SETUP)
    nb.code(KERNEL)
    nb.code('''%%hip linecross --entry linecross
__global__ void linecross(const float* a, const float* b, float* c, int n) {
    const int ITEMS = 8;
    int64_t base = static_cast<int64_t>(blockIdx.x) * blockDim.x * ITEMS;
    for (int j = 0; j < ITEMS; ++j) {
        int64_t i = base + static_cast<int64_t>(threadIdx.x) * ITEMS + j;
        if (i < n) c[i] = a[i] + b[i];
    }
}''')
    nb.code('''a, b = learning.inputs(cfg['n'] + 17, seed=cfg['seed'])
outputs = {name: torch.empty_like(a) for name in ('contiguous', 'linecross')}
ITEMS = 8
linecross_grid = (a.numel() + cfg['block'] * ITEMS - 1) // (cfg['block'] * ITEMS)
calls = {'contiguous': vector_add.prepare(a, b, block=cfg['block'], out=outputs['contiguous']),
         'linecross': linecross.prepare(a, b, block=cfg['block'], grid_limit=linecross_grid,
                                        out=outputs['linecross'])}
table = learning.compare(calls, reference=a+b, outputs=outputs,
                         warmup=cfg['warmup'], repeat=cfg['repeat'], bytes_moved=12*a.numel())
table''')
    nb.code("learning.plot_comparison(table, baseline='contiguous')")
    nb.md('''## 6.2 把线程分工画出来

先在纸上找一个 thread 对应的下标。连续版相邻线程访问相邻元素，linecross 版相邻线程在同轮访问相隔 ITEMS 的元素。这个图用于解释地址顺序，不规定你的设备怎样合并物理事务。''')
    nb.figure(semantic_figure('linecross-mapping', '相邻线程的访问位置：只描述地址，不固定 wave 宽度',
              [('连续版', 'thread t', 'base + t'), ('跨步：第 j 轮', 'thread t', 'base + t × ITEMS + j'),
               ('一个 block', 'blockDim × ITEMS 个元素', '不足部分由 i < n 保护'),
               ('启动网格', 'ceil(n / (block × ITEMS))', '每个启动 block 都有工作')],
              'ITEMS 来自 kernel 配置；相邻线程同轮相隔 ITEMS 个元素，不据此推断硬件事务。'),
              '该图对应当前 block 级索引公式，不标注固定 wavefront 宽度。', '连续与跨步访问的符号下标图')
    nb.code('''import pandas as pd
pd.DataFrame({'thread': range(8), 'contiguous': range(8),
              'linecross_round0': [i*ITEMS for i in range(8)]})''')
    nb.md('''## 6.3 让 rocprofv3 记录 kernel 的执行

profiling 在另一个进程进行，读入本 notebook 当前 kernel 源码。首次编译、校验和参考算子也会产生活动，不能把整份 CSV 的行数当作目标 launch 次数。

如果你的环境没有 rocprofv3，下面显示 unavailable；可以在 `config.toml` 指定安装路径或把 profiling.enabled 改为 false，然后继续学习 CSV 的读法。''')
    nb.code('profiling.capabilities()')
    nb.code('''trace = profiling.kernel_trace({'vector_add': vector_add, 'linecross': linecross},
                               n=a.numel(), block=cfg['block'], launches=3, label='chapter6',
                               grid_limits={'linecross': linecross_grid})
print({k:v for k,v in trace.items() if k not in ('table','input','environment')})''')
    nb.md('''## 6.4 从 CSV 中读懂一次启动

Start/End Timestamp 的单位是纳秒，差值除以 1000 得微秒。只筛本章命名的 kernel，再核对启动次数、grid、workgroup；缺失字段保留缺失，不填成零。''')
    nb.figure(semantic_figure('trace-fields', '从原始 trace 到目标 kernel 的本次记录',
              [('原始 CSV', '可能含初始化与库算子', '保留原始记录'),
               ('按 kernel 名筛选', '使用本次目标名字', '不预填命中条数'),
               ('核对启动配置', 'grid / workgroup / cap', '与 benchmark 参数一致'),
               ('读取时间与资源', 'End − Start，保留单位', '缺失值不填 0')],
              '实际 launch 数由本次 CSV 核对；图中不含旧实验的次数或性能数。'),
              '本次 trace 的筛选顺序示意；最终字段与条数以实际采集为准。', '无预设数值的trace记录筛选图')
    nb.code('profiling.trace_summary(trace)')
    nb.md('''## 6.5 这些证据还不能说明什么

VGPR/SGPR/LDS 字段描述每次启动的资源信息，单凭寄存器数不能计算利用率。kernel 时间与 event 区间的口径也不同。没有有效计数器或 ISA 对照时，缓存命中率、occupancy 和访存事务只能作为待检验假设。''')
    nb.code("print('当前可读字段：', list(trace.get('table', pd.DataFrame()).columns))")
    nb.md('''## 6.6 用 stride 扫描提出下一步实验

固定 block 和输入，真正改变 kernel 中的 ITEMS：它同时改变每线程循环次数、同轮跨步距离与有工作 block 数。每个版本按 ceil(n / (block × ITEMS)) 限制 grid，避免大量空跑 block。每次都重新编译、对答案并计时，不借用正文历史数据。''')
    nb.code('''scan_calls, scan_outputs, scan_kernels, scan_launches = {}, {}, [], {}
for items in (4, 8, 16):
    source = linecross.source.replace('const int ITEMS = 8;', f'const int ITEMS = {items};')
    kernel = gpu.compile_kernel(f'linecross_items_{items}', source, entry='linecross')
    cap = (a.numel() + cfg['block'] * items - 1) // (cfg['block'] * items)
    name = f'linecross ITEMS={items}'
    scan_outputs[name] = torch.empty_like(a)
    scan_calls[name] = kernel.prepare(a, b, block=cfg['block'], grid_limit=cap,
                                      out=scan_outputs[name])
    scan_kernels.append(kernel)
    scan_launches[name] = {'ITEMS': items, 'block': cfg['block'], 'grid_limit': cap}
scan_table = learning.compare(scan_calls, reference=a+b, outputs=scan_outputs,
                               warmup=cfg['warmup'], repeat=cfg['repeat'],
                               bytes_moved=12*a.numel())
scan_table''')
    nb.md('''## 6.7 练习

在扫描中增加 ITEMS=2，重新编译、检查全部答案、测量，再用对应 grid cap 采 trace。分别写出“源码改变了什么”“时间观察到什么”和“还没证明什么”。比较时固定输入和计时方法。''')
    nb.code('''record = learning.save_table('part1-profiling/chapter6',table,
                             config={**cfg,'n':a.numel(),'trace_status':trace['status']},
                             kernels=[vector_add,linecross],
                             launches={'contiguous': {'block':cfg['block']},
                                       'linecross': {'ITEMS':ITEMS,'block':cfg['block'],'grid_limit':linecross_grid}})
scan_record = learning.save_table('part1-profiling/chapter6-items',scan_table,
                                  config={**cfg,'n':a.numel()},kernels=scan_kernels,launches=scan_launches)
record, scan_record''')
    nb.md('''## 本章小结

我们用独立的 profiler 采集路径解释 kernel dispatch，按名称筛选真实记录，保留字段边界。下一章把算法工作量与本机测量一起放进 Roofline。

## 延伸阅读

- [第7章 notebook](../chapter7/chapter7.ipynb)
- [rocprofv3 官方指南](https://rocm.docs.amd.com/projects/rocprofiler-sdk/en/latest/how-to/using-rocprofv3.html)''')
    nb.write()


def chapter7():
    nb = Notebook('part1-profiling', 7)
    nb.md('''# 第7章 读懂 Roofline 图

得到时间以后，优先研究数据访问还是计算？我们从向量加法数出计算量、读写量，再把本次 GPU 测量画成一个点。参考线也从当前设备测量，不把其他显卡的固定峰值带进来。

前置：[第6章](../chapter6/chapter6.ipynb)。对应[正文](../../../docs/part1-profiling/chapter7/index.md)。''')
    nb.md('''## 7.1 一次加法包含多少工作

一个 FP32 输出对应一次加法、两次读取和一次写入：$F=N$ FLOP，$Q=12N$ Byte，所以 $AI=F/Q=1/12$ FLOP/Byte。长度抵消，规模增加不会改变算法算术强度。''')
    nb.figure('docs/part1-profiling/chapter7/images/vector-add-work.svg', '先按算法计算 F 与 Q，再讨论硬件参考。', '一次向量加法的逻辑工作')
    nb.code(SETUP)
    nb.code("N = cfg['n']\nF, Q = N, 12*N\nAI = F/Q\nprint({'FLOP':F,'logical_bytes':Q,'AI':AI})")
    nb.md('''## 7.2 为什么图上的线像屋顶

参考带宽对应斜线 $P=BW\\times AI$；参考计算吞吐对应水平线；两条线取小值形成屋顶。这里测 `copy_` 和 FP32 矩阵乘来建立**工作负载参考线**，它们不是硬件峰值，不是其他 kernel 不可越过的物理上限。

可在 config.toml 的 roofline 中提供 bandwidth_gbs、compute_tflops 和来源；默认零表示本次运行测量。矩阵大小也可以调整。''')
    nb.code('''from hello_gpu.config import configuration
roof_cfg = configuration().get('roofline', {})
references = learning.roofline_references(n=N, matrix_size=roof_cfg.get('matrix_size',512),
                                         warmup=cfg['warmup'], repeat=cfg['repeat'])
if roof_cfg.get('bandwidth_gbs',0)>0 and roof_cfg.get('compute_tflops',0)>0:
    assert roof_cfg.get('source'), '手动参考值必须说明来源'
    references.update({key:roof_cfg[key] for key in ('bandwidth_gbs','compute_tflops','source')})
print({k:references[k] for k in ('bandwidth_gbs','compute_tflops','source')})''')
    nb.md('''## 7.3 把一次测量变成一个点

横坐标采用算法 AI，纵坐标是 $F/t$。继续使用相同的计时边界：预分配输出，固定随机输入，先校验，稳态 event 计时。''')
    nb.code(KERNEL)
    nb.code(PREPARE)
    nb.code('''table = learning.compare({'HIP Vector Add':run}, reference=a+b,
                         outputs={'HIP Vector Add':out},warmup=cfg['warmup'],repeat=cfg['repeat'])
table['algorithmic_GFLOP_s'] = F/table['median_ms']/1e6
table['algorithmic_GB_s'] = Q/table['median_ms']/1e6
table''')
    nb.md('''## 7.4 生成图，并沿着坐标读一遍

实测点与参考线来自同一次环境。若一个小数组工作点低于斜线，只能先提出假设；启动成本、缓存、访问顺序和 CPU 提交节奏都可能参与。不能凭点的位置宣布唯一瓶颈。''')
    nb.code('learning.plot_roofline(table,flops=F,bytes_moved=Q,references=references)')
    nb.md('''## 7.5 从读图走到下一轮实验

扩大 N 保持 AI 不变，却可能减少启动成本在总时间中的占比；改算法以复用数据，才可能改变逻辑读写量。先选一个问题，固定其他条件再测。''')
    nb.code("print('当前输入工作量：',N,'元素；逻辑 AI：',AI,'FLOP/Byte')")
    nb.md('''## 7.6 练习

把 N 改成四倍，从 7.1 开始运行，检查新点是否仍在同一个横坐标。再调整 matrix_size，记录参考线为何变化。写下你选的是实测工作负载参考还是官方理论参数，二者不能混称。

保存所有当前样本、kernel 源码和参考条件，方便下一轮核对。''')
    nb.code("learning.save_table('part1-profiling/chapter7',table,config={**cfg,'n':N,'references':references},kernels=[vector_add])")
    nb.md('''## 本章小结

Roofline 把逻辑计算量、数据量和时间放在统一坐标中。参考线用于提出下一步问题；证明瓶颈还需要受控修改和针对性诊断。

## 延伸阅读

- [第8章 notebook](../../part2-kernels/chapter8/chapter8.ipynb)
- [Roofline 原论文](https://doi.org/10.1145/1498765.1498785)''')
    nb.write()


if __name__ == '__main__':
    chapter5(); chapter6(); chapter7()
