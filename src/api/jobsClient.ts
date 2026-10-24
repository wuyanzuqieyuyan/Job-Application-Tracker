import type { DeletedJobSnapshot, Job, JobInput, JobStatus, RestoredJobData } from '../types'

/**
 * 前端统一 API 客户端（P2-D1）。
 *
 * 契约唯一依据是服务端源码（server/src/routes/jobs.ts、jobService.ts）与现有测试：
 * - 成功：`{ data: <载荷> }`；失败：`{ error: { code, message } }`。
 * - `POST /api/jobs/import` 的请求体是**裸数组**（每项 `{ id?, ...五字段 }`），返回 201 `{ data: Job[] }`，
 *   响应中不区分"新插入/幂等跳过"，条目级确认由调用方（迁移模块）在导入后重新拉取列表核对。
 * - 所有网络/解析/HTTP 错误都归一为 ApiError，绝不让后端异常伪装成空列表。
 */

const BASE = '/api/jobs'

const JOB_STATUSES: JobStatus[] = ['applied', 'interviewing', 'offer', 'rejected']

/** 归一化的前端 API 错误：可识别、可分类，不包含 SQL/路径/堆栈等内部信息。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** 底层请求：网络失败/JSON 解析失败都必须抛出可识别错误，不返回假数据。 */
async function request(path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'network_error', '无法连接服务器，请确认后端服务正在运行')
  }
  const text = await res.text()
  let body: unknown = undefined
  if (text.length > 0) {
    try {
      body = JSON.parse(text)
    } catch {
      throw new ApiError(res.status, 'bad_response', '服务器返回了无法解析的响应')
    }
  }
  return { status: res.status, body }
}

/** 从 `{ error: { code, message } }` 结构提取错误；缺失时给出兜底分类。 */
function toApiError(status: number, body: unknown): ApiError {
  const code = readString((body as Record<string, unknown> | null)?.error, 'code') ?? 'internal_error'
  // 服务端 message 可含受限中文描述；避免暴露技术细节的场景直接用兜底文案。
  const message = readString((body as Record<string, unknown> | null)?.error, 'message') ?? requestFallbackMessage(status)
  return new ApiError(status, code, message)
}

function requestFallbackMessage(status: number): string {
  if (status === 0) return '网络不可用'
  if (status >= 500) return '服务器暂时不可用，请稍后重试'
  return '请求被服务器拒绝'
}

function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function expectEnvelope(status: number, body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) {
    throw new ApiError(status, 'bad_response', '服务器响应结构不符合约定')
  }
  const envelope = body as Record<string, unknown>
  if (envelope.error !== undefined) throw toApiError(status, body)
  if (envelope.data !== undefined) return envelope
  throw new ApiError(status, 'bad_response', '服务器响应缺少 data 字段')
}

/** 运行时校验：后端返回的五字段记录（对齐项目 Job 类型），不满足即抛 bad_response。 */
export function isValidJobRecord(value: unknown): value is Job {
  if (typeof value !== 'object' || value === null) return false
  const j = value as Record<string, unknown>
  return (
    typeof j.id === 'string' &&
    typeof j.company === 'string' &&
    typeof j.position === 'string' &&
    typeof j.appliedDate === 'string' &&
    (JOB_STATUSES as string[]).includes(j.status as JobStatus) &&
    typeof j.notes === 'string'
  )
}

/** 运行时校验：9 字段删除快照（id + 五业务 + sortOrder + createdAt + updatedAt，v2.1 §4.2）。 */
export function isValidSnapshotRecord(value: unknown): value is DeletedJobSnapshot {
  if (!isValidJobRecord(value)) return false
  const s = value as unknown as Record<string, unknown>
  return (
    typeof s.sortOrder === 'number' &&
    Number.isSafeInteger(s.sortOrder) &&
    typeof s.createdAt === 'string' &&
    typeof s.updatedAt === 'string'
  )
}

function unwrapJobs(status: number, body: unknown): Job[] {
  const data = expectEnvelope(status, body).data
  if (!Array.isArray(data) || !data.every(isValidJobRecord)) {
    throw new ApiError(status, 'bad_response', '服务器返回的记录列表格式不正确')
  }
  return data as Job[]
}

function unwrapJob(status: number, body: unknown): Job {
  const data = expectEnvelope(status, body).data
  if (!isValidJobRecord(data)) {
    throw new ApiError(status, 'bad_response', '服务器返回的记录格式不正确')
  }
  return data
}

const jsonInit = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})

export async function listJobs(): Promise<Job[]> {
  const { status, body } = await request(BASE, { method: 'GET' })
  if (status !== 200) throw toApiError(status, body)
  return unwrapJobs(status, body)
}

export async function getJob(id: string): Promise<Job> {
  const { status, body } = await request(`${BASE}/${encodeURIComponent(id)}`, { method: 'GET' })
  if (status !== 200) throw toApiError(status, body)
  return unwrapJob(status, body)
}

export async function createJob(input: JobInput): Promise<Job> {
  const { status, body } = await request(BASE, jsonInit('POST', input))
  if (status !== 201) throw toApiError(status, body)
  return unwrapJob(status, body)
}

export async function updateJob(id: string, input: JobInput): Promise<Job> {
  const { status, body } = await request(`${BASE}/${encodeURIComponent(id)}`, jsonInit('PUT', input))
  if (status !== 200) throw toApiError(status, body)
  return unwrapJob(status, body)
}

/**
 * 删除：200 → 完整 9 字段快照（供 P2-D2 撤销恢复使用）。
 * 404 → 抛 ApiError('job_not_found')，由调用方决定如何呈现。
 */
export async function deleteJob(id: string): Promise<DeletedJobSnapshot> {
  const { status, body } = await request(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (status !== 200) throw toApiError(status, body)
  const data = expectEnvelope(status, body).data
  if (!isValidSnapshotRecord(data)) {
    throw new ApiError(status, 'bad_response', '服务器返回的删除快照格式不正确')
  }
  return data
}

/** 批量导入：请求体为裸数组，任一项非法/冲突时整批失败（服务端原子性）。 */
export async function importJobs(items: ImportItemPayload[]): Promise<Job[]> {
  const { status, body } = await request(`${BASE}/import`, jsonInit('POST', items))
  if (status !== 201) throw toApiError(status, body)
  return unwrapJobs(status, body)
}

/** 导入项：id 可选（保留历史身份），五字段同创建规则。 */
export interface ImportItemPayload extends JobInput {
  id?: string
}

/** 恢复响应运行时校验：恰好 8 字段（id+五业务+sortOrder+restoredAs），restoredAs 只能为 original/appended。 */
export function isValidRestoredRecord(value: unknown): value is RestoredJobData {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    isValidJobRecord(r) &&
    typeof r.sortOrder === 'number' &&
    Number.isSafeInteger(r.sortOrder) &&
    (r.restoredAs === 'original' || r.restoredAs === 'appended')
  )
}

/**
 * 撤销恢复（设计文档 v2.1 §4.3）：请求体 `{ record: snapshot }`（9 字段原始快照，含时间戳）。
 * 201 → 运行时校验 8 字段响应（restoredAs 枚举）后返回；409 → 抛 ApiError('id_conflict') 由调用方核对。
 */
export async function restoreSnapshot(snapshot: DeletedJobSnapshot): Promise<RestoredJobData> {
  const { status, body } = await request(`${BASE}/restore`, jsonInit('POST', { record: snapshot }))
  if (status !== 201) throw toApiError(status, body)
  const data = expectEnvelope(status, body).data
  if (!isValidRestoredRecord(data)) {
    throw new ApiError(status, 'bad_response', '服务器返回的恢复结果格式不正确')
  }
  return data
}
