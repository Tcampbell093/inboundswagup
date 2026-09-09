// Overstock -> New Daily Rec workbook sync helper for Power Automate.
// Add this script in Excel for the web: Automate > New Script.
// Power Automate passes the Netlify webhook payload as payloadJson.

interface OverstockExcelRow {
  po?: string;
  deliveryId?: string;
  quantity?: number;
  location?: string;
  containerCode?: string;
  disposition?: string;
  note?: string;
}

interface OverstockExcelPayload {
  event: string;
  source?: string;
  occurredAt?: string;
  containerCode?: string;
  location?: string;
  rows?: OverstockExcelRow[];
}

function main(workbook: ExcelScript.Workbook, payloadJson: string): string {
  const payload = JSON.parse(payloadJson || '{}') as OverstockExcelPayload;

  // Daily Log is an audit/history workbook. A delete in Overstock does not
  // clear historical Excel fields automatically.
  if (payload.event === 'entry.deleted' || payload.event === 'container.deleted') {
    return JSON.stringify({ ok: true, event: payload.event, updated: 0, unresolved: [], skipped: 'audit-preserve-delete' });
  }

  const table = workbook.getTable('DailyLog');
  if (!table) throw new Error('Excel table DailyLog was not found.');

  const headers = table.getHeaderRowRange().getValues()[0].map(v => String(v ?? '').trim());
  const body = table.getRangeBetweenHeaderAndTotal();
  const values = body.getValues();

  const idx = (name: string) => headers.indexOf(name);
  const poCol = idx('PO # (Orden)');
  const deliveryCol = idx('Delivery ID (auto)');
  const qtyCol = idx('Overstock Qty');
  const locCol = idx('Overstock Loc (Ubicacion)');
  const containerCol = idx('Overstock Cont. (Contenedor)');
  const dispositionCol = idx('Disposition (Donado/Ret/Req)');
  const noteCol = idx('Overstock Note (Motivo)');

  if (poCol < 0 || locCol < 0 || containerCol < 0) {
    throw new Error('DailyLog is missing one or more required Overstock columns.');
  }

  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  let updated = 0;
  const unresolved: string[] = [];

  for (const change of rows) {
    const po = String(change.po ?? '').trim();
    const deliveryId = String(change.deliveryId ?? '').trim();
    if (!po && !deliveryId) continue;

    // Prefer Delivery ID because one PO can arrive in multiple deliveries.
    let matches: number[] = [];
    if (deliveryId && deliveryCol >= 0) {
      matches = values
        .map((row, i) => String(row[deliveryCol] ?? '').trim().toUpperCase() === deliveryId.toUpperCase() ? i : -1)
        .filter(i => i >= 0);
    }

    if (!matches.length && po) {
      const poMatches = values
        .map((row, i) => String(row[poCol] ?? '').trim().toUpperCase() === po.toUpperCase() ? i : -1)
        .filter(i => i >= 0);

      // A bare PO is safe only when it identifies one DailyLog row.
      if (poMatches.length === 1) matches = poMatches;
      else if (poMatches.length > 1) {
        unresolved.push(`${po}: multiple DailyLog rows; add Delivery ID in Overstock.`);
        continue;
      }
    }

    if (!matches.length) {
      unresolved.push(`${deliveryId || po}: no DailyLog row found.`);
      continue;
    }

    for (const rowIndex of matches) {
      // Write ONLY the Overstock input columns. Do not rewrite the whole table:
      // DailyLog contains formula/auto columns that must remain formulas.
      if (qtyCol >= 0 && change.quantity !== undefined && change.quantity !== null) {
        body.getCell(rowIndex, qtyCol).setValue(Number(change.quantity) || 0);
      }
      if (locCol >= 0 && change.location !== undefined) {
        body.getCell(rowIndex, locCol).setValue(String(change.location ?? ''));
      }
      if (containerCol >= 0 && change.containerCode !== undefined) {
        body.getCell(rowIndex, containerCol).setValue(String(change.containerCode ?? ''));
      }
      if (dispositionCol >= 0 && change.disposition !== undefined) {
        body.getCell(rowIndex, dispositionCol).setValue(String(change.disposition ?? ''));
      }
      if (noteCol >= 0 && change.note !== undefined) {
        body.getCell(rowIndex, noteCol).setValue(String(change.note ?? ''));
      }
      updated += 1;
    }
  }

  return JSON.stringify({ ok: true, event: payload.event, updated, unresolved });
}
