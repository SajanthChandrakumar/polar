import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEMO_PERIOD, DEMO_TIME, sources, sourceStatus, statusLabels, type Source } from './data';

type IconName = 'heart' | 'moon' | 'recharge' | 'activity' | 'training' | 'device' | 'grid' | 'layers' | 'arrow' | 'link' | 'refresh' | 'search' | 'close';
const paths: Record<IconName, ReactNode> = {
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
  moon: <path d="M20.7 13.4A9 9 0 0 1 10.6 3.3a9 9 0 1 0 10.1 10.1Z" />,
  recharge: <><path d="M13 2 4 14h7l-1 8 10-12h-7l1-8Z" /></>,
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  training: <><path d="m5 4 15 16M4 7l3-3M17 20l3-3M2 5l3-3M19 22l3-3M4 20l16-16M2 19l3 3M19 2l3 3" /></>,
  device: <><rect x="7" y="6" width="10" height="12" rx="3" /><path d="M9 6V2h6v4M9 18v4h6v-4M10 12h4" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9 1)" /></>,
  refresh: <path d="M21 7v5h-5M3 17v-5h5M5.2 7a8 8 0 0 1 13.2-2L21 8M3 16l2.6 3A8 8 0 0 0 18.8 17" />,
  search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
function Icon({ name, className = '' }: { name: IconName; className?: string }) { return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
function Modal({ title, onClose, children, closeLabel = 'Details schließen' }: { title: string; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (dialog.close) dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const nodes = ref.current!.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex="0"]');
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><div className="dialog-content"><div className="dialog-heading"><div><p className="eyebrow">DATENINSPEKTOR</p><h2 id="dialog-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label={closeLabel}><Icon name="close" /></button></div>{children}</div></dialog>;
}
const cards: { label: string; icon: IconName; value: string; unit: string; detail: string; source: string }[] = [
  { label: 'Herzfrequenz', icon: 'heart', value: '58', unit: 'bpm', detail: 'Mittelwert · 5 Samples am 02.10.', source: 'Herzfrequenz' },
  { label: 'Schlaf', icon: 'moon', value: '7 h 42', unit: 'min', detail: '23:10–06:52 · Nacht zum 03.10.', source: 'Schlaf' },
  { label: 'Nightly Recharge', icon: 'recharge', value: '+0,8', unit: 'ANS', detail: 'Synthetischer Polar-Feldwert · 03.10.', source: 'Nightly Recharge' },
  { label: 'Aktivität', icon: 'activity', value: '8.420', unit: 'Schritte', detail: '76 aktive Minuten · 02.10.', source: 'Aktivität' },
  { label: 'Training', icon: 'training', value: '42', unit: 'min', detail: '1 Training · Walking · 02.10.', source: 'Training' },
  { label: 'Geräte', icon: 'device', value: '1', unit: 'Gerät', detail: 'Polar Loop Gen 2 · Beispielgerät', source: 'Geräte' },
];
function Details({ source, demo, loading }: { source: Source; demo: boolean; loading: boolean }) {
  const status = sourceStatus(source, demo, loading);
  const inspected = demo && !loading && status !== 'skipped';
  const http = !inspected ? '—' : status === 'failed' ? '503 Service Unavailable' : status === 'denied' ? '403 Forbidden' : '200 OK';
  const count = inspected && ['populated', 'empty'].includes(status) ? source.count : null;
  return <><p className="notice small">{demo ? 'Synthetisches Beispiel. Antwortstruktur nur illustrativ; kein verifizierter Polar-API-Vertrag.' : 'Ohne Verbindung wurde keine Anfrage an Polar gestellt.'}</p><code className="endpoint-path">{source.path}</code><dl className="detail-grid"><div><dt>Status</dt><dd><span className={`badge ${status}`}>{statusLabels[status]}</span></dd></div><div><dt>HTTP-Status</dt><dd>{http}</dd></div><div><dt>Anfragezeitraum</dt><dd>{demo ? DEMO_PERIOD : 'Noch nicht angefordert'}</dd></div><div><dt>Letzte Anfrage</dt><dd>{inspected ? `${DEMO_TIME} · Demo` : 'Keine'}<small>Europe/Zurich</small></dd></div><div><dt>Herkunft</dt><dd>{demo ? 'Lokale synthetische Fixture' : 'Keine Datenquelle verbunden'}</dd></div><div><dt>Datensätze</dt><dd>{count ?? '—'}{count !== null && <small>{source.binary ? 'Binärdatei' : 'Top-Level-Einträge; Samples separat'}</small>}</dd></div></dl><div className="detail-block"><h3>Detailauswahl</h3><p>{source.features}</p><small>{source.limit}</small></div>{status === 'skipped' && <p className="notice">{source.message}</p>}{status === 'empty' && <p className="notice">Erfolgreiche Antwort ohne Einträge. Daraus folgt keine Aussage zur Geräteunterstützung.</p>}{status === 'loading' && <p className="notice">Demo-Anfrage läuft. Die Antwort erscheint nach dem simulierten Abruf.</p>}{inspected && <div className="detail-block"><h3>{source.binary ? 'Binär-Metadaten · synthetisch' : 'Antwort · synthetisches JSON'}</h3>{source.binary ? <dl className="binary"><div><dt>Dateityp</dt><dd>image/png</dd></div><div><dt>Größe</dt><dd>2.048 Bytes · kein echter Bildkörper gespeichert</dd></div><div><dt>Auswahl</dt><dd>medium</dd></div></dl> : <pre tabIndex={0} aria-label="Antwortinhalt">{JSON.stringify(source.payload, null, 2)}</pre>}</div>}</>;
}
export default function App() {
  const [demo, setDemo] = useState(false), [loading, setLoading] = useState(false), [finished, setFinished] = useState(false);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Source | null>(null), [connection, setConnection] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRun = useRef(false);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function toggleDemo() {
    if (timer.current) clearTimeout(timer.current);
    activeRun.current = false; setLoading(false); setFinished(false); setSelected(null); setDemo(!demo);
  }
  function refresh() {
    if (!demo || activeRun.current) return;
    activeRun.current = true; setLoading(true); setFinished(false);
    timer.current = setTimeout(() => { activeRun.current = false; setLoading(false); setFinished(true); }, 1800);
  }
  const filtered = sources.filter(source => {
    const matchesText = `${source.name} ${source.path} ${source.features}`.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de'));
    const status = sourceStatus(source, demo, loading);
    return matchesText && (filter === 'all' || filter === source.group || filter === status || (filter === 'issues' && ['failed', 'denied', 'skipped'].includes(status)));
  });
  return <div className="app-shell"><a href="#main" className="skip-link">Zum Inhalt</a><header className="site-header"><a className="brand" href="#overview" aria-label="Polar Health Analytics Übersicht"><span className="brand-mark"><Icon name="activity" /></span><span>polar<span className="brand-sub">DATA STUDIO</span></span></a><nav aria-label="Hauptnavigation"><a href="#overview">Übersicht</a><a href="#sources">Datenquellen <span className="nav-count">21</span></a></nav><div className="connection-state"><span className="status-dot" />Nicht verbunden</div></header><div className="workspace"><main id="main"><section className="page-heading" id="overview"><div><p className="eyebrow">POLAR HEALTH ANALYTICS</p><h1>Dein Körper. Deine Daten.</h1><p className="subtitle">Alles, was dein Loop erfasst. An einem Ort.</p></div><button className="primary" onClick={() => setConnection(true)}><Icon name="link" />Mit Polar verbinden</button></section><div className={`mode-banner ${demo ? 'demo-mode' : ''}`} role="status" aria-label="Datenmodus"><div><span className="banner-symbol">{demo ? '✦' : '○'}</span><div><strong>{demo ? 'Beispielansicht · alle Daten synthetisch' : 'Dein Dashboard wartet auf die ersten Daten'}</strong><p>{demo ? 'Lokale Beispiele, keine echten Gesundheitsdaten. Es erfolgt kein Polar-Abruf.' : 'Verbinde später dein Polar-Konto oder erkunde das Dashboard mit Beispieldaten.'}</p></div></div><button className="text-button" onClick={toggleDemo}>{demo ? 'Beispieldaten verlassen' : 'Beispieldaten ansehen'}<Icon name="arrow" /></button></div><div className="period-bar"><div><span className="label">ZEITRAUM</span><strong>{demo ? `${DEMO_PERIOD} · Demo` : 'Noch keine Daten'}</strong><small>Europe/Zurich</small></div><div className="refresh-area"><span className="last-fetch">Letzter Abruf <strong>{demo ? `${DEMO_TIME} · Demo` : 'Noch keiner'}</strong></span><button className="secondary" onClick={refresh} disabled={!demo || loading}><Icon name="refresh" className={loading ? 'spinning' : ''} />{loading ? 'Demo-Abruf läuft …' : 'Demo-Abruf'}</button></div></div><section className="metrics" aria-label="Datenübersicht">{cards.map(card => <article className={`metric-card ${card.icon}`} key={card.label}><div className="metric-header"><span className="metric-icon"><Icon name={card.icon} /></span><h2>{card.label}</h2>{demo && <span className="metric-demo">DEMO</span>}</div><div className="metric-value"><strong>{demo ? card.value : '—'}</strong>{demo && <span>{card.unit}</span>}</div><p>{demo ? card.detail : 'Noch keine Daten verfügbar'}</p><button className="card-link" onClick={() => setSelected(sources.find(source => source.name === card.source)!)}>Quelle ansehen<Icon name="arrow" /></button></article>)}</section><section className="collection-note"><span className="note-icon"><Icon name="layers" /></span><div><h2>Die Grundlage ist deine Datensammlung.</h2><p>Messungen, Konto und Kataloge bleiben nachvollziehbar. Fehlende Daten werden sichtbar; Auswertungen folgen nach der Prüfung.</p></div><span className="phase-tag">SAMMLUNG ZUERST</span></section><section className="sources-section" id="sources"><div className="section-heading"><div><p className="eyebrow">HERKUNFT & VERFÜGBARKEIT</p><h2>Datenquellen <span>21</span></h2><p>Jeder dokumentierte Bereich. Jede Antwort nachvollziehbar.</p></div><div className="source-summary">{demo ? <><span className="summary-dot"/>{loading ? 'Demo-Abruf läuft' : '18 erfolgreich · 3 mit Hinweis'}</> : 'Noch keine Anfragen an Polar'}</div></div>{finished && <p className="sync-result" role="status">Demo-Abruf beendet: 18 von 21 erfolgreich beantwortet; 1 Fehler, 1 Zugriff verweigert, 1 Route übersprungen. Alles synthetisch.</p>}{loading && <div className="loading-strip" role="status"><span className="loading-bar"/>Synthetische Antworten werden geladen …</div>}<div className="source-toolbar"><label className="search"><Icon name="search"/><input type="search" aria-label="Datenquellen durchsuchen" placeholder="Datenquelle oder Endpunkt suchen …" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Datenquellen filtern" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Alle Bereiche</option><option value="Messungen">Messungen</option><option value="Konto & Planung">Konto & Planung</option><option value="Kataloge">Kataloge</option><option value="empty">Erfolgreich leer</option><option value="issues">Mit Hinweis / Fehler</option></select></div><div className="source-table-header"><span>DATENQUELLE</span><span>STATUS</span><span>LETZTE ANFRAGE</span><span>HTTP</span><span>EINTRÄGE</span><span/></div>{(['Messungen', 'Konto & Planung', 'Kataloge'] as const).map(group => {
    const rows = filtered.filter(source => source.group === group);
    return rows.length ? <div className="source-group" key={group}><h3>{group}<span>{rows.length}</span>{group === 'Kataloge' && <small>Referenzdaten, keine persönlichen Messungen</small>}</h3>{rows.map(source => {
      const status = sourceStatus(source, demo, loading), inspected = demo && !loading && status !== 'skipped';
      return <article className="source-row" key={source.path}><div className="source-name"><strong>{source.name}</strong><code>{source.path}</code></div><div className="source-status"><span className={`badge ${status}`}><i/>{statusLabels[status]}</span></div><div className="source-time">{inspected ? <>{DEMO_TIME}<small>Demo · Europe/Zurich</small></> : '—'}</div><span className="source-http">{inspected ? status === 'failed' ? '503' : status === 'denied' ? '403' : '200' : '—'}</span><span className="source-count">{inspected && ['empty', 'populated'].includes(status) ? source.count : '—'}</span><button className="source-detail" aria-label={`Details zu ${source.name}`} onClick={() => setSelected(source)}><span>Details</span><Icon name="arrow"/></button></article>;
    })}</div> : null;
  })}{filtered.length === 0 && <div className="no-results"><Icon name="search"/><h3>Keine passende Datenquelle</h3><p>Versuche einen anderen Suchbegriff oder Filter.</p><button className="secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Filter zurücksetzen</button></div>}<div className="table-footer">{filtered.length} von 21 Datenquellen<span>Einträge = Top-Level-Datensätze · Samples in den Details</span></div></section><footer className="page-footer"><span>polar <span>Health Analytics</span></span><p>{demo ? 'Synthetische Beispielansicht · lokal im Browser' : 'Sammlung zuerst. Auswertung nach verifizierten Daten.'}</p></footer></main></div>{selected && <Modal title={selected.name} onClose={() => setSelected(null)}><Details source={selected} demo={demo} loading={loading}/></Modal>}{connection && <Modal title="Polar-Verbindung vorbereiten" onClose={() => setConnection(false)} closeLabel="Schließen"><p className="connection-copy">Die Verbindung folgt im nächsten Schritt: privater Besitzerzugang, serverseitiges OAuth und dauerhafte Speicherung der Originalantworten.</p><p className="notice">Diese erste Dashboard-Phase enthält noch keine Anmeldung bei Polar. Du kannst die Oberfläche bereits mit ausdrücklich synthetischen Beispieldaten prüfen.</p><button className="primary" onClick={() => setConnection(false)}>Verstanden</button></Modal>}</div>;
}
