/**
 * 后端 Job 数据模型。与前端 src/types.ts 的 Job 保持兼容：
 * id / company / position / appliedDate / status / notes。
 * 数据库列使用 snake_case，在 repository 层映射为 camelCase。
 */
export type JobStatus = 'applied' | 'interviewing' | 'offer' | 'rejected'

export interface Job {
  id: string
  company: string
  position: string
  appliedDate: string
  status: JobStatus
  notes: string
}

export interface JobInput {
  company: string
  position: string
  appliedDate: string
  status: JobStatus
  notes: string
}

/**
 * 删除快照（设计文档 v2.1 §4.2）：DELETE 成功（200）返回的完整记录，
 * 共 9 个字段（id + 五业务字段 + sortOrder + createdAt + updatedAt），
 * 作为未来撤销恢复 API 的数据基础。时间戳为删除时刻的原始值，恢复时原样保留。
 */
export interface DeletedJobSnapshot extends Job {
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 恢复结果形态（设计文档 v2.1 §4.3）：原槽位恢复或降级追加。 */
export type RestoredAs = 'original' | 'appended'

export interface RestoredJobData extends Job {
  sortOrder: number
  restoredAs: RestoredAs
}

/** 恢复接口经校验归一后的快照记录（service → repository 传递）。 */
export interface RestoredRecordInput {
  id: string
  input: JobInput
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export const JOB_STATUSES: JobStatus[] = ['applied', 'interviewing', 'offer', 'rejected']
