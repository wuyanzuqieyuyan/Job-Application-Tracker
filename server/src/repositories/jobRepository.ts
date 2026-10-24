import { randomUUID } from 'node:crypto'
import { db, readNextSortOrder, writeNextSortOrder } from '../db.js'
import { AppError } from '../errors.js'
import type {
  DeletedJobSnapshot,
  Job,
  JobInput,
  JobStatus,
  RestoredAs,
  RestoredJobData,
  RestoredRecordInput,
} from '../types.js'

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    company: String(row.company),
    position: String(row.position),
    appliedDate: String(row.applied_date),
    status: row.status as JobStatus,
    notes: String(row.notes ?? ''),
  }
}

/** 导入行：id 可选；未提供时服务端生成新 UUID。 */
interface BulkItem {
  id?: string
  input: JobInput
}

/** 计数器分配：分配值与推进必须与 INSERT 同事务。 */
const INSERT_SQL = `INSERT INTO jobs (id, company, position, applied_date, status, notes, created_at, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

/**
 * 删除：单语句 RETURNING 在同一条 SQL 内完成
 * "删除 + 取得原记录完整快照"，无删除后回查拼装，无竞态窗口。
 */
const DELETE_RETURNING_SQL = `DELETE FROM jobs WHERE id = ?
       RETURNING id, company, position, applied_date, status, notes, sort_order, created_at, updated_at`

/**
 * 删除并返回完整快照：记录不存在 → undefined。
 * 不压缩 sort_order、不触碰计数器（下一轮 restore 的原槽位依据持久空洞）。
 */
function rowToSnapshot(row: Record<string, unknown>): DeletedJobSnapshot {
  return {
    id: String(row.id),
    company: String(row.company),
    position: String(row.position),
    appliedDate: String(row.applied_date),
    status: row.status as JobStatus,
    notes: String(row.notes ?? ''),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export const jobRepository = {
  findAll(): Job[] {
    const rows = db.prepare('SELECT * FROM jobs ORDER BY applied_date DESC, id ASC').all() as Record<string, unknown>[]
    return rows.map(rowToJob)
  },

  findById(id: string): Job | undefined {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? rowToJob(row) : undefined
  },

  /**
   * 新建：单事务内依次执行
   * 读计数器 → 读 MAX 校验不变量 → INSERT（sort_order = n）→ 推进计数器。
   * 任一步失败整体回滚，不存在只插入记录或只推进计数器的中间态。
   */
  create(input: JobInput): Job {
    const id = randomUUID()
    const now = new Date().toISOString()
    const stmt = db.prepare(INSERT_SQL)
    db.transaction(() => {
      const order = readNextSortOrder(db)
      stmt.run(
        id,
        input.company.trim(),
        input.position.trim(),
        input.appliedDate,
        input.status,
        input.notes.trim(),
        now,
        now,
        order,
      )
      writeNextSortOrder(db, order + 1)
    })()
    const job = this.findById(id)
    if (!job) throw new Error('Failed to insert job')
    return job
  },

  update(id: string, input: JobInput): Job | undefined {
    const existing = this.findById(id)
    if (!existing) return undefined
    const now = new Date().toISOString()
    const stmt = db.prepare(
      `UPDATE jobs
       SET company = ?, position = ?, applied_date = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    const changes = stmt.run(
      input.company.trim(),
      input.position.trim(),
      input.appliedDate,
      input.status,
      input.notes.trim(),
      now,
      id
    ).changes
    if (changes === 0) return undefined
    return this.findById(id)
  },

  delete(id: string): DeletedJobSnapshot | undefined {
    const row = db.prepare(DELETE_RETURNING_SQL).get(id) as Record<string, unknown> | undefined
    return row ? rowToSnapshot(row) : undefined
  },

  /**
     * 批量导入（整批单事务，原子性）：
   * - 事务开始时读取一次计数器 n0，仅对实际新增按批内顺序连续分配 n0, n0+1, …，
   *   结束时一次性推进为 n0 + 新增行数；幂等命中的行不分配、不消耗计数器；
   * - 同一 id 已存在且内容一致 → 幂等跳过，安全重试不产生重复行、顺序不漂移；
   * - 同一 id 已存在（或同批重复）但内容不同 → 409 冲突，整批回滚（含计数器），绝不部分写入；
   * - id 缺省 → 服务端生成新 UUID。
   * - 计数器非法/低于高水位/达上限 → 拒绝并整批回滚（readNextSortOrder 同款守卫）。
   */
  bulkImport(items: BulkItem[]): Job[] {
    const selectEnough = db.prepare(
      `SELECT company, position, applied_date, status, notes FROM jobs WHERE id = ?`
    )
    const insert = db.prepare(INSERT_SQL)

    const transaction = db.transaction((list: BulkItem[]) => {
      let order = readNextSortOrder(db)
      const result: Job[] = []
      let inserted = 0
      for (const item of list) {
        const id = item.id ?? randomUUID()
        const normalized = item.input
        const existing = selectEnough.get(id) as
          | { company: string; position: string; applied_date: string; status: JobStatus; notes: string }
          | undefined

        if (existing) {
          const same =
            existing.company === normalized.company &&
            existing.position === normalized.position &&
            existing.applied_date === normalized.appliedDate &&
            existing.status === normalized.status &&
            existing.notes === normalized.notes
          if (!same) {
            throw new AppError(409, 'id_conflict', `导入冲突：id "${id}" 已存在但内容不同`)
          }
          // 幂等命中：保留已存在行的原 sort_order，不触碰计数器
          result.push({
            id,
            company: existing.company,
            position: existing.position,
            appliedDate: existing.applied_date,
            status: existing.status,
            notes: existing.notes,
          })
          continue
        }

        if (order + inserted >= Number.MAX_SAFE_INTEGER) {
          // 与 readNextSortOrder 同一上限语义：分配值达上限 → 整批回滚
          throw new Error(
            `[jobtrack-db]写入拒绝：批量导入分配值 ${order + inserted} 已达安全整数上限 ` +
            `${Number.MAX_SAFE_INTEGER}，本次导入不执行；事务将整体回滚，无部分写入`
          )
        }
        const allocated = order + inserted
        inserted += 1
        const now = new Date().toISOString()
        insert.run(id, normalized.company, normalized.position, normalized.appliedDate, normalized.status, normalized.notes, now, now, allocated)
        result.push({ id, ...normalized })
      }
      if (inserted > 0) {
        writeNextSortOrder(db, order + inserted)
      }
      return result
    })

    return transaction(items) as Job[]
  },

  /**
   * 恢复（单事务、行为完全确定）：
   * 1. 目标 id 已存在 → 409 id_conflict（绝不覆盖、绝不部分写入）；
   * 2. 原槽位空闲 → 以快照原 sortOrder 插入 → 'original'，**不触碰计数器**；
   * 3. 原槽位被占（正常流程不可达的防御分支）→ 计数器同事务分配新序号追加 →
   *    'appended' 并推进计数器；禁止独立 MAX+1 算法点（重用 readNextSortOrder 守卫
   *    与上限拒绝），触发时输出诊断日志。
   * 两种路径均原样保留快照的 createdAt/updatedAt；校验发生在 service 层。
   */
  restore(record: RestoredRecordInput): RestoredJobData {
    const insert = db.prepare(INSERT_SQL)

    type Assignment = { restoredAs: RestoredAs; sortOrder: number }
    const assigned: Assignment = db.transaction((): Assignment => {
      const exists = db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(record.id)
      if (exists) {
        throw new AppError(409, 'id_conflict', `恢复冲突：id "${record.id}" 已存在`)
      }
      const slotOccupied =
        db.prepare('SELECT 1 FROM jobs WHERE sort_order = ? LIMIT 1').get(record.sortOrder) !== undefined
      if (!slotOccupied) {
        // 原槽位恢复：快照原 sortOrder 原样写入，不触碰计数器
        insert.run(
          record.id,
          record.input.company,
          record.input.position,
          record.input.appliedDate,
          record.input.status,
          record.input.notes,
          record.createdAt,
          record.updatedAt,
          record.sortOrder
        )
        return { restoredAs: 'original', sortOrder: record.sortOrder }
      }
      // 防御分支（正常流程不可达）：槽位被占 → 计数器同事务分配追加
      const allocated = readNextSortOrder(db)
      console.error(
        `[jobtrack-db]恢复降级：id "${record.id}" 原槽位 sort_order=${record.sortOrder} 已被占用，` +
        `按计数器追加（分配 ${allocated}）；该分支触发意味着外部修改/迁移缺陷/实现缺陷，请排查`
      )
      insert.run(
        record.id,
        record.input.company,
        record.input.position,
        record.input.appliedDate,
        record.input.status,
        record.input.notes,
        record.createdAt,
        record.updatedAt,
        allocated
      )
      writeNextSortOrder(db, allocated + 1)
      return { restoredAs: 'appended', sortOrder: allocated }
    })()

    return {
      id: record.id,
      company: record.input.company,
      position: record.input.position,
      appliedDate: record.input.appliedDate,
      status: record.input.status,
      notes: record.input.notes,
      sortOrder: assigned.sortOrder,
      restoredAs: assigned.restoredAs,
    }
  },
}
