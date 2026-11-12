<script setup lang="ts">
/**
 * 1-3 的挑战「给 12 对数派活」（关卡自己的 scenes，不用登记组件）。
 *
 * 旋钮定派几个线程（8 / 12 / 16 / n），下面一行是这种派法写出来的启动代码（1-2 定的写法，跟着写法偏好）；
 * 沙盒里补 i，结果交给 RobotGrid。判星用 challenge.ts 的 judge：读者设的那一次跑 12 个数，
 * variants 再拿 20 个数、按同样的派法跑一次（★3）。没过的次数驱动沙盒下面的提示阶梯（F-12）。
 * 代码由沙盒存进这一关的草稿槽，旋钮的值存在同一份草稿的 params 里，刷新不丢。
 */
import { computed, onMounted, ref, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import RobotGrid from '@kit/RobotGrid.vue'
import Sandbox from '@kit/Sandbox.vue'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  CHALLENGE_N, DEFAULT_THREADS, HINTS, OWN_CELL_BLANKS, OWN_CELL_CODE, STAGE_ID, THREAD_CHOICES,
  addArgs, challengeLaunch, challengeVariants, judge, launchLine, normalizeThreads, type ThreadChoice,
} from '../challenge.ts'

const progress = useProgress()
const challenge = useChallenge({ stage: STAGE_ID, id: 'assign', hints: HINTS })

const ARGS = addArgs(CHALLENGE_N)
const OPTIONS = THREAD_CHOICES.map((value) => ({ value, label: String(value) }))

const threads = ref<ThreadChoice>(DEFAULT_THREADS)
const launch = computed(() => challengeLaunch(threads.value))
const variants = computed(() => challengeVariants(threads.value))

watch(threads, (value) => {
  const draft = challenge.draft.value
  const base = draft && typeof draft === 'object' && !Array.isArray(draft) ? (draft as Record<string, unknown>) : {}
  challenge.draft.value = { ...base, params: { threads: value } }
})

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine(threads.value, lang.value))

// 草稿槽在 useChallenge 挂载时读出来（它的 onMounted 先登记），这里接着把上次的派法放回去。
onMounted(() => {
  const draft = challenge.draft.value as { params?: { threads?: unknown } } | null
  threads.value = normalizeThreads(draft?.params?.threads)
  mounted.value = true
})
</script>

<template>
  <Sandbox
    title="12 对数：派几个线程，各算哪一格"
    :code="OWN_CELL_CODE"
    :blanks="OWN_CELL_BLANKS"
    :launch="launch"
    :args="ARGS"
    :variants="variants"
    :judge="judge"
    :challenge="challenge"
    file="add"
  >
    <template #controls>
      <div class="ac">
        <Knob label="派几个线程" :options="OPTIONS" unit=" 个" v-model="threads" />
        <p class="ac__launch">
          <span class="ac__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="ac__note">
          1 是派 1 组（分组下一关再讲），后面是这一组派几个线程；n 是数据的个数，这次是 {{ CHALLENGE_N }}。
        </p>
      </div>
    </template>
    <template #result="{ result, step, runs }">
      <RobotGrid
        :result="result"
        :step="step"
        :launch="runs[0]?.launch ?? launch"
        array="c"
        :controls="false"
        empty-text="还没运行：机器人按旋钮排好了，补好 i 再点「运行」。"
      />
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：旋钮、启动代码、说明上下排。 */
.ac {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.ac__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.ac__launch-label {
  color: var(--hg-ink-2);
}

.ac__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ac__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}
</style>
