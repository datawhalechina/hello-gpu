<script setup lang="ts">
import AlgorithmPlayer from '../../components/AlgorithmPlayer.vue'

// Deterministic teaching values. Animation time is not a GPU measurement.
const input = [3, 1, 7, 0, 4, 1, 6, 2]
const levels = [input]
while (levels[levels.length - 1].length > 1) {
  const previous = levels[levels.length - 1]
  const half = previous.length / 2
  levels.push(previous.slice(0, half).map((value, index) => value + previous[index + half]))
}
const partials = [input.slice(0, 4), input.slice(4)].map(group => group.reduce((a, b) => a + b, 0))
const cx = (level: number, index: number) => 88 + index * (544 / levels[level].length) + 272 / levels[level].length
const cy = (level: number) => 91 + level * 92
const progress = (local: number) => Math.min(1, Math.max(0, local / 1000))
const expressions = [
  '目标：8 个输入合成 1 个输出',
  'stride = 4：3 + 4 = 7，1 + 1 = 2，7 + 6 = 13，0 + 2 = 2',
  'stride = 2：7 + 13 = 20，2 + 2 = 4',
  'stride = 1：20 + 4 = 24',
]
const meta = {
  eyebrow: 'REDUCTION · 依赖与阶段',
  title: '从 8 个数到一个和',
  viewBox: '0 0 720 460',
  steps: [
    { label: '输入', title: '先看谁依赖谁', narration: '输入是 3、1、7、0、4、1、6、2。最终和为 24；下面按 HIP LDS 代码的前后半区配对方式展开。', duration: 2600 },
    { label: '4 次相加', title: '前半区读取后半区', narration: '4 个活动线程分别得到 7、2、13、2。它们互不依赖，但下一轮必须等本轮的 LDS 写入完成。', duration: 3500 },
    { label: '2 次相加', title: '在屏障之后继续', narration: '活动范围再减半。第一个位置读取 7 和 13，第二个读取 2 和 2，得到 20 与 4。', duration: 3200 },
    { label: '1 次相加', title: '得到最终结果', narration: '最后做 20 + 4 = 24。总共仍有 7 次加法，依赖深度缩短为 3 轮；这不是 3 个真实 GPU 周期。', duration: 3200 },
    { label: '分组 partial', title: '数组更大时，先分组', narration: '把同一输入改分给两个组：左组产生 11，右组产生 13。partial 是暂存的局部和，分组改变了加法顺序。', duration: 3200 },
    { label: '第二阶段', title: '用下一次 kernel 合并', narration: '第一阶段结束后，第二阶段才能安全读取完整的 partial 数组，再求 11 + 13 = 24。箭头表示数据依赖，不表示实测时间。', duration: 3500 },
  ],
}
</script>

<template>
  <AlgorithmPlayer :meta="meta">
    <template #stage="{ step, local }">
      <g font-family="inherit" text-anchor="middle" fill="var(--ej-ink)">
        <template v-if="step < 4">
          <text x="360" y="32" font-size="16">{{ expressions[step] }}</text>
          <template v-for="(values, level) in levels" :key="level">
            <text x="46" :y="cy(level) + 6" font-size="16" fill="var(--ej-ink-soft)">{{ level === 0 ? '输入' : `第 ${level} 轮` }}</text>
            <template v-if="level > 0">
              <template v-for="(_, index) in values" :key="`edge-${index}`">
                <template v-for="source in [index, index + values.length]" :key="source">
                  <line :x1="cx(level - 1, source)" :y1="cy(level - 1) + 24" :x2="cx(level, index)" :y2="cy(level) - 25" :stroke="step >= level ? 'var(--ej-active)' : 'var(--ej-line)'" :stroke-width="step === level ? 2.5 : 1.5" />
                  <circle v-if="step === level && local < 1000" :cx="cx(level - 1, source) + (cx(level, index) - cx(level - 1, source)) * progress(local)" :cy="cy(level - 1) + 24 + 43 * progress(local)" r="4" fill="var(--ej-active)" />
                </template>
              </template>
            </template>
            <g v-for="(value, index) in values" :key="index">
              <rect :x="cx(level, index) - 26" :y="cy(level) - 23" width="52" height="46" rx="8" :fill="level === step ? 'var(--ej-active-soft)' : 'var(--ej-surface)'" :stroke="level <= step ? 'var(--ej-active)' : 'var(--ej-line)'" :stroke-width="level === step ? 2 : 1" />
              <text :x="cx(level, index)" :y="cy(level) + 7" font-size="21" :fill="level <= step ? 'var(--ej-ink)' : 'var(--ej-ink-faint)'">{{ level <= step ? value : '?' }}</text>
            </g>
          </template>
          <text x="360" y="429" font-size="17" fill="var(--ej-ink-soft)">{{ step === 3 ? '4 + 2 + 1 = 7 次加法；3 轮依赖' : '每一条连线都表示：先有两个操作数，才能进行这次加法' }}</text>
        </template>
        <template v-else>
          <text x="360" y="32" font-size="18">同一组输入，分成两组计算</text>
          <g v-for="(group, groupIndex) in [input.slice(0, 4), input.slice(4)]" :key="groupIndex">
            <rect :x="44 + groupIndex * 342" y="64" width="290" height="142" rx="10" fill="var(--ej-a-soft)" stroke="var(--ej-a)" />
            <text :x="189 + groupIndex * 342" y="95" font-size="18" fill="var(--ej-a)">组 {{ groupIndex }}</text>
            <text :x="189 + groupIndex * 342" y="134" font-size="23">{{ group.join(' + ') }}</text>
            <text :x="189 + groupIndex * 342" y="178" font-size="21">partial[{{ groupIndex }}] = {{ partials[groupIndex] }}</text>
            <line :x1="189 + groupIndex * 342" y1="206" :x2="304 + groupIndex * 112" y2="278" :stroke="step === 5 ? 'var(--ej-active)' : 'var(--ej-line-strong)'" stroke-width="2" />
          </g>
          <rect x="230" y="254" width="260" height="56" rx="9" fill="var(--ej-b-soft)" stroke="var(--ej-b)" />
          <text x="360" y="289" font-size="21" fill="var(--ej-ink)">partial 数组：[11, 13]</text>
          <line x1="44" y1="338" x2="676" y2="338" stroke="var(--ej-line-strong)" stroke-dasharray="6 5" />
          <rect x="193" y="325" width="334" height="27" fill="var(--ej-surface)" />
          <text x="360" y="344" font-size="16" fill="var(--ej-ink-soft)">第一阶段结束 → 第二阶段开始</text>
          <rect x="218" y="374" width="284" height="52" rx="9" :fill="step === 5 ? 'var(--ej-c-soft)' : 'var(--ej-panel)'" :stroke="step === 5 ? 'var(--ej-c)' : 'var(--ej-line)'" />
          <text x="360" y="407" font-size="22">{{ step === 5 ? '11 + 13 = 24' : '等待第一阶段完成' }}</text>
        </template>
      </g>
    </template>
  </AlgorithmPlayer>
</template>
