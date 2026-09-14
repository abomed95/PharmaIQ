import { withTenant } from '@pharmaiq/db';
import { parseAlertConfig } from '@pharmaiq/core';
import { requirePermission, toTenantContext } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import { Badge, Card, PageHeader } from '@/components/ui';
import {
  AlertSettingsForm,
  InviteForm,
  PharmacySettingsForm,
} from '@/components/settings/SettingsForms';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { onboarding?: string };
}) {
  const user = await requirePermission('settings.manage');
  const dict = getDictionary(user.locale);
  const ctx = toTenantContext(user);

  const data = await withTenant(ctx, async (tx) => {
    const [pharmacy, users, branches, alerts] = await Promise.all([
      tx.pharmacy.findFirstOrThrow({
        where: { id: ctx.pharmacyId },
        select: {
          name: true,
          slug: true,
          city: true,
          currency: true,
          locale: true,
          timezone: true,
          invoicePrefix: true,
          taxRate: true,
          phoneWhatsapp: true,
          alertConfig: true,
          plan: true,
        },
      }),
      tx.user.findMany({
        where: { pharmacyId: ctx.pharmacyId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          fullName: true,
          email: true,
          role: true,
          isActive: true,
          lastSeenAt: true,
        },
      }),
      tx.branch.findMany({
        where: { pharmacyId: ctx.pharmacyId },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, address: true, isMain: true },
      }),
      tx.alert.findMany({
        where: { pharmacyId: ctx.pharmacyId },
        orderBy: { sentAt: 'desc' },
        take: 5,
        select: { id: true, type: true, channel: true, status: true, sentAt: true },
      }),
    ]);

    return { pharmacy, users, branches, alerts };
  });

  return (
    <>
      <PageHeader
        title={dict.settings.title}
        subtitle={`${data.pharmacy.name} · ${data.pharmacy.slug} · plan ${data.pharmacy.plan}`}
      />

      {searchParams.onboarding === '1' ? (
        <Card className="mb-4 border-brand-200 bg-brand-50">
          <h2 className="font-semibold text-brand-900">Bienvenue 👋</h2>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-brand-900">
            <li>Vérifie le numéro WhatsApp qui recevra les alertes.</li>
            <li>
              Importe ton catalogue :{' '}
              <code className="rounded bg-white px-1 py-0.5 text-xs">
                pnpm import:catalog --pharmacy-id {'<id>'} --file catalogue.csv
              </code>
            </li>
            <li>Invite ta caissière, puis encaisse ta première vente.</li>
          </ol>
        </Card>
      ) : null}

      <div className="space-y-4">
        <PharmacySettingsForm
          initial={{
            name: data.pharmacy.name,
            city: data.pharmacy.city ?? '',
            invoicePrefix: data.pharmacy.invoicePrefix,
            taxRate: Number(data.pharmacy.taxRate),
            phoneWhatsapp: data.pharmacy.phoneWhatsapp ?? '',
            locale: data.pharmacy.locale,
          }}
        />

        <AlertSettingsForm initial={parseAlertConfig(data.pharmacy.alertConfig)} />

        <Card>
          <h2 className="mb-3 font-semibold">{dict.settings.users}</h2>
          <div className="table-wrap">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Nom</th>
                  <th className="th">E-mail</th>
                  <th className="th">Rôle</th>
                  <th className="th">État</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((member) => (
                  <tr key={member.id}>
                    <td className="td font-medium">{member.fullName}</td>
                    <td className="td text-slate-500">{member.email}</td>
                    <td className="td">{member.role}</td>
                    <td className="td">
                      {member.isActive ? (
                        <Badge className="bg-brand-50 text-brand-700">actif</Badge>
                      ) : (
                        <Badge className="bg-amber-50 text-amber-700">invitation en attente</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <InviteForm />

        <Card>
          <h2 className="mb-3 font-semibold">{dict.settings.branches}</h2>
          <ul className="space-y-2 text-sm">
            {data.branches.map((branch) => (
              <li key={branch.id} className="flex items-center justify-between gap-3">
                <span>
                  {branch.name}
                  {branch.address ? ` — ${branch.address}` : ''}
                </span>
                {branch.isMain ? <Badge className="bg-slate-100 text-slate-600">principale</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Derniers envois d’alertes</h2>
          {data.alerts.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune alerte envoyée pour le moment. Le job quotidien s’exécute à l’heure configurée.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.alerts.map((alert) => (
                <li key={alert.id} className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-slate-100 text-slate-600">{alert.type}</Badge>
                  <span className="text-slate-500">{alert.channel}</span>
                  <Badge
                    className={
                      alert.status === 'sent'
                        ? 'bg-brand-50 text-brand-700'
                        : alert.status === 'failed'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-amber-50 text-amber-700'
                    }
                  >
                    {alert.status}
                  </Badge>
                  <span className="text-slate-400">{dateTime(alert.sentAt, user.locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
