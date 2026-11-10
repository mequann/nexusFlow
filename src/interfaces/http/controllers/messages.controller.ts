import { Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { MessageService } from '../../../application/services/message-service.js';
import { RequirePermission } from '../decorators/auth.decorator.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const CorrelateMessageSchema = z.object({
  messageName: z.string().min(1),
  correlationKey: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});

@ApiTags('Message Correlation (Camunda)')
@ApiBearerAuth()
@Controller('api/v1/messages')
export class MessagesController {
  constructor(@Inject(MessageService) private readonly messageService: MessageService) {}

  @Post('correlate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('message:correlate')
  @ApiOperation({ summary: 'Correlate an external business message to waiting workflow tokens' })
  async correlate(
    @Body(new ZodValidationPipe(CorrelateMessageSchema))
    body: z.infer<typeof CorrelateMessageSchema>,
  ) {
    return this.messageService.correlateMessage(
      body.messageName,
      body.correlationKey,
      body.payload,
    );
  }
}

