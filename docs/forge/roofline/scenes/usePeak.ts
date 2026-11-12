/**
 * 2-4 三段探索用哪组峰值（关卡自己的 scenes）：导入了带峰值的「我的 GPU 卡片」（L-07）就用你的卡，可以换成参考值对照正文；
 * 参考值是实验档案馆里这一关最新的真实记录，还没有记录时是本书那张卡的标称峰值（示意）。规则在 roofline.ts 的 pickPeak。
 * 存档在 onMounted 之后才读得到：挂载之前（服务端渲染、水合）一律用参考值，水合前后一致（同 2-1 的 useGpu）。
 */
import { computed, onMounted, ref } from 'vue'
import { data as archive } from '@course/labArchive.data.ts'
import { useProgress } from '@course/useProgress.ts'
import { cardPeak, referencePeak } from '../roofline.ts'

export function usePeak() {
  const progress = useProgress()
  const mounted = ref(false)
  onMounted(() => {
    mounted.value = true
  })
  /** 读者当前选的那张卡；没有导入过是 null。 */
  const card = computed(() => (mounted.value ? progress.currentDevice() : null))
  /** 那张卡带着的实测峰值；卡片还没测过峰值是 null。 */
  const mine = computed(() => cardPeak(card.value))
  const reference = referencePeak(archive.entries)
  /** 有自己的峰值时，读者可以临时看参考值（不改存档里选的卡）。 */
  const showReference = ref(false)
  const peak = computed(() => (mine.value && !showReference.value ? mine.value : reference))
  return { card, mine, peak, showReference }
}
