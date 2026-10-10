'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {previewAvailability} from '@/lib/availability-import';
import {availabilityText,type State} from '@/lib/domain';
export default function AvailabilityInbox({state,busy,save}:{state:State;busy:boolean;save:(action:string,payload:unknown)=>Promise<unknown>}){
 const [selected,setSelected]=useState(''),receipts=state.availabilityReceipts??[],pending=receipts.filter(r=>r.status==='pending'),receipt=receipts.find(r=>r.id===selected&&r.status==='pending');
 let rows:ReturnType<typeof previewAvailability>=[],error='';
 if(receipt)try{rows=previewAvailability(receipt.csv,state,receipt.securityType)}catch(e){error=e instanceof Error?e.message:'לא ניתן לבדוק את התשובה.';}
 return <section className="panel mt-4"><div className="panel-head"><h2>תשובות זמינות לבדיקה</h2><span className="pill amber">{pending.length} ממתינות</span></div><div className="panel-body">
 {!pending.length?<p className="small muted">לא נותרו תשובות לבדיקה. תשובות חדשות יופיעו כאן אחרי הסנכרון.</p>:<div className="table-wrap"><table><thead><tr><th>עובד</th><th>טלפון</th><th>קבוצה</th><th>שבוע</th><th>בדיקה</th></tr></thead><tbody>{pending.map(r=><tr key={r.id}><td>{r.name}</td><td><bdi>{r.phone}</bdi></td><td>{r.securityType==='armed'?'ב · חמוש':r.securityType==='unarmed'?'א · לא חמוש':'טופס קודם'}</td><td><bdi>{r.week}</bdi></td><td><Button variant="outline" size="sm" disabled={busy} onClick={()=>setSelected(r.id)}>בדיקה</Button></td></tr>)}</tbody></table></div>}
 {receipt&&<div className="mt-4"><h3>{receipt.name} · <bdi>{receipt.week}</bdi></h3><p className="small muted">התשובה נשמרה לבדיקה. אישור כאן מעדכן את התאריכים בלבד; הכשרת הנשק והשכר נשארים כפי שהוגדרו בכרטיס העובד.</p>
 {error?<p className="banner warn" role="alert">{error}</p>:<div className="table-wrap"><table><thead><tr><th>תאריך</th><th>לפני</th><th>אחרי</th></tr></thead><tbody>{rows.map(r=><tr key={r.guardId+r.date}><td><bdi>{r.date}</bdi></td><td>{r.previous}</td><td>{r.selections?availabilityText(r):r.available?r.start+'–'+r.end:'לא זמין'}</td></tr>)}</tbody></table></div>}
 <div className="actions mt-4"><Button disabled={busy||!!error||!rows.length} onClick={()=>void save('approveAvailabilityReceipt',{id:receipt.id})}>אישור תשובת הזמינות</Button><Button variant="outline" disabled={busy} onClick={()=>void save('rejectAvailabilityReceipt',{id:receipt.id})}>דחייה</Button></div></div>}
 <p className="small muted mt-4">{receipts.filter(r=>r.status==='approved').length} תשובות אושרו · {receipts.filter(r=>r.status==='rejected').length} נדחו. תשובה שכבר נבדקה אינה חוזרת אחרי רענון. לאחר אישור התوفر אפשר ליצור הצעת סידור עבודה ולבדוק אותה.</p>
 </div></section>;
}
