import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 项目本地数据目录。优先使用环境变量 JOBTRACK_DATA_DIR，否则使用
 * server/data（即后端进程工作目录下的 data 子目录）。数据库文件不
 * 会提交到 Git（见 .gitignore）。
 */
const DATA_DIR = process.env.JOBTRACK_DATA_DIR || path.join(process.cwd(), 'data')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export const DB_PATH = path.join(DATA_DIR, 'jobs.db')

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

/**
 * 高水位顺序计数器：持久化于 meta 表，
 * value 为十进制整数字符串，语义"下一个可分配的 sort_order"。
 */
export const COUNTER_KEY = 'next_sort_order'

/** 计数器上限按 JS 侧对账口径取安全整数 2^53-1。 */
const COUNTER_LIMIT = Number.MAX_SAFE_INTEGER

export class CounterInitError extends Error {}

/** 写路径计数器拒绝（分配不合法/达上限/持久值损坏）→ 调用方事务整体回滚 → 500。 */
export class CounterWriteError extends Error {}

type LogSink = (message: string) => void

const META_TABLE_SQL = `CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

const JOBS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  company       TEXT NOT NULL CHECK(length(company)  <= 50),
  position      TEXT NOT NULL CHECK(length(position) <= 50),
  applied_date  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('applied','interviewing','offer','rejected')),
  notes         TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 200),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sort_order    INTEGER NOT NULL CHECK(sort_order >= 1)
)`

const INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_jobs_status        ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_applied_date  ON jobs(applied_date);
  CREATE INDEX IF NOT EXISTS idx_jobs_sort_order    ON jobs(sort_order);
`

function jobsTableExists(target: Database.Database): boolean {
  return (
    target.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs'`).get() !== undefined
  )
}

function hasSortOrderColumn(target: Database.Database): boolean {
  const columns = target.pragma('table_info(jobs)') as { name: string }[]
  return columns.some((column) => column.name === 'sort_order')
}

function readMaxSortOrder(target: Database.Database): number | null {
  const row = target.prepare(`SELECT MAX(sort_order) AS m FROM jobs`).get() as { m: number | null }
  return row.m === null ? null : row.m
}

/**
 * 校验持久化计数器值：
 * 十进制纯数字字符串、整数值 ∈ [1, 2^53-1]，且存有记录时须 ≥ MAX(sort_order)+1。
 * 任一违规 → 拒绝启动（不静默覆盖、不自动抬升），诊断信息包含当前值与 MAX 值。
 */
function validatePersistedCounter(raw: unknown, max: number | null): number {
  const rawText = String(raw)
  if (typeof raw !== 'string' || !/^\d+$/.test(rawText)) {
    throw new CounterInitError(
      `[jobtrack-db]拒绝启动：meta.${COUNTER_KEY} 非十进制纯数字字符串（实际值 ${rawText}）。` +
      `无法与历史高水位对账，请人工排查；jobs 表 MAX(sort_order)=${max === null ? '空表' : max}`
    )
  }
  const value = Number(rawText)
  if (!Number.isInteger(value) || value < 1) {
    throw new CounterInitError(
      `[jobtrack-db]拒绝启动：meta.${COUNTER_KEY}=${rawText} 不是不小于 1 的整数，` +
      `无法与历史高水位对账，请人工排查；jobs 表 MAX(sort_order)=${max === null ? '空表' : max}`
    )
  }
  if (value > COUNTER_LIMIT) {
    throw new CounterInitError(
      `[jobtrack-db]拒绝启动：meta.${COUNTER_KEY}=${rawText} 超出 JS 安全整数上限 ${COUNTER_LIMIT}；` +
      `请人工排查；jobs 表 MAX(sort_order)=${max === null ? '空表' : max}`
    )
  }
  if (max !== null && value <= max) {
    throw new CounterInitError(
      `[jobtrack-db]拒绝启动：meta.${COUNTER_KEY}=${value} 不高于现存 MAX(sort_order)=${max}，` +
      `属于数据不一致（可能引入槽位复用），拒绝静默抬升；请人工排查外部篡改或迁移缺陷`
    )
  }
  return value
}

/**
 * 读取持久化计数器并校验；键缺失时按 §2.3 规则在同一事务内重建（启动自愈）：
 * 非空表 → MAX(sort_order)+1；空表 → 1。重建动作写日志。绝不依据 MAX 重算已有合法键值。
 */
function ensureMetaAndCounter(target: Database.Database, log: LogSink): void {
  target.exec(META_TABLE_SQL)
  const row = target.prepare(`SELECT value FROM meta WHERE key = ?`).get(COUNTER_KEY) as
    | { value: string }
    | undefined
  const max = readMaxSortOrder(target)

  if (row === undefined) {
    if (max !== null && max >= COUNTER_LIMIT) {
      throw new CounterInitError(
        `[jobtrack-db]拒绝启动：jobs 表 MAX(sort_order)=${max} 已达 JS 安全整数上限，` +
        `无法重建 meta.${COUNTER_KEY}，请人工排查`
      )
    }
    const next = max === null ? 1 : max + 1
    target.transaction(() => {
      target.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(COUNTER_KEY, String(next))
    })()
    log(
      `[jobtrack-db]meta.${COUNTER_KEY} 缺失（仅可能因人工删除触发），已按现存数据重建为 ${next}` +
      `（jobs 表 MAX(sort_order)=${max === null ? '空表' : max}）`
    )
    return
  }

  validatePersistedCounter(row.value, max)
}

/**
 * Schema 初始化与旧库迁移：
 * - 新库：完整 schema（含 sort_order 与 CHECK）+ 三个索引 + meta 表，计数器初始 1；
 *   全部在同一事务内完成，失败整体回滚、下次启动重跑。
 * - 旧库（缺 sort_order 列）：PRAGMA table_info 检测；ALTER ADD COLUMN
 *   NOT NULL DEFAULT 0 → UPDATE 按 rowid 回填（确定性顺序）→ 计数器
 *   MAX+1（空表为 1）→ 追加非唯一索引；单事务，DDL 失败整体回滚（已用
 *   better-sqlite3 13.0.3 实测），下次启动安全重试。
 * - 列已存在：跳过迁移，仅确保 meta 计数器存在并校验其合法性。
 * 迁移不清空记录、不改动业务字段与时间戳语义。
 */
export function ensureJobsSchema(target: Database.Database, log: LogSink = () => {}): void {
  if (!jobsTableExists(target)) {
    target.transaction(() => {
      target.exec(JOBS_SCHEMA_SQL)
      target.exec(INDEXES_SQL)
      target.exec(META_TABLE_SQL)
      target.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(COUNTER_KEY, '1')
    })()
    log(`[jobtrack-db] 新建数据库初始化完成：jobs/meta 表就绪，${COUNTER_KEY}=1`)
  } else if (!hasSortOrderColumn(target)) {
    target.transaction(() => {
      target.exec(`ALTER TABLE jobs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
      target.exec(`UPDATE jobs SET sort_order = rowid`)
      target.exec(META_TABLE_SQL)
      const max = readMaxSortOrder(target)
      if (max !== null && max >= COUNTER_LIMIT) {
        throw new CounterInitError(
          `[jobtrack-db]拒绝迁移：回填后 jobs 表 MAX(sort_order)=${max} 已达 JS 安全整数上限，` +
          `无法初始化 meta.${COUNTER_KEY}`
        )
      }
      const next = max === null ? 1 : max + 1
      target.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)`).run(COUNTER_KEY, String(next))
      target.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_sort_order ON jobs(sort_order)`)
      log(
        `[jobtrack-db] 旧库迁移完成：sort_order 按 rowid 确定性回填，` +
        `${COUNTER_KEY}=${next}（旧库 MAX(sort_order)=${max === null ? '空表' : max}）`
      )
    })()
  }
  ensureMetaAndCounter(target, log)
}

/**
 * 写路径读取持久化计数器并校验（写入前守卫）：
 * 必须在消费计数器的写事务内调用。
 * - 键缺失：合法路径只在启动阶段自愈，写入期出现即异常 → 抛错；
 * - 值非法 / 低于现存 MAX(sort_order)：同启动校验 → 抛错；
 * - 已达安全整数上限：拒绝本次分配；调用方捕获后整个事务回滚，无部分写入。
 */
export function readNextSortOrder(target: Database.Database): number {
  const row = target.prepare(`SELECT value FROM meta WHERE key = ?`).get(COUNTER_KEY) as
    | { value: string }
    | undefined
  const max = readMaxSortOrder(target)
  if (row === undefined) {
    throw new CounterWriteError(
      `[jobtrack-db]写入拒绝：meta.${COUNTER_KEY} 缺失（键仅在启动阶段允许自愈重建），` +
      `请重启应用；jobs 表 MAX(sort_order)=${max === null ? '空表' : max}`
    )
  }
  const next = validatePersistedCounter(row.value, max)
  if (next >= COUNTER_LIMIT) {
    throw new CounterWriteError(
      `[jobtrack-db]写入拒绝：${COUNTER_KEY}=${next} 已达安全整数上限 ${COUNTER_LIMIT}，本次分配不执行；` +
      `事务将整体回滚，无部分写入`
    )
  }
  return next
}

/**
 * 事务内把计数器推进到 next（= 最近一次分配值 + 1）。
 * 由调用方保证与 INSERT 位于同一事务；next 超出安全整数范围即拒绝（防御性断言）。
 */
export function writeNextSortOrder(target: Database.Database, next: number): void {
  if (!Number.isSafeInteger(next) || next < 1 || next > COUNTER_LIMIT) {
    throw new CounterWriteError(
      `[jobtrack-db]写入拒绝：计数器推进目标 ${next} 超出安全整数范围 [1, ${COUNTER_LIMIT}]`
    )
  }
  target
    .prepare(`UPDATE meta SET value = ? WHERE key = ?`)
    .run(String(next), COUNTER_KEY)
}

/**
 * 初始化数据库（server.ts 启动监听前调用）：建表/迁移 + 计数器校验。
 * 诊断与重建日志走 console.error。
 */
export function initDb(): void {
  ensureJobsSchema(db, (message) => console.error(message))
}
