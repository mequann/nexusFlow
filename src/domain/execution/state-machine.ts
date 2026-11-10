import { StateTransitionError } from '../errors.js';
import type { InstanceStatus, UserTaskStatus } from './types.js';

const INSTANCE_TRANSITIONS: Record<InstanceStatus, ReadonlySet<InstanceStatus>> = {
  PENDING: new Set(['RUNNING', 'CANCELLED', 'FAILED']),
  RUNNING: new Set([
    'RUNNING',
    'WAITING',
    'INCIDENT_OPEN',
    'COMPENSATING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ]),
  WAITING: new Set([
    'RUNNING',
    'WAITING',
    'INCIDENT_OPEN',
    'COMPENSATING',
    'COMPLETED',
    'CANCELLED',
  ]),
  INCIDENT_OPEN: new Set(['RUNNING', 'COMPENSATING', 'FAILED', 'CANCELLED']),
  COMPENSATING: new Set(['COMPENSATED', 'FAILED']),
  COMPENSATED: new Set([]),
  COMPLETED: new Set([]),
  FAILED: new Set([]),
  CANCELLED: new Set([]),
};

const TASK_TRANSITIONS: Record<UserTaskStatus, ReadonlySet<UserTaskStatus>> = {
  OPEN: new Set(['CLAIMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED']),
  CLAIMED: new Set(['OPEN', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED']),
  COMPLETED: new Set([]),
  REJECTED: new Set([]),
  CANCELLED: new Set([]),
  EXPIRED: new Set([]),
};

export function assertInstanceTransition(from: InstanceStatus, to: InstanceStatus): void {
  if (!INSTANCE_TRANSITIONS[from].has(to)) {
    throw new StateTransitionError('WorkflowInstance', from, to);
  }
}

export function assertTaskTransition(from: UserTaskStatus, to: UserTaskStatus): void {
  if (!TASK_TRANSITIONS[from].has(to)) {
    throw new StateTransitionError('UserTask', from, to);
  }
}

export function isTerminalInstanceStatus(status: InstanceStatus): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'COMPENSATED' ||
    status === 'FAILED' ||
    status === 'CANCELLED'
  );
}
