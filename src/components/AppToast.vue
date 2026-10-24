<script setup lang="ts">
import { computed } from 'vue'
import type { UndoEntry } from '../composables/useUndoStack'
import type { ToastVariant } from '../composables/useToastController'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{
  variant: ToastVariant
  title: string
  description?: string
  undoEntry: UndoEntry | null
  remainingMs: number
  /** 撤销窗口剩余比例（0..1），由撤销栈推导。 */
  progress: number
  leaving?: boolean
}>()

const emit = defineEmits<{
  (e: 'undo'): void
  (e: 'close'): void
}>()

const { t } = useI18n()

const remainingSeconds = computed(() => Math.max(0, Math.ceil(props.remainingMs / 1000)))

const undoLabel = computed(() => {
  const entry = props.undoEntry
  if (!entry) return ''
  return entry.type === 'delete'
    ? t('toastUndoDelete', { company: entry.job.company })
    : t('toastUndoAdd', { company: entry.job.company })
})

const role = computed(() => (props.variant === 'error' ? 'alert' : 'status'))
const live = computed(() => (props.variant === 'error' ? 'assertive' : 'polite'))

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
        <svg v-else-if="variant === 'exported'" viewBox="0 0 24 24" focusable="false">
          <path
            d="M12 4.2v8.6M8.2 9.2L12 13l3.8-3.8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M4.8 15v2.2a1.6 1.6 0 001.6 1.6h11.2a1.6 1.6 0 001.6-1.6V15"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
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
          {{ t('toastCountdown', { seconds: remainingSeconds }) }}
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
          {{ t('toastUndo') }}
        </button>
        <button
          type="button"
          class="toast-close"
          :aria-label="t('toastClose')"
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
