'use client';
import { Fragment } from 'react';
import { days, dateAdd, type State, type Guard, type Shift, type ShiftPeriod } from '@/lib/domain';
import { formatRosterDate, periodNames, rosterColumns, shiftPeriod, type RosterCell } from '@/lib/roster';

type Props={state:State;week:string;shifts:Shift[];siteId:string;draft:boolean;dirty:boolean;onGuard:(g:Guard)=>void};
export default function WeeklyRoster({state,week,shifts,siteId,draft,dirty,onGuard}:Props){
  const sites=state.sites.filter(s=>siteId==='all'||s.id===siteId);
  function block(list:Shift[],label:string,minRows:number,key:string){
    const columns=rosterColumns(list,week),rowCount=Math.max(minRows,...columns.map(c=>c.length));
    return renderColumns(columns,rowCount,label,key,new Set([0]));
  }
  function armedBlock(list:Shift[],label:string){
    const columns:Array<Array<RosterCell|undefined>>=Array.from({length:7},()=>[]),headers=new Set<number>();
    let rowCount=0;
    for(const period of ['morning','afternoon','night','extra'] as ShiftPeriod[]){
      const part=rosterColumns(list.filter(s=>shiftPeriod(s)===period),week),count=Math.max(period==='extra'?2:4,...part.map(c=>c.length));
      headers.add(rowCount);rowCount+=count;
      part.forEach((column,day)=>columns[day].push(...Array.from({length:count},(_,row)=>column[row])));
    }
    return renderColumns(columns,rowCount,label,'armed',headers);
  }
  function renderColumns(columns:Array<Array<RosterCell|undefined>>,rowCount:number,label:string,key:string,headers:Set<number>){
    return <tbody className="roster-block" key={key} data-section={key}>{Array.from({length:rowCount},(_,row)=><tr key={row}>
      {row===0&&<th scope="rowgroup" rowSpan={rowCount} className="roster-side">{label}</th>}
      {columns.map((col,day)=>{const cell=col[row];
        if(cell?.kind==='time')return <td key={day} className="roster-time" title={cell.overnight?'סיום ביום הבא':undefined}><bdi>{cell.text}</bdi></td>;
        if(cell?.kind==='shift'){
          const guard=state.guards.find(g=>g.id===cell.shift.guardId);
          return <td key={day} className={guard?'roster-person':'roster-gap'}>{guard?<button onClick={()=>onGuard(guard)} title={`פרטי עובד: ${guard.name}`}>{guard.name}</button>:<span title={cell.shift.reason||'טרם שובץ עובד'}>דרוש עובד</span>}</td>;
        }
        return <td key={day} className={headers.has(row)?'roster-time':'roster-blank'}>{headers.has(row)?<span aria-label="אין משמרת ביום זה">—</span>:'\u00a0'}</td>;
      })}
    </tr>)}</tbody>;
  }
  return <div className="roster-sheets">{sites.map(site=>{
    const own=shifts.filter(s=>s.siteId===site.id),unarmed=own.filter(s=>s.securityType==='unarmed'),armed=own.filter(s=>s.securityType==='armed'),unknown=own.filter(s=>!s.securityType);
    const periods:ShiftPeriod[]=['morning','afternoon','night'];
    return <article className="roster-sheet" key={site.id} aria-label={`סידור שבועי ${site.name}`}>
      <div className="roster-sheet-meta"><span>אמירו גרין</span><span>{draft?'טיוטה — לא אושרה':dirty?'נדרשת בדיקה מחדש':'סידור מאושר'}</span></div>
      <div className="roster-scroll" tabIndex={0} role="region" aria-label={`טבלת משמרות ${site.name} — ניתן לגלול אופקית`}>
        <table className="roster-grid" dir="rtl">
          <caption>סידור עבודה · {site.name}</caption>
          <colgroup><col className="roster-label-col"/>{days.map(d=><col key={d}/>)}</colgroup>
          <thead><tr><th className="roster-gutter" rowSpan={2}>משמרת</th>{days.map(d=><th scope="col" key={d}>{d}</th>)}</tr><tr>{days.map((d,i)=><th key={d}><time dateTime={dateAdd(week,i)}>{formatRosterDate(dateAdd(week,i))}</time></th>)}</tr></thead>
          <tbody className="roster-spacer"><tr><td colSpan={8}/></tr></tbody>
          {periods.map(period=><Fragment key={period}>{block(unarmed.filter(s=>shiftPeriod(s)===period),periodNames[period],period==='morning'?17:4,'unarmed-'+period)}<tbody className="roster-spacer"><tr><td colSpan={8}/></tr></tbody></Fragment>)}
          {unarmed.some(s=>shiftPeriod(s)==='extra')&&block(unarmed.filter(s=>shiftPeriod(s)==='extra'),'תגבור',3,'unarmed-extra')}
          <tbody><tr className="roster-section roster-armed-title"><th colSpan={8}>חמוש</th></tr></tbody>
          {armedBlock(armed,site.name)}
          {!!unknown.length&&<><tbody><tr className="roster-section roster-unknown"><th colSpan={8}>סידור קודם · סוג האבטחה טרם הוגדר</th></tr></tbody>{block(unknown,'קיים',3,'unspecified')}</>}
        </table>
      </div>
      <footer className="roster-footnote"><span>שעת סיום מוקדמת משעת ההתחלה = סיום למחרת.</span><span>{formatRosterDate(week)} – {formatRosterDate(dateAdd(week,6))}</span></footer>
    </article>;
  })}{!sites.length&&<div className="empty">יש להוסיף אתר כדי להציג סידור שבועי.</div>}</div>;
}
