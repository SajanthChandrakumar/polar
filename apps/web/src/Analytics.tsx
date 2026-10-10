import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { request } from './api';
import './analytics.css';

export type AnalyticsPoint = { date: string; value: number | null; provisional: boolean; response_ids: string[]; sample_count?: number };
export type DailyFeedback = { date: string; status: 'comparison' | 'insufficient' | 'provisional' | 'missing'; value: number | null; baseline: number | null; delta: number | null; comparison_days: number; required_days: number; from: string; to: string; text: string };
export type AnalyticsSeries = { key: string; label: string; unit: string; kind: 'line' | 'bar'; source_path: string; points: AnalyticsPoint[]; coverage: { valid_days: number; total_days: number }; feedback: DailyFeedback[] };
export type DailyRecovery = { date: string; value: number | null; reason: 'available' | 'missing' | 'invalid'; source_path: '/nightly-recharge-results'; response_ids: string[] };
export type AnalyticsData = { days: number; from: string; to: string; timezone: string; series: AnalyticsSeries[]; daily_recovery?: DailyRecovery[] };

const chartSpecs = [
  { key: 'moon', fallback: 'Schlafdauer' },
  { key: 'heart', fallback: 'Herzfrequenz' },
  { key: 'recharge', fallback: 'ANS-Status' },
  { key: 'activity', fallback: 'Schritte' },
  { key: 'training', fallback: 'Trainingsdauer' },
];
const ranges = [7, 30, 90] as const;
const numberFormat = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });
const recoveryLevels = ['Sehr schwach', 'Schwach', 'Beeinträchtigt', 'Okay', 'Gut', 'Sehr gut'];
const recoveryRatings: Record<number, { face: string; label: string; sentence: string }> = {
  1: { face: '🙁', label: 'Schwächer erholt', sentence: 'Deine Messungen zeigen eine schwächere Erholung über Nacht.' },
  2: { face: '🙁', label: 'Schwächer erholt', sentence: 'Deine Messungen zeigen eine schwächere Erholung über Nacht.' },
  3: { face: '🙁', label: 'Schwächer erholt', sentence: 'Deine Messungen zeigen eine schwächere Erholung über Nacht.' },
  4: { face: '😐', label: 'Erholung okay', sentence: 'Deine Erholung über Nacht liegt laut Polar im mittleren Bereich.' },
  5: { face: '🙂', label: 'Gut erholt', sentence: 'Deine Messungen zeigen eine gute Erholung über Nacht.' },
  6: { face: '🙂', label: 'Gut erholt', sentence: 'Deine Messungen zeigen eine gute Erholung über Nacht.' },
};

function seriesFor(data: AnalyticsData, key: string) { return data.series.find(series => series.key === key); }
function displayDate(date: string) {
  const [year, month, day] = date.slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : date;
}
function calendarDays(data: AnalyticsData) {
  const end = new Date(`${data.to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return [...new Set(data.series.flatMap(series => series.points.map(point => point.date)))].sort();
  return Array.from({ length: data.days }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - data.days + index + 1);
    return day.toISOString().slice(0, 10);
  });
}
function dateOptions(data: AnalyticsData) { return calendarDays(data).reverse(); }
function measurement(series: AnalyticsSeries | undefined, date: string) {
  return series?.points.find(point => point.date === date);
}
function factText(key: string, point: AnalyticsPoint | undefined, unit: string) {
  if (typeof point?.value !== 'number' || !Number.isFinite(point.value)) return 'Keine Messung';
  if (key === 'moon') {
    const minutes = Math.round(point.value);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  }
  if (key === 'activity') return `${integerFormat.format(point.value)} ${unit}`;
  if (key === 'training') return `${numberFormat.format(point.value)} ${unit}`;
  return `${numberFormat.format(point.value)} ${unit}`;
}

function valueDomain(values: number[], includeZero: boolean) {
  if (!values.length) return { min: 0, max: 1 };
  let min = Math.min(...values), max = Math.max(...values);
  if (includeZero) { min = Math.min(0, min); max = Math.max(0, max); }
  if (min === max) {
    const padding = min === 0 ? 1 : Math.abs(min) * .1;
    min -= padding;
    max += padding;
  } else if (!includeZero) {
    const padding = (max - min) * .08;
    min -= padding;
    max += padding;
  }
  return { min, max };
}

function Chart({ series, dates, selectedDate, onSelect, onInspect }: { series: AnalyticsSeries; dates: string[]; selectedDate: string | undefined; onSelect: (date: string) => void; onInspect?: (path: string, responseIds: string[]) => void }) {
  const width = 400, height = 230, left = 48, right = 384, top = 18, bottom = 180;
  const values = series.points.flatMap(point => typeof point.value === 'number' && Number.isFinite(point.value) ? [point.value] : []);
  const { min, max } = valueDomain(values, series.kind === 'bar' || series.key === 'recharge');
  const x = (date: string) => left + (Math.max(0, dates.indexOf(date)) / Math.max(1, dates.length - 1)) * (right - left);
  const y = (value: number) => bottom - ((value - min) / Math.max(Number.EPSILON, max - min)) * (bottom - top);
  const pointByDate = new Map(series.points.map(point => [point.date, point]));
  const plotted = dates.flatMap((date, index) => {
    const point = pointByDate.get(date);
    return point && typeof point.value === 'number' && Number.isFinite(point.value) ? [{ ...point, index }] : [];
  });
  const segments: string[] = [];
  if (series.kind === 'line') {
    let current = '';
    dates.forEach((date, index) => {
      const point = pointByDate.get(date);
      if (!point || typeof point.value !== 'number' || !Number.isFinite(point.value)) {
        if (current) segments.push(current);
        current = '';
      } else {
        current += `${current ? ' L' : 'M'} ${x(date)} ${y(point.value)}`;
      }
    });
    if (current) segments.push(current);
  }
  const zeroY = y(0);
  const ticks = Array.from({ length: 4 }, (_, index) => min + (max - min) * index / 3);
  const step = Math.max(1, Math.ceil(dates.length / 6));
  const tickIndexes = [...new Set([0, ...Array.from({ length: Math.ceil(dates.length / step) }, (_, i) => i * step).filter(i => i < dates.length), dates.length - 1])];
  const active = selectedDate ? plotted.find(point => point.date === selectedDate) : plotted[plotted.length - 1];
  const zeroAxis = series.kind === 'bar' || series.key === 'recharge';
  function choose(point: AnalyticsPoint) { onSelect(point.date); }
  function keyChoose(event: React.KeyboardEvent<SVGElement>, point: AnalyticsPoint) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(point); }
  }
  return <article className="analytics-chart" aria-label={series.label} role="region">
    <div className="analytics-chart-heading"><div><h3>{series.label}</h3><span>{series.coverage.valid_days} / {series.coverage.total_days} Tage mit Messwert</span></div><label className="analytics-chart-date">Tag<select aria-label={`Tageswert ${series.label}`} value={selectedDate ?? dates.at(-1) ?? ''} onChange={event => onSelect(event.target.value)}>{dates.map(date => <option key={date} value={date}>{displayDate(date)}</option>)}</select></label></div>
    <div className="analytics-chart-frame">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${series.label}; y-Achse enthält Nulllinie: ${zeroAxis ? 'ja' : 'nein'}`}>
        {ticks.map((tick, index) => <g key={index}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="analytics-gridline"/><text x={left - 9} y={y(tick) + 4} textAnchor="end" className="analytics-axis-label">{numberFormat.format(tick)}</text></g>)}
        {zeroAxis && <line x1={left} x2={right} y1={zeroY} y2={zeroY} className="analytics-zero-line"/>}
        {series.kind === 'line' ? segments.map((path, index) => <path key={index} d={path} className="analytics-line"/>) : plotted.map(point => {
          const slot = (right - left) / Math.max(1, dates.length);
          const barWidth = Math.max(2, Math.min(15, slot * .64));
          const valueY = y(point.value!);
          const baseline = zeroAxis ? zeroY : bottom;
          const barHeight = Math.max(1, Math.abs(baseline - valueY));
          const barY = point.value! >= 0 ? baseline - barHeight : baseline;
          return <rect key={point.date} x={x(point.date) - barWidth / 2} y={barY} width={barWidth} height={barHeight} rx="2" className={`analytics-bar ${active?.date === point.date ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`${series.label} ${displayDate(point.date)}: ${numberFormat.format(point.value!)} ${series.unit}${point.provisional ? ', vorläufig' : ''}`} onClick={() => choose(point)} onKeyDown={event => keyChoose(event, point)}><title>{`${displayDate(point.date)} · ${numberFormat.format(point.value!)} ${series.unit}`}</title></rect>;
        })}
        {tickIndexes.map(index => <g key={index}><line x1={x(dates[index])} x2={x(dates[index])} y1={bottom} y2={bottom + 5} className="analytics-tick"/><text x={x(dates[index])} y={bottom + 22} textAnchor={index === 0 ? 'start' : index === dates.length - 1 ? 'end' : 'middle'} className="analytics-axis-label">{displayDate(dates[index]).slice(0, 5)}</text></g>)}
        {series.kind === 'line' && plotted.map(point => <circle key={point.date} cx={x(point.date)} cy={y(point.value!)} r={active?.date === point.date ? 6 : 4.5} className={`analytics-point ${point.provisional ? 'provisional' : ''} ${active?.date === point.date ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`${series.label} ${displayDate(point.date)}: ${numberFormat.format(point.value!)} ${series.unit}${point.provisional ? ', vorläufig' : ''}`} onClick={() => choose(point)} onKeyDown={event => keyChoose(event, point)}><title>{`${displayDate(point.date)} · ${numberFormat.format(point.value!)} ${series.unit}${point.provisional ? ' · vorläufig' : ''}`}</title></circle>)}
      </svg>
    </div>
    <p className="analytics-unit">Einheit: {series.unit}</p>
    {active ? <div className="analytics-point-detail" aria-live="polite">
      <strong>{displayDate(active.date)} · {numberFormat.format(active.value!)} {series.unit}</strong>{active.provisional && <span className="analytics-provisional">Vorläufiger Messwert</span>}
      <details className="analytics-provenance"><summary>Messdetails ansehen</summary><dl><div><dt>Quelle</dt><dd><code>{series.source_path}</code></dd></div><div><dt>Archivantworten</dt><dd>{active.response_ids.length ? active.response_ids.map(id => <code key={id}>{id}</code>) : 'Keine Antwort-ID gespeichert'}</dd></div>{active.sample_count !== undefined && <div><dt>Samples</dt><dd>{active.sample_count}</dd></div>}</dl>
        {onInspect && active.response_ids.length > 0 && <button className="secondary analytics-original" onClick={() => onInspect(series.source_path, active.response_ids)}>Originalantwort ansehen</button>}
      </details>
    </div> : <p className="analytics-empty-point">Für {selectedDate ? displayDate(selectedDate) : 'diesen Zeitraum'} gibt es keine verwertbaren Messwerte.</p>}
  </article>;
}

function DaySummary({ data, date, onDateChange, authenticated, demo, loading, error, onInspect }: { data: AnalyticsData | null; date: string; onDateChange: (date: string) => void; authenticated: boolean; demo: boolean; loading: boolean; error: string; onInspect?: (path: string, responseIds: string[]) => void }) {
  const dates = data ? dateOptions(data) : [];
  const reading = data?.daily_recovery?.find(item => item.date === date);
  const validValue = reading?.reason === 'available' && Number.isInteger(reading.value) && reading.value !== null && reading.value >= 1 && reading.value <= 6 ? reading.value : null;
  const rating = validValue === null ? undefined : recoveryRatings[validValue];
  const factSpecs = [
    { key: 'moon', label: 'Schlaf', unit: 'min' },
    { key: 'heart', label: 'Herzfrequenz', unit: 'bpm' },
    { key: 'activity', label: 'Schritte', unit: 'Schritte' },
    { key: 'training', label: 'Training', unit: 'min' },
  ];
  return <section className="day-summary" aria-label="Dein Tag">
    <div className="day-summary-heading"><div><p className="eyebrow">DEIN TAG</p><h2>Dein Tag</h2><p>Deine Erholung und die Messwerte des ausgewählten Tages.</p></div>
      {data && <label className="analytics-range">Tag auswählen<select aria-label="Tag auswählen" value={date} onChange={event => onDateChange(event.target.value)}>{dates.map(item => <option value={item} key={item}>{displayDate(item)}</option>)}</select></label>}
      <a className="secondary day-history-link" href="#analytics-history">Verlauf ansehen</a>
    </div>
    {!authenticated || demo ? <p className="analytics-note" role="status">{demo ? 'In der Beispielansicht gibt es keine persönlichen Tageswerte.' : 'Melde dich an, um deinen persönlichen Tagesüberblick zu sehen.'}</p> : loading && !data ? <p className="analytics-state" role="status">Deine Tageswerte werden geladen …</p> : error && !data ? <p className="analytics-note" role="alert">Dein Tagesüberblick ist gerade nicht verfügbar.</p> : data && date ? <>
      <div className="recovery-summary">
        <span className="recovery-face" aria-hidden="true">{rating?.face ?? '○'}</span>
        <div><strong>{rating?.label ?? 'Noch keine Erholungsbewertung verfügbar.'}</strong><p>{rating?.sentence ?? 'Für diesen Tag liegt kein gültiger Polar-Erholungsstatus vor.'}</p></div>
        <details className="recovery-explanation"><summary>Warum diese Rückmeldung?</summary><div>
          {rating && validValue !== null && <p>Polar-Stufe {validValue} von 6: {recoveryLevels[validValue - 1]}.</p>}
          <p>Polar ordnet die Rückmeldung in sechs Stufen ein:</p>
          <ol>{recoveryLevels.map((label, index) => <li key={label}>{index + 1} · {label}</li>)}</ol>
          <dl><div><dt>Rohwert</dt><dd>{reading?.reason === 'invalid' ? 'Ungültige Stufe – siehe Originaldaten' : reading?.value ?? 'Kein Wert gespeichert'}</dd></div><div><dt>Quelle</dt><dd><code>{reading?.source_path ?? '/nightly-recharge-results'}</code></dd></div></dl>
          {reading?.reason === 'invalid' && <p>Der gespeicherte Wert entspricht keiner Polar-Stufe von 1 bis 6.</p>}
          {onInspect && reading?.response_ids.length ? <button className="secondary analytics-original" onClick={() => onInspect(reading.source_path, reading.response_ids)}>Originalantwort ansehen</button> : !reading?.response_ids.length && <p>Für diesen Tag ist keine Originalantwort verknüpft.</p>}
        </div></details>
      </div>
      <div className="day-facts">{factSpecs.map(spec => {
        const series = seriesFor(data, spec.key);
        const point = measurement(series, date);
        const feedback = series?.feedback.find(item => item.date === date);
        const hasValue = typeof point?.value === 'number' && Number.isFinite(point.value);
        const note = point?.provisional ? 'Vorläufiger Messwert' : hasValue ? feedback?.text : 'Für diesen Tag wurde kein Wert gespeichert.';
        return <article className="day-fact" key={spec.key}>
          <h3>{series?.label ?? spec.label}</h3><strong>{factText(spec.key, point, series?.unit ?? spec.unit)}</strong>
          {point?.provisional && <span className="analytics-provisional">Vorläufig</span>}
          {note && <p>{note}</p>}
        </article>;
      })}</div>
    </> : <p className="analytics-state" role="status">Wähle einen Tag, um die gespeicherten Werte zu sehen.</p>}
  </section>;
}

export default function Analytics({ authenticated, demo, revision, onInspect, children }: { authenticated: boolean; demo: boolean; revision?: string; onInspect?: (path: string, responseIds: string[]) => void; children?: ReactNode }) {
  const [days, setDays] = useState<number>(30);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedDates, setSelectedDates] = useState<Record<string, string>>({});
  const [day, setDay] = useState('');

  useEffect(() => {
    if (!authenticated || demo) { setData(null); setError(''); setLoading(false); setSelectedDates({}); setDay(''); return; }
    const abort = new AbortController();
    setData(null); setError(''); setLoading(true); setSelectedDates({});
    void request<AnalyticsData>(`/api/analytics?days=${days}`, abort.signal)
      .then(value => { if (!abort.signal.aborted) { setData(value); setDay(value.to.slice(0, 10)); setSelectedDates(Object.fromEntries(value.series.map(series => [series.key, value.to.slice(0, 10)]))); } })
      .catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Analysen konnten nicht geladen werden'); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [authenticated, demo, days, revision, retry]);

  const dates = useMemo(() => data ? calendarDays(data) : [], [data]);
  const charts = data ? chartSpecs.map(spec => ({ spec, series: seriesFor(data, spec.key) })) : [];

  return <section className="analytics-section" aria-label="Tagesübersicht und Verlauf" aria-busy={loading}>
    <DaySummary data={data} date={day} onDateChange={setDay} authenticated={authenticated} demo={demo} loading={loading} error={error} onInspect={onInspect}/>
    {children}
    <section className="analytics-history" id="analytics-history" aria-labelledby="analytics-title">
      <div className="analytics-heading"><div><p className="eyebrow">DEIN VERLAUF</p><h2 id="analytics-title">Dein Verlauf</h2><p>Fünf Messreihen aus deinem gespeicherten Archiv.</p></div><label className="analytics-range">Zeitraum<select aria-label="Zeitraum" value={days} onChange={event => setDays(Number(event.target.value))}>{ranges.map(range => <option value={range} key={range}>{range} Tage</option>)}</select></label></div>
      {demo && <p className="analytics-note">Verlaufsdiagramme zeigen nur Messungen aus dem privaten Archiv. In der Beispieldarstellung werden keine Messwerte ergänzt.</p>}
      {!authenticated && !demo && <p className="analytics-note">Melde dich an, um archivierte Messverläufe zu sehen.</p>}
      {loading && <p className="analytics-state" role="status">Archivierte Messungen werden geladen …</p>}
      {error && <div className="analytics-error" role="alert"><span>{error}</span><button className="secondary" onClick={() => setRetry(value => value + 1)}>Aktualisieren</button></div>}
      {data && !loading && <>
        <p className="analytics-period">{data.from}–{data.to} · {data.timezone}</p>
        {!data.series.some(series => series.points.some(point => typeof point.value === 'number' && Number.isFinite(point.value))) && <p className="analytics-state">Für diesen Zeitraum liegen keine verwertbaren archivierten Messwerte vor.</p>}
        <div className="analytics-charts">{charts.map(({ spec, series }) => series ? <Chart key={series.key} series={series} dates={dates} selectedDate={selectedDates[series.key]} onSelect={date => setSelectedDates(current => ({ ...current, [series.key]: date }))} onInspect={onInspect}/> : <article className="analytics-chart" role="region" aria-label={spec.fallback} key={spec.fallback}><div className="analytics-chart-heading"><h3>{spec.fallback}</h3></div><p className="analytics-empty-point">Für diesen Zeitraum liegt keine archivierte Reihe vor.</p></article>)}</div>
        <details className="analytics-comparison-details"><summary>Details zum Tagesvergleich</summary><div className="analytics-feedback-heading"><div><p className="eyebrow">TÄGLICHER VERGLEICH</p><h2>Vergleich mit deinem Verlauf</h2><p>Median und Datenbasis für {displayDate(day || data.to)}.</p></div></div>
          <div className="analytics-feedback-grid">{charts.map(({ spec, series }) => {
            const feedback = series?.feedback.find(item => item.date === day);
            const title = series?.label ?? spec.fallback;
            const required = Math.max(7, feedback?.required_days ?? 7);
            return <article className="analytics-feedback" key={series?.key ?? spec.fallback} aria-label={`${title} Tagesfeedback`}><h3>{title}</h3>{feedback ? <><p className="analytics-feedback-date">{displayDate(feedback.date)}</p><p className="analytics-feedback-text">{feedback.text || 'Für dieses Datum liegt kein erklärender Text vor.'}</p><p className="analytics-baseline">Für einen Vergleich sind mindestens {required} gültige Tage nötig; aktuell sind es {feedback.comparison_days}.</p>{feedback.from && feedback.to && <p className="analytics-comparison">Vergleichszeitraum: {feedback.from}–{feedback.to}</p>}{feedback.status === 'provisional' && <span className="analytics-provisional">Vorläufig</span>}</> : <p className="analytics-feedback-text">Für dieses Datum liegt kein Tagesfeedback vor.</p>}</article>;
          })}</div>
        </details>
      </>}
    </section>
  </section>;
}
