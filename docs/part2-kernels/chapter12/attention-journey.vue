<script setup lang="ts">
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'
const scores = [2, 1, 4]
const values = [[1, 0], [0, 2], [3, 1]]
const states = [{ m: -Infinity, l: 0, acc: [0, 0], alpha: 1, beta: 0 }]
for (let j = 0; j < scores.length; j++) {
  const old = states[j]
  const m = Math.max(old.m, scores[j])
  const alpha = Math.exp(old.m - m), beta = Math.exp(scores[j] - m)
  states.push({ m, alpha, beta, l: old.l * alpha + beta, acc: old.acc.map((x,d) => x * alpha + beta * values[j][d]) })
}
const fmt = (x: number) => Number.isFinite(x) ? x.toFixed(3) : '−∞'
const state = (step: number) => states[Math.max(0, Math.min(step - 1, 3))]
const meta: SceneMeta = {
  eyebrow: '12.3 · 在线 Attention', title: '最大值变了，旧的累计结果怎样换尺度？', viewBox: '0 0 720 440',
  steps: [
    { label: '物化', title: '先保存全部分数，再求概率', narration: '只放大一个 query 行。物化实现把各行 score 和概率写成两个 S×S 矩阵；这里显示其中三个位置。', duration: 3600 },
    { label: '初始化', title: '只保留 m、l 和 acc', narration: 'm 是已见最大值，l 是指数和，acc 是未归一化的加权 V。它们开始为 −∞、0 和零向量。', duration: 3000 },
    { label: 'key 0', title: '读入 score=2，V=[1,0]', narration: '最大值成为 2，新项指数为 1，因此 l=1，acc=[1,0]。不必保留这一个 score。', duration: 3400 },
    { label: 'key 1', title: '读入较小分数，沿用基准 2', narration: 'exp(1−2)≈0.368。l 增加 0.368，acc 的第二项增加 2×0.368。', duration: 3400 },
    { label: 'key 2', title: '新最大值 4：旧 l 和 acc 一起乘 exp(−2)', narration: '旧项改用基准 4，然后加入 exp(4−4)=1 和 V[2]=[3,1]。只缩放 l 或只缩放 acc 都会得到错误结果。', duration: 4600 },
    { label: '输出', title: '最后只做一次 acc / l', narration: '输出约为 [2.646,0.928]，与保存全部分数后计算 Softmax 加权和相同；这里比较数学结果，不比较 GPU 耗时。', duration: 3600 },
  ],
}
</script>
<template>
  <AlgorithmPlayer :meta="meta">
    <template #stage="{ step, local }">
      <text x="26" y="30" class="label">同一个 query 行 · score 已包含 1/√D · V 的下标是 key 编号</text>
      <g v-for="(s,j) in scores" :key="j" :transform="`translate(${26+j*226},50)`">
        <rect width="216" height="80" rx="8" :fill="step === j+2 ? 'var(--ej-active)' : 'var(--ej-panel)'" :opacity="step === j+2 ? .16 : 1" />
        <text x="12" y="25" class="label">key {{ j }}</text><text x="12" y="55" class="value">score {{ s }} · V [{{ values[j].join(', ') }}]</text>
        <line v-if="step === j+2" x1="12" y1="73" :x2="12+192*Math.min(local/750,1)" y2="73" stroke="var(--ej-active)" stroke-width="3" />
      </g>
      <g v-if="step===0">
        <text x="28" y="175" class="value">Scores 行 [2, 1, 4]</text><text x="28" y="212" class="value">概率行 [0.114, 0.042, 0.844]</text>
        <path d="M360 170V220H414" fill="none" stroke="var(--ej-active)" stroke-width="2" />
        <text x="427" y="222" class="value">乘 V → 输出行</text>
        <rect x="26" y="257" width="668" height="145" rx="8" fill="var(--ej-panel)" />
        <text x="45" y="290" class="label">完整矩阵：Scores 写回 → Softmax 读入并写 P → 乘 V 读 P</text>
        <text x="45" y="326" class="value">两个中间矩阵，各有 S × S 个元素</text>
        <text x="45" y="364" class="label">下一步：边读 key 边更新结果，省去这些中间读写。</text>
      </g>
      <g v-else>
        <g v-for="(label,i) in ['当前最大值 m','指数和 l','加权累计 acc']" :key="label" :transform="`translate(${26+i*226},158)`">
          <rect width="216" height="94" rx="8" fill="var(--ej-panel)" stroke="var(--ej-line)" />
          <text x="12" y="27" class="label">{{ label }}</text>
          <text x="12" y="64" class="value">{{ i===0 ? fmt(state(step).m) : i===1 ? fmt(state(step).l) : '['+state(step).acc.map(fmt).join(', ')+']' }}</text>
        </g>
        <rect x="26" y="275" width="668" height="128" rx="8" fill="var(--ej-panel)" />
        <template v-if="step===1"><text x="46" y="309" class="value">尚未读入任何 key</text><text x="46" y="348" class="label">acc 有 D 个分量；m 和 l 各只有一个值。</text></template>
        <template v-else-if="step<5">
          <text x="46" y="306" class="value">α = {{ fmt(state(step).alpha) }} · β = {{ fmt(state(step).beta) }}</text>
          <text x="46" y="343" class="label">l ← 旧 l × α + β</text>
          <text x="46" y="377" class="label">acc ← 旧 acc × α + β × V[{{ step-2 }}]</text>
          <circle v-if="local<1100" :cx="52+590*Math.min(local/1100,1)" cy="396" r="4" fill="var(--ej-active)" />
        </template>
        <template v-else><text x="46" y="315" class="value">O = acc / l = [{{ states[3].acc.map(x=>fmt(x/states[3].l)).join(', ') }}]</text><text x="46" y="355" class="label">物化与在线两条路线得到同一数学结果（浮点结果允许舍入差异）。</text></template>
      </g>
    </template>
  </AlgorithmPlayer>
</template>
<style scoped>
text { fill:var(--ej-ink); font-family:var(--vp-font-family-base); }.label{font-size:14px;fill:var(--ej-ink-soft)}.value{font-size:17px;font-weight:600}
</style>
