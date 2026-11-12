/**
 * 1-2「一份活的旅程」讲解动画：每一步说什么，每一帧画什么（纯函数，单测在 scripts/tests/novice-gpu-panorama.test.mjs）。
 *
 * 例子是新手村的向量加法：c[i] = a[i] + b[i]，1000 对数。一份活从 CPU 交给 GPU，走四站（大纲的核心交互）：
 * ① 拷进显存：a、b 从 CPU 的内存（主机内存），经过显卡和 CPU 之间的通道，拷进显存；
 * ② 启动：CPU 把工作单（下一关叫它 kernel）交给 GPU，工作单分到各个车间；
 * ③ 计算：车间里的 lane 从显存取 a[i]、b[i]，相加，把 c[i] 写回显存；CPU 在等它算完；
 * ④ 拷回：c 从显存拷回 CPU 的内存，CPU 才能用它。
 * 四站前面还有一步「出发前」：ScenePlayer 一打开显示的是第一步做完的样子，出发前的样子放在第一步，
 * 读者点「播放」就能从拷进显存看起。
 *
 * 「主机」「设备」这两个名字到正文的「原理」才给（03 第 1 节第 5 条），动画里只说「CPU 这边」「GPU 这边」。
 *
 * 画面是时间的纯函数（02 第 5 节）：journeyFrame(step, local) 只看第几步、这一步过了多少毫秒，
 * 拖动进度条、跳步都等于换一对输入。每一步的结尾是这一步做完的样子（减弱动效时直接显示它）。
 * 动画速度和真实的拷贝、计算耗时无关，场景的说明里写明了（02 第 3 节「速度声明」）。
 */
import { seg, segE } from '../../components/animation/easing.ts'

/** 02 第 2 节：讲解动画每步 1500 ms + 旁白字数 × 60 ms，上限 8 s（tokens.css 的 --motion-step-*）。 */
export function stepDuration(narration: string): number {
  return Math.min(8000, 1500 + narration.length * 60)
}

export interface JourneyStep {
  label: string
  title: string
  narration: string
  duration: number
}

/** 第几步（ScenePlayer 的 step）。 */
export const STEP = { ready: 0, copyIn: 1, launch: 2, compute: 3, copyOut: 4 } as const

/** 出发前 + 四站的文字。通道的名字（PCIe 5.0 x16）从参数来，不手写（09 第 4 节）。 */
export function journeySteps(bus?: string): JourneyStep[] {
  const road = bus ? `经过显卡和 CPU 之间的通道（${bus}）` : '经过显卡和 CPU 之间的通道'
  const steps = [
    {
      label: '出发前',
      title: '出发前',
      narration: 'a、b 两排数在 CPU 的内存里，显存还是空的。点「播放」，跟着这份活走一趟。',
    },
    {
      label: '拷进显存',
      title: '① 拷进显存',
      narration: `a、b 从 CPU 的内存出发，${road}，拷进显存。GPU 干活时从显存里取数据。`,
    },
    {
      label: '启动',
      title: '② 启动',
      narration: 'CPU 把工作单交给 GPU，这一步叫启动。工作单发到各个车间，每个工位照着它算自己那一对数。',
    },
    {
      label: '计算',
      title: '③ 计算',
      narration: '工位从显存取来 a[i]、b[i]，放进手边的寄存器，相加，再把 c[i] 写回显存。CPU 在等它算完。',
    },
    {
      label: '拷回',
      title: '④ 拷回',
      narration: 'c 从显存拷回 CPU 的内存。拷回来以后，CPU 才能用 c：打印、检查，或者交给下一步。',
    },
  ]
  return steps.map((s) => ({ ...s, duration: stepDuration(s.narration) }))
}

/** 路上的东西：三排数和一张工作单。t 是走了多少（0 出发，1 到达）。 */
export interface Packet {
  id: 'a' | 'b' | 'c' | 'order'
  /** in：CPU → GPU；out：GPU → CPU。 */
  dir: 'in' | 'out'
  t: number
}

export interface JourneyFrame {
  /** CPU 的内存里每排数有多满（0–1）：a、b 一直在；c 拷回来才有。 */
  host: { a: number; b: number; c: number }
  /** 显存里每排数有多满：a、b 拷进来才有；c 计算时一点点写满。 */
  vram: { a: number; b: number; c: number }
  /** 正在路上的东西（到了就不在路上了）。 */
  packets: Packet[]
  /** 工作单分到车间的程度（0–1）：车间一间间亮起来。 */
  dispatched: number
  /** 车间在算：读、写的箭头和亮着的工位。 */
  computing: boolean
  /** CPU 在等 GPU 算完。 */
  waiting: boolean
}

/** 每一步里几件事的时刻（毫秒，从这一步开始算）。a、b 是一组同类元素，错开 40 ms（02 第 3 节）。 */
export const TIMES = {
  copyIn: { a: [300, 1700], b: [340, 1740], land: 200 },
  launch: { order: [300, 1500], dispatch: [1500, 2500] },
  compute: { start: 300, fill: [600, 2600] },
  copyOut: { c: [300, 1700], land: 200 },
} as const

/** step 是第几步（0–4，见 STEP），local 是这一步开始后过了多少毫秒（可以超出这一步的时长，按做完算）。 */
export function journeyFrame(step: number, local: number): JourneyFrame {
  const at = Number.isFinite(local) ? Math.max(0, local) : local > 0 ? Number.POSITIVE_INFINITY : 0
  const s = Math.max(STEP.ready, Math.min(STEP.copyOut, Math.floor(step)))
  const frame: JourneyFrame = {
    host: { a: 1, b: 1, c: 0 },
    vram: { a: 0, b: 0, c: 0 },
    packets: [],
    dispatched: 0,
    computing: false,
    waiting: false,
  }
  // 前面几步已经做完的样子
  if (s > STEP.copyIn) {
    frame.vram.a = 1
    frame.vram.b = 1
  }
  if (s > STEP.launch) frame.dispatched = 1
  if (s > STEP.compute) frame.vram.c = 1

  if (s === STEP.copyIn) {
    const { a, b, land } = TIMES.copyIn
    const ta = segE(at, a[0], a[1])
    const tb = segE(at, b[0], b[1])
    if (ta > 0 && ta < 1) frame.packets.push({ id: 'a', dir: 'in', t: ta })
    if (tb > 0 && tb < 1) frame.packets.push({ id: 'b', dir: 'in', t: tb })
    frame.vram.a = seg(at, a[1], a[1] + land)
    frame.vram.b = seg(at, b[1], b[1] + land)
  } else if (s === STEP.launch) {
    const { order, dispatch } = TIMES.launch
    const t = segE(at, order[0], order[1])
    if (t > 0 && t < 1) frame.packets.push({ id: 'order', dir: 'in', t })
    frame.dispatched = seg(at, dispatch[0], dispatch[1])
  } else if (s === STEP.compute) {
    const { start, fill } = TIMES.compute
    frame.vram.c = seg(at, fill[0], fill[1])
    frame.computing = at >= start && frame.vram.c < 1
    frame.waiting = frame.vram.c < 1
  } else if (s === STEP.copyOut) {
    const { c, land } = TIMES.copyOut
    const t = segE(at, c[0], c[1])
    if (t > 0 && t < 1) frame.packets.push({ id: 'c', dir: 'out', t })
    frame.host.c = seg(at, c[1], c[1] + land)
  }
  return frame
}
