import { EthiopianDate } from '../localization/ethiopian-calendar.js';

export type CorrespondenceType = 'INBOUND' | 'OUTBOUND' | 'INTERNAL_MEMO';

export type CorrespondenceStatus = 
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'DISPATCHED'
  | 'ARCHIVED';

export type CorrespondenceUrgency = 'NORMAL' | 'URGENT' | 'VERY_URGENT';
export type CorrespondenceClassification = 'PUBLIC' | 'CONFIDENTIAL' | 'TOP_SECRET';

export interface MinuteRecord {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  actionTaken: 'FORWARDED' | 'RECOMMENDED' | 'APPROVED' | 'REJECTED' | 'COMMENT';
  comment: string;
  ethiopianDateString: string;
  createdAt: Date;
}

export interface CorrespondenceDocument {
  id: string;
  tenantId: string;
  referenceNumber: string;
  type: CorrespondenceType;
  subject: string;
  senderOrg: string;
  recipientOrg: string;
  urgency: CorrespondenceUrgency;
  classification: CorrespondenceClassification;
  bodyHtml?: string;
  attachments?: Array<{ name: string; url: string; sizeBytes?: number }>;
  minutes: MinuteRecord[];
  status: CorrespondenceStatus;
  signatoryId?: string;
  signatoryName?: string;
  signatoryRole?: string;
  digitalSealHash?: string;
  verificationCode?: string;
  qrVerificationUrl?: string;
  ethiopianDate: EthiopianDate;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCorrespondenceInput {
  tenantId?: string;
  type: CorrespondenceType;
  subject: string;
  senderOrg: string;
  recipientOrg: string;
  urgency?: CorrespondenceUrgency;
  classification?: CorrespondenceClassification;
  bodyHtml?: string;
  attachments?: Array<{ name: string; url: string; sizeBytes?: number }>;
  createdById: string;
  customPrefix?: string;
}

export interface AddMinuteInput {
  authorId: string;
  authorName: string;
  authorRole: string;
  actionTaken: 'FORWARDED' | 'RECOMMENDED' | 'APPROVED' | 'REJECTED' | 'COMMENT';
  comment: string;
}

export interface ApproveAndSealInput {
  signatoryId: string;
  signatoryName: string;
  signatoryRole: string;
  baseUrl?: string;
}
