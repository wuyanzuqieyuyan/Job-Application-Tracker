import { computed, onBeforeUnmount, ref } from 'vue'
import type { Job } from '../types'

export type UndoType = 'add' | 'delete'

export interface UndoEntry {
  id: string
  type: UndoType
  job: Job
  index: number
  createdAt: number
  expiresAt: number
}

export const UNDO_WINDOW_MS = 5000

function createEntryId(): string {
  return `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * LIFO stack of undoable operations.
 *
 * Every entry carries its own absolute `expiresAt`, so pushing a new entry
 * never extends the lifetime of older ones. Expiry is always judged against
 * the wall clock (`Date.now() >= expiresAt`), never against whether a timer
 * happened to fire on time.
 */
export function useUndoStack(undoWindowMs: number = UNDO_WINDOW_MS) {
  const entries = ref<UndoEntry[]>([])
  const now = ref(Date.now())

  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined

  function pruneExpired(): boolean {
    const t = Date.now()
    const kept = entries.value.filter((entry) => entry.expiresAt > t)
    if (kept.length === entries.value.length) return false
    entries.value = kept
    return true
  }

  function scheduleExpiry() {
    if (expiryTimer !== undefined) {
      clearTimeout(expiryTimer)
      expiryTimer = undefined
    }
    if (entries.value.length === 0) return
    const nextExpiry = Math.min(...entries.value.map((entry) => entry.expiresAt))
    const delay = Math.max(0, nextExpiry - Date.now())
    expiryTimer = setTimeout(
      () => {
        expiryTimer = undefined
        pruneExpired()
        scheduleExpiry()
        if (entries.value.length === 0) stopTicker()
      },
      delay + 5,
    )
  }

  function startTicker() {
    if (tickTimer !== undefined) return
    tickTimer = setInterval(() => {
      now.value = Date.now()
      if (pruneExpired()) {
        scheduleExpiry()
        if (entries.value.length === 0) stopTicker()
      }
    }, 250)
  }

  function stopTicker() {
    if (tickTimer === undefined) return
    clearInterval(tickTimer)
    tickTimer = undefined
  }

  function push(type: UndoType, job: Job, index: number): UndoEntry {
    const createdAt = Date.now()
    const entry: UndoEntry = {
      id: createEntryId(),
      type,
      job: { ...job },
      index,
      createdAt,
      expiresAt: createdAt + undoWindowMs,
    }
    entries.value = [...entries.value, entry]
    startTicker()
    scheduleExpiry()
    return entry
  }

  /** Latest still-valid entry (older expired ones are dropped first). */
  function top(): UndoEntry | null {
    pruneExpired()
    return entries.value.length > 0 ? entries.value[entries.value.length - 1] : null
  }

  /** Pops the latest still-valid entry (LIFO). */
  function take(): UndoEntry | null {
    pruneExpired()
    if (entries.value.length === 0) return null
    const entry = entries.value[entries.value.length - 1]
    entries.value = entries.value.slice(0, -1)
    if (entries.value.length === 0) stopTicker()
    else scheduleExpiry()
    return entry
  }

  function clear() {
    entries.value = []
    if (expiryTimer !== undefined) {
      clearTimeout(expiryTimer)
      expiryTimer = undefined
    }
    stopTicker()
  }

  const topEntry = computed(() => {
    const t = now.value
    for (let i = entries.value.length - 1; i >= 0; i--) {
      if (entries.value[i].expiresAt > t) return entries.value[i]
    }
    return null
  })

  const remainingMs = computed(() => {
    const entry = topEntry.value
    return entry ? Math.max(0, entry.expiresAt - now.value) : 0
  })

  onBeforeUnmount(() => {
    if (expiryTimer !== undefined) clearTimeout(expiryTimer)
    expiryTimer = undefined
    stopTicker()
  })

  return { entries, push, top, take, clear, topEntry, remainingMs, pruneExpired }
}
