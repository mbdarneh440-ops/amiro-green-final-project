import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed, plan, hours, interval, weekOf, normalizeCalendar, eligible, type Shift } from '../lib/domain';
import { act } from '../lib/actions';
import { universityTemplates, rosterColumns } from '../lib/roster';
let passed=0;
function test(name:string,run:()=>void){run();passed++;console.log('✓ '+name)}
const week='2026-10-04';
function workspace(){const s=seed();s.sites=s.sites.filter(x=>x.id==='university');s.sites[0].shiftTemplates=universityTemplates();s.proposals=[];return s}
test('שבוע ראשון עד שבת והתאריכים אינם זזים בגבול שבוע',()=>{
  assert.equal(weekOf('2026-10-04'),week);assert.equal(weekOf('2026-10-10'),week);assert.equal(weekOf('2026-10-11'),'2026-10-11');
});
test('הצילום מתורגם לשעות מלאות, כולל 8.5 ו־12 שעות ללא חיתוך',()=>{
  const s=workspace(),p=plan(s,week),sun=p.filter(x=>x.date===week);
  const normal=sun.filter(x=>x.securityType==='unarmed'&&x.period==='morning');
  assert.equal(normal.length,11);assert.equal(normal.filter(x=>hours(x)===8.5).length,8);assert.equal(normal.filter(x=>hours(x)===6.5).length,3);
  const extra=sun.find(x=>x.period==='extra')!;assert.equal(hours(extra),12);assert.equal(extra.end,interval(week,'20:00','08:00')[1]);
  assert.equal(new Set(p.map(x=>x.id)).size,p.length);
  assert.equal(p.filter(x=>x.securityType==='armed'&&x.date==='2026-10-09').length,0);
  assert.equal(p.filter(x=>x.period==='extra'&&x.date==='2026-10-08').length,0);
});
test('שיבוץ חמוש מחייב התאמה מפורשת ואינו מסיק אותה משם או אתר',()=>{
  const s=workspace(),p=plan(s,week),armed=p.find(x=>x.securityType==='armed')!,g=s.guards[0];
  assert.ok(p.filter(x=>x.securityType==='armed').every(x=>x.guardId===null));
  assert.match(eligible(s,g,armed,[])!,/נשק/);g.skills.push('נשק');assert.equal(eligible(s,g,armed,[]),null);
});
test('הכמות השבועית מחושבת גם לשעות לילה שגולשות ליום ראשון',()=>{
  const s=workspace(),g=s.guards[0];g.maxHours=8;g.skills.push('נשק');
  function shift(date:string,start:string,end:string):Shift{const [a,b]=interval(date,start,end);return{id:date,siteId:'university',date,start:a,end:b,guardId:g.id,rate:1,wage:1,actualHours:null,actualApproved:false,reason:''}}
  const saturday=shift('2026-10-03','22:00','07:00');
  assert.match(eligible(s,g,shift(week,'16:00','18:00'),[saturday])!,/מכסת/);
  assert.equal(eligible(s,g,shift(week,'16:00','17:00'),[saturday]),null);
});
test('מעבר משבוע שני לשבוע ראשון שומר דיווחים ומסמן את שני השבועות',()=>{
  const old=seed();delete old.calendarVersion;old.dirtyWeeks=['2026-09-21'];old.shifts=plan(old,'2026-09-21');old.shifts[0].actualHours=6;old.shifts[0].actualApproved=true;
  const original=structuredClone(old),migrated=normalizeCalendar(old);
  assert.deepEqual(migrated.shifts,original.shifts);assert.deepEqual(old,original);
  assert.deepEqual(new Set(migrated.dirtyWeeks),new Set(['2026-09-20','2026-09-27']));assert.deepEqual(normalizeCalendar(migrated),migrated);
});
test('עריכת מבנה ושמירת אתר אינן משנות שעות או סיווג שכבר דווחו',()=>{
  const s=workspace();act(s,'approvePlan',{week},'test');const first=s.shifts.find(x=>x.guardId)!;
  act(s,'approveHours',{id:first.id,hours:8},'test');const snapshot=structuredClone(first);
  const changed=universityTemplates().map(t=>({...t,start:'07:00'}));act(s,'saveShiftTemplates',{siteId:'university',templates:changed},'test');
  act(s,'saveSite',{...s.sites[0],name:'שם מעודכן'},'test');assert.deepEqual(s.sites[0].shiftTemplates,changed);
  act(s,'approvePlan',{week},'test');assert.deepEqual(s.shifts.find(x=>x.id===first.id),snapshot);
});
test('מזהים כפולים וימים ריקים נדחים לפני שינוי מבנה המשמרות',()=>{
  const s=workspace(),before=JSON.stringify(s),template=universityTemplates()[0];
  assert.throws(()=>act(s,'saveShiftTemplates',{siteId:'university',templates:[template,template]},'test'));assert.equal(JSON.stringify(s),before);
  assert.throws(()=>act(s,'saveShiftTemplates',{siteId:'university',templates:[{...template,days:[]}]},'test'));assert.equal(JSON.stringify(s),before);
});
test('ייבוא קובץ אתרים ישן אינו מוחק את מבנה המשמרות',()=>{
  const s=seed(),csv=readFileSync('public/templates/02_אתרים_קבועים.csv','utf8');act(s,'importCsv',{kind:'sites',csv},'test');
  const site=s.sites.find(x=>x.id.startsWith('csv-site:'))!;site.shiftTemplates=universityTemplates();act(s,'importCsv',{kind:'sites',csv},'test');
  assert.deepEqual(s.sites.find(x=>x.id===site.id)!.shiftTemplates,universityTemplates());
});
test('עמודות שומרות את כל השיבוצים והסוגים בלי כפילות או ערבוב',()=>{
  const s=workspace(),p=plan(s,week),unarmed=p.filter(x=>x.securityType==='unarmed'&&x.period==='morning'),cols=rosterColumns(unarmed,week);
  assert.equal(cols.length,7);assert.equal(cols[0].filter(c=>c.kind==='time').length,2);
  const ids=cols.flat().flatMap(c=>c.kind==='shift'?[c.shift.id]:[]);assert.deepEqual(new Set(ids),new Set(unarmed.map(x=>x.id)));assert.equal(ids.length,unarmed.length);
});
test('ביטול יום באתר מפורט מבטל את כל קבוצות האבטחה',()=>{
  const s=workspace();s.overrides=[{siteId:'university',date:week,start:'00:00',end:'24:00',count:0,rate:95}];assert.equal(plan(s,week).filter(x=>x.date===week).length,0);
});
test('שינוי תאריך קודם ללא סיווג נשק אינו עוקף את המבנה החדש',()=>{
  const s=workspace();delete s.sites[0].shiftTemplates;s.overrides=[{siteId:'university',date:week,start:'08:00',end:'16:00',count:2,rate:100}];
  const before=JSON.stringify(s);assert.throws(()=>act(s,'saveShiftTemplates',{siteId:'university',templates:universityTemplates()},'test'),/ללא סיווג נשק/);assert.equal(JSON.stringify(s),before);
});
test('משמרות ללא יום פעיל נדחות בלי למחוק את הדרישות הקיימות',()=>{
  const s=workspace();s.sites[0].days=[6];const before=JSON.stringify(s);
  assert.throws(()=>act(s,'saveShiftTemplates',{siteId:'university',templates:[{...universityTemplates()[0],days:[0]}]},'test'),/ימי הפעילות/);assert.equal(JSON.stringify(s),before);
});
console.log(`${passed} בדיקות סידור שבועי עברו בהצלחה`);
