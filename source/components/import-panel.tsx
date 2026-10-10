'use client';
import { useState } from 'react';
import { Upload, FileSpreadsheet, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table,TableHeader,TableHead,TableBody,TableRow,TableCell } from '@/components/ui/table';
import { DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Choice,Field } from './wardiya-forms';
import { previewImport,type ImportKind } from '@/lib/csv-import';
import type { State } from '@/lib/domain';
export default function ImportPanel({state,save,busy}:{state:State;save:(a:string,p:unknown)=>Promise<boolean>;busy:boolean}){
 const [kind,setKind]=useState<ImportKind>('workers'),[csv,setCsv]=useState(''),[filename,setFilename]=useState(''),[error,setError]=useState('');
 let preview:ReturnType<typeof previewImport>|null=null,problem=error;
 if(csv)try{preview=previewImport(kind,csv,state)}catch(e){problem=e instanceof Error?e.message:'הקובץ אינו תקין'}
 return <div className="dialog-form"><DialogTitle>ייבוא נתונים מקובץ</DialogTitle><DialogDescription>בחרו אחד משלושת קובצי ה־CSV. אפשר לערוך אותו ב־Excel ולשמור כ־CSV UTF-8.</DialogDescription><Field label="סוג הקובץ"><Choice value={kind} onChange={v=>{setKind(v as ImportKind);setCsv('');setFilename('');setError('')}} options={[["workers","עובדים וזמינות"],["sites","אתרים קבועים"],["events","אירועים"]]}/></Field>
 <div className="actions">{[['workers','01_עובדים.csv','עובדים'],['sites','02_אתרים_קבועים.csv','אתרים קבועים'],['events','03_אירועים.csv','אירועים']].map(([key,name,title])=><Button key={key} variant="outline" size="sm" asChild><a href={'/templates/'+name} download><Download size={15}/>{title}</a></Button>)}</div>
 <Field label="בחירת קובץ"><Input key={kind} type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>150000){setError('הקובץ גדול מדי. יש לחלק לקבצים קטנים יותר.');setCsv('');return}const content=await file.text();if(content.length>50000){setError('הקובץ ארוך מדי. יש לחלק לקבצים קטנים יותר.');setCsv('');return}setFilename(file.name);setError('');setCsv(content)}}/></Field>
 {problem&&<div className="banner error">{problem}</div>}{preview&&<><div className="banner"><FileSpreadsheet size={20}/><span>{filename}: {preview.rows} שורות · {preview.added} רשומות חדשות · {preview.updated} עדכונים</span></div><p className="small muted">קוד שכבר קיים יעדכן את הרשומה. שאר העובדים והאתרים לא יימחקו. בייבוא עובדים מוחלפת הזמינות השבועית של העובדים שבקובץ.</p><div className="table-wrap"><Table><TableHeader><TableRow><TableHead>קוד</TableHead><TableHead>שם</TableHead><TableHead>תעריף לשעה</TableHead></TableRow></TableHeader><TableBody>{preview.records.slice(0,20).map(r=><TableRow key={r.id}><TableCell>{r.id.split(':')[1]}</TableCell><TableCell>{r.name}</TableCell><TableCell>{'wage'in r?r.wage:r.rate}</TableCell></TableRow>)}</TableBody></Table>{preview.records.length>20&&<p className="small muted">מוצגות 20 הרשומות הראשונות; האישור חל על כל {preview.records.length} הרשומות.</p>}</div><div className="form-footer"><Button disabled={busy} onClick={()=>void save('importCsv',{kind,csv})}><Upload size={17}/>אישור ייבוא {preview.records.length} רשומות</Button></div></>}
 </div>
}
