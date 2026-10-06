<script setup lang="ts">
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import ReductionTreeScene from './reduction-tree-scene.vue'
const meta = {
  eyebrow:'手算 · 树形归约',title:'8 个数怎样逐轮合成一个和？',viewBox:'0 0 720 475',mobileViewBox:'0 0 400 495',
  steps:[
    {label:'输入',title:'先看全部输入',narration:'最上层是原始输入。沿连线向下看，每个加号把两个值合成一个；三轮之后只剩一个总和。虚线位置表示尚未计算的结果。'},
    {label:'8 → 4',title:'第一层：相邻两个值相加',narration:'3+1=4、7+0=7、4+1=5、6+2=8。四次加法互不依赖，可以在同一轮完成；原输入仍保留在上层。'},
    {label:'4 → 2',title:'第二层：合并上一层的结果',narration:'左边 4+7=11，右边 5+8=13。连线说明每个部分和来自哪里；这一层要等上一层算完。'},
    {label:'2 → 1',title:'第三层：得到最终的和',narration:'11 + 13 = 24。总共做了 4 + 2 + 1 = 7 次加法，分成三轮依赖；三轮不表示三个 GPU 周期。'}
  ]
}
</script>
<template><ScenePlayer :meta="meta"><template #stage="state"><ReductionTreeScene v-bind="state" /></template></ScenePlayer></template>
