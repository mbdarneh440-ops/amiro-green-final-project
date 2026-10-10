import {inboxEmailSchema,type InboxEmail} from './email-intake';
export type MakeConfig={MAKE_API_TOKEN?:string;MAKE_DATA_STORE_ID?:string;MAKE_ZONE?:string};
export function makeReady(config:MakeConfig){return !!(config.MAKE_API_TOKEN&&/^\d+$/.test(config.MAKE_DATA_STORE_ID??''));}
const emptyExtraction=(value:unknown)=>value===undefined||value===null||(typeof value==='string'&&!value.trim());
export async function readMakeInbox(config:MakeConfig){
 if(!makeReady(config))throw Error('יש להגדיר מפתח Make ומזהה מאגר בקובץ ההגדרות');
 const zone=config.MAKE_ZONE||'eu1.make.com';if(!['eu1.make.com','eu2.make.com','us1.make.com','us2.make.com'].includes(zone))throw Error('אזור Make אינו תקין');
 const emails:InboxEmail[]=[];let skipped=0,awaitingExtraction=0,offset=0;
 for(let page=0;page<10;page++){
  const url=new URL(`https://${zone}/api/v2/data-stores/${config.MAKE_DATA_STORE_ID}/data`);url.searchParams.set('pg[limit]','100');url.searchParams.set('pg[offset]',String(offset));
  const response=await fetch(url,{headers:{Authorization:'Token '+config.MAKE_API_TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('החיבור ל־Make נכשל. יש לבדוק את המפתח וההרשאה לקריאת המאגר.');
  const body=await response.json() as {records?:{data:unknown}[]};if(!Array.isArray(body.records))throw Error('תשובה לא צפויה מ־Make');
  for(const record of body.records){
   const data=record.data;
   if(data&&typeof data==='object'&&'sourceId' in data&&typeof data.sourceId==='string'){
    const sourceId=data.sourceId.trim();if(sourceId.startsWith('availability:'))continue;
    // Make preserves raw Gmail before AI completes. Do not consume its import-once
    // identity until a result exists; nonempty malformed results still need review.
    if(sourceId.startsWith('gmail:')&&emptyExtraction('extraction' in data?data.extraction:undefined)&&emptyExtraction('extractionJson' in data?data.extractionJson:undefined)){
     const raw=inboxEmailSchema.safeParse({...data,extraction:undefined,extractionJson:undefined});if(raw.success)awaitingExtraction++;else skipped++;
     continue;
    }
   }
   const item=inboxEmailSchema.safeParse(data);if(item.success)emails.push(item.data);else skipped++;
  }
  offset+=body.records.length;if(body.records.length<100)return {emails,skipped,awaitingExtraction};
 }
 throw Error('המאגר גדול מדי לסנכרון אחד. יש להרחיב את מנגנון הסנכרון לפני המשך.');
}
