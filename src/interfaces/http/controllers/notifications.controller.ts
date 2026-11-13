import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { NotificationService } from '../../../application/services/notification-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import { ErrorResponseDto } from '../dto/api.dto.js';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationService) private readonly notificationService: NotificationService,
  ) {}

  @Get()
  @RequirePermission('task:read')
  @ApiOperation({ summary: 'List notifications for current user/group' })
  @ApiQuery({ name: 'read', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({ description: 'List of notifications' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('read') read?: string,
    @Query('limit') limit?: string,
  ) {
    const isRead = read === undefined ? undefined : read === 'true';
    const groups = [principal.email, principal.role.toLowerCase()];
    const items = await this.notificationService.listForUser(principal.userId, groups, {
      read: isRead,
      limit: limit ? Number(limit) : 50,
    });
    return { items };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('task:read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiParam({ name: 'id', example: 'd3f23a4b-5c6d-7e8f-9a0b-1c2d3e4f5a6b' })
  async markRead(@Param('id') id: string) {
    await this.notificationService.markAsRead(id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('task:read')
  @ApiOperation({ summary: 'Mark all notifications as read for current user' })
  async markAllRead(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.notificationService.markAllAsRead(principal.userId);
  }
}
