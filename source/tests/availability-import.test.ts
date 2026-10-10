import assert from 'node:assert/strict';
import {act} from '../lib/actions';
import {availabilityDays,previewAvailability} from '../lib/availability-import';
import {dateAdd, plan, seed, eligible, interval, type Shift} from '../lib/domain';

let passed=0;
function test(name:string,run:()=>void){run();passed++;console.log('✓ '+name)}
const headers=['Timestamp','שם מלא','מספר טלפון','תאריך הזמינות','משעה (00:00–23:59)','עד שעה (00:00–23:59)'];
type Reply=[string,string,string,string,string];
function csv(...replies:Reply[]){return [headers,...replies.map(r=>['9/24/2026 12:00:00',...r])].map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\r\n')}
function workspace(){const s=seed();s.guards=s.guards.slice(0,2);s.guards[0].name='דנה לוי';s.guards[0].phone='050-123-4567';s.guards[1].name='אמיר כהן';s.guards[1].phone='052-123-4567';return s}
const valid:Reply=['דנה לוי','+972 50-123-4567','9/24/2026','22:00','06:00'];

test('תצוגה מקדימה מזהה טלפון בינלאומי ולילה ואינה משנה את הנתונים',()=>{
 const s=workspace();s.guards[0].exceptions=[{date:'2026-09-24',available:false,start:'00:00',end:'24:00'}];
 const before=JSON.stringify(s),rows=previewAvailability('\uFEFF'+csv(valid),s);
 assert.equal(JSON.stringify(s),before);
 assert.deepEqual(rows,[{guardId:s.guards[0].id,name:'דנה לוי',date:'2026-09-24',available:true,start:'22:00',end:'06:00',previous:'לא זמין'}]);
});

test('שורה פגומה אחרי שורה תקינה נדחית ללא שינוי או רישום אישור',()=>{
 for(const bad of [
  ['אמיר כהן','0521234567','2026-02-30','08:00','16:00'],
  ['אמיר כהן','0521234567','2026-09-25','24:00','16:00'],
  ['אמיר כהן','0521234567','2026-09-25','08:00','08:00'],
 ] as Reply[]){const s=workspace(),before=JSON.stringify(s);assert.throws(()=>act(s,'approveAvailabilityImport',{csv:csv(valid,bad)},'מנהל'));assert.equal(JSON.stringify(s),before)}
});

test('שם וטלפון חייבים להצביע על אותו עובד באופן חד משמעי',()=>{
 const s=workspace(),before=JSON.stringify(s);
 for(const row of [
  ['דנה לוי','0521234567','2026-09-24','08:00','16:00'],
  ['דנה לוי','לא ידוע','2026-09-24','08:00','16:00'],
  ['דנה לוי','0501234567abc','2026-09-24','08:00','16:00'],
 ] as Reply[])assert.throws(()=>previewAvailability(csv(row),s));
 assert.equal(JSON.stringify(s),before);
 s.guards[1].phone=s.guards[0].phone;assert.throws(()=>previewAvailability(csv(valid),s));
 s.guards[1].phone='0521234567';s.guards[1].name=s.guards[0].name;
 assert.throws(()=>previewAvailability(csv(['דנה לוי','','2026-09-24','08:00','16:00']),s));
});

test('טלפון ריק מאפשר רק שם יחיד וקובץ חסר עמודה נדחה',()=>{
 const s=workspace();assert.equal(previewAvailability(csv(['דנה לוי','','2026-09-24','08:00','16:00']),s)[0].guardId,s.guards[0].id);
 assert.throws(()=>previewAvailability(csv(valid).replace('"מספר טלפון"','"טלפון אחר"'),s),/חסרה עמודה/);
});

test('תשובות כפולות לאותו עובד ותאריך נדחות גם בפורמטי תאריך שונים',()=>{
 const s=workspace(),before=JSON.stringify(s);
 assert.throws(()=>act(s,'approveAvailabilityImport',{csv:csv(valid,['דנה לוי','0501234567','2026-09-24','10:00','18:00'])},'מנהל'),/יותר מתשובה אחת/);
 assert.equal(JSON.stringify(s),before);
});

test('אישור משנה רק את תאריכי הזמינות ומסמן שבועות לבדיקה מחדש',()=>{
 const s=workspace(),g=s.guards[0];g.confirmed=false;
 g.exceptions=[{date:'2026-09-24',available:false,start:'00:00',end:'24:00'},{date:'2026-10-05',available:false,start:'00:00',end:'24:00'}];
 s.shifts=plan(s,'2026-09-13');s.dirtyWeeks=['2026-09-06'];
 const before=structuredClone(s),olderException=structuredClone(g.exceptions[1]);
 act(s,'approveAvailabilityImport',{csv:csv(valid,['דנה לוי','0501234567','2026-09-28','08:00','16:00'])},'מנהל בדיקה');
 assert.deepEqual({...g,exceptions:[]},{...before.guards[0],exceptions:[]});
 assert.deepEqual(g.exceptions,[olderException,{date:'2026-09-24',available:true,start:'22:00',end:'06:00'},{date:'2026-09-28',available:true,start:'08:00',end:'16:00'}]);
 assert.deepEqual(s.guards[1],before.guards[1]);assert.deepEqual(s.shifts,before.shifts);
 assert.deepEqual(s.sites,before.sites);assert.deepEqual(s.proposals,before.proposals);assert.deepEqual(s.settings,before.settings);
 assert.deepEqual(new Set(s.dirtyWeeks),new Set(['2026-09-06','2026-09-13','2026-09-20','2026-09-27']));
 assert.equal(s.dirtyWeeks.length,4);assert.equal(s.audit.length,before.audit.length+1);assert.equal(s.audit[0].actor,'מנהל בדיקה');
});

test('מגבלת חריגות לעובד נבדקת לכל העובדים לפני שינוי כלשהו',()=>{
 const s=workspace();s.guards[1].exceptions=Array.from({length:366},(_,i)=>({date:dateAdd('2025-01-01',i),available:true,start:'08:00',end:'16:00'}));
 const before=JSON.stringify(s);
 assert.throws(()=>act(s,'approveAvailabilityImport',{csv:csv(valid,['אמיר כהן','0521234567','2026-09-24','08:00','16:00'])},'מנהל'),/366/);
 assert.equal(JSON.stringify(s),before);
 act(s,'approveAvailabilityImport',{csv:csv(['אמיר כהן','0521234567','2025-01-01','09:00','17:00'])},'מנהל');
 assert.equal(s.guards[1].exceptions.length,366);assert.equal(s.guards[1].exceptions.at(-1)?.start,'09:00');
});

const weeklyHeaders=['Timestamp','שם מלא','מספר טלפון','תאריך תחילת השבוע (יום ראשון)',...availabilityDays];
type WeeklyReply=[string,string,string,...string[]];
function weeklyCsv(...replies:WeeklyReply[]){return [weeklyHeaders,...replies.map(r=>['9/25/2026 12:00:00',...r])].map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\r\n')}
const weeklyReply:WeeklyReply=['דנה לוי','0501234567','2026-09-27','08:00–16:00','',' 22:00 - 06:00 ','00:00–06:00','','08:30—17:00',''];

test('תשובה שבועית מציגה שבעה תאריכים וימים ריקים כלא זמינים ללא שינוי נתונים',()=>{
 const s=workspace(),before=JSON.stringify(s),rows=previewAvailability(weeklyCsv(weeklyReply),s);
 assert.equal(JSON.stringify(s),before);assert.equal(rows.length,7);
 assert.deepEqual(rows.map(r=>r.date),Array.from({length:7},(_,i)=>dateAdd('2026-09-27',i)));
 assert.deepEqual(rows.map(r=>r.available),[true,false,true,true,false,true,false]);
 assert.equal(rows[2].start,'22:00');assert.equal(rows[2].end,'06:00');
 assert.equal(rows[5].start,'08:30');assert.equal(rows[1].start,'00:00');assert.equal(rows[1].end,'24:00');
});

test('שבוע חייב להתחיל ביום ראשון וכל טווח חייב להיות תקין ויחיד',()=>{
 for(const bad of [
  ['דנה לוי','0501234567','2026-09-28','08:00–16:00','','','','','',''],
  ['דנה לוי','0501234567','','08:00–16:00','','','','','',''],
  ['דנה לוי','0501234567','2026-09-27','24:00–16:00','','','','','',''],
  ['דנה לוי','0501234567','2026-09-27','08:00–08:00','','','','','',''],
  ['דנה לוי','0501234567','2026-09-27','08:00–12:00, 14:00–18:00','','','','','',''],
  ['דנה לוי','0501234567','2026-09-27','','','','','','','לא זמין'],
 ] as WeeklyReply[]){const s=workspace(),before=JSON.stringify(s);assert.throws(()=>act(s,'approveAvailabilityImport',{csv:weeklyCsv(bad)},'מנהל'));assert.equal(JSON.stringify(s),before)}
 assert.throws(()=>previewAvailability(weeklyCsv(weeklyReply).replace('"יום שבת"','"שבת אחרת"'),workspace()),/יום שבת/);
});

test('תשובות כפולות לאותו עובד ושבוע נדחות לפני כל שינוי',()=>{
 const s=workspace(),before=JSON.stringify(s),duplicate=[...weeklyReply] as WeeklyReply;duplicate[2]='9/27/2026';
 assert.throws(()=>act(s,'approveAvailabilityImport',{csv:weeklyCsv(weeklyReply,duplicate)},'מנהל'),/אותו עובד ושבוע/);
 assert.equal(JSON.stringify(s),before);
});

test('אישור שבוע מחליף את כל שבעת התאריכים ושומר חריגות אחרות ופרטי עובד',()=>{
 const s=workspace(),g=s.guards[0];g.confirmed=false;
 g.exceptions=[{date:'2026-09-28',available:true,start:'08:00',end:'16:00'},{date:'2026-10-10',available:false,start:'00:00',end:'24:00'}];
 const before=structuredClone(s);act(s,'approveAvailabilityImport',{csv:weeklyCsv(weeklyReply)},'מנהל');
 assert.deepEqual({...g,exceptions:[]},{...before.guards[0],exceptions:[]});assert.equal(g.exceptions.length,8);
 assert.deepEqual(g.exceptions[0],before.guards[0].exceptions[1]);
 assert.deepEqual(g.exceptions.find(e=>e.date==='2026-09-28'),{date:'2026-09-28',available:false,start:'00:00',end:'24:00',mode:'startDay'});
 assert.deepEqual(s.guards[1],before.guards[1]);assert.deepEqual(s.shifts,before.shifts);assert.deepEqual(s.sites,before.sites);
 assert.deepEqual(new Set(s.dirtyWeeks),new Set(['2026-09-27']));assert.equal(s.audit.length,before.audit.length+1);
});

test('הגיליון יכול להכיל עמודות ותשובות מהטופס הקודם ומהטופס השבועי',()=>{
 const combinedHeaders=[...headers,...weeklyHeaders.slice(3)];
 const lines=[combinedHeaders,['9/24/2026 12:00:00',...valid,...Array(8).fill('')],['9/25/2026 12:00:00',...weeklyReply.slice(0,2),'','','',...weeklyReply.slice(2)]];
 const combined=lines.map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\n');
 assert.equal(previewAvailability(combined,workspace()).length,8);
 // A legacy day overlapping a weekly response is still a duplicate.
 const overlapping=combined.replace('9/24/2026","22:00','9/27/2026","22:00');
 assert.throws(()=>previewAvailability(overlapping,workspace()),/אותו עובד ותאריך/);
 const ambiguous=combined.replace('"","","","2026-09-27"','"2026-09-25","08:00","16:00","2026-09-27"');
 assert.throws(()=>previewAvailability(ambiguous,workspace()),/גם שבוע וגם תאריך/);
});

test('שבעה ימים לא זמינים מותרים והמגבלה נבדקת אחרי הרחבה לשבעה תאריכים',()=>{
 const s=workspace();const blank:WeeklyReply=['דנה לוי','0501234567','2026-09-27','','','','','','',''];
 assert.equal(previewAvailability(weeklyCsv(blank),s).filter(r=>!r.available).length,7);
 s.guards[1].exceptions=Array.from({length:360},(_,i)=>({date:dateAdd('2025-01-01',i),available:true,start:'08:00',end:'16:00'}));
 const before=JSON.stringify(s),second:WeeklyReply=['אמיר כהן','0521234567',...blank.slice(2)] as WeeklyReply;
 assert.throws(()=>act(s,'approveAvailabilityImport',{csv:weeklyCsv(blank,second)},'מנהל'),/366/);assert.equal(JSON.stringify(s),before);
});

test('שמירת פרטי עובד לאחר הייבוא משמרת את משמעות שעות הלילה',()=>{
 const s=workspace();act(s,'approveAvailabilityImport',{csv:weeklyCsv(weeklyReply)},'מנהל');
 const exceptions=structuredClone(s.guards[0].exceptions);
 act(s,'saveGuard',{...s.guards[0],wage:70},'מנהל');
 assert.deepEqual(s.guards[0].exceptions,exceptions);assert.ok(exceptions.every(e=>e.mode==='startDay'));
});

function slot(date:string,start:string,end:string):Shift{const [a,b]=interval(date,start,end);return{id:'check',siteId:'university',date,start:a,end:b,guardId:null,rate:90,wage:0,actualHours:null,actualApproved:false,reason:''};}
test('שעות לילה מהטופס נשמרות גם כשהיום הבא ריק וחריגה ידנית גוברת',()=>{
 const s=workspace(),g=s.guards[0];g.availability=[];
 act(s,'approveAvailabilityImport',{csv:weeklyCsv(['דנה לוי','0501234567','2026-09-27','22:00–06:00','','','','','',''])},'מנהל');
 assert.equal(eligible(s,g,slot('2026-09-27','22:00','06:00'),[]),null);
 assert.equal(eligible(s,g,slot('2026-09-28','02:00','06:00'),[]),null);
 assert.notEqual(eligible(s,g,slot('2026-09-28','08:00','16:00'),[]),null);
 g.exceptions=g.exceptions.map(e=>e.date==='2026-09-28'?{date:e.date,available:false,start:'00:00',end:'24:00'}:e);
 assert.notEqual(eligible(s,g,slot('2026-09-27','22:00','06:00'),[]),null);
});
test('יום ריק בטופס אינו משאיר זמינות לילה קבועה מעבר לסוף השבוע',()=>{
 const s=workspace(),g=s.guards[0];g.availability=[{day:6,start:'22:00',end:'06:00'}];
 act(s,'approveAvailabilityImport',{csv:weeklyCsv(['דנה לוי','0501234567','2026-09-27','','','','','','',''])},'מנהל');
 assert.notEqual(eligible(s,g,slot('2026-10-04','01:00','05:00'),[]),null);
});
console.log(`${passed} בדיקות ייבוא זמינות עברו בהצלחה`);
