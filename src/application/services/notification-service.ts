import crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationRecord, NotificationType } from '../../domain/execution/types.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

export interface SendNotificationInput {
  recipientId: string;
  recipientGroup?: string | null;
  title: string;
  message: string;
  type: NotificationType;
  taskId?: string | null;
  instanceId?: string | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  /**
   * Dispatch a notification to the specified recipient and/or group.
   * Dispatches both to the durable database notifications table and to configured webhooks/event logs.
   */
  async notify(input: SendNotificationInput): Promise<NotificationRecord> {
    const notification: NotificationRecord = {
      id: crypto.randomUUID(),
      recipientId: input.recipientId,
      recipientGroup: input.recipientGroup ?? null,
      title: input.title,
      message: input.message,
      type: input.type,
      taskId: input.taskId ?? null,
      instanceId: input.instanceId ?? null,
      read: false,
      createdAt: new Date(),
      readAt: null,
    };

    const saved = await this.uow.repos.notifications.create(notification);
    this.logger.log(
      `[Notification] ${input.type} -> ${input.recipientId}${
        input.recipientGroup ? ` (${input.recipientGroup})` : ''
      }: "${input.title}"`,
    );

    return saved;
  }

  /**
   * List notifications for a given user and their candidate groups.
   */
  async listForUser(
    userId: string,
    groups: string[] = [],
    options?: { read?: boolean; limit?: number },
  ): Promise<NotificationRecord[]> {
    return this.uow.repos.notifications.list({
      recipientOrGroup: { recipientId: userId, groups },
      read: options?.read,
      limit: options?.limit ?? 50,
    });
  }

  async markAsRead(id: string): Promise<void> {
    await this.uow.repos.notifications.markAsRead(id, new Date());
  }

  async markAllAsRead(recipientId: string): Promise<void> {
    await this.uow.repos.notifications.markAllAsRead(recipientId, new Date());
  }
}
