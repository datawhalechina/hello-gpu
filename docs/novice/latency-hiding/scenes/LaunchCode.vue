<script setup lang="ts">
/**
 * 1-12 的启动代码（关卡自己的 scenes，不用登记组件）：按读者的写法偏好（LangCode）显示 HIP 风格或 Python 风格，
 * 两种都在服务端渲染。旋钮一换，派几组、每人加几个马上跟着变。高亮和代码沙盒是同一套（highlight.ts）。
 */
import { computed } from 'vue'
import LangCode from '@kit/LangCode.vue'
import { highlight, type Tone } from '@kit/sandbox/highlight.ts'
import { launchCode, type Plan } from '../challenge.ts'

const props = defineProps<{ plan: Plan }>()

/** 代码按 highlight() 的结果切成几段，关键字和注释着色（同 1-8 的实验台）。 */
function pieces(lang: 'hip' | 'python') {
  const source = launchCode(props.plan, lang)
  const parts: { text: string; tone: Tone | '' }[] = []
  let at = 0
  for (const token of highlight(source, lang)) {
    if (token.from > at) parts.push({ text: source.slice(at, token.from), tone: '' })
    parts.push({ text: source.slice(token.from, token.to), tone: token.tone })
    at = token.to
  }
  if (at < source.length) parts.push({ text: source.slice(at), tone: '' })
  return parts
}

const code = computed(() => ({ hip: pieces('hip'), python: pieces('python') }))
</script>

<template>
  <div class="lc">
    <LangCode>
      <template #hip>
        <div class="language-cpp"><span class="lang">cpp</span><pre><code><span v-for="(seg, k) in code.hip" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
      </template>
      <template #python>
        <div class="language-python"><span class="lang">python</span><pre><code><span v-for="(seg, k) in code.python" :key="k" :class="seg.tone ? `is-${seg.tone}` : undefined">{{ seg.text }}</span></code></pre></div>
      </template>
    </LangCode>
  </div>
</template>

<style scoped>
.lc {
  min-width: 0;
}

.lc :deep(.hg-langcode) {
  margin: 0;
}

.lc :deep(div[class*='language-']) {
  margin: 0;
}

.is-keyword {
  color: var(--hg-code-keyword);
}

.is-comment {
  color: var(--hg-code-file);
}

@media (max-width: 639px) {
  .lc :deep(div[class*='language-'] pre) {
    padding: 10px 12px 12px;
  }

  .lc :deep(div[class*='language-'] code) {
    font-size: 13px;
  }
}
</style>
