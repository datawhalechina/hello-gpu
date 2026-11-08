<script setup lang="ts">
import { onMounted } from 'vue'
import './tokens.css'
import { ensureLoaded, exportLog, pushToast, resetStageProgress } from './store.ts'

const props = defineProps<{ stage: string; predictionIds: string[] }>()
onMounted(ensureLoaded)

function download() {
  const blob = new Blob([exportLog(props.stage)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hello-gpu-${props.stage}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function reset() {
  if (!window.confirm('清空本关的进度、星级、预测和试玩日志？给下一位试玩者用之前可以点这里。')) return
  resetStageProgress(props.stage, props.predictionIds)
  pushToast('本关进度已清空，刷新页面后重新开始', 'info')
}
</script>

<template>
  <details class="hgp-pilot">
    <summary>试玩研究（给教程作者看的）</summary>
    <p>这一页是新版教程的试点。你的操作只记录在这台设备的浏览器里，不会自动上传。</p>
    <div class="actions">
      <button type="button" class="hgp-btn" @click="download">导出试玩日志</button>
      <button type="button" class="hgp-btn" @click="reset">清空本关进度</button>
    </div>
  </details>
</template>

<style scoped>
.hgp-pilot {
  margin: 32px 0 8px;
  padding: 10px 14px;
  border: 1px dashed var(--hg-border);
  border-radius: var(--hgp-radius);
  font-size: 14px;
  color: var(--vp-c-text-2);
}
summary {
  cursor: pointer;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
