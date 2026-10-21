<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import StatsBar from './components/StatsBar.vue'
import SearchFilter from './components/SearchFilter.vue'
import JobForm from './components/JobForm.vue'
import JobTable from './components/JobTable.vue'
import AppToast from './components/AppToast.vue'
import type { ToastVariant } from './components/AppToast.vue'
import ExportButton from './components/ExportButton.vue'
import type { ExportResult } from './utils/exportJobs'
import { useJobs } from './composables/useJobs'
import { useViewMode } from './composables/useViewMode'
import type { ViewPreference } from './composables/useViewMode'
import { useUndoStack, UNDO_WINDOW_MS } from './composables/useUndoStack'
import type { UndoEntry } from './composables/useUndoStack'
import type { Job } from './types'

const {
  jobs,
  filteredJobs,
  filters,
  hasActiveFilters,
  dateRangeError,
  patchFilters,
  clearFilters,
  stats,
  addJob,
  updateJob,
  deleteJob,
  restoreJob,
  removeJobById,
} = useJobs()

const { viewMode, isAuto, setViewMode, clearPreference } = useViewMode()

function handleViewPreference(value: ViewPreference) {
  if (value === 'auto') {
    clearPreference()
    return
  }
  setViewMode(value)
}

const undoStack = useUndoStack()

const formOpen = ref(false)
const editingJob = ref<Job | null>(null)
const pendingDelete = ref<Job | null>(null)

const toast = ref<{
  variant: ToastVariant
  title: string
  description: string
  undoId: string | null
} | null>(null)
const toastLeaving = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | undefined

const TOAST_EXIT_MS = 180

const isFiltering = computed(() => hasActiveFilters.value)

const undoRemainingMs = computed(() => undoStack.remainingMs.value)
/** Share of the undo window left, derived from the undo stack's own clock. */
const undoProgress = computed(() => {
  if (!undoStack.topEntry.value) return 0
  const ratio = undoStack.remainingMs.value / UNDO_WINDOW_MS
  return Math.max(0, Math.min(1, ratio))
})
/**
 * The undo entry this toast may offer to undo. A plain success toast never
 * shows an undo button, even when an earlier operation is still pending.
 */
const toastUndoEntry = computed(() => {
  const id = toast.value?.undoId
  if (!id) return null
  const top = undoStack.topEntry.value
  return top && top.id === id ? top : null
})

function clearToastTimer() {
  if (toastTimer !== undefined) {
    clearTimeout(toastTimer)
    toastTimer = undefined
  }
}

/** Dismisses the toast with a short exit transition. */
function hideToast() {
  if (!toast.value || toastLeaving.value) return
  clearToastTimer()
  toastLeaving.value = true
  toastTimer = setTimeout(() => {
    toast.value = null
    toastLeaving.value = false
  }, TOAST_EXIT_MS)
}

/**
 * Shows a toast. Success messages fade out on their own; error messages
 * stay until the user closes them so they can be read.
 */
function showToast(
  variant: ToastVariant,
  title: string,
  description = '',
  durationMs?: number,
  undoId: string | null = null,
) {
  toast.value = { variant, title, description, undoId }
  toastLeaving.value = false
  clearToastTimer()
  if (variant === 'error') return
  toastTimer = setTimeout(hideToast, durationMs ?? 3000)
}

/** Toast for a reversible operation: stays alive while the entry is valid. */
function showUndoToast(
  variant: ToastVariant,
  title: string,
  description: string,
  entry: UndoEntry,
) {
  const remaining = Math.max(0, entry.expiresAt - Date.now())
  showToast(variant, title, description, remaining, entry.id)
}

function handleUndo() {
  const entry = undoStack.take()
  if (!entry) {
    hideToast()
    return
  }
  let ok = false
  let title = ''
  let description = ''
  if (entry.type === 'delete') {
    ok = restoreJob({ job: entry.job, index: entry.index })
    title = ok ? '已恢复记录' : '撤销失败'
    description = ok
      ? `「${entry.job.company}」已还原到原来的位置`
      : '记录已存在，无法重复恢复'
  } else {
    ok = removeJobById(entry.job.id, entry.job)
    title = ok ? '已撤销新增' : '撤销失败'
    description = ok ? `「${entry.job.company}」已移除` : '记录已被修改，无法撤销'
  }
  const next = undoStack.topEntry.value
  if (!ok) {
    showToast('error', title, description)
  } else if (next) {
    // another undoable operation is still pending: keep the toast and let it
    // offer the next one with its own remaining time
    showUndoToast('undone', title, description, next)
  } else {
    showToast('undone', title, description, 3000)
  }
}

onBeforeUnmount(() => {
  clearToastTimer()
})

function openCreate() {
  editingJob.value = null
  formOpen.value = true
}

function openEdit(job: Job) {
  editingJob.value = job
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingJob.value = null
}

function handleSave(payload: Parameters<typeof addJob>[0]) {
  if (editingJob.value) {
    const company = editingJob.value.company
    updateJob(editingJob.value.id, payload)
    showToast('edited', `「${company}」已更新`, '记录内容已保存')
  } else {
    const job = addJob(payload)
    const entry = undoStack.push('add', job, jobs.value.length - 1)
    showUndoToast('added', `已新增「${job.company}」`, '', entry)
  }
  closeForm()
}

function confirmDelete() {
  if (!pendingDelete.value) return
  const target = pendingDelete.value
  const removed = deleteJob(target.id)
  pendingDelete.value = null
  if (!removed) {
    showToast('error', '删除失败', '记录不存在或已被移除')
    return
  }
  const entry = undoStack.push('delete', removed.job, removed.index)
  showUndoToast('deleted', `已删除「${removed.job.company}」`, '', entry)
}

/** Export is a non destructive action, so it never enters the undo stack. */
function handleExportResult(result: ExportResult) {
  if (result.ok) {
    showToast('exported', result.message, '文件已在本地生成')
    return
  }
  showToast('error', '导出失败', result.message)
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">JT</span>
        <div>
          <h1>JobTrack</h1>
          <p class="brand-sub">求职申请追踪</p>
        </div>
      </div>
      <ExportButton
        :filtered-jobs="filteredJobs"
        :all-jobs="jobs"
        @result="handleExportResult"
      />
      <button type="button" class="btn btn-primary" @click="openCreate">新增记录</button>
    </header>

    <main class="app-main">
      <StatsBar :stats="stats" />

      <SearchFilter
        :filters="filters"
        :has-active-filters="hasActiveFilters"
        :date-range-error="dateRangeError"
        :view-mode="viewMode"
        :is-auto="isAuto"
        @update:filters="patchFilters"
        @clear-filters="clearFilters"
        @update:view-preference="handleViewPreference"
      />

      <JobTable
        :jobs="filteredJobs"
        :has-any-record="jobs.length > 0"
        :is-filtering="isFiltering"
        :view-mode="viewMode"
        @edit="openEdit"
        @remove="pendingDelete = $event"
        @clear-filters="clearFilters"
      />
    </main>

    <div v-if="formOpen" class="overlay" role="dialog" aria-modal="true" @click.self="closeForm">
      <div class="dialog">
        <JobForm :editing="editingJob" @save="handleSave" @cancel="closeForm" />
      </div>
    </div>

    <div
      v-if="pendingDelete"
      class="overlay"
      role="alertdialog"
      aria-modal="true"
      @click.self="pendingDelete = null"
    >
      <div class="dialog dialog-confirm">
        <h2 class="dialog-title">确认删除</h2>
        <p class="confirm-text">
          确定要删除“{{ pendingDelete.company }} / {{ pendingDelete.position }}”这条记录吗？删除后可在提示条中撤销。
        </p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" @click="pendingDelete = null">取消</button>
          <button type="button" class="btn btn-danger" @click="confirmDelete">确认删除</button>
        </div>
      </div>
    </div>

    <AppToast
      v-if="toast"
      :variant="toast.variant"
      :title="toast.title"
      :description="toast.description"
      :undo-entry="toastUndoEntry"
      :remaining-ms="undoRemainingMs"
      :progress="undoProgress"
      :leaving="toastLeaving"
      @undo="handleUndo"
      @close="hideToast"
    />
  </div>
</template>
