/**
 * 硬件参数（hardware.json，09 第 4 节）的类型化读取：正文和组件从这里拿参数，不手写。
 *
 * 每个参数都带出处：source 指向 sources 里的一条，where 写在出处的哪个位置。查不到的值是 PENDING
 * （「[待实测]」），页面上照样显示这几个字。scripts/course/course-data-check.mjs 检查这份数据。
 */
import hardwareData from './hardware.json' with { type: 'json' }

/** 查不到出处时写的值（09 第 4 节）。 */
export const PENDING = '[待实测]'

export interface HardwareSource {
  title: string
  url: string
  /** 最近一次核对出处的日期。 */
  checked: string
}

export type ParamValue = number | string | readonly number[]

export interface HardwareParam {
  /** 中文名，显示在「这些数从哪来」里。 */
  label: string
  value: ParamValue
  /** 单位照出处的写法（MB、MiB、GB……）。 */
  unit?: string
  /** sources 里的键；值是 PENDING 时没有。 */
  source?: string
  /** 在出处的哪个位置找到这个数。 */
  where?: string
}

export interface HardwareDevice {
  name: string
  params: Record<string, HardwareParam>
}

export const HARDWARE_SOURCES = hardwareData.sources as Record<string, HardwareSource>
export const HARDWARE_DEVICES = hardwareData.devices as Record<string, HardwareDevice>

/** 本书的实验卡（旧版第 0 章 0.3 节）。读者没有导入自己的 GPU 卡片时，全景图和正文都用它。 */
export const DEFAULT_DEVICE_ID = 'rx-9070-xt'

export function deviceById(id: string): HardwareDevice | undefined {
  return Object.hasOwn(HARDWARE_DEVICES, id) ? HARDWARE_DEVICES[id] : undefined
}

export function sourceOf(param: HardwareParam | undefined): HardwareSource | null {
  if (!param?.source || !Object.hasOwn(HARDWARE_SOURCES, param.source)) return null
  return HARDWARE_SOURCES[param.source]
}

/** 参数写成一句话里的样子：「64 个」「128 KB」「32 或 64 个线程」「GDDR6」「[待实测]」。数字和单位之间空一格（05 第 7 节）。 */
export function formatParam(param: HardwareParam | undefined): string {
  if (!param || param.value === PENDING) return PENDING
  const value = Array.isArray(param.value) ? param.value.join(' 或 ') : String(param.value)
  return param.unit ? `${value} ${param.unit}` : value
}

/** 显存字节数换成 GiB，保留一位小数（同 hg.device_card() 打印的「显存：15.9 GiB」）：「我的 GPU 卡片」和全景图都这样写。 */
export function memoryGiB(bytes: number): number {
  return Number((bytes / 2 ** 30).toFixed(1))
}
