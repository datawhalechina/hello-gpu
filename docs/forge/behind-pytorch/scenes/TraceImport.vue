<script setup lang="ts">
/**
 * 2-5「导入你的 trace」（关卡自己的 scenes，不用登记组件）：把 Notebook 里 hg.trace 存的 JSON 导入本页，
 * 探索一、二的 trace 浏览器换成读者的数据。可以选文件（一次选几个），也可以粘贴 JSON 文本；新导入的接在已导入的后面，
 * 同名的行看后记的那次。导入的 trace 存在本关的草稿槽里（useTraces），只在这个浏览器里，不上传。
 * 文件先过 trace.ts 的 parseTraceJson；出错时写现象、原因、怎么改（03 第 4 节），解析器的原文放进折叠块。
 */
import { computed, ref, useId } from 'vue'
import { appendTraces, explainImportError, mergeTraces, parseTraceJson, type ArchiveTrace, type TraceImportError } from '../trace.ts'
import { useTraces } from './useTraces.ts'

const uid = useId()
const titleId = `${uid}-title`
const { myTraces, save, unsaved } = useTraces()

const fileInput = ref<HTMLInputElement | null>(null)
const pasted = ref('')
const problems = ref<{ source: string; error: TraceImportError }[]>([])
const status = ref('')

/** 收下这几段 JSON：读得出的接在已导入的后面，读不出的列出原因。 */
function take(inputs: { source: string; text: string }[]): boolean {
  const added: ArchiveTrace[] = []
  const failed: { source: string; error: TraceImportError }[] = []
  for (const { source, text } of inputs) {
    const parsed = parseTraceJson(text)
    if (parsed.ok) added.push(...parsed.traces)
    else failed.push({ source, error: parsed.error })
  }
  problems.value = failed
  if (!added.length) {
    status.value = ''
    return false
  }
  save(appendTraces(myTraces.value ?? [], added))
  const count = added.reduce((sum, t) => sum + t.lines.length, 0)
  status.value = `导入了 ${count} 行，上面两个 trace 浏览器换成了你的数据。`
  return true
}

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // 清掉选择，同一个文件改过以后还能再选一次
  input.value = ''
  if (!files.length) return
  take(await Promise.all(files.map(async (file) => ({ source: file.name, text: await file.text().catch(() => '') }))))
}

function onPaste() {
  if (take([{ source: '粘贴的 JSON', text: pasted.value }])) pasted.value = ''
}

function clear() {
  save(null)
  problems.value = []
  status.value = '已清掉你导入的 trace，两个浏览器换回参考数据。'
}

const lines = computed(() => (myTraces.value ? mergeTraces(myTraces.value) : []))
const devices = computed(() => [...new Set(lines.value.map((l) => l.device.name))].join('、'))
const problemTexts = computed(() => problems.value.map((p) => ({ ...p, text: explainImportError(p.error) })))
</script>

<template>
  <section class="ti" :aria-labelledby="titleId">
    <header class="ti__head">
      <span class="ti__eyebrow" aria-hidden="true">LAB</span>
      <strong :id="titleId" class="ti__title">导入你的 trace</strong>
    </header>
    <ol class="ti__steps">
      <li>Notebook 里每运行一次 <code translate="no">hg.trace</code>，输出的最后一行写着「trace 已保存：notebooks/.artifacts/traces/……json」。</li>
      <li><code translate="no">.artifacts</code> 是隐藏目录，文件列表里默认看不到：在 JupyterLab 里点 File › Open from Path…，填这个路径打开，再点 File › Download 下载。</li>
      <li>选下载的文件（一次可以选几个），或者把打开的 JSON 全选、复制，贴到下面。</li>
    </ol>

    <div class="ti__actions">
      <button type="button" class="ti__button is-primary" @click="fileInput?.click()">选 trace 文件</button>
      <input ref="fileInput" type="file" accept=".json,application/json" multiple hidden @change="onFiles" />
      <button v-if="myTraces" type="button" class="ti__button" @click="clear">清掉我的 trace</button>
    </div>

    <details class="ti__paste">
      <summary>粘贴 JSON 文本</summary>
      <form class="ti__form" @submit.prevent="onPaste">
        <label :for="`${uid}-json`" class="ti__label">hg.trace 存的 JSON</label>
        <textarea
          :id="`${uid}-json`"
          v-model="pasted"
          class="ti__input"
          rows="4"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          translate="no"
          placeholder="{ &quot;v&quot;: 1, &quot;lines&quot;: [ … ] }"
        />
        <button type="submit" class="ti__button" :disabled="!pasted.trim()">导入粘贴的内容</button>
      </form>
    </details>

    <p class="ti__status" role="status">{{ status }}</p>

    <p v-if="myTraces" class="ti__have">
      已导入 {{ lines.length }} 行：<code translate="no">{{ lines.map((l) => l.line.name).join('、') }}</code>（{{ devices }}）。只存在这个浏览器里，不会上传。
    </p>
    <p v-if="myTraces && unsaved" class="ti__warn" role="alert">没能存进浏览器（太大，或者浏览器不让存）：这一页上照样能看，刷新以后要重新导入。</p>

    <div v-for="(p, i) in problemTexts" :key="i" class="ti__problem" role="alert">
      <p class="ti__problem-title">{{ p.source }}：没能导入</p>
      <dl>
        <div><dt>现象</dt><dd>{{ p.text.symptom }}</dd></div>
        <div><dt>原因</dt><dd>{{ p.text.cause }}</dd></div>
        <div><dt>怎么改</dt><dd>{{ p.text.fix }}</dd></div>
      </dl>
      <details v-if="p.error.raw" class="ti__raw">
        <summary>解析器的原文</summary>
        <pre translate="no">{{ p.error.raw }}</pre>
      </details>
    </div>
  </section>
</template>

<style scoped>
/* 卡片、眉标同本关和 2-4 的场景；按钮、输入框、出错块的样子同 LabCard。 */
.ti {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 20px 0;
  padding: 20px 22px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.ti__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.ti__eyebrow {
  color: var(--hg-sky-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.ti__title {
  font-family: var(--hg-font-display);
  font-size: 17px;
}

.ti__steps {
  margin: 0;
  padding-left: 1.4em;
  color: var(--hg-ink-2);
  font-size: 15px;
}

.ti__steps li + li {
  margin-top: 4px;
}

.ti__steps code,
.ti__have code {
  font-family: var(--hg-font-mono);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.ti__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ti__button {
  min-height: 40px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}

.ti__button.is-primary {
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.ti__button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ti__button:focus-visible,
.ti__paste summary:focus-visible,
.ti__raw summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.ti__paste summary {
  color: var(--hg-ink-2);
  font-size: 15px;
  cursor: pointer;
}

.ti__form {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
}

.ti__label {
  color: var(--hg-ink-2);
  font-size: 13px;
}

.ti__input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  resize: vertical;
}

.ti__input:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 1px;
}

.ti__status:empty {
  display: none;
}

.ti__status,
.ti__have,
.ti__warn {
  margin: 0;
  font-size: 14px;
}

.ti__have {
  color: var(--hg-ink-2);
}

.ti__warn {
  color: var(--hg-error-ink);
}

.ti__problem {
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
  font-size: 14px;
}

.ti__problem-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.ti__problem dl {
  margin: 0;
}

.ti__problem dl div {
  display: grid;
  grid-template-columns: 4em 1fr;
  gap: 8px;
}

.ti__problem dt {
  color: var(--hg-ink-2);
}

.ti__problem dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.ti__raw {
  margin-top: 6px;
}

.ti__raw summary {
  color: var(--hg-ink-2);
  cursor: pointer;
}

.ti__raw pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

@media (max-width: 520px) {
  .ti {
    padding: 16px;
  }
}
</style>
