import { useState, type KeyboardEvent } from 'react';
import './patterns.css';
import { PATTERN_ACTIVITY_SOURCE, PATTERN_ANS_SOURCE, PATTERN_SLEEP_SOURCE, type PatternAnalysis, type PatternOutcome, type PatternPair, type PatternQuartiles } from './patterns';

type Props = {
  data: PatternAnalysis | null;
  days: number;
  outcome: PatternOutcome;
  onDaysChange: (days: number) => void;
  onOutcomeChange: (outcome: PatternOutcome) => void;
  onInspect?: (path: string, responseIds: string[]) => void;
  demo: boolean;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  accessRequired?: boolean;
};

const dateFormatter = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const numberFormatter = (maximumFractionDigits: number) => new Intl.NumberFormat('de-CH', { maximumFractionDigits });
function dateLabel(date: string) { return dateFormatter.format(new Date(`${date}T12:00:00Z`)); }
function formatSteps(value: number) { return numberFormatter(0).format(value); }
function formatOutcome(value: number, outcome: PatternOutcome) {
  if (outcome === 'sleep') return `${numberFormatter(0).format(value)} min`;
  const rounded = Math.round(value * 10) / 10;
  return `${new Intl.NumberFormat('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Object.is(rounded, -0) ? 0 : rounded)} ANS`;
}
function formatDifference(value: number, outcome: PatternOutcome) {
  const rounded = outcome === 'sleep' ? Math.round(value) : Math.round(value * 10) / 10;
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return `${new Intl.NumberFormat('de-CH', { maximumFractionDigits: outcome === 'sleep' ? 0 : 1, signDisplay: 'exceptZero' }).format(safe)} ${outcome === 'sleep' ? 'min' : 'ANS'}`;
}
function pairKey(pair: PatternPair) { return `${pair.activity_date}/${pair.outcome_date}`; }
function groupSummary(group: PatternQuartiles, outcome: PatternOutcome) {
  if (group.median === null || group.q1 === null || group.q3 === null) return null;
  return { median: formatOutcome(group.median, outcome), spread: `Q1 ${formatOutcome(group.q1, outcome)} · Q3 ${formatOutcome(group.q3, outcome)}` };
}

function ScatterPlot({ data, outcome, selectedKey, onSelect }: { data: PatternAnalysis; outcome: PatternOutcome; selectedKey: string; onSelect: (pair: PatternPair) => void }) {
  const width = 720, height = 360, left = 66, right = 28, top = 24, bottom = 56;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const xValues = data.pairs.map(pair => pair.steps).concat(data.threshold === null ? [] : [data.threshold]);
  const yValues = data.pairs.map(pair => pair.value);
  const rawXMin = xValues.length ? Math.min(...xValues) : 0, rawXMax = xValues.length ? Math.max(...xValues) : 1;
  const xPadding = rawXMin === rawXMax ? Math.max(Math.abs(rawXMin) * .08, 1) : (rawXMax - rawXMin) * .08;
  const xMin = rawXMin - xPadding, xMax = rawXMax + xPadding;
  const rawYMin = yValues.length ? Math.min(...yValues) : 0, rawYMax = yValues.length ? Math.max(...yValues) : 1;
  const yPadding = rawYMin === rawYMax ? Math.max(Math.abs(rawYMin) * .1, 1) : (rawYMax - rawYMin) * .1;
  const yMin = rawYMin - yPadding, yMax = rawYMax + yPadding;
  const x = (value: number) => left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const y = (value: number) => top + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
  const yTicks = [yMin, yMin + (yMax - yMin) / 2, yMax];
  const outcomePath = outcome === 'sleep' ? PATTERN_SLEEP_SOURCE : PATTERN_ANS_SOURCE;

  return <section className="pattern-chart-card" aria-label="Bewegung und nächste Nacht">
    <div className="pattern-chart-heading"><div><h3>Jeder Punkt steht für zwei Tage</h3><p>Bewegung am Tag · Ergebnis in der folgenden Nacht</p></div><span className="pattern-chart-key"><i className="pattern-key-lower" />Weniger Bewegung <i className="pattern-key-upper" />Mehr Bewegung</span></div>
    {data.pairs.length === 0 ? <p className="pattern-chart-empty" role="status">Für diesen Zeitraum gibt es keine vollständigen Tagspaare.</p> : <svg className="pattern-scatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="pattern-chart-title pattern-chart-desc">
      <title id="pattern-chart-title">Bewegung und nächste Nacht</title>
      <desc id="pattern-chart-desc">Die waagerechte Achse zeigt Schritte am Vortag. Die senkrechte Achse zeigt {outcome === 'sleep' ? 'Schlafdauer' : 'ANS-Status'} in der folgenden Nacht. Jeder Punkt kann ausgewählt werden.</desc>
      {yTicks.map((tick, index) => <g key={index} className="pattern-grid-line"><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text x={left - 10} y={y(tick) + 4} textAnchor="end">{formatOutcome(tick, outcome).replace(/ (min|ANS)$/, '')}</text></g>)}
      <line className="pattern-axis" x1={left} x2={left} y1={top} y2={height - bottom} />
      <line className="pattern-axis" x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} />
      {data.threshold !== null && <g className="pattern-threshold"><line x1={x(data.threshold)} x2={x(data.threshold)} y1={top} y2={height - bottom} /><text x={Math.min(x(data.threshold) + 7, width - right - 104)} y={top + 14}>Median-Grenze</text></g>}
      <text className="pattern-axis-label" x={left + plotWidth / 2} y={height - 12} textAnchor="middle">Schritte am Vortag</text>
      <text className="pattern-axis-label" x="18" y={top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 18 ${top + plotHeight / 2})`}>{outcome === 'sleep' ? 'Schlafdauer (min)' : 'ANS-Status'}</text>
      {data.pairs.map(pair => {
        const key = pairKey(pair), isSelected = selectedKey === key;
        const label = `${dateLabel(pair.outcome_date)} · ${formatSteps(pair.steps)} Schritte am ${dateLabel(pair.activity_date)} · ${formatOutcome(pair.value, outcome)} · ${pair.group === 'lower' ? 'weniger' : 'mehr'} Bewegung`;
        return <g key={key} className={`pattern-point ${pair.group} ${isSelected ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={label} aria-pressed={isSelected} onClick={() => onSelect(pair)} onPointerUp={() => onSelect(pair)} onKeyDown={(event: KeyboardEvent<SVGGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(pair); } }}>
          <circle className="pattern-point-hit" cx={x(pair.steps)} cy={y(pair.value)} r="15" />
          <circle className="pattern-point-dot" cx={x(pair.steps)} cy={y(pair.value)} r="7" />
        </g>;
      })}
    </svg>}
    <div className="pattern-chart-foot"><span>Mehr Schritte bedeuten mindestens den Medianwert.</span>{data.threshold !== null && <strong>Schritte-Grenze · {formatSteps(data.threshold)}</strong>}</div>
  </section>;
}

function GroupCard({ label, group, outcome, tone, summariesAvailable }: { label: string; group: PatternQuartiles; outcome: PatternOutcome; tone: 'lower' | 'upper'; summariesAvailable: boolean }) {
  const summary = summariesAvailable ? groupSummary(group, outcome) : null;
  return <article className={`pattern-group-card ${tone}`} aria-label={label}>
    <div className="pattern-group-heading"><h3>{label}</h3><span>{group.count} Nächte</span></div>
    {summary ? <div className="pattern-group-summary"><p>Median</p><strong>{summary.median}</strong><small>{summary.spread}</small></div> : <p className="pattern-group-wait">Mindestens 7 gültige Nächte pro Gruppe sind nötig, bevor eine Zusammenfassung erscheint.</p>}
  </article>;
}

function SelectedPair({ pair, outcome, demo, onInspect }: { pair: PatternPair; outcome: PatternOutcome; demo: boolean; onInspect?: Props['onInspect'] }) {
  const activityIds = pair.activity_response_ids, outcomeIds = pair.outcome_response_ids;
  return <article className="pattern-selected" aria-labelledby="pattern-selected-title">
    <div><p className="eyebrow">PUNKTAUSWAHL</p><h3 id="pattern-selected-title">Ausgewählter Punkt</h3></div>
    <dl className="pattern-selected-values">
      <div><dt>Bewegung am Vortag</dt><dd>{formatSteps(pair.steps)} Schritte</dd><time dateTime={pair.activity_date}>{dateLabel(pair.activity_date)}</time></div>
      <div><dt>{outcome === 'sleep' ? 'Schlafdauer' : 'ANS-Status'} in der Nacht danach</dt><dd>{formatOutcome(pair.value, outcome)}</dd><time dateTime={pair.outcome_date}>{dateLabel(pair.outcome_date)}</time></div>
    </dl>
    {!demo && onInspect && (activityIds.length > 0 || outcomeIds.length > 0) && <div className="pattern-source-actions">
      {activityIds.length > 0 && <button className="secondary" onClick={() => onInspect(PATTERN_ACTIVITY_SOURCE, activityIds)}>Aktivitätsquelle ansehen</button>}
      {outcomeIds.length > 0 && <button className="secondary" onClick={() => onInspect(outcome === 'sleep' ? PATTERN_SLEEP_SOURCE : PATTERN_ANS_SOURCE, outcomeIds)}>Ergebnisquelle ansehen</button>}
    </div>}
    {demo && <small className="pattern-synthetic-note">Synthetische Beispielwerte ohne persönliche Quellen.</small>}
  </article>;
}

export default function PatternExplorer({ data, days, outcome, onDaysChange, onOutcomeChange, onInspect, demo, loading = false, error = '', onRetry, accessRequired = false }: Props) {
  const [selectedKey, setSelectedKey] = useState('');
  const selected = data?.pairs.find(pair => pairKey(pair) === selectedKey);
  const canSummarize = data?.status === 'available' && data.groups.lower.count >= data.minimum_group_size && data.groups.upper.count >= data.minimum_group_size && data.groups.lower.median !== null && data.groups.upper.median !== null;
  const difference = canSummarize ? data.groups.upper.median! - data.groups.lower.median! : null;

  return <section className="pattern-explorer" id="pattern-explorer" aria-labelledby="pattern-heading">
    <div className="pattern-heading-row"><div className="pattern-heading-copy"><p className="eyebrow">RECOVERY LAB</p><h2 id="pattern-heading">Wie hängt Bewegung mit der nächsten Nacht zusammen?</h2><p>Vergleiche deine Schritte an einem Tag mit Schlafdauer oder ANS-Status in der folgenden Nacht.</p></div>{demo && <span className="pattern-demo-label">Beispielanalyse · synthetische Daten</span>}</div>
    <div className="pattern-toolbar">
      <label>Zeitraum<select aria-label="Zeitraum" value={days} onChange={event => onDaysChange(Number(event.target.value))}><option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option></select></label>
      <label>Ergebnis<select aria-label="Ergebnis" value={outcome} onChange={event => onOutcomeChange(event.target.value as PatternOutcome)}><option value="sleep">Schlafdauer</option><option value="ans">ANS-Status</option></select></label>
    </div>
    {error && <div className="pattern-error" role="alert"><p>{error}</p>{onRetry && !accessRequired && <button className="secondary" onClick={onRetry}>Erneut laden</button>}</div>}
    {accessRequired && <p className="pattern-state" role="status">Melde dich an, um deine privaten Bewegungsmuster zu sehen.</p>}
    {loading && <p className="pattern-state" role="status">Archivierte Tagspaare werden geladen …</p>}
    {data && <>
      <p className="pattern-period">Ergebnisnächte {dateLabel(data.from)}–{dateLabel(data.to)} · Bewegung {dateLabel(data.activity_from)}–{dateLabel(data.activity_to)} · Europe/Zurich</p>
      <div className="pattern-groups"><GroupCard label="Weniger Bewegung" group={data.groups.lower} outcome={outcome} tone="lower" summariesAvailable={canSummarize} /><GroupCard label="Mehr Bewegung" group={data.groups.upper} outcome={outcome} tone="upper" summariesAvailable={canSummarize} /></div>
      {difference !== null && <p className="pattern-difference">Beobachteter Medianunterschied (mehr minus weniger Bewegung): <strong>{formatDifference(difference, outcome)}</strong></p>}
      {data.status === 'insufficient' && <p className="pattern-insufficient" role="status">Mindestens 7 gültige Nächte pro Gruppe sind nötig, bevor ein Unterschied beschrieben wird. Punkte und Gruppengrößen bleiben sichtbar.</p>}
      <ScatterPlot data={data} outcome={outcome} selectedKey={selectedKey} onSelect={pair => setSelectedKey(pairKey(pair))} />
      {selected && <SelectedPair pair={selected} outcome={outcome} demo={demo} onInspect={onInspect} />}
      <p className="pattern-exclusions">Ausgeschlossen: {data.exclusions.activity_unavailable} Tage ohne Bewegungswert · {data.exclusions.activity_provisional} vorläufige Bewegungstage · {data.exclusions.outcome_unavailable} Nächte ohne Ergebnis.</p>
    </>}
    {!data && !loading && !accessRequired && !error && <p className="pattern-state" role="status">Für diese Auswahl sind noch keine archivierten Tagspaare verfügbar.</p>}
    <details className="pattern-method">
      <summary>So ist der Vergleich zu lesen</summary>
      <p>Verglichen werden abgeschlossene archivierte Bewegungstage mit dem Ergebnis der jeweils folgenden Nacht. Ein abgeschlossener Archivtag belegt keine Tragezeit und keine vollständige Sensorabdeckung. Die Gruppen beschreiben Beobachtungen aus deinem Archiv; sie zeigen keine Ursache und sind keine Vorhersage.</p>
      {data && <p>{data.threshold === null ? 'Für diesen Zeitraum ist keine Schritt-Grenze verfügbar; es wird keine Grenzlinie eingezeichnet.' : 'Die Grenzlinie ist der Median der verfügbaren Bewegungstage.'} Die mittleren 50&nbsp;% (Q1 bis Q3) zeigen die beobachtete Streuung, kein Konfidenzintervall. {data.exclusions.activity_unavailable + data.exclusions.activity_provisional + data.exclusions.outcome_unavailable} Tagpaare wurden wegen fehlender oder vorläufiger Werte ausgeschlossen.</p>}
    </details>
  </section>;
}
