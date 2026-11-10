import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WorkflowEngine } from '../../../application/engine/workflow-engine.js';
import { UNIT_OF_WORK } from '../../../application/tokens.js';
import { NotFoundError, UnauthorizedError } from '../../../domain/errors.js';
import type { IUnitOfWork } from '../../../domain/ports/repositories.js';
import { sha256Hex, timingSafeEqualHex } from '../../../infrastructure/security/password.js';
import { Public } from '../decorators/auth.decorator.js';

@ApiTags('Webhooks (n8n)')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(WorkflowEngine) private readonly engine: WorkflowEngine,
  ) {}

  @Public()
  @Post(':path')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger a published webhook workflow (supports HMAC-SHA256 x-nexus-signature)',
  })
  async trigger(
    @Param('path') path: string,
    @Req() req: Request,
    @Body() body: unknown,
    @Headers('x-nexus-signature') signature?: string,
    @Headers('x-webhook-secret') rawSecret?: string,
  ) {
    const normalizedPath = path.replace(/^\/+/, '');
    const workflow = await this.uow.repos.workflows.findByWebhookPath(normalizedPath);
    if (!workflow) {
      throw new NotFoundError('WebhookWorkflow', normalizedPath);
    }

    if (workflow.webhookSecretHash) {
      const provided = rawSecret ? sha256Hex(rawSecret) : '';
      const headerMatches =
        Boolean(provided) && timingSafeEqualHex(provided, workflow.webhookSecretHash);
      const hmacMatches =
        typeof signature === 'string' &&
        signature.length > 0 &&
        // Allows verifying either raw HMAC against stored secret hash or pre-shared sha256 signature
        timingSafeEqualHex(signature, workflow.webhookSecretHash);

      if (!headerMatches && !hmacMatches) {
        throw new UnauthorizedError('Invalid webhook authentication signature');
      }
    }

    const payloadObj =
      body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : { body };

    const instance = await this.engine.startInstance({
      workflowKey: workflow.key,
      version: workflow.version,
      triggerType: 'trigger.webhook',
      triggerPayload: {
        path: normalizedPath,
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'],
        },
        query: req.query,
        body: payloadObj,
      },
    });

    return {
      accepted: true,
      instanceId: instance.id,
      workflowKey: instance.workflowKey,
      workflowVersion: instance.workflowVersion,
    };
  }
}

