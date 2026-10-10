import {AVAILABILITY_HEADERS,parseAvailabilityBody,MakeAvailabilityError} from './make-availability';
import {availabilityGridHeaders,automaticWeekHeader} from './availability-import';
import type {AvailabilityReceipt,SecurityType} from './domain';
export type AvailabilityBatch=Omit<AvailabilityReceipt,'id'|'status'|'processedAt'>;
const cell=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const invalid=()=>new MakeAvailabilityError('תשובת זמינות אינה תקינה. יש לבדוק את מיפוי הטופס; הנתונים הקיימים לא שונו.');
function submissionWeek(value:unknown){
 if(typeof value!=='string')throw invalid();let day='';
 if(/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)&&Number.isFinite(Date.parse(value)))day=new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});
 else{const match=/^(\d{1,2})\/(\d{1,2})\/(20\d{2})(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/.exec(value);if(match)day=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;}
 if(!day||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw invalid();
 const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-date.getUTCDay());return date.toISOString().slice(0,10);
}
export async function availabilityBatches(records:unknown[]):Promise<AvailabilityBatch[]>{
 const batches:AvailabilityBatch[]=[],seen=new Set<string>();
 for(const record of records){
  if(!object(record)||!object(record.data))continue;const data=record.data;
  if(typeof data.sourceId!=='string'||!data.sourceId.startsWith('availability:'))continue;
  if(data.sender!=='Google Forms'||data.sourceId.length>200||seen.has(data.sourceId)||typeof data.body!=='string'||data.body.length>16000)throw invalid();seen.add(data.sourceId);
  if(typeof data.requestType==='string'&&data.requestType.startsWith('availability.')&&!['availability.unarmed','availability.armed'].includes(data.requestType))throw invalid();
  let securityType:SecurityType|undefined,values:string[],headers:string[],week:string;
  if(data.requestType==='availability.unarmed'||data.requestType==='availability.armed'){
   securityType=data.requestType==='availability.unarmed'?'unarmed':'armed';
   if(data.subject!==(securityType==='unarmed'?'זמינות שבועית · א':'זמינות שבועית · ב'))throw invalid();
   const expected=[...AVAILABILITY_HEADERS,automaticWeekHeader],lines=data.body.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n'),fields=new Map<string,string>();
   if(lines.length!==11||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.body))throw invalid();
   for(const line of lines){const at=line.indexOf(':'),key=line.slice(0,at).trim();if(at<0||!expected.includes(key)||fields.has(key))throw invalid();fields.set(key,line.slice(at+1).trim());}
   if(expected.some(key=>!fields.has(key)))throw invalid();values=expected.map(key=>fields.get(key)!);
   if(!values[0]||!values[1])throw invalid();
   // A new Sheets formula may not have recalculated when Watch Rows first fires.
   // Recover only from that row's original submission date, never today's clock.
   if(!values[2]&&!values[10])values[10]=submissionWeek(data.receivedAt);
   headers=[...AVAILABILITY_HEADERS.slice(0,3),...availabilityGridHeaders,automaticWeekHeader];week=values[10]||values[2];
  }else{
   values=parseAvailabilityBody(data.body);headers=[...AVAILABILITY_HEADERS];week=values[2];
   if(/^\d{1,2}\/\d{1,2}\/20\d{2}$/.test(week)){const [m,d,y]=week.split('/');week=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;}
  }
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(week)||!Number.isFinite(Date.parse(week+'T00:00:00Z'))||new Date(week+'T00:00:00Z').toISOString().slice(0,10)!==week||new Date(week+'T00:00:00Z').getUTCDay()!==0)throw invalid();
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([data.body,securityType??'legacy']))))).map(b=>b.toString(16).padStart(2,'0')).join('');
  batches.push({sourceId:data.sourceId,fingerprint,csv:[headers,values].map(row=>row.map(cell).join(',')).join('\r\n'),name:values[0],phone:values[1],week,...(securityType?{securityType}:{}),receivedAt:typeof data.receivedAt==='string'?data.receivedAt:''});
  if(batches.length>100)throw new MakeAvailabilityError('יש לקלוט עד 100 תשובות זמינות בכל סנכרון.');
 }
 return batches;
}
