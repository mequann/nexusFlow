import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { IMetrics } from '../../domain/ports/telemetry.js';

export class PrometheusMetrics implements IMetrics {
  public readonly registry: Registry;
  private readonly httpDuration: Histogram<string>;
  private readonly stepCounter: Counter<string>;
  private readonly stepDuration: Histogram<string>;
  private readonly instanceCounter: Counter<string>;
  private readonly incidentCounter: Counter<string>;
  private readonly activeInstancesGauge: Gauge<string>;

  constructor(enableDefaultMetrics = true) {
    this.registry = new Registry();
    if (enableDefaultMetrics) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.httpDuration = new Histogram({
      name: 'nexusflow_http_request_duration_ms',
      help: 'HTTP request latency in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [5, 15, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });

    this.stepCounter = new Counter({
      name: 'nexusflow_step_executions_total',
      help: 'Total workflow node step executions',
      labelNames: ['node_type', 'status'],
      registers: [this.registry],
    });

    this.stepDuration = new Histogram({
      name: 'nexusflow_step_duration_ms',
      help: 'Workflow node step execution duration in milliseconds',
      labelNames: ['node_type'],
      buckets: [1, 5, 25, 100, 500, 1000, 5000, 15000],
      registers: [this.registry],
    });

    this.instanceCounter = new Counter({
      name: 'nexusflow_instances_completed_total',
      help: 'Total workflow instances reaching terminal states',
      labelNames: ['workflow_key', 'status'],
      registers: [this.registry],
    });

    this.incidentCounter = new Counter({
      name: 'nexusflow_incidents_opened_total',
      help: 'Total workflow incidents opened',
      labelNames: ['incident_type'],
      registers: [this.registry],
    });

    this.activeInstancesGauge = new Gauge({
      name: 'nexusflow_active_instances',
      help: 'Current number of non-terminal workflow instances',
      registers: [this.registry],
    });
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    this.httpDuration.observe(
      { method, route, status_code: String(statusCode) },
      durationMs,
    );
  }

  recordStepExecution(nodeType: string, status: string, durationMs: number): void {
    this.stepCounter.inc({ node_type: nodeType, status });
    this.stepDuration.observe({ node_type: nodeType }, durationMs);
  }

  recordInstanceCompleted(workflowKey: string, status: string, _durationMs: number): void {
    this.instanceCounter.inc({ workflow_key: workflowKey, status });
  }

  incIncidentOpened(incidentType: string): void {
    this.incidentCounter.inc({ incident_type: incidentType });
  }

  setActiveInstances(count: number): void {
    this.activeInstancesGauge.set(count);
  }

  async renderPrometheus(): Promise<string> {
    return this.registry.metrics();
  }
}
