<script setup lang="ts">
/**
 * 关卡页底部的上一关 / 回到区域首页 / 下一关（F-10 写在 StageLayout 里，X-01 抽出来给副本页共用：
 * 副本页是上一道 / 回到副本大厅 / 下一道）。还没上线的那一项只写名字、标「还没上线」，不放链接。
 */
export interface NavItem {
  /** 「上一关」「下一道」这类方向。 */
  dir: string
  name: string
  /** 已经加好站点 base 的地址；空串表示还没上线。 */
  href: string
}

defineProps<{
  /** 整条导航的读屏名字。 */
  label: string
  prev: NavItem | null
  next: NavItem | null
  /** 中间那个回去的链接（已经加好站点 base）。 */
  home: { href: string; text: string }
}>()
</script>

<template>
  <nav class="hg-stagenav" :aria-label="label">
    <component
      :is="prev?.href ? 'a' : 'div'"
      v-if="prev"
      class="hg-stagenav__item is-prev"
      :href="prev.href || undefined"
    >
      <span class="hg-stagenav__dir">{{ prev.dir }}</span>
      <strong>{{ prev.name }}</strong>
      <span v-if="!prev.href" class="hg-stagenav__soon">还没上线</span>
    </component>
    <a class="hg-stagenav__zone" :href="home.href">{{ home.text }}</a>
    <component
      :is="next?.href ? 'a' : 'div'"
      v-if="next"
      class="hg-stagenav__item is-next"
      :href="next.href || undefined"
    >
      <span class="hg-stagenav__dir">{{ next.dir }}</span>
      <strong>{{ next.name }}</strong>
      <span v-if="!next.href" class="hg-stagenav__soon">还没上线</span>
    </component>
  </nav>
</template>

<style scoped>
.hg-stagenav {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  gap: 12px;
  margin-top: 48px;
  padding-top: 24px;
  border-top: var(--hg-border-width) solid var(--hg-border);
}

.hg-stagenav__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 16px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  text-decoration: none;
}

.hg-stagenav__item.is-prev {
  grid-column: 1;
}

.hg-stagenav__item.is-next {
  grid-column: 3;
  align-items: flex-end;
  text-align: right;
}

a.hg-stagenav__item:hover {
  border-color: var(--hg-accent);
}

div.hg-stagenav__item {
  color: var(--hg-ink-3);
  background: var(--hg-surface-2);
}

.hg-stagenav__dir {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-stagenav__item strong {
  font-family: var(--hg-font-display);
  font-size: 15px;
}

.hg-stagenav__soon {
  color: var(--hg-ink-3);
  font-size: 12px;
}

.hg-stagenav__zone {
  grid-column: 2;
  align-self: center;
  padding: 8px 12px;
  border-radius: var(--hg-radius-control);
  color: var(--hg-accent-ink);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.hg-stagenav__item:focus-visible,
.hg-stagenav__zone:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 手机：上一关、下一关上下排，「回到区域首页」放最后。 */
@media (max-width: 767px) {
  .hg-stagenav {
    grid-template-columns: 1fr;
  }

  .hg-stagenav__item.is-prev,
  .hg-stagenav__item.is-next,
  .hg-stagenav__zone {
    grid-column: 1;
  }

  .hg-stagenav__item.is-next {
    align-items: flex-start;
    text-align: left;
  }

  .hg-stagenav__zone {
    order: 1;
    justify-self: start;
  }
}
</style>
