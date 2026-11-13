import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '../../config/env.js';
import { ConflictError, ExternalServiceError, NotFoundError } from '../../domain/errors.js';
import {
  assertInstanceTransition,
  isTerminalInstanceStatus,
} from '../../domain/execution/state-machine.js';
import type {
  ExecutionJob,
  ExecutionToken,
  StepExecution,
  WorkflowInstance,
} from '../../domain/execution/types.js';
import type { IRepositoryRegistry, IUnitOfWork } from '../../domain/ports/repositories.js';
import type { ILogger, IMetrics } from '../../domain/ports/telemetry.js';
import type {
  EdgeDefinition,
  NodeDefinition,
  WorkflowDefinitionRecord,
} from '../../domain/workflow/types.js';
import { validateFormSubmission } from '../../domain/workflow/form-validator.js';
import type { CircuitBreakerRegistry } from '../../infrastructure/resilience/circuit-breaker.js';
import {
  DEFAULT_RETRY_POLICY,
  computeBackoffDelayMs,
} from '../../infrastructure/resilience/retry.js';
import { evaluateExpression, type ExpressionScope } from '../expressions/evaluator.js';
import type { CredentialService } from '../services/credential-service.js';
import {
  APP_CONFIG,
  APP_LOGGER,
  APP_METRICS,
  CIRCUIT_BREAKER,
  UNIT_OF_WORK,
} from '../tokens.js';
import { CredentialService as CredentialServiceClass } from '../services/credential-service.js';
import { NodeExecutorRegistry } from './node-executors.js';

export interface StartInstanceInput {
  workflowKey: string;
  version?: number;
  triggerType?: string;
  triggerPayload?: Record<string, unknown>;
  initialVariables?: Record<string, unknown>;
  correlationKey?: string | null;
  parentInstanceId?: string | null;
  parentTokenId?: string | null;
  startedBy?: string | null;
}

@Injectable()
export class WorkflowEngine {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(NodeExecutorRegistry) private readonly executors: NodeExecutorRegistry,
    @Inject(CredentialServiceClass) private readonly credentialService: CredentialService,
    @Inject(CIRCUIT_BREAKER) private readonly circuitBreaker: CircuitBreakerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
    @Inject(APP_METRICS) private readonly metrics: IMetrics,
  ) {}

  async startInstance(input: StartInstanceInput): Promise<WorkflowInstance> {
    const workflow = input.version
      ? await this.uow.repos.workflows.findByKeyAndVersion(input.workflowKey, input.version)
      : await this.uow.repos.workflows.findLatestByKey(input.workflowKey, 'PUBLISHED');

    if (!workflow || workflow.status !== 'PUBLISHED') {
      throw new NotFoundError('PublishedWorkflow', input.workflowKey);
    }

    const triggerNode = workflow.definition.nodes.find(
      (n) => n.type.startsWith('trigger.') && !n.isCompensationHandler,
    );
    if (!triggerNode) {
      throw new NotFoundError('TriggerNode', workflow.id);
    }

    if (workflow.definition.intakeFormSchema) {
      validateFormSubmission(workflow.definition.intakeFormSchema, {
        ...(input.triggerPayload ?? {}),
        ...(input.initialVariables ?? {}),
      });
    }

    const now = new Date();
    const instanceId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const retryPolicy = triggerNode.retryPolicy ?? workflow.definition.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY;

    const instance: WorkflowInstance = {
      id: instanceId,
      workflowId: workflow.id,
      workflowKey: workflow.key,
      workflowVersion: workflow.version,
      status: 'RUNNING',
      currentStage: triggerNode.stage ?? workflow.definition.stages?.[0] ?? null,
      slaStatus: 'ON_TRACK',
      triggerType: input.triggerType ?? triggerNode.type,
      triggerPayload: input.triggerPayload ?? {},
      variables: { ...(input.initialVariables ?? {}) },
      correlationKey: input.correlationKey ?? null,
      parentInstanceId: input.parentInstanceId ?? null,
      parentTokenId: input.parentTokenId ?? null,
      startedBy: input.startedBy ?? null,
      occVersion: 1,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
    };

    const rootToken: ExecutionToken = {
      id: tokenId,
      instanceId,
      currentNodeId: triggerNode.id,
      parentTokenId: null,
      joinGroupId: null,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    const job: ExecutionJob = {
      id: crypto.randomUUID(),
      instanceId,
      tokenId,
      nodeId: triggerNode.id,
      jobType: 'EXECUTE_NODE',
      payload: {},
      status: 'PENDING',
      attempts: 0,
      maxAttempts: retryPolicy.maxAttempts,
      availableAt: now,
      lockedBy: null,
      lockedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.uow.runInTransaction(async (repos) => {
      await repos.instances.create(instance);
      await repos.tokens.create(rootToken);
      await repos.jobs.enqueue(job);
      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'WorkflowInstance',
        aggregateId: instanceId,
        eventType: 'INSTANCE_STARTED',
        payload: {
          instanceId,
          workflowKey: workflow.key,
          workflowVersion: workflow.version,
          triggerType: instance.triggerType,
        },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });
    });

    this.logger.info('Workflow instance started', {
      instanceId,
      workflowKey: workflow.key,
      workflowVersion: workflow.version,
    });

    return instance;
  }

  /**
   * Processes one queued job. Returns true if a job was processed.
   */
  async processJob(job: ExecutionJob): Promise<void> {
    if (job.jobType === 'COMPENSATE') {
      await this.executeCompensation(job.instanceId);
      await this.uow.repos.jobs.complete(job.id);
      return;
    }

    const instance = await this.uow.repos.instances.findById(job.instanceId);
    if (!instance || isTerminalInstanceStatus(instance.status)) {
      await this.uow.repos.jobs.complete(job.id);
      return;
    }

    const workflow = await this.uow.repos.workflows.findById(instance.workflowId);
    if (!workflow) {
      await this.uow.repos.jobs.markDead(job.id, job.attempts + 1, 'Workflow definition missing');
      return;
    }

    const token = await this.uow.repos.tokens.findById(job.tokenId);
    if (!token) {
      await this.uow.repos.jobs.complete(job.id);
      return;
    }

    const node = workflow.definition.nodes.find((n) => n.id === job.nodeId);
    if (!node) {
      await this.uow.repos.jobs.markDead(job.id, job.attempts + 1, `Node '${job.nodeId}' not found`);
      return;
    }

    if (job.jobType === 'RESUME_TOKEN') {
      await this.handleResumeToken(instance, workflow, token, node, job);
      await this.uow.repos.jobs.complete(job.id);
      return;
    }

    if (token.status !== 'ACTIVE') {
      await this.uow.repos.jobs.complete(job.id);
      return;
    }

    await this.handleExecuteNode(instance, workflow, token, node, job);
  }

  /**
   * Drains pending jobs synchronously in-process — invaluable for deterministic tests and CLI runs.
   */
  async drainQueue(maxIterations = 200): Promise<number> {
    let processed = 0;
    for (let i = 0; i < maxIterations; i += 1) {
      const batch = await this.uow.repos.jobs.claimNextBatch('inline-drainer', 10, new Date());
      if (batch.length === 0) break;
      for (const job of batch) {
        await this.processJob(job);
        processed += 1;
      }
    }
    return processed;
  }

  async cancelInstance(instanceId: string, reason = 'Cancelled by operator'): Promise<WorkflowInstance> {
    return this.uow.runInTransaction(async (repos) => {
      const instance = await repos.instances.findById(instanceId);
      if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);
      assertInstanceTransition(instance.status, 'CANCELLED');

      const tokens = await repos.tokens.findByInstance(instanceId);
      for (const t of tokens) {
        if (t.status === 'ACTIVE' || t.status === 'WAITING') {
          await repos.tokens.update({ ...t, status: 'CANCELLED' });
        }
      }

      const subs = await repos.subscriptions.findByInstance(instanceId);
      for (const s of subs) {
        if (s.status === 'ACTIVE') {
          await repos.subscriptions.update({ ...s, status: 'CANCELLED' });
        }
      }

      const updated = await repos.instances.updateWithOcc({
        ...instance,
        status: 'CANCELLED',
        completedAt: new Date(),
      });

      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'WorkflowInstance',
        aggregateId: instanceId,
        eventType: 'INSTANCE_CANCELLED',
        payload: { instanceId, reason },
        status: 'PENDING',
        attempts: 0,
        createdAt: new Date(),
        publishedAt: null,
      });

      return updated;
    });
  }

  private async buildScope(
    repos: IRepositoryRegistry,
    instance: WorkflowInstance,
  ): Promise<ExpressionScope> {
    const steps = await repos.steps.findByInstance(instance.id);
    const stepsMap: Record<string, { output?: unknown }> = {};
    for (const s of steps) {
      if (s.status === 'COMPLETED' && s.output !== null) {
        stepsMap[s.nodeId] = { output: s.output };
      }
    }
    return {
      $trigger: instance.triggerPayload,
      $vars: instance.variables,
      $steps: stepsMap,
    };
  }

  private async handleExecuteNode(
    instance: WorkflowInstance,
    workflow: WorkflowDefinitionRecord,
    token: ExecutionToken,
    node: NodeDefinition,
    job: ExecutionJob,
  ): Promise<void> {
    const startedAt = new Date();
    const scope = await this.buildScope(this.uow.repos, instance);
    const outgoingEdges = workflow.definition.edges.filter((e) => e.from === node.id);

    const stepRecord: StepExecution = {
      id: crypto.randomUUID(),
      instanceId: instance.id,
      tokenId: token.id,
      nodeId: node.id,
      nodeType: node.type,
      nodeName: node.name,
      status: 'RUNNING',
      attempt: job.attempts + 1,
      input: { variables: instance.variables },
      output: null,
      errorMessage: null,
      compensateNodeId: node.compensateNodeId ?? null,
      startedAt,
      finishedAt: null,
      durationMs: null,
    };
    await this.uow.repos.steps.create(stepRecord);

    try {
      const executor = this.executors.get(node.type);
      const outcome = await executor({
        node,
        scope,
        outgoingEdges,
        credentialService: this.credentialService,
        circuitBreaker: this.circuitBreaker,
        config: this.config,
      });

      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      await this.uow.runInTransaction(async (repos) => {
        const freshInstance = await repos.instances.findByIdForUpdate(instance.id);
        if (!freshInstance || isTerminalInstanceStatus(freshInstance.status)) {
          await repos.jobs.complete(job.id);
          return;
        }

        if (outcome.kind === 'WAIT_USER_TASK') {
          await repos.steps.update({
            ...stepRecord,
            status: 'WAITING',
            finishedAt,
            durationMs,
          });
          await repos.tokens.update({ ...token, status: 'WAITING' });
          const taskId = crypto.randomUUID();
          await repos.userTasks.create({
            id: taskId,
            instanceId: instance.id,
            tokenId: token.id,
            nodeId: node.id,
            title: outcome.taskConfig.title,
            description: outcome.taskConfig.description,
            stage: node.stage ?? freshInstance.currentStage,
            candidateGroup: outcome.taskConfig.candidateGroup,
            assignee: outcome.taskConfig.assignee,
            delegatedFrom: null,
            status: 'OPEN',
            formSchema: outcome.taskConfig.formSchema,
            payload: outcome.taskConfig.payload,
            resolution: null,
            requiredApprovals: outcome.taskConfig.requiredApprovals,
            approvalsReceived: [],
            dueAt: outcome.taskConfig.dueAt,
            slaBreached: false,
            escalateTo: outcome.taskConfig.escalateTo,
            escalationLevel: 0,
            createdAt: finishedAt,
            updatedAt: finishedAt,
            completedAt: null,
          });
          const nextStage = node.stage ?? freshInstance.currentStage;
          if (freshInstance.status !== 'WAITING' || nextStage !== freshInstance.currentStage) {
            await repos.instances.updateWithOcc({
              ...freshInstance,
              status: 'WAITING',
              currentStage: nextStage,
            });
          }
          await repos.outbox.append({
            id: crypto.randomUUID(),
            aggregateType: 'UserTask',
            aggregateId: taskId,
            eventType: 'USER_TASK_CREATED',
            payload: {
              taskId,
              instanceId: instance.id,
              nodeId: node.id,
              assignee: outcome.taskConfig.assignee,
              candidateGroup: outcome.taskConfig.candidateGroup,
              title: outcome.taskConfig.title,
            },
            status: 'PENDING',
            attempts: 0,
            createdAt: finishedAt,
            publishedAt: null,
          });

          // Create in-app notification directly for the target actor/group
          const targetRecipient = outcome.taskConfig.assignee || 'unassigned';
          await repos.notifications.create({
            id: crypto.randomUUID(),
            recipientId: targetRecipient,
            recipientGroup: outcome.taskConfig.candidateGroup ?? null,
            title: `New Task: ${outcome.taskConfig.title}`,
            message: outcome.taskConfig.description || `Task awaiting action on step '${node.name}'`,
            type: 'TASK_ASSIGNED',
            taskId,
            instanceId: instance.id,
            read: false,
            createdAt: finishedAt,
            readAt: null,
          });
          await repos.jobs.complete(job.id);
          this.metrics.recordStepExecution(node.type, 'WAITING', durationMs);
          return;
        }

        if (outcome.kind === 'WAIT_TIMER') {
          await repos.steps.update({ ...stepRecord, status: 'WAITING', finishedAt, durationMs });
          await repos.tokens.update({ ...token, status: 'WAITING' });
          await repos.subscriptions.create({
            id: crypto.randomUUID(),
            instanceId: instance.id,
            tokenId: token.id,
            nodeId: node.id,
            type: 'TIMER',
            messageName: null,
            correlationKey: null,
            triggerAt: outcome.triggerAt,
            status: 'ACTIVE',
            payload: null,
            createdAt: finishedAt,
            triggeredAt: null,
          });
          if (freshInstance.status !== 'WAITING') {
            await repos.instances.updateWithOcc({ ...freshInstance, status: 'WAITING' });
          }
          await repos.jobs.complete(job.id);
          this.metrics.recordStepExecution(node.type, 'WAITING', durationMs);
          return;
        }

        if (outcome.kind === 'WAIT_MESSAGE') {
          await repos.steps.update({ ...stepRecord, status: 'WAITING', finishedAt, durationMs });
          await repos.tokens.update({ ...token, status: 'WAITING' });
          await repos.subscriptions.create({
            id: crypto.randomUUID(),
            instanceId: instance.id,
            tokenId: token.id,
            nodeId: node.id,
            type: 'MESSAGE',
            messageName: outcome.messageName,
            correlationKey: outcome.correlationKey,
            triggerAt: null,
            status: 'ACTIVE',
            payload: null,
            createdAt: finishedAt,
            triggeredAt: null,
          });
          if (freshInstance.status !== 'WAITING') {
            await repos.instances.updateWithOcc({ ...freshInstance, status: 'WAITING' });
          }
          await repos.jobs.complete(job.id);
          this.metrics.recordStepExecution(node.type, 'WAITING', durationMs);
          return;
        }

        if (outcome.kind === 'WAIT_EXTERNAL_TASK') {
          await repos.steps.update({ ...stepRecord, status: 'WAITING', finishedAt, durationMs });
          await repos.tokens.update({ ...token, status: 'WAITING' });
          const extId = crypto.randomUUID();
          await repos.externalTasks.create({
            id: extId,
            instanceId: instance.id,
            tokenId: token.id,
            nodeId: node.id,
            topic: outcome.topic,
            workerId: null,
            lockExpiresAt: null,
            status: 'OPEN',
            variables: outcome.variables,
            resultVariables: null,
            retries: outcome.retries,
            errorMessage: null,
            createdAt: finishedAt,
            updatedAt: finishedAt,
          });
          const nextStage = node.stage ?? freshInstance.currentStage;
          if (freshInstance.status !== 'WAITING' || nextStage !== freshInstance.currentStage) {
            await repos.instances.updateWithOcc({
              ...freshInstance,
              status: 'WAITING',
              currentStage: nextStage,
            });
          }
          await repos.outbox.append({
            id: crypto.randomUUID(),
            aggregateType: 'ExternalTask',
            aggregateId: extId,
            eventType: 'EXTERNAL_TASK_CREATED',
            payload: { externalTaskId: extId, topic: outcome.topic, instanceId: instance.id },
            status: 'PENDING',
            attempts: 0,
            createdAt: finishedAt,
            publishedAt: null,
          });
          await repos.jobs.complete(job.id);
          this.metrics.recordStepExecution(node.type, 'WAITING', durationMs);
          return;
        }

        if (outcome.kind === 'WAIT_SUB_WORKFLOW') {
          const childWorkflow = outcome.version
            ? await repos.workflows.findByKeyAndVersion(outcome.workflowKey, outcome.version)
            : await repos.workflows.findLatestByKey(outcome.workflowKey, 'PUBLISHED');
          if (!childWorkflow || childWorkflow.status !== 'PUBLISHED') {
            throw new NotFoundError('PublishedChildWorkflow', outcome.workflowKey);
          }
          const childTrigger = childWorkflow.definition.nodes.find(
            (n) => n.type.startsWith('trigger.') && !n.isCompensationHandler,
          );
          if (!childTrigger) {
            throw new NotFoundError('TriggerNode', childWorkflow.id);
          }

          await repos.steps.update({ ...stepRecord, status: 'WAITING', finishedAt, durationMs });
          await repos.tokens.update({ ...token, status: 'WAITING' });

          const childInstanceId = crypto.randomUUID();
          const childTokenId = crypto.randomUUID();
          const childPolicy =
            childTrigger.retryPolicy ?? childWorkflow.definition.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY;

          await repos.instances.create({
            id: childInstanceId,
            workflowId: childWorkflow.id,
            workflowKey: childWorkflow.key,
            workflowVersion: childWorkflow.version,
            status: 'RUNNING',
            currentStage: childTrigger.stage ?? childWorkflow.definition.stages?.[0] ?? null,
            slaStatus: 'ON_TRACK',
            triggerType: 'bpmn.call_activity',
            triggerPayload: outcome.variables,
            variables: { ...outcome.variables },
            correlationKey: freshInstance.correlationKey,
            parentInstanceId: instance.id,
            parentTokenId: token.id,
            startedBy: freshInstance.startedBy,
            occVersion: 1,
            startedAt: finishedAt,
            completedAt: null,
            updatedAt: finishedAt,
          });

          await repos.tokens.create({
            id: childTokenId,
            instanceId: childInstanceId,
            currentNodeId: childTrigger.id,
            parentTokenId: null,
            joinGroupId: null,
            status: 'ACTIVE',
            createdAt: finishedAt,
            updatedAt: finishedAt,
          });

          await repos.jobs.enqueue({
            id: crypto.randomUUID(),
            instanceId: childInstanceId,
            tokenId: childTokenId,
            nodeId: childTrigger.id,
            jobType: 'EXECUTE_NODE',
            payload: {},
            status: 'PENDING',
            attempts: 0,
            maxAttempts: childPolicy.maxAttempts,
            availableAt: finishedAt,
            lockedBy: null,
            lockedAt: null,
            lastError: null,
            createdAt: finishedAt,
            updatedAt: finishedAt,
          });

          if (freshInstance.status !== 'WAITING') {
            await repos.instances.updateWithOcc({
              ...freshInstance,
              status: 'WAITING',
              currentStage: node.stage ?? freshInstance.currentStage,
            });
          }

          await repos.jobs.complete(job.id);
          this.metrics.recordStepExecution(node.type, 'WAITING', durationMs);
          return;
        }

        // CONTINUE or END
        const nextVariables = { ...freshInstance.variables };
        if (outcome.variablesPatch) {
          Object.assign(nextVariables, outcome.variablesPatch);
        }
        if (node.outputKey) {
          nextVariables[node.outputKey] = outcome.output;
        }

        await repos.steps.update({
          ...stepRecord,
          status: 'COMPLETED',
          output: outcome.output,
          finishedAt,
          durationMs,
        });
        this.metrics.recordStepExecution(node.type, 'COMPLETED', durationMs);

        if (outcome.kind === 'END') {
          await repos.tokens.update({ ...token, status: 'COMPLETED' });
          const updatedInst = await repos.instances.updateWithOcc({
            ...freshInstance,
            currentStage: node.stage ?? freshInstance.currentStage,
            variables: nextVariables,
          });
          await this.maybeCompleteInstance(repos, updatedInst);
          await repos.jobs.complete(job.id);
          return;
        }

        const updatedInst = await repos.instances.updateWithOcc({
          ...freshInstance,
          status: 'RUNNING',
          currentStage: node.stage ?? freshInstance.currentStage,
          variables: nextVariables,
        });

        await this.advanceToken(
          repos,
          updatedInst,
          workflow,
          token,
          node,
          outcome.selectedBranch,
          outcome.forkEdges,
        );
        await repos.jobs.complete(job.id);
      });
    } catch (err) {
      await this.handleNodeFailure(instance, workflow, token, node, stepRecord, job, err);
    }
  }

  private async handleResumeToken(
    instance: WorkflowInstance,
    workflow: WorkflowDefinitionRecord,
    token: ExecutionToken,
    node: NodeDefinition,
    job: ExecutionJob,
  ): Promise<void> {
    await this.uow.runInTransaction(async (repos) => {
      const freshInstance = await repos.instances.findByIdForUpdate(instance.id);
      if (!freshInstance || isTerminalInstanceStatus(freshInstance.status)) return;

      const steps = await repos.steps.findByInstance(instance.id);
      const waitingStep = [...steps]
        .reverse()
        .find((s) => s.tokenId === token.id && s.nodeId === node.id && s.status === 'WAITING');

      const resolutionPayload = (job.payload ?? {}) as Record<string, unknown>;
      const now = new Date();
      if (waitingStep) {
        await repos.steps.update({
          ...waitingStep,
          status: 'COMPLETED',
          output: resolutionPayload,
          finishedAt: now,
          durationMs: now.getTime() - waitingStep.startedAt.getTime(),
        });
      }

      const nextVars = { ...freshInstance.variables, ...resolutionPayload };
      if (node.outputKey) {
        nextVars[node.outputKey] = resolutionPayload;
      }

      const activeToken = await repos.tokens.update({ ...token, status: 'ACTIVE' });
      const updatedInst = await repos.instances.updateWithOcc({
        ...freshInstance,
        status: 'RUNNING',
        variables: nextVars,
      });

      await this.advanceToken(repos, updatedInst, workflow, activeToken, node);
    });
  }

  private async advanceToken(
    repos: IRepositoryRegistry,
    instance: WorkflowInstance,
    workflow: WorkflowDefinitionRecord,
    token: ExecutionToken,
    currentNode: NodeDefinition,
    selectedBranch?: string,
    forkEdges?: EdgeDefinition[],
  ): Promise<void> {
    const scope = await this.buildScope(repos, instance);
    let edgesToFollow: EdgeDefinition[];

    if (forkEdges && forkEdges.length > 0) {
      edgesToFollow = forkEdges;
    } else {
      const outgoing = workflow.definition.edges.filter((e) => e.from === currentNode.id);
      edgesToFollow = outgoing.filter((edge) => {
        if (selectedBranch !== undefined && edge.branch !== selectedBranch) {
          return false;
        }
        if (edge.condition) {
          return Boolean(evaluateExpression(edge.condition, scope));
        }
        return true;
      });
    }

    if (edgesToFollow.length === 0) {
      await repos.tokens.update({ ...token, status: 'COMPLETED' });
      await this.maybeCompleteInstance(repos, instance);
      return;
    }

    // Parallel fork: retire current token and spawn N child tokens
    if (forkEdges && forkEdges.length > 0) {
      await repos.tokens.update({ ...token, status: 'COMPLETED' });
      for (const edge of edgesToFollow) {
        await this.moveOrSpawnToTarget(
          repos,
          instance,
          workflow,
          {
            id: crypto.randomUUID(),
            instanceId: instance.id,
            currentNodeId: edge.to,
            parentTokenId: token.id,
            joinGroupId: currentNode.id,
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          true,
        );
      }
      return;
    }

    // Single edge traversal (or multiple conditional edges)
    const [firstEdge, ...extraEdges] = edgesToFollow;
    if (firstEdge) {
      const updatedToken = await repos.tokens.update({
        ...token,
        currentNodeId: firstEdge.to,
      });
      await this.moveOrSpawnToTarget(repos, instance, workflow, updatedToken, false);
    }
    for (const extra of extraEdges) {
      await this.moveOrSpawnToTarget(
        repos,
        instance,
        workflow,
        {
          id: crypto.randomUUID(),
          instanceId: instance.id,
          currentNodeId: extra.to,
          parentTokenId: token.id,
          joinGroupId: null,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        true,
      );
    }
  }

  private async moveOrSpawnToTarget(
    repos: IRepositoryRegistry,
    instance: WorkflowInstance,
    workflow: WorkflowDefinitionRecord,
    token: ExecutionToken,
    isNewToken: boolean,
  ): Promise<void> {
    const targetNode = workflow.definition.nodes.find((n) => n.id === token.currentNodeId);
    if (!targetNode) {
      throw new NotFoundError('TargetNode', token.currentNodeId);
    }

    // Camunda/BPMN Parallel Join Barrier semantics
    if (targetNode.type === 'logic.join') {
      const expectedIncoming = workflow.definition.edges.filter(
        (e) => e.to === targetNode.id,
      ).length;

      const waitingToken: ExecutionToken = { ...token, status: 'WAITING' };
      if (isNewToken) {
        await repos.tokens.create(waitingToken);
      } else {
        await repos.tokens.update(waitingToken);
      }

      const waitingAtJoin = await repos.tokens.findWaitingAtNode(instance.id, targetNode.id);
      if (waitingAtJoin.length < expectedIncoming) {
        return; // Wait for sibling branches to arrive
      }

      // All branches converged — mark arrived tokens COMPLETED and spawn unified token
      for (const wt of waitingAtJoin) {
        await repos.tokens.update({ ...wt, status: 'COMPLETED' });
      }
      const mergedToken = await repos.tokens.create({
        id: crypto.randomUUID(),
        instanceId: instance.id,
        currentNodeId: targetNode.id,
        parentTokenId: token.parentTokenId,
        joinGroupId: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await this.enqueueNodeJob(repos, instance.id, mergedToken.id, targetNode, workflow);
      return;
    }

    if (isNewToken) {
      await repos.tokens.create(token);
    }
    await this.enqueueNodeJob(repos, instance.id, token.id, targetNode, workflow);
  }

  private async enqueueNodeJob(
    repos: IRepositoryRegistry,
    instanceId: string,
    tokenId: string,
    node: NodeDefinition,
    workflow: WorkflowDefinitionRecord,
  ): Promise<void> {
    const policy = node.retryPolicy ?? workflow.definition.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY;
    const now = new Date();
    await repos.jobs.enqueue({
      id: crypto.randomUUID(),
      instanceId,
      tokenId,
      nodeId: node.id,
      jobType: 'EXECUTE_NODE',
      payload: {},
      status: 'PENDING',
      attempts: 0,
      maxAttempts: policy.maxAttempts,
      availableAt: now,
      lockedBy: null,
      lockedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async maybeCompleteInstance(
    repos: IRepositoryRegistry,
    instance: WorkflowInstance,
  ): Promise<void> {
    const allTokens = await repos.tokens.findByInstance(instance.id);
    const hasOpenTokens = allTokens.some(
      (t) => t.status === 'ACTIVE' || t.status === 'WAITING',
    );
    if (hasOpenTokens) return;

    const now = new Date();
    await repos.instances.updateWithOcc({
      ...instance,
      status: 'COMPLETED',
      completedAt: now,
    });
    await repos.outbox.append({
      id: crypto.randomUUID(),
      aggregateType: 'WorkflowInstance',
      aggregateId: instance.id,
      eventType: 'INSTANCE_COMPLETED',
      payload: {
        instanceId: instance.id,
        workflowKey: instance.workflowKey,
        variables: instance.variables,
      },
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      publishedAt: null,
    });
    this.metrics.recordInstanceCompleted(
      instance.workflowKey,
      'COMPLETED',
      now.getTime() - instance.startedAt.getTime(),
    );

    // If this was a child sub-workflow spawned by bpmn.call_activity, resume the parent token!
    if (instance.parentInstanceId && instance.parentTokenId) {
      const parentToken = await repos.tokens.findById(instance.parentTokenId);
      if (parentToken && parentToken.status === 'WAITING') {
        await repos.jobs.enqueue({
          id: crypto.randomUUID(),
          instanceId: instance.parentInstanceId,
          tokenId: parentToken.id,
          nodeId: parentToken.currentNodeId,
          jobType: 'RESUME_TOKEN',
          payload: {
            [`sub_${instance.workflowKey}`]: instance.variables,
            ...instance.variables,
          },
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
      }
    }
  }

  /**
   * Runtime variable patching for dynamic instance adjustments without redeployment.
   */
  async patchVariables(
    instanceId: string,
    patch: Record<string, unknown>,
  ): Promise<WorkflowInstance> {
    return this.uow.runInTransaction(async (repos) => {
      const instance = await repos.instances.findById(instanceId);
      if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);
      if (isTerminalInstanceStatus(instance.status)) {
        throw new ConflictError(`Cannot modify terminal instance '${instanceId}'`);
      }
      return repos.instances.updateWithOcc({
        ...instance,
        variables: { ...instance.variables, ...patch },
      });
    });
  }

  /**
   * Camunda-style dynamic process instance modification: moves/jumps a token to any node in the graph.
   */
  async moveTokenToNode(
    instanceId: string,
    tokenId: string,
    targetNodeId: string,
    reason = 'Dynamic operator token modification',
  ): Promise<ExecutionToken> {
    return this.uow.runInTransaction(async (repos) => {
      const instance = await repos.instances.findById(instanceId);
      if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);
      if (isTerminalInstanceStatus(instance.status)) {
        throw new ConflictError(`Cannot modify terminal instance '${instanceId}'`);
      }

      const workflow = await repos.workflows.findById(instance.workflowId);
      if (!workflow) throw new NotFoundError('Workflow', instance.workflowId);
      const targetNode = workflow.definition.nodes.find((n) => n.id === targetNodeId);
      if (!targetNode) throw new NotFoundError('TargetNode', targetNodeId);

      const token = await repos.tokens.findById(tokenId);
      if (!token || token.instanceId !== instanceId) {
        throw new NotFoundError('ExecutionToken', tokenId);
      }

      const now = new Date();
      const updatedToken = await repos.tokens.update({
        ...token,
        currentNodeId: targetNode.id,
        status: 'ACTIVE',
      });

      if (instance.status !== 'RUNNING') {
        await repos.instances.updateWithOcc({
          ...instance,
          status: 'RUNNING',
          currentStage: targetNode.stage ?? instance.currentStage,
        });
      }

      await this.enqueueNodeJob(repos, instanceId, updatedToken.id, targetNode, workflow);

      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'WorkflowInstance',
        aggregateId: instanceId,
        eventType: 'TOKEN_MOVED_DYNAMICALLY',
        payload: { instanceId, tokenId, targetNodeId, reason },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });

      return updatedToken;
    });
  }

  private async handleNodeFailure(
    instance: WorkflowInstance,
    workflow: WorkflowDefinitionRecord,
    token: ExecutionToken,
    node: NodeDefinition,
    stepRecord: StepExecution,
    job: ExecutionJob,
    err: unknown,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? null : null;
    const isOccConflict = err instanceof ConflictError;
    const retryable = isOccConflict || (err instanceof ExternalServiceError ? err.retryable : false);
    const nextAttempt = job.attempts + 1;
    const now = new Date();

    await this.uow.repos.steps.update({
      ...stepRecord,
      status: 'FAILED',
      errorMessage: message,
      finishedAt: now,
      durationMs: now.getTime() - stepRecord.startedAt.getTime(),
    });
    this.metrics.recordStepExecution(
      node.type,
      'FAILED',
      now.getTime() - stepRecord.startedAt.getTime(),
    );

    if (retryable && nextAttempt < job.maxAttempts) {
      const policy = node.retryPolicy ?? workflow.definition.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY;
      const delayMs = computeBackoffDelayMs(nextAttempt, policy);
      await this.uow.repos.jobs.reschedule(
        job.id,
        new Date(Date.now() + delayMs),
        nextAttempt,
        message,
      );
      this.logger.warn('Node execution failed; scheduled retry', {
        instanceId: instance.id,
        nodeId: node.id,
        attempt: nextAttempt,
        delayMs,
        error: message,
      });
      return;
    }

    await this.uow.repos.jobs.markDead(job.id, nextAttempt, message);

    if (workflow.definition.sagaEnabled) {
      await this.uow.runInTransaction(async (repos) => {
        const fresh = await repos.instances.findById(instance.id);
        if (!fresh || isTerminalInstanceStatus(fresh.status)) return;
        await repos.tokens.update({ ...token, status: 'FAILED' });
        await repos.instances.updateWithOcc({ ...fresh, status: 'COMPENSATING' });
      });
      await this.executeCompensation(instance.id);
      return;
    }

    // Open Camunda-style Incident so operators can inspect & retry/compensate
    const incidentId = crypto.randomUUID();
    await this.uow.runInTransaction(async (repos) => {
      const fresh = await repos.instances.findById(instance.id);
      if (!fresh || isTerminalInstanceStatus(fresh.status)) return;

      await repos.tokens.update({ ...token, status: 'FAILED' });
      await repos.instances.updateWithOcc({ ...fresh, status: 'INCIDENT_OPEN' });
      await repos.incidents.create({
        id: incidentId,
        instanceId: instance.id,
        tokenId: token.id,
        stepExecutionId: stepRecord.id,
        nodeId: node.id,
        incidentType: err instanceof Error ? err.name : 'ExecutionError',
        message,
        stackTrace: stack,
        payloadSnapshot: fresh.variables,
        status: 'OPEN',
        resolvedBy: null,
        resolutionNote: null,
        createdAt: now,
        resolvedAt: null,
      });
      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'Incident',
        aggregateId: incidentId,
        eventType: 'INCIDENT_OPENED',
        payload: { incidentId, instanceId: instance.id, nodeId: node.id, message },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });
    });

    this.metrics.incIncidentOpened(err instanceof Error ? err.name : 'ExecutionError');
    this.logger.error('Incident opened after node failure', {
      incidentId,
      instanceId: instance.id,
      nodeId: node.id,
      message,
    });
  }

  /**
   * Executes Saga compensation handlers in reverse completion order.
   */
  async executeCompensation(instanceId: string): Promise<void> {
    const instance = await this.uow.repos.instances.findById(instanceId);
    if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);
    const workflow = await this.uow.repos.workflows.findById(instance.workflowId);
    if (!workflow) throw new NotFoundError('Workflow', instance.workflowId);

    const allSteps = await this.uow.repos.steps.findByInstance(instanceId);
    const compensableSteps = allSteps
      .filter((s) => s.status === 'COMPLETED' && s.compensateNodeId !== null)
      .reverse();

    let anyCompensationFailed = false;
    const scope = await this.buildScope(this.uow.repos, instance);

    for (const step of compensableSteps) {
      const compNode = workflow.definition.nodes.find((n) => n.id === step.compensateNodeId);
      if (!compNode) continue;

      const compStarted = new Date();
      const compStep: StepExecution = {
        id: crypto.randomUUID(),
        instanceId,
        tokenId: step.tokenId,
        nodeId: compNode.id,
        nodeType: compNode.type,
        nodeName: `[Compensate] ${compNode.name}`,
        status: 'RUNNING',
        attempt: 1,
        input: { compensatedStepId: step.id, originalOutput: step.output },
        output: null,
        errorMessage: null,
        compensateNodeId: null,
        startedAt: compStarted,
        finishedAt: null,
        durationMs: null,
      };
      await this.uow.repos.steps.create(compStep);

      try {
        const executor = this.executors.get(compNode.type);
        const outcome = await executor({
          node: compNode,
          scope,
          outgoingEdges: [],
          credentialService: this.credentialService,
          circuitBreaker: this.circuitBreaker,
          config: this.config,
        });
        const finished = new Date();
        await this.uow.repos.steps.update({
          ...compStep,
          status: 'COMPLETED',
          output: 'output' in outcome ? outcome.output : {},
          finishedAt: finished,
          durationMs: finished.getTime() - compStarted.getTime(),
        });
        await this.uow.repos.steps.update({ ...step, status: 'COMPENSATED' });
      } catch (err) {
        anyCompensationFailed = true;
        const finished = new Date();
        await this.uow.repos.steps.update({
          ...compStep,
          status: 'COMPENSATION_FAILED',
          errorMessage: err instanceof Error ? err.message : String(err),
          finishedAt: finished,
          durationMs: finished.getTime() - compStarted.getTime(),
        });
        await this.uow.repos.steps.update({ ...step, status: 'COMPENSATION_FAILED' });
      }
    }

    await this.uow.runInTransaction(async (repos) => {
      const fresh = await repos.instances.findById(instanceId);
      if (!fresh) return;
      if (fresh.status !== 'COMPENSATING') {
        throw new ConflictError(`Expected instance '${instanceId}' to be in COMPENSATING state`);
      }

      const finalStatus = anyCompensationFailed ? 'FAILED' : 'COMPENSATED';
      const now = new Date();
      await repos.instances.updateWithOcc({
        ...fresh,
        status: finalStatus,
        completedAt: now,
      });
      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'WorkflowInstance',
        aggregateId: instanceId,
        eventType: anyCompensationFailed ? 'INSTANCE_COMPENSATION_FAILED' : 'INSTANCE_COMPENSATED',
        payload: { instanceId, compensatedCount: compensableSteps.length },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });
      this.metrics.recordInstanceCompleted(
        fresh.workflowKey,
        finalStatus,
        now.getTime() - fresh.startedAt.getTime(),
      );
    });
  }
}

