import type { CSSProperties } from 'vue'

export type JobStatus = 'applied' | 'interviewing' | 'offer' | 'rejected'

export interface Job {
  id: string
  company: string
  position: string
  appliedDate: string
  status: JobStatus
  notes: string
}

/** 表单提交的五字段载荷（不含 id；id 一律由服务端生成）。 */
export interface JobInput {
  company: string
  position: string
  appliedDate: string
  status: JobStatus
  notes: string
}

/**
 * 服务端删除快照（设计文档 §4.2）：DELETE 成功（200）返回的完整记录，
 * 共 9 个字段：id + 五个业务字段 + sortOrder + createdAt + updatedAt。
 */
export interface DeletedJobSnapshot extends Job {
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** 恢复结果形态（设计文档 §4.3）：原槽位恢复或降级追加。 */
export type RestoredAs = 'original' | 'appended'

/**
 * 恢复成功响应（设计文档 §4.3）：恰好 8 个字段
 * （id + 五个业务字段 + sortOrder + restoredAs），**不含** createdAt/updatedAt。
 * 与 DELETE 快照（9 字段、含时间戳）是不同的契约形态，运行时校验各自独立。
 */
export interface RestoredJobData extends Job {
  sortOrder: number
  restoredAs: RestoredAs
}

export const STATUS_ORDER: JobStatus[] = ['applied', 'interviewing', 'offer', 'rejected']

export const STATUS_LABELS: Record<JobStatus, string> = {
  applied: '待回复',
  interviewing: '面试中',
  offer: '录取',
  rejected: '已拒绝',
}

/**
 * 状态颜色的唯一来源：图表（及详情等需要主色的场景）使用主色，
 * Badge 使用同一色系的浅色背景 + 深色文字。组件内不得再硬编码状态颜色。
 * 待回复=蓝 面试中=橙 已录用=绿 已拒绝=红。
 */
export const STATUS_COLORS: Record<JobStatus, string> = {
  applied: '#2563eb',
  interviewing: '#ea580c',
  offer: '#16a34a',
  rejected: '#dc2626',
}

/** Badge 内联样式形状，兼容 Vue 的 style 绑定类型。 */
export type StatusBadgeStyle = Pick<
  CSSProperties,
  'backgroundColor' | 'color' | 'borderColor'
>

/** Badge 浅色配色，与 STATUS_COLORS 同色系（文字对比度 ≥ WCAG AA）。 */
export const STATUS_BADGE_STYLES: Record<JobStatus, StatusBadgeStyle> = {
  applied: { backgroundColor: '#dbeafe', color: '#1d4ed8', borderColor: '#bfdbfe' },
  interviewing: { backgroundColor: '#ffedd5', color: '#c2410c', borderColor: '#fed7aa' },
  offer: { backgroundColor: '#dcfce7', color: '#15803d', borderColor: '#bbf7d0' },
  rejected: { backgroundColor: '#fee2e2', color: '#b91c1c', borderColor: '#fecaca' },
}

/** Badge / 图表共用的样式入口。 */
export function statusBadgeStyle(status: JobStatus): StatusBadgeStyle {
  return STATUS_BADGE_STYLES[status]
}

/** 记录列表的排序方式，按投递日期。 */
export type SortOrder = 'date-desc' | 'date-asc'

export const SORT_LABELS: Record<SortOrder, string> = {
  'date-desc': '投递日期（新 → 旧）',
  'date-asc': '投递日期（旧 → 新）',
}

/** 组合式查询状态。绝不回写到存储。 */
export interface JobFilters {
  keyword: string
  status: JobStatus | 'all'
  dateFrom: string
  dateTo: string
  sortOrder: SortOrder
}

export const DEFAULT_FILTERS: JobFilters = {
  keyword: '',
  status: 'all',
  dateFrom: '',
  dateTo: '',
  sortOrder: 'date-desc',
}
