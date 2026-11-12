<script setup lang="ts">
/**
 * 1-4 原理「这几组派到哪」（关卡自己的 scenes，不用登记组件）：示意图，不是模拟结果。
 *
 * 计算单元的个数、每个 WGP 有几个计算单元从 hardware.json 读（RX 9070 XT，1-2 的全景图用的同一组数）。
 * 旋钮选派几组：1 组（1-3 的派法）、4 组、和计算单元一样多。一组整组占一个计算单元，格子里写组号 blockIdx.x。
 * 哪一组进哪个计算单元由硬件安排（HIP 文档：work-group 由驱动和硬件调度，分到可用的计算单元上，顺序不确定），
 * 这里用一个固定的打乱顺序摆放，只表示「组号和车间没有固定的对应」。
 */
import { computed, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { DEFAULT_DEVICE_ID, HARDWARE_DEVICES } from '@course/hardware.ts'

const titleId = `${useId()}-title`
const params = HARDWARE_DEVICES[DEFAULT_DEVICE_ID].params
const CUS = Number(params.cuCount.value)
const PER_WGP = Number(params.cusPerWgp.value)
const WGPS = CUS / PER_WGP

const OPTIONS = [1, 4, CUS]
const groups = ref(4)

/**
 * 第 b 组放进第几个计算单元：步长和计算单元个数互质，b 从 0 走到 CUS − 1 正好把每个计算单元走一遍，
 * 前几组也分得开（不挤在一角）。
 */
function stride(total: number): number {
  for (let s = Math.floor(total * 0.27); s < total; s++) {
    let a = s
    let b = total
    while (b) [a, b] = [b, a % b]
    if (a === 1) return s
  }
  return 1
}
const STEP = stride(CUS)
const placeOf = (b: number) => (b * STEP + 5) % CUS

const cells = computed(() => {
  const owner = new Array<number | null>(CUS).fill(null)
  for (let b = 0; b < Math.min(groups.value, CUS); b++) owner[placeOf(b)] = b
  return Array.from({ length: WGPS }, (_, w) => Array.from({ length: PER_WGP }, (_, k) => {
    const cu = w * PER_WGP + k
    return { cu, block: owner[cu] }
  }))
})

const busy = computed(() => Math.min(groups.value, CUS))
const summary = computed(() => {
  const n = groups.value
  if (n === 1) return `派 1 组：整组进了 1 个计算单元，另外 ${CUS - 1} 个都闲着。上一关的派法就是这样。`
  if (n >= CUS) return `派 ${n} 组：每个计算单元都分到一组，整颗芯片都忙起来了。`
  return `派 ${n} 组：${n} 个计算单元各接一组，另外 ${CUS - n} 个闲着。`
})
const label = computed(() => `示意：芯片上 ${WGPS} 个 WGP、${CUS} 个计算单元。${summary.value}`)
const blockStyle = (b: number) => ({ '--blk': `var(--hg-group-${b % 6})`, '--blk-soft': `var(--hg-group-${b % 6}-soft)` })
</script>

<template>
  <figure class="cb" :aria-labelledby="titleId">
    <figcaption :id="titleId" class="cb__head">
      <span class="cb__eyebrow" aria-hidden="true">CHIP</span>
      <strong class="cb__title">这几组派到哪：{{ CUS }} 个计算单元</strong>
      <span class="cb__tag">示意</span>
    </figcaption>

    <div class="cb__knobs">
      <Knob label="派几组" code="gridDim.x" :options="OPTIONS" unit=" 组" v-model="groups" />
    </div>

    <div class="cb__chip" role="img" :aria-label="label">
      <div v-for="(wgp, w) in cells" :key="w" class="cb__wgp" aria-hidden="true">
        <span
          v-for="cell in wgp"
          :key="cell.cu"
          class="cb__cu"
          :class="{ 'is-busy': cell.block !== null }"
          :style="cell.block !== null ? blockStyle(cell.block) : undefined"
        >{{ cell.block ?? '' }}</span>
      </div>
    </div>

    <p class="cb__note" aria-live="polite">{{ summary }}</p>
    <p class="cb__legend">
      一个小方框是一个计算单元（车间），每两个框在一起是一个 WGP。有数字的框分到了一组，数字是组号 blockIdx.x；
      哪一组进哪个框由硬件安排，这里的摆法只是示意。现在 {{ busy }} 个在忙。
    </p>
  </figure>
</template>

<style scoped>
/* 卡片、眉标、「示意」标签同 1-3 的工位图（LaneSeats）。 */
.cb {
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

.cb__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.cb__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.cb__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.cb__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.cb__knobs {
  padding: 12px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

/* 芯片：窄屏一行 4 个 WGP，宽屏一行 8 个。 */
.cb__chip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

@media (min-width: 720px) {
  .cb__chip {
    grid-template-columns: repeat(8, minmax(0, 1fr));
  }
}

.cb__wgp {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: 6px;
  background: var(--hg-surface);
}

/* 闲着的计算单元是虚线框，分到一组的是实线框 + 组的颜色 + 组号：不只靠颜色（01 第 7 节）。 */
.cb__cu {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: 4px;
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 700;
  transition: background-color var(--motion-fast) var(--motion-ease-out), border-color var(--motion-fast) var(--motion-ease-out);
}

.cb__cu.is-busy {
  border-style: solid;
  border-color: var(--blk);
  background: var(--blk-soft);
  color: var(--hg-ink);
}

.cb__note {
  margin: 0;
  font-size: 15px;
}

.cb__legend {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

@media (max-width: 639px) {
  .cb {
    padding: 16px 12px;
  }

  .cb__chip {
    gap: 4px;
    padding: 8px 6px;
  }

  .cb__cu {
    min-height: 26px;
    font-size: 11px;
  }
}
</style>
