import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url));
const source=fs.readFileSync(path.join(directory,'AvailabilityDates.gs'),'utf8');
const context=vm.createContext({console,Utilities:{formatDate(date,timeZone){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}}});
new vm.Script(source,{filename:'AvailabilityDates.gs'}).runInContext(context);
const call=code=>vm.runInContext(code,context);
const results=[];
assert.equal(call('AVAILABILITY_DATES.DRY_RUN'),true);
assert.equal(call('AVAILABILITY_DATES.OWNER_CONFIRMED_COPY_TEST'),false);
assert.equal(call('AVAILABILITY_DATES.ENABLE_DAILY_TRIGGER'),false);
assert.throws(()=>call('requireDatesWriteConfiguration_()'),/Dry-run/);
assert.throws(()=>call('installDailyAvailabilityTrigger()'),/Dry-run/);
assert.throws(()=>call('refreshAvailabilityDatesDaily()'),/disabled/);
results.push('Syntax valid; dry-run/copy-confirmation/trigger defaults block mutations and trigger installation.');
for(const [instant,today,sunday] of [['2026-10-03T22:30:00Z','2026-10-04','2026-10-04'],['2026-12-31T12:00:00Z','2026-12-31','2026-12-27'],['2028-02-29T12:00:00Z','2028-02-29','2028-02-27']]){
 const plan=JSON.parse(call(`JSON.stringify(currentDatesPlan_(new Date('${instant}')))`));
 assert.equal(plan.today,today);assert.equal(plan.sunday,sunday);assert.equal(plan.rows.length,7);
 context.sampleRows=plan.rows;call('parseDatedRows_(sampleRows)');
}
context.sampleRows=JSON.parse(call("JSON.stringify(currentDatesPlan_(new Date('2026-10-04T12:00:00Z')).rows)"));
context.sampleRows[0]='יום ראשון · 05/10/2026';
assert.throws(()=>call('parseDatedRows_(sampleRows)'),/mismatch/);
context.sampleRows[0]='יום ראשון · 31/02/2026';
assert.throws(()=>call('parseDatedRows_(sampleRows)'),/Invalid date/);
results.push('Jerusalem midnight boundary, year rollover, leap day and strict weekday/calendar validation passed.');
for(const [instant,today,sunday] of [
 ['2026-10-24T19:00:00Z','2026-10-24','2026-10-18'],
 ['2026-10-24T22:30:00Z','2026-10-25','2026-10-25'],
 ['2026-10-24T23:30:00Z','2026-10-25','2026-10-25'],
 ['2026-03-26T23:30:00Z','2026-03-27','2026-03-22'],
 ['2026-03-27T00:30:00Z','2026-03-27','2026-03-22']
]) {
 const plan=JSON.parse(call(`JSON.stringify(currentDatesPlan_(new Date('${instant}')))`));
 assert.equal(plan.today,today);assert.equal(plan.sunday,sunday);
 context.sampleRows=plan.rows;call('parseDatedRows_(sampleRows)');
}
results.push('Saturday/Sunday civil-week boundary and both sides of Jerusalem DST transitions preserve the correct seven-day week.');
context.mockHeaders=['חותמת זמן','שם מלא','מספר טלפון','תאריך תחילת השבוע (יום ראשון)',...Array(7).fill('protected-day-header'),'שבוע אוטומטי'];
context.mockSheet={getLastColumn(){return 13;},getRange(){throw Error('No formula or mutation access needed after unexpected columns.');}};
assert.throws(()=>call("verifyFixedSheet_(mockSheet,mockHeaders,'synthetic')"),/fixed A:D/);
context.mockSheet={getLastColumn(){return 12;},getRange(){return {getFormula(){return '=UNEXPECTED()';}};}};
assert.throws(()=>call("verifyFixedSheet_(mockSheet,mockHeaders,'synthetic')"),/will not repair/);
const writes=[...source.matchAll(/\.setValues\(/g)];assert.equal(writes.length,1);
assert.match(source,/getRange\('E1:K1'\)\.setValues\(\[plan\.headers\]\)/);
assert.equal([...source.matchAll(/\.setRows\(/g)].length,1);
assert.doesNotMatch(source,/\.setFormula(?:s)?\(/);
results.push('Unexpected appended columns and changed L2 formula fail closed; native write sites restricted to setRows and E1:K1.');
assert.throws(()=>call("inspectTarget_({name:'synthetic',formId:'',spreadsheetId:'',sheetId:1},currentDatesPlan_(new Date('2026-10-04T12:00:00Z')))"),/Missing target IDs/);
context.FormApp={openById(id){return {getDestinationType(){return 'synthetic-spreadsheet';},getDestinationId(){return 'different-sheet';}};},DestinationType:{SPREADSHEET:'synthetic-spreadsheet'}};
assert.throws(()=>call("inspectTarget_({name:'synthetic',formId:'copied-form',spreadsheetId:'copied-sheet',sheetId:1},currentDatesPlan_(new Date('2026-10-04T12:00:00Z')))"),/not linked/);
results.push('Missing owner IDs and a mismatched form destination stop inspection before sheet access or writes.');
const report={checkedDate:'2026-10-04',mode:'offline_synthetic_only',googleCalls:0,tests:results,limitations:['Native Forms→Sheets rename behavior and real OAuth/trigger execution remain untested.']};
fs.writeFileSync(path.join(directory,'verification.json'),JSON.stringify(report,null,2)+'\n');
for(const result of results)console.log('✓ '+result);
