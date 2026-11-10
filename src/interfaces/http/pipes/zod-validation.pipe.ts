import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ValidationError } from '../../../domain/errors.js';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new ValidationError('Request validation failed', parsed.error.issues);
    }
    return parsed.data;
  }
}

