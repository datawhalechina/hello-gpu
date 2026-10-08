<script setup lang="ts">
import { computed, ref } from 'vue'
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
import HierarchyScene from './hierarchy-scene.vue'
import { identifyThread } from './hierarchy-model'

const block = ref(0)
const thread = ref(35)
const showDetails = ref(false)
const selected = computed(() => identifyThread(block.value, thread.value))

const meta = computed<SceneMeta>(() => ({
  eyebrow: '手算示例 · 2 个线程块，每块 64 个线程 · 每组 32 个线程',
  title: showDetails.value ? `从整个任务，一直找到线程 ${thread.value}` : '从整次任务，看到一组线程的执行',
  viewBox: '0 0 720 440',
  mobileViewBox: '0 0 400 520',
  note: '分组关系与一条加法指令的示意；展开顺序不表示调度顺序，动画速度不表示 GPU 耗时。',
  steps: showDetails.value ? [
    {
      label: '整个 Grid', title: '一次启动，两个 Block', duration: 4800,
      narration: `外框是整个 Grid。两个 Block 各有 64 个线程，共 128 个；小方格代表线程。蓝框标出 Block ${block.value} 中的线程 ${thread.value}。`
    },
    {
      label: '放大 Block', title: `先进入 Block ${block.value}`, duration: 5200,
      narration: `放大同一个 Block，看到其中编号 0～63 的 64 个线程。Block ${1 - block.value} 留在角落作为参照，它也有自己的线程 ${thread.value}。`
    },
    {
      label: '分成 Wave', title: '64 个线程，每 32 个组成一组', duration: 6000,
      narration: '本例采用 wave32：线程 0～31 属于 wavefront 0，32～63 属于 wavefront 1。这是原来 64 个线程的分组，没有增加新线程。'
    },
    {
      label: '找到 Lane', title: `线程 ${thread.value} 在这一组的哪个位置？`, duration: 6400,
      narration: `放大 wavefront ${selected.value.wave}，它从线程 ${selected.value.wave * 32} 开始。线程 ${thread.value} 的组内位置是 ${thread.value} − ${selected.value.wave * 32} = ${selected.value.lane}，叫 lane ${selected.value.lane}。Thread 是这份工作，lane 是它在 wavefront 中的位置。`
    },
    {
      label: '一起做加法', title: '同一条指令，各算各的数据', duration: 7400,
      narration: `各线程已经拿到自己的两个数。选中的 32 个线程执行同一条加法指令，分别得到 11、22、33……；线程 ${thread.value} 计算 ${selected.value.a} + ${selected.value.b} = ${selected.value.sum}。这里显示的是数值，不是数组下标。`
    }
  ] : [
    {
      label: '整次任务', title: '一次启动，许多份工作', duration: 4800,
      narration: '外框包含本次启动的全部线程，叫 Grid。里面有两个线程块，各有 64 个线程。每个小方格代表一个线程，蓝框让我们持续跟踪其中一份工作。'
    },
    {
      label: '看一个块', title: '打开一个线程块', duration: 5200,
      narration: '放大其中一个 Block，里面仍是原来的 64 个线程。每个线程都执行同一份 kernel，根据程序安排处理自己的数据。另一个块留在角落作为参照。'
    },
    {
      label: '看执行小组', title: '一个块里，还有更小的执行小组', duration: 6000,
      narration: '原来的 64 个线程分成两组，每组 32 个。这样共同执行指令的小组叫 wavefront。本例采用 wave32；只是给原有线程分组，没有增加线程。'
    },
    {
      label: '各自的数据', title: '同样的规则，各自的数据', duration: 6400,
      narration: '再放大一个执行小组，看看各线程已经拿到的两个数：有的是 1 和 10，有的是 2 和 20。格子里显示的是数据值，下一步大家都要做加法。'
    },
    {
      label: '一起做加法', title: '一组线程，共同执行加法', duration: 7400,
      narration: '这个小组的线程共同执行一条加法指令，分别得到 11、22、33……。相同的操作可以得到不同结果，因为各线程使用自己的数据。完整工作还包括取数和写回。'
    }
  ]
}))
</script>

<template>
  <div class="hierarchy-demo">
  <label class="hierarchy-detail-toggle">
    <input v-model="showDetails" type="checkbox" />
    <span>查看线程编号和 lane</span>
    <small>初次阅读可先保持关闭</small>
  </label>
  <div v-if="showDetails" class="hierarchy-choice">
    <label>观察哪个块
      <select v-model.number="block" aria-label="观察哪个块">
        <option :value="0">Block 0</option>
        <option :value="1">Block 1</option>
      </select>
    </label>
    <label class="thread-choice">块内线程号：<strong>{{ thread }}</strong>
      <input v-model.number="thread" type="range" min="0" max="63" step="1" aria-label="块内线程号" />
    </label>
  </div>
  <ScenePlayer :meta="meta">
    <template #stage="{ step, local, compact, reducedMotion }">
      <HierarchyScene :step="step" :local="local" :compact="compact" :reduced-motion="reducedMotion" :selected-block="block" :selected-thread="thread" :show-details="showDetails" />
    </template>
  </ScenePlayer>
  </div>
</template>

<style scoped>
.hierarchy-detail-toggle { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; text-align: left; font-size: 13px; color: var(--vp-c-text-1); cursor: pointer; }
.hierarchy-detail-toggle input { accent-color: var(--vp-c-brand-1); }
.hierarchy-detail-toggle small { color: var(--vp-c-text-2); font-size: 12px; }
.hierarchy-detail-toggle input:focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 3px; }
.hierarchy-choice { display: flex; align-items: center; gap: 28px; margin-bottom: 14px; text-align: left; font-size: 13px; color: var(--vp-c-text-2); }
.hierarchy-choice label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.hierarchy-choice select { border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg); color: var(--vp-c-text-1); padding: 7px 10px; border-radius: 5px; font: inherit; }
.thread-choice { flex: 1; }
.thread-choice strong { color: var(--vp-c-text-1); font-variant-numeric: tabular-nums; min-width: 2ch; }
.thread-choice input { flex: 1; min-width: 100px; max-width: 220px; accent-color: var(--vp-c-brand-1); }
.hierarchy-choice :is(input, select):focus-visible { outline: 2px solid var(--vp-c-brand-1); outline-offset: 3px; }
@media (max-width: 640px) {
  .hierarchy-choice { flex-direction: column; align-items: stretch; gap: 12px; }
}
</style>
