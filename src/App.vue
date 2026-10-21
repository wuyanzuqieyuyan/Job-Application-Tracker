<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watchEffect } from 'vue'
import StatsBar from './components/StatsBar.vue'
import SearchFilter from './components/SearchFilter.vue'
import JobForm from './components/JobForm.vue'
import JobTable from './components/JobTable.vue'
import AppToast from './components/AppToast.vue'
import type { ToastVariant } from './components/AppToast.vue'
import ExportButton from './components/ExportButton.vue'
import type { ExportResult } from './utils/exportJobs'
import type { StatusSlice } from './components/StatusChart.vue'
import JobDetailDrawer from './components/JobDetailDrawer.vue'
import { STATUS_COLORS, STATUS_ORDER } from './types'

// the chart library is only fetched when the dashboard is rendered
const StatusChart = defineAsyncComponent(() => import('./components/StatusChart.vue'))
import { useJobs } from './composables/useJobs'
import { useViewMode } from './composables/useViewMode'
import type { ViewPreference } from './composables/useViewMode'
import { useUndoStack, UNDO_WINDOW_MS } from './composables/useUndoStack'
import type { UndoEntry } from './composables/useUndoStack'
import { useI18n } from './composables/useI18n'
import type { Job } from './types'

const {
  jobs,
  filteredJobs,
  filters,
  hasActiveFilters,
  dateRangeInvalid,
  patchFilters,
  clearFilters,
  stats,
  statusCounts,
  addJob,
  updateJob,
  deleteJob,
  restoreJob,
  removeJobById,
} = useJobs()

const { viewMode, isAuto, setViewMode, clearPreference } = useViewMode()
const { t, statusLabel, locale, toggleLocale } = useI18n()

// 同步文档语言，屏幕阅读器与原生日期控件会跟随界面语言
watchEffect(() => {
  document.documentElement.lang = locale.value === 'zh-CN' ? 'zh-CN' : 'en'
})

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

/** Detail drawer selection, identified by the stable record id. */
const detailJobId = ref<string | null>(null)
const detailJob = computed(() => jobs.value.find((job) => job.id === detailJobId.value) ?? null)
const detailOpen = computed(() => detailJobId.value !== null)

function openDetail(job: Job) {
  detailJobId.value = job.id
}

function closeDetail() {
  detailJobId.value = null
}

/** Editing from the drawer reuses the existing edit flow. */
function handleDetailEdit(job: Job) {
  closeDetail()
  openEdit(job)
}

/** Deleting from the drawer reuses the existing confirmation + undo flow. */
function handleDetailRemove(job: Job) {
  closeDetail()
  pendingDelete.value = job
}

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

/** Chart slices are derived from the same record counts as the stat cards. */
const statusSlices = computed<StatusSlice[]>(() =>
  STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    count: statusCounts.value[status],
    color: STATUS_COLORS[status],
  })),
)

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
    title = ok ? t('toastRestored') : t('toastUndoFailed')
    description = ok
      ? t('toastRestoredDesc', { company: entry.job.company })
      : t('toastUndoFailedExists')
  } else {
    ok = removeJobById(entry.job.id, entry.job)
    title = ok ? t('toastUndoneAdd') : t('toastUndoFailed')
    description = ok
      ? t('toastUndoneAddDesc', { company: entry.job.company })
      : t('toastUndoFailedModified')
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

/** 打开表单时记录触发元素，关闭后恢复焦点 */
let formTrigger: HTMLElement | null = null
const fabRef = ref<HTMLElement | null>(null)

function openCreate() {
  formTrigger = document.activeElement as HTMLElement | null
  editingJob.value = null
  formOpen.value = true
}

function openEdit(job: Job) {
  formTrigger = document.activeElement as HTMLElement | null
  editingJob.value = job
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingJob.value = null
  const trigger = formTrigger
  formTrigger = null
  nextTick(() => {
    // 触发按钮可能已被重新创建（悬浮按钮在表单打开时移除），此时回退到悬浮按钮
    if (trigger && document.contains(trigger)) {
      trigger.focus()
    } else if (fabRef.value) {
      fabRef.value.focus()
    }
  })
}

function handleSave(payload: Parameters<typeof addJob>[0]) {
  if (editingJob.value) {
    updateJob(editingJob.value.id, payload)
    showToast('edited', t('toastUpdated'), t('toastSaved'))
  } else {
    const job = addJob(payload)
    const entry = undoStack.push('add', job, jobs.value.length - 1)
    showUndoToast('added', t('toastAdded', { company: job.company }), '', entry)
  }
  closeForm()
}

function confirmDelete() {
  if (!pendingDelete.value) return
  const target = pendingDelete.value
  const removed = deleteJob(target.id)
  pendingDelete.value = null
  if (!removed) {
    showToast('error', t('toastDeleteFailed'), t('toastDeleteFailedDesc'))
    return
  }
  const entry = undoStack.push('delete', removed.job, removed.index)
  showUndoToast('deleted', t('toastDeleted', { company: removed.job.company }), '', entry)
}

/** Export is a non destructive action, so it never enters the undo stack. */
function handleExportResult(result: ExportResult) {
  if (result.ok) {
    showToast('exported', t('exportDone', { count: result.count }), t('exportLocalNote'))
    return
  }
  const description =
    result.failure === 'empty' ? t('exportNoRecords') : t('exportWorkbookFailed')
  showToast('error', t('exportFailed'), description)
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="brand">
        <span class="brand-mark">JT</span>
        <div>
          <h1>JobTrack</h1>
          <p class="brand-sub">{{ t('appSubtitle') }}</p>
        </div>
      </div>
      <div class="app-actions">
        <button
          type="button"
          class="btn btn-lang"
          :aria-label="locale === 'zh-CN' ? t('actionLanguageToEnglish') : t('actionLanguageToChinese')"
          :title="locale === 'zh-CN' ? t('actionLanguageToEnglish') : t('actionLanguageToChinese')"
          @click="toggleLocale"
        >
          <svg class="lang-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <circle cx="10" cy="10" r="7.4" fill="none" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M2.6 10h14.8M10 2.6c2 2.2 3 4.7 3 7.4s-1 5.2-3 7.4c-2-2.2-3-4.7-3-7.4s1-5.2 3-7.4z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
          <span>{{ t('languageName') }}</span>
        </button>
        <ExportButton
          :filtered-jobs="filteredJobs"
          :all-jobs="jobs"
          @result="handleExportResult"
        />
        <button type="button" class="btn btn-primary" @click="openCreate">
          {{ t('actionAddRecord') }}
        </button>
      </div>
    </header>

    <main class="app-main">
      <div class="dashboard">
        <StatsBar :stats="stats" />
        <StatusChart :data="statusSlices" :total="stats.total" />
      </div>

      <SearchFilter
        :filters="filters"
        :has-active-filters="hasActiveFilters"
        :date-range-invalid="dateRangeInvalid"
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
        @view="openDetail"
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
        <h2 class="dialog-title">{{ t('confirmDeleteTitle') }}</h2>
        <p class="confirm-text">
          {{
            t('confirmDeleteText', {
              company: pendingDelete.company,
              position: pendingDelete.position,
            })
          }}
        </p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" @click="pendingDelete = null">
            {{ t('confirmCancel') }}
          </button>
          <button type="button" class="btn btn-danger" @click="confirmDelete">
            {{ t('confirmDeleteAction') }}
          </button>
        </div>
      </div>
    </div>

    <JobDetailDrawer
      :open="detailOpen"
      :job="detailJob"
      @close="closeDetail"
      @edit="handleDetailEdit"
      @remove="handleDetailRemove"
    />

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

    <button
      v-if="!formOpen"
      ref="fabRef"
      type="button"
      class="fab-add"
      :aria-label="t('actionAddRecord')"
      @click="openCreate"
    >
      <svg class="fab-add-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <path d="M10 4.4v11.2M4.4 10h11.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <span>{{ t('actionAddRecord') }}</span>
    </button>
  </div>
</template>
