import {env} from 'cloudflare:workers';
import {authenticatedIntake,emailIntakeReady,intakeRequestBody,EmailIntakeError} from '@/lib/email-intake';
import {recordIntake} from '@/lib/workspace-store';

export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(!env.DB||!emailIntakeReady(env))return reply({error:'קליטת ההודעות טרם הוגדרה בשרת.'},503);
 if(!await authenticatedIntake(request,env))return reply({error:'הבקשה אינה מורשית.'},401);
 try{
  const payload=await intakeRequestBody(request),receipt=await recordIntake(env.DB,env.INBOX_OWNER_ID!.trim(),payload);
  return reply(receipt);
 }catch(error){return reply({error:error instanceof EmailIntakeError?error.message:'ההודעה לא נשמרה. יש לנסות שוב עם אותו מזהה מקור.'},error instanceof EmailIntakeError?error.status:503);}
}
