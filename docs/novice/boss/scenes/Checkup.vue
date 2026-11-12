<script setup lang="ts">
/**
 * Boss 探索一「给三张工作单体检」（关卡自己的 scenes，不用登记组件）。
 *
 * 旋钮选一张坏工作单：上面是它做什么、启动那一行和代码（坏的那几行标出来，按写法偏好显示），
 * 下面是 Agent 三样工具的体检单（运行、计时、看访存各看到什么，有问题的一项标出来），再一句话说毛病在哪、回哪一关修。
 * 体检单上的数是 challenge.ts 的 CHECKUPS（模拟值，单测拿模拟器把两种写法都核对一遍）：这里不跑模拟器，换一张马上就变。
 * 旋钮的值不存草稿（同前几关只有旋钮的探索），刷新回到第一张。
 */
import { computed, onMounted, ref, useId } from 'vue'
import Knob from '@kit/Knob.vue'
import { fillTemplate, parseTemplate } from '@kit/sandbox/template.ts'
import { useProgress } from '@course/useProgress.ts'
import { FIX_NAMES, FIX_PARTS, FIXES, checkupRows, checkupText, launchLine, type FixPart } from '../challenge.ts'
import CodeView from './CodeView.vue'

const titleId = `${useId()}-title`
const OPTIONS = FIX_PARTS.map((p) => ({ value: p, label: FIX_NAMES[p] }))
const part = ref<FixPart>('oob')

const progress = useProgress()
/** 挂载之前（服务端渲染、水合）按 HIP 写，和代码块一样；挂载以后跟着写法偏好。 */
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})

const setup = computed(() => FIXES[part.value])
/** 坏工作单原来的样子：模板里的空换成初始内容。 */
const code = computed(() => ({
  hip: fillTemplate(parseTemplate(setup.value.code.hip)).source,
  python: fillTemplate(parseTemplate(setup.value.code.python)).source,
}))
const line = computed(() => launchLine(part.value, mounted.value ? progress.state.prefs.lang : 'hip'))
const rows = computed(() => checkupRows(part.value))
const text = computed(() => checkupText(part.value))
</script>

<template>
  <section class="ck" :aria-labelledby="titleId">
    <header class="ck__head">
      <span class="ck__eyebrow" aria-hidden="true">CHECKUP</span>
      <strong :id="titleId" class="ck__title">三张工作单的体检单</strong>
      <span class="ck__tag">模拟</span>
    </header>

    <Knob v-model="part" label="看哪一张" :options="OPTIONS" />

    <p class="ck__brief">
      {{ setup.brief }}。启动时这样写：<code translate="no">{{ line }}</code>
    </p>
    <CodeView :code="code" :marks="setup.badLines" />

    <ul class="ck__rows" aria-label="体检单：Agent 的三样工具各看到什么">
      <li v-for="row in rows" :key="row.tool" class="ck__row" :class="{ 'is-bad': row.bad }">
        <span class="ck__tool">{{ row.name }}<code translate="no">{{ row.tool }}</code></span>
        <span class="ck__text">{{ row.text }}</span>
        <span class="ck__mark">{{ row.bad ? '有问题' : '正常' }}</span>
      </li>
    </ul>

    <p class="ck__verdict" aria-live="polite">{{ text }}</p>
  </section>
</template>

<style scoped>
/* 卡片、眉标、「模拟」标签同前几关的实验台。 */
.ck {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.ck__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ck__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ck__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ck__tag {
  margin-left: auto;
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-ink-2);
  font-size: 12px;
}

.ck__brief {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ck__brief code {
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.ck__rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 一行：工具名、看到什么、正常还是有问题。窄屏上看到什么换到下一行，占满整行。 */
.ck__row {
  display: grid;
  grid-template-columns: 9em 1fr auto;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface-2);
}

.ck__row.is-bad {
  border-color: var(--hg-error);
  background: var(--hg-error-soft);
}

.ck__tool {
  display: flex;
  flex-direction: column;
  font-weight: 700;
}

.ck__tool code {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
  font-weight: 400;
}

.ck__text {
  min-width: 0;
  font-size: 15px;
}

.ck__mark {
  padding: 2px 8px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-surface);
  color: var(--hg-ink-2);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.is-bad .ck__mark {
  color: var(--hg-error-ink);
}

.ck__verdict {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

@media (max-width: 639px) {
  .ck {
    padding: 16px 14px;
  }

  .ck__row {
    grid-template-columns: 1fr auto;
  }

  .ck__tool {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0 8px;
  }

  .ck__text {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
