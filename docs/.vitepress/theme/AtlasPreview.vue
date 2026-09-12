<script setup lang="ts">
import { withBase } from 'vitepress'
import AtlasVendors from './AtlasVendors.vue'
import UiIcon from './UiIcon.vue'
</script>

<template>
  <section class="hg-atlas-preview" aria-labelledby="atlas-preview-title">
    <header>
      <div><p class="hg-atlas-eyebrow">GPU ATLAS</p><h2 id="atlas-preview-title">换一个视角，看懂 GPU。</h2><p class="hg-atlas-preview-description">从架构演进到芯片内部，让教程中的概念有迹可循。</p></div>
      <a :href="withBase('/atlas/')">进入 GPU 图谱 <UiIcon name="arrow" :size="18" /></a>
    </header>
    <AtlasVendors compact />
  </section>
</template>

<style scoped>
.hg-atlas-preview {
  max-width: 1456px;
  margin: 0 auto;
  padding: 86px 48px 16px;
  border-top: 1px solid var(--vp-c-divider);
}

.hg-atlas-preview header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 30px;
  margin-bottom: 34px;
}

.hg-atlas-eyebrow {
  font: 11px var(--vp-font-family-mono);
  letter-spacing: .12em;
  color: var(--vp-c-text-3);
  margin: 0 0 18px;
}

.hg-atlas-preview h2 {
  font-size: clamp(30px, 3vw, 44px);
  line-height: 1.3;
  letter-spacing: -.04em;
  font-weight: 600;
  margin: 0;
}

.hg-atlas-preview-description {
  font-size: 15px;
  line-height: 1.8;
  margin: 18px 0 0;
  color: var(--vp-c-text-2);
}

.hg-atlas-preview header > a {
  display: flex;
  align-items: center;
  gap: 16px;
  white-space: nowrap;
  font-size: 14px;
  color: var(--vp-c-brand-1);
  margin-bottom: 4px;
}

@media (max-width: 1000px) {
  .hg-atlas-preview {
    padding-left: 32px;
    padding-right: 32px;
  }
  .hg-atlas-preview header {
    align-items: flex-start;
    flex-direction: column;
    gap: 20px;
  }
}

@media (max-width: 600px) {
  .hg-atlas-preview {
    padding: 60px 24px 0;
  }
  .hg-atlas-preview h2 {
    font-size: 31px;
  }
  .hg-atlas-preview-description {
    font-size: 14px;
  }
}
</style>
