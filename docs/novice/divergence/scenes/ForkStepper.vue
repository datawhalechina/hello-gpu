<script setup lang="ts">
/**
 * 1-6 探索一「两拨先后走」（关卡自己的 scenes，不用登记组件）。
 *
 * 派 1 组 32 个线程，正好一支小队，跑热身里那张工作单（偶数号的线程做加法、奇数号的做减法，challenge.ts 的
 * FORK_CODE）。结果交给 WaveView 逐步播放：代码里亮起的是这一步的行，右边是这一步哪些 lane 在干活。
 * 挂载以后在 Web Worker 里跑（docs/sim/client.ts）；换写法就按新写法重跑，WaveView 跟着换代码。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import WaveView from '@kit/WaveView.vue'
import { buildRequest } from '@kit/sandbox/run.ts'
import { createSimClient, type SimClient } from '@sim/client.ts'
import type { RunResult } from '@sim/lockstep.ts'
import type { Lang } from '@sim/syntax/ast.ts'
import { useProgress } from '@course/useProgress.ts'
import { FORK_CODE, STEP_LAUNCH, jobArgs } from '../challenge.ts'

const progress = useProgress()
/** 跑完的一次：结果和跑的是哪种写法（WaveView 按它显示代码，行号和事件对得上） */
const run = shallowRef<{ result: RunResult; lang: Lang } | null>(null)
const problem = ref('')
let client: SimClient | null = null
/** 还没跑完时代码区文件名栏跟着写法偏好；挂载之前（服务端渲染、水合）按 HIP 写，和沙盒一样。 */
const mounted = ref(false)
const pref = computed<Lang>(() => (mounted.value ? progress.state.prefs.lang : 'hip'))

async function simulate() {
  if (!client) return
  const lang = progress.state.prefs.lang
  try {
    const result = await client.run(buildRequest(FORK_CODE[lang], lang, STEP_LAUNCH, jobArgs(STEP_LAUNCH.block)))
    run.value = { result, lang }
    problem.value = ''
  } catch (err) {
    // 一个 client 同时只跑一次：连着换写法时，上一次以 AbortError 结束，不算出错
    if ((err as Error).name !== 'AbortError') problem.value = `模拟器没跑起来：${(err as Error).message}。刷新页面再试一次。`
  }
}

watch(() => progress.state.prefs.lang, simulate)

onMounted(() => {
  mounted.value = true
  client = createSimClient()
  simulate()
})

onBeforeUnmount(() => client?.dispose())
</script>

<template>
  <div class="fk">
    <p v-if="problem" class="fk__problem" role="alert">{{ problem }}</p>
    <WaveView
      :result="run?.result ?? null"
      :launch="STEP_LAUNCH"
      :source="run ? FORK_CODE[run.lang] : null"
      :lang="run?.lang ?? pref"
      file="add_sub"
      empty-text="模拟器准备中……准备好以后，这里一步一步显示这支小队的 32 个 lane：哪些在干活，哪些在空转。"
    />
  </div>
</template>

<style scoped>
.fk {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 20px 0;
}

.fk__problem {
  margin: 0;
  color: var(--hg-error-ink);
  font-size: 15px;
}
</style>
