<script setup lang="ts">
import { OUTPUT, PROBABILITIES, fmt } from '../../attention-model'
</script>
<template>
  <div class="materialize-map" role="img" aria-label="物化 Attention 的数组交接：固定一个 query，读取全部 K 得到分数行，Softmax 写出概率行，再结合全部 V 得到输出行。所有 query 按同样规则得到完整矩阵。">
    <div class="flow-stage">
      <strong>① 分数</strong>
      <p><span class="input">一个 Q 行</span>与<span class="input">全部 K</span>逐行配对</p>
      <div class="stored"><b>写出 Scores 行</b><span>[2, 1, 4]</span></div>
    </div>
    <span class="handoff" aria-hidden="true">→</span>
    <div class="flow-stage">
      <strong>② Softmax</strong>
      <p>读取完整 Scores 行</p>
      <div class="stored"><b>写出 P 行</b><span class="values"><span v-for="(p, key) in PROBABILITIES" :key="key">p{{ key }}={{ fmt(p) }}</span></span></div>
    </div>
    <span class="handoff" aria-hidden="true">→</span>
    <div class="flow-stage">
      <strong>③ 加权和</strong>
      <p><span class="input">完整 P 行</span>与<span class="input">全部 V</span>逐项合并</p>
      <div class="output"><b>写出 O 行</b><span class="values"><span v-for="(value, d) in OUTPUT" :key="d">O[{{ d }}]={{ fmt(value) }}</span></span></div>
    </div>
    <p class="scope">每个 query 都重复这条依赖：Scores / P 的完整形状为 S×S，O 为 S×D。箭头表示数组交接，不表示 GPU 调度或时间。</p>
  </div>
</template>
<style scoped>
.materialize-map { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 10px; align-items: center; padding: 20px; background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); border-radius: 10px; color: var(--vp-c-text-1); }
.flow-stage { min-width: 0; align-self: stretch; display: flex; flex-direction: column; gap: 12px; }
.flow-stage > strong { font-size: 21px; }.flow-stage p { font-size: 18px; line-height: 1.7; margin: 0; }.input { font-weight: 600; }
.stored,.output { margin-top: auto; display: flex; flex-direction: column; gap: 12px; padding: 12px 8px; border: 1px solid #b96b32; border-radius: 7px; background: #b96b3210; font-size: 18px; line-height: 1.6; text-align: center; }.values { display: flex; flex-direction: column; gap: 4px; }.stored span,.output span { font-variant-numeric: tabular-nums; }.output { border-color: #3b8c60; background: #3b8c6010; }.handoff { font-size: 25px; color: var(--vp-c-text-2); }.scope { grid-column: 1/-1; font-size: 18px; margin: 8px 0 0; color: var(--vp-c-text-2); line-height: 1.7; }
@media(max-width:900px) { .materialize-map { grid-template-columns: 1fr; padding: 16px; }.handoff { transform: rotate(90deg); justify-self: center; }.flow-stage { text-align: center; } }
</style>
