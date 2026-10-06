# ROCm 10.0 受控矩阵乘实验

Radeon RX 9070 XT / gfx1201，原生 Ubuntu 24.04.5 / kernel 7.0.0-31-generic，ROCm SDK 10.0.0、HIP 7.15.26333、PyTorch 2.13.0+rocm10.0.0、Triton 3.8.0。采集日为 2026-09-20（UTC+8；manifest 时间为 UTC）。旧根 evidence 保留 ROCm 7.13 历史身份。

## 已运行入口

在 code/part2-kernels/ 下使用已有本篇环境，输出目录必须是新的：

```bash
source ./activate-rocm.sh
python chapter11/run_rounds.py --output chapter11/results/my-rounds --phase main
python chapter11/run_rounds.py --output chapter11/results/my-rounds --phase profile
python chapter11/run_rounds.py --output chapter11/results/my-rounds --phase validation
python chapter11/verify_rounds.py --frozen-run chapter11/results/my-rounds \
    --output chapter11/results/my-confirmation --configs \
    hip-naive-t16 hip-tiled-t16 triton-b32x32-g1 triton-b32x64-g1 \
    triton-b64x32-g1 triton-b64x32-g4 triton-b64x32-g8
```

确认命令中两项非方 tile 和 g4/g8 来自本轮实测后的选择；新实验若选择不同 tile，应使用新 manifest 中记录的配置 ID。省略 --configs 时，入口会选择两条路线基线、tiled16 中间版以及主扫描选出的 tile/group，并去重。入口核对实际文件及环境，不依赖 Git。原始 argv 在本地 results/rocm10-20260920/commands.jsonl，确认单独记录 commands.json。

## 对照与数值约定

- C[M,N]=A[M,K]@B[K,N]，FP32、row-major，三种尺寸顺序固定为 M×N×K。
- HIP naive t16→tiled t16 保持一线程一个输出及16×16线程块，添加每轮 A/B tile 的 LDS 暂存和同步；随后只在 tiled 路线比较 tile8/16/32。tile 同时改变重用粒度、LDS、线程块和网格，不能只把差值归因于其中一项。
- Triton 首轮固定 Ktile32、num_warps4、group1，比较输出 tile32×32/32×64/64×32；按主扫描三进程中位数选择64×32，再固定该tile比较group1/4/8。group1复用首轮的原始样本，不重复填表；追加的两组单独轮换测量。
- 所有路线输入相同。A[i]=(((17*(i%257)+seed%257)%257)-128)/128，B[i]=(((29*(i%251)+3*(seed%251))%251)-125)/128，seed20260920。
- CPU参考以FP64相乘累加后转FP32。接受条件逐元素为 abs(actual-ref)<=1e−4+1e−4*abs(ref)，并显式检查有限值。max_rel_error 使用 max(abs(ref),1e−6) 作分母，仅报告，不是独立的全局接受阈值。
- Triton tl.dot 显式 input_precision=ieee，HIP使用FP32累加；没有据tl.dot API或dtype宣称生成某类矩阵ISA。该输入下误差记录为0，不代表任意输入矩阵乘都无舍入误差。
- 输出在预检前填NaN，计时前后完整检查。没有把CPU参考、GPU拷贝、检查、分配、编译或JIT放进事件区间。

## 规模和统计

- 主1024³：先7配置×3进程，再追加选定tile的g4/g8各3进程，共9配置27进程。所有进程warmup10/repeat50。
- 附形状256×1024×512、1024×256×512：naive16/tiled16、Tr32×32g1、64×32g1、64×32g4，去重后每形状5配置3进程。
- 正确性尾边M/N/K分别为129×128×128、128×129×128、128×128×129，覆盖全部9配置，共27项。
- 总57进程2850原始event样本；summary有19配置×shape行。每个进程内部取中位数，再取三进程中位数的中位数和min/max。范围不是置信区间，150样本不混池。
- scope=gpu-event-full-operator，每条路径本轮只有1个目标kernel。预建事件，排入所有计时间隔后统一同步；短区间仍可能有CPU提交空隙。输入反复使用，不刷cache。
- 正式测量不启profiler，不锁频，不终止已有桌面/其他GPU上下文；GPU非独占。
- tflops 按2MNK/时间计算，仅为算法操作数换算，不直接与未测硬件峰值相除。

## 主形状观察

| 配置 | event 中位数 ms | 进程中位数范围 ms |
| --- | ---: | ---: |
| `hip-naive-t16` | 2.870803 | 2.482325–2.872944 |
| `hip-tiled-t16` | 1.386772 | 1.384532–1.394171 |
| `hip-tiled-t32` | 1.478391 | 1.476971–1.483611 |
| `hip-tiled-t8` | 1.450751 | 1.450131–1.460812 |
| `triton-b32x32-g1` | 0.516917 | 0.516217–0.519037 |
| `triton-b32x64-g1` | 0.359218 | 0.357378–0.359658 |
| `triton-b64x32-g1` | 0.358038 | 0.357898–0.359337 |
| `triton-b64x32-g4` | 0.355278 | 0.354558–0.358458 |
| `triton-b64x32-g8` | 0.358518 | 0.358198–0.359818 |

HIP保留tiled16；tile8/32在本次主形状更慢。两个Triton非方tile都显著快于32×32，32×64与64×32之间的范围重叠，继续使用64×32属于本轮数值选择，不是稳定唯一赢家。g4在主扫描数值最小，但组间差距很小，交由独立确认检查。

## 独立确认

独立目录重新读取实际环境，核对同一冻结来源与二进制，再测两HIP与全部五Tr配置，共21进程1050样本。确认特别保留接近的两种tile方向与三种group，不与扫描样本混合：

| 配置 | 确认中位数 ms | 进程中位数范围 ms |
| --- | ---: | ---: |
| `hip-naive-t16` | 2.868933 | 2.865150–2.869520 |
| `hip-tiled-t16` | 1.388766 | 1.384543–1.392047 |
| `triton-b32x32-g1` | 0.516244 | 0.515544–0.516725 |
| `triton-b32x64-g1` | 0.359138 | 0.356876–0.359917 |
| `triton-b64x32-g1` | 0.357537 | 0.354616–0.358018 |
| `triton-b64x32-g4` | 0.356077 | 0.355336–0.356857 |
| `triton-b64x32-g8` | 0.354397 | 0.353716–0.354597 |

HIP tiled16相对naive和Triton较大输出tile的改进复现。两种非方tile方向仍范围重叠。group数值第一从扫描g4变成确认g8，附矩形shape中g4/g1也几乎相同；本轮不能给某个group稳定最优的结论，保留group1是更保守的默认选择。没有用这些时间直接推断L2命中率。

## trace、身份和文件

- profile-summary每配置只筛目标matmul kernel，16dispatch排除precheck1+warmup5，保留10个timed。trace scope与event分开，不混入正式统计，也不相减估算CPU或启动成本。
- trace校验全部Grid_Size_X/Y/Z与Workgroup_Size_X/Y/Z。HIP网格为二维，Tr逻辑program网格一维；summary.grid是总block/program个数，不能当线程数。
- HIP naive/t8/t16/t32分别为16/40/56/88个VGPR，静态LDS0/512/2048/8192B；Tr32×32为104VGPR，32×64与64×32各组均120，scratch0。这些是分配/启动事实，不能单独证实occupancy或cache瓶颈。
- manifest保存冻结源码和二进制SHA、样本/日志/traceSHA，artifacts_sha256绑定summary/process/profile与confirmation最终字节。确认另外绑定用于选候选的父summary哈希。
- 所有检查通过后才写公开汇总。负向检查确认：改源码、ENV、样本配置、非有限误差、边界失败、错误二维trace网格或缺进程样本都会拒绝，失败时不预写汇总。

- matmul_hip.hip SHA-256：`9e037d9363c4ca210c0baca7f338cacfbc5cd610bb6496ad68cad767e0bbd84e`。
- matmul_triton.py SHA-256：`e67b82c1087c285fb240b46f4000b7c7a23f4fce2d3eb4c4a8ccac26b1b090fa`。
- HIP binary SHA-256：`5a0130ab37a8ef2ae05f12a601567082f158d01919463ce8fe0580a9f4ea2545`。
