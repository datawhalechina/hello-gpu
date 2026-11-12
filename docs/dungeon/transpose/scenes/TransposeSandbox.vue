<script setup lang="ts">
/**
 * 副本「矩阵转置」的挑战（副本自己的 scenes，不用登记组件）。
 *
 * 沙盒补三个空（r、c、写入前的条件），结果插槽放访存视图（MemoryView）：点「运行」看小队第一次读 a 搬几车，
 * 下面的汇总表分行写读 a、写 b 各搬了几车；单步时跟着这一步，搬的那一行一步里有读 a、写 b 两次。
 * 上面一行写 b 搬对了多少。派法是定的，旋钮区只写启动代码和说明；variants 换两种形状再跑（★3）。
 * 代码由沙盒存进这道题的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12），看过答案题解也展开（X-01）。
 */
import { computed, onMounted, ref } from 'vue'
import MemoryView from '@kit/MemoryView.vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  ARGS, BLANKS, CODE, COLS, EXERCISE_ID, HINTS, LAUNCH, ROWS, SIZE, THREADS, VARIANTS, VARIANT_SHAPES, judge, launchLine, placeText,
} from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: EXERCISE_ID, id: 'transpose', hints: HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const line = computed(() => launchLine(mounted.value ? progress.state.prefs.lang : 'hip'))
onMounted(() => {
  mounted.value = true
})

const AGAIN = VARIANTS.map((v, k) => `${VARIANT_SHAPES[k].rows} 行 ${VARIANT_SHAPES[k].cols} 列（派 ${v.grid} 组、每组 ${v.block} 个线程）`).join('、')
</script>

<template>
  <Sandbox
    :title="`${ROWS} 行 ${COLS} 列：转置进 b`"
    :code="CODE"
    :blanks="BLANKS"
    :launch="LAUNCH"
    :args="ARGS"
    :variants="VARIANTS"
    :judge="judge"
    :challenge="challenge"
    file="transpose"
  >
    <template #controls>
      <div class="tp">
        <p class="tp__launch">
          <span class="tp__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="tp__note">a[j] 一开始是 j + 1，b 全是 0。派 {{ LAUNCH.grid }} 组、每组 {{ LAUNCH.block }} 个线程，一共 {{ THREADS }} 个，比 {{ SIZE }} 个数多 {{ THREADS - SIZE }} 个。点「运行」以后，同一份代码还会换成 {{ AGAIN }} 的矩阵，各跑一次（第三颗星看它们）。</p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <div class="tp__result">
        <p v-if="result && (!step || step.index === step.count - 1)" class="tp__place">{{ placeText(result) }}</p>
        <MemoryView
          :result="result"
          :step="step"
          :launch="runs[0]?.launch ?? LAUNCH"
          :controls="false"
          :knobs="false"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-8 的沙盒）。 */
.tp {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tp__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.tp__launch-label {
  color: var(--hg-ink-2);
}

.tp__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.tp__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.tp__result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.tp__place {
  margin: 0;
  color: var(--hg-ink);
  font-size: 15px;
  font-weight: 600;
}
</style>
