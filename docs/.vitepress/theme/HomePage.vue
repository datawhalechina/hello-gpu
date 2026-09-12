<script setup lang="ts">
import { withBase } from 'vitepress'
import { chapterCount, parts } from '../outline.mjs'
import UiIcon from './UiIcon.vue'
import LearningPath from './LearningPath.vue'
import ScrollStory from './ScrollStory.vue'
import Contributors from './Contributors.vue'
import AtlasPreview from './AtlasPreview.vue'
</script>

<template>
  <div class="hg-home">
    <section class="hg-hero" aria-labelledby="home-title">
      <div class="hg-hero-inner">
        <div class="hg-hero-copy">
          <p class="hg-eyebrow">HELLO GPU <span>/</span> 从理解到优化</p>
          <h1 id="home-title"><span>看懂 GPU，</span><span>亲手优化<br class="hero-title-break">每一次计算。</span></h1>
          <p class="hg-hero-description">从第一个 Kernel，到经典算子优化，再到算子优化 Agent。<br class="desktop-break">沿着理解、测量、优化与自动化的路径动手实践。</p>
          <div class="hg-hero-actions">
            <a class="hg-primary" :href="withBase('/part0-intro/chapter0/')">开始学习 <UiIcon name="arrow" /></a>
            <a class="hg-text-link" :href="withBase('/curriculum/')"><span class="desktop-label">浏览学习路线</span><span class="mobile-label">学习路线</span></a>
          </div>
        </div>
        <figure class="hg-hero-art">
          <img :src="withBase('/images/ui/hello-gpu-chip.png')" width="1254" height="1254"
            alt="带 Hello-GPU 标志的银色与石墨色分层芯片，透明背景的抽象计算结构" fetchpriority="high" decoding="async">
          <figcaption>Hello-GPU · 计算结构示意</figcaption>
        </figure>
      </div>
      <a class="hg-scroll-invitation" href="#home-story">向下探索，每一次计算的可能 <UiIcon name="arrow" :size="16" /></a>
      <div class="hg-hardware-strip"><UiIcon name="monitor" /><strong>实验基线</strong><span>Radeon RX 9070 XT</span><i>·</i><span>ROCm 7.13</span><i>·</i><span>原生 Ubuntu 24.04</span></div>
    </section>
    <ScrollStory />
    <div id="home-curriculum" class="hg-curriculum-anchor" aria-hidden="true" />
    <a class="hg-route-strip" :href="withBase('/curriculum/')">
      <span class="hg-route-index">01 <i /></span><strong>学习路线</strong>
      <span class="hg-route-count">{{ parts.length }} 篇正文 · {{ chapterCount }} 章</span>
      <span class="hg-route-description">从基础概念到自动化优化，系统掌握 GPU 计算</span>
      <span class="hg-route-more">探索完整路线 <UiIcon name="arrow" /></span>
    </a>
    <LearningPath embedded />
    <AtlasPreview />
    <Contributors />
  </div>
</template>

<style scoped>
.hg-home {
  overflow: clip;
}

.hg-hero {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-divider);
}

.hg-hero-inner {
  max-width: 1680px;
  margin: auto;
  min-height: clamp(570px, 42.7vw, 730px);
  padding: 54px max(40px, 4.8vw) 58px;
  position: relative;
  display: flex;
  align-items: center;
}

.hg-hero-copy {
  position: relative;
  z-index: 1;
  width: 55%;
  padding-bottom: 32px;
}

.hg-eyebrow {
  color: var(--vp-c-text-2);
  font-size: 12px;
  letter-spacing: .16em;
  margin: 0 0 28px;
}

.hg-eyebrow span {
  margin: 0 14px;
}

h1 {
  font-size: clamp(42px, 4.4vw, 76px);
  line-height: 1.38;
  letter-spacing: -.045em;
  font-weight: 650;
  margin: 0;
}

h1 span {
  display: block;
  white-space: nowrap;
}

.hg-hero-description {
  font-size: clamp(16px, 1.45vw, 24px);
  line-height: 1.8;
  margin: 28px 0 32px;
  color: var(--vp-c-text-2);
  max-width: 680px;
}

.hg-hero-actions {
  display: flex;
  align-items: center;
  gap: 40px;
}

.hg-primary {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  min-width: 190px;
  padding: 16px 26px;
  border-radius: 5px;
  background: var(--hg-button-bg);
  color: var(--hg-button-text);
  font-size: 17px;
  font-weight: 600;
  box-shadow: inset 0 0 18px #ffffff14;
  transition: background .18s, transform .18s;
}

.hg-primary:hover {
  background: var(--hg-button-hover);
  transform: translateY(-2px);
}

.hg-text-link {
  font-size: 16px;
  border-bottom: 1px solid currentColor;
  padding: 9px 0;
  transition: color .18s;
}

.hg-text-link:hover {
  color: var(--vp-c-brand-1);
}

.hg-hero-art {
  position: absolute;
  width: 49%;
  right: 1.5%;
  top: 0;
  bottom: 0;
  margin: 0;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.hg-hero-art img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
}

.hg-hero-art figcaption {
  position: absolute;
  bottom: 32px;
  right: 12%;
  display: block;
  color: var(--vp-c-text-3);
  font-size: 10px;
  letter-spacing: .06em;
}

.hg-scroll-invitation {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 max(40px, 4.8vw) 27px;
  color: var(--vp-c-text-3);
  font-size: 12px;
}

.hg-scroll-invitation svg {
  transform: rotate(90deg);
}

.hg-hardware-strip {
  border-top: 1px solid var(--vp-c-divider);
  min-height: 58px;
  padding: 16px max(40px, 4.8vw);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 16px;
  color: var(--vp-c-text-2);
}

.hg-hardware-strip svg {
  display: none;
}

.hg-hardware-strip strong {
  font-weight: 550;
  color: var(--vp-c-text-1);
}

.hg-hardware-strip i {
  font-style: normal;
}

.hg-route-strip {
  max-width: 1680px;
  margin: auto;
  min-height: 100px;
  padding: 28px max(40px, 4.8vw);
  display: flex;
  align-items: center;
  gap: 28px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.hg-route-index {
  display: flex;
  align-items: center;
  gap: 22px;
  color: var(--vp-c-text-3);
  font: 12px var(--vp-font-family-mono);
}

.hg-route-index i {
  width: 52px;
  height: 1px;
  background: var(--vp-c-divider);
}

.hg-route-strip strong {
  font-size: 26px;
  letter-spacing: -.035em;
  white-space: nowrap;
}

.hg-route-count {
  border-left: 1px solid var(--vp-c-divider);
  padding-left: 26px;
  white-space: nowrap;
  font-size: 14px;
}

.hg-route-description {
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.hg-route-more {
  margin-left: auto;
  display: flex;
  gap: 18px;
  align-items: center;
  font-size: 14px;
  white-space: nowrap;
}

.hg-route-strip:hover .hg-route-more {
  color: var(--vp-c-brand-1);
}

.mobile-label, .hero-title-break {
  display: none;
}

@media (min-width: 1500px) {
  .hg-hero-copy {
    padding-bottom: 88px;
  }
  .hg-primary {
    min-width: 220px;
    font-size: 19px;
    line-height: 1.6;
  }
  .hg-hardware-strip {
    font-size: 18px;
  }
  .hg-hero-copy .hg-eyebrow {
    display: none;
  }
}

@media (max-width: 1200px) {
  .hg-route-description {
    display: none;
  }
  .hg-hero-inner {
    padding-left: 36px;
    padding-right: 36px;
  }
  .hg-hero-copy {
    width: 61%;
  }
  .hg-hero-art {
    width: 53%;
  }
}

@media (min-width: 768px) and (max-width: 1099px) {
  .hg-hero-copy {
    width: 51%;
  }
  h1 {
    font-size: 42px;
    line-height: 1.35;
  }
  .hero-title-break {
    display: block;
  }
  .hg-hero-description {
    font-size: 16px;
  }
  .hg-hero-actions {
    gap: 22px;
  }
  .hg-primary {
    min-width: 155px;
    padding: 14px 19px;
  }
  .hg-text-link {
    font-size: 14px;
  }
}

@media (max-width: 767px) {
  .hg-hero-inner {
    min-height: 0;
    padding: 30px 23px 0;
    display: block;
  }
  .hg-hero-copy {
    width: 100%;
    padding: 0;
  }
  .hg-eyebrow {
    font-size: 10px;
    margin-bottom: 27px;
    letter-spacing: .1em;
  }
  h1 {
    font-size: clamp(34px, 10.5vw, 66px);
    line-height: 1.31;
    letter-spacing: -.03em;
    max-width: 580px;
  }
  h1 span {
    white-space: normal;
  }
  h1 span:last-child {
    max-width: 9em;
  }
  .hero-title-break {
    display: block;
  }
  .hg-hero-description {
    font-size: 16px;
    line-height: 1.65;
    margin: 17px 0 24px;
    max-width: 500px;
  }
  .desktop-break {
    display: none;
  }
  .hg-hero-actions {
    gap: 27px;
  }
  .hg-primary {
    min-width: 140px;
    font-size: 16px;
    padding: 13px 20px;
    gap: 20px;
  }
  .hg-text-link {
    font-size: 16px;
  }
  .hg-scroll-invitation {
    padding: 0 23px 20px;
    font-size: 11px;
  }
  .hg-hero-art {
    position: relative;
    width: calc(100% + 20px);
    right: auto;
    margin: -2px -10px 0;
    opacity: 1;
    display: block;
  }
  .hg-hero-art img {
    display: block;
  }
  .hg-hero-art figcaption {
    display: block;
    color: var(--vp-c-text-2);
    position: static;
    margin: -5px 18px 18px;
    font-size: 11px;
  }
  .hg-hardware-strip {
    margin: 0 23px;
    padding: 16px 0;
    gap: 7px;
    font-size: 10px;
    min-height: 0;
  }
  .hg-hardware-strip svg {
    display: block;
    width: 15px;
  }
  .hg-hardware-strip strong {
    display: none;
  }
  .hg-route-strip {
    display: none;
  }
  .desktop-label {
    display: none;
  }
  .mobile-label {
    display: inline;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hg-primary {
    transition: none;
  }
  .hg-primary:hover {
    transform: none;
  }
}
</style>
