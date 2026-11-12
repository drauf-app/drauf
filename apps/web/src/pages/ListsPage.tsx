import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { createList, fetchLists } from '../api/lists';
import type { List } from '../api/types';
import { useT } from '../i18n';

function ListRow({ list }: { list: List }) {
  return (
    <li>
      <Link className="list-row" to={`/lists/${encodeURIComponent(list.id)}`}>
        <span className="list-dot" style={{ background: list.color ?? 'var(--accent)' }} />
        <span className="list-icon">{list.icon}</span>
        <span className="list-name">{list.name}</span>
      </Link>
    </li>
  );
}

export function ListsPage() {
  const t = useT();
  const [lists, setLists] = useState<List[]>();
  const [error, setError] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLists()
      .then((result) => {
        if (!cancelled) setLists(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '' || busy) {
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const list = await createList(trimmed);
      setLists((previous) => [...(previous ?? []), list]);
      setName('');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  if (lists === undefined) {
    return <p className="placeholder">{error ? t.common.error : t.common.loading}</p>;
  }

  const active = lists.filter((list) => !list.archived);
  const archived = lists.filter((list) => list.archived);

  return (
    <section>
      <h1>{t.lists.title}</h1>
      {active.length === 0 && <p className="placeholder">{t.lists.empty}</p>}
      <ul className="list-rows">
        {active.map((list) => (
          <ListRow key={list.id} list={list} />
        ))}
      </ul>
      {archived.length > 0 && (
        <details className="archived">
          <summary>{t.lists.archivedSection}</summary>
          <ul className="list-rows">
            {archived.map((list) => (
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        </details>
      )}
      <form className="create-list" onSubmit={(event) => void onCreate(event)}>
        <input
          type="text"
          value={name}
          maxLength={100}
          placeholder={t.lists.newListName}
          aria-label={t.lists.newListName}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="primary" disabled={busy}>
          {t.lists.create}
        </button>
      </form>
      {error && <p className="error">{t.common.error}</p>}
    </section>
  );
}
