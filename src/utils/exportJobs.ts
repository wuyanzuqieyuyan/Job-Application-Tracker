import ExcelJS from 'exceljs'
import type { Job, JobStatus } from '../types'

export const EXPORT_SHEET_NAME = 'Job Applications'

export type ExportScope = 'filtered' | 'all'

/** 导出失败的原因，由界面层翻译成当前语言的文案 */
export type ExportFailure = 'empty' | 'workbook'

export interface ExportResult {
  ok: boolean
  count: number
  failure?: ExportFailure
}

/** 导出时使用的文案（跟随当前界面语言） */
export interface ExportLabels {
  headers: {
    id: string
    company: string
    position: string
    appliedDate: string
    status: string
    notes: string
  }
  statusLabel: (status: JobStatus) => string
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
export async function buildWorkbookBuffer(jobs: Job[], labels: ExportLabels): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'JobTrack'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(EXPORT_SHEET_NAME)
  sheet.columns = [
    { header: labels.headers.id, key: 'id', width: 38 },
    { header: labels.headers.company, key: 'company', width: 24 },
    { header: labels.headers.position, key: 'position', width: 24 },
    { header: labels.headers.appliedDate, key: 'appliedDate', width: 14 },
    { header: labels.headers.status, key: 'status', width: 12 },
    { header: labels.headers.notes, key: 'notes', width: 60 },
  ]

  for (const job of jobs) {
    sheet.addRow({
      id: job.id,
      company: job.company,
      position: job.position,
      appliedDate: job.appliedDate,
      status: labels.statusLabel(job.status),
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
export async function exportJobsToXlsx(jobs: Job[], labels: ExportLabels): Promise<ExportResult> {
  if (jobs.length === 0) {
    return { ok: false, count: 0, failure: 'empty' }
  }
  try {
    const buffer = await buildWorkbookBuffer(jobs, labels)
    triggerDownload(buffer, buildExportFileName())
    return { ok: true, count: jobs.length }
  } catch {
    return { ok: false, count: 0, failure: 'workbook' }
  }
}
