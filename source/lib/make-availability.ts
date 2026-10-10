import {makeReady, type MakeConfig} from './make';
import {availabilityBatches,type AvailabilityBatch} from './availability-receipts';

export const AVAILABILITY_HEADERS=[
 'שם מלא','מספר טלפון','תאריך תחילת השבוע (יום ראשון)',
 'יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','יום שבת',
] as const;

export class MakeAvailabilityError extends Error {}
const invalid=()=>new MakeAvailabilityError('אחת מתשובות הזמינות ב־Make אינה במבנה התקין. לא יובאו נתונים. יש לבדוק את מיפוי השדות בתרחיש.');
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** This transport format is data only; every line must name one known form field. */
export function parseAvailabilityBody(body:unknown):string[]{
 if(typeof body!=='string'||body.length>16000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body))throw invalid();
 const lines=body.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n');
 if(lines.length!==AVAILABILITY_HEADERS.length)throw invalid();
 const values=new Map<string,string>();
 for(const line of lines){
  const separator=line.indexOf(':');if(separator<0)throw invalid();
  const header=line.slice(0,separator).trim();
  if(!AVAILABILITY_HEADERS.some(expected=>expected===header)||values.has(header))throw invalid();
  values.set(header,line.slice(separator+1).trim());
 }
 if(AVAILABILITY_HEADERS.some(header=>!values.has(header)))throw invalid();
 if(!values.get('שם מלא')||!values.get('מספר טלפון')||!values.get('תאריך תחילת השבוע (יום ראשון)'))throw invalid();
 return AVAILABILITY_HEADERS.map(header=>values.get(header)!);
}

const csvCell=(value:string)=>'"'+value.replace(/"/g,'""')+'"';

/** Validate the entire batch before returning anything to the review screen. */
export function availabilityRecordsToCsv(records:unknown[]):{csv:string;count:number}{
 const rows:string[][]=[];const seen=new Set<string>();
 for(const record of records){
  if(!isObject(record)||!isObject(record.data))continue;
  const data=record.data;
  if(typeof data.sourceId!=='string'||!data.sourceId.startsWith('availability:'))continue;
  if(data.sourceId.length<=13||data.sourceId.length>200||data.sender!=='Google Forms'||seen.has(data.sourceId))throw invalid();
  seen.add(data.sourceId);
  rows.push(parseAvailabilityBody(data.body));
  if(rows.length>100)throw new MakeAvailabilityError('נמצאו יותר מ־100 תשובות זמינות. יש לצמצם את התשובות במאגר לפני הייבוא. לא יובאו נתונים.');
 }
 return {csv:[Array.from(AVAILABILITY_HEADERS),...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'),count:rows.length};
}

export async function readMakeAvailability(config:MakeConfig,fetcher:typeof fetch=fetch):Promise<{csv:string;count:number;batches:AvailabilityBatch[]}>{
 if(!makeReady(config))throw new MakeAvailabilityError('יש להגדיר מפתח Make ומזהה מאגר בקובץ ההגדרות');
 const zone=config.MAKE_ZONE||'eu1.make.com';
 if(!['eu1.make.com','eu2.make.com','us1.make.com','us2.make.com'].includes(zone))throw new MakeAvailabilityError('אזור Make אינו תקין');
 const records:unknown[]=[];let offset=0;
 for(let page=0;page<10;page++){
  const url=new URL(`https://${zone}/api/v2/data-stores/${config.MAKE_DATA_STORE_ID}/data`);
  url.searchParams.set('pg[limit]','100');url.searchParams.set('pg[offset]',String(offset));
  let response:Response;
  try{response=await fetcher(url,{headers:{Authorization:'Token '+config.MAKE_API_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(12000)});}
  catch{throw new MakeAvailabilityError('החיבור ל־Make לא הושלם. אפשר לנסות שוב. לא שונו נתונים.');}
  if(!response.ok)throw new MakeAvailabilityError('החיבור ל־Make נכשל. יש לבדוק את המפתח וההרשאה לקריאת המאגר.');
  let body:unknown;try{body=await response.json();}catch{throw new MakeAvailabilityError('תשובה לא צפויה מ־Make');}
  if(!isObject(body)||!Array.isArray(body.records)||body.records.length>100)throw new MakeAvailabilityError('תשובה לא צפויה מ־Make');
  records.push(...body.records);offset+=body.records.length;
  if(body.records.length<100){
   const batches=await availabilityBatches(records),legacy=records.filter(record=>isObject(record)&&isObject(record.data)&&!String(record.data.requestType??'').startsWith('availability.'));
   return {csv:availabilityRecordsToCsv(legacy).csv,count:batches.length,batches};
  }
 }
 throw new MakeAvailabilityError('המאגר גדול מדי לסנכרון אחד. יש להרחיב את מנגנון הסנכרון לפני המשך.');
}
