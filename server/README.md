# JobTrack API (server)

Node.js + Express 5 + TypeScript + better-sqlite3 的后端。数据库文件位于 `server/data/jobs.db`（不提交到 Git）。

## Node 版本策略

- **推荐：Node.js 24 LTS**（维护期至 2028 年，原生模块 prebuilt 覆盖最稳）。
- `package.json` 的 `engines.node` 为 `>=22.5.0`：better-sqlite3 13.x 的最低要求是 `>=22`，
  22.5 起提供的 Node 内置打包 N-API 一致性更好。
- 未强制 engine-strict：26.x（Current→LTS）同样可运行，避免多机器差异直接阻塞。
- 以上版本组合仅在本机（Windows 11，Node.js 26）验证过；macOS、Linux 或其他 Node
  版本使用前需自行验证。
- 仓库提供 `.nvmrc`（内容 `24`），供使用 nvm 的环境一键切换到推荐版本。

## better-sqlite3 安装要点（为何需要 .npmrc 里的 ignore-scripts）

- better-sqlite3 **13.0.3** 的 npm tarball 自带全部平台的 prebuilt 二进制
  （`prebuilds/win32-x64.node` 等，N-API/node-addon-api 二进制，与 Node ABI 无关，Node ≥22 通用）。
- 但该包根目录带有 `binding.gyp` 且没有 `install` 脚本，npm 会对其**隐式执行
  `node-gyp rebuild`**——没有 Visual Studio C++ Build Tools 的机器会安装失败，
  失败信息与真实需要无关（运行时永远不会用到编译产物）。
- 因此 `server/.npmrc` 启用 `ignore-scripts=true`：跳过隐式编译，安装后由
  node-gyp-build 在运行时直接加载 tarball 自带的 prebuilds。
- 全部依赖（express、tsx、vitest/esbuild/rollup 的原生二进制）均不需要任何 install 脚本，
  关闭脚本对本项目无副作用。
- 若需要从源码编译 better-sqlite3（例如极端老平台）：安装 VS Build Tools 后临时移除
  `.npmrc` 设置，再运行 `npm rebuild better-sqlite3`。
- 锁文件 `package-lock.json` 固定了全部版本与完整性哈希，安装走 registry（npmjs），
  **不依赖 GitHub Releases 网络下载**，也不需要任何手动复制 `.node` 的步骤。

## 命令

```bash
# 干净安装（推荐，从锁文件精确还原）
cd server
npm ci

# 开发（两个终端分别执行）
npm run server:dev      # 后端 tsx watch，127.0.0.1:4000
npm run dev             # 前端 Vite 5173，/api 已代理到 4000

# 构建 / 生产启动
npm run server:build    # tsc -> dist（ESM/NodeNext）
npm run server:start    # node dist/server.js（PORT/HOST 可用环境变量覆盖）

# 测试
npm run server:test     # vitest run（全量用例）
npx tsx tests/smoke.ts  # 手动冒烟（使用临时库，不影响真实数据）
```

## 数据库

- 数据目录：环境变量 `JOBTRACK_DATA_DIR`，缺省为 `server/data`（自动创建）。
- `journal_mode = WAL`；schema 初始化见 `src/db.ts`（jobs 表 + 2 个索引）。

## 错误响应语义

统一为 `{ error: { code, message } }`，成功为 `{ data: ... }`：

| 状态码 | code | 触发条件 |
|---|---|---|
| 400 | `invalid_company/position/applied_date/status/notes` | 字段校验失败 |
| 400 | `invalid_id` | 导入项 id 不满足格式规则 |
| 400 | `invalid_request` | 请求体/导入数据结构不合法（非对象、非数组） |
| 400 | `malformed_body` | 畸形 JSON（body-parser `entity.parse.failed`） |
| 404 | `job_not_found` | 记录不存在 |
| 404 | `not_found` | 未知 API 路径 |
| 409 | `id_conflict` | 导入时 id 已存在（或同批重复）但内容不同 |
| 413 | `request_too_large` | 请求体超过 1MB（`entity.too.large`） |
| 415 | `unsupported_body_encoding` | 编码/字符集不受支持（`encoding.unsupported`/`charset.unsupported`） |
| 500 | `internal_error` | 其他一切未知异常（不透出堆栈/SQL/路径/err.message） |

判定依据：仅按 body-parser 错误对象的 `type` 白名单（服务端常量）映射状态码，
不信任任意异常对象自带的 `status`/`statusCode`。

## 删除接口（`DELETE /api/jobs/:id`）

删除成功返回 `200 OK` 与完整删除快照，不再是 `204 No Content` 无响应体。

- 快照字段（共 9 个：id、五个业务字段、sortOrder、createdAt、updatedAt，命名与既有 API 一致）：
  `id`、`company`、`position`、`appliedDate`、`status`、`notes`、
  `sortOrder`（服务端持久化顺序号）、`createdAt`、`updatedAt`（均为删除时刻的**原始**时间戳）。
- 记录不存在 → 统一错误格式 404：`{ error: { code: 'job_not_found', message: '记录不存在' } }`。
- 非幂等：同一删除请求重复执行，第二次得到 404（契约如实，不宣称幂等成功）。

响应示例：

```jsonc
DELETE /api/jobs/cdb94cab-41bf-4c0a-babe-adadfa2da456

// 成功 → 200 OK
{
  "data": {
    "id": "cdb94cab-41bf-4c0a-babe-adadfa2da456",
    "company": "示例科技",
    "position": "前端工程师",
    "appliedDate": "2026-09-01",
    "status": "offer",
    "notes": "offer",
    "sortOrder": 3,
    "createdAt": "2026-10-23T08:15:42.083Z",
    "updatedAt": "2026-10-23T08:15:42.083Z"
  }
}

// 记录不存在 → 404
{ "error": { "code": "job_not_found", "message": "记录不存在" } }
```

实现要点：

- 单语句 `DELETE FROM jobs WHERE id = ? RETURNING …` 原子完成"删除 + 取得原记录快照"，
  不在删除后回查拼装，无竞态窗口；数据库层失败（如注入异常）→ 整语句回滚，无部分删除。
- 删除**不压缩**既有 `sort_order`、**不触碰/不降低**持久化计数器 `next_sort_order`
  （空洞保留，供撤销恢复的原槽位还原使用）；计数器分配逻辑完全不变。

## 恢复接口（`POST /api/jobs/restore`）

与删除接口的 200 快照配套使用：把删除时拿到的
9 字段快照作为请求体回传，即可按原 id 恢复该记录。

### 请求格式

- 请求体：`{ "record": { … } }`，`record` 为必需的对象（缺 record 或非对象 → 400 `invalid_request`）。
- 必需字段（与删除快照一一对应，共 9 个）及校验规则（与当前实现一致）：

| 字段 | 校验 | 失败错误码 |
|---|---|---|
| `id` | 与导入一致：1-64 字符、首字符字母或数字、其余 `A-Za-z0-9._~:-` | `invalid_id` |
| `company` | 字符串，trim 后非空，≤ 50 字符 | `invalid_company` |
| `position` | 字符串，trim 后非空，≤ 50 字符 | `invalid_position` |
| `appliedDate` | `YYYY-MM-DD` 且不能晚于今天 | `invalid_applied_date` |
| `status` | 枚举 `applied / interviewing / offer / rejected` | `invalid_status` |
| `notes` | 字符串（可为空串），≤ 200 字符 | `invalid_notes` |
| `sortOrder` | 安全整数且 ≥ 1 | `invalid_request` |
| `createdAt` | 规范 ISO 8601：毫秒 + `Z`，且必须与 `Date.prototype.toISOString()` 输出一致 | `invalid_request` |
| `updatedAt` | 同 `createdAt` | `invalid_request` |

- 时间戳为"正则形状 + `Date` 可解析 + 规范回环"三重校验：字段越界滚动型非法日历日期
  （如 `2026-02-30T08:15:42.083Z`、非闰年的 `2026-02-29T08:15:42.083Z`）同样被拒绝；
  缺毫秒、带时区偏移、小写 `t/z`、5 位毫秒等非规范形态一律拒绝。
- 未知字段与既有 API 一致地被忽略。

### 成功响应（`201 Created`）

`{ data: restored }`，`restored` **恰好包含 8 个字段**：`id`、五个业务字段
（`company`、`position`、`appliedDate`、`status`、`notes`）、`sortOrder`、`restoredAs`。
**不含** `createdAt` / `updatedAt`。

- `restoredAs: 'original'`：快照的 `sortOrder` 槽位空闲，按原值插回该槽位，**不消耗**计数器。
- `restoredAs: 'appended'`：原槽位已被占用（防御分支，正常流程不可达），改用持久化高水位
  计数器分配新 `sortOrder` 追加到末尾，计数器 +1（服务端同时输出诊断日志，提示排查外部修改/迁移/实现缺陷）。
- 快照中的原始 `createdAt`、`updatedAt` 原样写回数据库并保留，**不会被重置**为恢复时刻
  （仅不回显在恢复响应里；时间戳本身按快照精确保存）。

```jsonc
POST /api/jobs/restore
{
  "record": {
    "id": "cdb94cab-41bf-4c0a-babe-adadfa2da456",
    "company": "示例科技",
    "position": "前端工程师",
    "appliedDate": "2026-09-01",
    "status": "offer",
    "notes": "offer",
    "sortOrder": 3,
    "createdAt": "2026-10-23T08:15:42.083Z",
    "updatedAt": "2026-10-23T08:15:42.083Z"
  }
}

// 成功 → 201 Created（恰好 8 字段，无时间戳字段）
{
  "data": {
    "id": "cdb94cab-41bf-4c0a-babe-adadfa2da456",
    "company": "示例科技",
    "position": "前端工程师",
    "appliedDate": "2026-09-01",
    "status": "offer",
    "notes": "offer",
    "sortOrder": 3,
    "restoredAs": "original"
  }
}
```

### 错误响应

- `409 id_conflict`：id 已存在，**不覆盖**现有记录。重复恢复同一快照：第一次 201，
  之后一律 409——契约如实，不宣称幂等成功。
- `400`（统一 `{ error: { code, message } }` 格式）：`invalid_id`、`invalid_company`、
  `invalid_position`、`invalid_applied_date`、`invalid_status`、`invalid_notes`、
  `invalid_request`（缺少/非对象 record、`sortOrder` 或时间戳非法），
  以及请求体层面的 `malformed_body`、`request_too_large`、`unsupported_body_encoding`。
- 数据库或计数器异常 → `500 internal_error`：走现有统一错误处理，
  不暴露 SQL、文件路径或堆栈。

### 原子性与重试

- 恢复在**单个事务**中原子完成：id 存在性检查 → 原槽位判定
  （空闲 → 原值插回 / 被占 → 计数器分配追加）→ `INSERT` → 必要时的计数器推进，均同事务。
- 任一步失败（如数据库异常、计数器推进失败），**整个事务回滚**：不产生半写入，
  计数器不漂移，同一快照可安全重试（重试时按当时状态重新判定 `original` / `appended`）。
- 重复恢复同一快照不会覆盖现有记录：id 已存在即返回 409，撤销 UI 可据此关闭窗口。

## 导入 ID 契约（`POST /api/jobs/import`）

- 普通 `POST /api/jobs` 始终由服务端生成 UUID v4，客户端提供的 `id` 被忽略。
- 导入项**允许**携带历史 id（保留 localStorage 记录原 id）：
  - 格式：1-64 字符，首字符为字母或数字，其余为 `A-Za-z0-9._~:-`
    （兼容 `sample-1`、前端回退格式 `job-<ts>-<rand>` 与 UUID）。
  - 不携带 id 的导入项由服务端生成新 UUID。
- **幂等重试**：同一批数据重复导入，id 已存在且逐字段内容（company/position/appliedDate/status/notes，
  先归一化 trim）一致 → 跳过该行，不产生重复记录；整批仍返回 201（含命中已存在行的结果）。
- **冲突回滚**：id 已存在（或同批出现两次）但内容不同 → 409 `id_conflict`，整批事务回滚，
  绝不部分写入。迁移失败重试不会清空或覆盖任何现有用户数据。

## 记录顺序契约

本节区分三个概念，避免相互覆盖：

**三个概念（互不覆盖）**

| 概念 | 归属 | 语义 |
|---|---|---|
| 数据库默认持久化顺序 | 后端 `GET /api/jobs` 默认返回序 | 稳定、确定性，反映"记录加入的先后" |
| 前端显式排序 | `SearchFilter`（搜索/筛选/日期排序） | 用户主动选择，永远优先于默认序 |
| 撤销恢复位置语义 | `useJobs` 的删除快照与 `restoreDeleted` | 优先按删除快照的 `sortOrder` 由服务端还原原槽位（LIFO、5 秒窗口）；仅当恢复后重新拉取列表失败时，才按删除前数组索引做本地近似插入 |

**1. 数据库迁移（启动时自动，幂等）**

- 新数据库：`CREATE TABLE jobs` 直接包含 `sort_order INTEGER NOT NULL`（`CREATE TABLE IF NOT EXISTS` 对旧库跳过建表，不报错）。
- 旧数据库：先执行 `PRAGMA table_info(jobs)` 检测 `sort_order` 列是否存在，**仅当列不存在时**执行：
  - `ALTER TABLE jobs ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;`
  - `UPDATE jobs SET sort_order = rowid ORDER BY rowid;`（按现有 rowid 顺序连续回填，即历史插入顺序）
- 结构变更与回填处于**同一个 better-sqlite3 `db.transaction`** 中：SQLite 的 DDL 支持事务回滚，
  迁移中途任意失败（磁盘满、回填异常等）会整体回滚，数据库保持迁移前的原始状态，之后可安全重试；
  失败路径不需要人为清理。**不删除旧库、不清空任何记录。**
- 迁移在服务器开始接受请求**之前**执行（启动序列钩子），避免与后续请求并发写。
- 迁移行为由测试覆盖（迁移前后行数与内容一致、回填后顺序与 rowid 顺序一致）。

**2. 创建与导入**

- `POST /api/jobs` 与 `POST /api/jobs/import` 的新记录：`sort_order = MAX(sort_order) + 1`，
  即"追加到末尾"，与现有 localStorage 数组 `push` 语义一致。
- 幂等命中（同 id、五字段内容一致）**不改变**该行现有 sort_order——重试导入永远不会移动已有记录。
- **导入带历史 id 的语义 = 追加**：迁移时首次导入的历史记录全部追加到当前末尾（按导入时的批内顺序）。
  这不是"回到当初位置"——历史位置信息在迁移时刻已无从知晓，首次迁移明确采用追加语义。
- `GET /api/jobs` 默认改为 `ORDER BY sort_order ASC, id ASC`（第二个键为确定性 tie-break，
  防御未来 sort_order 出现等值时的未定义顺序）。
- 数据库默认顺序**不能覆盖**前端显式选择的搜索/筛选/日期排序——前端始终在拿到默认序后自行排序。

**3. 删除与撤销恢复（原位还原）**

- 前端 `useJobs.ts`：删除撤销条目携带服务器返回的完整 9 字段快照，LIFO、5 秒有效期；
  `restoreDeleted` 把快照提交到 `POST /api/jobs/restore`，成功后以重新拉取的服务器列表为准；
  撤销"新增"（`removeJobById`）带 `expected` 快照校验，避免撤销丢弃后续编辑。
- 单纯复用 `POST /api/jobs/import`（保留历史 id、幂等）只能把记录追加到末尾，
  不满足原位恢复要求——因此提供专用恢复接口（契约见上方"恢复接口"一节）：
  删除快照自带 `sortOrder`，原槽位空闲则按原槽位还原（`restoredAs: 'original'`），
  槽位被占（外部修改等防御分支）降级为计数器分配追加（`restoredAs: 'appended'`）。
- LIFO/5 秒窗口由前端控制，后端不做定时清理、不做软删除。

## 数据目录/可靠性附注

- 服务器退出路径未显式关闭 DB 连接（WAL 文件残留属正常，不丢数据）；
  `foreign_keys` 未显式开启（当前 schema 无外键列）。
- 结构化错误响应统一为 `{ error: { code, message } }`。
