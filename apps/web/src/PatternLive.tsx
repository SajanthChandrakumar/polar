import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import PatternExplorer from './PatternExplorer';
import NightExplorer, { type Night } from './NightExplorer';
import type { PatternAnalysis, PatternOutcome } from './patterns';
import patternFixtures from './pattern-demo.json';
import nightFixtures from './night-demo.json';

type Props = {
  enabled: boolean;
  revision?: string;
  view?: 'patterns' | 'sleep' | 'all';
  demo?: boolean;
  onInspect?: (path: string, responseIds: string[]) => void;
  onUnauthorized?: () => void;
};
type ViewState = { key: string; data: PatternAnalysis | null; loading: boolean; error: string; accessRequired: boolean };
type NightViewState = { key: string; nights: Night[] | null; loading: boolean; error: string; accessRequired: boolean };
type FixtureKey = '30_sleep' | '30_ans' | '90_sleep' | '90_ans';
const demoPatterns = patternFixtures as Record<FixtureKey, PatternAnalysis>;
const demoNights = nightFixtures as Night[];

export default function PatternLive({ enabled, revision = '', view = 'all', demo = false, onInspect, onUnauthorized }: Props) {
  const [days, setDays] = useState(90), [outcome, setOutcome] = useState<PatternOutcome>('sleep'), [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewState>({ key: '', data: null, loading: false, error: '', accessRequired: false });
  const [nightOpen, setNightOpen] = useState(false), [nightRetry, setNightRetry] = useState(0);
  const [nightState, setNightState] = useState<NightViewState>({ key: '', nights: null, loading: false, error: '', accessRequired: false });
  const sequence = useRef(0), nightSequence = useRef(0), unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const showPatterns = view !== 'sleep';
  const showNights = view !== 'patterns';
  const patternKey = `${demo ? 'demo' : enabled ? 'private' : 'closed'}:${view}:${revision}:${days}:${outcome}:${retry}`;
  const current = demo
    ? { key: patternKey, data: demoPatterns[`${days}_${outcome}` as FixtureKey], loading: false, error: '', accessRequired: false }
    : state.key === patternKey ? state : { key: patternKey, data: null, loading: enabled && showPatterns, error: '', accessRequired: !enabled };
  const nightKey = `${demo ? 'demo' : enabled ? 'private' : 'closed'}:${view}:${revision}:${nightOpen}:${nightRetry}`;
  const currentNight = demo
    ? { key: nightKey, nights: demoNights, loading: false, error: '', accessRequired: false }
    : nightState.key === nightKey ? nightState : { key: nightKey, nights: null, loading: enabled && showNights && (view === 'sleep' || nightOpen), error: '', accessRequired: !enabled };
  const privateNightActive = enabled && showNights && (view === 'sleep' || nightOpen);

  useEffect(() => {
    const id = ++sequence.current;
    if (demo || !enabled || !showPatterns) {
      setState({ key: patternKey, data: null, loading: false, error: '', accessRequired: !demo && !enabled });
      return;
    }
    const controller = new AbortController();
    setState({ key: patternKey, data: null, loading: true, error: '', accessRequired: false });
    void request<PatternAnalysis>(`/api/patterns?days=${days}&outcome=${outcome}`, controller.signal)
      .then(data => { if (!controller.signal.aborted && id === sequence.current) setState({ key: patternKey, data, loading: false, error: '', accessRequired: false }); })
      .catch(reason => {
        if (controller.signal.aborted || id !== sequence.current) return;
        const unauthorized = reason instanceof ApiError && reason.status === 401;
        const message = unauthorized ? 'Sitzung abgelaufen. Bitte melde dich erneut an.' : reason instanceof Error ? reason.message : 'Bewegungsmuster konnten nicht geladen werden.';
        setState({ key: patternKey, data: null, loading: false, error: message, accessRequired: unauthorized });
        if (unauthorized) unauthorizedRef.current?.();
      });
    return () => controller.abort();
  }, [demo, enabled, showPatterns, patternKey, days, outcome, revision, retry]);

  useEffect(() => {
    const id = ++nightSequence.current;
    if (demo || !privateNightActive) {
      setNightState({ key: nightKey, nights: null, loading: false, error: '', accessRequired: !demo && !enabled });
      return;
    }
    const controller = new AbortController();
    setNightState({ key: nightKey, nights: null, loading: true, error: '', accessRequired: false });
    void request<{ nights: Night[] }>('/api/nights', controller.signal)
      .then(result => {
        if (!controller.signal.aborted && id === nightSequence.current) setNightState({ key: nightKey, nights: result.nights, loading: false, error: '', accessRequired: false });
      })
      .catch(reason => {
        if (controller.signal.aborted || id !== nightSequence.current) return;
        const unauthorized = reason instanceof ApiError && reason.status === 401;
        const message = unauthorized ? 'Sitzung abgelaufen. Bitte melde dich erneut an.' : reason instanceof Error ? reason.message : 'Nächte konnten nicht geladen werden.';
        setNightState({ key: nightKey, nights: null, loading: false, error: message, accessRequired: unauthorized });
        if (unauthorized) unauthorizedRef.current?.();
      });
    return () => controller.abort();
  }, [demo, enabled, privateNightActive, nightKey, revision, nightOpen, nightRetry]);

  return <>
    {showPatterns && <PatternExplorer data={current.data} days={days} outcome={outcome} onDaysChange={setDays} onOutcomeChange={setOutcome} onInspect={onInspect} demo={demo} embedded={view === 'patterns'} loading={current.loading} error={current.error} accessRequired={current.accessRequired} onRetry={() => setRetry(value => value + 1)} />}
    {showNights && <NightExplorer
      nights={currentNight.nights ?? []}
      open={demo ? view === 'sleep' || view === 'all' : privateNightActive}
      demo={demo}
      embedded={view === 'sleep'}
      loading={currentNight.loading}
      error={currentNight.error}
      accessRequired={currentNight.accessRequired}
      onOpen={() => setNightOpen(true)}
      onClose={view === 'all' ? () => setNightOpen(false) : undefined}
      onRetry={() => setNightRetry(value => value + 1)}
    />}
  </>;
}
