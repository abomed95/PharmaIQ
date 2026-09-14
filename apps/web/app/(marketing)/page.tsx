import Link from 'next/link';

const FEATURES = [
  {
    emoji: '📷',
    title: 'Le stock se met à jour en photo',
    text: "Photographie le reçu du fournisseur : l'IA lit les lignes, les rapproche de ton catalogue, tu vérifies et tu valides. Aucune saisie obligatoire.",
  },
  {
    emoji: '🔔',
    title: 'Les alertes arrivent sur WhatsApp',
    text: 'Un seul message récapitulatif le matin : ruptures, stocks bas, produits qui périment. Sans ouvrir l’application.',
  },
  {
    emoji: '🧠',
    title: 'Les conseils viennent de TES ventes',
    text: "Quoi commander, en quelle quantité, quoi arrêter d'acheter : calculé sur la vitesse de vente réelle de ta pharmacie.",
  },
];

export default function MarketingPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-12 text-center">
        <p className="mb-3 inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-700">
          SaaS multi-pharmacies · Djibouti
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">PharmaIQ</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          La gestion de pharmacie qui tient dans un téléphone : caisse en moins de 10 secondes,
          stock à jour par photo, et des conseils d’achat fondés sur vos ventes réelles.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="btn-primary">
            Créer ma pharmacie
          </Link>
          <Link href="/login" className="btn-secondary">
            Se connecter
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="card">
            <div className="text-2xl">{feature.emoji}</div>
            <h2 className="mt-3 font-semibold text-slate-900">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.text}</p>
          </article>
        ))}
      </section>

      <section className="card mt-10">
        <h2 className="font-semibold text-slate-900">Chaque pharmacie, ses données</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Chaque enregistrement appartient à une pharmacie et une seule. L’isolation est appliquée
          par la base de données elle-même (Row-Level Security PostgreSQL), pas seulement par le
          code applicatif — et elle est couverte par des tests automatisés.
        </p>
      </section>

      <footer className="mt-12 text-center text-xs text-slate-400">
        Devise FDJ · Paiements Cash, Waafi, CAC pay, D money, Saba pay, banque · FR / Soomaali /
        العربية / EN
      </footer>
    </main>
  );
}
