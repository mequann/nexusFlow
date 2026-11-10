import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors.js';
import { validateFormSubmission } from '../../src/domain/workflow/form-validator.js';

describe('Kissflow Form Schema Validator', () => {
  const schema = {
    title: 'CapEx Purchase Request',
    fields: [
      { name: 'vendorName', label: 'Vendor Name', type: 'text', required: true, min: 2 },
      { name: 'amount', label: 'Purchase Amount', type: 'currency', required: true, min: 1 },
      {
        name: 'department',
        type: 'select',
        required: true,
        options: ['ENGINEERING', 'FINANCE', 'OPERATIONS'],
      },
      { name: 'requesterEmail', type: 'email', required: true },
      { name: 'neededBy', type: 'date', required: false },
    ],
  };

  it('accepts valid Kissflow form payloads', () => {
    expect(() =>
      validateFormSubmission(schema, {
        vendorName: 'Cloudflare Inc.',
        amount: 4500,
        department: 'ENGINEERING',
        requesterEmail: 'cto@acme.io',
        neededBy: '2026-12-01',
      }),
    ).not.toThrow();
  });

  it('rejects missing required fields, invalid select options, and malformed emails', () => {
    expect(() =>
      validateFormSubmission(schema, {
        vendorName: 'A',
        amount: -10,
        department: 'MARKETING',
        requesterEmail: 'not-an-email',
      }),
    ).toThrow(ValidationError);
  });
});

