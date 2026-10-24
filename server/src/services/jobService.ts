import type {
  DeletedJobSnapshot,
  Job,
  JobInput,
  JobStatus,
  RestoredJobData,
  RestoredRecordInput,
} from '../types.js'
import { JOB_STATUSES } from '../types.js'
import { jobRepository } from '../repositories/jobRepository.js'
import { AppError } from '../errors.js'

export { AppError }

const MAX_COMPANY = 50
const MAX_POSITION = 50
const MAX_NOTES = 200

/**
 * 导入接口允许保留历史 id（localStorage 迁移）。
 * 兼容历史格式：`sample-1`、`job-1727xxxxx-ab12x3`（前端回退格式）以及 UUID。
 * 规则：1-64 个字符，首字符为字母或数字，其余可为字母/数字/._~:-
 */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,63}$/

function isFutureDate(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr + 'T00:00:00')
  return d > today
}

/**
 * 快照时间戳格式：与 `new Date().toISOString()` 一致（毫秒精度 + 'Z'），
 * 约定来源为服务端写库时刻；恢复请求中的时间戳格式非法 → 400 invalid_request。
 */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function validateJobInput(input: unknown): JobInput {
  if (typeof input !== 'object' || input === null) {
    throw new AppError(400, 'invalid_request', '请求体必须是 JSON 对象')
  }
  const obj = input as Record<string, unknown>

  const company = obj.company
  const position = obj.position
  const appliedDate = obj.appliedDate
  const status = obj.status
  const notes = obj.notes

  if (typeof company !== 'string' || company.trim() === '') {
    throw new AppError(400, 'invalid_company', '公司名称为必填项')
  }
  if (company.trim().length > MAX_COMPANY) {
    throw new AppError(400, 'invalid_company', `公司名称最多 ${MAX_COMPANY} 个字符`)
  }
  if (typeof position !== 'string' || position.trim() === '') {
    throw new AppError(400, 'invalid_position', '岗位名称为必填项')
  }
  if (position.trim().length > MAX_POSITION) {
    throw new AppError(400, 'invalid_position', `岗位名称最多 ${MAX_POSITION} 个字符`)
  }
  if (typeof appliedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(appliedDate)) {
    throw new AppError(400, 'invalid_applied_date', '申请日期格式应为 YYYY-MM-DD')
  }
  if (Number.isNaN(Date.parse(appliedDate))) {
    throw new AppError(400, 'invalid_applied_date', '申请日期无效')
  }
  if (isFutureDate(appliedDate)) {
    throw new AppError(400, 'invalid_applied_date', '申请日期不能是未来日期')
  }
  if (typeof status !== 'string' || !(JOB_STATUSES as string[]).includes(status)) {
    throw new AppError(400, 'invalid_status', '申请状态不合法')
  }
  const validStatus = status as JobStatus
  if (typeof notes !== 'string') {
    throw new AppError(400, 'invalid_notes', '备注必须是字符串')
  }
  if (notes.length > MAX_NOTES) {
    throw new AppError(400, 'invalid_notes', `备注最多 ${MAX_NOTES} 个字符`)
  }

  return {
    company: company.trim(),
    position: position.trim(),
    appliedDate,
    status: validStatus,
    notes: notes.trim(),
  }
}

export const jobService = {
  listJobs(): Job[] {
    return jobRepository.findAll()
  },

  getJob(id: string): Job {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new AppError(404, 'job_not_found', '记录不存在')
    }
    const job = jobRepository.findById(id.trim())
    if (!job) throw new AppError(404, 'job_not_found', '记录不存在')
    return job
  },

  createJob(input: unknown): Job {
    const validated = validateJobInput(input)
    return jobRepository.create(validated)
  },

  updateJob(id: string, input: unknown): Job {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new AppError(404, 'job_not_found', '记录不存在')
    }
    const validated = validateJobInput(input)
    const job = jobRepository.update(id.trim(), validated)
    if (!job) throw new AppError(404, 'job_not_found', '记录不存在')
    return job
  },

  /**
     * 删除并返回完整快照：成功 200 { data: snapshot }；
   * 记录不存在 → 404（非幂等：重复删除第二次即 404）。
   */
  deleteJob(id: string): DeletedJobSnapshot {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new AppError(404, 'job_not_found', '记录不存在')
    }
    const snapshot = jobRepository.delete(id.trim())
    if (!snapshot) throw new AppError(404, 'job_not_found', '记录不存在')
    return snapshot
  },

  importJobs(payload: unknown): Job[] {
    if (!Array.isArray(payload)) {
      throw new AppError(400, 'invalid_request', '导入数据必须是数组')
    }
    const items = payload.map(validateImportItem)
    return jobRepository.bulkImport(items)
  },

  /**
   * 撤销恢复：按 DELETE 200 返回的 9 字段快照恢复记录。
   * 客户端提交的 record 一律经校验归一后才写库：
   * - record 必须是对象，id 必填且满足 CLIENT_ID_PATTERN；
   * - 五业务字段走与创建同一套 validateJobInput（额外未知字段与既有一致地被忽略）；
   * - sortOrder 必须为 ≥1 的安全整数；createdAt/updatedAt 必须为服务端 ISO 时间戳格式；
   * - 时间戳/sortOrder 非法 → 400 invalid_request（见 §4.3 错误清单）。
   * 业务规则由 repository.restore 在单事务内执行：id 冲突 409 不覆盖；
   * 原槽位空闲恢复原位不消耗计数器；原槽位被占从计数器追加并推进。
   */
  restoreJob(payload: unknown): RestoredJobData {
    if (typeof payload !== 'object' || payload === null) {
      throw new AppError(400, 'invalid_request', '请求体必须是 JSON 对象')
    }
    const wrapper = payload as Record<string, unknown>
    if (wrapper.record === undefined) {
      throw new AppError(400, 'invalid_request', '请求体必须包含 record 字段')
    }
    const record = validateRestoreRecord(wrapper.record)
    return jobRepository.restore(record)
  },
}

export interface ImportItem {
  /** 历史记录 id；缺省时由服务端生成新 UUID。 */
  id?: string
  input: JobInput
}

/**
 * 校验单条导入项：允许携带历史 id（按 CLIENT_ID_PATTERN），
 * 内容字段规则与 createJob 一致。
 */
export function validateImportItem(item: unknown): ImportItem {
  if (typeof item !== 'object' || item === null) {
    throw new AppError(400, 'invalid_request', '导入项必须是 JSON 对象')
  }
  const obj = item as Record<string, unknown>

  let id: string | undefined
  if (obj.id !== undefined) {
    if (typeof obj.id !== 'string' || !CLIENT_ID_PATTERN.test(obj.id)) {
      throw new AppError(400, 'invalid_id', '导入 id 必须为 1-64 个字符，以字母或数字开头，仅限字母/数字/._~:-')
    }
    id = obj.id
  }

  return { id, input: validateJobInput(obj) }
}

/**
 * 校验并归一恢复快照记录（§4.3 流程 1-2）。额外未声明字段的处理策略与
 * 项目既有 API 一致：validateJobInput 只读取已知字段，未知字段被忽略。
 */
function validateRestoreRecord(record: unknown): RestoredRecordInput {
  if (typeof record !== 'object' || record === null) {
    throw new AppError(400, 'invalid_request', 'record 必须是 JSON 对象')
  }
  const obj = record as Record<string, unknown>

  if (typeof obj.id !== 'string' || !CLIENT_ID_PATTERN.test(obj.id)) {
    throw new AppError(400, 'invalid_id', '恢复 id 必须为 1-64 个字符，以字母或数字开头，仅限字母/数字/._~:-')
  }
  if (typeof obj.sortOrder !== 'number' || !Number.isSafeInteger(obj.sortOrder) || obj.sortOrder < 1) {
    throw new AppError(400, 'invalid_request', 'sortOrder 必须是不小于 1 的安全整数')
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    const value = obj[field]
    // 三道校验共享同一次解析：形状正则 + 可解析 + 规范回环。
    // 回环拦截"字段越界滚动"型非法日历日期（如 2026-02-30 会被 Date.parse 进位为 3 月 2 日），
    // 闰日正确性由 ISO 生成侧保证（非闰年的 02-29 规范化后必然不等于输入）。
    const parsed = typeof value === 'string' ? new Date(value) : null
    if (
      typeof value !== 'string' ||
      !TIMESTAMP_PATTERN.test(value) ||
      parsed === null ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString() !== value
    ) {
      throw new AppError(400, 'invalid_request', `${field} 必须是 ISO 8601 时间戳（如 2026-10-23T08:15:42.083Z）`)
    }
  }

  return {
    id: obj.id,
    input: validateJobInput(obj),
    sortOrder: obj.sortOrder,
    createdAt: obj.createdAt as string,
    updatedAt: obj.updatedAt as string,
  }
}
