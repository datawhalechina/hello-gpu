<script setup lang="ts">
import { withBase } from 'vitepress'
import { atlasVendors } from './atlas'
import UiIcon from './UiIcon.vue'
defineProps<{ compact?: boolean }>()
</script>

<template>
  <div class="hg-atlas-vendors" :class="{ 'is-compact': compact }">
    <a v-for="vendor in atlasVendors" :key="vendor.id" class="hg-atlas-vendor" :class="`vendor-${vendor.id}`"
      :href="withBase(vendor.href)" :target="vendor.standalone ? '_self' : undefined">
      <div class="hg-atlas-vendor-identity">
        <span class="hg-atlas-vendor-name">{{ vendor.name }}</span>
        <span class="hg-atlas-vendor-status"><i v-if="vendor.id === 'nvidia'" aria-hidden="true" />{{ vendor.status }}</span>
      </div>
      <div class="hg-atlas-vendor-art" aria-hidden="true">
        <img v-if="vendor.id === 'nvidia'" :src="withBase('/atlas-previews/nvidia-rtx5090.webp')" width="1497" height="1244" alt="" loading="lazy" decoding="async">
        <div v-else class="hg-atlas-planned-art">
          <svg viewBox="0 0 320 230" fill="none">
            <path d="m160 22 126 70-126 70L34 92Z" />
            <path d="m34 126 126 70 126-70M34 159l126 70 126-70" />
            <path d="m85 92 75-42 75 42-75 42Z" />
            <path d="M160 162v66M34 92v67M286 92v67" stroke-dasharray="3 6" />
          </svg>
          <span>RDNA <i>/</i> CDNA</span>
        </div>
      </div>
      <div class="hg-atlas-vendor-copy">
        <h3>{{ vendor.title }}</h3>
        <p>{{ vendor.description }}</p>
        <span class="hg-atlas-vendor-detail">{{ vendor.detail }}</span>
        <span class="hg-atlas-vendor-action">{{ vendor.action }} <UiIcon name="arrow" :size="19" /></span>
      </div>
    </a>
  </div>
</template>

<style scoped>
.hg-atlas-vendors {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.hg-atlas-vendor {
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  padding: 30px 36px 34px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 18px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  overflow: hidden;
  transition: border-color .2s, background .2s;
}

.hg-atlas-vendor:hover {
  border-color: var(--hg-line-strong);
  background: var(--vp-c-bg-elv);
}

.hg-atlas-vendor-identity {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  position: relative;
  z-index: 1;
}

.hg-atlas-vendor-name {
  font-size: 24px;
  font-weight: 650;
  letter-spacing: -.03em;
}

.hg-atlas-vendor-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  color: var(--vp-c-text-2);
}

.hg-atlas-vendor-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.hg-atlas-vendor-art {
  height: 260px;
  margin: 14px 0 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hg-atlas-vendor-art img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.hg-atlas-planned-art {
  position: relative;
  width: 270px;
  height: 210px;
  color: var(--vp-c-brand-1);
}

.hg-atlas-planned-art svg {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  stroke-width: 1;
  opacity: .55;
}

.hg-atlas-planned-art > span {
  display: block;
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  text-align: center;
  font: 11px var(--vp-font-family-mono);
  letter-spacing: .12em;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  padding-top: 8px;
}

.hg-atlas-planned-art i {
  font-style: normal;
  color: var(--vp-c-text-3);
  margin: 0 12px;
}

.hg-atlas-vendor-copy {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.hg-atlas-vendor h3 {
  text-wrap: balance;
  font-size: clamp(22px, 2.1vw, 30px);
  line-height: 1.4;
  font-weight: 600;
  letter-spacing: -.03em;
  margin: 0;
}

.hg-atlas-vendor-copy p {
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.9;
  margin: 16px 0;
  max-width: 450px;
}

.hg-atlas-vendor-detail {
  font-size: 11px;
  line-height: 1.7;
  color: var(--vp-c-text-3);
  margin: 0 0 26px;
}

.hg-atlas-vendor-action {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  color: var(--vp-c-brand-1);
  font-size: 14px;
  font-weight: 500;
  margin-top: auto;
}

.hg-atlas-vendor-action svg {
  transition: transform .2s;
}

.hg-atlas-vendor:hover .hg-atlas-vendor-action svg {
  transform: translateX(4px);
}

.is-compact .hg-atlas-vendor {
  padding: 26px 30px 28px;
  min-height: 275px;
}

.is-compact .hg-atlas-vendor-art {
  position: absolute;
  right: -12px;
  top: 45px;
  width: 45%;
  height: 190px;
  margin: 0;
  pointer-events: none;
}

.is-compact .hg-atlas-planned-art {
  width: 180px;
  height: 160px;
}

.is-compact .hg-atlas-planned-art > span {
  display: none;
}

.is-compact .hg-atlas-vendor-copy {
  margin-top: 25px;
  position: relative;
}

.is-compact .hg-atlas-vendor h3 {
  text-wrap: balance;
  font-size: 22px;
  max-width: 66%;
}

.is-compact .hg-atlas-vendor-copy p {
  max-width: 56%;
  font-size: 13px;
  line-height: 1.8;
  margin: 14px 0 24px;
}

.is-compact .hg-atlas-vendor-detail {
  display: none;
}

@media (max-width: 1100px) {
  .hg-atlas-vendor {
    padding: 26px;
  }
  .hg-atlas-vendor-art {
    height: 215px;
  }
  .is-compact .hg-atlas-vendor-art {
    opacity: .65;
  }
  .is-compact .hg-atlas-vendor h3 {
  text-wrap: balance;
    font-size: 20px;
    max-width: 72%;
  }
  .is-compact .hg-atlas-vendor-copy p {
    max-width: 64%;
  }
}

@media (max-width: 700px) {
  .hg-atlas-vendors {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .hg-atlas-vendor {
    padding: 24px;
  }
  .hg-atlas-vendor h3 {
  text-wrap: balance;
    font-size: 25px;
  }
  .hg-atlas-vendor-art {
    height: 220px;
  }
  .is-compact .hg-atlas-vendor {
    padding: 24px;
    min-height: 270px;
  }
  .is-compact .hg-atlas-vendor h3 {
  text-wrap: balance;
    max-width: 68%;
  }
  .is-compact .hg-atlas-vendor-copy p {
    max-width: 63%;
  }
  .is-compact .hg-atlas-vendor-art {
    width: 43%;
    top: 52px;
    height: 180px;
    opacity: .8;
  }
  .hg-atlas-vendor-status {
    font-size: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hg-atlas-vendor,.hg-atlas-vendor-action svg {
    transition: none;
  }
  .hg-atlas-vendor:hover .hg-atlas-vendor-action svg {
    transform: none;
  }
}
</style>
