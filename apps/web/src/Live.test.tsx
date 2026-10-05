import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import LiveDetails from './LiveDetails';
import { sources } from './data';
const source = {path:'/ppi-samples',status:'empty',http_status:200,count:0,fetched_at:'2026-10-05T12:00:00+02:00',message:'Keine Einträge',response_ids:['list','detail']};
function backend(authenticated = true, connected = false) {
  const requests: {url:string, init?:RequestInit}[] = []; let loggedIn = authenticated;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({url,init}); let body: unknown;
    if (url === '/api/session') body = {authenticated:loggedIn};
    else if (url === '/api/login') {loggedIn=true; body={authenticated:true};}
    else if (url === '/api/logout') {loggedIn=false; return new Response(null,{status:204});}
    else if (url === '/api/dashboard') body={connected,last_sync:null,sources:[source]};
    else if (url === '/api/sync') body={run_id:'run-1',status:'running'};
    else if (url === '/api/sync/run-1') body={run_id:'run-1',status:'completed',results:[source]};
    else if (url.startsWith('/api/responses/')) body={path:'/ppi-samples',params:{fromDate:'2026-10-01',features:'samples'},http_status:200,content_type:'application/json',fetched_at:source.fetched_at,sha256:'actual-hash',size:2,binary:false,payload:[]};
    else throw new Error(`Unexpected URL ${url}`);
    return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  }); vi.stubGlobal('fetch',fetcher); return {requests,fetcher};
}
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
describe('private live dashboard', () => {
  it('keeps health endpoints private, logs in via password, and clears live data on logout', async () => {
    const {requests} = backend(false); render(<App/>);
    await waitFor(() => expect(requests.length).toBe(1)); expect(requests[0].url).toBe('/api/session');
    fireEvent.click(screen.getByRole('button',{name:'Anmelden'})); const dialog=screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Besitzerpasswort')).toHaveAttribute('type','password');
    fireEvent.change(within(dialog).getByLabelText('Besitzerpasswort'),{target:{value:'test-only'}});
    fireEvent.click(within(dialog).getByRole('button',{name:'Anmelden'}));
    await screen.findByRole('button',{name:'Abmelden'}); await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    expect(requests.find(r=>r.url==='/api/login')?.init?.body).toBe(JSON.stringify({password:'test-only'}));
    fireEvent.click(screen.getByRole('button',{name:'Abmelden'})); await waitFor(()=>expect(screen.queryByText('Erfolgreich leer',{selector:'.badge'})).not.toBeInTheDocument());
    expect(screen.getByRole('button',{name:'Anmelden'})).toBeVisible(); expect(screen.queryByText('58')).not.toBeInTheDocument();
  });
  it('shows real statuses and provenance without synthetic metrics, dates or route state', async () => {
    backend(); render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    expect(screen.getAllByRole('button',{name:/^Details zu/})).toHaveLength(21);
    expect(screen.queryByText('58')).not.toBeInTheDocument(); expect(screen.queryByText('03.10.2026, 09:00')).not.toBeInTheDocument(); expect(screen.queryByText('Übersprungen')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Datenquellen filtern'),{target:{value:'empty'}});
    expect(screen.getAllByRole('button',{name:/^Details zu/})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    await within(screen.getByRole('dialog')).findByText('actual-hash');
    expect(within(screen.getByRole('dialog')).getByText(/2026-10-01/)).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByLabelText('Gespeicherte Antwort')).toHaveTextContent('2'); expect(within(screen.getByRole('dialog')).getByText('[]')).toBeVisible();
  });
  it('reports backend failures visibly instead of substituting demo data', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({detail:'Dienst nicht verfügbar'}),{status:503})));
    render(<App/>); await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Dienst nicht verfügbar'); expect(screen.queryByText('58')).not.toBeInTheDocument();
  });
  it('auto syncs only connected live sessions, polls and stops after completion', async () => {
    vi.useFakeTimers(); const {requests}=backend(true,true); render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(requests.filter(r=>r.url==='/api/sync')).toHaveLength(1);
    expect(JSON.parse(requests.find(r=>r.url==='/api/sync')!.init!.body as string)).toEqual({automatic:true});
    expect(screen.getByRole('button',{name:/Datenabruf läuft/})).toBeDisabled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);}); expect(screen.getByText(/Datenabruf abgeschlossen/)).toBeVisible();
    await act(async()=>{await vi.advanceTimersByTimeAsync(6000);}); expect(requests.filter(r=>r.url==='/api/sync/run-1')).toHaveLength(1);
  });
  it('cancels polling on demo entry and isolates synthetic mode from backend', async () => {
    vi.useFakeTimers(); const {requests}=backend(true,true); render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    fireEvent.click(screen.getByRole('button',{name:'Beispieldaten ansehen'})); const before=requests.length;
    fireEvent.click(screen.getByRole('button',{name:'Demo-Abruf'})); fireEvent.click(screen.getByRole('button',{name:'Details zu Herzfrequenz'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(6000);}); expect(requests).toHaveLength(before); expect(screen.getByText('58')).toBeVisible();
  });
  it('cancels scheduled poll on unmount', async () => {
    vi.useFakeTimers(); const {requests}=backend(true,true); const {unmount}=render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    unmount(); await act(async()=>{await vi.advanceTimersByTimeAsync(6000);}); expect(requests.some(r=>r.url.startsWith('/api/sync/'))).toBe(false);
  });
  it('honors automatic cooldown while allowing manual sync', async () => {
    const {fetcher,requests}=backend(true,true); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url,init)=> {
      if(url==='/api/sync' && JSON.parse(init?.body as string).automatic) {requests.push({url,init});return new Response(JSON.stringify({detail:'Automatischer Abruf erst nach 15 Minuten'}),{status:429});}
      return fallback(url,init);
    }); const {unmount}=render(<App/>); await screen.findByText(/Automatischer Abruf erst nach 15 Minuten/);
    fireEvent.click(screen.getByRole('button',{name:'Daten abrufen'})); await waitFor(()=>expect(requests.filter(r=>r.url==='/api/sync')).toHaveLength(2));
    expect(JSON.parse(requests.filter(r=>r.url==='/api/sync')[1].init!.body as string)).toEqual({automatic:false}); unmount();
  });
  it('shows a rejected password and keeps private health endpoints untouched', async () => {
    const {fetcher,requests}=backend(false); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url==='/api/login' ? new Response(JSON.stringify({detail:'Passwort ungültig'}),{status:401}) : fallback(url,init));
    render(<App/>); await waitFor(()=>expect(screen.getByRole('button',{name:'Anmelden'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:'Anmelden'}));
    fireEvent.change(screen.getByLabelText('Besitzerpasswort'),{target:{value:'incorrect-test-password'}});
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Anmelden'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwort ungültig');
    expect(requests.some(r=>r.url==='/api/dashboard')).toBe(false);
  });
  it('shows stored binary metadata and detail failures without parsing an image as JSON', async () => {
    const {fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url.startsWith('/api/responses/') ? url.endsWith('detail') ? new Response(JSON.stringify({detail:'Archiv momentan nicht verfügbar'}),{status:503}) : new Response(JSON.stringify({path:'/user/profile-picture',params:{size:'large'},http_status:200,content_type:'image/png',fetched_at:source.fetched_at,sha256:'binary-hash',size:8192,binary:true,payload:null}),{status:200}) : fallback(url,init));
    render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    expect(await screen.findByText('image/png')).toBeVisible(); expect(screen.getByText('8192 Bytes')).toBeVisible();
    expect(screen.queryByLabelText('Antwortinhalt')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gespeicherte Antwort'),{target:{value:'detail'}});
    expect(await screen.findByRole('alert')).toHaveTextContent('Archiv momentan nicht verfügbar');
    expect(screen.queryByText('binary-hash')).not.toBeInTheDocument();
  });
  it('shows invalid JSON as archived raw text rather than silently replacing it with null', async () => {
    const {fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url.startsWith('/api/responses/') ? new Response(JSON.stringify({path:source.path,params:{},http_status:200,content_type:'application/json',fetched_at:source.fetched_at,sha256:'invalid-hash',size:12,binary:false,payload:null,raw_text:'{invalid-json'}),{status:200}) : fallback(url,init));
    render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'});fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    expect(await screen.findByLabelText('Antwortinhalt')).toHaveTextContent('{invalid-json');
  });
  it('aborts in-flight detail and dashboard requests when entering demo', async () => {
    const {requests}=backend(); render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'})); await screen.findByText('actual-hash');
    fireEvent.click(screen.getByRole('button',{name:'Details schließen'}));
    fireEvent.click(screen.getByRole('button',{name:'Beispieldaten ansehen'}));
    expect(requests.filter(r=>r.url==='/api/dashboard'||r.url.startsWith('/api/responses/')).every(r=>r.init?.signal?.aborted)).toBe(true);
    expect(screen.queryByText('actual-hash')).not.toBeInTheDocument();
  });
  it('aborts poll on logout and removes an open private detail', async () => {
    vi.useFakeTimers(); const {requests,fetcher}=backend(true,true); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url==='/api/sync/run-1' ? (requests.push({url,init}),new Promise<Response>(()=>{})) : fallback(url,init));
    render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);}); await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'})); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    fireEvent.click(screen.getByRole('button',{name:'Abmelden'})); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(requests.find(r=>r.url==='/api/sync/run-1')?.init?.signal?.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText('actual-hash')).not.toBeInTheDocument();
  });
  it('reports sync poll failure and enables a manual retry', async () => {
    vi.useFakeTimers(); const {fetcher}=backend(true,true); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url==='/api/sync/run-1' ? new Response(JSON.stringify({detail:'Abrufstatus nicht verfügbar'}),{status:503}) : fallback(url,init));
    render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);}); await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    expect(screen.getByRole('alert')).toHaveTextContent('Abrufstatus nicht verfügbar');expect(screen.getByRole('button',{name:'Daten abrufen'})).toBeEnabled();
  });

  it('gives a safe error for non-JSON server failures', async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('<html>upstream unavailable</html>',{status:502,headers:{'Content-Type':'text/html'}})));
    render(<App/>);expect(await screen.findByRole('alert')).toHaveTextContent('Anfrage fehlgeschlagen (HTTP 502)');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Unexpected token');
  });
  it('never lets an aborted older response overwrite the selected archive response', async()=>{
    const {fetcher}=backend();const fallback=fetcher.getMockImplementation()!;
    let finishOld:(response:Response)=>void=()=>{};
    fetcher.mockImplementation(async(url,init)=>url==='/api/responses/list' ? new Promise<Response>(resolve=>{finishOld=resolve;}) : fallback(url,init));
    render(<App/>);await screen.findByText('Erfolgreich leer',{selector:'.badge'});fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    fireEvent.change(screen.getByLabelText('Gespeicherte Antwort'),{target:{value:'detail'}});await screen.findByText('actual-hash');
    await act(async()=>{finishOld(new Response(JSON.stringify({path:source.path,params:{},http_status:200,content_type:'application/json',fetched_at:source.fetched_at,sha256:'stale-response-hash',size:2,binary:false,payload:[]}),{status:200}));});
    expect(screen.getByText('actual-hash')).toBeVisible();expect(screen.queryByText('stale-response-hash')).not.toBeInTheDocument();
  });

  it('treats logout 401 as signed out and purges private state while aborting inflight requests', async()=>{
    vi.useFakeTimers();const {requests,fetcher}=backend(true,true);const fallback=fetcher.getMockImplementation()!;
    let finishPoll:(response:Response)=>void=()=>{};
    fetcher.mockImplementation(async(url,init)=>{
      if(url==='/api/logout')return new Response(JSON.stringify({detail:'Anmeldung erforderlich'}),{status:401});
      if(url==='/api/sync/run-1'){requests.push({url,init});return new Promise<Response>(resolve=>{finishPoll=resolve;});}
      if(url.startsWith('/api/responses/')){requests.push({url,init});return new Promise<Response>(()=>{});}
      return fallback(url,init);
    });
    render(<App/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    fireEvent.click(screen.getByRole('button',{name:'Abmelden'}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(screen.getByRole('button',{name:'Anmelden'})).toBeVisible();
    expect(screen.queryByText('Erfolgreich leer',{selector:'.badge'})).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(requests.filter(r=>r.url==='/api/sync/run-1'||r.url.startsWith('/api/responses/')).every(r=>r.init?.signal?.aborted)).toBe(true);
    await act(async()=>{finishPoll(new Response(JSON.stringify({run_id:'run-1',status:'completed',results:[source]}),{status:200}));});
    expect(screen.queryByText('Erfolgreich leer',{selector:'.badge'})).not.toBeInTheDocument();
  });

  it('loads arriving archive IDs in an already open pending detail and preserves a valid selection', async()=>{
    const {requests}=backend();const item=sources.find(item=>item.path===source.path)!;
    const {rerender}=render(<LiveDetails source={item} authenticated={true} live={{...source,status:'pending',response_ids:[]}}/>);
    expect(screen.getByText('Noch keine gespeicherte Antwort vorhanden.')).toBeVisible();
    rerender(<LiveDetails source={item} authenticated={true} live={{...source,status:'empty',response_ids:['list','detail']}}/>);
    expect(await screen.findByText('actual-hash')).toBeVisible();
    expect(requests.some(request=>request.url==='/api/responses/list')).toBe(true);
    fireEvent.change(screen.getByLabelText('Gespeicherte Antwort'),{target:{value:'detail'}});
    await waitFor(()=>expect(requests.some(request=>request.url==='/api/responses/detail')).toBe(true));
    rerender(<LiveDetails source={item} authenticated={true} live={{...source,status:'empty',response_ids:['list','detail','third']}}/>);
    expect(screen.getByLabelText('Gespeicherte Antwort')).toHaveValue('detail');
    rerender(<LiveDetails source={item} authenticated={true} live={{...source,status:'empty',response_ids:['third']}}/>);
    await waitFor(()=>expect(requests.some(request=>request.url==='/api/responses/third')).toBe(true));
    expect(screen.getByLabelText('Gespeicherte Antwort')).toHaveValue('third');
  });

});
