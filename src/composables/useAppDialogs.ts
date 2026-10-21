import { computed, nextTick, ref } from 'vue'
import type { Ref } from 'vue'
import type { Job } from '../types'

export interface AppDialogsOptions {
  /** 表单关闭后没有可用触发元素时，焦点回到这里（例如悬浮新增按钮）。 */
  fallbackFocus?: () => HTMLElement | null
  /** 全部记录，用于解析详情抽屉当前选中的记录。 */
  jobs?: Ref<Job[]>
}

/**
 * 弹窗协调：新增/编辑表单、删除确认、职位详情抽屉的状态与焦点恢复。
 * 只负责界面状态，真正的数据写入仍由 useJobs 完成。
 */
export function useAppDialogs(options: AppDialogsOptions = {}) {
  const formOpen = ref(false)
  const editingJob = ref<Job | null>(null)
  const pendingDelete = ref<Job | null>(null)

  /** 详情抽屉按记录 id 选中，筛选或排序变化不会串位。 */
  const detailJobId = ref<string | null>(null)
  const detailOpen = computed(() => detailJobId.value !== null)
  /** 抽屉展示的记录始终来自当前数据，删除后会变为 null。 */
  const detailJob = computed<Job | null>(
    () => options.jobs?.value.find((job) => job.id === detailJobId.value) ?? null,
  )

  let formTrigger: HTMLElement | null = null

  function captureTrigger() {
    formTrigger = document.activeElement as HTMLElement | null
  }

  function openCreate() {
    captureTrigger()
    editingJob.value = null
    formOpen.value = true
  }

  function openEdit(job: Job) {
    captureTrigger()
    editingJob.value = job
    formOpen.value = true
  }

  function closeForm() {
    formOpen.value = false
    editingJob.value = null
    const trigger = formTrigger
    formTrigger = null
    nextTick(() => {
      if (trigger && document.contains(trigger)) {
        trigger.focus()
      } else {
        options.fallbackFocus?.()?.focus()
      }
    })
  }

  function requestDelete(job: Job) {
    pendingDelete.value = job
  }

  function cancelDelete() {
    pendingDelete.value = null
  }

  function openDetail(job: Job) {
    detailJobId.value = job.id
  }

  function closeDetail() {
    detailJobId.value = null
  }

  /** 从抽屉发起编辑：关闭抽屉后复用既有的编辑流程。 */
  function editFromDetail(job: Job) {
    closeDetail()
    openEdit(job)
  }

  /** 从抽屉发起删除：关闭抽屉后复用既有的删除确认流程。 */
  function removeFromDetail(job: Job) {
    closeDetail()
    requestDelete(job)
  }

  return {
    formOpen,
    editingJob,
    pendingDelete,
    detailJobId,
    detailJob,
    detailOpen,
    openCreate,
    openEdit,
    closeForm,
    requestDelete,
    cancelDelete,
    openDetail,
    closeDetail,
    editFromDetail,
    removeFromDetail,
  }
}
