import { useT } from '../i18n';

export function ListsPage() {
  const t = useT();
  return (
    <section>
      <h1>{t.lists.title}</h1>
      <p className="placeholder">{t.lists.placeholder}</p>
    </section>
  );
}
