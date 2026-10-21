export type JobStatus = 'applied' | 'interviewing' | 'offer' | 'rejected'

export interface Job {
  id: string
  company: string
  position: string
  appliedDate: string
  status: JobStatus
  notes: string
}

export const STATUS_ORDER: JobStatus[] = ['applied', 'interviewing', 'offer', 'rejected']

export const STATUS_LABELS: Record<JobStatus, string> = {
  applied: '待回复',
  interviewing: '面试中',
  offer: '录取',
  rejected: '已拒绝',
}

/** Chart colours, kept in sync with the status badge palette. */
export const STATUS_COLORS: Record<JobStatus, string> = {
  applied: '#2563eb',
  interviewing: '#d97706',
  offer: '#16a34a',
  rejected: '#94a3b8',
}

/** Sort order for the record list, by application date. */
export type SortOrder = 'date-desc' | 'date-asc'

export const SORT_LABELS: Record<SortOrder, string> = {
  'date-desc': '投递日期（新 → 旧）',
  'date-asc': '投递日期（旧 → 新）',
}

/** Composable query state. Never written back to storage. */
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
