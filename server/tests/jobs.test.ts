import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type DatabaseConstructor from 'better-sqlite3'

// 动态导入必须在设置 JOBTRACK_DATA_DIR 之后（src/db 在模块加载时读取它），
// 这里通过 beforeAll 中的 await import 保证顺序。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrack-test-'))
process.env.JOBTRACK_DATA_DIR = tmpDir

const NEW_JOB = {
  company: '示例科技',
  position: '前端工程师',
  appliedDate: '2026-09-01',
  status: 'interviewing' as const,
  notes: '已完成一面',
}

let server: http.Server
let baseUrl: string
let db: InstanceType<typeof DatabaseConstructor> | null = null
let DB_PATH = ''

beforeAll(async () => {
  const { initDb, db: dbInstance } = await import('../src/db')
  const { createApp } = await import('../src/app')
  DB_PATH = (await import('../src/db')).DB_PATH

  db = dbInstance
  initDb()
  const app = createApp()
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  db?.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

async function request(method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: unknown = null
  if (text.length > 0) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status: res.status, data }
}

/** 解开 { data: ... } 响应包装。 */
function dataOf(res: { data: unknown }): unknown {
  return (res.data as { data: unknown }).data
}

function jobExpects(body: unknown, overrides: Partial<typeof NEW_JOB> = {}) {
  const job = body as { id: string; company: string; position: string; appliedDate: string; status: string; notes: string }
  expect(job.id).toBeTruthy()
  expect(job.company).toBe(overrides.company ?? NEW_JOB.company)
  expect(job.position).toBe(overrides.position ?? NEW_JOB.position)
  expect(job.appliedDate).toBe(overrides.appliedDate ?? NEW_JOB.appliedDate)
  expect(job.status).toBe(overrides.status ?? NEW_JOB.status)
  expect(job.notes).toBe(overrides.notes ?? NEW_JOB.notes)
}

describe('GET /api/health', () => {
  it('returns 200 and ok', async () => {
    const res = await request('GET', '/api/health')
    expect(res.status).toBe(200)
    expect(res.data).toMatchObject({ ok: true })
  })
})

describe('POST /api/jobs', () => {
  it('creates a job and returns 201', async () => {
    const res = await request('POST', '/api/jobs', NEW_JOB)
    expect(res.status).toBe(201)
    jobExpects(dataOf(res))
  })

  it('missing company returns 400', async () => {
    const res = await request('POST', '/api/jobs', { ...NEW_JOB, company: '' })
    expect(res.status).toBe(400)
    expect(res.data).toMatchObject({ error: { code: 'invalid_company' } })
  })

  it('future date returns 400', async () => {
    const res = await request('POST', '/api/jobs', { ...NEW_JOB, appliedDate: '2099-01-01' })
    expect(res.status).toBe(400)
    expect(res.data).toMatchObject({ error: { code: 'invalid_applied_date' } })
  })

  it('invalid status returns 400', async () => {
    const res = await request('POST', '/api/jobs', { ...NEW_JOB, status: 'unknown' })
    expect(res.status).toBe(400)
    expect(res.data).toMatchObject({ error: { code: 'invalid_status' } })
  })
})

describe('GET /api/jobs', () => {
  it('returns 200 and a list containing the created job', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const id = (dataOf(created) as { id: string }).id
    const res = await request('GET', '/api/jobs')
    expect(res.status).toBe(200)
    const jobs = (dataOf(res) as { id: string }[])
    expect(Array.isArray(jobs)).toBe(true)
    expect(jobs.some((j) => j.id === id)).toBe(true)
  })
})

describe('GET /api/jobs/:id', () => {
  it('returns 200 for an existing job', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const id = (dataOf(created) as { id: string }).id
    const res = await request('GET', `/api/jobs/${id}`)
    expect(res.status).toBe(200)
    jobExpects(dataOf(res))
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await request('GET', '/api/jobs/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
    expect(res.data).toMatchObject({ error: { code: 'job_not_found' } })
  })
})

describe('PUT /api/jobs/:id', () => {
  it('updates an existing job and returns 200', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const id = (dataOf(created) as { id: string }).id
    const res = await request('PUT', `/api/jobs/${id}`, { ...NEW_JOB, status: 'offer' })
    expect(res.status).toBe(200)
    jobExpects(dataOf(res), { status: 'offer' })
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await request('PUT', '/api/jobs/00000000-0000-0000-0000-000000000000', NEW_JOB)
    expect(res.status).toBe(404)
    expect(res.data).toMatchObject({ error: { code: 'job_not_found' } })
  })

  it('returns 400 for invalid body', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const id = (dataOf(created) as { id: string }).id
    const res = await request('PUT', `/api/jobs/${id}`, { ...NEW_JOB, notes: 'x'.repeat(201) })
    expect(res.status).toBe(400)
    expect(res.data).toMatchObject({ error: { code: 'invalid_notes' } })
  })
})

describe('DELETE /api/jobs/:id', () => {
  it('deletes an existing job and returns 200 with the full snapshot', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const id = (dataOf(created) as { id: string }).id
    const before = db!.prepare('SELECT sort_order, created_at, updated_at FROM jobs WHERE id = ?').get(id) as {
      sort_order: number
      created_at: string
      updated_at: string
    }

    const res = await request('DELETE', `/api/jobs/${id}`)
    expect(res.status).toBe(200)
    const snapshot = dataOf(res) as Record<string, unknown>
    expect(snapshot.id).toBe(id)
    expect(snapshot.company).toBe(NEW_JOB.company)
    expect(snapshot.position).toBe(NEW_JOB.position)
    expect(snapshot.appliedDate).toBe(NEW_JOB.appliedDate)
    expect(snapshot.status).toBe(NEW_JOB.status)
    expect(snapshot.notes).toBe(NEW_JOB.notes)
    expect(snapshot.sortOrder).toBe(before.sort_order)
    expect(snapshot.createdAt).toBe(before.created_at)
    expect(snapshot.updatedAt).toBe(before.updated_at)

    const getRes = await request('GET', `/api/jobs/${id}`)
    expect(getRes.status).toBe(404)
  })

  it('returns 404 for a nonexistent id', async () => {
    const res = await request('DELETE', '/api/jobs/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(404)
  })

  it('is not idempotent: deleting twice returns 404 the second time', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const id = (dataOf(created) as { id: string }).id
    const first = await request('DELETE', `/api/jobs/${id}`)
    expect(first.status).toBe(200)
    const second = await request('DELETE', `/api/jobs/${id}`)
    expect(second).toMatchObject({ status: 404 })
  })
})

describe('POST /api/jobs/import', () => {
  it('imports a batch atomically and returns 201', async () => {
    const before = ((await request('GET', '/api/jobs')).data as { data: unknown[] }).data.length
    const res = await request('POST', '/api/jobs/import', [
      NEW_JOB,
      { ...NEW_JOB, company: '另一家公司', status: 'applied' },
      { ...NEW_JOB, company: '第三家公司', status: 'offer' },
    ])
    expect(res.status).toBe(201)
    const inserted = dataOf(res) as { id: string }[]
    expect(inserted.length).toBe(3)
    const after = ((await request('GET', '/api/jobs')).data as { data: unknown[] }).data.length
    expect(after).toBe(before + 3)
    // 清理，避免影响其他用例
    for (const j of inserted) await request('DELETE', `/api/jobs/${j.id}`)
  })

  it('rolls back the whole batch when one item is invalid', async () => {
    const before = ((await request('GET', '/api/jobs')).data as { data: unknown[] }).data.length
    const res = await request('POST', '/api/jobs/import', [
      NEW_JOB,
      { ...NEW_JOB, company: '' },
    ])
    expect(res.status).toBe(400)
    const after = ((await request('GET', '/api/jobs')).data as { data: unknown[] }).data.length
    expect(after).toBe(before)
  })

  it('returns 400 for a non-array body', async () => {
    const res = await request('POST', '/api/jobs/import', { not: 'an array' })
    expect(res.status).toBe(400)
    expect(res.data).toMatchObject({ error: { code: 'invalid_request' } })
  })
})

describe('request body errors', () => {
  it('malformed JSON returns 400 (malformed_body)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken json',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'malformed_body' } })
  })

  it('oversized body (>1MB) returns 413 (request_too_large)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(1_100_000) }),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: { code: 'request_too_large' } })
  })

  it('unsupported charset returns 415 (unsupported_body_encoding)', async () => {
    const res = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=gbk' },
      body: '{"company":"A"}',
    })
    expect(res.status).toBe(415)
    expect(await res.json()).toMatchObject({ error: { code: 'unsupported_body_encoding' } })
  })

  it('malformed JSON on PUT returns 400 as well', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/irrelevant`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"company":',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'malformed_body' } })
  })

  it('unknown errors return generic 500 without leaking error details', async () => {
    const { errorHandler } = await import('../src/middleware/errorHandler.js')
    const err = new Error('SECRET sqlite3: table jobs exists ATTACH DATABASE C:\\Users\\secret\\jobs.db')
    let statusCode = -1
    let body: { error?: { code?: string; message?: string } } | null = null
    const fakeRes = {
      status(n: number) { statusCode = n; return this },
      json(b: { error?: { code?: string; message?: string } }) { body = b; return this },
    }
    errorHandler(err, {} as never, fakeRes as never, (() => undefined) as never)
    expect(statusCode).toBe(500)
    expect(body).toMatchObject({ error: { code: 'internal_error' } })
    expect(JSON.stringify(body)).not.toContain('SECRET')
    expect(JSON.stringify(body)).not.toContain('C:\\Users\\secret')
  })
})

describe('POST /api/jobs ignores client id', () => {
  it('always generates a server-side id', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, id: 'CLIENT-ID' })
    const job = dataOf(created) as { id: string }
    expect(created.status).toBe(201)
    expect(job.id).not.toBe('CLIENT-ID')
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/)
    // 清理
    await request('DELETE', `/api/jobs/${job.id}`)
  })
})

describe('import preserves historical ids', () => {
  const LEGACY = [
    {
      id: 'sample-1',
      company: '示例科技（迁移）',
      position: '前端工程师',
      appliedDate: '2026-09-01',
      status: 'applied' as const,
      notes: '历史记录',
    },
    {
      id: 'job-1727700000000-ab12x3',
      company: '虚构云图网络',
      position: 'Vue 开发',
      appliedDate: '2026-09-02',
      status: 'interviewing' as const,
      notes: '历史记录2',
    },
  ]

  it('import keeps legacy non-UUID ids', async () => {
    const res = await request('POST', '/api/jobs/import', LEGACY)
    expect(res.status).toBe(201)
    const inserted = dataOf(res) as { id: string }[]
    expect(inserted.map((j) => j.id)).toEqual(['sample-1', 'job-1727700000000-ab12x3'])

    const get = await request('GET', '/api/jobs/sample-1')
    expect(get.status).toBe(200)
    const restored = dataOf(get) as { company: string; position: string; notes: string }
    expect(restored.company).toBe('示例科技（迁移）')
    expect(restored.position).toBe('前端工程师')
    expect(restored.notes).toBe('历史记录')
  })

  it('retrying the same import batch does not duplicate records', async () => {
    const countBefore = (dataOf(await request('GET', '/api/jobs')) as unknown[]).length
    const res = await request('POST', '/api/jobs/import', LEGACY)
    expect(res.status).toBe(201)
    const after = (dataOf(await request('GET', '/api/jobs')) as { id: string }[]).filter(
      (j) => j.id === 'sample-1' || j.id === 'job-1727700000000-ab12x3'
    )
    expect(after).toHaveLength(2)
    const countAfter = (dataOf(await request('GET', '/api/jobs')) as unknown[]).length
    expect(countAfter).toBe(countBefore)
  })

  it('imported item without id gets a server-generated UUID', async () => {
    const res = await request('POST', '/api/jobs/import', [{ ...NEW_JOB }])
    expect(res.status).toBe(201)
    const job = (dataOf(res) as { id: string }[])[0]
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/)
    await request('DELETE', `/api/jobs/${job.id}`)
  })

  it('id conflict with different content returns 409 and writes nothing', async () => {
    const before = (dataOf(await request('GET', '/api/jobs')) as unknown[]).length
    const res = await request('POST', '/api/jobs/import', [
      { ...LEGACY[0], company: '内容不同', notes: '' },
      { id: 'must-not-exist', ...NEW_JOB, notes: '' },
    ])
    expect(res.status).toBe(409)
    expect(res.data).toMatchObject({ error: { code: 'id_conflict' } })

    const after = (dataOf(await request('GET', '/api/jobs')) as unknown[]).length
    expect(after).toBe(before)

    const missing = await request('GET', '/api/jobs/must-not-exist')
    expect(missing.status).toBe(404)
  })

  it('in-batch duplicate id with different content returns 409', async () => {
    const res = await request('POST', '/api/jobs/import', [
      { id: 'dup-in-batch', ...NEW_JOB },
      { id: 'dup-in-batch', company: '另一个', ...NEW_JOB, notes: '' },
    ])
    expect(res.status).toBe(409)
    expect(res.data).toMatchObject({ error: { code: 'id_conflict' } })
  })

  it('in-batch duplicate id with identical content is idempotent (single row)', async () => {
    const res = await request('POST', '/api/jobs/import', [
      { id: 'dup-equal', ...NEW_JOB },
      { id: 'dup-equal', ...NEW_JOB },
    ])
    expect(res.status).toBe(201)
    const inserted = dataOf(res) as { id: string }[]
    expect(inserted).toHaveLength(2)
    const rows = (dataOf(await request('GET', '/api/jobs')) as { id: string }[]).filter((j) => j.id === 'dup-equal')
    expect(rows).toHaveLength(1)
    await request('DELETE', '/api/jobs/dup-equal')
  })

  it('invalid id format returns 400 invalid_id', async () => {
    const bad1 = await request('POST', '/api/jobs/import', [{ id: 'a b', ...NEW_JOB }])
    expect(bad1.status).toBe(400)
    expect(bad1.data).toMatchObject({ error: { code: 'invalid_id' } })

    const bad2 = await request('POST', '/api/jobs/import', [{ id: 'x'.repeat(65), ...NEW_JOB }])
    expect(bad2.status).toBe(400)
    expect(bad2.data).toMatchObject({ error: { code: 'invalid_id' } })

    const okMaxLength = await request('POST', '/api/jobs/import', [{ id: 'x'.repeat(64), ...NEW_JOB }])
    expect(okMaxLength.status).toBe(201)
    await request('DELETE', '/api/jobs/' + 'x'.repeat(64))
  })
})

// persistence 必须放在该文件最后：它关闭并重开数据库连接，
// 后续对同一连接的 API 请求都会失败。
/**
 * P2-A：Repository/Service 顺序分配与计数器接入（设计文档 v2.1 §2.3/§2.4）。
 * API 响应不包含 sort_order（Job 五字段契约不变），顺序号经由数据库直读断言；
 * 计数器篡改类用例必须在 finally 中恢复原值，避免污染同文件后续用例。
 */
describe('P2-A order allocation & counter integration', () => {
  const COUNTER_KEY = 'next_sort_order'

  function counterValue(): string {
    const row = db!.prepare('SELECT value FROM meta WHERE key = ?').get(COUNTER_KEY) as { value: string }
    return row.value
  }
  function setCounter(value: string): void {
    db!.prepare('UPDATE meta SET value = ? WHERE key = ?').run(value, COUNTER_KEY)
  }
  function sortOrderOf(id: string): number | undefined {
    const row = db!.prepare('SELECT sort_order FROM jobs WHERE id = ?').get(id) as
      | { sort_order: number }
      | undefined
    return row?.sort_order
  }
  function jobCount(): number {
    return (db!.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c
  }
  function deleteJobViaApi(id: string): Promise<unknown> {
    return request('DELETE', `/api/jobs/${id}`)
  }

  it('valid create returns 201 with sort_order = counter value, counter advances by exactly one', async () => {
    const before = counterValue()
    const res = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-create-1' })
    expect(res.status).toBe(201)
    const job = dataOf(res) as { id: string }
    expect(sortOrderOf(job.id)).toBe(Number(before))
    expect(Number(counterValue())).toBe(Number(before) + 1)
  })

  it('consecutive creates get consecutive increasing sort_order', async () => {
    const before = counterValue()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const res = await request('POST', '/api/jobs', { ...NEW_JOB, notes: `p2a-seq-${i}` })
      expect(res.status).toBe(201)
      ids.push((dataOf(res) as { id: string }).id)
    }
    expect(sortOrderOf(ids[0])).toBe(Number(before))
    expect(sortOrderOf(ids[1])).toBe(Number(before) + 1)
    expect(sortOrderOf(ids[2])).toBe(Number(before) + 2)
    expect(Number(counterValue())).toBe(Number(before) + 3)
  })

  it('deleting the max-sort record does not let a new create reuse that slot; delete leaves the counter untouched', async () => {
    const first = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-slot-a' })
    const second = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-slot-b' })
    const idA = (dataOf(first) as { id: string }).id
    const idB = (dataOf(second) as { id: string }).id
    const sortB = sortOrderOf(idB)
    expect(sortB).toBeGreaterThan(sortOrderOf(idA)!)

    const counterBeforeDelete = counterValue()
    const del = await deleteJobViaApi(idB)
    expect(del).toMatchObject({ status: 200 })
    expect(counterValue()).toBe(counterBeforeDelete)
    expect(sortOrderOf(idB)).toBeUndefined()

    const recreated = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-slot-c' })
    expect(recreated.status).toBe(201)
    const idC = (dataOf(recreated) as { id: string }).id
    expect(sortOrderOf(idC)).toBe(Number(counterBeforeDelete))
    expect(sortOrderOf(idC)).not.toBe(sortB)
  })

  it('valid bulk import allocates consecutive sort_order in batch order', async () => {
    const before = counterValue()
    const res = await request('POST', '/api/jobs/import', [
      { id: 'p2a-i1', ...NEW_JOB, notes: 'p2a-i1' },
      { id: 'p2a-i2', ...NEW_JOB, notes: 'p2a-i2' },
      { id: 'p2a-i3', ...NEW_JOB, notes: 'p2a-i3' },
    ])
    expect(res.status).toBe(201)
    expect(sortOrderOf('p2a-i1')).toBe(Number(before))
    expect(sortOrderOf('p2a-i2')).toBe(Number(before) + 1)
    expect(sortOrderOf('p2a-i3')).toBe(Number(before) + 2)
    expect(Number(counterValue())).toBe(Number(before) + 3)
  })

  it('idempotent import keeps sort_order and consumes no counter', async () => {
    const before = counterValue()
    const so = { i1: sortOrderOf('p2a-i1'), i2: sortOrderOf('p2a-i2'), i3: sortOrderOf('p2a-i3') }
    const rowsBefore = jobCount()

    const res = await request('POST', '/api/jobs/import', [
      { id: 'p2a-i1', ...NEW_JOB, notes: 'p2a-i1' },
      { id: 'p2a-i2', ...NEW_JOB, notes: 'p2a-i2' },
      { id: 'p2a-i3', ...NEW_JOB, notes: 'p2a-i3' },
    ])
    expect(res.status).toBe(201)

    expect(counterValue()).toBe(before)
    expect(sortOrderOf('p2a-i1')).toBe(so.i1)
    expect(sortOrderOf('p2a-i2')).toBe(so.i2)
    expect(sortOrderOf('p2a-i3')).toBe(so.i3)
    expect(jobCount()).toBe(rowsBefore)
  })

  it('import with an id conflict rolls back the whole batch and leaves the counter unchanged', async () => {
    const before = counterValue()
    const soExisting = sortOrderOf('p2a-i1')
    const rowsBefore = jobCount()

    const res = await request('POST', '/api/jobs/import', [
      { id: 'p2a-fresh', ...NEW_JOB, notes: 'p2a-fresh' },
      { id: 'p2a-i1', ...NEW_JOB, notes: 'content-differs' },
    ])
    expect(res).toMatchObject({ status: 409 })
    expect(res.data).toMatchObject({ error: { code: 'id_conflict' } })

    expect(counterValue()).toBe(before)
    expect(sortOrderOf('p2a-i1')).toBe(soExisting)
    expect(sortOrderOf('p2a-fresh')).toBeUndefined()
    expect(jobCount()).toBe(rowsBefore)
  })

  it('tampered counter value fails writes with rollback and no partial writes', async () => {
    const before = counterValue()
    const rowsBefore = jobCount()
    try {
      setCounter('abc')
      const r1 = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-tamper-create' })
      expect(r1).toMatchObject({ status: 500 })
      expect(r1.data).toMatchObject({ error: { code: 'internal_error' } })
      const r2 = await request('POST', '/api/jobs/import', [{ id: 'p2a-tamper-import', ...NEW_JOB }])
      expect(r2).toMatchObject({ status: 500 })
      expect(counterValue()).toBe('abc')
      expect(jobCount()).toBe(rowsBefore)
      expect(sortOrderOf('p2a-tamper-import')).toBeUndefined()
    } finally {
      setCounter(before)
    }
    expect(counterValue()).toBe(before)
    expect(jobCount()).toBe(rowsBefore)
  })

  it('counter not higher than existing MAX(sort_order) fails the write transaction and rolls back', async () => {
    const seed = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-low-counter' })
    expect(seed.status).toBe(201)
    const idSeed = (dataOf(seed) as { id: string }).id
    const sortSeed = sortOrderOf(idSeed)!
    const counterAfterSeed = counterValue()
    const rowsBefore = jobCount()
    try {
      setCounter(String(sortSeed))
      const res = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-lowcounter-create' })
      expect(res).toMatchObject({ status: 500 })
      expect(counterValue()).toBe(String(sortSeed))
      expect(jobCount()).toBe(rowsBefore)
      expect(sortOrderOf('p2a-lowcounter-create')).toBeUndefined()
    } finally {
      setCounter(counterAfterSeed)
    }
    expect(counterValue()).toBe(counterAfterSeed)
    expect(jobCount()).toBe(rowsBefore)
  })

  it('PUT edit keeps sort_order intact', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-put-original' })
    const id = (dataOf(created) as { id: string }).id
    const before = sortOrderOf(id)!

    const res = await request('PUT', `/api/jobs/${id}`, { ...NEW_JOB, status: 'offer', notes: 'p2a-put-edited' })
    expect(res.status).toBe(200)
    expect((dataOf(res) as { status: string }).status).toBe('offer')
    expect(sortOrderOf(id)).toBe(before)
  })

  it('safe-integer limit: allocation refuses with full rollback and no partial writes', async () => {
    const LIMIT = '9007199254740991'
    const before = counterValue()
    const rowsBefore = jobCount()
    let boundaryId: string | undefined
    try {
      setCounter(LIMIT)
      const refused = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-limit-refused' })
      expect(refused).toMatchObject({ status: 500 })
      expect(counterValue()).toBe(LIMIT)
      expect(jobCount()).toBe(rowsBefore)

      // 恰好低于上限一次分配可以成功；随后到达上限再次拒绝
      setCounter('9007199254740990')
      const ok = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-limit-boundary' })
      expect(ok.status).toBe(201)
      boundaryId = (dataOf(ok) as { id: string }).id
      expect(sortOrderOf(boundaryId)).toBe(9007199254740990)
      expect(counterValue()).toBe(LIMIT)

      const refusedAgain = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2a-limit-refused-2' })
      expect(refusedAgain).toMatchObject({ status: 500 })
      expect(counterValue()).toBe(LIMIT)
      expect(jobCount()).toBe(rowsBefore + 1)
    } finally {
      if (boundaryId !== undefined) {
        await deleteJobViaApi(boundaryId)
      }
      setCounter(before)
    }
    expect(jobCount()).toBe(rowsBefore)
    expect(counterValue()).toBe(before)
  })
})

/**
 * P2-B：DELETE 200 删除快照（设计文档 v2.1 §4.2）。
 * 快照经单语句 RETURNING 产生（不回查拼装）；计数器与既有序号槽位保持不动。
 */
describe('P2-B delete snapshot', () => {
  const COUNTER_KEY = 'next_sort_order'

  function counterValue(): string {
    const row = db!.prepare('SELECT value FROM meta WHERE key = ?').get(COUNTER_KEY) as { value: string }
    return row.value
  }

  it('snapshot integrity: business fields, sortOrder, createdAt, updatedAt are identical to the row just before deletion', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2b-snapshot', status: 'offer' })
    const id = (dataOf(created) as { id: string }).id
    const before = db!.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown>

    const res = await request('DELETE', `/api/jobs/${id}`)
    expect(res.status).toBe(200)
    const snapshot = dataOf(res) as Record<string, unknown>
    expect(snapshot).toEqual({
      id,
      company: before.company,
      position: before.position,
      appliedDate: before.applied_date,
      status: before.status,
      notes: before.notes,
      sortOrder: before.sort_order,
      createdAt: before.created_at,
      updatedAt: before.updated_at,
    })
  })

  it('DELETE leaves next_sort_order unchanged', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2b-counter' })
    const id = (dataOf(created) as { id: string }).id
    const before = counterValue()

    const res = await request('DELETE', `/api/jobs/${id}`)
    expect(res.status).toBe(200)
    expect(counterValue()).toBe(before)
  })

  it('deleting the highest sort_order then creating reuses no deleted slot (counter keeps the hole)', async () => {
    const first = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2b-high-a' })
    const second = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2b-high-b' })
    const idA = (dataOf(first) as { id: string }).id
    const idB = (dataOf(second) as { id: string }).id
    const sortB = (db!.prepare('SELECT sort_order FROM jobs WHERE id = ?').get(idB) as { sort_order: number }).sort_order

    const counterBeforeDelete = counterValue()
    const del = await request('DELETE', `/api/jobs/${idB}`)
    expect(del.status).toBe(200)
    expect(counterValue()).toBe(counterBeforeDelete)

    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2b-high-c' })
    const idC = (dataOf(created) as { id: string }).id
    const sortC = (db!.prepare('SELECT sort_order FROM jobs WHERE id = ?').get(idC) as { sort_order: number }).sort_order
    expect(sortC).toBe(Number(counterBeforeDelete))
    expect(sortC).toBeGreaterThan(sortB)
    void idA
  })

  it('database failure during DELETE: no partial delete, snapshot not lost, counter unchanged', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2b-fail' })
    const id = (dataOf(created) as { id: string }).id
    const counterBefore = counterValue()
    db!.exec(`CREATE TRIGGER trg_p2b_fail BEFORE DELETE ON jobs BEGIN SELECT RAISE(ABORT,'p2b-injected-delete'); END`)
    try {
      const res = await request('DELETE', `/api/jobs/${id}`)
      expect(res).toMatchObject({ status: 500 })
      expect(res.data).toMatchObject({ error: { code: 'internal_error' } })
      expect(counterValue()).toBe(counterBefore)
    } finally {
      db!.exec(`DROP TRIGGER trg_p2b_fail`)
    }

    // 记录完好：回滚后可再次成功删除并取得同一快照
    const retry = await request('DELETE', `/api/jobs/${id}`)
    expect(retry.status).toBe(200)
    expect((dataOf(retry) as { id: string }).id).toBe(id)
  })
})

/**
 * P2-C：恢复 API（设计文档 v2.1 §4.3）。
 * DELETE 200 快照 → POST /api/jobs/restore：原槽位空闲恢复原位（计数器不动）；
 * 槽位被占（外部修改等防御分支）→ 计数器同事务追加；id 冲突 409 不覆盖；
 * 时间戳精确保留。涉及数据库篡改的用例一律在 finally 中清理恢复。
 */
describe('P2-C restore API', () => {
  const COUNTER_KEY = 'next_sort_order'
  const TS_A = '2026-10-01T08:15:42.083Z'
  const TS_B = '2026-10-02T09:30:00.500Z'

  function counterValue(): string {
    const row = db!.prepare('SELECT value FROM meta WHERE key = ?').get(COUNTER_KEY) as { value: string }
    return row.value
  }
  function setCounter(value: string): void {
    db!.prepare('UPDATE meta SET value = ? WHERE key = ?').run(value, COUNTER_KEY)
  }
  function rawRow(id: string): Record<string, unknown> | undefined {
    return db!.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  }
  async function deleteAndGetSnapshot(id: string): Promise<Record<string, unknown>> {
    const res = await request('DELETE', `/api/jobs/${id}`)
    expect(res.status).toBe(200)
    return dataOf(res) as Record<string, unknown>
  }

  it('original-slot restore: returns restoredAs original, keeps id/sortOrder, preserves timestamps exactly, counter untouched', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-orig' })
    const id = (dataOf(created) as { id: string }).id
    const snapshot = await deleteAndGetSnapshot(id)

    const before = counterValue()
    const res = await request('POST', '/api/jobs/restore', { record: snapshot })
    expect(res.status).toBe(201)
    const restored = dataOf(res) as Record<string, unknown>
    // P2-C-FIX：整对象断言——响应恰好只含既定 8 字段，不含 createdAt/updatedAt
    expect(restored).toEqual({
      id,
      company: snapshot.company,
      position: snapshot.position,
      appliedDate: snapshot.appliedDate,
      status: snapshot.status,
      notes: snapshot.notes,
      sortOrder: snapshot.sortOrder,
      restoredAs: 'original',
    })
    expect(counterValue()).toBe(before)

    const row = rawRow(id)!
    expect(row.id).toBe(id)
    expect(row.sort_order).toBe(snapshot.sortOrder)
    expect(row.created_at).toBe(snapshot.createdAt)
    expect(row.updated_at).toBe(snapshot.updatedAt)
    const fetched = await request('GET', `/api/jobs/${id}`)
    expect(fetched.status).toBe(200)
    expect((dataOf(fetched) as { notes: string }).notes).toBe(snapshot.notes)
  })

  it('occupied-slot restore ( Defensive branch): appended via counter, counter advances by exactly one, no overwrite', async () => {
    const createdA = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-occ-a' })
    const createdB = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-occ-b' })
    const idA = (dataOf(createdA) as { id: string }).id
    const idB = (dataOf(createdB) as { id: string }).id
    const sortBOriginal = (rawRow(idB) as { sort_order: number }).sort_order
    const snapshotA = await deleteAndGetSnapshot(idA)
    const sortA = snapshotA.sortOrder as number

    // 防御分支注记：正常流程槽位不可达，此处模拟外部改库占用原槽位
    db!.prepare('UPDATE jobs SET sort_order = ? WHERE id = ?').run(sortA, idB)

    const before = counterValue()
    const res = await request('POST', '/api/jobs/restore', { record: snapshotA })
    expect(res.status).toBe(201)
    const restored = dataOf(res) as Record<string, unknown>
    // P2-C-FIX：整对象断言——追加路径同样恰好只含既定 8 字段
    expect(restored).toEqual({
      id: idA,
      company: snapshotA.company,
      position: snapshotA.position,
      appliedDate: snapshotA.appliedDate,
      status: snapshotA.status,
      notes: snapshotA.notes,
      sortOrder: Number(before),
      restoredAs: 'appended',
    })
    expect(Number(counterValue())).toBe(Number(before) + 1)

    // 占用者数据完好（未被覆盖）
    const holder = rawRow(idB)!
    expect(holder.company).toBe('示例科技')
    expect(holder.created_at).toBe((rawRow(idB) as { created_at: string }).created_at)
    // 时间戳精确保留
    expect((rawRow(idA) as { created_at: string }).created_at).toBe(snapshotA.createdAt)
    expect((rawRow(idA) as { updated_at: string }).updated_at).toBe(snapshotA.updatedAt)

    // 清理：删除恢复行并把占用者顺序号还原
    await deleteAndGetSnapshot(idA)
    db!.prepare('UPDATE jobs SET sort_order = ? WHERE id = ?').run(sortBOriginal, idB)
  })

  it('id conflict: restoring when id exists returns 409 and the existing record is completely unchanged', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-conflict' })
    const id = (dataOf(created) as { id: string }).id
    const snapshot = await deleteAndGetSnapshot(id)
    const res1 = await request('POST', '/api/jobs/restore', { record: snapshot })
    expect(res1.status).toBe(201)

    const rowBefore = rawRow(id)
    const res2 = await request('POST', '/api/jobs/restore', { record: snapshot })
    expect(res2).toMatchObject({ status: 409 })
    expect(res2.data).toMatchObject({ error: { code: 'id_conflict' } })
    expect(rawRow(id)).toEqual(rowBefore)
  })

  it('transaction failure paths: insert failure and counter-update failure both roll back fully', async () => {
    const createdA = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-fail-a' })
    const createdC = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-fail-c' })
    const idA = (dataOf(createdA) as { id: string }).id
    const idC = (dataOf(createdC) as { id: string }).id
    const sortCOriginal = (rawRow(idC) as { sort_order: number }).sort_order
    const snapshotA = await deleteAndGetSnapshot(idA)
    db!.prepare('UPDATE jobs SET sort_order = ? WHERE id = ?').run(snapshotA.sortOrder, idC)

    const counterBefore = counterValue()
    const rowsBefore = (db!.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c

    // 失败注记一：INSERT 阶段失败
    db!.exec(`CREATE TRIGGER trg_p2c_fail_insert BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT,'p2c-injected'); END`)
    try {
      const r = await request('POST', '/api/jobs/restore', { record: snapshotA })
      expect(r).toMatchObject({ status: 500 })
      expect(r.data).toMatchObject({ error: { code: 'internal_error' } })
      expect(counterValue()).toBe(counterBefore)
      expect((db!.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c).toBe(rowsBefore)
      expect(rawRow(idA)).toBeUndefined()
    } finally {
      db!.exec('DROP TRIGGER trg_p2c_fail_insert')
    }

    // 失败注记二：计数器推进阶段失败（INSERT 已完成，须连同回滚）
    db!.exec(
      `CREATE TRIGGER trg_p2c_fail_counter AFTER UPDATE ON meta
       WHEN NEW.key = 'next_sort_order' BEGIN SELECT RAISE(ABORT,'p2c-injected-counter'); END`
    )
    try {
      const r = await request('POST', '/api/jobs/restore', { record: snapshotA })
      expect(r).toMatchObject({ status: 500 })
      expect(counterValue()).toBe(counterBefore)
      expect((db!.prepare('SELECT COUNT(*) AS c FROM jobs').get() as { c: number }).c).toBe(rowsBefore)
      expect(rawRow(idA)).toBeUndefined()
    } finally {
      db!.exec('DROP TRIGGER trg_p2c_fail_counter')
    }

    // 回滚后成功路径：同一快照追加恢复成功
    const ok = await request('POST', '/api/jobs/restore', { record: snapshotA })
    expect(ok.status).toBe(201)
    expect((dataOf(ok) as { restoredAs: string }).restoredAs).toBe('appended')

    // 清理：删除恢复行并把占用者顺序号还原
    await deleteAndGetSnapshot(idA)
    db!.prepare('UPDATE jobs SET sort_order = ? WHERE id = ?').run(sortCOriginal, idC)
  })

  it('validation matrix: payload/field/id/length/status/date/sortOrder/timestamp rejections', async () => {
    const snapshot = {
      id: 'p2c-valid',
      company: '示例科技',
      position: '前端工程师',
      appliedDate: '2026-09-01',
      status: 'applied',
      notes: '',
      sortOrder: 1,
      createdAt: TS_A,
      updatedAt: TS_B,
    }
    const expect400 = async (record: unknown, code: string) => {
      const res = await request('POST', '/api/jobs/restore', { record })
      expect(res).toMatchObject({ status: 400 })
      expect(res.data).toMatchObject({ error: { code } })
    }
    await expect400('not-an-object', 'invalid_request')       // record 非对象
    await expect400(undefined, 'invalid_request')             // 缺 record
    await expect400({ ...snapshot, id: undefined as unknown as string }, 'invalid_id')
    await expect400({ ...snapshot, id: 'bad id!' }, 'invalid_id')
    await expect400({ ...snapshot, id: 'a'.repeat(65) }, 'invalid_id')
    await expect400({ ...snapshot, company: '长'.repeat(51) }, 'invalid_company')
    await expect400({ ...snapshot, position: '长'.repeat(51) }, 'invalid_position')
    await expect400({ ...snapshot, status: 'ghost' }, 'invalid_status')
    await expect400({ ...snapshot, notes: 'n'.repeat(201) }, 'invalid_notes')
    await expect400({ ...snapshot, notes: undefined }, 'invalid_notes')
    await expect400({ ...snapshot, appliedDate: '2026-13-01' }, 'invalid_applied_date')
    await expect400({ ...snapshot, appliedDate: '2099-01-01' }, 'invalid_applied_date')
    await expect400({ ...snapshot, sortOrder: 0 }, 'invalid_request')
    await expect400({ ...snapshot, sortOrder: 1.5 }, 'invalid_request')
    await expect400({ ...snapshot, sortOrder: '3' }, 'invalid_request')
    await expect400({ ...snapshot, sortOrder: 99999999999999999999 }, 'invalid_request')
    await expect400({ ...snapshot, createdAt: '2026-10-23' }, 'invalid_request')
    await expect400({ ...snapshot, createdAt: 'not-a-timestamp' }, 'invalid_request')
    await expect400({ ...snapshot, updatedAt: '2026-10-02' }, 'invalid_request')
    // P2-C-FIX：字段越界滚动型非法日历日期（Date.parse 会把 2/30、非闰 2/29 进位，靠回环比对拦截）
    await expect400({ ...snapshot, createdAt: '2026-02-30T08:15:42.083Z' }, 'invalid_request')
    await expect400({ ...snapshot, createdAt: '2026-02-29T08:15:42.083Z' }, 'invalid_request')
    await expect400({ ...snapshot, updatedAt: '2026-02-30T08:15:42.083Z' }, 'invalid_request')
    await expect400({ ...snapshot, updatedAt: '2026-02-29T08:15:42.083Z' }, 'invalid_request')
    // 有效快照作为对照必须可恢复成功，并保证清理
    const ok = await request('POST', '/api/jobs/restore', { record: snapshot })
    expect(ok.status).toBe(201)
    await deleteAndGetSnapshot('p2c-valid')
  })

  it('P2-C-FIX: invalid calendar dates rejected e2e; bad timestamps return 400 and nothing is written', async () => {
    const record = {
      id: 'p2c-leap-bad',
      company: '示例科技',
      position: '前端工程师',
      appliedDate: '2026-09-01',
      status: 'applied',
      notes: '',
      sortOrder: 1,
      createdAt: TS_A,
      updatedAt: TS_B,
    }
    const expect400withNothing = async (patch: Record<string, unknown>) => {
      const res = await request('POST', '/api/jobs/restore', { record: { ...record, ...patch } })
      expect(res).toMatchObject({ status: 400 })
      expect(res.data).toMatchObject({ error: { code: 'invalid_request' } })
      expect(rawRow('p2c-leap-bad')).toBeUndefined()
    }
    await expect400withNothing({ createdAt: '2026-02-30T08:15:42.083Z' })  // 2 月 30 日不存在
    await expect400withNothing({ createdAt: '2026-02-29T08:15:42.083Z' })  // 2026 非闰年
    await expect400withNothing({ updatedAt: '2026-02-30T08:15:42.083Z' })
    await expect400withNothing({ updatedAt: '2026-02-29T08:15:42.083Z' })
  })

  it('P2-C-FIX: valid leap-day timestamps (2024, leap year) accepted e2e and preserved exactly', async () => {
    const created = await request('POST', '/api/jobs', { ...NEW_JOB, notes: 'p2c-leap-good' })
    const id = (dataOf(created) as { id: string }).id
    const snapshot = await deleteAndGetSnapshot(id)
    const leapSnapshot = { ...snapshot, createdAt: '2024-02-29T08:15:42.083Z', updatedAt: '2024-02-29T23:59:59.999Z' }
    const res = await request('POST', '/api/jobs/restore', { record: leapSnapshot })
    expect(res.status).toBe(201)
    // 整对象断言：响应恰好只含既定 8 字段
    expect(dataOf(res)).toEqual({
      id,
      company: snapshot.company,
      position: snapshot.position,
      appliedDate: snapshot.appliedDate,
      status: snapshot.status,
      notes: snapshot.notes,
      sortOrder: snapshot.sortOrder,
      restoredAs: 'original',
    })
    // 闰日规范值在库中逐字节保留
    const row = rawRow(id)!
    expect(row.created_at).toBe('2024-02-29T08:15:42.083Z')
    expect(row.updated_at).toBe('2024-02-29T23:59:59.999Z')
    // 清理
    await deleteAndGetSnapshot(id)
  })
})

describe('persistence', () => {
  it('survives a re-open of the same database file', async () => {
    const created = await request('POST', '/api/jobs', NEW_JOB)
    const job = dataOf(created) as { id: string }

    db!.close()
    const { default: Database } = await import('better-sqlite3')
    const reopened = new Database(DB_PATH)
    const row = reopened
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(job.id) as { company: string; applied_date: string } | undefined
    expect(row).toBeDefined()
    expect(row?.company).toBe(NEW_JOB.company)
    expect(row?.applied_date).toBe(NEW_JOB.appliedDate)
    reopened.close()
  })
})
