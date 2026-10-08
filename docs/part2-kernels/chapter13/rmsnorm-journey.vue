<script setup lang="ts">
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import MathScene from './rmsnorm-math-scene.vue'
import type {SceneMeta} from '../../components/animation/sceneTypes'
const meta:SceneMeta={eyebrow:'RMSNorm · 一行的数学过程',title:'一行先求尺度，再分别写出结果',viewBox:'0 0 720 440',mobileViewBox:'0 0 400 560',steps:[
{label:'输入',title:'先保留输入和列权重',narration:'输入 x=[3,4,−3,−4]，权重 w=[1,0.5,2,1]。权重稍后才参与输出，不参与平方和。'},
{label:'平方',title:'每个输入各自平方',narration:'得到 [9,16,9,16]。负输入的平方为正，但原输入仍保留，写输出时还要用。'},
{label:'求和',title:'四个平方合成一个和',narration:'9+16+9+16=50。这里展示公式中的求和，具体串行或树形分工留到 HIP 路线比较。'},
{label:'均值',title:'平方和除以有效列数',narration:'50/4=12.5。分母是这行的四个有效输入，不能换成线程数或填充后的宽度。'},
{label:'尺度',title:'求均方根的倒数',narration:'r=1/√(12.5+ε)≈0.2828，ε=1e−5。同一行所有输出使用相同的 r。'},
{label:'输出',title:'原输入乘尺度，再乘对应权重',narration:'第二列为 4×r×0.5≈0.5657。第三列的负号来自原输入，权重 2 放大它的幅度。每列结果仍各不相同。'}
]}
</script>
<template><ScenePlayer :meta="meta"><template #stage="state"><MathScene v-bind="state" /></template></ScenePlayer></template>
