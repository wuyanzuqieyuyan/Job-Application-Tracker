import type { JobFilters } from '../types'

/**
 * 日期范围控件（Element Plus daterange）与筛选状态之间的纯映射。
 *
 * 契约（投递日期范围控件与筛选状态的统一映射）：
 * - 筛选状态的格式永不改变：`dateFrom`/`dateTo` 为 `YYYY-MM-DD` 字符串，未选时为 `''`
 *   （useJobs.dateRangeInvalid 与 filteredJobs 的 Date.parse 边界逻辑依赖此格式）。
 * - `value-format="YYYY-MM-DD"` 使 Element Plus 直接产出/消费字符串，
 *   不经过 Date 对象，因此不存在本地时区/`Date.parse` 偏移问题。
 * - 组件空态表示为 `null`（用户点击清除），映射回两个 `''`；
 *   其他不可信输入一律兜底为"未选择"，绝不臆造日期字符串。
 */

export type DateRangeValue = [string, string] | null

/** 筛选状态 → 组件 model：只取已选日期，未选择时必须传 null（clearable 依赖 null 判空）。 */
export function toRangeValue(dateFrom: string, dateTo: string): DateRangeValue {
  if (dateFrom === '' && dateTo === '') return null
  if (dateFrom === '' || dateTo === '') return null
  return [dateFrom, dateTo]
}

/** 组件 model → 筛选状态的 date 字段（Partial<JobFilters>）：null/异常输入 → 空串。 */
export function fromRangeValue(value: unknown): Pick<JobFilters, 'dateFrom' | 'dateTo'> {
  if (!Array.isArray(value) || value.length !== 2) {
    return { dateFrom: '', dateTo: '' }
  }
  const [from, to] = value
  return {
    dateFrom: typeof from === 'string' ? from : '',
    dateTo: typeof to === 'string' ? to : '',
  }
}
