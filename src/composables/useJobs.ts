import { computed, reactive, ref, watch } from 'vue'
import type { Job, JobStatus } from '../types'

const STORAGE_KEY = 'jobtrack.jobs.v1'

function sampleJobs(): Job[] {
  return [
    {
      id: 'sample-1',
      company: '示例科技（虚构）',
      position: '前端工程师',
      appliedDate: '2026-09-01',
      status: 'interviewing',
      notes: '已完成一面，等待二面通知。',
    },
    {
      id: 'sample-2',
      company: '虚构云图网络',
      position: 'Vue 开发',
      appliedDate: '2026-09-10',
      status: 'applied',
      notes: '已投递，等待 HR 回复。',
    },
    {
      id: 'sample-3',
      company: '想象数据公司',
      position: 'Web 前端',
      appliedDate: '2026-08-20',
      status: 'offer',
      notes: '已收到 offer，正在考虑。',
    },
    {
      id: 'sample-4',
      company: '示例视界工作室',
      position: '初级前端',
      appliedDate: '2026-08-05',
      status: 'rejected',
      notes: '岗位已招满。',
    },
  ]
}

function isValidJob(value: unknown): value is Job {
  if (typeof value !== 'object' || value === null) return false
  const j = value as Record<string, unknown>
  return (
    typeof j.id === 'string' &&
    typeof j.company === 'string' &&
    typeof j.position === 'string' &&
    typeof j.appliedDate === 'string' &&
    (j.status === 'applied' ||
      j.status === 'interviewing' ||
      j.status === 'offer' ||
      j.status === 'rejected') &&
    typeof j.notes === 'string'
  )
}

function loadJobs(): Job[] {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) {
    const seeded = sampleJobs()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidJob)
    }
  } catch {
    // ignore corrupted storage and fall through to empty list
  }
  return []
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const jobs = ref<Job[]>(loadJobs())

watch(
  jobs,
  (value) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  },
  { deep: true },
)

const searchTerm = ref('')
const statusFilter = ref<JobStatus | 'all'>('all')

const filteredJobs = computed(() => {
  const term = searchTerm.value.trim().toLowerCase()
  return jobs.value.filter((job) => {
    const matchesStatus = statusFilter.value === 'all' || job.status === statusFilter.value
    const matchesCompany = term === '' || job.company.toLowerCase().includes(term)
    return matchesStatus && matchesCompany
  })
})

const stats = computed(() => {
  const list = jobs.value
  return {
    total: list.length,
    applied: list.filter((j) => j.status === 'applied').length,
    interviewing: list.filter((j) => j.status === 'interviewing').length,
    offer: list.filter((j) => j.status === 'offer').length,
  }
})

export interface JobFormInput {
  company: string
  position: string
  appliedDate: string
  status: JobStatus
  notes: string
}

/** A removed record together with the position it occupied. */
export interface RemovedJob {
  job: Job
  index: number
}

function sameJob(a: Job, b: Job): boolean {
  return (
    a.company === b.company &&
    a.position === b.position &&
    a.appliedDate === b.appliedDate &&
    a.status === b.status &&
    a.notes === b.notes
  )
}

export function useJobs() {
  const lastDeleted = reactive<{ id: string | null }>({ id: null })

  /** Adds a record and returns it, so callers can build an undo entry. */
  function addJob(input: JobFormInput): Job {
    const job: Job = {
      id: createId(),
      ...input,
      company: input.company.trim(),
      position: input.position.trim(),
    }
    jobs.value = [...jobs.value, job]
    return job
  }

  function updateJob(id: string, input: JobFormInput) {
    jobs.value = jobs.value.map((job) =>
      job.id === id
        ? { ...job, ...input, company: input.company.trim(), position: input.position.trim() }
        : job,
    )
  }

  /** Removes a record and returns a snapshot of it (for undo). */
  function deleteJob(id: string): RemovedJob | null {
    const index = jobs.value.findIndex((job) => job.id === id)
    if (index < 0) return null
    const job = jobs.value[index]
    jobs.value = jobs.value.filter((item) => item.id !== id)
    lastDeleted.id = id
    return { job: { ...job }, index }
  }

  /** Puts a removed record back at its original position. */
  function restoreJob(removed: RemovedJob): boolean {
    if (jobs.value.some((job) => job.id === removed.job.id)) return false
    const next = [...jobs.value]
    const index = Math.min(Math.max(removed.index, 0), next.length)
    next.splice(index, 0, { ...removed.job })
    jobs.value = next
    return true
  }

  /**
   * Removes a record added earlier. When `expected` is given the record is
   * only removed if it still matches that snapshot, so an undo can never
   * discard edits made after the operation was recorded.
   */
  function removeJobById(id: string, expected?: Job): boolean {
    const current = jobs.value.find((job) => job.id === id)
    if (!current) return false
    if (expected && !sameJob(current, expected)) return false
    jobs.value = jobs.value.filter((job) => job.id !== id)
    return true
  }

  function reset() {
    jobs.value = []
    searchTerm.value = ''
    statusFilter.value = 'all'
  }

  return {
    jobs,
    filteredJobs,
    searchTerm,
    statusFilter,
    stats,
    addJob,
    updateJob,
    deleteJob,
    restoreJob,
    removeJobById,
    reset,
  }
}
