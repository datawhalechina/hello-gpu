<script setup lang="ts">
import { computed, ref } from 'vue'
import { A, B, reuseSelection } from './matmulModel.mjs'
const selected = ref({ matrix: 'a', row: 0, column: 1 })
const state = computed(() => reuseSelection(selected.value.matrix, selected.value.row, selected.value.column))
const inputs = [{ key: 'a', name: 'A · 2×3', values: A }, { key: 'b', name: 'B · 3×2', values: B }]
const affected = (row: number, column: number) => state.value.contributions.find((item: {row:number;column:number}) => item.row===row && item.column===column)
</script>

<template>
  <section class="reuse" aria-label="点选输入，查看它用于哪些输出">
    <p class="heading">一个输入值，可以参与多个输出</p>
    <p class="lead">点选 A 或 B 中的一个数，查看这一项的贡献。</p>
    <div class="panels">
      <div v-for="input in inputs" :key="input.key" class="input-panel">
        <p class="matrix-name">{{ input.name }}</p>
        <div class="input-grid" :style="{gridTemplateColumns: `repeat(${input.values[0].length}, 1fr)`}">
          <template v-for="(row,r) in input.values" :key="r">
            <button v-for="(value,c) in row" :key="c" type="button"
              :aria-label="`${input.key.toUpperCase()}[${r},${c}]=${value}，查看它的输出贡献`"
              :aria-pressed="selected.matrix===input.key && selected.row===r && selected.column===c"
              :class="[input.key,{chosen:selected.matrix===input.key && selected.row===r && selected.column===c}]"
              @click="selected={matrix:input.key,row:r,column:c}">
              <span class="coordinate">[{{ r }},{{ c }}]</span><b>{{ value }}</b>
            </button>
          </template>
        </div>
      </div>
      <div class="output-panel">
        <p class="matrix-name">这一项会加到哪些位置？</p>
        <div class="output-grid">
          <template v-for="r in [0,1]" :key="r">
            <div v-for="c in [0,1]" :key="c" :class="['output',{used:affected(r,c)}]">
              <span class="coordinate">C[{{ r }},{{ c }}]</span>
              <b>{{ affected(r,c) ? '+'+affected(r,c).amount : '—' }}</b>
            </div>
          </template>
        </div>
      </div>
    </div>
    <div class="readout" aria-live="polite">
      <p class="selected">{{ state.matrix.toUpperCase() }}[{{ state.row }},{{ state.column }}] = {{ state.value }}</p>
      <p v-for="item in state.contributions" :key="`${item.row},${item.column}`" class="contribution">→ C[{{ item.row }},{{ item.column }}] 加上 {{ item.left }} × {{ item.right }} = {{ item.amount }}</p>
    </div>
    <p class="note">这里显示一个输入值的贡献；完整输出还要累加其他 K 位置。点选表示数据关系，不表示执行顺序。</p>
  </section>
</template>

<style scoped>
.reuse{padding:20px;background:var(--vp-c-bg-soft);border:1px solid var(--vp-c-divider);border-radius:14px;color:var(--vp-c-text-1);font-size:18px;line-height:1.5}.heading{margin:0;font-size:22px;font-weight:700}.lead,.matrix-name,.note{margin:10px 0 16px}.matrix-name{font-size:20px;font-weight:600}.panels{display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:20px}.input-panel,.output-panel{min-width:0}.input-grid,.output-grid{display:grid;gap:8px}.output-grid{grid-template-columns:repeat(2,1fr)}button,.output{min-width:0;min-height:80px;padding:6px;border:1px solid var(--vp-c-divider);border-radius:8px;background:var(--vp-c-bg);text-align:center;font:inherit;color:inherit}button{cursor:pointer}.a{background:rgba(52,123,170,.1)}.b{background:rgba(185,107,50,.1)}button.chosen{outline:3px solid var(--vp-c-brand-1);outline-offset:1px}button:focus-visible{outline:3px solid var(--vp-c-brand-1);outline-offset:3px}.coordinate{display:block;font-size:18px}b{display:block;font-size:26px;font-weight:600}.used{background:rgba(59,140,96,.15);border:2px solid var(--vp-c-brand-1)}.readout{margin-top:22px;padding:14px;border-top:2px solid var(--vp-c-divider)}.readout p{margin:5px 0;font-size:20px}.selected{font-weight:700}.note{font-size:18px;color:var(--vp-c-text-2);margin-bottom:0}@media(max-width:640px){.reuse{padding:14px}.panels{grid-template-columns:1fr;gap:12px}.input-grid{max-width:340px}.output-grid{max-width:340px}.contribution{overflow-wrap:anywhere}.readout{padding:12px 0}}
</style>
