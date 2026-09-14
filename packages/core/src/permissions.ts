/**
 * Rôles & permissions (§9 du cahier des charges).
 *
 * Le contrôle d'accès s'applique CÔTÉ SERVEUR, sur chaque route. Le front s'en
 * sert uniquement pour masquer ce qui n'est pas permis.
 */

export type Role = 'owner' | 'admin' | 'pharmacist' | 'cashier' | 'stock_manager';

export const ROLES: readonly Role[] = ['owner', 'admin', 'pharmacist', 'cashier', 'stock_manager'];

export type Permission =
  | 'dashboard.view' // KPI complets (CA, bénéfice)
  | 'dashboard.view_limited' // ventes du jour uniquement
  | 'sales.create'
  | 'sales.cancel'
  | 'sales.view'
  | 'products.view'
  | 'products.manage'
  | 'stock.view'
  | 'stock.update'
  | 'purchases.manage'
  | 'receipts.scan'
  | 'suggestions.view'
  | 'customers.manage'
  | 'reports.view'
  | 'assistant.use'
  | 'users.manage'
  | 'settings.manage'
  | 'billing.manage';

const OWNER: Permission[] = [
  'dashboard.view',
  'sales.create',
  'sales.cancel',
  'sales.view',
  'products.view',
  'products.manage',
  'stock.view',
  'stock.update',
  'purchases.manage',
  'receipts.scan',
  'suggestions.view',
  'customers.manage',
  'reports.view',
  'assistant.use',
  'users.manage',
  'settings.manage',
  'billing.manage',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: OWNER,
  // Tout sauf la facturation de l'abonnement SaaS.
  admin: OWNER.filter((p) => p !== 'billing.manage'),
  pharmacist: [
    'dashboard.view',
    'sales.create',
    'sales.view',
    'products.view',
    'products.manage',
    'stock.view',
    'stock.update',
    'purchases.manage',
    'receipts.scan',
    'suggestions.view',
    'customers.manage',
    'reports.view',
    'assistant.use',
  ],
  cashier: [
    'dashboard.view_limited',
    'sales.create',
    'sales.view',
    'products.view',
    'stock.view',
    'stock.update',
    'receipts.scan',
    'customers.manage',
  ],
  stock_manager: [
    'dashboard.view_limited',
    'products.view',
    'stock.view',
    'stock.update',
    'purchases.manage',
    'receipts.scan',
    'suggestions.view',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/** Erreur à traduire en HTTP 403 par les routes. */
export class ForbiddenError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(`Permission requise : ${permission}`);
    this.name = 'ForbiddenError';
    this.permission = permission;
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
