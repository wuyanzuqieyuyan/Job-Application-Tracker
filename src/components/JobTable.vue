<script setup lang="ts">
import type { Job } from '../types'
import { STATUS_LABELS } from '../types'
import type { ViewMode } from '../composables/useViewMode'

defineProps<{
  jobs: Job[]
  hasAnyRecord: boolean
  isFiltering: boolean
  viewMode: ViewMode
}>()

const emit = defineEmits<{
  (e: 'edit', job: Job): void
  (e: 'remove', job: Job): void
  (e: 'clearFilters'): void
}>()
</script>

<template>
  <section class="table-wrap" aria-label="申请记录列表">
    <template v-if="jobs.length > 0">
      <table v-if="viewMode === 'table'" class="job-table">
        <thead>
          <tr>
            <th scope="col">公司</th>
            <th scope="col">岗位</th>
            <th scope="col">申请日期</th>
            <th scope="col">状态</th>
            <th scope="col">备注</th>
            <th scope="col" class="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id">
            <td class="cell-company">{{ job.company }}</td>
            <td class="cell-position">{{ job.position }}</td>
            <td>{{ job.appliedDate }}</td>
            <td>
              <span class="badge" :class="`badge-${job.status}`">
                {{ STATUS_LABELS[job.status] }}
              </span>
            </td>
            <td class="cell-notes">{{ job.notes || '—' }}</td>
            <td class="col-actions">
              <div class="col-actions-list">
                <button type="button" class="btn btn-sm btn-ghost" @click="emit('edit', job)">
                  编辑
                </button>
                <button type="button" class="btn btn-sm btn-danger" @click="emit('remove', job)">
                  删除
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
              {{ STATUS_LABELS[job.status] }}
            </span>
          </div>
          <dl class="card-meta">
            <div class="card-meta-row">
              <dt>申请日期</dt>
              <dd>{{ job.appliedDate }}</dd>
            </div>
            <div class="card-meta-row">
              <dt>备注</dt>
              <dd class="card-notes">{{ job.notes || '—' }}</dd>
            </div>
          </dl>
          <div class="card-actions">
            <button type="button" class="btn btn-sm btn-ghost" @click="emit('edit', job)">
              编辑
            </button>
            <button type="button" class="btn btn-sm btn-danger" @click="emit('remove', job)">
              删除
            </button>
          </div>
        </article>
      </div>
    </template>

    <div v-else class="empty-state">
      <template v-if="!hasAnyRecord">
        <p class="empty-title">还没有申请记录</p>
        <p class="empty-desc">点击右上角“新增记录”开始追踪你的求职进度。</p>
      </template>
      <template v-else-if="isFiltering">
        <p class="empty-title">没有匹配的记录</p>
        <p class="empty-desc">尝试调整搜索关键字、状态或日期范围。</p>
        <button type="button" class="btn btn-sm btn-ghost empty-action" @click="emit('clearFilters')">
          清除筛选条件
        </button>
      </template>
      <template v-else>
        <p class="empty-title">暂无记录</p>
      </template>
    </div>
  </section>
</template>
