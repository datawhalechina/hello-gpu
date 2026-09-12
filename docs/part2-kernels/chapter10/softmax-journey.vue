<script setup lang="ts">
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'

// These are hand-checkable formula values, not hardware observations.
const logits = [1000, 1001, 1002]
const maximum = Math.max(...logits)
const shifted = logits.map(value => value - maximum)
const exponentials = shifted.map(Math.exp)
const denominator = exponentials.reduce((a, b) => a + b, 0)
const probabilities = exponentials.map(value => value / denominator)
const rows = [
  { name: '输入 x', values: logits.map(String), ready: 0 },
  { name: 'x − m', values: shifted.map(String), ready: 2 },
  { name: 'exp(x − m)', values: exponentials.map(value => value.toFixed(4)), ready: 3 },
  { name: '输出 y', values: probabilities.map(value => value.toFixed(4)), ready: 5 },
]
const meta = {
  eyebrow: 'SOFTMAX · 数值与依赖',
  title: '同一行的数怎样变成概率',
  viewBox: '0 0 720 480',
  steps: [
    { label: '输入', title: '先别直接取指数', narration: '一行是 1000、1001、1002。它们都超过 FP32 直接取指数的安全范围；我们先找一个保持结果不变的平移。', duration: 2800 },
    { label: '最大值', title: '整行共享 m = 1002', narration: '最大值归约要看完整行。三个位置随后都使用同一个 m；不能每个位置各减自己的值。', duration: 3000 },
    { label: '平移', title: '把最大输入移到 0', narration: '逐元素减去 1002，得到 −2、−1、0。所有指数的自变量都不大于 0，最大的指数将是 1。', duration: 3000 },
    { label: '指数', title: '得到可保存或重算的中间值', narration: '指数约为 0.1353、0.3679、1.0000。这些值尚未归一化；多 kernel baseline 会把它们写入中间数组。', duration: 3000 },
    { label: '分母', title: '整行共享 s ≈ 1.5032', narration: '第二次归约把所有指数相加。只有分母完整后，每个位置才能独立做最后一次除法。', duration: 3200 },
    { label: '归一化', title: '除以同一个分母', narration: '输出约为 0.0900、0.2447、0.6652。未舍入值的和为 1；图中四位小数的和是 0.9999，来自显示舍入。', duration: 3500 },
  ],
}
</script>

<template>
  <AlgorithmPlayer :meta="meta">
    <template #stage="{ step }">
      <g font-family="inherit" text-anchor="middle" fill="var(--ej-ink)">
        <text x="360" y="32" font-size="17">两次归约共享标量，两次逐元素计算各自处理位置</text>
        <g v-for="(row, rowIndex) in rows" :key="row.name">
          <text x="140" :y="91 + rowIndex * 90" text-anchor="end" font-size="17" fill="var(--ej-ink-soft)">{{ row.name }}</text>
          <g v-for="(value, col) in row.values" :key="col">
            <line v-if="rowIndex > 0" :x1="233 + col * 137" :y1="112 + (rowIndex - 1) * 90" :x2="233 + col * 137" :y2="59 + rowIndex * 90" :stroke="step >= row.ready ? 'var(--ej-active)' : 'var(--ej-line)'" stroke-width="2" />
            <rect :x="178 + col * 137" :y="60 + rowIndex * 90" width="110" height="52" rx="8" :fill="step === row.ready ? 'var(--ej-active-soft)' : (rowIndex === 3 && step === 5 ? 'var(--ej-c-soft)' : 'var(--ej-surface)')" :stroke="rowIndex === 0 && step === 1 && col === 2 ? 'var(--ej-b)' : (step >= row.ready ? 'var(--ej-active)' : 'var(--ej-line)')" :stroke-width="rowIndex === 0 && step === 1 && col === 2 ? 3 : 1.5" />
            <text :x="233 + col * 137" :y="93 + rowIndex * 90" font-size="21" :fill="step >= row.ready ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">{{ step >= row.ready ? value : '?' }}</text>
          </g>
        </g>
        <g>
          <rect x="41" y="410" width="285" height="44" rx="8" :fill="step >= 1 ? 'var(--ej-b-soft)' : 'var(--ej-panel)'" :stroke="step >= 1 ? 'var(--ej-b)' : 'var(--ej-line)'" />
          <text x="183" y="438" font-size="19">{{ step >= 1 ? `最大值 m = ${maximum}` : 'm：等待最大值归约' }}</text>
          <rect x="346" y="410" width="333" height="44" rx="8" :fill="step >= 4 ? 'var(--ej-b-soft)' : 'var(--ej-panel)'" :stroke="step >= 4 ? 'var(--ej-b)' : 'var(--ej-line)'" />
          <text x="512" y="438" font-size="19">{{ step >= 4 ? `分母 s ≈ ${denominator.toFixed(4)}` : 's：等待指数求和' }}</text>
        </g>
      </g>
    </template>
  </AlgorithmPlayer>
</template>
