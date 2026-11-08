<script setup lang="ts">
import { computed, ref } from 'vue'
import { describe, type LaunchConfig, type LaunchResult, type ThreadStatus } from '../sim/launch.ts'

const props = defineProps<{ result: LaunchResult | null; cfg: LaunchConfig; emptyText?: string }>()

interface Cell {
  block: number
  thread: number
  index: number | null
  status: ThreadStatus | 'error'
}

type Hover = { kind: 'thread'; block: number; thread: number } | { kind: 'elem'; index: number } | null
const hover = ref<Hover>(null)

const ok = computed(() => props.result !== null && props.result.ok)

const blocks = computed(() => {
  const r = props.result
  return Array.from({ length: props.cfg.gridDim }, (_, block) =>
    Array.from({ length: props.cfg.blockDim }, (_, thread): Cell => {
      if (r && r.ok) {
        const t = r.threads[block * props.cfg.blockDim + thread]
        return { block, thread, index: t.index, status: t.status }
      }
      return { block, thread, index: null, status: 'error' }
    }),
  )
})

const elements = computed(() =>
  props.result && props.result.ok ? props.result.elements : Array.from({ length: props.cfg.n }, () => []),
)
const outside = computed(() => (props.result && props.result.ok ? props.result.outside : []))
const summary = computed(() =>
  props.result ? describe(props.result, props.cfg.n) : (props.emptyText ?? '先写出拿数的规则，再点运行。'),
)
const total = computed(() => props.cfg.gridDim * props.cfg.blockDim)

const color = (block: number) => `var(--hg-block-${block % 8})`

function hoveredCell(): Cell | undefined {
  const h = hover.value
  if (!h || h.kind !== 'thread') return undefined
  return blocks.value[h.block]?.[h.thread]
}

function threadLit(c: Cell) {
  const h = hover.value
  if (!h) return false
  if (h.kind === 'thread') return h.block === c.block && h.thread === c.thread
  return c.index === h.index && c.status !== 'skipped'
}

function indexLit(index: number) {
  const h = hover.value
  if (!h) return false
  if (h.kind === 'elem') return h.index === index
  const c = hoveredCell()
  return !!c && c.index === index && c.status !== 'skipped'
}

function threadLabel(c: Cell) {
  const where = `第 ${c.block} 组第 ${c.thread} 个线程`
  if (c.status === 'error' || c.index === null) return `${where}，下标还算不出来`
  if (c.status === 'skipped') return `${where}，下标 ${c.index}，检查后跳过`
  if (c.status === 'oob') return `${where}，下标 ${c.index}，写到了数组外面`
  return `${where}，写入 c[${c.index}]`
}

function elemLabel(i: number) {
  const w = elements.value[i]
  if (!ok.value) return `c[${i}]`
  if (w.length === 0) return `c[${i}]，没人算`
  const who = w.map(x => `第 ${x.block} 组第 ${x.thread} 个`).join('、')
  return `c[${i}]，由${who}线程写入${w.length > 1 ? `，重复了 ${w.length} 次` : ''}`
}
</script>

<template>
  <div class="hgp-grid" @mouseleave="hover = null">
    <div class="row-label">
      派出的线程：{{ cfg.gridDim }} 组 × 每组 {{ cfg.blockDim }} 个 = {{ total }} 个
    </div>
    <div class="blocks">
      <div v-for="(cells, b) in blocks" :key="b" class="block" :style="{ '--blk': color(b) }">
        <div class="block-title">第 {{ b }} 组 <code>blockIdx.x = {{ b }}</code></div>
        <div class="cells">
          <button
            v-for="c in cells"
            :key="c.thread"
            type="button"
            class="thread hgp-focusable"
            :class="[c.status, { lit: threadLit(c) }]"
            :aria-label="threadLabel(c)"
            @mouseenter="hover = { kind: 'thread', block: c.block, thread: c.thread }"
            @focus="hover = { kind: 'thread', block: c.block, thread: c.thread }"
            @blur="hover = null"
          >
            <span class="tid">{{ c.thread }}</span>
            <span class="dst">
              <template v-if="c.status === 'skipped'">跳过</template>
              <template v-else-if="c.index !== null">→{{ c.index }}</template>
              <template v-else>?</template>
            </span>
          </button>
        </div>
      </div>
    </div>
    <div class="caption">格子里的大数字是 <code>threadIdx.x</code>，箭头后面是它算出的下标 i。</div>

    <div class="row-label">数组 c（n = {{ cfg.n }}）<span v-if="outside.length" class="outside-label">· 数组外面的内存</span></div>
    <div class="memory">
      <div class="array">
        <button
          v-for="(writers, i) in elements"
          :key="i"
          type="button"
          class="elem hgp-focusable"
          :class="{ filled: writers.length > 0, missing: ok && writers.length === 0, dup: writers.length > 1, lit: indexLit(i) }"
          :style="writers.length ? { '--blk': color(writers[0].block) } : undefined"
          :aria-label="elemLabel(i)"
          @mouseenter="hover = { kind: 'elem', index: i }"
          @focus="hover = { kind: 'elem', index: i }"
          @blur="hover = null"
        >
          <span class="idx">{{ i }}</span>
          <span v-if="writers.length > 1" class="mark dup-mark">×{{ writers.length }}</span>
          <span v-else-if="ok && writers.length === 0" class="mark">?</span>
          <span v-else-if="writers.length === 1" class="mark ok-mark" aria-hidden="true">✓</span>
        </button>
      </div>
      <div v-if="outside.length" class="array outside">
        <button
          v-for="o in outside"
          :key="o.index"
          type="button"
          class="elem oob hgp-focusable"
          :class="{ lit: indexLit(o.index) }"
          :aria-label="`数组外面的位置 ${o.index}，被 ${o.writers.length} 个线程写坏了`"
          @mouseenter="hover = { kind: 'elem', index: o.index }"
          @focus="hover = { kind: 'elem', index: o.index }"
          @blur="hover = null"
        >
          <span class="idx">{{ o.index }}</span>
          <span class="mark">越界</span>
        </button>
      </div>
    </div>

    <p class="summary" :class="{ good: ok && result?.ok && result.summary.allCorrect && result.summary.oobWrites === 0 }" aria-live="polite">
      {{ summary }}
    </p>

    <ul class="legend" aria-label="图例">
      <li><span class="sw filled" />写入</li>
      <li><span class="sw oob" />越界写</li>
      <li><span class="sw skipped" />检查后跳过</li>
      <li><span class="sw missing" />没人算</li>
      <li><span class="sw dup">×2</span>重复计算</li>
    </ul>
  </div>
</template>

<style scoped>
.hgp-grid {
  display: grid;
  gap: 8px;
}
.row-label {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}
.outside-label {
  color: var(--hg-error);
}
.blocks {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.block {
  padding: 6px 8px 8px;
  border: 1.5px solid var(--blk);
  border-radius: var(--hgp-radius);
  background: color-mix(in srgb, var(--blk) 7%, transparent);
}
.block-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.block-title code {
  font-size: 11px;
}
.cells {
  display: flex;
  gap: 4px;
}
.thread {
  display: grid;
  place-items: center;
  width: 36px;
  height: 44px;
  padding: 0;
  border: 1.5px solid var(--blk);
  border-radius: 6px;
  background: color-mix(in srgb, var(--blk) 18%, var(--vp-c-bg));
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
  cursor: default;
  transition: background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out),
    transform var(--motion-fast) var(--ease-out), opacity var(--motion-base) var(--ease-out);
}
.tid {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}
.dst {
  font-size: 11px;
  line-height: 1;
  color: var(--vp-c-text-2);
}
.thread.oob {
  border-color: var(--hg-error);
  background: repeating-linear-gradient(45deg, var(--hg-error-soft) 0 4px, transparent 4px 8px), var(--vp-c-bg);
  animation: hgp-flash 240ms var(--ease-out) 2;
}
.thread.oob .dst {
  color: var(--hg-error);
  font-weight: 700;
}
.thread.skipped {
  border-style: dashed;
  border-color: var(--hg-inactive);
  background: transparent;
  opacity: 0.75;
}
.thread.error {
  border-color: var(--hg-inactive);
  background: transparent;
}
.thread.lit,
.elem.lit {
  transform: translateY(-2px);
  box-shadow: 0 0 0 2px var(--hg-focus);
}
.caption {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.memory {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-start;
}
.array {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.array.outside {
  padding-left: 10px;
  border-left: 2px dashed var(--hg-error);
}
.elem {
  position: relative;
  display: grid;
  place-items: center;
  width: 36px;
  height: 40px;
  padding: 0;
  border: 1.5px solid var(--hg-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
  cursor: default;
  transition: background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out),
    transform var(--motion-fast) var(--ease-out);
}
.idx {
  font-size: 11px;
  color: var(--vp-c-text-2);
  line-height: 1;
}
.mark {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}
.elem.filled {
  border-color: var(--blk);
  background: color-mix(in srgb, var(--blk) 22%, var(--vp-c-bg));
}
.ok-mark {
  color: var(--blk);
}
.elem.missing {
  border-style: dashed;
  border-color: var(--hg-error);
  color: var(--hg-error);
}
.elem.dup {
  box-shadow: inset 0 0 0 1.5px var(--hg-warn);
}
.dup-mark {
  color: var(--hg-warn);
}
.elem.oob {
  border-color: var(--hg-error);
  background: repeating-linear-gradient(45deg, var(--hg-error-soft) 0 4px, transparent 4px 8px), var(--vp-c-bg);
  color: var(--hg-error);
  animation: hgp-flash 240ms var(--ease-out) 2;
}
.elem.oob .mark {
  font-size: 10px;
}
.summary {
  margin: 4px 0 0;
  padding: 8px 12px;
  border-left: 3px solid var(--hg-warn);
  border-radius: 4px;
  background: var(--hg-warn-soft);
  font-size: 14px;
}
.summary.good {
  border-left-color: var(--hg-ok);
  background: var(--hg-ok-soft);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 5px;
}
.sw {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 14px;
  border: 1.5px solid var(--hg-border);
  border-radius: 3px;
  font-size: 8px;
  font-weight: 700;
}
.sw.filled {
  border-color: var(--hg-block-0);
  background: color-mix(in srgb, var(--hg-block-0) 22%, transparent);
}
.sw.oob {
  border-color: var(--hg-error);
  background: repeating-linear-gradient(45deg, var(--hg-error-soft) 0 3px, transparent 3px 6px);
}
.sw.skipped {
  border-style: dashed;
  border-color: var(--hg-inactive);
}
.sw.missing {
  border-style: dashed;
  border-color: var(--hg-error);
}
.sw.dup {
  border-color: var(--hg-warn);
  color: var(--hg-warn);
}
@keyframes hgp-flash {
  50% {
    transform: scale(1.08);
  }
}
@media (max-width: 420px) {
  .thread,
  .elem {
    width: 32px;
  }
  .cells {
    gap: 3px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .thread.oob,
  .elem.oob {
    animation: none;
  }
}
</style>
