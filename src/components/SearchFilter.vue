<script setup lang="ts">
import { STATUS_LABELS, STATUS_ORDER } from '../types'
import type { JobStatus } from '../types'
import type { ViewMode, ViewPreference } from '../composables/useViewMode'

defineProps<{
  searchTerm: string
  statusFilter: JobStatus | 'all'
  viewMode: ViewMode
  isAuto: boolean
}>()

const emit = defineEmits<{
  (e: 'update:searchTerm', value: string): void
  (e: 'update:statusFilter', value: JobStatus | 'all'): void
  (e: 'update:viewPreference', value: ViewPreference): void
}>()

const statuses: (JobStatus | 'all')[] = ['all', ...STATUS_ORDER]

function labelFor(status: JobStatus | 'all'): string {
  return status === 'all' ? '全部状态' : STATUS_LABELS[status]
}
</script>

<template>
  <section class="toolbar" aria-label="搜索与筛选">
    <div class="field field-search">
      <label for="search">按公司名称搜索</label>
      <input
        id="search"
        type="search"
        placeholder="输入公司名称关键字"
        :value="searchTerm"
        @input="emit('update:searchTerm', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="field field-status">
      <label for="status">按状态筛选</label>
      <select
        id="status"
        :value="statusFilter"
        @change="emit('update:statusFilter', ($event.target as HTMLSelectElement).value as JobStatus | 'all')"
      >
        <option v-for="status in statuses" :key="status" :value="status">
          {{ labelFor(status) }}
        </option>
      </select>
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
  </section>
</template>
