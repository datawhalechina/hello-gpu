<script setup lang="ts">
/**
 * 1-7 的「取数据」地图（关卡自己的 scenes，不用登记组件）：探索一、探索二共用这一张图，各自在每个地方下面画自己的东西
 * （place 插槽：探索一画等了多久的条，探索二画住在这里的数）。
 *
 * 空间约定（02 第 3 节）：CPU 这边在左，GPU 这边在右；GPU 里离工位越近越靠上，显存在最下面，
 * CPU 内存和显存在同一行，中间连着显卡和 CPU 之间的通道（hardware.json 的 bus）。
 * 地方从上往下排的是远近，不是一条必经的路：LDS 不在去显存的路上，从显存取数路过的是缓存（旧版第 3 章补充
 * 「寄存器与存储使用范围」的提醒），所以每个地方各画一格，不画箭头串起来。
 * pickable 时每个地方是一个按钮（aria-pressed 标出选中的那个），Tab 到它、回车或空格选它。
 */
import { BUS, PLACES, type Place } from '../challenge.ts'

withDefaults(defineProps<{
  /** 每个地方都能点：点了发 pick（探索一） */
  pickable?: boolean
  /** 高亮的地方 */
  selected?: Place | null
  /** 整张图的说明，读屏读这一句 */
  label?: string
}>(), { pickable: false, selected: null, label: '取数据地图' })

const emit = defineEmits<{ pick: [place: Place] }>()
defineSlots<{ place?: (props: { place: Place }) => unknown }>()

const DEVICE: Place[] = ['register', 'lds', 'cache', 'vram']
const HOST: Place = 'host'
</script>

<template>
  <div class="smap" role="group" :aria-label="label">
    <span class="smap__side is-host" aria-hidden="true">CPU 这边</span>
    <span class="smap__side is-device" aria-hidden="true">GPU 这边（工坊城）</span>
    <span class="smap__frame" aria-hidden="true" />
    <span class="smap__lane"><span class="smap__dot" aria-hidden="true" />工位：数要先到工具台上，才能拿来算</span>

    <component
      :is="pickable ? 'button' : 'div'"
      v-for="p in DEVICE"
      :key="p"
      :type="pickable ? 'button' : undefined"
      class="smap__place"
      :class="[`is-${p}`, { 'is-on': selected === p, 'is-pickable': pickable }]"
      :aria-pressed="pickable ? selected === p : undefined"
      @click="pickable && emit('pick', p)"
    >
      <span class="smap__name">{{ PLACES[p].name }}</span>
      <span class="smap__meta">{{ PLACES[p].where }} · {{ PLACES[p].who }}</span>
      <span class="smap__size">{{ PLACES[p].size }}</span>
      <slot name="place" :place="p" />
    </component>

    <component
      :is="pickable ? 'button' : 'div'"
      :type="pickable ? 'button' : undefined"
      class="smap__place is-host"
      :class="{ 'is-on': selected === HOST, 'is-pickable': pickable }"
      :aria-pressed="pickable ? selected === HOST : undefined"
      @click="pickable && emit('pick', HOST)"
    >
      <span class="smap__name">{{ PLACES.host.name }}</span>
      <span class="smap__meta">只有 CPU 用</span>
      <slot name="place" :place="HOST" />
    </component>
    <span class="smap__bus">和显存之间：{{ BUS }}</span>
  </div>
</template>

<style scoped>
/*
 * 一张两列的网格：左列 CPU 这边，右列 GPU 这边。CPU 内存和显存在同一行，所以一样高、对得齐，
 * 中间那条线（::after）就是显卡和 CPU 之间的通道。GPU 这边的虚线框（smap__frame）从工位那一行画到显存那一行。
 */
.smap {
  --smap-gap: 16px;
  --smap-inset: 10px;

  display: grid;
  grid-template-columns: minmax(78px, 0.3fr) minmax(0, 1fr);
  grid-template-areas:
    'hostside devside'
    '. lane'
    '. register'
    '. lds'
    '. cache'
    'host vram'
    'bus .';
  column-gap: var(--smap-gap);
  row-gap: 8px;
  min-width: 0;
}

.smap__side {
  color: var(--hg-ink-3);
  font-family: var(--hg-font-mono);
  font-size: var(--hg-text-label);
  font-weight: 700;
  letter-spacing: var(--hg-tracking-eyebrow);
}

.smap__side.is-host {
  grid-area: hostside;
}

.smap__side.is-device {
  grid-area: devside;
}

.smap__frame {
  grid-column: 2;
  grid-row: 2 / 7;
  border: var(--hg-border-width) dashed var(--hg-border-strong);
  border-radius: var(--hg-radius-card);
  background: var(--hg-surface-2);
}

.smap__lane {
  grid-area: lane;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: var(--smap-inset) var(--smap-inset) 0;
  color: var(--hg-ink-2);
  font-size: 13px;
}

.smap__dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--hg-accent);
}

.smap__place {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin: 0 var(--smap-inset);
  padding: 10px 12px;
  border: var(--hg-border-width) solid var(--hg-border);
  border-radius: var(--hg-radius-control);
  background: var(--hg-surface);
  color: var(--hg-ink);
  font: inherit;
  text-align: left;
}

.smap__place.is-register {
  grid-area: register;
}

.smap__place.is-lds {
  grid-area: lds;
}

.smap__place.is-cache {
  grid-area: cache;
}

.smap__place.is-vram {
  grid-area: vram;
  margin-bottom: var(--smap-inset);
}

.smap__place.is-host {
  grid-area: host;
  margin: 0 0 var(--smap-inset);
  border-style: dashed;
  border-color: var(--hg-border-strong);
}

/* 显卡和 CPU 之间的通道：从 CPU 内存的右边连到显存那一格（跨过列间距和虚线框的内边距）。 */
.smap__place.is-host::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 100%;
  width: calc(var(--smap-gap) + var(--smap-inset));
  border-top: 2px solid var(--hg-border-strong);
}

.smap__bus {
  grid-area: bus;
  color: var(--hg-ink-3);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.smap__place.is-pickable {
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease-out), background-color var(--motion-fast) var(--motion-ease-out);
}

.smap__place.is-pickable:hover {
  border-color: var(--hg-accent);
}

.smap__place:focus-visible {
  outline: 2px solid var(--hg-accent-ink);
  outline-offset: 2px;
}

/* 选中：强调色描边 + 浅底，不只靠颜色——读屏有 aria-pressed，名字前面还有一个实心点。 */
.smap__place.is-on {
  border-color: var(--hg-accent-ink);
  background: var(--hg-accent-soft);
}

.smap__place.is-on .smap__name::before {
  content: '●';
  margin-right: 6px;
  color: var(--hg-accent-ink);
  font-size: 10px;
  vertical-align: 2px;
}

.smap__name {
  font-size: 15px;
  font-weight: 700;
}

.smap__meta,
.smap__size {
  color: var(--hg-ink-3);
  font-size: 12px;
  line-height: 1.5;
}

.smap__size {
  font-family: var(--hg-font-mono);
}

@media (max-width: 639px) {
  .smap {
    --smap-gap: 12px;
    --smap-inset: 8px;

    grid-template-columns: minmax(72px, 0.28fr) minmax(0, 1fr);
  }

  .smap__place {
    padding: 8px 10px;
  }

  .smap__name {
    font-size: 14px;
  }

  /* CPU 内存那一格最窄：内边距收一点、字小一号，「CPU 内存」不折行。 */
  .smap__place.is-host {
    padding: 8px 6px;
  }

  .smap__place.is-host .smap__name {
    font-size: 13px;
  }
}
</style>
