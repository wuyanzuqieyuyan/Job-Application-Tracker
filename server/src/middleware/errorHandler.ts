import type { ErrorRequestHandler } from 'express'
import { AppError } from '../errors.js'

/**
 * body-parser 自身的错误类型（type 字段为服务端常量，不是用户可控输入）。
 * 仅按该白名单推导状态码，绝不信任任意异常对象自带的 status/statusCode。
 */
const BODY_PARSER_STATUS_BY_TYPE: Record<string, { status: number; code: string; message: string }> = {
  'entity.parse.failed': { status: 400, code: 'malformed_body', message: '请求体不是合法的 JSON' },
  'entity.verify.failed': { status: 400, code: 'malformed_body', message: '请求体不是合法的 JSON' },
  'entity.too.large': { status: 413, code: 'request_too_large', message: '请求体超过大小限制' },
  'encoding.unsupported': {
    status: 415,
    code: 'unsupported_body_encoding',
    message: '请求体编码或字符集不受支持',
  },
  'charset.unsupported': {
    status: 415,
    code: 'unsupported_body_encoding',
    message: '请求体编码或字符集不受支持',
  },
}

interface ErrorShape {
  type?: unknown
}

/**
 * 统一 JSON 错误响应。不向客户端暴露 SQL、堆栈跟踪、本地文件路径或
 * 未知异常携带的任何细节。
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    })
    return
  }

  const shape = (typeof err === 'object' && err !== null ? err : undefined) as ErrorShape | undefined
  const type = shape?.type
  const mapped = typeof type === 'string' ? BODY_PARSER_STATUS_BY_TYPE[type] : undefined
  if (mapped) {
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message },
    })
    return
  }

  // 其余一律 500：不做兜底信任，不透出 err.message/type/堆栈/SQL/路径
  res.status(500).json({
    error: { code: 'internal_error', message: '服务器内部错误' },
  })
}
