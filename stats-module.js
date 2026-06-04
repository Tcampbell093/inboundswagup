/* =========================================================================
   stats-module.js — Trends tab for the inbound module.

   Renders the Trends page (#page-stats) from /.netlify/functions/ops-metrics.
   Exposes window.renderStatsPage(), called by app.js when the Trends tab is
   opened (lazy). Uses Chart.js (loaded via CDN in workflow.html).

   Graphs degrade gracefully: a dataset with too little history shows a
   "building history" note instead of an empty/misleading chart.
   ========================================================================= */
(function () {
  'use strict';

  const API = '/.netlify/functions/ops-metrics';
  const charts = {};            // canvasId -> Chart instance (destroyed before redraw)
  let lastRangeDays = 180;
  let inFlight = false;

  function el(id) { return document.getElementById(id); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function dstr(v) { return String(v == null ? '' : v).slice(0, 10); } // YYYY-MM-DD

  // Pull the most recent value for a (area, metric, dimension) from daily_metrics.
  function latestMetric(daily, area, metric, dimension) {
    let best = null;
    for (const r of daily) {
      if (r.area === area && r.metric === metric && r.dimension === dimension) {
        if (!best || dstr(r.snapshot_date) > dstr(best.snapshot_date)) best = r;
      }
    }
    return best ? num(best.value) : null;
  }

  // Build a date-indexed series for a (area, metric, dimension) from daily_metrics.
  function metricSeries(daily, area, metric, dimension) {
    return daily
      .filter(r => r.area === area && r.metric === metric && r.dimension === dimension)
      .map(r => ({ x: dstr(r.snapshot_date), y: num(r.value) }))
      .sort((a, b) => a.x.localeCompare(b.x));
  }

  function setCard(id, value, fmt) {
    const node = el(id);
    if (!node) return;
    if (value == null) { node.textContent = '—'; return; }
    node.textContent = fmt === 'money'
      ? '$' + Math.round(value).toLocaleString()
      : Math.round(value).toLocaleString();
  }

  // Render (or note) a chart. cfgFn returns a Chart.js config, or null to show
  // the "not enough data" placeholder in the panel instead.
  function draw(canvasId, noteId, hasData, cfgFn, emptyMsg) {
    const canvas = el(canvasId);
    const note = el(noteId);
    if (charts[canvasId]) { charts[canvasId].destroy(); delete charts[canvasId]; }
    if (!canvas) return;
    if (!hasData) {
      canvas.style.display = 'none';
      if (note) { note.style.display = 'block'; note.textContent = emptyMsg || 'No data captured yet — this fills in as the daily snapshot runs.'; }
      return;
    }
    canvas.style.display = 'block';
    if (note) note.style.display = 'none';
    charts[canvasId] = new Chart(canvas.getContext('2d'), cfgFn());
  }

  const COLORS = {
    blue: '#2a7fd4', navy: '#12324a', green: '#0a7c4e', amber: '#d99100',
    purple: '#7b5cd6', red: '#cc4b4b', gray: '#90a4b8',
  };

  function lineCfg(labels, datasets, opts) {
    return {
      type: 'line',
      data: { labels, datasets },
      options: Object.assign({
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
        scales: { x: { grid: { display: false } } },
      }, opts || {}),
    };
  }

  function renderCharts(data) {
    const daily = Array.isArray(data.daily_metrics) ? data.daily_metrics : [];
    const sord = Array.isArray(data.sord) ? data.sord : [];
    const events = Array.isArray(data.pallet_events) ? data.pallet_events : [];
    const prod = Array.isArray(data.productivity) ? data.productivity : [];

    // ── Snapshot cards (latest captured values) ──
    setCard('statsCardOverstock', latestMetric(daily, 'overstock', 'units_active', '__total__'));
    const pallets = latestMetric(daily, 'inbound', 'pallets', '__total__');
    setCard('statsCardPallets', pallets);
    setCard('statsCardHeadcount', latestMetric(daily, 'attendance', 'headcount', '__total__'));
    const lastSord = sord.length ? sord[sord.length - 1] : null;
    setCard('statsCardPipelineUnits', lastSord ? num(lastSord.units) : null);
    setCard('statsCardPipelineValue', lastSord ? num(lastSord.subtotal) : null, 'money');

    // ── 1. Order pipeline — units + $ over time (dual axis) ──
    draw('statsChartPipeline', 'statsNotePipeline', sord.length >= 2, () => {
      const labels = sord.map(r => dstr(r.snapshot_date));
      return lineCfg(labels, [
        { label: 'Units', data: sord.map(r => num(r.units)), borderColor: COLORS.blue, backgroundColor: COLORS.blue, tension: .25, yAxisID: 'y' },
        { label: 'Value ($)', data: sord.map(r => num(r.subtotal)), borderColor: COLORS.green, backgroundColor: COLORS.green, tension: .25, yAxisID: 'y1' },
      ], {
        scales: {
          x: { grid: { display: false } },
          y:  { position: 'left',  title: { display: true, text: 'Units' } },
          y1: { position: 'right', title: { display: true, text: '$' }, grid: { drawOnChartArea: false } },
        },
      });
    }, 'Order pipeline has only ' + sord.length + ' day(s) so far — a line appears at 2+.');

    // ── 2. Inbound activity — events per day, stacked by type ──
    const dayset = [...new Set(events.map(e => dstr(e.day)))].sort();
    const types = [...new Set(events.map(e => e.event_type))];
    const palette = [COLORS.blue, COLORS.green, COLORS.amber, COLORS.purple, COLORS.red, COLORS.navy, COLORS.gray];
    draw('statsChartInbound', 'statsNoteInbound', dayset.length >= 1 && types.length >= 1, () => {
      const datasets = types.map((tp, i) => ({
        label: tp,
        data: dayset.map(d => events.filter(e => dstr(e.day) === d && e.event_type === tp).reduce((s, e) => s + num(e.count), 0)),
        backgroundColor: palette[i % palette.length],
      }));
      return {
        type: 'bar',
        data: { labels: dayset, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, title: { display: true, text: 'Events' } } },
        },
      };
    }, 'No pallet activity recorded in this window yet.');

    // ── 3. Productivity — units touched + cost-per-unit (dual axis) ──
    draw('statsChartProductivity', 'statsNoteProductivity', prod.length >= 2, () => {
      const labels = prod.map(r => dstr(r.record_date));
      return lineCfg(labels, [
        { label: 'Units touched', data: prod.map(r => num(r.total_touched_units)), borderColor: COLORS.blue, backgroundColor: COLORS.blue, tension: .25, yAxisID: 'y' },
        { label: 'Cost / unit ($)', data: prod.map(r => num(r.cpu_touched)), borderColor: COLORS.amber, backgroundColor: COLORS.amber, tension: .25, yAxisID: 'y1' },
      ], {
        scales: {
          x: { grid: { display: false } },
          y:  { position: 'left',  title: { display: true, text: 'Units' } },
          y1: { position: 'right', title: { display: true, text: '$/unit' }, grid: { drawOnChartArea: false } },
        },
      });
    }, 'Productivity has only ' + prod.length + ' day(s) — import more payroll data to extend it.');

    // ── 4. Overstock units on shelf over time (from daily capture) ──
    const osSeries = metricSeries(daily, 'overstock', 'units_active', '__total__');
    draw('statsChartOverstock', 'statsNoteOverstock', osSeries.length >= 2, () =>
      lineCfg(osSeries.map(p => p.x), [
        { label: 'Active units', data: osSeries.map(p => p.y), borderColor: COLORS.purple, backgroundColor: COLORS.purple, tension: .25, fill: false },
      ], { scales: { x: { grid: { display: false } }, y: { title: { display: true, text: 'Units' } } } }),
      'Overstock history is being captured daily — a trend line appears after a couple of days.');

    // ── 5. Headcount over time (from daily capture) ──
    const hcSeries = metricSeries(daily, 'attendance', 'headcount', '__total__');
    draw('statsChartHeadcount', 'statsNoteHeadcount', hcSeries.length >= 2, () =>
      lineCfg(hcSeries.map(p => p.x), [
        { label: 'Headcount', data: hcSeries.map(p => p.y), borderColor: COLORS.navy, backgroundColor: COLORS.navy, tension: .25, fill: false },
      ], { scales: { x: { grid: { display: false } }, y: { title: { display: true, text: 'People' }, beginAtZero: true } } }),
      'Headcount history is being captured daily — a trend line appears after a couple of days.');
  }

  function setStatus(msg, isError) {
    const s = el('statsStatus');
    if (!s) return;
    s.textContent = msg || '';
    s.style.color = isError ? '#cc4b4b' : 'var(--muted)';
  }

  async function load() {
    if (inFlight) return;
    if (typeof Chart === 'undefined') { setStatus('Charts library still loading — try again in a moment.', true); return; }
    inFlight = true;
    setStatus('Loading…');
    try {
      const res = await fetch(API + '?days=' + lastRangeDays, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      renderCharts(data);
      const gen = data.generated_at ? new Date(data.generated_at).toLocaleString() : '';
      setStatus('Updated ' + gen);
    } catch (e) {
      setStatus('Could not load stats: ' + e.message, true);
    } finally {
      inFlight = false;
    }
  }

  // Public entry point — called by app.js when the Trends tab opens.
  window.renderStatsPage = function () {
    // Wire controls once.
    const rangeSel = el('statsRange');
    if (rangeSel && !rangeSel.dataset.bound) {
      rangeSel.dataset.bound = '1';
      rangeSel.addEventListener('change', () => { lastRangeDays = Number(rangeSel.value) || 180; load(); });
    }
    const refreshBtn = el('statsRefresh');
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', load);
    }
    load();
  };
})();
