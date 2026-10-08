<script setup lang="ts">
import {ref} from 'vue'
import ScenePlayer from '../../components/animation/ScenePlayer.vue'
import TileScene from './rmsnorm-tile-scene.vue'
import {rmsnormTileMeta} from './visuals/sceneRegistry'
import {SERIAL_SUMS,SHARED_ROUNDS,MATH,format} from './rmsnorm-model'
withDefaults(defineProps<{scenario?:'serial-vs-block'|'triton-rows'}>(),{scenario:'serial-vs-block'})
const stage=ref(0), labels=['平方和','各自求尺度','写输出']
</script>
<template>
<ScenePlayer v-if="scenario==='triton-rows'" :meta="rmsnormTileMeta"><template #stage="state"><TileScene v-bind="state" /></template></ScenePlayer>
<section v-else class="rms-compare" aria-label="同一行的两种 HIP 分工">
 <header><small>HIP · 同一输入的分工对照</small><h4>平方和相同，计算依赖不同</h4></header>
 <div class="rms-choices" role="group" aria-label="选择查看计算阶段"><button v-for="(label,i) in labels" :key="i" :aria-pressed="stage===i" @click="stage=i">{{label}}</button></div>
 <div class="rms-columns">
  <article><h5>serial：一个线程处理一行</h5>
   <template v-if="stage===0"><p>每加完一项，再处理下一项。</p><ol class="rms-chain"><li v-for="(v,i) in SERIAL_SUMS" :key="i"><span>{{i===0?'初值':`加入 ${MATH.squares[i-1]}`}}</span><b>{{v}}</b></li></ol></template>
   <template v-else-if="stage===1"><p>该线程用自己的平方和求尺度。</p><div class="rms-result">50 / 4 = 12.5<br>r = {{format(MATH.scale)}}</div></template>
   <template v-else><p>同一个线程按列写回全部结果。</p><div class="rms-result">{{MATH.output.map(format).join(' · ')}}</div></template>
  </article>
  <article><h5>block：多个线程合算一行</h5>
   <template v-if="stage===0"><p>每轮完成写入并同步，再读下一轮。</p><ol class="rms-shared"><li v-for="(row,i) in SHARED_ROUNDS" :key="i"><span>{{['各自平方','stride = 2','stride = 1'][i]}}</span><div><b v-for="(v,j) in row" :key="j" :class="{inactive:i>0&&j>=4/2**i}">{{v}}</b></div></li></ol><p class="rms-note">淡色格仍保留原值；只更新本轮参与的位置。</p></template>
   <template v-else-if="stage===1"><p>所有线程读取 shared[0] = 50，然后<b>各自计算</b>同一个 r。</p><div class="rms-result">每线程：rsqrt(50 / 4 + ε)<br>r = {{format(MATH.scale)}}</div><p class="rms-note">源码没有把 r 写进 LDS 再广播。</p></template>
   <template v-else><p>各线程按原来的列分工写回输出。</p><div class="rms-result">{{MATH.output.map(format).join(' · ')}}</div><p class="rms-note">shared[0] 此后不再覆盖，无须为复用槽位另加读者屏障。</p></template>
  </article>
 </div>
 <p class="rms-note">四个位置仅用于手算。实际协作基线为 block=256；依赖链长短不能代替 benchmark。</p>
</section>
</template>
<style scoped>
.rms-compare{border:1px solid var(--vp-c-divider);border-radius:12px;padding:22px;background:var(--vp-c-bg-soft)}h4{margin:6px 0 16px!important}small,.rms-note{color:var(--vp-c-text-2)}.rms-choices{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.rms-choices button{padding:7px 12px;border:1px solid var(--vp-c-divider);border-radius:6px;font:inherit}.rms-choices button[aria-pressed=true]{background:var(--vp-c-brand-soft);border-color:var(--vp-c-brand-1)}.rms-choices button:focus-visible{outline:2px solid var(--vp-c-brand-1);outline-offset:3px}.rms-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.rms-columns article{border:1px solid var(--vp-c-divider);padding:16px;border-radius:8px;background:var(--vp-c-bg)}h5{font-size:16px;margin:0!important}.rms-columns p{font-size:14px;line-height:1.8}.rms-chain,.rms-shared{list-style:none;padding:0!important;margin:0!important}.rms-chain li{display:flex;justify-content:space-between;border-bottom:1px solid var(--vp-c-divider);padding:7px 12px}.rms-shared li{margin:12px 0}.rms-shared li>span{font-size:13px}.rms-shared li>div{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:6px}.rms-shared b{padding:8px 0;background:var(--vp-c-brand-soft);text-align:center;border:1px solid var(--vp-c-brand-1);border-radius:4px}.rms-shared .inactive{background:var(--vp-c-bg-soft);border-color:var(--vp-c-divider);color:var(--vp-c-text-2)}.rms-result{padding:18px 10px;background:var(--vp-c-brand-soft);border-radius:6px;font-size:17px;line-height:2;overflow-wrap:anywhere}.rms-note{font-size:13px;line-height:1.7;margin-bottom:0}@media(max-width:600px){.rms-columns{grid-template-columns:1fr}.rms-compare{padding:14px}.rms-columns article{padding:12px}}
</style>
