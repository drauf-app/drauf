import { useT } from '../i18n';

export function PlanPage() {
  const t = useT();
  return (
    <section>
      <h1>{t.plan.title}</h1>
      <p className="placeholder">{t.plan.placeholder}</p>
    </section>
  );
}
