import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { APP_CONFIG, APP_LOGGER } from '../tokens.js';
import type { AppConfig } from '../../config/env.js';
import type { ILogger } from '../../domain/ports/telemetry.js';
import { NotFoundError } from '../../domain/errors.js';
import { createPgPool } from '../../infrastructure/db/pool.js';

export interface StoredFileRecord {
  id: string;
  tenantId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  storageDriver: 'local' | 'database' | 's3_compatible' | 'memory';
  storagePath: string;
  metadata: Record<string, unknown>;
  uploadedBy?: string | null;
  createdAt: Date;
}

export interface UploadFileInput {
  filename: string;
  mimeType?: string;
  content: Buffer | Uint8Array | string;
  metadata?: Record<string, unknown>;
  tenantId?: string;
  uploadedBy?: string;
}

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private memoryFiles = new Map<string, { record: StoredFileRecord; data: Buffer }>();
  private pgPool: Pool | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
  ) {}

  private getPool(): Pool {
    if (!this.pgPool) {
      this.pgPool = createPgPool(this.config);
    }
    return this.pgPool;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.config.FILE_STORAGE_DRIVER === 'local') {
      try {
        await fs.mkdir(this.config.FILE_STORAGE_LOCAL_DIR, { recursive: true });
        this.logger.info(`Initialized local document storage at '${this.config.FILE_STORAGE_LOCAL_DIR}'`);
      } catch (err: any) {
        this.logger.warn(`Could not create local storage directory: ${err.message}`);
      }
    }
  }

  async uploadFile(input: UploadFileInput): Promise<StoredFileRecord> {
    const tenantId = input.tenantId ?? 'default';
    const id = crypto.randomUUID();
    const buffer = Buffer.isBuffer(input.content)
      ? input.content
      : typeof input.content === 'string'
      ? Buffer.from(input.content, 'utf-8')
      : Buffer.from(input.content);

    const checksumSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const sizeBytes = buffer.length;
    const mimeType = input.mimeType || this.inferMimeType(input.filename);
    const storageDriver = this.config.FILE_STORAGE_DRIVER;
    const now = new Date();

    let storagePath = `storage://${tenantId}/${id}/${input.filename}`;
    let contentData: string | null = null;

    if (this.config.STORAGE_DRIVER === 'memory') {
      // Memory mode for unit/in-memory tests
      const record: StoredFileRecord = {
        id,
        tenantId,
        filename: input.filename,
        mimeType,
        sizeBytes,
        checksumSha256,
        storageDriver,
        storagePath,
        metadata: input.metadata ?? {},
        uploadedBy: input.uploadedBy ?? null,
        createdAt: now,
      };
      this.memoryFiles.set(id, { record, data: buffer });
      return record;
    }

    if (storageDriver === 'database') {
      contentData = buffer.toString('base64');
      storagePath = `db://stored_files/${id}`;
    } else if (storageDriver === 'local') {
      const tenantDir = path.resolve(this.config.FILE_STORAGE_LOCAL_DIR, tenantId);
      await fs.mkdir(tenantDir, { recursive: true });
      const localFilePath = path.join(tenantDir, `${id}_${input.filename}`);
      await fs.writeFile(localFilePath, buffer);
      storagePath = localFilePath;
    } else if (storageDriver === 's3_compatible') {
      // S3 compatible storage (MinIO / Cloudflare R2 / AWS S3)
      // When S3 endpoint is provided, upload via HTTP PUT; if not configured, fall back to local disk
      if (this.config.FILE_STORAGE_S3_ENDPOINT) {
        try {
          await this.putToS3Compatible(id, input.filename, buffer, mimeType);
          storagePath = `s3://${this.config.FILE_STORAGE_S3_BUCKET}/${tenantId}/${id}/${input.filename}`;
        } catch (err: any) {
          this.logger.warn(`S3 upload failed (${err.message}), falling back to local database storage`);
          contentData = buffer.toString('base64');
          storagePath = `db://stored_files/${id}`;
        }
      } else {
        contentData = buffer.toString('base64');
        storagePath = `db://stored_files/${id}`;
      }
    }

    const query = `
      INSERT INTO stored_files (
        id, tenant_id, filename, mime_type, size_bytes, checksum_sha256,
        storage_driver, storage_path, content_data, metadata, uploaded_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, tenant_id, filename, mime_type, size_bytes, checksum_sha256,
                storage_driver, storage_path, metadata, uploaded_by, created_at
    `;
    const res = await this.getPool().query(query, [
      id,
      tenantId,
      input.filename,
      mimeType,
      sizeBytes,
      checksumSha256,
      storageDriver,
      storagePath,
      contentData,
      JSON.stringify(input.metadata ?? {}),
      input.uploadedBy ?? null,
      now,
    ]);

    const row = res.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      checksumSha256: row.checksum_sha256,
      storageDriver: row.storage_driver,
      storagePath: row.storage_path,
      metadata: row.metadata || {},
      uploadedBy: row.uploaded_by,
      createdAt: new Date(row.created_at),
    };
  }

  async getFile(id: string, tenantId?: string): Promise<StoredFileRecord> {
    if (this.config.STORAGE_DRIVER === 'memory') {
      const item = this.memoryFiles.get(id);
      if (!item) throw new NotFoundError('StoredFile', id);
      return item.record;
    }

    const res = await this.getPool().query(
      `SELECT id, tenant_id, filename, mime_type, size_bytes, checksum_sha256,
              storage_driver, storage_path, metadata, uploaded_by, created_at
       FROM stored_files
       WHERE id = $1 ${tenantId ? 'AND tenant_id = $2' : ''}`,
      tenantId ? [id, tenantId] : [id],
    );

    if (res.rows.length === 0) {
      throw new NotFoundError('StoredFile', id);
    }
    const row = res.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      checksumSha256: row.checksum_sha256,
      storageDriver: row.storage_driver,
      storagePath: row.storage_path,
      metadata: row.metadata || {},
      uploadedBy: row.uploaded_by,
      createdAt: new Date(row.created_at),
    };
  }

  async downloadFileContent(id: string, tenantId?: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    if (this.config.STORAGE_DRIVER === 'memory') {
      const item = this.memoryFiles.get(id);
      if (!item) throw new NotFoundError('StoredFile', id);
      return { buffer: item.data, filename: item.record.filename, mimeType: item.record.mimeType };
    }

    const res = await this.getPool().query(
      `SELECT id, tenant_id, filename, mime_type, storage_driver, storage_path, content_data
       FROM stored_files
       WHERE id = $1 ${tenantId ? 'AND tenant_id = $2' : ''}`,
      tenantId ? [id, tenantId] : [id],
    );

    if (res.rows.length === 0) {
      throw new NotFoundError('StoredFile', id);
    }
    const row = res.rows[0];

    if (row.content_data) {
      return {
        buffer: Buffer.from(row.content_data, 'base64'),
        filename: row.filename,
        mimeType: row.mime_type,
      };
    }

    if (row.storage_driver === 'local') {
      const buffer = await fs.readFile(row.storage_path);
      return { buffer, filename: row.filename, mimeType: row.mime_type };
    }

    if (row.storage_driver === 's3_compatible' && this.config.FILE_STORAGE_S3_ENDPOINT) {
      const buffer = await this.getFromS3Compatible(id, row.filename);
      return { buffer, filename: row.filename, mimeType: row.mime_type };
    }

    throw new NotFoundError('StoredFileContent', id);
  }

  async listFiles(tenantId = 'default', limit = 50): Promise<StoredFileRecord[]> {
    if (this.config.STORAGE_DRIVER === 'memory') {
      return [...this.memoryFiles.values()]
        .filter((i) => !tenantId || i.record.tenantId === tenantId)
        .map((i) => i.record)
        .slice(0, limit);
    }

    const res = await this.getPool().query(
      `SELECT id, tenant_id, filename, mime_type, size_bytes, checksum_sha256,
              storage_driver, storage_path, metadata, uploaded_by, created_at
       FROM stored_files
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );

    return res.rows.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      checksumSha256: row.checksum_sha256,
      storageDriver: row.storage_driver,
      storagePath: row.storage_path,
      metadata: row.metadata || {},
      uploadedBy: row.uploaded_by,
      createdAt: new Date(row.created_at),
    }));
  }

  async deleteFile(id: string, tenantId?: string): Promise<void> {
    if (this.config.STORAGE_DRIVER === 'memory') {
      this.memoryFiles.delete(id);
      return;
    }

    const file = await this.getFile(id, tenantId);
    if (file.storageDriver === 'local') {
      try {
        await fs.unlink(file.storagePath);
      } catch {}
    } else if (file.storageDriver === 's3_compatible' && this.config.FILE_STORAGE_S3_ENDPOINT) {
      try {
        await this.deleteFromS3Compatible(id, file.filename);
      } catch {}
    }
    await this.getPool().query('DELETE FROM stored_files WHERE id = $1', [id]);
  }

  private inferMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.json':
        return 'application/json';
      case '.xml':
      case '.bpmn':
        return 'application/xml';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.csv':
        return 'text/csv';
      case '.txt':
        return 'text/plain';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Generates AWS Signature Version 4 headers for S3-compatible endpoints
   * (compatible with AWS S3, Cloudflare R2, MinIO, Ceph, and Ethio Telecom Cloud).
   */
  private signS3Request(
    method: string,
    urlStr: string,
    bodyBuffer?: Buffer,
    contentType?: string,
  ): Record<string, string> {
    const accessKey = this.config.FILE_STORAGE_S3_ACCESS_KEY;
    const secretKey = this.config.FILE_STORAGE_S3_SECRET_KEY;
    const region = this.config.FILE_STORAGE_S3_REGION || 'us-east-1';

    const headers: Record<string, string> = {};
    if (contentType) headers['Content-Type'] = contentType;
    if (bodyBuffer) headers['Content-Length'] = String(bodyBuffer.length);

    if (!accessKey || !secretKey) {
      return headers; // Unauthenticated / Dev MinIO / Mock
    }

    const parsedUrl = new URL(urlStr);
    const host = parsedUrl.host;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const payloadHash = crypto
      .createHash('sha256')
      .update(bodyBuffer || Buffer.alloc(0))
      .digest('hex');

    headers['Host'] = host;
    headers['x-amz-date'] = amzDate;
    headers['x-amz-content-sha256'] = payloadHash;

    const canonicalUri = parsedUrl.pathname || '/';
    const canonicalQuery = parsedUrl.searchParams.toString();

    const sortedHeaderKeys = Object.keys(headers)
      .map((k) => k.toLowerCase())
      .sort();
    const canonicalHeaders = sortedHeaderKeys
      .map((k) => {
        const matchingKey = Object.keys(headers).find((orig) => orig.toLowerCase() === k);
        const val = matchingKey ? headers[matchingKey] : '';
        return `${k}:${(val || '').trim()}\n`;
      })
      .join('');
    const signedHeaders = sortedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string): Buffer =>
      crypto.createHmac('sha256', key).update(data).digest();

    const kDate = hmac('AWS4' + secretKey, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headers;
  }

  private async putToS3Compatible(
    fileId: string,
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    const endpoint = this.config.FILE_STORAGE_S3_ENDPOINT!;
    const bucket = this.config.FILE_STORAGE_S3_BUCKET;
    const url = `${endpoint.replace(/\/$/, '')}/${bucket}/${fileId}_${encodeURIComponent(filename)}`;

    const headers = this.signS3Request('PUT', url, buffer, mimeType);

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: new Uint8Array(buffer),
    });

    if (!res.ok && res.status !== 200 && res.status !== 201) {
      throw new Error(`S3 responded with ${res.status}: ${res.statusText}`);
    }
  }

  private async getFromS3Compatible(fileId: string, filename: string): Promise<Buffer> {
    const endpoint = this.config.FILE_STORAGE_S3_ENDPOINT!;
    const bucket = this.config.FILE_STORAGE_S3_BUCKET;
    const url = `${endpoint.replace(/\/$/, '')}/${bucket}/${fileId}_${encodeURIComponent(filename)}`;

    const headers = this.signS3Request('GET', url);
    const res = await fetch(url, { method: 'GET', headers });

    if (!res.ok) {
      throw new Error(`S3 GET responded with ${res.status}: ${res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  private async deleteFromS3Compatible(fileId: string, filename: string): Promise<void> {
    const endpoint = this.config.FILE_STORAGE_S3_ENDPOINT!;
    const bucket = this.config.FILE_STORAGE_S3_BUCKET;
    const url = `${endpoint.replace(/\/$/, '')}/${bucket}/${fileId}_${encodeURIComponent(filename)}`;

    const headers = this.signS3Request('DELETE', url);
    await fetch(url, { method: 'DELETE', headers }).catch(() => {});
  }
}
