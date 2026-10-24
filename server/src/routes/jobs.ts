import { Router } from 'express'
import { jobService } from '../services/jobService.js'

const router = Router()

router.get('/', (_req, res) => {
  const jobs = jobService.listJobs()
  res.json({ data: jobs })
})

router.get('/:id', (req, res, next) => {
  try {
    const job = jobService.getJob(req.params.id)
    res.json({ data: job })
  } catch (err) {
    next(err)
  }
})

router.post('/', (req, res, next) => {
  try {
    const job = jobService.createJob(req.body)
    res.status(201).json({ data: job })
  } catch (err) {
    next(err)
  }
})

/** 批量导入：整批在一个数据库事务中写入，任一记录非法则整批回滚。 */
router.post('/import', (req, res, next) => {
  try {
    const jobs = jobService.importJobs(req.body)
    res.status(201).json({ data: jobs })
  } catch (err) {
    next(err)
  }
})

/** 撤销恢复（设计文档 v2.1 §4.3）：按删除快照恢复；201 返回恢复记录与 restoredAs。 */
router.post('/restore', (req, res, next) => {
  try {
    const restored = jobService.restoreJob(req.body)
    res.status(201).json({ data: restored })
  } catch (err) {
    next(err)
  }
})

router.put('/:id', (req, res, next) => {
  try {
    const job = jobService.updateJob(req.params.id, req.body)
    res.json({ data: job })
  } catch (err) {
    next(err)
  }
})

/** 删除：200 返回完整删除快照（设计文档 v2.1 §4.2），不存在 → 404。 */
router.delete('/:id', (req, res, next) => {
  try {
    const snapshot = jobService.deleteJob(req.params.id)
    res.status(200).json({ data: snapshot })
  } catch (err) {
    next(err)
  }
})

export default router
