<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Job } from '../types'
import { statusBadgeStyle } from '../types'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{
  open: boolean
  job: Job | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit', job: Job): void
  (e: 'remove', job: Job): void
}>()

const { t, statusLabel } = useI18n()

const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let lastFocused: HTMLElement | null = null

function focusables(): HTMLElement[] {
  if (!panel.value) return []
  const selector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(panel.value.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null
      document.body.style.overflow = 'hidden'
      await nextTick()
      closeButton.value?.focus()
    } else {
      document.body.style.overflow = ''
      const previous = lastFocused
      lastFocused = null
      if (previous && document.contains(previous)) previous.focus()
    }
  },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="drawer-overlay" @click.self="emit('close')">
      <aside
        ref="panel"
        class="drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="job ? t('drawerLabel', { company: job.company, position: job.position }) : t('drawerTitle')"
      >
        <header class="drawer-header">
          <h2 class="drawer-heading">{{ t('drawerTitle') }}</h2>
          <button
            ref="closeButton"
            type="button"
            class="drawer-close"
            :aria-label="t('drawerClose')"
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
        </header>

        <div class="drawer-body">
          <template v-if="job">
            <h3 class="drawer-company">{{ job.company }}</h3>
            <p class="drawer-position">{{ job.position }}</p>

            <dl class="drawer-meta">
              <div class="drawer-meta-row">
                <dt>{{ t('drawerDate') }}</dt>
                <dd>{{ job.appliedDate }}</dd>
              </div>
              <div class="drawer-meta-row">
                <dt>{{ t('drawerStatus') }}</dt>
                <dd>
                  <span class="badge" :style="statusBadgeStyle(job.status)">
                    {{ statusLabel(job.status) }}
                  </span>
                </dd>
              </div>
            </dl>

            <section class="drawer-section">
              <h4 class="drawer-section-title">{{ t('drawerNotes') }}</h4>
              <p class="drawer-notes">{{ job.notes || t('drawerNoNotes') }}</p>
            </section>
          </template>

          <p v-else class="drawer-missing">{{ t('drawerMissing') }}</p>
        </div>

        <footer v-if="job" class="drawer-footer">
          <button type="button" class="btn btn-primary" @click="emit('edit', job)">
            {{ t('drawerEdit') }}
          </button>
          <button type="button" class="btn btn-danger-ghost" @click="emit('remove', job)">
            {{ t('drawerDelete') }}
          </button>
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
