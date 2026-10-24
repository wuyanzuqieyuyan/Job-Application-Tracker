import { computed, onBeforeUnmount, ref } from 'vue'
import type { DeletedJobSnapshot, Job } from '../types'

export type UndoType = 'add' | 'delete'

export interface UndoEntry {
  id: string
  type: UndoType
  job: Job
  /** 只要仍然有效（未过期、未被明确放弃）就用于重试/重放的恢复信息。 */
  snapshot?: DeletedJobSnapshot
  index: number
  createdAt: number
  expiresAt: number
}

export const UNDO_WINDOW_MS = 5000

function createEntryId(): string {
  return `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 可撤销操作的 LIFO 栈。
 *
 * 每个条目都携带自己的绝对过期时间 `expiresAt`，因此压入新条目绝不会延长
 * 旧条目的有效期。过期判定始终依据墙钟（`Date.now() >= expiresAt`），
 * 而不取决于定时器是否恰好准时触发。
 */
export function useUndoStack(undoWindowMs: number = UNDO_WINDOW_MS) {
  const entries = ref<UndoEntry[]>([])
  const now = ref(Date.now())
  // 恢复请求进行中的条目 id：过期剪枝必须放行（见文件尾部扩展说明）。
  const inFlight = new Set<string>()

  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined

  function pruneExpired(): boolean {
    const t = Date.now()
    const kept = entries.value.filter((entry) => entry.expiresAt > t || inFlight.has(entry.id))
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
    const t = Date.now()
    const nextExpiry = Math.min(...entries.value.map((entry) => entry.expiresAt))
    // 全部待过期条目都在恢复进行中时改用固定 250ms 轮询，避免对已过期条目的 0ms 忙转。
    const held = entries.value.some((entry) => entry.expiresAt <= t && inFlight.has(entry.id))
    const delay = held ? 250 : Math.max(0, nextExpiry - t) + 5
    expiryTimer = setTimeout(
      () => {
        expiryTimer = undefined
        pruneExpired()
        scheduleExpiry()
        if (entries.value.length === 0) stopTicker()
      },
      delay,
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

  /**
   * 删除撤销专用：携带服务器原始 9 字段快照。
   * 有效期规则与通用 push 完全一致（后端确认成功后才开始计时，见 App 调用点）。
   */
  function pushDelete(snapshot: DeletedJobSnapshot, index: number): UndoEntry {
    const entry = push('delete', snapshot, index)
    entry.snapshot = snapshot
    return entry
  }

  /** 撤销成功后出栈指定条目（不做 LIFO 弹出，供异步流程按 id 清理）。 */
  function removeById(entryId: string): boolean {
    const before = entries.value.length
    entries.value = entries.value.filter((entry) => entry.id !== entryId)
    if (entries.value.length === before) return false
    if (entries.value.length === 0) stopTicker()
    else scheduleExpiry()
    return true
  }

  /**
   * 结果不确定时把 take() 弹出的原条目原样放回栈尾：
   * 保持原 expiresAt（不续命、不复活——若窗口已过，剪枝/下次轮询会自然处置），
   * 并正确重建计时器与轮询（这是不能手写 entries 赋值的原因：定时器状态会泄漏）。
   */
  function reinsert(entry: UndoEntry): void {
    entries.value = [...entries.value, entry]
    startTicker()
    scheduleExpiry()
  }

  /** 恢复请求开始/结束：进行中的条目不会被过期剪枝删除，结果确定后释放（不复活过期条目）。 */
  function markInFlight(entryId: string): void {
    inFlight.add(entryId)
  }

  function clearInFlight(entryId: string): void {
    inFlight.delete(entryId)
  }

  /** 最新一条仍有效的条目（已过期的旧条目会先被剔除）。 */
  function top(): UndoEntry | null {
    pruneExpired()
    return entries.value.length > 0 ? entries.value[entries.value.length - 1] : null
  }

  /** 弹出最新一条仍有效的条目（LIFO）。 */
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

  return {
    entries,
    push,
    pushDelete,
    removeById,
    reinsert,
    markInFlight,
    clearInFlight,
    top,
    take,
    clear,
    topEntry,
    remainingMs,
    pruneExpired,
  }
}
