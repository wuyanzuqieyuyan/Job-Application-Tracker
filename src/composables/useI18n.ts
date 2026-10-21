import { computed, ref } from 'vue'
import type { JobStatus } from '../types'
import { STATUS_LABELS } from '../types'

export type Locale = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'jobtrack-language'
const DEFAULT_LOCALE: Locale = 'zh-CN'

/** 状态名称：界面语言相关，存储中的状态值保持不变 */
export const statusLabels: Record<Locale, Record<JobStatus, string>> = {
  'zh-CN': STATUS_LABELS,
  'en-US': {
    applied: 'Pending',
    interviewing: 'Interviewing',
    offer: 'Offer',
    rejected: 'Rejected',
  },
}

export const messages = {
  'zh-CN': {
    appSubtitle: '求职申请追踪',
    actionAddRecord: '新增记录',
    actionExport: '导出 Excel',
    actionExporting: '导出中…',
    actionLanguage: '切换语言',
    actionLanguageToEnglish: '切换到 English',
    actionLanguageToChinese: '切换到中文',
    languageName: '中文',

    statsLabel: '申请统计',
    statTotal: '总申请数',
    statApplied: '待回复',
    statInterviewing: '面试中',
    statOffer: '录取',

    filterSearchLabel: '搜索公司或职位',
    filterSearchPlaceholder: '输入公司或职位关键字',
    filterStatusLabel: '按状态筛选',
    filterStatusAll: '全部状态',
    filterDateLabel: '投递日期范围',
    filterDateFrom: '起始日期',
    filterDateTo: '结束日期',
    filterSortLabel: '排序方式',
    filterSortDesc: '投递日期（新 → 旧）',
    filterSortAsc: '投递日期（旧 → 新）',
    filterActionsLabel: '筛选操作',
    filterSectionLabel: '搜索与筛选',
    filterClear: '清除筛选',
    filterDateRangeError: '起始日期不能晚于结束日期，已暂时忽略日期范围',
    filterViewLabel: '显示方式',

    viewTable: '表格',
    viewCards: '卡片',
    viewAuto: '跟随屏幕',
    viewAutoTitle: '跟随屏幕宽度自动选择（当前：{view}）',

    tableCompany: '公司',
    tablePosition: '岗位',
    tableDate: '申请日期',
    tableStatus: '状态',
    tableNotes: '备注',
    tableActions: '操作',
    tableListLabel: '申请记录列表',

    cardDate: '申请日期',
    cardNotes: '备注',
    cardDetail: '详情',
    cardEdit: '编辑',
    cardDelete: '删除',

    emptyNoRecordsTitle: '还没有申请记录',
    emptyNoRecordsDesc: '点击右上角“新增记录”开始追踪你的求职进度。',
    emptyNoMatchTitle: '没有匹配的记录',
    emptyNoMatchDesc: '尝试调整搜索关键字、状态或日期范围。',
    emptyClearFilters: '清除筛选条件',
    emptyTitle: '暂无记录',

    formEditTitle: '编辑申请记录',
    formAddTitle: '新增申请记录',
    formCompany: '公司名称',
    formPosition: '岗位名称',
    formDate: '申请日期',
    formStatus: '申请状态',
    formNotes: '备注',
    formCancel: '取消',
    formSave: '保存修改',
    formSubmit: '新增记录',
    errorCompanyRequired: '请输入公司名称',
    errorCompanyTooLong: '公司名称不能超过 {max} 个字符',
    errorPositionRequired: '请输入岗位名称',
    errorPositionTooLong: '岗位名称不能超过 {max} 个字符',
    errorDateRequired: '请选择申请日期',
    errorDateInvalid: '日期格式无效',
    errorDateFuture: '申请日期不能晚于今天',
    errorNotesTooLong: '备注不能超过 {max} 个字符',

    exportMenuLabel: '导出范围',
    exportFiltered: '导出当前筛选结果',
    exportAll: '导出全部记录',
    exportCount: '{count} 条',
    exportNoRecords: '没有可导出的记录',
    exportModuleFailed: '导出失败：模块加载出错',
    exportDone: '已导出 {count} 条记录',
    exportLocalNote: '文件已在本地生成',
    exportFailed: '导出失败',
    exportWorkbookFailed: '导出失败：工作簿生成出错',
    exportHeaderId: 'ID',
    exportHeaderCompany: '公司',
    exportHeaderPosition: '职位',
    exportHeaderDate: '投递日期',
    exportHeaderStatus: '状态',
    exportHeaderNotes: '备注',

    chartTitle: '求职状态分布',
    chartCenterLabel: '总记录',
    chartExpand: '展开图表',
    chartCollapse: '收起图表',
    chartEmpty: '还没有记录，新增一条后即可查看状态分布。',
    chartSummaryItem: '{label} {count} 条',
    chartSummary: '共 {total} 条记录：{detail}',
    chartCanvasLabel: '求职状态分布环形图，共 {total} 条记录：{detail}',

    drawerTitle: '职位详情',
    drawerClose: '关闭详情',
    drawerDate: '申请日期',
    drawerStatus: '当前状态',
    drawerNotes: '备注',
    drawerNoNotes: '暂无备注',
    drawerMissing: '该记录已被删除。',
    drawerLabel: '{company} {position} 职位详情',
    drawerEdit: '编辑',
    drawerDelete: '删除',

    toastClose: '关闭提示',
    toastUndo: '撤销',
    toastUndoDelete: '撤销删除「{company}」',
    toastUndoAdd: '撤销新增「{company}」',
    toastCountdown: '剩余 {seconds} 秒可撤销',

    confirmDeleteTitle: '确认删除',
    confirmDeleteText: '确定要删除“{company} / {position}”这条记录吗？删除后可在提示条中撤销。',
    confirmCancel: '取消',
    confirmDeleteAction: '确认删除',

    toastUpdated: '记录已更新',
    toastAdded: '已新增「{company}」',
    toastDeleted: '已删除「{company}」',
    toastRestored: '已恢复记录',
    toastRestoredDesc: '「{company}」已还原到原来的位置',
    toastUndoneAdd: '已撤销新增',
    toastUndoneAddDesc: '「{company}」已移除',
    toastUndoFailed: '撤销失败',
    toastUndoFailedExists: '记录已存在，无法重复恢复',
    toastUndoFailedModified: '记录已被修改，无法撤销',
    toastDeleteFailed: '删除失败',
    toastDeleteFailedDesc: '记录不存在或已被移除',
    toastSaved: '记录内容已保存',
  },
  'en-US': {
    appSubtitle: 'Job application tracker',
    actionAddRecord: 'Add record',
    actionExport: 'Export Excel',
    actionExporting: 'Exporting…',
    actionLanguage: 'Switch language',
    actionLanguageToEnglish: 'Switch to English',
    actionLanguageToChinese: 'Switch to Chinese',
    languageName: 'English',

    statsLabel: 'Application statistics',
    statTotal: 'Total applications',
    statApplied: 'Pending',
    statInterviewing: 'Interviewing',
    statOffer: 'Offer',

    filterSearchLabel: 'Search company or position',
    filterSearchPlaceholder: 'Company or position',
    filterStatusLabel: 'Filter by status',
    filterStatusAll: 'All statuses',
    filterDateLabel: 'Application date range',
    filterDateFrom: 'Start date',
    filterDateTo: 'End date',
    filterSortLabel: 'Sort by',
    filterSortDesc: 'Newest first',
    filterSortAsc: 'Oldest first',    filterActionsLabel: 'Filter actions',
    filterSectionLabel: 'Search and filters',
    filterClear: 'Clear filters',
    filterDateRangeError:
      'The start date must not be after the end date; the date range is currently ignored',
    filterViewLabel: 'View',

    viewTable: 'Table',
    viewCards: 'Cards',
    viewAuto: 'Follow screen',
    viewAutoTitle: 'Choose automatically by screen width (current: {view})',

    tableCompany: 'Company',
    tablePosition: 'Position',
    tableDate: 'Applied',
    tableStatus: 'Status',
    tableNotes: 'Notes',
    tableActions: 'Actions',
    tableListLabel: 'Application records',

    cardDate: 'Applied',
    cardNotes: 'Notes',
    cardDetail: 'Details',
    cardEdit: 'Edit',
    cardDelete: 'Delete',

    emptyNoRecordsTitle: 'No applications yet',
    emptyNoRecordsDesc: 'Click “Add record” in the top right to start tracking your applications.',
    emptyNoMatchTitle: 'No matching records',
    emptyNoMatchDesc: 'Try a different keyword, status or date range.',
    emptyClearFilters: 'Clear filters',
    emptyTitle: 'No records',

    formEditTitle: 'Edit application',
    formAddTitle: 'New application',
    formCompany: 'Company name',
    formPosition: 'Position name',
    formDate: 'Application date',
    formStatus: 'Status',
    formNotes: 'Notes',
    formCancel: 'Cancel',
    formSave: 'Save changes',
    formSubmit: 'Add record',
    errorCompanyRequired: 'Please enter a company name',
    errorCompanyTooLong: 'The company name cannot exceed {max} characters',
    errorPositionRequired: 'Please enter a position name',
    errorPositionTooLong: 'The position name cannot exceed {max} characters',
    errorDateRequired: 'Please choose an application date',
    errorDateInvalid: 'Invalid date format',
    errorDateFuture: 'The application date cannot be in the future',
    errorNotesTooLong: 'The notes cannot exceed {max} characters',

    exportMenuLabel: 'Export range',
    exportFiltered: 'Export current filtered results',
    exportAll: 'Export all records',
    exportCount: '{count}',
    exportNoRecords: 'There are no records to export',
    exportModuleFailed: 'Export failed: the module could not be loaded',
    exportDone: 'Exported {count} records',
    exportLocalNote: 'The file was generated locally',
    exportFailed: 'Export failed',
    exportWorkbookFailed: 'Export failed: the workbook could not be generated',
    exportHeaderId: 'ID',
    exportHeaderCompany: 'Company',
    exportHeaderPosition: 'Position',
    exportHeaderDate: 'Applied',
    exportHeaderStatus: 'Status',
    exportHeaderNotes: 'Notes',

    chartTitle: 'Application status breakdown',
    chartCenterLabel: 'Total',
    chartExpand: 'Show chart',
    chartCollapse: 'Hide chart',
    chartEmpty: 'No records yet. Add one to see the status breakdown.',
    chartSummaryItem: '{label}: {count}',
    chartSummary: '{total} records: {detail}',
    chartCanvasLabel: 'Donut chart of the application status breakdown, {total} records: {detail}',

    drawerTitle: 'Application details',
    drawerClose: 'Close details',
    drawerDate: 'Application date',
    drawerStatus: 'Current status',
    drawerNotes: 'Notes',
    drawerNoNotes: 'No notes',
    drawerMissing: 'This record has been deleted.',
    drawerLabel: 'Details for {company} {position}',
    drawerEdit: 'Edit',
    drawerDelete: 'Delete',

    toastClose: 'Dismiss notification',
    toastUndo: 'Undo',
    toastUndoDelete: 'Undo deletion of “{company}”',
    toastUndoAdd: 'Undo creation of “{company}”',
    toastCountdown: '{seconds}s left to undo',

    confirmDeleteTitle: 'Delete record',
    confirmDeleteText:
      'Delete “{company} / {position}”? You can undo this from the notification.',
    confirmCancel: 'Cancel',
    confirmDeleteAction: 'Delete',

    toastUpdated: 'Record updated',
    toastAdded: 'Added “{company}”',
    toastDeleted: 'Deleted “{company}”',
    toastRestored: 'Record restored',
    toastRestoredDesc: '“{company}” was put back in its original position',
    toastUndoneAdd: 'Creation undone',
    toastUndoneAddDesc: '“{company}” was removed',
    toastUndoFailed: 'Undo failed',
    toastUndoFailedExists: 'The record already exists and cannot be restored again',
    toastUndoFailedModified: 'The record was modified and cannot be undone',
    toastDeleteFailed: 'Delete failed',
    toastDeleteFailedDesc: 'The record does not exist or was already removed',
    toastSaved: 'The record has been saved',
  },
} as const

export type MessageKey = keyof (typeof messages)['zh-CN']

function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en-US'
}

function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    return null
  }
}

/** 首次访问时按浏览器语言选择：zh* → zh-CN，en* → en-US，其余回退简体中文。 */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE
  const tags: string[] = []
  if (Array.isArray(navigator.languages)) tags.push(...navigator.languages)
  if (navigator.language) tags.push(navigator.language)
  for (const tag of tags) {
    if (!tag) continue
    const lower = tag.toLowerCase()
    if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh-CN'
    if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en-US'
  }
  return DEFAULT_LOCALE
}

/**
 * 语言优先级：已保存的有效偏好 > 浏览器语言 > 简体中文。
 * 读取时不会写入存储，只有用户主动切换才会持久化。
 */
const locale = ref<Locale>(readStoredLocale() ?? detectBrowserLocale())

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.split(`{${key}}`).join(String(value)),
    text,
  )
}

export function useI18n() {
  function t(key: MessageKey, vars?: Record<string, string | number>): string {
    const table = messages[locale.value] as Record<string, string>
    const text = table[key]
    return text === undefined ? key : interpolate(text, vars)
  }

  function statusLabel(status: JobStatus): string {
    return statusLabels[locale.value][status]
  }

  function setLocale(next: Locale) {
    locale.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 存储不可用时仅保留当前会话的语言
    }
  }

  function toggleLocale() {
    setLocale(locale.value === 'zh-CN' ? 'en-US' : 'zh-CN')
  }

  return {
    locale,
    isEnglish: computed(() => locale.value === 'en-US'),
    t,
    statusLabel,
    setLocale,
    toggleLocale,
  }
}
