import { useEffect, useRef, useState } from 'react';
import { ApiError, request } from './api';
import PatternExplorer from './PatternExplorer';
import NightExplorer, { type Night } from './NightExplorer';
import type { PatternAnalysis, PatternOutcome } from './patterns';

type Props = { enabled: boolean; revision?: string; onInspect?: (path: string, responseIds: string[]) => void; onUnauthorized?: () => void };
type ViewState = { key: string; data: PatternAnalysis | null; loading: boolean; error: string; accessRequired: boolean };
type NightViewState = { key: string; nights: Night[] | null; loading: boolean; error: string; accessRequired: boolean };

export default function PatternLive({ enabled, revision = '', onInspect, onUnauthorized }: Props) {
  const [days, setDays] = useState(90), [outcome, setOutcome] = useState<PatternOutcome>('sleep'), [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewState>({ key: '', data: null, loading: false, error: '', accessRequired: false });
  const [nightOpen, setNightOpen] = useState(false), [nightRetry, setNightRetry] = useState(0);
  const [nightState, setNightState] = useState<NightViewState>({ key: '', nights: null, loading: false, error: '', accessRequired: false });
  const sequence = useRef(0), nightSequence = useRef(0), unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;
  const key = `${enabled ? 'private' : 'closed'}:${revision}:${days}:${outcome}:${retry}`;
  const current = state.key === key ? state : { key, data: null, loading: enabled, error: '', accessRequired: !enabled };
  const nightKey = `${enabled ? 'private' : 'closed'}:${revision}:${nightOpen}:${nightRetry}`;
  const currentNight = nightState.key === nightKey ? nightState : { key: nightKey, nights: null, loading: enabled && nightOpen, error: '', accessRequired: !enabled };

  useEffect(() => {
    const id = ++sequence.current;
    if (!enabled) {
      setState({ key, data: null, loading: false, error: '', accessRequired: true });
      return;
    }
    const controller = new AbortController();
    setState({ key, data: null, loading: true, error: '', accessRequired: false });
    void request<PatternAnalysis>(`/api/patterns?days=${days}&outcome=${outcome}`, controller.signal)
      .then(data => { if (!controller.signal.aborted && id === sequence.current) setState({ key, data, loading: false, error: '', accessRequired: false }); })
      .catch(reason => {
        if (controller.signal.aborted || id !== sequence.current) return;
        const unauthorized = reason instanceof ApiError && reason.status === 401;
        const message = unauthorized ? 'Sitzung abgelaufen. Bitte melde dich erneut an.' : reason instanceof Error ? reason.message : 'Bewegungsmuster konnten nicht geladen werden.';
        setState({ key, data: null, loading: false, error: message, accessRequired: unauthorized });
        if (unauthorized) unauthorizedRef.current?.();
      });
    return () => controller.abort();
  }, [enabled, revision, days, outcome, retry]);

  useEffect(() => {
    const id = ++nightSequence.current;
    if (!enabled || !nightOpen) {
      setNightState({ key: nightKey, nights: null, loading: false, error: '', accessRequired: !enabled });
      if (!enabled) setNightOpen(false);
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
  }, [enabled, revision, nightOpen, nightRetry]);

  return <>
    <PatternExplorer data={current.data} days={days} outcome={outcome} onDaysChange={setDays} onOutcomeChange={setOutcome} onInspect={onInspect} demo={false} loading={current.loading} error={current.error} accessRequired={current.accessRequired} onRetry={() => setRetry(value => value + 1)} />
    <NightExplorer
      nights={currentNight.nights ?? []}
      open={enabled && nightOpen}
      loading={currentNight.loading}
      error={currentNight.error}
      accessRequired={currentNight.accessRequired}
      onOpen={() => setNightOpen(true)}
      onClose={() => setNightOpen(false)}
      onRetry={() => setNightRetry(value => value + 1)}
    />
  </>;
}
