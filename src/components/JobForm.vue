<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElDatePicker, ElConfigProvider, ElSelect, ElOption } from 'element-plus'
import zhCnLocale from 'element-plus/es/locale/lang/zh-cn'
import enUsLocale from 'element-plus/es/locale/lang/en'
import { STATUS_ORDER } from '../types'
import type { Job } from '../types'
import type { JobFormInput } from '../composables/useJobs'
import { useI18n } from '../composables/useI18n'
import 'element-plus/es/components/date-picker/style/css'
import 'element-plus/es/components/select/style/css'

const props = defineProps<{ editing: Job | null }>()

const emit = defineEmits<{
  (e: 'save', payload: JobFormInput): void
  (e: 'cancel'): void
}>()

const { t, statusLabel, locale } = useI18n()

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
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * 申请日期控件（Element Plus ElDatePicker 单日期）：
 * - model 转换：空串 ''（表单契约）↔ 组件空态 null，选中值为 YYYY-MM-DD 字符串（value-format），
 *   不经过 Date 对象，表单/提交/验证/回填的日期格式和数据结构保持不变；
 * - disabled-date 保留原生 :max="today()" 的「不能晚于今天」约束；
 * - 面板语言随应用语言（ElConfigProvider，与筛选栏同一套 locale 响应链）；
 * - 独立占位键 formApplicationDatePlaceholder，仅用于本窗口，不影响筛选栏。
 */
const formElementLocale = computed(() => (locale.value === 'en-US' ? enUsLocale : zhCnLocale))
const datePlaceholder = computed(() => t('formApplicationDatePlaceholder'))
const formDateModel = computed(() => form.appliedDate || null)

function disableFutureDate(date: Date): boolean {
  return date.getTime() > Date.parse(today())
}

function handleApplyDateChange(value: unknown) {
  form.appliedDate = typeof value === 'string' ? value : ''
  clearError('appliedDate')
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
        <el-config-provider :locale="formElementLocale">
          <el-date-picker
            id="appliedDate"
            class="job-form-date"
            type="date"
            :model-value="formDateModel"
            :placeholder="datePlaceholder"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            :clearable="true"
            :disabled-date="disableFutureDate"
            :class="{ 'is-invalid': errors.appliedDate }"
            :teleported="true"
            popper-class="jobtrack-form-date-popper"
            @update:model-value="handleApplyDateChange"
          />
        </el-config-provider>
        <p v-if="errors.appliedDate" class="error">{{ errors.appliedDate }}</p>
      </div>

      <div class="field">
        <span class="field-label" id="form-status-label">{{ t('formStatus') }}</span>
        <el-select
          id="form-status"
          class="job-form-select"
          :model-value="form.status"
          aria-labelledby="form-status-label"
          popper-class="jobtrack-select-popper"
          :validate-event="false"
          @update:model-value="(value: string | number | boolean | object | undefined) => { form.status = value as Job['status'] }"
        >
          <el-option v-for="status in STATUS_ORDER" :key="status" :value="status" :label="statusLabel(status)" />
        </el-select>
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
