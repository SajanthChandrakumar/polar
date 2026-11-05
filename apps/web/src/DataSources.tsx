import { useState } from 'react';
import { sources, sourceStatus, statusLabels, type Source } from './data';
import type { Dashboard } from './api';

export default function DataSources({ demo, dashboard, loading, onSelect }: {
  demo: boolean;
  dashboard: Dashboard | null;
  loading: boolean;
  onSelect: (source: Source) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const state = (source: Source) => demo ? sourceStatus(source, true, false) : dashboard?.sources.find(item => item.path === source.path)?.status ?? 'pending';
  const filtered = sources.filter(source => {
    const matchesText = `${source.name} ${source.path} ${source.features}`.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de'));
    const status = state(source);
    return matchesText && (filter === 'all' || filter === source.group || filter === status || (filter === 'issues' && ['failed', 'denied', 'skipped'].includes(status)));
  });
  const reviewed = dashboard?.sources.filter(source => !['pending', 'loading'].includes(source.status)).length ?? 0;
  const available = dashboard?.sources.filter(source => ['populated', 'empty'].includes(source.status)).length ?? 0;

  return <section className="sources-section" aria-labelledby="sources-heading">
    <div className="section-heading"><div><p className="eyebrow">HERKUNFT &amp; VERFÜGBARKEIT</p><h2 id="sources-heading">Datenquellen <span>{sources.length}</span></h2><p>Jeder dokumentierte Bereich. Jede Antwort nachvollziehbar.</p></div><div className="source-summary">{demo ? 'Lokale Beispielstruktur' : reviewed ? `${available} erfolgreich · ${reviewed} geprüft` : 'Noch keine Anfragen an Polar'}</div></div>
    {loading && <div className="loading-strip" role="status"><span className="loading-bar"/>Originalantworten werden abgerufen und archiviert …</div>}
    <div className="source-toolbar"><label className="search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Datenquellen durchsuchen" placeholder="Datenquelle oder Endpunkt suchen …" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="Datenquellen filtern" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Alle Bereiche</option><option value="Messungen">Messungen</option><option value="Konto & Planung">Konto &amp; Planung</option><option value="Kataloge">Kataloge</option><option value="empty">Erfolgreich leer</option><option value="issues">Mit Hinweis / Fehler</option></select></div>
    <div className="source-table-header"><span>DATENQUELLE</span><span>STATUS</span><span>LETZTE ANFRAGE</span><span>HTTP</span><span>EINTRÄGE</span><span/></div>
    {(['Messungen', 'Konto & Planung', 'Kataloge'] as const).map(group => {
      const rows = filtered.filter(source => source.group === group);
      return rows.length ? <div className="source-group" key={group}><h3>{group}<span>{rows.length}</span>{group === 'Kataloge' && <small>Referenzdaten, keine persönlichen Messungen</small>}</h3>{rows.map(source => {
        const status = state(source), actual = demo ? undefined : dashboard?.sources.find(item => item.path === source.path);
        return <article className="source-row" key={source.path}><div className="source-name"><strong>{source.name}</strong><code>{source.path}</code></div><div className="source-status"><span className={`badge ${status}`}><i/>{statusLabels[status]}</span></div><div className="source-time">{actual?.fetched_at ?? (demo ? 'Lokale Beispielstruktur' : '—')}</div><span className="source-http">{actual?.http_status ?? '—'}</span><span className="source-count">{actual?.count ?? '—'}</span><button className="source-detail" aria-label={`Details zu ${source.name}`} onClick={() => onSelect(source)}><span>Details ansehen</span><span aria-hidden="true">→</span></button></article>;
      })}</div> : null;
    })}
    {filtered.length === 0 && <div className="no-results"><h3>Keine passende Datenquelle</h3><p>Versuche einen anderen Suchbegriff oder Filter.</p><button className="secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Filter zurücksetzen</button></div>}
    <div className="table-footer">{filtered.length} von {sources.length} Datenquellen<span>Einträge = Top-Level-Datensätze · Samples in den Details</span></div>
  </section>;
}
