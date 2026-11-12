<script setup lang="ts">
/**
 * 1-9 的挑战「每组倒过来」（关卡自己的 scenes，不用登记组件）。
 *
 * flip：派 2 组、每组 64 个线程，每组把自己的 64 个数倒过来。读者补三个空：放之前等不等、放和取之间等不等、
 * 取货架的第几格。judge 判三颗星；variants 用同一份代码换成 4 组、每组 32 个线程再跑一次（★3）。
 * 结果插槽：先是每一次运行的一句话（out 对不对、几处数据竞争、每支小队等了几次），再是货架板（ShelfBoard，
 * 画派 2 组的那一次）：点「运行」看跑完的样子，可以换着看两组；单步时跟着这一步的组走。
 * 派法是定的，旋钮区只写启动代码和说明。代码由沙盒存进这一关的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12）。
 */
import { computed, onMounted, ref } from 'vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import ShelfBoard from './ShelfBoard.vue'
import {
  FLIP_ARGS, FLIP_BLANKS, FLIP_CODE, FLIP_LAUNCH, FLIP_VARIANTS, HINTS, STAGE_ID, VARIANT_LAUNCH, flipLaunchLine, judge,
  runSummary,
} from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: STAGE_ID, id: 'flip', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => flipLaunchLine(FLIP_LAUNCH, lang.value))
onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <Sandbox
    :title="`每组倒过来：${FLIP_LAUNCH.grid} 组，每组 ${FLIP_LAUNCH.block} 个线程`"
    :code="FLIP_CODE"
    :blanks="FLIP_BLANKS"
    :launch="FLIP_LAUNCH"
    :args="FLIP_ARGS"
    :variants="FLIP_VARIANTS"
    :judge="judge"
    :challenge="challenge"
    file="flip"
  >
    <template #controls>
      <div class="fs">
        <p class="fs__launch">
          <span class="fs__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="fs__note">a 里 {{ FLIP_LAUNCH.grid * FLIP_LAUNCH.block }} 个数，a[j] = j + 1。派 {{ FLIP_LAUNCH.grid }} 组，每组 {{ FLIP_LAUNCH.block }} 个线程，每组把自己那 {{ FLIP_LAUNCH.block }} 个数倒过来存进 out。点「运行」以后，同一份代码还会换成 {{ VARIANT_LAUNCH.grid }} 组、每组 {{ VARIANT_LAUNCH.block }} 个线程，再跑一次（第三颗星看它）。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="fs__result">
        <ul v-if="runs.length && (!step || step.index === step.count - 1)" class="fs__runs">
          <li v-for="(run, k) in runs" :key="k">{{ runSummary(run) }}<span v-if="k > 0" class="fs__runs-tag">（第三颗星看这一次）</span></li>
        </ul>
        <ShelfBoard
          :result="result"
          :launch="runs[0]?.launch ?? FLIP_LAUNCH"
          :upto="step ? step.index + 1 : null"
          empty-text="还没运行：补好三个空，点「运行」。这里画出每组货架上的 64 格和 out：哪些格子放好了，哪些没放好就被取了。"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-8 的沙盒）。 */
.fs {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.fs__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.fs__launch-label {
  color: var(--hg-ink-2);
}

.fs__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.fs__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.fs__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.fs__runs {
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

.fs__runs li {
  margin: 0;
}

.fs__runs-tag {
  color: var(--hg-ink-3);
  font-weight: 500;
}
</style>
