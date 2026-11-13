import { Inject, Injectable, Logger } from '@nestjs/common';
import { TaskService } from './task-service.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

export interface TelegramCallbackQuery {
  id: string;
  from: {
    id: number;
    first_name: string;
    username?: string;
  };
  message?: {
    message_id: number;
    chat: {
      id: number;
    };
    text?: string;
  };
  data?: string; // e.g. "APPROVE:task-uuid" or "REJECT:task-uuid"
}

export interface TelegramWebhookUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number };
    text?: string;
  };
}

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;

  constructor(
    @Inject(TaskService) private readonly taskService: TaskService,
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
  ) {}

  /**
   * Formats a rich bilingual message card for Telegram notifications.
   */
  public formatTaskNotificationCard(task: {
    id: string;
    name: string;
    workflowInstanceId: string;
    dueAt?: Date;
    ethiopianDueDate?: string;
  }): { text: string; replyMarkup: any } {
    const text = [
      `📋 *አዲስ የውሳኔ ጥያቄ (New Approval Task)*`,
      ``,
      `*ተግባር (Task):* ${task.name}`,
      `*የሂደት ቁጥር (Instance):* \`${task.workflowInstanceId.slice(0, 8)}...\``,
      task.ethiopianDueDate ? `*የተሰጠው ጊዜ (Due):* ${task.ethiopianDueDate}` : ``,
      ``,
      `እባክዎን ከታች ካሉት አማራጮች አንዱን ይምረጡ:`,
    ]
      .filter(Boolean)
      .join('\n');

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '✅ ፍቀድ (Approve)', callback_data: `APPROVE:${task.id}` },
          { text: '❌ ውድቅ አድርግ (Reject)', callback_data: `REJECT:${task.id}` },
        ],
      ],
    };

    return { text, replyMarkup };
  }

  /**
   * Dispatches a message to a Telegram chat using Telegram Bot API.
   */
  public async sendTelegramMessage(chatId: string | number, text: string, replyMarkup?: any): Promise<boolean> {
    if (!this.botToken) {
      this.logger.debug(`[MOCK TELEGRAM] To chatId ${chatId}: ${text}`);
      return true;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Failed to send Telegram message: ${errorText}`);
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Telegram API error: ${err.message}`);
      return false;
    }
  }

  /**
   * Handles incoming Webhook updates from Telegram Bot API (e.g. 1-click approvals).
   */
  public async handleWebhookUpdate(update: TelegramWebhookUpdate): Promise<{
    handled: boolean;
    actionResult?: string;
  }> {
    if (update.callback_query && update.callback_query.data) {
      const query = update.callback_query;
      const callbackData = query.data ?? '';
      const [action, taskId] = callbackData.split(':');
      const telegramUserId = String(query.from.id);

      this.logger.log(`Received Telegram action '${action}' for task '${taskId}' from user ${telegramUserId}`);

      if (!taskId || !action) {
        return { handled: false, actionResult: 'Invalid callback format' };
      }

      // Map action to decision
      const decision = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      const isRejected = action === 'REJECT';

      try {
        await this.taskService.completeTask(
          taskId,
          telegramUserId,
          {
            decision,
            source: 'TELEGRAM_BOT',
            telegramUserId,
            submittedAt: new Date().toISOString(),
          },
          isRejected,
        );

        // Send confirmation back to user
        const confirmationMessage = action === 'APPROVE'
          ? `✅ ውሳኔዎ በተሳካ ሁኔታ ተመዝግቧል (Task Approved)`
          : `❌ ጥያቄው ውድቅ መደረጉ ተመዝግቧል (Task Rejected)`;

        if (query.message?.chat.id) {
          await this.sendTelegramMessage(query.message.chat.id, confirmationMessage);
        }

        return { handled: true, actionResult: `Task ${taskId} completed with decision ${decision}` };
      } catch (err: any) {
        this.logger.error(`Failed to complete task from Telegram: ${err.message}`);
        if (query.message?.chat.id) {
          await this.sendTelegramMessage(query.message.chat.id, `⚠️ ስህተት ተፈጥሯል: ${err.message}`);
        }
        return { handled: false, actionResult: err.message };
      }
    }

    return { handled: true, actionResult: 'Ignored non-callback update' };
  }
}
