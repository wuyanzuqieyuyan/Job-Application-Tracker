import type { Job, JobStatus } from '../types'
import { importJobs, isValidJobRecord, listJobs, ApiError } from './jobsClient'

/**
 * 历史 localStorage 数据迁移。
 *
 * 设计要点：
 * - 迁移判据不是"服务器记录数为零"，而是显式迁移标记 + 旧数据快照内容。
 * - 利用服务端 `POST /api/jobs/import` 的幂等语义（同 id 同内容 → 跳过；同 id 不同内容 → 409 整批回滚）。
 * - 导入成功不能只凭 201 判定：必须在导入后重新拉取列表，逐条核对"每个本地记录断 id
 *   都已按原内容落到服务器"，全部核对通过才写入迁移完成标记。
 * - 任何失败路径都不删除/改写/覆盖旧 localStorage 数据（旧键一经写入此后完全不再改动，
 *   成为冻结备份）。
 * - 服务端不可达、校验失败、结果不确定 → 不写完成标记；下次启动再次尝试（幂等安全）。
 * - 服务端不可达时绝不回退到本地数据源。
 */

export const LEGACY_KEY = 'jobtrack.jobs.v1'

/** 迁移完成标记（独立键；仅在该标记写入成功后才视为"迁移已完成"状态）。 */
export const MIGRATION_KEY = 'jobtrack.migration.v1'

export interface MigrationMarker {
  status: 'migrated'
  migratedAt: string
  /** 旧记录总数（含非法）。 */
  total: number
  /** 未通过预检、未提交导入的非法记录数（原样保留在旧键中）。 */
  invalid: number
  /** 本次导入请求中新增的记录数（由导入前后服务器列表推算）。 */
  imported: number
  /** 本次导入请求中因幂等命中而跳过的记录数。 */
  skipped: number
}

/**
 * 旧数据快照（初始化时只读一次，迁移期间也绝不写入旧键）。
 * - `none`：键不存在或存储为空。
 * - `unparsable`：JSON 损坏（历史 loadJobs 的行为同样是忽略；数据仍保留在键内，不清除）。
 * - `invalid-only`：数组存在逐条校验后没有任何合法记录。
 * - `candidates`：存在可迁移记录（附非法条目计数）。
 */
export type LegacySnapshot =
  | { kind: 'none' }
  | { kind: 'unparsable' }
  | { kind: 'invalid-only'; invalidCount: number }
  | { kind: 'candidates'; candidates: LegacyRecord[]; invalidCount: number }

type LegacyRecord = Job & Record<string, unknown>

/** 服务端创建/导入校验规则的客户端镜像（预检用；避免整批因个别坏记录被原子回滚）。 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,63}$/
const JOB_STATUSES: JobStatus[] = ['applied', 'interviewing', 'offer', 'rejected']

export function isValidLegacyId(id: unknown): id is string {
  return typeof id === 'string' && CLIENT_ID_PATTERN.test(id)
}

function validContentFields(j: LegacyRecord): boolean {
  return (
    typeof j.company === 'string' && j.company.trim() !== '' && j.company.trim().length <= 50 &&
    typeof j.position === 'string' && j.position.trim() !== '' && j.position.trim().length <= 50 &&
    typeof j.appliedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.appliedDate) && !isFutureDate(j.appliedDate) &&
    (JOB_STATUSES as string[]).includes(j.status) &&
    typeof j.notes === 'string' && j.notes.trim().length <= 200
  )
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(dateStr + 'T00:00:00') > today
}

/** 只读解析旧键：绝不写入。 */
export function readLegacySnapshot(): LegacySnapshot {
  let raw: string | null
  try {
    raw = localStorage.getItem(LEGACY_KEY)
  } catch {
    return { kind: 'none' }
  }
  if (raw === null) return { kind: 'none' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unparsable' }
  }
  if (!Array.isArray(parsed)) return { kind: 'unparsable' }

  const candidates: LegacyRecord[] = []
  const invalid: LegacyRecord[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) { invalid.push(entry as LegacyRecord); continue }
    if (!isValidJobRecord(entry)) { invalid.push(entry as LegacyRecord); continue }
    const record = entry as LegacyRecord
    if (!isValidLegacyId(record.id) || !validContentFields(record)) { invalid.push(record); continue }
    candidates.push(record)
  }
  if (candidates.length === 0) {
    return parsed.length > 0 ? { kind: 'invalid-only', invalidCount: parsed.length } : { kind: 'none' }
  }
  return { kind: 'candidates', candidates, invalidCount: invalid.length }
}

/** 迁移执行结果（useJobs 据此决定提示与是否刷新列表）。 */
export interface MigrationOutcome {
  /** true：无需操作或已完成（复检/导入成功），返回值含最终应展示的服务器列表。 */
  done: boolean
  /** 迁移完成后的服务器列表（done=true 时存在）。 */
  finalList?: Job[]
  /** 需要呈现的迁移信息（冲突/未完成/部分保留），done=false 或有注意事项时存在。 */
  notice?: MigrationNotice
}

export type MigrationNotice =
  | { kind: 'conflict'; count: number; ids: string[] }
  | { kind: 'unparsable' }
  | { kind: 'invalid-only'; count: number }
  | { kind: 'partially-invalid'; imported: number; skipped: number; invalidCount: number }
  | { kind: 'blocked'; message: string }

/** 读已完成标记；损坏/不完整一律视为未迁移（宁可重复幂等导入，不可漏迁移）。 */
function readMarker(): MigrationMarker | null {
  try {
    const raw = localStorage.getItem(MIGRATION_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<MigrationMarker> | null
    return parsed !== null && parsed.status === 'migrated'
      ? {
          status: 'migrated',
          migratedAt: String(parsed.migratedAt ?? ''),
          total: Number(parsed.total ?? 0),
          invalid: Number(parsed.invalid ?? 0),
          imported: Number(parsed.imported ?? 0),
          skipped: Number(parsed.skipped ?? 0),
        }
      : null
  } catch {
    return null
  }
}

function writeMarker(marker: MigrationMarker): void {
  // 标记写入失败不吞掉迁移结果本身：服务器已可靠接纳（见核对流程），
  // 下次启动的重复导入是幂等安全的，只会在日志层面可见。
  try {
    localStorage.setItem(MIGRATION_KEY, JSON.stringify(marker))
  } catch {
    console.warn('[jobtrack-migration]迁移完成标记写入失败；旧数据键保持原样，下次启动将重试幂等导入')
  }
}

/** 归一化比较（与服务器 trim 语义一致）：迁移核对用。 */
function sameContent(a: { company: string; position: string; appliedDate: string; status: string; notes: string },
  b: { company: string; position: string; appliedDate: string; status: string; notes: string }): boolean {
  return (
    a.company.trim() === b.company.trim() &&
    a.position.trim() === b.position.trim() &&
    a.appliedDate === b.appliedDate &&
    a.status === b.status &&
    a.notes.trim() === b.notes.trim()
  )
}

/**
 * 迁移入口：在服务器列表成功获取之后调用（绝不代替服务器加载）。
 *
 * 状态转换：
 * 1. 标记=已完成 → 直接结束（done，finalList=服务器列表）。
 * 2. 旧数据=none/invalid-only → 不导入（无标记也不重复打扰），按 invalid-only 通知坏记录保留事实。
 * 3. 存在候选 → 同 id 冲突预检（本地候选间 + 候选与服务器现有记录间）；冲突 → 停止迁移并报告，绝不改写两端数据。
 * 4. 通过预检 → 导入 → 重新拉取列表逐条核对；全部落库 → 写完成标记；核对不过/异常 → 不写标记，可重试。
 */
export async function migrateLegacyIfNeeded(serverJobs: Job[]): Promise<MigrationOutcome> {
  const marker = readMarker()
  if (marker !== null) {
    return { done: true, finalList: serverJobs }
  }

  const legacy = readLegacySnapshot()
  if (legacy.kind === 'none') {
    // 从未迁移且没有旧数据：不标记（旧备份未来出现时仍可迁移），不动存储。
    return { done: true, finalList: serverJobs }
  }
  if (legacy.kind === 'unparsable') {
    return noticeAndKeep(serverJobs, { kind: 'unparsable' })
  }
  if (legacy.kind === 'invalid-only') {
    return noticeAndKeep(serverJobs, { kind: 'invalid-only', count: legacy.invalidCount })
  }

  const candidates = legacy.candidates

  // 预检一：候选内部同 id 不同内容（服务端会整批回滚，这里提前分类为冲突）
  const byId = new Map<string, LegacyRecord>()
  const internalConflictIds = new Set<string>()
  for (const record of candidates) {
    const existing = byId.get(record.id)
    if (existing && !sameContent(existing, record)) internalConflictIds.add(record.id)
    byId.set(record.id, record)
  }
  if (internalConflictIds.size > 0) {
    return noticeAndKeep(serverJobs, { kind: 'conflict', count: internalConflictIds.size, ids: [...internalConflictIds] })
  }

  // 预检二：候选与服务端现有同 id 记录内容不同 → 服务端 409 整批回滚（设计文档 §2.3）
  const serverById = new Map(serverJobs.map(job => [job.id, job]))
  const conflicts: string[] = []
  for (const record of candidates) {
    const remote = serverById.get(record.id)
    if (remote && remote.id === record.id && !sameContent(remote, record)) conflicts.push(record.id)
  }
  if (conflicts.length > 0) {
    return noticeAndKeep(serverJobs, { kind: 'conflict', count: conflicts.length, ids: conflicts })
  }

  const payload = candidates.map(record => ({
    id: record.id,
    company: record.company,
    position: record.position,
    appliedDate: record.appliedDate,
    status: record.status,
    notes: record.notes,
  }))

  let serverBeforeCount = serverJobs.length
  let serverAfter: Job[]
  try {
    await importJobs(payload)
    serverAfter = await listJobs()
  } catch (error) {
    // 导入失败/网络失败/结果不确定：不写标记，旧数据原样保留，下次启动重试。
    const message = error instanceof ApiError ? error.message : '迁移过程中出现未知错误'
    console.warn('[jobtrack-migration]导入失败，旧数据保留并在下次启动重试：', message)
    return noticeAndKeep(serverJobs, { kind: 'blocked', message })
  }

  // 核对：每个候选断 id 都必须在服务器上存在且内容一致
  const afterById = new Map(serverAfter.map(job => [job.id, job]))
  for (const record of candidates) {
    const remote = afterById.get(record.id)
    if (!remote || !isValidJobRecord(remote) || !sameContent(remote, record)) {
      console.warn('[jobtrack-migration]导入后核对失败（id=' + record.id + '），不写完成标记，下次启动重试')
      return noticeAndKeep(serverAfter, { kind: 'blocked', message: '导入结果核对失败，本地数据已保留，将在下次启动时重试' })
    }
  }

  const imported = Math.max(0, serverAfter.length - serverBeforeCount)
  const markerOut: MigrationMarker = {
    status: 'migrated',
    migratedAt: new Date().toISOString(),
    total: legacy.candidates.length + legacy.invalidCount,
    invalid: legacy.invalidCount,
    imported,
    skipped: payload.length - imported,
  }
  writeMarker(markerOut)
  console.info(
    `[jobtrack-migration]迁移完成：导入 ${markerOut.imported} 条，幂等跳过 ${markerOut.skipped} 条，` +
    `未通过预检保留 ${markerOut.invalid} 条`,
  )

  if (legacy.invalidCount > 0) {
    return {
      done: true,
      finalList: serverAfter,
      notice: { kind: 'partially-invalid', imported: markerOut.imported, skipped: markerOut.skipped, invalidCount: legacy.invalidCount },
    }
  }
  return { done: true, finalList: serverAfter }
}

function noticeAndKeep(serverJobs: Job[], notice: MigrationNotice): MigrationOutcome {
  // 关键：旧键中的数据永不改动——notice 只用于呈现，函数本身从不写 LEGACY_KEY。
  return { done: notice.kind !== 'blocked', finalList: serverJobs, notice }
}
