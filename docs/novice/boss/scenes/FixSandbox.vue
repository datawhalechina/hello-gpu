<script setup lang="ts">
/**
 * Boss 挑战一的三道修复题（关卡自己的 scenes，不用登记组件）：part 选第一、二、三张。
 *
 * 代码沙盒补空，点「运行」以后同一份代码再按 variants 换一批数据或者换一种派法跑一次（写死的数过不了）。
 * judgeFix 判这道题过没过：这是一道分题（useChallenge 的 part）：记次数、给提示，没过 2 / 4 / 6 次依次解锁，
 * 看答案以后本关最高 2 星，可它自己不发星。跑完以后把这道题这次的结果（fixRecord）报给本关（useBoss），
 * 本关的三颗星由几道分题合起来判。代码由沙盒存进这道题的草稿，刷新不丢。
 * 结果插槽：第一张放 RobotGrid（每个线程写了哪一格，写到外面的放进越界区），第二张放 WaveView（lane 利用率），
 * 第三张放 MemoryView（一支小队每次读写搬几车）。单步交给沙盒。
 */
import { computed, onMounted, ref } from 'vue'
import MemoryView from '@kit/MemoryView.vue'
import RobotGrid from '@kit/RobotGrid.vue'
import Sandbox from '@kit/Sandbox.vue'
import WaveView from '@kit/WaveView.vue'
import type { SandboxOutcome, SandboxRun } from '@kit/sandbox/run.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import { FIX_HINTS, FIX_NAMES, FIXES, STAGE_ID, WAVE, fixRecord, judgeFix, launchLine, type FixPart } from '../challenge.ts'
import type { Boss } from './useBoss.ts'

const props = defineProps<{
  part: FixPart
  /** 本关的三颗星（页面上 useBoss 的返回值）：这道题跑完以后报给它 */
  boss: Boss
}>()

const setup = FIXES[props.part]
const challenge = useChallenge({ stage: STAGE_ID, id: `fix-${props.part}`, kind: 'part', hints: FIX_HINTS[props.part] })

const TITLES: Readonly<Record<FixPart, string>> = {
  oob: '别让线程写到 c 外面',
  fork: '让每支小队整队走一边',
  stride: '让相邻的线程拿相邻的数',
}
const title = `${FIX_NAMES[props.part]}：${TITLES[props.part]}`
const threads = setup.launch.grid * setup.launch.block
const NOTES: Readonly<Record<FixPart, string>> = {
  oob: `c 有 ${setup.n} 格，派 ${setup.launch.grid} 组、每组 ${setup.launch.block} 个线程，一共 ${threads} 个。`,
  fork: `c、d 各 ${setup.n} 格，派 ${setup.launch.grid} 组、每组 ${setup.launch.block} 个线程：一组正好一支小队。空里可以用 t、n、half、blockIdx.x、threadIdx.x 和整数。`,
  stride: `${setup.n} 个数，派 ${setup.launch.grid} 组、每组 ${setup.launch.block} 个线程，一个线程算一个数。`,
}
const note = `${NOTES[props.part]}点「运行」以后，同一份代码还会${setup.variantText}再跑一次。`
const EMPTY: Readonly<Record<FixPart, string>> = {
  oob: '还没运行：改好条件，点「运行」。这里显示每个线程写了 c 的哪一格，写到外面的放进越界区。',
  fork: `还没运行：补好 k 和条件，点「运行」。这里一步一步显示每支小队的 ${WAVE} 个 lane 哪些在干活。`,
  stride: '还没运行：改好下标，点「运行」。这里显示一支小队每次读写显存要哪些地址、搬几车。',
}

/** 沙盒的 judge：这道题自己的判定。 */
const judge = (runs: SandboxRun[]) => judgeFix(props.part, runs)

const progress = useProgress()
/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const line = computed(() => launchLine(props.part, mounted.value ? progress.state.prefs.lang : 'hip'))
onMounted(() => {
  mounted.value = true
})

function onResult(outcome: SandboxOutcome) {
  props.boss.report({ [props.part]: fixRecord(props.part, outcome.runs) })
}
</script>

<template>
  <Sandbox
    :title="title"
    :code="setup.code"
    :blanks="setup.blanks"
    :launch="setup.launch"
    :args="setup.args"
    :variants="setup.variants"
    :judge="judge"
    :challenge="challenge"
    :file="setup.kernel"
    @result="onResult"
  >
    <template #controls>
      <div class="fx">
        <p class="fx__launch">
          <span class="fx__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="fx__note">{{ note }}</p>
      </div>
    </template>
    <template #result="{ result, step, runs, source, lang: ran }">
      <RobotGrid
        v-if="part === 'oob'"
        :result="result"
        :step="step"
        :launch="runs[0]?.launch ?? setup.launch"
        array="c"
        :controls="false"
        :empty-text="EMPTY.oob"
      />
      <WaveView
        v-else-if="part === 'fork'"
        :result="result"
        :step="step"
        :launch="runs[0]?.launch ?? setup.launch"
        :source="source"
        :lang="ran"
        :controls="false"
        :file="setup.kernel"
        :empty-text="EMPTY.fork"
      />
      <MemoryView
        v-else
        :result="result"
        :step="step"
        :launch="runs[0]?.launch ?? setup.launch"
        :controls="false"
        :knobs="false"
        :empty-text="EMPTY.stride"
      />
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-6 的沙盒）。 */
.fx {
  display: flex;
  flex: 1 1 100%;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.fx__launch {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 0;
  font-size: 14px;
}

.fx__launch-label {
  color: var(--hg-ink-2);
}

.fx__launch code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.fx__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}
</style>
