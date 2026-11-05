import { useEffect, useRef, useState, type ReactNode } from 'react';
import './night-explorer.css';

export type NightPhase = { start: string; end: string; stage: 'awake' | 'light' | 'deep' | 'rem' | 'unknown' };
export type Night = {
  date: string;
  start: string | null;
  end: string | null;
  sleep_minutes: number | null;
  sleep_score: number | null;
  steps_previous_day: number | null;
  ans: number | null;
  hrv_ms: number | null;
  phases: NightPhase[];
  pulse: Array<{ time: string; bpm: number }>;
};
type Props = {
  nights: Night[];
  demo?: boolean;
  embedded?: boolean;
  open?: boolean;
  loading?: boolean;
  error?: string;
  accessRequired?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onRetry?: () => void;
};
type WindowRange = { start: number; end: number };

const dates = new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
const clock = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const formatNumber = (maximumFractionDigits = 0) => new Intl.NumberFormat('de-CH', { maximumFractionDigits });
const labels: Record<NightPhase['stage'], string> = { awake: 'Wach', light: 'Leicht', deep: 'Tief', rem: 'REM', unknown: 'Unbekannt' };
const stages: NightPhase['stage'][] = ['awake', 'rem', 'light', 'deep', 'unknown'];

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function formatDate(value: string) { return dates.format(new Date(`${value}T12:00:00Z`)); }
function formatTime(value: number | null) { return value === null ? '—' : clock.format(value); }
function formatSleep(minutes: number | null) { return minutes === null ? 'Nicht verfügbar' : `${formatNumber(1).format(minutes / 60)} h`; }
function formatSteps(steps: number | null) { return steps === null ? 'Nicht verfügbar' : `${formatNumber().format(steps)} Schritte`; }
function stageName(stage: string): string { return labels[stage as NightPhase['stage']] ?? labels.unknown; }

function windowFor(night: Night): WindowRange | null {
  const start = timestamp(night.start), end = timestamp(night.end);
  const phases = night.phases.map(phase => [timestamp(phase.start), timestamp(phase.end)] as const).filter(([from, to]) => from !== null && to !== null && to > from);
  const phaseStart = phases.length ? Math.min(...phases.map(([from]) => from!)) : null;
  const phaseEnd = phases.length ? Math.max(...phases.map(([, to]) => to!)) : null;
  if (start !== null && end !== null && end > start) return { start, end };
  if (start !== null && end === null && phaseEnd !== null && phaseEnd > start) return { start, end: phaseEnd };
  if (start === null && end !== null && phaseStart !== null && end > phaseStart) return { start: phaseStart, end };
  if (start === null && end === null && phaseStart !== null && phaseEnd !== null && phaseEnd > phaseStart) return { start: phaseStart, end: phaseEnd };
  if (start !== null && end !== null && phaseStart !== null && phaseEnd !== null && phaseEnd > phaseStart) return { start: phaseStart, end: phaseEnd };
  return null;
}
function boundaryReadout(start: number | null, end: number | null) {
  if (start !== null && end !== null && end > start) return `Schlafzeit ${formatTime(start)} bis ${formatTime(end)}`;
  if (start !== null && end === null) return `Schlafbeginn ${formatTime(start)} · Schlafende nicht archiviert`;
  if (start === null && end !== null) return `Schlafende ${formatTime(end)} · Schlafbeginn nicht archiviert`;
  return 'Schlafgrenzen nicht verfügbar';
}
function boundaryNote(start: number | null, end: number | null) {
  if (start !== null && end === null) return `Schlafbeginn ${formatTime(start)} archiviert; Schlafende nicht archiviert.`;
  if (start === null && end !== null) return `Schlafende ${formatTime(end)} archiviert; Schlafbeginn nicht archiviert.`;
  if (start === null && end === null) return 'Schlafgrenzen nicht archiviert.';
  return 'Die gespeicherten Schlafgrenzen bilden keinen gültigen Zeitraum.';
}
function validPhases(night: Night) {
  return night.phases.map(phase => ({ ...phase, from: timestamp(phase.start), to: timestamp(phase.end) }))
    .filter((phase): phase is NightPhase & { from: number; to: number } => phase.from !== null && phase.to !== null && phase.to > phase.from)
    .sort((left, right) => left.from - right.from);
}
function gapsFor(phases: ReturnType<typeof validPhases>, range: WindowRange) {
  const gaps: WindowRange[] = [];
  let cursor = range.start;
  for (const phase of phases) {
    const start = Math.max(range.start, phase.from), end = Math.min(range.end, phase.to);
    if (end <= start) continue;
    if (start > cursor) gaps.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < range.end) gaps.push({ start: cursor, end: range.end });
  return gaps;
}
function position(value: number, range: WindowRange) { return Math.max(0, Math.min(100, (value - range.start) / (range.end - range.start) * 100)); }
function percentStyle(range: WindowRange, segment: WindowRange) {
  const left = position(segment.start, range), right = position(segment.end, range);
  return { left: `${left}%`, width: `${Math.max(0, right - left)}%` };
}
function formatDuration(start: number, end: number) { return `${formatTime(start)}–${formatTime(end)}`; }

function PhaseTimeline({ night }: { night: Night }) {
  const range = windowFor(night);
  const phases = validPhases(night);
  const gaps = range ? gapsFor(phases, range) : [];
  const gapDescription = gaps.map(gap => formatDuration(gap.start, gap.end)).join(', ');
  const start = timestamp(night.start), end = timestamp(night.end);
  const completeBounds = start !== null && end !== null && end > start;
  const headerRange = completeBounds ? `${formatTime(start)}–${formatTime(end)} Uhr`
    : start !== null && end === null && range ? `${formatTime(start)}–${formatTime(range.end)} Uhr`
    : start === null && end !== null && range ? `${formatTime(range.start)}–${formatTime(end)} Uhr`
    : 'Zeitraum der verfügbaren Phasendaten';

  if (!range) return <section className="night-timeline-card" aria-label="Schlafphasen"><h3>Schlafphasen</h3><p className="night-empty-note">{boundaryNote(start, end)}</p><p className="night-empty-note">Keine Phasendaten gespeichert; eine Zeitachse lässt sich nicht darstellen.</p></section>;

  return <section className="night-timeline-card" aria-label="Schlafphasen">
    <div className="night-card-heading"><div><h3>Schlafphasen</h3><p>{headerRange}</p></div>
      {!completeBounds && <span className="night-data-note">{start !== null && end === null ? 'Schlafende nicht archiviert' : start === null && end !== null ? 'Schlafbeginn nicht archiviert' : 'Schlafgrenzen nicht verfügbar'}</span>}
    </div>
    <div className="night-stage-legend" aria-label="Farben der Schlafphasen">{stages.map(stage => <span key={stage}><i className={`night-stage-color ${stage}`} aria-hidden="true" />{labels[stage]}</span>)}</div>
    <div className="night-timeline" role="group" aria-label="Phasenverlauf nach Uhrzeit">
      <div className="night-stage-lanes">
        {stages.map(stage => <div key={stage} className="night-stage-lane" role="group" aria-label={labels[stage]}>
          <span className="night-stage-label">{labels[stage]}</span>
          <div className="night-timeline-track">
            {gaps.map((gap, index) => <span className="night-timeline-gap" aria-hidden="true" key={`gap-${index}`} style={percentStyle(range, gap)} />)}
            {phases.filter(phase => phase.stage === stage).map((phase, index) => {
              if (position(phase.to, range) <= position(phase.from, range)) return null;
              return <span key={`${phase.start}-${index}`} className={`night-timeline-phase ${stage}`} title={`${labels[stage]} · ${formatDuration(phase.from, phase.to)}`} style={percentStyle(range, { start: phase.from, end: phase.to })} />;
            })}
          </div>
        </div>)}
      </div>
      <div className="night-timeline-ticks" aria-hidden="true"><time>{formatTime(range.start)}</time><time>{formatTime(range.start + (range.end - range.start) / 2)}</time><time>{formatTime(range.end)}</time></div>
      {gaps.length > 0 && <p className="night-gap-note">Keine Phasendaten für {gapDescription}. Die Lücke bleibt offen.</p>}
    </div>
    {!completeBounds && <p className="night-empty-note">{start !== null && end === null ? 'Schlafende nicht archiviert; das Ende der Zeitachse markiert den letzten gespeicherten Phasenwert.' : start === null && end !== null ? 'Schlafbeginn nicht archiviert; der Anfang der Zeitachse markiert den ersten gespeicherten Phasenwert.' : 'Schlafgrenzen nicht verfügbar; gezeigt wird nur der Zeitraum der archivierten Phasen.'}</p>}
    {phases.length > 0 && <details className="night-detail-list" key={night.date}>
      <summary>Schlafphasen als Liste</summary>
      <ol className="night-phase-list" aria-label="Schlafphasen mit Uhrzeiten">
        {phases.map((phase, index) => <li key={`${phase.start}-${index}`}><i className={`night-stage-color ${phase.stage}`} aria-hidden="true" /><span>{stageName(phase.stage)}</span><time dateTime={phase.start}>{formatTime(phase.from)}</time><span aria-hidden="true">–</span><time dateTime={phase.end}>{formatTime(phase.to)}</time></li>)}
      </ol>
    </details>}
  </section>;
}

function PulseTimeline({ night, range }: { night: Night; range: WindowRange | null }) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(700);
  useEffect(() => {
    const node = plotRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setPlotWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [night]);
  const allPoints = night.pulse.map(point => ({ ...point, at: timestamp(point.time) }))
    .filter((point): point is { time: string; bpm: number; at: number } => point.at !== null && Number.isFinite(point.bpm));
  if (!allPoints.length) return null;
  const firstPoint = Math.min(...allPoints.map(point => point.at)), lastPoint = Math.max(...allPoints.map(point => point.at));
  const start = range?.start ?? timestamp(night.start) ?? firstPoint;
  const end = range?.end ?? timestamp(night.end) ?? lastPoint;
  const pointRange = end > start ? { start, end } : { start: firstPoint, end: lastPoint };
  const safeRange = pointRange.end > pointRange.start ? pointRange : { start: pointRange.start - 150_000, end: pointRange.end + 150_000 };
  const points = allPoints.filter(point => point.at >= safeRange.start && point.at <= safeRange.end);
  if (!points.length) return null;
  const values = points.map(point => point.bpm), low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .2, 2), min = low - padding, max = high + padding;
  const y = (bpm: number) => 130 - (bpm - min) / (max - min) * 120;
  const dotRadius = Math.min(3, plotWidth * 300_000 / (safeRange.end - safeRange.start) * .32);
  return <section className="night-pulse-card" aria-label="Pulswerte">
    <div className="night-card-heading"><div><h3>Pulsmittel je 5 Minuten</h3><p>Archivierte 5-Minuten-Mittelwerte · Lücken entsprechen fehlenden Zeitabschnitten.</p></div></div>
    <div className="night-pulse-plot">
      <div className="night-pulse-y-axis" aria-hidden="true"><span style={{ top: `${y(high)}px` }}>{formatNumber().format(high)} bpm</span><span style={{ top: `${y(low)}px` }}>{formatNumber().format(low)} bpm</span></div>
      <div ref={plotRef} className="night-pulse-canvas"><svg viewBox={`0 0 ${plotWidth} 140`} role="img" aria-label={`Pulsmittel je 5 Minuten, ${formatNumber().format(low)} bis ${formatNumber().format(high)} bpm; fehlende Zeitabschnitte bleiben offen`}>
        <line className="night-pulse-grid" x1="0" x2={plotWidth} y1={y(high)} y2={y(high)} />
        <line className="night-pulse-grid" x1="0" x2={plotWidth} y1={y(low)} y2={y(low)} />
        {points.map((point, index) => <circle key={`${point.time}-${index}`} cx={position(point.at, safeRange) / 100 * plotWidth} cy={y(point.bpm)} r={dotRadius} aria-hidden="true" />)}
      </svg></div>
    </div>
    <div className="night-timeline-ticks"><span /><time>{formatTime(safeRange.start)}</time><time>{formatTime(safeRange.start + (safeRange.end - safeRange.start) / 2)}</time><time>{formatTime(safeRange.end)}</time></div>
    <details className="night-detail-list" key={night.date}>
      <summary>Pulswerte als Liste</summary>
      <ul className="night-pulse-list" aria-label="Gespeicherte Pulswerte">{points.map((point, index) => <li key={`${point.time}-${index}`}><time dateTime={point.time}>{formatTime(point.at)}</time><span>{formatNumber().format(point.bpm)} bpm</span></li>)}</ul>
    </details>
  </section>;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div className="night-metric"><dt>{label}</dt><dd>{children}</dd></div>;
}

export default function NightExplorer({ nights, demo = false, embedded = false, open, loading = false, error = '', accessRequired = false, onOpen, onClose, onRetry }: Props) {
  const isOpen = open ?? demo;
  const [selectedDate, setSelectedDate] = useState('');
  const selected = nights.find(night => night.date === selectedDate) ?? nights[0] ?? null;
  const range = selected ? windowFor(selected) : null;
  const start = selected ? timestamp(selected.start) : null, end = selected ? timestamp(selected.end) : null;
  const phases = selected ? validPhases(selected) : [];
  const gapCount = selected && range ? gapsFor(phases, range).length : 0;
  const gapLabel = gapCount === 1 ? '1 Phasenlücke' : `${gapCount} Phasenlücken`;

  return <section className={`night-explorer${embedded ? ' night-explorer-embedded' : ''}`} id="nachtansicht" aria-label={embedded ? 'Nachtverlauf' : undefined} aria-labelledby={embedded ? undefined : 'night-heading'}>
    {!embedded && <div className="night-explorer-heading"><div><p className="night-eyebrow">NIGHT EXPLORER</p><h2 id="night-heading">Dein Nachtverlauf</h2><p>Sieh dir Schlafphasen und archivierte Messwerte einzelner Nächte an.</p></div>{demo && <span className="night-demo-badge">Beispielansicht</span>}</div>}
    {demo && !embedded && <p className="night-synthetic-note"><strong>Nur synthetische Beispielwerte.</strong> Diese Nächte sind künstlich erzeugt und enthalten keine persönlichen Polar-Daten.</p>}
    {!demo && !isOpen && <div className="night-private-prompt">
      {accessRequired ? <p role="status">Melde dich an, um deine privaten Nachtverläufe zu sehen.</p> : <button className="night-open-button" type="button" onClick={onOpen}>Nachtverlauf anzeigen</button>}
    </div>}
    {!demo && isOpen && onClose && <div className="night-private-actions"><button type="button" className="night-close-button" onClick={onClose}>Nachtverlauf schließen</button></div>}
    {!demo && isOpen && error && <div className="night-error" role="alert"><p>{error}</p>{onRetry && !accessRequired && <button type="button" onClick={onRetry}>Erneut laden</button>}</div>}
    {!demo && isOpen && loading && <p className="night-state" role="status">Nächte aus deinem Archiv werden geladen …</p>}
    {demo && !embedded && <p className="night-period">4 Beispielnächte · 27.–30. September 2026</p>}
    {isOpen && selected && <>
      <div className="night-controls"><label htmlFor="night-picker">Nacht auswählen</label><select id="night-picker" value={selected.date} onChange={event => setSelectedDate(event.target.value)}>
        {nights.map(night => <option key={night.date} value={night.date}>{formatDate(night.date)} · {formatSleep(night.sleep_minutes)}</option>)}
      </select></div>
      <p className="night-selected-readout" aria-live="polite">Ausgewählt: {formatDate(selected.date)} · {boundaryReadout(start, end)}{gapCount > 0 ? ` · ${gapLabel}` : ''}.</p>
      <dl className="night-metrics">
        <Metric label="Schlafdauer">{formatSleep(selected.sleep_minutes)}</Metric>
        <Metric label="Schlafscore">{selected.sleep_score === null ? 'Nicht verfügbar' : formatNumber().format(selected.sleep_score)}</Metric>
        <Metric label="Schritte am Vortag">{formatSteps(selected.steps_previous_day)}</Metric>
        <Metric label="ANS-Status in dieser Nacht">{selected.ans === null ? 'Nicht verfügbar' : `${formatNumber(1).format(selected.ans)} ANS`}</Metric>
        <Metric label="HRV · Polar Nightly Recharge">{selected.hrv_ms === null ? 'Nicht verfügbar' : `${formatNumber().format(selected.hrv_ms)} ms`}</Metric>
      </dl>
      <PhaseTimeline key={selected.date} night={selected} />
      <PulseTimeline key={`pulse-${selected.date}`} night={selected} range={range} />
    </>}
    {isOpen && !selected && !loading && !error && <p className="night-state" role="status">Für die letzten 90 Tage liegen keine archivierten Nächte vor.</p>}
    {demo && <p className="night-method">Die Zeitleiste zeigt nur gespeicherte Grenzen und Phasen. Fehlende Messungen bleiben als Lücken sichtbar; Pulsmittelwerte werden nicht verbunden oder ergänzt.</p>}
  </section>;
}
