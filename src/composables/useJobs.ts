import { computed, ref } from 'vue'
import type { DeletedJobSnapshot, Job, JobFilters, JobInput, JobStatus, RestoredJobData } from '../types'
import { DEFAULT_FILTERS } from '../types'
import {
  ApiError,
  createJob,
  deleteJob as apiDeleteJob,
  getJob,
  listJobs,
  restoreSnapshot,
  updateJob as apiUpdateJob,
} from '../api/jobsClient'
import type { MigrationNotice } from '../api/migration'
import { migrateLegacyIfNeeded } from '../api/migration'

/**
 * 数据访问层：SQLite 后端是职位数据的唯一事实来源。
 *
 * - 初始化：`GET /api/jobs` 加载；失败进入 error 状态并提供 retryLoad()，绝不静默回退 localStorage。
 * - 初始化成功后才执行历史数据迁移（migration.ts；判据依据迁移标记，而非服务器记录数）。
 * - localStorage 仅保留迁移标记与语言/视图偏好；职位数组不再有任何深度 watch 回写。
 * - 创建/编辑/删除均先完成服务端请求，成功后才更新内存；失败保持列表不变并返回失败信号。
 * - 删除返回服务端 9 字段快照（供撤销恢复使用）。
 * - 未加载完成（loading/error）时所有写操作直接拒绝，避免假数据造成覆盖。
 */

export type JobsLoadState = 'loading' | 'ready' | 'error'

/** 编辑表单的五字段载荷（与 JobForm.vue 既有导出保持兼容）。 */
export interface JobFormInput extends JobInput {}

/** 删除操作结果：窄联合类型，App 按 outcome 分派提示与撤销栈动作。 */
export type DeleteOutcome =
  | { outcome: 'deleted'; snapshot: DeletedJobSnapshot; index: number }
  | { outcome: 'absent' }
  | { outcome: 'failed'; message: string }
  | { outcome: 'uncertain'; message: string }

/** 恢复操作结果。serverHasRecord：true=GET 确认存在；false=确认不存在；null=无法核对。 */
export type RestoreOutcome =
  | { outcome: 'restored'; data: RestoredJobData; synced: boolean }
  | { outcome: 'conflict'; existsNow: boolean; sameContent: boolean }
  | { outcome: 'failed'; message: string }
  | { outcome: 'uncertain'; serverHasRecord: boolean | null; message: string }

/** 网络中断/5xx/无法解析的响应：结果不确定，需要 GET 核对。 */
function isUncertain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 0 || error.status >= 500 || error.code === 'bad_response'
}

function retriableMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : '发生未知错误'
}

const jobs = ref<Job[]>([])
const loadState = ref<JobsLoadState>('loading')
const loadError = ref<string>('')
// 富类型通知：App.vue 按 kind 分派文案（count/ids 等细节不在此处削枝）。
const migrationNotice = ref<MigrationNotice | null>(null)

/** 同一记录的写操作互斥（创建共用 submitBusy 全局锁）。 */
const submitBusy = ref(false)
const busyRecordIds = ref<Set<string>>(new Set())

function isBusyRecord(id: string): boolean {
  return busyRecordIds.value.has(id)
}

function markBusy(id: string): boolean {
  if (isBusyRecord(id)) return false
  const next = new Set(busyRecordIds.value)
  next.add(id)
  busyRecordIds.value = next
  return true
}

function unmarkBusy(id: string): void {
  const next = new Set(busyRecordIds.value)
  next.delete(id)
  busyRecordIds.value = next
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return '发生未知错误'
}

async function loadOnce(): Promise<void> {
  loadState.value = 'loading'
  loadError.value = ''
  migrationNotice.value = null
  try {
    const serverJobs = await listJobs()
    const outcome = await migrateLegacyIfNeeded(serverJobs)
    jobs.value = outcome.finalList ?? serverJobs
    loadState.value = 'ready'
    if (outcome.notice) {
      migrationNotice.value = outcome.notice
    }
  } catch (error) {
    // 关键契约：绝不把失败伪装成空列表，也绝不回退到 localStorage 数据源。
    // 诊断细节（含后端返回的错误码/消息）输出到控制台；界面提示使用
    // loadFailureDesc 的固定本地化文案（不再插值 loadError，避免英文混排中文）。
    console.error('[JobTrack] 服务器数据加载失败：', error)
    jobs.value = []
    loadState.value = 'error'
    loadError.value = describeError(error)
  }
}

/** App.vue 初始化时会调用；模块级单例保证只初始化一次。 */
let initStarted = false

export function useJobs() {
  function ensureInit(): void {
    if (initStarted) return
    initStarted = true
    void loadOnce()
  }

  /** 加载失败后的手动重试入口。 */
  async function retryLoad(): Promise<void> {
    await loadOnce()
  }

  const filters = ref<JobFilters>({ ...DEFAULT_FILTERS })

  /** 所选日期范围自相矛盾（起始晚于结束）时为 true。 */
  const dateRangeInvalid = computed(() => {
    const { dateFrom, dateTo } = filters.value
    return dateFrom !== '' && dateTo !== '' && dateFrom > dateTo
  })

  const hasActiveFilters = computed(() => {
    const f = filters.value
    return (
      f.keyword.trim() !== '' ||
      f.status !== 'all' ||
      f.dateFrom !== '' ||
      f.dateTo !== ''
    )
  })

  /**
   * 查询流水线：关键词 → 状态 → 日期范围 → 排序。
   * 始终在副本上运算；响应式源数组绝不会被修改。
   */
  const filteredJobs = computed<Job[]>(() => {
    const { keyword, status, dateFrom, dateTo, sortOrder } = filters.value
    const term = keyword.trim().toLowerCase()
    const hasFrom = dateFrom !== ''
    const hasTo = dateTo !== ''
    const ignoreRange = dateRangeInvalid.value
    const from = hasFrom ? Date.parse(dateFrom) : Number.NaN
    const to = hasTo ? Date.parse(dateTo) : Number.NaN

    const matched = jobs.value.filter((job) => {
      if (term !== '') {
        const hitCompany = job.company.toLowerCase().includes(term)
        const hitPosition = job.position.toLowerCase().includes(term)
        if (!hitCompany && !hitPosition) return false
      }
      if (status !== 'all' && job.status !== status) return false
      if (!ignoreRange && (hasFrom || hasTo)) {
        const time = Date.parse(job.appliedDate)
        // 日期无法解析的记录无法落入任何范围
        if (Number.isNaN(time)) return false
        if (hasFrom && time < from) return false
        if (hasTo && time > to) return false
      }
      return true
    })

    const direction = sortOrder === 'date-asc' ? 1 : -1
    return matched
      .map((job, index) => ({ job, index }))
      .sort((a, b) => {
        const timeA = Date.parse(a.job.appliedDate)
        const timeB = Date.parse(b.job.appliedDate)
        const validA = !Number.isNaN(timeA)
        const validB = !Number.isNaN(timeB)
        // 无法解析的日期始终排到末尾
        if (validA !== validB) return validA ? -1 : 1
        if (validA && timeA !== timeB) return (timeA - timeB) * direction
        // 稳定的次级规则：保持原始插入顺序
        return a.index - b.index
      })
      .map((entry) => entry.job)
  })

  /** 各状态的记录数。顶部统计数据的唯一事实来源。 */
  const statusCounts = computed<Record<JobStatus, number>>(() => {
    const counts: Record<JobStatus, number> = {
      applied: 0,
      interviewing: 0,
      offer: 0,
      rejected: 0,
    }
    for (const job of jobs.value) {
      counts[job.status] += 1
    }
    return counts
  })

  const stats = computed(() => ({
    total: jobs.value.length,
    applied: statusCounts.value.applied,
    interviewing: statusCounts.value.interviewing,
    offer: statusCounts.value.offer,
  }))

  function sameJob(a: Job, b: Job): boolean {
    return (
      a.company === b.company &&
      a.position === b.position &&
      a.appliedDate === b.appliedDate &&
      a.status === b.status &&
      a.notes === b.notes
    )
  }

  /** 创建：先服务端后内存；失败返回 null（列表不变）。未知错误统一走失败文案。 */
  async function addJob(input: JobInput): Promise<Job | null> {
    if (loadState.value !== 'ready' || submitBusy.value) return null
    submitBusy.value = true
    try {
      const job = await createJob(input)
      jobs.value = [...jobs.value, job]
      return job
    } catch {
      return null
    } finally {
      submitBusy.value = false
    }
  }

  /** 编辑：先服务端后内存；失败返回 null（列表不变）。 */
  async function updateJob(id: string, input: JobInput): Promise<Job | null> {
    if (loadState.value !== 'ready' || !markBusy(id)) return null
    try {
      const job = await apiUpdateJob(id, input)
      jobs.value = jobs.value.map((existing) => (existing.id === id ? job : existing))
      return job
    } catch {
      return null
    } finally {
      unmarkBusy(id)
    }
  }

  /**
   * 删除（四态结果）：
   * - deleted：服务器确认成功（9 字段快照），本地同步移除；撤销条目由调用方在确认后才压栈。
   * - absent：服务器确认无此记录（404）——按"服务器为准"同步移除本地过期记录，不产生撤销。
   * - failed：服务器明确拒绝/确认未删除（核对发现记录仍在），列表不变。
   * - uncertain：网络中断/5xx/解析失败且 GET 核对也失败——删除可能已生效也可能没有，
   *   列表保持原状，由界面给出"结果待确认"提示；绝不臆断成功或失败。
   * 同一记录的并发操作由 busy 锁拒绝，未确认的删除不会与后续操作交错。
   */
  async function deleteJob(id: string): Promise<DeleteOutcome> {
    if (loadState.value !== 'ready' || !markBusy(id)) {
      return { outcome: 'failed', message: '数据尚未加载完成或该记录正在处理中' }
    }
    const index = jobs.value.findIndex((job) => job.id === id)
    if (index < 0) {
      unmarkBusy(id)
      return { outcome: 'failed', message: '记录不在当前列表中' }
    }
    try {
      const snapshot = await apiDeleteJob(id)
      jobs.value = jobs.value.filter((item) => item.id !== id)
      return { outcome: 'deleted', snapshot, index }
    } catch (error) {
      // 诊断细节进控制台；UI 用固定本地化文案（避免英文界面混排）
      console.error('[JobTrack] 删除同步失败：', error)
      if (error instanceof ApiError && error.code === 'job_not_found') {
        // 服务器确认不存在：以服务器为准移除本地残留记录（无快照可撤销）。
        jobs.value = jobs.value.filter((item) => item.id !== id)
        return { outcome: 'absent' }
      }
      if (isUncertain(error)) {
        // 结果不确定 → 按 GET 真实契约核对
        try {
          const remote = await getJob(id)
          if (remote) return { outcome: 'failed', message: retriableMessage(error) }
        } catch (verifyError) {
          if (verifyError instanceof ApiError && verifyError.code === 'job_not_found') {
            jobs.value = jobs.value.filter((item) => item.id !== id)
            return { outcome: 'absent' }
          }
          return {
            outcome: 'uncertain',
            message: `删除请求未收到确认，且无法核实记录状态（${retriableMessage(error)}）`,
          }
        }
      }
      return { outcome: 'failed', message: retriableMessage(error) }
    } finally {
      unmarkBusy(id)
    }
  }

  /**
   * 撤销删除：POST /restore 提交原始 9 字段快照；成功后以重新拉取的
   * 服务器列表为准同步显示（服务器排序权威，还原位置由 restoredAs 表达）。
   * - 409：不覆盖同 id 记录；先 GET 核对当前服务器内容再报告，条目与数据由调用方处置。
   * - 不确定（网络/5xx/解析失败）：按 GET 核对；只报告"服务器当前是否存在"这一事实，
   *   不声称恢复成功或失败；serverHasRecord=null 表示核对本身失败。
   */
  async function restoreDeleted(
    snapshot: DeletedJobSnapshot,
    fallbackIndex: number,
  ): Promise<RestoreOutcome> {
    if (loadState.value !== 'ready' || !markBusy(snapshot.id)) {
      return { outcome: 'failed', message: '数据尚未加载完成或该记录正在处理中' }
    }
    try {
      const data = await restoreSnapshot(snapshot)
      let synced = false
      try {
        jobs.value = await listJobs()
        synced = true
      } catch {
        // 服务器顺序同步失败：以恢复响应在本地下标处插入近似还原（五字段，服务器已恢复成功）
        const job: Job = {
          id: data.id,
          company: data.company,
          position: data.position,
          appliedDate: data.appliedDate,
          status: data.status,
          notes: data.notes,
        }
        jobs.value = jobs.value.some((item) => item.id === job.id)
          ? jobs.value
          : [...jobs.value.slice(0, Math.max(0, Math.min(fallbackIndex, jobs.value.length))), job, ...jobs.value.slice(Math.max(0, Math.min(fallbackIndex, jobs.value.length)))]
      }
      return { outcome: 'restored', data, synced }
    } catch (error) {
      // 诊断细节进控制台；UI 用固定本地化文案（避免英文界面混排）
      console.error('[JobTrack] 撤销恢复失败：', error)
      if (error instanceof ApiError && error.code === 'id_conflict') {
        let existsNow = false
        let sameContent = false
        try {
          const remote = await getJob(snapshot.id)
          existsNow = true
          sameContent =
            remote.company.trim() === snapshot.company &&
            remote.position.trim() === snapshot.position &&
            remote.appliedDate === snapshot.appliedDate &&
            remote.status === snapshot.status &&
            remote.notes.trim() === snapshot.notes
        } catch {
          existsNow = false
        }
        return { outcome: 'conflict', existsNow, sameContent }
      }
      if (isUncertain(error)) {
        try {
          await getJob(snapshot.id)
          // GET 确认记录存在：仅说明"当前存在"，不宣称本次恢复成功。
          return { outcome: 'uncertain', serverHasRecord: true, message: retriableMessage(error) }
        } catch (verifyError) {
          if (verifyError instanceof ApiError && verifyError.code === 'job_not_found') {
            return { outcome: 'uncertain', serverHasRecord: false, message: retriableMessage(error) }
          }
          return {
            outcome: 'uncertain',
            serverHasRecord: null,
            message: `恢复结果待确认，且无法核实记录状态（${retriableMessage(error)}）`,
          }
        }
      }
      return { outcome: 'failed', message: retriableMessage(error) }
    } finally {
      unmarkBusy(snapshot.id)
    }
  }

  /** 以服务器列表为准强制刷新本地视图（供必要的状态核对与一致性兜底）。 */
  async function syncFromServer(): Promise<boolean> {
    if (loadState.value !== 'ready') return false
    try {
      jobs.value = await listJobs()
      return true
    } catch {
      return false
    }
  }

  /** 撤销"新增"：快照校验 + 服务端删除；失败列表不变。 */
  async function removeJobById(id: string, expected?: Job): Promise<boolean> {
    if (loadState.value !== 'ready' || !markBusy(id)) return false
    const current = jobs.value.find((job) => job.id === id)
    if (!current || (expected && !sameJob(current, expected))) {
      unmarkBusy(id)
      return false
    }
    try {
      await apiDeleteJob(id)
    } catch {
      return false
    }
    jobs.value = jobs.value.filter((job) => job.id !== id)
    return true
  }

  /** 应用一次部分筛选变更。 */
  function patchFilters(patch: Partial<JobFilters>) {
    filters.value = { ...filters.value, ...patch }
  }

  /** 恢复默认筛选与默认排序。 */
  function clearFilters() {
    filters.value = { ...DEFAULT_FILTERS }
  }

  ensureInit()

  return {
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
    loadError,
    migrationNotice,
    isSubmitting: submitBusy,
    retryLoad,
    addJob,
    updateJob,
    deleteJob,
    restoreDeleted,
    syncFromServer,
    removeJobById,
  }
}
