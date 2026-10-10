import { z } from 'zod';
import { previewImport } from './csv-import';
import { previewAvailability } from './availability-import';
import { dateAdd, extract, plan, weekOf, type State } from './domain';
import {draftFromExtraction,eventRangeIssue,inboxEmailSchema} from './email-intake';
const text=z.string().trim().min(1).max(150), loose=z.string().trim().max(150);
const date=z.string().regex(/^20\d\d-\d\d-\d\d$/).refine(v=>{try{return new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v}catch{return false}},'תאריך לא תקין');
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), end=z.union([time,z.literal('24:00')]);
const money=z.number().finite().min(0).max(1000000), count=z.number().int().min(1).max(1000);
const window=z.object({day:z.number().int().min(0).max(6),start:time,end});
const templates=z.array(z.object({id:text,period:z.enum(['morning','afternoon','night','extra']),securityType:z.enum(['unarmed','armed']),start:time,end,count:count.max(100),days:z.array(z.number().int().min(0).max(6)).min(1).max(7)})).max(64).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'קוד משמרת כפול');
const selections=z.object({periods:z.array(z.enum(['morning','afternoon','night'])).max(3).refine(p=>new Set(p).size===p.length,'משמרת כפולה'),securityType:z.enum(['unarmed','armed'])});
const guard=z.object({id:loose,name:text,phone:loose,wage:money,maxHours:z.number().min(1).max(168),skills:z.array(text).min(1),confirmed:z.boolean(),availability:z.array(window).max(50),exceptions:z.array(z.object({date,available:z.boolean(),start:time,end,mode:z.literal('startDay').optional(),selections:selections.optional()}).refine(e=>!e.selections||(e.mode==='startDay'&&e.available===(e.selections.periods.length>0)),'בחירת משמרות חייבת להישמר כתשובה שבועית')).max(366)});
const site=z.object({id:loose,name:text,organization:text,phone:loose,contact:loose.optional(),address:loose.optional(),kind:z.enum(['fixed','event']),start:time,end,count,days:z.array(z.number().int().min(0).max(6)),date:z.string(),rate:money,skill:text});
const settings=z.object({restHours:z.number().min(0).max(48),travelMinutes:z.number().min(0).max(1440),onCost:z.number().min(0).max(100),overhead:money,tax:z.number().min(0).max(100).nullable(),currency:z.enum(['₪','$','€','JOD'])});
export const envelope=z.object({version:z.number().int().positive(),action:z.string(),payload:z.unknown()});
export class DomainError extends Error {}
const fail=(message:string):never=>{throw new DomainError(message)};
function pending(s:State,id:string){return s.proposals.find(p=>p.id===id&&p.status==='pending')??fail('הבקשה אינה קיימת או שכבר נבדקה');}
function touch(s:State){s.dirtyWeeks=[...new Set([...s.dirtyWeeks,...s.shifts.map(x=>weekOf(x.date))])];}
function checkTemplateDays(site:State['sites'][number],rows:NonNullable<State['sites'][number]['shiftTemplates']>){
  const active=site.kind==='event'?[new Date(site.date+'T00:00:00Z').getUTCDay()]:site.days;
  if(rows.length&&!rows.some(row=>row.days.some(day=>active.includes(day))))fail('ימי המשמרות אינם חופפים לימי הפעילות של האתר. יש לתקן את הימים לפני השמירה.');
}
export function act(s:State,action:string,raw:unknown,actor:string){
  let label='';
  if(action==='queueAvailability'){
    const input=z.array(z.object({sourceId:z.string().min(14).max(200).startsWith('availability:'),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),csv:z.string().min(1).max(16000),name:text,phone:loose,week:date,securityType:z.enum(['unarmed','armed']).optional(),receivedAt:z.string().max(150)}).strict()).max(100).parse(raw);
    s.availabilityReceipts??=[];let added=0;
    for(const item of input){
      if(s.availabilityReceipts.some(r=>r.sourceId===item.sourceId&&r.fingerprint===item.fingerprint))continue;
      if(s.availabilityReceipts.length>=300)fail('תיבת תשובות הזמינות הגיעה למגבלה. יש להרחיב או לארכב אותה לפני קליטה נוספת.');
      s.availabilityReceipts.unshift({...item,id:crypto.randomUUID(),status:'pending'});added++;
    }
    if(!added)return s;
    label='קליטת תשובות זמינות לבדיקה: '+added;
  }else if(action==='approveAvailabilityReceipt'||action==='rejectAvailabilityReceipt'){
    const input=z.object({id:text}).strict().parse(raw),receipt=s.availabilityReceipts?.find(r=>r.id===input.id);
    if(!receipt||receipt.status!=='pending')fail('תשובת הזמינות כבר נבדקה או אינה קיימת.');
    if(action==='approveAvailabilityReceipt')act(s,'approveAvailabilityImport',{csv:receipt!.csv,...(receipt!.securityType?{securityType:receipt!.securityType}:{})},actor);
    receipt!.status=action==='approveAvailabilityReceipt'?'approved':'rejected';receipt!.processedAt=new Date().toISOString();
    label=(action==='approveAvailabilityReceipt'?'אישור':'דחיית')+' תשובת זמינות: '+receipt!.name+' · '+receipt!.week;
  }else if(action==='approveAvailabilityImport'){
    const input=z.object({csv:z.string().min(1).max(50000),securityType:z.enum(['unarmed','armed']).optional()}).parse(raw);
    let records;try{records=previewAvailability(input.csv,s,input.securityType)}catch(e){fail(e instanceof Error?e.message:'קובץ תשובות לא תקין')}
    const updates=new Map<string,State['guards'][number]['exceptions']>();
    for(const r of records!){const g=s.guards.find(g=>g.id===r.guardId)!;const exceptions=(updates.get(g.id)??g.exceptions).filter(x=>x.date!==r.date);exceptions.push({date:r.date,available:r.available,start:r.start,end:r.end,...(r.mode?{mode:r.mode}:{}),...(r.selections?{selections:r.selections}:{})});updates.set(g.id,exceptions);}
    for(const exceptions of updates.values())if(exceptions.length>366)fail('אפשר לשמור עד 366 חריגות זמינות לעובד. יש להסיר תאריכים ישנים לפני הייבוא.');
    for(const [id,exceptions] of updates)s.guards.find(g=>g.id===id)!.exceptions=exceptions;
    for(const r of records!)s.dirtyWeeks.push(weekOf(r.date));
    touch(s);label='אישור תשובות זמינות עובדים: '+records!.length+' תאריכים';
  }else if(action==='importCsv'){
    const input=z.object({kind:z.enum(['workers','sites','events']),csv:z.string().min(1).max(50000)}).parse(raw);
    let imported;try{imported=previewImport(input.kind,input.csv,s)}catch(e){fail(e instanceof Error?e.message:'קובץ לא תקין')}
    if(input.kind==='workers'){
      const entries=imported!.records.map(r=>guard.parse(r));
      for(const entry of entries){const at=s.guards.findIndex(g=>g.id===entry.id);if(at>=0)s.guards[at]=entry;else s.guards.push(entry)}
    }else{
      const entries=imported!.records.map(r=>{const entry=site.parse(r);if(entry.kind==='event')date.parse(entry.date);else if(!entry.days.length)fail('יש לבחור ימי עבודה');checkTemplateDays({...entry,revision:0},s.sites.find(x=>x.id===entry.id)?.shiftTemplates??[]);return entry});
      for(const entry of entries){const at=s.sites.findIndex(x=>x.id===entry.id),old=s.sites[at];const record={...entry,...(old?.shiftTemplates?{shiftTemplates:old.shiftTemplates}:{}),revision:(old?.revision??0)+1};if(at>=0)s.sites[at]=record;else s.sites.push(record)}
    }
    touch(s);label='אישור ייבוא קובץ: '+imported!.records.length+' רשומות';
  }else if(action==='saveSite'){
    const p=site.parse(raw);if(p.kind==='event')date.parse(p.date);else if(!p.days.length)fail('יש לבחור יום עבודה אחד לפחות');
    const old=s.sites.find(x=>x.id===p.id);if(p.id&&!old)fail('האתר אינו קיים');
    const entry={...p,...(old?.shiftTemplates?{shiftTemplates:old.shiftTemplates}:{}),id:old?.id??crypto.randomUUID(),revision:(old?.revision??0)+1};checkTemplateDays(entry,entry.shiftTemplates??[]);s.sites=old?s.sites.map(x=>x.id===old.id?entry:x):[...s.sites,entry];touch(s);label='אישור פרטי האתר: '+p.name;
  }else if(action==='saveShiftTemplates'){
    const p=z.object({siteId:text,templates}).parse(raw),existing=s.sites.find(x=>x.id===p.siteId);
    if(!existing)fail('האתר אינו קיים');
    checkTemplateDays(existing!,p.templates);
    const conflicts=s.overrides.filter(o=>o.siteId===p.siteId&&o.count>0);
    if(p.templates.length&&conflicts.length)fail('קיימים שינויים מאושרים ללא סיווג נשק בתאריכים: '+conflicts.map(o=>o.date).join(', ')+'. יש לבדוק ולבטל אותם לפני הפעלת מבנה המשמרות החדש.');
    existing!.shiftTemplates=p.templates;existing!.revision++;touch(s);label='עדכון מבנה המשמרות: '+existing!.name;
  }else if(action==='saveGuard'){
    const p=guard.parse(raw),old=s.guards.find(x=>x.id===p.id);if(p.id&&!old)fail('המאבטח אינו קיים');
    const entry={...p,id:old?.id??crypto.randomUUID()};s.guards=old?s.guards.map(x=>x.id===old.id?entry:x):[...s.guards,entry];touch(s);label='עדכון פרטי המאבטח והזמינות: '+p.name;
  }else if(action==='saveSettings'){
    s.settings=settings.parse(raw);touch(s);label='עדכון הנחות השיבוץ והחישובים';
  }else if(action==='importEmail'){
    const p=inboxEmailSchema.parse(raw);
    if(s.proposals.some(x=>x.sourceId===p.sourceId))fail('ההודעה כבר קיימת ולא נוספה שוב');
    const draft=p.extraction!==undefined||p.extractionJson!==undefined?draftFromExtraction(p):{...extract(p.body),kind:'new' as const};
    s.proposals.unshift({subject:p.subject,sender:p.sender,...(p.requesterName!==undefined?{requesterName:p.requesterName}:{}),body:p.body,sourceId:p.sourceId,...draft,id:crypto.randomUUID(),siteId:'',siteRevision:0,status:'pending',received:p.receivedAt??new Date().toISOString()});label='ייבוא הודעה לבדיקה: '+p.subject;
  }else if(action==='saveProposal'){
    const p=z.object({id:text,kind:z.enum(['new','change','cancel']),siteId:loose,organization:loose,siteName:loose.optional(),contactName:loose.optional(),requestSummary:z.string().trim().max(1000).optional(),phone:loose,date:z.string().max(20),endDate:z.string().max(20).optional(),start:z.string().max(5),end:z.string().max(5),count:z.number().int().min(0).max(1000),rate:money}).parse(raw);
    const old=pending(s,p.id),existing=s.sites.find(x=>x.id===p.siteId);if(p.kind!=='new'&&!existing)fail('יש לבחור את האתר שברצונך לשנות');
    Object.assign(old,p,{siteRevision:existing?.revision??0});if(old.intake)old.intake.reviewed=true;label='שמירת טיוטת בקשה: '+old.subject;
  }else if(action==='approveProposal'){
    const p=pending(s,z.object({id:text}).parse(raw).id);
    if(p.intake?.isAutomated||p.intake?.requestType==='unrelated')fail('זו הודעה אוטומטית או לא קשורה שנשמרה למעקב. היא אינה בקשת אבטחה לאישור.');
    date.parse(p.date);time.parse(p.start);end.parse(p.end);
    if(p.endDate){date.parse(p.endDate);const issue=eventRangeIssue(p);if(issue)fail(issue);}
    if(p.intake?.rangeNeedsReview&&!p.intake.reviewed)fail('יש לבדוק את טווח האירוע המקורי ולשמור טיוטה מתוקנת לפני האישור.');
    if(p.kind!=='cancel'){count.parse(p.count);if(!p.organization)fail('יש למלא את שם הארגון');if(p.rate<=0)fail('יש למלא תעריף לשעה לפני האישור');}
    let existing=s.sites.find(x=>x.id===p.siteId);
    if(p.kind!=='new'){
      if(!existing||p.siteRevision!==existing.revision)fail('פרטי האתר השתנו. יש לפתוח את הבקשה, לבדוק אותה ולשמור שוב את הטיוטה');
      if(p.kind==='change'&&existing?.shiftTemplates?.length)fail('באתר זה מוגדרות משמרות עם ובלי נשק. יש לעדכן את השעות והכמויות במסך מבנה המשמרות; הבקשה נשארת לבדיקה.');
      if(s.shifts.some(x=>x.siteId===existing!.id&&x.date===p.date&&x.actualHours!==null))fail('כבר דווחו שעות בפועל ביום הזה. לא ניתן לשנות את דרישות האבטחה לאחר דיווח השעות');
    }else{
      existing={id:crypto.randomUUID(),name:p.siteName||p.organization,organization:p.organization,phone:p.phone,kind:'event',date:p.date,days:[],start:p.start,end:p.end,count:p.count,rate:p.rate,skill:'כללי',revision:1};s.sites.push(existing);p.siteId=existing.id;
    }
    if(p.kind!=='new'){
      s.overrides=s.overrides.filter(x=>!(x.siteId===existing!.id&&x.date===p.date));s.overrides.push({siteId:existing!.id,date:p.date,start:p.start,end:p.end,count:p.kind==='cancel'?0:p.count,rate:p.rate});existing!.revision++;
    }
    p.status='approved';touch(s);s.dirtyWeeks=[...new Set([...s.dirtyWeeks,weekOf(p.date)])];label='אישור בקשה: '+p.subject;
  }else if(action==='rejectProposal'){
    const p=pending(s,z.object({id:text}).parse(raw).id);p.status='rejected';label='דחיית בקשה: '+p.subject;
  }else if(action==='approvePlan'){
    const p=z.object({week:date}).parse(raw);if(weekOf(p.week)!==p.week)fail('השבוע חייב להתחיל ביום ראשון');
    const draft=plan(s,p.week);if(!draft.length&&!s.shifts.some(x=>x.date>=p.week&&x.date<dateAdd(p.week,7)))fail('אין דרישות אבטחה לשבוע הזה');
    s.shifts=[...s.shifts.filter(x=>x.date<p.week||x.date>=dateAdd(p.week,7)),...draft];s.dirtyWeeks=s.dirtyWeeks.filter(x=>x!==p.week);label='אישור סידור העבודה לשבוע '+p.week;
  }else if(action==='reportHours'||action==='approveHours'){
    const p=z.object({id:text,hours:z.number().finite().min(0).max(24)}).parse(raw),shift=s.shifts.find(x=>x.id===p.id);if(!shift?.guardId)fail('לא שובץ מאבטח למשמרת הזו');
    shift!.actualHours=p.hours;shift!.actualApproved=action==='approveHours';label=(shift!.actualApproved?'אישור':'דיווח')+' שעות בפועל: '+p.hours;
  }else fail('פעולה לא נתמכת');
  s.audit.unshift({at:new Date().toISOString(),actor,action:label});return s;
}
