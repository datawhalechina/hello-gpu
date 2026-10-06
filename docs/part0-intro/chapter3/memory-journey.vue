<script setup lang="ts">
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
import MemoryScene from './memory-scene.vue'
import { JOURNEY_DURATIONS } from './memory-model'

const meta: SceneMeta = {
  eyebrow: '手算示例 · a[2] = 3，b[2] = 30',
  title: '一次加法的数据旅程',
  viewBox: '0 0 720 440',
  mobileViewBox: '0 0 400 640',
  note: '数据过程示意，动画时长不表示 GPU 耗时。读取中的缓存细节与 CPU 取回结果未展开。',
  steps: [
    {
      label: '输入准备', title: '输入和输出都在数组存储中', duration: JOURNEY_DURATIONS[0],
      narration: 'a[2] = 3、b[2] = 30 和尚未写入的 c[2] 位于同一个数组存储区域。本线程使用的临时位置还没有取得输入；保存临时值与执行加法由不同部件完成。'
    },
    {
      label: '发出读取', title: '提交读取请求，等待输入', duration: JOURNEY_DURATIONS[1],
      narration: '线程请求读取 a[2] 和 b[2]。发出请求之后，临时位置仍为空，执行加法的部件还不能使用尚未返回的值；输入数组保留原值。'
    },
    {
      label: '输入到达', title: '将读到的值放入寄存器', duration: JOURNEY_DURATIONS[2],
      narration: '读取返回后，3 和 30 放入本线程使用的临时位置，也就是这里画出的寄存器。数组中的原值仍然保留；执行加法的部件现在有了可用输入，c[2] 尚未写入。'
    },
    {
      label: '执行加法', title: '完成运算，保留临时结果 33', duration: JOURNEY_DURATIONS[3],
      narration: '加法部件使用寄存器中的 3 和 30，得到 33，再把它保留为临时结果。寄存器用于存值，加法部件负责运算；此时数组存储中的 c[2] 仍未写入。'
    },
    {
      label: '保存结果', title: '将 33 写回数组存储中的 c[2]', duration: JOURNEY_DURATIONS[4],
      narration: '将临时结果 33 写回数组存储中的 c[2]，a[2] 和 b[2] 仍为 3 和 30。这里完成的是 GPU 侧写回；CPU 等待完成并取回结果是图外的后续步骤。'
    }
  ]
}
</script>

<template>
  <ScenePlayer :meta="meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <MemoryScene :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" />
    </template>
  </ScenePlayer>
</template>
