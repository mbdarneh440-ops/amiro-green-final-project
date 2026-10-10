import assert from 'node:assert/strict';
import {availabilityBatches} from '../lib/availability-receipts';
import {readMakeAvailability} from '../lib/make-availability';
import {previewAvailability} from '../lib/availability-import';
import {syncEnabled,aiEnabled} from '../lib/integration-config';
import {act} from '../lib/actions';
import {seed} from '../lib/domain';
let checks=0;function check(name:string,fn:()=>void){fn();checks++;console.log('✓ '+name)}
const data={sourceId:'availability:synthetic-sheet:2',sender:'Google Forms',subject:'זמינות שבועית · א',requestType:'availability.unarmed',receivedAt:'10/4/2026 9:00:00',body:'שם מלא: עובד בדיקה\nמספר טלפון: 0500000000\nתאריך תחילת השבוע (יום ראשון): \nיום ראשון: בוקר, לילה\nיום שני: צהריים\nיום שלישי: \nיום רביעי: \nיום חמישי: \nיום שישי: \nיום שבת: \nשבוע אוטומטי: 2026-10-04'};
async function main(){
 const batches=await availabilityBatches([{data}]),batch=batches[0],state=seed();state.guards=[{id:'synthetic-worker',name:'עובד בדיקה',phone:'0500000000',wage:85,maxHours:48,skills:['כללי'],confirmed:false,availability:[],exceptions:[]}];
 check('A group and frozen week survive transport',()=>{assert.equal(batch.securityType,'unarmed');assert.equal(batch.week,'2026-10-04');assert.equal(batch.phone,'0500000000')});
 check('Checkboxes yield seven dated review rows',()=>{const rows=previewAvailability(batch.csv,state,batch.securityType);assert.equal(rows.length,7);assert.deepEqual(rows[0].selections?.periods,['morning','night']);assert.equal(rows[1].date,'2026-10-05')});
 const same=await availabilityBatches([{data:{...data,receivedAt:'10/4/2026 10:00:00'}}]);check('Receipt fingerprint is stable on reread',()=>assert.equal(same[0].fingerprint,batch.fingerprint));
 const delayed=await availabilityBatches([{data:{...data,receivedAt:'10/11/2026 9:00:00',body:data.body.replace('שבוע אוטומטי: 2026-10-04','שבוע אוטומטי: ')}}]);check('Delayed Sheets formula uses original submission week',()=>assert.equal(delayed[0].week,'2026-10-11'));
 const armed=await availabilityBatches([{data:{...data,subject:'זמינות שבועית · ב',requestType:'availability.armed'}}]);check('B retains distinct group',()=>assert.equal(armed[0].securityType,'armed'));
 await assert.rejects(()=>availabilityBatches([{data:{...data,subject:'זמינות שבועית · ב'}}]));checks++;console.log('✓ Wrong group subject is rejected');
 await assert.rejects(()=>availabilityBatches([{data:{...data,body:data.body+'\nשם מלא: injected'}}]));checks++;console.log('✓ Additional injected field is rejected');
 act(state,'queueAvailability',batches,'test');const id=state.availabilityReceipts![0].id;
 check('Automatic intake changes no worker availability',()=>{assert.equal(state.guards[0].exceptions.length,0);assert.equal(state.availabilityReceipts![0].status,'pending')});
 act(state,'queueAvailability',batches,'test');check('Polling creates no duplicate receipt',()=>assert.equal(state.availabilityReceipts!.length,1));
 act(state,'approveAvailabilityReceipt',{id},'manager');check('Approval applies dates and stores decision together',()=>{assert.equal(state.guards[0].exceptions.length,7);assert.equal(state.availabilityReceipts![0].status,'approved')});
 check('Approval preserves wage, qualification and confirmed flag',()=>{assert.equal(state.guards[0].wage,85);assert.deepEqual(state.guards[0].skills,['כללי']);assert.equal(state.guards[0].confirmed,false)});
 act(state,'queueAvailability',batches,'test');check('Approved response does not reappear',()=>{assert.equal(state.availabilityReceipts!.length,1);assert.equal(state.availabilityReceipts![0].status,'approved')});
 const modified=await availabilityBatches([{data:{...data,body:data.body.replace('יום שני: צהריים','יום שני: לילה')}}]);act(state,'queueAvailability',modified,'test');const second=state.availabilityReceipts!.find(r=>r.status==='pending')!;act(state,'rejectAvailabilityReceipt',{id:second.id},'manager');act(state,'queueAvailability',modified,'test');check('Changed reply requires review; rejected version stays rejected',()=>{assert.equal(state.availabilityReceipts!.length,2);assert.equal(state.availabilityReceipts!.filter(r=>r.status==='pending').length,0);assert.deepEqual(state.guards[0].exceptions[1].selections?.periods,['afternoon'])});
 check('Make and AI are disabled even if keys exist',()=>{const config={MAKE_API_TOKEN:'synthetic',MAKE_DATA_STORE_ID:'123',COMPANY_MAILBOX:'owner@example.com',AI_API_KEY:'synthetic'};assert.equal(syncEnabled(config),false);assert.equal(aiEnabled(config),false);assert.equal(syncEnabled({...config,MAKE_SYNC_ENABLED:'true'}),true);assert.equal(aiEnabled({...config,AI_ENABLED:'true'}),true)});
 const result=await readMakeAvailability({MAKE_API_TOKEN:'synthetic',MAKE_DATA_STORE_ID:'123'},async()=>new Response(JSON.stringify({records:[{data}]}),{status:200}));check('Mock Make read returns new review batch',()=>{assert.equal(result.count,1);assert.equal(result.batches[0].securityType,'unarmed')});
 console.log(`${checks} availability connection checks passed; no external calls.`);
}
void main().catch(error=>{console.error(error);process.exitCode=1});
