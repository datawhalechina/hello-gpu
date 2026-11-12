---
layout: stage
stage: novice-boss
newTerms: [out-of-bounds, fake-speedup]
evidence: simulated
description: 新手村的毕业考：给三张坏工作单体检，识破一份没同步就计时的提速报告，修好越界、分支发散、非合并访存三处毛病，再让你在第 1-14 关写的 Agent 从新起点调到三星。
---

<script setup>
import { describeConfig } from '@course/agent/tasks.ts'
import { neighborsOf, stageById } from '@course/outline.ts'
import { percent } from '@kit/wave-view/model.ts'
import { SIM_PARAMS } from '@sim/params.ts'
import AgentExam from './scenes/AgentExam.vue'
import BossBoard from './scenes/BossBoard.vue'
import Checkup from './scenes/Checkup.vue'
import FixSandbox from './scenes/FixSandbox.vue'
import SpotReport from './scenes/SpotReport.vue'
import { useBoss } from './scenes/useBoss.ts'
import {
  AGENT_START, AGENT_TOUR, CHECKUPS, FIXED, FIXES, LAUNCH_CYCLES, SPOT_FIXED, SPOT_GPU, SPOT_REPORT, STAGE_ID, STAR_LABELS,
  WAVE, times,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = '修好三张坏工作单，再让你的 Agent 把向量加法调到三星。'
// 几道分题共用的本关三颗星：页面调用一次，交给每道题的场景（scenes/useBoss.ts）
const boss = useBoss()

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { next: NEXT } = neighborsOf(S)
const GROUPS = stageById('novice-thread-groups')
const DIVERGENCE = stageById('novice-divergence')
const COALESCING = stageById('novice-coalescing')
const TIMING = stageById('novice-timing')
const FIRST_AGENT = stageById('novice-first-agent')

const OOB = FIXES.oob
const FORK_LANE = percent(CHECKUPS.fork.laneUse)

const Q_WRONG = '三张原样跑一遍：算出来的 c（第二张还有 d）里，有几张有错数？'
const pWrong = [
  { label: '三张都有：都是坏工作单', why: '坏不一定坏在数上：三张算出来的数，一个都没错。' },
  { label: `一张：第一张多派了一个线程`, why: `多派的那个线程写到了 c 外面，可 c 里的 ${OOB.n} 个数都对：它写坏的是别处。` },
  { label: '一张都没有', correct: true, why: '三张的数都对。第一张有线程写到了数组外面；第二、三张没写错一个数，坏在慢。' },
  { label: '我不确定', why: '不确定也没关系，下面给它们体检。' },
]

const checkpoint = [
  {
    q: '又来一张工作单：运行全对、没有越界；看访存，搬的车等于理想车数；计时说 lane 利用率只有 50%（模拟）。先查哪里？',
    options: [
      { label: '算下标的那一行：相邻线程是不是隔得远', why: '搬的车等于理想车数，排队没问题。相邻线程隔得远，看访存会先看出来。' },
      { label: '写入前的条件：是不是写到了数组外面', why: '运行说没有越界：条件拦得住。' },
      { label: 'if 那一行：同一支小队是不是走进了两条路', correct: true, why: `数都对、车也不多，lane 利用率却低，多半是小队在岔路口分成了两拨：走一条路时，另一拨原地等（第 ${DIVERGENCE.code} 关）。` },
      { label: '计时代码：是不是没同步就看表', why: 'lane 利用率是数每一步有几个 lane 在干活数出来的，和计时代码怎么写无关。' },
    ],
  },
  {
    q: '小林量两版：改前是程序里第一次启动 kernel，量到 3200 个周期；改后接着量，200 个周期，「快了 16 倍」（模拟）。两次停表前都同步了。最可能哪里不对？',
    options: [
      { label: '没同步：表停早了', why: '两次都同步了：表停在 GPU 算完以后。' },
      { label: '没预热：改前那次多算了第一次启动的准备', correct: true, why: `程序里第一次启动，启动那一行要先做准备（第 ${TIMING.code} 关）。改前先量，准备全算进了改前。先空跑一次再计时。` },
      { label: '可信：都同步了，就是快了 16 倍', why: '同步只管表停得对不对。改前那次多出来的准备，同步管不了。' },
    ],
  },
  {
    q: '200 个数，派 4 组、每组 64 个线程，写入前的条件写成 i < 256。会怎样？',
    options: [
      { label: '有 56 个数算错', why: 'c 的 200 个数照样都对：坏在数组外面。' },
      { label: '多出来的 56 个线程写到了 c 外面', correct: true, why: '256 是派出的线程数，不是 c 有几格。i 是 200～255 的线程都过了条件，写到了 c[200]～c[255]：越界。条件要和 n 比。' },
      { label: '没问题：一共只派了 256 个线程', why: '派了几个线程和数组有几格是两回事：c 只有 200 格。' },
    ],
  },
]
</script>

# Boss 新手村毕业考

<div class="bs-hello">
  <Mascot class="bs-hello__art" :size="64" />
  <p class="bs-hello__line">毕业考：三张坏工作单，一份提速报告。</p>
</div>

这一关不教新本事。前面学过的派线程、分小队、排队取数、量时间，还有你的 Agent，这里全都用得上。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

三张工作单各坏在一处：先体检，再修。中间有一份提速报告，看你能不能识破。最后把调参交给你在第 {{ FIRST_AGENT.code }} 关写的 Agent。

</Mission>

## 热身：数算对了吗？

三张工作单都「坏」了。下面是每张的关键几行：

<LangCode>
<template #hip>

```cpp
// 第一张 add：63 个数，派 2 组 × 32 个线程
int i = blockIdx.x * blockDim.x + threadIdx.x;
if (i <= n) c[i] = a[i] + b[i];
// 第二张 two_jobs：64 个和、64 个差，派 4 组 × 32 个线程
int k = blockIdx.x * half + threadIdx.x % half;   // half 是每组的一半
if (threadIdx.x < half) c[k] = a[k] + b[k]; else d[k] = a[k] - b[k];
// 第三张 add：128 个数，派 4 组 × 32 个线程
int i = threadIdx.x * gridDim.x + blockIdx.x;
if (i < n) c[i] = a[i] + b[i];
```

</template>
<template #python>

```python
# 第一张 add：63 个数，派 2 组 × 32 个线程
i = blockIdx.x * blockDim.x + threadIdx.x
if i <= n: c[i] = a[i] + b[i]
# 第二张 two_jobs：64 个和、64 个差，派 4 组 × 32 个线程
k = blockIdx.x * half + threadIdx.x % half   # half 是每组的一半
if threadIdx.x < half: c[k] = a[k] + b[k]
else: d[k] = a[k] - b[k]
# 第三张 add：128 个数，派 4 组 × 32 个线程
i = threadIdx.x * gridDim.x + blockIdx.x
if i < n: c[i] = a[i] + b[i]
```

</template>
</LangCode>

<Predict :stage="S" id="bs-p-wrong" :question="Q_WRONG" :options="pWrong">

坏，不一定坏在数上。下面用你的 Agent 的三样工具，给它们体检。

</Predict>

## 探索一：给三张工作单体检

体检用的，就是你的 Agent 每一圈用的三样工具：运行看对错和越界，计时看示意时间和 lane 利用率，看访存数车次。旋钮换一张，体检单马上跟着换。

<Checkup />

三张各有一项不对劲：第一张有线程写到了 c 外面；第二张 lane 利用率只有 {{ FORK_LANE }}；第三张搬了 {{ CHECKUPS.stride.transactions }} 车，理想只要 {{ CHECKUPS.stride.ideal }} 车（模拟）。看出是哪一项，就知道回哪一关去修。

## 探索二：一份提速报告

第三张修好以后，有人量了一下，交来一份报告：快了 {{ times(SPOT_REPORT.before, SPOT_REPORT.after) }} 倍。表是真看了，数也是真量的。这份报告可信吗？

<SpotReport />

毛病在量法：改后那次交出工作单就看表，GPU 才刚开工。补上同步，改后 {{ SPOT_FIXED.after }} 个周期，快了 {{ times(SPOT_FIXED.before, SPOT_FIXED.after) }} 倍（模拟）。少搬车是真的变快了，只是没那么多。

## 原理：越界和假加速

数都对，也可能出了事：第一张多派的那个线程，写到了 c 外面。这叫越界。

<ConceptCard term="out-of-bounds" code="if (i < n)">

第一张差了一个：条件写成 `i <= n`，i 等于 {{ OOB.n }} 的线程照样写 c[{{ OOB.n }}]，可 c 的最后一格是 c[{{ OOB.n - 1 }}]。写到外面不一定马上报错，所以要靠运行时数一数越界，别只看数对不对。

</ConceptCard>

看着变快了，也可能是量错了。这叫假加速。

<ConceptCard term="fake-speedup">

报告里改后那次没同步就看表：量到的 {{ SPOT_REPORT.after }} 个周期，只是交出一张工作单的 {{ LAUNCH_CYCLES }} 个周期，GPU 要算的 {{ SPOT_GPU.after }} 个周期一点都没量到（模拟）。

</ConceptCard>

给 kernel 体检，按这个顺序：

- 先看对不对：运行，数全对、没有越界（第 {{ GROUPS.code }} 关的边界检查）；
- 再看快不快：lane 利用率低，找分岔（第 {{ DIVERGENCE.code }} 关）；车次比理想多，找下标（第 {{ COALESCING.code }} 关）；
- 拿数说「变快了」之前，先预热、停表前同步（第 {{ TIMING.code }} 关）。

前两步，正是你的 Agent 每一圈做的事：运行、计时、看访存，看出问题再改。

<DeepDive title="出处：越界和计时">

- ROCm 的文档《[Using the AddressSanitizer on a GPU](https://rocm.docs.amd.com/projects/llvm-project/en/latest/conceptual/using-gpu-sanitizer.html#using-asan-with-a-short-hip-application)》举了一个没有边界检查的 kernel：申请的元素比派出的线程少，多出来的线程就会访问没申请的显存。不加检测工具编译，程序照样跑完，这个错一点都查不出来；用 AddressSanitizer 编译，才报出越界写在哪一组。文档写明出了这种错，程序的行为就没有定义了。文档的例子用的是 Instinct 系列的 gfx90a，RX 9070 XT 上能不能这样查 [待实测]。
- HIP 文档：kernel 是异步启动的，GPU 算的时候 CPU 接着往下走（[Concurrent execution between host and device](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_runtime_api/asynchronous.html#concurrent-execution-between-host-and-device)）；`hipDeviceSynchronize()` 让 CPU 等到设备上的活都做完（[Device management](https://rocm.docs.amd.com/projects/HIP/en/latest/reference/hip_runtime_api/modules/device_management.html#_CPPv420hipDeviceSynchronizev)）。PyTorch 文档也提醒，GPU 上的操作默认是异步的，计时前要先同步（[Asynchronous execution](https://docs.pytorch.org/docs/stable/notes/cuda.html#asynchronous-execution)）。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 越界写在模拟器里不落进数组，单独放进越界区；越界读一律读到 0。这是模拟器为了让错误每次都一样定的约定（第 {{ GROUPS.code }} 关）。真卡上写到外面会改掉什么、读到什么，说不准。
- lane 利用率、车次、示意时间都是模拟器按事件流数出来的，一车 {{ SIM_PARAMS.lineBytes }} 字节、交出一张工作单 {{ LAUNCH_CYCLES }} 个周期都是示意值，同一份代码每次都一样。真卡上这几张工作单修前修后各要多久 [待实测]。
- 第二张的 if、else 两段，模拟器里各走一遍，两段的读写也各记一次，所以体检单上读写了 {{ CHECKUPS.fork.accesses }} 次，修好以后是 {{ FIXED.fork.accesses }} 次。
- 时间线上 CPU 和 GPU 共用一个时钟，按周期数画（同第 {{ TIMING.code }} 关）。真程序里，CPU 的时钟读出来是秒。

</DeepDive>

## 挑战一：修好三张工作单

这是星级挑战：三张都修对，数全对、没有一次读写跑到数组外面，拿第一颗星；第二、三张都不浪费，小队不分岔、读写不多搬车，拿第二颗；你的 Agent 交出三星参数，拿第三颗（在挑战二）。

每张修好、点「运行」，同一份代码还会换一批数据或者换一种派法再跑一次：写死的数过不了。没过不扣分，没过两次以后会出现提示；在这里看了答案，这一关最多两颗星。

### 第一张：越界

c 只有 {{ OOB.n }} 格，最后一格是 c[{{ OOB.n - 1 }}]。改写入前的条件，拦住多出来的那个线程。

<FixSandbox part="oob" :boss="boss" />

### 第二张：分支发散

一组 {{ WAVE }} 个线程，正好一支小队。让每支小队整队只走一边：要么都算和，要么都算差。

<FixSandbox part="fork" :boss="boss" />

### 第三张：非合并访存

每个线程还是算一个数，只改下标：让一支小队里相邻的线程，拿相邻的数。

<FixSandbox part="stride" :boss="boss" />

## 挑战二：让你的 Agent 调到三星

第三张，你是改下标修好的。你的 Agent 调向量加法，走的是另一条路：把步长改成 1，把 block 取到 {{ WAVE }} 的倍数。

这次的起点是 {{ describeConfig(AGENT_START) }}：两条规则都要用上。三个空补对的话，它会走 {{ AGENT_TOUR.steps }} 步，交出 {{ describeConfig(AGENT_TOUR.path[AGENT_TOUR.path.length - 1]) }}。

<AgentExam :boss="boss" />

<BossBoard :boss="boss" />

## 你现在能……

- 看运行、计时、看访存三样结果，说出一个 kernel 是越界、分岔还是多搬车，该回哪一关去修
- 修好越界、分支发散、非合并访存三种毛病，换一批数据照样成立
- 看出没同步就停表量出来的假加速，量准了再说「变快了」

## 检查点

答完这三道题，毕业考就完成了：你会拿到 500 XP 和「新手村毕业」徽章。

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

新手村到这里就毕业了。{{ NEXT.code }}「{{ NEXT.title }}」走进铸造城：在真卡上读出你的 GPU 有多少计算单元、wave 多大、显存多少。

- 回到基础：[新手村地图](/novice/)，哪一张没修好，就回到那一关再走一遍：越界看第 {{ GROUPS.code }} 关，分岔看第 {{ DIVERGENCE.code }} 关，多搬车看第 {{ COALESCING.code }} 关，量时间看第 {{ TIMING.code }} 关。
- 深入一层：[铸造城](/forge/)，同样是写对、写快、量准，换到真卡上做，再用自己的算子去比 PyTorch。

<EvidenceCard kind="simulated">这一关的数，都是浏览器里的模拟器算出来的，不是实测：越界的次数、lane 利用率、车次按事件流数，示意时间用的是第 {{ TIMING.code }} 关的示意计时；一车 {{ SIM_PARAMS.lineBytes }} 字节、交出一张工作单 {{ LAUNCH_CYCLES }} 个周期都是示意值，同一份代码每次都一样。越界写放进越界区、越界读读到 0，是模拟器的约定。你的 Agent 在浏览器里用 Pyodide 运行，调用的工具跑在同一个模拟器上。真卡上这三张工作单修前修后差多少 [待实测]，实验档案馆里还没有这一关的记录。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-14 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.bs-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.bs-hello__art {
  flex: none;
}

.bs-hello__line {
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
.hg-shell.is-plain .bs-hello__art {
  display: none;
}

.hg-shell.is-plain .bs-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
