<script setup lang="ts">
/**
 * 1-8 的挑战「每人先加一段」（关卡自己的 scenes，不用登记组件）。
 *
 * part_sum：a 里 128 个数，派 1 组 32 个线程，每人把 4 个数加成部分和，存进 part[t]。读者补一个空：
 * 第 k 轮、第 t 个线程拿第几个数（i）。judge 判三颗星；variants 用同一份代码换成 2 组、每人加 2 个再跑一次（★3）。
 * 结果插槽里放访存视图：点「运行」看第一次读写和整段的车次汇总，单步时跟着这一步；上面一行写 part 加起来是多少。
 * 派法是定的，旋钮区只写启动代码和说明。代码由沙盒存进这一关的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12）。
 */
import { computed, onMounted, ref } from 'vue'
import MemoryView from '@kit/MemoryView.vue'
import Sandbox from '@kit/Sandbox.vue'
import type { RunResult } from '@sim/lockstep.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  HINTS, PART_ARGS, PART_BLANKS, PART_CODE, PART_LAUNCH, PART_M, PART_N, PART_TOTAL, PART_VARIANTS, STAGE_ID,
  VARIANT_LAUNCH, VARIANT_M, judge, partLaunchLine,
} from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: STAGE_ID, id: 'part', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => partLaunchLine(lang.value))
onMounted(() => {
  mounted.value = true
})

/** 结果上面那一行：part 加起来是多少，对不对。 */
function totalText(result: RunResult | null): string {
  if (!result) return ''
  if (!result.ok) return '程序没有跑完，part 还没加起来。'
  const total = (result.arrays.part ?? []).reduce((sum, v) => sum + v, 0)
  return total === PART_TOTAL
    ? `part 加起来是 ${total}，和 1 + 2 + … + ${PART_N} 一样。`
    : `part 加起来是 ${total}，应该是 ${PART_TOTAL}。`
}
</script>

<template>
  <Sandbox
    :title="`${PART_N} 个数：每人先加 ${PART_M} 个`"
    :code="PART_CODE"
    :blanks="PART_BLANKS"
    :launch="PART_LAUNCH"
    :args="PART_ARGS"
    :variants="PART_VARIANTS"
    :judge="judge"
    :challenge="challenge"
    file="part_sum"
  >
    <template #controls>
      <div class="ps">
        <p class="ps__launch">
          <span class="ps__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="ps__note">a 里 {{ PART_N }} 个数，a[j] = j + 1。派 1 组 {{ PART_LAUNCH.block }} 个线程，每人加 {{ PART_M }} 个，部分和存进 <code translate="no">part[t]</code>。点「运行」以后，同一份代码还会换成 {{ VARIANT_LAUNCH.grid }} 组、每组 {{ VARIANT_LAUNCH.block }} 个线程、每人加 {{ VARIANT_M }} 个，再跑一次（第三颗星看它）。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="ps__result">
        <p v-if="result && (!step || step.index === step.count - 1)" class="ps__total">{{ totalText(result) }}</p>
        <MemoryView
          :result="result"
          :step="step"
          :launch="runs[0]?.launch ?? PART_LAUNCH"
          :controls="false"
          :knobs="false"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-7 的沙盒）。 */
.ps {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ps__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.ps__launch-label {
  color: var(--hg-ink-2);
}

.ps__launch code,
.ps__note code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ps__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.ps__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.ps__total {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}
</style>
