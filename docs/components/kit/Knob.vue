<script setup lang="ts">
/**
 * 旋钮：关卡里让读者改的那 1–3 个参数（03 第 1 节第 3 条、第 3 节组件登记表）。
 * 三种模式——分段选择、步进器、开关，全部能用键盘操作，并显示单位和范围。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <Knob label="每组人数" code="blockDim.x" :options="[2, 4, 8]" v-model="blockDim" />
 *   <Knob label="组数" code="gridDim.x" :min="1" :max="8" unit="组" v-model="gridDim" />
 *   <Knob label="边界检查" mode="switch" on="已加上" off="没有" v-model="guard" />
 *
 * 模式不写时自己判断：给了 options 是分段，modelValue 是布尔值是开关，其余是步进器。
 * 键盘：分段和步进用 ← → ↑ ↓ 换值、Home / End 跳到两端，开关用空格或回车。
 */
import { computed, ref } from 'vue'

type Mode = 'seg' | 'step' | 'switch'
type Value = number | string | boolean

interface KnobOption {
  value: number | string
  /** 按钮上显示的文字，不写就用 value。 */
  label?: string
}

const props = withDefaults(defineProps<{
  /** 参数的中文名，例如「每组人数」。 */
  label: string
  /** 代码里的名字，等宽显示，例如 blockDim.x。 */
  code?: string
  modelValue: Value
  /** 不写时按 options 和 modelValue 的类型推断。 */
  mode?: Mode
  /** 分段选择的可选项。 */
  options?: readonly (number | string | KnobOption)[]
  /** 步进器的下限、上限和步长。 */
  min?: number
  max?: number
  step?: number
  /** 单位，跟在数值后面，例如「组」「个」。 */
  unit?: string
  /** 开关两个状态的文案。 */
  on?: string
  off?: string
  disabled?: boolean
}>(), { step: 1, on: '开', off: '关', unit: '', disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()

const mode = computed<Mode>(() => {
  if (props.mode) return props.mode
  if (props.options) return 'seg'
  return typeof props.modelValue === 'boolean' ? 'switch' : 'step'
})

const groupLabel = computed(() => (props.code ? `${props.label}（${props.code}）` : props.label))

const items = computed<KnobOption[]>(() =>
  (props.options ?? []).map((o) => (typeof o === 'object' ? o : { value: o })),
)

const current = computed(() => items.value.findIndex((o) => o.value === props.modelValue))

/** 步进器：没给上下限就不设限，按钮只在到头时禁用。 */
const stepValue = computed(() => (typeof props.modelValue === 'number' ? props.modelValue : 0))
const atMin = computed(() => props.min !== undefined && stepValue.value - props.step < props.min)
const atMax = computed(() => props.max !== undefined && stepValue.value + props.step > props.max)

const checked = computed(() => props.modelValue === true)

/** 单位和范围：三种模式各写一句，读者不用猜能调到哪里（03 第 3 节）。 */
const caption = computed(() => {
  const unit = props.unit
  if (mode.value === 'seg') {
    return `可选 ${items.value.map((o) => `${o.label ?? o.value}`).join(' / ')}${unit}`
  }
  if (mode.value === 'switch') return `${props.on} / ${props.off}`
  const low = props.min === undefined ? '不限' : `${props.min}`
  const high = props.max === undefined ? '不限' : `${props.max}`
  return `范围 ${low}–${high}${unit}，每次 ±${props.step}`
})

function set(value: Value) {
  if (props.disabled || value === props.modelValue) return
  emit('update:modelValue', value)
}

function bump(delta: number) {
  if (props.disabled) return
  let next = stepValue.value + delta * props.step
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  set(next)
}

/** 分段按钮的 DOM，换值时把焦点跟过去（WAI-ARIA 的 radiogroup 做法）。 */
const segEls = ref<(HTMLButtonElement | null)[]>([])

function moveTo(index: number) {
  const option = items.value[index]
  if (!option) return
  set(option.value)
  segEls.value[index]?.focus()
}

function onSegKey(event: KeyboardEvent) {
  const total = items.value.length
  if (total === 0 || props.disabled || event.altKey || event.ctrlKey || event.metaKey) return
  const from = current.value < 0 ? 0 : current.value
  const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (from + 1) % total
    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (from - 1 + total) % total
      : event.key === 'Home' ? 0
        : event.key === 'End' ? total - 1
          : null
  if (next === null) return
  event.preventDefault()
  moveTo(next)
}

function onStepKey(event: KeyboardEvent) {
  if (props.disabled || event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') bump(1)
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') bump(-1)
  else if (event.key === 'Home' && props.min !== undefined) set(props.min)
  else if (event.key === 'End' && props.max !== undefined) set(props.max)
  else return
  event.preventDefault()
}
</script>

<template>
  <div class="hg-knob" :class="[`is-${mode}`, { 'is-disabled': disabled }]">
    <span class="hg-knob__label">
      {{ label }}
      <code v-if="code">{{ code }}</code>
    </span>

    <div
      v-if="mode === 'seg'"
      class="hg-knob__seg"
      role="radiogroup"
      :aria-label="groupLabel"
      @keydown="onSegKey"
    >
      <button
        v-for="(option, index) in items"
        :key="option.value"
        :ref="(el) => (segEls[index] = el as HTMLButtonElement | null)"
        type="button"
        role="radio"
        class="hg-knob__option"
        :class="{ 'is-on': index === current }"
        :aria-checked="index === current"
        :tabindex="index === (current < 0 ? 0 : current) ? 0 : -1"
        :disabled="disabled"
        @click="set(option.value)"
      >
        {{ option.label ?? option.value }}{{ unit }}
      </button>
    </div>

    <div
      v-else-if="mode === 'step'"
      class="hg-knob__step"
      role="group"
      :aria-label="groupLabel"
      @keydown="onStepKey"
    >
      <button
        type="button"
        class="hg-knob__button"
        :aria-label="`${label}减 ${step}`"
        :disabled="disabled || atMin"
        @click="bump(-1)"
      >
        −
      </button>
      <output class="hg-knob__value" aria-live="polite">{{ stepValue }}<i v-if="unit">{{ unit }}</i></output>
      <button
        type="button"
        class="hg-knob__button"
        :aria-label="`${label}加 ${step}`"
        :disabled="disabled || atMax"
        @click="bump(1)"
      >
        +
      </button>
    </div>

    <button
      v-else
      type="button"
      role="switch"
      class="hg-knob__switch"
      :class="{ 'is-on': checked }"
      :aria-checked="checked"
      :aria-label="groupLabel"
      :disabled="disabled"
      @click="set(!checked)"
    >
      <span class="hg-knob__track" aria-hidden="true"><i class="hg-knob__thumb" /></span>
      <span class="hg-knob__state">{{ checked ? on : off }}</span>
    </button>

    <span class="hg-knob__caption">{{ caption }}</span>
  </div>
</template>

<style scoped>
.hg-knob {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
  color: var(--hg-ink);
}

.hg-knob__label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-knob__label code {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-knob__caption {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

/* 分段和步进共用的底槽：浅底、1px 描边、内嵌的小按钮（设计稿 Stage 的参数区）。 */
.hg-knob__seg,
.hg-knob__step {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 3px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.hg-knob__seg {
  flex-wrap: wrap;
}

.hg-knob__option,
.hg-knob__button {
  min-width: 44px;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: calc(var(--hg-radius-control) - 2px);
  background: transparent;
  color: var(--hg-ink-2);
  font-family: var(--hg-font-display);
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color var(--motion-fast) var(--motion-ease-out),
    color var(--motion-fast) var(--motion-ease-out);
}

.hg-knob__button {
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

.hg-knob__option:not(:disabled):hover,
.hg-knob__button:not(:disabled):hover {
  color: var(--hg-ink);
  background: var(--hg-surface);
}

/* 当前选中项：深墨底配反色文字，和主按钮一致（01 第 2.2 节）。 */
.hg-knob__option.is-on {
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-knob__option:disabled,
.hg-knob__button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hg-knob__value {
  min-width: 52px;
  padding: 0 4px;
  text-align: center;
  font-family: var(--hg-font-display);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.hg-knob__value i {
  margin-left: 2px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-style: normal;
  font-weight: 500;
}

.hg-knob__switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: flex-start;
  min-height: 46px;
  padding: 0 14px 0 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.hg-knob__switch.is-on {
  color: var(--hg-ink);
}

.hg-knob__switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hg-knob__track {
  position: relative;
  display: block;
  width: 44px;
  height: 26px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-idle);
  transition: background-color var(--motion-fast) var(--motion-ease-out);
}

.hg-knob__switch.is-on .hg-knob__track {
  background: var(--hg-accent);
}

.hg-knob__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  transition: transform var(--motion-fast) var(--motion-ease-out);
}

.hg-knob__switch.is-on .hg-knob__thumb {
  transform: translateX(18px);
}

/* 开关不只靠颜色：滑块位置 + 「开 / 关」文字都在（01 第 7 节）。 */
.hg-knob__state {
  font-variant-numeric: tabular-nums;
}

.hg-knob__option:focus-visible,
.hg-knob__button:focus-visible,
.hg-knob__switch:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}
</style>
