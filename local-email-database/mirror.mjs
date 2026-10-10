import {readFile, rename, unlink, mkdir, open, rmdir, access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const csvColumns = [
  ['sourceId','معرّف الطلب'],['receivedAt','تاريخ وصول الإيميل'],
  ['displayName','الاسم'],['nameSource','مصدر الاسم'],['senderName','اسم مرسل الإيميل'],['sender','الإيميل'],
  ['phone','رقم الهاتف'],['organization','اسم الجهة'],['requestSummary','شو المطلوب'],
  ['requestType','نوع الطلب'],['site','المكان'],['startDate','تاريخ البداية'],
  ['endDate','تاريخ النهاية'],['startTime','ساعة البداية'],['endTime','ساعة النهاية'],
  ['guardCount','عدد العمال المطلوب'],['hourlyRate','السعر المذكور للساعة'],
  ['ackState','حالة رد الاستلام'],['sourceManagerStatus','قرار المسؤول الوارد من المصدر'],
  ['managerStatus','قرار المسؤول المسجل محليًا'],['manualNotes','ملاحظات محلية'],
  ['reviewNotes','نواقص تحتاج مراجعة'],['subject','عنوان الإيميل'],['body','نص الإيميل الأصلي'],
  ['updatedAt','آخر تحديث محلي'],['dataMode','نوع البيانات'],
];

const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const compact=value=>value.replace(/\s+/g,' ').trim();
function string(value,max=16000){return typeof value==='string'&&value.length<=max?value:'';}
function validDate(value){if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;try{return new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}}
function dateInQuote(quote,value){
  if(!validDate(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  return [...quote.matchAll(/(?:^|[^\d])(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)|(?:^|[^\d])(\d{1,2})[/.](\d{1,2})[/.](20\d{2})(?!\d)/g)]
    .some(match=>match[1]?Number(match[1])===year&&Number(match[2])===month&&Number(match[3])===day:Number(match[6])===year&&Number(match[5])===month&&Number(match[4])===day);
}
function validReceivedAt(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return '';return value;}
const requestTypes=new Set(['new_request','update','cancellation','unrelated','unclear']);
const requestLabels={new_request:'طلب جديد',update:'تعديل طلب',cancellation:'إلغاء طلب',unrelated:'غير متعلق بطلب',unclear:'بحاجة لتحديد'};
const ackLabels={received:'محفوظ؛ لم يسجل إرسال رد',reserved:'إرسال الرد محجوز؛ يحتاج تحقق',sent:'سجل المصدر إرسال رد',uncertain:'إرسال الرد غير مؤكد'};

// A malformed record aborts the whole pull, so a partial response is never published.
export function normalizeRecord(raw,mode='live',now=new Date().toISOString()){
  if(!isObject(raw))throw new Error('سجل غير صالح في ملف الإدخال.');
  const data=isObject(raw.data)?raw.data:raw;
  if(typeof data.sourceId==='string'&&data.sourceId.startsWith('availability:'))return null;
  if(typeof data.sourceId!=='string'||!/^[A-Za-z0-9:_-]{1,200}$/.test(data.sourceId))throw new Error('سجل بدون معرّف مصدر صالح.');
  if(typeof data.sender!=='string'||data.sender.length>200||!/^\S+@\S+\.\S+$/.test(data.sender))throw new Error('عنوان مرسل غير صالح.');
  if(typeof data.subject!=='string'||!data.subject.trim()||data.subject.length>2000)throw new Error('عنوان إيميل غير صالح.');
  if(typeof data.body!=='string'||!data.body.trim()||data.body.length>100000)throw new Error('نص إيميل غير صالح.');
  const notes=[];let extraction={};
  if(data.extraction!==undefined&&data.extractionJson!==undefined)notes.push('المصدر يحتوي نسختين من الاستخراج؛ لم يعتمد أي منهما.');
  else if(typeof data.extractionJson==='string'){
    if(data.extractionJson.length>32000)notes.push('نتيجة الاستخراج أكبر من الحد المسموح؛ راجع الإيميل.');
    else try{const parsed=JSON.parse(data.extractionJson);if(isObject(parsed))extraction=parsed;else notes.push('نتيجة الاستخراج ليست كائن بيانات.');}catch{notes.push('نتيجة الاستخراج ليست JSON صالحًا.');}
  }else if(isObject(data.extraction))extraction=data.extraction;
  else notes.push('لم يصل استخراج AI؛ المعلومات الأصلية محفوظة.');
  let evidence=extraction.source_evidence;
  if(typeof evidence==='string')try{evidence=JSON.parse(evidence);}catch{evidence={};}
  if(!isObject(evidence))evidence={};
  const sourceText=data.subject+'\n'+data.body;
  const fact=(key,check=value=>compact(evidence[key]).includes(compact(value)),max=200,bodyOnly=false)=>{
    const value=string(extraction[key],max).trim();if(!value)return '';
    const quote=string(evidence[key],2000);
    if(!quote||!(bodyOnly?data.body:sourceText).includes(quote)||!check(value,quote)){notes.push('قيمة '+key+' لم تدعمها عبارة من الإيميل؛ بقيت فارغة.');return '';}
    return value;
  };
  const contactName=fact('contact_name',undefined,150,true);
  const senderName=string(data.requesterName??data.fromName??data.senderName,150).trim();
  const phoneKey=extraction.contact_phone?'contact_phone':'phone';
  const phone=fact(phoneKey,(value,quote)=>{
    const digits=value.replace(/\D/g,'');if(!/^\+?[\d ()-]{6,40}$/.test(value)||digits.length<6||digits.length>20)return false;
    return [...quote.matchAll(/(?:^|[^\d])(\+?\d[\d ()-]{4,38}\d)(?!\d)/g)].some(match=>match[1].replace(/\D/g,'')===digits);
  },40);
  const date=key=>fact(key,(value,quote)=>dateInQuote(quote,value),10);
  const time=key=>fact(key,(value,quote)=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)&&new RegExp('(?:^|[^\\d:.])'+(Number(value.slice(0,2))<10?'0?':'')+Number(value.slice(0,2))+'[:.]'+value.slice(3)+'(?!\\d)').test(quote),5);
  const integer=key=>{
    const rawValue=extraction[key];const value=typeof rawValue==='number'?String(rawValue):string(rawValue,40).trim();if(!value)return '';
    const quote=string(evidence[key],2000),guardWords='(?:מאבטח(?:ים|ות)?|שומר(?:ים|ות)?|אנשי אבטחה|حراس|عمال|guards)';
    const numeric=key==='guard_count'?/^\d{1,4}$/.test(value)&&Number(value)>0&&Number(value)<=1000:/^\d+(?:\.\d+)?$/.test(value)&&Number(value)>0&&Number(value)<=1000000;
    const contextual=key==='guard_count'?new RegExp('(?:^|[^\\d/.:,+-]|[למ][-־])'+value+'\\s*'+guardWords+'(?![\\p{L}\\p{N}])','iu').test(quote):new RegExp('(?:^|[^\\d/.:,+-])'+value.replace('.', '\\.')+'\\s*(?:₪|ש["״\u0027]?ח|שקל(?:ים)?|NIS|USD|للساعة|לשעה)(?![\\p{L}\\p{N}])','iu').test(quote);
    if(!numeric||!quote||!sourceText.includes(quote)||!contextual){notes.push('العدد '+key+' يحتاج مراجعة؛ بقي فارغًا.');return '';}
    return value;
  };
  const type=requestTypes.has(extraction.request_type)?extraction.request_type:'unclear';
  const missing=typeof extraction.missing_fields==='string'?extraction.missing_fields.split(','):Array.isArray(extraction.missing_fields)?extraction.missing_fields:[];
  for(const key of missing){if(typeof key==='string'&&key.trim())notes.push('المصدر يذكر معلومة ناقصة: '+key.trim());}
  if(typeof extraction.ambiguities==='string'&&extraction.ambiguities.trim())notes.push(extraction.ambiguities.trim().slice(0,2000));
  if(extraction.is_automated===true||extraction.is_automated==='true')notes.push('المصدر صنّف الرسالة آلية؛ ليست موافقة على طلب.');
  if(!contactName&&!senderName)notes.push('اسم الشخص غير مذكور؛ عنوان الإيميل موجود.');
  if(!phone)notes.push('رقم الهاتف غير مذكور أو غير مؤكد.');
  const receivedAt=validReceivedAt(data.receivedAt);if(!receivedAt)notes.push('تاريخ الوصول غير مسجل بصيغة مؤكدة.');
  const summary=fact('request_summary',undefined,1000,true);
  const record={
    sourceId:data.sourceId,receivedAt,contactName,displayName:contactName||senderName,nameSource:contactName?'نص الإيميل':senderName?'اسم المرسل في الإيميل':'',senderName,sender:data.sender,
    phone,organization:fact('organization'),requestSummary:summary||data.subject,
    requestType:requestLabels[type],requestTypeCode:type,site:fact('site'),startDate:date('start_date'),endDate:date('end_date'),
    startTime:time('start_time'),endTime:time('end_time'),guardCount:integer('guard_count'),hourlyRate:integer('hourly_rate'),
    ackState:ackLabels[data.ackState]??'',sourceManagerStatus:string(data.managerStatus,200),managerStatus:'',manualNotes:'',
    reviewNotes:[...new Set(notes)].join(' | '),subject:data.subject,body:data.body,updatedAt:now,dataMode:mode==='demo'?'مثال تجريبي':'بيانات مستوردة',
    sourceEvidence:Object.fromEntries(Object.entries(evidence).filter(([key,quote])=>['contact_name','request_summary','contact_phone','phone','organization','site','start_date','end_date','start_time','end_time','guard_count','hourly_rate'].includes(key)&&typeof quote==='string'&&quote.length<=2000&&sourceText.includes(quote))),
  };
  const missingKeys={contact_name:'contactName',request_summary:'requestSummary',contact_phone:'phone',phone:'phone',organization:'organization',site:'site',start_date:'startDate',end_date:'endDate',start_time:'startTime',end_time:'endTime',guard_count:'guardCount',hourly_rate:'hourlyRate'};
  for(const key of missing){const target=missingKeys[key?.trim?.()];if(target)record[target]='';}
  record.displayName=record.contactName||senderName;record.nameSource=record.contactName?'نص الإيميل':senderName?'اسم المرسل في الإيميل':'';
  if(!record.requestSummary)record.requestSummary=data.subject;
  return record;
}

export function normalizeSnapshot(input,mode,now){
  const rawRecords=Array.isArray(input)?input:isObject(input)&&Array.isArray(input.records)?input.records:null;
  if(!rawRecords)throw new Error('ملف الإدخال لازم يحتوي مصفوفة records.');
  if(rawRecords.length>100000)throw new Error('عدد السجلات أكبر من الحد المسموح.');
  const byId=new Map();
  for(const raw of rawRecords){const record=normalizeRecord(raw,mode,now);if(!record)continue;
    const previous=byId.get(record.sourceId);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(record))throw new Error('معرّف مكرر بمعلومات متعارضة؛ لم يحدّث الملف.');
    byId.set(record.sourceId,record);
  }
  return [...byId.values()];
}

export function mergeLedger(previous,records,mode,now){
  if(previous&&(!isObject(previous)||previous.schemaVersion!==1||!Array.isArray(previous.records)))throw new Error('قاعدة البيانات المحلية غير صالحة؛ لم يجر استبدالها.');
  if(previous&&previous.mode!==mode)throw new Error('بيانات المثال منفصلة عن البيانات الفعلية؛ اختَر مجلدًا آخر.');
  const byId=new Map();
  for(const record of previous?.records??[]){if(!isObject(record)||typeof record.sourceId!=='string'||byId.has(record.sourceId))throw new Error('قاعدة البيانات تحتوي سجلًا غير صالح أو مكررًا.');byId.set(record.sourceId,record);}
  for(const record of records){const old=byId.get(record.sourceId);byId.set(record.sourceId,{...record,managerStatus:string(old?.managerStatus,200),manualNotes:string(old?.manualNotes,10000),manualUpdatedAt:string(old?.manualUpdatedAt,100)});}
  return {schemaVersion:1,mode,updatedAt:now,lastPullCount:records.length,records:[...byId.values()].sort((a,b)=>(b.receivedAt??'').localeCompare(a.receivedAt??'')||a.sourceId.localeCompare(b.sourceId))};
}

// Quote every cell, use UTF-8 BOM, and neutralize spreadsheet formula prefixes.
// Phone stays a string in the ledger; CSV prefixes an apostrophe for leading zero / plus.
export function csvCell(value,key){
  let cell=value===undefined||value===null?'':String(value);
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)||key==='phone'&&/^0/.test(cell))cell="'"+cell;
  return '"'+cell.replaceAll('"','""')+'"';
}
export function ledgerCsv(ledger){
  return '\uFEFF'+[csvColumns.map(([key,label])=>csvCell(label,key)).join(','),...ledger.records.map(record=>csvColumns.map(([key])=>csvCell(record[key],key)).join(','))].join('\r\n')+'\r\n';
}

export async function atomicWrite(file,content){
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.tmp-'+randomUUID();
  try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(content,'utf8');await handle.sync();}finally{await handle.close();}await rename(temporary,file);}
  catch(error){await unlink(temporary).catch(()=>{});throw error;}
}
export async function loadLedger(outDir){
  try{return JSON.parse(await readFile(path.join(outDir,'requests.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new Error('تعذر قراءة قاعدة البيانات المحلية؛ لم يجر استبدالها.');}
}
export async function saveLedger(outDir,ledger){
  // JSON is authoritative. A locked CSV remains valid; run again after closing Excel.
  await atomicWrite(path.join(outDir,'requests.json'),JSON.stringify(ledger,null,2)+'\n');
  try{await atomicWrite(path.join(outDir,'requests.csv'),ledgerCsv(ledger));}catch{throw new Error('حُفظت قاعدة JSON، لكن Excel قد يكون فاتح ملف CSV. أغلق CSV وأعد التشغيل لتحديث العرض.');}
}
export async function withLocalLock(outDir,operation){
  await mkdir(outDir,{recursive:true});const lock=path.join(outDir,'.sync-lock');
  try{await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw new Error('تحديث محلي آخر يعمل، أو بقي قفل بعد إغلاق مفاجئ. لم يجر تغيير الملفات.');throw error;}
  try{return await operation();}finally{await rmdir(lock);}
}
export async function importFile(inputFile,outDir,mode='live'){
  const input=JSON.parse(await readFile(inputFile,'utf8'));if(input.demo===true&&mode!=='demo')throw new Error('هذا ملف مثال تجريبي؛ استخدم --demo ومجلد المثال.');
  const now=new Date().toISOString();const records=normalizeSnapshot(input,mode,now);
  return withLocalLock(outDir,async()=>{const previous=await loadLedger(outDir),ledger=mergeLedger(previous,records,mode,now);await saveLedger(outDir,ledger);return ledger;});
}

export function makeConfig(env=process.env){
  const token=env.MAKE_API_TOKEN??'',dataStoreId=env.MAKE_DATA_STORE_ID??'',zone=env.MAKE_ZONE??'eu1.make.com';
  if(!token||!/^\d+$/.test(dataStoreId))throw new Error('لا يوجد إعداد Make. لم يتم الاتصال؛ استخدم مثال العرض أو جهّز المتغيرات لاحقًا.');
  if(token.length>4096||/[\r\n]/.test(token)||!['eu1.make.com','eu2.make.com','us1.make.com','us2.make.com'].includes(zone))throw new Error('إعداد اتصال غير صالح.');
  return {token,dataStoreId,zone};
}
export function liveModeAllowed(env=process.env){
  if(env.MAKE_SYNC_ENABLED!=='true')throw new Error('التشغيل الفعلي مقفول؛ يلزم MAKE_SYNC_ENABLED=true بعد موافقة الشركة وإكمال الربط.');
  const mailbox=env.COMPANY_MAILBOX;
  if(typeof mailbox!=='string'||mailbox.length>200||!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(mailbox))throw new Error('يجب تحديد بريد الشركة الصحيح قبل القراءة الفعلية.');
  return true;
}
export async function fetchSnapshot(config,fetcher=fetch){
  const records=[];let offset=0;
  for(let page=0;page<1000;page++){
    const url=new URL(`https://${config.zone}/api/v2/data-stores/${config.dataStoreId}/data`);url.searchParams.set('pg[limit]','100');url.searchParams.set('pg[offset]',String(offset));
    let response;try{response=await fetcher(url,{headers:{Authorization:'Token '+config.token,Accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw new Error('تعذر قراءة Make؛ بقيت الملفات المحلية السابقة.');}
    if(!response.ok)throw new Error('قراءة Make لم تنجح (HTTP '+response.status+'). بقيت الملفات السابقة.');
    let data;try{data=await response.json();}catch{throw new Error('Make رجّع بيانات غير قابلة للقراءة؛ بقيت الملفات السابقة.');}
    if(!isObject(data)||!Array.isArray(data.records)||data.records.length>100)throw new Error('استجابة Make غير متوقعة؛ بقيت الملفات السابقة.');
    records.push(...data.records);if(data.records.length<100)return {records};offset+=data.records.length;
  }
  throw new Error('تجاوزت القراءة حد 100000 سجل؛ لم تحفظ استجابة ناقصة.');
}
export async function pullMake(outDir,config=makeConfig(),fetcher=fetch){
  const input=await fetchSnapshot(config,fetcher),now=new Date().toISOString();
  const records=normalizeSnapshot(input,'live',now);
  return withLocalLock(outDir,async()=>{const previous=await loadLedger(outDir),ledger=mergeLedger(previous,records,'live',now);await saveLedger(outDir,ledger);return ledger;});
}
export async function renderXlsx(outDir,renderer,explicit=false){
  const script=renderer?path.resolve(renderer):path.join(path.dirname(fileURLToPath(import.meta.url)),'render-xlsx.mjs');
  try{await access(script);}catch{if(explicit)throw new Error('ملف مُصدّر Excel غير موجود. JSON وCSV محفوظان.');return false;}
  const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(?:TOKEN|SECRET|KEY|PASSWORD)/i.test(key)));
  try{await promisify(execFile)(process.execPath,[script,'--input',path.join(outDir,'requests.json'),'--output',path.join(outDir,'requests.xlsx')],{env:safeEnv,timeout:120000,maxBuffer:100000,windowsHide:true});return true;}
  catch{
    const message='حُفظ JSON وCSV، لكن ملف Excel لم يتحدث. أغلق Excel وأعد التشغيل؛ المصدّر يحتاج مكتبته المحلية.';
    if(explicit)throw new Error(message);
    console.warn(message);return false;
  }
}
function parseArgs(args){
  const options={};for(let index=0;index<args.length;index++){const name=args[index];if(['--once','--watch','--demo','--help'].includes(name)){options[name]=true;continue;}if(['--input','--out','--interval','--annotate','--notes','--manager-status','--xlsx-renderer'].includes(name)&&args[index+1]&&!args[index+1].startsWith('--')){options[name]=args[++index];continue;}throw new Error('خيار غير معروف أو بدون قيمة: '+name);}
  return options;
}
const help=`ملف طلبات الإيميل المحلي — بدون إرسال إيميلات\n\nمثال العرض:\n  node mirror.mjs --demo --input demo-records.json --out data-demo\nاستيراد ملف JSON حقيقي:\n  node mirror.mjs --input records.json --out data\nقراءة Make لاحقًا، باستخدام إعدادات صاحب الشركة فقط:\n  node start-live.mjs --project "C:\\path\\wardiya-web" --once\n  node start-live.mjs --project "C:\\path\\wardiya-web"\nملاحظة محلية:\n  node mirror.mjs --annotate gmail:MESSAGE_ID --notes "تواصلت مع العميل" --manager-status "بانتظار المسؤول" --out data-live\n\nحارس القراءة الفعلية: MAKE_SYNC_ENABLED=true وCOMPANY_MAILBOX صحيح.\nإعدادات القراءة: MAKE_API_TOKEN، MAKE_DATA_STORE_ID، MAKE_ZONE.\n--watch يعمل فقط طول ما النافذة والكمبيوتر شغّالين؛ Ctrl+C يوقفه.\nrequests.json هو السجل؛ requests.csv نسخة عرض لـ Excel. أغلق CSV أثناء التحديث.\n`;
export async function cli(args=process.argv.slice(2)){
  const options=parseArgs(args);if(options['--help']){console.log(help);return;}
  const outDir=path.resolve(options['--out']??(options['--demo']?'data-demo':'data'));
  if(options['--annotate']){
    if(options['--input']||options['--once']||options['--watch']||options['--demo']||options['--notes']===undefined&&options['--manager-status']===undefined)throw new Error('الملاحظة تحتاج معرّفًا ونصًا أو حالة، بدون خيارات مزامنة.');
    await withLocalLock(outDir,async()=>{const ledger=await loadLedger(outDir);if(!ledger)throw new Error('لا يوجد سجل محلي بعد.');
      const record=ledger.records.find(item=>item.sourceId===options['--annotate']);if(!record)throw new Error('معرّف الطلب غير موجود في السجل.');
      if(options['--notes']!==undefined){if(options['--notes'].length>10000)throw new Error('الملاحظة طويلة جدًا.');record.manualNotes=options['--notes'];}
      if(options['--manager-status']!==undefined){if(options['--manager-status'].length>200)throw new Error('الحالة طويلة جدًا.');record.managerStatus=options['--manager-status'];}
      record.manualUpdatedAt=new Date().toISOString();await saveLedger(outDir,ledger);
    });await renderXlsx(outDir,options['--xlsx-renderer'],!!options['--xlsx-renderer']);console.log('حُفظت الملاحظة المحلية فقط.');return;
  }
  if(options['--notes']!==undefined||options['--manager-status']!==undefined)throw new Error('الملاحظة تحتاج --annotate ومعرّف طلب.');
  if(options['--input']){
    if(options['--once']||options['--watch'])throw new Error('اختَر ملف إدخال أو Make.');
    const ledger=await importFile(path.resolve(options['--input']),outDir,options['--demo']?'demo':'live');await renderXlsx(outDir,options['--xlsx-renderer'],!!options['--xlsx-renderer']);console.log(`حُفظ ${ledger.records.length} طلب في ${outDir}`);return;
  }
  if(options['--demo'])throw new Error('وضع المثال يحتاج --input demo-records.json.');
  if(!!options['--once']===!!options['--watch'])throw new Error('حدد --input أو --once أو --watch. لن يبدأ التشغيل تلقائيًا.');
  liveModeAllowed();
  const config=makeConfig(); // Validate before opening a loop; no implicit connection.
  const seconds=Number(options['--interval']??900);if(!Number.isInteger(seconds)||seconds<60||seconds>86400)throw new Error('الفاصل لازم يكون من 60 إلى 86400 ثانية.');
  const run=async()=>{const ledger=await pullMake(outDir,config);await renderXlsx(outDir,options['--xlsx-renderer'],!!options['--xlsx-renderer']);console.log(new Date().toLocaleString()+`: ${ledger.records.length} طلب محلي.`);};
  await run();if(options['--once'])return;
  console.log('المتابعة المحلية تعمل؛ Ctrl+C للإيقاف.');
  let stopped=false;const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  while(!stopped){await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);process.off('SIGINT',finish);process.off('SIGTERM',finish);resolve();};const timer=setTimeout(finish,seconds*1000);process.once('SIGINT',finish);process.once('SIGTERM',finish);});if(stopped)break;try{await run();}catch(error){console.error(error.message);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)cli().catch(error=>{console.error(error.message);process.exitCode=1;});
