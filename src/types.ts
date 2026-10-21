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
