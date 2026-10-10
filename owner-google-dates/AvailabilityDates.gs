/**
 * Owner-operated Google Apps Script. PREPARED ONLY: no trigger is installed.
 * Default mode reads metadata and previews a plan; it performs no writes.
 * Only the existing checkbox-grid row labels and E1:K1 can be written.
 * D history and the existing L2 ARRAYFORMULA are never repaired or replaced.
 * See README-ar.md before changing the three activation flags.
 */
const AVAILABILITY_DATES = {
  DRY_RUN: true,
  OWNER_CONFIRMED_COPY_TEST: false,
  ENABLE_DAILY_TRIGGER: false,
  TIME_ZONE: 'Asia/Jerusalem',
  GRID_TITLE: 'זמינות למשמרות',
  GRID_COLUMNS: ['בוקר', 'צהריים', 'לילה'],
  DAYS: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'],
  MAX_EXISTING_RESPONSE_ROWS: 20000,
  EXPECTED_WEEK_FORMULA: '=ARRAYFORMULA(IF(A2:A="","",IF(D2:D<>"","",TEXT(INT(A2:A)-WEEKDAY(INT(A2:A),1)+1,"yyyy-mm-dd"))))',
  TARGETS: [
    {name: 'A', formId: '1Cu2fwvNlyHT-mGai2234K8wQtjQNpVnfdBq4Rq6Yzyo', spreadsheetId: '1pXxBEnJYWHLi4Sd-gwuFQih6mOzZUkCBIuUvGtKI-cE', sheetId: 849812451},
    {name: 'B', formId: '1y_8R4AnPf6AqoVY1uR5PWXombOiBD4cAq1FD_KHBWto', spreadsheetId: '1BuohXEKiMm7paVwFAsIyFm-DeR7iD7nVKNH_ZNH_f7M', sheetId: 1330052281}
  ]
};

// Public entry point: read-only even when the other activation flags change.
function previewAvailabilityDates() {
  return withDatesLock_(function () {
    const datePlan = currentDatesPlan_(new Date());
    const targets = AVAILABILITY_DATES.TARGETS.map(function (target) { return inspectTarget_(target, datePlan); });
    const report = {mode: 'DRY_RUN', timeZone: AVAILABILITY_DATES.TIME_ZONE, today: datePlan.today, sunday: datePlan.sunday,
      rowLabels: datePlan.rows, targets: targets.map(targetReport_)};
    console.log(JSON.stringify(report));
    return report;
  });
}

// Explicit owner action only. Does not install a trigger or publish a form.
function applyAvailabilityDatesOnce() {
  if (AVAILABILITY_DATES.DRY_RUN) return previewAvailabilityDates();
  requireDatesWriteConfiguration_();
  return withDatesLock_(applyDates_);
}

// Only called automatically after the owner explicitly installs its trigger.
function refreshAvailabilityDatesDaily() {
  if (!AVAILABILITY_DATES.ENABLE_DAILY_TRIGGER) throw new Error('Daily trigger is disabled in configuration.');
  requireDatesWriteConfiguration_();
  return withDatesLock_(applyDates_);
}

// Installing requires a successful owner-run refresh for these exact targets.
function installDailyAvailabilityTrigger() {
  requireDatesWriteConfiguration_();
  if (!AVAILABILITY_DATES.ENABLE_DAILY_TRIGGER) throw new Error('Set ENABLE_DAILY_TRIGGER only after checking a successful one-time update.');
  return withDatesLock_(function () {
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('AVAILABILITY_DATES_FAULT')) throw new Error('Resolve the recorded fault before installing a trigger.');
    const success = JSON.parse(properties.getProperty('AVAILABILITY_DATES_LAST_SUCCESS') || 'null');
    const plan = currentDatesPlan_(new Date());
    if (!success || success.fingerprint !== configurationFingerprint_() || success.today !== plan.today) {
      throw new Error('Run applyAvailabilityDatesOnce successfully today with these target IDs first.');
    }
    // Preflight again; never install against a changed form/sheet topology.
    AVAILABILITY_DATES.TARGETS.forEach(function (target) { inspectTarget_(target, plan); });
    const existing = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'refreshAvailabilityDatesDaily'; });
    if (existing.length) throw new Error('A trigger for this handler already exists. Inspect it, or remove it with removeDailyAvailabilityTrigger before replacing it.');
    const trigger = ScriptApp.newTrigger('refreshAvailabilityDatesDaily').timeBased().atHour(0).nearMinute(30)
      .everyDays(1).inTimezone(AVAILABILITY_DATES.TIME_ZONE).create();
    const report = {triggerId: trigger.getUniqueId(), timeZone: AVAILABILITY_DATES.TIME_ZONE, approximateWindow: '00:15–00:45', active: true};
    console.log(JSON.stringify(report));
    return report;
  });
}

// Removes only this script's named daily handler for the current owner.
function removeDailyAvailabilityTrigger() {
  return withDatesLock_(function () {
    const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'refreshAvailabilityDatesDaily'; });
    triggers.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    const report = {removed: triggers.length, handler: 'refreshAvailabilityDatesDaily'};
    console.log(JSON.stringify(report));
    return report;
  });
}

// A fault never clears automatically. Owner must repair/verify topology first.
function clearAvailabilityDatesFaultAfterOwnerReview() {
  requireDatesWriteConfiguration_();
  return withDatesLock_(function () {
    const plan = currentDatesPlan_(new Date());
    AVAILABILITY_DATES.TARGETS.forEach(function (target) { inspectTarget_(target, plan); });
    PropertiesService.getScriptProperties().deleteProperty('AVAILABILITY_DATES_FAULT');
    console.log('Fault cleared after owner preflight. No form/sheet cells changed.');
  });
}

function applyDates_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('AVAILABILITY_DATES_FAULT')) throw new Error('Previous update requires owner review. Run previewAvailabilityDates; no automatic repair will occur.');
  try {
    const plan = currentDatesPlan_(new Date());
    // Both targets must pass every preflight before the first mutation.
    const targets = AVAILABILITY_DATES.TARGETS.map(function (target) { return inspectTarget_(target, plan); });
    targets.forEach(function (target) {
      // Re-read just before writing; ScriptLock cannot lock human/native Forms edits.
      const fresh = inspectTarget_(target.config, plan);
      if (fresh.gridId !== target.gridId || !same_(fresh.rows, target.rows) || !same_(fresh.headers, target.headers)
          || fresh.lastRow !== target.lastRow || fresh.historyDigest !== target.historyDigest) {
        throw new Error(target.config.name + ': target changed during preflight. No write to this target.');
      }
      if (!same_(target.rows, plan.rows)) target.grid.setRows(plan.rows);
      SpreadsheetApp.flush();
      // Native Forms may update its destination asynchronously. Accept only the
      // same seven old/new headers in exactly E:K, never newly appended columns.
      Utilities.sleep(1000);
      verifyAfterGridRename_(target, plan);
      const current = target.sheet.getRange('E1:K1').getValues()[0];
      if (!same_(current, plan.headers)) target.sheet.getRange('E1:K1').setValues([plan.headers]);
      SpreadsheetApp.flush();
      Utilities.sleep(1000);
      verifyAfterGridRename_(target, plan);
      if (!same_(target.grid.getRows(), plan.rows) || !same_(target.sheet.getRange('E1:K1').getValues()[0], plan.headers)) {
        throw new Error(target.config.name + ': final label/header verification failed.');
      }
    });
    targets.forEach(function (target) { verifyAfterGridRename_(target, plan); });
    const success = {today: plan.today, sunday: plan.sunday, timeZone: AVAILABILITY_DATES.TIME_ZONE, fingerprint: configurationFingerprint_(), checkedAt: new Date().toISOString()};
    properties.setProperty('AVAILABILITY_DATES_LAST_SUCCESS', JSON.stringify(success));
    console.log(JSON.stringify({mode: 'APPLIED', result: success, targets: targets.map(targetReport_)}));
    return success;
  } catch (error) {
    // Stop future runs, preserve all data, and avoid speculative rollback.
    properties.setProperty('AVAILABILITY_DATES_FAULT', JSON.stringify({at: new Date().toISOString(), message: String(error.message || error)}));
    throw error;
  }
}

function inspectTarget_(target, plan) {
  if (!target.formId || !target.spreadsheetId || !Number.isInteger(target.sheetId)) throw new Error('Missing target IDs.');
  const form = FormApp.openById(target.formId);
  if (form.getDestinationType() !== FormApp.DestinationType.SPREADSHEET || form.getDestinationId() !== target.spreadsheetId) {
    throw new Error(target.name + ': form is not linked to the configured response spreadsheet.');
  }
  const items = form.getItems();
  // Removed week question remains historical column D; it must not reappear as an item.
  if (items.length !== 3 || items[0].getType() !== FormApp.ItemType.TEXT || items[0].getTitle() !== 'שם מלא'
      || items[1].getType() !== FormApp.ItemType.TEXT || items[1].getTitle() !== 'מספר טלפון'
      || items[2].getType() !== FormApp.ItemType.CHECKBOX_GRID || items[2].getTitle() !== AVAILABILITY_DATES.GRID_TITLE) {
    throw new Error(target.name + ': expected exactly name, phone, and one checkbox grid; unexpected topology.');
  }
  const grid = items[2].asCheckboxGridItem();
  if (!same_(grid.getColumns(), AVAILABILITY_DATES.GRID_COLUMNS)) throw new Error(target.name + ': shift columns/order differ.');
  const rows = grid.getRows();
  parseDatedRows_(rows);
  const spreadsheet = SpreadsheetApp.openById(target.spreadsheetId);
  if (spreadsheet.getSpreadsheetTimeZone() !== AVAILABILITY_DATES.TIME_ZONE) throw new Error(target.name + ': spreadsheet timezone differs; inspect historical timestamps before any timezone change.');
  const sheets = spreadsheet.getSheets().filter(function (sheet) { return sheet.getSheetId() === target.sheetId; });
  if (sheets.length !== 1) throw new Error(target.name + ': configured response tab gid not found uniquely.');
  const sheet = sheets[0], headers = sheet.getRange('A1:L1').getValues()[0];
  verifyFixedSheet_(sheet, headers, target.name);
  const expectedOldHeaders = rows.map(function (row) { return AVAILABILITY_DATES.GRID_TITLE + ' [' + row + ']'; });
  if (!same_(headers.slice(4, 11), expectedOldHeaders)) throw new Error(target.name + ': E:K does not match the existing checkbox rows; appended/renamed columns require owner review.');
  const lastRow = sheet.getLastRow();
  if (lastRow > AVAILABILITY_DATES.MAX_EXISTING_RESPONSE_ROWS + 1) throw new Error(target.name + ': history exceeds the bounded verification limit.');
  return {config: target, form: form, grid: grid, gridId: grid.getId(), sheet: sheet, rows: rows, headers: headers, lastRow: lastRow,
    historyDigest: historyDigest_(sheet, lastRow), timestampRowCount: lastRow < 2 ? 0 : sheet.getRange(2, 1, lastRow - 1, 1).getValues().filter(function (row) { return row[0] !== '' && row[0] !== null; }).length,
    wouldChange: !same_(rows, plan.rows)};
}

function verifyFixedSheet_(sheet, headers, name) {
  if (sheet.getLastColumn() !== 12 || headers.length !== 12 || !['חותמת זמן', 'Timestamp'].includes(headers[0])
      || headers[1] !== 'שם מלא' || headers[2] !== 'מספר טלפון' || headers[3] !== 'תאריך תחילת השבוע (יום ראשון)' || headers[11] !== 'שבוע אוטומטי') {
    throw new Error(name + ': expected fixed A:D history, E:K weekdays, L automatic week, with no extra used columns.');
  }
  if (sheet.getRange('L2').getFormula() !== AVAILABILITY_DATES.EXPECTED_WEEK_FORMULA) throw new Error(name + ': L2 formula differs or is absent. The script will not repair it.');
}

function verifyAfterGridRename_(target, plan) {
  const headers = target.sheet.getRange('A1:L1').getValues()[0];
  verifyFixedSheet_(target.sheet, headers, target.config.name);
  if (!same_(headers.slice(0, 4), target.headers.slice(0, 4)) || headers[11] !== target.headers[11]) throw new Error(target.config.name + ': protected history headers changed.');
  const days = headers.slice(4, 11);
  if (!same_(days, target.headers.slice(4, 11)) && !same_(days, plan.headers)) throw new Error(target.config.name + ': native Forms produced unexpected/mixed day columns.');
  if (target.sheet.getLastRow() < target.lastRow || historyDigest_(target.sheet, target.lastRow) !== target.historyDigest) throw new Error(target.config.name + ': an existing response cell changed. No automatic restoration will be attempted.');
  if (target.form.getDestinationId() !== target.config.spreadsheetId || target.grid.getId() !== target.gridId
      || !same_(target.grid.getColumns(), AVAILABILITY_DATES.GRID_COLUMNS) || !same_(target.grid.getRows(), plan.rows)) throw new Error(target.config.name + ': form changed during update.');
}

function currentDatesPlan_(now) {
  const today = Utilities.formatDate(now, AVAILABILITY_DATES.TIME_ZONE, 'yyyy-MM-dd');
  const day = new Date(today + 'T12:00:00Z');
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  const sunday = day.toISOString().slice(0, 10);
  const rows = AVAILABILITY_DATES.DAYS.map(function (name, offset) {
    const date = new Date(day.getTime()); date.setUTCDate(date.getUTCDate() + offset);
    return name + ' · ' + two_(date.getUTCDate()) + '/' + two_(date.getUTCMonth() + 1) + '/' + date.getUTCFullYear();
  });
  return {today: today, sunday: sunday, rows: rows, headers: rows.map(function (row) { return AVAILABILITY_DATES.GRID_TITLE + ' [' + row + ']'; })};
}

function parseDatedRows_(rows) {
  if (rows.length !== 7) throw new Error('Checkbox grid must have exactly seven rows.');
  let first;
  rows.forEach(function (row, index) {
    const prefix = AVAILABILITY_DATES.DAYS[index] + ' · ';
    if (row.indexOf(prefix) !== 0) throw new Error('Weekday label/order differs.');
    const text = row.slice(prefix.length), match = /^(\d{2})\/(\d{2})\/(20\d{2})$/.exec(text);
    if (!match) throw new Error('Dates must be DD/MM/YYYY.');
    const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12));
    if (date.getUTCFullYear() !== Number(match[3]) || date.getUTCMonth() + 1 !== Number(match[2]) || date.getUTCDate() !== Number(match[1]) || date.getUTCDay() !== index) throw new Error('Invalid date or weekday/date mismatch.');
    if (!first) first = date.getTime();
    if (date.getTime() !== first + index * 86400000) throw new Error('Dates must be one consecutive Sunday–Saturday week.');
  });
}

function historyDigest_(sheet, lastRow) {
  if (lastRow < 2) return digest_('no-response-rows');
  const range = sheet.getRange(2, 1, lastRow - 1, 12);
  // Read-only checks include all existing A:L values and formulas, including D/L.
  // New submissions appended below lastRow are allowed; existing cells are not.
  return digest_(JSON.stringify({values: range.getValues(), formulas: range.getFormulas()}));
}
function targetReport_(target) { return {name: target.config.name, formId: target.config.formId, spreadsheetId: target.config.spreadsheetId, sheetId: target.config.sheetId, gridId: target.gridId, existingRows: target.rows, protectedRowCount: Math.max(0, target.lastRow - 1), timestampRowCount: target.timestampRowCount, wouldChange: target.wouldChange}; }
function configurationFingerprint_() { return digest_(JSON.stringify({targets: AVAILABILITY_DATES.TARGETS, timeZone: AVAILABILITY_DATES.TIME_ZONE, title: AVAILABILITY_DATES.GRID_TITLE, columns: AVAILABILITY_DATES.GRID_COLUMNS})); }
function digest_(text) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join(''); }
function same_(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function two_(number) { return ('0' + number).slice(-2); }
function requireDatesWriteConfiguration_() { if (AVAILABILITY_DATES.DRY_RUN || !AVAILABILITY_DATES.OWNER_CONFIRMED_COPY_TEST) throw new Error('Dry-run is the default. Owner must verify a copied native Forms→Sheets rename test before enabling writes.'); }
function withDatesLock_(run) { const lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) throw new Error('Another availability refresh is in progress.'); try { return run(); } finally { lock.releaseLock(); } }
