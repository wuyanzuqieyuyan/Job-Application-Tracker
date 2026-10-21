<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { Job } from '../types'
import { STATUS_LABELS, STATUS_ORDER } from '../types'
import type { JobFormInput } from '../composables/useJobs'

const props = defineProps<{ editing: Job | null }>()

const emit = defineEmits<{
  (e: 'save', payload: JobFormInput): void
  (e: 'cancel'): void
}>()

type FormState = JobFormInput
type FormErrors = Partial<Record<keyof FormState, string>>

const blank = (): FormState => ({
  company: '',
  position: '',
  appliedDate: '',
  status: 'applied',
  notes: '',
})

const form = reactive<FormState>(blank())
const errors = ref<FormErrors>({})

watch(
  () => props.editing,
  (job) => {
    Object.assign(form, blank())
    errors.value = {}
    if (job) {
      form.company = job.company
      form.position = job.position
      form.appliedDate = job.appliedDate
      form.status = job.status
      form.notes = job.notes
    }
  },
  { immediate: true },
)

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function validate(): boolean {
  const next: FormErrors = {}
  const company = form.company.trim()
  const position = form.position.trim()

  if (company === '') {
    next.company = '请输入公司名称'
  } else if (company.length > 50) {
    next.company = '公司名称不能超过 50 个字符'
  }

  if (position === '') {
    next.position = '请输入岗位名称'
  } else if (position.length > 50) {
    next.position = '岗位名称不能超过 50 个字符'
  }

  if (form.appliedDate === '') {
    next.appliedDate = '请选择申请日期'
  } else if (Number.isNaN(Date.parse(form.appliedDate))) {
    next.appliedDate = '日期格式无效'
  } else if (form.appliedDate > today()) {
    next.appliedDate = '申请日期不能晚于今天'
  }

  if (form.notes.length > 200) {
    next.notes = '备注不能超过 200 个字符'
  }

  errors.value = next
  return Object.keys(next).length === 0
}

function onSubmit() {
  if (!validate()) return
  emit('save', {
    company: form.company.trim(),
    position: form.position.trim(),
    appliedDate: form.appliedDate,
    status: form.status,
    notes: form.notes.trim(),
  })
}

function clearError(field: keyof FormErrors) {
  delete errors.value[field]
}
</script>

<template>
  <form class="job-form" novalidate @submit.prevent="onSubmit">
    <h2 class="dialog-title">{{ editing ? '编辑申请记录' : '新增申请记录' }}</h2>

    <div class="field">
      <label for="company">公司名称 <span class="req">*</span></label>
      <input
        id="company"
        v-model="form.company"
        type="text"
        :class="{ invalid: errors.company }"
        maxlength="50"
        @input="clearError('company')"
      />
      <p v-if="errors.company" class="error">{{ errors.company }}</p>
    </div>

    <div class="field">
      <label for="position">岗位名称 <span class="req">*</span></label>
      <input
        id="position"
        v-model="form.position"
        type="text"
        :class="{ invalid: errors.position }"
        maxlength="50"
        @input="clearError('position')"
      />
      <p v-if="errors.position" class="error">{{ errors.position }}</p>
    </div>

    <div class="field-row">
      <div class="field">
        <label for="appliedDate">申请日期 <span class="req">*</span></label>
        <input
          id="appliedDate"
          v-model="form.appliedDate"
          type="date"
          :max="today()"
          :class="{ invalid: errors.appliedDate }"
          @change="clearError('appliedDate')"
        />
        <p v-if="errors.appliedDate" class="error">{{ errors.appliedDate }}</p>
      </div>

      <div class="field">
        <label for="form-status">申请状态</label>
        <select id="form-status" v-model="form.status">
          <option v-for="status in STATUS_ORDER" :key="status" :value="status">
            {{ STATUS_LABELS[status] }}
          </option>
        </select>
      </div>
    </div>

    <div class="field">
      <label for="notes">备注</label>
      <textarea
        id="notes"
        v-model="form.notes"
        rows="3"
        maxlength="200"
        :class="{ invalid: errors.notes }"
        @input="clearError('notes')"
      ></textarea>
      <p v-if="errors.notes" class="error">{{ errors.notes }}</p>
    </div>

    <div class="dialog-actions">
      <button type="button" class="btn btn-ghost" @click="emit('cancel')">取消</button>
      <button type="submit" class="btn btn-primary">{{ editing ? '保存修改' : '新增记录' }}</button>
    </div>
  </form>
</template>
