<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { JobStatus } from '../types'
import { useI18n } from '../composables/useI18n'

echarts.use([PieChart, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer])

export interface StatusSlice {
  status: JobStatus
  label: string
  count: number
  color: string
}

const props = defineProps<{
  data: StatusSlice[]
  total: number
}>()

const { t } = useI18n()

const container = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

const hasRecords = computed(() => props.total > 0)

/** Text alternative for the canvas, also used by assistive technology. */
const summary = computed(() =>
  props.data
    .filter((slice) => slice.count > 0)
    .map((slice) => t('chartSummaryItem', { label: slice.label, count: slice.count }))
    .join(', '),
)

const option = computed<echarts.EChartsCoreOption>(() => ({
  title: {
    text: String(props.total),
    subtext: t('chartCenterLabel'),
    left: 'center',
    top: '32%',
    textStyle: { fontSize: 26, fontWeight: 700, color: '#0f172a' },
    subtextStyle: { fontSize: 12, color: '#64748b' },
  },
  tooltip: {
    trigger: 'item',
    formatter: (params: unknown) => {
      const p = params as { name: string; value: number; percent: number }
      return `${p.name}<br/>${p.value} · ${p.percent}%`
    },
  },
  legend: {
    bottom: 0,
    left: 'center',
    icon: 'circle',
    itemWidth: 10,
    itemHeight: 10,
    itemGap: 14,
    textStyle: { color: '#64748b', fontSize: 12 },
  },
  series: [
    {
      type: 'pie',
      radius: ['58%', '80%'],
      center: ['50%', '42%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: props.data.map((slice) => ({
        name: slice.label,
        value: slice.count,
        itemStyle: { color: slice.color },
      })),
    },
  ],
}))

function ensureChart() {
  if (chart || !container.value || !hasRecords.value) return
  chart = echarts.init(container.value)
  chart.setOption(option.value)
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(container.value)
}

function render() {
  if (!hasRecords.value) {
    // nothing to plot: tear the instance down so no empty ring is shown
    observer?.disconnect()
    observer = null
    chart?.dispose()
    chart = null
    return
  }
  ensureChart()
  chart?.setOption(option.value, true)
}

onMounted(render)

watch(() => props.data, render, { deep: true })
watch(() => props.total, render)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <section class="chart-card" :aria-label="t('chartTitle')">
    <h2 class="chart-title">{{ t('chartTitle') }}</h2>
    <p class="sr-only">{{ t('chartSummary', { total, detail: summary }) }}</p>
    <p v-if="!hasRecords" class="chart-empty">{{ t('chartEmpty') }}</p>
    <div
      v-show="hasRecords"
      ref="container"
      class="chart-canvas"
      role="img"
      :aria-label="t('chartCanvasLabel', { total, detail: summary })"
    ></div>
  </section>
</template>
