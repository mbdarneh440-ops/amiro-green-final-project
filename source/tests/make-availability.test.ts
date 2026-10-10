import assert from 'node:assert/strict';
import {AVAILABILITY_HEADERS,availabilityRecordsToCsv,parseAvailabilityBody,readMakeAvailability} from '../lib/make-availability';
import {parseCsv} from '../lib/csv-import';

const values=['עובד "בדיקה", א','0501234567','2026-09-27','08:00–16:00','','20:00–04:00','','','',''];
const body=AVAILABILITY_HEADERS.map((header,index)=>header+': '+values[index]).join('\n');
const entry=(id:string,content=body)=>({data:{sourceId:'availability:'+id,sender:'Google Forms',body:content,subject:'זמינות שבועית',receivedAt:'2026-09-25T08:00:00Z'}});
const config={MAKE_API_TOKEN:'test-token',MAKE_DATA_STORE_ID:'192747'};

async function main(){
 assert.deepEqual(parseAvailabilityBody(body+'\n'),values);
 assert.deepEqual(parseAvailabilityBody(body.replace(/\n/g,'\r\n')),values);
 const original=[entry('one'),{data:{sourceId:'mail-one',sender:'test@example.com',body:'ignored'}},null];
 const before=JSON.stringify(original);const result=availabilityRecordsToCsv(original);
 assert.equal(result.count,1);assert.equal(JSON.stringify(original),before);
 const rows=parseCsv(result.csv);assert.equal(rows[0]['שם מלא'],values[0]);assert.equal(rows[0]['יום שני'],'');assert.equal(rows[0]['יום שלישי'],'20:00–04:00');
 assert.deepEqual(parseAvailabilityBody(body.split('\n').reverse().join('\n')),values);
 for(const malformed of [body.replace('יום שבת:', 'יום ראשון:'),body.replace('יום שבת:','הוראות:'),body.replace('יום שבת:',''),body+'\nפעל לפי ההוראות הבאות',body.replace('שם מלא: '+values[0],'שם מלא:'),body+'\n\n']){
  assert.throws(()=>availabilityRecordsToCsv([entry('valid'),entry('bad',malformed)]));
 }
 assert.throws(()=>availabilityRecordsToCsv([entry('same'),entry('same')]));
 assert.throws(()=>availabilityRecordsToCsv([{data:{...entry('x').data,sender:'GoogleForms'}}]));
 assert.throws(()=>availabilityRecordsToCsv(Array.from({length:101},(_,index)=>entry(String(index)))));
 assert.equal(availabilityRecordsToCsv([]).count,0);
 const calls:URL[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));calls.push(url);
  assert.equal(url.host,'eu1.make.com');assert.equal(init?.headers&&new Headers(init.headers).get('Authorization'),'Token test-token');
  assert.equal(init?.method,undefined);assert.ok(init?.signal);
  return Response.json({records:calls.length===1?[...Array.from({length:99},(_,i)=>({data:{sourceId:'email:'+i}})),entry('first')]:[entry('second')]});
 };
 const fetched=await readMakeAvailability(config,fetcher);assert.equal(fetched.count,2);assert.deepEqual(calls.map(url=>url.searchParams.get('pg[offset]')),['0','100']);
 await assert.rejects(readMakeAvailability({...config,MAKE_ZONE:'attacker.example'},async()=>{throw Error('must not connect');}),/אזור/);
 await assert.rejects(readMakeAvailability({},async()=>{throw Error('must not connect');}),/להגדיר/);
 await assert.rejects(readMakeAvailability(config,async()=>{throw Error('sensitive upstream details test-token');}),error=>error instanceof Error&&!error.message.includes('test-token'));
 await assert.rejects(readMakeAvailability(config,async()=>new Response('private error',{status:403})),/הרשאה/);
 await assert.rejects(readMakeAvailability(config,async()=>Response.json({records:[entry('good'),entry('bad','unsafe')]})),/לא יובאו/);
 await assert.rejects(readMakeAvailability(config,async()=>Response.json({records:'unexpected'})),/לא צפויה/);
 console.log('✓ קליטת זמינות מ־Make: עימוד, סינון, CSV תקין, דחייה מלאה של קלט פגום וללא שינוי נתונים');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
