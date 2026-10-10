import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {seed,type State} from '../lib/domain';
import {act} from '../lib/actions';
import {draftFromExtraction,emailIntakeSchema,authenticatedIntake,emailIntakeReady,intakeRequestBody,maxEmailIntakeBytes,EmailIntakeError,acknowledgementText,eventRangeIssue} from '../lib/email-intake';
import {recordIntake,updateAcknowledgement,type WorkspaceDb} from '../lib/workspace-store';
import {readMakeInbox} from '../lib/make';
import {canRefreshWorkspace} from '../lib/workspace-refresh';
let passed=0;
async function test(name:string,run:()=>void|Promise<void>){await run();passed++;console.log('✓ '+name);}
const owner='manager-existing',testToken='synthetic-test-token-0123456789-abcdef';
function state(){const result=seed();result.proposals=[];return result;}
function mail(sourceId='gmail-fixture-1'){
 const body='שלום, אנחנו עמותת המפגש. מבקשים ארבעה מאבטחים באולם העיר בתאריך 04/10/2026 משעה 18:00 עד 23:00. התעריף הוא 100 ש״ח לשעה. טלפון 050-123-4567.';
 return {sourceId,subject:'בקשת אבטחה לאירוע',sender:'fixture@example.test',body,receivedAt:'2026-10-03T12:00:00+03:00',extraction:{request_type:'new_request',organization:'עמותת המפגש',site:'אולם העיר',phone:'050-123-4567',start_date:'2026-10-04',end_date:'2026-10-04',start_time:'18:00',end_time:'23:00',guard_count:'4',hourly_rate:'100',missing_fields:'',ambiguities:'',source_evidence:{organization:'עמותת המפגש',site:'אולם העיר',phone:'050-123-4567',start_date:'04/10/2026',end_date:'04/10/2026',start_time:'18:00',end_time:'23:00',guard_count:'ארבעה מאבטחים',hourly_rate:'100 ש״ח לשעה'}}};
}
class FakeDb implements WorkspaceDb {
 rows=new Map<string,{version:number;data:string}>();writes=0;failWrites=false;refuseWrites=false;beforeWrite?:()=>void;delayWrite?:Promise<void>;
 constructor(){this.rows.set(owner,{version:1,data:JSON.stringify(state())});}
 current(target=owner){return JSON.parse(this.rows.get(target)!.data) as State;}
 mutate(update:(value:State)=>void,target=owner){const row=this.rows.get(target)!,value=this.current(target);update(value);row.data=JSON.stringify(value);row.version++;}
 prepare(query:string){return {bind:(...values:unknown[])=>({first:async <T>()=>{const row=this.rows.get(String(values[0]));return row?{...row} as T:null;},run:async ()=>{
  this.writes++;if(this.delayWrite)await this.delayWrite;if(this.failWrites)throw Error('synthetic DB outage');
  if(query.startsWith('INSERT')){const key=String(values[0]);if(this.rows.has(key))return {meta:{changes:0}};this.rows.set(key,{version:1,data:String(values[1])});return {meta:{changes:1}};}
  const key=String(values[2]),expected=Number(values[3]);this.beforeWrite?.();const row=this.rows.get(key);
  if(this.refuseWrites||!row||row.version!==expected)return {meta:{changes:0}};
  row.data=String(values[0]);row.version++;return {meta:{changes:1}};
 }})};}
}
function api(relative:string,config:Record<string,unknown>){
 const module={exports:{} as {POST:(request:Request)=>Promise<Response>}},root=process.env.EMAIL_PATCH_COMPILED??path.dirname(__dirname);
 const requireActual=(name:string)=>require(name.startsWith('@/')?path.join(root,name.slice(2)+'.js'):name);
 const code=readFileSync(path.join(root,relative),'utf8');new Function('require','module','exports',code)((name:string)=>name==='cloudflare:workers'?{env:config}:requireActual(name),module,module.exports);return module.exports.POST;
}
function request(payload:unknown,token=testToken){return new Request('https://fixture.invalid/api/email-intake',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload)});}
async function run(){
 await test('Grounded free-text Hebrew becomes pending with original source, timestamp and entity, without operational changes',async()=>{
  const db=new FakeDb(),before=db.current(),receipt=await recordIntake(db,owner,mail()),after=db.current(),proposal=after.proposals[0];
  assert.equal(receipt.reviewStatus,'pending');assert.equal(receipt.status,'recorded');assert.equal(proposal.sourceId,'make:gmail-fixture-1');assert.equal(proposal.received,mail().receivedAt);assert.equal(proposal.organization,'עמותת המפגש');assert.equal(proposal.siteName,'אולם העיר');assert.equal(proposal.count,4);assert.equal(proposal.rate,100);assert.deepEqual(after.sites,before.sites);assert.deepEqual(after.shifts,before.shifts);assert.deepEqual(after.guards,before.guards);assert.equal(proposal.intake?.extractionStatus,'validated');assert.equal(proposal.body,mail().body);
 });
 await test('Absent or malformed AI preserves raw pending data without granting approvals or legacy parsed facts',async()=>{
  for(const extraction of [undefined,{...mail().extraction,status:'approved'},{request_type:'execute_action'}]){const db=new FakeDb(),payload={...mail(),body:'ארגון: מזויף\nתאריך: 2026-10-04\nכמות: 500',extraction};await recordIntake(db,owner,payload);const proposal=db.current().proposals[0];assert.equal(proposal.status,'pending');assert.equal(proposal.count,0);assert.equal(proposal.organization,'');assert.equal(proposal.intake?.extractionStatus,'failed');}
  assert.throws(()=>emailIntakeSchema.parse({...mail(),owner:'attacker',status:'approved',state:{}}));
 });
 await test('Facts require matching evidence; wrong dates, counts, currency and signs never masquerade as valid values',()=>{
  for(const quote of ['04/10/2026','-4 מאבטחים','4,000 מאבטחים','100 ש״ח','100 מאבטחים ב-4 ש״ח']){const payload=mail();payload.body+=' '+quote;payload.extraction.guard_count=quote==='100 ש״ח'?'100':'4';payload.extraction.source_evidence.guard_count=quote;assert.equal(draftFromExtraction(payload).count,0);}
  for(const quote of ['דרושים 4 מאבטחים','2026-10-04','4 מאבטחים ב-100 ש״ח']){const payload=mail();payload.body+=' '+quote;payload.extraction.hourly_rate=quote==='2026-10-04'?'2026':'4';payload.extraction.source_evidence.hourly_rate=quote;assert.equal(draftFromExtraction(payload).rate,0);}
  const wrong=mail();wrong.extraction.start_date='2026-11-04';wrong.extraction.source_evidence.start_date='04/10/2026';assert.equal(draftFromExtraction(wrong).date,'');wrong.extraction.source_evidence.organization='משהו שלא כתוב בהודעה';assert.equal(draftFromExtraction(wrong).organization,'');
 });
 await test('Explicit missing or conflicting fields clear even otherwise grounded suggestions',()=>{
  const payload=mail();payload.extraction.missing_fields='guard_count, start_date';const draft=draftFromExtraction(payload);assert.equal(draft.count,0);assert.equal(draft.date,'');assert.ok(draft.intake.missingFields.includes('guard_count'));assert.equal(draft.intake.extractionStatus,'needs_review');
 });
 await test('Dotted dates and unrelated words cannot supply time or currency evidence',()=>{
  const payload=mail();payload.body+=' בשעה 04.10.2026 עלו 4 שחקנים.';payload.extraction.start_time='04:10';payload.extraction.source_evidence.start_time='בשעה 04.10.2026';assert.equal(draftFromExtraction(payload).start,'');payload.extraction.hourly_rate='4';payload.extraction.source_evidence.hourly_rate='4 שחקנים';assert.equal(draftFromExtraction(payload).rate,0);
 });
 await test('Multi-day evidence persists and backend blocks approval even after save, while a representable overnight is accepted',()=>{
  const payload=mail();payload.body+=' סיום בתאריך 06/10/2026.';payload.extraction.end_date='2026-10-06';payload.extraction.source_evidence.end_date='06/10/2026';const s=state();act(s,'importEmail',{...payload,sourceId:'make:multi'},'בדיקה');const p=s.proposals[0];assert.equal(p.endDate,'2026-10-06');assert.equal(p.intake?.sourceEvidence.end_date,'06/10/2026');assert.ok(p.intake?.rangeNeedsReview);const before=JSON.stringify(s);assert.throws(()=>act(s,'approveProposal',{id:p.id},'בדיקה'));assert.equal(JSON.stringify(s),before);act(s,'saveProposal',{...p},'בדיקה');assert.throws(()=>act(s,'approveProposal',{id:p.id},'בדיקה'),/כמה ימים/);assert.equal(p.status,'pending');
  assert.equal(eventRangeIssue({date:'2026-10-04',endDate:'2026-10-05',start:'22:00',end:'06:00'}),'');assert.ok(eventRangeIssue({date:'2026-10-04',endDate:'2026-10-05',start:'08:00',end:'18:00'}));assert.ok(eventRangeIssue({date:'2026-10-04',endDate:'2026-10-04',start:'22:00',end:'06:00'}));
 });
 await test('Request kind never selects or changes an existing site automatically',()=>{
  for(const requestType of ['update','cancellation']){const payload=mail();payload.extraction.request_type=requestType;const s=state(),before=structuredClone(s);act(s,'importEmail',payload,'בדיקה');assert.equal(s.proposals[0].kind,requestType==='update'?'change':'cancel');assert.equal(s.proposals[0].siteId,'');assert.throws(()=>act(s,'approveProposal',{id:s.proposals[0].id},'בדיקה'));assert.deepEqual(s.sites,before.sites);assert.deepEqual(s.shifts,before.shifts);}
 });
 await test('JSON-only extraction and maximum provider IDs survive the canonical make namespace',async()=>{
  const db=new FakeDb(),original=mail('x'.repeat(180)),payload={...original,extraction:undefined,extractionJson:JSON.stringify(original.extraction)};await recordIntake(db,owner,payload);const p=db.current().proposals[0];assert.equal(p.count,4);assert.equal(p.intake?.extractionStatus,'validated');assert.equal(p.sourceId.length,185);
 });
 await test('Intake and legacy Make pull share source dedupe without resetting reviewed requests',async()=>{
  for(const status of ['approved','rejected'] as const){const db=new FakeDb();db.mutate(s=>{act(s,'importEmail',{...mail(),sourceId:'make:'+mail().sourceId},'מנהל');s.proposals[0].status=status;});const before=db.current(),receipt=await recordIntake(db,owner,mail());assert.equal(receipt.duplicate,true);assert.equal(receipt.reviewStatus,status);assert.equal(receipt.receiptId,before.proposals[0].id);assert.deepEqual(db.current(),before);}
  const db=new FakeDb();await recordIntake(db,owner,mail());assert.throws(()=>act(db.current(),'importEmail',{...mail(),sourceId:'make:'+mail().sourceId},'מנהל'));
 });
 await test('A reused Gmail ID with different raw content rejects without overwrite',async()=>{const db=new FakeDb();await recordIntake(db,owner,mail());const before=db.current();await assert.rejects(recordIntake(db,owner,{...mail(),body:'different body'}),error=>error instanceof EmailIntakeError&&error.status===409);assert.deepEqual(db.current(),before);});
 await test('CAS retries preserve another writer changes and deduplicate simultaneous imports',async()=>{
  const db=new FakeDb();db.beforeWrite=()=>{db.beforeWrite=undefined;db.mutate(s=>{s.guards[0].wage=777;});};await recordIntake(db,owner,mail());assert.equal(db.current().guards[0].wage,777);assert.equal(db.current().proposals.length,1);
  const simultaneous=new FakeDb(),receipts=await Promise.all([recordIntake(simultaneous,owner,mail()),recordIntake(simultaneous,owner,mail())]);assert.equal(simultaneous.current().proposals.length,1);assert.equal(receipts[0].receiptId,receipts[1].receiptId);assert.equal(receipts.filter(value=>value.duplicate).length,1);
  const different=new FakeDb();await Promise.all([recordIntake(different,owner,mail('first')),recordIntake(different,owner,mail('second'))]);assert.equal(different.current().proposals.length,2);
 });
 await test('A concurrent writer importing this Gmail ID wins with its durable identity',async()=>{const db=new FakeDb();let expected='';db.beforeWrite=()=>{db.beforeWrite=undefined;db.mutate(s=>{act(s,'importEmail',{...mail(),sourceId:'make:'+mail().sourceId},'מנהל');expected=s.proposals[0].id;s.guards[0].wage=123;});};const receipt=await recordIntake(db,owner,mail());assert.equal(receipt.duplicate,true);assert.equal(receipt.receiptId,expected);assert.equal(db.current().guards[0].wage,123);assert.equal(db.current().proposals.length,1);});
 await test('There is no receipt before durable commit, after DB failure, or after exhausted CAS retries',async()=>{
  const db=new FakeDb();let release!:()=>void;db.delayWrite=new Promise(resolve=>{release=resolve;});let resolved=false;const pending=recordIntake(db,owner,mail()).then(value=>{resolved=true;return value;});await new Promise(resolve=>setImmediate(resolve));assert.equal(resolved,false);assert.equal(db.current().proposals.length,0);release();await pending;assert.equal(db.current().proposals.length,1);
  for(const mode of ['failure','conflict']){const bad=new FakeDb();if(mode==='failure')bad.failWrites=true;else bad.refuseWrites=true;await assert.rejects(recordIntake(bad,owner,mail()));assert.equal(bad.current().proposals.length,0);if(mode==='conflict')assert.equal(bad.writes,3);}
  const absent=new FakeDb();absent.rows.clear();await assert.rejects(recordIntake(absent,'mistyped-owner',mail()),error=>error instanceof EmailIntakeError&&error.status===503);assert.equal(absent.rows.size,0);assert.equal(absent.writes,0);
 });
 await test('Authentication checks a separate server secret and the API can only write its configured existing owner',async()=>{
  const db=new FakeDb(),config={DB:db,MAKE_INBOX_WEBHOOK_SECRET:' '+testToken+' ',INBOX_OWNER_ID:' '+owner+' '},post=api('app/api/email-intake/route.js',config);assert.equal(emailIntakeReady(config),true);assert.equal(emailIntakeReady({MAKE_INBOX_WEBHOOK_SECRET:'short',INBOX_OWNER_ID:owner}),false);assert.equal(await authenticatedIntake(request(mail()),config),true);assert.equal(await authenticatedIntake(request(mail(),'x'),config),false);
  assert.equal((await post(request(mail(),'wrong'))).status,401);assert.equal(db.current().proposals.length,0);assert.equal((await post(request({...mail(),owner:'other'}))).status,400);assert.equal((await post(request(mail()))).status,200);assert.equal(db.current().proposals.length,1);assert.equal(db.rows.size,1);
 });
 await test('The endpoint rejects invalid timestamps, oversized UTF-8 bodies and wrong content types before writes',async()=>{
  await assert.rejects(intakeRequestBody(request({...mail(),receivedAt:'today'})));
  const tooLarge=new Request('https://fixture.invalid',{method:'POST',headers:{'content-type':'application/json'},body:'א'.repeat(Math.ceil(maxEmailIntakeBytes/2)+1)});await assert.rejects(intakeRequestBody(tooLarge),error=>error instanceof EmailIntakeError&&error.status===413);
  await assert.rejects(intakeRequestBody(new Request('https://fixture.invalid',{method:'POST',body:'{}'})),error=>error instanceof EmailIntakeError&&error.status===415);
 });
 await test('Transient D1 route failures return 503 and acknowledgement input failures return 400',async()=>{
  const db=new FakeDb();db.failWrites=true;const config={DB:db,MAKE_INBOX_WEBHOOK_SECRET:testToken,INBOX_OWNER_ID:owner};assert.equal((await api('app/api/email-intake/route.js',config)(request(mail()))).status,503);
  const good=new FakeDb(),receipt=await recordIntake(good,owner,mail()),ackPost=api('app/api/email-intake/acknowledgement/route.js',{...config,DB:good});assert.equal((await ackPost(request({bad:'payload'}))).status,400);good.failWrites=true;assert.equal((await ackPost(request({sourceId:mail().sourceId,receiptId:receipt.receiptId,action:'reserve'}))).status,503);
 });
 await test('Lost intake responses remain recoverable, and simultaneous acknowledgement reservations permit one sender',async()=>{
  const db=new FakeDb(),first=await recordIntake(db,owner,mail()),again=await recordIntake(db,owner,mail());assert.equal(again.receiptId,first.receiptId);assert.equal(again.acknowledgementNeeded,true);const input={sourceId:mail().sourceId,receiptId:first.receiptId,action:'reserve'},reservations=await Promise.all([updateAcknowledgement(db,owner,input),updateAcknowledgement(db,owner,input)]);assert.equal(reservations.filter(value=>value.canSend).length,1);assert.equal(db.current().proposals[0].status,'pending');assert.equal((await recordIntake(db,owner,mail())).acknowledgementNeeded,false);assert.equal(db.current().sites.length,state().sites.length);
 });
 await test('Acknowledgement sent retries are idempotent, wrong reservations fail, and uncertain sends are never automatically reopened',async()=>{
  const db=new FakeDb(),receipt=await recordIntake(db,owner,mail()),key={sourceId:mail().sourceId,receiptId:receipt.receiptId},reservation=await updateAcknowledgement(db,owner,{...key,action:'reserve'});assert.equal(reservation.canSend,true);const sent={...key,action:'sent',reservationId:reservation.reservationId,replyId:'synthetic-gmail-reply'};
  await assert.rejects(updateAcknowledgement(db,owner,{...sent,reservationId:'wrong'}));await updateAcknowledgement(db,owner,sent);assert.equal((await updateAcknowledgement(db,owner,sent)).acknowledgementStatus,'sent');await assert.rejects(updateAcknowledgement(db,owner,{...sent,replyId:'different-reply'}));assert.equal((await updateAcknowledgement(db,owner,{...key,action:'reserve'})).canSend,false);
  const uncertain=new FakeDb(),r=await recordIntake(uncertain,owner,mail()),u={sourceId:mail().sourceId,receiptId:r.receiptId},reserved=await updateAcknowledgement(uncertain,owner,{...u,action:'reserve'});await updateAcknowledgement(uncertain,owner,{...u,action:'uncertain',reservationId:reserved.reservationId});assert.equal((await updateAcknowledgement(uncertain,owner,{...u,action:'reserve'})).canSend,false);assert.equal((await recordIntake(uncertain,owner,mail())).acknowledgementStatus,'uncertain');
  assert.ok(acknowledgementText.includes('אין בכך אישור'));assert.equal(db.current().proposals[0].status,'pending');
 });
 await test('Unrelated mail is retained for review without requesting an automatic acknowledgement',async()=>{const db=new FakeDb(),payload=mail();payload.extraction.request_type='unrelated';const receipt=await recordIntake(db,owner,payload);assert.equal(receipt.acknowledgementNeeded,false);assert.equal(receipt.acknowledgementStatus,'not_requested');assert.equal(db.current().proposals[0].count,0);assert.equal(db.current().proposals[0].status,'pending');});
 await test('Production contact_phone and is_automated JSON fields survive pull under make:gmail: IDs, while automation and unrelated approvals stay blocked',async()=>{
  const original=mail('gmail:fixture-14'),{phone,...fields}=original.extraction,{phone:phoneQuote,...evidence}=fields.source_evidence,extraction={...fields,contact_phone:phone,is_automated:'false',source_evidence:{...evidence,contact_phone:phoneQuote}},payload={...original,extraction:undefined,extractionJson:JSON.stringify(extraction)},db=new FakeDb();await recordIntake(db,owner,payload);assert.equal(db.current().proposals[0].phone,'050-123-4567');assert.equal(db.current().proposals[0].sourceId,'make:gmail:fixture-14');assert.equal(db.current().proposals[0].intake?.isAutomated,false);
  for(const field of ['automation','unrelated']){const modified={...extraction,is_automated:field==='automation'?'true':'false',request_type:field==='unrelated'?'unrelated':'new_request'},other=new FakeDb();const receipt=await recordIntake(other,owner,{...payload,extractionJson:JSON.stringify(modified)});assert.equal(receipt.acknowledgementNeeded,false);const s=other.current(),p=s.proposals[0];act(s,'saveProposal',{...p,organization:'השלמה ידנית',date:'2026-10-04',start:'18:00',end:'23:00',count:4,rate:100},'מנהל');assert.throws(()=>act(s,'approveProposal',{id:p.id},'מנהל'),/אוטומטית או לא קשורה/);assert.equal(p.status,'pending');}
 });
 await test('A deferred background refresh cannot overwrite a newly opened modal, inline settings edit, or newer save',async()=>{
  for(const activity of [{busy:false,modal:{kind:'review'},view:'inbox'},{busy:false,modal:null,view:'settings'},{busy:true,modal:null,view:'inbox'}]){const local={state:'unsaved input',version:4};let release!:(value:{state:string;version:number})=>void;const response=new Promise<{state:string;version:number}>(resolve=>{release=resolve;});const pending=response.then(value=>{if(canRefreshWorkspace(activity,4,local.version))Object.assign(local,value);});release({state:'remote state',version:5});await pending;assert.deepEqual(local,{state:'unsaved input',version:4});}
  assert.equal(canRefreshWorkspace({busy:false,modal:null,view:'inbox'},4,5),false);assert.equal(canRefreshWorkspace({busy:false,modal:null,view:'inbox'},4,4),true);
 });
 await test('Original manual structured import and Make datastore extraction fields both remain usable',async()=>{
  const s=state();act(s,'importEmail',{subject:'ישן',sender:'fixture@example.test',sourceId:'manual legacy ID',body:'ארגון: דוגמה\nתאריך: 2026-10-04\nהתחלה: 18:00\nסיום: 23:00\nכמות: 2\nתעריף: 100'},'מנהל');assert.equal(s.proposals[0].count,2);assert.equal(s.proposals[0].intake,undefined);
  const originalFetch=globalThis.fetch;try{const original=mail('gmail:fixture-pull'),payload={...original,extraction:undefined,extractionJson:JSON.stringify(original.extraction),acknowledgementState:'reserved'};globalThis.fetch=async()=>new Response(JSON.stringify({records:[{data:payload}]}));const result=await readMakeInbox({MAKE_API_TOKEN:'synthetic-token',MAKE_DATA_STORE_ID:'123',MAKE_ZONE:'eu1.make.com'});assert.equal(result.emails.length,1);assert.equal(result.emails[0].extractionJson,payload.extractionJson);const next=state();act(next,'importEmail',{...result.emails[0],sourceId:'make:'+result.emails[0].sourceId},'מנהל');assert.equal(next.proposals[0].sourceId,'make:gmail:fixture-pull');assert.equal(next.proposals[0].count,4);}finally{globalThis.fetch=originalFetch;}
 });
 await test('Named contacts and exact request excerpts preserve the original Gmail display name separately from the organization',async()=>{
  const original=mail(),contactName='דנה כהן',summary='מבקשים ארבעה מאבטחים באולם העיר בתאריך 04/10/2026 משעה 18:00 עד 23:00.',payload={...original,requesterName:'  צוות אירועים  ',body:original.body+' שמי '+contactName+'.',extraction:{...original.extraction,contact_name:contactName,request_summary:summary,source_evidence:{...original.extraction.source_evidence,contact_name:'שמי '+contactName,request_summary:summary}}},db=new FakeDb();
  await recordIntake(db,owner,payload);const proposal=db.current().proposals[0];assert.equal(proposal.requesterName,'  צוות אירועים  ');assert.equal(proposal.contactName,contactName);assert.equal(proposal.requestSummary,summary);assert.equal(proposal.organization,'עמותת המפגש');assert.equal(proposal.phone,'050-123-4567');assert.equal(proposal.intake?.sourceEvidence.contact_name,'שמי '+contactName);assert.equal(proposal.status,'pending');
 });
 await test('Names and summaries without matching body quotes remain blank, while source header names never become inferred body contacts',()=>{
  const original=mail(),payload={...original,requesterName:'כותרת בלבד',extraction:{...original.extraction,contact_name:'דנה כהן',request_summary:'דרושים עשרה מאבטחים',source_evidence:{...original.extraction.source_evidence,contact_name:'דנה כהן',request_summary:'דרושים עשרה מאבטחים'}}};const draft=draftFromExtraction(payload);assert.equal(draft.contactName,'');assert.equal(draft.requestSummary,'');assert.ok(draft.intake.warnings.length>=2);
  const subjectOnly={...payload,subject:'דנה כהן — דרושים עשרה מאבטחים'};assert.equal(draftFromExtraction(subjectOnly).contactName,'');assert.equal(draftFromExtraction(subjectOnly).requestSummary,'');
  const invented={...payload,extraction:{...payload.extraction,request_summary:'בקשה לעשרה מאבטחים',source_evidence:{...payload.extraction.source_evidence,request_summary:original.body}}};assert.equal(draftFromExtraction(invented).requestSummary,'');
 });
 await test('Legacy extraction without name or summary remains valid, and absent phone or evidence never fabricates contact data',()=>{
  const original=mail(),draft=draftFromExtraction(original);assert.equal(draft.contactName,'');assert.equal(draft.requestSummary,'');assert.equal(draft.intake.extractionStatus,'validated');const payload={...original,extraction:{...original.extraction,phone:'',contact_name:'',request_summary:''}};assert.equal(draftFromExtraction(payload).phone,'');assert.equal(draftFromExtraction(payload).contactName,'');
  assert.throws(()=>emailIntakeSchema.parse({...original,requesterName:'x'.repeat(151)}));
 });
 await test('Edited contact labels and descriptions survive manager review without changing original sender identity or replacing organization',async()=>{
  const original=mail(),payload={...original,requesterName:'Gmail header name'},db=new FakeDb();await recordIntake(db,owner,payload);const s=db.current(),p=s.proposals[0];act(s,'saveProposal',{...p,contactName:'שם בבדיקה',requestSummary:'תיאור שהמנהל בדק',requesterName:'forged header'},'מנהל');assert.equal(p.contactName,'שם בבדיקה');assert.equal(p.requestSummary,'תיאור שהמנהל בדק');assert.equal(p.requesterName,'Gmail header name');assert.equal(p.organization,'עמותת המפגש');assert.equal(p.sender,original.sender);assert.equal(p.status,'pending');
 });
 await test('Requester headers survive Make datastore pull and collisions never replace the already stored sender name',async()=>{
  const original=mail(),payload={...original,requesterName:'Gmail header name'},db=new FakeDb();await recordIntake(db,owner,payload);const before=db.current();assert.equal((await recordIntake(db,owner,payload)).duplicate,true);await assert.rejects(recordIntake(db,owner,{...payload,requesterName:'changed header'}),error=>error instanceof EmailIntakeError&&error.status===409);assert.deepEqual(db.current(),before);
  const originalFetch=globalThis.fetch;try{globalThis.fetch=async()=>new Response(JSON.stringify({records:[{data:{...payload,extraction:undefined,extractionJson:JSON.stringify(payload.extraction)}}]}));const result=await readMakeInbox({MAKE_API_TOKEN:'synthetic-token',MAKE_DATA_STORE_ID:'123',MAKE_ZONE:'eu1.make.com'});assert.equal(result.emails[0].requesterName,payload.requesterName);}finally{globalThis.fetch=originalFetch;}
 });
 await test('Gmail pull waits for delayed extraction before its import-once identity is recorded, and preserves manager review',async()=>{
  const {extraction,...raw}=mail('gmail:fixture-delayed'),next=state(),before=structuredClone(next),originalFetch=globalThis.fetch;
  let records:{data:unknown}[]=[];
  const config={MAKE_API_TOKEN:'synthetic-token',MAKE_DATA_STORE_ID:'123',MAKE_ZONE:'eu1.make.com'};
  try{
   globalThis.fetch=async()=>Response.json({records});
   for(const fields of [{},{extractionJson:''},{extractionJson:' \n '},{extractionJson:null},{extraction:null},{extraction:null,extractionJson:null}]){
    records=[{data:{...raw,...fields}}];const batch=await readMakeInbox(config);
    assert.equal(batch.emails.length,0);assert.equal(batch.awaitingExtraction,1);assert.equal(batch.skipped,0);assert.deepEqual(next,before);
   }
   records=[{data:{...raw,extractionJson:JSON.stringify(extraction)}}];const completed=await readMakeInbox(config);
   assert.equal(completed.awaitingExtraction,0);assert.equal(completed.skipped,0);assert.equal(completed.emails.length,1);
   act(next,'importEmail',{...completed.emails[0],sourceId:'make:'+raw.sourceId},'מנהל');
   const proposal=next.proposals[0];assert.equal(proposal.status,'pending');assert.equal(proposal.count,4);assert.equal(proposal.intake?.extractionStatus,'validated');assert.equal(proposal.body,raw.body);assert.equal(proposal.received,raw.receivedAt);assert.deepEqual(next.sites,before.sites);assert.deepEqual(next.shifts,before.shifts);assert.deepEqual(next.guards,before.guards);
   act(next,'saveProposal',{...proposal,contactName:'שם שבדק המנהל',rate:120},'מנהל');const reviewed=structuredClone(next),again=await readMakeInbox(config);
   assert.throws(()=>act(next,'importEmail',{...again.emails[0],sourceId:'make:'+raw.sourceId},'מנהל'),/כבר קיימת/);assert.deepEqual(next,reviewed);assert.equal(next.proposals.length,1);
  }finally{globalThis.fetch=originalFetch;}
 });
 await test('Completed malformed extraction stays pending for manual review, while legacy non-Gmail records remain importable',async()=>{
  const {extraction:unused,...raw}=mail('gmail:fixture-malformed'),originalFetch=globalThis.fetch;
  try{
   globalThis.fetch=async()=>Response.json({records:[{data:{...raw,extractionJson:'{broken JSON'}},{data:{...raw,sourceId:'legacy-structured',body:'ארגון: דוגמה\nתאריך: 2026-10-04\nהתחלה: 18:00\nסיום: 23:00\nכמות: 2\nתעריף: 100'}},{data:{...raw,sourceId:'gmail:invalid-record',sender:'invalid',extractionJson:'{}'}},{data:{...raw,sourceId:'gmail:invalid-raw',sender:'invalid',extractionJson:null}}]});
   const batch=await readMakeInbox({MAKE_API_TOKEN:'synthetic-token',MAKE_DATA_STORE_ID:'123'});assert.equal(batch.awaitingExtraction,0);assert.equal(batch.skipped,2);assert.equal(batch.emails.length,2);
   const next=state();for(const item of batch.emails)act(next,'importEmail',{...item,sourceId:'make:'+item.sourceId},'מנהל');
   const malformed=next.proposals.find(item=>item.sourceId==='make:'+raw.sourceId)!,legacy=next.proposals.find(item=>item.sourceId==='make:legacy-structured')!;
   assert.equal(malformed.body,raw.body);assert.equal(malformed.status,'pending');assert.equal(malformed.intake?.extractionStatus,'failed');assert.equal(malformed.count,0);assert.equal(malformed.organization,'');assert.throws(()=>act(next,'approveProposal',{id:malformed.id},'מנהל'));
   assert.equal(legacy.status,'pending');assert.equal(legacy.count,2);assert.equal(legacy.intake,undefined);
  }finally{globalThis.fetch=originalFetch;}
 });
 await test('A full page awaiting extraction does not hide a completed Gmail record on the next page',async()=>{
  const {extraction:unused,...raw}=mail('gmail:fixture-page'),originalFetch=globalThis.fetch,offsets:string[]=[];
  try{
   globalThis.fetch=async input=>{offsets.push(new URL(String(input)).searchParams.get('pg[offset]')!);return Response.json({records:offsets.length===1?Array.from({length:100},(_,index)=>({data:{...raw,sourceId:'gmail:waiting-'+index,extractionJson:null}})):[{data:mail('gmail:fixture-ready')} ]});};
   const batch=await readMakeInbox({MAKE_API_TOKEN:'synthetic-token',MAKE_DATA_STORE_ID:'123'});assert.deepEqual(offsets,['0','100']);assert.equal(batch.awaitingExtraction,100);assert.equal(batch.skipped,0);assert.equal(batch.emails.length,1);assert.equal(batch.emails[0].sourceId,'gmail:fixture-ready');
  }finally{globalThis.fetch=originalFetch;}
 });
 console.log(passed+' email intake tests passed.');
}
void run().catch(error=>{console.error(error);process.exitCode=1;});
