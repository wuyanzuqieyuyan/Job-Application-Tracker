import ExcelJS from 'exceljs'
import type { Job } from '../types'
import { STATUS_LABELS } from '../types'

export const EXPORT_SHEET_NAME = 'Job Applications'

export type ExportScope = 'filtered' | 'all'

export interface ExportResult {
  ok: boolean
  message: string
  count: number
}

/** Local date, e.g. jobtrack-export-2026-10-21.xlsx */
export function buildExportFileName(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `jobtrack-export-${year}-${month}-${day}.xlsx`
}

function triggerDownload(data: ArrayBuffer, fileName: string) {
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  // the blob url has to stay alive until the browser has read the file,
  // otherwise the transfer is aborted right after it started
  window.setTimeout(() => {
    link.remove()
    URL.revokeObjectURL(url)
  }, 30000)
}

/**
 * Builds the .xlsx workbook bytes for the given records.
 *
 * Every user supplied value is written as a plain text cell, so notes that
 * start with "=" are never treated as a formula. Nothing is sent anywhere:
 * the workbook is produced entirely in the browser.
 */
export async function buildWorkbookBuffer(jobs: Job[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'JobTrack'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(EXPORT_SHEET_NAME)
  sheet.columns = [
    { header: 'ID', key: 'id', width: 38 },
    { header: '公司', key: 'company', width: 24 },
    { header: '职位', key: 'position', width: 24 },
    { header: '投递日期', key: 'appliedDate', width: 14 },
    { header: '状态', key: 'status', width: 12 },
    { header: '备注', key: 'notes', width: 60 },
  ]

  for (const job of jobs) {
    sheet.addRow({
      id: job.id,
      company: job.company,
      position: job.position,
      appliedDate: job.appliedDate,
      status: STATUS_LABELS[job.status],
      notes: job.notes,
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}

/**
 * Serialises the given records into an .xlsx workbook and downloads it.
 * The export never modifies business data.
 */
export async function exportJobsToXlsx(jobs: Job[]): Promise<ExportResult> {
  if (jobs.length === 0) {
    return { ok: false, message: '没有可导出的记录', count: 0 }
  }
  try {
    const buffer = await buildWorkbookBuffer(jobs)
    triggerDownload(buffer, buildExportFileName())
    return { ok: true, message: `已导出 ${jobs.length} 条记录`, count: jobs.length }
  } catch {
    return { ok: false, message: '导出失败：工作簿生成出错', count: 0 }
  }
}
