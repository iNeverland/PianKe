import { ErrorCode } from './errorCodes.js';

/** 主进程统一错误类型：携带可序列化的错误码与可选的诊断细节。 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}
