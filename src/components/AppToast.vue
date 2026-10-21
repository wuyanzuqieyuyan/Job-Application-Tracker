<script setup lang="ts">
import { computed } from 'vue'
import type { UndoEntry } from '../composables/useUndoStack'

/** Semantic variant of a toast; drives the icon, colour and a11y semantics. */
export type ToastVariant = 'added' | 'deleted' | 'edited' | 'undone' | 'error'

const props = defineProps<{
  variant: ToastVariant
  title: string
  description?: string
  undoEntry: UndoEntry | null
  remainingMs: number
  /** 0..1 remaining share of the undo window, derived from the undo stack. */
  progress: number
  leaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'undo'): void
  (e: 'close'): void
}>()

const isError = computed(() => props.variant === 'error')

const role = computed(() => (isError.value ? 'alert' : 'status'))
const live = computed(() => (isError.value ? 'assertive' : 'polite'))

const remainingSeconds = computed(() => Math.max(0, Math.ceil(props.remainingMs / 1000)))

const undoLabel = computed(() => {
  const entry = props.undoEntry
  if (!entry) return ''
  return entry.type === 'delete'
    ? `撤销删除「${entry.job.company}」`
    : `撤销新增「${entry.job.company}」`
})

const progressWidth = computed(() => {
  const ratio = Math.max(0, Math.min(1, props.progress))
  return `${(ratio * 100).toFixed(2)}%`
})
</script>

<template>
  <div class="toast-wrap">
    <div
      class="toast"
      :class="[`toast-${variant}`, { 'is-leaving': leaving }]"
      :role="role"
      :aria-live="live"
      aria-atomic="true"
    >
      <span class="toast-icon" aria-hidden="true">
        <svg v-if="variant === 'added'" viewBox="0 0 24 24" focusable="false">
          <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path
            d="M8.2 12.2l2.6 2.6 5-5.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else-if="variant === 'deleted'" viewBox="0 0 24 24" focusable="false">
          <path
            d="M4.6 6.6h14.8M9.6 6.6V5.2a1.4 1.4 0 011.4-1.4h2a1.4 1.4 0 011.4 1.4v1.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
          <path
            d="M6.6 6.6l.7 12a1.8 1.8 0 001.8 1.7h5.8a1.8 1.8 0 001.8-1.7l.7-12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M10.4 10.2v6M13.6 10.2v6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <svg v-else-if="variant === 'edited'" viewBox="0 0 24 24" focusable="false">
          <path
            d="M4.4 19.6l.8-3.6L15.5 5.7a1.7 1.7 0 012.4 0l.4.4a1.7 1.7 0 010 2.4L8 19l-3.6.6z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linejoin="round"
          />
          <path d="M14.2 7l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <svg v-else-if="variant === 'undone'" viewBox="0 0 24 24" focusable="false">
          <path
            d="M4.6 9.4h9.6a5.4 5.4 0 010 10.8H8.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M8.4 5.2L4 9.4l4.4 4.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" focusable="false">
          <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M12 7.6v5.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
          <circle cx="12" cy="16.1" r="1.1" fill="currentColor" />
        </svg>
      </span>

      <div class="toast-content">
        <p class="toast-title">{{ title }}</p>
        <p v-if="description" class="toast-desc">{{ description }}</p>
        <p v-if="undoEntry" class="toast-desc toast-countdown">
          剩余 {{ remainingSeconds }} 秒可撤销
        </p>
      </div>

      <div class="toast-actions">
        <button
          v-if="undoEntry && !leaving"
          type="button"
          class="toast-action"
          :title="undoLabel"
          :aria-label="undoLabel"
          @click="emit('undo')"
        >
          撤销
        </button>
        <button
          type="button"
          class="toast-close"
          aria-label="关闭提示"
          @click="emit('close')"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              d="M5.5 5.5l9 9M14.5 5.5l-9 9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <span v-if="undoEntry" class="toast-progress" aria-hidden="true">
        <span class="toast-progress-bar" :style="{ width: progressWidth }"></span>
      </span>
    </div>
  </div>
</template>
