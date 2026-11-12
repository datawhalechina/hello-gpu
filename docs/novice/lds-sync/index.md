---
layout: stage
stage: novice-lds-sync
newTerms: [wgp, barrier, race-condition]
evidence: simulated
description: 组里的线程要互相借数：先放上车间货架，再取别人放的那一格。可对面放好了没有？一步一步看两支小队在同步处等齐，再删掉同步，看取早了会怎样；最后自己定哪里要等。
---

<script setup>
import { neighborsOf, stageById } from '@course/outline.ts'
import FlipSandbox from './scenes/FlipSandbox.vue'
import ShelfLab from './scenes/ShelfLab.vue'
import {
  ARCH, CUS_PER_WGP, DEVICE_NAME, FLIP_LAUNCH, LAB_LAUNCH, LDS_PER_BLOCK, LDS_PER_WGP, SHELF, STAGE_ID, STAR_LABELS,
  VARIANT_LAUNCH, WAVE,
} from './challenge.ts'

const S = STAGE_ID
const GOAL = `派 ${FLIP_LAUNCH.grid} 组线程，每组借货架把自己的 ${SHELF} 个数倒过来：结果要对，整组只等一次。`

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取。
const { prev: PREV, next: NEXT } = neighborsOf(S)
const GROUPS = stageById('novice-thread-groups')
const WAVEFRONT = stageById('novice-wavefront')
const HIERARCHY = stageById('novice-memory-hierarchy')

const pReady = [
  { label: '一定：整组一起走，同一行大家一起做', why: `一起走的是一支小队（第 ${WAVEFRONT.code} 关）。线程 63 在小队 1，和线程 0 不在同一支小队，各走各的。` },
  { label: '不一定：线程 63 在另一支小队，可能还没走到放的那一行', correct: true, why: '线程 0 在小队 0，线程 63 在小队 1。两支小队谁先走到哪一行，没人管着，就说不准。' },
  { label: '一定没有：小队 1 总是后走', why: '也说不准。真卡上几支小队交错着走，这一次小队 1 慢，下一次也许就快。' },
  { label: '我不确定', why: '不确定也没关系，下面一步一步看两支小队怎么走。' },
]

const pNoWait = [
  { label: '照样全对：放和取就隔一行，中间没别的事', why: '隔一行也来得及出错：小队 0 放完就去取，小队 1 也许还没开始放。' },
  { label: '有的线程取早了，取到还没放好的格子', correct: true, why: '取早了的线程拿到的不是对面放的数。模拟器每次都让小队 0 取早；真卡上谁先谁后说不准，这一次对，下一次也许就错。' },
  { label: '程序报错，停在取的那一行', why: '删掉同步不会报错，程序照样跑完，只是结果可能不对。这正是它难发现的地方。' },
  { label: '我不确定', why: '不确定也没关系，下面的旋钮可以把同步删掉、挪开，看看会怎样。' },
]

// 检查点第 1 题：整段倒过来，一共 2 组。
const TOTAL = FLIP_LAUNCH.grid * SHELF

const checkpoint = [
  {
    q: `整段数组倒过来：派 2 组、每组 ${SHELF} 个线程，线程 i 要 a[${TOTAL - 1} - i]。block 0 要的数，都在 block 1 搬进来的那一半里。能借货架交接吗？`,
    options: [
      { label: '能：放上货架，同步一下再取', why: '货架上给 block 1 开的格子，block 0 看不到；同步也只等得齐自己这一组。' },
      { label: '不能：别的组看不到这一组的格子，跨组的数要经过显存', correct: true, why: `每组在货架上各开各的格子，同步也只管同一组。这道题让线程 i 直接去显存读 a[${TOTAL - 1} - i] 就行，用不着货架。` },
      { label: '能：只要两组落在同一个 WGP 里', why: '落在同一个 WGP 也是各开各的格子：block 0 照样看不到 block 1 的。' },
    ],
  },
  {
    q: '每个线程把自己的数放上货架的第 t 格，再取右边邻居那一格（第 t + 1 格）加起来，最后一个线程不取。同步写在哪？',
    options: [
      { label: '放之前', why: '那时货架上还什么都没有。放完没再等，就去取邻居的格子，邻居可能还没放。' },
      { label: '放和取之间', correct: true, why: '先等整组都放好，再取邻居那一格。只要取的是别人放的数，就要先等。' },
      { label: '不用写：邻居就在旁边，同一支小队', why: '线程 31 的右邻居是线程 32，在另一支小队，可能还没放。' },
    ],
  },
  {
    q: `派 2 组、每组 ${SHELF} 个线程。block 0 的一个线程走到同步那一行，要等谁？`,
    options: [
      { label: `只等同一支小队的 ${WAVE} 个线程`, why: `同步等的是整组：block 0 的 ${SHELF} 个线程，两支小队都要走到。` },
      { label: `block 0 的 ${SHELF} 个线程都走到`, correct: true, why: '同步让同一组的线程等齐：两支小队都走到这一行，才一起往下走。' },
      { label: `两组 ${TOTAL} 个线程都走到`, why: '同步不管别的组：block 1 也许还没开始，也许早就走完了。组和组之间等不了。' },
    ],
  },
]
</script>

# 1-9 车间里的货架

<div class="ls-hello">
  <Mascot class="ls-hello__art" :size="64" />
  <p class="ls-hello__line">数放上货架，组里谁都拿得到。可什么时候拿？</p>
</div>

第 {{ PREV.code }} 关的小队排好队，一车一车把数搬进车间。这一关，组里的线程要互相借数：线程 0 要用的，是线程 63 搬来的那个。

第 {{ HIERARCHY.code }} 关见过车间货架（LDS）：同一组的线程都拿得到。放上去、再取下来，听着不难，难在什么时候取。

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

先一步一步看两支小队怎样在货架前等齐，再把等的那一行删掉，看会出什么错。最后自己定：哪里要等，取哪一格。

</Mission>

## 热身：对面放好了吗？

这一关的工作单把 {{ LAB_LAUNCH.block }} 个数倒过来：线程 0 拿最后一个，线程 63 拿第一个。

每个线程先把自己搬来的数放上货架的第 t 格，再取对面那一格，也就是第 63 - t 格。t 是组内编号 threadIdx.x，i 是第 {{ GROUPS.code }} 关的全局下标。

<LangCode>
<template #hip>

```cpp
__global__ void flip(float* a, float* out) {
    __shared__ float s[64];     // 货架开 64 格
    int t = threadIdx.x;
    int i = blockIdx.x * blockDim.x + t;
    s[t] = a[i];                // 放上货架的第 t 格
    out[i] = s[63 - t];         // 取对面那一格
}
```

</template>
<template #python>

```python
@kernel
def flip(a, out):
    s = shared(64)              # 货架开 64 格
    t = threadIdx.x
    i = blockIdx.x * blockDim.x + t
    s[t] = a[i]                 # 放上货架的第 t 格
    out[i] = s[63 - t]          # 取对面那一格
```

</template>
</LangCode>

派 1 组 {{ LAB_LAUNCH.block }} 个线程，排成两支小队（第 {{ WAVEFRONT.code }} 关）：线程 0～{{ WAVE - 1 }} 是小队 0，{{ WAVE }}～{{ 2 * WAVE - 1 }} 是小队 1。

<Predict :stage="S" id="ls-p-ready" question="线程 0 去取第 63 格的时候，线程 63 一定已经把数放好了吗？" :options="pReady">

一支小队里的线程一起走，两支小队却各走各的。下面的单步执行器在放和取之间加了一行同步，看它怎样让两支小队等齐。

</Predict>

## 探索一：放好了，等齐再取

工作单在放和取之间加了一行：HIP 风格写 `__syncthreads();`，Python 风格写 `syncthreads()`。走到这一行的线程停下来，等这一组的线程全都走到，再一起往下走。

<ShelfLab variant="watch" />

小队 0 先放好了，可它要的第 32～63 格在小队 1 手里。它走到同步就停下，等小队 1 也放好、也走到同步，两支小队才一起去取。

模拟器让小队 0 先走，走到同步再换小队 1。真卡上两支小队交错着走，谁先到说不准；有了同步，先到的总会等后到的。

## 探索二：把同步删掉

<Predict :stage="S" id="ls-p-nowait" question="把同步那一行删掉，out 会怎样？" :options="pNoWait">

下面还是这张工作单。旋钮可以把同步删掉，或者挪到放之前，看货架和 out 怎么变。

</Predict>

<ShelfLab variant="move" />

删掉同步，小队 0 放完马上就取：第 32～63 格小队 1 还没放，取到的是 0。out 的前 32 个数错了，后 32 个碰巧对。

挪到放之前也一样：大家到齐了才开始放，放完没再等，照样取早。同步要写在「放」和「取」之间。

取到 0 是模拟器的约定：每组开始时，货架清零。真卡上货架不会清零，没放好的格子里是之前留下的数，错成什么样都有可能。

## 原理：工作组处理器、同步屏障和数据竞争

同一组的线程能借货架交接，是因为整组都落在同一个工作组处理器（WGP）里，货架就在那里。

<ConceptCard term="wgp">

{{ DEVICE_NAME }}（{{ ARCH }}）上，每 {{ CUS_PER_WGP }}计算单元合成一个 WGP，LDS 就在 WGP 里，一共 {{ LDS_PER_WGP }}。派出去的一组线程整组落在同一个 WGP，在货架上分到自己的一块，最多 {{ LDS_PER_BLOCK }}。

</ConceptCard>

所以货架只在同一组里共享：别的组看不到这一组的格子，落在同一个 WGP 也一样。组和组之间要交接，只能经过显存。

<ConceptCard term="barrier" code="__syncthreads()">

就是探索一加的那一行。走到它的小队停下来，等这一组的小队全都到了，再一起往下走；同步之前放上货架的数，同步之后大家都看得见。

</ConceptCard>

<ConceptCard term="race-condition">

探索二删掉同步以后，第 32 格：线程 31 去取的时候，线程 32 还没放。两个线程碰同一格，其中有人在放，中间又没有同步，模拟器就记一处数据竞争。

</ConceptCard>

为什么需要同步？一支小队里的线程一起走，可一组常有好几支小队，谁先走到哪一行说不准。取别人放的数之前，要等整组都放好。

同步也不是越多越好。每次同步，先到的小队都要停下来，等最慢的那支。只在取别人放的数之前等，别处不用等。

<DeepDive title="出处：货架、同步和数据竞争">

- HIP 文档：`__shared__` 声明的变量，只有同一个线程块的线程能访问，寿命和这个线程块一样长（[`__shared__`](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#shared)）。
- HIP 文档：同步函数让一组线程都停在这里，直到所有线程都走到；它带着内存栅栏，保证组里的线程看得见之前的读写。`__syncthreads()` 同步的是一个线程块（[Synchronization functions](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#synchronization-functions)）。同一页还说，不经过同步，不能认定一个线程写的数，别的线程已经看得见（[Memory fence instructions](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/hip_cpp_language_extensions.html#memory-fence-instructions)）。
- HIP 编程模型：一个线程块的 warp 都在同一个计算单元上执行，用同一块 LDS，能一起同步；不同的线程块之间不能直接同步，要经过全局内存交接（[Block (Work-group)](https://rocm.docs.amd.com/projects/HIP/en/latest/understand/programming_model.html#inherent-thread-hierarchy-block)）。warp 是 CUDA 的叫法，在 AMD GPU 上就是 wavefront。
- RDNA4 指令集手册：一个线程块（手册里叫 work-group）的 wave 都派到同一个 WGP，通过 LDS 共享数据，在屏障处同步，最多分到 {{ LDS_PER_BLOCK }} 的 LDS（2.3 节）；在 WGP 模式下，一组的 wave 可以分在这个 WGP 的两个计算单元上（同一节），所以上面 HIP 文档说的「同一个计算单元」，在 RDNA 上要读成「同一个 WGP」。每个 WGP 有 {{ LDS_PER_WGP }} 的 LDS（1.2.2.1 节）；屏障让每个 wave 等组里别的 wave 都走到同一条指令，再一起继续（5.6 节）。只有一个 wave 的组，屏障指令什么也不用等，当成空操作（2.3 节）。手册在 [GPUOpen](https://gpuopen.com/download/rdna4-instruction-set-architecture.pdf)。
- HIP 性能指南：每次同步，块里的线程都要停下来，等最慢的那个走到屏障；只在线程之间真要通过共享内存交换数据时同步（[Synchronization](https://rocm.docs.amd.com/projects/HIP/en/latest/how-to/performance_guidelines.html#synchronization)）。

</DeepDive>

<DeepDive title="模拟器简化了什么？">

- 模拟器让一组里的小队按编号轮流走：一支小队走到同步或者走完，才换下一支。所以删掉同步时，每次都是小队 0 取早。真卡上几支小队交错着走，先后不确定。
- 模拟器里，货架每组开始时是 0，取早的格子读到 0。真卡上货架不会自动清零，读到的是之前留下的数。
- 两次同步之间，两个线程碰了同一格、其中有人在放，模拟器就记一处数据竞争。真卡不会提醒你，只会时对时错。
- 挑战里「等了几次」只数同步的次数，不算时间：每次同步要等多久，这一关没有模拟。

</DeepDive>

比喻的边界：货架是整间车间的，上面给每组开的格子却只归这一组。在货架前等齐也只是比喻：真卡上没有人点名，是每支小队走到同步指令时报个到，到齐了再一起走。

## 挑战：每组倒过来

现在派 {{ FLIP_LAUNCH.grid }} 组，每组 {{ FLIP_LAUNCH.block }} 个线程，每组把自己的 {{ SHELF }} 个数倒过来：block 0 倒 a[0]～a[63]，block 1 倒 a[64]～a[127]。

工作单写了两次同步：放之前一次，放和取之间一次。三个虚线框由你来改：两处同步留不留，取货架的第几格。不想等的地方，删掉，或者写成一行注释。

这是星级挑战：每组都倒过来、没有数据竞争，拿第一颗星；每支小队只等一次，拿第二颗；换成 {{ VARIANT_LAUNCH.grid }} 组、每组 {{ VARIANT_LAUNCH.block }} 个线程，同一份代码照样成立，拿第三颗。没过不扣分，没过两次以后会出现提示。

<FlipSandbox />

## 你现在能……

- 借货架（LDS）在同一组线程之间交接数据：放上自己那一格，再取别人放的格子
- 说出为什么要同步：一组常有好几支小队，取别人放的数之前，要等整组都放好；别处不多等
- 说出货架和同步只管同一组：别的组看不到这一组的格子，组和组之间要经过显存

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：一组线程各有一个部分和，要合成一个数。放上货架，等齐，两两相加，再等齐……每一轮都要等。

- 回到基础：[旧版第 3 章 3.3 Block 内的数据共享与同步](/part0-intro/chapter3/#_3-3-block-内的数据共享与同步)，甲、乙两个线程各写一份局部和，同步以后，甲再把两份读出来加起来。
- 深入一层：[旧版第 10 章「LDS 复用必须等到所有读者完成」](/part2-kernels/chapter10/#lds-复用必须等到所有读者完成)，货架要拿来放别的数之前，还得再同步一次：等所有人都读完。

<EvidenceCard kind="simulated">这一关的结果来自浏览器里的模拟器：谁先放、谁先取、out 对不对、几处数据竞争、每支小队等了几次，都是模拟器照着工作单跑出来的，不计时，也不是实测。没有同步时总是小队 0 取早、取早的格子读到 0，是模拟器为了每次都看到同样的错定的规则；真卡上先后不确定，货架也不会清零。LDS 的大小（每个 WGP {{ LDS_PER_WGP }}，每组最多 {{ LDS_PER_BLOCK }}）来自 AMD 的 RDNA4 指令集手册，不是实测。</EvidenceCard>

<style scoped>
/* 小核开场：同 1-1～1-8 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.ls-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.ls-hello__art {
  flex: none;
}

.ls-hello__line {
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
.hg-shell.is-plain .ls-hello__art {
  display: none;
}

.hg-shell.is-plain .ls-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
