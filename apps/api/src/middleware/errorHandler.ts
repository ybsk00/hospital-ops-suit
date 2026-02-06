import { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../config/env';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(statusCode: number, code: string, message: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function globalErrorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError && err.isOperational ? err.message : '서버 내부 오류가 발생했습니다.';

  if (env.isDev) {
    console.error('[ErrorHandler]', err);
  } else if (!isAppError || !err.isOperational) {
    console.error('[ErrorHandler] 예상치 못한 오류:', err);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(env.isDev && { stack: err.stack }),
    },
  });
}
