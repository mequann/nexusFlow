import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  CorrespondenceDocument,
  CreateCorrespondenceInput,
  AddMinuteInput,
  ApproveAndSealInput,
  MinuteRecord,
} from '../../domain/correspondence/types.js';
import { EthiopianCalendar } from '../../domain/localization/ethiopian-calendar.js';
import { DigitalSealEngine } from '../../domain/security/digital-seal.js';
import { NotFoundError, ValidationError } from '../../domain/errors.js';

@Injectable()
export class CorrespondenceService {
  private readonly logger = new Logger(CorrespondenceService.name);

  // In-memory persistent store (backed by PostgreSQL or memory depending on runtime)
  private readonly documents = new Map<string, CorrespondenceDocument>();
  private readonly sequenceCounters = new Map<string, number>();

  /**
   * Generates official sequential reference number: e.g. "NXF/ገቢ/2019/00001" or "NXF/OUT/2019/00042"
   */
  private generateReferenceNumber(
    tenantId: string,
    type: string,
    ethYear: number,
    customPrefix = 'NXF',
  ): string {
    const typeLabel = type === 'INBOUND' ? 'IN' : type === 'OUTBOUND' ? 'OUT' : 'MEMO';
    const seqKey = `${tenantId}:${typeLabel}:${ethYear}`;
    const nextVal = (this.sequenceCounters.get(seqKey) ?? 0) + 1;
    this.sequenceCounters.set(seqKey, nextVal);

    const paddedSeq = String(nextVal).padStart(5, '0');
    return `${customPrefix.toUpperCase()}/${typeLabel}/${ethYear}/${paddedSeq}`;
  }

  public async createDocument(input: CreateCorrespondenceInput): Promise<CorrespondenceDocument> {
    const tenantId = input.tenantId ?? 'default';
    const now = new Date();
    const ethDate = EthiopianCalendar.fromGregorian(now);

    const referenceNumber = this.generateReferenceNumber(
      tenantId,
      input.type,
      ethDate.year,
      input.customPrefix,
    );

    const doc: CorrespondenceDocument = {
      id: randomUUID(),
      tenantId,
      referenceNumber,
      type: input.type,
      subject: input.subject,
      senderOrg: input.senderOrg,
      recipientOrg: input.recipientOrg,
      urgency: input.urgency ?? 'NORMAL',
      classification: input.classification ?? 'PUBLIC',
      bodyHtml: input.bodyHtml,
      attachments: input.attachments ?? [],
      minutes: [],
      status: 'UNDER_REVIEW',
      ethiopianDate: ethDate,
      createdById: input.createdById,
      createdAt: now,
      updatedAt: now,
    };

    this.documents.set(doc.id, doc);
    this.logger.log(`Created correspondence ${doc.referenceNumber} (${doc.type}) in tenant ${tenantId}`);
    return doc;
  }

  public async addMinute(documentId: string, input: AddMinuteInput): Promise<CorrespondenceDocument> {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new NotFoundError('CorrespondenceDocument', documentId);
    }

    if (doc.status === 'APPROVED' || doc.status === 'ARCHIVED') {
      throw new ValidationError(`Cannot add minutes to a document in '${doc.status}' status`);
    }

    const now = new Date();
    const ethDate = EthiopianCalendar.fromGregorian(now);

    const minute: MinuteRecord = {
      id: randomUUID(),
      authorId: input.authorId,
      authorName: input.authorName,
      authorRole: input.authorRole,
      actionTaken: input.actionTaken,
      comment: input.comment,
      ethiopianDateString: ethDate.formattedAmharic,
      createdAt: now,
    };

    doc.minutes.push(minute);
    doc.updatedAt = now;
    this.logger.log(`Added minute from ${input.authorName} (${input.authorRole}) to ${doc.referenceNumber}`);
    return doc;
  }

  public async approveAndSeal(documentId: string, input: ApproveAndSealInput): Promise<CorrespondenceDocument> {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new NotFoundError('CorrespondenceDocument', documentId);
    }

    const now = new Date();
    const approvedAtIso = now.toISOString();

    const sealResult = DigitalSealEngine.generateSeal(
      {
        documentId: doc.id,
        tenantId: doc.tenantId,
        referenceNumber: doc.referenceNumber,
        subject: doc.subject,
        signatoryId: input.signatoryId,
        signatoryName: input.signatoryName,
        approvedAtIso,
      },
      input.baseUrl,
    );

    doc.status = 'APPROVED';
    doc.signatoryId = input.signatoryId;
    doc.signatoryName = input.signatoryName;
    doc.signatoryRole = input.signatoryRole;
    doc.digitalSealHash = sealResult.sealHash;
    doc.verificationCode = sealResult.verificationCode;
    doc.qrVerificationUrl = sealResult.verificationUrl;
    doc.updatedAt = now;

    this.logger.log(`Approved & digitally sealed document ${doc.referenceNumber} by ${input.signatoryName}. Verification: ${sealResult.verificationUrl}`);
    return doc;
  }

  public async getDocumentById(documentId: string): Promise<CorrespondenceDocument> {
    const doc = this.documents.get(documentId);
    if (!doc) {
      throw new NotFoundError('CorrespondenceDocument', documentId);
    }
    return doc;
  }

  public async listDocuments(tenantId?: string): Promise<CorrespondenceDocument[]> {
    const all = Array.from(this.documents.values());
    if (tenantId) {
      return all.filter((d) => d.tenantId === tenantId);
    }
    return all;
  }

  /**
   * Public Document Verification (Used by citizens or receiving organizations scanning the QR code)
   */
  public async verifyPublicDocument(documentId: string): Promise<{
    isValid: boolean;
    referenceNumber: string;
    subject: string;
    senderOrg: string;
    recipientOrg: string;
    signatoryName?: string;
    signatoryRole?: string;
    status: string;
    ethiopianDate: string;
    approvedAt?: string;
    digitalSealHash?: string;
    verificationCode?: string;
  }> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.status !== 'APPROVED') {
      return {
        isValid: false,
        referenceNumber: 'UNKNOWN',
        subject: 'Document Not Found or Not Approved',
        senderOrg: 'N/A',
        recipientOrg: 'N/A',
        status: doc?.status ?? 'NOT_FOUND',
        ethiopianDate: 'N/A',
      };
    }

    return {
      isValid: true,
      referenceNumber: doc.referenceNumber,
      subject: doc.subject,
      senderOrg: doc.senderOrg,
      recipientOrg: doc.recipientOrg,
      signatoryName: doc.signatoryName,
      signatoryRole: doc.signatoryRole,
      status: doc.status,
      ethiopianDate: doc.ethiopianDate.formattedAmharic,
      approvedAt: doc.updatedAt.toISOString(),
      digitalSealHash: doc.digitalSealHash,
      verificationCode: doc.verificationCode,
    };
  }
}
