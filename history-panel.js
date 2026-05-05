(function () {
  'use strict';

  const HISTORY_API = '/.netlify/functions/history';

  let _currentSearch = null;
  let _currentOffset = 0;
  let _currentTotal  = 0;

  // ── Action labels & colors ──────────────────────────────────────
  const ACTION_LABELS = {
    created:       'Added',
    updated:       'Edited',
    deleted:       'Removed',
    stage_change:  'Stage Changed',
    scheduled:     'Scheduled',
    unscheduled:   'Returned to Queue',
    hold_added:    'Put on Hold',
    hold_released: 'Released from Hold',
    hold_removed:  'Hold Deleted',
    error_logged:  'Error Logged',
    error_deleted: 'Error Deleted',
    imported:      'Imported',
  };

  const ACTION_COLORS = {
    created:       '#0a6640',
    updated:       '#0c447c',
    deleted:       '#8b1a1a',
    stage_change:  '#4a1e8c',
    scheduled:     '#185fa5',
    unscheduled:   '#633806',
    hold_added:    '#7c4200',
    hold_released: '#0a6640',
    hold_removed:  '#8b1a1a',
    error_logged:  '#7c1e00',
    error_deleted: '#8b1a1a',
    imported:      '#185fa5',
  };

  const ENTITY_LABELS = {
    pack_builder: 'Pack Builder',
    sales_order:  'Sales Order',
    po:           'Purchase Order',
    employee:     'Employee',
    account:      'Account',
    error_record: 'Error Record',
  };

  // ── Render helpers ──────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    } catch (_) { return iso; }
  }

  function fmtKey(k) {
    return String(k).replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
  }

  function renderDiff(before, after) {
    if (!before && !after) return '';
    if (!before) {
      // created — show after fields
      const lines = Object.entries(after || {})
        .filter(([,v]) => v !== null && v !== undefined && v !== '')
        .map(([k,v]) => `<div class="hist-diff-row hist-diff-add"><span class="hist-diff-key">${esc(fmtKey(k))}</span><span class="hist-diff-val">${esc(v)}</span></div>`);
      return lines.length ? `<div class="hist-diff">${lines.join('')}</div>` : '';
    }
    if (!after) {
      const lines = Object.entries(before || {})
        .filter(([,v]) => v !== null && v !== undefined && v !== '')
        .map(([k,v]) => `<div class="hist-diff-row hist-diff-del"><span class="hist-diff-key">${esc(fmtKey(k))}</span><span class="hist-diff-val">${esc(v)}</span></div>`);
      return lines.length ? `<div class="hist-diff">${lines.join('')}</div>` : '';
    }
    // show changed fields only
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const lines = [];
    allKeys.forEach(k => {
      const bv = before[k], av = after[k];
      const bStr = (bv === null || bv === undefined) ? '' : String(bv);
      const aStr = (av === null || av === undefined) ? '' : String(av);
      if (bStr === aStr) return;
      lines.push(
        `<div class="hist-diff-row">` +
        `<span class="hist-diff-key">${esc(fmtKey(k))}</span>` +
        `<span class="hist-diff-val hist-diff-del">${esc(bStr || '—')}</span>` +
        `<span class="hist-diff-arrow">→</span>` +
        `<span class="hist-diff-val hist-diff-add">${esc(aStr || '—')}</span>` +
        `</div>`
      );
    });
    return lines.length ? `<div class="hist-diff">${lines.join('')}</div>` : '';
  }

  function renderEntry(e) {
    const action = e.action || 'updated';
    const label  = ACTION_LABELS[action] || action;
    const color  = ACTION_COLORS[action] || '#555';
    const eLabel = ENTITY_LABELS[e.entity_type] || e.entity_type || '';
    const diff   = renderDiff(e.before_data, e.after_data);
    const related = (e.related_type && e.related_id)
      ? `<span class="hist-related">via ${esc(ENTITY_LABELS[e.related_type] || e.related_type)} <strong>${esc(e.related_id)}</strong></span>`
      : '';
    const sfLink = e.salesforce_id
      ? `<a class="hist-sf-link" href="https://swagup.lightning.force.com/${esc(e.salesforce_id)}" target="_blank" rel="noopener">Open in SF ↗</a>`
      : '';
    const note = e.note ? `<div class="hist-note">${esc(e.note)}</div>` : '';

    return `
      <div class="hist-entry">
        <div class="hist-entry-header">
          <span class="hist-action-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${esc(label)}</span>
          <span class="hist-entity-label">${esc(eLabel)} <strong>${esc(e.entity_id)}</strong></span>
          ${related}
          ${sfLink}
          <span class="hist-timestamp">${fmtDate(e.changed_at)}</span>
          <span class="hist-by">by ${esc(e.changed_by || '—')}</span>
        </div>
        ${diff}
        ${note}
      </div>`;
  }

  // ── Search ──────────────────────────────────────────────────────
  async function runSearch(offset) {
    offset = offset || 0;
    const typeEl  = document.getElementById('historyEntityType');
    const idEl    = document.getElementById('historyEntityId');
    const fromEl  = document.getElementById('historyFrom');
    const toEl    = document.getElementById('historyTo');
    const results = document.getElementById('historyResults');
    const moreBtn = document.getElementById('historyLoadMore');
    const status  = document.getElementById('historyStatus');

    if (!results) return;

    const entityType = typeEl  ? typeEl.value.trim()  : '';
    const entityId   = idEl    ? idEl.value.trim()    : '';
    const from       = fromEl  ? fromEl.value.trim()  : '';
    const to         = toEl    ? toEl.value.trim()    : '';

    _currentSearch = { entityType, entityId, from, to };
    _currentOffset = offset;

    const params = new URLSearchParams({ limit: 50, offset });
    if (entityType && entityId) {
      params.set('entity_type', entityType);
      params.set('entity_id',   entityId);
      params.set('include_related', 'true');
    } else if (entityId) {
      params.set('search', entityId);
    } else if (entityType) {
      params.set('entity_type', entityType);
    }
    if (from) params.set('from', from);
    if (to)   params.set('to',   to + 'T23:59:59Z');

    if (status) status.textContent = 'Searching…';
    if (offset === 0) results.innerHTML = '';

    try {
      const r = await fetch(HISTORY_API + '?' + params.toString());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();

      _currentTotal = data.total || 0;

      if (offset === 0 && !data.entries.length) {
        results.innerHTML = '<div class="hist-empty">No history found for this search.</div>';
        if (moreBtn) moreBtn.style.display = 'none';
        if (status) status.textContent = '0 results';
        return;
      }

      const html = data.entries.map(renderEntry).join('');
      if (offset === 0) results.innerHTML = html;
      else results.insertAdjacentHTML('beforeend', html);

      const loaded = offset + data.entries.length;
      if (status) status.textContent = `Showing ${loaded.toLocaleString()} of ${_currentTotal.toLocaleString()}`;
      if (moreBtn) moreBtn.style.display = loaded < _currentTotal ? 'block' : 'none';
    } catch (err) {
      if (offset === 0) results.innerHTML = '<div class="hist-empty hist-error">Could not load history. Check your connection.</div>';
      if (status) status.textContent = 'Error';
    }
  }

  function loadMoreHistory() {
    runSearch(_currentOffset + 50);
  }

  // ── Deep-link: open history page pre-filled ─────────────────────
  function openHistoryFor(entityType, entityId) {
    const typeEl = document.getElementById('historyEntityType');
    const idEl   = document.getElementById('historyEntityId');
    if (typeEl) typeEl.value = entityType || '';
    if (idEl)   idEl.value   = entityId   || '';
    if (window.goToPage) window.goToPage('historyPage');
    runSearch(0);
  }

  // ── Init ────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const searchBtn = document.getElementById('historySearchBtn');
    const idInput   = document.getElementById('historyEntityId');
    if (searchBtn) searchBtn.addEventListener('click',  function () { runSearch(0); });
    if (idInput)   idInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runSearch(0); });

    const moreBtn = document.getElementById('historyLoadMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', loadMoreHistory);
  });

  window.searchHistoryPanel  = function () { runSearch(0); };
  window.loadMoreHistory     = loadMoreHistory;
  window.openHistoryFor      = openHistoryFor;
})();
