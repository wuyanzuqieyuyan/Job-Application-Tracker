<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
/** 窄屏默认收起图表，把首屏空间留给搜索、筛选与记录 */
const collapsed = ref(
  typeof window !== 'undefined' && window.innerWidth <= 640,
)
let chart: echarts.ECharts | null = null
let observer: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | undefined

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
  if (collapsed.value) return
  ensureChart()
  chart?.setOption(option.value, true)
}

/**
 * 展开时补建实例并恢复尺寸，实例不会被重复初始化。
 * 尺寸在高度过渡结束后再计算，避免图表被拉伸。
 */
function toggleCollapsed() {
  collapsed.value = !collapsed.value
  if (collapsed.value) return
  nextTick(() => {
    ensureChart()
    chart?.setOption(option.value, true)
    if (resizeTimer !== undefined) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => chart?.resize(), 220)
  })
}

onMounted(render)

watch(() => props.data, render, { deep: true })
watch(() => props.total, render)
watch(collapsed, render)

onBeforeUnmount(() => {
  if (resizeTimer !== undefined) clearTimeout(resizeTimer)
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <section class="chart-card" :class="{ 'is-collapsed': collapsed }" :aria-label="t('chartTitle')">
    <div class="chart-head">
      <h2 class="chart-title">{{ t('chartTitle') }}</h2>
      <button
        type="button"
        class="chart-toggle"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? t('chartExpand') : t('chartCollapse')"
        @click="toggleCollapsed"
      >
        <svg class="chart-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            :d="collapsed ? 'M4 10.5L8 6.5l4 4' : 'M4 6.5L8 10.5l4-4'"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ collapsed ? t('chartExpand') : t('chartCollapse') }}</span>
      </button>
    </div>
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
