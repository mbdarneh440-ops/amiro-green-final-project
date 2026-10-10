'use client';
import { useState } from 'react';
import { Search,UserRound } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { days,hours,dateAdd,availabilityText,type State,type Guard } from '@/lib/domain';
import { shiftTime } from './schedule-board';
export function WorkerSearch({state,onPick}:{state:State;onPick:(g:Guard)=>void}){
 const [q,setQ]=useState('');const normalized=q.trim().toLocaleLowerCase('he');const list=normalized?state.guards.filter(g=>[g.name,g.phone,g.id].some(v=>v.toLocaleLowerCase('he').includes(normalized))):[];
 return <div className="global-worker-search"><Search size={18}/><Input aria-label="חיפוש עובד בכל המערכת" placeholder="חיפוש עובד לפי שם…" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setQ('')}}/>{normalized&&<div className="worker-search-results"><p className="small muted">{list.length} תוצאות</p>{list.slice(0,10).map(g=><button key={g.id} onClick={()=>{onPick(g);setQ('')}}><UserRound size={18}/><span><strong>{g.name}</strong><small>{g.phone||'לא הוזן טלפון'}</small></span></button>)}{!list.length&&<p>לא נמצא עובד בשם הזה.</p>}</div>}</div>
}
export default function WorkerDetails({guard,state,week,onEdit}:{guard:Guard;state:State;week:string;onEdit:()=>void}){
 const shifts=state.shifts.filter(s=>s.guardId===guard.id&&s.date>=week&&s.date<dateAdd(week,7));
 return <div className="dialog-form"><DialogTitle>{guard.name}</DialogTitle><DialogDescription>כרטיס עובד · נתונים עדכניים וסידור מאושר לשבוע {week}</DialogDescription><div className="profile-grid"><div><small>טלפון</small><strong dir="ltr">{guard.phone||'לא הוזן'}</strong></div><div><small>שכר לשעה</small><strong>{guard.wage} {state.settings.currency}</strong></div><div><small>שעות משובצות השבוע</small><strong><bdi>{shifts.reduce((n,s)=>n+hours(s),0)} / {guard.maxHours}</bdi></strong></div><div><small>זמינות</small><strong>{guard.confirmed?'אושרה':'ממתינה לאישור'}</strong></div></div><p><b>הכשרות: </b>{guard.skills.join(' · ')}</p><h3>זמינות שבועית</h3><div className="availability-list">{guard.availability.map((w,i)=><p key={i}><strong>{days[w.day]}</strong><bdi>{w.start}–{w.end}</bdi></p>)}</div>{guard.exceptions.length>0&&<div><h3>חריגות בתאריכים</h3>{guard.exceptions.map((e,i)=><p key={i}>{e.date} · {availabilityText(e)}</p>)}</div>}<h3>משמרות מאושרות השבוע</h3>{shifts.length?shifts.map(s=><div className="worker-shift-row" key={s.id}><span>{s.date}</span><bdi>{shiftTime(s)}</bdi><strong>{state.sites.find(x=>x.id===s.siteId)?.name}</strong></div>):<p className="muted">טרם נשמרו משמרות מאושרות לעובד בשבוע הזה.</p>}<Button onClick={onEdit}>עריכת פרטים וזמינות</Button></div>
}
