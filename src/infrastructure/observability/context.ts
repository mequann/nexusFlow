import { AsyncLocalStorage } from 'node:async_hooks';

export interface ExecutionContext {
  correlationId: string;
  traceId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<ExecutionContext>();

export function runWithContext<T>(ctx: ExecutionContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): ExecutionContext | undefined {
  return storage.getStore();
}
