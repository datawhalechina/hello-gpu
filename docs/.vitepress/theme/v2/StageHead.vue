<script setup lang="ts">
/**
 * 关卡头（F-10 写在 StageLayout 里，X-01 抽出来给副本页 DungeonLayout 共用）。
 *
 * 眉标（区域 · 关卡号，测试版标记）→ 一排「键 值」（关卡：这一关讲、推荐等级、时长、硬件、前置关卡；
 * 副本：练的是、难度、经验值、运行环境、关联关卡）→ 一句不上锁的提醒 →「我已经会了，直接做挑战」。
 * 值可以是一段文字，也可以是几个关卡链接：还没上线的关卡只写名字、后面跟一句说明，
 * 读者做没做完用「已完成 / 还没完成」写出来（对勾不单靠颜色）。数据都由布局从 outline.json 和存档算好传进来。
 */
export interface HeadLink {
  text: string
  /** 已经加好站点 base 的地址；空串表示还没上线，只写名字。 */
  href: string
  /** 没有链接时跟在名字后面的说明，例如「（还没上线）」。 */
  note?: string
  /** 读者做完没有；不写就不显示这一项。 */
  done?: boolean
}

export interface HeadItem {
  key: string
  text?: string
  links?: readonly HeadLink[]
}

defineProps<{
  eyebrow: string
  /** 大纲里 status 为 draft：标「测试版」。 */
  beta?: boolean
  items: readonly HeadItem[]
  /** 一句温和的提醒（等级或关联关卡还没到），只是提醒，不挡路。 */
  hint?: string
  /** 「我已经会了，直接做挑战」（03 第 4 节「随时可跳过」）。 */
  skip?: { href: string; text: string } | null
}>()
</script>

<template>
  <header class="hg-stagehead">
    <p class="hg-stagehead__eyebrow">
      <span>{{ eyebrow }}</span>
      <span v-if="beta" class="hg-stagehead__beta">测试版</span>
    </p>
    <ul class="hg-stagehead__meta">
      <li v-for="item in items" :key="item.key">
        <span class="hg-stagehead__key">{{ item.key }}</span>
        <template v-if="item.links">
          <span v-for="(link, i) in item.links" :key="link.text" class="hg-stagehead__link">
            <template v-if="i">、</template>
            <a v-if="link.href" :href="link.href">{{ link.text }}</a>
            <span v-else>{{ link.text }}{{ link.note }}</span>
            <span v-if="link.done !== undefined" class="hg-stagehead__state" :class="{ 'is-done': link.done }">
              <svg v-if="link.done" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
              {{ link.done ? '已完成' : '还没完成' }}
            </span>
          </span>
        </template>
        <template v-else>{{ item.text }}</template>
      </li>
    </ul>
    <p v-if="hint" class="hg-stagehead__hint" role="note">{{ hint }}</p>
    <p v-if="skip" class="hg-stagehead__skip">
      <a :href="skip.href">{{ skip.text }}</a>
    </p>
  </header>
</template>

<style scoped>
.hg-stagehead {
  margin: 0 0 20px;
}

.hg-stagehead__eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin: 0 0 8px;
  color: var(--hg-accent-ink);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.hg-stagehead__beta {
  padding: 1px 8px;
  border: var(--hg-border-width) solid var(--hg-amber);
  border-radius: var(--hg-radius-pill);
  color: var(--hg-amber-ink);
  letter-spacing: 0;
}

.hg-stagehead__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-stagehead__meta li {
  margin: 0;
}

.hg-stagehead__key {
  margin-right: 6px;
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
}

.hg-stagehead__state {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  color: var(--hg-ink-3);
  font-size: 13px;
}

.hg-stagehead__state.is-done {
  color: var(--hg-accent-ink);
}

.hg-stagehead__state svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.hg-stagehead__hint {
  margin: 12px 0 0;
  padding: 10px 14px;
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  border: var(--hg-border-width) solid var(--hg-border);
  color: var(--hg-ink-2);
  font-size: 14px;
}

.hg-stagehead__skip {
  margin: 10px 0 0;
  font-size: 14px;
}

.hg-stagehead__skip a {
  color: var(--hg-accent-ink);
  font-weight: 600;
}
</style>
