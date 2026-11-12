<script setup lang="ts">
/**
 * 1-6 的两个代码沙盒（关卡自己的 scenes，不用登记组件）：探索二「把岔路口挪到两支小队中间」和挑战「两种活」。
 *
 * - fork（探索二）：add_sub，派 1 组 64 个线程（两支小队），补分支条件；judgeFork 判过没过
 *   （探索环节，看答案不影响星级）。c、d 和线程一样多，什么条件都不会算错，只看有没有小队分岔。
 * - challenge（挑战）：two_jobs，32 个和、32 个差，派 1 组 64 个线程，补 k 和条件；judge 判三颗星，
 *   VARIANTS 换成 64 个和、64 个差、派 128 个线程再跑一次（★3）。
 * 沙盒跑完，结果插槽里先放小队板（ForkBoard：每支小队岔路口两段各几个 lane 在干活）和一句话，再放 WaveView
 * （:controls="false"，单步跟着沙盒走，点「运行」看整段的 lane 利用率）。派法是定的，旋钮区只写启动代码和说明。
 * 代码由沙盒存进这一关的草稿槽，刷新不丢；没过 2 / 4 / 6 次依次解锁提示（F-12）。
 */
import { computed, onMounted, ref } from 'vue'
import Sandbox from '@kit/Sandbox.vue'
import WaveView from '@kit/WaveView.vue'
import type { SandboxRun } from '@kit/sandbox/run.ts'
import { useChallenge } from '@course/useChallenge.ts'
import { useProgress } from '@course/useProgress.ts'
import ForkBoard from './ForkBoard.vue'
import {
  CHALLENGE_BLANKS, CHALLENGE_CODE, CHALLENGE_LAUNCH, CHALLENGE_N, FORK_BLANKS, FORK_HINTS, FORK_LAUNCH, FORK_TEMPLATE,
  HINTS, STAGE_ID, VARIANTS, WAVE, WIDE_N, forkRows, forkText, jobArgs, judge, judgeFork, laneRate, launchLine,
  type ForkRow,
} from '../challenge.ts'

const props = defineProps<{
  /** fork：探索二；challenge：本关的星级挑战 */
  part: 'fork' | 'challenge'
}>()

const isChallenge = props.part === 'challenge'
const SETUP = isChallenge
  ? {
      title: `${CHALLENGE_N} 个和、${CHALLENGE_N} 个差：谁算哪一格`,
      kernel: 'two_jobs' as const,
      code: CHALLENGE_CODE,
      blanks: CHALLENGE_BLANKS,
      launch: CHALLENGE_LAUNCH,
      args: jobArgs(CHALLENGE_N),
      variants: VARIANTS,
      judge,
      note: `派 1 组 ${CHALLENGE_LAUNCH.block} 个线程，排成 2 支小队。c 放 ${CHALLENGE_N} 个和，d 放 ${CHALLENGE_N} 个差，一个线程算一格。`
        + `点「运行」以后，同一份代码还会换成 ${WIDE_N} 个和、${WIDE_N} 个差（派 ${2 * WIDE_N} 个线程）再跑一次，看第三颗星。`,
      empty: '还没运行：补好 k 和条件，点「运行」。这里先显示每支小队在岔路口怎样走，下面一步一步看 lane。',
    }
  : {
      title: '改写岔路口的条件',
      kernel: 'add_sub' as const,
      code: FORK_TEMPLATE,
      blanks: FORK_BLANKS,
      launch: FORK_LAUNCH,
      args: jobArgs(FORK_LAUNCH.block),
      variants: [],
      judge: judgeFork,
      note: `派 1 组 ${FORK_LAUNCH.block} 个线程，排成 2 支小队：t = 0～${WAVE - 1} 是第 0 支，${WAVE}～${2 * WAVE - 1} 是第 1 支。`
        + '条件成立的线程做加法，不成立的做减法；条件里可以用 t 和整数。',
      empty: '还没运行：改好条件，点「运行」。这里先显示每支小队在岔路口怎样走，下面一步一步看 lane。',
    }

const progress = useProgress()
const challenge = isChallenge
  ? useChallenge({ stage: STAGE_ID, id: 'jobs', hints: HINTS })
  : useChallenge({ stage: STAGE_ID, id: 'fork', kind: 'explore', hints: FORK_HINTS })

/** 挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
const lang = computed(() => (mounted.value ? progress.state.prefs.lang : 'hip'))
const line = computed(() => launchLine(SETUP.kernel, SETUP.launch, lang.value))
onMounted(() => {
  mounted.value = true
})

interface Board {
  key: number
  title: string
  text: string
  rows: ForkRow[]
}

/** 单步时插槽每一步都重新渲染：同一次运行的小队板只算一次。 */
const cache = new WeakMap<readonly SandboxRun[], Board[]>()

function boardsOf(runs: readonly SandboxRun[]): Board[] {
  const hit = cache.get(runs)
  if (hit) return hit
  const out = runs.flatMap((run, i): Board[] => {
    if (!run.result.ok) return []
    const rows = forkRows(run)
    const n = run.launch.block / 2
    const title = isChallenge ? `${n} 个和、${n} 个差 · 派 ${run.launch.block} 个线程${i > 0 ? '（第三颗星看这一次）' : ''}` : ''
    return [{ key: i, title, text: forkText(rows, laneRate(run)), rows }]
  })
  cache.set(runs, out)
  return out
}
</script>

<template>
  <Sandbox
    :title="SETUP.title"
    :code="SETUP.code"
    :blanks="SETUP.blanks"
    :launch="SETUP.launch"
    :args="SETUP.args"
    :variants="SETUP.variants"
    :judge="SETUP.judge"
    :challenge="challenge"
    :file="SETUP.kernel"
  >
    <template #controls>
      <div class="fs">
        <p class="fs__launch">
          <span class="fs__launch-label">启动时这样写：</span>
          <code translate="no">{{ line }}</code>
        </p>
        <p class="fs__note">{{ SETUP.note }}</p>
      </div>
    </template>
    <template #result="{ result, step, runs, source, lang: ran }">
      <div class="fs__out">
        <section v-for="b in boardsOf(runs)" :key="b.key" class="fs__board" :aria-label="b.title || '每支小队在岔路口怎样走'">
          <p v-if="b.title" class="fs__board-title">{{ b.title }}</p>
          <p class="fs__board-text">{{ b.text }}</p>
          <ForkBoard :rows="b.rows" :size="WAVE" />
        </section>
        <WaveView
          :result="result"
          :step="step"
          :launch="runs[0]?.launch ?? SETUP.launch"
          :source="source"
          :lang="ran ?? lang"
          :controls="false"
          :file="SETUP.kernel"
          :empty-text="SETUP.empty"
        />
      </div>
    </template>
  </Sandbox>
</template>

<style scoped>
/* 沙盒的旋钮区是横排换行的（.hg-sandbox__controls），这一块占满一行：启动代码、说明上下排（同 1-4 的沙盒）。 */
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

.fs__out {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.fs__board {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.fs__board-title {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
}

.fs__board-text {
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .fs__board {
    padding: 10px;
  }
}
</style>
