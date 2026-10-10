import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {syncEnabled} from '@/lib/integration-config';
import {MakeAvailabilityError,readMakeAvailability} from '@/lib/make-availability';

export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

// Fetching creates only a preview. Approval and workspace changes use the normal action endpoint.
export async function POST(request:Request){
 if(!await getChatGPTUser())return reply({error:'יש להתחבר תחילה'},401);
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'הבקשה אינה מורשית'},403);
 if(!syncEnabled(env))return reply({error:'הסנכרון מושבת עד להשלמת הגדרות בעל החברה.'},400);
 try{return reply(await readMakeAvailability(env));}
 catch(error){return reply({error:error instanceof MakeAvailabilityError?error.message:'לא ניתן לטעון את תשובות הזמינות כרגע. הנתונים שלך לא שונו.'},502);}
}
