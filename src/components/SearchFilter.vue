<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElDatePicker, ElConfigProvider, ElSelect, ElOption } from 'element-plus'
import zhCnLocale from 'element-plus/es/locale/lang/zh-cn'
import enUsLocale from 'element-plus/es/locale/lang/en'
import { STATUS_ORDER } from '../types'
import type { JobFilters, JobStatus, SortOrder } from '../types'
import type { ViewMode, ViewPreference } from '../composables/useViewMode'
import { useI18n } from '../composables/useI18n'
import { toRangeValue, fromRangeValue } from '../utils/dateRange'
// 按需样式：只拉取 date-picker 与 select 组件样式（含基础变量），不引入全站样式表
import 'element-plus/es/components/date-picker/style/css'
import 'element-plus/es/components/select/style/css'

const props = defineProps<{
  filters: JobFilters
  hasActiveFilters: boolean
  dateRangeInvalid: boolean
  viewMode: ViewMode
  isAuto: boolean
}>()

const emit = defineEmits<{
  (e: 'update:filters', value: Partial<JobFilters>): void
  (e: 'clearFilters'): void
  (e: 'update:viewPreference', value: ViewPreference): void
}>()

const { t, statusLabel, locale } = useI18n()

const statuses: (JobStatus | 'all')[] = ['all', ...STATUS_ORDER]
const sortOrders: SortOrder[] = ['date-desc', 'date-asc']

function labelFor(status: JobStatus | 'all'): string {
  return status === 'all' ? t('filterStatusAll') : statusLabel(status)
}

/**
 * 次级筛选（状态/日期/排序）仅在窄视口折叠，桌面端始终展开。
 * 折叠只切换可见性，筛选值与排序都保存在父级，不会因展开收起而重置。
 */
const NARROW_QUERY = '(max-width: 640px)'
const narrow = ref(typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches)
const advancedOpen = ref(false)
let mediaQuery: MediaQueryList | null = null

function handleMediaChange(event: MediaQueryListEvent) {
  narrow.value = event.matches
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  mediaQuery = window.matchMedia(NARROW_QUERY)
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleMediaChange)
  } else {
    mediaQuery.addListener(handleMediaChange)
  }
}

onBeforeUnmount(() => {
  if (!mediaQuery) return
  if (typeof mediaQuery.removeEventListener === 'function') {
    mediaQuery.removeEventListener('change', handleMediaChange)
  } else {
    mediaQuery.removeListener(handleMediaChange)
  }
  mediaQuery = null
})

const showAdvanced = computed(() => !narrow.value || advancedOpen.value)

/** 生效的次级筛选数量（与 hasActiveFilters 同口径：状态 + 日期，不含排序）。 */
const activeAdvancedCount = computed(() => {
  let count = 0
  if (props.filters.status !== 'all') count += 1
  if (props.filters.dateFrom !== '') count += 1
  if (props.filters.dateTo !== '') count += 1
  return count
})

const advancedToggleLabel = computed(() => {
  if (advancedOpen.value) return t('filterAdvancedHide')
  return activeAdvancedCount.value > 0
    ? t('filterAdvancedShowCount', { count: activeAdvancedCount.value })
    : t('filterAdvancedShow')
})

// 日期范围非法时自动展开，避免错误提示对应的控件被折叠隐藏
watch(
  () => props.dateRangeInvalid,
  (invalid) => {
    if (invalid) advancedOpen.value = true
  },
)

/**
 * Element Plus daterange 控件的模型映射（见 utils/dateRange.ts）：
 * - `value-format="YYYY-MM-DD"` 与筛选状态格式完全一致，无 Date/时区转换；
 * - 清除（组件 null）→ 两个空串，保持"清除日期范围"能力；
 * - 语言联动：Element 的面板文案/占位符文案通过 locale 判据切换。
 */
const elementLocale = computed(() => (locale.value === 'en-US' ? enUsLocale : zhCnLocale))
// 筛选栏daterange两端保持各自 i18n 提示（恢复为「开始日期/结束日期」）
const startPlaceholder = computed(() => t('filterDateFrom'))
const endPlaceholder = computed(() => t('filterDateTo'))
const rangeSeparator = computed(() => t('filterDateRangeSeparator'))

const rangeModel = computed(() => toRangeValue(props.filters.dateFrom, props.filters.dateTo))

function handleRangeChange(value: unknown) {
  emit('update:filters', fromRangeValue(value))
}
</script>

<template>
  <section class="toolbar" :aria-label="t('filterSectionLabel')">
    <!-- 第一组：关键词搜索 -->
    <div class="toolbar-group toolbar-search">
      <div class="field field-search">
        <label for="search">{{ t('filterSearchLabel') }}</label>
        <input
          id="search"
          type="search"
          :placeholder="t('filterSearchPlaceholder')"
          :value="props.filters.keyword"
          @input="emit('update:filters', { keyword: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>

    <!-- 折叠开关：只在窄视口出现，桌面端次级筛选始终展开 -->
    <button
      v-if="narrow"
      type="button"
      class="filter-advanced-toggle"
      :aria-expanded="advancedOpen"
      aria-controls="advanced-filters"
      @click="advancedOpen = !advancedOpen"
    >
      <svg
        class="filter-advanced-icon"
        :class="{ 'is-open': advancedOpen }"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 6.5L8 10.5l4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>{{ advancedToggleLabel }}</span>
    </button>

    <!-- 第二组：状态、日期范围、排序等筛选条件（窄视口可折叠） -->
    <div v-show="showAdvanced" id="advanced-filters" class="toolbar-group toolbar-filters">
      <div class="field field-status">
        <span class="field-label" id="status-label">{{ t('filterStatusLabel') }}</span>
        <el-select
          class="toolbar-select"
          :model-value="props.filters.status"
          aria-labelledby="status-label"
          popper-class="jobtrack-select-popper"
          :validate-event="false"
          @update:model-value="(value: string | number | boolean | object |undefined) => emit('update:filters', { status: value as JobStatus | 'all' })"
        >
          <el-option v-for="status in statuses" :key="status" :value="status" :label="labelFor(status)" />
        </el-select>
      </div>

      <div class="field field-range">
        <span class="field-range-label" id="date-range-label">{{ t('filterDateLabel') }}</span>
        <div class="field-range-inputs" role="group" aria-labelledby="date-range-label">
          <el-config-provider :locale="elementLocale">
            <el-date-picker
              class="field-range-picker"
              type="daterange"
              :model-value="rangeModel"
              :start-placeholder="startPlaceholder"
              :end-placeholder="endPlaceholder"
              :range-separator="rangeSeparator"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              date-format="YYYY-MM-DD"
              :single-panel="narrow"
              popper-class="jobtrack-date-picker-popper"
              :clearable="true"
              :teleported="true"
              @update:model-value="handleRangeChange"
            />
          </el-config-provider>
        </div>
      </div>

      <div class="field field-sort">
        <span class="field-label" id="sort-label">{{ t('filterSortLabel') }}</span>
        <el-select
          class="toolbar-select"
          :model-value="props.filters.sortOrder"
          aria-labelledby="sort-label"
          popper-class="jobtrack-select-popper"
          :validate-event="false"
          @update:model-value="(value: string | number | boolean | object | undefined) => emit('update:filters', { sortOrder: value as SortOrder })"
        >
          <el-option
            v-for="order in sortOrders"
            :key="order"
            :value="order"
            :label="t(order === 'date-desc' ? 'filterSortDesc' : 'filterSortAsc')"
          />
        </el-select>
      </div>
    </div>

    <!-- 第三组：显示方式与清除筛选，始终作为一个整体靠右 -->
    <div class="toolbar-group toolbar-actions">
      <div class="field field-view">
        <span id="view-toggle-label" class="field-view-label">{{ t('filterViewLabel') }}</span>
        <div class="view-toggle" role="group" aria-labelledby="view-toggle-label">
          <button
            type="button"
            class="view-toggle-btn"
            :class="{ 'is-active': viewMode === 'table' }"
            :aria-pressed="viewMode === 'table'"
            @click="emit('update:viewPreference', 'table')"
          >
            <svg class="view-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M2 3.5h12M2 8h12M2 12.5h12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
            <span>{{ t('viewTable') }}</span>
          </button>
          <button
            type="button"
            class="view-toggle-btn"
            :class="{ 'is-active': viewMode === 'cards' }"
            :aria-pressed="viewMode === 'cards'"
            @click="emit('update:viewPreference', 'cards')"
          >
            <svg class="view-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="2" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" />
              <rect x="9" y="2" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" />
              <rect x="2" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" />
              <rect x="9" y="9" width="5" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" />
            </svg>
            <span>{{ t('viewCards') }}</span>
          </button>
          <button
            type="button"
            class="view-toggle-btn view-toggle-auto"
            :class="{ 'is-active': isAuto }"
            :aria-pressed="isAuto"
            :title="t('viewAutoTitle', { view: viewMode === 'table' ? t('viewTable') : t('viewCards') })"
            @click="emit('update:viewPreference', 'auto')"
          >
            <svg class="view-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="1.5" y="2.5" width="13" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M5.5 13.5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
            <span>{{ t('viewAuto') }}</span>
          </button>
        </div>
      </div>

      <div class="field field-actions">
        <span id="clear-filters-label" class="sr-only">{{ t('filterActionsLabel') }}</span>
        <button
          type="button"
          class="btn btn-ghost field-clear-btn"
          :disabled="!props.hasActiveFilters"
          aria-labelledby="clear-filters-label"
          @click="emit('clearFilters')"
        >
          {{ t('filterClear') }}
        </button>
      </div>
    </div>

    <p v-if="dateRangeInvalid" class="field-error" role="alert">
      {{ t('filterDateRangeError') }}
    </p>
  </section>
</template>
