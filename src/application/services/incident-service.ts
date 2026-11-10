import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import type { Incident, IncidentStatus } from '../../domain/execution/types.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

export type IncidentResolutionAction = 'RETRY' | 'COMPENSATE' | 'FAIL';

@Injectable()
export class IncidentService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  async listIncidents(filters?: {
    status?: IncidentStatus;
    instanceId?: string;
  }): Promise<Incident[]> {
    return this.uow.repos.incidents.list(filters);
  }

  async resolveIncident(
    incidentId: string,
    actorId: string,
    action: IncidentResolutionAction,
    note?: string,
    variablesPatch?: Record<string, unknown>,
  ): Promise<Incident> {
    return this.uow.runInTransaction(async (repos) => {
      const incident = await repos.incidents.findById(incidentId);
      if (!incident) throw new NotFoundError('Incident', incidentId);
      if (incident.status !== 'OPEN') {
        throw new ConflictError(`Incident '${incidentId}' is already '${incident.status}'`);
      }

      const instance = await repos.instances.findById(incident.instanceId);
      if (!instance) throw new NotFoundError('WorkflowInstance', incident.instanceId);

      const now = new Date();
      const resolved = await repos.incidents.update({
        ...incident,
        status: 'RESOLVED',
        resolvedBy: actorId,
        resolutionNote: note ?? action,
        resolvedAt: now,
      });

      if (action === 'RETRY') {
        const token = await repos.tokens.findById(incident.tokenId);
        if (token) {
          await repos.tokens.update({ ...token, status: 'ACTIVE' });
        }
        await repos.instances.updateWithOcc({
          ...instance,
          status: 'RUNNING',
          variables: variablesPatch
            ? { ...instance.variables, ...variablesPatch }
            : instance.variables,
        });
        await repos.jobs.enqueue({
          id: crypto.randomUUID(),
          instanceId: instance.id,
          tokenId: incident.tokenId,
          nodeId: incident.nodeId,
          jobType: 'EXECUTE_NODE',
          payload: {},
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
      } else if (action === 'COMPENSATE') {
        await repos.instances.updateWithOcc({
          ...instance,
          status: 'COMPENSATING',
        });
        await repos.jobs.enqueue({
          id: crypto.randomUUID(),
          instanceId: instance.id,
          tokenId: incident.tokenId,
          nodeId: incident.nodeId,
          jobType: 'COMPENSATE',
          payload: {},
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 1,
          availableAt: now,
          lockedBy: null,
          lockedAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await repos.instances.updateWithOcc({
          ...instance,
          status: 'FAILED',
          completedAt: now,
        });
      }

      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'Incident',
        aggregateId: incident.id,
        eventType: 'INCIDENT_RESOLVED',
        payload: { incidentId: incident.id, instanceId: instance.id, action, actorId },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });

      return resolved;
    });
  }
}

