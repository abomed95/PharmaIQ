import { requirePermission } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { PageHeader } from '@/components/ui';
import { PosTerminal } from '@/components/pos/PosTerminal';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const user = await requirePermission('sales.create');
  const dict = getDictionary(user.locale);

  return (
    <>
      <PageHeader title={dict.pos.title} subtitle={user.pharmacyName} />
      <PosTerminal
        currency={user.currency}
        locale={user.locale}
        taxRate={user.taxRate}
        pharmacyName={user.pharmacyName}
        labels={{ ...dict.pos, common: dict.common }}
      />
    </>
  );
}
