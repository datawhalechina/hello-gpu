<script setup lang="ts">
const props = defineProps<{
  label: string
  code?: string
  modelValue: number
  options?: number[]
  min?: number
  max?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function set(value: number) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="hgp-knob">
    <div class="k-label">{{ label }} <code v-if="code">{{ code }}</code></div>
    <div v-if="options" class="k-seg" role="radiogroup" :aria-label="label">
      <button
        v-for="o in options"
        :key="o"
        type="button"
        role="radio"
        class="hgp-focusable"
        :aria-checked="modelValue === o"
        :class="{ on: modelValue === o }"
        @click="set(o)"
      >
        {{ o }}
      </button>
    </div>
    <div v-else class="k-step">
      <button
        type="button"
        class="hgp-focusable"
        :aria-label="`${label}减 1`"
        :disabled="min !== undefined && modelValue <= min"
        @click="set(modelValue - 1)"
      >
        −
      </button>
      <output aria-live="polite">{{ modelValue }}</output>
      <button
        type="button"
        class="hgp-focusable"
        :aria-label="`${label}加 1`"
        :disabled="max !== undefined && modelValue >= max"
        @click="set(modelValue + 1)"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.hgp-knob {
  display: grid;
  gap: 6px;
}
.k-label {
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.k-label code {
  font-size: 12px;
}
.k-seg,
.k-step {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
button {
  min-width: 40px;
  min-height: 36px;
  border: 1px solid var(--hg-border);
  border-radius: var(--hgp-radius);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out);
}
button.on {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
output {
  min-width: 36px;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
