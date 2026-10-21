<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Job } from '../types'
import type { ExportLabels, ExportResult, ExportScope } from '../utils/exportJobs'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{
  filteredJobs: Job[]
  allJobs: Job[]
}>()

const emit = defineEmits<{
  (e: 'result', result: ExportResult): void
}>()

const { t, statusLabel } = useI18n()

const open = ref(false)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)

const hasRecords = computed(() => props.allJobs.length > 0)
const hasFiltered = computed(() => props.filteredJobs.length > 0)

/** 导出的列名与状态文案跟随当前界面语言 */
const exportLabels = computed<ExportLabels>(() => ({
  headers: {
    id: t('exportHeaderId'),
    company: t('exportHeaderCompany'),
    position: t('exportHeaderPosition'),
    appliedDate: t('exportHeaderDate'),
    status: t('exportHeaderStatus'),
    notes: t('exportHeaderNotes'),
  },
  statusLabel,
}))

function toggleMenu() {
  if (busy.value || !hasRecords.value) return
  open.value = !open.value
}

function closeMenu() {
  open.value = false
}

async function choose(scope: ExportScope) {
  if (busy.value) return
  closeMenu()
  const jobs = scope === 'filtered' ? props.filteredJobs : props.allJobs
  if (jobs.length === 0) {
    emit('result', { ok: false, count: 0, failure: 'empty' })
    return
  }
  busy.value = true
  try {
    // the Excel writer is only loaded when an export is actually requested
    const { exportJobsToXlsx } = await import('../utils/exportJobs')
    emit('result', await exportJobsToXlsx(jobs, exportLabels.value))
  } catch {
    emit('result', { ok: false, count: 0, failure: 'workbook' })
  } finally {
    busy.value = false
  }
}

function onDocumentPointerDown(event: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(event.target as Node)) closeMenu()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) closeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="export">
    <button
      type="button"
      class="btn btn-export export-trigger"
      :disabled="!hasRecords || busy"
      :aria-label="t('actionExport')"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggleMenu"
    >
      <svg class="export-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path
          d="M10 3.2v8.4M6.6 8.2L10 11.6l3.4-3.4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M3.8 13.4v1.8a1.6 1.6 0 001.6 1.6h9.2a1.6 1.6 0 001.6-1.6v-1.8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
      <span>{{ busy ? t('actionExporting') : t('actionExport') }}</span>
    </button>

    <div v-if="open" class="export-menu" role="menu" :aria-label="t('exportMenuLabel')">
      <button
        type="button"
        class="export-menu-item"
        role="menuitem"
        :disabled="!hasFiltered"
        @click="choose('filtered')"
      >
        <span class="export-menu-label">{{ t('exportFiltered') }}</span>
        <span class="export-menu-count">{{ t('exportCount', { count: filteredJobs.length }) }}</span>
      </button>
      <button
        type="button"
        class="export-menu-item"
        role="menuitem"
        :disabled="!hasRecords"
        @click="choose('all')"
      >
        <span class="export-menu-label">{{ t('exportAll') }}</span>
        <span class="export-menu-count">{{ t('exportCount', { count: allJobs.length }) }}</span>
      </button>
    </div>
  </div>
</template>
