import assert from 'node:assert/strict';
import {act} from '../lib/actions';
import {availabilityDays,availabilityGridHeaders,automaticWeekHeader,previewAvailability} from '../lib/availability-import';
import {seed,eligible,interval,dateAdd,availabilityText,type Shift,type SecurityType} from '../lib/domain';
let passed=0;
const test=(name:string,run:()=>void)=>{run();passed++;console.log('✓ '+name);};
function state(){const s=seed();s.guards=s.guards.slice(0,1);s.guards[0].name='עובד בדיקה';s.guards[0].phone='0500000000';s.guards[0].confirmed=true;return s;}
function csv(values:string[],headers=availabilityGridHeaders){return [['שם מלא','מספר טלפון','תאריך תחילת השבוע (יום ראשון)',...headers],['עובד בדיקה','0500000000','2026-10-04',...values]].map(row=>row.map(x=>'"'+x.replaceAll('"','""')+'"').join(',')).join('\n');}
function slot(date:string,start:string,end:string,period:Shift['period']='morning',securityType:SecurityType|undefined='unarmed'):Shift{const [a,b]=interval(date,start,end);return{id:'check',siteId:'university',date,start:a,end:b,period,securityType,guardId:null,rate:90,wage:0,actualHours:null,actualApproved:false,reason:''};}
const multiple=['בוקר, לילה','','צהריים','','','',''];
test('Grid headers read back from both Google Sheets accept multiple choices without mutating state',()=>{
 const s=state(),before=JSON.stringify(s),rows=previewAvailability(csv(multiple),s,'unarmed');
 assert.equal(JSON.stringify(s),before);assert.equal(rows.length,7);assert.deepEqual(rows[0].selections,{periods:['morning','night'],securityType:'unarmed'});assert.equal(rows[1].available,false);assert.deepEqual(rows[2].selections?.periods,['afternoon']);
});
test('The administrator must select a source group, including for all-blank weeks',()=>{
 assert.throws(()=>previewAvailability(csv(multiple),state()),/קבוצת הטופס/);assert.throws(()=>previewAvailability(csv(Array(7).fill('')),state()),/קבוצת הטופס/);
 assert.equal(previewAvailability(csv(Array(7).fill('')),state(),'unarmed').filter(r=>!r.available).length,7);
});
test('Choice labels and duplicate replies fail atomically',()=>{
 for(const label of ['בוקר, בוקר','ערב','בוקר,','08:00–16:00']){const s=state(),before=JSON.stringify(s);assert.throws(()=>act(s,'approveAvailabilityImport',{csv:csv([label,'','','','','','']),securityType:'unarmed'},'מנהל'));assert.equal(JSON.stringify(s),before);}
 const content=csv(multiple);assert.throws(()=>previewAvailability(content+'\n'+content.split('\n')[1],state(),'unarmed'),/אותו עובד ושבוע/);
});
test('Approval stores all choices and wage edits preserve them without changing qualifications or saved shifts',()=>{
 const s=state(),before=structuredClone(s);s.guards[0].exceptions=[{date:'2026-09-01',available:false,start:'00:00',end:'24:00'}];
 act(s,'approveAvailabilityImport',{csv:csv(multiple),securityType:'unarmed'},'מנהל');
 assert.equal(s.guards[0].exceptions.length,8);assert.deepEqual(s.guards[0].skills,before.guards[0].skills);assert.deepEqual(s.shifts,before.shifts);
 const exceptions=structuredClone(s.guards[0].exceptions);act(s,'saveGuard',{...s.guards[0],wage:75},'מנהל');assert.deepEqual(s.guards[0].exceptions,exceptions);
});
test('Selected periods cover actual roster hours without allowing an unselected afternoon',()=>{
 const s=state(),g=s.guards[0];g.availability=[];act(s,'approveAvailabilityImport',{csv:csv(multiple),securityType:'unarmed'},'מנהל');
 assert.equal(eligible(s,g,slot('2026-10-04','06:30','15:00'),[]),null);assert.equal(eligible(s,g,slot('2026-10-04','06:30','13:00'),[]),null);
 assert.notEqual(eligible(s,g,slot('2026-10-04','13:00','23:00','afternoon'),[]),null);assert.notEqual(eligible(s,g,slot('2026-10-05','06:30','15:00'),[]),null);
});
test('Overnight and 20–08 reinforcement retain their start day while manual next-day blocking wins',()=>{
 const s=state(),g=s.guards[0];g.availability=[];g.skills.push('נשק');act(s,'approveAvailabilityImport',{csv:csv(['לילה','','','','','','']),securityType:'armed'},'מנהל');
 assert.equal(eligible(s,g,slot('2026-10-04','22:30','07:00','night','armed'),[]),null);assert.equal(eligible(s,g,slot('2026-10-04','20:00','08:00','extra','armed'),[]),null);
 assert.notEqual(eligible(s,g,slot('2026-10-05','02:00','06:00','night','armed'),[]),null);
 g.exceptions=g.exceptions.map(e=>e.date==='2026-10-05'?{date:e.date,available:false,start:'00:00',end:'24:00'}:e);
 assert.notEqual(eligible(s,g,slot('2026-10-04','22:30','07:00','night','armed'),[]),null);
});
test('An armed-form reply grants no weapon qualification and cannot cover the other source group',()=>{
 const s=state(),g=s.guards[0];act(s,'approveAvailabilityImport',{csv:csv(['בוקר','','','','','','']),securityType:'armed'},'מנהל');
 assert.ok(!g.skills.includes('נשק'));assert.match(eligible(s,g,slot('2026-10-04','06:30','15:00','morning','armed'),[])??'',/נשק/);
 g.skills.push('נשק');assert.equal(eligible(s,g,slot('2026-10-04','06:30','15:00','morning','armed'),[]),null);assert.notEqual(eligible(s,g,slot('2026-10-04','06:30','15:00'),[]),null);
});
test('Legacy shifts with no security label use the unarmed form',()=>{
 const s=state(),g=s.guards[0];act(s,'approveAvailabilityImport',{csv:csv(['בוקר','','','','','','']),securityType:'unarmed'},'מנהל');const candidate=slot('2026-10-04','06:30','15:00');delete candidate.securityType;delete candidate.period;assert.equal(eligible(s,g,candidate,[]),null);
});
test('Old weekly hour answers remain importable in a sheet containing retained grid columns',()=>{
 const headers=[...availabilityGridHeaders,...availabilityDays],s=state();const old=csv([...Array(7).fill(''),'08:00–16:00','','','','','',''],headers);
 const rows=previewAvailability(old,s);assert.equal(rows[0].start,'08:00');assert.equal(rows[0].end,'16:00');assert.equal(rows[0].selections,undefined);
 const mixed=csv(['בוקר','','','','','','','08:00–16:00','','','','','',''],headers);assert.throws(()=>previewAvailability(mixed,s,'unarmed'),/גם בחירת משמרות/);
});
test('Unconfirmed workers remain unavailable after import',()=>{
 const s=state(),g=s.guards[0];g.confirmed=false;act(s,'approveAvailabilityImport',{csv:csv(['בוקר','','','','','','']),securityType:'unarmed'},'מנהל');assert.equal(g.confirmed,false);assert.notEqual(eligible(s,g,slot('2026-10-04','06:30','15:00'),[]),null);
});
test('Partial retained columns containing values are rejected without data loss',()=>{
 const s=state();const partialGrid=[...availabilityGridHeaders.slice(0,6),...availabilityDays];
 assert.throws(()=>previewAvailability(csv(['בוקר','','','','','','','','','','','',''],partialGrid),s,'unarmed'),/חסרות עמודות/);
 const partialHours=[...availabilityGridHeaders,...availabilityDays.slice(0,6)];
 assert.throws(()=>previewAvailability(csv(['בוקר','','','','','','','08:00–16:00','','','','',''],partialHours),s,'unarmed'),/חסרות עמודות/);
});
test('Worker-facing choice text hides the internal group',()=>{
 const row=previewAvailability(csv(multiple),state(),'armed')[0];assert.equal(availabilityText(row,false),'בוקר · לילה');assert.match(availabilityText(row),/חמוש/);
});
function datedHeaders(week:string){return availabilityDays.map((day,offset)=>{const [year,month,date]=dateAdd(week,offset).split('-');return 'זמינות למשמרות ['+day+' · '+date+'/'+month+'/'+year+']';});}
function table(headers:string[],...rows:string[][]){return [headers,...rows].map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\n');}
function datedCsv(week:string,values:string[]=multiple,headers=datedHeaders(week)){return table(['שם מלא','מספר טלפון',automaticWeekHeader,...headers],['עובד בדיקה','0500000000',week,...values]);}
test('Dated DD/MM/YYYY grid imports seven dates from the frozen automatic week',()=>{
 const s=state(),before=JSON.stringify(s),rows=previewAvailability(datedCsv('2026-10-04'),s,'unarmed');
 assert.equal(JSON.stringify(s),before);assert.deepEqual(rows.map(row=>row.date),Array.from({length:7},(_,i)=>dateAdd('2026-10-04',i)));assert.deepEqual(rows[0].selections?.periods,['morning','night']);assert.equal(rows[1].available,false);
});
test('Renamed newer grid headings cannot move historical replies away from their submission week',()=>{
 const headers=datedHeaders('2026-10-11'),content=table(['שם מלא','מספר טלפון',automaticWeekHeader,...headers],['עובד בדיקה','0500000000','2026-10-04',...multiple],['עובד בדיקה','0500000000','2026-10-11','לילה','','','','','','']);
 const s=state(),rows=previewAvailability(content,s,'armed');assert.equal(rows.length,14);assert.equal(rows[0].date,'2026-10-04');assert.equal(rows[7].date,'2026-10-11');
 act(s,'approveAvailabilityImport',{csv:content,securityType:'armed'},'מנהל');assert.equal(s.guards[0].exceptions.find(row=>row.date==='2026-10-04')?.selections?.periods[0],'morning');assert.equal(s.guards[0].exceptions.find(row=>row.date==='2026-10-11')?.selections?.periods[0],'night');
});
test('Blank dated weeks still require the manager source group and retain all seven unavailable dates',()=>{
 const content=datedCsv('2026-10-04',Array(7).fill(''),datedHeaders('2026-10-11'));
 assert.throws(()=>previewAvailability(content,state()),/קבוצת הטופס/);const rows=previewAvailability(content,state(),'unarmed');assert.equal(rows.length,7);assert.ok(rows.every(row=>!row.available));assert.equal(rows[0].date,'2026-10-04');
});
test('Rows select populated dated grids and ignore blank retained historical columns',()=>{
 const first=datedHeaders('2026-09-27'),second=datedHeaders('2026-10-04'),headers=['שם מלא','מספר טלפון',automaticWeekHeader,...first,...second];
 const content=table(headers,['עובד בדיקה','0500000000','2026-09-27',...multiple,...Array(7).fill('')],['עובד בדיקה','0500000000','2026-10-04',...Array(7).fill(''),'לילה','','','','','','']);
 const rows=previewAvailability(content,state(),'unarmed');assert.equal(rows.length,14);assert.deepEqual(rows[0].selections?.periods,['morning','night']);assert.deepEqual(rows[7].selections?.periods,['night']);
 const mixed=table(headers,['עובד בדיקה','0500000000','2026-10-04',...multiple,...multiple]);assert.throws(()=>previewAvailability(mixed,state(),'unarmed'),/יותר משבוע/);
});
test('Explicit older weekly and single-day history is preserved beside blank automatic and dated columns',()=>{
 const headers=['שם מלא','מספר טלפון','תאריך תחילת השבוע (יום ראשון)',automaticWeekHeader,'תאריך הזמינות','משעה (00:00–23:59)','עד שעה (00:00–23:59)',...availabilityGridHeaders,...datedHeaders('2026-10-11')];
 const content=table(headers,['עובד בדיקה','0500000000','2026-09-27','','','','',...multiple,...Array(7).fill('')],['עובד בדיקה','0500000000','','','9/20/2026','08:00','16:00',...Array(14).fill('')]);
 const rows=previewAvailability(content,state(),'unarmed');assert.equal(rows.length,8);assert.equal(rows[0].date,'2026-09-27');assert.equal(rows[7].date,'2026-09-20');assert.equal(rows[7].selections,undefined);
});
test('Automatic week ISO dates and conflicting explicit weeks reject before any mutation',()=>{
 for(const week of ['04/10/2026','2026-10-05','2026-02-30','']){const s=state(),before=JSON.stringify(s);assert.throws(()=>act(s,'approveAvailabilityImport',{csv:datedCsv(week,multiple,datedHeaders('2026-10-04')),securityType:'unarmed'},'מנהל'));assert.equal(JSON.stringify(s),before);}
 const headers=['שם מלא','מספר טלפון','תאריך תחילת השבוע (יום ראשון)',automaticWeekHeader,...datedHeaders('2026-10-04')];
 const s=state(),before=JSON.stringify(s),content=table(headers,['עובד בדיקה','0500000000','2026-10-11','2026-10-04',...multiple]);assert.throws(()=>act(s,'approveAvailabilityImport',{csv:content,securityType:'unarmed'},'מנהל'),/אינם תואמים/);assert.equal(JSON.stringify(s),before);
});
test('Dated headings validate real DD/MM/YYYY dates, weekday names and consecutive offsets',()=>{
 const original=datedHeaders('2026-10-04');
 for(const replacement of ['זמינות למשמרות [יום ראשון · 10/04/2026]','זמינות למשמרות [יום ראשון · 31/02/2026]','זמינות למשמרות [יום ראשון · 2026-10-04]']){const bad=[...original];bad[0]=replacement;assert.throws(()=>previewAvailability(datedCsv('2026-10-04',multiple,bad),state(),'unarmed'));}
 const offset=[...original];offset[1]='זמינות למשמרות [יום שני · 12/10/2026]';assert.throws(()=>previewAvailability(datedCsv('2026-10-04',multiple,offset),state(),'unarmed'),/חסרות עמודות/);
 const duplicate=[...original,'זמינות למשמרות [יום ראשון  ·  04/10/2026]'];assert.throws(()=>previewAvailability(datedCsv('2026-10-04',[...multiple,''],duplicate),state(),'unarmed'),/יותר מעמודה/);
 for(const week of ['2026-12-27','2028-02-27']){const rows=previewAvailability(datedCsv(week),state(),'unarmed');assert.equal(rows[6].date,dateAdd(week,6));}
});
test('Missing automatic week and ambiguous blank dated schemas are never inferred from today',()=>{
 const headers=['שם מלא','מספר טלפון',...datedHeaders('2026-10-04')],content=table(headers,['עובד בדיקה','0500000000',...multiple]);assert.throws(()=>previewAvailability(content,state(),'unarmed'),/שבוע אוטומטי/);
 const multipleHeaders=[...datedHeaders('2026-10-04'),...datedHeaders('2026-10-11')];assert.throws(()=>previewAvailability(datedCsv('2026-09-27',Array(14).fill(''),multipleHeaders),state(),'unarmed'),/תשובה ריקה/);
 const matching=previewAvailability(datedCsv('2026-10-04',Array(14).fill(''),multipleHeaders),state(),'unarmed');assert.equal(matching.length,7);assert.equal(matching[0].date,'2026-10-04');
});
console.log(passed+' checkbox-selection tests passed.');
