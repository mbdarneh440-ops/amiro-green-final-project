import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const target='.sites-runtime/tests';
mkdirSync(target,{recursive:true});
writeFileSync(target+'/package.json',JSON.stringify({type:'commonjs'}));
for(const file of ['lib/roster.ts','tests/roster.test.ts','lib/domain.ts','lib/actions.ts','lib/csv-import.ts','lib/availability-import.ts','lib/availability-receipts.ts','lib/integration-config.ts','lib/assistant.ts','lib/make.ts','lib/make-availability.ts','lib/email-intake.ts','lib/workspace-store.ts','lib/workspace-refresh.ts','app/api/email-intake/route.ts','app/api/email-intake/acknowledgement/route.ts','tests/domain.test.ts','tests/assistant.test.ts','tests/availability-import.test.ts','tests/make-availability.test.ts','tests/email-intake.test.ts','tests/availability-selection.test.ts','tests/availability-connections.test.ts']){
  const output=path.join(target,file.replace(/\.ts$/,'.js'));
  mkdirSync(path.dirname(output),{recursive:true});
  writeFileSync(output,ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
}
for(const name of ['roster','domain','assistant','availability-import','make-availability','email-intake','availability-selection','availability-connections']){const result=spawnSync(process.execPath,[target+'/tests/'+name+'.test.js'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
