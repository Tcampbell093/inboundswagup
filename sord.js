(function(){
  const STORAGE_KEY='ops_hub_sord_imports_v1';
  const OWNER_MAP_KEY='ops_hub_sord_owner_map_v1';
  const SEARCH_LIMIT_DEFAULT = 250;
  const SALESFORCE_BASE = 'https://swagup.lightning.force.com';
  const PURCHASE_ORDER_OBJECT = 'Purchase_Order__c';

  const els = {
    page: document.getElementById('sordPage'),
    queueInput: document.getElementById('sordQueueFileInput'),
    revenueInput: document.getElementById('sordRevenueFileInput'),
    eomInput: document.getElementById('sordEomFileInput'),
    importBtn: document.getElementById('sordImportBtn'),
    clearBtn: document.getElementById('sordClearImportsBtn'),
    refreshBtn: document.getElementById('sordRefreshBtn'),
    importStatus: document.getElementById('sordImportStatus'),
    topStats: document.getElementById('sordTopStats'),
    searchInput: document.getElementById('sordSearchInput'),
    statusFilter: document.getElementById('sordStatusFilter'),
    readinessFilter: document.getElementById('sordReadinessFilter'),
    complexityFilter: document.getElementById('sordComplexityFilter'),
    riskFilter: document.getElementById('sordRiskFilter'),
    resetFiltersBtn: document.getElementById('sordResetFiltersBtn'),
    explorerBody: document.getElementById('sordExplorerBody'),
    explorerCount: document.getElementById('sordExplorerCount'),
    dossierTitle: document.getElementById('sordDossierTitle'),
    dossierBadges: document.getElementById('sordDossierBadges'),
    summaryGrid: document.getElementById('sordSummaryGrid'),
    flagsWrap: document.getElementById('sordFlagsWrap'),
    packBuilderBody: document.getElementById('sordPackBuilderBody'),
    revenuePanel: document.getElementById('sordRevenuePanel'),
    timelinePanel: document.getElementById('sordTimelinePanel'),
    poBody: document.getElementById('sordPoBody'),
    accountProductBody: document.getElementById('sordAccountProductBody'),
    ownerMapBody: document.getElementById('sordOwnerMapBody'),
    ownerUtilityLabel: document.getElementById('sordOwnerUtilityLabel'),
    ownerUtilityUrl: document.getElementById('sordOwnerUtilityUrl'),
    ownerUtilityLink: document.getElementById('sordOwnerUtilityLink'),
    addOwnerRowBtn: document.getElementById('sordAddOwnerRowBtn'),
    saveOwnerMapBtn: document.getElementById('sordSaveOwnerMapBtn')
  };


  const DEFAULT_OWNER_MAP = {
    utilityLabel: 'Open team directory',
    utilityUrl: '',
    rows: [
      { sfName:'dan', accountManager:'Dan Kolomatis', accountManagerLink:'', projectManager:'Brenda Liontop', projectManagerLink:'', psa:'Maggie Ildesa', psaLink:'' },
      { sfName:'rob.youn', accountManager:'Rob Young', accountManagerLink:'', projectManager:'Tracy Pacht', projectManagerLink:'', psa:'Maggie Ildesa', psaLink:'' },
      { sfName:'mmart', accountManager:'Michaela Stamler', accountManagerLink:'', projectManager:'Meg Schippe', projectManagerLink:'', psa:'Jess Roldan', psaLink:'' },
      { sfName:'kkell', accountManager:'Kevin Kelly', accountManagerLink:'', projectManager:"Jessica O'Donnell", projectManagerLink:'', psa:'Leila Sanvictores', psaLink:'' },
      { sfName:'lindsey.', accountManager:'Lindsey Pedersen', accountManagerLink:'', projectManager:"Jessica O'Donnell", projectManagerLink:'', psa:'Leila Sanvictores', psaLink:'' },
      { sfName:'sarah.dj', accountManager:'Sarah Djafri', accountManagerLink:'', projectManager:'CJ Panuayan', projectManagerLink:'', psa:'John Cardeno', psaLink:'' },
      { sfName:'dvaitena', accountManager:'David Vaitenas', accountManagerLink:'', projectManager:'Meg Schippe', projectManagerLink:'', psa:'John Cardeno', psaLink:'' },
      { sfName:'michael.', accountManager:'Mike Bajramoski', accountManagerLink:'', projectManager:'Camila Lomanto', projectManagerLink:'', psa:'Vin Natividad', psaLink:'' },
      { sfName:'mahek.sh', accountManager:'Mahek Shah', accountManagerLink:'', projectManager:'Erica Tracy', projectManagerLink:'', psa:'Vin Natividad', psaLink:'' }
    ]
  };

  if (!els.page) return;

  const state = {
    imports: loadJson(STORAGE_KEY, {
      queueRows: [],
      revenueRows: [],
      eomRows: [],
      importedAt: '',
      fileNames: { queue: '', revenue: '', eom: '' }
    }),
    dataset: [],
    selectedKey: '',
    ownerMap: loadJson(OWNER_MAP_KEY, DEFAULT_OWNER_MAP)
  };

  function saveState(){ saveJson(STORAGE_KEY, state.imports); }
  function safeText(v){ return String(v ?? '').trim(); }
  function norm(v){ return safeText(v).toLowerCase(); }
  function num(v){ const n = Number(String(v ?? '').replace(/[$,]/g,'')); return Number.isFinite(n) ? n : 0; }
  function unique(arr){ return [...new Set((arr||[]).filter(Boolean))]; }
  function fmtMoney(v){ return '$' + Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtInt(v){ return Number(v||0).toLocaleString(); }
  function fmtDate(v){
    const s=safeText(v);
    if(!s) return '—';
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-US');
    return s;
  }
  function escape(v){ return typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? ''); }
  function escJs(v){ return typeof escapeJs === 'function' ? escapeJs(v) : String(v ?? '').replace(/'/g,"\\'"); }
  function dateToIso(v){
    const s = safeText(v);
    if (!s) return '';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0,10);
  }
  function minDate(values){ return unique(values.map(dateToIso).filter(Boolean)).sort()[0] || ''; }
  function salesOrderUrl(id){
    const clean = safeText(id);
    return clean ? `${SALESFORCE_BASE}/lightning/r/SalesOrder__c/${encodeURIComponent(clean)}/view` : '';
  }
  function purchaseOrderUrl(id){
    const clean = safeText(id);
    return clean ? `${SALESFORCE_BASE}/lightning/r/${PURCHASE_ORDER_OBJECT}/${encodeURIComponent(clean)}/view` : '';
  }
  function maxDate(values){ const arr = unique(values.map(dateToIso).filter(Boolean)).sort(); return arr[arr.length-1] || ''; }
  function summarizeFileNames(){
    const f=state.imports.fileNames||{};
    const pieces=[];
    if(f.queue) pieces.push(`Queue: ${f.queue}`);
    if(f.revenue) pieces.push(`Revenue: ${f.revenue}`);
    if(f.eom) pieces.push(`EOM: ${f.eom}`);
    return pieces.join(' • ');
  }


  function saveOwnerMap(){ saveJson(OWNER_MAP_KEY, state.ownerMap); }
  function emptyOwnerRow(){
    return { sfName:'', accountManager:'', accountManagerLink:'', projectManager:'', projectManagerLink:'', psa:'', psaLink:'' };
  }
  function normalizeOwnerMap(){
    const src = state.ownerMap || DEFAULT_OWNER_MAP;
    state.ownerMap = {
      utilityLabel: safeText(src.utilityLabel) || 'Open link',
      utilityUrl: safeText(src.utilityUrl),
      rows: (Array.isArray(src.rows) ? src.rows : []).map(row => ({
        sfName: safeText(row.sfName),
        accountManager: safeText(row.accountManager),
        accountManagerLink: safeText(row.accountManagerLink),
        projectManager: safeText(row.projectManager),
        projectManagerLink: safeText(row.projectManagerLink),
        psa: safeText(row.psa),
        psaLink: safeText(row.psaLink)
      }))
    };
  }
  function ownerIndex(){
    const map = new Map();
    (state.ownerMap?.rows || []).forEach(row => {
      const keys = unique([row.sfName, row.accountManager]).map(norm).filter(Boolean);
      keys.forEach(key => { if(!map.has(key)) map.set(key, row); });
    });
    return map;
  }
  function getOwnerMapping(ownerValue){
    const key = norm(ownerValue);
    return key ? ownerIndex().get(key) || null : null;
  }
  function roleLink(name, url){
    const label = escape(name || '—');
    return safeText(url) ? `<a class="queue-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  }
  function internalSordLink(sord){
    const match = state.dataset.find(x => norm(x.sord) === norm(sord));
    if(match) return `<a class="queue-link" href="#" onclick="window.selectSordRecord('${escJs(match.key)}');return false;">${escape(sord)}</a>`;
    return escape(sord);
  }
  function renderOwnerMapTable(){
    if(!els.ownerMapBody) return;
    const rows = state.ownerMap?.rows || [];
    els.ownerUtilityLabel.value = state.ownerMap?.utilityLabel || '';
    els.ownerUtilityUrl.value = state.ownerMap?.utilityUrl || '';
    if (safeText(state.ownerMap?.utilityUrl)) {
      els.ownerUtilityLink.style.display = '';
      els.ownerUtilityLink.href = state.ownerMap.utilityUrl;
      els.ownerUtilityLink.textContent = safeText(state.ownerMap.utilityLabel) || 'Open link';
    } else {
      els.ownerUtilityLink.style.display = 'none';
      els.ownerUtilityLink.removeAttribute('href');
    }
    els.ownerMapBody.innerHTML = rows.length ? rows.map((row, idx) => `
      <tr>
        <td><input data-owner-field="sfName" data-owner-index="${idx}" value="${escape(row.sfName)}" placeholder="dan" /></td>
        <td>
          <input data-owner-field="accountManager" data-owner-index="${idx}" value="${escape(row.accountManager)}" placeholder="Dan Kolomatis" />
          <input class="sord-link-input" data-owner-field="accountManagerLink" data-owner-index="${idx}" value="${escape(row.accountManagerLink)}" placeholder="Slack link" />
        </td>
        <td>
          <input data-owner-field="projectManager" data-owner-index="${idx}" value="${escape(row.projectManager)}" placeholder="Brenda Liontop" />
          <input class="sord-link-input" data-owner-field="projectManagerLink" data-owner-index="${idx}" value="${escape(row.projectManagerLink)}" placeholder="Slack link" />
        </td>
        <td>
          <input data-owner-field="psa" data-owner-index="${idx}" value="${escape(row.psa)}" placeholder="Maggie Ildesa" />
          <input class="sord-link-input" data-owner-field="psaLink" data-owner-index="${idx}" value="${escape(row.psaLink)}" placeholder="Slack link" />
        </td>
        <td><button class="btn secondary btn-sm" type="button" onclick="window.deleteOwnerMapRow(${idx})">Remove</button></td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty">No owner mapping rows yet.</td></tr>';
  }
  function syncOwnerMapFromUi(){
    if(!els.ownerMapBody) return;
    const rows = (state.ownerMap?.rows || []).map(() => emptyOwnerRow());
    els.ownerMapBody.querySelectorAll('[data-owner-index]').forEach(input => {
      const idx = Number(input.getAttribute('data-owner-index'));
      const field = input.getAttribute('data-owner-field');
      if(rows[idx]) rows[idx][field] = safeText(input.value);
    });
    state.ownerMap = {
      utilityLabel: safeText(els.ownerUtilityLabel?.value),
      utilityUrl: safeText(els.ownerUtilityUrl?.value),
      rows: rows.filter(row => Object.values(row).some(Boolean))
    };
  }

  function normalizeHeaderKey(key){
    return safeText(key)
      .replace(/\u00a0/g,' ')
      .replace(/[\n\r\t]+/g,' ')
      .replace(/[()]/g,'')
      .replace(/[:/]+/g,' ')
      .replace(/[^a-zA-Z0-9]+/g,'_')
      .replace(/^_+|_+$/g,'')
      .toLowerCase();
  }

  function objectWithNormalizedKeys(row){
    const out={};
    Object.keys(row||{}).forEach(key=>{ out[normalizeHeaderKey(key)] = row[key]; });
    return out;
  }

  async function parseWorkbookOrCsv(file){
    const name=safeText(file?.name).toLowerCase();
    if(!file) return [];
    if(name.endsWith('.csv')){
      const text = await file.text();
      const wb = XLSX.read(text, { type: 'string' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet,{defval:''});
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet,{defval:''});
  }

  function parseQueueImportRows(rawRows){
    const grouped = new Map();
    rawRows.forEach(raw=>{
      const r=objectWithNormalizedKeys(raw);
      const pb = safeText(r.pack_builder_name || r.pack_builder);
      if(!pb) return;
      const pbId = safeText(r.pack_builder_id);
      const sord = safeText(r.sales_order_sales_order_name || r.sales_order_name || r.sord || r.sales_order);
      const salesOrderId = safeText(r.sales_order_id);
      const account = safeText(r.account || r.account_product_account_product_name);
      const accountOwner = safeText(r.account_owner);
      const qty = num(r.quantity);
      const products = num(r.total_unique_products || r.products);
      const ihd = safeText(r.in_hands_date || r.ihd || r.complete_date);
      const pdfUrl = safeText(r.pack_builder_pdf_url || r.pdf_url);
      const status = safeText(r.status);
      const key = pbId || pb;
      if(!grouped.has(key)){
        grouped.set(key, {
          sord, salesOrderId, pb, pbId, account, accountOwner, qty, products,
          units: qty * products, ihd, pdfUrl, status
        });
      } else {
        const cur = grouped.get(key);
        cur.sord = cur.sord || sord;
        cur.salesOrderId = cur.salesOrderId || salesOrderId;
        cur.account = cur.account || account;
        cur.accountOwner = cur.accountOwner || accountOwner;
        cur.qty = Math.max(cur.qty, qty);
        cur.products = Math.max(cur.products, products);
        cur.units = cur.qty * cur.products;
        cur.ihd = cur.ihd || ihd;
        cur.pdfUrl = cur.pdfUrl || pdfUrl;
        cur.status = cur.status || status;
      }
    });
    return [...grouped.values()];
  }

  function parseRevenueImportRows(rawRows){
    return rawRows.map(raw=>{
      const r=objectWithNormalizedKeys(raw);
      const sord = safeText(r.sales_order || r.sales_order_name || r.sord || r.sales_order_sales_order_name);
      const salesOrderId = safeText(r.sales_order_id);
      const subtotal = num(r.subtotal || r.invoice_subtotal);
      const originalSubtotal = num(r.original_subtotal || r.originalsubtotal || r.original_sub_total);
      const status = safeText(r.status || r.sales_order_status);
      const poStatus = safeText(r.po_status || r.purchase_order_status);
      const ihd = safeText(r.ihd || r.in_hands_date || r.requested_in_hands_date_from_supplier);
      const account = safeText(r.account || r.account_account_name || r.client_name);
      const invoiceName = safeText(r.invoice_name || r.invoice || r.invoice_number);
      const accountOwner = safeText(r.account_owner || r.owner_full_name);
      const createdBy = safeText(r.created_by_full_name);
      const orderOwner = safeText(r.owner_full_name);
      const totalBulkProducts = num(r.total_bulk_products);
      const totalPackItems = num(r.total_pack_items);
      const productionType = safeText(r.production_type);
      const dueDate = safeText(r.due_date);
      const createdDate = safeText(r.created_date);
      const notes = safeText(r.notes);
      const relatedSords = unique((notes.match(/SORD-\d+/gi) || []).map(x=>safeText(x).toUpperCase())).filter(x=>x !== safeText(sord).toUpperCase());
      return {
        sord, salesOrderId, subtotal, originalSubtotal, status, poStatus, ihd, account, invoiceName,
        accountOwner, createdBy, orderOwner, totalBulkProducts, totalPackItems, productionType, dueDate, createdDate, notes, relatedSords
      };
    }).filter(r=>r.sord || r.salesOrderId);
  }

  function parseEomImportRows(rawRows){
    return rawRows.map(raw=>{
      const r=objectWithNormalizedKeys(raw);
      return {
        sord: safeText(r.opportunity_quote_sales_order_sales_order_name || r.sales_order_name || r.sales_order || r.sord),
        salesOrderId: safeText(r.sales_order_id),
        salesOrderCreatedDate: safeText(r.sales_order_created_date),
        purchaseOrderName: safeText(r.purchase_order_purchase_order_name || r.purchase_order_name || r.purchase_order),
        purchaseOrderId: safeText(r.purchase_order_id || r.purchase_order_purchase_order_id || r.purchase_order_id_1),
        poOwner: safeText(r.po_owner || r.purchase_order_owner || r.owner),
        supplier: safeText(r.supplier || r.supplier_name || r.vendor),
        printerName: safeText(r.decoration_supplier_product_printer_name),
        estimatedShipDate: safeText(r.estimated_ship_date || r.requested_in_hands_date_from_supplier || r.ship_date),
        createdDate: safeText(r.created_date),
        ihd: safeText(r.opportunity_quote_sales_order_in_hands_date || r.in_hands_date),
        itemTotalCost: num(r.item_total_cost || r.total_item_cost || r.item_cost),
        lineItemPrice: num(r.line_item_price || r.item_price || r.unit_price || r.opportunity_quote_product_total_price || r.opportunity_quote_p_item_opportunity_quote_product_total_price),
        invoiceTotal: num(r.opportunity_quote_invoice_total || r.invoice_total),
        subtotal: num(r.subtotal || r.invoice_subtotal || r.opportunity_quote_invoice_subtotal),
        originalSubtotal: num(r.original_subtotal || r.originalsubtotal || r.opportunity_quote_invoice_original_subtotal),
        invoiceName: safeText(r.invoice_name || r.invoice),
        account: safeText(r.account || r.client_name || r.opportunity_quote_sales_order_client_name),
        accountOwner: safeText(r.account_owner),
        status: safeText(r.status || r.so_status || r.opportunity_quote_sales_order_status),
        poStatus: safeText(r.po_status || r.purchase_order_status || r.so_status || r.opportunity_quote_sales_order_status),
        accountProductName: safeText(r.account_product_account_product_name || r.account_product || r.account_product_name),
        accountProductExternalId: safeText(r.account_product_external_id),
        externalId: safeText(r.external_id),
        quantity: num(r.quantity),
        quantityReceived: num(r.quantity_received)
      };
    }).filter(r => r.sord || r.salesOrderId || r.purchaseOrderId || r.purchaseOrderName);
  }

  function getLiveOperationalRows(){
    const rows = [];
    const add = (source, list) => {
      (Array.isArray(list) ? list : []).forEach(row => {
        const sord = safeText(row.so || row.salesOrder || row.sord);
        if(!sord) return;
        rows.push({
          source,
          sord,
          salesOrderId: '',
          pb: safeText(row.pb),
          pbId: safeText(row.pbId),
          account: safeText(row.account),
          qty: num(row.qty),
          products: num(row.products),
          units: num(row.units || (num(row.qty) * num(row.products))),
          ihd: safeText(row.ihd),
          status: safeText(row.status),
          stage: safeText(row.stage),
          date: safeText(row.date || row.scheduledFor),
          scheduledFor: safeText(row.scheduledFor),
          pdfUrl: safeText(row.pdfUrl),
          accountOwner: safeText(row.accountOwner),
          subtotal: num(row.subtotal),
          workType: safeText(row.workType)
        });
      });
    };
    add('Available Queue', window.availableQueueRows);
    add('Incomplete Queue', window.incompleteQueueRows);
    add('Scheduled Queue', window.scheduledQueueRows);
    add('Assembly Board', window.assemblyBoardRows);
    return rows;
  }

  function resolveOrderKey(parts){
    return safeText(parts.salesOrderId || parts.sord);
  }

  function buildDataset(){
    const map = new Map();
    const ensure = (parts) => {
      const key = resolveOrderKey(parts);
      if(!key) return null;
      if(!map.has(key)){
        map.set(key, {
          key,
          sord: safeText(parts.sord),
          salesOrderId: safeText(parts.salesOrderId),
          account: '',
          accountOwner: '',
          orderOwner: '',
          createdBy: '',
          status: '',
          poStatus: '',
          invoiceName: '',
          subtotal: 0,
          originalSubtotal: 0,
          invoiceTotal: 0,
          totalPackItems: 0,
          totalBulkProducts: 0,
          revenueRows: [],
          queueRows: [],
          eomRows: [],
          liveRows: [],
          packBuilderMap: new Map(),
          poMap: new Map(),
          accountProductMap: new Map(),
          suppliers: new Set(),
          poOwners: new Set(),
          printerNames: new Set(),
          productionTypes: new Set(),
          notesSet: new Set(),
          relatedSords: new Set(),
          estimatedDates: [],
          ihdDates: [],
          dueDates: [],
          createdDates: [],
          salesOrderCreatedDates: [],
          flags: []
        });
      }
      const obj = map.get(key);
      obj.sord = obj.sord || safeText(parts.sord);
      obj.salesOrderId = obj.salesOrderId || safeText(parts.salesOrderId);
      return obj;
    };

    (state.imports.queueRows||[]).forEach(row=>{
      const obj = ensure(row); if(!obj) return;
      obj.queueRows.push(row);
      obj.account = obj.account || row.account;
      obj.accountOwner = obj.accountOwner || row.accountOwner;
      obj.status = obj.status || row.status;
      obj.ihdDates.push(row.ihd);
      const pbKey = row.pbId || row.pb;
      if(pbKey && !obj.packBuilderMap.has(pbKey)){
        obj.packBuilderMap.set(pbKey, {
          pb: row.pb, pbId: row.pbId, source: 'Queue Import', qty: row.qty, products: row.products,
          units: row.units, status: row.status, ihd: row.ihd, stage: '', link: row.pdfUrl || (typeof buildSalesforcePbLink === 'function' ? buildSalesforcePbLink(row.pbId, row.pdfUrl) : ''),
          account: row.account, accountOwner: row.accountOwner
        });
      }
    });

    (state.imports.revenueRows||[]).forEach(row=>{
      const obj = ensure(row); if(!obj) return;
      obj.revenueRows.push(row);
      obj.account = obj.account || row.account;
      obj.accountOwner = obj.accountOwner || row.accountOwner;
      obj.orderOwner = obj.orderOwner || row.orderOwner;
      obj.createdBy = obj.createdBy || row.createdBy;
      obj.status = obj.status || row.status;
      obj.poStatus = obj.poStatus || row.poStatus;
      obj.invoiceName = obj.invoiceName || row.invoiceName;
      obj.subtotal = Math.max(obj.subtotal, row.subtotal || 0);
      obj.originalSubtotal = Math.max(obj.originalSubtotal, row.originalSubtotal || 0);
      obj.totalPackItems = Math.max(obj.totalPackItems, row.totalPackItems || 0);
      obj.totalBulkProducts = Math.max(obj.totalBulkProducts, row.totalBulkProducts || 0);
      if(row.productionType) obj.productionTypes.add(row.productionType);
      if(row.notes) obj.notesSet.add(row.notes);
      (row.relatedSords||[]).forEach(s=>obj.relatedSords.add(s));
      obj.ihdDates.push(row.ihd);
      obj.dueDates.push(row.dueDate);
      obj.createdDates.push(row.createdDate);
    });

    (state.imports.eomRows||[]).forEach(row=>{
      const obj = ensure(row); if(!obj) return;
      obj.eomRows.push(row);
      obj.account = obj.account || row.account;
      obj.accountOwner = obj.accountOwner || row.accountOwner;
      obj.status = obj.status || row.status;
      obj.poStatus = obj.poStatus || row.poStatus;
      obj.invoiceName = obj.invoiceName || row.invoiceName;
      obj.subtotal = Math.max(obj.subtotal, row.subtotal || 0);
      obj.originalSubtotal = Math.max(obj.originalSubtotal, row.originalSubtotal || 0);
      obj.invoiceTotal = Math.max(obj.invoiceTotal, row.invoiceTotal || 0);
      if(row.supplier) obj.suppliers.add(row.supplier);
      if(row.poOwner) obj.poOwners.add(row.poOwner);
      if(row.printerName) obj.printerNames.add(row.printerName);
      if(row.estimatedShipDate) obj.estimatedDates.push(row.estimatedShipDate);
      if(row.ihd) obj.ihdDates.push(row.ihd);
      if(row.createdDate) obj.createdDates.push(row.createdDate);
      if(row.salesOrderCreatedDate) obj.salesOrderCreatedDates.push(row.salesOrderCreatedDate);
      const poKey = row.purchaseOrderId || row.purchaseOrderName || `${obj.key}-${obj.poMap.size+1}`;
      if(!obj.poMap.has(poKey)){
        obj.poMap.set(poKey, {
          purchaseOrderName: row.purchaseOrderName,
          purchaseOrderId: row.purchaseOrderId,
          poOwner: row.poOwner,
          supplier: row.supplier,
          printerName: row.printerName,
          estimatedShipDate: row.estimatedShipDate,
          createdDate: row.createdDate,
          ihd: row.ihd,
          itemTotalCost: row.itemTotalCost,
          lineItemPrice: row.lineItemPrice,
          accountProductName: row.accountProductName,
          accountProductExternalId: row.accountProductExternalId,
          quantity: row.quantity
        });
      } else {
        const po = obj.poMap.get(poKey);
        po.itemTotalCost += row.itemTotalCost || 0;
        po.lineItemPrice += row.lineItemPrice || 0;
        po.quantity += row.quantity || 0;
        po.accountProductName = po.accountProductName || row.accountProductName;
        po.accountProductExternalId = po.accountProductExternalId || row.accountProductExternalId;
        po.printerName = po.printerName || row.printerName;
        po.createdDate = po.createdDate || row.createdDate;
        po.ihd = po.ihd || row.ihd;
      }
      const apKey = row.accountProductExternalId || row.accountProductName;
      if(apKey){
        if(!obj.accountProductMap.has(apKey)){
          obj.accountProductMap.set(apKey, {
            accountProductName: row.accountProductName,
            accountProductExternalId: row.accountProductExternalId,
            suppliers: new Set(row.supplier ? [row.supplier] : []),
            printers: new Set(row.printerName ? [row.printerName] : []),
            poKeys: new Set(poKey ? [poKey] : []),
            quantity: row.quantity || 0,
            itemTotalCost: row.itemTotalCost || 0
          });
        } else {
          const ap = obj.accountProductMap.get(apKey);
          if(row.supplier) ap.suppliers.add(row.supplier);
          if(row.printerName) ap.printers.add(row.printerName);
          if(poKey) ap.poKeys.add(poKey);
          ap.quantity += row.quantity || 0;
          ap.itemTotalCost += row.itemTotalCost || 0;
        }
      }
    });

    getLiveOperationalRows().forEach(row=>{
      const obj = ensure(row); if(!obj) return;
      obj.liveRows.push(row);
      obj.account = obj.account || row.account;
      obj.accountOwner = obj.accountOwner || row.accountOwner;
      obj.status = obj.status || row.status;
      obj.ihdDates.push(row.ihd);
      const pbKey = row.pbId || `${row.pb}|${row.source}|${row.date||row.scheduledFor}`;
      if(!obj.packBuilderMap.has(pbKey)){
        obj.packBuilderMap.set(pbKey, {
          pb: row.pb, pbId: row.pbId, source: row.source, qty: row.qty, products: row.products,
          units: row.units, status: row.status, ihd: row.ihd, stage: row.stage || row.workType, link: row.pdfUrl || (typeof buildSalesforcePbLink === 'function' ? buildSalesforcePbLink(row.pbId, row.pdfUrl) : ''),
          account: row.account, accountOwner: row.accountOwner, scheduledFor: row.scheduledFor || row.date
        });
      } else {
        const pb = obj.packBuilderMap.get(pbKey);
        pb.stage = pb.stage || row.stage || row.workType;
        pb.status = pb.status || row.status;
        pb.scheduledFor = pb.scheduledFor || row.scheduledFor || row.date;
      }
    });

    const out = [...map.values()].map(order=>finalizeOrder(order));
    out.sort((a,b)=> (b.subtotal - a.subtotal) || a.sord.localeCompare(b.sord));
    state.dataset = out;
    if(!state.selectedKey && out[0]) state.selectedKey = out[0].key;
    if(state.selectedKey && !out.find(x=>x.key===state.selectedKey)) state.selectedKey = out[0]?.key || '';
  }

function finalizeOrder(order){
    const packBuilders = [...order.packBuilderMap.values()];
    const poRows = [...order.poMap.values()];
    const accountProducts = [...order.accountProductMap.values()].map(item=>({
      ...item,
      supplierCount: item.suppliers.size,
      printerCount: item.printers.size,
      poCount: item.poKeys.size
    }));
    const totalQty = packBuilders.reduce((sum,r)=>sum + num(r.qty),0) || order.eomRows.reduce((sum,r)=>sum+num(r.quantity),0);
    const totalUniqueProducts = packBuilders.reduce((sum,r)=>sum + num(r.products),0);
    const supplierCount = order.suppliers.size;
    const poCount = poRows.length;
    const pbCount = packBuilders.length;
    const totalItemCost = poRows.reduce((sum,r)=>sum + num(r.itemTotalCost),0);
    const revenue = order.subtotal || order.originalSubtotal || 0;
    const originalRevenue = order.originalSubtotal || order.subtotal || 0;
    const grossSpread = revenue - totalItemCost;
    const marginPct = revenue > 0 ? (grossSpread / revenue) * 100 : 0;
    const earliestEta = minDate(order.estimatedDates);
    const latestEta = maxDate(order.estimatedDates);
    const earliestIhd = minDate(order.ihdDates);
    const latestIhd = maxDate(order.ihdDates);
    const dueDate = minDate(order.dueDates);
    const createdDate = minDate(order.createdDates);
    const salesOrderCreatedDate = minDate(order.salesOrderCreatedDates) || createdDate;
    const notes = [...order.notesSet];
    const relatedSords = [...order.relatedSords];
    const poOwners = [...order.poOwners].sort();
    const printerNames = [...order.printerNames].sort();
    const productionTypes = [...order.productionTypes].sort();
    const readiness = deriveReadiness(order, { poCount, supplierCount, pbCount, revenue });
    const flags = deriveFlags(order, { poCount, supplierCount, pbCount, revenue, originalRevenue, earliestEta, totalQty, totalItemCost, packBuilders, poRows, dueDate, relatedSords, totalPackItems: order.totalPackItems, totalBulkProducts: order.totalBulkProducts });
    const finalComplexity = deriveComplexity({ poCount, supplierCount, pbCount, totalQty, totalUniqueProducts, flagsHint: flags.length });
    return {
      key: order.key,
      sord: order.sord || order.salesOrderId || '(Unlabeled Order)',
      salesOrderId: order.salesOrderId,
      account: order.account,
      accountOwner: order.accountOwner,
      orderOwner: order.orderOwner,
      createdBy: order.createdBy,
      poOwners,
      printerNames,
      productionTypes,
      status: order.status,
      poStatus: order.poStatus,
      invoiceName: order.invoiceName,
      subtotal: revenue,
      originalSubtotal: originalRevenue,
      invoiceTotal: order.invoiceTotal || 0,
      revenueDelta: revenue - originalRevenue,
      totalItemCost,
      grossSpread,
      marginPct,
      totalQty,
      totalUniqueProducts,
      totalPackItems: order.totalPackItems || 0,
      totalBulkProducts: order.totalBulkProducts || 0,
      pbCount,
      poCount,
      supplierCount,
      earliestEta,
      latestEta,
      earliestIhd,
      latestIhd,
      dueDate,
      createdDate,
      salesOrderCreatedDate,
      notes,
      relatedSords,
      readiness,
      complexity: finalComplexity,
      flags,
      flagCount: flags.length,
      packBuilders,
      poRows,
      accountProducts,
      timeline: buildTimeline(order, earliestEta, latestEta, earliestIhd, latestIhd, dueDate, salesOrderCreatedDate),
      ownerMapping: getOwnerMapping(order.accountOwner || order.orderOwner || order.createdBy),
      raw: order
    };
  }

  function deriveReadiness(order, metrics){
    const text = `${order.status} ${order.poStatus}`.toLowerCase();
    if(/pending|case|block|hold|missing|exception/.test(text)) return 'Blocked';
    if(!metrics.pbCount || !metrics.poCount || !metrics.revenue) return 'Needs Review';
    if(metrics.supplierCount > 1 || metrics.poCount > 1) return 'Partially Ready';
    if(/complete|ready|fully received/.test(text) || (!text.trim() && metrics.pbCount && metrics.revenue)) return 'Ready';
    return 'Partially Ready';
  }

  function deriveComplexity({ poCount, supplierCount, pbCount, totalQty, totalUniqueProducts, flagsHint }){
    let score = 0;
    if(pbCount > 1) score += 2;
    if(poCount > 2) score += 2; else if(poCount > 1) score += 1;
    if(supplierCount > 2) score += 2; else if(supplierCount > 1) score += 1;
    if(totalQty >= 5000) score += 2; else if(totalQty >= 1000) score += 1;
    if(totalUniqueProducts >= 40) score += 2; else if(totalUniqueProducts >= 15) score += 1;
    if(flagsHint >= 4) score += 2; else if(flagsHint >= 2) score += 1;
    if(score >= 7) return 'High';
    if(score >= 3) return 'Medium';
    return 'Low';
  }

  function deriveFlags(order, metrics){
    const flags=[];
    if(metrics.pbCount && !metrics.revenue) flags.push('Pack builder exists but revenue record is missing');
    if(metrics.revenue && !metrics.pbCount) flags.push('Revenue exists but no pack builder was found');
    if(metrics.pbCount > 1) flags.push('Multiple pack builders tied to one SORD');
    if(metrics.supplierCount > 1) flags.push('Multiple suppliers tied to this order');
    if(metrics.poCount > 1) flags.push('Multiple purchase orders tied to this order');
    if(order.originalSubtotal && order.subtotal && Math.abs(order.subtotal - order.originalSubtotal) > 0.009) flags.push('Subtotal differs from original subtotal');
    if((metrics.packBuilders || []).some(pb=>!safeText(pb.link))) flags.push('At least one pack builder is missing a PDF / direct link');
    if(!safeText(order.accountOwner) && !order.poOwners?.size) flags.push('Owner fields are missing or incomplete');
    if(metrics.earliestEta){
      const eta = new Date(metrics.earliestEta + 'T00:00:00');
      const today = new Date(); today.setHours(0,0,0,0);
      if(!Number.isNaN(eta.getTime()) && eta < today) flags.push('Estimated ship date has passed');
      if(safeText(metrics.dueDate)){
        const due = new Date(metrics.dueDate + 'T00:00:00');
        if(!Number.isNaN(due.getTime()) && !Number.isNaN(eta.getTime()) && eta > due) flags.push('Estimated ship date is later than due date');
      }
    }
    const text = `${order.status} ${order.poStatus}`.toLowerCase();
    if(/pending|case|exception|replacements|partial/.test(text)) flags.push('Status indicates pending / exception / partial-order risk');
    if(metrics.totalQty >= 10000) flags.push('Very high quantity order');
    if(metrics.totalItemCost >= 25000) flags.push('High material cost order');
    if((metrics.totalPackItems || 0) > 0 && (metrics.totalBulkProducts || 0) > 0) flags.push('Order mixes pack items and bulk products');
    if((metrics.relatedSords || []).length) flags.push('Notes reference an earlier or related SORD');
    const unmatchedEom = order.eomRows.some(row => !safeText(row.purchaseOrderId) && !safeText(row.purchaseOrderName));
    if(unmatchedEom) flags.push('Some EOM rows are missing PO identifiers');
    return unique(flags);
  }

  function buildTimeline(order, earliestEta, latestEta, earliestIhd, latestIhd, dueDate, salesOrderCreatedDate){
    const rows=[];
    if(salesOrderCreatedDate) rows.push({label:'Sales order created', value: salesOrderCreatedDate});
    const earliestCreated = minDate(order.createdDates);
    if(earliestCreated && earliestCreated !== salesOrderCreatedDate) rows.push({label:'PO / line created', value: earliestCreated});
    if(dueDate) rows.push({label:'Due date', value: dueDate});
    if(earliestEta) rows.push({label:'Earliest ETA', value: earliestEta});
    if(latestEta && latestEta !== earliestEta) rows.push({label:'Latest ETA', value: latestEta});
    if(earliestIhd) rows.push({label:'Earliest IHD', value: earliestIhd});
    if(latestIhd && latestIhd !== earliestIhd) rows.push({label:'Latest IHD', value: latestIhd});
    const scheduledDates = unique(order.liveRows.map(r=>r.scheduledFor || r.date).filter(Boolean)).sort();
    if(scheduledDates[0]) rows.push({label:'Scheduled in app', value: scheduledDates[0]});
    const assemblyDates = unique(order.liveRows.filter(r=>r.source==='Assembly Board').map(r=>r.date).filter(Boolean)).sort();
    if(assemblyDates[0]) rows.push({label:'Seen on assembly board', value: assemblyDates[0]});
    return rows;
  }

  function getFilteredDataset(){
    const q = norm(els.searchInput.value);
    const statusFilter = safeText(els.statusFilter.value);
    const readinessFilter = safeText(els.readinessFilter.value);
    const complexityFilter = safeText(els.complexityFilter.value);
    const riskFilter = safeText(els.riskFilter.value);
    return state.dataset.filter(item=>{
      if(q){
        const hay = [item.sord, item.salesOrderId, item.account, item.accountOwner, item.orderOwner, item.createdBy, item.status, item.poStatus, ...(item.notes||[]), ...(item.relatedSords||[]), ...item.packBuilders.map(pb=>pb.pb), ...item.poRows.flatMap(po=>[po.supplier, po.poOwner, po.purchaseOrderName]), ...item.accountProducts.map(ap=>ap.accountProductName)].join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      if(statusFilter && safeText(item.status) !== statusFilter && safeText(item.poStatus) !== statusFilter) return false;
      if(readinessFilter && item.readiness !== readinessFilter) return false;
      if(complexityFilter && item.complexity !== complexityFilter) return false;
      if(riskFilter === 'none' && item.flagCount) return false;
      if(riskFilter === 'flagged' && !item.flagCount) return false;
      return true;
    });
  }

  function renderTopStats(list){
    const totalRevenue = list.reduce((sum,r)=>sum + num(r.subtotal),0);
    const totalFlags = list.reduce((sum,r)=>sum + num(r.flagCount),0);
    const blocked = list.filter(r=>r.readiness==='Blocked').length;
    const highComplexity = list.filter(r=>r.complexity==='High').length;
    els.topStats.innerHTML = [
      statCard('SORDs', fmtInt(list.length), 'Orders visible in explorer'),
      statCard('Revenue', fmtMoney(totalRevenue), 'Subtotal from imported revenue / EOM data'),
      statCard('Blocked', fmtInt(blocked), 'Orders with blocked readiness'),
      statCard('High Complexity', fmtInt(highComplexity), 'Orders with higher operational complexity'),
      statCard('Risk Flags', fmtInt(totalFlags), 'Total active flags across visible SORDs')
    ].join('');
  }

  function statCard(label, value, hint){
    return `<div class="card"><div class="stat-label">${escape(label)}</div><div class="stat-value">${escape(value)}</div><div class="stat-hint">${escape(hint)}</div></div>`;
  }

  function renderExplorer(){
    const list = getFilteredDataset();
    renderTopStats(list);
    els.explorerCount.textContent = `${list.length} result${list.length===1?'':'s'}`;
    if(!list.length){
      els.explorerBody.innerHTML = '<tr><td colspan="9" class="empty">No SORDs match the current filters.</td></tr>';
      renderDossier(null);
      return;
    }
    const visible = list.slice(0, SEARCH_LIMIT_DEFAULT);
    els.explorerBody.innerHTML = visible.map(item=>{
      const selected = item.key === state.selectedKey ? ' class="sord-selected-row"' : '';
      const orderUrl = salesOrderUrl(item.salesOrderId);
      const sordLabel = orderUrl
        ? `<a class="queue-link" href="${escape(orderUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${escape(item.sord)}</a>`
        : `<strong>${escape(item.sord)}</strong>`;
      const ownerLabel = item.ownerMapping?.accountManager || item.accountOwner || item.orderOwner || '—';
      const ownerHint = item.ownerMapping?.projectManager ? `PM: ${item.ownerMapping.projectManager}` : (item.salesOrderId || '—');
      return `<tr${selected} onclick="window.selectSordRecord('${escJs(item.key)}')">`+
        `<td>${sordLabel}<div class="sord-subline">${escape(item.account || '—')}</div></td>`+
        `<td>${escape(ownerLabel)}<div class="sord-subline">${escape(ownerHint)}</div></td>`+
        `<td>${escape(item.status || item.poStatus || '—')}</td>`+
        `<td>${escape(fmtMoney(item.subtotal || item.originalSubtotal))}</td>`+
        `<td>${escape(fmtInt(item.pbCount))}</td>`+
        `<td>${escape(fmtInt(item.supplierCount))}</td>`+
        `<td>${renderBadge(item.readiness, badgeToneForReadiness(item.readiness))}</td>`+
        `<td>${renderBadge(item.complexity, badgeToneForComplexity(item.complexity))}</td>`+
        `<td>${item.flagCount ? `<span class="sord-flag-count">${item.flagCount}</span>` : '—'}</td>`+
      `</tr>`;
    }).join('');
    if(!state.selectedKey || !visible.find(v=>v.key===state.selectedKey)) state.selectedKey = visible[0].key;
    renderDossier(state.dataset.find(x=>x.key===state.selectedKey) || null);
  }

  function renderBadge(text, tone){
    return `<span class="sord-badge sord-badge-${escape(tone)}">${escape(text)}</span>`;
  }
  function badgeToneForReadiness(v){
    return v==='Ready' ? 'good' : v==='Blocked' ? 'bad' : v==='Needs Review' ? 'warn' : 'neutral';
  }
  function badgeToneForComplexity(v){
    return v==='High' ? 'bad' : v==='Medium' ? 'warn' : 'good';
  }

  function renderSummaryField(label, value, hint=''){
    return `<div class="sord-summary-card"><div class="sord-summary-label">${escape(label)}</div><div class="sord-summary-value">${escape(value || '—')}</div>${hint?`<div class="sord-summary-hint">${escape(hint)}</div>`:''}</div>`;
  }

  function renderDossier(item){
    if(!item){
      els.dossierTitle.textContent = 'Select a SORD';
      els.dossierBadges.innerHTML = '';
      els.summaryGrid.innerHTML = '<div class="empty-state">Import your reports and choose a SORD from the explorer.</div>';
      els.flagsWrap.innerHTML = '<div class="empty-state">No SORD selected.</div>';
      els.packBuilderBody.innerHTML = '<tr><td colspan="10" class="empty">No SORD selected.</td></tr>';
      els.revenuePanel.innerHTML = '<div class="empty-state">No SORD selected.</div>';
      els.timelinePanel.innerHTML = '<div class="empty-state">No SORD selected.</div>';
      els.poBody.innerHTML = '<tr><td colspan="8" class="empty">No SORD selected.</td></tr>';
      els.accountProductBody.innerHTML = '<tr><td colspan="6" class="empty">No SORD selected.</td></tr>';
      return;
    }
    const orderUrl = salesOrderUrl(item.salesOrderId);
    els.dossierTitle.innerHTML = orderUrl
      ? `<a class="queue-link" href="${escape(orderUrl)}" target="_blank" rel="noopener noreferrer">${escape(item.sord)}</a>`
      : escape(item.sord);
    els.dossierBadges.innerHTML = [
      renderBadge(item.readiness, badgeToneForReadiness(item.readiness)),
      renderBadge(item.complexity, badgeToneForComplexity(item.complexity)),
      item.flagCount ? renderBadge(`${item.flagCount} flags`, 'bad') : renderBadge('No active flags','good')
    ].join('');

    const notePreview = item.notes[0] ? (item.notes[0].length > 96 ? item.notes[0].slice(0,96) + '…' : item.notes[0]) : '';
    const ownerMap = item.ownerMapping;
    const ownerCoverage = ownerMap
      ? `${ownerMap.projectManager || '—'} • ${ownerMap.psa || '—'}`
      : (item.accountOwner || item.orderOwner || 'Unmapped owner');
    els.summaryGrid.innerHTML = [
      renderSummaryField('SORD', item.sord, item.salesOrderId || ''),
      renderSummaryField('Account', item.account || '—', ownerMap?.accountManager || item.accountOwner || item.orderOwner || '—'),
      renderSummaryField('Status', item.status || '—', item.poStatus || '—'),
      renderSummaryField('In-Hands Date', fmtDate(item.earliestIhd || item.dueDate || item.earliestEta), `Due: ${fmtDate(item.dueDate)} • ETA: ${fmtDate(item.earliestEta)}`),
      renderSummaryField('Subtotal', fmtMoney(item.subtotal || item.originalSubtotal), item.originalSubtotal ? `Original: ${fmtMoney(item.originalSubtotal)}` : ''),
      renderSummaryField('Pack Builders', fmtInt(item.pbCount), `Suppliers: ${fmtInt(item.supplierCount)} • POs: ${fmtInt(item.poCount)}`),
      renderSummaryField('Production Mix', `${fmtInt(item.totalPackItems)} pack • ${fmtInt(item.totalBulkProducts)} bulk`, item.productionTypes.length ? item.productionTypes.join(' • ') : ''),
      renderSummaryField('Owner Coverage', ownerMap?.accountManager || item.accountOwner || '—', ownerCoverage),
      renderSummaryField('Feasibility Snapshot', item.readiness, `${item.flagCount} flags • Margin est.: ${item.subtotal ? item.marginPct.toFixed(1)+'%' : '—'}`),
      renderSummaryField('Created / Owned By', item.createdBy || item.orderOwner || '—', item.orderOwner && item.createdBy && item.orderOwner !== item.createdBy ? `Owner: ${item.orderOwner}` : ''),
      renderSummaryField('PO Owners', item.poOwners.length ? item.poOwners.slice(0,2).join(', ') : '—', item.poOwners.length > 2 ? `+${item.poOwners.length - 2} more` : ''),
      renderSummaryField('Notes / Linked SORDs', item.relatedSords[0] || '—', notePreview || '')
    ].join('');

    const noteCards = item.notes.map(note=>`<div class="sord-flag-card">📝 ${escape(note)}</div>`);
    const linkedCards = item.relatedSords.map(s=>`<div class="sord-flag-card">🔁 Related SORD: ${internalSordLink(s)}</div>`);
    const ownerCards = ownerMap ? [
      `<div class="sord-flag-card sord-flag-card-good">👤 Account Manager: ${roleLink(ownerMap.accountManager, ownerMap.accountManagerLink)}</div>`,
      `<div class="sord-flag-card sord-flag-card-good">🧭 Project Manager: ${roleLink(ownerMap.projectManager, ownerMap.projectManagerLink)}</div>`,
      `<div class="sord-flag-card sord-flag-card-good">💬 PSA: ${roleLink(ownerMap.psa, ownerMap.psaLink)}</div>`
    ] : [`<div class="sord-flag-card">👤 Unmapped owner: ${escape(item.accountOwner || item.orderOwner || item.createdBy || '—')}</div>`];
    els.flagsWrap.innerHTML = (item.flags.length || noteCards.length || linkedCards.length)
      ? [
          ...ownerCards,
          ...item.flags.map(flag=>`<div class="sord-flag-card">⚠ ${escape(flag)}</div>`),
          ...linkedCards,
          ...noteCards
        ].join('')
      : '<div class="sord-flag-card sord-flag-card-good">No active risk flags or notes for this SORD.</div>';

    els.packBuilderBody.innerHTML = item.packBuilders.length
      ? item.packBuilders.map(pb=>`<tr><td>${escape(pb.pb || '—')}</td><td>${escape(pb.pbId || '—')}</td><td>${escape(pb.source || '—')}</td><td>${escape(fmtInt(pb.qty))}</td><td>${escape(fmtInt(pb.products))}</td><td>${escape(fmtInt(pb.units))}</td><td>${escape(pb.status || '—')}</td><td>${escape(fmtDate(pb.ihd))}</td><td>${escape(pb.stage || pb.scheduledFor || '—')}</td><td>${pb.link ? `<a class="queue-link" href="${escape(pb.link)}" target="_blank" rel="noopener noreferrer">Open</a>` : '—'}</td></tr>`).join('')
      : '<tr><td colspan="10" class="empty">No pack builder detail found for this SORD.</td></tr>';

    els.revenuePanel.innerHTML = [
      renderSummaryField('Revenue', fmtMoney(item.subtotal || item.originalSubtotal)),
      renderSummaryField('Original Revenue', fmtMoney(item.originalSubtotal || item.subtotal)),
      renderSummaryField('Revenue Delta', fmtMoney(item.revenueDelta)),
      renderSummaryField('Estimated Item Cost', fmtMoney(item.totalItemCost)),
      renderSummaryField('Gross Spread', fmtMoney(item.grossSpread)),
      renderSummaryField('Margin Estimate', item.subtotal ? `${item.marginPct.toFixed(1)}%` : '—'),
      renderSummaryField('Pack Items', fmtInt(item.totalPackItems)),
      renderSummaryField('Bulk Products', fmtInt(item.totalBulkProducts))
    ].join('');

    els.timelinePanel.innerHTML = item.timeline.length
      ? item.timeline.map(row=>`<div class="sord-timeline-row"><div class="sord-timeline-dot"></div><div><div class="sord-timeline-label">${escape(row.label)}</div><div class="sord-timeline-value">${escape(fmtDate(row.value))}</div></div></div>`).join('')
      : '<div class="empty-state">No timeline dates were available from the imported data.</div>';

    els.poBody.innerHTML = item.poRows.length
      ? item.poRows.map(po=>{
          const poUrl = purchaseOrderUrl(po.purchaseOrderId);
          const poName = escape(po.purchaseOrderName || '—');
          const poId = escape(po.purchaseOrderId || '—');
          return `<tr><td>${poUrl ? `<a class="queue-link" href="${escape(poUrl)}" target="_blank" rel="noopener noreferrer">${poName}</a>` : poName}</td><td>${poUrl ? `<a class="queue-link" href="${escape(poUrl)}" target="_blank" rel="noopener noreferrer">${poId}</a>` : poId}</td><td>${escape(po.poOwner || '—')}</td><td>${escape(po.supplier || '—')}${po.printerName ? `<div class="sord-subline">Printer: ${escape(po.printerName)}</div>` : ''}</td><td>${escape(fmtDate(po.estimatedShipDate || po.ihd))}${po.createdDate ? `<div class="sord-subline">Created: ${escape(fmtDate(po.createdDate))}</div>` : ''}</td><td>${escape(fmtMoney(po.itemTotalCost))}</td><td>${escape(fmtMoney(po.lineItemPrice))}</td><td>${escape(po.accountProductName || '—')}</td></tr>`;
        }).join('')
      : '<tr><td colspan="8" class="empty">No PO detail found for this SORD.</td></tr>';

    els.accountProductBody.innerHTML = item.accountProducts.length
      ? item.accountProducts.map(ap=>`<tr><td>${escape(ap.accountProductName || '—')}${ap.printers?.size ? `<div class="sord-subline">${escape([...ap.printers].slice(0,2).join(', '))}${ap.printers.size>2 ? ' +' + (ap.printers.size-2) + ' more' : ''}</div>` : ''}</td><td>${escape(ap.accountProductExternalId || '—')}</td><td>${escape(fmtInt(ap.poCount))}</td><td>${escape(fmtInt(ap.supplierCount))}</td><td>${escape(fmtInt(ap.quantity))}</td><td>${escape(fmtMoney(ap.itemTotalCost))}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">No account-product detail found for this SORD.</td></tr>';
  }

  function fillStatusFilter(){
    const values = unique(state.dataset.flatMap(item=>[item.status, item.poStatus]).filter(Boolean)).sort((a,b)=>a.localeCompare(b));
    const current = els.statusFilter.value;
    els.statusFilter.innerHTML = '<option value="">All</option>' + values.map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('');
    if(values.includes(current)) els.statusFilter.value = current;
  }

  async function importFiles(){
    try{
      if(typeof XLSX === 'undefined') throw new Error('XLSX library is not available.');
      const queueFile = els.queueInput.files?.[0] || null;
      const revenueFile = els.revenueInput.files?.[0] || null;
      const eomFile = els.eomInput.files?.[0] || null;
      if(!queueFile && !revenueFile && !eomFile){
        setStatus('Choose at least one report to import.', true);
        return;
      }
      setStatus('Reading report files...');
      if(queueFile){
        state.imports.queueRows = parseQueueImportRows(await parseWorkbookOrCsv(queueFile));
        state.imports.fileNames.queue = queueFile.name;
      }
      if(revenueFile){
        state.imports.revenueRows = parseRevenueImportRows(await parseWorkbookOrCsv(revenueFile));
        state.imports.fileNames.revenue = revenueFile.name;
      }
      if(eomFile){
        state.imports.eomRows = parseEomImportRows(await parseWorkbookOrCsv(eomFile));
        state.imports.fileNames.eom = eomFile.name;
      }
      state.imports.importedAt = new Date().toISOString();
      saveState();
      rebuildAndRender();
      setStatus(`SORD data imported. Queue rows: ${fmtInt(state.imports.queueRows.length)} • Revenue rows: ${fmtInt(state.imports.revenueRows.length)} • EOM rows: ${fmtInt(state.imports.eomRows.length)}${summarizeFileNames() ? ' • ' + summarizeFileNames() : ''}`);
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Import failed.', true);
      alert(error.message || 'Import failed.');
    }
  }

  function clearImports(){
    state.imports = { queueRows: [], revenueRows: [], eomRows: [], importedAt: '', fileNames: { queue:'', revenue:'', eom:'' } };
    saveState();
    rebuildAndRender();
    els.queueInput.value=''; els.revenueInput.value=''; els.eomInput.value='';
    setStatus('Imported SORD report data cleared. Live queue / assembly data is still visible when it can be matched.');
  }

  function setStatus(text, isError=false){
    els.importStatus.textContent = text;
    els.importStatus.classList.toggle('error', !!isError);
  }

  function rebuildAndRender(){
    buildDataset();
    fillStatusFilter();
    renderExplorer();
  }

  function bind(){
    els.importBtn.addEventListener('click', importFiles);
    els.clearBtn.addEventListener('click', clearImports);
    els.refreshBtn.addEventListener('click', ()=>{ rebuildAndRender(); setStatus(`Refreshed SORD explorer from imported reports and live app data${summarizeFileNames() ? ' • ' + summarizeFileNames() : ''}.`); });
    [els.searchInput, els.statusFilter, els.readinessFilter, els.complexityFilter, els.riskFilter].forEach(el=>el.addEventListener('input', renderExplorer));
    els.resetFiltersBtn.addEventListener('click', ()=>{
      els.searchInput.value='';
      els.statusFilter.value='';
      els.readinessFilter.value='';
      els.complexityFilter.value='';
      els.riskFilter.value='';
      renderExplorer();
    });
    if(els.addOwnerRowBtn){
      els.addOwnerRowBtn.addEventListener('click', ()=>{ syncOwnerMapFromUi(); state.ownerMap.rows.push(emptyOwnerRow()); renderOwnerMapTable(); });
      els.saveOwnerMapBtn.addEventListener('click', ()=>{ syncOwnerMapFromUi(); saveOwnerMap(); renderOwnerMapTable(); rebuildAndRender(); setStatus('Owner mapping saved.'); });
      [els.ownerUtilityLabel, els.ownerUtilityUrl].forEach(el=> el && el.addEventListener('input', ()=>{ syncOwnerMapFromUi(); renderOwnerMapTable(); }));
      window.deleteOwnerMapRow = (idx)=>{ syncOwnerMapFromUi(); state.ownerMap.rows.splice(idx,1); renderOwnerMapTable(); };
    }
    els.poBody?.addEventListener('click', (event)=>{
      const btn = event.target.closest('[data-po-image]');
      if(!btn) return;
      event.preventDefault();
      openImagePreview(btn.getAttribute('data-po-title') || 'PO Image', btn.getAttribute('data-po-image') || '');
    });
    document.getElementById('sordImageCloseBtn')?.addEventListener('click', closeImagePreview);
    document.getElementById('sordImageOverlay')?.addEventListener('click', (event)=>{
      if(event.target && event.target.id === 'sordImageOverlay') closeImagePreview();
    });
    window.selectSordRecord = (key)=>{ state.selectedKey = key; renderExplorer(); };
  }

  normalizeOwnerMap();
  bind();
  renderOwnerMapTable();
  rebuildAndRender();
  if(state.imports.importedAt){
    setStatus(`Loaded saved SORD imports from ${fmtDate(state.imports.importedAt)}${summarizeFileNames() ? ' • ' + summarizeFileNames() : ''}.`);
  } else {
    setStatus('No SORD imports loaded yet. You can still see live queue / assembly matches after importing at least one report.');
  }
})();



  function parseSalesforceImageUrl(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';

    // Full URL already present
    const directUrlMatch = raw.match(/https?:\/\/[^\s"'<>]+/i);
    if (directUrlMatch) {
      return directUrlMatch[0];
    }

    // HTML img tag snippet
    const imgSrcMatch = raw.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgSrcMatch && imgSrcMatch[1]) {
      let src = imgSrcMatch[1].trim();
      if (/^https?:\/\//i.test(src)) return src;
      if (src.startsWith('/')) return `https://swagup.file.force.com${src}`;
      return `https://swagup.file.force.com/${src.replace(/^\/+/, '')}`;
    }

    // Relative servlet path copied without the img tag
    if (/^\/?servlet\/servlet\.FileDownload\?file=/i.test(raw)) {
      const normalized = raw.startsWith('/') ? raw : `/${raw}`;
      return `https://swagup.file.force.com${normalized}`;
    }

    // Bare Salesforce file id fallback
    const fileIdMatch = raw.match(/\b00P[A-Za-z0-9]{12,15}\b/);
    if (fileIdMatch) {
      return `https://swagup.file.force.com/servlet/servlet.FileDownload?file=${fileIdMatch[0]}`;
    }

    return '';
  }
