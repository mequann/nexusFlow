import { describe, expect, it } from 'vitest';
import { NotificationService } from '../../src/application/services/notification-service.js';
import { UserSyncService } from '../../src/application/services/user-sync-service.js';
import { MemoryUnitOfWork } from '../../src/infrastructure/repositories/memory/memory-uow.js';

describe('Enterprise Notifications and User Sync Service', () => {
  it('dispatches and scopes notifications to the assigned actor and candidate group', async () => {
    const uow = new MemoryUnitOfWork();
    const service = new NotificationService(uow);

    // Create notification for finance officer
    await service.notify({
      recipientId: 'cfo@company.com',
      recipientGroup: 'finance',
      title: 'Approve $50k PO',
      message: 'Pending high-value invoice approval',
      type: 'TASK_ASSIGNED',
      taskId: 'task-101',
      instanceId: 'inst-101',
    });

    // Create notification for legal counsel
    await service.notify({
      recipientId: 'counsel@company.com',
      recipientGroup: 'legal',
      title: 'Review NDA',
      message: 'Vendor NDA review',
      type: 'TASK_ASSIGNED',
      taskId: 'task-102',
      instanceId: 'inst-102',
    });

    // CFO should only receive notifications for CFO or group 'finance'
    const cfoNotifs = await service.listForUser('cfo@company.com', ['finance']);
    expect(cfoNotifs).toHaveLength(1);
    expect(cfoNotifs[0]?.title).toBe('Approve $50k PO');
    expect(cfoNotifs[0]?.read).toBe(false);

    // Mark as read
    await service.markAsRead(cfoNotifs[0]!.id);
    const unread = await service.listForUser('cfo@company.com', ['finance'], { read: false });
    expect(unread).toHaveLength(0);

    // Another user (legal) should only see their own notification
    const legalNotifs = await service.listForUser('counsel@company.com', ['legal']);
    expect(legalNotifs).toHaveLength(1);
    expect(legalNotifs[0]?.title).toBe('Review NDA');
  });

  it('imports external users and resolves manager reporting hierarchies', async () => {
    const uow = new MemoryUnitOfWork();
    const syncService = new UserSyncService(uow);

    const batch = [
      {
        email: 'vp.eng@company.com',
        name: 'VP Engineering',
        role: 'OPERATOR' as const,
        department: 'Engineering',
      },
      {
        email: 'lead.dev@company.com',
        name: 'Lead Developer',
        role: 'BUILDER' as const,
        department: 'Engineering',
        managerEmail: 'vp.eng@company.com',
      },
    ];

    const result = await syncService.syncUsers(batch);
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);

    const lead = await uow.repos.users.findByEmail('lead.dev@company.com');
    const vp = await uow.repos.users.findByEmail('vp.eng@company.com');
    expect(lead).toBeDefined();
    expect(vp).toBeDefined();
    expect(lead?.managerId).toBe(vp?.id);
    expect(lead?.department).toBe('Engineering');
  });
});

