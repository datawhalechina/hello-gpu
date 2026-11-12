<script setup lang="ts">
/**
 * 2-5 trace 浏览器用的是哪份数据（关卡自己的 scenes，不用登记组件）：标签 + 一句来历 + 换数据的按钮，版式同 2-4 的 PeakSource。
 * 还没导入自己的 trace 时，链到本页探索二下面的「导入你的 trace」（锚点 #my-trace）。
 */
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { archiveHref } from '@course/labArchive.ts'
import { SAMPLE_DEVICE, type SetLine, type TraceSource } from '../trace.ts'

const props = defineProps<{
  source: TraceSource
  /** 正在看的那一行（读者导入的几份 trace 可能来自不同的卡和时间）。 */
  line: SetLine | null
  /** 档案条目 id（source 是 archive 时）。 */
  entry: string | null
  /** 读者导入过自己的 trace：可以在自己的和参考数据之间换。 */
  hasMine: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const TAG: Record<TraceSource, string> = { mine: '你的 trace', archive: '档案馆', sample: '示意' }
const device = computed(() => props.line?.device.name ?? '')
const date = computed(() => props.line?.at?.slice(0, 10) ?? '')
const entryHref = computed(() => (props.entry ? withBase(archiveHref(props.entry)) : ''))
</script>

<template>
  <div class="ts" :class="`is-${source}`">
    <span class="ts__tag">{{ TAG[source] }}</span>
    <p class="ts__text">
      <template v-if="source === 'mine'">{{ device }}：你导入的 trace（{{ date }} 记的），只存在这个浏览器里。</template>
      <template v-else-if="source === 'archive'">{{ device }}：实验档案馆里<a :href="entryHref">这条记录</a>（{{ date }}）的 trace。</template>
      <template v-else>按 {{ SAMPLE_DEVICE.name }} 的标称峰值和几个示意的开销排出来的，不是实测（怎么排的见本页「示意数据怎么来的」）。</template>
      <template v-if="hasMine && source !== 'mine'">你导入的 trace 先收起来了。</template>
      <template v-else-if="!hasMine"><a href="#my-trace">导入你在 Notebook 里记的 trace</a>，换成你的卡。</template>
    </p>
    <button v-if="hasMine" type="button" class="ts__button" @click="emit('toggle')">
      {{ source === 'mine' ? '看参考数据' : '换回我的 trace' }}
    </button>
  </div>
</template>

<style scoped>
/* 同 2-4 的 PeakSource：参考数据虚线框、浅灰底；你的 trace 实线框、强调色浅底（01 第 2 节）。 */
.ts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.ts.is-mine {
  border-style: solid;
  background: var(--hg-accent-soft);
}

.ts__tag {
  flex: none;
  padding: 1px 10px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ts.is-mine .ts__tag {
  color: var(--hg-accent-ink);
}

.ts__text {
  flex: 1 1 16em;
  min-width: 0;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ts__text a {
  color: var(--hg-accent-ink);
  font-weight: 600;
}

.ts__button {
  min-height: 34px;
  padding: 0 12px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color var(--motion-instant) var(--motion-ease-out);
}

.ts__button:hover {
  border-color: var(--hg-accent);
}

.ts__button:focus-visible,
.ts__text a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}
</style>
