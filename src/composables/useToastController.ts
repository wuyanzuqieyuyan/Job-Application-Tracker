import { computed, onBeforeUnmount, ref } from 'vue'
import type { UndoEntry } from './useUndoStack'
import { UNDO_WINDOW_MS } from './useUndoStack'

export type ToastVariant = 'added' | 'deleted' | 'edited' | 'undone' | 'exported' | 'error'

export interface ToastView {
  variant: ToastVariant
  title: string
  description: string
  /** 该提示可以撤销的条目 id，普通提示为 null。 */
  undoId: string | null
}

const TOAST_EXIT_MS = 180
const TOAST_DEFAULT_MS = 3000

type UndoStack = ReturnType<typeof import('./useUndoStack').useUndoStack>

/**
 * Toast 生命周期与撤销栈的绑定关系。
 * 提示内容由调用方决定，这里只负责显示时长、退出动画与可撤销条目。
 */
export function useToastController(undoStack: UndoStack) {
  const toast = ref<ToastView | null>(null)
  const toastLeaving = ref(false)
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const undoRemainingMs = computed(() => undoStack.remainingMs.value)

  /** 撤销窗口剩余比例，直接来自撤销栈自己的时钟。 */
  const undoProgress = computed(() => {
    if (!undoStack.topEntry.value) return 0
    const ratio = undoStack.remainingMs.value / UNDO_WINDOW_MS
    return Math.max(0, Math.min(1, ratio))
  })

  /**
   * 当前提示可以撤销的条目。
   * 普通成功提示即使存在更早的待撤销操作，也不会显示撤销按钮。
   */
  const toastUndoEntry = computed<UndoEntry | null>(() => {
    const id = toast.value?.undoId
    if (!id) return null
    const top = undoStack.topEntry.value
    return top && top.id === id ? top : null
  })

  function clearTimer() {
    if (toastTimer !== undefined) {
      clearTimeout(toastTimer)
      toastTimer = undefined
    }
  }

  /** 关闭提示并播放退出动画。 */
  function hideToast() {
    if (!toast.value || toastLeaving.value) return
    clearTimer()
    toastLeaving.value = true
    toastTimer = setTimeout(() => {
      toast.value = null
      toastLeaving.value = false
    }, TOAST_EXIT_MS)
  }

  /**
   * 显示提示。错误提示不自动消失，需要用户主动关闭。
   * @param undoEntry 需要关联的撤销条目（可撤销操作传入）
   */
  function showToast(
    variant: ToastVariant,
    title: string,
    description = '',
    durationMs?: number,
    undoEntry?: UndoEntry,
  ) {
    toast.value = {
      variant,
      title,
      description,
      undoId: undoEntry ? undoEntry.id : null,
    }
    toastLeaving.value = false
    clearTimer()
    if (variant === 'error') return
    toastTimer = setTimeout(hideToast, durationMs ?? TOAST_DEFAULT_MS)
  }

  onBeforeUnmount(clearTimer)

  return {
    undoStack,
    toast,
    toastLeaving,
    toastUndoEntry,
    undoRemainingMs,
    undoProgress,
    showToast,
    hideToast,
  }
}
