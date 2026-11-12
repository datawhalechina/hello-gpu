<script setup lang="ts">
/**
 * 副本「向量缩放」的挑战（副本自己的 scenes，不用登记组件）。
 *
 * 沙盒补两个空（下标 i、写入前的条件），结果交给 RobotGrid（显存格子画 x）：每个线程乘了哪一格、哪些格子被乘了不止一次、
 * 哪些没人乘、谁写到了 x 外面；上面一行写 x 乘成了什么样。派法是定的，旋钮区只写启动代码和说明；
 * variants 连数据一起换，再跑两次（★3）。代码由沙盒存进这道题的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12），
 * 看过答案题解也展开（X-01）。
 */
import { computed, onMounted, ref } from 'vue'
import RobotGrid from '@kit/RobotGrid.vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  ARGS, BLANKS, CODE, EXERCISE_ID, HINTS, K, LAUNCH, N, THREADS, VARIANTS, VARIANT_SETUPS, judge, launchLine, valueText,
} from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: EXERCISE_ID, id: 'scale', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const line = computed(() => launchLine(mounted.value ? progress.state.prefs.lang : 'hip'))
onMounted(() => {
  mounted.value = true
})

const AGAIN = VARIANTS.map((v, k) => `每组 ${v.block} 个线程、${VARIANT_SETUPS[k].n} 个数（派 ${v.grid} 组）`).join('，')
</script>

<template>
  <Sandbox
    :title="`把 ${N} 个数都乘以 ${K}`"
    :code="CODE"
    :blanks="BLANKS"
    :launch="LAUNCH"
    :args="ARGS"
    :variants="VARIANTS"
    :judge="judge"
    :challenge="challenge"
    file="scale"
  >
    <template #controls>
      <div class="vs">
        <p class="vs__launch">
          <span class="vs__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="vs__note">x[0]～x[{{ N - 1 }}] 一开始是 1～{{ N }}。派 {{ LAUNCH.grid }} 组、每组 {{ LAUNCH.block }} 个线程，一共 {{ THREADS }} 个。点「运行」以后，同一份代码还会换成{{ AGAIN }}，各跑一次（第三颗星看它们）。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="vs__result">
        <p v-if="result && (!step || step.index === step.count - 1)" class="vs__values">{{ valueText(result) }}</p>
        <RobotGrid
          :result="result"
          :step="step"
          :launch="runs[0]?.launch ?? LAUNCH"
          array="x"
          :controls="false"
          empty-text="还没运行。运行以后，这里显示每个线程乘了 x 的哪一格。"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-8 的沙盒）。 */
.vs {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.vs__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.vs__launch-label {
  color: var(--hg-ink-2);
}

.vs__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.vs__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.vs__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.vs__values {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}
</style>
