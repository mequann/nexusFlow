import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { NodeExecutorRegistry } from '../../../application/engine/node-executors.js';
import { RequirePermission } from '../decorators/auth.decorator.js';
import {
  ConnectorDescriptorDto,
  ConnectorListResponseDto,
  ErrorResponseDto,
  RegisterHttpConnectorDto,
} from '../dto/api.dto.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const RegisterConnectorSchema = z.object({
  type: z
    .string()
    .regex(/^(connector|custom)\.[a-z0-9_-]+$/, 'Must be prefixed with connector. or custom.'),
  title: z.string().min(1).max(150),
  description: z.string().min(1).max(500),
  endpointUrl: z.string().url(),
  method: z.enum(['POST', 'PUT', 'PATCH']).optional(),
  credentialName: z.string().optional(),
  defaultHeaders: z.record(z.string()).optional(),
});

@ApiTags('Dynamic Connectors & Plugins')
@ApiBearerAuth()
@Controller('api/v1/connectors')
export class ConnectorsController {
  constructor(@Inject(NodeExecutorRegistry) private readonly registry: NodeExecutorRegistry) {}

  @Get()
  @RequirePermission('workflow:read')
  @ApiOperation({
    summary: 'List all built-in and dynamically registered step/connector types & schemas',
  })
  @ApiOkResponse({ description: 'Available workflow connectors', type: ConnectorListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  list() {
    return { items: this.registry.listConnectors() };
  }

  @Post('register')
  @RequirePermission('workflow:write')
  @ApiOperation({
    summary: 'Dynamically register a custom HTTP-backed connector step type at runtime',
  })
  @ApiBody({ type: RegisterHttpConnectorDto })
  @ApiCreatedResponse({ description: 'Custom connector registered', type: ConnectorDescriptorDto })
  @ApiBadRequestResponse({ description: 'Validation error', type: ErrorResponseDto })
  @ApiForbiddenResponse({ description: 'Insufficient permissions', type: ErrorResponseDto })
  register(
    @Body(new ZodValidationPipe(RegisterConnectorSchema)) body: RegisterHttpConnectorDto,
  ) {
    return this.registry.registerHttpConnector(body);
  }
}

