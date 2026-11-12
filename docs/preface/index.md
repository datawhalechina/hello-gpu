---
layout: hg
title: 前言
description: Hello GPU 写给谁、从哪里开始、怎么玩、三个区域、需要什么环境，以及进度存在哪。
---

<script setup>
import { withBase } from 'vitepress'
import { isPublished, stageHref, STAGES, ZONES } from '@course/outline.ts'

// 新手村第一关按大纲顺序取，编号和名字不手写。还没上线（planned）的关卡没有正式页面，
// 和世界地图一样不链接过去，先带读者去地图上看路线；NV-01 把它改成 draft 以后，这里自动变成链接。
const first = STAGES.find((s) => s.zone === 'novice')
const firstName = `${first.code} ${first.title}`
const firstHref = isPublished(first) ? withBase(stageHref(first)) : ''

// 区域卡片：推荐等级、运行环境、适合谁、一句话介绍都来自 outline.json 的 zones，关卡数从 stages 数。
const zones = ZONES.map((zone) => {
  const stages = STAGES.filter((s) => s.zone === zone.id)
  const bosses = stages.filter((s) => s.kind === 'boss').length
  return {
    ...zone,
    href: withBase(`/${zone.id}/`),
    count: bosses ? `${stages.length - bosses} 关 + Boss` : `${stages.length} 关`,
  }
})

// 「怎么玩」示意图里的五角星，圆心在原点、外接圆半径 5，用 transform 摆位置和缩放。
const STAR = 'M0 -5 L1.12 -1.55 L4.76 -1.55 L1.82 0.59 L2.94 4.05 L0 1.91 L-2.94 4.05 L-1.82 0.59 L-4.76 -1.55 L-1.12 -1.55 Z'
</script>

# 前言

<div class="pf-hello">
  <Mascot class="pf-hello__art" :size="64" />
  <p class="pf-hello__line">欢迎来到芯片工坊城。我是小核，陪你一关一关往前走。</p>
</div>

Hello GPU 是一本 AMD GPU 编程的闯关式教程，写给三类读者：零基础的新手、会 PyTorch 的算法工程师、会写算子的工程师。学完三个区域，你能写出正确的 kernel（交给 GPU 运行的代码），在真卡上找出它慢在哪，把它推近硬件上限，还会造自动调参的 Agent。

<section class="pf-door">

## 从哪里开始

<ul class="pf-start">
  <li class="pf-start__card">
    <h3 class="pf-start__who">零基础</h3>
    <p class="pf-start__text">从新手村第一关开始，只要浏览器。</p>
    <p v-if="!firstHref" class="pf-start__soon">{{ firstName }}还在建设中。</p>
    <p class="pf-start__go">
      <a v-if="firstHref" class="pf-btn is-primary" :href="firstHref">开始 {{ firstName }}</a>
      <a v-else class="pf-btn" :href="withBase('/world/')">看地图</a>
    </p>
  </li>
  <li class="pf-start__card">
    <h3 class="pf-start__who">会 PyTorch</h3>
    <p class="pf-start__text">先做定级测试，跳过已经会的关卡。</p>
    <p class="pf-start__go">
      <a class="pf-btn is-primary" :href="withBase('/placement/')">定级测试</a>
    </p>
  </li>
  <li class="pf-start__card">
    <h3 class="pf-start__who">写过算子</h3>
    <p class="pf-start__text">做定级测试，或者直接去试炼场。</p>
    <p class="pf-start__go">
      <a class="pf-btn is-primary" :href="withBase('/placement/')">定级测试</a>
      <a class="pf-btn" :href="withBase('/trial/')">去试炼场</a>
    </p>
  </li>
</ul>

<p class="pf-door__note">选错了也没关系：区域从不上锁，随时可以换；定级测试跳过的关卡，以后也能回来拿星。</p>

</section>

## 怎么玩

每一关都是同一个节奏：<span class="pf-seq">任务 → 先猜 → 动手 → 星级</span>。

<ol class="pf-loop pf-chain" aria-label="一关的四步">
  <li class="pf-loop__step is-mission">
    <svg class="pf-loop__art" viewBox="0 0 96 56" aria-hidden="true">
      <rect class="a-card" x="6" y="5" width="84" height="46" rx="8" />
      <rect class="a-ink" x="15" y="13" width="50" height="5" rx="2.5" />
      <path v-for="x in [20, 33, 46]" :key="x" class="a-star" :d="STAR" :transform="`translate(${x} 34)`" />
      <rect class="a-line" x="56" y="32" width="24" height="4" rx="2" />
    </svg>
    <span class="pf-loop__tag" aria-hidden="true">MISSION</span>
    <strong class="pf-loop__name">任务</strong>
    <span class="pf-loop__text">一句话说清这一关要做成什么，三颗星的标准也写在这里。</span>
  </li>
  <li class="pf-loop__step is-predict">
    <svg class="pf-loop__art" viewBox="0 0 96 56" aria-hidden="true">
      <rect class="a-ink" x="10" y="8" width="56" height="5" rx="2.5" />
      <rect class="a-option" x="10" y="22" width="22" height="24" rx="6" />
      <rect class="a-option is-picked" x="37" y="22" width="22" height="24" rx="6" />
      <rect class="a-option" x="64" y="22" width="22" height="24" rx="6" />
      <circle class="a-pick" cx="48" cy="34" r="4" />
    </svg>
    <span class="pf-loop__tag" aria-hidden="true">PREDICT</span>
    <strong class="pf-loop__name">先猜</strong>
    <span class="pf-loop__text">动手之前先猜一个结果。猜错不扣分，揭晓时对照你猜的。</span>
  </li>
  <li class="pf-loop__step is-lab">
    <svg class="pf-loop__art" viewBox="0 0 96 56" aria-hidden="true">
      <line class="a-track" x1="12" y1="12" x2="84" y2="12" />
      <line class="a-track is-on" x1="12" y1="12" x2="56" y2="12" />
      <circle class="a-knob" cx="56" cy="12" r="5.5" />
      <rect class="a-cell is-done" x="12" y="30" width="14" height="14" rx="3" />
      <rect class="a-cell is-done" x="30" y="30" width="14" height="14" rx="3" />
      <rect class="a-cell is-done" x="48" y="30" width="14" height="14" rx="3" />
      <rect class="a-cell" x="66" y="30" width="14" height="14" rx="3" />
    </svg>
    <span class="pf-loop__tag" aria-hidden="true">LAB</span>
    <strong class="pf-loop__name">动手</strong>
    <span class="pf-loop__text">拖滑块、改代码，马上看到线程怎么干活。写错了可以一直重试。</span>
  </li>
  <li class="pf-loop__step is-stars">
    <svg class="pf-loop__art" viewBox="0 0 96 56" aria-hidden="true">
      <path
        v-for="(x, i) in [24, 48, 72]"
        :key="x"
        class="a-star is-big"
        :class="{ 'is-empty': i === 2 }"
        :d="STAR"
        :transform="`translate(${x} 29) scale(2)`"
      />
    </svg>
    <span class="pf-loop__tag" aria-hidden="true">STARS</span>
    <strong class="pf-loop__name">星级</strong>
    <span class="pf-loop__text">★1 结果正确，★2 达到效率目标，★3 最优或完成额外挑战。</span>
  </li>
</ol>

看到现象以后才讲原理和新术语。卡住时有提示，一级比一级具体；在挑战里看了答案，这一关最多拿 2 颗星。

通关得 100 经验值，每颗星再加 50；每 300 经验值升一级，等级不封顶。等级、星、徽章和图鉴（学过的术语）都记在[我的成长](/me/)里。

## 三个区域

三个区域由浅到深，推荐等级只是建议。

<ul class="pf-zones">
  <li v-for="z in zones" :key="z.id" class="pf-zone" :data-zone="z.id">
    <p class="pf-zone__code">{{ z.code }}</p>
    <h3 class="pf-zone__name"><a :href="z.href">{{ z.name }}</a></h3>
    <p class="pf-zone__summary">{{ z.summary }}</p>
    <dl class="pf-zone__facts">
      <div><dt>推荐等级</dt><dd>Lv.{{ z.lv[0] }}–{{ z.lv[1] }}</dd></div>
      <div><dt>运行环境</dt><dd>{{ z.env }}</dd></div>
      <div><dt>适合</dt><dd>{{ z.readers }}</dd></div>
      <div><dt>关卡</dt><dd>{{ z.count }}</dd></div>
    </dl>
  </li>
</ul>

新手村的代码有 HIP 风格（C++ 写法）和 Python 风格两种，随时切换。铸造城和试炼场分 HIP、Triton 两条路线，在区域入口选；题目和实测数据两条路线共用。

## 需要什么环境

新手村只要浏览器。代码跑在网页里的 GPU 模拟器上，不用装软件，也不用显卡。

铸造城和试炼场要一张 AMD GPU，云上租的或自己的都行。动手的部分在实验室 Notebook 里做，和网页之间用通关码连起来：

<ol class="pf-flow pf-chain" aria-label="真卡关卡的一轮">
  <li class="pf-flow__step">
    <strong class="pf-flow__name">网页关卡</strong>
    <span class="pf-flow__text">读任务、先猜、看原理和可视化。</span>
  </li>
  <li class="pf-flow__step">
    <strong class="pf-flow__name">实验室 Notebook</strong>
    <span class="pf-flow__text">在 GPU 上写 kernel、校验、计时，最后打印通关码。</span>
  </li>
  <li class="pf-flow__step">
    <strong class="pf-flow__name">回到网页</strong>
    <span class="pf-flow__text">贴上通关码，按本关规则算星。</span>
  </li>
</ol>

装环境的步骤见[实验环境指南](/handbook/setup/)。暂时没有 GPU，可以选「观摩模式」：回放实验档案馆里的真实运行记录，能通关，但不得星。

## 进度存在哪

进度只存在你的浏览器里：经验值、星、徽章和代码草稿都不上传。换设备时，到[我的成长](/me/)导出存档文件或存档码，再到新设备导入。

清理浏览器数据会把进度一起清掉，隔一阵导出一次更稳妥。这里没有登录和排行榜，也不收集任何个人数据。

<style scoped>
/* Markdown 写的正文段落（没有 class）限制行长，宽屏上一行四十来个字；卡片和示意图照样占满版心。 */
p:not([class]) {
  max-width: 44em;
}

/* 「任务 → 先猜 → 动手 → 星级」不在箭头处断行。 */
.pf-seq {
  white-space: nowrap;
}

/* ---------- 小核开场：设计稿 Stage 的「小核 + 对话框」，对话框左上角收成小圆角，指向小核 ---------- */

.pf-hello {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin: 0 0 20px;
}

.pf-hello__art {
  flex: none;
}

.pf-hello__line {
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

/* 简洁模式收起插画（01 第 4 节），台词照样留着（「我是小核」说明了是谁在说）。 */
.hg-shell.is-plain .pf-hello__art {
  display: none;
}

.hg-shell.is-plain .pf-hello__line {
  margin-top: 0;
  border-radius: var(--hg-radius-card);
  box-shadow: none;
}

/* ---------- 按钮：主按钮深墨底、反色字，强调色只留给进度和焦点（01 第 2.2 节） ---------- */

.pf-btn {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 18px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  text-decoration: none;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.pf-btn.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.pf-btn:hover {
  border-color: var(--hg-accent);
  text-decoration: none;
}

.pf-btn:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/*
 * ---------- 从哪里开始：三类读者各一张卡，放在浅青底的面板里（配色同任务卡 Mission） ----------
 * 三类读者要在一屏内找到起点，所以手机上卡片收紧：名字和按钮同一行，说明在下面；
 * 一行放不下时按钮自己换到下一行。宽屏三张卡并排，按钮压到卡片底部对齐成一行。
 */

.pf-door {
  margin: 0 0 8px;
  padding: 16px 14px 14px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-accent-soft);
}

/* 面板里的标题不要正文 h2 的分隔线和大间距。 */
.pf-door h2 {
  margin: 0 0 12px;
  padding: 0;
  border: 0;
  font-size: 20px;
}

.pf-door__note {
  margin: 12px 0 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

.pf-start {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pf-start__card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 0;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

.pf-start__who {
  flex: 1 0 auto;
  margin: 0;
  font-size: var(--hg-text-card-title);
}

.pf-start__go {
  order: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
}

.pf-start__go .pf-btn {
  padding: 0 14px;
}

.pf-start__text,
.pf-start__soon {
  order: 2;
  flex: 1 1 100%;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

.pf-start__soon {
  color: var(--hg-ink-3);
}

@media (min-width: 768px) {
  .pf-door {
    padding: 20px 22px 18px;
  }

  .pf-start {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }

  .pf-start__card {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 6px;
    padding: 18px 20px;
  }

  .pf-start__who,
  .pf-start__text,
  .pf-start__soon {
    flex: none;
  }

  .pf-start__text,
  .pf-start__soon {
    font-size: 15px;
  }

  .pf-start__go {
    order: 3;
    margin-top: auto;
    padding-top: 8px;
  }

  .pf-start__go .pf-btn {
    padding: 0 18px;
  }
}

/*
 * ---------- 两张步骤图共用：怎么玩（四步）、真卡关卡（三步） ----------
 * 窄屏竖着排，步与步之间的箭头朝下；≥ 960px 排成一行（列数是 --pf-cols），箭头朝右。
 * 箭头是纯装饰，用边框画，读屏不会念出来。
 */

.pf-chain {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 22px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}

.pf-chain > li {
  position: relative;
  margin: 0;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
}

.pf-chain > li:not(:last-child)::after {
  content: '';
  position: absolute;
  bottom: -16px;
  left: var(--pf-arrow-x);
  width: 9px;
  height: 9px;
  border-right: 1.5px solid var(--hg-ink-3);
  border-bottom: 1.5px solid var(--hg-ink-3);
  transform: rotate(45deg);
}

/* ---------- 怎么玩：四步示意图，每步一张小插画 ---------- */

.pf-loop {
  --pf-cols: 4;
  /* 竖着排时箭头对准插画的中线（左内边距 16 + 插画宽 96 的一半 - 箭头半宽）；横着排时对准插画的高度 */
  --pf-arrow-x: 60px;
  --pf-arrow-y: 40px;
}

.pf-loop__step {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  grid-template-rows: auto auto 1fr;
  column-gap: 16px;
  padding: 14px 16px;
}

.pf-loop__art {
  grid-row: 1 / 4;
  width: 96px;
  height: 56px;
  align-self: center;
}

.pf-loop__tag {
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  letter-spacing: var(--hg-tracking-eyebrow);
}

.is-mission .pf-loop__tag { color: var(--hg-accent-ink); }
.is-predict .pf-loop__tag { color: var(--hg-violet-ink); }
.is-lab .pf-loop__tag { color: var(--hg-sky-ink); }
.is-stars .pf-loop__tag { color: var(--hg-amber-ink); }

.pf-loop__name {
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  line-height: 1.3;
}

.pf-loop__text {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

/* 示意图里的插画：颜色全部取 token，含义和关卡里一致（青 = 任务和进度、紫 = 先猜、天蓝 = 动手、琥珀 = 星）。 */
.a-card { fill: var(--hg-accent-soft); stroke: var(--hg-accent); stroke-width: 1.5; }
.a-ink { fill: var(--hg-ink-3); opacity: 0.55; }
.a-line { fill: var(--hg-border-strong); }
.a-star { fill: var(--hg-amber); stroke: var(--hg-art-line); stroke-width: 1; stroke-linejoin: round; }
.a-star.is-big { stroke-width: 0.6; }
.a-star.is-empty { fill: none; stroke: var(--hg-idle); stroke-dasharray: 1.4 1; }
.a-option { fill: var(--hg-surface-2); stroke: var(--hg-border-strong); stroke-width: 1.5; }
.a-option.is-picked { fill: color-mix(in srgb, var(--hg-violet) 14%, transparent); stroke: var(--hg-violet); }
.a-pick { fill: var(--hg-violet); }
.a-track { stroke: var(--hg-border-strong); stroke-width: 4; stroke-linecap: round; }
.a-track.is-on { stroke: var(--hg-sky-ink); }
.a-knob { fill: var(--hg-surface); stroke: var(--hg-ink); stroke-width: 1.5; }
.a-cell { fill: none; stroke: var(--hg-idle); stroke-width: 1.5; stroke-dasharray: 3 2; }
.a-cell.is-done { fill: var(--hg-accent); stroke: var(--hg-accent); stroke-dasharray: none; }

/* ---------- 真卡关卡的一轮：网页和实验室 Notebook 用通关码连起来（03 第 6 节） ---------- */

.pf-flow {
  --pf-cols: 3;
  --pf-arrow-x: 28px;
  --pf-arrow-y: calc(50% - 5px);
}

.pf-flow__step {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
}

.pf-flow__name {
  font-family: var(--hg-font-display);
  font-size: 16px;
  line-height: 1.35;
}

.pf-flow__text {
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

/* ---------- 三个区域：卡片跟着区域换强调色（01 第 4 节），试炼场是深色区域 ---------- */

.pf-zones {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}

.pf-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 16px 18px;
  border: var(--hg-border-width) solid color-mix(in srgb, var(--hg-accent) 45%, var(--hg-border));
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.pf-zone[data-zone='trial'] {
  background: var(--hg-bg);
}

.pf-zone__code {
  margin: 0;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.pf-zone__name {
  margin: 0;
  font-size: 19px;
  line-height: 1.3;
}

.pf-zone__name a {
  color: var(--hg-ink);
  text-decoration: none;
}

.pf-zone__name a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.pf-zone__name a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.pf-zone__summary {
  margin: 0 0 4px;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.55;
}

.pf-zone__facts {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-top: 10px;
  border-top: var(--hg-border-width) solid var(--hg-border);
  font-size: 14px;
}

.pf-zone__facts div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 8px;
}

.pf-zone__facts dt {
  color: var(--hg-ink-3);
}

.pf-zone__facts dd {
  margin: 0;
  color: var(--hg-ink);
}

/* ---------- 宽屏：步骤图排成一行，箭头朝右 ---------- */

@media (min-width: 960px) {
  .pf-chain {
    grid-template-columns: repeat(var(--pf-cols), minmax(0, 1fr));
  }

  .pf-chain > li:not(:last-child)::after {
    top: var(--pf-arrow-y);
    right: -16px;
    bottom: auto;
    left: auto;
    transform: rotate(-45deg);
  }

  .pf-loop__step {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto;
    row-gap: 4px;
    align-content: start;
  }

  .pf-loop__art {
    grid-row: auto;
    margin-bottom: 6px;
    align-self: start;
  }
}

/* ---------- 窄屏：小核的台词小一号，对话框贴近小核的头 ---------- */

@media (max-width: 767px) {
  .pf-hello {
    gap: 10px;
    margin-bottom: 16px;
  }

  .pf-hello__line {
    margin-top: 4px;
    padding: 10px 14px;
    font-size: 15px;
    line-height: 1.6;
  }
}
</style>
