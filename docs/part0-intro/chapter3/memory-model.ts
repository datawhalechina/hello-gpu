// 教学状态模型：数值用于手算，时间仅控制动画，不表示 GPU 延迟。
export const JOURNEY_INPUT = Object.freeze({ index: 2, a: 3, b: 30 })
export const JOURNEY_DURATIONS = Object.freeze([4200, 4600, 4600, 4600, 4600])
export const TRANSFER_COMPLETE_MS = 1600
export const ADDITION_COMPLETE_MS = 800

export function journeyState(step: number, local: number, reducedMotion = false) {
  if (!Number.isInteger(step) || step < 0 || step >= JOURNEY_DURATIONS.length) {
    throw new RangeError('数据旅程共有五个步骤，编号为 0～4')
  }
  if (!Number.isFinite(local) || local < 0) {
    throw new RangeError('步骤内时间必须为非负有限数')
  }
  const progress = reducedMotion ? 1 : Math.min(local / TRANSFER_COMPLETE_MS, 1)
  const phaseComplete = progress === 1
  const operandsReady = step > 2 || (step === 2 && phaseComplete)
  const additionDone = step > 3 || (step === 3 && (reducedMotion || local >= ADDITION_COMPLETE_MS))
  const resultReady = step > 3 || (step === 3 && phaseComplete)
  const outputReady = step === 4 && phaseComplete

  return {
    step,
    progress,
    sourceA: JOURNEY_INPUT.a,
    sourceB: JOURNEY_INPUT.b,
    requestIssued: step >= 1,
    waitingForInputs: step === 1 || (step === 2 && !operandsReady),
    operandsReady,
    operandA: operandsReady ? JOURNEY_INPUT.a : null,
    operandB: operandsReady ? JOURNEY_INPUT.b : null,
    additionDone,
    arithmeticResult: additionDone ? JOURNEY_INPUT.a + JOURNEY_INPUT.b : null,
    resultReady,
    temporaryResult: resultReady ? JOURNEY_INPUT.a + JOURNEY_INPUT.b : null,
    outputReady,
    output: outputReady ? JOURNEY_INPUT.a + JOURNEY_INPUT.b : null,
    cpuReceived: false
  }
}

export function journeyCopy(local: number, reducedMotion = false) {
  // A single bounded progress value keeps drawing and semantic state aligned.
  const progress = reducedMotion ? 1 : Math.min(Math.max(local / TRANSFER_COMPLETE_MS, 0), 1)
  return 1 - Math.pow(1 - progress, 3)
}
