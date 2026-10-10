import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { createHash } from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const sameRoot=process.platform==='win32'
  ? path.resolve(process.cwd()).toLowerCase()===path.resolve(root).toLowerCase()
  : path.resolve(process.cwd())===path.resolve(root);
if(!sameRoot)process.chdir(root);
const version=process.versions.node.split('.').map(Number);
if(version[0]<22||(version[0]===22&&version[1]<13))throw Error('נדרשת גרסת Node.js 22.13 ומעלה');
process.env.PATH=path.dirname(process.execPath)+path.delimiter+process.env.PATH;
const shim=path.join(root,'scripts','windows-runtime.cjs').replaceAll('\\','/');
process.env.NODE_OPTIONS=[process.env.NODE_OPTIONS||'',`--require "${shim}"`].filter(Boolean).join(' ');
process.env.npm_config_cache??=path.join(root,'.sites-runtime','npm-cache');
process.env.SHARP_IGNORE_GLOBAL_LIBVIPS??='1';
const noOpen=process.argv.includes('--no-open'), prepareOnly=process.argv.includes('--prepare-only');
function run(args){const r=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw Error('הפעולה נכשלה. פרטי התקלה מופיעים מעל הודעה זו.');}
async function openBrowser(url){
  if(noOpen)return true;
  const login=url+'signin-with-chatgpt?return_to=/';
  console.log('\nפותחים את ורדיה בדפדפן הרגיל של המחשב.\nאם לא נפתח חלון, אפשר להעתיק לדפדפן את הקישור:\n'+login+'\n');
  const windowsBrowser=process.platform==='win32'?[
    path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
  ].find(file=>existsSync(file)):undefined;
  const app=windowsBrowser||(process.platform==='win32'?'powershell.exe':process.platform==='darwin'?'open':'xdg-open');
  const args=windowsBrowser?['--new-window',login]:process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',`try { Start-Process -FilePath '${login}' -ErrorAction Stop; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`]:[login];
  if(windowsBrowser)console.log('פתיחת חלון '+(windowsBrowser.includes('chrome.exe')?'Chrome':'Edge')+'…');
  return await new Promise(resolve=>{
    const browser=spawn(app,args,{stdio:windowsBrowser?'ignore':['ignore','ignore','pipe'],windowsHide:!windowsBrowser,detached:!!windowsBrowser});
    let detail='',finished=false;
    browser.stderr?.on('data',chunk=>detail+=chunk.toString());
    const finish=ok=>{if(finished)return;finished=true;clearTimeout(timer);if(windowsBrowser)browser.unref();if(!ok)console.error('פתיחת הדפדפן לא הצליחה. האתר פועל; יש להשתמש בקישור שלמעלה.\n'+detail.trim());resolve(ok)};
    const timer=setTimeout(()=>{detail+='\nתם הזמן לפתיחת הדפדפן';browser.kill();finish(false)},20000);
    if(windowsBrowser)browser.once('spawn',()=>setTimeout(()=>finish(true),1500));
    browser.once('error',error=>{detail=error.message;finish(false)});
    browser.once('close',code=>finish(code===0));
  });
}
async function ready(url){try{const r=await fetch(url+'api/workspace',{signal:AbortSignal.timeout(1500)});const body=await r.json();return r.status===401&&typeof body.error==='string'}catch{return false}}
const stateFile='.sites-runtime/local-server.json';
if(!prepareOnly&&existsSync(stateFile)){
  try{const old=JSON.parse(readFileSync(stateFile,'utf8'));if(old.root===root&&/^http:\/\/127\.0\.0\.1:51[0-9]{2}\/$/.test(old.url)){process.kill(old.pid,0);if(await ready(old.url)){console.log('ורדיה כבר פועלת: '+old.url);const opened=await openBrowser(old.url);process.exit(opened?0:1)}}}catch{}
}
mkdirSync('.sites-runtime',{recursive:true});
const packages=['vinext/dist/cli.js','wrangler/bin/wrangler.js','vite/package.json','@cloudflare/vite-plugin/package.json'];
const probeDependencies=()=>packages.every(p=>existsSync(path.join('node_modules',p)))&&spawnSync(process.execPath,['node_modules/vinext/dist/cli.js','--version'],{stdio:'ignore',windowsHide:true,timeout:15000}).status===0;
if(!probeDependencies()){
  console.log('הכנה ראשונית: מתקינים את רכיבי המערכת. התהליך עשוי להימשך מספר דקות.');
  const npmCli='.sites-runtime/npm/package/bin/npm-cli.js';
  if(!existsSync(npmCli)){
    const archive='vendor/npm-11.6.2.tgz';
    const hash=createHash('sha512').update(readFileSync(archive)).digest('hex');
    if(hash!=='ee22b335fcbc95662cdf3ab8a053daf045d9cf9c6df6040d28965abb707512b2c16fa6c5eec049d34c74f78f390cebd14f697919eadb97756564d4f9eccc4954')throw Error('קובץ ההתקנה אינו תקין');
    mkdirSync('.sites-runtime/npm',{recursive:true});
    const extracted=spawnSync('tar',['-xzf',archive,'-C','.sites-runtime/npm'],{stdio:'inherit',windowsHide:true});
    if(extracted.error)throw extracted.error;if(extracted.status!==0)throw Error('לא ניתן לחלץ את קובץ ההתקנה');
  }
  run([npmCli,'ci','--prefix',root,'--workspaces=false','--include=dev','--include=optional','--prefer-offline','--no-audit','--no-fund']);
}
if(!existsSync('.env'))copyFileSync('.env.example','.env');
const allowed=new Set(['MAKE_API_TOKEN','MAKE_ZONE','MAKE_DATA_STORE_ID','MAKE_INBOX_WEBHOOK_SECRET','INBOX_OWNER_ID','AI_API_KEY','AI_MODEL','MAKE_SYNC_ENABLED','COMPANY_MAILBOX','AI_ENABLED']);
const lines=readFileSync('.env','utf8').split(/\r?\n/).filter(line=>allowed.has(line.split('=')[0].trim()));
writeFileSync('.dev.vars',lines.join('\n')+'\n');
writeFileSync('.sites-runtime/execution-profile.json',JSON.stringify({executionProfile:'portable'}));
// Portable startup uses the installed Node runtime and the real routes/schema.
// Publishing/build commands retain Cloudflare's deployment configuration.
const {getLocalBindings}=await import('./local-node-runtime.mjs');
getLocalBindings().DB.close();
if(prepareOnly){console.log('ההכנה הושלמה בהצלחה. אפשר לפתוח את הפעלה.cmd.');process.exit(0)}
async function available(port){return new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)))})}
let port=5173;while(port<5183&&!(await available(port)))port++;
if(port===5183)throw Error('לא נמצא חיבור מקומי פנוי. יש לסגור חלונות הפעלה ישנים ולנסות שוב');
const url=`http://127.0.0.1:${port}/`;
const server=spawn(process.execPath,['scripts/start-node-server.mjs','--port',String(port)],{stdio:'inherit',windowsHide:true});
server.on('error',error=>{console.error(error.message);process.exitCode=1});
server.on('exit',code=>process.exitCode=code??0);
let online=false;
for(let i=0;i<120&&server.exitCode===null;i++){
  if(await ready(url)){online=true;break}
  await new Promise(resolve=>setTimeout(resolve,500));
}
if(online){
  writeFileSync(stateFile,JSON.stringify({pid:server.pid,root,url,runtime:'node',offline:false}));
  console.log('\nורדיה מוכנה: '+url+'\nיש להשאיר חלון זה פתוח בזמן העבודה. לסיום: Ctrl+C\n');
  await openBrowser(url);
}else console.error('האתר עדיין לא מוכן. יש לבדוק את ההודעה בחלון ההפעלה.');
