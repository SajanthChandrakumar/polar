import { useEffect, useRef, useState, type ReactNode } from 'react';
import Analytics from './Analytics';
import ConnectionLoading from './ConnectionLoading';
import DataSources from './DataSources';
import LiveDetails from './LiveDetails';
import PatternLive from './PatternLive';
import { useLiveDashboard } from './api';
import { DEMO_PERIOD, DEMO_TIME, sources, sourceStatus, statusLabels, type Source } from './data';

type Page = 'overview' | 'sleep' | 'trends' | 'data';
type TrendMode = 'series' | 'patterns';
const pageHeadings: Record<Page, string> = { overview: 'Übersicht', sleep: 'Schlaf', trends: 'Trends', data: 'Daten' };
const pageDescriptions: Record<Page, string> = {
  overview: 'Ein ausgewählter Tag und die Messwerte aus deinem Polar-Archiv.',
  sleep: 'Schlafphasen und gespeicherte Messwerte einzelner Nächte.',
  trends: 'Zeitverläufe und die vorhandenen Bewegungs-Nacht-Vergleiche.',
  data: 'Quellen, Verfügbarkeit und gespeicherte Originalantworten.',
};
const navItems: Array<{ page: Page; label: string; href: string; icon: 'overview' | 'sleep' | 'trends' | 'data' }> = [
  { page: 'overview', label: 'Übersicht', href: '#overview', icon: 'overview' },
  { page: 'sleep', label: 'Schlaf', href: '#nachtansicht', icon: 'sleep' },
  { page: 'trends', label: 'Trends', href: '#analytics-history', icon: 'trends' },
  { page: 'data', label: 'Daten', href: '#sources', icon: 'data' },
];

function routeFromHash(hash: string): { page: Page; trendMode?: TrendMode } {
  if (hash === '#nachtansicht') return { page: 'sleep' };
  if (hash === '#pattern-explorer') return { page: 'trends', trendMode: 'patterns' };
  if (hash === '#analytics-history') return { page: 'trends', trendMode: 'series' };
  if (hash === '#sources') return { page: 'data' };
  return { page: 'overview' };
}

function Icon({ name }: { name: 'overview' | 'sleep' | 'trends' | 'data' | 'refresh' | 'activity' | 'arrow' }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    sleep: <path d="M20.7 13.4A9 9 0 0 1 10.6 3.3a9 9 0 1 0 10.1 10.1Z"/>,
    trends: <path d="M3 17 9 11l4 4 8-9M15 6h6v6"/>,
    data: <><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="1"/><circle cx="14" cy="12" r="1"/><circle cx="10" cy="19" r="1"/></>,
    refresh: <path d="M21 7v5h-5M3 17v-5h5M5.2 7a8 8 0 0 1 13.2-2L21 8M3 16l2.6 3A8 8 0 0 0 18.8 17"/>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

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
      const nodes = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(node => {
        const collapsed = [...ref.current!.querySelectorAll('details:not([open])')].filter(detail => detail.contains(node));
        return node.getAttribute('aria-hidden') !== 'true' && !node.closest('[hidden]') && (!collapsed.length || (node.tagName === 'SUMMARY' && collapsed.length === 1 && node.parentElement === collapsed[0]));
      });
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}><div className="dialog-content"><div className="dialog-heading"><div><p className="eyebrow">DATENINSPEKTOR</p><h2 id="dialog-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label={closeLabel}>×</button></div>{children}</div></dialog>;
}

function DemoDetails({ source }: { source: Source }) {
  const status = sourceStatus(source, true, false);
  const inspected = status !== 'skipped';
  const http = !inspected ? '—' : status === 'failed' ? '503 Service Unavailable' : status === 'denied' ? '403 Forbidden' : '200 OK';
  const count = inspected && ['populated', 'empty'].includes(status) ? source.count : null;
  return <><p className="notice small">Synthetisches Beispiel. Antwortstruktur nur illustrativ; kein verifizierter Polar-API-Vertrag.</p><code className="endpoint-path">{source.path}</code><dl className="detail-grid"><div><dt>Status</dt><dd><span className={`badge ${status}`}>{statusLabels[status]}</span></dd></div><div><dt>HTTP-Status</dt><dd>{http}</dd></div><div><dt>Anfragezeitraum</dt><dd>{DEMO_PERIOD}</dd></div><div><dt>Letzte Anfrage</dt><dd>{inspected ? `${DEMO_TIME} · Demo` : 'Keine'}<small>Europe/Zurich</small></dd></div><div><dt>Herkunft</dt><dd>Lokale synthetische Fixture</dd></div><div><dt>Datensätze</dt><dd>{count ?? '—'}{count !== null && <small>Top-Level-Einträge; Samples separat</small>}</dd></div></dl><div className="detail-block"><h3>Detailauswahl</h3><p>{source.features}</p><small>{source.limit}</small></div>{status === 'skipped' && <p className="notice">{source.message}</p>}{status === 'empty' && <p className="notice">Erfolgreiche Antwort ohne Einträge. Daraus folgt keine Aussage zur Geräteunterstützung.</p>}{inspected && <div className="detail-block"><h3>Antwort · synthetisches JSON</h3><pre tabIndex={0} aria-label="Antwortinhalt">{JSON.stringify(source.payload, null, 2)}</pre></div>}</>;
}

function AccessPanel({ onOverview }: { onOverview: () => void }) {
  return <section className="access-panel" aria-labelledby="access-heading"><h2 id="access-heading">Privater Zugang</h2><p>Melde dich an, um deine gespeicherten Polar-Daten und privaten Verläufe zu sehen.</p><button className="primary" onClick={onOverview}>Zum Anmelden</button><a href="/demo">Öffentliche Demo ansehen</a></section>;
}

export default function App({ demo = false }: { demo?: boolean }) {
  const [page, setPage] = useState<Page>(() => routeFromHash(window.location.hash).page);
  const [trendMode, setTrendMode] = useState<TrendMode>(() => routeFromHash(window.location.hash).trendMode ?? 'series');
  const [navigationCount, setNavigationCount] = useState(0);
  const [selected, setSelected] = useState<Source | null>(null);
  const [inspectResponseIds, setInspectResponseIds] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const live = useLiveDashboard(demo);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = !demo && live.running;
  const liveSource = (source: Source) => live.dashboard?.sources.find(item => item.path === source.path);

  useEffect(() => {
    function handleHashChange() {
      if (window.location.hash === '#main') return;
      const route = routeFromHash(window.location.hash);
      setPage(route.page);
      if (route.trendMode) setTrendMode(route.trendMode);
      setNavigationCount(count => count + 1);
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  useEffect(() => { if (navigationCount > 0) headingRef.current?.focus(); }, [navigationCount, page]);
  useEffect(() => { if (!selected) setInspectResponseIds([]); }, [selected]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setSigningIn(true); setLoginError('');
    try { await live.login(password); setPassword(''); }
    catch (reason) { setLoginError(reason instanceof Error ? reason.message : 'Anmeldung fehlgeschlagen'); }
    finally { setSigningIn(false); }
  }
  function logout() { setSelected(null); setInspectResponseIds([]); void live.logout(); }
  function handleUnauthorized() { logout(); }
  function selectSource(source: Source, ids: string[] = []) { setInspectResponseIds(ids); setSelected(source); }
  function inspect(path: string, ids: string[]) {
    const source = sources.find(item => item.path === path);
    if (source) selectSource(source, ids);
  }
  function showOverview() {
    if (window.location.hash === '#overview') { setPage('overview'); headingRef.current?.focus(); }
    else window.location.hash = '#overview';
  }
  function connect() { if (!demo && live.authenticated) window.location.assign('/api/polar/authorize'); }

  const pageTitle = pageHeadings[page];
  const status = demo ? 'Beispielansicht' : !live.sessionReady ? 'Zugang wird geprüft' : live.authenticated ? live.dashboard?.connected ? 'Polar verbunden' : 'Polar nicht verbunden' : 'Nicht angemeldet';

  return <div className="app-shell">
    <a href="#main" className="skip-link">Zum Inhalt</a>
    <aside className="workspace-sidebar">
      <a className="brand" href="#overview" aria-label="Polar Health Analytics Übersicht"><span className="brand-mark"><Icon name="activity" /></span><span>polar<span className="brand-sub">Persönliches Archiv</span></span></a>
      <nav className="workspace-nav" aria-label="Arbeitsbereiche">{navItems.map(item => <a key={item.page} className="workspace-nav-link" href={item.href} aria-current={page === item.page ? 'page' : undefined}><Icon name={item.icon}/>{item.label}</a>)}</nav>
      <div className="workspace-sidebar-footer">{demo ? <a href="/">Zur privaten Ansicht</a> : <><strong>Polar Health Analytics</strong><p>Deine Daten bleiben in deinem privaten Archiv.</p><a href="/demo">Öffentliche Demo</a></>}</div>
    </aside>
    <div className="workspace-body">
      <header className="workspace-topbar">
        <div><strong>{status}</strong>{demo && <small className="mode-label">Synthetische Daten</small>}</div>
        <div className="topbar-actions">
          {!demo && live.authenticated && <><div className={`connection-state ${live.dashboard?.connected ? 'connected' : ''}`} aria-label="Verbindungsstatus"><span className="status-dot"/>{live.dashboard?.connected ? 'Verbunden' : 'Nicht verbunden'}</div>
          <button className="secondary" onClick={() => void live.sync()} disabled={busy || !live.authenticated || !live.dashboard?.connected}><Icon name="refresh"/>{busy ? 'Aktualisierung läuft …' : 'Aktualisieren'}</button></>}
          {demo && <a className="text-button" href="/">Privaten Zugang öffnen</a>}
          {!demo && live.authenticated && <details className="topbar-account"><summary>Konto</summary><div className="account-menu-content"><p>{live.dashboard?.connected ? 'Polar ist verbunden.' : 'Dein privater Zugang ist aktiv.'}</p>{live.dashboard?.connection_error && <p className="account-error" role="alert">{live.dashboard.connection_error}</p>}<button className="text-button" onClick={logout}>Abmelden</button>{!live.dashboard?.connected && <button className="secondary" onClick={connect}>Mit Polar verbinden</button>}</div></details>}
        </div>
      </header>
      <main className="workspace-content" id="main" tabIndex={-1}>
        <div className="view-heading"><div><h1 ref={headingRef} className="view-heading-title" tabIndex={-1}>{pageTitle}</h1><p>{pageDescriptions[page]}</p></div></div>
        {demo && <div className="demo-notice" role="status">Künstlich erzeugte Beispieldaten · Juli–September 2026</div>}
        {!demo && live.error && <p className="notice" role="alert">{live.error}</p>}
        {!demo && live.notice && <p className="sync-result" role="status">{live.notice}</p>}
        {!demo && !live.error && (!live.sessionReady || (live.authenticated && !live.dashboard)) && <ConnectionLoading stage={live.sessionReady ? 'dashboard' : 'session'} />}

        {page === 'overview' && !demo && live.sessionReady && !live.authenticated && <section className="welcome-panel" aria-labelledby="welcome-title"><p className="eyebrow">PRIVATER BESITZERZUGANG</p><h2 id="welcome-title">Privater Zugang</h2><p>Melde dich an, um deine Polar-Daten im privaten Archiv zu öffnen.</p><form className="login-form" onSubmit={signIn}><label htmlFor="owner-password">Besitzerpasswort</label><input id="owner-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/>{loginError && <p role="alert" className="notice">{loginError}</p>}<button className="primary" disabled={signingIn}>{signingIn ? 'Anmeldung läuft …' : 'Anmelden'}</button></form><a href="/demo">Öffentliche Demo ansehen</a></section>}

        {page !== 'overview' && !demo && !live.authenticated && live.sessionReady && <AccessPanel onOverview={showOverview}/>}

        {page === 'overview' && (demo || live.authenticated) && <>
          {!demo && live.authenticated && live.dashboard && !live.dashboard.connected && <section className="connection-panel"><h2>Polar verbinden</h2><p>Dein privater Zugang ist aktiv. Verbinde Polar, damit neue Daten in dein Archiv übernommen werden.</p><a className="primary" href="/api/polar/authorize">Mit Polar verbinden</a></section>}
          <Analytics authenticated={live.authenticated} demo={demo} revision={live.dashboard?.last_sync?.finished_at ?? undefined} view="overview" onInspect={inspect} onUnauthorized={handleUnauthorized}/>
          <div className="overview-actions"><a className="secondary" href="#nachtansicht">Schlaf ansehen <Icon name="arrow"/></a><a className="secondary" href="#analytics-history">Trends ansehen <Icon name="arrow"/></a><a className="secondary" href="#sources">Datenquellen ansehen <Icon name="arrow"/></a></div>
        </>}

        {page === 'sleep' && (demo || live.authenticated) && <PatternLive enabled={demo || live.authenticated} demo={demo} view="sleep" revision={live.dashboard?.last_sync?.finished_at ?? undefined} onUnauthorized={handleUnauthorized}/>}

        {page === 'trends' && (demo || live.authenticated) && <>
          <nav className="view-switch" aria-label="Trendansichten"><a href="#analytics-history" aria-current={trendMode === 'series' ? 'page' : undefined}>Messverläufe</a><a href="#pattern-explorer" aria-current={trendMode === 'patterns' ? 'page' : undefined}>Bewegung → nächste Nacht</a></nav>
          {trendMode === 'series' ? <Analytics authenticated={live.authenticated} demo={demo} revision={live.dashboard?.last_sync?.finished_at ?? undefined} view="trends" onInspect={inspect} onUnauthorized={handleUnauthorized}/> : <PatternLive enabled={demo || live.authenticated} demo={demo} view="patterns" revision={live.dashboard?.last_sync?.finished_at ?? undefined} onInspect={inspect} onUnauthorized={handleUnauthorized}/>}
        </>}

        {page === 'data' && (demo || live.authenticated) && <>
          {!demo && live.authenticated && <section className="account-panel"><h2>Konto</h2><p>{live.dashboard?.connected ? 'Deine private Polar-Verbindung ist aktiv.' : 'Dein privater Zugang ist aktiv.'}</p><button className="secondary" onClick={logout}>Abmelden</button></section>}
          {!demo && live.authenticated && live.dashboard && !live.dashboard.connected && <section className="connection-panel"><h2>Polar-Verbindung</h2><p>Verknüpfe dein Polar-Konto, um neue Originaldaten abzurufen.</p><a className="primary" href="/api/polar/authorize">Mit Polar verbinden</a></section>}
          <DataSources demo={demo} dashboard={live.dashboard} loading={live.running} onSelect={source => selectSource(source)}/>
        </>}
        <footer className="page-footer"><span>polar <span>Health Analytics</span></span><p>{demo ? 'Keine medizinische Bewertung.' : 'Deine Polar-Daten · Originalantworten bleiben nachvollziehbar.'}</p></footer>
      </main>
    </div>
    {selected && (demo || live.authenticated) && <Modal title={selected.name} onClose={() => setSelected(null)}>{demo ? <DemoDetails source={selected}/> : <LiveDetails source={selected} live={liveSource(selected)} authenticated={live.authenticated} initialResponseIds={inspectResponseIds}/>}</Modal>}
  </div>;
}
