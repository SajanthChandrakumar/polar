import { useEffect, useRef, useState } from 'react';
import type { Status } from './data';
export type LiveSource = {path:string; status:Status; http_status:number|null; count:number|null; fetched_at:string|null; message?:string; response_id?:string; response_ids?:string[]};
export type Run = {run_id:string; status:string; results?:LiveSource[]; started_at?:string; finished_at?:string; from_date?:string; to_date?:string; from?:string; to?:string};
export type Dashboard = {connected:boolean; connection_error?:string; last_sync:Run|null; sources:LiveSource[]};
export type StoredResponse = {path:string; params:Record<string,unknown>; http_status:number; content_type:string; fetched_at:string; sha256:string; size:number; payload:unknown; binary:boolean; raw_text?:string|null; payload_unavailable_reason?:string|null};
export class ApiError extends Error { constructor(message:string, public status:number, public body:Record<string,unknown>) {super(message);} }
export async function request<T>(path:string, signal?:AbortSignal, body?:unknown):Promise<T> {
  const response = await fetch(path,{credentials:'same-origin',signal,...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  if (response.status===204) return undefined as T;
  let data: Record<string,unknown>;
  try {data = await response.json();} catch {
    throw new ApiError(`Anfrage fehlgeschlagen (HTTP ${response.status})`,response.status,{});
  }
  if (!response.ok) throw new ApiError(typeof data.detail==='string' ? data.detail : `Anfrage fehlgeschlagen (HTTP ${response.status})`,response.status,data);
  return data as T;
}
export function useLiveDashboard(demo:boolean) {
  const [authenticated,setAuthenticated]=useState(false), [sessionReady,setSessionReady]=useState(false);
  const [dashboard,setDashboard]=useState<Dashboard|null>(null), [error,setError]=useState(''), [notice,setNotice]=useState(''), [running,setRunning]=useState(false);
  const control=useRef<{sync:(automatic:boolean)=>Promise<void>}|null>(null);
  const syncBusy=useRef(false);
  useEffect(()=>{
    if(demo)return;
    const abort=new AbortController();
    void request<{authenticated:boolean}>('/api/session',abort.signal).then(session=>{if(!abort.signal.aborted){setAuthenticated(session.authenticated);setSessionReady(true);}}).catch(reason=>{if(!abort.signal.aborted){setSessionReady(true);setError(reason instanceof Error?reason.message:'Sitzung konnte nicht geprüft werden');}});
    return()=>abort.abort();
  },[demo]);
  useEffect(()=>{
    const abort=new AbortController(); let poll:ReturnType<typeof setTimeout>|undefined; let stopped=false;
    setRunning(false); syncBusy.current=false; setNotice('');
    if(demo || !authenticated || !sessionReady) {control.current=null;if(!authenticated)setDashboard(null);return ()=>abort.abort();}
    setError('');
    const signal=abort.signal;
    function fail(reason:unknown) {if(stopped || signal.aborted)return; if(reason instanceof ApiError && reason.status===401){setAuthenticated(false);setDashboard(null);} setError(reason instanceof Error ? reason.message : 'Anfrage fehlgeschlagen');setRunning(false);syncBusy.current=false;}
    async function load() {const data=await request<Dashboard>('/api/dashboard',signal);if(!stopped)setDashboard(data);return data;}
    async function watch(id:string) {
      if(stopped)return;
      try {const run=await request<Run>(`/api/sync/${encodeURIComponent(id)}`,signal);if(stopped)return;
        if(run.results)setDashboard(previous=>previous ? {...previous,sources:run.results!,last_sync:run}:previous);
        if(run.status==='running')poll=setTimeout(()=>void watch(id),2000);
        else {setRunning(false);syncBusy.current=false;setNotice(run.status==='completed'?'Datenabruf abgeschlossen. Jeder Bereich zeigt sein tatsächliches Ergebnis.':`Datenabruf ${run.status==='interrupted'?'unterbrochen':'fehlgeschlagen'}.`);await load();}
      }catch(reason){fail(reason);}
    }
    async function sync(automatic:boolean) {
      if(stopped || syncBusy.current)return;
      syncBusy.current=true;setRunning(true);setError('');setNotice('');
      try {const run=await request<Run>('/api/sync',signal,{automatic});if(stopped)return;
        if(run.status==='running')poll=setTimeout(()=>void watch(run.run_id),2000);
        else {syncBusy.current=false;setRunning(false);await load();}
      }catch(reason) {
        if(stopped || signal.aborted)return;
        if(reason instanceof ApiError && reason.status===409){
          const id=reason.body.run_id;
          if(typeof id==='string') {poll=setTimeout(()=>void watch(id),2000);setNotice('Ein Datenabruf läuft bereits.');return;}
          const data=await load().catch(()=>null);
          if(data?.last_sync?.status==='running'){poll=setTimeout(()=>void watch(data.last_sync!.run_id),2000);return;}
        }
        if(reason instanceof ApiError && reason.status===429){setNotice(reason.message);setRunning(false);syncBusy.current=false;}else fail(reason);
      }
    }
    control.current={sync};
    void (async()=>{try {
      const data=await load();if(stopped)return;
      if(data.last_sync?.status==='running'){syncBusy.current=true;setRunning(true);poll=setTimeout(()=>void watch(data.last_sync!.run_id),2000);}
      else if(data.connected)await sync(true);
    }catch(reason){if(!stopped)setSessionReady(true);fail(reason);}})();
    return ()=>{stopped=true;abort.abort();if(poll)clearTimeout(poll);control.current=null;syncBusy.current=false;};
  },[demo,authenticated,sessionReady]);
  async function login(password:string) {await request('/api/login',undefined,{password});setAuthenticated(true);setError('');}
  async function logout() {try{await request('/api/logout',undefined,{});setAuthenticated(false);setDashboard(null);setError('');}catch(reason){if(reason instanceof ApiError && reason.status===401){setAuthenticated(false);setDashboard(null);setError('');}else setError(reason instanceof Error?reason.message:'Abmeldung fehlgeschlagen');}}
  return {authenticated,sessionReady,dashboard,error,notice,running,login,logout,sync:()=>control.current?.sync(false)};
}
