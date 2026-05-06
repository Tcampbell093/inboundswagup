(function(){
  const STORAGE_KEY='ops_hub_sord_imports_v1';
  const OWNER_MAP_KEY='ops_hub_sord_owner_map_v1';
  const LARGE_IMPORT_DB='ops_hub_large_imports_db';
  const LARGE_IMPORT_STORE='imports';
  const LARGE_IMPORT_RECORD_KEY='sord_imports_v1';
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
    sortSelect: document.getElementById('sordSortSelect'),
    statusFilter: document.getElementById('sordStatusFilter'),
    readinessFilter: document.getElementById('sordReadinessFilter'),
    complexityFilter: document.getElementById('sordComplexityFilter'),
    riskFilter: document.getElementById('sordRiskFilter'),
    confirmedFilter: document.getElementById('sordConfirmedFilter'),
    resetFiltersBtn: document.getElementById('sordResetFiltersBtn'),
    explorerCount: document.getElementById('sordExplorerCount'),
    accordionList: document.getElementById('sordAccordionList'),
    typeCntAll:  document.getElementById('sordTypeCntAll'),
    typeCntPb:   document.getElementById('sordTypeCntPb'),
    typeCntBulk: document.getElementById('sordTypeCntBulk'),
    typeCntMix:  document.getElementById('sordTypeCntMix'),
    ownerMapBody: document.getElementById('sordOwnerMapBody'),
    ownerUtilityLabel: document.getElementById('sordOwnerUtilityLabel'),
    ownerUtilityUrl: document.getElementById('sordOwnerUtilityUrl'),
    ownerUtilityLink: document.getElementById('sordOwnerUtilityLink'),
    addOwnerRowBtn: document.getElementById('sordAddOwnerRowBtn'),
    saveOwnerMapBtn: document.getElementById('sordSaveOwnerMapBtn'),
    priorityPanel: document.getElementById('priorityBuilderPanel'),
    pbSelectedChips: document.getElementById('pbSelectedChips'),
    pbGenerateBtn: document.getElementById('pbGenerateBtn'),
    pbClearSelBtn: document.getElementById('pbClearSelBtn'),
    pbCopyBtn: document.getElementById('pbCopyBtn'),
    pbPostWrap: document.getElementById('pbPostWrap'),
    pbPostContent: document.getElementById('pbPostContent')
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

  function emptyImports(){
    return {
      queueRows: [],
      revenueRows: [],
      eomRows: [],
      importedAt: '',
      fileNames: { queue: '', revenue: '', eom: '' },
      counts: { queue: 0, revenue: 0, eom: 0 }
    };
  }

  function buildImportMeta(imports){
    const base = emptyImports();
    const fileNames = imports?.fileNames || {};
    return {
      importedAt: safeText(imports?.importedAt),
      fileNames: {
        queue: safeText(fileNames.queue),
        revenue: safeText(fileNames.revenue),
        eom: safeText(fileNames.eom)
      },
      counts: {
        queue: Array.isArray(imports?.queueRows) ? imports.queueRows.length : Number(imports?.counts?.queue || 0),
        revenue: Array.isArray(imports?.revenueRows) ? imports.revenueRows.length : Number(imports?.counts?.revenue || 0),
        eom: Array.isArray(imports?.eomRows) ? imports.eomRows.length : Number(imports?.counts?.eom || 0)
      },
      queueRows: [],
      revenueRows: [],
      eomRows: []
    };
  }

  function openLargeImportDb(){
    return new Promise((resolve, reject) => {
      if(typeof indexedDB === 'undefined'){
        reject(new Error('IndexedDB is not available.'));
        return;
      }
      const request = indexedDB.open(LARGE_IMPORT_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if(!db.objectStoreNames.contains(LARGE_IMPORT_STORE)){
          db.createObjectStore(LARGE_IMPORT_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed.'));
    });
  }

  async function readLargeImportRecord(){
    try{
      const db = await openLargeImportDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(LARGE_IMPORT_STORE, 'readonly');
        const store = tx.objectStore(LARGE_IMPORT_STORE);
        const request = store.get(LARGE_IMPORT_RECORD_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error('IndexedDB read failed.'));
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
        tx.onerror = () => db.close();
      });
    }catch(error){
      console.warn('Could not read large SORD import cache.', error);
      return null;
    }
  }

  async function writeLargeImportRecord(value){
    const db = await openLargeImportDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LARGE_IMPORT_STORE, 'readwrite');
      const store = tx.objectStore(LARGE_IMPORT_STORE);
      store.put(value, LARGE_IMPORT_RECORD_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB write aborted.')); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB write failed.')); };
    });
  }

  async function deleteLargeImportRecord(){
    try{
      const db = await openLargeImportDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(LARGE_IMPORT_STORE, 'readwrite');
        const store = tx.objectStore(LARGE_IMPORT_STORE);
        store.delete(LARGE_IMPORT_RECORD_KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB delete aborted.')); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB delete failed.')); };
      });
    }catch(error){
      console.warn('Could not clear large SORD import cache.', error);
    }
  }

  function normalizeImportedPayload(imports){
    const base = emptyImports();
    const incoming = imports || {};
    return {
      queueRows: Array.isArray(incoming.queueRows) ? incoming.queueRows : [],
      revenueRows: Array.isArray(incoming.revenueRows) ? incoming.revenueRows : [],
      eomRows: Array.isArray(incoming.eomRows) ? incoming.eomRows : [],
      importedAt: safeText(incoming.importedAt),
      fileNames: {
        queue: safeText(incoming.fileNames?.queue),
        revenue: safeText(incoming.fileNames?.revenue),
        eom: safeText(incoming.fileNames?.eom)
      },
      counts: {
        queue: Array.isArray(incoming.queueRows) ? incoming.queueRows.length : Number(incoming.counts?.queue || 0),
        revenue: Array.isArray(incoming.revenueRows) ? incoming.revenueRows.length : Number(incoming.counts?.revenue || 0),
        eom: Array.isArray(incoming.eomRows) ? incoming.eomRows.length : Number(incoming.counts?.eom || 0)
      }
    };
  }

  async function loadPersistedImports(){
    const meta = loadJson(STORAGE_KEY, null);
    if(meta && (Array.isArray(meta.queueRows) || Array.isArray(meta.revenueRows) || Array.isArray(meta.eomRows)) && ((meta.queueRows||[]).length || (meta.revenueRows||[]).length || (meta.eomRows||[]).length)){
      const migrated = normalizeImportedPayload(meta);
      await writeLargeImportRecord(migrated);
      saveJson(STORAGE_KEY, buildImportMeta(migrated));
      return migrated;
    }
    const large = await readLargeImportRecord();
    if(large){
      const normalized = normalizeImportedPayload(large);
      const metaCounts = meta?.counts || {};
      if(meta && (!normalized.importedAt || !normalized.fileNames.queue && !normalized.fileNames.revenue && !normalized.fileNames.eom)){
        normalized.importedAt = normalized.importedAt || safeText(meta.importedAt);
        normalized.fileNames = {
          queue: normalized.fileNames.queue || safeText(meta.fileNames?.queue),
          revenue: normalized.fileNames.revenue || safeText(meta.fileNames?.revenue),
          eom: normalized.fileNames.eom || safeText(meta.fileNames?.eom)
        };
      }
      normalized.counts = {
        queue: normalized.queueRows.length || Number(metaCounts.queue || 0),
        revenue: normalized.revenueRows.length || Number(metaCounts.revenue || 0),
        eom: normalized.eomRows.length || Number(metaCounts.eom || 0)
      };
      return normalized;
    }
    return normalizeImportedPayload(meta || emptyImports());
  }

  const PRIORITY_KEY = 'ops_hub_sord_priority_v1';

  const state = {
    poCategoryFilter: 'all',
    imports: emptyImports(),
    dataset: [],
    selectedKey: '',
    expandedKey: '',
    expandedTabMap: {},
    activeTypeFilter: 'all',
    ownerMap: loadJson(OWNER_MAP_KEY, DEFAULT_OWNER_MAP),
    prioritySords: new Set(JSON.parse(localStorage.getItem(PRIORITY_KEY) || '[]'))
  };

  function savePriority() {
    try { localStorage.setItem(PRIORITY_KEY, JSON.stringify([...state.prioritySords])); } catch {}
  }
window.__sordState = state;

  async function saveState(){
    state.imports = normalizeImportedPayload(state.imports);
    await writeLargeImportRecord(state.imports);
    saveJson(STORAGE_KEY, buildImportMeta(state.imports));
  }
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

      // The "Products Received" column is a JSON array with per-size breakdowns.
      // Each element has OriginalQuantity (ordered) and ProductsReceived (received).
      // This is the only reliable source of unit counts in the SORD Summary report.
      let jsonOrdered = 0;
      let jsonReceived = 0;
      const productsReceivedRaw = r.products_received || r.products_received_description || r.received_products || '';
      if (productsReceivedRaw) {
        try {
          const parsed = JSON.parse(String(productsReceivedRaw));
          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              jsonOrdered   += num(item.OriginalQuantity   || item.originalQuantity   || item.ordered_quantity  || 0);
              jsonReceived  += num(item.ProductsReceived   || item.productsReceived   || item.received_quantity || 0);
            });
          }
        } catch (_) { /* non-JSON value — ignore */ }
      }

      const quantity         = jsonOrdered  || num(r.quantity || r.original_quantity || r.ordered_quantity);
      const quantityReceived = jsonReceived || num(r.quantity_received || r.received_quantity || r.products_received_quantity || r.original_received_quantity);
      const itemTotalCost = num(r.item_total_cost || r.total_item_cost || r.item_cost);
      const lineItemPrice = num(r.line_item_price || r.item_price || r.unit_price || r.opportunity_quote_product_total_price || r.opportunity_quote_p_item_opportunity_quote_product_total_price);
      const unitPrice = lineItemPrice > 0 && quantity > 0 ? (lineItemPrice / quantity) : 0;
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
        itemTotalCost,
        lineItemPrice,
        unitPrice,
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
        quantity,
        quantityReceived,
        itemReceivedAtWarehouseDate: safeText(r.item_received_at_warehouse_date || r.received_at_warehouse_date || r.item_received_date),
        productsReceived: safeText(r.products_received || r.products_received_description || r.received_products),
        floorValue: quantityReceived > 0 && unitPrice > 0 ? quantityReceived * unitPrice : 0,
        image: safeText(r.image || r.image_url || r.thumbnail || r.po_image)
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

  
  function canMergeOrders(a, b){
    if (!a || !b) return false;
    const aSord = safeText(a.sord);
    const bSord = safeText(b.sord);
    const aSo = safeText(a.salesOrderId);
    const bSo = safeText(b.salesOrderId);
    return !!(
      (aSo && bSo && aSo === bSo) ||
      (aSord && bSord && aSord === bSord) ||
      (aSo && bSord && aSo === bSord) ||
      (aSord && bSo && aSord === bSo)
    );
  }

  function mergeOrderMaps(targetMap, sourceMap, mergeFn){
    (sourceMap ? [...sourceMap.entries()] : []).forEach(([key, value]) => {
      if (!targetMap.has(key)) {
        targetMap.set(key, value);
      } else if (mergeFn) {
        mergeFn(targetMap.get(key), value);
      }
    });
  }

  function mergeRawOrders(target, source){
    target.sord = target.sord || source.sord;
    target.salesOrderId = target.salesOrderId || source.salesOrderId;
    target.account = target.account || source.account;
    target.accountOwner = target.accountOwner || source.accountOwner;
    target.orderOwner = target.orderOwner || source.orderOwner;
    target.createdBy = target.createdBy || source.createdBy;
    target.status = target.status || source.status;
    target.poStatus = target.poStatus || source.poStatus;
    target.invoiceName = target.invoiceName || source.invoiceName;
    target.subtotal = Math.max(target.subtotal || 0, source.subtotal || 0);
    target.originalSubtotal = Math.max(target.originalSubtotal || 0, source.originalSubtotal || 0);
    target.invoiceTotal = Math.max(target.invoiceTotal || 0, source.invoiceTotal || 0);
    target.totalPackItems = Math.max(target.totalPackItems || 0, source.totalPackItems || 0);
    target.totalBulkProducts = Math.max(target.totalBulkProducts || 0, source.totalBulkProducts || 0);

    (source.revenueRows || []).forEach(row => target.revenueRows.push(row));
    (source.queueRows || []).forEach(row => target.queueRows.push(row));
    (source.eomRows || []).forEach(row => target.eomRows.push(row));
    (source.liveRows || []).forEach(row => target.liveRows.push(row));

    mergeOrderMaps(target.packBuilderMap, source.packBuilderMap, (a, b) => {
      a.pb = a.pb || b.pb;
      a.pbId = a.pbId || b.pbId;
      a.source = a.source || b.source;
      a.qty = a.qty || b.qty;
      a.products = a.products || b.products;
      a.units = a.units || b.units;
      a.status = a.status || b.status;
      a.ihd = a.ihd || b.ihd;
      a.stage = a.stage || b.stage;
      a.link = a.link || b.link;
      a.account = a.account || b.account;
      a.accountOwner = a.accountOwner || b.accountOwner;
      a.scheduledFor = a.scheduledFor || b.scheduledFor;
    });

    mergeOrderMaps(target.poMap, source.poMap, (a, b) => {
      a.purchaseOrderName = a.purchaseOrderName || b.purchaseOrderName;
      a.purchaseOrderId = a.purchaseOrderId || b.purchaseOrderId;
      a.poOwner = a.poOwner || b.poOwner;
      a.supplier = a.supplier || b.supplier;
      a.printerName = a.printerName || b.printerName;
      a.estimatedShipDate = a.estimatedShipDate || b.estimatedShipDate;
      a.createdDate = a.createdDate || b.createdDate;
      a.ihd = a.ihd || b.ihd;
      a.itemTotalCost = Math.max(a.itemTotalCost || 0, b.itemTotalCost || 0);
      a.lineItemPrice = Math.max(a.lineItemPrice || 0, b.lineItemPrice || 0);
      a.accountProductName = a.accountProductName || b.accountProductName;
      a.accountProductExternalId = a.accountProductExternalId || b.accountProductExternalId;
      a.quantity = Math.max(a.quantity || 0, b.quantity || 0);
      a.status = a.status || b.status;
      a.image = a.image || b.image;
    });

    mergeOrderMaps(target.accountProductMap, source.accountProductMap, (a, b) => {
      (b.suppliers || new Set()).forEach(v => a.suppliers.add(v));
      (b.printers || new Set()).forEach(v => a.printers.add(v));
      (b.poKeys || new Set()).forEach(v => a.poKeys.add(v));
      a.quantity += b.quantity || 0;
      a.itemTotalCost += b.itemTotalCost || 0;
      a.accountProductName = a.accountProductName || b.accountProductName;
      a.accountProductExternalId = a.accountProductExternalId || b.accountProductExternalId;
    });

    (source.suppliers || new Set()).forEach(v => target.suppliers.add(v));
    (source.poOwners || new Set()).forEach(v => target.poOwners.add(v));
    (source.printerNames || new Set()).forEach(v => target.printerNames.add(v));
    (source.productionTypes || new Set()).forEach(v => target.productionTypes.add(v));
    (source.notesSet || new Set()).forEach(v => target.notesSet.add(v));
    (source.relatedSords || new Set()).forEach(v => target.relatedSords.add(v));
    (source.estimatedDates || []).forEach(v => target.estimatedDates.push(v));
    (source.ihdDates || []).forEach(v => target.ihdDates.push(v));
    (source.dueDates || []).forEach(v => target.dueDates.push(v));
    (source.createdDates || []).forEach(v => target.createdDates.push(v));
    (source.salesOrderCreatedDates || []).forEach(v => target.salesOrderCreatedDates.push(v));
    (source.flags || []).forEach(v => target.flags.push(v));
    return target;
  }

  function consolidateOrders(rawOrders){
    const merged = [];
    (rawOrders || []).forEach(order => {
      const existing = merged.find(candidate => canMergeOrders(candidate, order));
      if (existing) mergeRawOrders(existing, order);
      else merged.push(order);
    });
    return merged;
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
          quantity: row.quantity,
          status: row.status,
          image: row.image
        });
      } else {
        const po = obj.poMap.get(poKey);
        po.itemTotalCost += row.itemTotalCost || 0;
        po.lineItemPrice += row.lineItemPrice || 0;
        po.quantity += row.quantity || 0;
        po.accountProductName = po.accountProductName || row.accountProductName;
        po.accountProductExternalId = po.accountProductExternalId || row.accountProductExternalId;
        po.status = po.status || row.status;
        po.image = po.image || row.image;
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

    const out = consolidateOrders([...map.values()]).map(order=>finalizeOrder(order));
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
      confirmedThisMonth: deriveConfirmedThisMonth(order.eomRows, poRows),
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

  function deriveConfirmedThisMonth(eomRows, poRows){
    // Conservative filter: every item line must be in a confirmed-completable state.
    // When in doubt, leave the SORD out.
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth(); // 0-indexed

    function isThisMonth(dateStr){
      if(!dateStr) return false;
      const iso = dateToIso(dateStr);
      if(!iso) return false;
      const d = new Date(iso + 'T00:00:00');
      if(isNaN(d.getTime())) return false;
      return d.getFullYear() === curYear && d.getMonth() === curMonth;
    }

    // Use granular eomRows if available; fall back to consolidated poRows
    const rows = (Array.isArray(eomRows) && eomRows.length) ? eomRows : (poRows || []);
    if(!rows.length) return false;

    for(const row of rows){
      const s = safeText(row.status).toLowerCase();

      // ✅ Always pass — item is done or physically in-house
      if(
        s === 'qa approved' ||
        s === 'qa complete' ||
        s === 'po complete' ||
        s === 'item fully received at warehouse' ||
        s === 'delivered direct to client' ||
        s === 'mission complete'
      ) continue;

      // ✅ Pass — partially received; item is in-house and can still finish
      if(s === 'item partially received at warehouse') continue;

      // ✅ Conditional pass — confirmed ship/arrival must be within this calendar month
      if(s === 'ship date confirmed' || s === 'item shipped from supplier'){
        if(isThisMonth(row.estimatedShipDate)) continue;
        return false; // date missing, unparseable, or outside this month
      }

      // ❌ Everything else is uncertain — Supplier Acknowledged, Client Approved,
      //    PO Sent, Pending Ship Date, Production Delay, QA Case, Shipping Delay, etc.
      return false;
    }
    return true;
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

  function itemHasPb(item)   { return item.pbCount > 0 || item.totalPackItems > 0; }
  function itemHasBulk(item) { return item.totalBulkProducts > 0; }

  function getFilteredDataset(){
    const q = norm(els.searchInput?.value || '');
    const statusFilter = safeText(els.statusFilter?.value);
    const readinessFilter = safeText(els.readinessFilter?.value);
    const complexityFilter = safeText(els.complexityFilter?.value);
    const riskFilter = safeText(els.riskFilter?.value);
    const confirmedFilter = safeText(els.confirmedFilter?.value);
    const sortVal = safeText(els.sortSelect?.value) || 'ihd';
    let list = state.dataset.filter(item=>{
      if(q){
        const hay = [item.sord, item.salesOrderId, item.account, item.accountOwner, item.orderOwner, item.createdBy, item.status, item.poStatus, ...(item.notes||[]), ...(item.relatedSords||[]), ...item.packBuilders.map(pb=>pb.pb), ...item.poRows.flatMap(po=>[po.supplier, po.poOwner, po.purchaseOrderName]), ...item.accountProducts.map(ap=>ap.accountProductName)].join(' ').toLowerCase();
        if(!hay.includes(q)) return false;
      }
      if(statusFilter && safeText(item.status) !== statusFilter && safeText(item.poStatus) !== statusFilter) return false;
      if(readinessFilter && item.readiness !== readinessFilter) return false;
      if(complexityFilter && item.complexity !== complexityFilter) return false;
      if(riskFilter === 'none' && item.flagCount) return false;
      if(riskFilter === 'flagged' && !item.flagCount) return false;
      if(confirmedFilter === 'confirmed' && !item.confirmedThisMonth) return false;
      // Production type filter
      if(state.activeTypeFilter === 'pb'   && !(itemHasPb(item) && !itemHasBulk(item))) return false;
      if(state.activeTypeFilter === 'bulk' && !(!itemHasPb(item) && itemHasBulk(item)))  return false;
      if(state.activeTypeFilter === 'mix'  && !(itemHasPb(item) && itemHasBulk(item)))   return false;
      return true;
    });
    list.sort((a,b)=>{
      if(sortVal === 'rev-desc') return num(b.subtotal) - num(a.subtotal);
      if(sortVal === 'readiness-asc') { const order = {'Blocked':0,'Needs Review':1,'Partially Ready':2,'Ready':3}; return (order[a.readiness]??1) - (order[b.readiness]??1); }
      if(sortVal === 'flags-desc') return num(b.flagCount) - num(a.flagCount);
      if(sortVal === 'account') return safeText(a.account).localeCompare(safeText(b.account));
      // default: IHD ascending
      const aDate = a.earliestIhd || a.dueDate || '9999';
      const bDate = b.earliestIhd || b.dueDate || '9999';
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    });
    return list;
  }

  function renderTopStats(list){
    const totalRevenue = list.reduce((sum,r)=>sum + num(r.subtotal),0);
    const totalFlags = list.reduce((sum,r)=>sum + num(r.flagCount),0);
    const blocked = list.filter(r=>r.readiness==='Blocked').length;
    const highComplexity = list.filter(r=>r.complexity==='High').length;
    const confirmedList = list.filter(r=>r.confirmedThisMonth);
    const confirmedRevenue = confirmedList.reduce((sum,r)=>sum + num(r.subtotal),0);
    const confirmedCount = confirmedList.length;
    const isConfirmedFilterActive = safeText(els.confirmedFilter?.value) === 'confirmed';
    els.topStats.innerHTML = [
      statCard('SORDs', fmtInt(list.length), 'Orders visible in explorer'),
      statCard('Revenue', fmtMoney(totalRevenue), 'Subtotal from imported revenue / EOM data'),
      statCard('Confirmed This Month', fmtMoney(confirmedRevenue),
        isConfirmedFilterActive
          ? `${fmtInt(confirmedCount)} SORD${confirmedCount===1?'':'s'} — all items confirmed completable`
          : `${fmtInt(confirmedCount)} of ${fmtInt(list.length)} SORDs fully confirmed for this month`,
        'confirmed'),
      statCard('Blocked', fmtInt(blocked), 'Orders with blocked readiness'),
      statCard('High Complexity', fmtInt(highComplexity), 'Orders with higher operational complexity'),
      statCard('Risk Flags', fmtInt(totalFlags), 'Total active flags across visible SORDs')
    ].join('');
  }

  function statCard(label, value, hint, tone=''){
    const toneClass = tone ? ` stat-card-${escape(tone)}` : '';
    return `<div class="card${toneClass}"><div class="stat-label">${escape(label)}</div><div class="stat-value">${escape(value)}</div><div class="stat-hint">${escape(hint)}</div></div>`;
  }

  
  function poCategoryLabel(value){
    return value === 'pack' ? 'Pack Items' : value === 'bulk' ? 'Bulk Products' : value === 'mix' ? 'Mix' : 'All';
  }

  function buildPackHintTokens(item){
    const text = (item.packBuilders || []).map(pb => `${pb.pb || ''} ${pb.pbId || ''}`).join(' ').toLowerCase();
    return new Set(text.split(/[^a-z0-9]+/).filter(token => token && token.length >= 4));
  }

  function hasTokenOverlap(textValue, tokenSet){
    const tokens = String(textValue || '').toLowerCase().split(/[^a-z0-9]+/).filter(token => token && token.length >= 4);
    return tokens.some(token => tokenSet.has(token));
  }

  function classifyPoCategoryForItem(item, po){
    const orderHasPack = Number(item.totalPackItems || 0) > 0;
    const orderHasBulk = Number(item.totalBulkProducts || 0) > 0;
    const baseText = `${po.purchaseOrderName || ''} ${po.accountProductName || ''} ${po.status || ''} ${po.supplier || ''}`.toLowerCase();

    if (orderHasPack && !orderHasBulk) return 'pack';
    if (orderHasBulk && !orderHasPack) return 'bulk';

    const explicitBulk = /\bbulk\b|loose item|loose items|individual/.test(baseText);
    if (explicitBulk) return 'bulk';

    const packTokens = buildPackHintTokens(item);
    const looksPack = hasTokenOverlap(baseText, packTokens);

    if (orderHasPack && orderHasBulk) {
      if (looksPack && explicitBulk) return 'mix';
      if (looksPack) return 'pack';
      return 'mix';
    }

    return looksPack ? 'pack' : 'mix';
  }

  function computePoCategoryCounts(item){
    const counts = { all: 0, pack: 0, bulk: 0, mix: 0 };
    (item?.poRows || []).forEach(po => {
      const cat = classifyPoCategoryForItem(item, po);
      counts.all += 1;
      counts[cat] += 1;
    });
    return counts;
  }

  // ── Accordion helpers ─────────────────────────────────────────────────────
  function acStatusColor(s){
    const t=(s||'').toLowerCase();
    if(/complete|received|mission complete|delivered|qa approved/.test(t)) return 'ac-chip-green';
    if(/progress|packing|ship|scheduled|confirmed/.test(t)) return 'ac-chip-blue';
    if(/delay|exception|case|hold|block|pending|partial/.test(t)) return 'ac-chip-red';
    return 'ac-chip-gray';
  }
  function acPbStageColor(s){
    if(s==='Complete') return 'ac-pb-green';
    if(/Packing|Build Ready|QC Check/.test(s)) return 'ac-pb-blue';
    return 'ac-pb-yellow';
  }

  function renderAccordion(){
    const list = getFilteredDataset();
    renderTopStats(list);

    // Update type pill counts
    const allDs = state.dataset;
    if(els.typeCntAll)  els.typeCntAll.textContent  = allDs.length;
    if(els.typeCntPb)   els.typeCntPb.textContent   = allDs.filter(x => itemHasPb(x) && !itemHasBulk(x)).length;
    if(els.typeCntBulk) els.typeCntBulk.textContent = allDs.filter(x => !itemHasPb(x) && itemHasBulk(x)).length;
    if(els.typeCntMix)  els.typeCntMix.textContent  = allDs.filter(x => itemHasPb(x) && itemHasBulk(x)).length;

    // Update active pill styling
    document.querySelectorAll('[data-type-filter]').forEach(btn=>{
      const f = btn.getAttribute('data-type-filter');
      btn.classList.toggle('sord-type-pill-active', f === state.activeTypeFilter);
    });

    if(els.explorerCount) els.explorerCount.textContent = `${list.length} result${list.length===1?'':'s'}`;
    if(!els.accordionList) return;

    if(!list.length){
      els.accordionList.innerHTML = '<div class="sord-accordion-empty">No SORDs match the current filters. Try adjusting your search or filters.</div>';
      return;
    }

    const visible = list.slice(0, SEARCH_LIMIT_DEFAULT);

    // Group: flagged/blocked float to top when showing all
    let html = '';
    if(state.activeTypeFilter === 'all' && !safeText(els.searchInput?.value)){
      const urgent = visible.filter(x => x.flagCount > 0 || /block|exception/.test((x.readiness||'').toLowerCase()));
      const rest   = visible.filter(x => !urgent.includes(x));
      if(urgent.length){
        html += `<div class="sord-section-hdr"><span>Needs Attention (${urgent.length})</span><div class="sord-section-line"></div></div>`;
        html += urgent.map(item => renderAccordionRow(item)).join('');
        if(rest.length){
          html += `<div class="sord-section-hdr" style="margin-top:10px"><span>Active (${rest.length})</span><div class="sord-section-line"></div></div>`;
          html += rest.map(item => renderAccordionRow(item)).join('');
        }
      } else {
        html = visible.map(item => renderAccordionRow(item)).join('');
      }
    } else {
      html = visible.map(item => renderAccordionRow(item)).join('');
    }

    els.accordionList.innerHTML = html;
  }

  function renderAccordionRow(item){
    const isExp   = state.expandedKey === item.key;
    const hasPb   = itemHasPb(item);
    const hasBulk = itemHasBulk(item);
    const tc      = hasPb && !hasBulk ? 'pb' : !hasPb && hasBulk ? 'bulk' : 'mix';
    const isPinned = state.prioritySords.has(item.key);

    const typeBadge = tc==='pb'
      ? '<span class="ac-type-badge ac-badge-pb">📦 PB</span>'
      : tc==='bulk'
        ? '<span class="ac-type-badge ac-badge-bulk">🏭 Bulk</span>'
        : '<span class="ac-type-badge ac-badge-mix">⚡ PB+Bulk</span>';

    const complexClass = item.complexity === 'High' ? 'ac-cx-high' : item.complexity === 'Medium' ? 'ac-cx-med' : 'ac-cx-low';
    const ownerLabel = item.ownerMapping?.accountManager || item.accountOwner || item.orderOwner || '—';
    const starBtn = `<button class="pb-star-btn${isPinned?' pb-star-active':''}" type="button" title="${isPinned?'Remove from priority':'Add to priority'}" onclick="event.stopPropagation();window.pbToggleSord('${escJs(item.key)}')">★</button>`;

    return `
      <div class="sord-accordion-row${isExp?' sord-acc-expanded':''}" id="sord-acc-${escJs(item.key)}">
        <div class="sord-acc-header" onclick="window.sordToggleRow('${escJs(item.key)}')">
          <div class="sord-acc-stripe sord-stripe-${tc}"></div>
          <div class="sord-acc-main">
            <div class="sord-acc-top">
              <span class="sord-acc-id">${escape(item.sord)}</span>
              ${typeBadge}
              <span class="sord-acc-cx ${complexClass}">${escape(item.complexity)}</span>
              ${item.flagCount ? `<span class="sord-acc-flag">⚑ ${item.flagCount} flag${item.flagCount>1?'s':''}</span>` : ''}
              ${item.confirmedThisMonth ? '<span class="sord-acc-confirmed">✓ Confirmed</span>' : ''}
            </div>
            <div class="sord-acc-bottom">
              <span class="sord-acc-account">${escape(item.account||'—')}</span>
              <span class="sord-acc-owner">AO: ${escape(ownerLabel)}</span>
              <span class="sord-acc-status-chip ${acStatusColor(item.status||item.poStatus)}">${escape(item.status||item.poStatus||'—')}</span>
            </div>
          </div>
          <div class="sord-acc-right">
            ${starBtn}
            <div>
              <div class="sord-acc-rev">${fmtMoney(item.subtotal||item.originalSubtotal)}</div>
              <div class="sord-acc-ihd">IHD ${fmtDate(item.earliestIhd||item.dueDate||'')}</div>
            </div>
            <div class="sord-acc-read-bar"><div class="sord-acc-read-fill sord-read-${item.readiness==='Ready'?'green':item.readiness==='Blocked'?'red':'yellow'}"></div></div>
            <span class="sord-acc-chevron">›</span>
          </div>
        </div>
        <div class="sord-acc-dossier">${isExp ? buildInlineDossier(item) : ''}</div>
      </div>`;
  }

  function buildInlineDossier(item){
    const hasPb   = itemHasPb(item);
    const hasBulk = itemHasBulk(item);
    const ownerMap = item.ownerMapping;
    const orderUrl = salesOrderUrl(item.salesOrderId);

    // ── Overview tab ─────────────────────────────────────────────────────────
    const readPct = item.readiness === 'Ready' ? 95
      : item.readiness === 'Partially Ready' ? 55
      : item.readiness === 'Blocked' ? 15 : 30;
    const readCls = item.readiness === 'Ready' ? 'fill-green' : item.readiness === 'Blocked' ? 'fill-red' : 'fill-yellow';
    const readHex = item.readiness === 'Ready' ? '#059669' : item.readiness === 'Blocked' ? '#dc2626' : '#d97706';

    const overviewHTML = `
      <div class="ac-readiness-wrap">
        <div class="ac-readiness-hdr"><span class="ac-readiness-lbl">Readiness: ${escape(item.readiness)}</span><span style="font-size:11px;font-weight:700;color:${readHex}">${readPct}%</span></div>
        <div class="ac-readiness-bg"><div class="ac-readiness-fill ${readCls}" style="width:${readPct}%"></div></div>
      </div>
      <div class="ac-stat-row">
        <div class="ac-stat"><div class="ac-stat-lbl">Revenue</div><div class="ac-stat-val green">${fmtMoney(item.subtotal||item.originalSubtotal)}</div></div>
        <div class="ac-stat"><div class="ac-stat-lbl">IHD</div><div class="ac-stat-val blue">${fmtDate(item.earliestIhd||item.dueDate||'')}</div></div>
        <div class="ac-stat"><div class="ac-stat-lbl">Pack Builders</div><div class="ac-stat-val" style="color:#185fa5">${fmtInt(item.pbCount)}</div></div>
        <div class="ac-stat"><div class="ac-stat-lbl">Bulk POs</div><div class="ac-stat-val" style="color:#059669">${fmtInt(item.poRows.filter(p=>p.category==='bulk'||(!itemHasPb(item)&&itemHasBulk(item))).length||item.totalBulkProducts>0?item.poCount-item.pbCount:0)}</div></div>
        <div class="ac-stat"><div class="ac-stat-lbl">Total Qty</div><div class="ac-stat-val">${fmtInt(item.totalQty)}</div></div>
        <div class="ac-stat"><div class="ac-stat-lbl">Products</div><div class="ac-stat-val">${fmtInt(item.totalUniqueProducts)}</div></div>
      </div>

      <div class="ac-section">
        <div class="ac-section-title">Account Owner &amp; Team</div>
        <div class="ac-people-row">
          <div class="ac-person-card"><div class="ac-person-role">Account Owner</div><div class="ac-person-name">${escape(item.accountOwner||'—')}</div></div>
          <div class="ac-person-card"><div class="ac-person-role">Order Owner</div><div class="ac-person-name">${escape(item.orderOwner||'—')}</div></div>
          <div class="ac-person-card"><div class="ac-person-role">Created By</div><div class="ac-person-name">${escape(item.createdBy||'—')}</div></div>
        </div>
        ${ownerMap ? `<div class="ac-people-row" style="margin-top:8px">
          <div class="ac-person-card"><div class="ac-person-role">Account Manager</div><div class="ac-person-name">${escape(ownerMap.accountManager||'—')}</div>${ownerMap.accountManagerLink?`<a class="ac-person-link" href="${escape(ownerMap.accountManagerLink)}" target="_blank">↗ Slack</a>`:''}</div>
          <div class="ac-person-card"><div class="ac-person-role">Project Manager</div><div class="ac-person-name">${escape(ownerMap.projectManager||'—')}</div>${ownerMap.projectManagerLink?`<a class="ac-person-link" href="${escape(ownerMap.projectManagerLink)}" target="_blank">↗ Slack</a>`:''}</div>
          <div class="ac-person-card"><div class="ac-person-role">PSA</div><div class="ac-person-name">${escape(ownerMap.psa||'—')}</div>${ownerMap.psaLink?`<a class="ac-person-link" href="${escape(ownerMap.psaLink)}" target="_blank">↗ Slack</a>`:''}</div>
        </div>` : ''}
      </div>

      <div class="ac-section">
        <div class="ac-section-title">Order Details</div>
        <div class="ac-kv-list">
          <div class="ac-kv-row"><span class="ac-kv-key">SORD</span><span class="ac-kv-val">${orderUrl?`<a class="queue-link" href="${escape(orderUrl)}" target="_blank">${escape(item.sord)}</a>`:escape(item.sord)}</span></div>
          ${item.invoiceName?`<div class="ac-kv-row"><span class="ac-kv-key">Invoice</span><span class="ac-kv-val">${escape(item.invoiceName)}</span></div>`:''}
          <div class="ac-kv-row"><span class="ac-kv-key">SO Status</span><span class="ac-kv-val"><span class="ac-chip ${acStatusColor(item.status)}">${escape(item.status||'—')}</span></span></div>
          <div class="ac-kv-row"><span class="ac-kv-key">PO Status</span><span class="ac-kv-val"><span class="ac-chip ${acStatusColor(item.poStatus)}">${escape(item.poStatus||'—')}</span></span></div>
          <div class="ac-kv-row"><span class="ac-kv-key">Complexity</span><span class="ac-kv-val"><span class="ac-cx-inline ac-cx-${(item.complexity||'Low').toLowerCase()}">${escape(item.complexity||'—')}</span></span></div>
          ${item.productionTypes?.length?`<div class="ac-kv-row"><span class="ac-kv-key">Production Types</span><span class="ac-kv-val">${escape(item.productionTypes.join(', '))}</span></div>`:''}
          ${item.supplierCount?`<div class="ac-kv-row"><span class="ac-kv-key">Suppliers</span><span class="ac-kv-val">${escape([...item.raw.suppliers||[]].slice(0,5).join(', ')||'—')}</span></div>`:''}
          ${item.poOwners?.length?`<div class="ac-kv-row"><span class="ac-kv-key">PO Owner(s)</span><span class="ac-kv-val">${escape(item.poOwners.join(', '))}</span></div>`:''}
          ${item.relatedSords?.length?`<div class="ac-kv-row"><span class="ac-kv-key">Related SORDs</span><span class="ac-kv-val">${item.relatedSords.map(r=>`<span class="ac-related-chip">${escape(r)}</span>`).join(' ')}</span></div>`:''}
        </div>
      </div>

      ${item.flags?.length?`<div class="ac-section">
        <div class="ac-section-title">⚑ Flags (${item.flags.length})</div>
        <div class="ac-flags-list">${item.flags.map(f=>`<div class="ac-flag-row"><span>⚑</span><span>${escape(f)}</span></div>`).join('')}</div>
      </div>`:''}

      ${item.notes?.length?`<div class="ac-section">
        <div class="ac-section-title">Notes</div>
        ${item.notes.map(n=>`<div class="ac-note">${escape(n)}</div>`).join('')}
      </div>`:''}
    `;

    // ── Timeline tab ──────────────────────────────────────────────────────────
    const timelineHTML = item.timeline?.length
      ? `<div class="ac-timeline">${item.timeline.map(t=>`
          <div class="ac-tl-row">
            <div class="ac-tl-dot"></div>
            <span class="ac-tl-label">${escape(t.label)}</span>
            <span class="ac-tl-val">${escape(fmtDate(t.value))}</span>
          </div>`).join('')}
        </div>`
      : '<div class="ac-empty">No timeline dates available from imported data.</div>';

    // ── Pack Builders tab ─────────────────────────────────────────────────────
    const pbHTML = !item.packBuilders?.length
      ? '<div class="ac-empty">No pack builder detail found for this SORD.</div>'
      : `<div class="ac-pb-list">${item.packBuilders.map(pb=>{
          const stCls = acPbStageColor(pb.stage||pb.status||'');
          return `<div class="ac-pb-row">
            <div class="ac-pb-top">
              <span class="ac-pb-id">${escape(pb.pb||'—')}</span>
              ${pb.pbId?`<span class="ac-pb-sfid">${escape(pb.pbId)}</span>`:''}
              <span class="ac-pb-stage ${stCls}">${escape(pb.stage||pb.status||'—')}</span>
              ${pb.link?`<a class="ac-pb-link" href="${escape(pb.link)}" target="_blank">📄 PDF</a>`:'<span class="ac-pb-nopdf">No PDF</span>'}
            </div>
            <div class="ac-pb-meta">
              <span>${fmtInt(pb.qty)} kits</span>
              <span>${fmtInt(pb.products)} products</span>
              <span>${fmtInt(pb.units)} units</span>
              ${pb.scheduledFor?`<span>Sched: <strong>${escape(pb.scheduledFor)}</strong></span>`:''}
              ${pb.source?`<span>Source: ${escape(pb.source)}</span>`:''}
            </div>
          </div>`;
        }).join('')}</div>`;

    // ── POs tab ───────────────────────────────────────────────────────────────
    const visiblePoRows = (item.poRows||[]).filter(po=>
      state.poCategoryFilter==='all' ? true : classifyPoCategoryForItem(item,po)===state.poCategoryFilter
    );
    const poCounts = computePoCategoryCounts(item);
    const poHTML = `
      <div class="po-category-filters" style="margin-bottom:10px">
        ${['all','pack','bulk','mix'].map(f=>`<button class="po-chip${state.poCategoryFilter===f?' active':''}" type="button" data-po-filter="${f}">${poCategoryLabel(f)} (${poCounts[f]})</button>`).join('')}
      </div>
      ${!visiblePoRows.length
        ? '<div class="ac-empty">No PO detail found for this filter.</div>'
        : `<div class="ac-po-list">${visiblePoRows.map(po=>{
            const poUrl = purchaseOrderUrl(po.purchaseOrderId);
            const cat = classifyPoCategoryForItem(item,po);
            const imageUrl = parseSalesforceImageUrl(po.image||po.imageUrl||po.thumbnail||'');
            return `<div class="ac-po-row">
              <div class="ac-po-top">
                <div class="ac-po-dot" style="background:${cat==='pack'?'#185fa5':cat==='bulk'?'#059669':'#7c3aed'}"></div>
                <span class="ac-po-num">${poUrl?`<a class="queue-link" href="${escape(poUrl)}" target="_blank">${escape(po.purchaseOrderName||'—')}</a>`:escape(po.purchaseOrderName||'—')}</span>
                <span class="ac-chip ${acStatusColor(po.status)}">${escape(po.status||'—')}</span>
              </div>
              <div class="ac-po-meta">
                ${po.supplier?`<span>Supplier: <strong>${escape(po.supplier)}</strong></span>`:''}
                ${po.poOwner?`<span>Owner: <strong>${escape(po.poOwner)}</strong></span>`:''}
                ${po.quantity?`<span>${fmtInt(po.quantity)} units</span>`:''}
                ${po.estimatedShipDate?`<span>Est. Ship: <strong>${escape(fmtDate(po.estimatedShipDate))}</strong></span>`:''}
                ${po.ihd?`<span>IHD: <strong>${escape(fmtDate(po.ihd))}</strong></span>`:''}
                ${po.itemTotalCost?`<span>Item Cost: <strong>${fmtMoney(po.itemTotalCost)}</strong></span>`:''}
                ${po.accountProductName?`<span>${escape(po.accountProductName)}</span>`:''}
                ${imageUrl?`<span><button class="btn secondary btn-sm po-image-link" type="button" data-po-image="${escape(imageUrl)}" data-po-title="${escape(po.purchaseOrderName||'')} image">View image</button></span>`:''}
              </div>
            </div>`;
          }).join('')}</div>`
      }`;

    // ── Account Products tab ──────────────────────────────────────────────────
    const apHTML = !item.accountProducts?.length
      ? '<div class="ac-empty">No account-product detail found for this SORD.</div>'
      : `<div class="ac-po-list">${item.accountProducts.map(ap=>`
          <div class="ac-po-row">
            <div class="ac-po-top"><span class="ac-po-num" style="font-size:12px">${escape(ap.accountProductName||'—')}</span></div>
            <div class="ac-po-meta">
              ${ap.accountProductExternalId?`<span>ID: ${escape(ap.accountProductExternalId)}</span>`:''}
              <span>${fmtInt(ap.poCount)} POs</span>
              <span>${fmtInt(ap.supplierCount)} suppliers</span>
              <span>${fmtInt(ap.quantity)} units</span>
              ${ap.itemTotalCost?`<span>Cost: ${fmtMoney(ap.itemTotalCost)}</span>`:''}
            </div>
          </div>`).join('')}</div>`;

    // ── Financials tab ────────────────────────────────────────────────────────
    const delta = (item.subtotal||0) - (item.originalSubtotal||0);
    const deltaHtml = delta ? `<span style="font-size:11px;color:${delta>0?'#059669':'#dc2626'}"> (${delta>0?'+':''}${fmtMoney(delta)})</span>` : '';
    const finHTML = `
      <div class="ac-fin-grid">
        <div class="ac-fin-card"><div class="ac-fin-lbl">Revenue</div><div class="ac-fin-val green">${fmtMoney(item.subtotal||item.originalSubtotal)}${deltaHtml}</div></div>
        <div class="ac-fin-card"><div class="ac-fin-lbl">Original Rev</div><div class="ac-fin-val">${fmtMoney(item.originalSubtotal||item.subtotal)}</div></div>
        <div class="ac-fin-card"><div class="ac-fin-lbl">Item Cost</div><div class="ac-fin-val">${fmtMoney(item.totalItemCost)}</div></div>
        <div class="ac-fin-card"><div class="ac-fin-lbl">Gross Spread</div><div class="ac-fin-val green">${fmtMoney(item.grossSpread)}</div></div>
        <div class="ac-fin-card"><div class="ac-fin-lbl">Margin Est.</div><div class="ac-fin-val">${item.subtotal?item.marginPct.toFixed(1)+'%':'—'}</div></div>
        <div class="ac-fin-card"><div class="ac-fin-lbl">Pack Items</div><div class="ac-fin-val">${fmtInt(item.totalPackItems)}</div></div>
        <div class="ac-fin-card"><div class="ac-fin-lbl">Bulk Products</div><div class="ac-fin-val">${fmtInt(item.totalBulkProducts)}</div></div>
      </div>`;

    const tabs = [
      {id:'ov',  label:'Overview'},
      {id:'tl',  label:'Timeline'},
      {id:'pbs', label:`Pack Builders${item.pbCount?` (${item.pbCount})`:''}`, hidden: !hasPb},
      {id:'pos', label:`POs (${item.poCount})`},
      {id:'ap',  label:`Products (${item.accountProducts?.length||0})`, hidden: !item.accountProducts?.length},
      {id:'fin', label:'Financials'},
    ].filter(t => !t.hidden);

    const activeDossierTab = state.expandedTabMap?.[item.key] || tabs[0].id;

    return `
      <div class="ac-dossier-tabs">${tabs.map(t=>`<div class="ac-dtab${activeDossierTab===t.id?' active':''}" data-key="${escJs(item.key)}" data-dtab="${t.id}" onclick="window.sordSwitchTab('${escJs(item.key)}','${t.id}')">${escape(t.label)}</div>`).join('')}</div>
      <div class="ac-dossier-body">
        ${tabs.map(t=>{
          const body = t.id==='ov'?overviewHTML : t.id==='tl'?timelineHTML : t.id==='pbs'?pbHTML : t.id==='pos'?poHTML : t.id==='ap'?apHTML : finHTML;
          return `<div class="ac-dtab-pane${activeDossierTab===t.id?' active':''}" id="ac-pane-${escJs(item.key)}-${t.id}">${body}</div>`;
        }).join('')}
      </div>
      <div class="ac-dossier-footer">
        ${orderUrl?`<a class="btn secondary" href="${escape(orderUrl)}" target="_blank" rel="noopener noreferrer">↗ Salesforce</a>`:''}
        <button class="btn secondary" onclick="navigator.clipboard?.writeText('${escJs(item.sord)}').then(()=>{this.textContent='✓ Copied';setTimeout(()=>{this.textContent='Copy ID'},1500)}).catch(()=>{})">Copy ID</button>
        <button class="pb-star-btn${state.prioritySords.has(item.key)?' pb-star-active':''}" type="button" title="Toggle priority" style="margin-left:auto;font-size:18px" onclick="window.pbToggleSord('${escJs(item.key)}')">★</button>
      </div>`;
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

  function renderDossier(item){ /* replaced by inline accordion dossier — no-op */ }

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
      await importSharedFiles({ queueFile, revenueFile, eomFile });
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Import failed.', true);
      alert(error.message || 'Import failed.');
    }
  }

  async function clearImports(){
    await clearSharedImports();
  }

  function setStatus(text, isError=false){
    els.importStatus.textContent = text;
    els.importStatus.classList.toggle('error', !!isError);
  }

  function rebuildAndRender(){
    buildDataset();
    fillStatusFilter();
    renderAccordion();
  }


  async function importSharedFiles(files,{silent=false}={}){
    try{
      if(typeof XLSX === 'undefined') throw new Error('XLSX library is not available.');
      const queueFile = files?.queueFile || null;
      const revenueFile = files?.revenueFile || null;
      const eomFile = files?.eomFile || null;
      if(!queueFile && !revenueFile && !eomFile){
        setStatus('Choose at least one report to import.', true);
        throw new Error('Choose at least one report to import.');
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
      state.imports.counts = {
        queue: state.imports.queueRows.length,
        revenue: state.imports.revenueRows.length,
        eom: state.imports.eomRows.length
      };
      await saveState();
      rebuildAndRender();
      // PATCH: Save a daily SORD status snapshot for historical analysis
      if (typeof window.huddleSaveSordSnapshot === 'function') {
        window.huddleSaveSordSnapshot(state.dataset, state.imports.importedAt);
      }
      // PATCH: force Daily Brief / Huddle Dashboard to repaint immediately after SORD imports
      if (typeof window.huddleRefresh === 'function') {
        try { window.huddleRefresh(); } catch (_) {}
      }
      const text = `SORD data imported. Queue rows: ${fmtInt(state.imports.queueRows.length)} • Revenue rows: ${fmtInt(state.imports.revenueRows.length)} • EOM rows: ${fmtInt(state.imports.eomRows.length)}${summarizeFileNames() ? ' • ' + summarizeFileNames() : ''}`;
      setStatus(text);
      return { message: text, counts: { queue: state.imports.queueRows.length, revenue: state.imports.revenueRows.length, eom: state.imports.eomRows.length } };
    } catch (error) {
      console.error(error);
      setStatus(error.message || 'Import failed.', true);
      if(!silent) alert(error.message || 'Import failed.');
      throw error;
    }
  }

  async function clearSharedImports({silent=false}={}){
    state.imports = emptyImports();
    await deleteLargeImportRecord();
    saveJson(STORAGE_KEY, buildImportMeta(state.imports));
    rebuildAndRender();
    if (els.queueInput) els.queueInput.value='';
    if (els.revenueInput) els.revenueInput.value='';
    if (els.eomInput) els.eomInput.value='';
    const text='Imported <a class="import-report-link" href="https://swagup.lightning.force.com/lightning/r/Report/00OQm000003BDbJMAW/view" target="_blank" rel="noopener noreferrer">SORD report</a> data cleared. Live queue / assembly data is still visible when it can be matched.';
    setStatus(text);
    if (typeof window.huddleRefresh === 'function') {
      try { window.huddleRefresh(); } catch (_) {}
    }
    return { message: text };
  }

  // ════════════════════════════════════════════════════════════════
  // PRIORITY BUILDER — select SORDs, surface open POs, generate Slack post
  // ════════════════════════════════════════════════════════════════

  const PO_PASS_STATUSES = new Set([
    'qa approved', 'qa complete', 'po complete',
    'item fully received at warehouse', 'delivered direct to client', 'mission complete'
  ]);

  function poNeedsWork(po) {
    const s = safeText(po.status).toLowerCase();
    return !PO_PASS_STATUSES.has(s);
  }

  function renderPriorityChips() {
    if (!els.pbSelectedChips) return;
    const keys = [...state.prioritySords];
    if (!keys.length) {
      els.pbSelectedChips.innerHTML = '<span class="pb-empty-hint">Click ★ on any SORD in the list below to add it here.</span>';
      return;
    }
    els.pbSelectedChips.innerHTML = keys.map(key => {
      const item = state.dataset.find(x => x.key === key);
      const label = item ? (item.sord || item.account || key) : key;
      const account = item ? (item.account || '') : '';
      return `<span class="pb-chip">
        <span class="pb-chip-sord">${escape(label)}</span>
        ${account ? `<span class="pb-chip-account">${escape(account)}</span>` : ''}
        <button class="pb-chip-remove" type="button" title="Remove" onclick="window.pbToggleSord('${escJs(key)}')">×</button>
      </span>`;
    }).join('');
  }

  function generateSlackPost() {
    const keys = [...state.prioritySords];
    if (!keys.length) return '';

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const lines = [];
    lines.push(`🚨 *PRIORITY ORDER LIST — ${today}*`);
    lines.push(`The following SORDs need same-day attention across Inbound and Assembly. Please prioritize accordingly.`);
    lines.push('');

    let hasAssemblyItems = false;

    keys.forEach((key, idx) => {
      const item = state.dataset.find(x => x.key === key);
      if (!item) return;

      const revenue = fmtMoney(item.subtotal || item.originalSubtotal);
      const ihd = item.earliestIhd ? `IHD: ${fmtDate(item.earliestIhd)}` : (item.dueDate ? `Due: ${fmtDate(item.dueDate)}` : 'No date set');
      const account = item.account || '—';
      const orderStatus = item.status || item.poStatus || '—';

      lines.push(`*${idx + 1}. ${item.sord}* — ${account}`);
      lines.push(`   📦 Revenue: ${revenue}   |   ${ihd}   |   Status: ${orderStatus}`);

      // POs that still need work
      const openPos = (item.poRows || []).filter(poNeedsWork);
      const donePos  = (item.poRows || []).filter(po => !poNeedsWork(po));

      if (openPos.length) {
        lines.push(`   ⚠️ *${openPos.length} PO${openPos.length > 1 ? 's' : ''} need inbound attention:*`);
        openPos.forEach(po => {
          const poName = po.purchaseOrderName || po.purchaseOrderId || '(unnamed)';
          const poStatus = po.status || '—';
          const eta = po.estimatedShipDate ? `ETA: ${fmtDate(po.estimatedShipDate)}` : '';
          const supplier = po.supplier ? `• ${po.supplier}` : '';
          const product = po.accountProductName ? `(${po.accountProductName})` : '';
          lines.push(`      • *${poName}* — ${poStatus}${eta ? '  ' + eta : ''}${supplier ? '  ' + supplier : ''}${product ? ' ' + product : ''}`);
        });
      }
      if (donePos.length) {
        lines.push(`   ✅ ${donePos.length} PO${donePos.length > 1 ? 's' : ''} already QA Approved / Complete`);
      }

      // Pack builders
      const pbs = item.packBuilders || [];
      if (pbs.length) {
        hasAssemblyItems = true;
        lines.push(`   📋 *Pack Builder${pbs.length > 1 ? 's' : ''} (Assembly):*`);
        pbs.forEach(pb => {
          const pbStage = pb.stage ? ` — Stage: ${pb.stage}` : '';
          const pbIhd = pb.ihd ? ` | IHD: ${fmtDate(pb.ihd)}` : '';
          const pbLink = pb.link ? ` → ${pb.link}` : '';
          lines.push(`      • ${pb.pb || '(unnamed)'}${pbStage}${pbIhd}${pbLink}`);
        });
      }

      lines.push('');
    });

    if (hasAssemblyItems) {
      lines.push(`_@assembly-lead please prioritize the pack builders listed above so these orders can complete today._`);
    }
    lines.push(`_@inbound-team please process the open POs listed above as soon as possible._`);

    return lines.join('\n');
  }

  function renderPriorityPost() {
    if (!els.pbPostWrap || !els.pbPostContent) return;
    const post = generateSlackPost();
    if (!post) {
      els.pbPostWrap.hidden = true;
      return;
    }
    els.pbPostContent.textContent = post;
    els.pbPostWrap.hidden = false;
  }

  function bindPriorityBuilder() {
    if (!els.priorityPanel) return;

    els.pbGenerateBtn?.addEventListener('click', () => {
      renderPriorityPost();
      if (!els.pbPostWrap?.hidden) {
        els.pbPostWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    els.pbClearSelBtn?.addEventListener('click', () => {
      state.prioritySords.clear();
      savePriority();
      renderPriorityChips();
      els.pbPostWrap && (els.pbPostWrap.hidden = true);
      renderAccordion();
    });

    els.pbCopyBtn?.addEventListener('click', () => {
      const text = els.pbPostContent?.textContent || '';
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const btn = els.pbCopyBtn;
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      }).catch(() => {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        const btn = els.pbCopyBtn;
        const orig = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      });
    });

    // Init chips on load
    renderPriorityChips();
  }

  window.pbToggleSord = function(key) {
    if (state.prioritySords.has(key)) {
      state.prioritySords.delete(key);
    } else {
      state.prioritySords.add(key);
    }
    savePriority();
    renderPriorityChips();
    // Refresh post if it's currently visible
    if (els.pbPostWrap && !els.pbPostWrap.hidden) renderPriorityPost();
    renderAccordion();
  };

  // Toggle a SORD row open/closed
  window.sordToggleRow = function(key) {
    state.expandedKey = (state.expandedKey === key) ? '' : key;
    renderAccordion();
    if (state.expandedKey) {
      requestAnimationFrame(()=>{
        const el = document.getElementById('sord-acc-' + state.expandedKey);
        if(el) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
      });
    }
  };

  // Switch the active tab inside an already-expanded dossier (in-place, no full re-render)
  window.sordSwitchTab = function(key, tabId) {
    if (!state.expandedTabMap) state.expandedTabMap = {};
    state.expandedTabMap[key] = tabId;
    const row = document.getElementById('sord-acc-' + key);
    if (row) {
      row.querySelectorAll('.ac-dtab').forEach(t =>
        t.classList.toggle('active', t.getAttribute('data-dtab') === tabId)
      );
      row.querySelectorAll('.ac-dtab-pane').forEach(p => {
        const paneId = p.id.replace('ac-pane-' + key + '-', '');
        p.classList.toggle('active', paneId === tabId);
      });
    }
  };

  // Set the production-type filter pill (called from onclick on pill buttons)
  window.sordSetTypeFilter = function(f) {
    state.activeTypeFilter = f || 'all';
    renderAccordion();
  };

  function bind(){
    els.importBtn.addEventListener('click', importFiles);
    bindPriorityBuilder();
    els.clearBtn.addEventListener('click', clearImports);
    els.refreshBtn.addEventListener('click', ()=>{ rebuildAndRender(); setStatus(`Refreshed SORD explorer from imported reports and live app data${summarizeFileNames() ? ' • ' + summarizeFileNames() : ''}.`); });
    [els.searchInput, els.sortSelect, els.statusFilter, els.readinessFilter, els.complexityFilter, els.riskFilter, els.confirmedFilter].filter(Boolean).forEach(el=>el.addEventListener('input', renderAccordion));
    [els.sortSelect].filter(Boolean).forEach(el=>el.addEventListener('change', renderAccordion));
    els.resetFiltersBtn?.addEventListener('click', ()=>{
      if(els.searchInput) els.searchInput.value='';
      if(els.statusFilter) els.statusFilter.value='';
      if(els.readinessFilter) els.readinessFilter.value='';
      if(els.complexityFilter) els.complexityFilter.value='';
      if(els.riskFilter) els.riskFilter.value='';
      if(els.confirmedFilter) els.confirmedFilter.value='';
      state.activeTypeFilter = 'all';
      renderAccordion();
    });
    if(els.addOwnerRowBtn){
      els.addOwnerRowBtn.addEventListener('click', ()=>{ syncOwnerMapFromUi(); state.ownerMap.rows.push(emptyOwnerRow()); renderOwnerMapTable(); });
      els.saveOwnerMapBtn.addEventListener('click', ()=>{ syncOwnerMapFromUi(); saveOwnerMap(); renderOwnerMapTable(); rebuildAndRender(); setStatus('Owner mapping saved.'); });
      [els.ownerUtilityLabel, els.ownerUtilityUrl].forEach(el=> el && el.addEventListener('input', ()=>{ syncOwnerMapFromUi(); renderOwnerMapTable(); }));
      window.deleteOwnerMapRow = (idx)=>{ syncOwnerMapFromUi(); state.ownerMap.rows.splice(idx,1); renderOwnerMapTable(); };
    }
    // Image preview delegation — works from any PO row inside the accordion
    (els.accordionList || els.page)?.addEventListener('click', (event)=>{
      const btn = event.target.closest('[data-po-image]');
      if(!btn) return;
      event.preventDefault();
      openImagePreview(btn.getAttribute('data-po-title') || 'PO Image', btn.getAttribute('data-po-image') || '');
    });
    document.getElementById('sordImageCloseBtn')?.addEventListener('click', closeImagePreview);
    document.getElementById('sordImageOverlay')?.addEventListener('click', (event)=>{
      if(event.target && event.target.id === 'sordImageOverlay') closeImagePreview();
    });
    // Type pill delegation (works for both static HTML pills and any dynamically added ones)
    els.page?.addEventListener('click', (event)=>{
      const pill = event.target.closest('[data-type-filter]');
      if(!pill) return;
      state.activeTypeFilter = pill.getAttribute('data-type-filter') || 'all';
      renderAccordion();
    });
    window.selectSordRecord = (key)=>{
      state.expandedKey = key;
      renderAccordion();
      requestAnimationFrame(()=>{
        const el = document.getElementById('sord-acc-' + key);
        if(el) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
      });
    };
  }

  async function initialize(){
    normalizeOwnerMap();
    bind();
    renderOwnerMapTable();
    setStatus('Loading saved SORD imports...');
    state.imports = await loadPersistedImports();
    rebuildAndRender();
    if(state.imports.importedAt){
      const counts = state.imports.counts || {};
      setStatus(`Loaded saved SORD imports from ${fmtDate(state.imports.importedAt)} • Queue rows: ${fmtInt(counts.queue || state.imports.queueRows.length)} • Revenue rows: ${fmtInt(counts.revenue || state.imports.revenueRows.length)} • EOM rows: ${fmtInt(counts.eom || state.imports.eomRows.length)}${summarizeFileNames() ? ' • ' + summarizeFileNames() : ''}.`);
    } else {
      setStatus('No SORD imports loaded yet. You can still see live queue / assembly matches after importing at least one report.');
    }
  }

  initialize().catch(error => {
    console.error(error);
    rebuildAndRender();
    setStatus(error?.message || 'Could not load saved SORD imports.', true);
  });

  document.addEventListener('click', (event) => {
    const filterBtn = event.target.closest('[data-po-filter]');
    if (!filterBtn) return;
    state.poCategoryFilter = filterBtn.getAttribute('data-po-filter') || 'all';
    renderAccordion();
  });


  // ── Helper functions (moved inside IIFE for scope) ──────────────
  function numberFromLoose(value) {
      if (value === null || value === undefined || value === '') return 0;
      const n = Number(String(value).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
  
    function classifyPoCategory(po) {
      const statusText = String(po.status || '').toLowerCase();
      const descText = [
        po.purchaseOrderName,
        po.accountProductName,
        po.notes,
        po.clientName,
        po.supplier
      ].filter(Boolean).join(' ').toLowerCase();
  
      const packCount =
        numberFromLoose(po.totalPackItems) +
        numberFromLoose(po.packItems) +
        numberFromLoose(po.packCount);
  
      const bulkCount =
        numberFromLoose(po.totalBulkProducts) +
        numberFromLoose(po.bulkProducts) +
        numberFromLoose(po.bulkCount);
  
      const hintsPack = /pack item|pack items|packbuilder|pack builder|kitting|kit/i.test(statusText + ' ' + descText);
      const hintsBulk = /bulk|loose item|loose items|individual/i.test(statusText + ' ' + descText);
  
      const hasPack = packCount > 0 || hintsPack;
      const hasBulk = bulkCount > 0 || hintsBulk;
  
      if (hasPack && hasBulk) return 'mix';
      if (hasPack) return 'pack';
      if (hasBulk) return 'bulk';
      return 'mix';
    }
  
    function getFilteredPurchaseOrders(purchaseOrders, filterValue) {
      const tagged = (purchaseOrders || []).map(po => ({
        ...po,
        categoryTag: po.categoryTag || classifyPoCategory(po)
      }));
      if (!filterValue || filterValue === 'all') return tagged;
      return tagged.filter(po => po.categoryTag === filterValue);
    }
  
    function purchaseOrderCategoryCounts(purchaseOrders) {
      const counts = { all: 0, pack: 0, bulk: 0, mix: 0 };
      (purchaseOrders || []).forEach(po => {
        const tag = po.categoryTag || classifyPoCategory(po);
        counts.all += 1;
        if (counts[tag] !== undefined) counts[tag] += 1;
      });
      return counts;
    }
  
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

  window.importSordSharedFiles = importSharedFiles;
  window.clearSordSharedImports = clearSharedImports;
})()
