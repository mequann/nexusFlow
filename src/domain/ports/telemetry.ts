export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  meta?: Record<string, unknown>;
}

export interface ILogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  getRecentLogs?(limit?: number, minLevel?: string): LogEntry[];
}

export interface IMetrics {
  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void;
  recordStepExecution(nodeType: string, status: string, durationMs: number): void;
  recordInstanceCompleted(workflowKey: string, status: string, durationMs: number): void;
  incIncidentOpened(incidentType: string): void;
  setActiveInstances(count: number): void;
}
