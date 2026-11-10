export type Role = 'ADMIN' | 'OPERATOR' | 'BUILDER' | 'VIEWER';

export type Permission =
  | 'workflow:read'
  | 'workflow:write'
  | 'workflow:publish'
  | 'instance:read'
  | 'instance:start'
  | 'instance:cancel'
  | 'task:read'
  | 'task:act'
  | 'incident:read'
  | 'incident:resolve'
  | 'credential:read'
  | 'credential:write'
  | 'message:correlate'
  | 'admin:users';

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>([
    'workflow:read',
    'workflow:write',
    'workflow:publish',
    'instance:read',
    'instance:start',
    'instance:cancel',
    'task:read',
    'task:act',
    'incident:read',
    'incident:resolve',
    'credential:read',
    'credential:write',
    'message:correlate',
    'admin:users',
  ]),
  BUILDER: new Set<Permission>([
    'workflow:read',
    'workflow:write',
    'workflow:publish',
    'instance:read',
    'instance:start',
    'task:read',
    'credential:read',
    'credential:write',
    'message:correlate',
  ]),
  OPERATOR: new Set<Permission>([
    'workflow:read',
    'instance:read',
    'instance:start',
    'instance:cancel',
    'task:read',
    'task:act',
    'incident:read',
    'incident:resolve',
    'message:correlate',
  ]),
  VIEWER: new Set<Permission>([
    'workflow:read',
    'instance:read',
    'task:read',
    'incident:read',
  ]),
};

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  role: Role;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface AuthPrincipal {
  userId: string;
  email: string;
  role: Role;
  authType: 'jwt' | 'api_key';
}

export interface CredentialRecord {
  id: string;
  name: string;
  type: 'bearer' | 'api_key' | 'basic' | 'custom';
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
