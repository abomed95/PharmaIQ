import { isAiConfigured } from '@pharmaiq/ai';
import { requirePermission } from '@/lib/auth';
import { getDictionary } from '@/lib/i18n';
import { EmptyState, PageHeader } from '@/components/ui';
import { AssistantChat } from '@/components/assistant/AssistantChat';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const user = await requirePermission('assistant.use');
  const dict = getDictionary(user.locale);

  if (!isAiConfigured()) {
    return (
      <>
        <PageHeader title={dict.assistant.title} />
        <EmptyState
          title={dict.assistant.disabled}
          hint="Ajoute ANTHROPIC_API_KEY dans les variables d'environnement du serveur."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={dict.assistant.title}
        subtitle={`Répond uniquement sur les données de ${user.pharmacyName}`}
      />
      <AssistantChat labels={{ ...dict.assistant, common: dict.common }} />
    </>
  );
}
