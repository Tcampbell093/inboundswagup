(function () {
  'use strict';

  const HISTORY_API  = '/.netlify/functions/history';
  const BATCH_DELAY  = 1500;
  const MAX_BATCH    = 50;

  let pending = [];
  let timer   = null;

  function currentUser() {
    try {
      const u = window.hcCurrentUser;
      return (u && (u.name || u.email)) || null;
    } catch (_) { return null; }
  }

  function flush() {
    timer = null;
    if (!pending.length) return;
    const batch = pending.splice(0, MAX_BATCH);
    fetch(HISTORY_API, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify(batch),
      keepalive: true,
    }).catch(function () {});
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(flush, BATCH_DELAY);
  }

  // Canonical entity type resolver — collapses known aliases
  const ENTITY_ALIASES = {
    po: 'po', ponumber: 'po', ponum: 'po', poid: 'po', purchaseorderid: 'po', purchaseordername: 'po',
    pack_builder: 'pack_builder', pb: 'pack_builder', packbuilder: 'pack_builder',
    sales_order: 'sales_order', so: 'sales_order', sord: 'sales_order', salesorder: 'sales_order', salesorderid: 'sales_order',
    employee: 'employee', associate: 'employee',
    account: 'account',
    error_record: 'error_record',
  };

  function canonicalType(raw) {
    if (!raw) return raw;
    return ENTITY_ALIASES[String(raw).toLowerCase().replace(/[^a-z0-9]/g, '_')] || raw;
  }

  function logHistory(entry) {
    if (!entry || !entry.entity_type || !entry.entity_id) return;
    pending.push({
      entity_type:   canonicalType(entry.entity_type),
      entity_id:     String(entry.entity_id).trim(),
      salesforce_id: entry.salesforce_id || null,
      action:        entry.action        || 'updated',
      changed_by:    entry.changed_by    || currentUser() || 'unknown',
      changed_at:    entry.changed_at    || new Date().toISOString(),
      before_data:   entry.before_data   != null ? entry.before_data  : null,
      after_data:    entry.after_data    != null ? entry.after_data   : null,
      related_type:  entry.related_type  ? canonicalType(entry.related_type) : null,
      related_id:    entry.related_id    ? String(entry.related_id).trim()   : null,
      note:          entry.note          || null,
    });
    schedule();
  }

  async function fetchHistory(entityType, entityId, opts) {
    opts = opts || {};
    const p = new URLSearchParams({
      entity_type: canonicalType(entityType),
      entity_id:   entityId,
      limit:       opts.limit  || 100,
      offset:      opts.offset || 0,
    });
    if (opts.includeRelated) p.set('include_related', 'true');
    if (opts.from) p.set('from', opts.from);
    if (opts.to)   p.set('to',   opts.to);
    const r = await fetch(HISTORY_API + '?' + p.toString());
    if (!r.ok) throw new Error('History fetch failed (' + r.status + ')');
    return r.json();
  }

  async function searchHistory(query, opts) {
    opts = opts || {};
    const p = new URLSearchParams({ search: query, limit: opts.limit || 100, offset: opts.offset || 0 });
    if (opts.entityType) p.set('entity_type', canonicalType(opts.entityType));
    if (opts.from) p.set('from', opts.from);
    if (opts.to)   p.set('to',   opts.to);
    const r = await fetch(HISTORY_API + '?' + p.toString());
    if (!r.ok) throw new Error('History search failed (' + r.status + ')');
    return r.json();
  }

  // Flush remaining entries before the page unloads
  window.addEventListener('beforeunload', flush);

  window.logHistory     = logHistory;
  window.fetchHistory   = fetchHistory;
  window.searchHistory  = searchHistory;
  window.canonicalHistoryType = canonicalType;
})();
