<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { parts, chapters, chapterCount } from '../outline.mjs'
import UiIcon from './UiIcon.vue'
defineProps<{ embedded?: boolean }>()
const selected = ref(2)
const current = computed(() => parts[selected.value])
const currentChapters = computed(() => chapters.filter(chapter => chapter.part.prefix === current.value.prefix))
const icons = ['book', 'chart', 'code', 'grid', 'chip']
const descriptions = ['建立 GPU 计算的核心认知', '定位性能瓶颈，读懂硬件行为', '从理解到高性能实现', '把测量与优化交给工具和 Agent', '走进真实模型的优化问题']
const operators: Record<number, string> = { 8: 'Vector Add', 9: 'Sum Reduction', 10: 'Softmax', 11: 'Matmul', 12: 'FlashAttention', 13: 'Fused RMSNorm' }
function onPartKey(event: KeyboardEvent, index: number) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? parts.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + parts.length) % parts.length
  selected.value = next
  ;(event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
}
</script>

<template>
  <section class="hg-curriculum" :class="{ 'is-embedded': embedded }" aria-labelledby="curriculum-title">
    <div class="hg-curriculum-layout">
      <div class="hg-curriculum-intro">
        <p class="hg-eyebrow">LEARNING PATH</p>
        <h1 v-if="!embedded" id="curriculum-title">从第一步，<br>到独立优化。</h1>
        <h2 v-else id="curriculum-title"><span class="desktop-heading">从第一步，<br>到独立优化。</span><span class="mobile-heading">循序渐进，<br>走完优化闭环。</span></h2>
        <p class="hg-chapter-count">{{ parts.length }} 篇正文 <span>·</span> {{ chapterCount }} 章</p>
        <div class="hg-part-list" role="tablist" aria-label="选择教程篇目" aria-orientation="vertical">
          <button v-for="(part, index) in parts" :id="`part-tab-${index}`" :key="part.prefix" type="button"
            role="tab" :aria-selected="selected === index" aria-controls="chapter-list" :tabindex="selected === index ? 0 : -1"
            :class="{ 'is-active': selected === index }" @click="selected = index" @keydown="onPartKey($event, index)">
            <span class="hg-part-number">{{ String(index).padStart(2, '0') }}</span><UiIcon :name="icons[index]" :size="26" />
            <span class="hg-part-name">{{ part.title }}<small>{{ descriptions[index] }}</small></span><UiIcon class="hg-part-arrow" name="chevron" :size="16" />
          </button>
        </div>
        <a class="hg-environment-link" :href="withBase('/part0-intro/chapter1/')">准备实验环境 <UiIcon name="arrow" :size="18" /></a>
      </div>
      <div id="chapter-list" class="hg-chapter-list" role="tabpanel" :aria-labelledby="`part-tab-${selected}`" tabindex="0">
        <div class="hg-directory-visual" aria-hidden="true"><img :src="withBase('/images/ui/gpu-directory.webp')" alt="" width="535" height="209" loading="lazy"></div>
        <div class="hg-chapter-list-heading"><p>第 {{ selected }} 篇 <span>/</span> {{ current.title }}</p><span>{{ descriptions[selected] }}</span></div>
        <a v-for="chapter in currentChapters" :key="chapter.path" class="hg-chapter-row" :href="withBase(chapter.path)">
          <span class="hg-chapter-number">{{ String(chapter.number).padStart(2, '0') }}</span>
          <span class="hg-chapter-title">{{ chapter.title }}<small>{{ operators[chapter.number] || chapter.summary }}</small></span>
          <span v-if="selected === 2" class="hg-language-tags"><span>HIP</span><span>Triton</span></span><UiIcon name="arrow" :size="22" />
        </a>
        <a v-if="selected === 2" class="hg-part-reading" :href="withBase('/part2-kernels/')">本篇读法与实验说明 <UiIcon name="arrow" :size="17" /></a>
      </div>
    </div>
    <p v-if="!embedded" class="hg-curriculum-baseline">实验基线：Radeon RX 9070 XT <span>·</span> ROCm 7.13 <span>·</span> 原生 Ubuntu 24.04</p>
  </section>
</template>

<style scoped>
.hg-curriculum {
  max-width: 1680px;
  margin: auto;
  padding: 64px max(40px, 4.8vw) 34px;
}

.hg-curriculum.is-embedded {
  padding-top: 90px;
  padding-bottom: 76px;
}

.hg-curriculum-layout {
  display: grid;
  grid-template-columns: minmax(270px, .95fr) minmax(0, 2fr);
  gap: 44px;
}

.hg-eyebrow {
  margin: 0 0 22px;
  font-size: 11px;
  letter-spacing: .18em;
  color: var(--vp-c-text-3);
}

h1,h2 {
  font-size: clamp(35px, 4.05vw, 64px);
  line-height: 1.43;
  letter-spacing: -.045em;
  font-weight: 650;
  margin: 0;
}

.hg-chapter-count {
  color: var(--vp-c-text-2);
  font-size: 21px;
  margin: 17px 0 36px;
  letter-spacing: .05em;
}

.hg-chapter-count span {
  padding: 0 10px;
}

.hg-part-list {
  display: flex;
  flex-direction: column;
}

.hg-part-list button {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 24px;
  text-align: left;
  border: 0;
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 14px 12px 14px 0;
  cursor: pointer;
  color: var(--vp-c-text-2);
  background: transparent;
  transition: background .18s, color .18s;
  position: relative;
}

.hg-part-list button::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 -12px;
  width: 3px;
  background: transparent;
}

.hg-part-list button.is-active::before {
  background: var(--vp-c-brand-1);
}

.hg-part-list button.is-active {
  background: linear-gradient(90deg, var(--vp-c-brand-soft), transparent);
  color: var(--vp-c-text-1);
}

.hg-part-list button:hover {
  color: var(--vp-c-brand-1);
}

.hg-part-number {
  font: 14px var(--vp-font-family-mono);
  color: var(--vp-c-text-2);
  flex: 0 0 27px;
}

.hg-part-name {
  font-size: clamp(16px, 1.35vw, 22px);
  line-height: 1.6;
}

.is-active .hg-part-name {
  font-weight: 600;
}

.hg-part-name small,.hg-part-list svg {
  display: none;
}

.hg-environment-link {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-top: 34px;
}

.hg-environment-link:hover {
  color: var(--vp-c-brand-1);
}

.hg-chapter-list {
  position: relative;
  min-width: 0;
  padding: 105px 0 0 40px;
  border-left: 1px solid var(--vp-c-divider);
}

.hg-directory-visual {
  position: absolute;
  width: 65%;
  height: 195px;
  top: -48px;
  right: -10px;
  pointer-events: none;
  opacity: .72;
  mask-image: linear-gradient(180deg, transparent, #000 18%, #000 65%, transparent);
}

.hg-directory-visual img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  mask-image: linear-gradient(90deg, transparent, #000 22%, #000 80%, transparent);
}

.hg-chapter-list-heading {
  position: relative;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.hg-chapter-list-heading p {
  margin: 0 0 9px;
  font-size: 13px;
  letter-spacing: .12em;
  color: var(--vp-c-text-2);
}

.hg-chapter-list-heading p span {
  margin: 0 9px;
}

.hg-chapter-list-heading > span {
  font-size: 15px;
  color: var(--vp-c-text-2);
}

.hg-chapter-row {
  display: flex;
  gap: 25px;
  align-items: center;
  min-height: 85px;
  padding: 15px 12px 15px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  transition: background .18s, color .18s;
}

.hg-chapter-row:hover {
  background: var(--vp-c-brand-soft);
}

.hg-chapter-number {
  font: 19px var(--vp-font-family-mono);
  min-width: 37px;
  border-right: 1px solid var(--vp-c-divider);
  padding-right: 20px;
}

.hg-chapter-title {
  flex: 1;
  min-width: 0;
  font-size: clamp(16px, 1.35vw, 23px);
  letter-spacing: -.02em;
  line-height: 1.45;
}

.hg-chapter-title small {
  display: block;
  color: var(--vp-c-text-2);
  font: 13px/1.6 var(--vp-font-family-mono);
  margin-top: 3px;
  letter-spacing: .015em;
}

.hg-language-tags {
  display: flex;
  gap: 14px;
  margin-right: 35px;
}

.hg-language-tags span {
  padding: 1px 12px;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  font: 11px/1.6 var(--vp-font-family-mono);
}

.hg-chapter-row > svg {
  flex: none;
}

.hg-part-reading {
  display: inline-flex;
  gap: 14px;
  align-items: center;
  margin-top: 25px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.hg-curriculum-baseline {
  margin: 55px 0 0;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 24px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.hg-curriculum-baseline span {
  padding: 0 8px;
}

.mobile-heading {
  display: none;
}

@media (max-width: 1199px) {
  .hg-language-tags {
    margin-right: 0;
    gap: 5px;
  }
  .hg-language-tags span {
    padding: 1px 5px;
  }
  .hg-curriculum-layout {
    gap: 27px;
    grid-template-columns: minmax(235px, .9fr) minmax(0, 1.6fr);
  }
  .hg-chapter-list {
    padding-left: 27px;
  }
  .hg-chapter-row {
    gap: 14px;
  }
}

@media (max-width: 767px) {
  .hg-curriculum, .hg-curriculum.is-embedded {
    padding: 31px 23px 36px;
  }
  .hg-curriculum-layout {
    display: block;
  }
  .hg-eyebrow {
    display: none;
  }
  h1,h2 {
    font-size: clamp(24px, 6.4vw, 31px);
    line-height: 1.45;
    letter-spacing: -.035em;
  }
  .desktop-heading {
    display: none;
  }
  .mobile-heading {
    display: inline;
  }
  .mobile-heading br {
    display: none;
  }
  .hg-chapter-count {
    font-size: 14px;
    margin: 10px 0 23px;
  }
  .hg-part-list {
    gap: 6px;
  }
  .hg-part-list button {
    padding: 14px 12px;
    min-height: 70px;
    border: 1px solid var(--vp-c-divider);
    border-radius: 5px;
    gap: 14px;
  }
  .hg-part-list button::before {
    display: none;
  }
  .hg-part-list button.is-active {
    border-color: var(--hg-line-strong);
    background: var(--vp-c-brand-soft);
  }
  .hg-part-list svg {
    display: block;
    flex: none;
    color: var(--vp-c-brand-1);
  }
  .hg-part-number {
    font-size: 12px;
    flex-basis: 30px;
    border-right: 1px solid var(--vp-c-divider);
    padding-right: 10px;
  }
  .hg-part-name {
    font-size: 15px;
    flex: 1;
  }
  .hg-part-name small {
    display: block;
    font-size: 11px;
    line-height: 1.5;
    font-weight: 400;
    color: var(--vp-c-text-2);
  }
  .hg-part-arrow {
    width: 14px;
  }
  .hg-environment-link {
    margin: 22px 0;
    font-size: 12px;
  }
  .hg-chapter-list {
    margin-top: 12px;
    padding: 20px 0 0;
    border-left: none;
  }
  .hg-directory-visual {
    display: none;
  }
  .hg-chapter-list-heading {
    padding-bottom: 17px;
  }
  .hg-chapter-list-heading p {
    letter-spacing: 0;
    font-size: 12px;
  }
  .hg-chapter-list-heading > span {
    font-size: 13px;
  }
  .hg-chapter-row {
    min-height: 80px;
    gap: 13px;
    padding: 14px 0;
  }
  .hg-chapter-number {
    font-size: 15px;
    min-width: 32px;
    padding-right: 12px;
  }
  .hg-chapter-title {
    font-size: 16px;
  }
  .hg-chapter-title small {
    font-size: 11px;
  }
  .hg-language-tags {
    display: none;
  }
  .hg-chapter-row > svg {
    width: 18px;
  }
  .hg-curriculum-baseline {
    font-size: 10px;
    line-height: 1.9;
    margin-top: 30px;
  }
}
</style>
