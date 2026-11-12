<script setup lang="ts">
/**
 * 实验环境指南（L-06）里一个平台的 GPU 和 ROCm / PyTorch / Triton 版本。
 *
 * 数据在 docs/course/lab-platforms.json（写法同 hardware.json），页面不手写版本号和硬件参数（09 第 4 节）：
 * 每项带出处，展开「这些数从哪来」能看到出处和在出处的哪个位置；查不到的写「[待实测]」。
 * id 写错时画红框，构建失败（F-09 的内容检查）。
 */
import { computed } from 'vue'
import { useData } from 'vitepress'
import { contentError } from '@kit/contentError.ts'
import { PLATFORM_FACTS, platformById, platformFact } from '@course/labPlatforms.ts'

const props = defineProps<{
  /** lab-platforms.json 里的平台 id。 */
  id: string
}>()

const { page } = useData()
const platform = computed(() => platformById(props.id))
const facts = computed(() => {
  const p = platform.value
  return p ? PLATFORM_FACTS.map((key) => platformFact(p, key)) : []
})
const problem = computed(() =>
  platform.value ? '' : contentError(`PlatformFacts 的 id「${props.id}」不在 docs/course/lab-platforms.json 里。`, page.value.relativePath),
)
</script>

<template>
  <p v-if="problem" class="sf-error" role="alert" data-hg-content-error>{{ problem }}</p>
  <section v-else class="sf" :aria-label="`${platform?.name}：GPU 和软件版本`">
    <dl class="sf__grid">
      <div v-for="fact in facts" :key="fact.key" class="sf__cell">
        <dt class="sf__label">{{ fact.label }}</dt>
        <dd class="sf__value" :class="{ 'is-pending': fact.pending }" translate="no">{{ fact.text }}</dd>
      </div>
    </dl>
    <details class="sf__from">
      <summary>这些数从哪来</summary>
      <ul>
        <li v-for="fact in facts" :key="fact.key">
          <span class="sf__from-name">{{ fact.label }}</span>
          <template v-if="fact.source">
            <a :href="fact.source.url" target="_blank" rel="noopener">{{ fact.source.title }}</a>：{{ fact.where }}（{{ fact.source.checked }} 核对）
          </template>
          <template v-else>还没有出处。在这个环境里跑一遍环境检查，卡片上会打印这一项。</template>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.sf {
  margin: 4px 0 24px;
  padding: 14px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface);
  box-shadow: var(--hg-shadow);
}

/* 五项排成一行（375px 上两列）：上面是名字，下面是值。 */
.sf__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 12px 16px;
  margin: 0;
}

.sf__cell {
  min-width: 0;
}

.sf__label {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.sf__value {
  margin: 2px 0 0;
  font-family: var(--hg-font-mono);
  font-size: 15px;
  font-weight: 600;
  /* 版本号很长（3.8.0+git4cff872c.rocm10.0.0）：窄屏上在任意位置折行，不把卡片撑出屏幕。 */
  overflow-wrap: anywhere;
}

.sf__value.is-pending {
  color: var(--hg-ink-3);
  font-weight: 400;
}

.sf__from {
  margin: 12px 0 0;
  padding: 10px 0 0;
  border-top: var(--hg-border-width) dashed var(--hg-border);
  color: var(--hg-ink-2);
  font-size: 14px;
}

.sf__from summary {
  width: fit-content;
  font-weight: 600;
  cursor: pointer;
}

.sf__from summary:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

.sf__from ul {
  margin: 8px 0 0;
}

.sf__from li {
  overflow-wrap: anywhere;
}

.sf__from-name {
  margin-right: 6px;
  color: var(--hg-ink);
  font-weight: 600;
}

.sf-error {
  margin: 0 0 20px;
  padding: 14px 18px;
  border: 2px dashed var(--hg-error);
  border-radius: var(--hg-radius-card);
  background: var(--hg-error-soft);
  color: var(--hg-error-ink);
  font-weight: 600;
}
</style>
