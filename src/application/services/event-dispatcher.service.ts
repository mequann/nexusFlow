import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, APP_LOGGER, CIRCUIT_BREAKER } from '../tokens.js';
import type { AppConfig } from '../../config/env.js';
import type { ILogger } from '../../domain/ports/telemetry.js';
import type { OutboxEvent } from '../../domain/execution/types.js';
import type { CircuitBreakerRegistry } from '../../infrastructure/resilience/circuit-breaker.js';

export interface EventListener {
  (event: OutboxEvent): void | Promise<void>;
}

@Injectable()
export class EventDispatcherService {
  private readonly emitter = new EventEmitter();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
    @Inject(CIRCUIT_BREAKER) private readonly circuitBreaker: CircuitBreakerRegistry,
  ) {
    this.emitter.setMaxListeners(100);
  }

  on(eventType: string, listener: EventListener): () => void {
    this.emitter.on(eventType, listener);
    return () => {
      this.emitter.off(eventType, listener);
    };
  }

  onAny(listener: EventListener): () => void {
    const handler = (event: OutboxEvent) => void listener(event);
    this.emitter.on('*', handler);
    return () => {
      this.emitter.off('*', handler);
    };
  }

  async dispatch(event: OutboxEvent): Promise<void> {
    // 1. In-process event dispatch
    this.emitter.emit(event.eventType, event);
    this.emitter.emit('*', event);

    // 2. Outbound HTTP Webhook dispatch if configured
    if (this.config.OUTBOUND_WEBHOOK_URL) {
      await this.dispatchHttpWebhook(this.config.OUTBOUND_WEBHOOK_URL, event);
    }
  }

  private async dispatchHttpWebhook(url: string, event: OutboxEvent): Promise<void> {
    const bodyStr = JSON.stringify({
      id: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      createdAt: event.createdAt,
    });

    const secret = this.config.OUTBOUND_WEBHOOK_SECRET ?? this.config.JWT_SECRET;
    const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');

    const key = `outbox_webhook:${new URL(url).hostname}`;

    await this.circuitBreaker.execute(key, async () => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NexusFlow-Delivery': event.id,
          'X-NexusFlow-Event': event.eventType,
          'X-NexusFlow-Timestamp': new Date().toISOString(),
          'X-NexusFlow-Signature': `sha256=${signature}`,
        },
        body: bodyStr,
      });

      if (!res.ok) {
        throw new Error(`Outbound webhook responded with status ${res.status}`);
      }
    });

    this.logger.info('Outbox event dispatched via HTTP webhook', {
      eventId: event.id,
      eventType: event.eventType,
      url,
    });
  }
}
