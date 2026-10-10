import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed, plan, interval, eligible, finance, type Shift, type Site } from '../lib/domain';
import { act } from '../lib/actions';
import { previewImport, parseCsv } from '../lib/csv-import';
let passed=0;
function test(name:string,run:()=>void){run();passed++;console.log('✓ '+name)}
const week='2026-09-20';
function simple(){const s=seed();s.sites=[];s.proposals=[];s.guards=s.guards.slice(0,1);s.guards[0].maxHours=80;return s}
function event(id:string,date:string,start='08:00',end='16:00'):Site{return{id,name:id,organization:id,phone:'',kind:'event',date,days:[],start,end,count:1,rate:100,skill:'כללי',revision:1}}
function candidate(date:string,start:string,end:string):Shift{const [a,b]=interval(date,start,end);return{id:'בדיקה',siteId:'אתר',date,start:a,end:b,guardId:null,rate:100,wage:0,actualHours:null,actualApproved:false,reason:''}}
test('כיסוי רציף של קניון ואוניברסיטה, כולל מעבר חצות',()=>{const s=seed(),p=plan(s,week);assert.equal(p.filter(x=>x.siteId==='mall').reduce((n,x)=>n+(x.end-x.start)/3600000,0),19*2*7);assert.equal(p.filter(x=>x.siteId==='university').reduce((n,x)=>n+(x.end-x.start)/3600000,0),24*2*7);assert.equal(p.filter(x=>x.siteId==='mall').at(-1)?.end,interval('2026-09-26','06:00','01:00')[1])});
test('חריגה בתאריך חוסמת גם זמינות מהלילה הקודם',()=>{const s=simple();s.sites=[event('אתר','2026-09-22')];const g=s.guards[0];g.availability=[{day:1,start:'22:00',end:'08:00'}];g.exceptions=[{date:'2026-09-22',available:true,start:'18:00',end:'23:00'}];assert.notEqual(eligible(s,g,candidate('2026-09-22','01:00','05:00'),[]),null);assert.notEqual(eligible(s,g,candidate('2026-09-21','23:00','02:00'),[]),null);assert.equal(eligible(s,g,candidate('2026-09-22','18:00','22:00'),[]),null);g.exceptions[0].available=false;assert.notEqual(eligible(s,g,candidate('2026-09-21','23:00','02:00'),[]),null)});
test('חפיפות, זמן מעבר, מכסת שעות והכשרה נבדקים',()=>{const s=simple();s.sites=[event('אתר',week),event('אחר',week)];const g=s.guards[0],old={...candidate(week,'00:00','08:00'),guardId:g.id,siteId:'אחר'};assert.notEqual(eligible(s,g,candidate(week,'07:00','10:00'),[old]),null);assert.notEqual(eligible(s,g,candidate(week,'16:00','20:00'),[old]),null);assert.equal(eligible(s,g,candidate(week,'16:30','20:00'),[old]),null);g.maxHours=10;assert.notEqual(eligible(s,g,candidate(week,'17:00','21:00'),[old]),null);g.skills=[];assert.notEqual(eligible(s,g,candidate(week,'17:00','18:00'),[]),null)});
test('הודעות נשארות ממתינות וחסומות לייבוא כפול',()=>{const s=simple(),mail={subject:'בקשה',sender:'demo@example.test',sourceId:'1',body:'ארגון: דוגמה\nתאריך: 2026-09-24\nהתחלה: 18:00\nסיום: 23:00\nכמות: 2\nתעריף: 100'};act(s,'importEmail',mail,'בדיקה');assert.equal(s.sites.length,0);assert.equal(s.proposals[0].status,'pending');assert.throws(()=>act(s,'importEmail',mail,'בדיקה'));act(s,'approveProposal',{id:s.proposals[0].id},'בדיקה');assert.equal(s.sites.length,1)});
test('בקשת שינוי ישנה דורשת בדיקה חוזרת',()=>{const s=simple();s.sites=[event('אתר',week)];act(s,'importEmail',{subject:'שינוי',sender:'demo@example.test',sourceId:'2',body:'בדיקה'},'בדיקה');const p=s.proposals[0];act(s,'saveProposal',{...p,kind:'change',siteId:'אתר',organization:'דוגמה',date:week,start:'08:00',end:'16:00',count:1,rate:100},'בדיקה');s.sites[0].revision++;assert.throws(()=>act(s,'approveProposal',{id:p.id},'בדיקה'));assert.equal(p.status,'pending')});
test('ביטול האירוע האחרון מנקה את סידור העבודה',()=>{const s=simple();s.sites=[event('אתר','2026-09-24')];act(s,'approvePlan',{week},'בדיקה');assert.equal(s.shifts.length,1);act(s,'importEmail',{subject:'ביטול',sender:'demo@example.test',sourceId:'3',body:'בדיקה'},'בדיקה');const p=s.proposals[0];act(s,'saveProposal',{...p,kind:'cancel',siteId:'אתר',date:'2026-09-24',start:'08:00',end:'16:00'},'בדיקה');act(s,'approveProposal',{id:p.id},'בדיקה');act(s,'approvePlan',{week},'בדיקה');assert.equal(s.shifts.length,0);assert.equal(s.dirtyWeeks.includes(week),false)});
test('דיווח יום ראשון נשמר ואינו חוסם הוספת אירוע ביום חמישי',()=>{const s=simple();s.sites=[event('אתר',week)];act(s,'approvePlan',{week},'בדיקה');const first=s.shifts[0];act(s,'approveHours',{id:first.id,hours:7.5},'בדיקה');const frozen=JSON.stringify(s.shifts[0]);act(s,'saveSite',{...event('', '2026-09-24'),name:'אירוע נוסף',organization:'ארגון נוסף'},'בדיקה');act(s,'approvePlan',{week},'בדיקה');assert.equal(s.shifts.length,2);assert.equal(JSON.stringify(s.shifts.find(x=>x.id===first.id)),frozen);assert.ok(s.shifts.find(x=>x.date==='2026-09-24')?.guardId)});
test('מס חסר אינו אפס ושעות לא מאושרות אינן ביצוע',()=>{const s=simple();s.sites=[event('אתר',week)];s.shifts=plan(s,week);assert.equal(finance(s,s.shifts).afterTax,null);assert.equal(finance(s,s.shifts,true).revenue,0);s.shifts[0].actualHours=5;s.shifts[0].actualApproved=true;assert.equal(finance(s,s.shifts,true).revenue,500);s.settings.tax=20;s.settings.overhead=0;assert.equal(finance(s,s.shifts,true).tax,Math.max(0,finance(s,s.shifts,true).beforeTax)*.2)});
test('שלוש התבניות נטענות ועדכון קוד קיים אינו יוצר כפילות',()=>{const s=simple();for(const [kind,file,expected]of [['workers','01_עובדים.csv',2],['sites','02_אתרים_קבועים.csv',2],['events','03_אירועים.csv',1]] as const){const csv=readFileSync('public/templates/'+file,'utf8');const p=previewImport(kind,csv,s);assert.equal(p.records.length,expected);act(s,'importCsv',{kind,csv},'בדיקה');assert.equal(previewImport(kind,csv,s).updated,expected);act(s,'importCsv',{kind,csv},'בדיקה')}assert.equal(s.guards.length,3);assert.equal(s.sites.length,3)});
test('קלט פגום נדחה לפני שינוי הנתונים',()=>{assert.throws(()=>parseCsv('שם,שם\nא,ב'));assert.throws(()=>parseCsv('שם,קוד\n"טקסט,1'));const s=simple(),before=JSON.stringify(s),csv=readFileSync('public/templates/03_אירועים.csv','utf8').replace('18:00','25:00');assert.throws(()=>act(s,'importCsv',{kind:'events',csv},'בדיקה'));assert.equal(JSON.stringify(s),before)});
test('זמינות שבועית בלילה ממשיכה ליום ריק בלי להחזיר זמינות קבועה',()=>{
 const s=simple();s.sites=[event('אתר','2026-09-28')];const g=s.guards[0];
 g.availability=[{day:0,start:'00:00',end:'24:00'},{day:1,start:'00:00',end:'24:00'}];
 g.exceptions=[{date:'2026-09-27',available:true,start:'22:00',end:'06:00',mode:'startDay'},{date:'2026-09-28',available:false,start:'00:00',end:'24:00',mode:'startDay'}];
 assert.equal(eligible(s,g,candidate('2026-09-27','22:00','06:00'),[]),null);
 assert.equal(eligible(s,g,candidate('2026-09-28','01:00','05:00'),[]),null);
 assert.notEqual(eligible(s,g,candidate('2026-09-28','06:00','07:00'),[]),null);
 assert.notEqual(eligible(s,g,candidate('2026-09-27','08:00','12:00'),[]),null);
});
test('ימים שבועיים סמוכים אינם חותכים אחד לשני משמרות לילה',()=>{
 const s=simple();s.sites=[event('אתר','2026-09-28')];const g=s.guards[0];g.availability=[];
 g.exceptions=[{date:'2026-09-27',available:true,start:'22:00',end:'06:00',mode:'startDay'},{date:'2026-09-28',available:true,start:'22:00',end:'06:00',mode:'startDay'},{date:'2026-09-29',available:false,start:'00:00',end:'24:00',mode:'startDay'}];
 for(const day of ['2026-09-27','2026-09-28'])assert.equal(eligible(s,g,candidate(day,'22:00','06:00'),[]),null);
 assert.notEqual(eligible(s,g,candidate('2026-09-28','12:00','16:00'),[]),null);
 assert.notEqual(eligible(s,g,candidate('2026-09-30','01:00','05:00'),[]),null);
});
test('יום ריק בטופס שבועי מסיר זמינות קבועה שגלשה מהלילה הקודם',()=>{
 const s=simple();s.sites=[event('אתר','2026-09-27')];const g=s.guards[0];g.availability=[{day:6,start:'22:00',end:'06:00'}];
 g.exceptions=[{date:'2026-09-27',available:false,start:'00:00',end:'24:00',mode:'startDay'}];
 assert.notEqual(eligible(s,g,candidate('2026-09-27','01:00','05:00'),[]),null);
 assert.equal(eligible(s,g,candidate('2026-09-26','22:00','23:00'),[]),null);
});
test('חריגה ידנית בתאריך גוברת על לילה מהטופס השבועי',()=>{
 const s=simple();s.sites=[event('אתר','2026-09-28')];const g=s.guards[0];g.availability=[];
 g.exceptions=[{date:'2026-09-28',available:false,start:'00:00',end:'24:00'},{date:'2026-09-27',available:true,start:'22:00',end:'06:00',mode:'startDay'}];
 assert.notEqual(eligible(s,g,candidate('2026-09-27','22:00','06:00'),[]),null);
 assert.equal(eligible(s,g,candidate('2026-09-27','22:00','23:00'),[]),null);
 g.exceptions[0]={date:'2026-09-28',available:true,start:'03:00',end:'06:00'};
 assert.equal(eligible(s,g,candidate('2026-09-28','03:00','06:00'),[]),null);
 assert.notEqual(eligible(s,g,candidate('2026-09-28','01:00','03:00'),[]),null);
});
console.log(`${passed} בדיקות עברו בהצלחה`);
