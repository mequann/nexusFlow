import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { APP_LOGGER } from '../../../application/tokens.js';
import { DomainError } from '../../../domain/errors.js';
import type { ILogger } from '../../../domain/ports/telemetry.js';
import { getContext } from '../../../infrastructure/observability/context.js';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  constructor(@Inject(APP_LOGGER) private readonly logger: ILogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = getContext()?.correlationId ?? request.headers['x-correlation-id'];

    if (exception instanceof DomainError) {
      response.status(exception.statusCode).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          correlationId,
          path: request.url,
        },
      });
      return;
    }

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: exception.issues,
          correlationId,
          path: request.url,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resBody = exception.getResponse();
      response.status(status).json({
        error: {
          code: 'HTTP_ERROR',
          message:
            typeof resBody === 'string'
              ? resBody
              : ((resBody as { message?: string }).message ?? exception.message),
          details: typeof resBody === 'object' ? resBody : undefined,
          correlationId,
          path: request.url,
        },
      });
      return;
    }

    this.logger.error('Unhandled exception in HTTP pipeline', {
      path: request.url,
      method: request.method,
      error: exception instanceof Error ? exception.message : String(exception),
    });

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred',
        correlationId,
        path: request.url,
      },
    });
  }
}

