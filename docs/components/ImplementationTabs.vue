<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps<{ id: string }>()
type Language = 'hip' | 'triton'
type Bookmark = { element: HTMLElement; fraction: number; gap: number }
const selected = ref<Language>('hip')
const root = ref<HTMLElement>()
const toolbar = ref<HTMLElement>()
const announcement = ref('')
const languages: Language[] = ['hip', 'triton']
const storageKey = 'hello-gpu-implementation'
// Keep DOM anchors, rather than page offsets, so code wrapping and opened details
// above the current paragraph do not invalidate a language's reading position.
const bookmarks: Partial<Record<Language, Bookmark>> = {}
let transition: Animation | undefined
let revision = 0
let mounted = false

function panel(language: Language) {
  return root.value?.querySelector<HTMLElement>(`[data-implementation="${language}"]`)
}

function stickyTop() {
  return toolbar.value ? parseFloat(getComputedStyle(toolbar.value).top) || 0 : 0
}

function hashTarget() {
  try { return document.getElementById(decodeURIComponent(location.hash.slice(1))) }
  catch { return null }
}

function rememberPosition(language: Language) {
  const content = panel(language)
  if (!content || !toolbar.value || !root.value) return
  if (root.value.getBoundingClientRect().top >= stickyTop() - 1) {
    delete bookmarks[language]
    return
  }
  const readingLine = toolbar.value.getBoundingClientRect().bottom + 16
  const blocks = Array.from(content.children).filter((node): node is HTMLElement =>
    node instanceof HTMLElement && node.getBoundingClientRect().height > 0
  )
  const element = blocks.find(node => node.getBoundingClientRect().bottom > readingLine)
  if (!element) return
  const bounds = element.getBoundingClientRect()
  bookmarks[language] = {
    element,
    fraction: Math.max(0, Math.min(1, (readingLine - bounds.top) / bounds.height)),
    gap: Math.max(0, bounds.top - readingLine),
  }
}

function moveToBeginning(smooth = false) {
  if (!root.value) return
  const top = window.scrollY + root.value.getBoundingClientRect().top - stickyTop()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top, behavior: smooth && !reduceMotion ? 'smooth' : 'instant' })
}

function restorePosition(language: Language, wasPinned: boolean, previousScroll: number) {
  const bookmark = bookmarks[language]
  if (bookmark && panel(language)?.contains(bookmark.element) && toolbar.value) {
    const bounds = bookmark.element.getBoundingClientRect()
    const readingLine = stickyTop() + toolbar.value.offsetHeight + 16
    window.scrollTo({
      top: window.scrollY + bounds.top + bounds.height * bookmark.fraction - bookmark.gap - readingLine,
      behavior: 'instant',
    })
  } else if (wasPinned) {
    moveToBeginning()
  } else {
    // A switch near the beginning should leave the toolbar exactly where it was.
    window.scrollTo({ top: previousScroll, behavior: 'instant' })
  }
}

function animateContent(language: Language) {
  transition?.cancel()
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  transition = panel(language)?.animate(
    [{ opacity: 0.65, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 160, easing: 'ease-out' },
  )
}

async function select(language: Language, focus = false, fromLink = false) {
  if (language === selected.value) return
  const currentRevision = ++revision
  transition?.cancel()
  const outgoing = panel(selected.value)
  const updateHash = !fromLink && outgoing?.contains(hashTarget())
  const previousScroll = window.scrollY
  const wasPinned = !!root.value && root.value.getBoundingClientRect().top < stickyTop() - 1
  rememberPosition(selected.value)
  selected.value = language
  try { sessionStorage.setItem(storageKey, language) } catch { /* Preference is optional. */ }
  await nextTick()
  if (!mounted || currentRevision !== revision) return
  if (!fromLink) restorePosition(language, wasPinned, previousScroll)
  if (updateHash) {
    // Replace, rather than push: tab clicks should not fill browser history.
    // A reload must never reveal the old language through a stale heading hash.
    const url = new URL(location.href)
    url.hash = `${props.id}-${language}-panel`
    history.replaceState(history.state, '', url)
  }
  if (focus) root.value?.querySelector<HTMLButtonElement>(`#${props.id}-${language}-tab`)?.focus({ preventScroll: true })
  animateContent(language)
  announcement.value = `已切换到 ${language === 'hip' ? 'HIP' : 'Triton'}${fromLink ? '' : bookmarks[language] ? '，继续上次阅读位置' : '，从本节开头阅读'}`
}

async function revealHash() {
  const target = hashTarget()
  if (!target || !root.value?.contains(target)) return
  const language = target.closest<HTMLElement>('[data-implementation]')?.dataset.implementation as Language | undefined
  if (!language || language === selected.value) return
  await select(language, false, true)
  if (!mounted || !root.value?.contains(target) || selected.value !== language || hashTarget() !== target) return
  target.scrollIntoView({ block: 'start', behavior: 'instant' })
}

function onKey(event: KeyboardEvent, language: Language) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 'hip' : event.key === 'End' ? 'triton' : language === 'hip' ? 'triton' : 'hip'
  select(next, true)
}

onMounted(async () => {
  mounted = true
  try {
    const saved = sessionStorage.getItem(storageKey)
    if (saved === 'hip' || saved === 'triton') selected.value = saved
  } catch { /* Both routes work without storage. */ }
  await nextTick()
  if (!mounted) return
  await revealHash()
  if (!mounted) return
  window.addEventListener('hashchange', revealHash)
})
onUnmounted(() => {
  mounted = false
  revision++
  transition?.cancel()
  window.removeEventListener('hashchange', revealHash)
})
</script>

<template>
  <section :id="id" ref="root" class="implementation-tabs" aria-label="选择实现语言">
    <div ref="toolbar" class="implementation-toolbar">
      <div class="implementation-tabbar" role="tablist" aria-label="实现语言" :data-selected="selected">
        <span class="implementation-indicator" aria-hidden="true" />
        <button v-for="language in languages" :id="`${id}-${language}-tab`" :key="language"
          type="button" role="tab" :aria-selected="selected === language"
          :aria-controls="`${id}-${language}-panel`" :tabindex="selected === language ? 0 : -1"
          @click="select(language)" @keydown="onKey($event, language)">
          <span class="implementation-language">{{ language === 'hip' ? 'HIP' : 'Triton' }}</span>
          <span class="implementation-caption">{{ language === 'hip' ? '线程与协作' : '数据块与操作' }}</span>
        </button>
      </div>
      <div class="implementation-context">
        <span>切换会保留各自的阅读位置</span>
        <button type="button" class="implementation-start" @click="moveToBeginning(true)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h8M8 13V6m-3 3 3-3 3 3" /></svg>
          从头阅读
        </button>
      </div>
    </div>
    <div :id="`${id}-hip-panel`" v-show="selected === 'hip'" role="tabpanel" data-implementation="hip"
      :aria-labelledby="`${id}-hip-tab`" tabindex="0" class="implementation-panel"><slot name="hip" /></div>
    <div :id="`${id}-triton-panel`" v-show="selected === 'triton'" role="tabpanel" data-implementation="triton"
      :aria-labelledby="`${id}-triton-tab`" tabindex="0" class="implementation-panel"><slot name="triton" /></div>
    <span class="implementation-announcement" role="status">{{ announcement }}</span>
  </section>
</template>

<style scoped>
.implementation-tabs {
  --implementation-sticky-top: calc(var(--vp-layout-top-height, 0px) + var(--vp-nav-height, 64px));
  margin: 30px 0 36px;
  min-width: 0;
  overflow-anchor: none;
  scroll-margin-top: var(--implementation-sticky-top);
}
.implementation-toolbar {
  position: sticky;
  top: var(--implementation-sticky-top);
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 64px;
  padding: 8px 0 0;
  background: var(--vp-c-bg);
  border-bottom: 1px solid var(--vp-c-divider);
}
.implementation-tabbar {
  display: grid;
  grid-template-columns: 96px 96px;
  position: relative;
  flex: none;
}
.implementation-indicator {
  position: absolute;
  inset: auto auto -1px 0;
  width: 96px;
  height: 3px;
  border-radius: 2px;
  background: var(--vp-c-brand-1);
  transition: transform 180ms cubic-bezier(.2,.7,.2,1);
  pointer-events: none;
}
.implementation-tabbar[data-selected='triton'] .implementation-indicator { transform: translateX(100%); }
.implementation-tabbar > button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 54px;
  padding: 12px 18px;
  border: 0;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 160ms ease;
}
.implementation-tabbar > button:hover { color: var(--vp-c-text-1); }
.implementation-tabbar > button[aria-selected='true'] { color: var(--vp-c-brand-1); }
.implementation-language { font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
.implementation-caption { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.implementation-context { display: flex; align-items: center; justify-content: flex-end; gap: 20px; color: var(--vp-c-text-3); font-size: 11px; line-height: 1.5; }
.implementation-start { display: inline-flex; align-items: center; gap: 6px; padding: 8px 0; white-space: nowrap; color: var(--vp-c-text-2); cursor: pointer; font-size: 12px; }
.implementation-start:hover { color: var(--vp-c-brand-1); }
.implementation-start svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.implementation-tabbar button:focus-visible, .implementation-start:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: -3px; border-radius: 3px; }
.implementation-panel { padding: 10px 0 12px; min-width: 0; scroll-margin-top: calc(var(--implementation-sticky-top) + 88px); }
.implementation-panel :deep(h3), .implementation-panel :deep(h4),
.implementation-panel :deep(.figure), .implementation-panel :deep(.ej) { scroll-margin-top: calc(var(--implementation-sticky-top) + 88px); }
.implementation-panel:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 4px; }
.implementation-announcement { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (min-width: 960px) and (max-width: 1279px) { .implementation-tabs { --implementation-sticky-top: calc(var(--vp-layout-top-height, 0px) + var(--vp-nav-height, 64px) + 48px); } }
@media (max-width: 959px) { .implementation-tabs { --implementation-sticky-top: calc(var(--vp-layout-top-height, 0px) + 58px); } }
@media (max-width: 640px) {
  .implementation-toolbar { gap: 12px; min-height: 58px; padding-top: 4px; }
  .implementation-tabbar { grid-template-columns: 76px 76px; }
  .implementation-indicator { width: 76px; }
  .implementation-tabbar > button { min-height: 52px; padding: 12px; }
  .implementation-language { font-size: 15px; }
  .implementation-context > span { display: none; }
  .implementation-start { font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) { .implementation-indicator, .implementation-tabbar > button { transition: none; } }
@media print {
  .implementation-toolbar, .implementation-announcement { display: none; }
  .implementation-panel { display: block !important; opacity: 1 !important; transform: none !important; }
}
</style>
