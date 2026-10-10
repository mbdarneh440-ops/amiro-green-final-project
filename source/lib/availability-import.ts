import {parseCsv} from './csv-import';
import {dateAdd, availabilityText, type AvailabilitySelections, type Guard, type State, type SecurityType} from './domain';

export type AvailabilityImport={guardId:string;name:string;date:string;available:boolean;start:string;end:string;previous:string;mode?:'startDay';selections?:AvailabilitySelections};
export const availabilityDays=['יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','יום שבת'];
export const availabilityGridHeaders=availabilityDays.map(day=>'זמינות למשמרות ['+day+']');
export const automaticWeekHeader='שבוע אוטומטי';
const weekHeader='תאריך תחילת השבוע (יום ראשון)';
const legacyHeaders=['תאריך הזמינות','משעה (00:00–23:59)','עד שעה (00:00–23:59)'];
const phone=(s:string)=>s.replace(/\D/g,'').replace(/^972/,'0');
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;

function dateValue(value:string){
 let result=value.trim();if(/^\d{1,2}\/\d{1,2}\/20\d{2}$/.test(result)){const [month,day,year]=result.split('/');result=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;}
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(result)||Number.isNaN(Date.parse(result+'T00:00:00Z'))||new Date(result+'T00:00:00Z').toISOString().slice(0,10)!==result)throw Error('תאריך לא תקין. יש להשתמש ב־YYYY-MM-DD או בתאריך המקורי של טבלת Google (חודש/יום/שנה).');
 return result;
}
type DatedGrid={week:string;headers:string[]};
function datedGrids(headers:string[]):DatedGrid[]{
 const groups=new Map<string,DatedGrid>();
 for(const header of headers){
  if(!header.startsWith('זמינות למשמרות [')||!header.includes('·'))continue;
  const match=/^זמינות למשמרות \[(יום ראשון|יום שני|יום שלישי|יום רביעי|יום חמישי|יום שישי|יום שבת)\s*·\s*(\d{2})\/(\d{2})\/(20\d{2})\]$/.exec(header);
  if(!match)throw Error('כותרת יום ותאריך אינה תקינה: '+header+'. יש להשתמש ביום ובתאריך DD/MM/YYYY.');
  const offset=availabilityDays.indexOf(match[1]);let date:string;
  try{date=dateValue(match[4]+'-'+match[3]+'-'+match[2]);}catch{throw Error('תאריך לא תקין בכותרת: '+header);}
  if(new Date(date+'T00:00:00Z').getUTCDay()!==offset)throw Error('היום והתאריך אינם תואמים בכותרת: '+header);
  const week=dateAdd(date,-offset),group=groups.get(week)??{week,headers:Array<string>(7).fill('')};
  if(group.headers[offset])throw Error('יותר מעמודה אחת לאותו יום בשבוע: '+header);
  group.headers[offset]=header;groups.set(week,group);
 }
 return [...groups.values()];
}
function completeGrid(group:DatedGrid){return group.headers.every(Boolean);}
function automaticWeek(value:string,line:number){
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))throw Error('שורה '+line+': שבוע אוטומטי חייב להיות תאריך ISO בפורמט YYYY-MM-DD.');
 const week=dateValue(value);
 if(new Date(week+'T00:00:00Z').getUTCDay()!==0)throw Error('שורה '+line+': השבוע האוטומטי חייב להתחיל ביום ראשון.');
 return week;
}
function validateTimes(start:string,end:string,line:number,day=''){
 if(!timePattern.test(start)||!timePattern.test(end)||start===end)throw Error('שורה '+line+(day?' · '+day:'')+': שעות לא תקינות או זהות. יש להזין טווח כמו 08:00–16:00, בשעות 00:00–23:59.');
}
function record(guard:Guard,date:string,available:boolean,start:string,end:string,mode?:'startDay',selections?:AvailabilitySelections):AvailabilityImport{
 const previous=guard.exceptions.find(e=>e.date===date);
 return {guardId:guard.id,name:guard.name,date,available,start,end,...(mode?{mode}:{}),...(selections?{selections}:{}),previous:previous?(previous.selections?availabilityText(previous):previous.available?previous.start+'–'+previous.end:previous.mode==='startDay'?'לא הוזנו שעות ליום זה':'לא זמין'):'לפי הזמינות השבועית'};
}

export function previewAvailability(csv:string,state:State,securityType?:SecurityType):AvailabilityImport[]{
 const rows=parseCsv(csv);if(rows.length>100)throw Error('אפשר לייבא עד 100 תשובות בכל פעם.');
 const has=(header:string)=>header in rows[0];
 for(const header of ['שם מלא','מספר טלפון'])if(!has(header))throw Error('חסרה עמודה בקובץ תשובות הזמינות: '+header);
 const weekly=has(weekHeader),automatic=has(automaticWeekHeader),legacy=legacyHeaders.every(has),grid=availabilityGridHeaders.every(has),hours=availabilityDays.every(has),dated=datedGrids(Object.keys(rows[0]));
 if((weekly||automatic)&&!grid&&!hours&&!dated.length){const headers=availabilityGridHeaders.some(has)?availabilityGridHeaders:availabilityDays;throw Error('חסרה עמודה בקובץ תשובות הזמינות: '+headers.find(header=>!has(header)));}
 else if(!weekly&&!automatic&&!legacy)throw Error('חסרה עמודה בקובץ תשובות הזמינות: '+(dated.length?automaticWeekHeader:legacyHeaders.find(h=>!has(h))??weekHeader));
 const seen=new Set<string>(),seenWeeks=new Set<string>();
 return rows.flatMap((row,index)=>{
  const line=index+2,name=row['שם מלא']?.trim(),rawPhone=row['מספר טלפון']?.trim()??'',number=phone(rawPhone);
  if(rawPhone&&(!number||!/^[+\d\s().-]+$/.test(rawPhone)))throw Error('שורה '+line+': מספר הטלפון אינו תקין.');
  const matches=number?state.guards.filter(g=>phone(g.phone)===number):state.guards.filter(g=>g.name.trim()===name);
  if(!name||matches.length!==1||matches[0].name.trim()!==name)throw Error('שורה '+line+': לא נמצאה התאמה חד־משמעית לשם ולמספר הטלפון. יש לעדכן קודם את כרטיס העובד.');
  const guard=matches[0];let changes:AvailabilityImport[];
  // Google Sheets keeps old question columns after a form change.
  // Identify each response format separately to retain dated history.
  if(!grid&&availabilityGridHeaders.some(header=>!!row[header]?.trim()))throw Error('שורה '+line+': חסרות עמודות של בחירת משמרות. יש להוריד את הגיליון המלא.');
  if(!hours&&availabilityDays.some(day=>!!row[day]?.trim()))throw Error('שורה '+line+': חסרות עמודות שעות מהטופס הקודם. יש להוריד את הגיליון המלא.');
  const hasGridValues=grid&&availabilityGridHeaders.some(header=>!!row[header]?.trim()),hasHourValues=hours&&availabilityDays.some(day=>!!row[day]?.trim());
  const populatedDated=dated.filter(group=>group.headers.some(header=>header&&!!row[header]?.trim()));
  if(populatedDated.some(group=>!completeGrid(group)))throw Error('שורה '+line+': חסרות עמודות יום ותאריך של בחירת משמרות. יש להוריד את הגיליון המלא.');
  if(populatedDated.length>1)throw Error('שורה '+line+': התשובה מכילה בחירות ביותר משבוע מתוארך אחד. יש להשאיר סוג תשובה אחד בלבד.');
  if(Number(hasGridValues)+Number(hasHourValues)+Number(!!populatedDated.length)>1)throw Error('שורה '+line+': התשובה מכילה גם בחירת משמרות וגם שעות מהטופס הישן או עמודות מתוארכות נוספות. יש להשאיר סוג תשובה אחד בלבד.');
  const rawManualWeek=row[weekHeader]?.trim()??'',rawAutomaticWeek=row[automaticWeekHeader]?.trim()??'';
  const usesWeek=!!rawManualWeek||!!rawAutomaticWeek;
  if(usesWeek){
   if(row['תאריך הזמינות']?.trim())throw Error('שורה '+line+': התשובה מכילה גם שבוע וגם תאריך מהטופס הישן. יש להשאיר סוג תשובה אחד בלבד.');
   // The submission's frozen week is authoritative even after Forms renames
   // the dated grid headings. Never rebase historical rows to today's week.
   const week=rawAutomaticWeek?automaticWeek(rawAutomaticWeek,line):dateValue(rawManualWeek);
   if(rawAutomaticWeek&&rawManualWeek&&dateValue(rawManualWeek)!==week)throw Error('שורה '+line+': השבוע האוטומטי ותאריך השבוע הישן אינם תואמים.');
   if(new Date(week+'T00:00:00Z').getUTCDay()!==0)throw Error('שורה '+line+': תאריך תחילת השבוע חייב להיות יום ראשון.');
   let selectedDated:DatedGrid|undefined=populatedDated[0];
   if(!hasGridValues&&!hasHourValues&&!selectedDated){
    const candidates=dated.filter(completeGrid);
    // Blank retained columns are not response evidence. Select a blank dated
    // grid only from an explicit frozen week or an unambiguous single schema.
    if(rawAutomaticWeek||(!grid&&!hours)){
     selectedDated=candidates.find(group=>group.week===week);
     if(!selectedDated&&candidates.length===1)selectedDated=candidates[0];
     if(!selectedDated&&candidates.length>1)throw Error('שורה '+line+': לא ניתן לזהות את עמודות השבוע לתשובה ריקה.');
     if(!selectedDated&&!grid&&!hours)throw Error('שורה '+line+': חסרות עמודות יום ותאריך של בחירת משמרות. יש להוריד את הגיליון המלא.');
    }
   }
   const selectedHeaders=selectedDated?.headers??(hasHourValues||(!grid&&hours)?availabilityDays:availabilityGridHeaders);
   const usesGrid=!!selectedDated||selectedHeaders===availabilityGridHeaders;
   if(usesGrid&&!grid&&!selectedDated)throw Error('שורה '+line+': חסרות עמודות של בחירת משמרות. יש להוריד את הגיליון המלא.');
   if(usesGrid&&!securityType)throw Error('יש לבחור את קבוצת הטופס: א · לא חמוש או ב · חמוש. הבחירה מיועדת למנהל בלבד.');
   const weekKey=guard.id+':'+week;if(seenWeeks.has(weekKey))throw Error('שורה '+line+': יותר מתשובה אחת לאותו עובד ושבוע. יש להשאיר בקובץ את התשובה המעודכנת בלבד.');seenWeeks.add(weekKey);
   changes=availabilityDays.map((day,offset)=>{
    const value=(row[selectedHeaders[offset]]??'').trim(),date=dateValue(dateAdd(week,offset));
    if(usesGrid){
      const labels=value?value.split(',').map(v=>v.trim()):[];
      const names:Record<string,AvailabilitySelections['periods'][number]>={'בוקר':'morning','צהריים':'afternoon','לילה':'night'};
      if(labels.some(label=>!Object.hasOwn(names,label))||new Set(labels).size!==labels.length)throw Error('שורה '+line+' · '+day+': יש לבחור בוקר, צהריים או לילה בלבד, בלי כפילויות.');
      const periods=labels.map(label=>names[label]);
      return record(guard,date,periods.length>0,'00:00','24:00','startDay',{periods,securityType:securityType!});
    }
    if(!value)return record(guard,date,false,'00:00','24:00','startDay');
    const range=value.split(/\s*[-–—]\s*/);
    const start=range[0]?.trim()??'',end=range[1]?.trim()??'';
    if(range.length!==2)throw Error('שורה '+line+' · '+day+': יש להזין טווח שעות אחד, למשל 08:00–16:00, או להשאיר ריק כשלא זמינים.');
    validateTimes(start,end,line,day);return record(guard,date,true,start,end,'startDay');
   });
  }else{
   if(hasGridValues||hasHourValues||populatedDated.length||!legacy)throw Error('שורה '+line+': חסר תאריך שבוע לתשובה. יש לשמור את השבוע האוטומטי המקורי או את תאריך השבוע מהטופס הקודם.');
   const date=dateValue(row['תאריך הזמינות']??''),start=(row[legacyHeaders[1]]??'').trim(),end=(row[legacyHeaders[2]]??'').trim();
   validateTimes(start,end,line);changes=[record(guard,date,true,start,end)];
  }
  for(const change of changes){const key=guard.id+':'+change.date;if(seen.has(key))throw Error('שורה '+line+': יותר מתשובה אחת לאותו עובד ותאריך. יש להשאיר בקובץ את התשובה המעודכנת בלבד.');seen.add(key);}
  return changes;
 });
}
