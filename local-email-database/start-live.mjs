import {readFile,stat,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {makeConfig} from './mirror.mjs';

export const liveKeys=new Set(['COMPANY_MAILBOX','MAKE_SYNC_ENABLED','MAKE_API_TOKEN','MAKE_DATA_STORE_ID','MAKE_ZONE']);
// Parse dotenv data only. No eval, shell expansion, sourcing, or arbitrary env pass-through.
export function parseOwnerEnv(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>1048576)throw Error('ملف الإعداد أكبر من الحد المسموح أو غير صالح.');
  const result={};
  for(const original of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=original.trim();if(!line||line.startsWith('#'))continue;
    const equals=line.indexOf('=');if(equals<1)continue;
    const key=line.slice(0,equals).trim();if(!liveKeys.has(key))continue;
    if(Object.hasOwn(result,key))throw Error('متغير إعداد مطلوب مكرر؛ صحح ملف المالك.');
    const encoded=line.slice(equals+1).trim();let value;
    if(encoded.startsWith('"')){
      try{value=JSON.parse(encoded);}catch{throw Error('قيمة إعداد مطلوبة ليست نصًا مقتبسًا صالحًا.');}
    }else if(encoded.startsWith("'")&&encoded.endsWith("'")&&encoded.length>=2){value=encoded.slice(1,-1);}
    else{if(/[\s#'"`]/.test(encoded))throw Error('قيمة إعداد مطلوبة تحتاج اقتباسًا صالحًا.');value=encoded;}
    if(typeof value!=='string'||value.length>4096||/[\u0000-\u001f\u007f]/.test(value))throw Error('قيمة إعداد مطلوبة تحتوي محارف غير صالحة.');
    result[key]=value;
  }
  return result;
}
export function validateLiveConfig(config){
  if(config.MAKE_SYNC_ENABLED!=='true')throw Error('التشغيل الفعلي مقفول. لم يبدأ اتصال: يلزم MAKE_SYNC_ENABLED=true بعد موافقة الشركة وإكمال الربط.');
  const mailbox=config.COMPANY_MAILBOX;
  if(typeof mailbox!=='string'||mailbox.length>200||!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(mailbox))throw Error('بريد الشركة غير صالح أو غير محدد؛ لم يبدأ اتصال.');
  const token=config.MAKE_API_TOKEN;
  if(typeof token!=='string'||token.length<16||token.length>4096||! /^[A-Za-z0-9._:/+=-]+$/.test(token))throw Error('مفتاح Make غير صالح أو غير محدد؛ لم يبدأ اتصال.');
  if(typeof config.MAKE_DATA_STORE_ID!=='string'||! /^[1-9]\d{0,14}$/.test(config.MAKE_DATA_STORE_ID))throw Error('معرّف مخزن الشركة غير صالح؛ لم يبدأ اتصال.');
  makeConfig(config); // Shares the exact zone allowlist used by the mirror.
  return Object.fromEntries([...liveKeys].filter(key=>config[key]!==undefined).map(key=>[key,config[key]]));
}
export async function readOwnerConfig(project){
  if(typeof project!=='string'||!project.trim()||/[\u0000\r\n]/.test(project))throw Error('اختر مجلد الموقع بواسطة --project.');
  const directory=await realpath(path.resolve(project)).catch(()=>{throw Error('مجلد الموقع غير موجود.');});
  if(!(await stat(directory)).isDirectory())throw Error('المسار ليس مجلد موقع.');
  const packageInfo=await stat(path.join(directory,'package.json')).catch(()=>{throw Error('المجلد المختار لا يحتوي package.json.');});
  if(!packageInfo.isFile())throw Error('package.json غير صالح.');
  const file=path.join(directory,'.env');
  const info=await lstat(file).catch(()=>{throw Error('لم يُجهّز ملف .env الخاص بالمالك في هذا الموقع.');});
  if(!info.isFile()||info.isSymbolicLink()||info.size>1048576)throw Error('ملف .env ليس ملفًا محليًا عاديًا صالحًا.');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file));}catch{throw Error('تعذر قراءة ملف المالك بصيغة UTF-8؛ لم يبدأ الاتصال.');}
  return validateLiveConfig(parseOwnerEnv(text));
}
export function parseLiveArguments(args){
  const options={project:'',out:'',once:false,help:false};
  for(let index=0;index<args.length;index++){
    const key=args[index];
    if(['--project','--out'].includes(key)&&args[index+1]&&!args[index+1].startsWith('--')){options[key.slice(2)]=args[++index];continue;}
    if(key==='--once'){options.once=true;continue;}if(key==='--help'){options.help=true;continue;}
    throw Error('خيار غير صالح؛ المفاتيح لا تُقبل في سطر الأوامر.');
  }
  return options;
}
export function launchPlan(options,config,{baseDirectory=path.dirname(fileURLToPath(import.meta.url)),environment=process.env}={}){
  const checked=validateLiveConfig(config),out=path.resolve(options.out||path.join(baseDirectory,'data-live'));
  const safeEnv=Object.fromEntries(Object.entries(environment).filter(([key])=>!/(?:TOKEN|SECRET|KEY|PASSWORD)/i.test(key)&&!liveKeys.has(key)));
  const args=[path.join(baseDirectory,'mirror.mjs'),options.once?'--once':'--watch'];if(!options.once)args.push('--interval','900');args.push('--out',out);
  return {executable:process.execPath,args,env:{...safeEnv,...checked},out};
}
const help=`متابعة ملف طلبات الشركة — تشغيل صريح فقط\n\nnode start-live.mjs --project "C:\\path\\wardiya-web"\nnode start-live.mjs --project "C:\\path\\wardiya-web" --out "C:\\Company\\EmailRequests" --once\n\nيقرأ 5 متغيرات فقط من .env الذي جهّزه صاحب الشركة؛ لا يستخدم مفاتيح جلسة الطالب.\nيلزم MAKE_SYNC_ENABLED=true وبريد الشركة ومفتاح Make ومعرّف مخزنها.\nالوضع الافتراضي لهذا المشغّل بعد الحارس: تحديث كل 15 دقيقة ما دامت النافذة مفتوحة.\nJSON وCSV يعملان دون مكتبة Excel؛ XLSX اختياري. لا يوجد تشغيل مع بدء Windows.\n`;
export async function cli(args=process.argv.slice(2)){
  const options=parseLiveArguments(args);if(options.help){console.log(help);return;}
  if(Number(process.versions.node.split('.')[0])<22)throw Error('هذا المشغّل يحتاج Node.js 22 أو أحدث.');
  const config=await readOwnerConfig(options.project),plan=launchPlan(options,config);
  console.log('بدأت قراءة مخزن الطلبات الذي حدده صاحب الشركة. لم يُفتح البريد ولم تُرسل رسائل.');
  console.log('مجلد البيانات المحلي: '+plan.out);
  console.log(options.once?'قراءة واحدة فقط.':'متابعة كل 15 دقيقة؛ Ctrl+C للإيقاف. النافذة والكمبيوتر يجب أن يبقيا شغّالين.');
  await new Promise((resolve,reject)=>{
    const child=spawn(plan.executable,plan.args,{env:plan.env,stdio:'inherit',windowsHide:true});
    const stop=()=>{if(!child.killed)child.kill('SIGINT');};
    process.on('SIGINT',stop);process.on('SIGTERM',stop);
    const cleanup=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);};
    child.once('error',()=>{cleanup();reject(Error('تعذر تشغيل المتابعة المحلية؛ لم تُرسل مفاتيح إلى خدمة خارجية بواسطة المشغّل.'));});
    child.once('exit',code=>{cleanup();process.exitCode=code??0;resolve();});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)cli().catch(error=>{console.error(error.message);process.exitCode=1;});
