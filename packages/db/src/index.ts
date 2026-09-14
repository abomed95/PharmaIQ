export { prisma } from './client';
export { prismaAdmin } from './admin';
export {
  withTenant,
  tenantScope,
  tenantQuery,
  nextCounter,
  currentPharmacyId,
  assertUuid,
  TenantError,
  type TenantContext,
  type TenantTx,
} from './tenant';

export { Prisma } from '@prisma/client';
export {
  Role,
  Plan,
  MovementType,
  MovementSource,
  SaleStatus,
  PurchaseStatus,
  AlertType,
  AlertChannel,
  AlertStatus,
  RecoType,
} from '@prisma/client';
export type {
  Pharmacy,
  Branch,
  User,
  Invitation,
  Category,
  Product,
  Stock,
  StockMovement,
  Supplier,
  Purchase,
  PurchaseItem,
  Sale,
  SaleItem,
  Customer,
  Alert,
  Recommendation,
  Counter,
  AuditLog,
} from '@prisma/client';
