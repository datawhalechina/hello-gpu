<script setup lang="ts">
import { computed } from 'vue'
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'
import type { SceneMeta } from '../../components/animation/sceneTypes'

const A = [[1, 2, 3], [4, 5, 6]]
const B = [[1, 0], [2, 1], [0, 2]]
const cumulative = [0, 1, 2, 3].map(count => A.map(row => B[0].map((_, n) =>
  row.slice(0, count).reduce((sum, a, k) => sum + a * B[k][n], 0)
)))
const props = withDefaults(defineProps<{ mode?: 'dot' | 'tile' }>(), { mode: 'tile' })
const meta = computed<SceneMeta>(() => ({
  eyebrow: props.mode === 'dot' ? 'MATMUL · 点积' : 'MATMUL · 数据复用',
  title: props.mode === 'dot' ? '固定一个输出，沿 K 做点积' : '保留 C 的累加块，沿 K 推进',
  viewBox: '0 0 720 485',
  steps: [
    { label: '形状', title: '先确定输入与输出', narration: 'A 是 2×3，B 是 3×2，结果 C 是 2×2。K=3 是每个点积的长度，部分和从 0 开始。', duration: 2600 },
    ...[0, 1, 2].map(k => ({
      label: `k=${k}`,
      title: `沿 K 处理第 ${k} 项`,
      narration: props.mode === 'dot'
        ? `C[0,0] 加上 A[0,${k}]=${A[0][k]} 与 B[${k},0]=${B[k][0]} 的乘积，累计 ${cumulative[k + 1][0][0]}。`
        : `取 A 的第 ${k} 列与 B 的第 ${k} 行。每个 A 值用于两列输出，每个 B 值用于两行输出；四个乘积加入各自的部分和。`,
      duration: 3600,
    })),
    { label: '写回', title: 'K 全部处理完，再写回', narration: props.mode === 'dot'
      ? 'C[0,0]=5。其余三个输出各自完成点积，得到完整 C=[[5,8],[14,17]]。'
      : 'C=[[5,8],[14,17]]。示意的 K tile 宽度为 1；真实 kernel 一次加载更大的输入片段，但仍要跨各轮保留累加块。', duration: 3000 },
  ],
}))
const cells = (values: number[][]) => values.flatMap((row, r) => row.map((value, c) => ({ r, c, value })))
const outputs = cells(cumulative[0])
const calculating = (step: number) => step > 0 && step < 4
const consumed = (step: number, local: number) => step === 4 ? 3 : Math.max(0, step - (local < 1800 ? 1 : 0))
const activeA = (r: number, c: number, step: number) => calculating(step) && c === step - 1 && (props.mode === 'tile' || r === 0)
const activeB = (r: number, c: number, step: number) => calculating(step) && r === step - 1 && (props.mode === 'tile' || c === 0)
const visibleOutput = (r: number, c: number, step: number) => props.mode === 'tile' || step === 4 || (r === 0 && c === 0)
const phase = (local: number) => local < 900 ? '① 取出这一轮的输入' : local < 1800 ? '② 形成对应的乘积' : '③ 乘积加入部分和，保留到下一轮'
const formula = (r: number, c: number, step: number, local: number) => {
  const k = step - 1
  const old = cumulative[k][r][c]
  const a = A[r][k]
  const b = B[k][c]
  return local < 900 ? `C[${r},${c}]：${old}，等待 ${a} × ${b}`
    : local < 1800 ? `C[${r},${c}]：${old} + (${a} × ${b})`
    : `C[${r},${c}]：${old} + ${a} × ${b} = ${cumulative[step][r][c]}`
}
</script>

<template>
  <AlgorithmPlayer :meta="meta">
    <template #stage="{ step, local }">
      <g fill="var(--ej-ink)" font-family="inherit" text-anchor="middle">
        <text x="132" y="32" font-size="18">A · 2×3</text>
        <text x="350" y="32" font-size="18">B · 3×2</text>
        <text x="587" y="32" font-size="18">C · 2×2</text>
        <g v-for="item in cells(A)" :key="`a${item.r}${item.c}`">
          <rect :x="42 + item.c * 60" :y="58 + item.r * 58" width="52" height="48" rx="6"
            :fill="activeA(item.r, item.c, step) ? 'var(--ej-a-soft)' : 'var(--ej-panel)'"
            :stroke="activeA(item.r, item.c, step) ? 'var(--ej-a)' : 'var(--ej-line)'" />
          <text :x="68 + item.c * 60" :y="89 + item.r * 58" font-size="22">{{ item.value }}</text>
        </g>
        <text x="261" y="119" font-size="25">×</text>
        <g v-for="item in cells(B)" :key="`b${item.r}${item.c}`">
          <rect :x="292 + item.c * 60" :y="58 + item.r * 58" width="52" height="48" rx="6"
            :fill="activeB(item.r, item.c, step) ? 'var(--ej-b-soft)' : 'var(--ej-panel)'"
            :stroke="activeB(item.r, item.c, step) ? 'var(--ej-b)' : 'var(--ej-line)'" />
          <text :x="318 + item.c * 60" :y="89 + item.r * 58" font-size="22">{{ item.value }}</text>
        </g>
        <text x="472" y="119" font-size="25">→</text>
        <g v-for="item in cells(cumulative[consumed(step, local)])" :key="`c${item.r}${item.c}`">
          <rect :x="528 + item.c * 60" :y="58 + item.r * 58" width="52" height="48" rx="6"
            :fill="visibleOutput(item.r, item.c, step) ? 'var(--ej-c-soft)' : 'var(--ej-panel)'"
            :stroke="visibleOutput(item.r, item.c, step) ? 'var(--ej-c)' : 'var(--ej-line)'" />
          <text :x="554 + item.c * 60" :y="89 + item.r * 58" font-size="22">
            {{ visibleOutput(item.r, item.c, step) ? item.value : '·' }}
          </text>
        </g>
        <text x="586" y="193" font-size="14" fill="var(--ej-ink-soft)">{{ step === 4 ? '最终输出' : '保留的部分和' }}</text>

        <text x="360" y="265" font-size="17" fill="var(--ej-active)">
          {{ calculating(step) ? phase(local) : step === 0 ? '先看形状：固定输出位置，再沿 K 移动' : '3 项全部累加完毕，写回最终结果' }}
        </text>
        <g v-if="calculating(step)">
          <g v-for="item in outputs" :key="`formula${item.r}${item.c}`">
            <rect :x="42 + item.c * 328" :y="286 + item.r * 65" width="308" height="52" rx="8"
              :fill="visibleOutput(item.r, item.c, step) ? 'var(--ej-surface)' : 'var(--ej-panel)'"
              :stroke="visibleOutput(item.r, item.c, step) && local >= 1800 ? 'var(--ej-c)' : 'var(--ej-line)'" />
            <text :x="196 + item.c * 328" :y="318 + item.r * 65" font-size="16"
              :fill="visibleOutput(item.r, item.c, step) ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">
              {{ visibleOutput(item.r, item.c, step) ? formula(item.r, item.c, step, local) : `C[${item.r},${item.c}]：由其他点积计算` }}
            </text>
          </g>
        </g>
        <g v-else>
          <rect x="42" y="286" width="636" height="117" rx="9" fill="var(--ej-surface)" stroke="var(--ej-line-strong)" />
          <text x="360" y="326" font-size="20">{{ step === 0 ? 'C 从 0 开始，K=3，所以要累加 3 项' : 'C = [[5, 8], [14, 17]]' }}</text>
          <text x="360" y="367" font-size="16" fill="var(--ej-ink-soft)">
            {{ mode === 'dot' ? '取 A 的一行与 B 的一列，得到一个输出' : '一个 2×2 累加块，对应四个独立的部分和' }}
          </text>
        </g>
        <text x="360" y="441" font-size="15" fill="var(--ej-ink-soft)">
          {{ mode === 'dot' ? '只展开 C[0,0]；其他输出使用相同的规则' : '同一 A 值服务两列，同一 B 值服务两行：看四个算式里的重复值' }}
        </text>
        <text x="360" y="467" font-size="13" fill="var(--ej-ink-faint)">示意输出块 2×2，K tile 宽度 1；不代表真实 block 大小或物理访存次数</text>
      </g>
    </template>
  </AlgorithmPlayer>
</template>
