<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Job } from '../types'
import { STATUS_LABELS } from '../types'

const props = defineProps<{
  open: boolean
  job: Job | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'edit', job: Job): void
  (e: 'remove', job: Job): void
}>()

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
        :aria-label="job ? `${job.company} ${job.position} 职位详情` : '职位详情'"
      >
        <header class="drawer-header">
          <h2 class="drawer-heading">职位详情</h2>
          <button
            ref="closeButton"
            type="button"
            class="drawer-close"
            aria-label="关闭详情"
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
                <dt>申请日期</dt>
                <dd>{{ job.appliedDate }}</dd>
              </div>
              <div class="drawer-meta-row">
                <dt>当前状态</dt>
                <dd>
                  <span class="badge" :class="`badge-${job.status}`">
                    {{ STATUS_LABELS[job.status] }}
                  </span>
                </dd>
              </div>
            </dl>

            <section class="drawer-section">
              <h4 class="drawer-section-title">备注</h4>
              <p class="drawer-notes">{{ job.notes || '暂无备注' }}</p>
            </section>
          </template>

          <p v-else class="drawer-missing">该记录已被删除。</p>
        </div>

        <footer v-if="job" class="drawer-footer">
          <button type="button" class="btn btn-ghost" @click="emit('edit', job)">编辑</button>
          <button type="button" class="btn btn-danger" @click="emit('remove', job)">删除</button>
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
