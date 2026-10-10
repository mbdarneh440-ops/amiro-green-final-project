'use client';
import {useState} from 'react';
import {DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {availabilityDays,previewAvailability} from '@/lib/availability-import';
import {availabilityText,type State,type SecurityType,type AvailabilityReceipt} from '@/lib/domain';
import {Choice} from './wardiya-forms';
export default function AvailabilityImportPanel({state,busy,makeReady=false,save}:{state:State;busy:boolean;makeReady?:boolean;save:(action:string,payload:unknown)=>Promise<unknown>}){
 const [securityType,setSecurityType]=useState<SecurityType|''>('');
 const [csv,setCsv]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);let rows:ReturnType<typeof previewAvailability>=[];let issue='';
 async function loadMake(){setLoading(true);setCsv('');setError('');try{const r=await fetch('/api/availability',{method:'POST'});const v=await r.json() as {csv:string;count:number;batches?:Omit<AvailabilityReceipt,'id'|'status'|'processedAt'>[];error?:string};if(!r.ok)throw Error(v.error);if(v.batches?.length){await save('queueAvailability',v.batches);return}if(!v.count){setError('אין כרגע תשובות זמינות במאגר Make. אפשר לייבא קובץ מהגיליון.');return}if(v.csv.length>50000)throw Error('הקובץ גדול מדי לבדיקה אחת. יש לייבא קובץ מצומצם מהגיליון.');setCsv(v.csv)}catch(e){setError(e instanceof Error?e.message:'לא ניתן לקרוא את התשובות')}finally{setLoading(false)}}
 if(csv)try{rows=previewAvailability(csv,state,securityType||undefined)}catch(e){issue=e instanceof Error?e.message:'הקובץ לא תקין'}
 return <div className="dialog-form availability-import-form">
  <DialogTitle>בדיקת תשובות זמינות</DialogTitle>
  <DialogDescription>טוענים תשובות, משווים את שעות השבוע ומאשרים. עד לאישור לא משתנה זמינות של אף עובד.</DialogDescription>
  <Button variant="outline" disabled={!makeReady||busy||loading} onClick={()=>void loadMake()}>{loading?'טוען תשובות…':'טעינת תשובות מ־Make לבדיקה'}</Button>
  {!makeReady&&<p className="small muted">טעינה מ־Make תהיה זמינה לאחר הגדרת שירותי החברה והפעלת הסנכרון. בינתיים אפשר לבחור קובץ.</p>}
  <label className="field"><span>קבוצת הטופס · למנהל בלבד</span><Choice label="קבוצת טופס הזמינות" value={securityType} onChange={v=>setSecurityType(v as SecurityType|'')} options={[["","בחירת קבוצת הטופס"],["unarmed","א · לא חמוש"],["armed","ב · חמוש"]]}/></label>
  <details className="small muted"><summary>איך מכינים את הקובץ והשעות?</summary><p>בטבלת Google: קובץ ← הורדה ← ערכים מופרדים בפסיקים, כולל עמודת <b>שבוע אוטומטי</b>. בטופס מוצגים ימי השבוע הנוכחי עם תאריך ליד כל יום; אין צורך להזין תאריך תחילת שבוע. מסמנים בוקר, צהריים או לילה, ואפשר לבחור כמה משמרות ביום. השבוע של כל תשובה מחושב ממועד השליחה ונשמר בעמודה האוטומטית, כך שעדכון כותרות הטופס לשבוע חדש אינו משנה תשובות קודמות. המנהל בוחר כאן את קבוצת הטופס לפני האישור. הבחירות נבדקות לפי שעות המשמרות בסידור. אפשר לייבא גם שעות ותאריכי שבוע מהטופס הקודם, למשל <bdi>08:00–16:00</bdi>, וגם תשובות ישנות לפי תאריך יחיד. יום ריק פירושו שלא מתחילה בו זמינות חדשה; משמרת לילה שהתחילה ביום הקודם ממשיכה כרגיל. תאריך בכותרות הטופס מוצג לפי יום/חודש/שנה; תאריך גיליון ישן באנגלית נקרא לפי חודש/יום/שנה.</p></details>
  <Button variant="outline" asChild><label htmlFor="availability-csv">בחירת קובץ תשובות (CSV)</label></Button>
  <Input className="sr-only" id="availability-csv" aria-label="קובץ תשובות זמינות" type="file" accept=".csv,text/csv" onChange={async e=>{setCsv('');setError('');const f=e.target.files?.[0];if(!f)return;if(f.size>50000){setError('הקובץ גדול מדי. יש לייבא עד 100 תשובות בכל פעם.');return}try{setCsv(await f.text())}catch{setError('לא ניתן לקרוא את הקובץ. יש לנסות לבחור אותו שוב.')}}}/>
  {(issue||error)&&<p className="banner warn" role="alert">{issue||error}</p>}
  {rows.length>0&&<>
   <p><b>{rows.length} תאריכים לבדיקה</b> · הזמינות השבועית הקבועה, השכר וההכשרות נשארים כפי שהוגדרו.</p>
   <div className="table-wrap"><table className="availability-preview"><thead><tr><th>עובד</th><th>יום ותאריך</th><th>לפני</th><th>אחרי</th></tr></thead><tbody>{rows.map(r=><tr key={r.guardId+r.date}><td>{r.name}</td><td>{availabilityDays[new Date(r.date+'T00:00:00Z').getUTCDay()]}<br/><bdi>{r.date}</bdi></td><td>{r.previous}</td><td>{r.selections?availabilityText(r):r.available?<><bdi>{r.start}–{r.end}</bdi>{r.end<r.start?' למחרת':''}</>:<strong>לא הוזנו שעות ליום זה</strong>}</td></tr>)}</tbody></table></div>
   <p className="small muted">האישור מחליף את הזמינות בשבעת ימי השבוע של התשובה בלבד, לפי השבוע האוטומטי המקורי או תאריך השבוע בטופס הישן. שעות לילה ממשיכות למחרת גם כשהיום הבא ריק. חסימה ידנית של יום שלם גוברת עליהן. בחירת לילה מתייחסת למשמרת שמתחילה באותו יום וכוללת גם תגבור לילה 20:00–08:00. הייבוא אינו מעניק הכשרת נשק. לאחר האישור יוצרים הצעת שיבוץ חדשה; עובד שטרם אושר בכרטיסו לא ישובץ.</p>
  </>}
  <Button disabled={busy||loading||!rows.length||!!issue} onClick={()=>void save('approveAvailabilityImport',{csv,...(securityType?{securityType}:{})})}>אישור {rows.length||''} שינויי הזמינות</Button>
 </div>
}
