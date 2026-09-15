// New Daily Rec workbook -> Houston Overstock location sync helper.
// Add this script in Excel for the web: Automate > New Script.
// A scheduled Power Automate flow runs it and POSTs the returned rows to Houston.

interface HoustonLocationRow {
  po: string;
  deliveryId: string;
  location: string;
  containerCode: string;
}

function main(workbook: ExcelScript.Workbook): HoustonLocationRow[] {
  const table = workbook.getTable('DailyLog');
  if (!table) throw new Error('Excel table DailyLog was not found.');

  const headers = table.getHeaderRowRange().getTexts()[0].map(value => String(value ?? '').trim());
  const body = table.getRangeBetweenHeaderAndTotal();
  const textRows = body.getTexts();
  const indexOf = (name: string) => headers.indexOf(name);

  const poCol = indexOf('PO # (Orden)');
  const deliveryCol = indexOf('Delivery ID (auto)');
  const locationCol = indexOf('Overstock Loc (Ubicacion)');
  const containerCol = indexOf('Overstock Cont. (Contenedor)');
  if (poCol < 0 || deliveryCol < 0 || locationCol < 0 || containerCol < 0) {
    throw new Error('DailyLog is missing a required PO, Delivery ID, location, or container column.');
  }

  return textRows
    .map(row => ({
      po: String(row[poCol] ?? '').trim(),
      deliveryId: String(row[deliveryCol] ?? '').trim(),
      location: String(row[locationCol] ?? '').trim(),
      containerCode: String(row[containerCol] ?? '').trim(),
    }))
    .filter(row => Boolean(row.location) && Boolean(row.deliveryId || row.po));
}
