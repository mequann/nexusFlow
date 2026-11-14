import { Injectable } from '@nestjs/common';
import type { WorkflowGraphDefinition, NodeDefinition, EdgeDefinition } from '../../domain/workflow/types.js';

export interface BpmnImportResult {
  key: string;
  name: string;
  description: string;
  definition: WorkflowGraphDefinition;
}

@Injectable()
export class BpmnXmlService {
  /**
   * Parse BPMN 2.0 XML into NexusFlow Workflow Graph Definition
   */
  importBpmn(xml: string, defaultKey?: string): BpmnImportResult {
    const processMatch = xml.match(/<bpmn:process\s+[^>]*id="([^"]+)"[^>]*name="([^"]*)"/i) ||
      xml.match(/<process\s+[^>]*id="([^"]+)"[^>]*name="([^"]*)"/i) ||
      xml.match(/<bpmn:process\s+[^>]*id="([^"]+)"/i) ||
      xml.match(/<process\s+[^>]*id="([^"]+)"/i);

    const processId = processMatch?.[1] || defaultKey || 'imported-bpmn-process';
    const processName = processMatch?.[2] || processId;

    const nodes: NodeDefinition[] = [];
    const edges: EdgeDefinition[] = [];

    // Helper regex to extract XML attributes
    const extractAttr = (tag: string, attr: string): string | null => {
      const match = tag.match(new RegExp(`${attr}="([^"]*)"`, 'i'));
      return match ? match[1] ?? null : null;
    };

    // 1. Parse Start Events
    const startEventRegex = /<(?:bpmn:)?startEvent\b([^>]*)(?:\/?>|>([\s\S]*?)<\/(?:bpmn:)?startEvent>)/gi;
    let match: RegExpExecArray | null;
    while ((match = startEventRegex.exec(xml)) !== null) {
      const tagAttrs = match[1] || '';
      const id = extractAttr(tagAttrs, 'id') || `start_${nodes.length + 1}`;
      const name = extractAttr(tagAttrs, 'name') || 'Start Event';
      nodes.push({
        id,
        name,
        type: 'trigger.manual',
        config: {},
        position: this.findBounds(xml, id) ?? { x: 100, y: 150 },
      });
    }

    // 2. Parse User Tasks
    const userTaskRegex = /<(?:bpmn:)?userTask\b([^>]*)(?:\/?>|>([\s\S]*?)<\/(?:bpmn:)?userTask>)/gi;
    while ((match = userTaskRegex.exec(xml)) !== null) {
      const tagAttrs = match[1] || '';
      const id = extractAttr(tagAttrs, 'id') || `user_task_${nodes.length + 1}`;
      const name = extractAttr(tagAttrs, 'name') || 'User Task';
      const candidateGroup = extractAttr(tagAttrs, 'camunda:candidateGroups') || undefined;
      const assignee = extractAttr(tagAttrs, 'camunda:assignee') || undefined;

      nodes.push({
        id,
        name,
        type: 'bpmn.user_task',
        config: {
          title: name,
          candidateGroup,
          assignee,
        },
        position: this.findBounds(xml, id) ?? { x: 300 + nodes.length * 150, y: 150 },
      });
    }

    // 3. Parse Service Tasks / Script Tasks
    const serviceTaskRegex = /<(?:bpmn:)?(?:serviceTask|scriptTask|sendTask)\b([^>]*)(?:\/?>|>([\s\S]*?)<\/(?:bpmn:)?(?:serviceTask|scriptTask|sendTask)>)/gi;
    while ((match = serviceTaskRegex.exec(xml)) !== null) {
      const tagAttrs = match[1] || '';
      const id = extractAttr(tagAttrs, 'id') || `service_${nodes.length + 1}`;
      const name = extractAttr(tagAttrs, 'name') || 'Automated Service Step';

      nodes.push({
        id,
        name,
        type: 'bpmn.service_task',
        config: {
          action: 'execute_step',
          stepName: name,
        },
        position: this.findBounds(xml, id) ?? { x: 300 + nodes.length * 150, y: 150 },
      });
    }

    // 4. Parse Gateways
    const gatewayRegex = /<(?:bpmn:)?(?:exclusiveGateway|parallelGateway|inclusiveGateway)\b([^>]*)(?:\/?>|>([\s\S]*?)<\/(?:bpmn:)?(?:exclusiveGateway|parallelGateway|inclusiveGateway)>)/gi;
    while ((match = gatewayRegex.exec(xml)) !== null) {
      const tagAttrs = match[1] || '';
      const id = extractAttr(tagAttrs, 'id') || `gw_${nodes.length + 1}`;
      const name = extractAttr(tagAttrs, 'name') || 'Decision Gateway';

      nodes.push({
        id,
        name,
        type: 'bpmn.exclusive_gateway',
        config: {},
        position: this.findBounds(xml, id) ?? { x: 300 + nodes.length * 150, y: 150 },
      });
    }

    // 5. Parse End Events
    const endEventRegex = /<(?:bpmn:)?endEvent\b([^>]*)(?:\/?>|>([\s\S]*?)<\/(?:bpmn:)?endEvent>)/gi;
    while ((match = endEventRegex.exec(xml)) !== null) {
      const tagAttrs = match[1] || '';
      const id = extractAttr(tagAttrs, 'id') || `end_${nodes.length + 1}`;
      const name = extractAttr(tagAttrs, 'name') || 'End Event';

      nodes.push({
        id,
        name,
        type: 'bpmn.end',
        config: {},
        position: this.findBounds(xml, id) ?? { x: 300 + nodes.length * 150, y: 150 },
      });
    }

    // 6. Parse Sequence Flows (Edges)
    const flowRegex = /<(?:bpmn:)?sequenceFlow\b([^>]*)(?:\/?>|>([\s\S]*?)<\/(?:bpmn:)?sequenceFlow>)/gi;
    let flowIndex = 0;
    while ((match = flowRegex.exec(xml)) !== null) {
      const tagAttrs = match[1] || '';
      const flowContent = match[2] || '';
      const id = extractAttr(tagAttrs, 'id') || `flow_${++flowIndex}`;
      const from = extractAttr(tagAttrs, 'sourceRef');
      const to = extractAttr(tagAttrs, 'targetRef');
      const name = extractAttr(tagAttrs, 'name') || undefined;

      // Check condition
      const condMatch = flowContent.match(/<(?:bpmn:)?conditionExpression[^>]*>([\s\S]*?)<\/(?:bpmn:)?conditionExpression>/i);
      const condition = condMatch ? condMatch[1]?.trim() : undefined;

      if (from && to) {
        edges.push({
          id,
          from,
          to,
          branch: name,
          condition,
        });
      }
    }

    // If no nodes found, fallback to basic draft
    if (nodes.length === 0) {
      nodes.push({
        id: 'start',
        name: 'Start',
        type: 'trigger.manual',
        config: {},
        position: { x: 100, y: 150 },
      });
    }

    return {
      key: processId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase(),
      name: processName,
      description: `Imported from standard BPMN 2.0 XML (${nodes.length} nodes, ${edges.length} sequence flows)`,
      definition: {
        nodes,
        edges,
        sagaEnabled: false,
      },
    };
  }

  /**
   * Export NexusFlow definition to standard BPMN 2.0 XML
   */
  exportBpmn(definition: WorkflowGraphDefinition, key = 'nexusflow_process', name = 'NexusFlow Process'): string {
    const processId = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeName = this.escapeXml(name);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                  id="Definitions_${processId}"
                  targetNamespace="http://nexusflow.io/schema/bpmn">
  <bpmn:process id="${processId}" name="${safeName}" isExecutable="true">
`;

    // 1. Elements
    for (const node of definition.nodes) {
      const nodeId = this.escapeXml(node.id);
      const nodeName = this.escapeXml(node.name);

      if (node.type.startsWith('trigger.')) {
        xml += `    <bpmn:startEvent id="${nodeId}" name="${nodeName}" />\n`;
      } else if (node.type === 'task.user_form' || node.type.includes('user')) {
        const candidateGroup = (node.config?.candidateGroup as string) || '';
        const groupAttr = candidateGroup ? ` camunda:candidateGroups="${this.escapeXml(candidateGroup)}"` : '';
        xml += `    <bpmn:userTask id="${nodeId}" name="${nodeName}"${groupAttr} />\n`;
      } else if (node.type.includes('gateway')) {
        xml += `    <bpmn:exclusiveGateway id="${nodeId}" name="${nodeName}" />\n`;
      } else if (node.type === 'end_event' || node.type.includes('end')) {
        xml += `    <bpmn:endEvent id="${nodeId}" name="${nodeName}" />\n`;
      } else {
        xml += `    <bpmn:serviceTask id="${nodeId}" name="${nodeName}" camunda:type="external" camunda:topic="${this.escapeXml(node.type)}" />\n`;
      }
    }

    // 2. Sequence Flows
    for (const edge of definition.edges) {
      const edgeId = this.escapeXml(edge.id);
      const from = this.escapeXml(edge.from);
      const to = this.escapeXml(edge.to);
      const nameAttr = edge.branch ? ` name="${this.escapeXml(edge.branch)}"` : '';

      if (edge.condition) {
        xml += `    <bpmn:sequenceFlow id="${edgeId}" sourceRef="${from}" targetRef="${to}"${nameAttr}>
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression"><![CDATA[${edge.condition}]]></bpmn:conditionExpression>
    </bpmn:sequenceFlow>\n`;
      } else {
        xml += `    <bpmn:sequenceFlow id="${edgeId}" sourceRef="${from}" targetRef="${to}"${nameAttr} />\n`;
      }
    }

    xml += `  </bpmn:process>

  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${processId}">
`;

    // 3. Diagram Visual Coordinates (BPMNDI)
    for (let i = 0; i < definition.nodes.length; i++) {
      const node = definition.nodes[i]!;
      const pos = node.position || { x: 100 + i * 160, y: 150 };
      const isEvent = node.type.startsWith('trigger.') || node.type === 'end_event';
      const isGateway = node.type.includes('gateway');
      const width = isEvent ? 36 : isGateway ? 50 : 100;
      const height = isEvent ? 36 : isGateway ? 50 : 80;

      xml += `      <bpmndi:BPMNShape id="${this.escapeXml(node.id)}_di" bpmnElement="${this.escapeXml(node.id)}">
        <dc:Bounds x="${pos.x}" y="${pos.y}" width="${width}" height="${height}" />
      </bpmndi:BPMNShape>\n`;
    }

    for (const edge of definition.edges) {
      xml += `      <bpmndi:BPMNEdge id="${this.escapeXml(edge.id)}_di" bpmnElement="${this.escapeXml(edge.id)}" />\n`;
    }

    xml += `    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    return xml;
  }

  private findBounds(xml: string, id: string): { x: number; y: number } | null {
    const shapeRegex = new RegExp(`<bpmndi:BPMNShape[^>]*bpmnElement="${id}"[\\s\\S]*?<dc:Bounds\\s+([^>]*)\\/?>`, 'i');
    const match = xml.match(shapeRegex);
    if (!match || !match[1]) return null;

    const xMatch = match[1].match(/x="(\d+)"/i);
    const yMatch = match[1].match(/y="(\d+)"/i);
    if (xMatch && yMatch) {
      return { x: parseInt(xMatch[1]!, 10), y: parseInt(yMatch[1]!, 10) };
    }
    return null;
  }

  private escapeXml(unsafe: string): string {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
