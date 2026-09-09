# Overstock Control → New Daily Rec Excel sync

This integration makes Overstock Control the source of truth and writes warehouse changes into the SharePoint-hosted **New Daily Rec..xlsx** workbook.

## Workbook contract

The uploaded workbook already contains Excel table **DailyLog** (`A4:AZ504`). The sync targets these columns exactly:

- `PO # (Orden)`
- `Delivery ID (auto)` — preferred row key when available
- `Overstock Qty`
- `Overstock Loc (Ubicacion)`
- `Overstock Cont. (Contenedor)`
- `Disposition (Donado/Ret/Req)`
- `Overstock Note (Motivo)`

A PO can have more than one delivery, so the Office Script prefers **Delivery ID**. If an Overstock record has no Delivery ID, a PO-only match is accepted only when that PO occurs once in DailyLog. Duplicate PO matches are deliberately skipped instead of guessing.

## Power Automate flow

Create one cloud flow in the same Microsoft 365 account that can edit the live workbook.

1. Trigger: **When an HTTP request is received**.
2. Request body can be treated as JSON. The Netlify app sends the whole event body.
3. Action: **Excel Online (Business) → Run script**.
4. Select the SharePoint-hosted `New Daily Rec..xlsx` file.
5. Add the Office Script from `integrations/overstock-excel-office-script.ts` to that workbook.
6. In the Run script action, pass the trigger body converted to a string into `payloadJson`.
7. Save the flow and copy the generated HTTP POST URL.
8. Store that URL in the Netlify environment variable `OVERSTOCK_EXCEL_WEBHOOK_URL` with Functions/Runtime scope.
9. Trigger a new production deploy so the function receives the environment variable.

## Events sent by Overstock Control

- `entry.upserted` — add/edit an Overstock item; sends PO, Delivery ID, quantity, location, container, disposition and note.
- `entry.deleted` — sends the deleted item identity. The Office Script currently does not clear Excel automatically; this is intentional so accidental deletes do not erase the Daily Log.
- `container.updated` — when a container code/location/status is edited, sends every Overstock item currently inside that container so Excel can update all matching DailyLog rows.

The database write completes first. Excel sync is secondary: a temporary Microsoft/Power Automate failure does not roll back the warehouse transaction.
