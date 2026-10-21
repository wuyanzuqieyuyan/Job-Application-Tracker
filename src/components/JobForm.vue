<script setup lang="ts">
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { Job } from '../types'
import { STATUS_ORDER } from '../types'
import type { JobFormInput } from '../composables/useJobs'
import { useI18n } from '../composables/useI18n'

const props = defineProps<{ editing: Job | null }>()

const emit = defineEmits<{
  (e: 'save', payload: JobFormInput): void
  (e: 'cancel'): void
}>()

const { t, statusLabel } = useI18n()

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
const companyInput = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  companyInput.value?.focus()
})

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
    next.company = t('errorCompanyRequired')
  } else if (company.length > 50) {
    next.company = t('errorCompanyTooLong', { max: 50 })
  }

  if (position === '') {
    next.position = t('errorPositionRequired')
  } else if (position.length > 50) {
    next.position = t('errorPositionTooLong', { max: 50 })
  }

  if (form.appliedDate === '') {
    next.appliedDate = t('errorDateRequired')
  } else if (Number.isNaN(Date.parse(form.appliedDate))) {
    next.appliedDate = t('errorDateInvalid')
  } else if (form.appliedDate > today()) {
    next.appliedDate = t('errorDateFuture')
  }

  if (form.notes.length > 200) {
    next.notes = t('errorNotesTooLong', { max: 200 })
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
    <h2 class="dialog-title">{{ editing ? t('formEditTitle') : t('formAddTitle') }}</h2>

    <div class="field">
      <label for="company">{{ t('formCompany') }} <span class="req">*</span></label>
      <input
        id="company"
        ref="companyInput"
        v-model="form.company"
        type="text"
        :class="{ invalid: errors.company }"
        maxlength="50"
        @input="clearError('company')"
      />
      <p v-if="errors.company" class="error">{{ errors.company }}</p>
    </div>

    <div class="field">
      <label for="position">{{ t('formPosition') }} <span class="req">*</span></label>
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
        <label for="appliedDate">{{ t('formDate') }} <span class="req">*</span></label>
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
        <label for="form-status">{{ t('formStatus') }}</label>
        <select id="form-status" v-model="form.status">
          <option v-for="status in STATUS_ORDER" :key="status" :value="status">
            {{ statusLabel(status) }}
          </option>
        </select>
      </div>
    </div>

    <div class="field">
      <label for="notes">{{ t('formNotes') }}</label>
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
      <button type="button" class="btn btn-ghost" @click="emit('cancel')">
        {{ t('formCancel') }}
      </button>
      <button type="submit" class="btn btn-primary">
        {{ editing ? t('formSave') : t('formSubmit') }}
      </button>
    </div>
  </form>
</template>
