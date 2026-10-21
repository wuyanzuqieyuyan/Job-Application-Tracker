import { computed, reactive, ref, watch } from 'vue'
import type { Job, JobFilters, JobStatus } from '../types'
import { DEFAULT_FILTERS } from '../types'

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

const filters = ref<JobFilters>({ ...DEFAULT_FILTERS })

/** True when the chosen date range is contradictory (start after end). */
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
 * Query pipeline: keyword -> status -> date range -> sort.
 * Always works on a copy; the reactive source array is never mutated.
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
      // records with an unreadable date cannot be placed in a range
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
      // unreadable dates are always pushed to the end
      if (validA !== validB) return validA ? -1 : 1
      if (validA && timeA !== timeB) return (timeA - timeB) * direction
      // stable secondary rule: keep the original insertion order
      return a.index - b.index
    })
    .map((entry) => entry.job)
})

/** Record count per status. Single source of truth for the statistics. */
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
    clearFilters()
  }

  /** Applies a partial filter change. */
  function patchFilters(patch: Partial<JobFilters>) {
    filters.value = { ...filters.value, ...patch }
  }

  /** Restores the default filters and the default sort order. */
  function clearFilters() {
    filters.value = { ...DEFAULT_FILTERS }
  }

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
    addJob,
    updateJob,
    deleteJob,
    restoreJob,
    removeJobById,
    reset,
  }
}
