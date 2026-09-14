import { requirePermission } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { PageHeader } from '@/components/ui';
import { ReceiptImport } from '@/components/purchases/ReceiptImport';

export const dynamic = 'force-dynamic';

export default async function NewPurchasePage() {
  const user = await requirePermission('receipts.scan');
  const dict = getDictionary(user.locale);

  return (
    <>
      <PageHeader
        title={dict.receipts.title}
        subtitle="Photographie le reçu, vérifie les lignes, valide : le stock est à jour."
      />
      <ReceiptImport
        currency={user.currency}
        locale={user.locale}
        labels={{ ...dict.receipts, common: dict.common }}
      />
    </>
  );
}
