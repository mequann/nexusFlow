import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

export interface CorrelateMessageResult {
  matchedSubscriptions: number;
  resumedInstanceIds: string[];
}

@Injectable()
export class MessageService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  async correlateMessage(
    messageName: string,
    correlationKey: string,
    payload: Record<string, unknown> = {},
  ): Promise<CorrelateMessageResult> {
    return this.uow.runInTransaction(async (repos) => {
      const subs = await repos.subscriptions.findActiveMessage(messageName, correlationKey);
      const now = new Date();
      const resumedInstanceIds: string[] = [];

      for (const sub of subs) {
        await repos.subscriptions.update({
          ...sub,
          status: 'TRIGGERED',
          payload,
          triggeredAt: now,
        });

        await repos.jobs.enqueue({
          id: crypto.randomUUID(),
          instanceId: sub.instanceId,
          tokenId: sub.tokenId,
          nodeId: sub.nodeId,
          jobType: 'RESUME_TOKEN',
          payload,
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 3,
          availableAt: now,
          lockedBy: null,
          lockedAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });

        await repos.outbox.append({
          id: crypto.randomUUID(),
          aggregateType: 'EventSubscription',
          aggregateId: sub.id,
          eventType: 'MESSAGE_CORRELATED',
          payload: {
            subscriptionId: sub.id,
            instanceId: sub.instanceId,
            messageName,
            correlationKey,
          },
          status: 'PENDING',
          attempts: 0,
          createdAt: now,
          publishedAt: null,
        });

        resumedInstanceIds.push(sub.instanceId);
      }

      return {
        matchedSubscriptions: subs.length,
        resumedInstanceIds,
      };
    });
  }
}

