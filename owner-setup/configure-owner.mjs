import {open,stat,lstat,realpath,rename,unlink,link} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline/promises';

export const allowedZones=new Set(['eu1.make.com','eu2.make.com','us1.make.com','us2.make.com']);
export const ownerKeys=['COMPANY_MAILBOX','MAKE_API_TOKEN','MAKE_DATA_STORE_ID','MAKE_ZONE','MAKE_SYNC_ENABLED','AI_API_KEY','AI_MODEL','AI_ENABLED'];
const noControl=value=>typeof value==='string'&&!/[\u0000-\u001f\u007f]/.test(value);
export function validateEmail(value){
  if(!noControl(value)||value.length>200||! /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(value))throw Error('כתובת הדוא״ל של החברה אינה תקינה.');
  return value;
}
export function validateSecret(value,label,optional=false){
  if(optional&&value==='')return '';
  // Tokens are written as data, never shell text. Reject control characters and
  // whitespace rather than quietly trimming a pasted credential.
  if(!noControl(value)||value.length<16||value.length>4096||/\s/.test(value)||! /^[A-Za-z0-9._:/+=-]+$/.test(value))throw Error(label+' אינו תקין; אין להשתמש ברווחים או במספר שורות.');
  return value;
}
export function validateConfig(input,flags={}){
  const mailbox=validateEmail(input.companyMailbox);
  const makeToken=validateSecret(input.makeToken,'מפתח Make');
  const storeId=input.dataStoreId;
  if(typeof storeId!=='string'||! /^[1-9]\d{0,14}$/.test(storeId))throw Error('מזהה מאגר Make אינו תקין.');
  const zone=input.zone||'eu1.make.com';if(!allowedZones.has(zone))throw Error('אזור Make אינו מוכר.');
  const aiKey=validateSecret(input.aiKey??'','מפתח AI',true);
  const aiModel=input.aiModel??'';
  if(typeof aiModel!=='string'||aiModel.length>100||aiModel!==''&&! /^[A-Za-z0-9._-]+$/.test(aiModel))throw Error('שם מודל AI אינו תקין.');
  if(flags.enableAi===true&&!aiKey)throw Error('הפעלת AI דורשת מפתח AI חדש שמספק בעל החברה.');
  return {
    COMPANY_MAILBOX:mailbox,MAKE_API_TOKEN:makeToken,MAKE_DATA_STORE_ID:storeId,MAKE_ZONE:zone,
    MAKE_SYNC_ENABLED:flags.enableMakeSync===true?'true':'false',AI_API_KEY:aiKey,AI_MODEL:aiModel,AI_ENABLED:flags.enableAi===true?'true':'false',
  };
}
export function serializeEnv(config){
  if(!config||typeof config!=='object'||Array.isArray(config)||Object.keys(config).some(key=>!ownerKeys.includes(key))||ownerKeys.some(key=>typeof config[key]!=='string'||!noControl(config[key])))throw Error('ההגדרות כוללות משתנים שאינם מורשים או שורות שאינן מותרות.');
  // Each value stays on one physical line. Never interpolate it into a command.
  return '# Owner configuration created locally. Do not share this file.\n'+ownerKeys.map(key=>key+'='+JSON.stringify(config[key])).join('\n')+'\n';
}

export async function projectTarget(project){
  if(typeof project!=='string'||!project.trim()||/[\u0000\r\n]/.test(project))throw Error('בחרו תיקיית פרויקט באמצעות --project.');
  const directory=await realpath(path.resolve(project)).catch(()=>{throw Error('תיקיית הפרויקט אינה קיימת.');});
  const directoryInfo=await stat(directory);if(!directoryInfo.isDirectory())throw Error('הנתיב אינו תיקיית פרויקט.');
  const packageInfo=await stat(path.join(directory,'package.json')).catch(()=>{throw Error('התיקייה שנבחרה אינה מכילה package.json; בחרו את תיקיית האתר עצמו.');});
  if(!packageInfo.isFile())throw Error('package.json אינו תקין.');
  return {directory,file:path.join(directory,'.env')};
}
export async function existingEnvInfo(file){
  try{const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw Error('קובץ .env אינו קובץ רגיל; לא בוצעה כתיבה.');return {exists:true,nonempty:info.size>0};}
  catch(error){if(error.code==='ENOENT')return {exists:false,nonempty:false};throw error;}
}
export async function writeOwnerEnv(project,config,{replace=false}={}){
  const target=await projectTarget(project),info=await existingEnvInfo(target.file);
  if(info.exists&&!replace)throw Error('קובץ .env כבר קיים. תוכנו לא נקרא ולא השתנה. --replace מחליף אותו במלואו בהגדרות החדשות של הבעלים.');
  const content=serializeEnv(config),temporary=path.join(target.directory,'.env.owner-config-'+randomUUID()+'.tmp');
  let created=false;
  try{
    const handle=await open(temporary,'wx',0o600);created=true;
    try{await handle.writeFile(content,'utf8');await handle.sync();}finally{await handle.close();}
    // Check again after staging. Without --replace, never overwrite a file
    // that appeared or became nonempty while the user was entering values.
    const current=await existingEnvInfo(target.file);
    if(current.exists&&!replace)throw Error('קובץ .env הופיע במהלך ההגדרה. הקובץ הקיים נשאר ללא שינוי.');
    if(!replace){
      // Atomic no-replace publication: a same-directory hard link exposes
      // only the completed, closed staged file and refuses a racing .env.
      await link(temporary,target.file);
      await unlink(temporary);created=false;
    }else{await rename(temporary,target.file);created=false;}
    return target.file;
  }catch(error){if(created)await unlink(temporary).catch(()=>{});throw error;}
}

export function readMaskedSecret(prompt,{input=process.stdin,output=process.stdout}={}){
  if(!input.isTTY||!output.isTTY||typeof input.setRawMode!=='function')throw Error('המפתחות דורשים חלון TTY אינטראקטיבי. אין להעביר אותם בשורת הפקודה או דרך pipe.');
  return new Promise((resolve,reject)=>{
    let secret='',finished=false;const wasRaw=!!input.isRaw;
    const finish=(error,value)=>{if(finished)return;finished=true;input.off('data',onData);input.off('error',onError);input.setRawMode(wasRaw);input.pause();output.write('\n');error?reject(error):resolve(value);};
    const onError=()=>finish(Error('לא ניתן לקרוא את המפתח; הוא לא נשמר.'));
    const onData=chunk=>{
      const text=chunk.toString('utf8').replace(/\u001b\[[0-9;]*[A-Za-z~]/g,'');
      for(let index=0;index<text.length;index++){
        const character=text[index];
        if(character==='\u0003'){finish(Error('ההגדרה בוטלה.'));return;}
        if(character==='\r'||character==='\n'){
          if(text.slice(index+1).trim()){finish(Error('המפתח הכיל מספר שורות; הוא לא נשמר.'));return;}
          finish(null,secret);return;
        }
        if(character==='\u007f'||character==='\b'){if(secret){secret=secret.slice(0,-1);output.write('\b \b');}continue;}
        if(!/^[\x21-\x7e]$/.test(character)||secret.length>=4096){finish(Error('המפתח הכיל תו שאינו תקין; הוא לא נשמר.'));return;}
        secret+=character;output.write('*');
      }
    };
    output.write(prompt);input.setRawMode(true);input.resume();input.on('data',onData);input.on('error',onError);
  });
}
export function parseArguments(args){
  const options={project:'',replace:false,enableMakeSync:false,enableAi:false,help:false};
  for(let index=0;index<args.length;index++){
    const argument=args[index];
    if(argument==='--project'&&args[index+1]&&!args[index+1].startsWith('--')){options.project=args[++index];continue;}
    const flags={'--replace':'replace','--enable-make-sync':'enableMakeSync','--enable-ai':'enableAi','--help':'help'};
    if(flags[argument]){options[flags[argument]]=true;continue;}
    throw Error('אפשרות לא מוכרת. אין להזין מפתחות בשורת הפקודה.');
  }
  return options;
}
const help=`הגדרת בעל החברה — ללא חיבור חיצוני\n\nnode configure-owner.mjs --project "C:\\path\\wardiya-web"\n\n--replace מחליף את .env במלואו, ללא שימוש חוזר במפתח קודם.\nהשירותים נשארים כבויים כברירת מחדל. רק לאחר השלמת חיבורי החברה והבדיקות:\n--enable-make-sync מאפשר קריאה מ-Make באתר לאחר הפעלה מחדש.\n--enable-ai מאפשר שימוש במפתח AI שהזין בעל החברה לאחר הפעלה מחדש.\nהאפשרויות האלה אינן מפעילות תרחישי Make ואינן מעניקות OAuth ל-Gmail או ל-Sheets.\nהמפתחות מוזנים מקומית ומוסתרים; אין להעבירם כארגומנטים או כמשתני קלט לתוכנית הזאת.\n`;
export async function cli(args=process.argv.slice(2)){
  const options=parseArguments(args);if(options.help){console.log(help);return;}
  if(Number(process.versions.node.split('.')[0])<22)throw Error('הכלי הזה דורש Node.js 22 או חדש יותר.');
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('פתחו PowerShell אינטראקטיבי. לא נקרא ולא נכתב שום מפתח.');
  const target=await projectTarget(options.project),existing=await existingEnvInfo(target.file);
  if(existing.exists&&!options.replace)throw Error('קובץ .env כבר קיים. הוא לא נקרא ולא השתנה. הפעילו שוב עם --replace רק אם ברצונכם להחליפו במלואו.');
  console.log('הכלי כותב קובץ הגדרות מקומי בלבד; הוא אינו מתחבר ל-Make, ל-Google או ל-AI.');
  console.log(options.replace?'קובץ .env יוחלף במלואו בהגדרות החדשות של הבעלים, ללא העתקת המפתחות הישנים.':'ייווצר קובץ .env חדש להגדרות הבעלים.');
  console.log('MAKE_SYNC_ENABLED='+options.enableMakeSync+' | AI_ENABLED='+options.enableAi);
  let reader=createInterface({input:process.stdin,output:process.stdout});
  const input={};
  try{
    input.companyMailbox=(await reader.question('דוא״ל החברה: ')).trim();validateEmail(input.companyMailbox);
    input.dataStoreId=(await reader.question('מזהה מאגר בקשות Make של החברה: ')).trim();if(!/^[1-9]\d{0,14}$/.test(input.dataStoreId))throw Error('מזהה מאגר Make אינו תקין.');
    input.zone=(await reader.question('אזור Make [eu1.make.com]: ')).trim()||'eu1.make.com';if(!allowedZones.has(input.zone))throw Error('אזור Make אינו מוכר.');
  }finally{reader.close();}
  input.makeToken=await readMaskedSecret('מפתח Make של החברה (מוסתר): ');validateSecret(input.makeToken,'מפתח Make');
  input.aiKey=await readMaskedSecret('מפתח AI חדש, אופציונלי (מוסתר; Enter לדילוג): ');validateSecret(input.aiKey,'מפתח AI',true);
  if(input.aiKey){reader=createInterface({input:process.stdin,output:process.stdout});try{input.aiModel=(await reader.question('שם מודל AI אופציונלי [השאירו ריק לשימוש בהגדרת האתר]: ')).trim();}finally{reader.close();}}
  const config=validateConfig(input,options);
  const file=await writeOwnerEnv(target.directory,config,{replace:options.replace});
  input.makeToken='';input.aiKey='';config.MAKE_API_TOKEN='';config.AI_API_KEY='';
  console.log('קובץ הגדרות הבעלים נשמר: '+file);
  console.log('סגרו את האתר והפעילו אותו מחדש כדי שיקרא את .env. המפתח נמצא בקובץ מקומי: אין לשלוח אותו עם חבילת הפרויקט.');
  console.log('חיבור חשבון החברה ל-Google ב-Make, בדיקת ההרשאות והיתרה והפעלת התרחישים הם שלבים נפרדים.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)cli().catch(error=>{console.error(error.message);process.exitCode=1;});
