<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{
  code: string
}>()

const { isDark } = useData()
const diagram = ref<HTMLElement | null>(null)
const error = ref('')
const source = computed(() => decodeURIComponent(props.code))
let renderCount = 0
let diagramId = 0

async function renderDiagram() {
  if (!diagram.value) return

  if (!diagramId) {
    diagramId = Math.floor(Math.random() * 1_000_000_000)
  }
  renderCount += 1
  error.value = ''
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      darkMode: isDark.value,
      fontFamily: 'Helvetica Neue, Arial, PingFang SC, Microsoft YaHei, sans-serif',
      primaryColor: isDark.value ? '#172a29' : '#e7f0eb',
      primaryTextColor: isDark.value ? '#edf4f2' : '#203532',
      primaryBorderColor: isDark.value ? '#739c8d' : '#9ab8aa',
      lineColor: isDark.value ? '#adbcbe' : '#536561',
      secondaryColor: isDark.value ? '#172833' : '#e8f1f6',
      tertiaryColor: isDark.value ? '#1c2526' : '#f0f4f2',
      edgeLabelBackground: isDark.value ? '#111c1f' : '#f8faf9',
      clusterBkg: isDark.value ? '#111c1f' : '#f0f4f2',
      clusterBorder: isDark.value ? '#344c4c' : '#c8d7d0',
    },
  })

  try {
    const { svg } = await mermaid.render(`mermaid-${diagramId}-${renderCount}`, source.value)
    diagram.value.innerHTML = svg
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    diagram.value.textContent = source.value
  }
}

onMounted(renderDiagram)
watch(isDark, renderDiagram)
</script>

<template>
  <div class="mermaid-block">
    <div ref="diagram" />
    <pre v-if="error" class="mermaid-error">{{ error }}</pre>
  </div>
</template>
