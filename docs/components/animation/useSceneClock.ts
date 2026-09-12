import { computed, onUnmounted, ref, type Ref } from 'vue'
import { easeInOutCubic } from './easing'

/**
 * 每一步开头的入场过渡时长（ms）。
 * 场景约定：步骤的前 TRANSITION_MS 用于元素入场，之后是静止展示，
 * 跳步落在该步末尾，确保所有入场动画已经结束。
 */
export const TRANSITION_MS = 700

/**
 * 场景时钟：单一 time（ms）驱动一切。
 * - 播放：rAF 按真实时间推进，到末尾停止。
 * - 跳步：glideTo 在约 0.4s 内把 time 快进/快退到目标（快速擦洗观感）；
 *   reduced-motion 下直接落位。
 * - 拖动擦洗：seek 直接设置 time，画面即刻呈现任意中间状态。
 * - 兜底：内嵌预览等容器可能暂停 rAF，watchdog 检测到停摆后改用
 *   定时器推进（掉帧不跳时——time 始终按真实时间差推进）。
 */
export function useSceneClock(durations: Ref<number[]>) {
  const time = ref(0)
  const playing = ref(false)
  const reducedMotion = ref(false)

  const total = computed(() => durations.value.reduce((sum, d) => sum + d, 0))

  /** 每一步的起始时刻 */
  const starts = computed<number[]>(() => {
    const out: number[] = []
    let acc = 0
    for (const d of durations.value) {
      out.push(acc)
      acc += d
    }
    return out
  })

  const stepCount = computed(() => durations.value.length)
  const stepIndex = computed(() => {
    const idx = starts.value.findIndex(start => time.value < start)
    return idx === -1 ? stepCount.value - 1 : Math.max(idx - 1, 0)
  })
  const stepLocal = computed(() => {
    const i = stepIndex.value
    return time.value - starts.value[i]
  })
  /** 本步内进度，范围 [0,1] */
  const stepProgress = computed(() => {
    const i = stepIndex.value
    return durations.value[i] > 0 ? stepLocal.value / durations.value[i] : 1
  })

  let rafId = 0
  let watchdogId: ReturnType<typeof setInterval> | undefined
  let lastFrame = 0
  let tween: { from: number; to: number; start: number; duration: number } | null = null

  function step(now: number) {
    rafId = 0
    if (tween) {
      const p = Math.min((now - tween.start) / tween.duration, 1)
      time.value = tween.from + (tween.to - tween.from) * easeInOutCubic(p)
      if (p >= 1) tween = null
    } else if (playing.value) {
      // dt 上限放宽到 250ms：定时器被重度节流的容器里仍接近真实速度推进
      const dt = Math.min(now - lastFrame, 250)
      time.value += dt
      if (time.value >= total.value) {
        time.value = total.value
        playing.value = false
        stopLoop()
        return
      }
    } else {
      stopLoop()
      return
    }
    lastFrame = now
    rafId = requestAnimationFrame(step)
  }

  function kick() {
    lastFrame = performance.now()
    if (rafId === 0) rafId = requestAnimationFrame(step)
    if (watchdogId === undefined) {
      watchdogId = setInterval(() => {
        if (!playing.value && !tween) {
          clearInterval(watchdogId)
          watchdogId = undefined
          return
        }
        // rAF 停摆超过 250ms：丢弃挂起的 rAF，改由定时器推进一帧
        if (performance.now() - lastFrame > 250) {
          if (rafId !== 0) {
            cancelAnimationFrame(rafId)
            rafId = 0
          }
          step(performance.now())
        }
      }, 66)
    }
  }

  function stopLoop() {
    if (rafId !== 0) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (watchdogId !== undefined) {
      clearInterval(watchdogId)
      watchdogId = undefined
    }
  }

  function play() {
    if (total.value <= 0) return
    playing.value = true
    tween = null
    if (time.value >= total.value - 1) time.value = 0
    kick()
  }

  function pause() {
    playing.value = false
    tween = null
    stopLoop()
  }

  function toggle() {
    if (playing.value || tween) pause()
    else play()
  }

  /** 直接跳到时间轴某点（拖动擦洗）。 */
  function seek(t: number) {
    time.value = Math.max(0, Math.min(t, total.value))
  }

  /** 平滑跳到某点：短暂快进后停在目标处并暂停。 */
  function glideTo(target: number) {
    const to = Math.max(0, Math.min(target, total.value))
    playing.value = false
    if (reducedMotion.value || Math.abs(to - time.value) < 60) {
      time.value = to
      return
    }
    tween = { from: time.value, to, start: performance.now(), duration: 420 }
    kick()
  }

  /** 跳到第 i 步：非 reduced-motion 落在过渡结束的稳定帧，并带一点快进动画。 */
  function goToStep(i: number) {
    const idx = Math.max(0, Math.min(i, stepCount.value - 1))
    const settled = starts.value[idx] + Math.max(0, durations.value[idx] - 1)
    glideTo(settled)
  }

  onUnmounted(stopLoop)

  return {
    time,
    playing,
    reducedMotion,
    total,
    starts,
    stepCount,
    stepIndex,
    stepLocal,
    stepProgress,
    play,
    pause,
    toggle,
    seek,
    glideTo,
    goToStep
  }
}
