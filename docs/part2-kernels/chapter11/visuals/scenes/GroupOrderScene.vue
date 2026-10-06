<script setup lang="ts">
import { computed, ref } from 'vue'
import { groupMapping } from '../matmulModel.mjs'
const selected = ref(1)
const ids = Array.from({length:12},(_,i)=>i)
const panels = computed(() => [1,8].map(group => ({group,selected:groupMapping(selected.value,group),cells:ids.map(id=>groupMapping(id,group)).sort((a,b)=>a.row-b.row||a.column-b.column)})))
</script>

<template>
  <section class="group-map" aria-label="program ID 到输出 tile 的静态映射对照">
    <p class="heading">同一个 program ID，对应哪个输出块？</p>
    <p>输出网格有 3 行、4 列。点选 ID，比较两种编号规则。</p>
    <div class="choices" role="group" aria-label="选择 program ID">
      <button v-for="id in ids" :key="id" type="button" :aria-pressed="selected===id" :class="{chosen:selected===id}" @click="selected=id">{{ id }}</button>
    </div>
    <div class="panels">
      <div v-for="panel in panels" :key="panel.group" class="panel">
        <p class="panel-title">GROUP_M = {{ panel.group }}</p>
        <p class="mapping" aria-live="polite">id {{ selected }} → 输出块 ({{ panel.selected.row }},{{ panel.selected.column }})</p>
        <div class="grid">
          <div v-for="cell in panel.cells" :key="cell.id" :class="['cell',{selected:cell.id===selected,same:cell.column===panel.selected.column}]">
            <span>({{ cell.row }},{{ cell.column }})</span><b>id {{ cell.id }}</b>
          </div>
        </div>
        <p class="input">需要 A 的块行 {{ panel.selected.row }}<br>以及 B 的块列 {{ panel.selected.column }}</p>
        <p class="limit">每组最多 {{ panel.group }} 行；本组实际 {{ panel.selected.actualGroup }} 行。</p>
      </div>
    </div>
    <p class="legend">粗框是选中的输出块；淡色同列的块会请求同一片 B。坐标表示 tile，不能当作单个元素的下标。</p>
    <p class="note">ID 决定负责哪个输出块。这里没有模拟调度；GPU 不保证按 ID 顺序执行，缓存收益仍需实测。</p>
  </section>
</template>

<style scoped>
.group-map{padding:20px;background:var(--vp-c-bg-soft);border:1px solid var(--vp-c-divider);border-radius:14px;color:var(--vp-c-text-1);font-size:18px;line-height:1.5}.group-map p{margin:10px 0 16px}.heading{font-size:22px;font-weight:700}.choices{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.choices button{width:44px;min-height:44px;border:1px solid var(--vp-c-divider);border-radius:7px;background:var(--vp-c-bg);color:inherit;font:inherit;cursor:pointer}.choices button.chosen{background:var(--vp-c-brand-soft);border:2px solid var(--vp-c-brand-1)}button:focus-visible{outline:3px solid var(--vp-c-brand-1);outline-offset:2px}.panels{display:grid;grid-template-columns:1fr 1fr;gap:24px}.panel{min-width:0}.panel-title{font-size:22px;font-weight:700}.mapping{font-size:20px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.cell{min-height:80px;border:1px solid var(--vp-c-divider);border-radius:7px;background:var(--vp-c-bg);text-align:center;padding:8px 0}.cell span{display:block;font-size:18px}.cell b{display:block;font-size:22px}.cell.same{background:rgba(185,107,50,.13)}.cell.selected{outline:3px solid var(--vp-c-brand-1);outline-offset:-2px}.input{font-size:20px}.legend,.note,.limit{font-size:18px;color:var(--vp-c-text-2)}.note{border-top:1px solid var(--vp-c-divider);padding-top:14px}@media(max-width:640px){.group-map{padding:14px}.panels{grid-template-columns:1fr;gap:18px}.cell{min-height:76px}.grid{gap:4px}.mapping{overflow-wrap:anywhere}}
</style>
