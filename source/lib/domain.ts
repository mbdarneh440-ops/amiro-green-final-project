import type {IntakeMetadata} from './email-intake';
export type Window = { day: number; start: string; end: string };
export type AvailabilitySelections = { periods: ('morning'|'afternoon'|'night')[]; securityType: SecurityType };
export type AvailabilityException = { date: string; available: boolean; start: string; end: string; mode?: 'startDay'; selections?: AvailabilitySelections };
export type Guard = { id: string; name: string; phone: string; wage: number; maxHours: number; skills: string[]; confirmed: boolean; availability: Window[]; exceptions: AvailabilityException[] };
export type SecurityType = 'unarmed'|'armed';
export type ShiftPeriod = 'morning'|'afternoon'|'night'|'extra';
export type ShiftTemplate = { id: string; period: ShiftPeriod; securityType: SecurityType; start: string; end: string; count: number; days: number[] };
export type Site = { id: string; name: string; organization: string; phone: string; contact?:string; address?:string; kind: 'fixed'|'event'; start: string; end: string; count: number; days: number[]; date: string; rate: number; skill: string; revision: number; shiftTemplates?: ShiftTemplate[] };
export type Proposal = { id: string; sourceId: string; subject: string; sender: string; requesterName?:string; contactName?:string; requestSummary?:string; body: string; kind: 'new'|'change'|'cancel'; siteId: string; organization: string; siteName?:string; phone: string; date: string; endDate?:string; start: string; end: string; count: number; rate: number; siteRevision: number; status: 'pending'|'approved'|'rejected'; received: string; intake?:IntakeMetadata };
export type Shift = { id: string; siteId: string; date: string; start: number; end: number; guardId: string|null; rate: number; wage: number; actualHours: number|null; actualApproved: boolean; reason: string; templateId?: string; securityType?: SecurityType; period?: ShiftPeriod };
export type AvailabilityReceipt = {id:string;sourceId:string;fingerprint:string;csv:string;name:string;phone:string;week:string;securityType?:SecurityType;receivedAt:string;status:'pending'|'approved'|'rejected';processedAt?:string};
export type State = { calendarVersion?: 2; availabilityReceipts?:AvailabilityReceipt[]; dirtyWeeks: string[]; sites: Site[]; guards: Guard[]; proposals: Proposal[]; overrides: { siteId: string; date: string; start: string; end: string; count: number; rate: number }[]; shifts: Shift[]; settings: { restHours: number; travelMinutes: number; onCost: number; overhead: number; tax: number|null; currency: string }; audit: { at: string; actor: string; action: string }[] };
export const days = ['יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','שבת'];
export const dayMs = 86400000;
export const dateAdd = (date: string, n: number) => new Date(Date.parse(date+'T00:00:00Z')+n*dayMs).toISOString().slice(0,10);
export const minutes = (s: string) => Number(s.split(':')[0])*60+Number(s.split(':')[1]);
// Fixed-offset demonstration clock; DST and legal payroll rules are not inferred.
export const instant = (date: string, time: string) => Date.parse(date+'T00:00:00Z')+minutes(time)*60000;
export const interval = (date: string, start: string, end: string): [number,number] => {
  const a=instant(date,start); let b=instant(date,end); if(b<=a)b+=dayMs; return [a,b];
};
export const hours = (s: Pick<Shift,'start'|'end'>) => (s.end-s.start)/3600000;
export const stamp = (n: number) => new Date(n).toISOString().slice(11,16);
export const shiftPeriod = (shift:Pick<Shift,'start'|'period'>):ShiftPeriod => shift.period??(Number(stamp(shift.start).slice(0,2))<6?'night':Number(stamp(shift.start).slice(0,2))<12?'morning':Number(stamp(shift.start).slice(0,2))<20?'afternoon':'night');
export function availabilityText(e:Pick<AvailabilityException,'available'|'start'|'end'|'mode'|'selections'>,showGroup=true):string {
  if(!e.available)return e.mode==='startDay'?'לא נבחרו משמרות ליום זה':'לא זמין כל היום';
  if(e.selections){const names={morning:'בוקר',afternoon:'צהריים',night:'לילה'};return e.selections.periods.map(p=>names[p]).join(' · ')+(showGroup?' ('+(e.selections.securityType==='armed'?'חמוש':'לא חמוש')+')':'');}
  return e.start+'–'+e.end+(e.end<e.start?' למחרת':'');
}
export function weekOf(date: string) { return dateAdd(date,-new Date(date+'T00:00:00Z').getUTCDay()); }
export function normalizeCalendar(state:State):State {
  if(state.calendarVersion===2)return state;
  // A legacy Monday–Sunday range touches two Sunday-based weeks. Keep all
  // saved assignments and actual hours; require review of their new weeks.
  return {...state,calendarVersion:2,dirtyWeeks:[...new Set([
    ...state.dirtyWeeks.flatMap(w=>[weekOf(w),weekOf(dateAdd(w,6))]),
    ...state.shifts.map(s=>weekOf(s.date)),
  ])]};
}
export function seed(): State {
  const names=['אחמד','מוחמד','עומר','יוסף','חאלד','עלי','ראמי','סאמי','נור','כרים','חסן','מאהר','נביל','פאדי','וסים','אמיר','טארק','יאסר'];
  const state: State={calendarVersion:2,dirtyWeeks:[],sites:[
    {id:'mall',name:'הקניון',organization:'הנהלת הקניון — הדגמה',phone:'',kind:'fixed',start:'06:00',end:'01:00',count:2,days:[0,1,2,3,4,5,6],date:'',rate:90,skill:'כללי',revision:1},
    {id:'university',name:'האוניברסיטה',organization:'הנהלת האוניברסיטה — הדגמה',phone:'',kind:'fixed',start:'00:00',end:'24:00',count:2,days:[0,1,2,3,4,5,6],date:'',rate:95,skill:'כללי',revision:1}
  ],guards:names.map((name,i)=>({id:'g'+i,name:name+' (הדגמה)',phone:'',wage:48+i%5*2,maxHours:48,skills:i%3===0?['כללי','אירועים']:['כללי'],confirmed:i!==17,availability:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),exceptions:[]})),proposals:[],overrides:[],shifts:[],settings:{restHours:8,travelMinutes:30,onCost:12,overhead:450,tax:null,currency:'₪'},audit:[]};
  state.proposals.push({id:'demo-request',sourceId:'demo-event-001',subject:'אבטחת אירוע ביום חמישי',sender:'events@example.test',body:'הודעה לדוגמה\nארגון: מרכז המפגש\nתאריך: 2026-09-24\nהתחלה: 18:00\nסיום: 23:00\nכמות: 4\nאתר: אולם המפגש\nדרושים 4 מאבטחים לקבלת האורחים. ההודעה אינה כוללת מספר טלפון או תעריף.',kind:'new',siteId:'',organization:'מרכז המפגש',phone:'',date:'2026-09-24',start:'18:00',end:'23:00',count:4,rate:0,siteRevision:0,status:'pending',received:'2026-09-20T10:00:00Z'});
  return state;
}
function covers(windows: [number,number][], a: number,b: number) {
  let cursor=a; for(const [x,y] of windows.sort((p,q)=>p[0]-q[0])){if(x>cursor)break;if(y>cursor)cursor=y;if(cursor>=b)return true;}return false;
}
function isAvailable(g: Guard,s: Shift) {
  if(!g.confirmed)return false;
  let windows: [number,number][]=[];
  for(let d=-1;d<=1;d++){
    const date=dateAdd(s.date,d);
    if(g.exceptions.some(e=>e.date===date&&e.mode==='startDay'))continue;
    for(const w of g.availability.filter(w=>w.day===new Date(date+'T00:00:00Z').getUTCDay()))windows.push(interval(date,w.start,w.end));
  }
  const clearDate=(date:string)=>{
    const a=instant(date,'00:00'),b=a+dayMs;
    windows=windows.flatMap(([x,y]):[number,number][]=>y<=a||x>=b?[[x,y]]:[...(x<a?[[x,a] as [number,number]]:[]),...(y>b?[[b,y] as [number,number]]:[])]);
  };
  const addException=(e:AvailabilityException)=>{
    if(!e.available)return;
    if(e.selections){
      const period=shiftPeriod(s),selectionPeriod=period==='extra'?'night':period;
      // Choices apply to actual shifts starting on the reported date. They do
      // not grant full-day availability or change an employee's qualifications.
      if(e.date===s.date&&e.selections.securityType===(s.securityType??'unarmed')&&e.selections.periods.includes(selectionPeriod))windows.push([s.start,s.end]);
      return;
    }
    const w=interval(e.date,e.start,e.end);if(w[0]<s.end&&w[1]>s.start)windows.push(w);
  };
  // A weekly reply replaces recurring availability on every submitted date.
  // Its overnight windows belong to their start date and survive the next
  // weekly day's blank field. Explicit calendar exceptions still take priority.
  for(const e of g.exceptions)clearDate(e.date);
  for(const e of g.exceptions.filter(e=>e.mode==='startDay'))addException(e);
  for(const e of g.exceptions.filter(e=>e.mode!=='startDay').sort((a,b)=>a.date.localeCompare(b.date))){clearDate(e.date);addException(e);}
  return covers(windows,s.start,s.end);
}
function countedWeek(s: Shift,week: string) {const a=instant(week,'00:00');return Math.max(0,Math.min(s.end,a+7*dayMs)-Math.max(s.start,a))/3600000;}
export function eligible(state: State,g: Guard,s: Shift,assigned: Shift[]): string|null {
  const site=state.sites.find(x=>x.id===s.siteId)!;
  if(!g.skills.includes(site.skill))return 'ההכשרה הנדרשת חסרה';
  if(s.securityType==='armed'&&!g.skills.includes('נשק'))return 'לא אושרה התאמה לאבטחה עם נשק';
  if(!isAvailable(g,s))return 'הזמינות לא אושרה או אינה מכסה את כל המשמרת';
  const own=assigned.filter(x=>x.guardId===g.id);
  for(const x of own){
    if(s.start<x.end&&s.end>x.start)return 'חפיפה עם משמרת אחרת';
    const gap=s.start>=x.end?(s.start-x.end):(x.start-s.end);
    if(gap<(state.settings.restHours*60+(s.siteId!==x.siteId?state.settings.travelMinutes:0))*60000)return 'אין מספיק זמן למנוחה ולנסיעה';
  }
  for(const w of new Set([weekOf(new Date(s.start).toISOString().slice(0,10)),weekOf(new Date(s.end-1).toISOString().slice(0,10))])){
    if(own.reduce((sum,x)=>sum+countedWeek(x,w),0)+countedWeek(s,w)>g.maxHours+0.0001)return 'חריגה ממכסת השעות השבועית';
  }
  return null;
}
export function plan(state: State,week: string): Shift[] {
  const requirements:Shift[]=[];
  const frozenDays=new Set(state.shifts.filter(x=>x.actualHours!==null).map(x=>`${x.siteId}:${x.date}`));
  const preserved=state.shifts.filter(x=>x.date>=week&&x.date<dateAdd(week,7)&&frozenDays.has(`${x.siteId}:${x.date}`));
  for(let i=0;i<7;i++)for(const site of state.sites){
    const date=dateAdd(week,i),day=new Date(date+'T00:00:00Z').getUTCDay();
    if(frozenDays.has(`${site.id}:${date}`))continue;
    const override=state.overrides.find(x=>x.siteId===site.id&&x.date===date);
    if(!override&&((site.kind==='fixed'&&!site.days.includes(day))||(site.kind==='event'&&site.date!==date)))continue;
    if(!override&&site.shiftTemplates?.length){
      for(const template of site.shiftTemplates.filter(t=>t.days.includes(day))){
        const [start,end]=interval(date,template.start,template.end);
        for(let slot=0;slot<template.count;slot++)requirements.push({id:`${site.id}:${date}:${template.id}:${slot}`,siteId:site.id,date,start,end,guardId:null,rate:site.rate,wage:0,actualHours:null,actualApproved:false,reason:'',templateId:template.id,securityType:template.securityType,period:template.period});
      }
      continue;
    }
    const rule=override??site; const [a,b]=interval(date,rule.start,rule.end);
    for(let start=a;start<b;start+=8*3600000)for(let slot=0;slot<rule.count;slot++)requirements.push({id:`${site.id}:${date}:${start}:${slot}`,siteId:site.id,date,start,end:Math.min(b,start+8*3600000),guardId:null,rate:rule.rate,wage:0,actualHours:null,actualApproved:false,reason:''});
  }
  const existing=[...state.shifts.filter(x=>x.date<week||x.date>=dateAdd(week,7)),...preserved];
  const assigned=[...existing];
  requirements.sort((a,b)=>state.guards.filter(g=>eligible(state,g,a,existing)===null).length-state.guards.filter(g=>eligible(state,g,b,existing)===null).length||a.start-b.start||a.id.localeCompare(b.id));
  for(const s of requirements){
    const pool=state.guards.filter(g=>eligible(state,g,s,assigned)===null);
    pool.sort((a,b)=>assigned.filter(x=>x.guardId===a.id&&x.date>=week&&x.date<dateAdd(week,7)).reduce((sum,x)=>sum+hours(x),0)-assigned.filter(x=>x.guardId===b.id&&x.date>=week&&x.date<dateAdd(week,7)).reduce((sum,x)=>sum+hours(x),0)||a.wage-b.wage||a.id.localeCompare(b.id));
    if(pool[0]){s.guardId=pool[0].id;s.wage=pool[0].wage;assigned.push(s)}else s.reason='לא נמצא מאבטח שעומד בדרישות הזמינות, המנוחה, ההכשרה ומכסת השעות השבועית';
  }
  return [...preserved,...requirements].sort((a,b)=>a.start-b.start||a.siteId.localeCompare(b.siteId));
}
export function finance(state:State,shifts:Shift[],actual=false){
  const covered=shifts.filter(s=>s.guardId&&(!actual||s.actualApproved));
  const h=(s:Shift)=>actual?s.actualHours??0:hours(s);
  const revenue=covered.reduce((n,s)=>n+h(s)*s.rate,0), wages=covered.reduce((n,s)=>n+h(s)*s.wage,0);
  const onCost=wages*state.settings.onCost/100, beforeTax=revenue-wages-onCost-state.settings.overhead;
  return {revenue,wages,onCost,overhead:state.settings.overhead,beforeTax,tax:state.settings.tax===null?null:Math.max(0,beforeTax)*state.settings.tax/100,afterTax:state.settings.tax===null?null:beforeTax-Math.max(0,beforeTax)*state.settings.tax/100,hours:covered.reduce((n,s)=>n+h(s),0)};
}
export function extract(body:string){
  const field=(label:string)=>body.match(new RegExp('(?:^|\\n)'+label+'\\s*[:：]\\s*([^\\n]+)'))?.[1]?.trim()??'';
  return {organization:field('ארגון'),phone:field('טלפון'),date:field('תאריך'),start:field('התחלה'),end:field('סיום'),count:Number(field('כמות'))||0,rate:Number(field('תעריף'))||0};
}
