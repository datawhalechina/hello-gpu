<script setup lang="ts">
/**
 * 2-1 三段探索画的是哪张卡（关卡自己的 scenes，不用登记组件）：标签 + 一句来历 + 换卡按钮，版式同 1-2 全景图的那一栏。
 * 没有卡片时链到本页挑战一节的「我的 GPU 卡片」（锚点 #gpu-card）。
 */
import type { Gpu } from '../readings.ts'

defineProps<{
  gpu: Gpu
  /** 读者导入过卡片：可以在你的卡和本书的卡之间换。 */
  hasCard: boolean
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="gs" :class="{ 'is-mine': gpu.mine }">
    <span class="gs__tag">{{ gpu.mine ? '你的卡' : '本书的卡' }}</span>
    <p class="gs__text">
      <template v-if="gpu.mine">{{ gpu.name }}（<code translate="no">{{ gpu.gfx }}</code>）：数来自你导入的 GPU 卡片。</template>
      <template v-else-if="hasCard">{{ gpu.name }}：正文说的就是这张卡，数来自 AMD 官方资料。</template>
      <template v-else>{{ gpu.name }}：数来自 AMD 官方资料。<a href="#gpu-card">导入你的 GPU 卡片</a>以后，这里换成你的卡。</template>
    </p>
    <button v-if="hasCard" type="button" class="gs__button" @click="emit('toggle')">
      {{ gpu.mine ? '看本书的卡' : '换回我的卡' }}
    </button>
  </div>
</template>

<style scoped>
/* 同 1-2 全景图的「画的是哪张卡」：本书的卡虚线框、浅灰底；你的卡实线框、强调色浅底（01 第 2 节）。 */
.gs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.gs.is-mine {
  border-style: solid;
  background: var(--hg-accent-soft);
}

.gs__tag {
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

.gs.is-mine .gs__tag {
  color: var(--hg-accent-ink);
}

.gs__text {
  flex: 1 1 16em;
  min-width: 0;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.gs__text code {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.gs__text a {
  color: var(--hg-accent-ink);
  font-weight: 600;
}

.gs__button {
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

.gs__button:hover {
  border-color: var(--hg-accent);
}

.gs__button:focus-visible,
.gs__text a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}
</style>
