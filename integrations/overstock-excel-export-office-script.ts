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
  total?: number;
}

interface WorkbookHistoryPayload {
  currentRows: Record<string, string>[];
  archiveRows: Record<string, string>[];
  archivePaRows: Record<string, string>[];
}

function worksheetRows(workbook: ExcelScript.Workbook, sheetName: string): Record<string, string>[] {
  const sheet: ExcelScript.Worksheet | undefined = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const used: ExcelScript.Range | undefined = sheet.getUsedRange(true);
  if (!used) return [];
  const texts: string[][] = used.getTexts();
  const headerIndex: number = texts.findIndex((row: string[]): boolean =>
    row.some((cell: string): boolean => String(cell ?? '').trim() === 'PO # (Orden)')
  );
  if (headerIndex < 0) return [];
  const headers: string[] = texts[headerIndex].map((cell: string): string => String(cell ?? '').trim());
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
      quantity: Math.max(0, Math.round(Number(row[quantityCol] ?? 0) || 0)),
      location: String(row[locationCol] ?? '').trim(),
      containerCode: String(row[containerCol] ?? '').trim(),
      disposition: dispositionCol >= 0 ? String(row[dispositionCol] ?? '').trim() : '',
      note: noteCol >= 0 ? String(row[noteCol] ?? '').trim() : '',
    }))
    .filter((row: HoustonLocationRow): boolean => Boolean(row.location) && Boolean(row.deliveryId || row.po));

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

  const history: WorkbookHistoryPayload = {
    currentRows: worksheetRows(workbook, 'Daily Log'),
    archiveRows: worksheetRows(workbook, 'Archive'),
    archivePaRows: worksheetRows(workbook, 'Archive PA'),
  };
  const historyResult: PoHistorySyncResult = { current: 0, archive: 0, archivePa: 0 };
  const sheets: { name: string; field: keyof WorkbookHistoryPayload; count: keyof PoHistorySyncResult; rows: Record<string, string>[] }[] = [
    { name: 'Daily Log', field: 'currentRows', count: 'current', rows: history.currentRows },
    { name: 'Archive', field: 'archiveRows', count: 'archive', rows: history.archiveRows },
    { name: 'Archive PA', field: 'archivePaRows', count: 'archivePa', rows: history.archivePaRows },
  ];
  for (const sheet of sheets) {
    for (let start = 0; start < sheet.rows.length; start += 100) {
      const payload: WorkbookHistoryPayload = { currentRows: [], archiveRows: [], archivePaRows: [] };
      payload[sheet.field] = sheet.rows.slice(start, start + 100);
      let historyResponse: Response;
      try {
        historyResponse = await fetch(PO_HISTORY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-overstock-import-key': IMPORT_KEY },
          body: JSON.stringify({ action: 'syncWorkbookHistory', source: 'New Daily Rec', ...payload }),
        });
      } catch (error) {
        throw new Error(`PO History could not send ${sheet.name} rows ${start + 1}-${Math.min(start + 100, sheet.rows.length)}: ${String(error)}.`);
      }
      const historyText: string = await historyResponse.text();
      let batch: PoHistorySyncResult = {};
      try {
        batch = historyText ? JSON.parse(historyText) as PoHistorySyncResult : {};
      } catch {
        if (!historyResponse.ok) throw new Error(`PO History returned HTTP ${historyResponse.status}: ${historyText}`);
      }
      if (!historyResponse.ok) throw new Error(batch.error || `PO History returned HTTP ${historyResponse.status} for ${sheet.name} rows ${start + 1}-${Math.min(start + 100, sheet.rows.length)}.`);
      if (sheet.count === 'current') historyResult.current = (historyResult.current ?? 0) + (batch.current ?? 0);
      if (sheet.count === 'archive') historyResult.archive = (historyResult.archive ?? 0) + (batch.archive ?? 0);
      if (sheet.count === 'archivePa') historyResult.archivePa = (historyResult.archivePa ?? 0) + (batch.archivePa ?? 0);
    }
  }

  return [
    'Houston sync complete.',
    `${result.updatedEntries ?? 0} item(s) updated`,
    `${result.createdEntries ?? 0} new item(s) added`,
    `${result.updatedContainers ?? 0} container(s) moved`,
    `${result.createdContainers ?? 0} new container(s) added`,
    `${result.unchanged ?? 0} already current`,
    `${result.unresolved?.length ?? 0} unmatched`,
    `${result.importedAssociates ?? 0} associate name(s) loaded`,
    `${historyResult.current ?? 0} current PO row(s) copied`,
    `${historyResult.archive ?? 0} archived PO row(s) copied`,
    `${historyResult.archivePa ?? 0} put-away history row(s) copied`,
  ].join(' ');
}
