<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import UiIcon from './UiIcon.vue'
import { contributors, contributorsUrl, contributeUrl } from './contributors'

const rail = ref<HTMLUListElement>()
const canScroll = ref(false)
const atStart = ref(true)
const atEnd = ref(false)
let observer: ResizeObserver | undefined

function updateScrollState() {
  const el = rail.value
  if (!el) return
  canScroll.value = el.scrollWidth > el.clientWidth + 2
  atStart.value = el.scrollLeft < 2
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
}

function scrollCards(direction: number) {
  const el = rail.value
  if (!el) return
  const card = el.querySelector('li')
  const step = (card?.getBoundingClientRect().width ?? el.clientWidth) + 20
  el.scrollBy({
    left: direction * step,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
}

function onKeydown(event: KeyboardEvent) {
  if (event.target !== rail.value) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    scrollCards(event.key === 'ArrowRight' ? 1 : -1)
  }
}

onMounted(async () => {
  await nextTick()
  updateScrollState()
  observer = new ResizeObserver(updateScrollState)
  if (rail.value) observer.observe(rail.value)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <section class="hg-contributors" aria-labelledby="hg-contributors-title">
    <div class="hg-contributors-inner">
      <header class="hg-contributors-heading">
        <div>
          <p class="hg-contributors-eyebrow">社区共建</p>
          <h2 id="hg-contributors-title">一起，把 GPU 讲清楚。</h2>
          <p class="hg-contributors-intro">由 Datawhale 社区发起，与每一位贡献者共同完善。</p>
        </div>
        <a class="hg-contributors-all" :href="contributorsUrl" target="_blank" rel="noreferrer">
          查看全部贡献 <UiIcon name="arrow" :size="18" />
        </a>
      </header>

      <ul id="hg-contributors-rail" ref="rail" class="hg-contributors-rail" aria-label="项目贡献者"
        :tabindex="canScroll ? 0 : undefined" @scroll.passive="updateScrollState" @keydown="onKeydown">
        <li v-for="person in contributors" :key="person.login" class="hg-contributor-card">
          <a :href="person.url" target="_blank" rel="noreferrer" class="hg-contributor-link"
            :aria-label="`${person.name}，${person.role}，查看 GitHub 主页（新窗口）`">
            <div class="hg-contributor-top">
              <img :src="withBase(person.avatar)" alt="" width="88" height="88" loading="lazy" decoding="async" />
              <span class="hg-contributor-arrow"><UiIcon name="arrow" :size="18" /></span>
            </div>
            <div class="hg-contributor-identity">
              <h3>{{ person.name }}</h3>
              <p class="hg-contributor-handle">@{{ person.login }}</p>
            </div>
            <div class="hg-contributor-role">
              <span>{{ person.role }}</span>
              <span v-if="person.affiliation" class="hg-contributor-affiliation">{{ person.affiliation }}</span>
            </div>
          </a>
        </li>
      </ul>

      <footer class="hg-contributors-footer">
        <p>每一次纠错、复现与分享，都让下一位读者少走一步弯路。</p>
        <div class="hg-contributors-actions">
          <a :href="contributeUrl" target="_blank" rel="noreferrer" class="hg-contributors-join">
            参与贡献 <UiIcon name="arrow" :size="18" />
          </a>
          <div v-if="canScroll" class="hg-contributors-controls" aria-label="浏览贡献者">
            <button type="button" aria-label="上一位贡献者" aria-controls="hg-contributors-rail" :disabled="atStart" @click="scrollCards(-1)">
              <UiIcon name="chevron" :size="18" class="hg-contributors-prev" />
            </button>
            <button type="button" aria-label="下一位贡献者" aria-controls="hg-contributors-rail" :disabled="atEnd" @click="scrollCards(1)">
              <UiIcon name="chevron" :size="18" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  </section>
</template>

<style scoped>
.hg-contributors {
  --contributor-card-bg: var(--vp-c-bg-soft);
  --contributor-card-hover: var(--vp-c-bg-elv);
  --contributor-card-line: var(--vp-c-divider);
  background: var(--vp-c-bg, #fff);
  color: var(--vp-c-text-1);
  padding: clamp(80px, 9vw, 144px) 48px 96px;
}


.hg-contributors-inner {
  max-width: 1360px;
  margin: 0 auto;
}

.hg-contributors-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 32px;
  margin-bottom: 40px;
}

.hg-contributors-eyebrow {
  margin: 0 0 18px;
  color: var(--vp-c-text-3);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: .08em;
}

.hg-contributors h2 {
  margin: 0;
  font-size: clamp(30px, 3.3vw, 48px);
  font-weight: 600;
  letter-spacing: -.04em;
  line-height: 1.2;
}

.hg-contributors-intro {
  margin: 20px 0 0;
  font-size: 16px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}

.hg-contributors-all, .hg-contributors-join {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  white-space: nowrap;
  text-decoration: none;
}

.hg-contributors-all {
  padding-bottom: 5px;
}

.hg-contributors-all svg, .hg-contributors-join svg {
  transition: transform 180ms ease;
}

.hg-contributors-all:hover svg, .hg-contributors-join:hover svg {
  transform: translateX(3px);
}

.hg-contributors-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 20px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.hg-contributor-card {
  min-width: 0;
  border: 1px solid var(--contributor-card-line);
  border-radius: 24px;
  background: var(--contributor-card-bg);
  transition: background 200ms ease, transform 200ms ease;
}

.hg-contributor-card:hover {
  background: var(--contributor-card-hover);
  transform: translateY(-4px);
}

.hg-contributor-link {
  min-height: 304px;
  height: 100%;
  padding: 30px;
  display: flex;
  flex-direction: column;
  color: inherit;
  text-decoration: none;
  border-radius: inherit;
}

.hg-contributor-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.hg-contributor-top img {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: 50%;
  background: var(--vp-c-bg);
  border: 1px solid var(--contributor-card-line);
}

.hg-contributor-arrow {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--vp-c-text-3);
  transition: background 180ms ease, color 180ms ease;
}

.hg-contributor-card:hover .hg-contributor-arrow {
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
}

.hg-contributor-identity {
  margin-top: 26px;
}

.hg-contributor-identity h3 {
  margin: 0;
  font-size: 23px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -.025em;
  overflow-wrap: anywhere;
}

.hg-contributor-handle {
  margin: 6px 0 0;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.hg-contributor-role {
  margin-top: auto;
  padding-top: 24px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.5;
}

.hg-contributor-affiliation {
  color: var(--vp-c-text-3);
}

.hg-contributors-footer {
  margin-top: 30px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
}

.hg-contributors-footer > p {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--vp-c-text-3);
}

.hg-contributors-actions, .hg-contributors-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hg-contributors-actions {
  gap: 24px;
}

.hg-contributors-controls button {
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--contributor-card-bg);
  color: var(--vp-c-text-1);
  width: 36px;
  height: 36px;
  cursor: pointer;
}

.hg-contributors-controls button:disabled {
  opacity: .35;
  cursor: default;
}

.hg-contributors-prev {
  transform: rotate(180deg);
}

.hg-contributors a:focus-visible, .hg-contributors button:focus-visible, .hg-contributors-rail:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 5px;
}

@media (max-width: 1100px) {
  .hg-contributors {
    padding-left: 32px;
    padding-right: 32px;
  }
  .hg-contributors-rail {
    gap: 16px;
  }
  .hg-contributor-link {
    padding: 24px;
  }
  .hg-contributor-top img {
    width: 76px;
    height: 76px;
  }
  .hg-contributor-identity h3 {
    font-size: 21px;
  }
}

@media (max-width: 850px) {
  .hg-contributors-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px;
  }
  .hg-contributor-link {
    min-height: 292px;
    padding: 28px;
  }
  .hg-contributors-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 20px;
  }
}

@media (max-width: 600px) {
  .hg-contributors {
    padding: 76px 24px 68px;
    overflow: hidden;
  }
  .hg-contributors h2 {
    font-size: 32px;
    max-width: 320px;
  }
  .hg-contributors-eyebrow {
    margin-bottom: 14px;
    font-size: 12px;
  }
  .hg-contributors-intro {
    margin-top: 16px;
    max-width: 300px;
    font-size: 14px;
  }
  .hg-contributors-heading {
    margin-bottom: 30px;
  }
  .hg-contributors-rail {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: min(78vw, 300px);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scroll-padding-left: 24px;
    gap: 20px;
    margin: 0 -24px;
    padding: 6px 24px 14px;
    scrollbar-width: none;
  }
  .hg-contributors-rail::-webkit-scrollbar {
    display: none;
  }
  .hg-contributor-card {
    scroll-snap-align: start;
  }
  .hg-contributor-link {
    min-height: 310px;
    padding: 28px;
  }
  .hg-contributor-top img {
    width: 88px;
    height: 88px;
  }
  .hg-contributor-identity h3 {
    font-size: 24px;
  }
  .hg-contributors-footer {
    margin-top: 16px;
    flex-direction: column;
    align-items: stretch;
    gap: 22px;
  }
  .hg-contributors-footer > p {
    max-width: 300px;
    font-size: 12px;
  }
  .hg-contributors-actions {
    justify-content: space-between;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hg-contributors *, .hg-contributors *::before {
    transition: none;
  }
  .hg-contributor-card:hover, .hg-contributors-all:hover svg, .hg-contributors-join:hover svg {
    transform: none;
  }
}
</style>
