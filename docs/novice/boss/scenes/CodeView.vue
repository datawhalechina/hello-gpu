<script setup lang="ts">
/**
 * Boss 的代码块（关卡自己的 scenes，不用登记组件）：两种写法的代码按读者的写法偏好显示一种（LangCode），
 * marks 里的行标出来（左边一道竖线、底色），同 1-11 的计时代码。高亮和代码沙盒是同一套（highlight.ts）。
 * 体检单标出坏的那几行，识破题标出补上的那一行。
 */
import { computed } from 'vue'
import LangCode from '@kit/LangCode.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import type { Lang } from '@sim/syntax/ast.ts'

const props = defineProps<{
  code: Readonly<Record<Lang, string>>
  /** 要标出来的行（从 1 数），两种写法各给 */
  marks?: Readonly<Partial<Record<Lang, readonly number[]>>>
}>()

type Piece = { text: string; tone: Tone | '' }

/** 一种写法的代码切成行，每行按 highlight() 的结果切成几段，关键字和注释着色。 */
function lines(lang: Lang) {
  const marked = new Set(props.marks?.[lang] ?? [])
  return props.code[lang].split('\n').map((source, i) => {
    const parts: Piece[] = []
    let at = 0
    for (const token of highlight(source, lang)) {
      if (token.from > at) parts.push({ text: source.slice(at, token.from), tone: '' })
      parts.push({ text: source.slice(token.from, token.to), tone: token.tone })
      at = token.to
    }
    if (at < source.length) parts.push({ text: source.slice(at), tone: '' })
    return { mark: marked.has(i + 1), parts }
  })
}

const panes = computed(() => ({ hip: lines('hip'), python: lines('python') }))
</script>

<template>
  <div class="cv">
    <LangCode>
      <template #hip>
        <div class="language-cpp"><span class="lang">cpp</span><pre><code><template v-for="(line, i) in panes.hip" :key="i"><span class="cv__line" :class="{ 'is-mark': line.mark }"><span v-for="(p, k) in line.parts" :key="k" :class="p.tone ? `is-${p.tone}` : undefined">{{ p.text }}</span></span>{{ i < panes.hip.length - 1 ? '\n' : '' }}</template></code></pre></div>
      </template>
      <template #python>
        <div class="language-python"><span class="lang">python</span><pre><code><template v-for="(line, i) in panes.python" :key="i"><span class="cv__line" :class="{ 'is-mark': line.mark }"><span v-for="(p, k) in line.parts" :key="k" :class="p.tone ? `is-${p.tone}` : undefined">{{ p.text }}</span></span>{{ i < panes.python.length - 1 ? '\n' : '' }}</template></code></pre></div>
      </template>
    </LangCode>
  </div>
</template>

<style scoped>
.cv {
  min-width: 0;
}

.cv :deep(.hg-langcode) {
  margin: 0;
}

.cv :deep(div[class*='language-']) {
  margin: 0;
}

/* 标出来的行：左边一道竖线，加一层底色（和代码区「读者要改的地方」同一个颜色，同 1-11）。 */
.cv__line.is-mark {
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

@media (max-width: 639px) {
  .cv :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .cv :deep(div[class*='language-'] code) {
    font-size: 13px;
  }
}
</style>
