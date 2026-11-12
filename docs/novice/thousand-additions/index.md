---
layout: stage
stage: novice-thousand-additions
newTerms: [parallel, data-dependency]
evidence: simulated
description: 1 位教授和 1000 个学徒比赛做加法：GPU 为什么快，什么样的活适合并行。
---

<script setup>
import { ref } from 'vue'
import { neighborsOf, stageById } from '@course/outline.ts'
import AdditionRace from './scenes/AdditionRace.vue'
import JobBoard from './scenes/JobBoard.vue'
import { KIND_OPTIONS, RACE_COUNTS, STAGE_ID, STAR_LABELS } from './challenge.ts'

const S = STAGE_ID
const GOAL = '把今天的五张单子派给教授或学徒：结果全对，总用时最短。'

// 关卡编号由大纲生成（04 第 1 节），正文里提到别的关卡时也从大纲取，插关卡不用改这一页。
const WAVE = stageById('novice-wavefront')
const NEXT = neighborsOf(S).next

// 探索一只开放题目数量，探索二只开放题目种类（03 第 1 节第 3 条：每次只开放 1–3 个参数）。
const raceCount = ref(1000)
const raceKind = ref('add')

const pRace = [
  { label: '教授', why: '教授一道只要 1 拍，可他得一道接一道做 1000 道，一共 1000 拍。' },
  { label: '1000 个学徒', correct: true, why: '每个学徒只做 1 道，1000 人同时动笔，4 拍就全部做完。' },
  { label: '差不多同时', why: '差得很远：学徒 4 拍，教授 1000 拍。' },
  { label: '我不确定', why: '不确定也没关系，下面就开赛。' },
]

const pSum = [
  { label: '还是学徒赢', why: '学徒要拿到上一步的和才能动笔。人再多，每一步也只能 1 个人做。' },
  { label: '教授赢', correct: true, why: '累加只能一步接一步，比的是单个人的快慢：教授 1 拍一步，学徒 4 拍一步。' },
  { label: '打平', why: '一步接一步时，教授每步 1 拍，学徒每步 4 拍，差了 4 倍。' },
  { label: '我不确定', why: '不确定也没关系，下面换成累加比一场。' },
]

const checkpoint = [
  {
    q: '工坊城又来了一张单子：给 2000 张照片各自调亮一点，每张照片只管自己。交给谁更快？',
    options: [
      { label: '1000 个学徒', correct: true, why: '每张照片只用自己的数据，互不依赖，份数又多：正是拆得开的活。' },
      { label: '教授', why: '份数多、互不依赖的活交给教授，就得一张接一张做，最慢。' },
      { label: '一样快', why: '总活量一样，可学徒能同时开工，用时短得多。' },
    ],
  },
  {
    q: '存钱：每年的余额 = 上一年的余额 × 1.05。想知道 30 年后的余额，让 30 个学徒每人算一年，行不行？',
    options: [
      { label: '行，30 个人一轮就算完', why: '算第 2 年的人要用第 1 年的余额，他动笔的时候第 1 年还没算完。' },
      { label: '不行，每一年都要用上一年的结果', correct: true, why: '这就是数据依赖。人再多，也只能一年接一年地算。' },
      { label: '行，只要每个人算得够快', why: '问题不在快慢：拆开同时算，谁也拿不到上一年的余额。' },
    ],
  },
  {
    q: '有人说：GPU 有成千上万个执行通道，所以任何程序放到 GPU 上都会变快。这句话错在哪？',
    options: [
      { label: '没错，通道越多越快', why: '通道再多，也得有那么多份互不相关的活分给它们。' },
      {
        label: '活太少，或者后一步要等前一步时，通道多也帮不上忙',
        correct: true,
        why: '份数少时，大部分通道闲着；有依赖时，只能一步接一步。这两种活，CPU 的强核心反而更合适。',
      },
      { label: 'GPU 的每个通道都比 CPU 核心快，所以总是更快', why: '正好相反：单个执行通道比 CPU 核心简单，单打独斗比不过。GPU 快在同时开工的人多。' },
    ],
  },
]
</script>

# 1-1 一千道加法

<div class="ta-hello">
  <Mascot class="ta-hello__art" :size="64" />
  <p class="ta-hello__line">工坊城接了第一单：1000 道加法。办场比赛吧！</p>
</div>

一边是 1 位教授，算得快，可只有一个人。另一边是 1000 个学徒，每人算得慢，但能一起上。教授代表 CPU（电脑的中央处理器），学徒代表 GPU（显卡上的图形处理器）。

这一关用一场比赛回答两个问题：GPU 为什么快？什么样的活适合交给它？

<Mission :stage="S" :goal="GOAL" :stars="STAR_LABELS">

这是任务卡，每一关开头都有一张：第一行是这一关要做成的事，下面三行是三颗星的标准。星在后面的「挑战」里拿，拿到的星会在这里点亮。

</Mission>

## 热身：谁先交卷？

先定比赛规则（模拟）：教授 1 拍算完一道加法，一道接一道做；学徒 4 拍才算完一道，但 1000 个学徒可以同时动笔。题目是 1000 道互不相关的加法：每一道只用自己那一对数，不用等别的题算完。

下面这张卡叫「先猜」：先选一个答案，点「锁定答案」，才会揭晓。猜错不扣分，猜对也不加分，凭第一反应选就好。

<Predict :stage="S" id="ta-p-race" question="1000 道加法，谁先交卷？" :options="pRace">

学徒 4 拍就交卷，教授要 1000 拍。下面开一场比赛，亲眼看看。

</Predict>

## 探索一：题目的多少

动手改一改题目数量，点「开赛」看过程。特别看看只有 1 道题的时候。

<AdditionRace :n="raceCount" kind="add">
  <Knob label="题目数量" :options="RACE_COUNTS" unit=" 道" v-model="raceCount" />
</AdditionRace>

学徒赢在人多，不在算得快。题目越多，同时动笔的人越多；题目比学徒还多，就分几轮做。只有 1 道题时，1000 个学徒里只有 1 个有活干，他还比教授慢。

## 探索二：换成累加

换一种题：把 1000 个数加成一个总和。从 0 开始，先加上第 1 个数，再在这个和上加第 2 个数……每一步都要用到上一步的和。

写成代码，两段循环几乎一样，差别就在循环里那一行。代码有 HIP 风格和 Python 风格两种写法，块顶上随时可以换。

<LangCode>
<template #hip>

```cpp
// 逐个相加：第 i 道只用第 i 对数
for (int i = 0; i < 1000; i++) {
    c[i] = a[i] + b[i];
}
// 累加：每一步都要用上一步的 s
float s = 0;
for (int i = 0; i < 1000; i++) {
    s = s + a[i];
}
```

</template>
<template #python>

```python
# 逐个相加：第 i 道只用第 i 对数
for i in range(1000):
    c[i] = a[i] + b[i]
# 累加：每一步都要用上一步的 s
s = 0.0
for i in range(1000):
    s = s + a[i]
```

</template>
</LangCode>

<Predict :stage="S" id="ta-p-sum" question="换成累加，1000 个学徒还能赢吗？" :options="pSum">

把下面的题目换成「累加」，看学徒那边开赛时有几个人在算。

</Predict>

<AdditionRace :n="1000" :kind="raceKind">
  <Knob label="题目" :options="KIND_OPTIONS" v-model="raceKind" />
</AdditionRace>

累加的每一步都要等上一步的和，学徒那边只能派 1 个人从头加到尾，另外 999 个人帮不上忙。要是硬把 1000 步拆给 1000 个人同时做，每个人拿到的和都还是 0，交上来的总和就错了。

## 原理：人多，还要拆得开

<ConceptCard term="parallel">

这一关里，1000 个学徒同时做 1000 道互不相关的加法，就是并行。

</ConceptCard>

<ConceptCard term="data-dependency" code="s = s + a[i]">

累加的每一步都要用上一步的 s。有数据依赖的活，拆开同时做就会算错。

</ConceptCard>

比赛里的两队，对应电脑里的两种芯片。CPU 里是少数几个强大的核心，每个核心像一位教授，复杂的事也能很快做完。GPU 里是成千上万个简单的执行通道，每个通道像一个学徒，单个比不上 CPU 的核心，胜在能同时开工。

所以 GPU 快，快在人多。前提是活能拆成很多份，每一份只用自己的数据。份数太少，或者后一步要等前一步，人再多也帮不上忙。

比喻的边界：比赛里只有一位教授，真实的 CPU 却有好几个核心，也能并行，只是人少。GPU 上的学徒也不是各干各的：一小队执行通道听同一个口令，同一时刻做同一件事，第 {{ WAVE.code }} 关会讲。

<DeepDive title="教授 1 拍、学徒 4 拍，是真实的速度吗？">

不是。这两个数是比赛规则，只为了好算：单个学徒比教授慢，人数却多得多。真实的 CPU 核心和 GPU 执行通道各有多快，要看具体的芯片和算的是什么。

比赛还省掉了一段路：真实程序里，数据要先从 CPU 这边搬到 GPU，算完再搬回来，这也要花时间。下一关就沿着这段路走一遍；到了铸造城，你会在真卡上亲手测。

</DeepDive>

## 挑战：今天的五张单子

工坊城今天来了五张单子。每张由你决定：交给教授一道接一道做，还是拆开交给 1000 个学徒，每人一道、同时开工。派好了点「开工」。

这是星级挑战：结果全对拿第一颗星，用时达到目标拿第二颗，用时最短拿第三颗，和上面任务卡写的一样。没过不扣分，可以一直试；没过两次以后，会出现提示。

<JobBoard />

## 你现在能……

- 用「人多，单个慢」说清 GPU 为什么快
- 判断一份活适不适合交给 GPU：份数多不多，每一份是不是只用自己的数据
- 认出数据依赖：后一步要用前一步的结果，拆开同时做就会算错

## 检查点

<Checkpoint :stage="S" :questions="checkpoint" />

## 下一关

{{ NEXT.code }}「{{ NEXT.title }}」：1000 个学徒在 GPU 里住在哪？下一关走进工坊城，看 GPU 由哪些部分组成，一份活从 CPU 交给 GPU 要经过哪里。

- 回到基础：[旧版第 2 章 2.1 GPU 计算的基本流程](/part0-intro/chapter2/#_2-1-gpu-计算的基本流程)，从两排数对应相加讲起，讲的是同一件事。
- 深入一层：[GPU 图谱](/atlas/)，看真实的 AMD GPU 芯片里，计算单元是怎么排布的。

<EvidenceCard kind="simulated">这一关的拍数、用时和倍数都按比赛规则算出来（教授 1 拍一道，学徒 4 拍一道，1000 个学徒同时开工），不是真卡实测，也不代表真实 CPU、GPU 的速度比例。</EvidenceCard>

<style scoped>
/* 小核开场：同前言的「小核 + 对话框」，对话框左上角收成小圆角，指向小核。 */
.ta-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.ta-hello__art {
  flex: none;
}

.ta-hello__line {
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
.hg-shell.is-plain .ta-hello__art {
  display: none;
}

.hg-shell.is-plain .ta-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}
</style>
