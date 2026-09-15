# Overstock Control ↔ New Daily Rec Excel sync

This integration supports both directions between Overstock Control and the SharePoint-hosted **New Daily Rec..xlsx** workbook. The inbound flow updates locations on matching Houston records and creates a new Houston item when a populated workbook PO does not already exist. It never deletes records or rewrites existing quantities, dispositions, notes, or historical timestamps.

## Workbook contract

The workbook contains Excel table **DailyLog**. The sync targets these columns exactly:

- `PO # (Orden)`
- `Delivery ID (auto)` — preferred row key when available
- Column H — category
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

## Excel location → Overstock Control (one-click, no Premium connector)

The workbook can call Houston directly from an Office Script when a user clicks its worksheet button. This avoids the Power Automate Premium HTTP action.

1. Add `integrations/overstock-excel-export-office-script.ts` in Excel for the web under **Automate → New Script**.
2. Rotate `OVERSTOCK_EXCEL_IMPORT_SECRET` in Netlify if its previous value was exposed.
3. Replace `PASTE_YOUR_NEW_NETLIFY_KEY_HERE` in the private workbook script with that new value. Never commit the value to GitHub.
4. Save the script, associate it with the workbook, and choose **Add button to worksheet**.
5. Rename the button **Sync locations to Houston**.
6. After changing Overstock locations, click the button and wait for the completion message.

Anyone allowed to edit the workbook may be able to inspect its associated script and key. Restrict workbook edit access accordingly. The server limits this key to location updates on existing Houston records; it cannot create or delete records or change quantities, dispositions, notes, or history.

Office Scripts external API calls must be allowed by the Microsoft 365 administrator. If the workbook reports that external calls are disabled, BDA IT must enable them or provide an approved integration method.

The endpoint prefers `Delivery ID (auto)`. If no Delivery ID match exists, it updates existing Houston entries with the same PO number. Column H is copied into the Houston category field. If neither key matches, it creates a Houston item using the workbook PO, Delivery ID, category, Overstock Qty, location, container, disposition and note. A missing container code receives the next `OSC-###` code. Blank workbook locations are ignored and never erase a Houston location. If a matched item belongs to a Houston container, the container location and every item in that container move together.

The response reports updated entries, updated containers, skipped blank rows, and workbook rows that could not be matched. The flow should retain failed or unresolved responses for manager review.
