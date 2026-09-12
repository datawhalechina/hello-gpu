<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import UiIcon from './UiIcon.vue'

const root = ref<HTMLElement>()
const enhanced = ref(false)
const active = ref(0)
const steps = [
  { name: '理解', title: '看懂一次计算，\n怎样在 GPU 上发生。', text: '从线程、wavefront 到片上存储，跟着一个元素的旅程，把抽象的硬件概念变成看得见的过程。', link: '/part0-intro/chapter2/', action: '走进 GPU 的工作方式' },
  { name: '测量', title: '先找到瓶颈，\n再谈优化。', text: '学会可信计时、读懂 kernel trace 和 Roofline。让每一次修改，都有测量和证据作为起点。', link: '/part1-profiling/chapter5/', action: '建立第一个可信基准' },
  { name: '优化', title: '把理解，\n写进每一个 Kernel。', text: '从逐元素计算到归约、矩阵乘与融合，用 HIP 或 Triton 实现同一个算子，逐步理解性能取舍。', link: '/part2-kernels/chapter8/', action: '开始经典算子实战' },
  { name: '自动化', title: '让每次尝试，\n成为下一次的起点。', text: '把编译、测量和分析封装成工具，让 Agent 在可验证的反馈中迭代，留下能回看的优化轨迹。', link: '/part3-agent/chapter14/', action: '搭建算子优化 Agent' },
]
let frame = 0
let media: MediaQueryList | undefined
let observer: IntersectionObserver | undefined
let visible = false

function update() {
  frame = 0
  if (!root.value || !enhanced.value) return
  const box = root.value.getBoundingClientRect()
  const top = parseFloat(getComputedStyle(root.value).getPropertyValue('--story-top')) || 92
  const travel = Math.max(1, box.height - window.innerHeight + top)
  const progress = Math.max(0, Math.min(1, (top - box.top) / travel))
  root.value.style.setProperty('--story-progress', progress.toFixed(4))
  active.value = Math.min(steps.length - 1, Math.floor(progress * steps.length))
}

function schedule() {
  if (visible && !frame) frame = requestAnimationFrame(update)
}

function configure() {
  enhanced.value = !!media?.matches
  requestAnimationFrame(update)
}

function goTo(index: number) {
  if (!root.value || !enhanced.value) return
  const box = root.value.getBoundingClientRect()
  const top = parseFloat(getComputedStyle(root.value).getPropertyValue('--story-top')) || 92
  const travel = box.height - window.innerHeight + top
  window.scrollTo({ top: window.scrollY + box.top - top + travel * (index + .35) / steps.length, behavior: 'smooth' })
}

onMounted(() => {
  media = window.matchMedia('(min-width: 960px) and (min-height: 760px) and (prefers-reduced-motion: no-preference)')
  media.addEventListener('change', configure)
  configure()
  observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) schedule() }, { rootMargin: '150px' })
  if (root.value) observer.observe(root.value)
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  media?.removeEventListener('change', configure)
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
})
</script>

<template>
  <section id="home-story" ref="root" class="hg-story" :class="{ 'is-enhanced': enhanced }" aria-labelledby="story-title">
    <div class="hg-story-sticky">
      <header class="hg-story-heading">
        <p>HELLO-GPU · 从理解到优化</p>
        <h2 id="story-title">每一步，都离硬件更近。</h2>
      </header>
      <div class="hg-story-body">
        <figure class="hg-story-art" aria-hidden="true">
          <img :src="withBase('/images/ui/hello-gpu-chip.png')" width="1254" height="1254" alt="" loading="lazy" decoding="async">
        </figure>
        <div class="hg-story-content">
          <article v-for="(step, index) in steps" :key="step.name" :class="{ 'is-active': active === index }"
            :aria-hidden="enhanced && active !== index ? true : undefined" :inert="enhanced && active !== index ? true : undefined">
            <p class="hg-story-number"><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ step.name }}</p>
            <h3>{{ step.title }}</h3>
            <p class="hg-story-description">{{ step.text }}</p>
            <a :href="withBase(step.link)">{{ step.action }} <UiIcon name="arrow" :size="20" /></a>
          </article>
        </div>
      </div>
      <nav v-if="enhanced" class="hg-story-navigation" aria-label="探索学习过程">
        <button v-for="(step, index) in steps" :key="step.name" :class="{ 'is-active': active === index }"
          :aria-current="active === index ? 'step' : undefined" @click="goTo(index)">
          <span>{{ String(index + 1).padStart(2, '0') }}</span>{{ step.name }}<i aria-hidden="true" />
        </button>
      </nav>
      <a class="hg-story-skip" href="#home-curriculum">查看完整学习路线 <UiIcon name="arrow" :size="17" /></a>
    </div>
  </section>
</template>

<style scoped>
.hg-story {
  --story-top: 92px;
  --story-progress: 0;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-divider);
  scroll-margin-top: 92px;
}

.hg-story-sticky {
  max-width: 1500px;
  margin: auto;
  padding: 90px 64px 48px;
}

.hg-story-heading p {
  margin: 0 0 18px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .12em;
  color: var(--vp-c-text-3);
}

.hg-story-heading h2 {
  font-size: clamp(32px, 3.3vw, 52px);
  line-height: 1.25;
  letter-spacing: -.04em;
  font-weight: 600;
  margin: 0;
}

.hg-story-body {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 64px;
  align-items: center;
}

.hg-story-art {
  pointer-events: none;
  margin: 0;
  width: 100%;
}

.hg-story-art img {
  display: block;
  width: 100%;
  height: auto;
}

.hg-story-content {
  min-width: 0;
}

.hg-story-content article {
  padding: 38px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.hg-story-number {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 15px;
  color: var(--vp-c-brand-1);
  margin: 0 0 20px;
}

.hg-story-number span {
  font: 12px var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.hg-story-content h3 {
  font-size: clamp(29px, 2.7vw, 43px);
  line-height: 1.35;
  font-weight: 600;
  letter-spacing: -.04em;
  white-space: pre-line;
  margin: 0;
}

.hg-story-description {
  color: var(--vp-c-text-2);
  font-size: 17px;
  line-height: 1.85;
  max-width: 440px;
  margin: 26px 0;
}

.hg-story-content a {
  display: inline-flex;
  align-items: center;
  gap: 18px;
  font-size: 15px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.hg-story-content a:hover svg {
  transform: translateX(4px);
}

.hg-story-content a svg {
  transition: transform .2s;
}

.hg-story-skip {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 15px;
  margin: 25px 0 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
}

.is-enhanced {
  height: 270svh;
}

.is-enhanced .hg-story-sticky {
  position: sticky;
  top: var(--story-top);
  height: calc(100svh - var(--story-top));
  min-height: 540px;
  display: flex;
  flex-direction: column;
  padding-top: 42px;
  padding-bottom: 24px;
}

.is-enhanced .hg-story-body {
  flex: 1;
  min-height: 0;
}

.is-enhanced .hg-story-art {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
}

.is-enhanced .hg-story-art img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  object-fit: contain;
  transform: translate3d(0, calc((.5 - var(--story-progress)) * 38px), 0) rotate(calc(-5deg + var(--story-progress) * 10deg)) scale(calc(.92 + var(--story-progress) * .14));
}

.is-enhanced .hg-story-content {
  display: grid;
  align-items: center;
}

.is-enhanced .hg-story-content article {
  grid-area: 1 / 1;
  padding: 25px 0;
  border: 0;
  opacity: 0;
  transform: translateY(22px);
  transition: opacity .35s, transform .45s;
  pointer-events: none;
}

.is-enhanced .hg-story-content article.is-active {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.hg-story-navigation {
  display: flex;
  justify-content: center;
  gap: 45px;
  margin-top: 10px;
}

.hg-story-navigation button {
  display: flex;
  align-items: center;
  gap: 13px;
  border: 0;
  padding: 12px 0;
  color: var(--vp-c-text-3);
  font-size: 14px;
  cursor: pointer;
  background: transparent;
}

.hg-story-navigation button > span {
  font: 10px var(--vp-font-family-mono);
}

.hg-story-navigation button i {
  display: block;
  width: 42px;
  height: 2px;
  background: var(--vp-c-divider);
  border-radius: 2px;
}

.hg-story-navigation button.is-active {
  color: var(--vp-c-text-1);
}

.hg-story-navigation button.is-active i {
  background: var(--vp-c-brand-1);
}

@media (max-width: 1199px) {
  .hg-story-sticky {
    padding-left: 40px;
    padding-right: 40px;
  }
  .hg-story-body {
    gap: 28px;
  }
  .hg-story-description {
    font-size: 15px;
  }
  .hg-story-navigation {
    gap: 28px;
  }
}

@media (max-width: 959px) {
  .hg-story-sticky {
    padding: 70px 30px 40px;
  }
  .hg-story-art {
    display: none;
  }
  .hg-story-body {
    display: block;
  }
  .hg-story-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px 40px;
  }
  .hg-story-content article {
    padding: 38px 0 30px;
  }
  .hg-story-content h3 {
    font-size: 27px;
  }
  .hg-story-description {
    font-size: 15px;
    margin: 20px 0;
  }
  .hg-story-content a {
    font-size: 13px;
  }
}

@media (max-width: 600px) {
  .hg-story-sticky {
    padding: 60px 23px 32px;
  }
  .hg-story-heading h2 {
    font-size: 30px;
  }
  .hg-story-heading p {
    font-size: 10px;
  }
  .hg-story-content {
    display: block;
  }
  .hg-story-content article {
    padding: 37px 0;
  }
  .hg-story-content h3 {
    font-size: 29px;
  }
  .hg-story-description {
    font-size: 16px;
  }
  .hg-story-skip {
    margin-top: 22px;
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hg-story-content a svg {
    transition: none;
  }
  .hg-story-content a:hover svg {
    transform: none;
  }
}

@media print {
  .hg-story-art, .hg-story-navigation, .hg-story-skip {
    display: none !important;
  }
  .hg-story.is-enhanced {
    height: auto;
  }
  .hg-story .hg-story-sticky {
    position: static;
    height: auto;
    min-height: 0;
    padding: 0;
    display: block;
  }
  .hg-story .hg-story-body, .hg-story .hg-story-content {
    display: block;
  }
  .hg-story .hg-story-content article {
    opacity: 1;
    transition: none;
    transform: none;
    padding: 24px 0;
    break-inside: avoid;
  }
}
</style>
