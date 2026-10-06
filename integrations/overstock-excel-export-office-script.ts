// New Daily Rec workbook -> Houston Overstock location sync helper.
// Add this script in Excel for the web: Automate > New Script, then add a button.
// Replace IMPORT_KEY below with the private value configured in Netlify.

interface HoustonLocationRow {
  po: string;
  deliveryId: string;
  associate: string;
  category: string;
  operationalDate: string;
  quantity: number;
  location: string;
  containerCode: string;
  disposition: string;
  note: string;
}

interface HoustonSyncResult {
  error?: string;
  received?: number;
  updatedEntries?: number;
  updatedContainers?: number;
  createdEntries?: number;
  createdContainers?: number;
  retiredEmptyExcelBoxes?: number;
  unchanged?: number;
  skipped?: string[];
  unresolved?: string[];
  importedAssociates?: number;
}

interface HoustonApiResponse extends HoustonSyncResult {
  import?: HoustonSyncResult;
}

interface PoHistorySyncResult {
  error?: string;
  current?: number;
  archive?: number;
  archivePa?: number;
  putAway?: number;
  cases?: number;
  watch?: number;
  hidden?: number;
  total?: number;
}

interface WorkbookHistoryPayload {
  currentRows: Record<string, string>[];
  archiveRows: Record<string, string>[];
  archivePaRows: Record<string, string>[];
  putAwayRows: Record<string, string>[];
  caseRows: Record<string, string>[];
  watchRows: Record<string, string>[];
}

// Headers such as "PO #\n(Orden)" wrap onto two lines in some sheets.
function oneLine(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function worksheetRows(workbook: ExcelScript.Workbook, sheetName: string): Record<string, string>[] {
  const sheet: ExcelScript.Worksheet | undefined = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const used: ExcelScript.Range | undefined = sheet.getUsedRange(true);
  if (!used) return [];
  const texts: string[][] = used.getTexts();
  const headerIndex: number = texts.findIndex((row: string[]): boolean =>
    row.some((cell: string): boolean => oneLine(cell) === 'PO # (Orden)')
  );
  if (headerIndex < 0) return [];
  const headers: string[] = texts[headerIndex].map((cell: string): string => oneLine(cell));
  return texts.slice(headerIndex + 1).map((row: string[]): Record<string, string> => {
    const record: Record<string, string> = {};
    headers.forEach((header: string, column: number): void => {
      if (header) record[header] = String(row[column] ?? '').trim();
    });
    return record;
  }).filter((record: Record<string, string>): boolean =>
    Boolean(record['PO # (Orden)'] || record['Delivery ID (auto)'] || record['Delivery ID'])
  );
}

async function main(workbook: ExcelScript.Workbook): Promise<string> {
  const HOUSTON_ENDPOINT = 'https://inboundswagup.netlify.app/api/overstock-control';
  const PO_HISTORY_ENDPOINT = 'https://inboundswagup.netlify.app/api/po-history';
  const IMPORT_KEY = 'PASTE_YOUR_NEW_NETLIFY_KEY_HERE';

  if (IMPORT_KEY === 'PASTE_YOUR_NEW_NETLIFY_KEY_HERE') {
    throw new Error('Paste your new Netlify import key into IMPORT_KEY before running this script.');
  }

  const table = workbook.getTable('DailyLog');
  if (!table) throw new Error('Excel table DailyLog was not found.');

  const headers = table.getHeaderRowRange().getTexts()[0].map(value => String(value ?? '').trim());
  const body = table.getRangeBetweenHeaderAndTotal();
  const textRows = body.getTexts();
  const indexOf = (name: string) => headers.indexOf(name);
  const associateColumns: number[] = headers
    .map((name: string, index: number): number => /\bBy\b|\(Por\)/i.test(name) ? index : -1)
    .filter((index: number): boolean => index >= 0);
  const associates: string[] = [];
  textRows.forEach((row: string[]): void => {
    associateColumns.forEach((column: number): void => {
      const name: string = String(row[column] ?? '').trim();
      if (name && !associates.some((existing: string): boolean => existing.toLowerCase() === name.toLowerCase())) associates.push(name);
    });
  });
  associates.sort((a: string, b: string): number => a.localeCompare(b));

  const poCol = indexOf('PO # (Orden)');
  const deliveryCol = indexOf('Delivery ID (auto)');
  const prepAssociateCol = indexOf('Prep By (Por)');
  const categoryCol = 7; // Workbook column H.
  const operationalDateCol = 19; // Workbook column T: Prep Date (Prep).
  const quantityCol = indexOf('Overstock Qty');
  const locationCol = indexOf('Overstock Loc (Ubicacion)');
  const containerCol = indexOf('Overstock Cont. (Contenedor)');
  const dispositionCol = indexOf('Disposition (Donado/Ret/Req)');
  const noteCol = indexOf('Overstock Note (Motivo)');
  if (poCol < 0 || deliveryCol < 0 || prepAssociateCol < 0 || quantityCol < 0 || locationCol < 0 || containerCol < 0) {
    throw new Error('DailyLog is missing a required PO, Delivery ID, Prep By, quantity, location, or container column.');
  }

  const rows: HoustonLocationRow[] = textRows
    .map((row: string[]): HoustonLocationRow => ({
      po: String(row[poCol] ?? '').trim(),
      deliveryId: String(row[deliveryCol] ?? '').trim(),
      associate: String(row[prepAssociateCol] ?? '').trim(),
      category: String(row[categoryCol] ?? '').trim(),
      operationalDate: String(row[operationalDateCol] ?? '').trim(),
      quantity: Math.max(0, Math.round(Number(String(row[quantityCol] ?? 0).replace(/,/g, '')) || 0)),
      location: String(row[locationCol] ?? '').trim(),
      containerCode: String(row[containerCol] ?? '').trim(),
      disposition: dispositionCol >= 0 ? String(row[dispositionCol] ?? '').trim() : '',
      note: noteCol >= 0 ? String(row[noteCol] ?? '').trim() : '',
    }))
    .filter((row: HoustonLocationRow): boolean => Boolean(row.associate) && Boolean(row.location) && Boolean(row.deliveryId || row.po));

  let result: HoustonSyncResult = {};
  if (rows.length) {
    const response: Response = await fetch(HOUSTON_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-overstock-import-key': IMPORT_KEY },
      body: JSON.stringify({ action: 'syncFromExcel', rows, associates }),
    });
    const responseText: string = await response.text();
    try {
      const parsed: HoustonApiResponse = responseText ? JSON.parse(responseText) as HoustonApiResponse : {};
      result = parsed.import ?? parsed;
    } catch {
      if (!response.ok) throw new Error(`Houston returned HTTP ${response.status}: ${responseText}`);
    }
    if (!response.ok) throw new Error(result.error || `Houston returned HTTP ${response.status}.`);
  }

  // PO History copy: every sheet that mentions POs. One syncId for the whole
  // run; once every sheet has arrived, PO History hides rows that are no
  // longer in the workbook (e.g. Daily Log rows after the month is archived).
  const syncId: string = `sync-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const historyResult: PoHistorySyncResult = { current: 0, archive: 0, archivePa: 0, putAway: 0, cases: 0, watch: 0 };
  type HistoryCount = 'current' | 'archive' | 'archivePa' | 'putAway' | 'cases' | 'watch';
  const sheets: { name: string; field: keyof WorkbookHistoryPayload; count: HistoryCount }[] = [
    { name: 'Daily Log', field: 'currentRows', count: 'current' },
    { name: 'Archive', field: 'archiveRows', count: 'archive' },
    { name: 'Archive PA', field: 'archivePaRows', count: 'archivePa' },
    { name: 'Put-Away', field: 'putAwayRows', count: 'putAway' },
    { name: 'Cases', field: 'caseRows', count: 'cases' },
    { name: 'Watch List', field: 'watchRows', count: 'watch' },
  ];
  const sentSheets: string[] = [];
  const postHistory = async (body: object, label: string): Promise<PoHistorySyncResult> => {
    let historyResponse: Response;
    try {
      historyResponse = await fetch(PO_HISTORY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-overstock-import-key': IMPORT_KEY },
        body: JSON.stringify({ source: 'New Daily Rec', syncId, ...body }),
      });
    } catch (error) {
      throw new Error(`PO History could not send ${label}: ${String(error)}.`);
    }
    const historyText: string = await historyResponse.text();
    let parsed: PoHistorySyncResult = {};
    try {
      parsed = historyText ? JSON.parse(historyText) as PoHistorySyncResult : {};
    } catch {
      if (!historyResponse.ok) throw new Error(`PO History returned HTTP ${historyResponse.status}: ${historyText}`);
    }
    if (!historyResponse.ok) throw new Error(parsed.error || `PO History returned HTTP ${historyResponse.status} for ${label}.`);
    return parsed;
  };
  for (const sheet of sheets) {
    if (!workbook.getWorksheet(sheet.name)) continue; // optional sheets may not exist in older files
    const rows: Record<string, string>[] = worksheetRows(workbook, sheet.name);
    for (let start = 0; start < rows.length; start += 100) {
      const batch: PoHistorySyncResult = await postHistory(
        { action: 'syncWorkbookHistory', [sheet.field]: rows.slice(start, start + 100) },
        `${sheet.name} rows ${start + 1}-${Math.min(start + 100, rows.length)}`,
      );
      historyResult[sheet.count] = Number(historyResult[sheet.count] ?? 0) + Number(batch[sheet.count] ?? 0);
    }
    sentSheets.push(sheet.name);
  }
  const finished: PoHistorySyncResult = await postHistory({ action: 'finishSync', sheets: sentSheets }, 'the finishing step');

  return [
    'Houston sync complete.',
    `${result.updatedEntries ?? 0} item(s) updated`,
    `${result.createdEntries ?? 0} new item(s) added`,
    `${result.updatedContainers ?? 0} container(s) moved`,
    `${result.createdContainers ?? 0} new container(s) added`,
    `${result.retiredEmptyExcelBoxes ?? 0} empty Excel box(es) retired`,
    `${result.unchanged ?? 0} already current`,
    `${result.unresolved?.length ?? 0} row(s) need review`,
    `${result.skipped?.length ?? 0} row(s) skipped`,
    [...(result.unresolved ?? []), ...(result.skipped ?? [])].slice(0, 8).join(' | '),
    `${result.importedAssociates ?? 0} associate name(s) loaded`,
    `${historyResult.current ?? 0} current PO row(s) copied`,
    `${historyResult.archive ?? 0} archived PO row(s) copied`,
    `${historyResult.archivePa ?? 0} put-away history row(s) copied`,
    `${historyResult.putAway ?? 0} put-away row(s), ${historyResult.cases ?? 0} case(s) and ${historyResult.watch ?? 0} watch-list row(s) copied`,
    `${finished.hidden ?? 0} row(s) no longer in the workbook hidden from PO History`,
  ].join(' ');
}
