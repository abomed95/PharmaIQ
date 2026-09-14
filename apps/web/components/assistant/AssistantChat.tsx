'use client';

import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const EXAMPLES = [
  'Quel est mon médicament le plus rentable ce mois-ci ?',
  'Combien de Doliprane commander ?',
  'Quels produits dorment dans mon stock ?',
];

/** Chat IA sur les données de la pharmacie connectée uniquement. */
export function AssistantChat({ labels }: { labels: Dictionary['assistant'] & { common: Dictionary['common'] } }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);
    const history = turns.slice(-8);
    setTurns((current) => [...current, { role: 'user', content: trimmed }]);
    setQuestion('');

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, history }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? labels.common.error);
        return;
      }

      setTurns((current) => [...current, { role: 'assistant', content: payload.data.answer }]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {turns.length === 0 ? (
        <div className="card">
          <p className="text-sm text-slate-600">Essaie par exemple :</p>
          <ul className="mt-2 space-y-2">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => ask(example)}
                  className="w-full rounded-lg border border-slate-200 p-3 text-start text-sm hover:border-brand-300 hover:bg-brand-50"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="space-y-3">
          {turns.map((turn, index) => (
            <li
              key={index}
              className={
                turn.role === 'user'
                  ? 'ms-auto max-w-[85%] rounded-2xl bg-brand-600 px-4 py-2 text-sm text-white'
                  : 'me-auto max-w-[85%] whitespace-pre-line rounded-2xl bg-white px-4 py-3 text-sm shadow-sm'
              }
            >
              {turn.content}
            </li>
          ))}
        </ul>
      )}

      {pending ? <p className="text-sm text-slate-400">{labels.common.loading}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div ref={endRef} />

      <form
        className="sticky bottom-20 flex gap-2 md:bottom-4"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <input
          className="input"
          placeholder={labels.placeholder}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" className="btn-primary" disabled={pending || !question.trim()}>
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
