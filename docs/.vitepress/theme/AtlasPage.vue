<script setup lang="ts">
import { withBase } from 'vitepress'
import AtlasVendors from './AtlasVendors.vue'
import UiIcon from './UiIcon.vue'
defineProps<{ amd?: boolean }>()
const lessons = [
  { chapter: '02', title: '编程模型与 wavefront 执行', description: '从线程编号到软件与硬件的映射，理解一次工作怎样交给 GPU。', href: '/part0-intro/chapter2/' },
  { chapter: '03', title: '片上资源与数据通路', description: '跟着一个元素认识寄存器、缓存与 LDS，再看数据怎样流动。', href: '/part0-intro/chapter3/' },
]
</script>

<template>
  <section class="hg-atlas-page" :class="{ 'is-amd': amd }">
    <nav class="hg-atlas-breadcrumb" aria-label="当前位置">
      <a :href="withBase(amd ? '/atlas/' : '/')"><UiIcon name="arrow" :size="16" />{{ amd ? 'GPU 图谱' : 'Hello GPU' }}</a>
      <span>{{ amd ? 'AMD' : 'GPU ATLAS' }}</span>
    </nav>
    <header class="hg-atlas-page-hero">
      <p class="hg-atlas-page-kicker">{{ amd ? 'AMD · 交互图谱筹备中' : 'GPU ATLAS · GPU 图谱' }}</p>
      <h1>{{ amd ? '从我们手上的 GPU，\n开始。' : '从架构演进，\n看到计算发生。' }}</h1>
      <p>{{ amd ? 'AMD 图谱将从教程主线的 RDNA 出发，逐步扩展到 CDNA。交互内容正在筹备，你可以先沿着已有章节，读懂执行模型与片上资源。' : '沿着 GPU 的每一层，连接整卡、芯片与计算单元。把教程中的抽象概念，放回看得见的硬件结构。' }}</p>
    </header>
    <template v-if="!amd">
      <AtlasVendors />
      <div class="hg-atlas-reading-note"><UiIcon name="book" :size="22" /><p>图谱用于辅助理解硬件与查阅公开资料。架构模型是结构示意；产品规格、理论峰值与教程实测分别标注。</p><a :href="withBase('/curriculum/')">回到学习路线 <UiIcon name="arrow" :size="18" /></a></div>
    </template>
    <template v-else>
      <div class="hg-amd-layout">
        <section class="hg-amd-directions" aria-labelledby="amd-directions-title">
          <p class="hg-atlas-section-label">接下来，逐层展开</p>
          <h2 id="amd-directions-title">两条系列，各自看清。</h2>
          <article><div><h3>RDNA</h3><span>优先建设</span></div><p>先围绕 Radeon RX 9070 XT 展开，与教程中的 wavefront、WGP / CU 和 LDS 概念衔接。</p><small>Radeon 系列</small></article>
          <article><div><h3>CDNA</h3><span>后续扩展</span></div><p>逐步补充面向计算产品的芯片结构、存储层级与公开资料。</p><small>Instinct 系列</small></article>
        </section>
        <section class="hg-amd-lessons" aria-labelledby="amd-lessons-title">
          <p class="hg-atlas-section-label">现在可以开始</p>
          <h2 id="amd-lessons-title">先把基础，看得更清楚。</h2>
          <a v-for="lesson in lessons" :key="lesson.chapter" :href="withBase(lesson.href)">
            <span class="hg-amd-lesson-number">第 {{ lesson.chapter }} 章</span><h3>{{ lesson.title }}</h3><p>{{ lesson.description }}</p><span class="hg-amd-lesson-action">阅读教程 <UiIcon name="arrow" :size="19" /></span>
          </a>
        </section>
      </div>
      <footer class="hg-amd-footer"><p>也可以先探索已开放的 NVIDIA 图谱，了解另一种架构组织方式。</p><a :href="withBase('/atlas/nvidia/')" target="_self">探索 NVIDIA 图谱 <UiIcon name="arrow" :size="18" /></a></footer>
    </template>
  </section>
</template>

<style scoped>
.hg-atlas-page {
  max-width: 1456px;
  margin: auto;
  padding: 40px 48px 90px;
  color: var(--vp-c-text-1);
}

.hg-atlas-breadcrumb {
  display: flex;
  gap: 20px;
  align-items: center;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.hg-atlas-breadcrumb a {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--vp-c-text-2);
}

.hg-atlas-breadcrumb a svg {
  transform: rotate(180deg);
}

.hg-atlas-breadcrumb > span {
  padding-left: 20px;
  border-left: 1px solid var(--vp-c-divider);
  font-size: 10px;
  letter-spacing: .06em;
}

.hg-atlas-page-hero {
  padding: 76px 0 64px;
}

.hg-atlas-page-kicker {
  font: 11px var(--vp-font-family-mono);
  letter-spacing: .13em;
  color: var(--vp-c-text-3);
  margin: 0 0 26px;
}

.hg-atlas-page h1 {
  font-size: clamp(43px, 5.2vw, 72px);
  line-height: 1.2;
  letter-spacing: -.045em;
  font-weight: 600;
  white-space: pre-line;
  margin: 0;
}

.hg-atlas-page-hero > p:last-child {
  max-width: 620px;
  font-size: 18px;
  line-height: 1.9;
  color: var(--vp-c-text-2);
  margin: 28px 0 0;
}

.hg-atlas-reading-note {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 32px;
  color: var(--vp-c-text-3);
}

.hg-atlas-reading-note > svg {
  flex-shrink: 0;
}

.hg-atlas-reading-note p {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  max-width: 720px;
}

.hg-atlas-reading-note a {
  margin-left: auto;
  color: var(--vp-c-brand-1);
  display: flex;
  align-items: center;
  gap: 12px;
  white-space: nowrap;
  font-size: 13px;
}

.hg-amd-layout {
  display: grid;
  grid-template-columns: .9fr 1.1fr;
  gap: 80px;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 45px;
}

.hg-atlas-section-label {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin: 0 0 18px;
}

.hg-amd-layout h2 {
  font-size: clamp(24px, 2.3vw, 31px);
  font-weight: 600;
  letter-spacing: -.03em;
  line-height: 1.4;
  margin: 0 0 32px;
}

.hg-amd-directions article {
  border-top: 1px solid var(--vp-c-divider);
  padding: 26px 0 30px;
}

.hg-amd-directions article > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.hg-amd-directions h3 {
  font-size: 25px;
  margin: 0;
  font-weight: 550;
  letter-spacing: -.03em;
}

.hg-amd-directions article span {
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.hg-amd-directions article p {
  font-size: 15px;
  line-height: 1.9;
  color: var(--vp-c-text-2);
  max-width: 400px;
  margin: 18px 0;
}

.hg-amd-directions small {
  font: 11px var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.hg-amd-lessons > a {
  display: block;
  background: var(--vp-c-bg-soft);
  padding: 27px 30px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  margin-top: 18px;
  transition: border-color .2s;
}

.hg-amd-lessons > a:hover {
  border-color: var(--hg-line-strong);
}

.hg-amd-lesson-number {
  font: 11px var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.hg-amd-lessons h3 {
  font-size: 21px;
  line-height: 1.5;
  letter-spacing: -.02em;
  font-weight: 500;
  margin: 14px 0 0;
}

.hg-amd-lessons a p {
  margin: 12px 0 24px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.8;
}

.hg-amd-lesson-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  color: var(--vp-c-brand-1);
}

.hg-amd-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  border-top: 1px solid var(--vp-c-divider);
  margin-top: 64px;
  padding-top: 30px;
}

.hg-amd-footer p {
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.8;
  margin: 0;
}

.hg-amd-footer a {
  display: flex;
  align-items: center;
  gap: 16px;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  white-space: nowrap;
}

@media (max-width: 1000px) {
  .hg-atlas-page {
    padding: 32px 32px 70px;
  }
  .hg-amd-layout {
    gap: 40px;
  }
  .hg-atlas-reading-note {
    flex-wrap: wrap;
  }
  .hg-atlas-reading-note a {
    margin: 4px 0 0 42px;
  }
}

@media (max-width: 700px) {
  .hg-atlas-page {
    padding: 30px 24px 60px;
  }
  .hg-atlas-page-hero {
    padding: 55px 0 40px;
  }
  .hg-atlas-page h1 {
    font-size: clamp(37px, 9vw, 58px);
  }
  .hg-atlas-page-hero > p:last-child {
    font-size: 16px;
    margin-top: 24px;
  }
  .hg-atlas-page-kicker {
    font-size: 10px;
    margin-bottom: 22px;
  }
  .hg-atlas-reading-note {
    align-items: flex-start;
    gap: 15px;
  }
  .hg-atlas-reading-note p {
    flex: 1;
    min-width: 200px;
    font-size: 12px;
  }
  .hg-atlas-reading-note a {
    margin-left: 37px;
  }
  .hg-amd-layout {
    grid-template-columns: 1fr;
    gap: 28px;
    padding-top: 34px;
  }
  .hg-amd-layout h2 {
    font-size: 27px;
    margin-bottom: 26px;
  }
  .hg-amd-directions article {
    padding: 22px 0 26px;
  }
  .hg-amd-directions article:last-child {
    padding-bottom: 0;
  }
  .hg-amd-lessons > a {
    padding: 24px;
  }
  .hg-amd-lessons h3 {
    font-size: 21px;
  }
  .hg-amd-footer {
    margin-top: 42px;
    padding-top: 26px;
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hg-amd-lessons > a {
    transition: none;
  }
}
</style>
