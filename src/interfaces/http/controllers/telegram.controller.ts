import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  TelegramBotService,
  TelegramWebhookUpdate,
} from '../../../application/services/telegram-bot-service.js';

@ApiTags('Telegram Bot Webhook (ቴሌግራም ቦት)')
@Controller('api/v1/webhooks/telegram')
export class TelegramWebhookController {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Telegram Bot webhook updates (1-click approvals and callbacks)' })
  public async handleWebhook(@Body() update: TelegramWebhookUpdate) {
    return this.telegramBotService.handleWebhookUpdate(update);
  }
}

