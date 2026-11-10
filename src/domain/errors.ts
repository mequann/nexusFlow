export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, identifier: string) {
    super('NOT_FOUND', `${entity} '${identifier}' was not found`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions for this operation') {
    super('FORBIDDEN', message, 403);
  }
}

export class StateTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Cannot transition ${entity} from '${from}' to '${to}'`,
      409,
    );
  }
}

export class SecurityViolationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('SECURITY_VIOLATION', message, 403, details);
  }
}

export class ExternalServiceError extends DomainError {
  public readonly retryable: boolean;

  constructor(message: string, retryable = true, details?: unknown) {
    super('EXTERNAL_SERVICE_ERROR', message, 502, details);
    this.retryable = retryable;
  }
}
