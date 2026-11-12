<script setup lang="ts">
/**
 * 1-4 的两个代码沙盒（关卡自己的 scenes，不用登记组件）：探索二「写出拿数的规则」和挑战「13 对数」。
 *
 * 旋钮定每组几个线程、派几组，下面一行是这样派写出来的启动代码（1-2 定的写法，跟着写法偏好）；
 * 沙盒里补空，结果交给 RobotGrid。代码由沙盒存进这一关的草稿槽，旋钮的值存在同一份草稿的 params 里，刷新不丢。
 * - rule（探索二）：10 对数，补 i；judgeRule 判过没过（探索环节，看答案不影响星级）。
 * - challenge（挑战）：13 对数，补 i 和写入前的条件；judge 判三颗星，variants 换另外两种每组线程数再跑（★3）。
 * 旋钮一动，派法写进草稿；沙盒读到草稿换了，就把上一次的结果收起来，机器人按新的派法排好、待命，再点「运行」看新的结果
 * （同 1-3 的挑战）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import Knob from '@kit/Knob.vue'
import RobotGrid from '@kit/RobotGrid.vue'
import Sandbox from '@kit/Sandbox.vue'
import type { Launch } from '@kit/sandbox/run.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import {
  BLOCK_DIMS, CHALLENGE_BLANKS, CHALLENGE_CODE, CHALLENGE_GRID_MAX, CHALLENGE_LAUNCH, CHALLENGE_N, EXPLORE_GRID_MAX,
  EXPLORE_LAUNCH, EXPLORE_N, HINTS, RULE_BLANKS, RULE_CODE, RULE_HINTS, STAGE_ID, addArgs, judge, judgeRule,
  launchLine, normalizeLaunch, variantsFor,
} from '../challenge.ts'

const props = defineProps<{
  /** rule：探索二；challenge：本关的星级挑战 */
  part: 'rule' | 'challenge'
}>()

const isChallenge = props.part === 'challenge'
const SETUP = isChallenge
  ? {
      title: `${CHALLENGE_N} 对数：派几组，各拿哪一格`,
      code: CHALLENGE_CODE,
      blanks: CHALLENGE_BLANKS,
      n: CHALLENGE_N,
      gridMax: CHALLENGE_GRID_MAX,
      launch: CHALLENGE_LAUNCH,
      judge,
      empty: '还没运行：定好每组几个线程、派几组，补好 i 和条件，再点「运行」。',
    }
  : {
      title: `${EXPLORE_N} 对数：写出拿数的规则`,
      code: RULE_CODE,
      blanks: RULE_BLANKS,
      n: EXPLORE_N,
      gridMax: EXPLORE_GRID_MAX,
      launch: EXPLORE_LAUNCH,
      judge: judgeRule,
      empty: '还没运行：把 i 改对，再点「运行」。',
    }

const progress = useProgress()
const challenge = isChallenge
  ? useChallenge({ stage: STAGE_ID, id: 'groups', hints: HINTS })
  : useChallenge({ stage: STAGE_ID, id: 'rule', kind: 'explore', hints: RULE_HINTS })

const ARGS = addArgs(SETUP.n)
const BLOCK_OPTIONS = [...BLOCK_DIMS]

const block = ref(SETUP.launch.block)
const grid = ref(SETUP.launch.grid)
const launch = computed<Launch>(() => ({ grid: grid.value, block: block.value }))
const variants = computed(() => (isChallenge ? variantsFor(launch.value) : []))

watch(launch, (value) => {
  const draft = challenge.draft.value
  const base = draft && typeof draft === 'object' && !Array.isArray(draft) ? (draft as Record<string, unknown>) : {}
  challenge.draft.value = { ...base, params: { ...value } }
})

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine(launch.value, lang.value))

// 草稿槽在 useChallenge 挂载时读出来（它的 onMounted 先登记），这里接着把上次的派法放回去。
onMounted(() => {
  const draft = challenge.draft.value as { params?: unknown } | null
  const saved = normalizeLaunch(draft?.params, SETUP.launch, SETUP.gridMax)
  block.value = saved.block
  grid.value = saved.grid
  mounted.value = true
})
</script>

<template>
  <Sandbox
    :title="SETUP.title"
    :code="SETUP.code"
    :blanks="SETUP.blanks"
    :launch="launch"
    :args="ARGS"
    :variants="variants"
    :judge="SETUP.judge"
    :challenge="challenge"
    file="add"
  >
    <template #controls>
      <div class="gs">
        <div class="gs__knobs">
          <Knob label="每组几个线程" code="blockDim.x" :options="BLOCK_OPTIONS" unit=" 个" v-model="block" />
          <Knob label="派几组" code="gridDim.x" :min="1" :max="SETUP.gridMax" unit=" 组" v-model="grid" />
        </div>
        <p class="gs__launch">
          <span class="gs__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="gs__note">
          一共派出 {{ grid * block }} 个线程，n 是 {{ SETUP.n }}。下标可以用 blockIdx.x、blockDim.x、threadIdx.x 和整数。
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
        :empty-text="SETUP.empty"
      />
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：旋钮、启动代码、说明上下排（同 1-3 的挑战）。 */
.gs {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.gs__knobs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
}

.gs__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.gs__launch-label {
  color: var(--hg-ink-2);
}

.gs__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.gs__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}
</style>
