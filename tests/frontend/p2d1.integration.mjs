/**
 * 前端接入集成测试（不使用浏览器，纯 Node 环境，经 tsx 运行）。
 *
 * 覆盖：API 客户端状态码/错误解析/响应校验、迁移判据与幂等、冲突防护、
 * useJobs 初始化状态机（含后端不可达不回退 localStorage）、CRUD 数据流。
 * 后端使用独立临时数据库（JOBTRACK_DATA_DIR），绝不触碰真实 server/data。
 * 运行：node server/node_modules/tsx/dist/cli.mjs tests/frontend/p2d1.integration.mjs
 * （前置：npm run server:build 已产出 server/dist/server.js）
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')

/** Windows 下动态导入 TS 模块必须用 file:// URL。 */
function srcImport(relative) {
  return import(pathToFileURL(join(ROOT, relative)).href)
}

/* ---------- localStorage shim（内存版，测试间用 storage 重置隔离） ---------- */
let storage = {}
globalThis.localStorage = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v) },
  removeItem: (k) => { delete storage[k] },
}

/* ---------- fetch shim：相对路径 → 本测试后端 ---------- */
const realFetch = globalThis.fetch.bind(globalThis)
let fetchCalls = { paths: [] }
function setFetchBase(port) {
  const base = `http://127.0.0.1:${port}`
  globalThis.fetch = (input, init) => {
    fetchCalls.paths.push(String(input))
    return realFetch(base + input, init)
  }
}
function useOfflineFetch() {
  globalThis.fetch = async () => { throw new Error('offline') }
}
function useTamperedJson() {
  globalThis.fetch = async () => new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

/* ---------- server 进程管理 ---------- */
let serverProc = null
let serverPort = 0
let tempDir = null

async function startServer() {
  tempDir = mkdtempSync(join(tmpdir(), 'jobtrack-p2d1-'))
  serverPort = 4310 + Math.floor(Math.random() * 80)
  serverProc = spawn(process.execPath, [join(ROOT, 'server/dist/server.js')], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, PORT: String(serverPort), HOST: '127.0.0.1', JOBTRACK_DATA_DIR: tempDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProc.stdout.resume()
  serverProc.stderr.resume()
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await realFetch(`http://127.0.0.1:${serverPort}/api/health`)
      if (res.ok) return
    } catch { /* 尚未就绪 */ }
    await wait(100)
  }
  throw new Error('测试后端未能启动')
}

async function stopServer() {
  if (serverProc) serverProc.kill()
  serverProc = null
  await wait(150)
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
}

const wait = (ms) => new Promise((resolveP) => setTimeout(resolveP, ms))

/* ---------- 断言工具 ---------- */
let passed = 0
let failed = 0
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`  ok - ${label}`) }
  else { failed += 1; console.error(`  FAIL - ${label}`) }
}
async function assertThrowsApiError(promise, code, label) {
  try {
    await promise
    assert(false, `${label}（未抛错）`)
  } catch (error) {
    assert(error.name === 'ApiError' && error.code === code, `${label}（status=${error.status} code=${error.code}）`)
  }
}

/* ---------- 载荷样本 ---------- */
const LEGACY = [
  { id: 'sample-1', company: '示例科技（虚构）', position: '前端工程师', appliedDate: '2026-09-01', status: 'interviewing', notes: '已完成一面，等待二面通知。' },
  { id: 'sample-2', company: '虚构云图网络', position: 'Vue 开发', appliedDate: '2026-09-10', status: 'applied', notes: '已投递，等待 HR 回复。' },
  { id: 'sample-3', company: '想象数据公司', position: 'Web 前端', appliedDate: '2026-08-20', status: 'offer', notes: '已收到 offer，正在考虑。' },
  { id: 'sample-4', company: '示例视界工作室', position: '初级前端', appliedDate: '2026-08-05', status: 'rejected', notes: '岗位已招满。' },
]

const { listJobs, createJob, updateJob, deleteJob, importJobs, getJob, restoreSnapshot, isValidRestoredRecord } = await srcImport('src/api/jobsClient.ts')
const { migrateLegacyIfNeeded, LEGACY_KEY, MIGRATION_KEY, readLegacySnapshot } = await srcImport('src/api/migration.ts')

/** 服务端时间戳规范形状（toISOString 产物）。 */
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/** DELETE 快照的精确 9 键（排序后对照）。 */
const SNAP_KEYS = ['appliedDate', 'company', 'createdAt', 'id', 'notes', 'position', 'sortOrder', 'status', 'updatedAt']

/** 稳定序列化（键排序后的 JSON 字符串）：深度一致比较用；响应式代理读取后仍成立。 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
    return out
  }
  return value
}

/** 测试用 9 字段快照（形状符合 DeletedJobSnapshot 契约）。 */
function sampleSnapshot() {
  return {
    id: 'sample-1', company: '示例科技（虚构）', position: '前端工程师', appliedDate: '2026-09-01',
    status: 'interviewing', notes: '已完成一面', sortOrder: 1,
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z',
  }
}

async function scenarioHealthyFresh() {
  console.log('# 场景一：空服务器 + 无旧数据 + 客户端错误处理')
  await startServer()
  try {
    storage = {}
    setFetchBase(serverPort)
    const initial = await listJobs()
    assert(Array.isArray(initial) && initial.length === 0, '初始列表为空数组（有效数据，不是错误）')

    const outcome = await migrateLegacyIfNeeded(initial)
    assert(outcome.done === true && outcome.finalList.length === 0, '无旧数据：done、列表为空')
    assert(localStorage.getItem(LEGACY_KEY) === null, '旧数据键未创建（不自动播种示例数据）')
    assert(localStorage.getItem(MIGRATION_KEY) === null, '无旧数据不写迁移标记')

    const created = await createJob({ company: '示例公司', position: '前端', appliedDate: '2026-10-01', status: 'applied', notes: 'n1' })
    assert(typeof created.id === 'string' && created.id.length > 0, '创建返回服务端 id')
    const fetched = await getJob(created.id)
    assert(fetched.company === '示例公司' && fetched.id === created.id, '按 id 查询一致')

    const updated = await updateJob(created.id, { company: '示例公司B', position: '前端', appliedDate: '2026-10-01', status: 'offer', notes: 'n2' })
    assert(updated.company === '示例公司B', '编辑返回服务器记录')
    const refreshed = await listJobs()
    assert(refreshed.length === 1 && refreshed[0].notes === 'n2', '编辑后列表同步（服务器为准，刷新保留）')

    const snap = await deleteJob(created.id)
    // 任务 B1：9 个必需键完整性（无缺无用例在下方注入伪造响应验证）
    assert(Object.keys(snap).sort().join(',') === SNAP_KEYS.join(','), '快照恰好 9 个键、无多余键（id+五业务+sortOrder+createdAt+updatedAt）')
    // 任务 B2：五个业务字段 + id 与服务端返回值一致（取编辑后的最新内容）
    assert(
      snap.id === created.id && snap.company === '示例公司B' && snap.position === '前端' &&
      snap.appliedDate === '2026-10-01' && snap.status === 'offer' && snap.notes === 'n2',
      'id + 五个业务字段与服务端记录一致',
    )
    assert(
      typeof snap.sortOrder === 'number' && Number.isSafeInteger(snap.sortOrder) && snap.sortOrder >= 1 &&
      TS_RE.test(snap.createdAt) && TS_RE.test(snap.updatedAt) && snap.createdAt <= snap.updatedAt,
      'sortOrder ≥ 1 安全整数；两个时间戳符合 ISO 规范且 created_at 未被重置（≤ updatedAt）',
    )
    assert((await listJobs()).length === 0, '删除后服务器记录确实被删除')
    await assertThrowsApiError(deleteJob(created.id), 'job_not_found', '重复删除 → 404 job_not_found')

    // 任务 B3：前端快照校验负面用例——伪造"缺少 updatedAt"的 200 响应必须被拒绝
    globalThis.fetch = async () => new Response(
      JSON.stringify({
        data: {
          id: 'p2d1-bad', company: 'a', position: 'b', appliedDate: '2026-10-01',
          status: 'applied', notes: '', sortOrder: 1,
          createdAt: '2026-10-23T00:00:00.000Z',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
    await assertThrowsApiError(deleteJob('p2d1-bad'), 'bad_response', '缺少 updatedAt 的快照 → bad_response（不静默接受残缺快照）')
    setFetchBase(serverPort)

    useTamperedJson()
    await assertThrowsApiError(listJobs(), 'bad_response', '非 JSON 的 200 响应 → bad_response（不假装空列表）')
    useOfflineFetch()
    await assertThrowsApiError(listJobs(), 'network_error', '网络不可达 → network_error')
    setFetchBase(serverPort)

    const imported = await importJobs([{ id: 'legacy-1', company: '甲公司', position: '岗', appliedDate: '2026-09-09', status: 'applied', notes: '' }])
    assert(imported[0].id === 'legacy-1', '导入保留历史 id')
    await assertThrowsApiError(importJobs([{ id: 'legacy-1', company: '甲公司', position: '岗2', appliedDate: '2026-09-09', status: 'applied', notes: '' }]), 'id_conflict', '同 id 不同内容 → 409 整批回滚')
    const afterConflict = await listJobs()
    assert(afterConflict.length === 1 && afterConflict[0].position === '岗', '冲突批次未写入任何记录')
  } finally {
    await stopServer()
  }
}

async function scenarioMigration() {
  console.log('# 场景二：useJobs 加载失败状态机 + 迁移幂等/坏记录保留')
  await startServer()
  try {
    storage = {}
    setFetchBase(serverPort)
    const legacyText = JSON.stringify([...LEGACY, { id: 'sample-5', company: '', position: '坏记录', appliedDate: '2026-09-01', status: 'applied', notes: '' }])
    storage[LEGACY_KEY] = legacyText

    const snap1 = readLegacySnapshot()
    assert(snap1.kind === 'candidates' && snap1.candidates.length === 4 && snap1.invalidCount === 1, '快照解析：4 候选 + 1 非法')

    // useJobs 单例：首次调用即触发加载；先拦截网络模拟"服务器不可达"
    useOfflineFetch()
    const { useJobs } = await srcImport('src/composables/useJobs.ts')
    const api = useJobs()
    await wait(80)
    assert(api.loadState.value === 'error' && api.loadError.value !== '', '加载失败进入 error 状态且带错误信息')
    assert((await api.addJob({ company: 'x', position: 'y', appliedDate: '2026-09-09', status: 'applied', notes: '' })) === null, 'error 状态下 addJob 被拒绝')
    assert((await api.deleteJob('sample-1')).outcome === 'failed', 'error 状态下 deleteJob 被拒绝（failed 结果，不臆断）')
    assert((await api.restoreDeleted(sampleSnapshot(), 0)).outcome === 'failed', 'error 状态下 restoreDeleted 被拒绝')
    assert(storage[LEGACY_KEY] === legacyText, '失败重试前旧数据键未被动过')

    assert((await api.retryLoad(), api.loadState.value === 'error'), '后端仍不可达：重试后仍 error，未回退本地数据源')

    setFetchBase(serverPort)
    await api.retryLoad()
    await wait(50)
    assert(api.loadState.value === 'ready', '服务器恢复后重试 → ready')
    assert(api.jobs.value.length === 4, '迁移把 4 条候选带入服务器列表')
    assert(api.migrationNotice.value !== null && api.migrationNotice.value.kind === 'partially-invalid', '呈现"部分迁移"通知（1 条非法保留本地）')

    const marker = JSON.parse(storage[MIGRATION_KEY])
    assert(marker.status === 'migrated' && marker.imported === 4 && marker.skipped === 0 && marker.invalid === 1, '完成标记记录 counts（imported=4/skipped=0/invalid=1）')
    assert(storage[LEGACY_KEY] === legacyText, '迁移完成后旧键仍逐字节不变（作为恢复保障）')

    // 已有标记 → 不再触发导入
    fetchCalls = { paths: [] }
    await migrateLegacyIfNeeded(await listJobs())
    assert(!fetchCalls.paths.some((p) => p.endsWith('/api/jobs/import')), '已有完成标记：不再发起导入请求')

    // 删掉标记后可安全幂等重试
    delete storage[MIGRATION_KEY]
    const outcome2 = await migrateLegacyIfNeeded(await listJobs())
    assert(outcome2.done === true, '丢失标记时可安全重试')
    const marker2 = JSON.parse(storage[MIGRATION_KEY])
    assert(marker2.imported === 0 && marker2.skipped === 4, '幂等重跑：imported=0/skipped=4')
  } finally {
    await stopServer()
  }
}

async function scenarioConflict() {
  console.log('# 场景三：同 id 不同内容 → 停止迁移，两端数据都不覆盖')
  await startServer()
  try {
    storage = {}
    setFetchBase(serverPort)
    const created = await createJob({ company: '服务器A内容', position: 'p', appliedDate: '2026-09-01', status: 'applied', notes: '' })
    storage[LEGACY_KEY] = JSON.stringify([{ id: created.id, company: '本地B内容', position: 'p', appliedDate: '2026-09-01', status: 'applied', notes: '' }])
    const outcome = await migrateLegacyIfNeeded(await listJobs())
    assert(outcome.notice !== undefined && outcome.notice.kind === 'conflict' && outcome.notice.count === 1, '冲突被识别并报告')
    assert(localStorage.getItem(MIGRATION_KEY) === null, '冲突 → 不写完成标记')
    assert(JSON.parse(storage[LEGACY_KEY])[0].company === '本地B内容', '本地数据未被改写')
    assert((await listJobs())[0].company === '服务器A内容', '服务器数据未被覆盖')
  } finally {
    await stopServer()
  }
}

async function scenarioOps() {
  console.log('# 场景四：useJobs 数据流（创建/编辑/删除 + busy 锁 + 撤销新增）')
  await startServer()
  try {
    storage = {}
    setFetchBase(serverPort)
    const { useJobs } = await srcImport('src/composables/useJobs.ts')
    const api = useJobs()
    await api.retryLoad()
    assert(api.loadState.value === 'ready', '初始化 retryLoad → ready')
    assert(api.jobs.value.length === 0, '无旧数据 → 空状态（非示例数据填充）')

    const job = await api.addJob({ company: '集成公司', position: 'pos', appliedDate: '2026-10-01', status: 'applied', notes: 'x' })
    assert(job !== null && api.jobs.value.some((j) => j.id === job?.id), '创建成功并进入内存列表（服务端 id）')
    const id = job?.id ?? ''

    const beforeNotes = api.jobs.value.map((j) => j.notes).join('|')
    assert((await api.updateJob(id, { company: '集成公司', position: 'pos', appliedDate: '2026-10-01', status: 'applied', notes: 'y' })) !== null, '编辑成功')
    assert(api.jobs.value.map((j) => j.notes).join('|') !== beforeNotes, '编辑后内存列表已更新')
    assert((await api.updateJob('no-such-id', { company: 'z', position: 'p', appliedDate: '2026-10-01', status: 'applied', notes: '' })) === null && api.jobs.value.length === 1, '编辑不存在的 id → 失败且列表不变')

    const removed = await api.deleteJob(id)
    assert(removed.outcome === 'deleted' && removed.snapshot.notes === 'y' && removed.index >= 0, '删除同步返回 deleted 结果、快照与原列表位置')
    assert(Object.keys(removed.snapshot).sort().join(',') === SNAP_KEYS.join(','), '删除快照 9 键完整')
    assert(!api.jobs.value.some((j) => j.id === id), '删除后内存列表已移除')

    const [r1, r2] = await Promise.all([
      api.addJob({ company: '锁验证', position: 'pos2', appliedDate: '2026-10-02', status: 'applied', notes: '' }),
      api.addJob({ company: '锁验证2', position: 'pos3', appliedDate: '2026-10-02', status: 'applied', notes: '' }),
    ])
    assert(r1 !== null && r2 === null, 'submit 锁使并发第二条创建被拒（防重复提交）')

    const undoneOk = await api.removeJobById(r1?.id ?? '', r1 ?? undefined)
    assert(undoneOk === true && api.jobs.value.every((j) => j.id !== r1?.id), '撤销新增：服务端删除 + 内存移除')
    const undoneBad = await api.removeJobById(r1?.id ?? '', r1 ?? undefined)
    assert(undoneBad === false, '重复撤销（记录已不在）→ false，无副作用')

    const goneAgain = await api.deleteJob(id)
    assert(goneAgain.outcome === 'failed' && api.jobs.value.length === 0, '删除本地已不存在的记录 → failed（本地前置核实；404→absent 已在场景五覆盖）')
  } finally {
    await stopServer()
  }
}

/**
 * 场景五：删除撤销接入后端。
 * 覆盖：restore 请求体必须与服务器给的原始快照逐键一致（捕获 fetch body）、
 * original 恢复 + 服务器序同步、同 id 不同内容 → 409 冲突（绝不覆盖）、
 * 恢复/删除的"不确定"分支（不宣称成功/失败、不额外重复尝试、列表不动）、
 * DELETE 失败后 GET 核对的三种结果（仍在 → failed / 已无 → absent / 核对失败 → uncertain）。
 */
async function scenarioRestore() {
  console.log('# 场景五：删除撤销接入（restore 请求体 = 原始快照 + original + 冲突 + 不确定）')
  await startServer()
  try {
    storage = {}
    setFetchBase(serverPort)
    const { useJobs } = await srcImport('src/composables/useJobs.ts')
    const api = useJobs()
    await api.retryLoad()
    assert(api.loadState.value === 'ready' && api.jobs.value.length === 0, '初始化 → ready 空列表')

    const base = `http://127.0.0.1:${serverPort}`
    let restoreBodies = []
    /** 捕获（并按需放行/拦截）发给 /restore 的请求体：先记录再决定放行还是抛错。 */
    function captureRestores(block) {
      restoreBodies = []
      globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url === '/api/jobs/restore') {
          if (init && typeof init.body === 'string') restoreBodies.push(JSON.parse(init.body))
          if (block) throw new Error('offline')
        }
        return realFetch(base + input, init)
      }
    }

    const job = await api.addJob({ company: '撤销公司', position: '前端', appliedDate: '2026-10-01', status: 'applied', notes: '原笔记' })
    const id = job?.id ?? ''

    captureRestores(false)
    const removed = await api.deleteJob(id)
    assert(removed.outcome === 'deleted' && !api.jobs.value.some((j) => j.id === id), '删除 → deleted 分支且内存已移除')
    const snapshot = removed.snapshot
    assert(Object.keys(snapshot).sort().join(',') === SNAP_KEYS.join(','), '服务器快照 9 键完整')

    const result = await api.restoreDeleted(snapshot, removed.index)
    assert(result.outcome === 'restored' && result.data.restoredAs === 'original', '恢复 → original（原槽位）')
    assert(result.synced === true, '恢复成功后以重新拉取的服务器列表同步（synced）')
    assert(api.jobs.value.some((j) => j.id === id && j.notes === '原笔记'), '恢复的记录回到服务器列表（内容一致）')
    assert(restoreBodies.length === 1 && JSON.stringify(canonical(restoreBodies[0].record)) === JSON.stringify(canonical(snapshot)), 'restore 请求体 = { record: 完整原始 9 字段快照 }（无删减/改写）')

    // 幂等往返：再删再恢复
    const removed2 = await api.deleteJob(id)
    assert(removed2.outcome === 'deleted', '二次删除成功')
    const result2 = await api.restoreDeleted(removed2.snapshot, removed2.index)
    assert(result2.outcome === 'restored' && result2.data.restoredAs === 'original', '二次删除→恢复往返仍为 original')

    // 冲突：删 C → 导入同 id 不同内容 → 恢复被 409 拒绝，绝不覆盖
    const c = await api.addJob({ company: '冲突公司', position: 'p', appliedDate: '2026-10-02', status: 'applied', notes: '笔记c' })
    const removedC = await api.deleteJob(c?.id ?? '')
    assert(removedC.outcome === 'deleted', '删除 C 成功')
    await importJobs([{ id: c.id, company: '冒名内容', position: 'p', appliedDate: '2026-10-02', status: 'applied', notes: '' }])
    const conflict = await api.restoreDeleted(removedC.snapshot, removedC.index)
    assert(conflict.outcome === 'conflict' && conflict.existsNow === true && conflict.sameContent === false, '同 id 不同内容 → conflict（已存在 + 内容不同，如实报告）')
    assert((await listJobs()).find((j) => j.id === c.id)?.company === '冒名内容', '冲突恢复未覆盖服务器现有内容')
    assert(api.jobs.value.every((j) => !(j.id === c.id && j.notes === '笔记c')), '冲突后被删内容未插回内存列表（恢复被拒绝未臆断成功）')
    await assertThrowsApiError(restoreSnapshot(removedC.snapshot), 'id_conflict', '客户端 restoreSnapshot 同 id → ApiError(id_conflict)')
    assert(restoreBodies.length === 4, '四次恢复尝试（useJobs 成功×2 + 冲突×1 + 客户端直调×1）恰好各发一次 POST，无未知额外请求')

    // 恢复响应校验器（独立于 9 字段快照校验）单元检查
    assert(isValidRestoredRecord({ id: 'x', company: 'a', position: 'b', appliedDate: '2026-10-01', status: 'applied', notes: '', sortOrder: 1, restoredAs: 'appended' }), 'isValidRestoredRecord 接受 8 字段 + appended 响应')
    assert(!isValidRestoredRecord({ id: 'x', company: 'a', position: 'b', appliedDate: '2026-10-01', status: 'applied', notes: '', sortOrder: 1, restoredAs: 'weird' }), 'isValidRestoredRecord 拒绝非法 restoredAs 枚举值')
    assert(!isValidRestoredRecord({ id: 'x', company: 'a', position: 'b', appliedDate: '2026-10-01', status: 'applied', notes: '', sortOrder: 1 }), 'isValidRestoredRecord 拒绝缺 restoredAs（必需键）')
    assert(!isValidRestoredRecord({ id: 'x', company: 'a', position: 'b', appliedDate: '2026-10-01', status: 'nope', notes: '', sortOrder: 1, restoredAs: 'original' }), 'isValidRestoredRecord 拒绝非法 status（内层五字段校验生效）')

    // restore 请求失败但 GET 可用 → uncertain(serverHasRecord=true)：不宣称成功，仅报告"服务器当前存在"
    captureRestores(true)
    const unver = await api.restoreDeleted(removed2.snapshot, removed2.index)
    assert(unver.outcome === 'uncertain' && unver.serverHasRecord === true, 'restore 失败 + GET 确认记录存在 → uncertain(serverHasRecord=true)')
    assert(restoreBodies.length === 1, '不确定分支恰好一次 POST 尝试（capture 重置后仅 +1，不偷偷重试恢复）')

    // 断网：restore + GET 都失败 → uncertain(null)
    useOfflineFetch()
    const offline = await api.restoreDeleted(removed2.snapshot, removed2.index)
    assert(offline.outcome === 'uncertain' && offline.serverHasRecord === null, '断网恢复 → uncertain(null)（不宣称成功/失败）')
    setFetchBase(serverPort)
    assert(api.jobs.value.every((j) => !(j.id === c.id && j.notes === '笔记c')), '断网恢复未把已删条目插回内存列表（不猜测生效）')

    // DELETE 的"不确定"三种核对结果：
    const e = await api.addJob({ company: '仍存在公司', position: 'p', appliedDate: '2026-10-03', status: 'applied', notes: '' })
    globalThis.fetch = async (input, init) => {
      if (String(input) === `/api/jobs/${e.id}` && init && init.method === 'DELETE') throw new Error('offline')
      return realFetch(base + input, init)
    }
    const stillThere = await api.deleteJob(e.id)
    assert(stillThere.outcome === 'failed' && api.jobs.value.some((j) => j.id === e.id), 'DELETE 失败 + GET 核对记录仍在 → failed（删除未生效，列表不动）')

    const f = await api.addJob({ company: '已消失公司', position: 'p', appliedDate: '2026-10-03', status: 'applied', notes: '' })
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url === `/api/jobs/${f.id}`) {
        if (init && init.method === 'DELETE') throw new Error('offline')
        // 伪造服务器确认已无此记录（本用例验证前端核对逻辑，不关心服务器真状态）
        return new Response(JSON.stringify({ error: { code: 'job_not_found', message: 'not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      return realFetch(base + input, init)
    }
    const goneVerify = await api.deleteJob(f.id)
    assert(goneVerify.outcome === 'absent' && !api.jobs.value.some((j) => j.id === f.id), 'DELETE 失败 + GET 404 → absent（如实确认并同步移除）')

    const g = await api.addJob({ company: '核对失败公司', position: 'p', appliedDate: '2026-10-03', status: 'applied', notes: '' })
    useOfflineFetch()
    const unknown = await api.deleteJob(g.id)
    assert(unknown.outcome === 'uncertain' && api.jobs.value.some((j) => j.id === g.id), 'DELETE + GET 核对都失败 → uncertain（列表不动，不臆断成功/失败）')
    setFetchBase(serverPort)
  } finally {
    await stopServer()
  }
}

/**
 * 场景六：撤销栈契约。
 * 覆盖：pushDelete 携带快照、LIFO、reinsert 保持原 expiresAt（不续命）、
 * 过期 + in-flight 竞态（剪枝放行 → 释放后按原时间剪掉，不复活）。
 */
async function scenarioUndoStack() {
  console.log('# 场景六：撤销栈（in-flight 过期保护 + LIFO + reinsert 不续命）')
  const { useUndoStack } = await srcImport('src/composables/useUndoStack.ts')
  const stack = useUndoStack(150)

  const jobA = { id: 'j-a', company: '甲', position: 'p', appliedDate: '2026-10-01', status: 'applied', notes: '' }
  const snapA = { ...jobA, sortOrder: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }
  const snapB = { ...jobA, id: 'j-b', company: '乙', sortOrder: 2, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }

  const d1 = stack.pushDelete(snapA, 0)
  assert(d1.snapshot === snapA && d1.type === 'delete', 'pushDelete 携带原始快照引用且类型为 delete')
  const d2 = stack.pushDelete(snapB, 1)
  assert(stack.topEntry.value?.id === d2.id, 'LIFO：后压栈的删除条目在栈顶')

  const expiresBefore = d2.expiresAt
  const taken = stack.take()
  // 响应式代理读取不保引用一致，按字段比较（字段完整性即快照交接正确）
  assert(taken?.id === d2.id && JSON.stringify(canonical(taken?.snapshot)) === JSON.stringify(canonical(snapB)), 'take 弹出最新删除条目（含快照，按字段核对）')
  stack.reinsert(d2)
  assert(stack.topEntry.value?.id === d2.id, 'reinsert 把原条目放回栈顶')
  assert(d2.expiresAt === expiresBefore, 'reinsert 保持原 expiresAt（不续命，窗口不重置）')

  // 过期 + in-flight 竞态
  const d3 = stack.pushDelete({ ...snapA, id: 'j-c' }, 2)
  stack.markInFlight(d3.id)
  await wait(220)
  stack.pruneExpired()
  assert(stack.entries.value.some((entry) => entry.id === d3.id), '已过期但恢复进行中（in-flight）的条目不被剪枝删除')
  stack.clearInFlight(d3.id)
  stack.pruneExpired()
  assert(stack.entries.value.every((entry) => entry.id !== d3.id), '释放 in-flight 后，过期条目按原时间被剪掉（结果确定后不复活已过期条目）')

  // LIFO 多条弹出顺序
  stack.clear()
  const s1 = stack.pushDelete(snapA, 0)
  const s2 = stack.pushDelete(snapB, 1)
  assert(stack.take()?.id === s2.id && stack.take()?.id === s1.id, '多条删除撤销按 LIFO 弹出')
}

/**
 * 场景七：加载失败横幅 i18n 修复回归（紧急修复任务）。
 * 问题 A/B 根因：后端未运行时 Vite 代理对 /api/* 返回 500，前端兜底文案
 * （中文硬编码）经 loadFailureDesc 的 {message} 插值进入英文界面造成混排。
 * 回归保障：loadFailure 文案双语逐字固定；en 表全无 CJK 字符；双语键完全对应；
 * loadError 诊断信息保留在状态中但不进界面插值。
 */
async function scenarioI18nBanner() {
  console.log('# 场景七：加载失败横幅 i18n（固定文案 + en 无混排 + 诊断保留）')
  const { messages } = await srcImport('src/composables/useI18n.ts')
  const zh = messages['zh-CN']
  const en = messages['en-US']

  assert(zh.loadFailureTitle === '服务器数据加载失败', 'zh 标题与规定一致')
  assert(zh.loadFailureDesc === '服务器暂时不可用，请稍后重试。你的数据以服务器为准，未做本地替换。', 'zh 说明与规定一致（中文句号）')
  assert(en.loadFailureTitle === 'Failed to load server data', 'en 标题与规定一致')
  assert(en.loadFailureDesc === 'The server is temporarily unavailable. Please try again later. Your data is managed by the server; no local data was substituted.', 'en 说明与规定一致（英文句号）')

  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
  const cjkKeys = Object.entries(en).filter(([, v]) => CJK.test(String(v))).map(([k]) => k)
  assert(en.loadFailureDesc !== undefined && cjkKeys.length === 0, `en 表所有文案无中文字符/中文标点$\{违规键=${cjkKeys.length}\}`)
  assert(JSON.stringify(Object.keys(zh)) === JSON.stringify(Object.keys(en)), '双语键集合与顺序完全对应（MessageKey 完整性）')

  const { useJobs } = await srcImport('src/composables/useJobs.ts')
  const api = useJobs()
  useOfflineFetch()
  await api.retryLoad()
  await wait(50)
  assert(api.loadState.value === 'error' && api.loadError.value !== '', '加载失败 → error 状态且 loadError 诊断信息保留（console 输出，不进界面插值）')
  assert(api.jobs.value.length === 0 && loadStateNeverPretendsReady(api), '失败期间未用 localStorage 数据伪装 ready（服务器为唯一数据源）')

  function loadStateNeverPretendsReady(stateRef) {
    return stateRef.loadState.value !== 'ready'
  }
}

/**
 * 场景八：服务器持久化与降级恢复的补充覆盖。
 * - 持久化：独立临时数据库下，新增 → 停止后端 → 用同一数据库重启后端 → 重新拉取，
 *   记录与业务字段完全一致（不依赖前端会话）。
 * - 删除回退窗口内原排序槽位被占（直接写临时 sqlite 模拟"外部修改"），
 *   restore 端到端返回 restoredAs='appended'，前端接受服务器降级结果，
 *   最终顺序以重新拉取的服务器列表为准（restoredAs 不决定前端排序）。
 * - 撤销新增的服务端删除路径带编辑保护 —— 记录被编辑后拒绝按原快照撤销。
 */
async function scenarioPersistentAppend() {
  console.log('# 场景八：重启持久化 + appended 端到端 + 编辑保护')
  const { createRequire } = await import('node:module')
  const serverRequire = createRequire(join(ROOT, 'server/package.json'))

  const temp = mkdtempSync(join(tmpdir(), 'jobtrack-d3-'))
  let proc = null
  const spawnServer = (port) => spawn(process.execPath, [join(ROOT, 'server/dist/server.js')], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JOBTRACK_DATA_DIR: temp },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  async function waitHealth(port) {
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await realFetch(`http://127.0.0.1:${port}/api/health`)
        if (res.ok) return
      } catch { /* 尚未就绪 */ }
      await wait(100)
    }
    throw new Error('场景八后端未能启动')
  }

  const port1 = 4501 + Math.floor(Math.random() * 40)
  proc = spawnServer(port1)
  try {
    await waitHealth(port1)
    storage = {}
    setFetchBase(port1)
    const { useJobs } = await srcImport('src/composables/useJobs.ts')
    const api = useJobs()
    await api.retryLoad()
    await wait(30)
    assert(api.loadState.value === 'ready' && api.jobs.value.length === 0, '场景八：独立临时库空状态 → ready')

    // —— A2：新增 → 重启后端 → 数据仍在 ——
    const job1 = await api.addJob({ company: '重启公司', position: '重启岗', appliedDate: '2026-10-04', status: 'applied', notes: '重启前备注' })
    assert(job1 !== null && api.jobs.value.length === 1, 'A2：新增成功进入服务器列表')
    proc.kill()
    proc = null
    await wait(300)

    const port2 = port1 + 1
    proc = spawnServer(port2)
    await waitHealth(port2)
    setFetchBase(port2)
    await api.retryLoad()
    await wait(30)
    assert(api.loadState.value === 'ready', 'A2：重启后重新拉取 → ready')
    const reloaded = api.jobs.value.find((j) => j.id === job1?.id)
    assert(reloaded !== undefined && reloaded.company === '重启公司' && reloaded.position === '重启岗' && reloaded.appliedDate === '2026-10-04' && reloaded.status === 'applied' && reloaded.notes === '重启前备注', 'A2：重启后记录与全部业务字段一致（服务器持久化）')

    // —— B3.2：删除 → 占用原槽位 → 恢复得到 appended ——
    const removed = await api.deleteJob(job1?.id ?? '')
    assert(removed.outcome === 'deleted', 'B3.2：删除成功，取得 9 字段服务器快照')
    const snapshot = removed.snapshot
    const Database = serverRequire('better-sqlite3')
    const db = new Database(join(temp, 'jobs.db'))
    db.prepare(`INSERT INTO jobs (id, company, position, applied_date, status, notes, created_at, updated_at, sort_order)
      VALUES ('occupier-1', '插槽占位公司', 'pos', '2026-10-04', 'applied', '', '2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z', 1)`).run()
    db.close()
    const appended = await api.restoreDeleted(snapshot, 0)
    assert(appended.outcome === 'restored' && appended.data.restoredAs === 'appended', 'B3.2：原槽位被占 → 服务器降级追加 restoredAs=appended（前端如实接受）')
    assert(appended.synced === true, 'B3.2：appended 后仍以重新拉取的服务器列表同步（restoredAs 不决定前端排序）')
    const finalList = await listJobs()
    // GET /api/jobs 契约：不含内部 sort_order；展示顺序 = applied_date DESC, id ASC（稳定键，前端以此同步）
    assert(appended.data.sortOrder === 2 && appended.data.sortOrder !== snapshot.sortOrder, 'B3.2：恢复响应携带计数器分配的新内部 sort_order=2（≠ 原 1；快照的内部序不回前端排序）')
    const expectedOrder = [...finalList].sort((a, b) => (a.appliedDate === b.appliedDate ? a.id.localeCompare(b.id) : b.appliedDate.localeCompare(a.appliedDate)))
    assert(finalList.length === 2 && JSON.stringify(finalList.map((j) => j.id)) === JSON.stringify(expectedOrder.map((j) => j.id)), 'B3.2：最终服务器顺序符合展示排序契约（applied_date DESC + id ASC），前端以此为准')

    // —— B4：撤销新增的编辑保护 ——
    const edited = await api.updateJob(job1?.id ?? '', { company: '重启公司', position: '重启岗', appliedDate: '2026-10-04', status: 'interviewing', notes: '已被编辑的备注' })
    assert(edited !== null && edited.status === 'interviewing', 'B4：记录编辑成功（撤销窗口内状态已改变）')
    const refused = await api.removeJobById(job1?.id ?? '', {
      id: job1?.id ?? '', company: '重启公司', position: '重启岗', appliedDate: '2026-10-04', status: 'applied', notes: '重启前备注',
    })
    assert(refused === false, 'B4：内容与撤销快照不一致 → 拒绝撤销（不误删编辑后的记录）')
    assert(api.jobs.value.some((j) => j.id === job1?.id && j.notes === '已被编辑的备注'), 'B4：编辑后的记录完整保留在列表')

    // —— B4：记录不存在 → false（不伪装成功，本场景场景四已覆盖路径，此处复核被编辑记录独立守卫） ——
    const againGone = await api.deleteJob(job1?.id ?? '')
    assert(againGone.outcome === 'deleted', 'B4：真实删除被编辑后的记录（获取新快照）')
    const refusedAgain = await api.removeJobById(job1?.id ?? '', edited ?? undefined)
    assert(refusedAgain === false, 'B4：记录已不存在 → removeJobById 返回 false（不伪装成功）')
  } finally {
    if (proc) proc.kill()
    await wait(200)
    rmSync(temp, { recursive: true, force: true })
  }
}

/**
 * 场景九：日期范围控件统一化回归（Element Plus daterange 接入）。
 * 覆盖：filters ↔ 组件 model 纯映射（格式不变形、无时区通道）、
 * 清除态、边界态、异常兜底，以及中英文分隔符/占位符键的 i18n 契约。
 */
async function scenarioDateRange() {
  console.log('# 场景九：日期范围控件（映射契约 + i18n）')
  const { toRangeValue, fromRangeValue } = await srcImport('src/utils/dateRange.ts')
  const { messages } = await srcImport('src/composables/useI18n.ts')

  // 组件 model 契约：value-format=YYYY-MM-DD 直通，字符串原样进出
  assert(toRangeValue('', '') === null, '范围映射：均未选 → null（clearable 依赖 null 判空）')
  const pair = toRangeValue('2026-10-01', '2026-10-31')
  assert(Array.isArray(pair) && pair[0] === '2026-10-01' && pair[1] === '2026-10-31', '范围映射：成对日期字符串原样透传（无 Date/时区转换）')
  assert(toRangeValue('2026-10-01', '') === null && toRangeValue('', '2026-10-31') === null, '范围映射：单侧日期（本控件不可达的存量态）防御性显示为空')

  // 反向：组件 → filters（保持 string/'' 契约，筛选与 error 逻辑不变）
  assert(JSON.stringify(fromRangeValue(null)) === JSON.stringify({ dateFrom: '', dateTo: '' }), '反向映射：清除（null）→ 两个空串')
  assert(JSON.stringify(fromRangeValue(['2026-10-01', '2026-10-31'])) === JSON.stringify({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }), '反向映射：成对选择写入 dateFrom/dateTo（原字段名、原格式）')
  assert(JSON.stringify(fromRangeValue('oops')) === JSON.stringify({ dateFrom: '', dateTo: '' }), '反向映射：非数组输入兜底为空（不臆造日期）')
  assert(JSON.stringify(fromRangeValue(['2026-10-01', 7])) === JSON.stringify({ dateFrom: '2026-10-01', dateTo: '' }), '反向映射：非字符串元素按侧兜底')

  // i18n 契约：分隔符键双语存在；占位符复用既有 filterDateFrom/filterDateTo
  const zh = messages['zh-CN']
  const en = messages['en-US']
  assert(zh.filterDateRangeSeparator === '至' && en.filterDateRangeSeparator === 'to', '范围分隔符中英文均已配置（zh=至 / en=to）')
  assert(zh.filterDateRangePlaceholder === undefined && en.filterDateRangePlaceholder === undefined, '筛选栏不再使用统一占位键（恢复两端独立提示）')
  assert(zh.formApplicationDatePlaceholder === '点击选择申请日期' && en.formApplicationDatePlaceholder === 'Click to select application date', '新增窗口申请日期占位符（表单专用键，不影响筛选栏）')
  assert(zh.filterDateFrom === '开始日期' && en.filterDateFrom === 'Start date' && zh.filterDateTo === '结束日期' && en.filterDateTo === 'End date', '起止占位符沿用既有双语键')
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/
  assert(!CJK.test(String(en.filterDateRangeSeparator)), 'en 分隔符无中文字符（混排回归）')
}

async function main() {
  await scenarioHealthyFresh()
  await scenarioMigration()
  await scenarioConflict()
  await scenarioOps()
  await scenarioRestore()
  await scenarioUndoStack()
  await scenarioI18nBanner()
  await scenarioPersistentAppend()
  await scenarioDateRange()
  console.log(`\np2d1 结果：${passed} 通过，${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (error) => {
  console.error('harness 崩溃：', error)
  await stopServer()
  process.exit(1)
})
