<script setup lang="ts">
import { STATUS_LABELS, STATUS_ORDER, SORT_LABELS } from '../types'
import type { JobFilters, JobStatus, SortOrder } from '../types'
import type { ViewMode, ViewPreference } from '../composables/useViewMode'

const props = defineProps<{
  filters: JobFilters
  hasActiveFilters: boolean
  dateRangeError: string
  viewMode: ViewMode
  isAuto: boolean
}>()

const emit = defineEmits<{
  (e: 'update:filters', value: Partial<JobFilters>): void
  (e: 'clearFilters'): void
  (e: 'update:viewPreference', value: ViewPreference): void
}>()

const statuses: (JobStatus | 'all')[] = ['all', ...STATUS_ORDER]
const sortOrders: SortOrder[] = ['date-desc', 'date-asc']

function labelFor(status: JobStatus | 'all'): string {
  return status === 'all' ? '全部状态' : STATUS_LABELS[status]
}
</script>

<template>
  <section class="toolbar" aria-label="搜索与筛选">
    <div class="field field-search">
      <label for="search">搜索公司或职位</label>
      <input
        id="search"
        type="search"
        placeholder="输入公司或职位关键字"
        :value="props.filters.keyword"
        @input="emit('update:filters', { keyword: ($event.target as HTMLInputElement).value })"
      />
    </div>

    <div class="field field-status">
      <label for="status">按状态筛选</label>
      <select
        id="status"
        :value="props.filters.status"
        @change="emit('update:filters', { status: ($event.target as HTMLSelectElement).value as JobStatus | 'all' })"
      >
        <option v-for="status in statuses" :key="status" :value="status">
          {{ labelFor(status) }}
        </option>
      </select>
    </div>

    <div class="field field-range">
      <span class="field-range-label" id="date-range-label">投递日期范围</span>
      <div class="field-range-inputs" role="group" aria-labelledby="date-range-label">
        <input
          type="date"
          aria-label="起始日期"
          :value="props.filters.dateFrom"
          @change="emit('update:filters', { dateFrom: ($event.target as HTMLInputElement).value })"
        />
        <span class="field-range-sep" aria-hidden="true">→</span>
        <input
          type="date"
          aria-label="结束日期"
          :value="props.filters.dateTo"
          @change="emit('update:filters', { dateTo: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>

    <div class="field field-sort">
      <label for="sort">排序方式</label>
      <select
        id="sort"
        :value="props.filters.sortOrder"
        @change="emit('update:filters', { sortOrder: ($event.target as HTMLSelectElement).value as SortOrder })"
      >
        <option v-for="order in sortOrders" :key="order" :value="order">
          {{ SORT_LABELS[order] }}
        </option>
      </select>
    </div>

    <div class="field field-actions">
      <span class="field-actions-label" aria-hidden="true">筛选操作</span>
      <button
        type="button"
        class="btn btn-sm btn-ghost"
        :disabled="!props.hasActiveFilters"
        @click="emit('clearFilters')"
      >
        清除筛选
      </button>
    </div>

    <div class="field field-view">
      <span id="view-toggle-label" class="field-view-label">显示方式</span>
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
          <span>表格</span>
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
          <span>卡片</span>
        </button>
        <button
          type="button"
          class="view-toggle-btn view-toggle-auto"
          :class="{ 'is-active': isAuto }"
          :aria-pressed="isAuto"
          :title="`跟随屏幕宽度自动选择（当前：${viewMode === 'table' ? '表格' : '卡片'}）`"
          @click="emit('update:viewPreference', 'auto')"
        >
          <svg class="view-toggle-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="1.5" y="2.5" width="13" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path d="M5.5 13.5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          </svg>
          <span>跟随屏幕</span>
        </button>
      </div>
    </div>

    <p v-if="dateRangeError" class="field-error" role="alert">{{ dateRangeError }}</p>
  </section>
</template>
