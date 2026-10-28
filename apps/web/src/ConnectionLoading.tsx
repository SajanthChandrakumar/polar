import { useEffect, useState } from 'react';
import './connection-loading.css';

export default function ConnectionLoading({ stage }: { stage: 'session' | 'dashboard' }) {
  const [startedAt] = useState(Date.now);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return <section className="connection-loading" aria-labelledby="connection-loading-title">
    <div className="connection-loading-head">
      <div><h2 id="connection-loading-title">Deine Ansicht startet</h2><p role="status" id="connection-loading-stage">{stage === 'session' ? 'Serververbindung wird aufgebaut …' : 'Verbindung steht. Deine Übersicht wird geladen …'}</p></div>
      <span className="connection-loading-clock" aria-live="off">Wartezeit {clock}</span>
    </div>
    <div className="connection-loading-track" role="progressbar" aria-label="Verbindung wird hergestellt" aria-describedby="connection-loading-stage"><span /></div>
    <p className="connection-loading-hint">{elapsed >= 15 ? 'Die Antwort lässt noch auf sich warten. Du kannst die Seite geöffnet lassen.' : 'Einen Moment – wir warten auf die Antwort.'} Die verbleibende Dauer ist noch nicht bestimmbar.</p>
  </section>;
}
