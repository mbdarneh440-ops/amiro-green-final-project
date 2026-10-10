import {env} from 'cloudflare:workers';
import {authenticatedIntake,emailIntakeReady,intakeJsonBody,EmailIntakeError} from '@/lib/email-intake';
import {updateAcknowledgement} from '@/lib/workspace-store';
import {ZodError} from 'zod';

export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:Request){
 if(!env.DB||!emailIntakeReady(env))return reply({error:'קליטת ההודעות טרם הוגדרה בשרת.'},503);
 if(!await authenticatedIntake(request,env))return reply({error:'הבקשה אינה מורשית.'},401);
 try{return reply(await updateAcknowledgement(env.DB,env.INBOX_OWNER_ID!.trim(),await intakeJsonBody(request)));}
 catch(error){return reply({error:error instanceof EmailIntakeError?error.message:'מצב הודעת הקבלה לא נשמר. אין לשלוח שוב אוטומטית.'},error instanceof EmailIntakeError?error.status:error instanceof ZodError?400:503);}
}
