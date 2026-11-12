/**
 * 2-1 三段探索画哪张卡（关卡自己的 scenes）：导入了「我的 GPU 卡片」（L-07）就画你的卡，可以换回本书的卡对照正文。
 * 存档在 onMounted 之后才读得到：挂载之前（服务端渲染、水合）一律画本书的卡，水合前后一致（同 DeviceCard）。
 */
import { computed, onMounted, ref } from 'vue'
import { useProgress } from '@course/useProgress.ts'
import { BOOK_GPU, gpuFromCard } from '../readings.ts'

export function useGpu() {
  const progress = useProgress()
  const mounted = ref(false)
  onMounted(() => {
    mounted.value = true
  })
  /** 读者当前选的那张卡；没有导入过是 null。 */
  const card = computed(() => (mounted.value ? progress.currentDevice() : null))
  /** 有自己的卡时，读者可以临时看本书的卡（不改存档里选的卡）。 */
  const showBook = ref(false)
  const gpu = computed(() => (card.value && !showBook.value ? gpuFromCard(card.value) : BOOK_GPU))
  return { card, showBook, gpu }
}
