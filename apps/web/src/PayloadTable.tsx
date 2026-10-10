import { useState } from 'react';
import './payload-table.css';

type Field = {path: string; value: string; unit: string};
const units: Record<string,string> = {heartRate:'bpm',ansStatus:'ANS',durationMillis:'ms',offsetMillis:'ms',asleepDuration:'s'};
function* fields(value: unknown, path = ''): Generator<Field> {
  if (Array.isArray(value) && value.length) {
    for (let i=0;i<value.length;i++) yield* fields(value[i],`${path}[${i}]`);
  } else if (value && typeof value === 'object' && Object.keys(value).length) {
    for (const [key, item] of Object.entries(value)) yield* fields(item,path?`${path}.${key}`:key);
  } else {
    const name=path.split('.').pop() ?? '';
    const unit=/^steps\[\d+\]$/.test(name)?'Schritte':units[name]??'';
    yield {path:path||'Antwort',value:value===null?'Nicht vorhanden':typeof value==='object'?JSON.stringify(value):String(value),unit};
  }
}
export default function PayloadTable({payload}:{payload:unknown}) {
  const [query,setQuery]=useState(''),[page,setPage]=useState(0);
  const rows:Field[]=[]; let matched=0, more=false;
  for(const field of fields(payload)) {
    if(!`${field.path} ${field.value} ${field.unit}`.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'))) continue;
    if(matched++<page*100) continue;
    if(rows.length===100) {more=true;break;}
    rows.push(field);
  }
  return <section className="payload-fields" aria-label="Messfelder der Originalantwort">
    <h3>Alle gespeicherten Felder</h3>
    <p>Feldpfade und Werte aus der Originalantwort. Einheiten werden angezeigt, soweit sie eindeutig bekannt sind.</p>
    <label>Messfelder durchsuchen<input type="search" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <div className="payload-scroll"><table><thead><tr><th>Feld / Messzeitpunkt</th><th>Wert</th><th>Einheit</th></tr></thead><tbody>{rows.map(row=><tr key={row.path}><th scope="row">{row.path}</th><td>{row.value}</td><td>{row.unit||'—'}</td></tr>)}</tbody></table></div>
    {!rows.length&&<p>Keine passenden Felder.</p>}
    <nav aria-label="Feldseiten"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Vorherige Felder</button><span>Seite {page+1} · bis zu 100 Felder</span><button disabled={!more} onClick={()=>setPage(p=>p+1)}>Nächste Felder</button></nav>
  </section>;
}
