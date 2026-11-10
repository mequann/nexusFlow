import { ValidationError } from '../errors.js';

export type FormFieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'select'
  | 'date'
  | 'email';

export interface FormFieldRule {
  name: string;
  label?: string;
  type: FormFieldType;
  required?: boolean;
  min?: number;
  max?: number;
  options?: string[];
  pattern?: string;
}

export interface KissflowFormSchema {
  title?: string;
  fields: FormFieldRule[];
}

/**
 * Validates Kissflow-style no-code form submissions at case intake or human task completion.
 */
export function validateFormSubmission(
  schema: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  const rawFields = (schema as { fields?: unknown }).fields;
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    return;
  }

  const issues: Array<{ field: string; message: string }> = [];

  for (const field of rawFields as FormFieldRule[]) {
    const val = payload[field.name];
    const isMissing = val === undefined || val === null || val === '';

    if (field.required && isMissing) {
      issues.push({
        field: field.name,
        message: `Field '${field.label ?? field.name}' is required`,
      });
      continue;
    }

    if (isMissing) continue;

    switch (field.type) {
      case 'text':
        if (typeof val !== 'string') {
          issues.push({ field: field.name, message: `'${field.name}' must be a string` });
        } else {
          if (field.min !== undefined && val.length < field.min) {
            issues.push({
              field: field.name,
              message: `'${field.name}' length must be >= ${field.min}`,
            });
          }
          if (field.max !== undefined && val.length > field.max) {
            issues.push({
              field: field.name,
              message: `'${field.name}' length must be <= ${field.max}`,
            });
          }
          if (field.pattern && !new RegExp(field.pattern).test(val)) {
            issues.push({
              field: field.name,
              message: `'${field.name}' does not match required format`,
            });
          }
        }
        break;

      case 'email':
        if (typeof val !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          issues.push({ field: field.name, message: `'${field.name}' must be a valid email` });
        }
        break;

      case 'number':
      case 'currency':
        if (typeof val !== 'number' || Number.isNaN(val)) {
          issues.push({ field: field.name, message: `'${field.name}' must be a valid number` });
        } else {
          if (field.min !== undefined && val < field.min) {
            issues.push({ field: field.name, message: `'${field.name}' must be >= ${field.min}` });
          }
          if (field.max !== undefined && val > field.max) {
            issues.push({ field: field.name, message: `'${field.name}' must be <= ${field.max}` });
          }
        }
        break;

      case 'boolean':
        if (typeof val !== 'boolean') {
          issues.push({ field: field.name, message: `'${field.name}' must be a boolean` });
        }
        break;

      case 'select':
        if (
          typeof val !== 'string' ||
          (Array.isArray(field.options) && !field.options.includes(val))
        ) {
          issues.push({
            field: field.name,
            message: `'${field.name}' must be one of [${(field.options ?? []).join(', ')}]`,
          });
        }
        break;

      case 'date':
        if (typeof val !== 'string' || Number.isNaN(Date.parse(val))) {
          issues.push({
            field: field.name,
            message: `'${field.name}' must be a valid ISO date string`,
          });
        }
        break;
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('Form submission validation failed', issues);
  }
}
