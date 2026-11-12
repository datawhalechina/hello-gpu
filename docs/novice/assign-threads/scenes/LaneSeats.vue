<script setup lang="ts">
/**
 * 1-3 原理「每个线程落在一条 lane 上」（关卡自己的 scenes，不用登记组件）：静态示意图，不是模拟结果。
 *
 * 一条 SIMD（车间里的一条流水线）的 lane 数从 hardware.json 读（RX 9070 XT：RDNA4 指令集手册，1-2 的全景图
 * 用的同一个数），探索二的 8 个线程一人站一个 lane：块里的第 k 个线程在 lane k（旧版第 2 章 2.3.4），
 * 另外的 lane 这次空着。窄屏一行 8 个 lane，宽屏一行 16 个。
 */
import { useId } from 'vue'
import ThreadBot from '@kit/ThreadBot.vue'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'
import { EXPLORE_N } from '../challenge.ts'

const titleId = `${useId()}-title`
const LANES = Number(HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params.lanesPerSimd.value)
const lanes = Array.from({ length: LANES }, (_, lane) => ({ lane, thread: lane < EXPLORE_N ? lane : null }))
const label = `一条 SIMD 上的 ${LANES} 个 lane：线程 0 到 ${EXPLORE_N - 1} 各站一个，在 lane 0 到 lane ${EXPLORE_N - 1}；另外 ${LANES - EXPLORE_N} 个 lane 空着。`
</script>

<template>
  <figure class="ls" :aria-labelledby="titleId">
    <figcaption :id="titleId" class="ls__head">
      <span class="ls__eyebrow" aria-hidden="true">SIMD</span>
      <strong class="ls__title">一条流水线，{{ LANES }} 个工位</strong>
      <span class="ls__tag">示意</span>
    </figcaption>
    <div class="ls__simd" role="img" :aria-label="label">
      <div
        v-for="slot in lanes"
        :key="slot.lane"
        class="ls__lane"
        :class="{ 'is-busy': slot.thread !== null }"
        aria-hidden="true"
      >
        <ThreadBot v-if="slot.thread !== null" class="ls__bot" :label="slot.thread" :size="30" />
        <span class="ls__no">{{ slot.lane }}</span>
      </div>
    </div>
    <p class="ls__note">
      格子下面的数是 lane 的编号，机器人屏幕上的数是 threadIdx.x。{{ EXPLORE_N }} 个线程占了 {{ EXPLORE_N }} 个 lane，另外 {{ LANES - EXPLORE_N }} 个 lane 这次空着。
    </p>
  </figure>
</template>

<style scoped>
.ls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  color: var(--hg-ink);
}

.ls__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ls__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ls__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ls__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

/* 一条流水线：窄屏一行 8 个工位，宽屏一行 16 个。 */
.ls__simd {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  padding: 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .ls__simd {
    grid-template-columns: repeat(16, minmax(0, 1fr));
  }
}

/* 空着的工位是虚线框，有线程的是实线框 + 机器人：不只靠颜色（01 第 7 节）。 */
.ls__lane {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  min-height: 58px;
  padding: 4px 0 3px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: 6px;
}

.ls__lane.is-busy {
  border-style: solid;
  border-color: var(--hg-ink-3);
  background: var(--hg-surface);
}

.ls__bot {
  max-width: 100%;
  height: auto;
}

.ls__no {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 11px;
  line-height: 1;
}

.ls__note {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

@media (max-width: 639px) {
  .ls {
    padding: 16px 12px;
  }

  .ls__simd {
    gap: 4px;
    padding: 8px 6px;
  }
}
</style>
