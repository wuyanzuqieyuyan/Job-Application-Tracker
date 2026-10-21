<script setup lang="ts">
import type { Job } from '../types'
import type { ViewMode } from '../composables/useViewMode'
import { useI18n } from '../composables/useI18n'

defineProps<{
  jobs: Job[]
  hasAnyRecord: boolean
  isFiltering: boolean
  viewMode: ViewMode
}>()

const emit = defineEmits<{
  (e: 'edit', job: Job): void
  (e: 'remove', job: Job): void
  (e: 'view', job: Job): void
  (e: 'clearFilters'): void
}>()

const { t, statusLabel } = useI18n()
</script>

<template>
  <section class="table-wrap" :aria-label="t('tableListLabel')">
    <template v-if="jobs.length > 0">
      <table v-if="viewMode === 'table'" class="job-table">
        <thead>
          <tr>
            <th scope="col">{{ t('tableCompany') }}</th>
            <th scope="col">{{ t('tablePosition') }}</th>
            <th scope="col">{{ t('tableDate') }}</th>
            <th scope="col">{{ t('tableStatus') }}</th>
            <th scope="col">{{ t('tableNotes') }}</th>
            <th scope="col" class="col-actions">{{ t('tableActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="job in jobs"
            :key="job.id"
            class="job-row"
            tabindex="0"
            @click="emit('view', job)"
            @keydown.enter.prevent="emit('view', job)"
            @keydown.space.prevent="emit('view', job)"
          >
            <td class="cell-company" :title="job.company">{{ job.company }}</td>
            <td class="cell-position" :title="job.position">{{ job.position }}</td>
            <td>{{ job.appliedDate }}</td>
            <td>
              <span class="badge" :class="`badge-${job.status}`">
                {{ statusLabel(job.status) }}
              </span>
            </td>
            <td class="cell-notes">
              <div class="cell-notes-text" :title="job.notes || undefined">
                {{ job.notes || '—' }}
              </div>
            </td>
            <td class="col-actions">
              <div class="col-actions-list">
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  @click.stop="emit('edit', job)"
                >
                  {{ t('cardEdit') }}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-danger"
                  @click.stop="emit('remove', job)"
                >
                  {{ t('cardDelete') }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="job-cards">
        <article v-for="job in jobs" :key="job.id" class="job-card">
          <div class="card-head">
            <div class="card-title">
              <h3 class="card-company">{{ job.company }}</h3>
              <p class="card-position">{{ job.position }}</p>
            </div>
            <span class="badge" :class="`badge-${job.status}`">
              {{ statusLabel(job.status) }}
            </span>
          </div>
          <dl class="card-meta">
            <div class="card-meta-row">
              <dt>{{ t('cardDate') }}</dt>
              <dd>{{ job.appliedDate }}</dd>
            </div>
            <div class="card-meta-row">
              <dt>{{ t('cardNotes') }}</dt>
              <dd class="card-notes">{{ job.notes || '—' }}</dd>
            </div>
          </dl>
          <div class="card-actions">
            <button type="button" class="btn btn-sm btn-ghost" @click="emit('view', job)">
              {{ t('cardDetail') }}
            </button>
            <button type="button" class="btn btn-sm btn-ghost" @click="emit('edit', job)">
              {{ t('cardEdit') }}
            </button>
            <button type="button" class="btn btn-sm btn-danger" @click="emit('remove', job)">
              {{ t('cardDelete') }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <div v-else class="empty-state">
      <template v-if="!hasAnyRecord">
        <p class="empty-title">{{ t('emptyNoRecordsTitle') }}</p>
        <p class="empty-desc">{{ t('emptyNoRecordsDesc') }}</p>
      </template>
      <template v-else-if="isFiltering">
        <p class="empty-title">{{ t('emptyNoMatchTitle') }}</p>
        <p class="empty-desc">{{ t('emptyNoMatchDesc') }}</p>
        <button type="button" class="btn btn-sm btn-ghost empty-action" @click="emit('clearFilters')">
          {{ t('emptyClearFilters') }}
        </button>
      </template>
      <template v-else>
        <p class="empty-title">{{ t('emptyTitle') }}</p>
      </template>
    </div>
  </section>
</template>
