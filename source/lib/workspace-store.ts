import {seed,normalizeCalendar,type State,type Proposal} from './domain';
import {act} from './actions';
import {EmailIntakeError,emailIntakeSchema,draftFromExtraction,acknowledgementText,type InboxEmail,type Acknowledgement} from './email-intake';
import {z} from 'zod';

export type WorkspaceDb={prepare(query:string):{bind(...values:unknown[]):{first<T>():Promise<T|null>;run():Promise<{meta:{changes:number}}>}}};
export type WorkspaceRow={version:number;state:State};
export async function loadWorkspace(db:WorkspaceDb,owner:string,create=true):Promise<WorkspaceRow>{
 if(create)await db.prepare('INSERT OR IGNORE INTO workspaces (owner_id,version,data,updated_at) VALUES (?,1,?,?)').bind(owner,JSON.stringify(seed()),new Date().toISOString()).run();
 let row=await db.prepare('SELECT version,data FROM workspaces WHERE owner_id=?').bind(owner).first<{version:number;data:string}>();
 if(!row)throw new EmailIntakeError('סביבת היעד אינה קיימת. יש לפתוח תחילה את סביבת המנהל ולבדוק את מזהה הבעלים.',503);
 const original=JSON.parse(row.data) as State;
 if(create&&row.version===1&&original.audit.length===0&&original.shifts.length===0&&original.sites[0]?.name==='\u0627\u0644\u0643\u0646\u064a\u0648\u0646'){
  const data=JSON.stringify(seed()),changed=await db.prepare('UPDATE workspaces SET data=? WHERE owner_id=? AND version=1').bind(data,owner).run();if(changed.meta.changes===1)row={version:1,data};
 }
 return {version:row.version,state:normalizeCalendar(JSON.parse(row.data) as State)};
}
export async function saveWorkspace(db:WorkspaceDb,owner:string,row:WorkspaceRow,next:State){
 const data=JSON.stringify(next);if(new TextEncoder().encode(data).byteLength>1500000)throw new EmailIntakeError('סביבת העבודה הגיעה למגבלת האחסון. ההודעה לא נשמרה.',413);
 const result=await db.prepare('UPDATE workspaces SET data=?,version=version+1,updated_at=? WHERE owner_id=? AND version=?').bind(data,new Date().toISOString(),owner,row.version).run();return result.meta.changes===1;
}
export type EmailReceipt={receiptId:string;status:'recorded';reviewStatus:Proposal['status'];duplicate:boolean;acknowledgementStatus:Acknowledgement['status']|'not_requested';acknowledgementNeeded:boolean;acknowledgementText?:string};
function receipt(proposal:Proposal,duplicate:boolean):EmailReceipt{
 const status=proposal.intake?.acknowledgement?.status??'not_requested',needed=status==='pending';return {receiptId:proposal.id,status:'recorded',reviewStatus:proposal.status,duplicate,acknowledgementStatus:status,acknowledgementNeeded:needed,...(needed?{acknowledgementText}:{})};
}
function duplicateReceipt(existing:Proposal,mail:InboxEmail):EmailReceipt{
 if(existing.subject!==mail.subject||existing.sender!==mail.sender||existing.body!==mail.body||(existing.requesterName!==undefined&&existing.requesterName!==(mail.requesterName??'')))throw new EmailIntakeError('מזהה המקור כבר קיים עם תוכן אחר. הרשומה הקיימת לא שונתה.',409);
 return receipt(existing,true);
}
export async function recordIntake(db:WorkspaceDb,owner:string,payload:unknown):Promise<EmailReceipt>{
 const mail=emailIntakeSchema.parse(payload),sourceId='make:'+mail.sourceId;
 for(let attempt=0;attempt<3;attempt++){
  // An inbound token never creates a new isolated demonstration workspace.
  const row=await loadWorkspace(db,owner,false),existing=row.state.proposals.find(proposal=>proposal.sourceId===sourceId);
  if(existing)return duplicateReceipt(existing,mail);
  const next=structuredClone(row.state),draft=draftFromExtraction(mail);
  // A missing/invalid model result still preserves the original message as a
  // blank pending draft, never as a trusted legacy structured extraction.
  act(next,'importEmail',{...mail,sourceId,...(mail.extraction===undefined&&mail.extractionJson===undefined?{extraction:null}:{})},'קליטה אוטומטית מ־Make');
  const proposal=next.proposals.find(value=>value.sourceId===sourceId)!;
  if(draft.intake.requestType!=='unrelated'&&!draft.intake.isAutomated)proposal.intake!.acknowledgement={status:'pending',updatedAt:new Date().toISOString()};
  if(await saveWorkspace(db,owner,row,next))return receipt(proposal,false);
 }
 throw new EmailIntakeError('הנתונים נערכו במקביל. יש לנסות שוב עם אותו מזהה הודעה; לא נשלח אישור שמירה.',409);
}
export const acknowledgementUpdateSchema=z.object({sourceId:z.string().regex(/^[A-Za-z0-9:_-]{1,180}$/),receiptId:z.string().min(1).max(150),action:z.enum(['reserve','sent','uncertain']),reservationId:z.string().min(1).max(150).optional(),replyId:z.string().min(1).max(200).optional()}).strict();
export type AcknowledgementReceipt={receiptId:string;acknowledgementStatus:Acknowledgement['status'];canSend:boolean;reservationId?:string;acknowledgementText?:string};
export async function updateAcknowledgement(db:WorkspaceDb,owner:string,payload:unknown):Promise<AcknowledgementReceipt>{
 const input=acknowledgementUpdateSchema.parse(payload);
 for(let attempt=0;attempt<3;attempt++){
  const row=await loadWorkspace(db,owner,false),next=structuredClone(row.state),proposal=next.proposals.find(value=>value.sourceId==='make:'+input.sourceId&&value.id===input.receiptId),ack=proposal?.intake?.acknowledgement;
  if(!proposal||!ack)throw new EmailIntakeError('לא נמצא רישום קבלה עבור ההודעה.',404);
  if(input.action==='reserve'){
   if(ack.status!=='pending')return {receiptId:proposal.id,acknowledgementStatus:ack.status,canSend:false};
   ack.status='reserved';ack.reservationId=crypto.randomUUID();
  }else{
   if(!input.reservationId||input.reservationId!==ack.reservationId)throw new EmailIntakeError('מזהה חזקת השליחה אינו תואם.',409);
   if(input.action==='sent'){
    if(!input.replyId)throw new EmailIntakeError('יש לשמור את מזהה תשובת Gmail.');
    if(ack.status==='sent'){if(ack.replyId!==input.replyId)throw new EmailIntakeError('כבר נרשמה תשובת Gmail אחרת.',409);return {receiptId:proposal.id,acknowledgementStatus:'sent',canSend:false};}
    if(ack.status!=='reserved')throw new EmailIntakeError('מצב השליחה דורש בדיקה ידנית. אין לשלוח שוב אוטומטית.',409);
    ack.status='sent';ack.replyId=input.replyId;
   }else{if(ack.status==='sent')throw new EmailIntakeError('התשובה כבר נרשמה כנשלחה.',409);if(ack.status!=='reserved'&&ack.status!=='uncertain')throw new EmailIntakeError('יש לחזקה את השליחה תחילה.',409);ack.status='uncertain';}
  }
  ack.updatedAt=new Date().toISOString();next.audit.unshift({at:ack.updatedAt,actor:'תיעוד קבלת הודעה מ־Make',action:'עדכון מצב הודעת הקבלה: '+ack.status});
  if(await saveWorkspace(db,owner,row,next))return {receiptId:proposal.id,acknowledgementStatus:ack.status,canSend:input.action==='reserve',...(input.action==='reserve'?{reservationId:ack.reservationId,acknowledgementText}:{})};
 }
 throw new EmailIntakeError('מצב הודעת הקבלה נערך במקביל. יש לבדוק לפני ניסיון שליחה נוסף.',409);
}
