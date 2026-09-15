// New Daily Rec workbook -> Houston Overstock location sync helper.
// Add this script in Excel for the web: Automate > New Script, then add a button.
// Replace IMPORT_KEY below with the private value configured in Netlify.

interface HoustonLocationRow {
  po: string;
  deliveryId: string;
  category: string;
  operationalDate: string;
  quantity: number;
  location: string;
  containerCode: string;
  disposition: string;
  note: string;
}

async function main(workbook: ExcelScript.Workbook): Promise<string> {
  const HOUSTON_ENDPOINT = 'https://inboundswagup.netlify.app/api/overstock-control';
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
  const categoryCol = 7; // Workbook column H.
  const operationalDateCol = 19; // Workbook column T: Prep Date (Prep).
  const quantityCol = indexOf('Overstock Qty');
  const locationCol = indexOf('Overstock Loc (Ubicacion)');
  const containerCol = indexOf('Overstock Cont. (Contenedor)');
  const dispositionCol = indexOf('Disposition (Donado/Ret/Req)');
  const noteCol = indexOf('Overstock Note (Motivo)');
  if (poCol < 0 || deliveryCol < 0 || quantityCol < 0 || locationCol < 0 || containerCol < 0) {
    throw new Error('DailyLog is missing a required PO, Delivery ID, quantity, location, or container column.');
  }

  const rows = textRows
    .map(row => ({
      po: String(row[poCol] ?? '').trim(),
      deliveryId: String(row[deliveryCol] ?? '').trim(),
      category: String(row[categoryCol] ?? '').trim(),
      operationalDate: String(row[operationalDateCol] ?? '').trim(),
      quantity: Math.max(0, Math.round(Number(row[quantityCol] ?? 0) || 0)),
      location: String(row[locationCol] ?? '').trim(),
      containerCode: String(row[containerCol] ?? '').trim(),
      disposition: dispositionCol >= 0 ? String(row[dispositionCol] ?? '').trim() : '',
      note: noteCol >= 0 ? String(row[noteCol] ?? '').trim() : '',
    }))
    .filter(row => Boolean(row.location) && Boolean(row.deliveryId || row.po));

  if (!rows.length) return 'Nothing to sync: no populated Overstock locations were found.';

  const response = await fetch(HOUSTON_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-overstock-import-key': IMPORT_KEY,
    },
    body: JSON.stringify({ action: 'syncFromExcel', rows, associates }),
  });

  const responseText = await response.text();
  let result: {
    error?: string;
    received?: number;
    updatedEntries?: number;
    updatedContainers?: number;
    createdEntries?: number;
    createdContainers?: number;
    unchanged?: number;
    skipped?: unknown[];
    unresolved?: unknown[];
    importedAssociates?: number;
  } = {};

  try {
    const parsed = responseText ? JSON.parse(responseText) : {};
    result = parsed.import ?? parsed;
  } catch {
    if (!response.ok) throw new Error(`Houston returned HTTP ${response.status}: ${responseText}`);
  }

  if (!response.ok) {
    throw new Error(result.error || `Houston returned HTTP ${response.status}.`);
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
  ].join(' ');
}
