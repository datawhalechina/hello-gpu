<script setup lang="ts">
/**
 * 我的 GPU 卡片（L-07；07 第 7 节 hg.device_card()，04 第 7 节存档）：导入 hg.device_card() 打印的导入码，存进进度存档，
 * 显示当前那张卡；导入过几张时可以换当前的、可以删。
 *
 * 用法（组件已全局注册，Markdown 里直接写）：2-1 关卡页写 <DeviceCard />；「我的成长」页写 <DeviceCard :level="2" />，
 * level 是卡片标题的级别（默认 3，放在关卡正文的二级标题下面）。
 * 当前那张卡给 1-2 的全景图用（换成你的卡的 CU 数、wave 大小、显存），2-4 的 Roofline 用它的实测峰值。
 * 解码、检查在 lab.ts 的 decodeCard，换成存档里的样子在 device.ts，存几张、哪张是当前在 progress.ts。
 * 存档要等 onMounted 之后才读得到：读出来之前按没有卡片画，按钮先禁用，服务端渲染和水合一致（同「我的成长」页；见下面的 mounted）。
 */
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { withBase } from 'vitepress'
import { cardRecord, explainCardError } from '@course/device.ts'
import { dateText } from '@course/growth.ts'
import { memoryGiB } from '@course/hardware.ts'
import { CARD_PREFIX, LabCodeError, decodeCard, formatAt } from '@course/lab.ts'
import { isPublished, stageById, stageHref } from '@course/outline.ts'
import type { DeviceRecord } from '@course/progress.ts'
import { useProgress } from '@course/useProgress.ts'

const props = withDefaults(defineProps<{
  /** 卡片标题的级别：关卡正文里是 3（在二级标题下面），「我的成长」页的各张卡片是 2。 */
  level?: 2 | 3
}>(), { level: 3 })

const progress = useProgress()
const { state, loaded } = progress
const uid = useId()

/**
 * 这个组件挂载以后才按存档画。它是异步组件，水合要等它的代码块加载完，这时别的组件可能已经把存档读出来了；
 * 水合时要和服务端渲染的一样（按没有卡片画），不然就是水合不一致。
 */
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
const ready = computed(() => mounted.value && loaded.value)

const PANORAMA = stageById('novice-gpu-panorama')
const ROOFLINE = stageById('forge-roofline')
const panoramaHref = PANORAMA && isPublished(PANORAMA) ? withBase(stageHref(PANORAMA)) : ''

const current = computed(() => (ready.value ? progress.currentDevice() : null))
const others = computed(() => (ready.value ? state.devices.cards.filter((c) => c.id !== state.devices.current) : []))

// ── 导入 ────────────────────────────────────────────────────────────────────

const input = ref('')
const busy = ref(false)
const error = ref<LabCodeError | null>(null)
const errorText = computed(() => (error.value ? explainCardError(error.value) : null))
/** 这次做了什么，读屏会念（role="status"）。 */
const message = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const currentEl = ref<HTMLElement | null>(null)

async function submit() {
  if (!input.value.trim() || busy.value || !ready.value) return
  busy.value = true
  try {
    const record = cardRecord(await decodeCard(input.value))
    const before = state.devices.cards.find((c) => c.id === record.id)
    const saved = progress.saveDevice(record)
    error.value = null
    input.value = ''
    message.value = {
      added: `已导入「${record.name}」，现在用的就是这张卡。`,
      updated: `已更新「${record.name}」，现在用的就是这张卡。`,
      same: `「${record.name}」导入过同一串导入码，没有变化；现在用的就是这张卡。`,
      older: `「${record.name}」存着更新的导入码（${before ? formatAt(before.at) : ''} 生成），这一串更早，没有覆盖；现在用的就是这张卡。`,
    }[saved]
  } catch (caught) {
    error.value = caught instanceof LabCodeError ? caught : new LabCodeError('format', '码不完整或被改动过，解不开')
    message.value = ''
  } finally {
    busy.value = false
  }
}

/** 导入码里没有换行：在输入框里按 Enter 就是导入（输入法正在选字时的 Enter 不算，Shift + Enter 照常换行）。同 LabCard。 */
function onEnter(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  void submit()
}

// ── 换卡、删卡 ──────────────────────────────────────────────────────────────

async function select(card: DeviceRecord) {
  if (!progress.selectDevice(card.id)) return
  message.value = `现在用的是「${card.name}」。`
  await nextTick()
  currentEl.value?.focus()
}

async function remove(card: DeviceRecord) {
  if (!progress.removeDevice(card.id)) return
  message.value = `已删除「${card.name}」。要找回，再导入一次它的导入码。`
  await nextTick()
  inputEl.value?.focus()
}
</script>

<template>
  <section class="hg-device" :aria-labelledby="`${uid}-title`">
    <header class="hg-device__head">
      <span class="hg-device__eyebrow" aria-hidden="true">GPU CARD</span>
      <component :is="`h${props.level}`" :id="`${uid}-title`" class="hg-device__title">我的 GPU 卡片</component>
      <p class="hg-device__lead">
        在有 AMD GPU 的机器上运行 <code translate="no">hg.device_card()</code>，把它最后打印的导入码贴到下面。网页会记住这张卡：{{ PANORAMA?.code }} 的全景图换成它的 CU 数、wave 大小和显存，{{ ROOFLINE?.code }} 的 Roofline 用它的实测峰值。
      </p>
    </header>

    <div v-if="current" ref="currentEl" class="hg-device__card" tabindex="-1">
      <p class="hg-device__name">
        <span class="hg-device__tag">当前</span>
        <strong>{{ current.name }}</strong>
      </p>
      <dl class="hg-device__specs">
        <div><dt>架构（gfx）</dt><dd translate="no">{{ current.gfx }}</dd></div>
        <div><dt>计算单元</dt><dd>{{ current.cus }} 个</dd></div>
        <div><dt>wave 大小</dt><dd>{{ current.wave ? `${current.wave} 个线程` : '未知' }}</dd></div>
        <div><dt>显存</dt><dd>{{ memoryGiB(current.memoryBytes) }} GiB</dd></div>
        <div><dt>峰值带宽</dt><dd>{{ current.peak ? `${current.peak.gbps.toFixed(1)} GB/s` : '还没测' }}</dd></div>
        <div><dt>峰值算力</dt><dd>{{ current.peak ? `${current.peak.tflops.toFixed(2)} TFLOPS` : '还没测' }}</dd></div>
      </dl>
      <p class="hg-device__note">
        <template v-if="current.peak">峰值是 {{ current.peak.at.slice(0, 10) }} 生成的导入码带来的实测值：带宽测显存拷贝，算力测 FP32 FMA。</template>
        <template v-else>峰值还没测：{{ ROOFLINE?.code }} 关运行 <code translate="no">hg.peak()</code> 以后，再运行一次 <code translate="no">hg.device_card()</code>，把新的导入码贴进来。</template>
      </p>
      <p class="hg-device__note">
        软件：ROCm {{ current.env.rocm ?? '未知' }} · PyTorch {{ current.env.torch ?? '未知' }} · Triton {{ current.env.triton ?? '未找到' }}
      </p>
      <p class="hg-device__fine">导入码生成于 {{ formatAt(current.at) }}，{{ dateText(current.importedAt) }} 导入到这台设备。</p>
      <div class="hg-device__actions">
        <a v-if="panoramaHref" class="hg-device__link" :href="panoramaHref">在 {{ PANORAMA?.code }} 的全景图里看</a>
        <button type="button" class="hg-device__button" @click="remove(current)">删除这张卡</button>
      </div>
    </div>
    <p v-else class="hg-device__empty">
      <template v-if="ready">还没有导入卡片。没有卡片时，全景图画的是本书的实验卡。</template>
    </p>

    <div v-if="others.length" class="hg-device__others">
      <p :id="`${uid}-others`" class="hg-device__label">导入过的其他卡</p>
      <ul :aria-labelledby="`${uid}-others`">
        <li v-for="card in others" :key="card.id" class="hg-device__other">
          <span class="hg-device__other-text">
            <strong>{{ card.name }}</strong>
            <span translate="no">{{ card.gfx }} · {{ card.cus }} 个计算单元 · {{ memoryGiB(card.memoryBytes) }} GiB</span>
          </span>
          <span class="hg-device__other-actions">
            <button type="button" class="hg-device__button" @click="select(card)">用这张</button>
            <button type="button" class="hg-device__button" @click="remove(card)">删除</button>
          </span>
        </li>
      </ul>
    </div>

    <form class="hg-device__form" @submit.prevent="submit">
      <label :for="`${uid}-code`" class="hg-device__label">导入码</label>
      <textarea
        :id="`${uid}-code`"
        ref="inputEl"
        v-model="input"
        class="hg-device__input"
        rows="3"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        translate="no"
        :placeholder="`${CARD_PREFIX}……`"
        @keydown.enter.exact="onEnter"
      />
      <button type="submit" class="hg-device__submit" :disabled="!ready || busy || !input.trim()">{{ busy ? '正在导入…' : '导入' }}</button>
    </form>
    <div v-if="errorText" class="hg-device__problem" role="alert">
      <p class="hg-device__problem-title">没能导入</p>
      <dl>
        <div><dt>现象</dt><dd>{{ errorText.symptom }}</dd></div>
        <div><dt>原因</dt><dd>{{ errorText.cause }}</dd></div>
        <div><dt>怎么改</dt><dd>{{ errorText.fix }}</dd></div>
      </dl>
    </div>
    <p class="hg-device__msg" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.hg-device {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 20px 0;
  padding: 18px 20px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
  color: var(--hg-ink);
}

.hg-device__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.hg-device__eyebrow {
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

/* 标题去掉正文 h2 / h3 的分隔线和大间距。 */
.hg-device__title {
  margin: 0;
  padding: 0;
  border: 0;
  font-family: var(--hg-font-display);
  font-size: var(--hg-text-card-title);
  letter-spacing: 0;
}

.hg-device__lead {
  flex-basis: 100%;
  margin: 6px 0 0;
  color: var(--hg-ink-2);
  font-size: 15px;
}

/* ---------- 当前那张卡：名字 + 一格一项的参数 ---------- */

.hg-device__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
}

/* 换卡以后焦点落在这里（读屏念出新的卡），不是可操作的控件，不画焦点框。 */
.hg-device__card:focus {
  outline: none;
}

.hg-device__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin: 0;
  font-family: var(--hg-font-display);
  font-size: 18px;
  overflow-wrap: anywhere;
}

.hg-device__tag {
  padding: 1px 10px;
  border-radius: var(--hg-radius-pill);
  background: var(--hg-accent-soft);
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

/* 六项排成 3 × 2；手机上 2 × 3（一格一项，数值折行只在空格处）。 */
.hg-device__specs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.hg-device__specs > div {
  min-width: 0;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
}

.hg-device__specs dt {
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-device__specs dd {
  margin: 2px 0 0;
  font-family: var(--hg-font-mono);
  font-size: 16px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.hg-device__note,
.hg-device__empty,
.hg-device__msg {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-device__fine {
  margin: 0;
  color: var(--hg-ink-3);
  font-size: 13px;
}

/* 没有消息时也留在页面上（读屏要先有这个 role=status 区域，后来写进去的话才会念），只是抵掉间距。 */
.hg-device__empty:empty,
.hg-device__msg:empty {
  margin-top: -14px;
}

.hg-device__actions,
.hg-device__other-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ---------- 导入过的其他卡 ---------- */

.hg-device__others ul {
  display: grid;
  gap: 8px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.hg-device__other {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
  margin: 0;
  padding: 8px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
}

.hg-device__other-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
}

.hg-device__other-text span {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

/* ---------- 按钮和输入框（同 LabCard） ---------- */

.hg-device__label {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.hg-device__link,
.hg-device__button,
.hg-device__submit {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out);
}

.hg-device__link:hover,
.hg-device__button:hover,
.hg-device__submit:not(:disabled):hover {
  border-color: var(--hg-accent);
}

/* 主按钮用深墨底配反色文字，强调色只留给进度和焦点（01 第 2.2 节）。 */
.hg-device__submit {
  justify-content: center;
  min-width: 6.5em;
  border-color: var(--hg-ink);
  background: var(--hg-ink);
  color: var(--hg-surface);
}

.hg-device__submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.hg-device__link:focus-visible,
.hg-device__button:focus-visible,
.hg-device__submit:focus-visible,
.hg-device__input:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.hg-device__form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 6px 10px;
}

.hg-device__form .hg-device__label {
  grid-column: 1 / -1;
}

.hg-device__input {
  width: 100%;
  min-height: 72px;
  padding: 8px 10px;
  border: var(--hg-border-width) solid var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  background: var(--hg-bg);
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
  resize: vertical;
}

.hg-device__problem {
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-error);
  border-radius: var(--hg-radius-control);
  background: var(--hg-error-soft);
}

.hg-device__problem-title {
  margin: 0 0 6px;
  color: var(--hg-error-ink);
  font-weight: 700;
}

.hg-device__problem dl {
  display: grid;
  gap: 4px;
  margin: 0;
}

.hg-device__problem dl > div {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
}

.hg-device__problem dt {
  color: var(--hg-ink-2);
  font-weight: 600;
}

.hg-device__problem dd {
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 480px) {
  .hg-device {
    padding: 16px;
  }

  .hg-device__specs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hg-device__form {
    grid-template-columns: minmax(0, 1fr);
  }

  .hg-device__submit {
    justify-self: start;
  }
}
</style>
