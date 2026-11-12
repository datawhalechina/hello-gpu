<script setup lang="ts">
/**
 * 证据卡：说明本关的数字是模拟还是实测（03 第 3 节组件登记表、06 第 3 节第 11 项、09 第 4 节）。
 * 「模拟」和「实测」严格分开（05 第 3 节）：实测（measured）和混合（mixed）必须写清硬件、软件版本、
 * 日期和实验档案馆的条目——正文里的实测数字只能来自档案条目。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：
 *   <EvidenceCard kind="simulated">本关的数字来自浏览器里的模拟器，cache line 大小和延迟都是示意值。</EvidenceCard>
 *   <EvidenceCard kind="measured" hardware="AMD Radeon RX 9070 XT" software="ROCm …" date="2026-11-01"
 *     entry="forge-softmax/hip-rx-9070-xt-2026-11-01">这一页的耗时和带宽都来自这条记录。</EvidenceCard>
 *
 * entry 是实验档案馆的条目 id（docs/lab/data/<关卡 id>/<文件名去掉 .json>，L-04），链接到档案馆里的这一条
 * （/lab/#<条目 id>：那一条描边并自动展开；写法同 labArchive.ts 的 archiveHref。这里不 import 它：
 * 证据卡在每个页面都要加载的主题块里，import 会把档案馆的整个模块带进主题块）。
 * 实测缺字段时：开发时页面上显示红框警告，构建时直接报错。条目要在档案馆里、hardware 和 date 要和条目一致、
 * 正式页面不能引用示例条目：这几条由 npm run course:check（scripts/course/lab-data-check.mjs）检查。
 */
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { contentError } from './contentError.ts'

type Kind = 'simulated' | 'measured' | 'mixed'

const props = defineProps<{
  kind: Kind
  /** 实测用的硬件，例如 AMD Radeon RX 9070 XT。 */
  hardware?: string
  /** 软件版本，例如 ROCm、PyTorch 的版本号。 */
  software?: string
  /** 测量日期。 */
  date?: string
  /** 实验档案馆的条目 id。 */
  entry?: string
}>()

const { page } = useData()

const KINDS: readonly Kind[] = ['simulated', 'measured', 'mixed']
const KIND_NOTE: Record<Kind, string> = {
  simulated: '这些数字来自浏览器里的模拟器，用来看清机制，不代表真卡上的耗时。',
  measured: '这些数字在真卡上测得，完整的环境和原始样本见档案条目。',
  mixed: '示意部分来自模拟器，标了硬件的数字来自真卡实测。',
}

const hasMeasured = computed(() => props.kind === 'measured' || props.kind === 'mixed')
const known = computed(() => KINDS.includes(props.kind))

const missing = computed(() => {
  if (!hasMeasured.value) return []
  const fields: [string, string | undefined][] = [
    ['hardware（硬件）', props.hardware],
    ['software（软件版本）', props.software],
    ['date（日期）', props.date],
    ['entry（档案条目）', props.entry],
  ]
  return fields.filter(([, value]) => !value?.trim()).map(([name]) => name)
})

const problem = computed(() => {
  if (!known.value) {
    return contentError(`EvidenceCard 的 kind="${props.kind}" 不对，只能是 simulated、measured 或 mixed。`, page.value.relativePath)
  }
  if (missing.value.length) {
    return contentError(
      `EvidenceCard 是实测数据，但缺了 ${missing.value.join('、')}。实测数字必须写清硬件、软件版本、日期和档案条目。`,
      page.value.relativePath,
    )
  }
  return ''
})

const entryHref = computed(() => (props.entry ? withBase(`/lab/#${encodeURI(props.entry)}`) : ''))
</script>

<template>
  <aside class="hg-evidence" :class="[`is-${kind}`, { 'is-broken': problem }]" aria-label="数据来源">
    <p v-if="problem" class="hg-evidence__error" role="alert" data-hg-content-error>{{ problem }}</p>
    <template v-else>
      <p class="hg-evidence__head">
        <span class="hg-evidence__eyebrow" aria-hidden="true">EVIDENCE</span>
        <span v-if="kind !== 'measured'" class="hg-evidence__tag is-sim">模拟</span>
        <span v-if="hasMeasured" class="hg-evidence__tag is-real">实测</span>
        <span class="hg-evidence__note">{{ KIND_NOTE[kind] }}</span>
      </p>
      <div v-if="$slots.default" class="hg-evidence__body"><slot /></div>
      <dl v-if="hasMeasured" class="hg-evidence__facts">
        <div>
          <dt>硬件</dt>
          <dd>{{ hardware }}</dd>
        </div>
        <div>
          <dt>软件版本</dt>
          <dd>{{ software }}</dd>
        </div>
        <div>
          <dt>日期</dt>
          <dd>{{ date }}</dd>
        </div>
        <div>
          <dt>档案条目</dt>
          <dd><a :href="entryHref">{{ entry }}</a></dd>
        </div>
      </dl>
    </template>
  </aside>
</template>

<style scoped>
.hg-evidence {
  margin: 20px 0;
  padding: 14px 18px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface-2);
  color: var(--hg-ink-2);
  font-size: 14px;
  line-height: 1.6;
}

.hg-evidence__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
}

.hg-evidence__eyebrow {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

/* 模拟 = 虚线框，实测 = 实线框 + 实验室的天蓝；颜色之外还有文字（01 第 7 节）。 */
.hg-evidence__tag {
  padding: 0 8px;
  border-radius: var(--hg-radius-tag);
  font-size: var(--hg-text-label);
  font-weight: 700;
  line-height: 20px;
  white-space: nowrap;
}

.hg-evidence__tag.is-sim {
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  color: var(--hg-ink-2);
}

.hg-evidence__tag.is-real {
  border: var(--hg-border-width) solid var(--hg-sky-ink);
  color: var(--hg-sky-ink);
}

.hg-evidence__note {
  flex: 1 1 16em;
  min-width: 0;
}

.hg-evidence__body {
  margin-top: 6px;
  color: var(--hg-ink-2);
}

.hg-evidence__body :deep(p) {
  margin: 0 0 4px;
}

.hg-evidence__body :deep(p:last-child) {
  margin-bottom: 0;
}

.hg-evidence__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: 8px 16px;
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.hg-evidence__facts dt {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-evidence__facts dd {
  margin: 0;
  color: var(--hg-ink);
  overflow-wrap: anywhere;
}

.hg-evidence__facts a {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.hg-evidence__facts a:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
  border-radius: var(--hg-radius-tag);
}

.hg-evidence.is-broken {
  border: 2px dashed var(--hg-error);
  background: var(--hg-error-soft);
}

.hg-evidence__error {
  margin: 0;
  color: var(--hg-error-ink);
  font-weight: 600;
}
</style>
