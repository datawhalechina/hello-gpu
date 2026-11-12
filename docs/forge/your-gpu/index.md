---
layout: stage
stage: forge-your-gpu
newTerms: [rocm, gfx-target]
evidence: mixed
description: 在云上或自己的机器上拿到一块 AMD GPU，一键检查环境，读出它的 CU 数、wave 大小和显存，再把「我的 GPU 卡片」交给新手村的全景图。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import { platformById, platformFact } from '@course/labPlatforms.ts'
import CuCount from './scenes/CuCount.vue'
import WaveRows from './scenes/WaveRows.vue'
import MemoryFit from './scenes/MemoryFit.vue'
import { BOOK_GPU, STAGE_ID, cuReading } from './readings.ts'

const S = STAGE_ID
const GOAL = '在一块真的 AMD GPU 上跑通环境检查，读对它的 CU 数、wave 大小和显存，再比一比 CPU 和 GPU 谁算得快。'
// 星级标准从大纲的 lab.stars 读（06 第 7 节）：任务卡、LabCard 判星和 Notebook 用的是同一份规则。
const STARS = stageById(S).lab.stars.map((star) => star.text)

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const NEXT = neighborsOf(S).next
const PANORAMA = stageById('novice-gpu-panorama')
const WAVEFRONT = stageById('novice-wavefront')
const TIMING = stageById('forge-trusted-timing')

// 硬件参数从 hardware.json 读（09 第 4 节），正文不手写。
const HW = HARDWARE_DEVICES[DEFAULT_DEVICE_ID]
const CUS = HW.params.cuCount.value
const GFX = HW.params.gfx.value
const LANES = HW.params.streamProcessors.value
const TORCH_CUS = cuReading(BOOK_GPU, 'torch').value
// 实验档案馆的参考记录在这张卡上测（R-01），硬件参数同样从 hardware.json 读。
const REF = HARDWARE_DEVICES['ai-pro-r9700']

// 实验平台的 GPU 和版本从 lab-platforms.json 读（L-06），查不到的是「[待实测]」。
const fact = (id, key) => platformFact(platformById(id), key).text
const RC_GPU = fact('radeon-cloud', 'gpu')
const AUP_GPU = fact('aup-learning-cloud', 'gpu')
const LOCAL_GPU = fact('local', 'gpu')
const LOCAL_TORCH = fact('local', 'torch')

const pCus = [
  { label: `${CUS} 个`, why: `${CUS} 是计算单元的个数。按 ROCm 运行时的源码，PyTorch 在这张卡上数的不是计算单元。` },
  { label: `${TORCH_CUS} 个`, correct: true, why: 'RDNA 架构的卡上，HIP 运行时默认按 WGP 计数，两个计算单元算一个。PyTorch 报的就是 HIP 的这个数。' },
  { label: `${LANES} 个`, why: `${LANES} 是流处理器（lane）的个数，不是计算单元。` },
  { label: '我不确定', why: '不确定也没关系，探索一把三种数法摆在一起。' },
]

const checkpoint = [
  {
    q: '假设两张卡的 PyTorch 都报 multi_processor_count = 40：一张是 RDNA 3 架构的 Radeon 显卡，一张是 CDNA 3 架构的 Instinct 加速卡。两张卡各有几个计算单元？',
    options: [
      { label: '都是 40 个', why: 'RDNA 3 的卡默认按 WGP 计数，40 是 WGP 的个数。只有 CDNA 那张报的是计算单元。' },
      { label: 'Radeon 80 个，Instinct 40 个', correct: true, why: 'RDNA 的卡（gfx10 到 gfx12.4）默认按 WGP 数，乘 2 才是计算单元；CDNA 没有 WGP，报的就是计算单元。' },
      { label: 'Radeon 40 个，Instinct 80 个', why: '反了：要乘 2 的是按 WGP 计数的 RDNA 那张。' },
    ],
  },
  {
    q: '一张卡的 total_memory 是 25769803776 字节。全景图的显存要填 GiB，保留一位小数，该填几？',
    options: [
      { label: '24.0', correct: true, why: '25769803776 ÷ 2³⁰ = 24。同一块显存写成 GB 是 25.8，数大 7% 左右。' },
      { label: '25.8', why: '这是按 1000 进位的 GB：字节数除以 10⁹。全景图和卡片用的是 GiB。' },
      { label: '24576.0', why: '这是 MiB：只除了两次 1024，再除一次才是 GiB。' },
    ],
  },
  {
    q: '在一台新机器上运行 hg.check_env()，第一行是 ✗：PyTorch 不是 ROCm 版。接下来怎么办？',
    options: [
      { label: '在 Notebook 里 pip install torch，再接着运行', why: 'PyPI 上默认的 torch 是 CUDA 版，还会顶掉环境里原来的 PyTorch。' },
      { label: '先不管它，接着运行下面的单元', why: '后面的单元都要用 GPU，会接连报错。hg.check_env() 打印完就停下，就是要先把这一项改好。' },
      { label: '换到装了 ROCm 版 PyTorch 的内核或实例，从头运行', correct: true, why: '前三项是开工的前提。本地换一个内核，云平台上重新启动一个实例，再从「准备」运行。' },
    ],
  },
]
</script>

# 2-1 开工准备

<div class="yg-hello">
  <Mascot class="yg-hello__art" :size="64" />
  <p class="yg-hello__line">工坊城是照着资料画的。这回换上你自己的卡。</p>
</div>

新手村的全景图照着 {{ HW.name }} 的官方资料画。这一关在你自己的 GPU 上读出三个数：计算单元（CU）有几个、wave 多大、显存多少，再把它们交给全景图。

做这一关要一块 AMD GPU，云上、本地都行，挑战一节列了三种环境。没有 GPU 也能读完；挑战另有观摩模式，回放实验档案馆里的真实运行。

<Mission :stage="S" :goal="GOAL" :stars="STARS">

三颗星都在实验室 Notebook 里拿：★1 看你读得对不对，★2、★3 看 CPU 和 GPU 算矩阵乘的快慢，只和你自己的卡比。

</Mission>

## 热身：PyTorch 说有几个计算单元？

{{ HW.name }} 的产品页写着 {{ CUS }} 个计算单元。上了真卡，第一个去问的通常是 PyTorch：

```python
import torch
props = torch.cuda.get_device_properties(0)
props.multi_processor_count
```

<Predict :stage="S" id="yg-p-cus" :question="`在 ${HW.name} 上，最后一行会打印几？`" :options="pCus">

探索一把 PyTorch、rocminfo 和 GPU 卡片的数法摆在一起。

</Predict>

## 探索一：CU 有几个

同一张卡，PyTorch 报的数可能只有计算单元的一半：在 RDNA 架构的卡上，它数的是 [WGP](/handbook/#wgp)。

三个地方都报这个数：PyTorch 的设备属性、`rocminfo` 里 GPU 那一段的 `Compute Unit`、`hg.device_card()` 打出的卡片。换着看，每个数的是什么。

<CuCount />

全景图要的是[计算单元](/handbook/#cu)的个数：rocminfo 和卡片照抄，PyTorch 的数在 RDNA 卡上要乘 2。Notebook「动手」的第一段把这三个数并排打印出来。

## 探索二：wave 多大

[wave](/handbook/#wavefront) 的大小跟着架构走：Radeon 显卡（RDNA）32 个线程一队，Instinct 加速卡（CDNA）64 个一队。PyTorch 的 `warp_size`、rocminfo 的 `Wavefront Size` 报的都是它。

{{ WAVEFRONT.code }} 关的小队是 32 个一队。同一组线程放到 wave 64 的卡上，排出来就不一样：

<WaveRows />

每组线程数是写 kernel 的人定的。取 64 的倍数，两种卡上都坐得满；定之前，先读出这张卡的 wave 大小。

{{ HW.name }} 的硬件两种 wave 都支持，HIP 默认按 32 编译，见 {{ WAVEFRONT.code }} 关的「wave32 和 wave64」。

## 探索三：显存多少

显存总量用 PyTorch 的 `total_memory` 读，单位是字节；全景图和卡片都换成 GiB。

GiB 按 2³⁰ 字节算，GB 按 10⁹ 字节算。同一块[显存](/handbook/#vram)写成 GB，数大 7% 左右。总量够不够，要看放进去的数据有多大：

<MemoryFit />

矩阵乘要同时放下 A、B、C 三个矩阵，n 翻一倍，占的显存翻两番。真正能用的上限是 `torch.cuda.mem_get_info()` 报的空闲：别的程序和 Notebook 自己已经占了一些。

终端里的 `amd-smi`、`rocm-smi` 也能看显存的总量和用量，用法见原理一节的「终端里的 rocminfo、amd-smi 和 rocm-smi」。

## 原理：三个数从哪来

三个读数来自同一张卡，但经过的软件层不一样，数法就可能不一样：

- PyTorch（ROCm 版）的设备属性来自 HIP 运行时：`multi_processor_count`、`warp_size`、`total_memory`、`gcnArchName`。
- HIP 运行时建在 ROCr 运行时（HSA 运行时）上。`rocminfo` 直接问 ROCr，每个设备列一段：`Name`、`Compute Unit`、`Wavefront Size`……
- `amd-smi`、`rocm-smi` 是管理工具，看驱动报的显存用量、温度和功耗。

<ConceptCard term="rocm">

HIP 运行时、ROCr 运行时、`rocminfo`、`amd-smi` 都是 ROCm 的组件。ROCm 版 PyTorch 的版本号写着它为哪版 ROCm 编译，例如本书实验机上的 `{{ LOCAL_TORCH }}`；`hg.check_env()` 的第四项拿它和装好的 ROCm 比。

</ConceptCard>

<ConceptCard term="gfx-target" code="props.gcnArchName">

{{ HW.name }} 是 `{{ GFX }}`。PyTorch 的 `gcnArchName`（冒号前面那段）、rocminfo 里 GPU 那一段的 `Name`、卡片上的「架构」，写的都是它。PyTorch 自带的 GPU 代码也按 gfx 代号编译：`hg.check_env()` 的第三项报 `invalid device function`，多半是这版 PyTorch 里没有这张卡的代码。

</ConceptCard>

<DeepDive title="出处：PyTorch 为什么报 WGP 的个数">

- PyTorch 的 `multi_processor_count` 就是 HIP 设备属性里的 `multiProcessorCount`。ROCm 的 HIP 运行时（clr）在 gfx10、gfx11 和 gfx12.0–12.4 上默认进 WGP 模式（[rocsettings.cpp](https://github.com/ROCm/rocm-systems/blob/3e6495e3a33a6d2bf4855e69f17f42b6185c0b71/projects/clr/rocclr/device/rocm/rocsettings.cpp#L174-L181)），这时把计算单元数取一半（[rocdevice.cpp](https://github.com/ROCm/rocm-systems/blob/3e6495e3a33a6d2bf4855e69f17f42b6185c0b71/projects/clr/rocclr/device/rocm/rocdevice.cpp#L1148-L1149)），再填进 `multiProcessorCount`（[hip_device.cpp](https://github.com/ROCm/rocm-systems/blob/3e6495e3a33a6d2bf4855e69f17f42b6185c0b71/projects/clr/hipamd/src/hip_device.cpp#L685)）。
- 环境变量 `GPU_ENABLE_WGP_MODE=0` 能关掉 WGP 模式，PyTorch 就报计算单元数。`hg.device_card()` 会看这个变量，卡片上写的总是计算单元。
- wave 大小：RDNA 架构 32 个线程，CDNA 架构 64 个（[HIP 文档：Warp (or Wavefront)](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#wavefront)）。
- 实验档案馆的参考记录在 {{ REF.name }} 上测，它和 {{ HW.name }} 同为 `{{ REF.params.gfx.value }}`、{{ REF.params.cuCount.value }} 个计算单元：PyTorch 的 `multi_processor_count` 打印 32，rocminfo 的 `Compute Unit` 打印 64；`warp_size` 和 `Wavefront Size` 都是 32。

</DeepDive>

<DeepDive title="终端里的 rocminfo、amd-smi 和 rocm-smi">

- `rocminfo` 每个设备列一段，通常先 CPU 后 GPU。GPU 那一段里，`Name` 是 gfx 代号，`Compute Unit` 是计算单元数，`Wavefront Size` 是 wave 大小（[rocminfo 文档的示例输出](https://rocm.docs.amd.com/projects/rocminfo/en/latest/how-to/use-rocminfo.html)，那台机器是 Instinct MI300X）。
- `amd-smi static --asic` 列出 `NUM_COMPUTE_UNITS` 和 `TARGET_GRAPHICS_VERSION`，`amd-smi static --vram` 列出显存容量，`amd-smi monitor` 的 `VRAM_USAGE` 一列是「已用/总量」（[AMD SMI 文档](https://rocm.docs.amd.com/projects/amdsmi/en/docs-10.0.0/how-to/amdsmi-cli-tool.html)）。`rocm-smi --showmeminfo vram` 也能看显存（[ROCm SMI 文档](https://rocm.docs.amd.com/projects/rocm_smi_lib/en/latest/how-to/use-python.html)）。
- 这两个管理工具依赖平台提供的驱动接口，有的环境里用不了（[旧版第 1 章 1.2 节](/part0-intro/chapter1/#_1-2-平台边界-原生-linux-优先-wsl2-需单独验证)）。所以实验室的读数都从 PyTorch 和 rocminfo 来。

</DeepDive>

## 挑战：在你的卡上交成绩

挑战在实验室 Notebook 里做，三颗星和任务卡上写的一样：

- ★1：把读出的三个数填进 `mine`，交给 `hg.check_card` 核对。CU 数要数计算单元（不是 WGP），显存要换成 GiB。
- ★2、★3：`hg.race(n)` 让 CPU 和 GPU 算同一个 n×n 的 FP32 矩阵乘。★2 只比计算，数据事先放进显存；★3 把拷进、拷回也算上，就是 {{ PANORAMA.code }} 关那段旅程的头尾两步。

n 从 32 开始往大改。矩阵乘要算 2·n³ 次浮点运算，只搬 3·n² 个数：n 越大，每搬一个数要算的次数越多，拷贝的时间就越摊得开。从多大的 n 起 GPU 更快，看你的卡和 CPU。参考记录里 {{ REF.name }} 对上 32 个线程的 Threadripper PRO 9975WX：数据已在显存里，n = 512 起 GPU 更快（CPU ÷ GPU = 2.02）；算上拷进拷回，要到 n = 1024（6.47）。

计时由 `hg.race` 负责，GPU 计时的门道在 {{ TIMING.code }} 关。

还没有 GPU？三种环境任选一种。两个云平台的镜像都带着 ROCm 版 PyTorch：AUP Learning Cloud 用 GitHub 账号登录，AMD Radeon Cloud 用开发者积分换算力。[实验环境指南](/handbook/setup/)从注册一直写到在 Notebook 里打出卡片：

| 环境 | GPU | 要准备什么 |
| --- | --- | --- |
| [AMD Radeon Cloud](/handbook/setup/#radeon-cloud) | {{ RC_GPU }} | AMD AI 开发者计划的账号，开发者积分换算力 |
| [AUP Learning Cloud](/handbook/setup/#aup-learning-cloud) | {{ AUP_GPU }}（核显） | GitHub 账号，或者管理员发的账号 |
| [本地](/handbook/setup/#local) | 本书用 {{ LOCAL_GPU }} | 一块 ROCm 支持的 AMD GPU 和 Linux |

AUP Learning Cloud 的 {{ AUP_GPU }} 和本书的 {{ HW.name }} 不是同一款，Radeon Cloud 上是哪款 [待实测]。换了卡，计算单元数、wave 大小、显存都要重新读，这正是这一关要练的。

打开实验室，从上往下运行。第一节「准备」是一键检查：

```python
env = hg.check_env()
card = hg.device_card()
```

`hg.check_env()` 查六项。前三项（PyTorch 是 ROCm 版、看得到 GPU、GPU 算得对）有 ✗ 就停下，按提示改好再从头运行；后三项（ROCm 和 PyTorch 版本一致、HIP 编译工具、Triton）只记 ⚠，只影响以后某条路线。`hg.device_card()` 打出 GPU 卡片，最后一行是导入码。

<LabCard />

导入码贴进下面的卡片。导入以后，上面三段探索换成你的卡；{{ PANORAMA.code }} 的全景图也换成你的卡的计算单元数、wave 大小和显存（本书资料里还没有你的 gfx 代号时，全景图先画本书的卡）。

<div id="gpu-card"><DeviceCard /></div>

## 你现在能……

- 在 AMD Radeon Cloud、AUP Learning Cloud 或自己的机器上准备好环境，用 `hg.check_env()` 判断能不能开工
- 从 PyTorch 和 rocminfo 读出一张卡的计算单元数、wave 大小和显存，分清 WGP 和计算单元、GiB 和 GB
- 把「我的 GPU 卡片」导入网页，在自己的卡上测出矩阵多大时 GPU 比 CPU 快

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：卡认识了，下一关在它上面编译、运行、校验第一个 kernel。

- 回到基础：[{{ PANORAMA.code }}「{{ PANORAMA.title }}」](/novice/gpu-panorama/)：这一关读出的三个数，就是全景图里计算单元、wave 和显存的大小。
- 深入一层：[旧版附录 B · 换一张卡](/appendix/appendix-b-switch-gpu/#b-1-第一步-从自己的型号查到-gfx-代号)：从产品型号查到 gfx 代号，再按它装 ROCm 版 PyTorch。

<EvidenceCard kind="mixed" hardware="AMD Radeon AI PRO R9700" software="ROCm 10.0.0 · PyTorch 2.13.0+rocm10.0.0 · Triton 3.8.0+git4cff872c.rocm10.0.0" date="2026-11-11" entry="forge-your-gpu/shared-ai-pro-r9700-2026-11-11">PyTorch 和 rocminfo 打印的数、挑战里 CPU 和 GPU 的快慢，来自实验档案馆的参考记录：在 {{ REF.name }} 上照 Notebook 从头跑了一遍，挑战填的是参考解，完整输出和原始样本见档案条目。{{ HW.name }} 的计算单元数和显存容量出自 AMD 产品页，gfx 代号出自 ROCm 的 GPU 规格表；wave 大小按架构固定出自 HIP 文档，PyTorch 在 RDNA 卡上按 WGP 计数出自 ROCm 运行时的源码。探索里的方格和条形图是示意；导入卡片以后，探索画的是你的 Notebook 读出的数，只存在你的浏览器里。</EvidenceCard>

<style scoped>
/* 小核开场：同新手村各关的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.yg-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.yg-hello__art {
  flex: none;
}

.yg-hello__line {
  flex: 1 1 auto;
  max-width: 34em;
  margin: 10px 0 0;
  padding: 12px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  border-top-left-radius: 4px;
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  font-size: 17px;
}

/* 简洁模式收起插画（01 第 4 节），台词照样留着。 */
.hg-shell.is-plain .yg-hello__art {
  display: none;
}

.hg-shell.is-plain .yg-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
