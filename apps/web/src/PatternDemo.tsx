import { useState } from 'react';
import fixtures from './pattern-demo.json';
import PatternExplorer from './PatternExplorer';
import type { PatternAnalysis, PatternOutcome } from './patterns';
import './PatternDemo.css';

type FixtureKey = '30_sleep' | '30_ans' | '90_sleep' | '90_ans';
const demoFixtures = fixtures as Record<FixtureKey, PatternAnalysis>;

export default function PatternDemo() {
  const [days, setDays] = useState(90);
  const [outcome, setOutcome] = useState<PatternOutcome>('sleep');
  const key = `${days}_${outcome}` as FixtureKey;

  return <div className="pattern-demo-page">
    <header className="demo-public-header">
      <a className="demo-brand" href="/" aria-label="Polar Health Analytics, private dashboard">
        <span className="demo-brand-mark" aria-hidden="true">p</span>
        <span>polar<small>DATA STUDIO</small></span>
      </a>
      <a className="demo-back-link" href="/">Zur privaten Datenansicht <span aria-hidden="true">↗</span></a>
    </header>
    <main className="demo-main">
      <section className="demo-intro" aria-labelledby="demo-title">
        <p className="demo-kicker">POLAR HEALTH ANALYTICS <span>·</span> ÖFFENTLICHE DEMO</p>
        <h1 id="demo-title">Ein Blick auf die nächste Nacht</h1>
        <p className="demo-lede">Vergleiche Bewegung an einem Tag mit Schlafdauer oder ANS-Status in der folgenden Nacht. Die Auswahl zeigt, wie das Recovery Lab archivierte Tageswerte einordnet.</p>
        <div className="demo-period"><span>Fester Beispielzeitraum</span><strong>03.07.2026 bis 30.09.2026</strong></div>
        <p className="demo-synthetic-note"><strong>Nur synthetische Werte.</strong> Diese Ansicht ist frei erzeugt und enthält keine persönlichen Polar-Daten.</p>
      </section>
      <PatternExplorer
        data={demoFixtures[key]}
        days={days}
        outcome={outcome}
        onDaysChange={setDays}
        onOutcomeChange={setOutcome}
        demo
      />
      <footer className="demo-footer">Die Beispiele zeigen keine echten Messungen, keine Ursache und keine Vorhersage. Sie sind keine medizinische Bewertung oder Empfehlung.</footer>
    </main>
  </div>;
}
