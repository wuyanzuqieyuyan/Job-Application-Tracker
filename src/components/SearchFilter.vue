<script setup lang="ts">
import { STATUS_ORDER } from '../types'
import type { JobFilters, JobStatus, SortOrder } from '../types'
import type { ViewMode, ViewPreference } from '../composables/useViewMode'
import { useI18n } from '../composables/useI18n'

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

const { t, statusLabel } = useI18n()

const statuses: (JobStatus | 'all')[] = ['all', ...STATUS_ORDER]
const sortOrders: SortOrder[] = ['date-desc', 'date-asc']

function labelFor(status: JobStatus | 'all'): string {
  return status === 'all' ? t('filterStatusAll') : statusLabel(status)
}
</script>

<template>
  <section class="toolbar" :aria-label="t('filterSectionLabel')">
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

    <div class="field field-status">
      <label for="status">{{ t('filterStatusLabel') }}</label>
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
      <span class="field-range-label" id="date-range-label">{{ t('filterDateLabel') }}</span>
      <div class="field-range-inputs" role="group" aria-labelledby="date-range-label">
        <input
          type="date"
          :aria-label="t('filterDateFrom')"
          :value="props.filters.dateFrom"
          @change="emit('update:filters', { dateFrom: ($event.target as HTMLInputElement).value })"
        />
        <span class="field-range-sep" aria-hidden="true">→</span>
        <input
          type="date"
          :aria-label="t('filterDateTo')"
          :value="props.filters.dateTo"
          @change="emit('update:filters', { dateTo: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>

    <div class="field field-sort">
      <label for="sort">{{ t('filterSortLabel') }}</label>
      <select
        id="sort"
        :value="props.filters.sortOrder"
        @change="emit('update:filters', { sortOrder: ($event.target as HTMLSelectElement).value as SortOrder })"
      >
        <option v-for="order in sortOrders" :key="order" :value="order">
          {{ t(order === 'date-desc' ? 'filterSortDesc' : 'filterSortAsc') }}
        </option>
      </select>
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

    <p v-if="dateRangeInvalid" class="field-error" role="alert">
      {{ t('filterDateRangeError') }}
    </p>
  </section>
</template>
