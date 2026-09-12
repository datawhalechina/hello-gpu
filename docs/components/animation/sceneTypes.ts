/**
 * 场景系统的公共类型。
 *
 * 一个「场景」= 元信息（SceneMeta）+ 一个纯渲染组件。
 * 渲染组件只接收 (step, local) 两个 props，把当前画面表达为
 * 这两个量的确定性函数——因此时间轴上任意一点都可以被精确重放
 * （拖动擦洗、快速跳步都等价于换一对输入）。
 */
export interface SceneStep {
  /** 控制条步骤胶囊上的短标签 */
  label: string
  /** 旁白条中的步骤标题 */
  title: string
  /** 旁白：这一步学习者应该看到 / 理解什么 */
  narration: string
  /** 本步时长（ms），含开头 TRANSITION_MS 的入场过渡；缺省 2600 */
  duration?: number
}

export interface SceneMeta {
  /** 场景分类标签（播放器左上角小字） */
  eyebrow: string
  /** 场景标题 */
  title: string
  /** 舞台 viewBox，如 '0 0 720 400' */
  viewBox: string
  /** Optional stacked composition for narrow screens. */
  mobileViewBox?: string
  steps: SceneStep[]
}
