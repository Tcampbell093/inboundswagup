// ===== HOUSTON CONTROL — HELP SYSTEM =====
// Injects ℹ tooltip triggers next to every major feature label.
// Powers the full Help page with search.

(function () {

  // ── Tooltip content registry ─────────────────────────────────────────────
  // Each entry: { title, body, page (optional nav target) }
  const TIPS = {

    // ── Home / Mission Control ─────────────────────────────────────────────
    'attendance-health': {
      title: 'Attendance Health',
      body: 'Shows today\'s attendance snapshot — how many associates are Present, Late, or Absent across all departments. Color-coded green / yellow / red based on headcount thresholds. Click to jump to the full Attendance page.',
      page: 'attendancePage'
    },
    'inbound-health': {
      title: 'Inbound Health',
      body: 'Summarizes today\'s inbound throughput from Dock, Receiving, and Prep. Reflects the most recently logged entries. Click to open the QA Inbound workflow board.',
      page: 'workflowInboundPage'
    },
    'assembly-health': {
      title: 'Assembly Health',
      body: 'Live count of assembly units scheduled, in-progress, and completed today. Turns green when done units are healthy relative to the schedule. Click to jump to the Assembly planner.',
      page: 'assemblyPage'
    },
    'issue-health': {
      title: 'Issue Health',
      body: 'Count of open warehouse error records. A high number or recent unresolved errors turns this red. Click to open the Warehouse Errors log and investigate.',
      page: 'errorsPage'
    },
    'data-freshness': {
      title: 'Data Freshness',
      body: 'Tracks how recently any module\'s data was updated. Goes green within 2 hours, yellow up to 12 hours, red when stale. Helps you know if you\'re looking at current data or need to re-import. Click to go to the Import Hub.',
      page: 'importHubPage'
    },
    'today-output': {
      title: "Today's Output",
      body: 'Combined unit throughput across Assembly + Inbound for today. A quick pulse check of how much work has moved through the warehouse floor.'
    },
    'month-revenue': {
      title: 'Month Revenue',
      body: 'Tracks month-to-date revenue from your imported Monthly Revenue Estimate report, plus any SORDs your assembly team has completed (stage = Done) that aren\'t already in the imported report. No double-counting. Click to scroll to the full Revenue Tracker panel below.',
    },
    'dept-radar': {
      title: 'Department Radar',
      body: 'A live grid of every department\'s headcount and output today. Updates automatically as attendance is logged and assembly/inbound activity is recorded. Each tile shows present staff and throughput for that department.'
    },
    'priority-radar': {
      title: 'Priority Radar',
      body: 'Auto-generated list of items that need your attention right now — such as overdue IHDs, blocked SORDs, low headcount, or stale data. Calculated from live data across all modules. Not manually entered; the system surfaces it for you.'
    },
    'exception-center': {
      title: 'Exception Center',
      body: 'Highlights operational pressure points — things that are abnormal or at risk. Examples include orders with mismatched subtotals, pack builders missing PDFs, or SORDs with open QA cases. Review these to catch problems before they escalate.'
    },
    'timeline-pulse': {
      title: 'Timeline Pulse',
      body: 'A feed of recent PO traceability activity and edit history across the inbound workflow. Shows which POs have been touched multiple times or have edit corrections, useful for auditing data quality.'
    },
    'calendar-urgency': {
      title: 'Calendar + Urgency',
      body: 'Time-sensitive items sorted by their In-Hands Date (IHD). Shows what is due soonest so you can prioritize assembly scheduling. Pulls from both the imported SORD data and the live queue.'
    },
    'recent-changes': {
      title: 'Recent Changes',
      body: 'A log of the most recent policy updates, data imports, and system events. Useful for knowing what changed since you last logged in — who imported what, when policies were updated, and so on.'
    },
    'rev-tracker': {
      title: 'Monthly Revenue Tracker',
      body: 'Import your Monthly Revenue Estimate Salesforce report here to track month-to-date revenue. Set a goal (e.g. $2.5M) and the panel shows a progress bar, percentage to goal, and remaining amount. Assembly-completed SORDs (marked Done) are automatically added if they\'re not already in the imported report — no double-counting. The goal persists across sessions.',
    },

    // ── Import Hub ────────────────────────────────────────────────────────
    'import-hub': {
      title: 'Import Hub',
      body: 'The single place to load all Salesforce report exports into the app. Upload up to four report files at once — Queue/Assembly, Revenue Reference, SORD/PO Detail, and Monthly Revenue Estimate — and click Import. All modules read from these shared imports so you only have to do it once per session.',
      page: 'importHubPage'
    },
    'queue-report-input': {
      title: 'Queue / Assembly Report',
      body: 'Upload the Salesforce "Pack Builder Queue" report export (.xlsx). This feeds the Available Queue page (ready and incomplete pack builders) and the Daily Tools SORD dossier. Required columns: Pack Builder Name, Sales Order Name, Quantity, Total Unique Products, Status, Pack Builder ID.'
    },
    'revenue-report-input': {
      title: 'Revenue Report',
      body: 'Upload the Salesforce Revenue report export (.xlsx). This feeds the Queue\'s revenue reference lookup (used to show $ values on pack builders) and the Daily Tools revenue panel. Required columns: Sales Order Name, Subtotal, Original Subtotal, In Hands Date.'
    },
    'eom-report-input': {
      title: 'SORD / PO Detail Report',
      body: 'Upload the Salesforce SORD Summary / EOM detail report (.xlsx). This is the richest feed — it populates the Daily Tools dossier with per-item statuses, supplier names, estimated ship dates, PO numbers, and account product details. Required columns: Purchase Order Name, Status, Estimated Ship Date, Supplier Name, Sales Order Name.'
    },
    'rev-tracker-input': {
      title: 'Monthly Revenue Estimate',
      body: 'Upload the "This Month\'s Revenue Estimate" Salesforce report. Only rows with a Sales Order Name are counted. This feeds the Month Revenue tracker on the Home page. Columns used: Sales Order Name, Subtotal.'
    },

    // ── Assembly ──────────────────────────────────────────────────────────
    'assembly': {
      title: 'Assembly Daily Planner',
      body: 'The daily assembly board. Add pack builders from the queue (or manually), assign them to a date, then move them through stages: AA → Print → Picked → Line → DPMO → Done. When a row reaches Done, its revenue is added to the Month Revenue tracker automatically.',
      page: 'assemblyPage'
    },
    'assembly-stages': {
      title: 'Assembly Stages',
      body: 'Each pack builder moves through six stages:\n• AA — Awaiting assembly start\n• Print — Graphics / print stage\n• Picked — Items picked from shelves\n• Line — On the assembly line\n• DPMO — Final QA / DPMO check\n• Done — Complete. Revenue is now counted toward this month.'
    },
    'assembly-schedule': {
      title: '7-Day Lookahead',
      body: 'Shows pack builders scheduled for the next 7 days. Use this to plan headcount and ensure the schedule is realistic relative to your team\'s capacity. Pack builders scheduled here pull from the Available Queue.'
    },
    'build-notes': {
      title: 'Build Notes',
      body: 'A free-form notes area for each scheduled date. Use it to capture special instructions, custom build paths, material substitutions, or client-specific notes that the team needs to know before starting work.'
    },

    // ── Available Queue ───────────────────────────────────────────────────
    'queue': {
      title: 'Available Queue',
      body: 'All pack builders imported from Salesforce, split into Ready and Incomplete buckets. Ready = can be scheduled immediately. Incomplete = missing something (materials, approvals). You can star priority items, put them on Issue Hold, or schedule them to a date from here.',
      page: 'queuePage'
    },
    'queue-ready': {
      title: 'Ready Pack Builders',
      body: 'Pack builders whose status qualifies them for immediate assembly scheduling. Sorted by IHD (In-Hands Date) by default — earliest due first. Use ⭐ Priority to flag urgent ones, Schedule to push to the Assembly planner, or Hold to park a pack builder with a note.'
    },
    'queue-incomplete': {
      title: 'Incomplete / Pending Pack Builders',
      body: 'Pack builders that exist in Salesforce but aren\'t ready yet — e.g. items not yet received, proofs pending, or partial orders. Imported alongside ready pack builders so you have full visibility. They move to Ready automatically on the next import if their status changes.'
    },
    'queue-scheduled': {
      title: 'Scheduled Pack Builders',
      body: 'Pack builders you have assigned to a specific assembly date. These feed the Assembly Daily Planner. The date you assign here becomes the planned production date. You can reschedule or unschedule at any time.'
    },
    'issue-hold': {
      title: 'Issue Hold',
      body: 'A holding area for pack builders you\'ve flagged as having a problem — wrong items received, client change, QA issue, etc. Held items are removed from the Ready queue so they don\'t get accidentally scheduled. Add a note explaining the hold when you set it.'
    },

    // ── Daily Tools / SORD ───────────────────────────────────────────────
    'sord': {
      title: 'Daily Tools Dossier',
      body: 'A cross-referenced view of every active SORD (Sales Order), combining data from your Queue import, Revenue import, and SORD/PO Detail import. Click any SORD in the explorer list to open its full dossier on the right.',
      page: 'sordPage'
    },
    'sord-explorer': {
      title: 'SORD Explorer',
      body: 'The searchable, filterable list of all SORDs. Filter by Status, Readiness, Complexity, Risk flags, or the Confirmed Revenue filter. Click a row to open that SORD\'s dossier. Shows up to 250 results at once.'
    },
    'sord-status-filter': {
      title: 'Status Filter',
      body: 'Filter the SORD list to a specific Salesforce order status (e.g. PO Complete, Mission Complete, Partial PO). Populated dynamically from your imported data.'
    },
    'sord-readiness-filter': {
      title: 'Readiness Filter',
      body: 'Filter by the system-calculated readiness score:\n• Ready — has a pack builder, revenue, and a clean status\n• Partially Ready — has some components but not all\n• Needs Review — missing key data\n• Blocked — a case, hold, or exception is blocking progress'
    },
    'sord-complexity-filter': {
      title: 'Complexity Filter',
      body: 'Filter by complexity score (Low / Medium / High). Complexity is calculated from the number of POs, suppliers, pack builders, line items, and total quantity. High complexity orders need more coordination and oversight.'
    },
    'sord-risk-filter': {
      title: 'Risk / Flags Filter',
      body: 'Filter to only Flagged SORDs (at least one automated warning) or only clean SORDs (No Flags). Flags are generated by the system when it detects issues like mismatched subtotals, missing owners, late ETAs, or open QA cases.'
    },
    'sord-confirmed-filter': {
      title: 'Confirmed Revenue This Month',
      body: 'Conservative filter that shows only SORDs where every required item is in a confirmed-completable state for the current calendar month.\n\n✅ PASS: QA Approved, Fully Received, PO Complete\n✅ PASS: Partially Received (item is in-house)\n✅ CONDITIONAL: Ship Date Confirmed — only if the confirmed ship date falls within this month\n\n❌ FAIL: Supplier Acknowledged, Client Approved, Pending Ship Date, Production Delay, QA Cases, or any uncertain status\n\nThe "Confirmed This Month" stat card always shows the total even when the filter is off — so you can see the number at a glance.'
    },
    'sord-dossier': {
      title: 'SORD Dossier',
      body: 'The detailed view for a selected SORD. Shows all data combined from your imports: status badges, revenue, readiness, flags, pack builders, purchase orders, suppliers, timeline, and financials. The "Confirmed This Month" badge shows whether this specific SORD passes the conservative completability test.'
    },
    'sord-flags': {
      title: 'Risk & Blockers — Flags',
      body: 'Automatically generated warnings for this SORD. Examples:\n• Revenue exists but no pack builder found\n• Multiple suppliers on one order\n• Estimated ship date has already passed\n• Subtotal differs from original subtotal\n• Missing owner fields\n\nFlags are informational — they surface risk, they do not block operations.'
    },
    'sord-pack-builders': {
      title: 'Pack Builders Panel',
      body: 'All pack builders associated with this SORD across all data sources (queue import, assembly board, scheduled). Shows status, units, IHD, assembly stage, and a direct link to the pack builder PDF in Salesforce.'
    },
    'sord-revenue-panel': {
      title: 'Revenue Panel',
      body: 'The financial view for this SORD: subtotal, original subtotal, invoice total, item cost, gross spread, and margin %. The margin estimate is approximate — based on imported subtotal vs. item cost from the PO data.'
    },
    'sord-timeline': {
      title: 'Lifecycle Timeline',
      body: 'Key dates for this SORD in chronological order: Sales order created → PO created → Due date → Estimated ship dates → In-Hands Date → Scheduled assembly date. Useful for understanding lead time and identifying where a SORD is in its lifecycle.'
    },
    'sord-po-detail': {
      title: 'POs & Suppliers',
      body: 'All purchase orders tied to this SORD. Each PO shows its supplier, printer, estimated ship date, status, account product, quantity, and item cost. Filter by Pack Items, Bulk Products, or Mix using the category chips.'
    },
    'sord-account-products': {
      title: 'Account Products (Item Layer)',
      body: 'The individual product items within this SORD, grouped by account product ID. Shows which suppliers are handling each item, the quantity, cost, and which POs cover it. Useful for tracing a specific item across multiple POs.'
    },
    'sord-owner-map': {
      title: 'Owner Mapping',
      body: 'A configurable lookup that maps account owners to Account Managers and Project Managers. Set this up once per account and it will display on every SORD for that owner. You can also set a custom utility link (e.g. a Slack channel or project tracker) per account.'
    },
    'sord-top-stats': {
      title: 'SORD Summary Stats',
      body: 'The stat bar above the SORD explorer. Always reflects the current filtered view:\n• SORDs — count of visible orders\n• Revenue — sum of subtotals\n• Confirmed This Month — revenue from SORDs where all items are confirmed completable\n• Blocked — orders with a Blocked readiness score\n• High Complexity — orders scored as high complexity\n• Risk Flags — total flag count across visible SORDs'
    },

    // ── Attendance ────────────────────────────────────────────────────────
    'attendance': {
      title: 'Attendance',
      body: 'Log and review daily attendance for every warehouse associate. Mark each person Present, Late, Absent, Call Out, or No Call No Show. The system tracks patterns, computes attendance health, and feeds the home page radar. Employee roster is managed in the Settings tab.',
      page: 'attendancePage'
    },

    // ── Warehouse Errors ──────────────────────────────────────────────────
    'errors': {
      title: 'Warehouse Errors',
      body: 'A structured log for capturing warehouse mistakes — pick errors, wrong items packed, damaged goods, mislabeled shipments, etc. Each entry captures the associate, error type, SORD/order reference, and resolution. Used to track patterns and hold associates accountable.',
      page: 'errorsPage'
    },

    // ── Calendar ──────────────────────────────────────────────────────────
    'calendar': {
      title: 'Planning Calendar',
      body: 'A monthly calendar view of all scheduled pack builder assembly dates. Dates with scheduled work show a unit count. Click a date to see what\'s planned. Useful for capacity planning — spread work evenly and avoid overloading any single day.',
      page: 'calendarPage'
    },

    // ── Policy ────────────────────────────────────────────────────────────
    'policy': {
      title: 'Policy & SOP Library',
      body: 'A searchable library of warehouse policies, standard operating procedures, and reference documents. Add individual policy entries (quick text rules) or import full SOP documents. Associates can search by keyword. Policies display in a preview pane on the right.',
      page: 'policyPage'
    },

    // ── Returns ───────────────────────────────────────────────────────────
    'returns': {
      title: 'Returns Desk',
      body: 'Log and track inbound returns from clients. Scan or enter the order reference, log the condition and reason for return, and track resolution. The returns log is searchable and timestamped. Today\'s return count appears on the quick pulse card.',
      page: 'returnsPage'
    },

    // ── QA Inbound ────────────────────────────────────────────────────────
    'qa-inbound': {
      title: 'QA Inbound Workflow',
      body: 'The embedded inbound workflow board for Dock, Receiving, Prep, Overstock, and Putaway. Associates log what was received, quantities, and any discrepancies. This data feeds the home page Inbound Health card and the Department Radar.',
      page: 'workflowInboundPage'
    },

  };

  // ── Help page article content ─────────────────────────────────────────────
  const HELP_SECTIONS = [
    {
      heading: 'Getting Started',
      articles: [
        {
          id: 'import-hub',
          title: 'How to import data',
          body: 'Go to Import Hub in the sidebar. Upload your Salesforce report exports — Queue/Assembly, Revenue Reference, SORD/PO Detail, and Monthly Revenue Estimate. Click "Import Selected Files". All modules read from these shared imports, so you only need to do it once per session (or whenever Salesforce data changes).'
        },
        {
          id: 'data-flow',
          title: 'How data flows through the app',
          body: 'Queue report → Available Queue + Daily Tools pack builder view\nRevenue report → Queue revenue reference + Daily Tools financials\nSORD/PO Detail → Daily Tools dossier (statuses, suppliers, ETAs, POs)\nMonthly Revenue Estimate → Home page Month Revenue tracker\n\nAll data lives in your browser\'s local storage — nothing is sent to a server except the Netlify backend sync for attendance and employees.'
        },
      ]
    },
    {
      heading: 'Home — Mission Control',
      articles: [
        { id: 'attendance-health',    title: 'Attendance Health card',       body: TIPS['attendance-health'].body },
        { id: 'inbound-health',       title: 'Inbound Health card',          body: TIPS['inbound-health'].body },
        { id: 'assembly-health',      title: 'Assembly Health card',         body: TIPS['assembly-health'].body },
        { id: 'issue-health',         title: 'Issue Health card',            body: TIPS['issue-health'].body },
        { id: 'data-freshness',       title: 'Data Freshness card',          body: TIPS['data-freshness'].body },
        { id: 'today-output',         title: "Today's Output card",          body: TIPS['today-output'].body },
        { id: 'month-revenue',        title: 'Month Revenue card',           body: TIPS['month-revenue'].body },
        { id: 'dept-radar',           title: 'Department Radar',             body: TIPS['dept-radar'].body },
        { id: 'priority-radar',       title: 'Priority Radar',               body: TIPS['priority-radar'].body },
        { id: 'exception-center',     title: 'Exception Center',             body: TIPS['exception-center'].body },
        { id: 'timeline-pulse',       title: 'Timeline Pulse',               body: TIPS['timeline-pulse'].body },
        { id: 'calendar-urgency',     title: 'Calendar + Urgency',           body: TIPS['calendar-urgency'].body },
        { id: 'rev-tracker',          title: 'Monthly Revenue Tracker',      body: TIPS['rev-tracker'].body },
      ]
    },
    {
      heading: 'Import Hub',
      articles: [
        { id: 'queue-report-input',   title: 'Queue / Assembly report',      body: TIPS['queue-report-input'].body },
        { id: 'revenue-report-input', title: 'Revenue report',               body: TIPS['revenue-report-input'].body },
        { id: 'eom-report-input',     title: 'SORD / PO Detail report',      body: TIPS['eom-report-input'].body },
        { id: 'rev-tracker-input',    title: 'Monthly Revenue Estimate',     body: TIPS['rev-tracker-input'].body },
      ]
    },
    {
      heading: 'Assembly Workflow',
      articles: [
        { id: 'assembly',             title: 'Assembly Daily Planner',       body: TIPS['assembly'].body },
        { id: 'assembly-stages',      title: 'Assembly Stages (AA → Done)',  body: TIPS['assembly-stages'].body },
        { id: 'assembly-schedule',    title: '7-Day Lookahead',              body: TIPS['assembly-schedule'].body },
        { id: 'build-notes',          title: 'Build Notes',                  body: TIPS['build-notes'].body },
      ]
    },
    {
      heading: 'Available Queue',
      articles: [
        { id: 'queue',                title: 'Available Queue overview',     body: TIPS['queue'].body },
        { id: 'queue-ready',          title: 'Ready pack builders',          body: TIPS['queue-ready'].body },
        { id: 'queue-incomplete',     title: 'Incomplete pack builders',     body: TIPS['queue-incomplete'].body },
        { id: 'queue-scheduled',      title: 'Scheduled pack builders',      body: TIPS['queue-scheduled'].body },
        { id: 'issue-hold',           title: 'Issue Hold',                   body: TIPS['issue-hold'].body },
      ]
    },
    {
      heading: 'Daily Tools Dossier',
      articles: [
        { id: 'sord',                  title: 'Daily Tools overview',        body: TIPS['sord'].body },
        { id: 'sord-explorer',         title: 'SORD Explorer',               body: TIPS['sord-explorer'].body },
        { id: 'sord-top-stats',        title: 'Summary stat cards',          body: TIPS['sord-top-stats'].body },
        { id: 'sord-status-filter',    title: 'Status filter',               body: TIPS['sord-status-filter'].body },
        { id: 'sord-readiness-filter', title: 'Readiness filter',            body: TIPS['sord-readiness-filter'].body },
        { id: 'sord-complexity-filter','title': 'Complexity filter',         body: TIPS['sord-complexity-filter'].body },
        { id: 'sord-risk-filter',      title: 'Risk / Flags filter',         body: TIPS['sord-risk-filter'].body },
        { id: 'sord-confirmed-filter', title: 'Confirmed Revenue This Month',body: TIPS['sord-confirmed-filter'].body },
        { id: 'sord-dossier',          title: 'SORD Dossier panel',          body: TIPS['sord-dossier'].body },
        { id: 'sord-flags',            title: 'Risk & Blockers — Flags',     body: TIPS['sord-flags'].body },
        { id: 'sord-pack-builders',    title: 'Pack Builders panel',         body: TIPS['sord-pack-builders'].body },
        { id: 'sord-revenue-panel',    title: 'Revenue panel',               body: TIPS['sord-revenue-panel'].body },
        { id: 'sord-timeline',         title: 'Lifecycle Timeline',          body: TIPS['sord-timeline'].body },
        { id: 'sord-po-detail',        title: 'POs & Suppliers',             body: TIPS['sord-po-detail'].body },
        { id: 'sord-account-products', title: 'Account Products (Item Layer)',body: TIPS['sord-account-products'].body },
        { id: 'sord-owner-map',        title: 'Owner Mapping',               body: TIPS['sord-owner-map'].body },
      ]
    },
    {
      heading: 'Other Modules',
      articles: [
        { id: 'attendance',           title: 'Attendance',                   body: TIPS['attendance'].body },
        { id: 'errors',               title: 'Warehouse Errors',             body: TIPS['errors'].body },
        { id: 'calendar',             title: 'Planning Calendar',            body: TIPS['calendar'].body },
        { id: 'policy',               title: 'Policy & SOP Library',        body: TIPS['policy'].body },
        { id: 'returns',              title: 'Returns Desk',                 body: TIPS['returns'].body },
        { id: 'qa-inbound',           title: 'QA Inbound Workflow',          body: TIPS['qa-inbound'].body },
      ]
    },
  ];

  // ── Tooltip engine ────────────────────────────────────────────────────────
  let tooltipEl = null;
  let hideTimer = null;

  function getTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.getElementById('hcTooltip');
    }
    return tooltipEl;
  }

  function showTooltip(triggerEl, tipId) {
    const tip = TIPS[tipId];
    if (!tip) return;
    clearTimeout(hideTimer);
    const el = getTooltip();
    if (!el) return;

    el.querySelector('.hc-tip-title').textContent = tip.title;
    el.querySelector('.hc-tip-body').textContent = tip.body;

    const jumpBtn = el.querySelector('.hc-tip-jump');
    if (tip.page) {
      jumpBtn.style.display = '';
      jumpBtn.onclick = () => {
        hideTooltip();
        document.querySelector(`.nav-btn[data-page="${tip.page}"]`)?.click();
      };
    } else {
      jumpBtn.style.display = 'none';
    }

    el.style.display = 'block';
    positionTooltip(triggerEl, el);
  }

  function positionTooltip(triggerEl, el) {
    const rect = triggerEl.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const tipW = 300;
    const margin = 10;

    let left = rect.right + scrollX + margin;
    let top = rect.top + scrollY - 6;

    // Flip left if too close to right edge
    if (left + tipW > window.innerWidth + scrollX - margin) {
      left = rect.left + scrollX - tipW - margin;
    }
    // Clamp top
    if (top + el.offsetHeight > window.innerHeight + scrollY - margin) {
      top = window.innerHeight + scrollY - el.offsetHeight - margin;
    }
    if (top < scrollY + margin) top = scrollY + margin;

    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function hideTooltip() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const el = getTooltip();
      if (el) el.style.display = 'none';
    }, 120);
  }

  function keepTooltip() {
    clearTimeout(hideTimer);
  }

  // ── Inject ℹ triggers ─────────────────────────────────────────────────────
  // Map: CSS selector of the element to inject AFTER → tip key
  const INJECT_MAP = [
    // Home health strip cards — inject into the mc-label span
    { sel: '#mcAttendanceHealthCard .mc-label',   tip: 'attendance-health',   inline: true },
    { sel: '#mcInboundHealthCard .mc-label',       tip: 'inbound-health',      inline: true },
    { sel: '#mcAssemblyHealthCard .mc-label',      tip: 'assembly-health',     inline: true },
    { sel: '#mcIssueHealthCard .mc-label',         tip: 'issue-health',        inline: true },
    { sel: '#mcDataFreshnessCard .mc-label',       tip: 'data-freshness',      inline: true },
    { sel: '#mcTodayOutputCard .mc-label',         tip: 'today-output',        inline: true },
    { sel: '#mcMonthRevenueCard .mc-label',        tip: 'month-revenue',       inline: true },

    // Home panels — inject into panel-head h3
    { sel: '#mcDeptRadar',                         tip: 'dept-radar',          headingPrev: true },
    { sel: '#mcPriorityRadar',                     tip: 'priority-radar',      headingPrev: true },
    { sel: '#mcExceptionCenter',                   tip: 'exception-center',    headingPrev: true },
    { sel: '#mcTimelinePulse',                     tip: 'timeline-pulse',      headingPrev: true },
    { sel: '#mcUrgencyRail',                       tip: 'calendar-urgency',    headingPrev: true },
    { sel: '#revTrackerPanel',                     tip: 'rev-tracker',         panelHead: true },

    // Import hub
    { sel: '#importHubQueueFile',                  tip: 'queue-report-input',  labelFor: true },
    { sel: '#importHubRevenueFile',                tip: 'revenue-report-input',labelFor: true },
    { sel: '#importHubEomFile',                    tip: 'eom-report-input',    labelFor: true },
    { sel: '#importHubRevTrackerFile',             tip: 'rev-tracker-input',   labelFor: true },

    // SORD filters
    { sel: '#sordStatusFilter',                    tip: 'sord-status-filter',  labelFor: true },
    { sel: '#sordReadinessFilter',                 tip: 'sord-readiness-filter', labelFor: true },
    { sel: '#sordComplexityFilter',                tip: 'sord-complexity-filter', labelFor: true },
    { sel: '#sordRiskFilter',                      tip: 'sord-risk-filter',    labelFor: true },
    { sel: '#sordConfirmedFilter',                 tip: 'sord-confirmed-filter', labelFor: true },

    // SORD page sections — injected into h3 inside panel head
    { sel: '#sordTopStats',                        tip: 'sord-top-stats',      headingPrev: true },
    { sel: '#sordExplorerBody',                    tip: 'sord-explorer',       headingPrev: true },
    { sel: '#sordDossierTitle',                    tip: 'sord-dossier',        directH3: true },
    { sel: '#sordFlagsWrap',                       tip: 'sord-flags',          headingPrev: true },
    { sel: '#sordPackBuilderBody',                 tip: 'sord-pack-builders',  headingPrev: true },
    { sel: '#sordRevenuePanel',                    tip: 'sord-revenue-panel',  panelHead: true },
    { sel: '#sordTimelinePanel',                   tip: 'sord-timeline',       panelHead: true },
    { sel: '#sordPoBody',                          tip: 'sord-po-detail',      headingPrev: true },
    { sel: '#sordAccountProductBody',              tip: 'sord-account-products', headingPrev: true },
    { sel: '#sordOwnerMapBody',                    tip: 'sord-owner-map',      headingPrev: true },
  ];

  function makeTrigger(tipId) {
    const btn = document.createElement('button');
    btn.className = 'hc-info-btn';
    btn.setAttribute('aria-label', 'Help');
    btn.setAttribute('type', 'button');
    btn.textContent = 'ⓘ';
    btn.addEventListener('mouseenter', () => showTooltip(btn, tipId));
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('click', (e) => { e.stopPropagation(); showTooltip(btn, tipId); });
    return btn;
  }

  function injectTriggers() {
    INJECT_MAP.forEach(({ sel, tip, inline, headingPrev, labelFor, panelHead, directH3 }) => {
      const el = document.querySelector(sel);
      if (!el) return;

      const trigger = makeTrigger(tip);

      if (inline) {
        // Append inside the label span itself
        el.appendChild(trigger);
      } else if (directH3) {
        // Inject right after the h3 text node, inside the h3
        el.appendChild(trigger);
      } else if (labelFor) {
        // Find the label element for this input and append there
        const id = el.id;
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) label.appendChild(trigger);
      } else if (panelHead) {
        // Find the h3 inside the nearest .mc-panel-head ancestor or sibling
        const head = el.querySelector('.mc-panel-head h3') || el.previousElementSibling?.querySelector('h3');
        if (head) head.appendChild(trigger);
      } else if (headingPrev) {
        // Walk up to find the nearest panel-head h3 sibling above this element
        let container = el.closest('.mc-panel, .card, section');
        const h3 = container?.querySelector('h3');
        if (h3) h3.appendChild(trigger);
      }
    });
  }

  // ── Help page rendering ───────────────────────────────────────────────────
  function renderHelpPage(query) {
    const q = (query || '').toLowerCase().trim();
    const body = document.getElementById('helpPageBody');
    if (!body) return;

    let html = '';
    let totalMatches = 0;

    HELP_SECTIONS.forEach(section => {
      const articles = section.articles.filter(a => {
        if (!q) return true;
        return a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q);
      });
      if (!articles.length) return;
      totalMatches += articles.length;

      html += `<div class="help-section">
        <div class="help-section-heading">${esc(section.heading)}</div>
        ${articles.map(a => `
          <div class="help-article">
            <div class="help-article-title">${highlight(esc(a.title), q)}</div>
            <div class="help-article-body">${highlight(esc(a.body).replace(/\n/g, '<br>'), q)}</div>
          </div>
        `).join('')}
      </div>`;
    });

    if (!html) {
      html = `<div class="help-empty">No results found for "<strong>${esc(query)}</strong>". Try a shorter search term.</div>`;
    }

    const countEl = document.getElementById('helpResultCount');
    if (countEl) countEl.textContent = q ? `${totalMatches} result${totalMatches === 1 ? '' : 's'} for "${query}"` : `${HELP_SECTIONS.reduce((s, sec) => s + sec.articles.length, 0)} articles`;

    body.innerHTML = html;
  }

  function highlight(text, q) {
    if (!q) return text;
    // Highlight matching term in rendered text (operates on already-escaped HTML)
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'gi'), m => `<mark class="help-highlight">${m}</mark>`);
  }

  function esc(v) {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Tooltip hover keep-alive
    const tip = getTooltip();
    if (tip) {
      tip.addEventListener('mouseenter', keepTooltip);
      tip.addEventListener('mouseleave', hideTooltip);
    }

    // Inject ℹ buttons
    injectTriggers();

    // Help page search
    const searchInput = document.getElementById('helpSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => renderHelpPage(searchInput.value));
    }

    // Initial render of help page
    if (document.getElementById('helpPageBody')) {
      renderHelpPage('');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay so other modules finish injecting their DOM first
    setTimeout(init, 100);
  }

})();
