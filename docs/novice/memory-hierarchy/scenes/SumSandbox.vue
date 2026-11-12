<script setup lang="ts">
/**
 * 1-7 的挑战「4 排数加起来」（关卡自己的 scenes，不用登记组件）。
 *
 * add_rows：a 里 4 排数，每排 32 个；派 1 组 32 个线程，第 t 个线程把每排的第 t 个数加起来存进 out[t]。
 * 工作单里备好了工具台的 s（寄存器）、货架上的 box（LDS）、仓库里的 out（显存），读者补两个空：循环里把和加在哪，
 * 最后把哪里的和存进 out[t]。judge 判三颗星；结果插槽里放 TripBoard：这支小队去仓库、货架各跑了几趟，
 * 往返代价多少（模拟），单步时跟着数到这一步。派法是定的，旋钮区只写启动代码和说明。
 * 代码由沙盒存进这一关的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12）。
 */
import { computed, onMounted, ref } from 'vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import TripBoard from './TripBoard.vue'
import { HINTS, STAGE_ID, SUM_BLANKS, SUM_CODE, SUM_LAUNCH, SUM_M, SUM_N, judge, launchLine, rowsArgs } from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: STAGE_ID, id: 'rows', hints: HINTS })
const ARGS = rowsArgs()

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine(lang.value))
onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <Sandbox
    :title="`${SUM_M} 排数加起来：和加在哪`"
    :code="SUM_CODE"
    :blanks="SUM_BLANKS"
    :launch="SUM_LAUNCH"
    :args="ARGS"
    :judge="judge"
    :challenge="challenge"
    file="add_rows"
  >
    <template #controls>
      <div class="ss">
        <p class="ss__launch">
          <span class="ss__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="ss__note">a 里 {{ SUM_M }} 排数，每排 {{ SUM_N }} 个，第 k 排的第 t 个数在 <code translate="no">a[k * n + t]</code>。派 1 组 {{ SUM_N }} 个线程，第 t 个线程把每排的第 t 个数加起来，存进 <code translate="no">out[t]</code>。a、out 都在显存里，已经拷进来了。</p>
      </div>
    </template>
    <template #result="{ result, step }">
      <TripBoard :result="result" :step="step" />
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-6 的沙盒）。 */
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
</style>
