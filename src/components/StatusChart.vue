<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { JobStatus } from '../types'

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

const container = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null

const hasRecords = computed(() => props.total > 0)

/** Text alternative for the canvas, also used by assistive technology. */
const summary = computed(() =>
  props.data
    .filter((slice) => slice.count > 0)
    .map((slice) => `${slice.label} ${slice.count} 条`)
    .join('，'),
)

const option = computed<echarts.EChartsCoreOption>(() => ({
  title: {
    text: String(props.total),
    subtext: '总记录',
    left: 'center',
    top: '32%',
    textStyle: { fontSize: 26, fontWeight: 700, color: '#0f172a' },
    subtextStyle: { fontSize: 12, color: '#64748b' },
  },
  tooltip: {
    trigger: 'item',
    formatter: (params: unknown) => {
      const p = params as { name: string; value: number; percent: number }
      return `${p.name}<br/>${p.value} 条 · ${p.percent}%`
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
  <section class="chart-card" aria-label="求职状态分布">
    <h2 class="chart-title">求职状态分布</h2>
    <p class="sr-only">共 {{ total }} 条记录：{{ summary }}</p>
    <p v-if="!hasRecords" class="chart-empty">还没有记录，新增一条后即可查看状态分布。</p>
    <div v-show="hasRecords" ref="container" class="chart-canvas" role="img" :aria-label="`求职状态分布环形图，共 ${total} 条记录：${summary}`"></div>
  </section>
</template>
