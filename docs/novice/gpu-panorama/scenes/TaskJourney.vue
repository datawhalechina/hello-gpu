<script setup lang="ts">
/**
 * 1-2「一份活的旅程」讲解动画（关卡自己的 scenes）：拷进显存 → 启动 → 计算 → 拷回。
 *
 * 用登记过的 ScenePlayer 播放（播放、单步、拖动、键盘，离开视口就暂停），画面在 JourneyStage 里画，
 * 每一步的旁白和时长在 journey.ts（02 第 2 节：1500 ms + 旁白字数 × 60 ms）。
 * ScenePlayer 只认系统的减弱动效；读者在站点设置里关掉动效或打开简洁模式时，这里让画面只显示每一步
 * 做完的样子（02 第 4 节）。通道的名字和车间的个数从参数来，不传就是本书的 RX 9070 XT：旅程只是过程示意，
 * 不跟着读者的「我的 GPU 卡片」换（卡片里没有和 CPU 之间的通道）。
 */
import { computed } from 'vue'
import ScenePlayer from '../../../components/animation/ScenePlayer.vue'
import type { SceneMeta } from '../../../components/animation/sceneTypes.ts'
import { useProgress } from '@course/useProgress.ts'
import JourneyStage from './JourneyStage.vue'
import { journeySteps } from '../journey.ts'
import { DEFAULT_SPEC, countsOf, type ChipSpec } from '../panorama.ts'

const props = withDefaults(defineProps<{
  /** 不传就是 RX 9070 XT（hardware.json）。 */
  spec?: ChipSpec
}>(), { spec: () => DEFAULT_SPEC })

const progress = useProgress()
const still = computed(() => progress.state.prefs.reducedMotion || progress.state.prefs.plain)

/** 芯片上画几个车间：有 WGP 的卡画 WGP，没有的画计算单元（和全景图的第一层一样）。 */
const shops = computed(() => {
  const c = countsOf(props.spec)
  return c.wgps || c.cus
})

const meta = computed<SceneMeta>(() => ({
  eyebrow: '示意 · 逐个相加 1000 对数',
  title: '一份活的旅程：从 CPU 到 GPU，再回来',
  viewBox: '0 0 720 400',
  mobileViewBox: '0 0 400 560',
  note: '过程示意：动画速度不代表真实的拷贝和计算耗时。',
  steps: journeySteps(props.spec.bus),
}))
</script>

<template>
  <ScenePlayer class="gp-journey" :meta="meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <JourneyStage
        :step="step"
        :local="local"
        :compact="compact"
        :still="still || reducedMotion"
        :wgps="shops"
        :bus="spec.bus"
      />
    </template>
  </ScenePlayer>
</template>

<style scoped>
/* ScenePlayer 自己不带外边距，和本关其他卡片一样上下留 20px。 */
.gp-journey {
  margin: 20px 0;
}
</style>
