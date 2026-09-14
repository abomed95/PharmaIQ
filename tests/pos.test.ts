import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS,
  can,
  computeChange,
  computeTotals,
  counterKey,
  formatInvoiceNumber,
  isPaymentMethod,
  lineTotal,
  marginRate,
  round2,
} from '@pharmaiq/core';

describe('caisse — totaux', () => {
  it('additionne les lignes', () => {
    const totals = computeTotals([
      { quantity: 2, unitPrice: 300 },
      { quantity: 1, unitPrice: 950 },
    ]);

    expect(totals.subtotal).toBe(1550);
    expect(totals.grandTotal).toBe(1550);
  });

  it('applique la taxe après la remise', () => {
    const totals = computeTotals([{ quantity: 2, unitPrice: 500 }], {
      taxRate: 10,
      globalDiscount: 200,
    });

    expect(totals.discount).toBe(200);
    expect(totals.subtotal).toBe(800);
    expect(totals.tax).toBe(80);
    expect(totals.grandTotal).toBe(880);
  });

  it('ne laisse jamais la remise dépasser le montant brut', () => {
    const totals = computeTotals([{ quantity: 1, unitPrice: 100 }], { globalDiscount: 500 });

    expect(totals.discount).toBe(100);
    expect(totals.grandTotal).toBe(0);
  });

  it('calcule la monnaie et le reste à payer', () => {
    expect(computeChange(660, 1000)).toEqual({ change: 340, due: 0 });
    expect(computeChange(660, 500)).toEqual({ change: 0, due: 160 });
  });

  it('évite la dérive des flottants', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(lineTotal({ quantity: 3, unitPrice: 33.33 })).toBe(99.99);
  });

  it('calcule la marge en pourcentage du prix de vente', () => {
    expect(marginRate(180, 300)).toBe(40);
    expect(marginRate(900, 700)).toBeLessThan(0);
    expect(marginRate(100, 0)).toBeNull();
  });

  it('n’accepte que les modes de paiement locaux connus', () => {
    expect(isPaymentMethod('Waafi')).toBe(true);
    expect(isPaymentMethod('D money')).toBe(true);
    expect(isPaymentMethod('Bitcoin')).toBe(false);
  });
});

describe('numérotation des factures', () => {
  it('formate le numéro avec période et séquence', () => {
    const date = new Date('2026-09-14T12:00:00Z');
    expect(formatInvoiceNumber('INV', 42, date)).toBe('INV-202609-000042');
    expect(counterKey(date)).toBe('invoice:2026-09');
  });

  it('nettoie un préfixe fantaisiste', () => {
    const date = new Date('2026-01-05T12:00:00Z');
    expect(formatInvoiceNumber('sh-ifa!', 1, date)).toBe('SHIFA-202601-000001');
  });
});

describe('permissions par rôle', () => {
  it('le caissier encaisse mais ne voit pas les finances', () => {
    expect(can('cashier', 'sales.create')).toBe(true);
    expect(can('cashier', 'reports.view')).toBe(false);
    expect(can('cashier', 'users.manage')).toBe(false);
  });

  it('tout le monde peut mettre le stock à jour par photo (§9)', () => {
    for (const role of ['owner', 'admin', 'pharmacist', 'cashier', 'stock_manager'] as const) {
      expect(can(role, 'receipts.scan')).toBe(true);
    }
  });

  it('seul le propriétaire gère la facturation SaaS', () => {
    expect(can('owner', 'billing.manage')).toBe(true);
    expect(can('admin', 'billing.manage')).toBe(false);
  });

  it('le gestionnaire de stock ne vend pas', () => {
    expect(can('stock_manager', 'sales.create')).toBe(false);
    expect(can('stock_manager', 'stock.update')).toBe(true);
  });

  it('aucun rôle n’a de permission en double', () => {
    for (const permissions of Object.values(ROLE_PERMISSIONS)) {
      expect(new Set(permissions).size).toBe(permissions.length);
    }
  });
});
