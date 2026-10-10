import { days,hours,type State } from './domain';
export type Citation={start:number;end:number;url:string;title:string};
export type AssistantReply={answer:string;mode:'local'|'ai'|'web';citations:Citation[];view?:string;searchUrl?:string};
const local=(answer:string,view?:string):AssistantReply=>({answer,view,mode:'local',citations:[]});
export function localHelp(question:string,state:State):AssistantReply|null{
 const q=question.trim();
 const guard=state.guards.find(g=>q.includes(g.name)||q===g.phone||q===g.id);
 if(guard){const own=state.shifts.filter(s=>s.guardId===guard.id);return local(`${guard.name}\nטלפון: ${guard.phone||'לא הוזן'}\nשכר לשעה: ${guard.wage} ${state.settings.currency}\nמכסה שבועית: ${guard.maxHours} שעות\nזמינות ${guard.confirmed?'מאושרת':'טרם אושרה'}: ${guard.availability.map(a=>`${days[a.day]} ${a.start}–${a.end}`).join(', ')}\n${own.length} משמרות מאושרות בכל התקופות שנשמרו, בסך ${own.reduce((n,s)=>n+hours(s),0)} שעות.\nאפשר לפתוח כרטיס עובד בחיפוש שבראש המסך.`, 'guards');}
 if(/איך.*(שיבוץ|סידור|משמרת)|איך.*בונ|תכנית עבודה|תוכנית עבודה/.test(q))return local('פותחים סידור עבודה ובוחרים שבוע.\n1. בודקים שלאתרים יש שעות ומספר עובדים, ושהזמינות של העובדים אושרה.\n2. לוחצים ״יצירת הצעת שיבוץ״ ובודקים כל יום ואתר. ״דרוש עובד״ מסמן חוסר.\n3. אפשר לעבור ל״לפי עובד״ כדי לראות את השבוע של כל עובד.\n4. רק ״אישור הסידור המוצג״ שומר את ההצעה.\nהשיבוץ פועל לפי כללי זמינות, הכשרה, מנוחה ומכסת שעות; אין צורך במפתח AI כדי ליצור סידור.', 'schedule');
 if(/למה.*(חסר|שובץ|שיבוץ)|אין.*עובד|חוסרים/.test(q))return local('משמרת נשארת ללא עובד כשאין מועמד מתאים לפי הזמינות המאושרת, ההכשרה, מכסת השעות, מנוחה או חפיפה. בדקו את כרטיסי העובדים ואת דרישות האתר, עדכנו את הנתונים ואז צרו הצעה מחדש. המערכת אינה מבטיחה למצוא את הסידור המיטבי.', 'guards');
 if(/חיפוש|למצוא.*עובד|כרטיס עובד/.test(q))return local('בחיפוש שבראש המסך אפשר להקליד שם, טלפון או מזהה עובד. לחיצה על תוצאה פותחת את פרטיו, הזמינות שלו והמשמרות המאושרות לשבוע הנבחר.', 'guards');
 if(/גוגל|טופס|make|gmail|מייל|חיבור/i.test(q))return local('ב״חיבורים ושירותים״ מופיעים קישור לטופס העובדים, טבלת התשובות וקישורי Make, עם מצב כל חיבור. תשובות עובדים והודעות לקוחות חייבות בדיקת מנהל לפני שהן משפיעות על סידור העבודה. חיבור שמסומן כממתין עדיין אינו מעביר מידע אוטומטית.', 'integrations');
 if(/רווח|עלויות|שכר|כספים|מסים|מיסים/.test(q))return local('בעמוד כספים רואים הכנסה ממשמרות ששובצו, שכר עובדים, עלויות נוספות והוצאות. אפשר לעבור לתוצאות לפי שעות בפועל שאושרו. המס הוא הנחה שתזינו בהגדרות; אם לא הוגדר שיעור, אין תוצאת רווח לאחר מס. זו תחזית ולא חישוב שכר או מס סופי.', 'finance');
 if(/אישור|לאשר|בקשות/.test(q))return local('בקשות לקוח נבדקות בעמוד ״בקשות לבדיקה״. בדקו את המקור ואת השדות, השלימו פרטים חסרים ורק אז אשרו. לאחר שינוי בדרישות או בזמינות צריך ליצור הצעת שיבוץ חדשה ולאשר אותה. הצ׳אט אינו מאשר או משנה מידע.', 'inbox');
 if(/שלום|היי|עזרה|מה אתה יכול/.test(q))return local('אני עוזר להתמצא באמירו גרין, להסביר את השיבוץ ולמצוא עובד לפי שם. אפשר לשאול ״איך בונים סידור עבודה?״, ״למה חסרים עובדים?״ או לכתוב את שם העובד. תשובות מקומיות זמינות גם בלי מפתח AI.');
 return null;
}
export function externalQuestion(question:string,state:State){
 let q=question;for(const g of state.guards){for(const value of [g.name,g.phone,g.id].filter(Boolean))q=q.split(value).join('[עובד]');}
 return q.replace(/\b0\d[\d -]{7,12}\b/g,'[טלפון]');
}
export function parseResponse(payload:unknown):AssistantReply{
 const data=payload as {output?:{type?:string;content?:{type?:string;text?:string;annotations?:{type?:string;start_index?:number;end_index?:number;url?:string;title?:string}[]}[]}[]};
 let answer='';const citations:Citation[]=[];let searched=false;
 for(const item of data.output??[]){if(item.type==='web_search_call')searched=true;for(const part of item.content??[]){if(part.type!=='output_text'||typeof part.text!=='string')continue;const offset=answer.length;answer+=part.text+'\n';for(const a of part.annotations??[]){if(a.type!=='url_citation'||!a.url)continue;try{const url=new URL(a.url);if(!['https:','http:'].includes(url.protocol))continue;const start=Number(a.start_index),end=Number(a.end_index);if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>part.text.length)continue;citations.push({start:offset+start,end:offset+end,url:url.href,title:a.title||url.hostname});}catch{}}}}
 if(!answer.trim())throw Error('empty_response');
 return {answer:answer.trimEnd(),mode:searched?'web':'ai',citations:citations.sort((a,b)=>a.start-b.start)};
}
