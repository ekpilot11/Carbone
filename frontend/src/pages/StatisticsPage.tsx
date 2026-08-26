import type { Strings } from "../lib/i18n";

/**
 * Counts and charts over the stored consultations — not built yet.
 *
 * The tab exists because the layout it belongs to is being built now, and a
 * tab that quietly does nothing is worse than one that says what it will
 * do. What goes here is decided: the filters the form's own coded fields
 * support — dilatação pupilar, IFIS, tansulosina, the comorbidities, the
 * cataract classification — and the cross-tabs that are actually worth
 * looking at, such as tansulosina against IFIS.
 */
export function StatisticsPage({ t }: { t: Strings }) {
  return (
    <section className="page-intro">
      <h2>{t.statsTitle}</h2>
      <p className="hint">{t.statsComingSoon}</p>
      <ul className="match-findings">
        {t.statsPlanned.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
