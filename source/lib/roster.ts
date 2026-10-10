import { dateAdd, stamp, type Shift, type ShiftPeriod, type ShiftTemplate } from './domain';
export { shiftPeriod } from './domain';

export const periodNames:Record<ShiftPeriod,string>={morning:'בוקר',afternoon:'צהריים',night:'לילה',extra:'תגבור'};
export const securityNames={unarmed:'לא חמוש',armed:'חמוש'};
export const formatRosterDate=(date:string)=>date.split('-').reverse().join('/');

// Hours, days and head counts from the supplied university sheet. Names and
// assignments are deliberately not imported into employee records.
export function universityTemplates():ShiftTemplate[]{
  const rules:Omit<ShiftTemplate,'id'>[]=[];
  const add=(securityType:ShiftTemplate['securityType'],period:ShiftPeriod,start:string,end:string,groups:[number[],number][])=>{
    for(const [days,count] of groups)rules.push({securityType,period,start,end,days,count});
  };
  add('unarmed','morning','06:30','15:00',[[[0],8],[[1,2,3],12],[[4],10],[[5],2],[[6],1]]);
  add('unarmed','morning','06:30','13:00',[[[0],3]]);
  add('unarmed','morning','08:00','17:00',[[[4],4]]);
  add('unarmed','afternoon','13:00','23:00',[[[0],3]]);
  add('unarmed','afternoon','14:30','23:00',[[[1,2,3,4],3],[[5,6],2]]);
  add('unarmed','night','22:30','07:00',[[[0,1,2,3,6],3],[[4,5],2]]);
  add('armed','morning','06:30','15:00',[[[0],1],[[1,3,4],3],[[2],2]]);
  add('armed','afternoon','14:30','23:00',[[[0,1,2,3,4],2],[[6],1]]);
  add('armed','night','22:30','07:00',[[[0,1,2,3,4,6],1]]);
  add('armed','extra','20:00','08:00',[[[0,1,2,3,6],1]]);
  return rules.map((r,i)=>({...r,id:'university-'+i}));
}

export type RosterCell={kind:'time';text:string;overnight:boolean}|{kind:'shift';shift:Shift};
export function rosterColumns(shifts:Shift[],week:string):RosterCell[][]{
  return Array.from({length:7},(_,day)=>{
    const groups=new Map<string,Shift[]>();
    for(const shift of shifts.filter(s=>s.date===dateAdd(week,day)).sort((a,b)=>a.start-b.start||b.end-a.end||a.id.localeCompare(b.id))){
      const key=`${shift.start}:${shift.end}`;
      groups.set(key,[...(groups.get(key)??[]),shift]);
    }
    return [...groups.values()].flatMap((list):RosterCell[]=>[
      {kind:'time',text:`${stamp(list[0].start)}–${stamp(list[0].end)}`,overnight:new Date(list[0].end).toISOString().slice(0,10)!==list[0].date},
      ...list.map(shift=>({kind:'shift' as const,shift})),
    ]);
  });
}
