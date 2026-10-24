<script setup lang="ts">
import type { Job } from '../types'
import { statusBadgeStyle } from '../types'
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
  (e: 'create'): void
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
              <span class="badge" :style="statusBadgeStyle(job.status)">
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
                  class="btn btn-sm btn-edit"
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
          <!-- 卡片信息区即详情入口：键盘可达、鼠标悬停渐变、操作按钮位于同级区块（事件天然隔离） -->
          <div
            class="card-main"
            role="button"
            tabindex="0"
            :aria-label="t('cardViewDetails')"
            @click="emit('view', job)"
            @keydown.enter.prevent="emit('view', job)"
            @keydown.space.prevent="emit('view', job)"
          >
            <div class="card-head">
              <div class="card-title">
                <h3 class="card-company">{{ job.company }}</h3>
                <p class="card-position">{{ job.position }}</p>
              </div>
              <span class="badge" :style="statusBadgeStyle(job.status)">
                {{ statusLabel(job.status) }}
              </span>
            </div>
            <dl class="card-meta">
              <div class="card-meta-row">
                <dt>{{ t('cardDate') }}</dt>
                <dd class="card-date-value">{{ job.appliedDate }}</dd>
              </div>
              <div class="card-meta-row card-notes-row">
                <dt>{{ t('cardNotes') }}</dt>
                <dd class="card-notes">{{ job.notes || '—' }}</dd>
              </div>
            </dl>
          </div>
          <div class="card-actions">
            <button type="button" class="btn btn-sm btn-edit" @click.stop="emit('edit', job)">
              {{ t('cardEdit') }}
            </button>
            <button type="button" class="btn btn-sm btn-danger-ghost" @click.stop="emit('remove', job)">
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
        <button type="button" class="btn btn-sm btn-primary empty-action" @click="emit('create')">
          {{ t('actionAddRecord') }}
        </button>
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
