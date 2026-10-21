<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Job } from '../types'
import type { ExportResult, ExportScope } from '../utils/exportJobs'

const props = defineProps<{
  filteredJobs: Job[]
  allJobs: Job[]
}>()

const emit = defineEmits<{
  (e: 'result', result: ExportResult): void
}>()

const open = ref(false)
const busy = ref(false)
const root = ref<HTMLElement | null>(null)

const hasRecords = computed(() => props.allJobs.length > 0)
const hasFiltered = computed(() => props.filteredJobs.length > 0)

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
    emit('result', { ok: false, message: '没有可导出的记录', count: 0 })
    return
  }
  busy.value = true
  try {
    // the Excel writer is only loaded when an export is actually requested
    const { exportJobsToXlsx } = await import('../utils/exportJobs')
    const result = await exportJobsToXlsx(jobs)
    emit('result', result)
  } catch {
    emit('result', { ok: false, message: '导出失败：模块加载出错', count: 0 })
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
      class="btn btn-ghost export-trigger"
      :disabled="!hasRecords || busy"
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
      <span>{{ busy ? '导出中…' : '导出 Excel' }}</span>
    </button>

    <div v-if="open" class="export-menu" role="menu" aria-label="导出范围">
      <button
        type="button"
        class="export-menu-item"
        role="menuitem"
        :disabled="!hasFiltered"
        @click="choose('filtered')"
      >
        <span class="export-menu-label">导出当前筛选结果</span>
        <span class="export-menu-count">{{ filteredJobs.length }} 条</span>
      </button>
      <button
        type="button"
        class="export-menu-item"
        role="menuitem"
        :disabled="!hasRecords"
        @click="choose('all')"
      >
        <span class="export-menu-label">导出全部记录</span>
        <span class="export-menu-count">{{ allJobs.length }} 条</span>
      </button>
    </div>
  </div>
</template>
