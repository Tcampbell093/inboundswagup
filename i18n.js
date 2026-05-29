/* ════════════════════════════════════════════════════════════════════
   i18n.js — Global EN/ES translation for Houston Control
   ─────────────────────────────────────────────────────────────────────
   Exposes window.HC_I18N with:
     • T(key)              → translated string (falls back to key)
     • T.apply(root?)      → walk [data-i18n] under root and update text
     • T.setLang(lang)     → 'en' | 'es' — persists + dispatches event
     • T.getLang()         → current language
     • T.onChange(fn)      → subscribe; returns unsubscribe fn
     • T.dict              → expose the dictionary (for callers that
                             want to merge module-specific strings)

   Scope 1.5: covers the floor-facing strings shared across modules.
   Module-specific dictionaries (the legacy inbound `translations` table
   in app.js) are still authoritative for their own keys — i18n.js only
   fills in the global vocabulary used everywhere.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.HC_I18N) return; // safe re-include guard

  var STORAGE_KEY = 'hcLang';
  var LEGACY_KEY = 'qaWorkflowLanguageV1'; // inbound module's old key

  // ── Dictionary ─────────────────────────────────────────────────────
  // Keep keys simple and stable. Floor-facing first. Each new key needs
  // an 'en' AND an 'es' entry.
  var dict = {
    en: {
      // ── Status words ─────────────────────────────────────
      'status.ready':       'Ready',
      'status.notReady':    'Not Ready',
      'status.done':        'Done',
      'status.pending':     'Pending',
      'status.complete':    'Complete',
      'status.completed':   'Completed',
      'status.inProgress':  'In Progress',
      'status.empty':       'Empty',
      'status.active':      'Active',
      'status.assigned':    'Assigned',
      'status.unset':       'Unset',
      'status.ineligible':  'Ineligible',
      'status.complication':'Complication',
      'status.blocked':     'Blocked',
      'status.late':        'Late',
      'status.absent':      'Absent',
      'status.present':     'Present',
      'status.scheduled':   'Scheduled',
      'status.routed':      'Routed',

      // ── Common verbs / actions ───────────────────────────
      'action.route':       'Route',
      'action.send':        'Send',
      'action.sendToPrep':  'Send to Prep',
      'action.sendToRouting':'Send to Routing',
      'action.complete':    'Complete',
      'action.cancel':      'Cancel',
      'action.save':        'Save',
      'action.close':       'Close',
      'action.confirm':     'Confirm',
      'action.reset':       'Reset',
      'action.view':        'View',
      'action.viewAll':     'View all',
      'action.viewDetails': 'View details',
      'action.edit':        'Edit',
      'action.delete':      'Delete',
      'action.add':         'Add',
      'action.create':      'Create',
      'action.search':      'Search',
      'action.filter':      'Filter',
      'action.sort':        'Sort',
      'action.clear':       'Clear',
      'action.refresh':     'Refresh',
      'action.import':      'Import',
      'action.export':      'Export',
      'action.print':       'Print',
      'action.signOut':     'Sign Out',
      'action.signIn':      'Sign In',
      'action.continue':    'Continue',
      'action.back':        'Back',
      'action.next':        'Next',
      'action.submit':      'Submit',
      'action.assign':      'Assign',
      'action.unassign':    'Unassign',

      // ── Nouns (warehouse vocabulary) ─────────────────────
      'noun.pallet':        'Pallet',
      'noun.pallets':       'Pallets',
      'noun.po':            'PO',
      'noun.pos':           'POs',
      'noun.unit':          'Unit',
      'noun.units':         'Units',
      'noun.box':           'Box',
      'noun.boxes':         'Boxes',
      'noun.kit':           'Kit',
      'noun.kits':          'Kits',
      'noun.product':       'Product',
      'noun.products':      'Products',
      'noun.sord':          'SORD',
      'noun.sords':         'SORDs',
      'noun.packBuilder':   'Pack Builder',
      'noun.packBuilders':  'Pack Builders',
      'noun.pb':            'PB',
      'noun.pbs':           'PBs',
      'noun.associate':     'Associate',
      'noun.associates':    'Associates',
      'noun.team':          'Team',
      'noun.department':    'Department',
      'noun.location':      'Location',
      'noun.dock':          'Dock',
      'noun.receiving':     'Receiving',
      'noun.prep':          'Prep',
      'noun.assembly':      'Assembly',
      'noun.staffing':      'Staffing',
      'noun.overstock':     'Overstock',
      'noun.putaway':       'Putaway',
      'noun.account':       'Account',
      'noun.note':          'Note',
      'noun.notes':         'Notes',
      'noun.user':          'User',
      'noun.currentUser':   'Current User',
      'noun.language':      'Language',

      // ── Time ─────────────────────────────────────────────
      'time.today':         'Today',
      'time.yesterday':     'Yesterday',
      'time.tomorrow':      'Tomorrow',
      'time.thisWeek':      'This Week',
      'time.lastWeek':      'Last Week',
      'time.now':           'Now',

      // ── UI / Common ──────────────────────────────────────
      'ui.all':             'All',
      'ui.none':            'None',
      'ui.loading':         'Loading…',
      'ui.empty':           'Nothing here yet',
      'ui.showSummary':     'Show Summary',
      'ui.hideSummary':     'Hide Summary',
      'ui.expand':          'Expand',
      'ui.collapse':        'Collapse',
      'ui.settings':        'Settings',
      'ui.profile':         'Profile',
      'ui.help':            'Help',
      'ui.yes':             'Yes',
      'ui.no':              'No',
      'ui.ok':              'OK',
      'ui.optional':        'Optional',
      'ui.required':        'Required',
      'ui.search.placeholder': 'Search…',

      // ── Nav (sidebar labels) ─────────────────────────────
      'nav.missionControl': 'Mission Control',
      'nav.importHub':      'Import Hub',
      'nav.attendance':     'Attendance',
      'nav.qaInbound':      'QA Inbound',
      'nav.inboundFlight':  'Inbound Flight Tracker',
      'nav.fulfillment':    'Fulfillment Scan-Out',
      'nav.returns':        'Returns',
      'nav.cycleCount':     'Cycle Count',
      'nav.errorLog':       'Error Log',
      'nav.assemblyPlanner':'Assembly Planner',
      'nav.packBuilderQueue':'Pack Builder Queue',
      'nav.flightTracker':  'Flight Tracker',
      'nav.dailyTools':     'Daily Tools Dossier',
      'nav.calendar':       'Calendar',
      'nav.productivity':   'Productivity',
      'nav.policy':         'Policy & SOPs',
      'nav.history':        'History Log',
      'nav.helpGuide':      'Help & Guide',

      // ── Settings page ────────────────────────────────────
      'settings.language.title':  'Language',
      'settings.language.desc':   'Choose the display language. Applies across every module that supports translation.',
      'settings.language.en':     'English',
      'settings.language.es':     'Spanish',
    },
    es: {
      // ── Status words ─────────────────────────────────────
      'status.ready':       'Listo',
      'status.notReady':    'No listo',
      'status.done':        'Hecho',
      'status.pending':     'Pendiente',
      'status.complete':    'Completar',
      'status.completed':   'Completado',
      'status.inProgress':  'En progreso',
      'status.empty':       'Vacío',
      'status.active':      'Activo',
      'status.assigned':    'Asignado',
      'status.unset':       'Sin estado',
      'status.ineligible':  'No elegible',
      'status.complication':'Complicación',
      'status.blocked':     'Bloqueado',
      'status.late':        'Tarde',
      'status.absent':      'Ausente',
      'status.present':     'Presente',
      'status.scheduled':   'Programado',
      'status.routed':      'Enrutado',

      // ── Verbs / actions ──────────────────────────────────
      'action.route':       'Enrutar',
      'action.send':        'Enviar',
      'action.sendToPrep':  'Enviar a preparación',
      'action.sendToRouting':'Enviar a enrutado',
      'action.complete':    'Completar',
      'action.cancel':      'Cancelar',
      'action.save':        'Guardar',
      'action.close':       'Cerrar',
      'action.confirm':     'Confirmar',
      'action.reset':       'Restablecer',
      'action.view':        'Ver',
      'action.viewAll':     'Ver todo',
      'action.viewDetails': 'Ver detalles',
      'action.edit':        'Editar',
      'action.delete':      'Eliminar',
      'action.add':         'Agregar',
      'action.create':      'Crear',
      'action.search':      'Buscar',
      'action.filter':      'Filtrar',
      'action.sort':        'Ordenar',
      'action.clear':       'Limpiar',
      'action.refresh':     'Actualizar',
      'action.import':      'Importar',
      'action.export':      'Exportar',
      'action.print':       'Imprimir',
      'action.signOut':     'Cerrar sesión',
      'action.signIn':      'Iniciar sesión',
      'action.continue':    'Continuar',
      'action.back':        'Atrás',
      'action.next':        'Siguiente',
      'action.submit':      'Enviar',
      'action.assign':      'Asignar',
      'action.unassign':    'Desasignar',

      // ── Nouns ────────────────────────────────────────────
      'noun.pallet':        'Pallet',
      'noun.pallets':       'Pallets',
      'noun.po':            'PO',
      'noun.pos':           'POs',
      'noun.unit':          'Unidad',
      'noun.units':         'Unidades',
      'noun.box':           'Caja',
      'noun.boxes':         'Cajas',
      'noun.kit':           'Kit',
      'noun.kits':          'Kits',
      'noun.product':       'Producto',
      'noun.products':      'Productos',
      'noun.sord':          'SORD',
      'noun.sords':         'SORDs',
      'noun.packBuilder':   'Pack Builder',
      'noun.packBuilders':  'Pack Builders',
      'noun.pb':            'PB',
      'noun.pbs':           'PBs',
      'noun.associate':     'Asociado',
      'noun.associates':    'Asociados',
      'noun.team':          'Equipo',
      'noun.department':    'Departamento',
      'noun.location':      'Ubicación',
      'noun.dock':          'Descarga',
      'noun.receiving':     'Recepción',
      'noun.prep':          'Preparación',
      'noun.assembly':      'Ensamblaje',
      'noun.staffing':      'Personal',
      'noun.overstock':     'Exceso',
      'noun.putaway':       'Ubicación',
      'noun.account':       'Cuenta',
      'noun.note':          'Nota',
      'noun.notes':         'Notas',
      'noun.user':          'Usuario',
      'noun.currentUser':   'Usuario actual',
      'noun.language':      'Idioma',

      // ── Time ─────────────────────────────────────────────
      'time.today':         'Hoy',
      'time.yesterday':     'Ayer',
      'time.tomorrow':      'Mañana',
      'time.thisWeek':      'Esta semana',
      'time.lastWeek':      'Semana pasada',
      'time.now':           'Ahora',

      // ── UI ───────────────────────────────────────────────
      'ui.all':             'Todos',
      'ui.none':            'Ninguno',
      'ui.loading':         'Cargando…',
      'ui.empty':           'Nada aquí todavía',
      'ui.showSummary':     'Mostrar resumen',
      'ui.hideSummary':     'Ocultar resumen',
      'ui.expand':          'Expandir',
      'ui.collapse':        'Contraer',
      'ui.settings':        'Configuración',
      'ui.profile':         'Perfil',
      'ui.help':            'Ayuda',
      'ui.yes':             'Sí',
      'ui.no':              'No',
      'ui.ok':              'OK',
      'ui.optional':        'Opcional',
      'ui.required':        'Requerido',
      'ui.search.placeholder': 'Buscar…',

      // ── Nav ──────────────────────────────────────────────
      'nav.missionControl': 'Centro de mando',
      'nav.importHub':      'Centro de importación',
      'nav.attendance':     'Asistencia',
      'nav.qaInbound':      'Recepción QA',
      'nav.inboundFlight':  'Rastreador de entradas',
      'nav.fulfillment':    'Escaneo de salida',
      'nav.returns':        'Devoluciones',
      'nav.cycleCount':     'Conteo cíclico',
      'nav.errorLog':       'Registro de errores',
      'nav.assemblyPlanner':'Planificador de ensamblaje',
      'nav.packBuilderQueue':'Cola de Pack Builders',
      'nav.flightTracker':  'Rastreador de vuelo',
      'nav.dailyTools':     'Dosier de herramientas',
      'nav.calendar':       'Calendario',
      'nav.productivity':   'Productividad',
      'nav.policy':         'Políticas y SOPs',
      'nav.history':        'Registro histórico',
      'nav.helpGuide':      'Ayuda y guía',

      // ── Settings page ────────────────────────────────────
      'settings.language.title':  'Idioma',
      'settings.language.desc':   'Elija el idioma de visualización. Aplica a todos los módulos que admiten traducción.',
      'settings.language.en':     'Inglés',
      'settings.language.es':     'Español',
    }
  };

  // ── State ──────────────────────────────────────────────────────────
  function loadLang() {
    try {
      var v = localStorage.getItem(STORAGE_KEY);
      if (v === 'en' || v === 'es') return v;
      // Migrate from the inbound-only legacy key if present
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy === 'en' || legacy === 'es') {
        localStorage.setItem(STORAGE_KEY, legacy);
        return legacy;
      }
    } catch (_) {}
    return 'en';
  }

  var currentLang = loadLang();
  var subscribers = [];

  // ── Core lookups ───────────────────────────────────────────────────
  function T(key) {
    if (!key) return '';
    var table = dict[currentLang] || dict.en;
    var fallback = dict.en;
    return table[key] || fallback[key] || key;
  }

  // Walk [data-i18n] children of root and replace their textContent.
  // Also supports [data-i18n-attr="placeholder:key,title:key2"] for
  // translating attribute values.
  T.apply = function (root) {
    root = root || document;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var k = n.getAttribute('data-i18n');
      if (k) n.textContent = T(k);
    }
    var attrNodes = root.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrNodes.length; j++) {
      var an = attrNodes[j];
      var spec = an.getAttribute('data-i18n-attr') || '';
      spec.split(',').forEach(function (pair) {
        var parts = pair.split(':');
        if (parts.length !== 2) return;
        var attr = parts[0].trim();
        var key = parts[1].trim();
        if (attr && key) an.setAttribute(attr, T(key));
      });
    }
  };

  T.setLang = function (lang) {
    if (lang !== 'en' && lang !== 'es') return;
    if (lang === currentLang) return;
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
      // Keep legacy key in sync so the inbound module's localStorage read
      // returns the right value even before our bridge fires.
      localStorage.setItem(LEGACY_KEY, lang);
    } catch (_) {}
    T.apply();
    // Notify in-page subscribers
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](lang); } catch (_) {}
    }
    // Notify other documents (iframes, parent) via a window event +
    // postMessage so the inbound iframe and parent stay in sync.
    try { window.dispatchEvent(new CustomEvent('hc-lang-changed', { detail: { lang: lang } })); } catch (_) {}
    try {
      // Tell parent (if we're an iframe) and every iframe child (if we're the parent)
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'HC_LANG_CHANGED', lang: lang }, '*');
      }
      var frames = document.querySelectorAll('iframe');
      for (var f = 0; f < frames.length; f++) {
        try { frames[f].contentWindow.postMessage({ type: 'HC_LANG_CHANGED', lang: lang }, '*'); } catch (_) {}
      }
    } catch (_) {}
  };

  T.getLang = function () { return currentLang; };

  T.onChange = function (fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function () {
      var i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  };

  T.dict = dict;

  // ── Cross-window sync ──────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'HC_LANG_CHANGED') {
      if (e.data.lang !== currentLang) T.setLang(e.data.lang);
    }
  });

  // Also listen for storage changes from other tabs/windows
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY && e.newValue && e.newValue !== currentLang) {
      T.setLang(e.newValue);
    }
  });

  // ── Auto-apply on first DOM ready ──────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { T.apply(); });
  } else {
    T.apply();
  }

  // Expose
  window.HC_I18N = T;
})();
