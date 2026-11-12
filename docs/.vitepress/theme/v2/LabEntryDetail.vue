<script setup lang="ts">
/**
 * 实验档案馆里一条记录的详情（L-04）：浏览页展开一条、读到条目全文以后显示。
 * 四块，和条目的格式一一对应（docs/lab/schema.json）：通关凭证、完整环境、原始样本、Notebook 的关键输出；
 * 最后是下载原文、在 GitHub 查看。原始样本按测量的先后画成折线，看得出预热够不够、有没有离群的几次。
 */
import { computed } from 'vue'
import { withBase } from 'vitepress'
import ArchiveCell from '@kit/lab/ArchiveCell.vue'
import ArchiveOutput from '@kit/lab/ArchiveOutput.vue'
import { memoryGiB } from '@course/hardware.ts'
import { LAB_REPO, ROUTE_NAMES, formatAt, formatNumber, githubUrl, metricLabel, metricUnit } from '@course/lab.ts'
import { archiveDataPath, archiveFile, sampleStats, seriesChart, type ArchiveEntry } from '@course/labArchive.ts'
import { platformById } from '@course/labPlatforms.ts'

const props = defineProps<{
  /** 条目 id：<关卡 id>/<文件名去掉 .json>。 */
  id: string
  entry: ArchiveEntry
}>()

const credential = computed(() => props.entry.credential)

const metrics = computed(() => Object.entries(credential.value.metrics).map(([name, value]) => ({
  name, label: metricLabel(name), text: `${formatNumber(value)} ${metricUnit(name)}`.trim(),
})))

/** 完整环境：设备、峰值、平台、软件、系统；code 为 true 的照原样用等宽字（版本号、架构名不翻译）。 */
const facts = computed(() => {
  const { device, peak, platform, software, system } = props.entry.environment
  return [
    { label: 'GPU', value: device.name },
    { label: '架构（gfx）', value: device.gfx, code: true },
    { label: '计算单元', value: `${device.cus} 个` },
    { label: 'wave 大小', value: device.wave ? `${device.wave} 个线程` : '未知' },
    { label: '显存', value: `${memoryGiB(device.memory_bytes)} GiB` },
    { label: '实测峰值', value: peak ? `${formatNumber(peak.gbps)} GB/s · ${formatNumber(peak.tflops)} TFLOPS` : '还没测' },
    { label: '在哪跑的', value: platformById(platform)?.name ?? platform },
    { label: 'ROCm', value: software.rocm ?? '查不到', code: true },
    { label: 'HIP', value: software.hip ?? '查不到', code: true },
    { label: 'PyTorch', value: software.torch ?? '查不到', code: true },
    { label: 'Triton', value: software.triton ?? '查不到', code: true },
    { label: 'Python', value: software.python, code: true },
    { label: '操作系统', value: system.os },
    { label: '内核', value: system.kernel, code: true },
    { label: 'CPU', value: system.cpu },
  ]
})

const variables = computed(() => Object.entries(props.entry.environment.variables ?? {}).map(([name, value]) => `${name}=${value}`))
/** 示例条目的提交是占位的 0000000，不做成链接。 */
const commitHref = computed(() => (props.entry.example ? '' : `${LAB_REPO}/commit/${props.entry.environment.commit}`))

const series = computed(() => props.entry.samples.map((s) => {
  const stats = sampleStats(s.ms)
  return {
    ...s,
    chart: seriesChart(s),
    stats: [
      { label: '中位数', value: stats.median },
      { label: 'p10', value: stats.p10 },
      { label: 'p90', value: stats.p90 },
      { label: '最小', value: stats.min },
      { label: '最大', value: stats.max },
    ].map((item) => ({ label: item.label, text: `${formatNumber(item.value)} ms` })),
  }
}))
</script>

<template>
  <div class="la-detail">
    <p v-if="entry.note" class="la-detail__note">{{ entry.note }}</p>

    <section class="la-block">
      <h4 class="la-block__title">通关凭证</h4>
      <p class="la-block__lead">
        <code translate="no">hg.submit()</code> 在 {{ formatAt(credential.at) }} 生成，{{ ROUTE_NAMES[credential.route] }}；校验 {{ credential.checks.passed }}/{{ credential.checks.total }} 项通过。
      </p>
      <div class="la-scroll">
        <table class="la-table">
          <thead>
            <tr>
              <th scope="col">测量项</th>
              <th scope="col">数值</th>
              <th scope="col">名字</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in metrics" :key="m.name">
              <th scope="row">{{ m.label }}</th>
              <td class="is-number">{{ m.text }}</td>
              <td><code translate="no">{{ m.name }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="la-block">
      <h4 class="la-block__title">完整环境</h4>
      <dl class="la-facts">
        <div v-for="f in facts" :key="f.label">
          <dt>{{ f.label }}</dt>
          <dd :class="{ 'is-code': f.code }" :translate="f.code ? 'no' : undefined">{{ f.value }}</dd>
        </div>
        <div v-if="variables.length" class="is-wide">
          <dt>环境变量</dt>
          <dd class="is-code" translate="no">
            <span v-for="v in variables" :key="v" class="la-facts__var">{{ v }}</span>
          </dd>
        </div>
        <div>
          <dt>仓库提交</dt>
          <dd class="is-code" translate="no">
            <a v-if="commitHref" :href="commitHref" target="_blank" rel="noreferrer">{{ entry.environment.commit }}</a>
            <template v-else>{{ entry.environment.commit }}</template>
          </dd>
        </div>
      </dl>
    </section>

    <section class="la-block">
      <h4 class="la-block__title">原始样本</h4>
      <p v-if="!series.length" class="la-block__lead">这条记录没有计时样本。</p>
      <div v-for="s in series" :key="s.label" class="la-series">
        <p class="la-series__head">
          <code translate="no">{{ s.label }}</code>
          <span v-if="s.note">{{ s.note }}</span>
          <span>预热 {{ s.warmup }} 次，计时 {{ s.repeat }} 次</span>
          <span class="la-series__method" translate="no">{{ s.method }}</span>
        </p>
        <dl class="la-stats">
          <div v-for="item in s.stats" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd>{{ item.text }}</dd>
          </div>
        </dl>
        <ArchiveOutput :output="s.chart" />
      </div>
    </section>

    <section class="la-block">
      <h4 class="la-block__title">Notebook 的关键输出</h4>
      <p class="la-block__lead">按 Notebook 里的顺序，共 {{ entry.cells.length }} 个单元。</p>
      <div class="la-cells">
        <ArchiveCell v-for="(cell, i) in entry.cells" :key="i" :cell="cell" />
      </div>
    </section>

    <p class="la-detail__links">
      <a :href="withBase(archiveDataPath(id))" download>下载这条记录（JSON）</a>
      <a :href="githubUrl(archiveFile(id))" target="_blank" rel="noreferrer">在 GitHub 查看</a>
    </p>
  </div>
</template>

<style scoped>
.la-detail {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
}

.la-detail__note {
  margin: 0;
  padding: 10px 14px;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-control);
  color: var(--hg-ink-2);
  font-size: 14px;
}

.la-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* 正文 h4 的上边距由 .la-detail 的间距给 */
.la-detail .la-block__title {
  margin: 0;
  font-size: 16px;
}

.la-block__lead {
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.la-scroll {
  max-width: 100%;
  overflow-x: auto;
}

.la-detail .la-table {
  display: table;
  width: auto;
  max-width: none;
  margin: 0;
  overflow: visible;
  border-collapse: collapse;
  font-size: 14px;
}

.la-table th,
.la-table td {
  padding: 6px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  text-align: left;
  white-space: nowrap;
}

.la-table thead th {
  background: var(--hg-surface-2);
}

.la-table tbody th {
  font-weight: 500;
}

.la-table .is-number {
  font-family: var(--hg-font-mono);
  font-size: 13px;
  text-align: right;
}

.la-facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr));
  gap: 10px 18px;
  margin: 0;
}

.la-facts > div {
  min-width: 0;
}

.la-facts .is-wide {
  grid-column: 1 / -1;
}

.la-facts dt,
.la-stats dt {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.la-facts dd,
.la-stats dd {
  margin: 0;
  color: var(--hg-ink);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.la-facts dd.is-code {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.la-facts__var + .la-facts__var::before {
  content: ' · ';
  color: var(--hg-ink-3);
}

.la-series {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  min-width: 0;
}

.la-series__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
  margin: 0;
  color: var(--hg-ink-2);
  font-size: 13.5px;
}

.la-series__head code {
  color: var(--hg-ink);
  font-family: var(--hg-font-mono);
  font-size: 14px;
  font-weight: 700;
}

.la-series__method {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: 12px;
}

.la-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin: 0;
}

.la-stats dd {
  font-family: var(--hg-font-mono);
  font-size: 13px;
}

.la-cells {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.la-detail__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 0;
  font-size: 14px;
}
</style>
