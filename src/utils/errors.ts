export type ErrorCode = 
  | 'ERR_MISSING_FILES'
  | 'ERR_FILE_CORRUPT'
  | 'ERR_FILE_TOO_LARGE'
  | 'ERR_MISSING_COLUMNS'
  | 'ERR_DUPLICATES_GESTOR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public code: ErrorCode;
  public statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    // Capture stack trace for better debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}
