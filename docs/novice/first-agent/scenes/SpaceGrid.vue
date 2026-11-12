<script setup lang="ts">
/**
 * 1-14 的搜索空间表（关卡自己的 scenes；探索一、探索二和挑战共用）：block 7 行 × 步长 4 列，一格一组参数。
 * 格子里写什么由场景给（GridCell：周期数、第几圈、拿到几颗星），表只管画。行头是 block、列头是步长，
 * 读屏按表格读，每格另有一句完整的说法。pickable 时格子是按钮，点一下发 pick：这是鼠标和触屏的捷径，
 * 键盘用场景里的旋钮，所以格子不进 Tab 顺序（28 个格子挨个 Tab 太长）。
 * 颜色之外每格都有字（周期数、圈号、星），「起点」「交卷」写成角标，不只靠颜色区分（01 第 7 节）。
 */
import { computed } from 'vue'
import { configKey, type TuneConfig } from '@course/agent/tasks.ts'
import { TASK, type GridCell } from '../challenge.ts'

const props = withDefaults(defineProps<{
  /** configKey → 这一格写什么；没给的格子空着 */
  cells: Readonly<Record<string, GridCell>>
  /** 表的标题（读屏读它；眼睛看场景里的说明） */
  caption: string
  /** 描边的那一格（旋钮选着的那组） */
  selected?: string | null
  pickable?: boolean
}>(), { selected: null, pickable: false })

const emit = defineEmits<{ pick: [config: TuneConfig] }>()

const STRIDES = TASK.strides
const rows = computed(() => TASK.blocks.map((block) => ({
  block,
  cells: STRIDES.map((stride) => {
    const config = { block, stride }
    const key = configKey(config)
    const cell = props.cells[key] ?? null
    // 周期数用等宽数字对齐；星、圈号、汉字用正文字体，字形大一些
    return { config, key, cell, num: /^\d+$/.test(cell?.text ?? '') }
  }),
})))
</script>

<template>
  <div class="sg">
    <table class="sg__table">
      <caption class="sg__sr">{{ caption }}</caption>
      <thead>
        <tr>
          <td class="sg__corner" />
          <th scope="colgroup" :colspan="STRIDES.length" class="sg__axis">访问步长 stride</th>
        </tr>
        <tr>
          <th scope="col" class="sg__corner">block</th>
          <th v-for="s in STRIDES" :key="s" scope="col" class="sg__col">{{ s }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.block">
          <th scope="row" class="sg__row">{{ row.block }}</th>
          <td
            v-for="item in row.cells"
            :key="item.key"
            class="sg__cell"
            :class="[item.cell?.tone ? `is-${item.cell.tone}` : '', { 'is-selected': selected === item.key }]"
          >
            <button v-if="pickable" type="button" tabindex="-1" class="sg__body" @click="emit('pick', item.config)">
              <span class="sg__text" :class="{ 'is-num': item.num }" aria-hidden="true">{{ item.cell?.text || '·' }}</span>
              <span v-if="item.cell?.tag" class="sg__tag" aria-hidden="true">{{ item.cell.tag }}</span>
              <span class="sg__sr">{{ item.cell?.label ?? `block ${item.config.block}、步长 ${item.config.stride}` }}</span>
            </button>
            <span v-else class="sg__body">
              <span class="sg__text" :class="{ 'is-num': item.num }" aria-hidden="true">{{ item.cell?.text || '·' }}</span>
              <span v-if="item.cell?.tag" class="sg__tag" aria-hidden="true">{{ item.cell.tag }}</span>
              <span class="sg__sr">{{ item.cell?.label ?? `block ${item.config.block}、步长 ${item.config.stride}` }}</span>
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sg {
  min-width: 0;
  /* 宽屏上格子不必拉满：28 格保持差不多方的比例，一眼看得全 */
  max-width: 560px;
}

/* VitePress 正文里的表格是 display: block、带竖线和隔行底色，这里换回占满一行的普通表格（同 1-7 的 TripBoard）。 */
.sg__table {
  display: table;
  width: 100%;
  margin: 0;
  border-collapse: separate;
  border-spacing: 4px;
  table-layout: fixed;
  font-size: 14px;
}

.sg .sg__table tr {
  border: 0;
  background-color: transparent;
}

.sg .sg__table th,
.sg .sg__table td {
  padding: 0;
  border: 0;
  background-color: transparent;
  text-align: center;
  vertical-align: middle;
}

.sg .sg__corner {
  width: 3.4em;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.sg .sg__axis {
  color: var(--hg-ink-3);
  font-size: 12px;
  font-weight: 600;
}

.sg .sg__col,
.sg .sg__row {
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-weight: 700;
}

.sg .sg__row {
  padding-right: 6px;
  text-align: right;
}

/* 一格：圆角小块，里面一行主字、一行角标 */
.sg__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 44px;
  padding: 4px 2px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
  color: var(--hg-ink);
  font: inherit;
  line-height: 1.2;
}

button.sg__body {
  cursor: pointer;
}

button.sg__body:hover {
  border-color: var(--hg-border-strong);
}

.sg__text {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}

.sg__text.is-num {
  font-family: var(--hg-font-mono);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.sg__tag {
  margin-top: 2px;
  color: var(--hg-ink-2);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.sg__cell.is-muted .sg__body {
  border-style: dashed;
  background: transparent;
  color: var(--hg-ink-3);
}

.sg__cell.is-path .sg__body {
  border-color: var(--hg-accent);
  background: var(--hg-surface-2);
}

.sg__cell.is-good .sg__body,
.sg__cell.is-best .sg__body {
  border-color: var(--hg-accent);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
}

.sg__cell.is-best .sg__body {
  border-width: 2px;
}

.sg__cell.is-bad .sg__body {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
}

/* 旋钮选着的那一格：外面再描一圈（不靠颜色：位置和粗细） */
.sg__cell.is-selected .sg__body {
  outline: 2px solid var(--hg-ink);
  outline-offset: 1px;
}

.sg__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 479px) {
  .sg__table {
    border-spacing: 3px;
  }

  .sg .sg__corner {
    width: 2.9em;
  }

  .sg__text {
    font-size: 14px;
  }

  .sg__text.is-num {
    font-size: 12px;
  }

  .sg__tag {
    font-size: 10px;
  }
}
</style>
