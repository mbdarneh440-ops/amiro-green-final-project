import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Public library entry point. JSON and CSV remain usable without this optional runtime.
async function artifactLibrary() {
  try { return await import('@oai/artifact-tool'); }
  catch (original) {
    const packages = process.env.ARTIFACT_NODE_MODULES || '';
    const userPackages = process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules');
    for (const folder of [packages, userPackages].filter(Boolean)) {
      try {
        const require = createRequire(path.join(folder, 'package.json'));
        return await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
      } catch { /* Try the next documented dependency location. */ }
    }
    throw new Error('مكتبة Excel غير متاحة؛ استخدم requests.csv أو جهّز ARTIFACT_NODE_MODULES.', {cause: original});
  }
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!['--input', '--output', '--qa'].includes(key) || !process.argv[i + 1]) throw new Error('خيار المصدّر غير صالح.');
  args[key] = process.argv[++i];
}
if (!args['--input'] || !args['--output']) throw new Error('يلزم --input و --output.');
const ledger = JSON.parse(await fs.readFile(args['--input'], 'utf8'));
if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.records) || !['demo', 'live'].includes(ledger.mode)) throw new Error('سجل الطلبات غير صالح.');
const output = path.resolve(args['--output']);
const {Workbook, SpreadsheetFile} = await artifactLibrary();
const workbook = Workbook.create();
const headings = ['الاسم', 'رقم التلفون', 'المطلوب', 'الإيميل', 'تاريخ الوصول', 'الجهة', 'مكان المناسبة', 'بداية المناسبة', 'نهاية المناسبة', 'من الساعة', 'إلى الساعة', 'عدد الحراس', 'نوع الطلب', 'قرار من المصدر', 'حالة مسجلة محليًا', 'رد الاستلام', 'ملاحظات المراجعة', 'ملاحظات محلية', 'مصدر الاسم', 'معرّف الإيميل', 'عنوان الإيميل', 'النص الأصلي'];
const widths = [25, 21, 60, 36, 25, 28, 28, 21, 21, 16, 16, 16, 22, 30, 30, 34, 65, 40, 28, 36, 50, 80];
const col = index => String.fromCharCode(65 + index);
function literal(value) {
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 32767);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}
function eventDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
function receiptDate(value) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(date).map(p => [p.type, p.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}
function row(record) {
  return [literal(record.displayName), literal(record.phone), literal(record.requestSummary), literal(record.sender), receiptDate(record.receivedAt), literal(record.organization), literal(record.site), eventDate(record.startDate), eventDate(record.endDate), literal(record.startTime), literal(record.endTime), /^\d+$/.test(record.guardCount || '') ? Number(record.guardCount) : null, literal(record.requestType), literal(record.sourceManagerStatus), literal(record.managerStatus), literal(record.ackState), literal(record.reviewNotes), literal(record.manualNotes), literal(record.nameSource), literal(record.sourceId), literal(record.subject), literal(record.body)];
}

const plans = [{name: 'الطلبات', rows: ledger.mode === 'live' ? ledger.records : [], table: 'EmailRequestsTable', color: '#176B5B', demo: false}];
if (ledger.mode === 'demo') plans.push({name: 'مثال تجريبي', rows: ledger.records, table: 'DemoEmailRequestsTable', color: '#A16207', demo: true});
for (const plan of plans) {
  const sheet = workbook.worksheets.add(plan.name);
  sheet.showGridLines = false;
  sheet.tabColor = plan.color;
  const bottom = Math.max(7, plan.rows.length + 6);
  const area = sheet.getRange(`A1:V${bottom}`);
  area.format.font = {name: 'Arial', size: 12, color: '#20332F'};
  area.format.horizontalAlignment = 'right';
  area.format.verticalAlignment = 'center';
  area.format.wrapText = true;
  area.format.rowHeight = 30;
  widths.forEach((width, i) => { sheet.getRange(`${col(i)}:${col(i)}`).format.columnWidth = width; });
  sheet.getRange('A2:E2').merge();
  sheet.getRange('A2').values = [[plan.demo ? 'طلبات تجريبية للعرض' : 'سجل طلبات الإيميل | أميرو غرين']];
  sheet.getRange('A2:E2').format.font = {name: 'Arial', size: 19, bold: true, color: plan.color};
  sheet.getRange('A2:E2').format.rowHeight = 38;
  sheet.getRange('A3:E3').merge();
  sheet.getRange('A3').values = [[plan.demo ? `بيانات صناعية فقط • ${plan.rows.length} أمثلة • لا يوجد إرسال بريد` : `عدد الطلبات المحفوظة: ${plan.rows.length} • ${ledger.mode === 'demo' ? 'التشغيل الحقيقي مؤجّل' : 'نسخة محلية من آخر تحديث'}`]];
  sheet.getRange('A4:E4').merge();
  sheet.getRange('A4').values = [[plan.demo ? 'المصدر: demo-records.json → requests.json؛ الخانات الناقصة فارغة.' : 'المصدر: requests.json؛ وصول البريد بتوقيت القدس. حالة المسؤول تظهر عند وصولها أو تسجيلها محليًا.']];
  sheet.getRange('A4:E4').format.font = {name: 'Arial', size: 11, color: '#5D716B'};
  sheet.getRange('A5:E5').merge();
  sheet.getRange('A5').values = [[`آخر تحديث للسجل: ${ledger.updatedAt ? new Date(ledger.updatedAt).toLocaleString('en-GB', {timeZone: 'Asia/Jerusalem'}) : 'غير متاح'} • ابحث أو فرز من أسهم العناوين`]];
  sheet.getRange('A5:E5').format.font = {name: 'Arial', size: 11, color: '#5D716B'};
  sheet.getRange('A6:V6').values = [headings];
  const body = sheet.getRange(`A7:V${bottom}`);
  body.values = plan.rows.length ? plan.rows.map(row) : [Array(headings.length).fill(null)];
  body.format.rowHeight = plan.demo ? 90 : 60;
  const table = sheet.tables.add(`A6:V${bottom}`, true, plan.table);
  table.showFilterButton = true;
  sheet.getRange('A6:V6').format.fill = plan.color;
  sheet.getRange('A6:V6').format.font = {name: 'Arial', size: 12, color: '#FFFFFF', bold: true};
  sheet.getRange('A6:V6').format.horizontalAlignment = 'center';
  sheet.getRange('A6:V6').format.rowHeight = 40;
  for (let i = 7; i <= bottom; i++) sheet.getRange(`A${i}:V${i}`).format.fill = i % 2 ? '#F1F7F4' : '#FFFFFF';
  sheet.getRange(`B7:B${bottom}`).setNumberFormat('@');
  sheet.getRange(`T7:T${bottom}`).setNumberFormat('@');
  sheet.getRange(`E7:E${bottom}`).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange(`H7:I${bottom}`).setNumberFormat('dd/mm/yyyy');
  sheet.getRange(`L7:L${bottom}`).setNumberFormat('0');
  sheet.getRange(`B7:B${bottom}`).format.horizontalAlignment = 'left';
  sheet.getRange(`D7:D${bottom}`).format.horizontalAlignment = 'left';
  sheet.getRange(`E7:E${bottom}`).format.horizontalAlignment = 'center';
  sheet.getRange(`H7:M${bottom}`).format.horizontalAlignment = 'center';
  sheet.getRange(`Q7:Q${bottom}`).conditionalFormats.add('notContainsBlanks', {format: {fill: '#FFF2CC', font: {color: '#7A4B00'}}});
  sheet.freezePanes.freezeRows(6);
  sheet.freezePanes.freezeColumns(2);
}
workbook.recalculate();
if (args['--qa']) {
  const qa = path.resolve(args['--qa']);
  await fs.mkdir(qa, {recursive: true});
  const summaries = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    summaries.push(await workbook.inspect({kind: 'table', range: `${plan.name}!A1:E${Math.max(7, plan.rows.length + 6)}`, include: 'values,formulas', tableMaxRows: 10, tableMaxCols: 5, maxChars: 3500}));
    summaries.push({sheet: plan.name, values: workbook.worksheets.getItem(plan.name).getRange('A6:E' + Math.min(10, Math.max(7, plan.rows.length + 6))).values});
    for (const [suffix, range] of [['contacts', `A1:E${Math.max(7, plan.rows.length + 6)}`], ['details', `F6:M${Math.max(7, plan.rows.length + 6)}`], ['review', `N6:S${Math.max(7, plan.rows.length + 6)}`]]) {
      const preview = await workbook.render({sheetName: plan.name, range, scale: 1.3, format: 'png'});
      await fs.writeFile(path.join(qa, `sheet-${i + 1}-${suffix}.png`), new Uint8Array(await preview.arrayBuffer()));
    }
  }
  summaries.push(await workbook.inspect({kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#N/A|#NAME\\?|#NUM!|#SPILL!', options: {useRegex: true, maxResults: 20}, maxChars: 3000}));
  await fs.writeFile(path.join(qa, 'verification.json'), JSON.stringify(summaries, null, 2));
}
await fs.mkdir(path.dirname(output), {recursive: true});
const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${Date.now()}.tmp.xlsx`);
try {
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(temporary);
  await fs.rename(temporary, output);
} finally {
  await fs.unlink(temporary).catch(() => {});
  await fs.unlink(temporary + '.inspect.ndjson').catch(() => {});
}
console.log(`Excel: ${ledger.mode === 'demo' ? 0 : ledger.records.length} طلب حقيقي، ${ledger.mode === 'demo' ? ledger.records.length : 0} مثال تجريبي.`);
