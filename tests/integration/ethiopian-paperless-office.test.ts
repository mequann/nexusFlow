import { describe, it, expect, beforeEach } from 'vitest';
import { CorrespondenceService } from '../../src/application/services/correspondence-service.js';
import { DigitalSealEngine } from '../../src/domain/security/digital-seal.js';
import { EthiopianCalendar } from '../../src/domain/localization/ethiopian-calendar.js';
import {
  MODEL_20_STORE_ISSUE_TEMPLATE,
  PER_DIEM_TRAVEL_TEMPLATE,
} from '../../src/application/templates/ethiopian-office-templates.js';
import { validateWorkflowGraph } from '../../src/domain/workflow/validator.js';

describe('Ethiopian Paperless Digital Office Subsystem', () => {
  let correspondenceService: CorrespondenceService;

  beforeEach(() => {
    correspondenceService = new CorrespondenceService();
  });

  describe('Digital Registry & Correspondence (ገቢ እና ወጪ ደብዳቤ)', () => {
    it('generates sequential reference numbers and registers incoming letters with Ethiopian date', async () => {
      const doc = await correspondenceService.createDocument({
        tenantId: 'ministry-of-innovation',
        type: 'INBOUND',
        subject: 'Inter-Ministerial Cloud Infrastructure Request',
        senderOrg: 'Ministry of Revenue',
        recipientOrg: 'Ministry of Innovation and Technology',
        urgency: 'URGENT',
        createdById: 'user-officer-1',
        customPrefix: 'MInT',
      });

      expect(doc.id).toBeDefined();
      expect(doc.tenantId).toBe('ministry-of-innovation');
      // Format: MINT/IN/2019/00001
      expect(doc.referenceNumber).toMatch(/^MInT\/IN\/2019\/00001$/i);
      expect(doc.status).toBe('UNDER_REVIEW');
      expect(doc.ethiopianDate.year).toBe(2019);
      expect(doc.ethiopianDate.monthNameAmharic).toBe('ህዳር');
    });

    it('appends hierarchical minutes/endorsements and seals document with cryptographic QR verification', async () => {
      // 1. Create Outbound Letter Draft
      const doc = await correspondenceService.createDocument({
        tenantId: 'telecom-corp',
        type: 'OUTBOUND',
        subject: 'National 5G Expansion Procurement Notice',
        senderOrg: 'Ethio Telecom Enterprise',
        recipientOrg: 'National Bank of Ethiopia',
        createdById: 'officer-abebe',
        customPrefix: 'ETC',
      });

      expect(doc.referenceNumber).toMatch(/^ETC\/OUT\/2019\/00001$/);

      // 2. Add Team Leader Endorsement Minute
      await correspondenceService.addMinute(doc.id, {
        authorId: 'tl-kebede',
        authorName: 'Kebede Chala',
        authorRole: 'TEAM_LEADER',
        actionTaken: 'RECOMMENDED',
        comment: 'ቴክኒካል ዝርዝሩ ተረጋግጧል፤ እንዲፈቀድ የውሳኔ ሃሳብ አቀርባለሁ (Technical specs verified, recommend approval).',
      });

      // 3. Add Director Endorsement Minute
      const withDirectorMinute = await correspondenceService.addMinute(doc.id, {
        authorId: 'dir-almaz',
        authorName: 'Almaz Tadesse',
        authorRole: 'DIRECTOR',
        actionTaken: 'FORWARDED',
        comment: 'ለዋና ስራ አስፈፃሚ ለፊርማ ተመርቷል (Forwarded to CEO for signature).',
      });

      expect(withDirectorMinute.minutes).toHaveLength(2);
      expect(withDirectorMinute.minutes[0].actionTaken).toBe('RECOMMENDED');
      expect(withDirectorMinute.minutes[1].actionTaken).toBe('FORWARDED');

      // 4. Executive Approval and Digital Stamping (Approve & Seal)
      const approvedDoc = await correspondenceService.approveAndSeal(doc.id, {
        signatoryId: 'ceo-frehiwot',
        signatoryName: 'Frehiwot Tamiru',
        signatoryRole: 'CHIEF_EXECUTIVE_OFFICER',
        baseUrl: 'https://nexusflow.et',
      });

      expect(approvedDoc.status).toBe('APPROVED');
      expect(approvedDoc.digitalSealHash).toBeDefined();
      expect(approvedDoc.digitalSealHash).toHaveLength(64); // SHA-256 hex
      expect(approvedDoc.verificationCode).toBeDefined();
      expect(approvedDoc.qrVerificationUrl).toContain('https://nexusflow.et/verify/');

      // 5. Public Document Verification (Simulating Citizen / Third-party QR Scan)
      const publicVerify = await correspondenceService.verifyPublicDocument(doc.id);
      expect(publicVerify.isValid).toBe(true);
      expect(publicVerify.referenceNumber).toBe(doc.referenceNumber);
      expect(publicVerify.signatoryName).toBe('Frehiwot Tamiru');
      expect(publicVerify.signatoryRole).toBe('CHIEF_EXECUTIVE_OFFICER');
      expect(publicVerify.status).toBe('APPROVED');
      expect(publicVerify.digitalSealHash).toBe(approvedDoc.digitalSealHash);
    });

    it('cryptographically detects document tampering', () => {
      const payload = {
        documentId: 'doc-uuid-1234',
        tenantId: 'ministry-of-finance',
        referenceNumber: 'MOF/OUT/2019/00099',
        subject: 'Budget Release Authorization - $10,000,000',
        signatoryId: 'minister-ahmed',
        signatoryName: 'Ahmed Shide',
        approvedAtIso: '2026-11-13T10:00:00.000Z',
      };

      const seal = DigitalSealEngine.generateSeal(payload);
      expect(DigitalSealEngine.verifySeal(payload, seal.sealHash)).toBe(true);

      // Attempt to tamper with amount/subject
      const tamperedPayload = {
        ...payload,
        subject: 'Budget Release Authorization - $90,000,000', // Tampered!
      };
      expect(DigitalSealEngine.verifySeal(tamperedPayload, seal.sealHash)).toBe(false);
    });
  });

  describe('Ethiopian Standard Workflow Templates', () => {
    it('validates Model 20 Store Issue Voucher workflow graph structure', () => {
      expect(() => validateWorkflowGraph(MODEL_20_STORE_ISSUE_TEMPLATE.definition)).not.toThrow();
      expect(MODEL_20_STORE_ISSUE_TEMPLATE.key).toBe('eth-model-20-store-issue');
      expect(MODEL_20_STORE_ISSUE_TEMPLATE.definition.nodes).toHaveLength(4);
      expect(MODEL_20_STORE_ISSUE_TEMPLATE.definition.stages).toContain('STORE_DISPATCH');
    });

    it('validates Field Mission & Per Diem Requisition workflow graph structure', () => {
      expect(() => validateWorkflowGraph(PER_DIEM_TRAVEL_TEMPLATE.definition)).not.toThrow();
      expect(PER_DIEM_TRAVEL_TEMPLATE.key).toBe('eth-per-diem-travel');
      expect(PER_DIEM_TRAVEL_TEMPLATE.definition.nodes).toHaveLength(4);
      expect(PER_DIEM_TRAVEL_TEMPLATE.definition.stages).toContain('AUDIT_VERIFICATION');
    });
  });

  describe('Telegram Bot & Omnichannel Notification Subsystem', () => {
    it('formats bilingual notification cards with inline approval buttons', async () => {
      const { TelegramBotService } = await import('../../src/application/services/telegram-bot-service.js');
      const botService = new TelegramBotService(null as any, null as any);

      const card = botService.formatTaskNotificationCard({
        id: 'task-uuid-8899',
        name: 'Approve Model 20 Store Issue Voucher #0042',
        workflowInstanceId: 'inst-uuid-11223344-5566',
        ethiopianDueDate: '15 ህዳር 2019 ዓ.ም',
      });

      expect(card.text).toContain('አዲስ የውሳኔ ጥያቄ');
      expect(card.text).toContain('Approve Model 20 Store Issue Voucher #0042');
      expect(card.text).toContain('15 ህዳር 2019 ዓ.ም');
      expect(card.replyMarkup.inline_keyboard[0][0].text).toContain('✅ ፍቀድ (Approve)');
      expect(card.replyMarkup.inline_keyboard[0][0].callback_data).toBe('APPROVE:task-uuid-8899');
      expect(card.replyMarkup.inline_keyboard[0][1].text).toContain('❌ ውድቅ አድርግ (Reject)');
      expect(card.replyMarkup.inline_keyboard[0][1].callback_data).toBe('REJECT:task-uuid-8899');
    });
  });
});
