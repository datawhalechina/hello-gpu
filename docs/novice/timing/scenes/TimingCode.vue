<script setup lang="ts">
/**
 * 1-11 的计时代码（关卡自己的 scenes，不用登记组件）：照着计时台的写法，按读者的写法偏好（LangCode）
 * 显示 HIP 风格或 Python 风格。旋钮管着的那几行标出来（左边一道竖线、底色），旋钮一换，代码马上跟着变。
 * 两种写法的行一一对应（challenge.ts 的 codeRows，单测核对）。高亮和代码沙盒是同一套（highlight.ts）。
 */
import { computed } from 'vue'
import LangCode from '@kit/LangCode.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { codeRows, rowTexts, type Call, type Plan } from '../challenge.ts'

const props = defineProps<{
  plan: Plan
  call: Call
  /** 字节数的式子；不给就不写算带宽的两行 */
  bytesExpr?: string
}>()

type Pane = { text: string; tone: Tone | '' }[]

/** 一行按 highlight() 的结果切成几段，关键字和注释着色。 */
function pieces(source: string, lang: 'hip' | 'python'): Pane {
  const parts: Pane = []
  let at = 0
  for (const token of highlight(source, lang)) {
    if (token.from > at) parts.push({ text: source.slice(at, token.from), tone: '' })
    parts.push({ text: source.slice(token.from, token.to), tone: token.tone })
    at = token.to
  }
  if (at < source.length) parts.push({ text: source.slice(at), tone: '' })
  return parts
}

function lines(lang: 'hip' | 'python') {
  const rows = codeRows(props.plan, props.call, lang, props.bytesExpr)
  return rowTexts(rows, lang).map((text, i) => ({ knob: rows[i].knob !== null, parts: pieces(text, lang) }))
}

const panes = computed(() => ({ hip: lines('hip'), python: lines('python') }))
</script>

<template>
  <div class="tc">
    <LangCode>
      <template #hip>
        <div class="language-cpp"><span class="lang">cpp</span><pre><code><template v-for="(line, i) in panes.hip" :key="i"><span class="tc__line" :class="{ 'is-knob': line.knob }"><span v-for="(p, k) in line.parts" :key="k" :class="p.tone ? `is-${p.tone}` : undefined">{{ p.text }}</span></span>{{ i < panes.hip.length - 1 ? '\n' : '' }}</template></code></pre></div>
      </template>
      <template #python>
        <div class="language-python"><span class="lang">python</span><pre><code><template v-for="(line, i) in panes.python" :key="i"><span class="tc__line" :class="{ 'is-knob': line.knob }"><span v-for="(p, k) in line.parts" :key="k" :class="p.tone ? `is-${p.tone}` : undefined">{{ p.text }}</span></span>{{ i < panes.python.length - 1 ? '\n' : '' }}</template></code></pre></div>
      </template>
    </LangCode>
    <p class="tc__note">标了竖线的行由上面的旋钮管。<code>now()</code> 看一眼时钟，读出现在是第几个周期（模拟）。</p>
  </div>
</template>

<style scoped>
.tc {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tc :deep(.hg-langcode) {
  margin: 0;
}

.tc :deep(div[class*='language-']) {
  margin: 0;
}

/* 旋钮管着的行：左边一道竖线，加一层底色（和代码区「读者要改的地方」同一个颜色）。 */
.tc__line.is-knob {
  display: inline-block;
  min-width: 100%;
  margin-left: -10px;
  padding-left: 7px;
  border-left: 3px solid var(--hg-code-highlight);
  background: color-mix(in srgb, var(--hg-code-highlight) 14%, transparent);
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

.tc__note {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

@media (max-width: 639px) {
  .tc :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .tc :deep(div[class*='language-'] code) {
    font-size: 13px;
  }
}
</style>
