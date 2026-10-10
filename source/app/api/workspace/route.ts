import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import {type State} from '@/lib/domain';
import { act, envelope, DomainError } from '@/lib/actions';
import { ZodError } from 'zod';
import { makeReady, readMakeInbox } from '@/lib/make';
import {emailIntakeReady,EmailIntakeError} from '@/lib/email-intake';
import {loadWorkspace,saveWorkspace} from '@/lib/workspace-store';
import {readMakeAvailability,MakeAvailabilityError} from '@/lib/make-availability';
import {integrationStatus,syncEnabled} from '@/lib/integration-config';
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function load(owner:string){
  if(!env.DB)throw new Error('Database unavailable');
  const row=await loadWorkspace(env.DB,owner);return {version:row.version,data:JSON.stringify(row.state)};
}
export async function GET(){
  const user=await getChatGPTUser();if(!user)return reply({error:'יש להתחבר כדי לפתוח את סביבת העבודה'},401);
  try{const row=await load(user.userId);return reply({version:row.version,state:JSON.parse(row.data),integrations:{...integrationStatus(env),emailIntake:emailIntakeReady(env)},user:{name:user.displayName??'מנהל התפעול'}})}catch{return reply({error:'לא ניתן לטעון את הנתונים. יש לנסות שוב.'},503)}
}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return reply({error:'יש להתחבר תחילה'},401);
  if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'הבקשה אינה מורשית'},403);
  try{
    const body=await request.text();if(body.length>60000)return reply({error:'הבקשה חורגת מהגודל המותר'},413);
    const input=envelope.parse(JSON.parse(body));const row=await load(user.userId);
    if(row.version!==input.version)return reply({error:'הנתונים השתנו. יש לרענן את העמוד ולבדוק שוב את השינוי.'},409);
    let next=JSON.parse(row.data) as State,notice='';
    if(input.action==='syncIntegrations'){
      if(!syncEnabled(env))throw new DomainError('הסנכרון האוטומטי מושבת. יש להשלים את הגדרות בעל החברה ולהפעיל אותו במפורש.');
      const [mailBatch,availabilityBatch]=await Promise.all([readMakeInbox(env),readMakeAvailability(env)]);
      const before=JSON.stringify(next);
      for(const mail of mailBatch.emails){const sourceId='make:'+mail.sourceId;if(!next.proposals.some(p=>p.sourceId===sourceId))next=act(next,'importEmail',{...mail,sourceId},user.displayName??'קליטה מ־Make');}
      next=act(next,'queueAvailability',availabilityBatch.batches,user.displayName??'קליטה מ־Make');
      if(JSON.stringify(next)===before)return reply({version:row.version,state:next,notice:''});
      notice='נקלטו נתונים חדשים לבדיקה בלבד.';
    }else if(input.action==='syncMake'){
      if(!syncEnabled(env))throw new DomainError('הסנכרון מושבת עד להשלמת הגדרות בעל החברה.');
      const batch=await readMakeInbox(env);let imported=0;
      for(const mail of batch.emails){const sourceId='make:'+mail.sourceId;if(next.proposals.some(p=>p.sourceId===sourceId))continue;next=act(next,'importEmail',{...mail,sourceId},user.displayName);imported++}
      notice=`יובאו ${imported} הודעות חדשות לבדיקה. ${batch.skipped} רשומות לא תקינות לא יובאו.`;
    }else next=act(next,input.action,input.payload,user.displayName??user.email??'המנהל');
    const data=JSON.stringify(next);if(data.length>1500000)return reply({error:'סביבת ההדגמה הגיעה למגבלת האחסון. יש להרחיב את מסד הנתונים לפני הוספת נתונים נוספים.'},413);
    if(!await saveWorkspace(env.DB!,user.userId,{version:row.version,state:next},next))return reply({error:'הנתונים נערכו במקביל. יש לרענן את העמוד לפני האישור.'},409);
    return reply({version:row.version+1,state:next,notice});
  }catch(error){
    if(error instanceof DomainError)return reply({error:error.message},400);
    if(error instanceof EmailIntakeError)return reply({error:error.message},error.status);
    if(error instanceof MakeAvailabilityError)return reply({error:error.message},502);
    if(error instanceof ZodError)return reply({error:'יש לבדוק את שדות החובה, השעות והמספרים. יש להשתמש בתאריכים תקינים ובשעות בפורמט 00:00.'},400);
    return reply({error:'לא ניתן לשמור את השינוי. השינוי לא אושר.'},500);
  }
}

