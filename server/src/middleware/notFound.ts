import { RequestHandler } from 'express'

/** 404：未匹配到的 API 路径返回统一 JSON 错误。 */
export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: 'not_found', message: '请求的资源不存在' },
  })
}
