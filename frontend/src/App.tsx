import { useState } from "react";
import "./App.css";
import { BiometryPage } from "./pages/BiometryPage";
import { FormPage } from "./pages/FormPage";
import { PatientsPage } from "./pages/PatientsPage";
import { StatisticsPage } from "./pages/StatisticsPage";
import {
  initialLanguage,
  LANGUAGES,
  LANGUAGE_LABELS,
  rememberLanguage,
  STRINGS,
  type Lang,
} from "./lib/i18n";
import { PAGES, useRoute, type Page } from "./lib/router";

/**
 * The shell: who you are, which language, which page.
 *
 * Everything else lives in `pages/`. This app spent a long time as one very
 * long screen — photograph an exam, review two eyes, set constants,
 * calculate, build a record, match a patient, and somewhere in the middle
 * an unrelated file input for photographing a consultation form. It grew
 * that way one feature at a time and became too much to take in at once.
 *
 * Four pages, each answering one question, and each carrying only the
 * warning that applies to it — the single disclaimer trying to cover both
 * photo paths at once was half the crowding on its own.
 */
function App() {
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const [page, navigate] = useRoute();
  const t = STRINGS[lang];

  function changeLanguage(next: Lang) {
    setLang(next);
    rememberLanguage(next);
  }

  const tabLabel: Record<Page, string> = {
    form: t.navForm,
    biometry: t.navBiometry,
    statistics: t.navStatistics,
    patients: t.navPatients,
  };

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>{t.title}</h1>
          <div className="lang-switch" role="group" aria-label="Language">
            {LANGUAGES.map((option) => (
              <button
                key={option}
                type="button"
                className={option === lang ? "active" : undefined}
                aria-pressed={option === lang}
                onClick={() => changeLanguage(option)}
              >
                {LANGUAGE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <nav className="tabs" aria-label={t.navLabel}>
          {PAGES.map((option) => (
            <button
              key={option}
              type="button"
              className={option === page ? "tab active" : "tab"}
              aria-current={option === page ? "page" : undefined}
              onClick={() => navigate(option)}
            >
              {tabLabel[option]}
            </button>
          ))}
        </nav>
      </header>

      {/* Remounted per page on purpose: leaving a half-finished calculation
          running behind another tab would be a surprise, and each page is a
          separate piece of work rather than a view of the same one. */}
      {page === "form" && <FormPage t={t} />}
      {page === "biometry" && <BiometryPage t={t} lang={lang} />}
      {page === "statistics" && <StatisticsPage t={t} />}
      {page === "patients" && <PatientsPage t={t} lang={lang} />}
    </div>
  );
}

export default App;
