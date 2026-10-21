<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watchEffect } from 'vue'
import StatsBar from './components/StatsBar.vue'
import SearchFilter from './components/SearchFilter.vue'
import JobForm from './components/JobForm.vue'
import JobTable from './components/JobTable.vue'
import AppToast from './components/AppToast.vue'
import ExportButton from './components/ExportButton.vue'
import JobDetailDrawer from './components/JobDetailDrawer.vue'
import type { StatusSlice } from './components/StatusChart.vue'
import { STATUS_COLORS, STATUS_ORDER } from './types'
import { useJobs } from './composables/useJobs'
import { useViewMode } from './composables/useViewMode'
import type { ViewPreference } from './composables/useViewMode'
import { useUndoStack } from './composables/useUndoStack'
import { useI18n } from './composables/useI18n'
import { useAppDialogs } from './composables/useAppDialogs'
import { useToastController } from './composables/useToastController'
import type { ExportResult } from './utils/exportJobs'
import type { Job } from './types'

// 图表库只在 Dashboard 渲染时才加载
const StatusChart = defineAsyncComponent(() => import('./components/StatusChart.vue'))

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
  document.documentElement.lang = locale.value
})

function handleViewPreference(value: ViewPreference) {
  if (value === 'auto') {
    clearPreference()
    return
  }
  setViewMode(value)
}

const undoStack = useUndoStack()
const toastController = useToastController(undoStack)
const { toast, toastLeaving, toastUndoEntry, undoRemainingMs, undoProgress, showToast, hideToast } =
  toastController

const fabRef = ref<HTMLElement | null>(null)

const dialogs = useAppDialogs({ fallbackFocus: () => fabRef.value, jobs })
const {
  formOpen,
  editingJob,
  pendingDelete,
  detailJob,
  detailOpen,
  openCreate,
  openEdit,
  closeForm,
  requestDelete,
  cancelDelete,
  openDetail,
  closeDetail,
  editFromDetail,
  removeFromDetail,
} = dialogs

const isFiltering = computed(() => hasActiveFilters.value)

/** 图表切片与统计卡片同源，均来自 useJobs 的记录计数。 */
const statusSlices = computed<StatusSlice[]>(() =>
  STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    count: statusCounts.value[status],
    color: STATUS_COLORS[status],
  })),
)

function handleSave(payload: Parameters<typeof addJob>[0]) {
  if (editingJob.value) {
    updateJob(editingJob.value.id, payload)
    showToast('edited', t('toastUpdated'), t('toastSaved'))
  } else {
    const job = addJob(payload)
    const entry = undoStack.push('add', job, jobs.value.length - 1)
    showToast('added', t('toastAdded', { company: job.company }), '', undefined, entry)
  }
  closeForm()
}

function confirmDelete() {
  if (!pendingDelete.value) return
  const target = pendingDelete.value
  const removed = deleteJob(target.id)
  cancelDelete()
  if (!removed) {
    showToast('error', t('toastDeleteFailed'), t('toastDeleteFailedDesc'))
    return
  }
  const entry = undoStack.push('delete', removed.job, removed.index)
  showToast('deleted', t('toastDeleted', { company: removed.job.company }), '', undefined, entry)
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
    // 还有待撤销的操作：保留提示并指向下一条
    showToast('undone', title, description, undefined, next)
  } else {
    showToast('undone', title, description)
  }
}

/** 导出是只读操作，不进入撤销栈。 */
function handleExportResult(result: ExportResult) {
  if (result.ok) {
    showToast('exported', t('exportDone', { count: result.count }), t('exportLocalNote'))
    return
  }
  const description = result.failure === 'empty' ? t('exportNoRecords') : t('exportWorkbookFailed')
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
        @remove="requestDelete"
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
      @click.self="cancelDelete"
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
          <button type="button" class="btn btn-ghost" @click="cancelDelete">
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
      @edit="editFromDetail"
      @remove="removeFromDetail"
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
