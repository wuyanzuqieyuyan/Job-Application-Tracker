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
  loadState,
  migrationNotice,
  isSubmitting,
  retryLoad,
  addJob,
  updateJob,
  deleteJob,
  restoreDeleted,
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

/** 迁移/加载通知文案（错误码不直接透出，只给最少量事实）。 */
const migrationNoticeDetail = computed(() => {
  const notice = migrationNotice.value
  if (!notice) return ''
  switch (notice.kind) {
    case 'conflict':
      return t('migrationConflictDesc', { count: notice.count, ids: notice.ids.join(', ') })
    case 'unparsable':
      return t('migrationUnparsableDesc')
    case 'invalid-only':
      return t('migrationInvalidDesc', { count: notice.count })
    case 'partially-invalid':
      return t('migrationPartialDesc', { count: notice.invalidCount })
    case 'blocked':
      // 诊断细节（迁移失败原因）保留在 notice.message 供开发排查；界面用固定本地化文案
      return t('migrationBlockedDesc')
  }
})

/** 图表切片与统计卡片同源，均来自 useJobs 的记录计数。 */
const statusSlices = computed<StatusSlice[]>(() =>
  STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    count: statusCounts.value[status],
    color: STATUS_COLORS[status],
  })),
)

async function handleSave(payload: Parameters<typeof addJob>[0]) {
  // 并发防护：请求进行中的重复提交直接忽略（useJobs 内部同样有锁）
  if (isSubmitting.value) return
  if (editingJob.value) {
    const id = editingJob.value.id
    const updated = await updateJob(id, payload)
    if (!updated) {
      showToast('error', t('toastSaveFailed'), t('toastSaveFailedDesc'))
      return
    } // 编辑失败时保留表单与已填写内容，用户可直接重试
    showToast('edited', t('toastUpdated'), t('toastSaved'))
    closeForm()
  } else {
    const job = await addJob(payload)
    if (!job) {
      showToast('error', t('toastSaveFailed'), t('toastSaveFailedDesc'))
      return
    }
    const entry = undoStack.push('add', job, jobs.value.length - 1)
    showToast('added', t('toastAdded', { company: job.company }), '', undefined, entry)
    closeForm()
  }
}

async function confirmDelete() {
  if (!pendingDelete.value) return
  const target = pendingDelete.value
  const removed = await deleteJob(target.id)
  cancelDelete()
  switch (removed.outcome) {
    case 'deleted': {
      // 只有 DELETE 确认成功（拿到服务器原始 9 字段快照）才开始撤销条目与 5 秒窗口
      const entry = undoStack.pushDelete(removed.snapshot, removed.index)
      showToast('deleted', t('toastDeleted', { company: removed.snapshot.company }), '', undefined, entry)
      break
    }
    case 'absent':
      showToast('error', t('toastDeleteFailed'), t('toastDeleteFailedDesc'))
      break
    case 'failed':
      // 诊断细节已由 useJobs 输出到控制台；界面只显示本地化固定文案
      showToast('error', t('toastDeleteFailed'), t('toastDeleteFailedBusyDesc'))
      break
    case 'uncertain':
      // 结果待确认：不动列表、不展示撤销，明确告知用户去核对
      showToast('error', t('toastDeleteUncertainTitle'), t('toastDeleteUncertainDesc'))
      break
  }
}

function describeRestoredToast(data: { company: string; restoredAs: 'original' | 'appended' }): { title: string; description: string } {
  const title = t('toastRestored')
  return {
    title,
    description:
      data.restoredAs === 'original'
        ? t('toastRestoredDesc', { company: data.company })
        : t('toastRestoredAppendedDesc', { company: data.company }),
  }
}

async function handleUndo() {
  const entry = undoStack.take()
  if (!entry) {
    hideToast()
    return
  }

  if (entry.type === 'delete') {
    // 删除撤销 = POST /restore 提交原始快照
    if (!entry.snapshot) {
      // 结构性防御：删除条目必须携带快照，不应出现；丢弃并如实报告
      showToast('error', t('toastUndoFailed'), t('toastSaveFailedDesc'))
      return
    }
    // 恢复请求进行中的条目受 markInFlight 保护：不会被过期回调删除；
    // 同一条目不会因重复点击而重复提交（take 之后对同一 id 的再撤销由 useJobs busy 键拦截）
    undoStack.markInFlight(entry.id)
    try {
      const result = await restoreDeleted(entry.snapshot, entry.index)
      const next = undoStack.topEntry.value
      if (result.outcome === 'restored') {
        undoStack.removeById(entry.id)
        const view = describeRestoredToast(result.data)
        if (next && next.id !== entry.id) {
          showToast('undone', view.title, view.description, undefined, next)
        } else {
          showToast('undone', view.title, view.description)
        }
      } else if (result.outcome === 'conflict') {
        // 结果确定（恢复被拒绝、未覆盖任何数据）：条目原样放回直至过期，提示如实
        undoStack.reinsert(entry)
        const message = result.existsNow
          ? t('toastRestoreConflictExists', { company: entry.snapshot.company, same: result.sameContent ? t('wordSame') : t('wordDifferent') })
          : t('toastRestoreConflictGone', { company: entry.snapshot.company })
        showToast('error', t('toastRestoreConflictTitle'), message)
      } else if (result.outcome === 'uncertain') {
        // 结果待定：条目原样放回（剩余窗口内可重试），绝不宣称成功/失败
        undoStack.reinsert(entry)
        const message = result.serverHasRecord
          ? t('toastRestoreUncertainExists', { company: entry.snapshot.company })
          : t('toastRestoreUncertainDesc')
        showToast('error', t('toastRestoreUncertainTitle'), message)
      } else {
        // 结果确定失败：丢弃条目，提示明确失败
        showToast('error', t('toastUndoFailed'), t('toastRestoreFailedDesc'))
      }
    } finally {
      undoStack.clearInFlight(entry.id)
    }
    return
  }

  let ok = await removeJobById(entry.job.id, entry.job)
  const title = ok ? t('toastUndoneAdd') : t('toastUndoFailed')
  const description = ok
    ? t('toastUndoneAddDesc', { company: entry.job.company })
    : t('toastSaveFailedDesc')
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
      <div v-if="loadState === 'loading'" class="load-banner load-banner-info" role="status">
        {{ t('loadingLabel') }}
      </div>
      <div v-else-if="loadState === 'error'" class="load-banner load-banner-error" role="alert">
        <div class="load-banner-text">
          <p class="load-banner-title">{{ t('loadFailureTitle') }}</p>
          <p class="load-banner-desc">{{ t('loadFailureDesc') }}</p>
        </div>
        <button type="button" class="btn btn-sm btn-primary" @click="retryLoad">
          {{ t('retryAction') }}
        </button>
      </div>
      <div v-if="loadState === 'ready' && migrationNotice" class="load-banner load-banner-warn" role="status">
        <p class="load-banner-desc">{{ migrationNoticeDetail }}</p>
      </div>

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
        @create="openCreate"
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
