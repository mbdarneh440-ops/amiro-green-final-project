import {z} from 'zod';

export const acknowledgementText='פנייתך התקבלה ונשמרה לבדיקה. אין בכך אישור לשירותי אבטחה או לשיבוץ מאבטחים. נחזור אליך לאחר בדיקת מנהל.';
const receivedAt=z.string().datetime({offset:true});
export const inboxEmailSchema=z.object({
 sourceId:z.string().trim().min(1).max(200),subject:z.string().trim().min(1).max(150),sender:z.string().trim().email().max(200),requesterName:z.string().max(150).optional(),body:z.string().min(1).max(16000),receivedAt:z.string().max(100).optional().nullable(),
 extraction:z.unknown().optional(),extractionJson:z.string().max(12000).optional(),
});
export const emailIntakeSchema=inboxEmailSchema.extend({sourceId:z.string().trim().regex(/^[A-Za-z0-9:_-]{1,180}$/),receivedAt}).strict();
export type InboxEmail=z.infer<typeof inboxEmailSchema>;
export type RequestType='new_request'|'update'|'cancellation'|'unrelated'|'unclear';
export type Acknowledgement={status:'pending'|'reserved'|'sent'|'uncertain';reservationId?:string;replyId?:string;updatedAt:string};
export type IntakeMetadata={requestType:RequestType;isAutomated?:boolean;extractionStatus:'validated'|'needs_review'|'failed';missingFields:string[];warnings:string[];sourceEvidence:Record<string,string>;rangeNeedsReview:boolean;reviewed?:boolean;acknowledgement?:Acknowledgement};
export type EmailDraft={kind:'new'|'change'|'cancel';organization:string;siteName:string;contactName:string;requestSummary:string;phone:string;date:string;endDate:string;start:string;end:string;count:number;rate:number;intake:IntakeMetadata};
const fact=z.string().trim().max(150).default('');
const numeric=z.union([z.string().trim().max(50),z.number().finite()]).default('');
const extractionSchema=z.object({
 request_type:z.enum(['new_request','update','cancellation','unrelated','unclear']),is_automated:z.union([z.boolean(),z.enum(['true','false'])]).default(false),organization:fact,site:fact,contact_name:fact,request_summary:z.string().trim().max(1000).default(''),contact_phone:fact,phone:fact,start_date:fact,end_date:fact,start_time:fact,end_time:fact,guard_count:numeric,hourly_rate:numeric,
 missing_fields:z.union([z.string().max(1000),z.array(z.string().max(100)).max(20)]).default(''),ambiguities:z.string().trim().max(2000).default(''),source_evidence:z.union([z.string().max(8000),z.record(z.string().max(1000))]).default({}),
}).strict();
const fieldNames=['organization','site','contact_name','request_summary','contact_phone','phone','start_date','end_date','start_time','end_time','guard_count','hourly_rate'];
export const intakeFieldLabels:Record<string,string>={organization:'שם הארגון',site:'מקום האירוע',contact_name:'שם איש הקשר',request_summary:'תיאור הבקשה',contact_phone:'מספר הטלפון',phone:'מספר הטלפון',start_date:'תאריך התחלה',end_date:'תאריך סיום',start_time:'שעת התחלה',end_time:'שעת סיום',guard_count:'מספר המאבטחים',hourly_rate:'תעריף לשעה'};
const compact=(value:string)=>value.replace(/\s+/g,' ').trim();
export function validDate(value:string){if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;try{return new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}catch{return false}}
function datesIn(value:string){
 const dates:string[]=[];
 for(const match of value.matchAll(/(?:^|[^\d])(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)|(?:^|[^\d])(\d{1,2})[/.](\d{1,2})[/.](20\d{2})(?!\d)/g)){
  const date=match[1]?`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`:`${match[6]}-${match[5].padStart(2,'0')}-${match[4].padStart(2,'0')}`;
  if(validDate(date))dates.push(date);
 }
 return dates;
}
const numberWords:Record<number,string[]>={1:['אחד','אחת'],2:['שני','שניים','שתי','שתיים'],3:['שלושה','שלוש'],4:['ארבעה','ארבע'],5:['חמישה','חמש'],6:['שישה','שש'],7:['שבעה','שבע'],8:['שמונה'],9:['תשעה','תשע'],10:['עשרה','עשר']};
function fieldNumberIn(quote:string,value:number,key:'guard_count'|'hourly_rate'){
 const token='([-+]?\\d+(?:,\\d{3})*(?:\\.\\d+)?)',guards='(?:מאבטח(?:ים|ות)?|שומר(?:ים|ות)?|אנשי אבטחה)';
 const patterns=key==='guard_count'?[new RegExp('(?:^|[^\\d/.:,+-])'+token+'\\s*'+guards+'(?![\\p{L}\\p{N}])','gu'),new RegExp('(?:כמות|מספר(?:\\s+'+guards+')?)\\s*[:：]?\\s*'+token+'(?![\\d/.:,+-])','gu')]:[new RegExp('(?:^|[^\\d/.:,+-])'+token+'\\s*(?:₪|ש["״\u0027]?ח|שקל(?:ים)?|NIS|USD|לשעה)(?![\\p{L}\\p{N}])','giu'),new RegExp('(?:תעריף|מחיר לשעה)\\s*[:：]?\\s*'+token+'(?![\\d/.:,+-])','gu')];
 if(patterns.some(pattern=>[...quote.matchAll(pattern)].some(match=>Number(match[1].replaceAll(',',''))===value)))return true;
 return key==='guard_count'&&(numberWords[value]??[]).some(word=>new RegExp('(?:^|[^\\p{L}\\p{N}])'+word+'\\s+'+guards,'u').test(quote));
}
function timeIn(quote:string,value:string){
 const [hour,minute]=value.split(':').map(Number);
 if([...quote.matchAll(/(?:^|[^\d/.:,-])(\d{1,2})([:.])(\d{2})(?![\d/.:,-])/g)].some(match=>Number(match[1])===hour&&Number(match[3])===minute&&(match[2]===':'||/שעה|משעה|עד|ב[-־]|בין|מ[-־]/.test(quote))))return true;
 return minute===0&&[...quote.matchAll(/(?:שעה|משעה|עד|ב[-־]|בין|מ[-־])\s*(\d{1,2})(?![\d/.:,+-])/g)].some(match=>Number(match[1])===hour);
}
export function eventRangeIssue(event:{date:string;endDate?:string;start:string;end:string}){
 if(!event.endDate)return '';
 if(!validDate(event.date)||!validDate(event.endDate))return 'יש לבדוק ולתקן את תאריכי תחילת האירוע וסיומו.';
 const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3)),start=minutes(event.start),end=minutes(event.end);
 if(event.endDate===event.date)return end<=start?'תאריך הסיום זהה לתאריך ההתחלה, אך שעת הסיום אינה מאוחרת יותר. יש לתקן את טווח האירוע.':'';
 const next=new Date(Date.parse(event.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 if(event.endDate===next&&end<=start)return '';
 return 'האירוע כולל טווח של כמה ימים שאינו מיוצג בבקשה יומית אחת. יש לפצל לבקשות יומיות או לתקן את הטווח לפני האישור.';
}
function emptyDraft(message:string):EmailDraft{return {kind:'new',organization:'',siteName:'',contactName:'',requestSummary:'',phone:'',date:'',endDate:'',start:'',end:'',count:0,rate:0,intake:{requestType:'unclear',extractionStatus:'failed',missingFields:['organization','start_date','start_time','end_time','guard_count','hourly_rate'],warnings:[message],sourceEvidence:{},rangeNeedsReview:true}};}

// Model output supplies suggestions only. Every accepted fact needs a quote
// from the original email and evidence of its normalized value.
export function draftFromExtraction(mail:InboxEmail):EmailDraft{
 let raw:unknown=mail.extraction;
 if(raw!==undefined&&mail.extractionJson!==undefined)return emptyDraft('התקבלו שתי גרסאות חילוץ. יש לבדוק את ההודעה המקורית ולמלא את הפרטים.');
 if(mail.extractionJson!==undefined)try{raw=JSON.parse(mail.extractionJson)}catch{return emptyDraft('תוצאת החילוץ אינה JSON תקין. ההודעה המקורית נשמרה לבדיקה.');}
 const parsed=extractionSchema.safeParse(raw);
 if(!parsed.success)return emptyDraft('לא התקבלה תוצאת חילוץ תקינה. ההודעה המקורית נשמרה לבדיקה ידנית.');
 const result=parsed.data,warnings:string[]=[],missing=new Set<string>();let rawEvidence:unknown=result.source_evidence;
 if(typeof rawEvidence==='string')try{rawEvidence=JSON.parse(rawEvidence)}catch{rawEvidence={};warnings.push('לא ניתן לקרוא את ראיות החילוץ.');}
 const evidence:Record<string,string>={};
 if(rawEvidence&&typeof rawEvidence==='object'&&!Array.isArray(rawEvidence))for(const key of fieldNames){const quote=(rawEvidence as Record<string,unknown>)[key];if(typeof quote==='string'&&quote.length<=1000&&quote.trim()&&(mail.body.includes(quote)||(key!=='contact_name'&&key!=='request_summary'&&mail.subject.includes(quote))))evidence[key]=quote;}
 const supported=(key:string,value:string,check:(quote:string)=>boolean)=>{
  if(!value)return '';
  const quote=evidence[key];if(!quote||!check(quote)){warnings.push('הערך של '+intakeFieldLabels[key]+' לא נתמך בראיה תואמת מההודעה המקורית ונשאר ריק.');return '';}
  return value;
 };
 const textual=(key:'organization'|'site'|'contact_name'|'request_summary'|'phone'|'contact_phone')=>supported(key,result[key],quote=>key==='phone'||key==='contact_phone'?quote.replace(/\D/g,'').includes(result[key].replace(/\D/g,''))&&/\d/.test(result[key]):key==='request_summary'?quote.includes(result[key]):compact(quote).includes(compact(result[key])));
 const date=(key:'start_date'|'end_date')=>supported(key,result[key],quote=>validDate(result[key])&&datesIn(quote).includes(result[key]));
 const time=(key:'start_time'|'end_time')=>supported(key,result[key],quote=>(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result[key])||(key==='end_time'&&result[key]==='24:00'))&&timeIn(quote,result[key]));
 const number=(key:'guard_count'|'hourly_rate')=>{const rawValue=String(result[key]),value=Number(rawValue),valid=/^\d+(?:\.\d+)?$/.test(rawValue)&&Number.isFinite(value)&&value>0&&(key==='guard_count'?Number.isInteger(value)&&value<=1000:value<=1000000);return valid&&supported(key,rawValue,quote=>fieldNumberIn(quote,value,key))?value:0;};
 const draft:EmailDraft={kind:result.request_type==='update'?'change':result.request_type==='cancellation'?'cancel':'new',organization:textual('organization'),siteName:textual('site'),contactName:textual('contact_name'),requestSummary:textual('request_summary'),phone:textual(result.contact_phone?'contact_phone':'phone'),date:date('start_date'),endDate:date('end_date'),start:time('start_time'),end:time('end_time'),count:number('guard_count'),rate:number('hourly_rate'),intake:{requestType:result.request_type,isAutomated:result.is_automated===true||result.is_automated==='true',extractionStatus:'validated',missingFields:[],warnings,sourceEvidence:evidence,rangeNeedsReview:false}};
 if(result.ambiguities)warnings.push(result.ambiguities);
 if(result.request_type==='unrelated'){warnings.push('החילוץ זיהה הודעה שאינה בקשת אבטחה. יש לבדוק ולדחות אם אינה קשורה.');Object.assign(draft,{organization:'',siteName:'',contactName:'',requestSummary:'',phone:'',date:'',endDate:'',start:'',end:'',count:0,rate:0});}
 if(result.request_type==='unclear')warnings.push('סוג הבקשה אינו ברור. יש לבחור את הסוג המתאים בבדיקה ידנית.');
 if(draft.intake.isAutomated)warnings.push('זו הודעה אוטומטית שנשמרה למעקב. אישור בקשה תפעולית ושליחת הודעת קבלה אוטומטית חסומים.');
 if(draft.kind!=='new')warnings.push('יש לבחור את האתר הרלוונטי ולבדוק את הדרישה הקיימת לפני אישור שינוי או ביטול.');
 const suppliedMissing=Array.isArray(result.missing_fields)?result.missing_fields:result.missing_fields.split(',');
 const draftKeys:Record<string,'organization'|'siteName'|'contactName'|'requestSummary'|'phone'|'date'|'endDate'|'start'|'end'|'count'|'rate'>={organization:'organization',site:'siteName',contact_name:'contactName',request_summary:'requestSummary',contact_phone:'phone',phone:'phone',start_date:'date',end_date:'endDate',start_time:'start',end_time:'end',guard_count:'count',hourly_rate:'rate'};
 for(const key of suppliedMissing.map(value=>value.trim()))if(fieldNames.includes(key)){missing.add(key);const field=draftKeys[key];if(field==='count'||field==='rate')draft[field]=0;else draft[field]='';warnings.push('החילוץ סימן את '+intakeFieldLabels[key]+' כחסר או סותר, ולכן הערך נשאר ריק.');}
 for(const [key,value] of Object.entries({organization:draft.organization,start_date:draft.date,start_time:draft.start,end_time:draft.end,guard_count:draft.count,hourly_rate:draft.rate}))if(!value)missing.add(key);
 const range=eventRangeIssue(draft);if(range)warnings.push(range);
 draft.intake.rangeNeedsReview=!!range||!!result.end_date&&!draft.endDate;
 if(draft.intake.rangeNeedsReview&&!range)warnings.push('לא ניתן לאמת את תאריך הסיום שהופיע בחילוץ. יש לבדוק את טווח האירוע המקורי.');
 draft.intake.missingFields=[...missing];draft.intake.extractionStatus=missing.size||warnings.length?'needs_review':'validated';return draft;
}

export type EmailIntakeConfig={MAKE_INBOX_WEBHOOK_SECRET?:string;INBOX_OWNER_ID?:string};
export function emailIntakeReady(config:EmailIntakeConfig){return (config.MAKE_INBOX_WEBHOOK_SECRET?.trim().length??0)>=32&&!!config.INBOX_OWNER_ID?.trim()&&config.INBOX_OWNER_ID.trim().length<=200;}
export async function authenticatedIntake(request:Request,config:EmailIntakeConfig){
 if(!emailIntakeReady(config))return false;
 const authorization=request.headers.get('authorization')??'';if(!authorization.startsWith('Bearer ')||authorization.length>2048)return false;
 const encoder=new TextEncoder(),hash=(value:string)=>crypto.subtle.digest('SHA-256',encoder.encode(value));
 const [supplied,expected]=await Promise.all([hash(authorization.slice(7)),hash(config.MAKE_INBOX_WEBHOOK_SECRET!.trim())]);
 const a=new Uint8Array(supplied),b=new Uint8Array(expected);let difference=0;for(let index=0;index<a.length;index++)difference|=a[index]^b[index];return difference===0;
}
export class EmailIntakeError extends Error {constructor(message:string,public status=400){super(message);}}
export const maxEmailIntakeBytes=96000;
export async function intakeJsonBody(request:Request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new EmailIntakeError('יש לשלוח JSON בלבד.',415);
 const size=Number(request.headers.get('content-length'));if(Number.isFinite(size)&&size>maxEmailIntakeBytes)throw new EmailIntakeError('ההודעה חורגת מהגודל המותר.',413);
 const reader=request.body?.getReader();if(!reader)throw new EmailIntakeError('חסר תוכן הודעה.');
 const chunks:Uint8Array[]=[];let total=0;
 for(;;){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>maxEmailIntakeBytes){await reader.cancel();throw new EmailIntakeError('ההודעה חורגת מהגודל המותר.',413);}chunks.push(chunk.value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{throw new EmailIntakeError('מבנה ההודעה אינו תקין.');}
}
export async function intakeRequestBody(request:Request){try{return emailIntakeSchema.parse(await intakeJsonBody(request));}catch(error){if(error instanceof EmailIntakeError)throw error;throw new EmailIntakeError('מבנה ההודעה אינו תקין.');}}
