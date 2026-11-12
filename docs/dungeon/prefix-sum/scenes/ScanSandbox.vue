<script setup lang="ts">
/**
 * 副本「前缀和入门」的挑战（副本自己的 scenes，不用登记组件）。
 *
 * 沙盒补三个空（循环走到哪为止、取之前等不等、取完放之前等不等），取和放两行、放完以后的同步是定的。
 * judge 判三颗星；variants 用同一份代码换成每组 128 个、32 个线程各跑一次（★3）。结果插槽：先是每一次运行的一句话
 * （out 对了没有、几处数据竞争、走了几轮、每支小队等了几次），再是货架板（ScanBoard，画每组 64 个线程的那一次），
 * 单步时跟着这一步。派法是定的，旋钮区只写启动代码和说明。代码由沙盒存进这道题的草稿槽，刷新不丢；
 * 没过 2 / 4 / 6 次依次解锁提示（F-12），看过答案题解也展开（X-01）。
 */
import { computed, onMounted, ref } from 'vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import ScanBoard from './ScanBoard.vue'
import { ARGS, BLANKS, CODE, EXERCISE_ID, HINTS, LAUNCH, VARIANTS, VARIANT_BLOCKS, judge, launchLine, prefixOf, runSummary } from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: EXERCISE_ID, id: 'scan', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const line = computed(() => launchLine(mounted.value ? progress.state.prefs.lang : 'hip'))
onMounted(() => {
  mounted.value = true
})

const TOTAL = prefixOf(LAUNCH.block)[LAUNCH.block - 1]
</script>

<template>
  <Sandbox
    :title="`给 ${LAUNCH.block} 个零件排号：前缀和`"
    :code="CODE"
    :blanks="BLANKS"
    :launch="LAUNCH"
    :args="ARGS"
    :variants="VARIANTS"
    :judge="judge"
    :challenge="challenge"
    file="scan"
  >
    <template #controls>
      <div class="sn">
        <p class="sn__launch">
          <span class="sn__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="sn__note">a 里 {{ LAUNCH.block }} 个零件，合格 1、不合格 0，一共 {{ TOTAL }} 个合格；out 一开始全是 0。派 1 组 {{ LAUNCH.block }} 个线程（两支小队）。点「运行」以后，同一份代码还会换成每组 {{ VARIANT_BLOCKS[0] }} 个、{{ VARIANT_BLOCKS[1] }} 个线程，各跑一次（第三颗星看它们）。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="sn__result">
        <ul v-if="runs.length && (!step || step.index === step.count - 1)" class="sn__runs">
          <li v-for="(run, k) in runs" :key="k">{{ runSummary(run) }}<span v-if="k > 0" class="sn__runs-tag">（第三颗星看这一次）</span></li>
        </ul>
        <ScanBoard
          :result="result"
          :step="step"
          :launch="runs[0]?.launch ?? LAUNCH"
          :args="ARGS"
          empty-text="还没运行：补好三个空，点「运行」。这里画出货架上的 64 格和 out：每一格现在是几，谁取到了这一轮已经加过的数。"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-10 的沙盒）。 */
.sn {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sn__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.sn__launch-label {
  color: var(--hg-ink-2);
}

.sn__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.sn__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.sn__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.sn__runs {
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

.sn__runs li {
  margin: 0;
}

.sn__runs-tag {
  color: var(--hg-ink-3);
  font-weight: 500;
}
</style>
