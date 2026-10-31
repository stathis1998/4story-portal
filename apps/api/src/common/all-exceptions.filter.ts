import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { ApiErrorBody } from '@4story-portal/shared';
import type { Response } from 'express';

// Every error leaves the API as ApiErrorBody. Unexpected errors are logged here and reach the
// browser only as a generic 500, so SQL and stack traces never leak.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Unhandled');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res.status(this.statusOf(exception)).json(this.bodyOf(exception));
  }

  private statusOf(exception: unknown): number {
    return exception instanceof HttpException ? exception.getStatus() : 500;
  }

  private bodyOf(exception: unknown): ApiErrorBody {
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
      return { statusCode: 500, message: 'Internal server error' };
    }

    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'string') return { statusCode, message: response };

    const { message, fieldErrors } = response as { message?: string | string[]; fieldErrors?: ApiErrorBody['fieldErrors'] };
    const body: ApiErrorBody = {
      statusCode,
      message: Array.isArray(message) ? message.join(', ') : (message ?? exception.message),
    };
    if (fieldErrors) body.fieldErrors = fieldErrors;
    return body;
  }
}
