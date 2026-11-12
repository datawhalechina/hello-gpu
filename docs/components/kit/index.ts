import { defineAsyncComponent, type App } from 'vue'
import ScenePlayer from '../animation/ScenePlayer.vue'
import AgentConsole from './AgentConsole.vue'
import Checkpoint from './Checkpoint.vue'
import ConceptCard from './ConceptCard.vue'
import DeepDive from './DeepDive.vue'
import EvidenceCard from './EvidenceCard.vue'
import HintLadder from './HintLadder.vue'
import Knob from './Knob.vue'
import LangCode from './LangCode.vue'
import Mascot from './Mascot.vue'
import MemoryView from './MemoryView.vue'
import Mission from './Mission.vue'
import Predict from './Predict.vue'
import RobotGrid from './RobotGrid.vue'
import RouteBlock from './RouteBlock.vue'
import Sandbox from './Sandbox.vue'
import Solution from './Solution.vue'
import ThreadBot from './ThreadBot.vue'
import WaveView from './WaveView.vue'

/**
 * 新版内容组件的全局注册入口（09 第 1 节）：组件在这里注册一次，关卡 Markdown 里直接写
 * <Mission …/>，不用 import。主题入口 docs/.vitepress/theme/index.ts 的 enhanceApp 调用它。
 * 组件随后续任务逐个加入。
 *
 * ScenePlayer 还在 docs/components/animation/（旧版章节页按相对路径 import 它，配色不变），
 * 这里只是把同一个组件接进 kit：新版页面直接写 <ScenePlayer :meta="…">，在 .hg-shell 里换成
 * v2 设计 token（F-08）。局部 import 优先于全局注册，旧版页面不受影响。
 *
 * AgentCode、LlmSettings 只有 1-14 用（A-02、A-03），LabCard 只有真卡关卡和真卡副本用（L-02），DeviceCard 只有 2-1 和
 * 「我的成长」页用（L-07），ExternalProblem 只有外部题索引和题解页用（X-08，它带着外部题数据），注册成异步组件：
 * 它们的代码单独成块，只有用到它们的页面才加载，不占每个页面的首屏 JS（09 第 6 节的预算）；服务端渲染照常把它们渲染出来。
 */
export function registerKit(app: App) {
  app.component('Mascot', Mascot)
  app.component('ThreadBot', ThreadBot)
  app.component('Mission', Mission)
  app.component('Predict', Predict)
  app.component('Knob', Knob)
  app.component('DeepDive', DeepDive)
  app.component('ScenePlayer', ScenePlayer)
  app.component('ConceptCard', ConceptCard)
  app.component('Checkpoint', Checkpoint)
  app.component('EvidenceCard', EvidenceCard)
  app.component('LangCode', LangCode)
  app.component('RouteBlock', RouteBlock)
  app.component('HintLadder', HintLadder)
  app.component('Sandbox', Sandbox)
  app.component('RobotGrid', RobotGrid)
  app.component('WaveView', WaveView)
  app.component('MemoryView', MemoryView)
  app.component('Solution', Solution)
  app.component('AgentConsole', AgentConsole)
  // 不能静态导入：静态导入会把它们打进每个页面都要加载的主题块（见上面的说明）
  app.component('AgentCode', defineAsyncComponent(() => import('./AgentCode.vue')))
  app.component('LlmSettings', defineAsyncComponent(() => import('./LlmSettings.vue')))
  app.component('LabCard', defineAsyncComponent(() => import('./LabCard.vue')))
  app.component('DeviceCard', defineAsyncComponent(() => import('./DeviceCard.vue')))
  app.component('ExternalProblem', defineAsyncComponent(() => import('./ExternalProblem.vue')))
}
