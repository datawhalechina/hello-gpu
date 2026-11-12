<script setup lang="ts">
/**
 * 2-4 三段探索用的是哪组峰值（关卡自己的 scenes，不用登记组件）：标签 + 一句来历 + 换峰值的按钮，版式同 2-1 的 GpuSource。
 * 没有卡片、卡片还没测峰值时，链到本页探索三下面的「我的 GPU 卡片」（锚点 #gpu-card）。
 */
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { archiveHref } from '@course/labArchive.ts'
import type { DeviceRecord } from '@course/progress.ts'
import { sig, type PeakSource, type RoofPeak } from '../roofline.ts'

const props = defineProps<{
  peak: RoofPeak
  /** 读者当前选的那张卡（可能还没测峰值）。 */
  card: DeviceRecord | null
  /** 那张卡带着实测峰值：可以在你的峰值和参考值之间换。 */
  hasMine: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()

const TAG: Record<PeakSource, string> = { card: '你的卡', archive: '档案馆', spec: '示意' }
const numbers = computed(() => `带宽 ${sig(props.peak.gbps)} GB/s，算力 ${sig(props.peak.tflops)} TFLOPS`)
const date = computed(() => props.peak.at?.slice(0, 10) ?? '')
const entryHref = computed(() => (props.peak.entry ? withBase(archiveHref(props.peak.entry)) : ''))
</script>

<template>
  <div class="ps" :class="`is-${peak.source}`">
    <span class="ps__tag">{{ TAG[peak.source] }}</span>
    <p class="ps__text">
      <template v-if="peak.source === 'card'">{{ peak.device }}：你用 <code translate="no">hg.peak()</code> 测的峰值（{{ date }} 的导入码），{{ numbers }}。</template>
      <template v-else-if="peak.source === 'archive'">{{ peak.device }}：峰值来自实验档案馆的<a :href="entryHref">这条记录</a>（{{ date }}），{{ numbers }}。</template>
      <template v-else>{{ peak.device }} 的标称峰值，出自 AMD 产品页：{{ numbers }}。不是实测，只用来示意。</template>
      <template v-if="hasMine && peak.source !== 'card'">你的卡测的峰值先收起来了。</template>
      <template v-else-if="card && !hasMine">你的卡「{{ card.name }}」还没测峰值：在 Notebook 里运行 <code translate="no">hg.peak()</code>，再把 <code translate="no">hg.device_card()</code> 新打印的导入码贴到<a href="#gpu-card">我的 GPU 卡片</a>。</template>
      <template v-else-if="!card"><a href="#gpu-card">导入你的 GPU 卡片</a>以后，换成你测的峰值。</template>
    </p>
    <button v-if="hasMine" type="button" class="ps__button" @click="emit('toggle')">
      {{ peak.source === 'card' ? '看参考值' : '换回我的卡' }}
    </button>
  </div>
</template>

<style scoped>
/* 同 2-1 的 GpuSource：参考值虚线框、浅灰底；你的卡实线框、强调色浅底（01 第 2 节）。 */
.ps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.ps.is-card {
  border-style: solid;
  background: var(--hg-accent-soft);
}

.ps__tag {
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

.ps.is-card .ps__tag {
  color: var(--hg-accent-ink);
}

.ps__text {
  flex: 1 1 16em;
  min-width: 0;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.ps__text code {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ps__text a {
  color: var(--hg-accent-ink);
  font-weight: 600;
}

.ps__button {
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

.ps__button:hover {
  border-color: var(--hg-accent);
}

.ps__button:focus-visible,
.ps__text a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}
</style>
