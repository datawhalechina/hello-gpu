<script setup lang="ts">
/**
 * 副本「直方图」的挑战（副本自己的 scenes，不用登记组件）。
 *
 * 沙盒补三个空（货架清不清零、数的那一行、怎么合进 hist），两次同步是定的。结果插槽：上面一行写 hist 数对了几档、
 * hist 前排了几次队，下面是结果板（HistBoard）：hist 的 8 档和每组往 hist 每一格原子加了几次；单步时表格跟着这一步。
 * 派法是定的，旋钮区只写启动代码和说明；这道题不换派法再跑。代码由沙盒存进这道题的草稿槽，刷新不丢；
 * 没过 2 / 4 / 6 次依次解锁提示（F-12），看过答案题解也展开（X-01）。
 */
import { computed, onMounted, ref } from 'vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import HistBoard from './HistBoard.vue'
import { ARGS, BLANKS, CODE, EXERCISE_ID, HINTS, LAUNCH, LEVELS, PIXELS, histText, judge, launchLine } from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: EXERCISE_ID, id: 'histogram', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const line = computed(() => launchLine(mounted.value ? progress.state.prefs.lang : 'hip'))
onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <Sandbox
    :title="`数 ${PIXELS} 个像素的亮度`"
    :code="CODE"
    :blanks="BLANKS"
    :launch="LAUNCH"
    :args="ARGS"
    :judge="judge"
    :challenge="challenge"
    file="histogram"
  >
    <template #controls>
      <div class="hs">
        <p class="hs__launch">
          <span class="hs__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="hs__note">a 里是 {{ PIXELS }} 个像素的亮度（0～{{ LEVELS - 1 }}），hist 的 {{ LEVELS }} 格一开始都是 0。派 {{ LAUNCH.grid }} 组、每组 {{ LAUNCH.block }} 个线程，一个线程管一个像素。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="hs__result">
        <p v-if="result && (!step || step.index === step.count - 1)" class="hs__line">{{ histText(result) }}</p>
        <HistBoard
          :result="result"
          :step="step"
          :launch="runs[0]?.launch ?? LAUNCH"
          empty-text="还没运行：补好三个空，点「运行」。这里画出 hist 的 8 档，和每组往 hist 的每一格原子加了几次。"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-8 的沙盒）。 */
.hs {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.hs__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.hs__launch-label {
  color: var(--hg-ink-2);
}

.hs__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.hs__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hs__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.hs__line {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}
</style>
