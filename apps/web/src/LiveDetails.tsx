import { useEffect, useState } from 'react';
import { request, type LiveSource, type StoredResponse } from './api';
import { statusLabels, type Source } from './data';
import PayloadTable from './PayloadTable';
export default function LiveDetails({source,live,authenticated,initialResponseIds}:{source:Source;live?:LiveSource;authenticated:boolean;initialResponseIds?:string[]}) {
  const ids=[...new Set([...(initialResponseIds??[]),...(live?.response_ids ?? (live?.response_id ? [live.response_id] : []))])];
  const [chosen,setChosen]=useState(ids[0]??''),[response,setResponse]=useState<StoredResponse|null>(null),[error,setError]=useState('');
  const idsKey=ids.join('\0');
  useEffect(()=>{setChosen(current=>ids.includes(current)?current:ids[0]??'');},[idsKey]);
  useEffect(()=>{const abort=new AbortController();setResponse(null);setError('');if(chosen && authenticated)void request<StoredResponse>(`/api/responses/${encodeURIComponent(chosen)}`,abort.signal).then(value=>{if(!abort.signal.aborted)setResponse(value);}).catch(reason=>{if(!abort.signal.aborted)setError(reason.message);});return()=>abort.abort();},[chosen,authenticated]);
  return <>
    <p className="notice">{authenticated ? 'Messwerte stammen aus gespeicherten Originalantworten.' : 'Melde dich an, um private Originalantworten zu prüfen.'}</p>
    <dl className="detail-grid source-status"><div><dt>Status</dt><dd>{statusLabels[live?.status ?? 'pending']}</dd></div></dl>
    {live?.message && <p className="notice">{live.message}</p>}
    {live?.status === 'empty' && <p className="notice">Erfolgreiche Antwort ohne Einträge. Daraus folgt keine Aussage zur Geräteunterstützung.</p>}
    <details className="live-source-details">
      <summary>Quellendetails</summary>
      <code className="endpoint-path">{source.path}</code>
      <dl className="detail-grid">
        <div><dt>HTTP-Status</dt><dd>{live?.http_status ?? '—'}</dd></div>
        <div><dt>Letzte Anfrage</dt><dd>{live?.fetched_at ?? 'Keine'}</dd></div>
        <div><dt>Datensätze</dt><dd>{live?.count ?? '—'}</dd></div>
      </dl>
      <div className="detail-block"><h3>Dokumentierte Detailauswahl</h3><p>{source.features}</p><small>{source.limit}</small></div>
    </details>
    {ids.length > 0 ? <details className="live-original-data">
      <summary>Originaldaten ansehen</summary>
      <label className="response-select">Gespeicherte Antwort<select aria-label="Gespeicherte Antwort" value={chosen} onChange={event => setChosen(event.target.value)}>{ids.map((id, index) => <option value={id} key={id}>Antwort {index + 1} von {ids.length} · {id}</option>)}</select></label>
      {response && <>
        <dl className="detail-grid">
          <div><dt>Angefragter Pfad</dt><dd>{response.path}</dd></div>
          <div><dt>Anfrageparameter / Features</dt><dd><pre>{JSON.stringify(response.params, null, 2)}</pre></dd></div>
          <div><dt>Content-Type</dt><dd>{response.content_type}</dd></div>
          <div><dt>Größe</dt><dd>{response.size} Bytes</dd></div>
          <div><dt>Anfragezeit</dt><dd>{response.fetched_at}</dd></div>
          <div><dt>HTTP-Status der Antwort</dt><dd>{response.http_status}</dd></div>
          <div className="hash-field"><dt>SHA-256</dt><dd>{response.sha256}</dd></div>
        </dl>
        {!response.binary && <PayloadTable key={chosen} payload={response.payload} />}
        <div className="detail-block"><h3>{response.binary ? 'Binärantwort · archivierte Metadaten' : 'Originalantwort'}</h3>
          {response.payload_unavailable_reason && <p className="notice">{response.payload_unavailable_reason}</p>}
          {response.binary ? <p>Binärkörper unverändert im Archiv gespeichert. Diese Ansicht zeigt Dateityp, Größe und Hash.</p> : <pre tabIndex={0} aria-label="Antwortinhalt">{response.raw_text ?? JSON.stringify(response.payload, null, 2)}</pre>}
        </div>
      </>}
    </details> : <p className="notice">Noch keine gespeicherte Antwort vorhanden.</p>}
    {error && <p className="notice" role="alert">{error}</p>}
    {chosen && authenticated && !response && !error && <p role="status" className="notice">Originalantwort wird geladen …</p>}
  </>;
}
