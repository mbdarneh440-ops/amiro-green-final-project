import type { Guard, Site, State } from './domain';
export type ImportKind='workers'|'sites'|'events';
const weekdays=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
export function parseCsv(input:string):Record<string,string>[] {
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
 const text=input.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else if(!quoted&&field)throw Error('מרכאות לא תקינות בקובץ');else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field=''}else field+=c;}
 if(quoted)throw Error('מרכאות פתוחות בקובץ');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
 const headers=rows.shift()?.map(h=>h.trim());if(!headers?.length||new Set(headers).size!==headers.length)throw Error('כותרות חסרות או כפולות');
 if(!rows.length)throw Error('הקובץ אינו מכיל נתונים');
 return rows.map((values,i)=>{if(values.length!==headers.length)throw Error(`מספר העמודות בשורה ${i+2} אינו תקין`);return Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]))});
}
const required=(row:Record<string,string>,key:string)=>{if(!row[key])throw Error('חסר ערך בעמודה: '+key);return row[key]};
const number=(row:Record<string,string>,key:string)=>{const v=Number(required(row,key));if(!Number.isFinite(v)||v<0)throw Error('מספר לא תקין: '+key);return v};
const parts=(s:string)=>s.split(';').map(x=>x.trim()).filter(Boolean);
export function previewImport(kind:ImportKind,csv:string,state:State):{records:(Guard|Site)[];added:number;updated:number;rows:number}{
 const rows=parseCsv(csv);const records:(Guard|Site)[]=[];const seen=new Map<string,Guard|Site>();
 for(const r of rows){
  if(kind==='workers'){
   const code=required(r,'קוד_עובד'),id='csv-worker:'+code;
   const confirmed=required(r,'זמינות_מאושרת');if(!['כן','לא'].includes(confirmed))throw Error('זמינות_מאושרת חייבת להיות כן או לא');
   const day=weekdays.indexOf(required(r,'יום'));if(day<0)throw Error('יום לא מוכר: '+r['יום']);
   const data={id,name:required(r,'שם'),phone:r['טלפון']??'',wage:number(r,'שכר_לשעה'),maxHours:number(r,'מקסימום_שעות_בשבוע'),skills:parts(required(r,'מיומנויות')),confirmed:confirmed==='כן'};
   const w={day,start:required(r,'משעה'),end:required(r,'עד_שעה')};const old=seen.get(id) as Guard|undefined;
   if(old){const base={...old};delete (base as Partial<Guard>).availability;delete (base as Partial<Guard>).exceptions;if(JSON.stringify(base)!==JSON.stringify(data))throw Error('פרטי עובד שונים בין שורות עם אותו קוד: '+code);old.availability.push(w)}else{const g={...data,availability:[w],exceptions:state.guards.find(g=>g.id===id)?.exceptions??[]};seen.set(id,g);records.push(g)}
  }else{
   const event=kind==='events',id=(event?'csv-event:':'csv-site:')+required(r,event?'קוד_אירוע':'קוד_אתר');if(seen.has(id))throw Error('קוד אתר או אירוע מופיע פעמיים: '+id);
   const activeDays=event?[]:parts(required(r,'ימים')).map(d=>{const day=weekdays.indexOf(d);if(day<0)throw Error('יום לא מוכר: '+d);return day});
   const s:Site={id,name:required(r,event?'שם_אירוע':'שם_אתר'),organization:required(r,'ארגון'),phone:r['טלפון']??'',contact:r['איש_קשר']??'',address:r['כתובת']??'',kind:event?'event':'fixed',date:event?required(r,'תאריך'):'',days:activeDays,start:required(r,'משעה'),end:required(r,'עד_שעה'),count:number(r,'מספר_מאבטחים'),rate:number(r,'תעריף_לשעה'),skill:required(r,'מיומנות'),revision:0};records.push(s);seen.set(id,s);
  }
 }
 const existing=kind==='workers'?state.guards:state.sites;const updated=records.filter(r=>existing.some(e=>e.id===r.id)).length;
 return {records,added:records.length-updated,updated,rows:rows.length};
}
