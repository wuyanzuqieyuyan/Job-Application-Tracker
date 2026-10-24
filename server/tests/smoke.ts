import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

process.env.JOBTRACK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrack-smoke-'))

const { createApp } = await import('../src/app')
const { initDb } = await import('../src/db')

initDb()
const app = createApp()

function fail(name: string, got: number, expected: number) {
  console.error(`${name}: expected ${expected} got ${got}`)
  process.exitCode = 1
}

const server = app.listen(0, '127.0.0.1', async () => {
  const addr = server.address() as { port: number }
  const base = `http://127.0.0.1:${addr.port}`
  try {
    const r1 = await fetch(`${base}/api/health`)
    if (r1.status === 200 && (await r1.json()).ok === true) {
      console.log('health: OK')
    } else { fail('health', r1.status, 200); exit() }

    const r2 = await fetch(`${base}/api/jobs`)
    const list = (await r2.json()).data
    if (r2.status === 200 && Array.isArray(list)) {
      console.log(`list: OK (${list.length} records, expected 0 on fresh db)`)
      if (list.length !== 0) fail('list-nonempty', list.length, 0)
    } else { fail('list', r2.status, 200); exit() }

    const r3 = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: '示例科技', position: '前端工程师', appliedDate: '2026-09-01', status: 'applied', notes: '' }),
    })
    const created = (await r3.json()) as { data: { id: string } }
    if (r3.status === 201 && created.data.id) { console.log('create: OK', created.data.id) } else { fail('create', r3.status, 201); exit() }
    const id = created.data.id

    const r4 = await fetch(`${base}/api/jobs/${id}`)
    if (r4.status === 200) { console.log('get: OK') } else { fail('get', r4.status, 200); exit() }

    const r5 = await fetch(`${base}/api/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: '示例科技', position: '前端工程师', appliedDate: '2026-09-01', status: 'offer', notes: 'offer' }),
    })
    if (r5.status === 200 && (await r5.json()).data.status === 'offer') { console.log('update: OK') } else { fail('update', r5.status, 200); exit() }

    const r6 = await fetch(`${base}/api/jobs/${id}`, { method: 'DELETE' })
    const deleted = (await r6.json()) as { data: Record<string, unknown> }
    if (
      r6.status === 200 &&
      deleted.data.id === id &&
      deleted.data.company === '示例科技' &&
      deleted.data.position === '前端工程师' &&
      deleted.data.appliedDate === '2026-09-01' &&
      deleted.data.status === 'offer' &&
      typeof deleted.data.sortOrder === 'number' &&
      typeof deleted.data.createdAt === 'string' &&
      typeof deleted.data.updatedAt === 'string'
    ) {
      console.log('delete: OK (snapshot, restoredAs-free 9-field DeletedJobSnapshot)')
    } else { fail('delete-snapshot', r6.status, 200); exit() }

    const r7 = await fetch(`${base}/api/jobs/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: deleted.data }),
    })
    const restoredData = (await r7.json()) as { data: { id: string; restoredAs: string; sortOrder: unknown } }
    if (
      r7.status === 201 &&
      restoredData.data.id === id &&
      (restoredData.data.restoredAs === 'original' || restoredData.data.restoredAs === 'appended') &&
      typeof restoredData.data.sortOrder === 'number'
    ) {
      console.log(`restore: OK (${restoredData.data.restoredAs}, sortOrder=${restoredData.data.sortOrder})`)
    } else { fail('restore', r7.status, 201); exit() }

    const r8 = await fetch(`${base}/api/jobs/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: deleted.data }),
    })
    const conflictBody = (await r8.json()) as { error: { code: string } }
    if (r8.status === 409 && conflictBody.error.code === 'id_conflict') {
      console.log('restore-duplicate: OK (409 id_conflict)')
    } else { fail('restore-duplicate', r8.status, 409); exit() }

    const r9 = await fetch(`${base}/api/jobs/nope`)
    if (r9.status === 404 && (await r9.json()).error.code === 'job_not_found') { console.log('get-404: OK') } else { fail('get-404', r9.status, 404); exit() }

    const r10 = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"company":""}' })
    if (r10.status === 400) { console.log('post-400: OK') } else { fail('post-400', r10.status, 400); exit() }

    console.log('smoke result:', process.exitCode ? 'FAILED' : 'ALL OK')
    exit()
  } finally {
    server.close()
  }
})

function exit() {
  process.exit(process.exitCode ?? 0)
}
