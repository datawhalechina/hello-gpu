<script setup lang="ts">
/**
 * 1-10 的挑战「两组一起求和」（关卡自己的 scenes，不用登记组件）。
 *
 * sum_all：派 2 组、每组 64 个线程，把 a 里 128 个数加进 out[0]。读者补三个空：循环搭到哪为止、每一轮之后等不等、
 * 最后那一行谁把什么加进 out[0]。judge 判三颗星；variants 用同一份代码换成 4 组、每组 32 个线程再跑一次（★3）。
 * 结果插槽：先是每一次运行的一句话（out[0] 对不对、几处数据竞争、搭了几轮、排了几次队），再是货架板（TreeBoard，
 * 画派 2 组的那一次）：点「运行」看跑完的样子，可以换着看两组；单步时跟着这一步的组。
 * 派法是定的，旋钮区只写启动代码和说明。代码由沙盒存进这一关的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12）。
 */
import { computed, onMounted, ref } from 'vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import TreeBoard from './TreeBoard.vue'
import {
  HINTS, STAGE_ID, SUM_ARGS, SUM_BLANKS, SUM_CODE, SUM_LAUNCH, SUM_N, SUM_TOTAL, SUM_VARIANTS, VARIANT_LAUNCH, judge, launchLine,
  runSummary,
} from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: STAGE_ID, id: 'sum', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine('sum_all', SUM_LAUNCH, lang.value))
onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <Sandbox
    :title="`两组一起求和：${SUM_LAUNCH.grid} 组，每组 ${SUM_LAUNCH.block} 个线程`"
    :code="SUM_CODE"
    :blanks="SUM_BLANKS"
    :launch="SUM_LAUNCH"
    :args="SUM_ARGS"
    :variants="SUM_VARIANTS"
    :judge="judge"
    :challenge="challenge"
    file="sum_all"
  >
    <template #controls>
      <div class="ss">
        <p class="ss__launch">
          <span class="ss__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="ss__note">a 里 {{ SUM_N }} 个数，a[j] = j + 1，加起来是 {{ SUM_TOTAL }}；out 只有 1 格，一开始是 0。派 {{ SUM_LAUNCH.grid }} 组，每组 {{ SUM_LAUNCH.block }} 个线程。点「运行」以后，同一份代码还会换成 {{ VARIANT_LAUNCH.grid }} 组、每组 {{ VARIANT_LAUNCH.block }} 个线程，再跑一次（第三颗星看它）。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="ss__result">
        <ul v-if="runs.length && (!step || step.index === step.count - 1)" class="ss__runs">
          <li v-for="(run, k) in runs" :key="k">{{ runSummary(run) }}<span v-if="k > 0" class="ss__runs-tag">（第三颗星看这一次）</span></li>
        </ul>
        <TreeBoard
          :result="result"
          :launch="runs[0]?.launch ?? SUM_LAUNCH"
          :args="SUM_ARGS"
          :expected="SUM_TOTAL"
          :range="step ? { from: step.group.from, to: step.group.to, block: step.group.block } : null"
          unit="步"
          empty-text="还没运行：补好三个空，点「运行」。这里画出每组货架上的 64 格和 out[0]：每一轮谁把谁加过来，out[0] 最后是多少、排了几次队。"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-9 的沙盒）。 */
.ss {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.ss__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.ss__launch-label {
  color: var(--hg-ink-2);
}

.ss__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ss__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.ss__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.ss__runs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
  list-style: none;
}

.ss__runs li {
  margin: 0;
}

.ss__runs-tag {
  color: var(--hg-ink-3);
  font-weight: 500;
}
</style>
