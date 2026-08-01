import { ErrorCode } from './errorCodes.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      detail: this.detail,
    };
  }

  static fromJSON(json: Record<string, unknown>): AppError {
    return new AppError(
      json.code as ErrorCode,
      json.message as string,
      json.detail
    );
  }
}
