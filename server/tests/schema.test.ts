import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type DatabaseConstructor from 'better-sqlite3'

// 与 jobs.test.ts 相同的模式：动态导入必须在设置 JOBTRACK_DATA_DIR 之后
//（src/db 在模块加载时读取它）。本文件同时用该目录承载模块单例库文件，
// 另为每个用例在临时子目录下创建独立的文件型数据库实例，互不共享。
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobtrack-p1-'))
process.env.JOBTRACK_DATA_DIR = tmpRoot

type Dialect = InstanceType<typeof DatabaseConstructor>
type SchemaModule = typeof import('../src/db')

let dbmod: SchemaModule
let DatabaseCtor: typeof DatabaseConstructor
const opened: Dialect[] = []

beforeAll(async () => {
  const mod = (await import('better-sqlite3')) as unknown as { default: typeof DatabaseConstructor }
  DatabaseCtor = mod.default
  dbmod = await import('../src/db')
})

afterAll(async () => {
  for (const d of opened) {
    try { d.close() } catch { /* 已关闭则忽略 */ }
  }
  try { dbmod.db.close() } catch { /* 模块单例可能未初始化连接 */ }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

function newTmpFileDb(name: string): Dialect {
  const dir = fs.mkdtempSync(path.join(tmpRoot, name + '-'))
  const file = path.join(dir, 'jobs.db')
  const d = new DatabaseCtor(file)
  opened.push(d)
  return d
}

const LEGACY_SCHEMA_SQL = `CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  company       TEXT NOT NULL CHECK(length(company)  <= 50),
  position      TEXT NOT NULL CHECK(length(position) <= 50),
  applied_date  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('applied','interviewing','offer','rejected')),
  notes         TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 200),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
)`

function seedLegacyRows(d: Dialect, count: number): void {
  const insert = d.prepare(`INSERT INTO jobs (id, company, position, applied_date, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  for (let i = 1; i <= count; i++) {
    insert.run(
      `seed-${i}`,
      `公司${i}`,
      `职位${i}`,
      `2026-01-0${i}`,
      i === 2 ? 'offer' : 'applied',
      i === 1 ? '备注一' : '',
      `2026-02-01 10:0${i}:00`,
      `2026-02-02 11:0${i}:00`,
    )
  }
}

function collapse(sql: string): string {
  return String(sql).replace(/\s+/g, ' ')
}

type Cell = Record<string, unknown>

function hasColumn(d: Dialect, column: string): boolean {
  return listColumns(d, 'jobs').some((c) => String(c.name) === column)
}

function readMaxSortOrder(d: Dialect): number | null {
  const row = d.prepare(`SELECT MAX(sort_order) AS m FROM jobs`).get() as { m: number | null }
  return row.m === null ? null : row.m
}

function listColumns(d: Dialect, table: string): Cell[] {
  return d.pragma(`table_info(${table})`) as unknown as Cell[]
}

function readJobsById(d: Dialect): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  for (const row of d.prepare(`SELECT * FROM jobs ORDER BY rowid ASC`).all() as Cell[]) {
    out[String(row.id)] = row
  }
  return out
}

function readCounter(d: Dialect): string {
  const row = d.prepare(`SELECT value FROM meta WHERE key = ?`).get(dbmod.COUNTER_KEY) as { value: string } | undefined
  if (row === undefined) throw new Error('计数器键缺失')
  return row.value
}

function setCounter(d: Dialect, value: string): void {
  d.prepare(`UPDATE meta SET value = ? WHERE key = ?`).run(value, dbmod.COUNTER_KEY)
}

function buildLegacyDb(name: string, rowCount: number): Dialect {
  const d = newTmpFileDb(name)
  d.exec(LEGACY_SCHEMA_SQL)
  seedLegacyRows(d, rowCount)
  return d
}

describe('P1：Schema 迁移与持久化顺序计数器（设计文档 v2.1）', () => {
  it('#1 新数据库：完整 Schema（含 sort_order 与 CHECK）、三个非唯一索引、meta 表、计数器初始 1', () => {
    const d = newTmpFileDb('fresh')
    const logs: string[] = []
    dbmod.ensureJobsSchema(d, (m) => logs.push(m))
    expect(logs.some((m) => m.includes('新建数据库'))).toBe(true)

    const cols = listColumns(d, 'jobs').map((c) => String(c.name))
    expect(cols).toEqual([
      'id', 'company', 'position', 'applied_date', 'status', 'notes', 'created_at', 'updated_at', 'sort_order',
    ])
    const jobsSql = d.prepare(`SELECT sql FROM sqlite_master WHERE name = 'jobs'`).get() as { sql: string }
    expect(jobsSql.sql).toContain('sort_order')
    expect(jobsSql.sql).toContain('CHECK(sort_order >= 1)')

    // 自建索引必须存在且全部非唯一；PRIMARY KEY 产生的 sqlite_autoindex 无 sql 文本，直接排除
    const indexRows = d.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs' AND sql IS NOT NULL ORDER BY name`,
    ).all() as { name: string; sql: string }[]
    const indexNames = indexRows.map((r) => r.name).sort()
    expect(indexNames).toEqual(['idx_jobs_applied_date', 'idx_jobs_sort_order', 'idx_jobs_status'])
    for (const r of indexRows) {
      expect(collapse(r.sql).toUpperCase()).not.toContain('UNIQUE')
    }

    const metaTable = d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).get()
    expect(metaTable).toBeDefined()
    expect(readCounter(d)).toBe('1')
  })

  it('#2+#4 旧库迁移：sort_order 按 rowid 确定性回填，计数器 = MAX+1，业务字段与时间戳不变', () => {
    const d = buildLegacyDb('legacy-seeded', 3)
    const logs: string[] = []
    dbmod.ensureJobsSchema(d, (m) => logs.push(m))
    expect(logs.some((m) => m.includes('旧库迁移完成'))).toBe(true)

    const rows = readJobsById(d)
    expect(Object.keys(rows).sort()).toEqual(['seed-1', 'seed-2', 'seed-3'])
    expect(rows['seed-1'].sort_order).toBe(1)
    expect(rows['seed-2'].sort_order).toBe(2)
    expect(rows['seed-3'].sort_order).toBe(3)
    expect(rows['seed-1'].company).toBe('公司1')
    expect(rows['seed-2'].status).toBe('offer')
    expect(rows['seed-1'].notes).toBe('备注一')
    expect(rows['seed-2'].notes).toBe('')
    expect(rows['seed-1'].created_at).toBe('2026-02-01 10:01:00')
    expect(rows['seed-3'].updated_at).toBe('2026-02-02 11:03:00')
    expect(readCounter(d)).toBe('4')
  })

  it('#3 空库：新库路径计数器为 1，旧库路径迁移后计数器也为 1', () => {
    const fresh = newTmpFileDb('empty-fresh')
    dbmod.ensureJobsSchema(fresh)
    expect(readCounter(fresh)).toBe('1')

    const legacyEmpty = newTmpFileDb('empty-legacy')
    legacyEmpty.exec(LEGACY_SCHEMA_SQL)
    seedLegacyRows(legacyEmpty, 0)
    dbmod.ensureJobsSchema(legacyEmpty)
    expect(hasColumn(legacyEmpty, 'sort_order')).toBe(true)
    expect(readMaxSortOrder(legacyEmpty)).toBe(null)
    expect(readCounter(legacyEmpty)).toBe('1')
  })

  it('#5 重复初始化幂等：不重复加列/建索引/破坏数据，也不重算计数器', () => {
    const d = buildLegacyDb('idempotent', 3)
    dbmod.ensureJobsSchema(d)
    dbmod.ensureJobsSchema(d)
    dbmod.ensureJobsSchema(d)

    const colDefs = listColumns(d, 'jobs').filter((c) => String(c.name) === 'sort_order')
    expect(colDefs.length).toBe(1)
    expect(listColumns(d, 'meta').map((c) => String(c.name))).toEqual(['key', 'value'])
    const idxCount = d.prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'index' AND name = 'idx_jobs_sort_order'`,
    ).get() as { c: number }
    expect(idxCount.c).toBe(1)
    const rows = readJobsById(d)
    expect(rows['seed-1'].sort_order).toBe(1)
    expect(rows['seed-2'].sort_order).toBe(2)
    expect(rows['seed-3'].sort_order).toBe(3)
    expect(rows['seed-1'].created_at).toBe('2026-02-01 10:01:00')
    expect(readCounter(d)).toBe('4')
  })

  it('#6 计数器键缺失：同一事务内防御性重建（非空 MAX+1、空库 1）并写日志', () => {
    const nonEmpty = buildLegacyDb('rebuild-nonempty', 3)
    dbmod.ensureJobsSchema(nonEmpty)
    nonEmpty.prepare(`DELETE FROM meta WHERE key = ?`).run(dbmod.COUNTER_KEY)
    const logs: string[] = []
    dbmod.ensureJobsSchema(nonEmpty, (m) => logs.push(m))
    expect(logs.some((m) => m.includes('重建'))).toBe(true)
    expect(readCounter(nonEmpty)).toBe('4')
    expect(readJobsById(nonEmpty)['seed-3'].sort_order).toBe(3)

    const emptyNew = newTmpFileDb('rebuild-empty')
    dbmod.ensureJobsSchema(emptyNew)
    emptyNew.prepare(`DELETE FROM meta WHERE key = ?`).run(dbmod.COUNTER_KEY)
    const logs2: string[] = []
    dbmod.ensureJobsSchema(emptyNew, (m) => logs2.push(m))
    expect(readCounter(emptyNew)).toBe('1')
    expect(logs2.some((m) => m.includes('重建'))).toBe(true)
  })

  it('#7 计数器值非法（非数字/0/负数/溢出）：拒绝启动，不覆盖、不改数据', () => {
    const invalidValues = ['abc', '0', '-2', '1.5', '', '9007199254740992', '99999999999999999999']
    for (const value of invalidValues) {
      const d = buildLegacyDb('invalid-' + value.replace(/[^a-zA-Z0-9]/g, '_'), 3)
      dbmod.ensureJobsSchema(d)
      setCounter(d, value)
      let thrown: Error | undefined
      try { dbmod.ensureJobsSchema(d) } catch (e) { thrown = e as Error }
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown?.message).toContain('拒绝启动')
      if (value !== '') {
        expect(thrown?.message).toContain(value)
      }
      expect(thrown?.message).toContain('MAX(sort_order)')
      d.close()
    }
    // 不覆盖：拒绝后 meta 值保持原样，记录完好
    const d = buildLegacyDb('invalid-abc-kept', 3)
    dbmod.ensureJobsSchema(d)
    setCounter(d, 'abc')
    try { dbmod.ensureJobsSchema(d) } catch { /* 期望拒绝 */ }
    expect(readCounter(d)).toBe('abc')
    const rows = readJobsById(d)
    expect(Object.keys(rows).length).toBe(3)
    expect(rows['seed-1'].sort_order).toBe(1)
  })

  it('#8 计数器 <= 现存 MAX(sort_order)：拒绝启动并报告两侧实际值', () => {
    for (const value of ['3', '2', '1']) {
      const d = buildLegacyDb('low-counter-' + value, 3)
      dbmod.ensureJobsSchema(d)
      setCounter(d, value)
      let thrown: Error | undefined
      try { dbmod.ensureJobsSchema(d) } catch (e) { thrown = e as Error }
      expect(thrown?.message).toContain('拒绝启动')
      expect(thrown?.message).toContain(String(Number(value)))
      expect(thrown?.message).toContain('MAX(sort_order)=3')
      d.close()
    }
    // '4'（= MAX+1）是合法持久值，正常启动不重算
    const ok = buildLegacyDb('boundary-max-plus-one', 3)
    dbmod.ensureJobsSchema(ok)
    expect(readCounter(ok)).toBe('4')
    dbmod.ensureJobsSchema(ok)
    expect(readCounter(ok)).toBe('4')
  })

  it('#9 迁移失败（RAISE(ABORT) 注入）：事务回滚无残留，重跑迁移完整成功', () => {
    const d = buildLegacyDb('fail-retry', 3)
    d.exec(`CREATE TRIGGER trg_p1_fail BEFORE UPDATE ON jobs BEGIN SELECT RAISE(ABORT,'p1-injected-update'); END`)
    let thrown: Error | undefined
    try { dbmod.ensureJobsSchema(d) } catch (e) { thrown = e as Error }
    expect(thrown?.message).toContain('p1-injected-update')
    // 回滚验证：无新列、无 meta 表、旧记录完好（亦证明时间戳未被改动）
    expect(hasColumn(d, 'sort_order')).toBe(false)
    const metaTable = d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).get()
    expect(metaTable).toBeUndefined()
    const rows = readJobsById(d)
    expect(Object.keys(rows).length).toBe(3)
    expect(rows['seed-1'].created_at).toBe('2026-02-01 10:01:00')
    expect(rows['seed-3'].sort_order).toBeUndefined()

    // 重试：移除注入后完整迁移成功
    d.exec(`DROP TRIGGER trg_p1_fail`)
    dbmod.ensureJobsSchema(d)
    expect(hasColumn(d, 'sort_order')).toBe(true)
    expect(readCounter(d)).toBe('4')
    expect(readJobsById(d)['seed-2'].sort_order).toBe(2)
  })

  it('#10 正常启动不重算：合法计数器优先于现存 MAX（含空表历史高水位场景）', () => {
    const withRows = buildLegacyDb('no-recompute', 3)
    dbmod.ensureJobsSchema(withRows)
    setCounter(withRows, '7')
    const logs: string[] = []
    dbmod.ensureJobsSchema(withRows, (m) => logs.push(m))
    expect(readCounter(withRows)).toBe('7')
    expect(logs.some((m) => m.includes('重建'))).toBe(false)
    expect(hasColumn(withRows, 'sort_order')).toBe(true)

    const emptyWithHistory = newTmpFileDb('empty-history-counter')
    dbmod.ensureJobsSchema(emptyWithHistory)
    setCounter(emptyWithHistory, '5')
    dbmod.ensureJobsSchema(emptyWithHistory)
    expect(readCounter(emptyWithHistory)).toBe('5')
  })

  it('模块单例：initDb() 完成同样的初始化且重复调用安全', async () => {
    const { initDb, db: singleton, DB_PATH } = dbmod
    expect(DB_PATH).toContain(tmpRoot)
    initDb()
    expect(listColumns(singleton, 'jobs').map((c) => String(c.name))).toContain('sort_order')
    expect(readCounter(singleton)).toBe('1')
    initDb()
    initDb()
    const colDefs = listColumns(singleton, 'jobs').filter((c) => String(c.name) === 'sort_order')
    expect(colDefs.length).toBe(1)
    expect(readCounter(singleton)).toBe('1')
  })
})
