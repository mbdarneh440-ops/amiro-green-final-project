'use client';
import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button } from './ui/button';
import { DialogTitle, DialogDescription } from './ui/dialog';
import { days, type Site, type ShiftTemplate } from '@/lib/domain';
import { periodNames, securityNames, universityTemplates } from '@/lib/roster';

export default function ShiftTemplateEditor({site,busy,save}:{site:Site;busy:boolean;save:(action:string,payload:unknown)=>Promise<boolean>}){
  const [rows,setRows]=useState<ShiftTemplate[]>(()=>structuredClone(site.shiftTemplates??[]));
  const update=(id:string,patch:Partial<ShiftTemplate>)=>setRows(old=>old.map(row=>row.id===id?{...row,...patch}:row));
  return <form className="dialog-form roster-editor" onSubmit={e=>{e.preventDefault();void save('saveShiftTemplates',{siteId:site.id,templates:rows})}}>
    <DialogTitle>מבנה המשמרות · {site.name}</DialogTitle>
    <DialogDescription>מגדירים שעות, סוג אבטחה וכמות לכל יום. שמירת המבנה יוצרת דרישות לשיבוץ; אישור סידור העבודה נעשה בנפרד.</DialogDescription>
    <div className="roster-editor-actions"><Button type="button" variant="outline" onClick={()=>setRows(universityTemplates())}>טעינת המבנה מהתמונה</Button><span className="small muted">ללא נשק למעלה · עם נשק למטה</span></div>
    <p className="small muted">התבנית מהתמונה כוללת שעות וכמויות בלבד. שמות עובדים אינם מועתקים. משמרת שחוצה חצות ממשיכה ביום הבא. ימי הפעילות של האתר עדיין חלים.</p>
    {!rows.length&&<p className="banner">טרם הוגדרו משמרות מפורטות. כרגע הכיסוי באתר מחולק למקטעים של עד 8 שעות, ללא סיווג נשק.</p>}
    <div className="roster-editor-rows">{rows.map((row,index)=><fieldset key={row.id} className="roster-rule"><legend>משמרת {index+1}</legend>
      <div className="roster-rule-fields">
        <label>סוג אבטחה<select aria-label={`סוג אבטחה ${index+1}`} value={row.securityType} onChange={e=>update(row.id,{securityType:e.target.value as ShiftTemplate['securityType']})}>{Object.entries(securityNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>משמרת<select aria-label={`משמרת ${index+1}`} value={row.period} onChange={e=>update(row.id,{period:e.target.value as ShiftTemplate['period']})}>{Object.entries(periodNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>התחלה<input aria-label={`התחלה ${index+1}`} required type="time" value={row.start} onChange={e=>update(row.id,{start:e.target.value})}/></label>
        <label>סיום<input aria-label={`סיום ${index+1}`} required dir="ltr" placeholder="24:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" value={row.end} onChange={e=>update(row.id,{end:e.target.value})}/></label>
        <label>עובדים<input aria-label={`כמות עובדים ${index+1}`} required type="number" min={1} max={100} value={row.count} onChange={e=>update(row.id,{count:Number(e.target.value)})}/></label>
        <Button type="button" variant="ghost" aria-label={`מחיקת משמרת ${index+1}`} onClick={()=>setRows(rows.filter(r=>r.id!==row.id))}><Trash2 size={17}/></Button>
      </div>
      <div className="roster-rule-days">{days.map((label,day)=><label key={day}><input type="checkbox" checked={row.days.includes(day)} onChange={e=>update(row.id,{days:e.target.checked?[...row.days,day].sort():row.days.filter(d=>d!==day)})}/>{label}</label>)}</div>
      {!row.days.length&&<p className="error-text">יש לבחור לפחות יום אחד.</p>}
    </fieldset>)}</div>
    <Button type="button" variant="outline" disabled={rows.length>=64} onClick={()=>setRows([...rows,{id:crypto.randomUUID(),securityType:'unarmed',period:'morning',start:'06:30',end:'15:00',count:1,days:site.kind==='event'?[new Date(site.date+'T00:00:00Z').getUTCDay()]:[...site.days]}])}><Plus size={16}/>הוספת משמרת</Button>
    <p className="small muted">שיבוץ עם נשק דורש סימון התאמה לכך בפרטי העובד. שעות שכבר דווחו נשמרות גם לאחר שינוי המבנה.</p>
    <div className="form-footer"><Button type="submit" disabled={busy||rows.some(r=>!r.days.length)}><Save size={16}/>{busy?'שומר…':'שמירת מבנה המשמרות'}</Button></div>
  </form>;
}
