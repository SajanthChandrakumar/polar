import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import LiveDetails from './LiveDetails';
import { sources } from './data';
const source = {path:'/ppi-samples',status:'empty',http_status:200,count:0,fetched_at:'2026-10-05T12:00:00+02:00',message:'Keine Einträge',response_ids:['list','detail']};
const openSources = () => fireEvent.click(screen.getByRole('link',{name:'Details ansehen'}));
const revealOriginal = (container: HTMLElement = screen.getByRole('dialog')) => fireEvent.click(within(container).getByText('Originaldaten ansehen'));
function backend(authenticated = true, connected = false) {
  const requests: {url:string, init?:RequestInit}[] = []; let loggedIn = authenticated;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({url,init}); let body: unknown;
    if (url === '/api/session') body = {authenticated:loggedIn};
    else if (url === '/api/login') {loggedIn=true; body={authenticated:true};}
    else if (url === '/api/logout') {loggedIn=false; return new Response(null,{status:204});}
    else if (url.startsWith('/api/patterns?')) {
      const params = new URL(url, 'http://localhost').searchParams;
      const days = Number(params.get('days') ?? 90), outcome = params.get('outcome') ?? 'sleep';
      body = {days, outcome, from:days === 30 ? '2026-09-26' : '2026-07-28', to:'2026-10-25', activity_from:days === 30 ? '2026-09-25' : '2026-07-27', activity_to:'2026-10-24', timezone:'Europe/Zurich', unit:outcome === 'ans' ? 'ANS' : 'min', threshold:null, status:'insufficient', minimum_group_size:7, groups:{lower:{count:0,median:null,q1:null,q3:null},upper:{count:0,median:null,q1:null,q3:null}}, pairs:[], exclusions:{activity_unavailable:0,activity_provisional:0,outcome_unavailable:0}};
    }

    else if (url.startsWith('/api/analytics?')) body={days:30,from:'2026-09-06',to:'2026-10-05',timezone:'Europe/Zurich',series:[]};
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
  it('keeps modal keyboard focus on visible controls when original data is closed or expanded', async () => {
    backend(); render(<App/>);
    await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    openSources();
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    const dialog=screen.getByRole('dialog');
    const close=within(dialog).getByRole('button',{name:'Details schließen'});
    const original=within(dialog).getByText('Originaldaten ansehen');
    close.focus();
    fireEvent.keyDown(close,{key:'Tab',shiftKey:true});
    expect(original).toHaveFocus();
    fireEvent.keyDown(original,{key:'Tab'});
    expect(close).toHaveFocus();
    fireEvent.click(original);
    const raw=await within(dialog).findByLabelText('Antwortinhalt');
    raw.focus();
    fireEvent.keyDown(raw,{key:'Tab'});
    expect(close).toHaveFocus();
    fireEvent.keyDown(close,{key:'Tab',shiftKey:true});
    expect(raw).toHaveFocus();
    fireEvent.click(original);
    close.focus();
    fireEvent.keyDown(close,{key:'Tab',shiftKey:true});
    expect(original).toHaveFocus();
  });

  it('keeps raw response fields closed until the user opens Originaldaten', async () => {
    backend(); render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    fireEvent.click(screen.getByRole('link',{name:'Details ansehen'}));
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    const dialog=screen.getByRole('dialog');
    const sourceDisclosure=within(dialog).getByText('Quellendetails');
    expect(sourceDisclosure.closest('details')).not.toHaveAttribute('open');
    expect(within(dialog).getByText('Erfolgreich leer')).toBeVisible();
    fireEvent.click(sourceDisclosure);
    expect(within(dialog).getByText('/ppi-samples')).toBeVisible();
    const disclosure=within(dialog).getByText('Originaldaten ansehen');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(disclosure);
    expect(await within(dialog).findByText('actual-hash')).toBeVisible();
    expect(within(dialog).getByLabelText('Gespeicherte Antwort')).toHaveValue('list');
  });

  it('renders real dashboard metrics with dates and clears them on logout', async () => {
    const {fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url==='/api/dashboard' ? new Response(JSON.stringify({connected:false,last_sync:null,sources:[source],metrics:{heart:{value:72.5,unit:'bpm',detail:'Mittelwert der Pulsmessungen',date:'2026-10-07',status:'available'},moon:{value:420,unit:'min',detail:'Tatsächliche Schlafdauer',date:'2026-10-06',status:'stale'},activity:{value:0,unit:'Schritte',detail:'Schritt-Samples',date:'2026-10-07',status:'available'}}}),{status:200}) : fallback(url,init));
    render(<App/>);
    const heart=screen.getByRole('heading',{name:'Herzfrequenz'}).closest('article')!;
    await within(heart).findByText('72.5');
    expect(within(heart).getByText('bpm')).toBeVisible();
    expect(within(heart).getByText(/07.10.2026/)).toBeVisible();
    const sleep=within(screen.getByLabelText('Datenübersicht')).getByRole('heading',{name:'Schlaf'}).closest('article')!;
    expect(within(sleep).getByText('7 h 00')).toBeVisible();
    expect(within(sleep).getByText(/Älterer Messwert/)).toBeVisible();
    const activity=screen.getByRole('heading',{name:'Aktivität'}).closest('article')!;
    expect(within(activity).getByText('0')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Abmelden'}));
    await waitFor(()=>expect(within(heart).queryByText('72.5')).not.toBeInTheDocument());
  });
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
    backend(); render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'}); openSources();
    expect(screen.getAllByRole('button',{name:/^Details zu/})).toHaveLength(19);
    expect(screen.queryByText('58')).not.toBeInTheDocument(); expect(screen.queryByText('03.10.2026, 09:00')).not.toBeInTheDocument(); expect(screen.queryByText('Übersprungen')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Datenquellen filtern'),{target:{value:'empty'}});
    expect(screen.getAllByRole('button',{name:/^Details zu/})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    const dialog=screen.getByRole('dialog'); revealOriginal(dialog); await within(dialog).findByText('actual-hash');
    expect(within(screen.getByRole('dialog')).getByText(/2026-10-01/)).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByLabelText('Gespeicherte Antwort')).toHaveTextContent('2'); expect(within(screen.getByRole('dialog')).getByLabelText('Antwortinhalt')).toHaveTextContent('[]');
  });
  it('reports backend failures visibly instead of substituting demo data', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({detail:'Dienst nicht verfügbar'}),{status:503})));
    render(<App/>); await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Dienst nicht verfügbar'); expect(screen.queryByText('58')).not.toBeInTheDocument();
  });
  it('auto syncs only connected live sessions, polls and stops after completion', async () => {
    vi.useFakeTimers(); const {requests}=backend(true,true); render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(requests.filter(r=>r.url==='/api/sync')).toHaveLength(1);
    expect(JSON.parse(requests.find(r=>r.url==='/api/sync')!.init!.body as string)).toEqual({automatic:true});
    expect(screen.getByRole('button',{name:/Aktualisierung läuft/})).toBeDisabled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(2000);}); expect(screen.getByText(/Aktualisierung abgeschlossen|Datenabruf abgeschlossen/)).toBeVisible();
    await act(async()=>{await vi.advanceTimersByTimeAsync(6000);}); expect(requests.filter(r=>r.url==='/api/sync/run-1')).toHaveLength(1);
  });
  it('cancels polling on demo entry and isolates synthetic mode from backend', async () => {
    vi.useFakeTimers(); const {requests}=backend(true,true); render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    fireEvent.click(screen.getByRole('button',{name:'Beispieldaten ansehen'})); openSources(); const before=requests.length;
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
    }); const {unmount}=render(<App/>); await waitFor(()=>expect(requests.some(r=>r.url==='/api/sync')).toBe(true));
    expect(screen.queryByText(/Automatischer Abruf erst nach 15 Minuten/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Aktualisieren'})); await waitFor(()=>expect(requests.filter(r=>r.url==='/api/sync')).toHaveLength(2));
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
    render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'}); openSources();
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    revealOriginal();
    expect(await screen.findByText('image/png')).toBeVisible(); expect(screen.getByText('8192 Bytes')).toBeVisible();
    expect(screen.queryByLabelText('Antwortinhalt')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Gespeicherte Antwort'),{target:{value:'detail'}});
    expect(await screen.findByRole('alert')).toHaveTextContent('Archiv momentan nicht verfügbar');
    expect(screen.queryByText('binary-hash')).not.toBeInTheDocument();
  });
  it('shows invalid JSON as archived raw text rather than silently replacing it with null', async () => {
    const {fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url.startsWith('/api/responses/') ? new Response(JSON.stringify({path:source.path,params:{},http_status:200,content_type:'application/json',fetched_at:source.fetched_at,sha256:'invalid-hash',size:12,binary:false,payload:null,raw_text:'{invalid-json'}),{status:200}) : fallback(url,init));
    render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'});openSources();fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'})); revealOriginal();
    expect(await screen.findByLabelText('Antwortinhalt')).toHaveTextContent('{invalid-json');
  });
  it('aborts in-flight detail and dashboard requests when entering demo', async () => {
    const {requests}=backend(); render(<App/>); await screen.findByText('Erfolgreich leer',{selector:'.badge'}); openSources();
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'})); revealOriginal(); await screen.findByText('actual-hash');
    fireEvent.click(screen.getByRole('button',{name:'Details schließen'}));
    fireEvent.click(screen.getByRole('button',{name:'Beispieldaten ansehen'}));
    expect(requests.filter(r=>r.url==='/api/dashboard'||r.url.startsWith('/api/responses/')).every(r=>r.init?.signal?.aborted)).toBe(true);
    expect(screen.queryByText('actual-hash')).not.toBeInTheDocument();
  });
  it('aborts poll on logout and removes an open private detail', async () => {
    vi.useFakeTimers(); const {requests,fetcher}=backend(true,true); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url==='/api/sync/run-1' ? (requests.push({url,init}),new Promise<Response>(()=>{})) : fallback(url,init));
    render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);}); await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    openSources(); fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'})); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    fireEvent.click(screen.getByRole('button',{name:'Abmelden'})); await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
    expect(requests.find(r=>r.url==='/api/sync/run-1')?.init?.signal?.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText('actual-hash')).not.toBeInTheDocument();
  });
  it('reports sync poll failure and enables a manual retry', async () => {
    vi.useFakeTimers(); const {fetcher}=backend(true,true); const fallback=fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async(url,init)=>url==='/api/sync/run-1' ? new Response(JSON.stringify({detail:'Abrufstatus nicht verfügbar'}),{status:503}) : fallback(url,init));
    render(<App/>); await act(async()=>{await vi.advanceTimersByTimeAsync(0);}); await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
    expect(screen.getByRole('alert')).toHaveTextContent('Abrufstatus nicht verfügbar');expect(screen.getByRole('button',{name:'Aktualisieren'})).toBeEnabled();
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
    render(<App/>);await screen.findByText('Erfolgreich leer',{selector:'.badge'});openSources();fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'})); revealOriginal();
    fireEvent.change(screen.getByLabelText('Gespeicherte Antwort'),{target:{value:'detail'}});await screen.findByText('actual-hash');
    await act(async()=>{finishOld(new Response(JSON.stringify({path:source.path,params:{},http_status:200,content_type:'application/json',fetched_at:source.fetched_at,sha256:'stale-response-hash',size:2,binary:false,payload:[]}),{status:200}));});
    expect(screen.getByText('actual-hash')).toBeVisible();expect(screen.queryByText('stale-response-hash')).not.toBeInTheDocument();
  });

    it('closes and clears the private inspector when pattern analysis returns 401', async () => {
    const {requests,fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
    let finishPatterns!:(response:Response)=>void;
    fetcher.mockImplementation(async(url,init)=> {
      if(url.startsWith('/api/patterns?')) { requests.push({url,init}); return new Promise<Response>(resolve=>{finishPatterns=resolve;}); }
      return fallback(url,init);
    });
    render(<App/>);
    await screen.findByText('Erfolgreich leer',{selector:'.badge'});
    await waitFor(()=>expect(requests.some(request=>request.url.startsWith('/api/patterns?'))).toBe(true));
    openSources(); fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    const dialog=screen.getByRole('dialog'); revealOriginal(dialog);
    expect(await within(dialog).findByText('actual-hash')).toBeVisible();
    expect(within(dialog).getByLabelText('Gespeicherte Antwort')).toHaveValue('list');
    expect(within(dialog).getByLabelText('Gespeicherte Antwort')).toHaveTextContent('list');

    await act(async()=>{finishPatterns(new Response(JSON.stringify({detail:'Anmeldung erforderlich'}),{status:401,headers:{'Content-Type':'application/json'}}));});
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Gespeicherte Antwort')).not.toBeInTheDocument();
    expect(screen.queryByText('Antwort 1 von 2 · list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));
    expect(screen.queryByLabelText('Gespeicherte Antwort')).not.toBeInTheDocument();
    expect(screen.queryByText('Antwort 1 von 2 · list')).not.toBeInTheDocument();
  });

  it('closes a private source inspector while a pending patterns request returns 401', async () => {
    const {requests,fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
    let finishPatterns!:(response:Response)=>void;
    const analytics={days:7,from:'2026-10-01',to:'2026-10-07',timezone:'Europe/Zurich',series:[{key:'heart',label:'Herzfrequenz',unit:'bpm',kind:'line',source_path:'/continuous-samples',coverage:{valid_days:1,total_days:7},points:[{date:'2026-10-03',value:70,provisional:false,response_ids:['private-pattern-source-id']}],feedback:[]}]};
    fetcher.mockImplementation(async(url,init)=> {
      if(url.startsWith('/api/patterns?')) { requests.push({url,init}); return new Promise<Response>(resolve=>{finishPatterns=resolve;}); }
      if(url.startsWith('/api/analytics?')) return new Response(JSON.stringify(analytics),{status:200});
      return fallback(url,init);
    });
    render(<App/>);
    const heart=await screen.findByRole('region',{name:'Herzfrequenz'});
    await waitFor(()=>expect(requests.some(request=>request.url.startsWith('/api/patterns?'))).toBe(true));
    fireEvent.change(within(heart).getByRole('combobox',{name:'Tageswert Herzfrequenz'}),{target:{value:'2026-10-03'}});
    fireEvent.click(within(heart).getByText('Messdetails ansehen'));
    fireEvent.click(await within(heart).findByRole('button',{name:'Originalantwort ansehen'}));
    const dialog=screen.getByRole('dialog'); revealOriginal(dialog);
    expect(await within(dialog).findByText('actual-hash')).toBeVisible();
    expect(within(dialog).getByLabelText('Gespeicherte Antwort')).toHaveValue('private-pattern-source-id');

    await act(async()=>{finishPatterns(new Response(JSON.stringify({detail:'Anmeldung erforderlich'}),{status:401,headers:{'Content-Type':'application/json'}}));});
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Gespeicherte Antwort')).not.toBeInTheDocument();
    expect(screen.queryByText('Antwort 1 von 1 · private-pattern-source-id')).not.toBeInTheDocument();
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
    openSources(); fireEvent.click(screen.getByRole('button',{name:'Details zu Pulsintervalle'}));await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
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
    revealOriginal(document.body); expect(await screen.findByText('actual-hash')).toBeVisible();
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

it('opens the exact historical archive response from a chart point', async () => {
  const {fetcher,requests}=backend(); const fallback=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(url,init)=> {
    if(url.startsWith('/api/analytics?')) return new Response(JSON.stringify({days:7,from:'2026-10-01',to:'2026-10-07',timezone:'Europe/Zurich',series:[{key:'heart',label:'Herzfrequenz',unit:'bpm',kind:'line',source_path:'/continuous-samples',coverage:{valid_days:1,total_days:7},points:[{date:'2026-10-03',value:70,provisional:false,response_ids:['historical']}],feedback:[]}]}),{status:200});
    if(url==='/api/responses/historical') return new Response(JSON.stringify({path:'/continuous-samples',params:{},http_status:200,content_type:'application/json',fetched_at:'2026-10-04',sha256:'history-hash',size:30,binary:false,payload:{historicalRecord:true}}),{status:200});
    return fallback(url,init);
  });
  render(<App/>);
  const heart=await screen.findByRole('region',{name:'Herzfrequenz'});
  fireEvent.change(within(heart).getByRole('combobox',{name:'Tageswert Herzfrequenz'}),{target:{value:'2026-10-03'}});
  fireEvent.click(within(heart).getByText('Messdetails ansehen'));
  fireEvent.click(await within(heart).findByRole('button',{name:'Originalantwort ansehen'}));
  const dialog=screen.getByRole('dialog'); revealOriginal(dialog);
  expect(await within(dialog).findByText('history-hash')).toBeVisible();
  expect(within(dialog).getByLabelText('Antwortinhalt')).toHaveTextContent('historicalRecord');
  expect(requests.some(r=>r.url==='/api/sync')).toBe(false);
});

it('hides and aborts private analytics immediately when logout is pending', async () => {
  const {fetcher}=backend(); const fallback=fetcher.getMockImplementation()!;
  let finishLogout!:(response:Response)=>void;
  fetcher.mockImplementation(async(url,init)=> {
    if(url==='/api/logout') return new Promise<Response>(resolve=>{finishLogout=resolve;});
    if(url.startsWith('/api/analytics?')) return new Response(JSON.stringify({days:7,from:'2026-10-01',to:'2026-10-07',timezone:'Europe/Zurich',series:[{key:'heart',label:'Herzfrequenz',unit:'bpm',kind:'line',source_path:'/continuous-samples',coverage:{valid_days:1,total_days:7},points:[{date:'2026-10-03',value:70,provisional:false,response_ids:['private-history-id']}],feedback:[]}]}),{status:200});
    return fallback(url,init);
  });
  render(<App/>);
  const heart=await screen.findByRole('region',{name:'Herzfrequenz'});
  fireEvent.change(within(heart).getByRole('combobox',{name:'Tageswert Herzfrequenz'}),{target:{value:'2026-10-03'}});
  fireEvent.click(within(heart).getByText('Messdetails ansehen'));
  await within(heart).findByText('private-history-id');
  fireEvent.click(screen.getByRole('button',{name:'Abmelden'}));
  await waitFor(()=>expect(screen.queryByText('private-history-id')).not.toBeInTheDocument());
  await act(async()=>{finishLogout(new Response(null,{status:204}));});
});
