// =============================================================
// app.js — QA Inbound Workflow Runtime
// Houston Control Warehouse Operations Hub
//
// PURPOSE: This is the core runtime for workflow.html (the standalone
// QA Inbound Pallet Tracker page). It is NOT part of the main Ops Hub
// app (index.html). Do not load it from index.html.
//
// workflow.html load order:
//   1. app.js       ← this file (defines `state`, sync, masters, user)
//   2. inbound-pallets.js  ← pallet UI module (depends on state from app.js)
//
// WHAT THIS FILE OWNS:
//   - `state` object (currentUser, language, masters, data)
//   - Workflow backend sync (/.netlify/functions/workflow-sync)
//   - User login / session management
//   - Masters editor (categories, locations)
//   - CEO/import tooling for performance data
// =============================================================

// ── Shared toast notification (used by app.js and inbound-pallets.js) ──
(function buildToast() {
  const el = document.createElement('div');
  el.id = 'hcToastMsg';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%) translateY(12px)',
    background: '#1e293b', color: '#f1f5f9',
    padding: '10px 20px', borderRadius: '10px',
    fontSize: '14px', fontWeight: '500', lineHeight: '1.4',
    boxShadow: '0 4px 16px rgba(0,0,0,.18)',
    opacity: '0', transition: 'opacity .2s, transform .2s',
    zIndex: '99999', pointerEvents: 'none', maxWidth: '360px', textAlign: 'center',
  });
  document.body.appendChild(el);
})();
let _toastTimer = null;
function showToast(message, type = 'info') {
  const el = document.getElementById('hcToastMsg');
  if (!el) return;
  el.textContent = message;
  el.style.background = type === 'error' ? '#7f1d1d' : type === 'success' ? '#14532d' : '#1e293b';
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(12px)';
  }, type === 'error' ? 4000 : 2500);
}
window.showToast = showToast;

const STORAGE_KEY = "qaV5SeparatedWorkflowData_v4fixed";
const MASTER_KEY = "qaBlueSheetMastersV5";
const LANGUAGE_KEY = "qaWorkflowLanguageV1";
const CURRENT_USER_KEY = "qaWorkflowCurrentUserV2";
const WORKFLOW_API_BASE='/.netlify/functions/workflow-sync';
let workflowSyncEnabled=false;
let workflowSyncLoaded=false;
let workflowSyncInFlight=false;
let workflowSyncQueued=false;
let workflowSyncTimer=null;
let workflowPollTimer=null;
const WORKFLOW_POLL_INTERVAL = 20000; // poll every 20 seconds

// Active editors — who is currently in which pallet modal
// { palletId: { user, ts } } — updated from server on every GET/poll
let workflowActiveEditors = {};

function plt_getActiveEditors() { return workflowActiveEditors; }

// Register/deregister self as editing a pallet via PATCH endpoint
async function workflowRegisterEditor(palletId, action) {
  if (!workflowSyncEnabled) return;
  const user = (typeof state !== 'undefined' && state.currentUser) ? state.currentUser : null;
  if (!user) return;
  try {
    await fetch(WORKFLOW_API_BASE, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, palletId, user }),
    });
  } catch(_) { /* non-fatal */ }
}

function startWorkflowPoll() {
  if (workflowPollTimer) return;
  workflowPollTimer = setInterval(async () => {
    if (!workflowSyncEnabled || workflowSyncInFlight) return;
    try {
      const data = await workflowApiRequest('GET');
      if (data) applyWorkflowSyncPayload(data);
    } catch(_) { /* non-fatal poll failure */ }
  }, WORKFLOW_POLL_INTERVAL);
}

function stopWorkflowPoll() {
  if (workflowPollTimer) { clearInterval(workflowPollTimer); workflowPollTimer = null; }
}

const ATTENDANCE_EMPLOYEE_KEY = "ops_hub_employees_v1";

function readAttendanceEmployees() {
  try {
    const raw = localStorage.getItem(ATTENDANCE_EMPLOYEE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && item.active !== false)
      .map(item => typeof item === "string" ? item.trim() : String(item.name || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function syncAssociatesFromAttendance() {
  const attendanceNames = [...new Set(readAttendanceEmployees())].sort((a, b) => a.localeCompare(b));
  if (!attendanceNames.length) return;
  const existing = Array.isArray(state?.masters?.associates) ? state.masters.associates : [];
  const changed =
    attendanceNames.length !== existing.length ||
    attendanceNames.some((name, index) => existing[index] !== name);
  if (changed && state && state.masters) {
    state.masters.associates = attendanceNames;
    persistMasters();
  }
}



function scheduleWorkflowSync() {
  if (!workflowSyncEnabled || !workflowSyncLoaded) return;
  if (workflowSyncTimer) clearTimeout(workflowSyncTimer);
  workflowSyncTimer = setTimeout(() => { workflowSyncTimer = null; syncWorkflowState(); }, 250);
}
async function workflowApiRequest(method='GET', body){
  const options = { method, headers: { 'Accept': 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(WORKFLOW_API_BASE, options);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  if (!response.ok) throw new Error(data?.error || `Workflow sync failed (${response.status})`);
  return data;
}
function applyWorkflowSyncPayload(payload={}){
  if (payload && typeof payload.activeEditors === 'object') {
    workflowActiveEditors = payload.activeEditors || {};
    // If a pallet modal is open, refresh its warning banner
    if (typeof plt_refreshEditorWarning === 'function') plt_refreshEditorWarning();
  }
  if (payload && typeof payload.data === 'object') {
    const defaults = getDefaultData();
    const parsed = payload.data;
    state.data = {
      ...defaults,
      ...parsed,
      pallets: Array.isArray(parsed.pallets) ? parsed.pallets : defaults.pallets,
      dockFilters: { ...defaults.dockFilters, ...(parsed.dockFilters || {}) },
      receivingFilters: { ...defaults.receivingFilters, ...(parsed.receivingFilters || {}) },
      prepFilters: { ...defaults.prepFilters, ...(parsed.prepFilters || {}) },
      overstockFilters: { ...defaults.overstockFilters, ...(parsed.overstockFilters || {}) },
      dockSections: Array.isArray(parsed.dockSections) ? parsed.dockSections : defaults.dockSections,
      receivingSections: Array.isArray(parsed.receivingSections) ? parsed.receivingSections : defaults.receivingSections,
      prepSections: Array.isArray(parsed.prepSections) ? parsed.prepSections : defaults.prepSections,
      overstockEntries: Array.isArray(parsed.overstockEntries) ? parsed.overstockEntries : defaults.overstockEntries,
      putawayEntries: Array.isArray(parsed.putawayEntries) ? parsed.putawayEntries : defaults.putawayEntries,
      workflowUi: { ...defaults.workflowUi, ...(parsed.workflowUi || {}) },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }
  if (payload && typeof payload.masters === 'object') {
    const base = payload.masters || {};
    const attendanceNames = [...new Set(readAttendanceEmployees())].sort((a,b)=>a.localeCompare(b));
    state.masters = {
      ...defaultMasters,
      ...base,
      associates: attendanceNames.length ? attendanceNames : (Array.isArray(base.associates) ? base.associates : defaultMasters.associates)
    };
    localStorage.setItem(MASTER_KEY, JSON.stringify(state.masters));
  }
}
async function loadWorkflowFromBackend() {
  try {
    const data = await workflowApiRequest('GET');
    if (data) applyWorkflowSyncPayload(data);
    workflowSyncEnabled = true;
    startWorkflowPoll();
  } catch (err) {
    console.warn('Workflow sync unavailable, using browser storage.', err);
    workflowSyncEnabled = false;
  } finally {
    workflowSyncLoaded = true;
  }
}
async function syncWorkflowState() {
  if (!workflowSyncEnabled || !workflowSyncLoaded) return;
  if (workflowSyncInFlight) { workflowSyncQueued = true; return; }
  workflowSyncInFlight = true;
  try {
    const data = await workflowApiRequest('POST', { data: state.data, masters: state.masters });
    if (data) applyWorkflowSyncPayload(data);
  } catch (err) {
    console.warn('Workflow sync save failed; keeping local copy.', err);
    workflowSyncEnabled = false;
  } finally {
    workflowSyncInFlight = false;
    if (workflowSyncQueued) { workflowSyncQueued = false; syncWorkflowState(); }
  }
}


const defaultMasters = {
  categories: [
    "Apparel / Ropa",
    "Drinkware / Utensilios para Beber",
    "Bags and Backpacks / Bolsas y Mochilas",
    "Tech Accessories / Accesorios Tecnológicos",
    "Office Supplies / Suministros de Oficina",
    "Outdoor and Sports / Artículos para Exteriores y Deportes",
    "Travel and Camping / Viajes y Acampada",
    "Personal Care and Wellness / Cuidado Personal y Bienestar",
    "Miscellaneous / Varios",
    "Perishables / Perecederos",
    "Pets / Mascotas",
    "Children / Niños",
  ],
  associates: [
    "Zuleidy","Maria Elena","Katherine","Maylin","Henry","Carlton","Reyna Orellana",
    "Rosa","Marcela","Gilda","Yesenia","Diana","Jay",
  ],
  locations: [
    "Dock-1 Mon","Dock-2 Mon","Dock-3 Mon","Dock-1 Tue","Dock-2 Tue","Dock-3 Tue",
    "Dock-1 Wed","Dock-2 Wed","Dock-3 Wed","Dock-1 Thu","Dock-2 Thu","Dock-3 Thu",
    "Dock-1 Fri","Dock-2 Fri","Dock-3 Fri","QA-1 Mon","QA-2 Mon","QA-3 Mon",
    "QA-1 Tue","QA-2 Tue","QA-3 Tue","Prep-1 Mon","Prep-2 Mon","Prep-3 Mon",
    "Prep-1 Tue","Prep-2 Tue","Prep-3 Tue",
  ],
};

const translations = {
  en: {
    tabDock: "Docker", tabReceiving: "QA Receiving", tabPrep: "Prepping", tabOverstock: "Overstock", tabPutaway: "Putaway", tabSettings: "Settings",
    statSections: "Sections", statRows: "Rows Logged", statBoxes: "Boxes", statNotes: "Notes",
    statSectionsHelp: "Date + name + location groups", statRowsHelp: "Total PO lines entered", statBoxesHelp: "Total boxes across all rows", statNotesHelp: "Rows with notes entered",
    today: "Today", totalQty: "Total Qty", language: "Language",
    viewControls: "View Controls", dockOnly: "Docker only.", receivingOnly: "QA Receiving only.", prepOnly: "Prep only.",
    addNewDockSection: "Add New Docker Section", addNewReceivingSection: "Add New QA Receiving Section", addNewPrepSection: "Add New Prep Section",
    dockDailyLayout: "Docker Daily Layout", receivingLayout: "QA Receiving Layout", prepLayout: "Prep Layout",
    dockSaveOnly: "Only saves to Docker.", receivingSaveOnly: "Only saves to QA Receiving.", prepSaveOnly: "Only saves to Prep.",
    dockDataOnly: "Docker data only.", receivingDataOnly: "QA Receiving data only.", prepDataOnly: "Prep data only.",
    settingsMasterLists: "Settings / Master Lists", settingsHelp: "Associate names now come from Attendance. Manage categories and locations here so the rest of the workflow can use dropdowns.",
    associates: "Associates", categories: "Categories", locations: "Locations",
    add: "Add", associate: "Associate", associateName: "Associate Name", day: "Day", date: "Date", location: "Location",
    search: "Search", clearFilters: "Clear Filters", createSection: "Create Section", loadDemo: "Load Demo Data", clearAll: "Clear All",
    editSection: "Edit Section", addRow: "Add Row", deleteSection: "Delete Section", save: "Save", cancel: "Cancel",
    po: "PO#", boxes: "# of Boxes", requestedQty: "Requested Qty", orderedQty: "Ordered Qty", receivedQty: "Received Qty", extras: "Extras", category: "Category", notes: "Notes",
    selectAssociate: "Select associate", selectLocation: "Select location", selectCategory: "Select category", everyone: "Everyone",
    placeholderOverstock: "This page is reserved for overflow / extras handling.", placeholderPutaway: "This page is reserved for stockers and long-term storage work.",
    noRows: "No PO lines match the current view.",
    sizeBreakdown: "Apparel size breakdown", sizesInExtras: "Apparel",
    addAssociatePlaceholder: "Add associate", addCategoryPlaceholder: "Add category", addLocationPlaceholder: "Add location",
    searchPlaceholder: "PO, category, note, location...",
    // Overstock status/action values
    donation: "Donation", notDonation: "Not Donation", pendingPb: "Pending PB",
    donated: "Donated", required: "Required", replaced: "Replaced", missingFromBox: "Missing from Box",
    // User controls
    myItemsOnly: "My Items Only", noUserSelected: "No user selected",
    clearUser: "Clear User", setUser: "Set User", currentUser: "Current User",
    notYourEntry: "Not your entry", actionNeeded: "Select action",
    // Timeline modal headers
    stage: "Stage", variance: "Variance", editTrail: "Edit Trail",
    orderedTotal: "Ordered Total", receivedTotal: "Received Total",
    boxesTotal: "Boxes Total", varianceTotal: "Variance Total",
    timelineEntries: "Timeline Entries", monthlyTotal: "Monthly Total",
    noHistoryFound: "No history found for this PO.",
    // Filter / UI
    viewTimeline: "View Timeline", fullPoHistory: "Full PO History", viewPutawayEntries: "View Putaway Entries", hidePutawayEntries: "Hide Putaway Entries", filterResults: "Filter",
    status: "Status", edit: "Edit", delete: "Delete", close: "Close",
    poTimeline: "PO Timeline", resetPace: "Reset Pace Images", performance: "Performance", settings: "Settings",
    hideFilter: "Hide Filter", showFilter: "Show Filter",
    // Performance / misc
    refreshView: "Refresh View", showSummary: "Show Summary", hideSummary: "Hide Summary",
    loadingDemo: "Loading demo data...", noSections: "No sections yet.",
    deleteConfirm: "Delete this row?", clearConfirm: "Clear all data?",
    required_field: "Required", poRequired: "PO# and Category are required.",
    selectUserFirst: "Select a current user first.",
    leadershipCode: "Enter Leadership code", incorrectCode: "Incorrect code.",
    // Putaway
    putawayControls: "Putaway Controls", putawayDesc: "Track what Prep handed off, where it was staged, and make it easy to find later for Assembly.",
    // Batch history stat pills
    associates: "Associates", locations: "Locations",
    matchingLines: "Matching Lines", monthsHit: "Months Hit", units: "Units"
  },
  es: {
    tabDock: "Descarga", tabReceiving: "Recepción QA", tabPrep: "Preparación", tabOverstock: "Exceso", tabPutaway: "Ubicación", tabSettings: "Configuración",
    statSections: "Secciones", statRows: "Filas", statBoxes: "Cajas", statNotes: "Notas",
    statSectionsHelp: "Grupos de fecha + nombre + ubicación", statRowsHelp: "Total de líneas PO ingresadas", statBoxesHelp: "Total de cajas en todas las filas", statNotesHelp: "Filas con notas",
    today: "Hoy", totalQty: "Cantidad Total", language: "Idioma",
    viewControls: "Controles de vista", dockOnly: "Solo descarga.", receivingOnly: "Solo recepción QA.", prepOnly: "Solo preparación.",
    addNewDockSection: "Agregar nueva sección de descarga", addNewReceivingSection: "Agregar nueva sección de recepción QA", addNewPrepSection: "Agregar nueva sección de preparación",
    dockDailyLayout: "Diseño diario de descarga", receivingLayout: "Diseño de recepción QA", prepLayout: "Diseño de preparación",
    dockSaveOnly: "Solo guarda en descarga.", receivingSaveOnly: "Solo guarda en recepción QA.", prepSaveOnly: "Solo guarda en preparación.",
    dockDataOnly: "Solo datos de descarga.", receivingDataOnly: "Solo datos de recepción QA.", prepDataOnly: "Solo datos de preparación.",
    settingsMasterLists: "Configuración / Listas maestras", settingsHelp: "Los nombres de asociados ahora vienen de Asistencia. Administra categorías y ubicaciones aquí para que el resto del flujo use menús.",
    associates: "Asociados", categories: "Categorías", locations: "Ubicaciones",
    add: "Agregar", associate: "Asociado", associateName: "Nombre del asociado", day: "Día", date: "Fecha", location: "Ubicación",
    search: "Buscar", clearFilters: "Limpiar filtros", createSection: "Crear sección", loadDemo: "Cargar demo", clearAll: "Borrar todo",
    editSection: "Editar sección", addRow: "Agregar fila", deleteSection: "Eliminar sección", save: "Guardar", cancel: "Cancelar",
    po: "PO#", boxes: "# de Cajas", requestedQty: "Cantidad pedida", orderedQty: "Cantidad pedida", receivedQty: "Cantidad recibida", extras: "Extras", category: "Categoría", notes: "Notas",
    selectAssociate: "Seleccionar asociado", selectLocation: "Seleccionar ubicación", selectCategory: "Seleccionar categoría", everyone: "Todos",
    placeholderOverstock: "Esta página está reservada para manejar exceso / extras.", placeholderPutaway: "Esta página está reservada para almacenistas y ubicaciones finales.",
    noRows: "Ninguna línea PO coincide con la vista actual.",
    sizeBreakdown: "Desglose de tallas de ropa", sizesInExtras: "Ropa",
    addAssociatePlaceholder: "Agregar asociado", addCategoryPlaceholder: "Agregar categoría", addLocationPlaceholder: "Agregar ubicación",
    searchPlaceholder: "PO, categoría, nota, ubicación...",
    donation: "Donación", notDonation: "No donación", pendingPb: "Pendiente PB",
    donated: "Donado", required: "Requerido", replaced: "Reemplazado", missingFromBox: "Falta de caja",
    myItemsOnly: "Solo mis artículos", noUserSelected: "Sin usuario",
    clearUser: "Limpiar usuario", setUser: "Establecer usuario", currentUser: "Usuario actual",
    notYourEntry: "No es tu entrada", actionNeeded: "Seleccionar acción",
    stage: "Etapa", variance: "Diferencia", editTrail: "Historial de edición",
    orderedTotal: "Total pedido", receivedTotal: "Total recibido",
    boxesTotal: "Total cajas", varianceTotal: "Total diferencia",
    timelineEntries: "Entradas de historial", monthlyTotal: "Total mensual",
    noHistoryFound: "No se encontró historial para este PO.",
    viewTimeline: "Ver historial", fullPoHistory: "Historial completo del PO", viewPutawayEntries: "Ver entradas de ubicación", hidePutawayEntries: "Ocultar entradas de ubicación", filterResults: "Filtrar",
    status: "Estado", edit: "Editar", delete: "Eliminar", close: "Cerrar",
    poTimeline: "Historial de PO", resetPace: "Restablecer imágenes", performance: "Rendimiento", settings: "Configuración",
    hideFilter: "Ocultar filtro", showFilter: "Mostrar filtro",
    refreshView: "Actualizar vista", showSummary: "Mostrar resumen", hideSummary: "Ocultar resumen",
    loadingDemo: "Cargando datos de demostración...", noSections: "No hay secciones aún.",
    deleteConfirm: "¿Eliminar esta fila?", clearConfirm: "¿Borrar todos los datos?",
    required_field: "Requerido", poRequired: "PO# y Categoría son obligatorios.",
    selectUserFirst: "Primero selecciona un usuario actual.",
    leadershipCode: "Ingresa el código de liderazgo", incorrectCode: "Código incorrecto.",
    putawayControls: "Controles de ubicación", putawayDesc: "Seguimiento de lo que Prep entregó, dónde fue almacenado, y fácil de encontrar para Assembly.",
    associates: "Asociados", locations: "Ubicaciones",
    matchingLines: "Líneas coincidentes", monthsHit: "Meses", units: "Unidades"
  }
};

const overstockStatusOptions = ["Donation", "Not Donation", "Pending PB", "Donated"];
const overstockActionOptions = ["Donated", "Required", "Replaced", "Missing from Box", "Lost"];
const overstockLocations = Array.from({length:24}, (_,i)=>`E-${i+1}`);

const pageConfig = {
  dock: {
    sectionKey: "dockSections",
    filterKey: "dockFilters",
    sectionForm: "sectionForm",
    sectionDate: "sectionDate",
    sectionName: "sectionName",
    sectionLocation: "sectionLocation",
    personFilter: "personFilter",
    dayFilter: "dayFilter",
    searchInput: "searchInput",
    clearFiltersBtn: "clearFiltersBtn",
    seedBtn: "seedBtn",
    clearBtn: "clearBtn",
    container: "sectionsContainer",
    title: "docker",
    mode: "simple",
  },
  receiving: {
    sectionKey: "receivingSections",
    filterKey: "receivingFilters",
    sectionForm: "receivingSectionForm",
    sectionDate: "receivingSectionDate",
    sectionName: "receivingSectionName",
    sectionLocation: "receivingSectionLocation",
    personFilter: "receivingPersonFilter",
    dayFilter: "receivingDayFilter",
    searchInput: "receivingSearchInput",
    clearFiltersBtn: "receivingClearFiltersBtn",
    seedBtn: "receivingSeedBtn",
    clearBtn: "receivingClearBtn",
    container: "receivingSectionsContainer",
    title: "QA receiving",
    mode: "counting",
  },
  prep: {
    sectionKey: "prepSections",
    filterKey: "prepFilters",
    sectionForm: "prepSectionForm",
    sectionDate: "prepSectionDate",
    sectionName: "prepSectionName",
    sectionLocation: "prepSectionLocation",
    personFilter: "prepPersonFilter",
    dayFilter: "prepDayFilter",
    searchInput: "prepSearchInput",
    clearFiltersBtn: "prepClearFiltersBtn",
    seedBtn: "prepSeedBtn",
    clearBtn: "prepClearBtn",
    container: "prepSectionsContainer",
    title: "prep",
    mode: "counting",
  },
};

const state = {
  data: loadWorkflowData(),
  masters: loadMasters(),
  currentPage: "dock",
  language: localStorage.getItem(LANGUAGE_KEY) || "en",
  currentUser: localStorage.getItem(CURRENT_USER_KEY) || "",
  performanceDeptView: localStorage.getItem("qaWorkflowPerformanceDeptViewV1") || "receiving",
};

const roleTabs = document.getElementById("roleTabs");
const pages = document.querySelectorAll(".page");
const statsGrid = document.getElementById("statsGrid");
const totalQty = document.getElementById("totalQty");
const statSections = document.getElementById("statSections");
const statRows = document.getElementById("statRows");
const statBoxes = document.getElementById("statBoxes");
const statNotes = document.getElementById("statNotes");
const todayLabel = document.getElementById("todayLabel");
const sectionTemplate = document.getElementById("sectionTemplate");

const associateForm = document.getElementById("associateForm");
const associateInput = document.getElementById("associateInput");
const associatesList = document.getElementById("associatesList");
const categoryForm = document.getElementById("categoryForm");
const categoryInput = document.getElementById("categoryInput");
const categoriesList = document.getElementById("categoriesList");
const locationForm = document.getElementById("locationForm");
const locationInput = document.getElementById("locationInput");
const locationsList = document.getElementById("locationsList");
const langEnBtn = document.getElementById("langEnBtn");
const langEsBtn = document.getElementById("langEsBtn");


const currentUserSelect = document.getElementById("currentUserSelect");
const currentUserNameEl = document.getElementById("currentUserName");
const currentUserAvatarEl = document.getElementById("currentUserAvatar");
const currentUserLabelEl = document.getElementById("currentUserLabel");
const setCurrentUserBtn = document.getElementById("setCurrentUserBtn");
const clearCurrentUserBtn = document.getElementById("clearCurrentUserBtn");

function getInitials(name) {
  if (!name) return "?";
  return name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function populateCurrentUserSelect() {
  syncAssociatesFromAttendance();
  if (!currentUserSelect) return;
  currentUserSelect.innerHTML = "";
  appendOption(currentUserSelect, "", t("selectAssociate"));
  const names = [...state.masters.associates].sort((a,b)=>a.localeCompare(b));
  names.forEach(name => appendOption(currentUserSelect, name, name));
  appendOption(currentUserSelect, LEADERSHIP_USER, LEADERSHIP_USER);
  currentUserSelect.value = state.currentUser || "";
}


function getHeroUphContext() {
  if (state.currentPage === "receiving") return { key: "receiving", label: "QA Receiving", goal: 200, rows: state.data.receivingSections || [] };
  if (state.currentPage === "prep") return { key: "prep", label: "QA Prep", goal: 275, rows: state.data.prepSections || [] };
  return null;
}

function getSectionUnitsForHero(section, deptKey) {
  return (section.rows || []).reduce((sum, row) => {
    if (deptKey === "receiving") return sum + Number(row.receivedQty || row.orderedQty || row.qty || 0);
    return sum + Number(row.receivedQty || row.orderedQty || row.qty || 0);
  }, 0);
}

function getPulseUphSummary(context, flatRows) {
  const rows = Array.isArray(flatRows) ? flatRows : getPalletRowsForPulse(context || getHeroPulseContext());
  const totalUnits = rows.reduce((sum, row) => sum + (Number(row.units || 0) || 0), 0);
  const uniquePeople = new Set(
    rows
      .map(row => String(row.associate || '').trim())
      .filter(Boolean)
      .filter(name => name.toLowerCase() !== 'unknown')
  );
  const headcount = uniquePeople.size;
  const hours = 8;
  const uph = headcount > 0 && hours > 0 ? +(totalUnits / (headcount * hours)).toFixed(1) : 0;
  return { totalUnits, headcount, hours, uph };
}



const UPH_PACE_CUSTOM_KEY = "qaWorkflowUphPaceCustomImagesV1";

function loadCustomPaceImages() {
  try {
    const raw = localStorage.getItem(UPH_PACE_CUSTOM_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCustomPaceImages(images) {
  localStorage.setItem(UPH_PACE_CUSTOM_KEY, JSON.stringify(images || {}));
}

function bindUphPaceCustomizer() {
  if (window.__uphPaceCustomizerBound) return;
  [1,2,3,4].forEach(stage => {
    const input = document.getElementById(`uphStageUpload${stage}`);
    if (!input) return;
    input.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const images = loadCustomPaceImages();
        images[String(stage)] = String(reader.result || "");
        saveCustomPaceImages(images);
        renderCurrentDeptUphBadge();
      };
      reader.readAsDataURL(file);
    });
  });

  const resetBtn = document.getElementById("uphResetImagesBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      localStorage.removeItem(UPH_PACE_CUSTOM_KEY);
      renderCurrentDeptUphBadge();
    });
  }

  window.__uphPaceCustomizerBound = true;
}

function getUphPaceStage(uph) {
  const value = Number(uph || 0);
  if (value < 50) return 1;
  if (value < 100) return 2;
  if (value < 150) return 3;
  return 4;
}

function getUphPaceAsset(stage) {
  const map = {
    1: "assets/uph_stage_1_sleep.png",
    2: "assets/uph_stage_2_walk.png",
    3: "assets/uph_stage_3_ride.png",
    4: "assets/uph_stage_4_speed.png",
  };
  const custom = loadCustomPaceImages();
  return custom[String(stage)] || map[stage] || map[1];
}

function getUphPaceLabelText(stage, language) {
  const labels = {
    en: { 1: "Sleeping", 2: "Walking", 3: "Riding", 4: "Flying", waiting: "Waiting" },
    es: { 1: "Dormido", 2: "Caminando", 3: "Montando", 4: "A toda velocidad", waiting: "Esperando" }
  };
  const lang = labels[language] ? language : "en";
  return labels[lang][stage] || labels[lang].waiting;
}

function renderUphPaceVisual(uph, deptLabel) {
  const icon = document.getElementById("uphPaceIcon");
  const text = document.getElementById("uphPaceText");
  const label = document.getElementById("uphPaceLabel");
  const wrap = document.getElementById("uphPaceVisual");
  if (!icon || !text || !label || !wrap) return;

  if (uph === null || uph === undefined || Number.isNaN(Number(uph))) {
    icon.src = getUphPaceAsset(1);
    label.textContent = state.language === "es" ? "Ritmo UPH" : "UPH Pace";
    text.textContent = getUphPaceLabelText("waiting", state.language);
    wrap.dataset.stage = "0";
    return;
  }

  const stage = getUphPaceStage(Number(uph));
  icon.src = getUphPaceAsset(stage);
  label.textContent = state.language === "es" ? "Ritmo UPH" : "UPH Pace";
  text.textContent = `${deptLabel}: ${Number(uph).toFixed(1)} • ${getUphPaceLabelText(stage, state.language)}`;
  wrap.dataset.stage = String(stage);
}

function renderCurrentDeptUphBadge() {
  const badge = document.getElementById("currentDeptUphBadge");
  const valueEl = document.getElementById("currentDeptUphValue");
  const metaEl = document.getElementById("currentDeptUphMeta");
  const labelEl = document.getElementById("currentDeptUphLabel");
  if (!badge || !valueEl || !metaEl || !labelEl) return;

  badge.classList.remove("uph-state-red", "uph-state-yellow", "uph-state-green", "uph-state-neutral");

  const context = getHeroUphContext();
  if (!context) {
    labelEl.textContent = "Current UPH";
    valueEl.textContent = "—";
    metaEl.textContent = "Switch to QA Receiving or Prep";
    badge.classList.add("uph-state-neutral");
    renderUphPaceVisual(null, "");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const pulseContext = getHeroPulseContext();
  const pulseRows = pulseContext && pulseContext.key === context.key ? getPalletRowsForPulse(pulseContext) : [];
  const pulseSummary = pulseRows.length ? getPulseUphSummary(pulseContext, pulseRows) : null;
  const todaysSections = context.rows.filter(section => String(section.date || "").slice(0,10) === today);
  const fallbackHeadcount = todaysSections.length;
  const fallbackHours = 8;
  const fallbackUnits = todaysSections.reduce((sum, section) => sum + getSectionUnitsForHero(section, context.key), 0);
  const headcount = pulseSummary ? pulseSummary.headcount : fallbackHeadcount;
  const hours = pulseSummary ? pulseSummary.hours : fallbackHours;
  const totalUnits = pulseSummary ? pulseSummary.totalUnits : fallbackUnits;
  const uph = headcount > 0 && hours > 0 ? +(totalUnits / (headcount * hours)).toFixed(1) : 0;
  const ratio = context.goal > 0 ? uph / context.goal : 0;

  labelEl.textContent = `${context.label} UPH`;
  valueEl.textContent = String(uph);
  metaEl.textContent = headcount
    ? `${totalUnits} units today • goal ${context.goal} • ${headcount} people`
    : `0 units today • goal ${context.goal} • 0 people`;

  if (!headcount) badge.classList.add("uph-state-neutral");
  else if (ratio >= 1) badge.classList.add("uph-state-green");
  else if (ratio >= 0.7) badge.classList.add("uph-state-yellow");
  else badge.classList.add("uph-state-red");

  renderUphPaceVisual(uph, context.label);
}

async function clearImportedLibraryData() {
  try {
    const db = await openImportDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IMPORT_DB_STORE, "readwrite");
      const store = tx.objectStore(IMPORT_DB_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
    importedLibraryCache = [];
    activeImportedKey = "";
    compareImportedKey = "";
    localStorage.setItem("qaActiveImportedMonthKeyV1", "");
    localStorage.setItem("qaCompareImportedMonthKeyV1", "");
    await refreshImportedLibraryCache();
    renderPerformancePage();
    renderStats();
  } catch (error) {
    console.error("Failed to clear imported performance data:", error);
    showToast("Could not reset imported performance data.", "error");
  }
}

function renderCurrentUser() {
  if (!currentUserNameEl) return;
  currentUserLabelEl.textContent = t("currentUser");
  setCurrentUserBtn.textContent = t("setUser");
  clearCurrentUserBtn.textContent = t("clearUser");
  document.querySelectorAll("#myItemsBtn, #receivingMyItemsBtn, #prepMyItemsBtn, #overstockMyItemsBtn").forEach(btn => {
    if (btn) btn.textContent = t("myItemsOnly");
  });
  if (state.currentUser) {
    currentUserNameEl.textContent = state.currentUser;
    currentUserAvatarEl.textContent = getInitials(state.currentUser);
  } else {
    currentUserNameEl.textContent = t("noUserSelected");
    currentUserAvatarEl.textContent = "?";
  }
}

function bindCurrentUserControls() {
  if (window.__currentUserControlsBound) {
    populateCurrentUserSelect();
    return;
  }
  populateCurrentUserSelect();
  setCurrentUserBtn.addEventListener("click", () => {
    const selected = currentUserSelect.value || "";
    if (selected === LEADERSHIP_USER && !isLeadershipUnlocked()) {
      const code = window.prompt("Enter Leadership code");
      if (String(code || "").trim() !== LEADERSHIP_CODE) {
        showToast("Incorrect code.", "error");
        populateCurrentUserSelect();
        return;
      }
      localStorage.setItem(LEADERSHIP_UNLOCK_KEY, "true");
    }
    state.currentUser = selected;
    localStorage.setItem(CURRENT_USER_KEY, state.currentUser);
    renderAll();
  });
  clearCurrentUserBtn.addEventListener("click", () => {
    state.currentUser = "";
    localStorage.setItem(CURRENT_USER_KEY, "");
    renderAll();
  });
  window.__currentUserControlsBound = true;
}



const toggleSummaryBtn = document.getElementById("toggleSummaryBtn");
let summaryVisible = false;
if (toggleSummaryBtn) {
  toggleSummaryBtn.addEventListener("click", () => {
    summaryVisible = !summaryVisible;
    document.getElementById("statsGrid").classList.toggle("hidden", !summaryVisible);
    toggleSummaryBtn.textContent = summaryVisible
      ? (state.language === "es" ? "Ocultar resumen" : "Hide Summary")
      : (state.language === "es" ? "Show Summary".replace("Show Summary","Show Summary") : "Show Summary");
    if (state.language === "es" && summaryVisible) toggleSummaryBtn.textContent = "Ocultar resumen";
    if (state.language === "es" && !summaryVisible) toggleSummaryBtn.textContent = "Mostrar resumen";
  });
}




const LEADERSHIP_USER = "Leadership";
const LEADERSHIP_CODE = "2026";
const LEADERSHIP_UNLOCK_KEY = "qaLeadershipUnlockedV1";

function isLeadershipUnlocked() {
  return localStorage.getItem(LEADERSHIP_UNLOCK_KEY) === "true";
}

function isLeadershipUserActive() {
  return state.currentUser === LEADERSHIP_USER;
}

const IMPORT_DB_NAME = "qaImportedMonthlyLibraryV1";
const IMPORT_DB_STORE = "imports";
let pendingImportFile = null;
let activeImportedKey = localStorage.getItem("qaActiveImportedMonthKeyV1") || "";
let compareImportedKey = localStorage.getItem("qaCompareImportedMonthKeyV1") || "";
let importedLibraryCache = [];


function openImportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMPORT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMPORT_DB_STORE)) {
        const store = db.createObjectStore(IMPORT_DB_STORE, { keyPath: "id" });
        store.createIndex("label", "label", { unique: false });
        store.createIndex("importedAt", "importedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllImportedMonths() {
  const db = await openImportDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IMPORT_DB_STORE, "readonly");
    const store = tx.objectStore(IMPORT_DB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => (a.label || "").localeCompare(b.label || "")));
    req.onerror = () => reject(req.error);
  });
}

async function saveImportedMonthRecord(record) {
  const db = await openImportDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IMPORT_DB_STORE, "readwrite");
    const store = tx.objectStore(IMPORT_DB_STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

async function deleteImportedMonthRecord(id) {
  const db = await openImportDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IMPORT_DB_STORE, "readwrite");
    const store = tx.objectStore(IMPORT_DB_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function refreshImportedLibraryCache() {
  try {
    importedLibraryCache = await getAllImportedMonths();
  } catch (err) {
    console.error("Failed to read import library:", err);
    importedLibraryCache = [];
  }

  if (activeImportedKey && !importedLibraryCache.some(item => item.id === activeImportedKey)) {
    activeImportedKey = "";
    localStorage.setItem("qaActiveImportedMonthKeyV1", "");
  }
  if (compareImportedKey && !importedLibraryCache.some(item => item.id === compareImportedKey)) {
    compareImportedKey = "";
    localStorage.setItem("qaCompareImportedMonthKeyV1", "");
  }
  if (!activeImportedKey && importedLibraryCache.length) {
    activeImportedKey = importedLibraryCache[importedLibraryCache.length - 1].id;
    localStorage.setItem("qaActiveImportedMonthKeyV1", activeImportedKey);
  }
  if (compareImportedKey === activeImportedKey) {
    compareImportedKey = "";
    localStorage.setItem("qaCompareImportedMonthKeyV1", "");
  }
}

function getActiveImportedRecord() {
  return importedLibraryCache.find(item => item.id === activeImportedKey) || null;
}

function getCompareImportedRecord() {
  return importedLibraryCache.find(item => item.id === compareImportedKey) || null;
}


async function readCsvFileAsLatin1(file) {
  if (!file) return "";
  const buffer = await file.arrayBuffer();
  return new TextDecoder("latin1").decode(buffer);
}

function normalizeImportedDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 30000 && serial < 60000) {
      const base = new Date(Date.UTC(1899, 11, 30));
      base.setUTCDate(base.getUTCDate() + Math.floor(serial));
      return base.toISOString().slice(0,10);
    }
  }
  return "";
}

function normalizeImportedText(value) {
  return String(value || "")
    .replace(/Ã±/g, "ñ")
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã/g, "Á")
    .trim();
}

function asNumberImported(value) {
  const raw = String(value || "").replace(/,/g, "").trim();
  if (!raw || raw === "#NAME?") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function findImportedHeaderIndex(headers, patterns) {
  return headers.findIndex(h => patterns.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(h);
    return h === pattern || h.includes(pattern);
  }));
}

function getImportedCell(row, index) {
  return index >= 0 ? row[index] : "";
}

function deriveImportedDelta(row, idx) {
  const requested = asNumberImported(getImportedCell(row, idx.requested));
  const received = asNumberImported(getImportedCell(row, idx.received));
  const extrasRaw = getImportedCell(row, idx.extras);
  const hasExplicitExtras = idx.extras >= 0 && String(extrasRaw ?? "").trim() !== "";
  const explicitExtras = hasExplicitExtras ? asNumberImported(extrasRaw) : null;
  const delta = explicitExtras !== null ? explicitExtras : (received - requested);

  return {
    requested,
    received,
    extras: Math.max(0, delta),
    missing: Math.max(0, -delta)
  };
}

function parseReceivingHistoricsCsv(text) {
  const rows = parseSimpleCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
  const idx = {
    po: findImportedHeaderIndex(headers, [/^po$/, /^po/, "po#", "purchase order"]),
    boxes: findImportedHeaderIndex(headers, ["# of boxes", "# of box", "boxes"]),
    requested: findImportedHeaderIndex(headers, ["requested", "requested qty", "qty requested", "quantity requested"]),
    received: findImportedHeaderIndex(headers, ["received", "received qty", "qty received", "quantity received"]),
    extras: findImportedHeaderIndex(headers, ["extras", "extra", "over", "overage"]),
    category: findImportedHeaderIndex(headers, ["category"]),
    notes: findImportedHeaderIndex(headers, ["notes", "note"]),
    date: findImportedHeaderIndex(headers, ["date"]),
    name: findImportedHeaderIndex(headers, ["name", "associate", "employee"]),
    department: findImportedHeaderIndex(headers, ["department"])
  };
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = normalizeImportedDate(getImportedCell(r, idx.date));
    const name = normalizeImportedText(getImportedCell(r, idx.name));
    if (!date || !name) continue;
    const delta = deriveImportedDelta(r, idx);
    parsed.push({
      department: "QA Receiving",
      associate: name,
      date,
      units: delta.received,
      requested: delta.requested,
      received: delta.received,
      extras: delta.extras,
      missing: delta.missing,
      boxes: asNumberImported(getImportedCell(r, idx.boxes)),
      po: normalizeImportedText(getImportedCell(r, idx.po)),
      category: normalizeImportedText(getImportedCell(r, idx.category)),
      notes: normalizeImportedText(getImportedCell(r, idx.notes)),
    });
  }
  return parsed;
}

function parsePrepHistoricsCsv(text) {
  const rows = parseSimpleCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
  const idx = {
    po: findImportedHeaderIndex(headers, [/^po$/, /^po/, "po#", "purchase order"]),
    boxes: findImportedHeaderIndex(headers, ["# of boxes", "# of box", "boxes"]),
    requested: findImportedHeaderIndex(headers, ["requested", "requested qty", "qty requested", "quantity requested"]),
    received: findImportedHeaderIndex(headers, ["received", "received qty", "qty received", "quantity received"]),
    extras: findImportedHeaderIndex(headers, ["extras", "extra", "over", "overage"]),
    category: findImportedHeaderIndex(headers, ["category"]),
    notes: findImportedHeaderIndex(headers, ["notes", "note"]),
    date: findImportedHeaderIndex(headers, ["date"]),
    name: findImportedHeaderIndex(headers, ["name", "associate", "employee"]),
    department: findImportedHeaderIndex(headers, ["department"])
  };
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = normalizeImportedDate(getImportedCell(r, idx.date));
    const name = normalizeImportedText(getImportedCell(r, idx.name));
    if (!date || !name) continue;
    const delta = deriveImportedDelta(r, idx);
    parsed.push({
      department: "Prep",
      associate: name,
      date,
      units: delta.received,
      requested: delta.requested,
      received: delta.received,
      extras: delta.extras,
      missing: delta.missing,
      boxes: asNumberImported(getImportedCell(r, idx.boxes)),
      po: normalizeImportedText(getImportedCell(r, idx.po)),
      category: normalizeImportedText(getImportedCell(r, idx.category)),
      notes: normalizeImportedText(getImportedCell(r, idx.notes)),
    });
  }
  return parsed;
}

function buildDailySummary(rows, department) {
  const map = new Map();
  rows.filter(r => r.department === department).forEach(r => {
    const current = map.get(r.date) || 0;
    map.set(r.date, current + Number(r.units || 0));
  });
  return [...map.entries()].map(([date, units]) => ({ date, units })).sort((a,b)=>a.date.localeCompare(b.date));
}

function buildAssociateSummary(rows, department) {
  const map = new Map();
  rows.filter(r => r.department === department).forEach(r => {
    const key = `${r.date}|${r.associate}|${department}`;
    const current = map.get(key) || 0;
    map.set(key, current + Number(r.units || 0));
  });
  return [...map.entries()].map(([key, units]) => {
    const [date, associate] = key.split("|");
    return { date, associate, department, units };
  }).sort((a,b)=>`${a.date}${a.associate}`.localeCompare(`${b.date}${b.associate}`));
}

async function buildImportedRecordFromFiles(combinedFile, statusWorkbookFile, label) {
  return (async () => {
    const combinedRows = combinedFile ? parseCombinedHistoricsCsv(await readTextFileSmart(combinedFile)) : [];
    const statusRows = statusWorkbookFile ? await parseStatusWorkbookFile(statusWorkbookFile) : [];
    const allRows = attachStatusToRows(combinedRows, statusRows);

    const recDaily = buildDailySummary(allRows, "QA Receiving");
    const prepDaily = buildDailySummary(allRows, "Prep");
    const recAssoc = buildAssociateSummary(allRows, "QA Receiving");
    const prepAssoc = buildAssociateSummary(allRows, "Prep");

    return {
      id: makeImportRecordId(label),
      label,
      importedAt: new Date().toISOString(),
      sourceName: `${combinedFile ? combinedFile.name : "No combined line file"}${statusWorkbookFile ? " + " + statusWorkbookFile.name : ""}`,
      rawRows: allRows,
      statusRows,
      receivingDaily: recDaily,
      prepDaily: prepDaily,
      receivingAssociates: recAssoc,
      prepAssociates: prepAssoc,
      assemblyDaily: [],
      diagnostics: {
        combinedRows: combinedRows.length,
        statusRows: statusRows.length,
        receivingDays: recDaily.length,
        prepDays: prepDaily.length,
        receivingAssociates: recAssoc.length,
        prepAssociates: prepAssoc.length,
      }
    };
  })();
}

function parseSimpleCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }
  if (value.length || row.length) {
    row.push(value.trim());
    rows.push(row);
  }
  return rows;
}

function normalizeDateToISO(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}


function detectAssociateSummaryRows(rows, dateCol, nameCol, unitsCol, department) {
  const result = [];
  let currentDate = "";
  for (const r of rows) {
    const maybeDate = normalizeDateToISO(r[dateCol]);
    if (maybeDate) currentDate = maybeDate;
    const name = String(r[nameCol] || "").trim();
    const units = Number(String(r[unitsCol] || "").replace(/,/g, "")) || 0;
    if (currentDate && name && units > 0 && !/total/i.test(name)) {
      result.push({ date: currentDate, associate: name, department, units });
    }
  }
  return dedupeAssoc(result);
}

function detectDailyRows(rows, dateCol, unitsCol) {
  const result = [];
  for (const r of rows) {
    const date = normalizeDateToISO(r[dateCol]);
    const units = Number(String(r[unitsCol] || "").replace(/,/g, "")) || 0;
    if (date && units > 0) result.push({ date, units });
  }
  return dedupeDaily(result);
}

function parseImportedSummaryFromCsvText(text) {
  const rows = parseSimpleCSV(text);
  const imported = {
    importedAt: new Date().toISOString(),
    sourceName: "Daily Received CSV",
    receivingDaily: [],
    prepDaily: [],
    receivingAssociates: [],
    prepAssociates: [],
    assemblyDaily: []
  };

  // These column positions are based on the uploaded daily-received style sheet.
  imported.receivingDaily = detectDailyRows(rows, 0, 2);
  imported.prepDaily = detectDailyRows(rows, 6, 8);
  imported.assemblyDaily = detectDailyRows(rows, 27, 31);

  imported.receivingAssociates = detectAssociateSummaryRows(rows, 0, 1, 2, "QA Receiving");
  imported.prepAssociates = detectAssociateSummaryRows(rows, 6, 7, 8, "Prep");

  return imported;
}

function dedupeDaily(items) {
  const map = new Map();
  items.forEach(item => {
    const key = item.date;
    map.set(key, item);
  });
  return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

function dedupeAssoc(items) {
  const map = new Map();
  items.forEach(item => {
    const key = `${item.date}|${item.associate}|${item.department}`;
    map.set(key, item);
  });
  return [...map.values()].sort((a,b)=>`${a.date}${a.associate}`.localeCompare(`${b.date}${b.associate}`));
}


function makeImportRecordId(label) {
  return `import-${String(label || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function getLatestImportedDate(imported) {
  if (!imported) return "";
  const dates = []
    .concat((imported.receivingDaily || []).map(x => x.date))
    .concat((imported.prepDaily || []).map(x => x.date))
    .concat((imported.assemblyDaily || []).map(x => x.date))
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : "";
}

function loadImportedSummary() {
  return getActiveImportedRecord();
}

function saveImportedSummary(data) {
  return saveImportedMonthRecord(data);
}


function normalizeDepartmentImported(value) {
  const raw = normalizeImportedText(value).toLowerCase();
  if (!raw) return "";
  if (raw.includes("prep")) return "Prep";
  if (raw.includes("receiv")) return "QA Receiving";
  if (raw.includes("dock")) return "Docker";
  return raw.replace(/\b\w/g, c => c.toUpperCase());
}

function normalizePoKey(value) {
  return String(value || "").replace(/[^0-9A-Za-z-]/g, "").trim();
}

function normalizeStatusLabel(value) {
  return normalizeImportedText(value).replace(/\s+/g, " ").trim();
}

function classifyPoStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("partially received")) return { bucket: "ready-receiving", tone: "ready", label: "Ready for Receiving" };
  if (s.includes("fully received")) return { bucket: "ready-prep", tone: "ready", label: "Ready for Prep" };
  if (s.includes("shipped from supplier") || s.includes("ship date confirmed")) return { bucket: "in-transit", tone: "cool", label: "Not Yet in Warehouse" };
  if (s.includes("case submitted") || s.includes("case in progress") || s.includes("pending replacements")) return { bucket: "exceptions", tone: "risk", label: "Exception / External Risk" };
  return { bucket: "other", tone: "warn", label: "Other Status" };
}

function parseCombinedHistoricsCsv(text) {
  const rows = parseSimpleCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
  const idx = {
    po: findImportedHeaderIndex(headers, [/^po$/, /^po/, "po#", "purchase order"]),
    boxes: findImportedHeaderIndex(headers, ["# of boxes", "# of box", "boxes"]),
    requested: findImportedHeaderIndex(headers, ["requested", "requested qty", "qty requested", "quantity requested"]),
    received: findImportedHeaderIndex(headers, ["received", "received qty", "qty received", "quantity received"]),
    extras: findImportedHeaderIndex(headers, ["extras", "extra", "over", "overage"]),
    category: findImportedHeaderIndex(headers, ["category"]),
    notes: findImportedHeaderIndex(headers, ["notes", "note"]),
    date: findImportedHeaderIndex(headers, ["date"]),
    name: findImportedHeaderIndex(headers, ["name", "associate", "employee"]),
    department: findImportedHeaderIndex(headers, ["department"])
  };
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = normalizeImportedDate(getImportedCell(r, idx.date));
    const name = normalizeImportedText(getImportedCell(r, idx.name));
    const department = normalizeDepartmentImported(getImportedCell(r, idx.department));
    if (!date || !name || !department) continue;
    const delta = deriveImportedDelta(r, idx);
    parsed.push({
      department,
      associate: name,
      date,
      units: delta.received,
      requested: delta.requested,
      received: delta.received,
      extras: delta.extras,
      missing: delta.missing,
      boxes: asNumberImported(getImportedCell(r, idx.boxes)),
      po: normalizeImportedText(getImportedCell(r, idx.po)),
      category: normalizeImportedText(getImportedCell(r, idx.category)),
      notes: normalizeImportedText(getImportedCell(r, idx.notes)),
    });
  }
  return parsed;
}

async function readTextFileSmart(file) {
  const buf = await file.arrayBuffer();
  const decoders = ["utf-8", "windows-1252", "iso-8859-1"];
  for (const enc of decoders) {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch (err) {}
  }
  return new TextDecoder("utf-8").decode(buf);
}

async function parseStatusWorkbookFile(file) {
  if (!file) return [];
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await readTextFileSmart(file);
    return parseStatusRowsFromObjects(csvRowsToObjects(parseSimpleCSV(text)));
  }
  if (typeof XLSX === "undefined") {
    throw new Error("XLSX library not available.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  return parseStatusRowsFromObjects(rows);
}

function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => obj[String(h || "").trim()] = r[idx] ?? "");
    return obj;
  });
}

function parseStatusRowsFromObjects(rows) {
  const out = [];
  rows.forEach(row => {
    const normalized = {};
    Object.keys(row || {}).forEach(key => normalized[String(key || "").trim().toLowerCase()] = row[key]);
    const po = normalizePoKey(normalized["purchase order: purchase order name"] || normalized["purchase order"] || normalized["po"] || normalized["purchase order name"]);
    const status = normalizeStatusLabel(normalized["status"]);
    if (!po || !status) return;
    out.push({
      po,
      status,
      quantity: asNumberImported(normalized["quantity"]),
      quantityReceived: asNumberImported(normalized["quantity received"]),
      accountProduct: normalizeImportedText(normalized["account product"]),
      requestedInHandsDate: normalizeImportedText(normalized["requested in hands date from supplier"]),
      qaOwner: normalizeImportedText(normalized["qa owner"]),
      lastModifiedBy: normalizeImportedText(normalized["purchase order: last modified by"]),
      purchaseOrderId: normalizeImportedText(normalized["purchase order: id"]),
      salesOrderId: normalizeImportedText(normalized["sales_order_id"] || normalized["sales order id"]),
    });
  });
  return out;
}

function buildStatusMap(statusRows) {
  const map = new Map();
  statusRows.forEach(row => {
    map.set(row.po, row);
  });
  return map;
}

function attachStatusToRows(rawRows, statusRows) {
  const map = buildStatusMap(statusRows);
  return rawRows.map(row => {
    const statusRow = map.get(normalizePoKey(row.po));
    const status = statusRow?.status || "";
    const statusInfo = classifyPoStatus(status);
    return {
      ...row,
      poStatus: status,
      poStatusBucket: statusInfo.bucket,
      poStatusLabel: statusInfo.label,
      poStatusTone: statusInfo.tone,
      statusQuantity: statusRow?.quantity || 0,
      statusQuantityReceived: statusRow?.quantityReceived || 0,
      qaOwner: statusRow?.qaOwner || "",
      requestedInHandsDate: statusRow?.requestedInHandsDate || "",
    };
  });
}

function getStatusRowsForImported(imported) {
  return Array.isArray(imported?.statusRows) ? imported.statusRows : [];
}

function summarizeStatusBoard(imported) {
  const statusRows = getStatusRowsForImported(imported);
  const groups = {
    "ready-receiving": { units: 0, pos: 0, label: "Ready for Receiving" },
    "ready-prep": { units: 0, pos: 0, label: "Ready for Prep" },
    "in-transit": { units: 0, pos: 0, label: "Not Yet in Warehouse" },
    "exceptions": { units: 0, pos: 0, label: "Exceptions / External Risk" },
    "other": { units: 0, pos: 0, label: "Other Status" },
  };
  statusRows.forEach(row => {
    const bucket = classifyPoStatus(row.status).bucket;
    if (!groups[bucket]) groups[bucket] = { units: 0, pos: 0, label: bucket };
    groups[bucket].units += Number(row.quantity || 0);
    groups[bucket].pos += 1;
  });
  return groups;
}

function renderCeoStatusBoard(imported) {
  const summary = summarizeStatusBoard(imported);
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set("ceoReadyReceivingUnits", summary["ready-receiving"].units);
  set("ceoReadyReceivingMeta", `${summary["ready-receiving"].pos} POs currently available to Receiving`);
  set("ceoReadyPrepUnits", summary["ready-prep"].units);
  set("ceoReadyPrepMeta", `${summary["ready-prep"].pos} POs currently available to Prep`);
  set("ceoInTransitUnits", summary["in-transit"].units);
  set("ceoInTransitMeta", `${summary["in-transit"].pos} POs still upstream`);
  set("ceoExceptionUnits", summary["exceptions"].units);
  set("ceoExceptionMeta", `${summary["exceptions"].pos} POs need attention`);

  setMetricList("ceoStatusBreakdown", [
    { label: "Ready for Receiving POs", value: summary["ready-receiving"].pos },
    { label: "Ready for Prep POs", value: summary["ready-prep"].pos },
    { label: "In Transit POs", value: summary["in-transit"].pos },
    { label: "Exception POs", value: summary["exceptions"].pos },
    { label: "Ready for Receiving Units", value: summary["ready-receiving"].units },
    { label: "Ready for Prep Units", value: summary["ready-prep"].units },
    { label: "In Transit Units", value: summary["in-transit"].units },
    { label: "Exception Units", value: summary["exceptions"].units }
  ]);

  const priorities = [];
  if (!imported || !getStatusRowsForImported(imported).length) {
    priorities.push("Import the Salesforce PO status workbook so leadership can see what is actually available versus blocked.");
  } else {
    if (summary["exceptions"].pos > 0) priorities.push(`<span class="priority-note-strong">Exception load:</span> ${summary["exceptions"].pos} POs are blocked by cases or replacements and need follow-up.`);
    if (summary["ready-receiving"].pos > summary["ready-prep"].pos) priorities.push(`<span class="priority-note-strong">Receiving queue is heavier:</span> more POs are waiting on Receiving than Prep right now.`);
    if (summary["ready-prep"].pos > 0) priorities.push(`<span class="priority-note-strong">Prep-ready work exists:</span> ${summary["ready-prep"].pos} fully received POs are available for Prep.`);
    if (summary["in-transit"].pos > 0) priorities.push(`<span class="priority-note-strong">Future load inbound:</span> ${summary["in-transit"].pos} POs are still upstream and not physically ready.`);
  }
  renderInsightsTo("ceoPriorityActions", priorities);
}

function renderInsightsTo(containerId, lines) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!lines.length) {
    el.innerHTML = `<div class="performance-empty">No insights yet.</div>`;
    return;
  }
  el.innerHTML = lines.map(line => `<div class="insight-item">${line}</div>`).join("");
}

function renderHistoryLookup() {
  const typeEl = document.getElementById("historyLookupType");
  const queryEl = document.getElementById("historyLookupQuery");
  const scopeEl = document.getElementById("historyLookupScope");
  const summaryEl = document.getElementById("historyLookupSummary");
  const metaEl = document.getElementById("historyLookupMeta");
  const statsEl = document.getElementById("historyLookupStats");
  const resultsEl = document.getElementById("historyLookupResults");
  if (!typeEl || !queryEl || !scopeEl || !summaryEl || !metaEl || !statsEl || !resultsEl) return;

  const records = scopeEl.value === "active" && getActiveImportedRecord() ? [getActiveImportedRecord()] : importedLibraryCache.slice();
  const rows = [];
  records.forEach(record => {
    getImportedRowsForRecord(record).forEach(row => rows.push({ ...row, monthLabel: record.label || "", importId: record.id }));
  });

  if (!records.length) {
    summaryEl.textContent = "No imported history library yet.";
    metaEl.textContent = "Save at least one month import first, then this lookup will search across raw lines and PO statuses.";
    statsEl.innerHTML = "";
    resultsEl.innerHTML = `<div class="performance-empty">No imported months available yet.</div>`;
    return;
  }

  const rawQuery = String(queryEl.value || "").trim().toLowerCase();
  const type = typeEl.value || "po";
  if (!rawQuery) {
    const typedLabel = type === "po" ? "PO" : type === "associate" ? "associate" : "category";
    summaryEl.textContent = "Start typing to search imported line history.";
    metaEl.textContent = `Search scope: ${scopeEl.value === "active" ? (getActiveImportedRecord()?.label || "active imported month") : `${records.length} imported month(s)`}.`;
    statsEl.innerHTML = "";
    resultsEl.innerHTML = `<div class="performance-empty">Type a ${typedLabel} to investigate line history.</div>`;
    return;
  }

  const matches = rows.filter(row => {
    const target = type === "po" ? String(row.po || "") : type === "associate" ? String(row.associate || "") : String(row.category || "");
    return target.toLowerCase().includes(rawQuery);
  }).sort((a,b)=>`${b.date}|${b.po}`.localeCompare(`${a.date}|${a.po}`));

  const monthCount = new Set(matches.map(r => r.monthLabel).filter(Boolean)).size;
  const deptCount = new Set(matches.map(r => r.department).filter(Boolean)).size;
  const unitCount = sum(matches, r => r.units || 0);
  const boxCount = sum(matches, r => r.boxes || 0);

  summaryEl.textContent = matches.length ? `${matches.length} matching line(s) found.` : `No matches found for "${queryEl.value.trim()}".`;
  metaEl.textContent = matches.length
    ? `Found across ${monthCount} imported month(s) and ${deptCount} department(s).`
    : `Try a broader spelling, switch month scope, or import another month like March when ready.`;

  statsEl.innerHTML = `
    <article class="stat-card"><span class="stat-label">Matching Lines</span><strong>${matches.length}</strong></article>
    <article class="stat-card"><span class="stat-label">Units</span><strong>${unitCount}</strong></article>
    <article class="stat-card"><span class="stat-label">Boxes</span><strong>${boxCount}</strong></article>
    <article class="stat-card"><span class="stat-label">Months Hit</span><strong>${monthCount}</strong></article>
  `;

  if (!matches.length) {
    resultsEl.innerHTML = `<div class="performance-empty">No matches found.</div>`;
    return;
  }

  resultsEl.innerHTML = matches.slice(0, 100).map(row => `
    <div class="history-result-card">
      <div class="history-result-top">
        <div>
          <strong>PO ${row.po || "—"} • ${row.associate || "Unknown"} • ${row.department || "—"}</strong>
          <div class="history-kv">${row.date || "—"}${row.monthLabel ? ` • ${row.monthLabel}` : ""}</div>
        </div>
        <span class="status-chip ${row.poStatusTone || "warn"}">${row.poStatusLabel || "No status"}${row.poStatus ? ` • ${row.poStatus}` : ""}</span>
      </div>
      <div class="history-result-meta">
        <span class="history-kv"><strong>Units:</strong> ${row.units || 0}</span>
        <span class="history-kv"><strong>Boxes:</strong> ${row.boxes || 0}</span>
        <span class="history-kv"><strong>Requested:</strong> ${row.requested || 0}</span>
        <span class="history-kv"><strong>Received:</strong> ${row.received || 0}</span>
        <span class="history-kv"><strong>Category:</strong> ${row.category || "—"}</span>
        <span class="history-kv"><strong>Extras/Missing:</strong> ${row.extras || 0} / ${row.missing || 0}</span>
        ${row.qaOwner ? `<span class="history-kv"><strong>QA Owner:</strong> ${row.qaOwner}</span>` : ""}
      </div>
      ${row.notes ? `<div class="history-kv"><strong>Notes:</strong> ${row.notes}</div>` : ""}
    </div>
  `).join("");
}

function bindImportControls() {
  const combinedInput = document.getElementById("importCombinedInput");
  const statusInput = document.getElementById("importStatusWorkbookInput");
  const monthLabelInput = document.getElementById("importMonthLabel");
  const runBtn = document.getElementById("runImportBtn");
  const activeSelect = document.getElementById("activeImportSelect");
  const compareSelect = document.getElementById("compareImportSelect");
  const removeBtn = document.getElementById("removeImportBtn");

  if (!combinedInput || !statusInput || !monthLabelInput || !runBtn || !activeSelect || !compareSelect || !removeBtn) return;

  const maybeGuessLabel = () => {
    const current = monthLabelInput.value.trim();
    if (current) return;
    const file = combinedInput.files?.[0] || statusInput.files?.[0];
    if (!file) return;
    monthLabelInput.value = file.name.replace(/\.[^.]+$/, "");
  };

  combinedInput.addEventListener("change", maybeGuessLabel);
  statusInput.addEventListener("change", maybeGuessLabel);

  runBtn.addEventListener("click", async () => {
    const combinedFile = combinedInput.files?.[0] || null;
    const statusWorkbookFile = statusInput.files?.[0] || null;
    const label = monthLabelInput.value.trim();

    if (!combinedFile) {
      showToast("Choose the combined line historics CSV first.", "error");
      return;
    }
    if (!statusWorkbookFile) {
      showToast("Choose the Salesforce PO status workbook too.", "error");
      return;
    }
    if (!label) {
      showToast("Enter a month label first.", "error");
      return;
    }

    try {
      const imported = await buildImportedRecordFromFiles(combinedFile, statusWorkbookFile, label);
      await saveImportedMonthRecord(imported);

      activeImportedKey = imported.id;
      localStorage.setItem("qaActiveImportedMonthKeyV1", activeImportedKey);

      await refreshImportedLibraryCache();
      populateImportSelectors();
      updateImportStatus();
      renderPerformancePage();

      const latest = getLatestImportedDate(imported);
      showToast(`CEO month import saved.${latest ? " Latest: " + latest : ""}`, "success");
    } catch (err) {
      console.error("Historics import failed:", err);
      showToast("Import failed. Check that CSV and workbook formats are correct.", "error");
    }
  });

  activeSelect.addEventListener("change", async () => {
    activeImportedKey = activeSelect.value || "";
    localStorage.setItem("qaActiveImportedMonthKeyV1", activeImportedKey);
    await refreshImportedLibraryCache();
    populateImportSelectors();
    updateImportStatus();
    renderPerformancePage();
  });

  compareSelect.addEventListener("change", async () => {
    compareImportedKey = compareSelect.value || "";
    localStorage.setItem("qaCompareImportedMonthKeyV1", compareImportedKey);
    await refreshImportedLibraryCache();
    populateImportSelectors();
    renderPerformancePage();
  });

  removeBtn.addEventListener("click", async () => {
    if (!activeImportedKey) {
      showToast("Choose an imported month first.", "error");
      return;
    }
    if (!window.confirm("Delete the selected imported month?")) return;
    const deletingId = activeImportedKey;
    await deleteImportedMonthRecord(deletingId);
    activeImportedKey = "";
    localStorage.setItem("qaActiveImportedMonthKeyV1", "");
    if (compareImportedKey === deletingId) {
      compareImportedKey = "";
      localStorage.setItem("qaCompareImportedMonthKeyV1", "");
    }
    await refreshImportedLibraryCache();
    populateImportSelectors();
    updateImportStatus();
    renderPerformancePage();
  });
}

function getImportedRowsForRecord(imported) {
  if (!imported) return [];
  if (Array.isArray(imported.rawRows) && imported.rawRows.length) return imported.rawRows;
  const rows = [];
  (imported.receivingAssociates || []).forEach(r => {
    rows.push({ department: "QA Receiving", associate: r.associate, date: r.date, units: Number(r.units || 0), boxes: 0, extras: 0, missing: 0, po: "", category: "" });
  });
  (imported.prepAssociates || []).forEach(r => {
    rows.push({ department: "Prep", associate: r.associate, date: r.date, units: Number(r.units || 0), boxes: 0, extras: 0, missing: 0, po: "", category: "" });
  });
  (imported.assemblyDaily || []).forEach(r => {
    rows.push({ department: "Assembly", associate: "Team Total", date: r.date, units: Number(r.units || 0), boxes: 0, extras: 0, missing: 0, po: "", category: "" });
  });
  return rows;
}

function getImportedRowsForPerformance() {
  const imported = getActiveImportedRecord();
  if (!imported) return [];
  const rows = [];
  (imported.receivingAssociates || []).forEach(r => {
    rows.push({
      department: "QA Receiving",
      associate: r.associate,
      date: r.date,
      units: Number(r.units || 0),
      boxes: 0,
      extras: 0,
      missing: 0,
      po: "",
      category: ""
    });
  });
  (imported.prepAssociates || []).forEach(r => {
    rows.push({
      department: "Prep",
      associate: r.associate,
      date: r.date,
      units: Number(r.units || 0),
      boxes: 0,
      extras: 0,
      missing: 0,
      po: "",
      category: ""
    });
  });
  // daily-only assembly summary
  (imported.assemblyDaily || []).forEach(r => {
    rows.push({
      department: "Assembly",
      associate: "Team Total",
      date: r.date,
      units: Number(r.units || 0),
      boxes: 0,
      extras: 0,
      missing: 0,
      po: "",
      category: ""
    });
  });
  return rows;
}

function populateImportSelectors() {
  const activeSelect = document.getElementById("activeImportSelect");
  const compareSelect = document.getElementById("compareImportSelect");
  const list = document.getElementById("importLibraryList");
  if (!activeSelect || !compareSelect || !list) return;

  activeSelect.innerHTML = "";
  appendOption(activeSelect, "", "Live App Data Only");
  importedLibraryCache.forEach(item => appendOption(activeSelect, item.id, item.label));
  activeSelect.value = activeImportedKey || "";

  compareSelect.innerHTML = "";
  appendOption(compareSelect, "", "No Comparison");
  importedLibraryCache
    .filter(item => item.id !== activeImportedKey)
    .forEach(item => appendOption(compareSelect, item.id, item.label));
  compareSelect.value = compareImportedKey || "";

  if (!importedLibraryCache.length) {
    list.innerHTML = `<div class="performance-empty">No monthly imports saved yet.</div>`;
    return;
  }

  list.innerHTML = importedLibraryCache.map(item => {
    const latest = getLatestImportedDate(item) || "—";
    const isActive = item.id === activeImportedKey;
    const isCompare = item.id === compareImportedKey;
    return `
      <div class="ranking-item">
        <div>
          <strong>${item.label}</strong>
          <div class="import-library-meta">${item.sourceName} • Latest date: ${latest} • Saved: ${new Date(item.importedAt).toLocaleString()}</div>
        </div>
        <div>
          ${isActive ? `<span class="lock-note">Active</span>` : ""}
          ${isCompare ? `<span class="lock-note">Compare</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function updateImportStatus() {
  const imported = loadImportedSummary();
  const el = document.getElementById("importStatusText");
  if (!el) return;
  if (!imported) {
    el.textContent = "No saved monthly import selected. The page is currently using app-entered data only.";
    return;
  }
  const latest = getLatestImportedDate(imported);
  const diag = imported.diagnostics || {};
  const statusCount = Array.isArray(imported.statusRows) ? imported.statusRows.length : 0;
  el.textContent = `Imported ${imported.sourceName} • Latest imported date: ${latest || "—"} • Line rows: ${diag.combinedRows || (imported.rawRows || []).length} • Status rows: ${statusCount} • Receiving days: ${diag.receivingDays || 0} • Prep days: ${diag.prepDays || 0}`;
}



function normalizeUserDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const year2 = Number(m[3]);
    const yyyy = year2 >= 70 ? 1900 + year2 : 2000 + year2;
    return `${yyyy}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return "";
}

function updatePerformanceLabels(context) {
  const unitsLabel = document.getElementById("perfUnitsLabel");
  const unitsHelp = document.getElementById("perfUnitsHelp");
  const sectionsLabel = document.getElementById("perfSectionsLabel");
  const sectionsHelp = document.getElementById("perfSectionsHelp");
  const dailyTitle = document.getElementById("dailySnapshotTitle");
  const dailyHelp = document.getElementById("dailySnapshotHelp");
  const rankingTitle = document.getElementById("teamRankingTitle");
  const rankingHelp = document.getElementById("teamRankingHelp");
  const insightsHelp = document.getElementById("huddleInsightsHelp");

  if (!unitsLabel) return;
  if (context.mode === "single") {
    unitsLabel.textContent = "Selected Day Units";
    unitsHelp.textContent = `Units processed on ${context.focusDate}`;
    sectionsLabel.textContent = "Selected Day Sections";
    sectionsHelp.textContent = `Sections touched on ${context.focusDate}`;
    dailyTitle.textContent = "Single Day Snapshot";
    dailyHelp.textContent = `Quick view for ${context.focusDate}.`;
    rankingTitle.textContent = `Team Ranking for ${context.focusDate}`;
    rankingHelp.textContent = `Who is producing on ${context.focusDate}.`;
    insightsHelp.textContent = `Talking points for ${context.focusDate}.`;
  } else if (context.mode === "range") {
    unitsLabel.textContent = "Range Units";
    unitsHelp.textContent = `Units processed across ${context.rangeStart} to ${context.rangeEnd}`;
    sectionsLabel.textContent = "Range Sections";
    sectionsHelp.textContent = `Sections touched across ${context.rangeStart} to ${context.rangeEnd}`;
    dailyTitle.textContent = "Date Range Snapshot";
    dailyHelp.textContent = `Quick view for ${context.rangeStart} to ${context.rangeEnd}.`;
    rankingTitle.textContent = "Team Ranking for Selected Range";
    rankingHelp.textContent = `Who produced the most in the selected range.`;
    insightsHelp.textContent = "Talking points for the selected range.";
  } else if (context.mode === "baseline") {
    unitsLabel.textContent = "Current Period Units";
    unitsHelp.textContent = "Units in the current baseline period";
    sectionsLabel.textContent = "Current Period Sections";
    sectionsHelp.textContent = "Sections touched in the current baseline period";
    dailyTitle.textContent = "Baseline Snapshot";
    dailyHelp.textContent = context.label;
    rankingTitle.textContent = "Team Ranking for Current Baseline Period";
    rankingHelp.textContent = "Who is producing in the current baseline period.";
    insightsHelp.textContent = "Talking points for the baseline comparison.";
  } else {
    unitsLabel.textContent = "Latest Imported Day Units";
    unitsHelp.textContent = `Units processed on ${context.focusDate}`;
    sectionsLabel.textContent = "Latest Imported Day Sections";
    sectionsHelp.textContent = `Sections touched on ${context.focusDate}`;
    dailyTitle.textContent = "Latest Imported Day Snapshot";
    dailyHelp.textContent = `Quick view for ${context.focusDate}.`;
    rankingTitle.textContent = `Team Ranking for ${context.focusDate}`;
    rankingHelp.textContent = `Who is producing on ${context.focusDate}.`;
    insightsHelp.textContent = `Talking points for ${context.focusDate}.`;
  }
}

function addDays(isoDate, delta) {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function getRowsBetween(rows, start, end) {
  return rows.filter(r => r.date >= start && r.date <= end);
}

function getPeriodContext(rows, imported) {
  const liveToday = new Date().toISOString().slice(0, 10);
  const importedLatest = getLatestImportedDate(imported);
  const mode = document.getElementById("performanceViewMode")?.value || "latest";
  const singleDateRaw = document.getElementById("performanceSingleDate")?.value || importedLatest || liveToday;
  const rangeStartRaw = document.getElementById("performanceRangeStart")?.value || "";
  const rangeEndRaw = document.getElementById("performanceRangeEnd")?.value || "";
  const baselineMode = document.getElementById("performanceBaselineMode")?.value || "today-vs-yesterday";

  const singleDate = normalizeUserDateInput(singleDateRaw) || importedLatest || liveToday;
  const rangeStart = normalizeUserDateInput(rangeStartRaw);
  const rangeEnd = normalizeUserDateInput(rangeEndRaw);

  let label = "";
  let currentRows = [];
  let previousRows = [];
  let focusDate = importedLatest || liveToday;

  if (mode === "single") {
    focusDate = singleDate;
    currentRows = rows.filter(r => r.date === singleDate);
    previousRows = rows.filter(r => r.date === addDays(singleDate, -1));
    label = `Single day: ${singleDate}`;
  } else if (mode === "range" && rangeStart && rangeEnd) {
    currentRows = getRowsBetween(rows, rangeStart, rangeEnd);
    const spanDays = Math.max(1, Math.round((new Date(rangeEnd+"T00:00:00") - new Date(rangeStart+"T00:00:00")) / 86400000) + 1);
    const prevEnd = addDays(rangeStart, -1);
    const prevStart = addDays(rangeStart, -spanDays);
    previousRows = getRowsBetween(rows, prevStart, prevEnd);
    label = `Date range: ${rangeStart} to ${rangeEnd}`;
    focusDate = rangeEnd;
  } else if (mode === "baseline") {
    if (baselineMode === "month-vs-last-month") {
      const monthKey = formatMonthKey(importedLatest || liveToday);
      const [y,m] = monthKey.split("-").map(Number);
      const prevMonthDate = `${m===1 ? y-1 : y}-${String(m===1?12:m-1).padStart(2,"0")}-01`;
      const prevMonthKey = formatMonthKey(prevMonthDate);
      currentRows = rows.filter(r => formatMonthKey(r.date) === monthKey);
      previousRows = rows.filter(r => formatMonthKey(r.date) === prevMonthKey);
      label = `Baseline: ${monthKey} vs ${prevMonthKey}`;
      focusDate = importedLatest || liveToday;
    } else {
      focusDate = importedLatest || liveToday;
      currentRows = rows.filter(r => r.date === focusDate);
      previousRows = rows.filter(r => r.date === addDays(focusDate, -1));
      label = `Baseline: ${focusDate} vs ${addDays(focusDate, -1)}`;
    }
  } else {
    focusDate = importedLatest || liveToday;
    currentRows = rows.filter(r => r.date === focusDate);
    previousRows = rows.filter(r => r.date === addDays(focusDate, -1));
    label = importedLatest ? `Latest imported day: ${focusDate}` : `Live today: ${focusDate}`;
  }

  return { mode, label, currentRows, previousRows, focusDate, rangeStart, rangeEnd, baselineMode };
}

function renderDateBreakdown(rows) {
  const el = document.getElementById("perfDateBreakdown");
  if (!el) return;
  const byDate = {};
  rows.forEach(r => { byDate[r.date] = (byDate[r.date] || 0) + r.units; });
  const items = Object.entries(byDate).sort((a,b)=>a[0].localeCompare(b[0]));
  if (!items.length) {
    el.innerHTML = `<div class="performance-empty">No rows for the selected date view.</div>`;
    return;
  }
  el.innerHTML = items.map(([date, units]) => `
    <div class="ranking-item">
      <div>${date}</div>
      <strong>${units} units</strong>
    </div>
  `).join("");
}

function renderLeadershipSummary(rows, currentRows, previousRows) {
  const el = document.getElementById("leadershipSummary");
  if (!el) return;
  const currentUnits = sum(currentRows, r=>r.units);
  const previousUnits = sum(previousRows, r=>r.units);
  const diff = currentUnits - previousUnits;
  const teamAvg = currentRows.length ? Math.round(currentUnits / Math.max(1, new Set(currentRows.map(r=>r.associate)).size)) : 0;
  const depMap = {};
  currentRows.forEach(r => depMap[r.department] = (depMap[r.department] || 0) + r.units);
  const topDep = Object.entries(depMap).sort((a,b)=>b[1]-a[1])[0];
  const ranking = {};
  currentRows.forEach(r => { if (r.associate) ranking[r.associate] = (ranking[r.associate] || 0) + r.units; });
  const topAssoc = Object.entries(ranking).sort((a,b)=>b[1]-a[1])[0];

  const cards = [
    { role: "Team Leads", text: `Use this to run huddles: top performer ${topAssoc ? topAssoc[0] : "—"}, average output ${teamAvg}, and biggest department ${topDep ? topDep[0] : "—"}.` },
    { role: "Supervisor", text: `Current units ${currentUnits}. Change vs previous period ${diff >= 0 ? "+" : ""}${diff}. Watch bottlenecks, coaching needs, and coverage.` },
    { role: "Operations Manager", text: `This view shows whether throughput is rising or falling, which department is carrying output, and where labor pacing needs adjustment.` },
    { role: "Senior Leadership", text: `High-level summary: output ${diff >= 0 ? "improving" : "softening"}, top department ${topDep ? topDep[0] : "—"}, top associate ${topAssoc ? topAssoc[0] : "—"}.` },
  ];

  el.innerHTML = cards.map(card => `
    <div class="insight-item">
      <div class="leadership-role">${card.role}</div>
      <div>${card.text}</div>
    </div>
  `).join("");
}


const PERFORMANCE_DEPT_META = {
  receiving: {
    label: "QA Receiving",
    title: { en: "QA Receiving Pace Planner", es: "Planificador de Ritmo de Recepción QA" },
    copy: {
      en: "Switch between QA Receiving and QA Prep without affecting anyone else’s view.",
      es: "Cambia entre Recepción QA y Preparación QA sin afectar la vista de otra persona."
    },
    goal: 200,
    headcount: 5,
    hours: 8,
    departments: ["QA Receiving", "Receiving", "QA receiving"]
  },
  prep: {
    label: "QA Prep",
    title: { en: "QA Prep Pace Planner", es: "Planificador de Ritmo de Preparación QA" },
    copy: {
      en: "Switch between QA Receiving and QA Prep without affecting anyone else’s view.",
      es: "Cambia entre Recepción QA y Preparación QA sin afectar la vista de otra persona."
    },
    goal: 275,
    headcount: 5,
    hours: 8,
    departments: ["Prep", "Prepping", "QA Prep", "Preparation"]
  }
};

function getPerformanceDeptMeta() {
  return PERFORMANCE_DEPT_META[state.performanceDeptView] || PERFORMANCE_DEPT_META.receiving;
}

function getRowsForPerformanceDept(rows) {
  const meta = getPerformanceDeptMeta();
  const allowed = new Set(meta.departments.map(item => String(item).toLowerCase()));
  return (rows || []).filter(row => allowed.has(String(row.department || "").toLowerCase()));
}

function renderPerformanceDeptHeader() {
  const meta = getPerformanceDeptMeta();
  const titleEl = document.getElementById("performanceDeptTitle");
  const copyEl = document.getElementById("performanceDeptCopy");
  if (titleEl) titleEl.textContent = meta.title[state.language] || meta.title.en;
  if (copyEl) copyEl.textContent = meta.copy[state.language] || meta.copy.en;

  document.querySelectorAll("[data-performance-dept]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-performance-dept") === state.performanceDeptView);
  });
}

const UPH_GOALS = { Prep: 275, QA: 180, Assembly: 220 };

function getAllWorkflowRows() {
  const rows = [];
  const importedRows = getImportedRowsForPerformance();
  importedRows.forEach(r => rows.push(r));

  const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
  pallets.forEach(pallet => {
    const date = String(pallet.date || (pallet.updatedAt ? new Date(pallet.updatedAt).toISOString().slice(0,10) : '') || '');
    (pallet.pos || []).forEach(row => {
      const po = row.po || '';
      const category = row.category || '';
      const boxes = Number(row.boxes || 0) || 0;
      const ordered = Number(row.orderedQty || 0) || 0;
      const received = Number(row.receivedQty || 0) || 0;
      const prepReceived = Number(row.prepReceivedQty || 0) || 0;
      const extras = Math.max(0, received - ordered);
      const missing = Math.max(0, ordered - received);
      rows.push({ department: 'Docker', associate: pallet.createdBy || '', date, units: ordered, boxes, extras: 0, missing: 0, po, category });
      if (row.receivingDone === true || received > 0) {
        rows.push({ department: 'QA Receiving', associate: (pallet.events || []).slice().reverse().find(evt => String(evt.type || '').includes('recv'))?.by || '', date, units: received, boxes, extras, missing, po, category });
      }
      if (row.prepVerified === true || prepReceived > 0) {
        rows.push({ department: 'Prep', associate: (pallet.events || []).slice().reverse().find(evt => String(evt.type || '').includes('prep'))?.by || '', date, units: prepReceived, boxes, extras: Math.max(0, prepReceived - received), missing: Math.max(0, received - prepReceived), po, category });
      }
    });
  });

  if (!rows.some(r => r.department === 'QA Receiving')) {
    (state.data.receivingSections || []).forEach(section => {
      (section.rows || []).forEach(row => {
        const extras = Number(row.extras || 0);
        rows.push({ department: 'QA Receiving', associate: section.name || '', date: section.date || '', units: Number(row.receivedQty || row.orderedQty || 0), boxes: Number(row.boxes || 0), extras: extras > 0 ? extras : 0, missing: extras < 0 ? Math.abs(extras) : 0, po: row.po || '', category: row.category || '' });
      });
    });
  }
  if (!rows.some(r => r.department === 'Prep')) {
    (state.data.prepSections || []).forEach(section => {
      (section.rows || []).forEach(row => {
        const extras = Number(row.extras || 0);
        rows.push({ department: 'Prep', associate: section.name || '', date: section.date || '', units: Number(row.receivedQty || row.orderedQty || 0), boxes: Number(row.boxes || 0), extras: extras > 0 ? extras : 0, missing: extras < 0 ? Math.abs(extras) : 0, po: row.po || '', category: row.category || '' });
      });
    });
  }
  return rows;
}


function getDepartmentLabelForPage(pageKey) {
  if (pageKey === "dock") return "Docker";
  if (pageKey === "receiving") return "QA Receiving";
  if (pageKey === "prep") return "Prep";
  return "";
}

function buildSyntheticSectionsFromImported(pageKey) {
  const department = getDepartmentLabelForPage(pageKey);
  if (!department) return [];
  const importedRows = (getImportedRowsForPerformance() || []).filter(row => String(row.department || "") === department);
  if (!importedRows.length) return [];

  const grouped = new Map();
  importedRows.forEach((row, idx) => {
    const associate = String(row.associate || "Imported").trim() || "Imported";
    const date = String(row.date || "").trim() || "";
    const key = `${associate}||${date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: `imported-${pageKey}-${associate}-${date || idx}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
        name: associate,
        date: date,
        location: "Imported",
        createdAt: Date.now() - idx,
        updatedAt: Date.now() - idx,
        rows: []
      });
    }
    const section = grouped.get(key);
    if (pageKey === "dock") {
      section.rows.push({
        id: `imported-row-${pageKey}-${idx}`,
        po: row.po || "",
        boxes: Number(row.boxes || 0) || 0,
        qty: Number(row.units || row.requested || row.received || 0) || 0,
        category: row.category || "",
        notes: row.notes || "",
        originalDate: row.originalDate || section.date || row.date || "",
        editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
        originalDate: date,
        editHistory: [],
        createdAt: Date.now() - idx
      });
    } else {
      const orderedQty = Number(row.requested || row.orderedQty || row.units || 0) || 0;
      const receivedQty = Number(row.received || row.receivedQty || row.units || 0) || 0;
      const extras = Number(row.extras || 0) || (receivedQty - orderedQty);
      section.rows.push({
        id: `imported-row-${pageKey}-${idx}`,
        po: row.po || "",
        boxes: Number(row.boxes || 0) || 0,
        orderedQty,
        receivedQty,
        extras,
        category: row.category || "",
        notes: row.notes || "",
        originalDate: row.originalDate || section.date || row.date || "",
        editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
        originalDate: date,
        editHistory: [],
        createdAt: Date.now() - idx
      });
    }
  });
  return [...grouped.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function formatMonthKey(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}`;
}

function sum(arr, fn) {
  return arr.reduce((acc, item) => acc + fn(item), 0);
}

function setMetricList(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="performance-empty">No matching data yet.</div>`;
    return;
  }
  el.innerHTML = items.map(item => `
    <div class="perf-metric-item">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
    </div>
  `).join("");
}

function renderRanking(items) {
  const el = document.getElementById("perfRankingList");
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="performance-empty">No team activity for the selected view yet.</div>`;
    return;
  }
  el.innerHTML = items.map((item, idx) => `
    <div class="ranking-item">
      <div><span class="ranking-rank">${idx+1}</span>${item.name}</div>
      <strong>${item.units} units</strong>
    </div>
  `).join("");
}

function renderInsights(lines) {
  const el = document.getElementById("perfInsights");
  if (!el) return;
  if (!lines.length) {
    el.innerHTML = `<div class="performance-empty">No insights yet.</div>`;
    return;
  }
  el.innerHTML = lines.map(line => `<div class="insight-item">• ${line}</div>`).join("");
}

function populatePerformanceControls() {
  const rows = getAllWorkflowRows();
  const associateSelect = document.getElementById("performanceAssociateSelect");
  const deptSelect = document.getElementById("performanceDepartmentSelect");
  if (!associateSelect || !deptSelect) return;

  const currentAssoc = associateSelect.value || "All";
  const currentDept = deptSelect.value || "All";

  associateSelect.innerHTML = "";
  appendOption(associateSelect, "All", "All Associates");
  [...new Set(rows.map(r => r.associate).filter(Boolean))].sort((a,b)=>a.localeCompare(b)).forEach(name => appendOption(associateSelect, name, name));
  associateSelect.value = [...associateSelect.options].some(o=>o.value===currentAssoc) ? currentAssoc : "All";

  deptSelect.innerHTML = "";
  appendOption(deptSelect, "All", "All Departments");
  ["Docker", "QA Receiving", "Prep", "Assembly"].forEach(dep => appendOption(deptSelect, dep, dep));
  deptSelect.value = ["All","Docker","QA Receiving","Prep","Assembly"].includes(currentDept) ? currentDept : "All";
}

function getPerformanceFilteredRows() {
  const rows = getAllWorkflowRows();
  const assoc = document.getElementById("performanceAssociateSelect")?.value || "All";
  const dept = document.getElementById("performanceDepartmentSelect")?.value || "All";
  let filtered = rows;
  if (assoc !== "All") filtered = filtered.filter(r => r.associate === assoc);
  if (dept !== "All") filtered = filtered.filter(r => r.department === dept);
  return filtered;
}


function renderPerformancePage() {
  renderPerformanceDeptHeader();

  const allRows = getAllWorkflowRows();
  const rows = getRowsForPerformanceDept(allRows);

  const meta = getPerformanceDeptMeta();
  const today = new Date().toISOString().slice(0, 10);
  const todaysRows = rows.filter(r => String(r.date || "").slice(0, 10) === today || !r.date ? true : String(r.date).slice(0,10) === today);
  const usingRows = todaysRows.length ? todaysRows : rows;

  const associates = [...new Set(usingRows.map(r => String(r.associate || "").trim()).filter(Boolean))];
  const categoriesMap = {};
  const associateMap = {};
  let totalUnits = 0;

  usingRows.forEach(row => {
    const units = Number(row.units || row.receivedQty || row.qty || 0) || 0;
    const category = String(row.category || "Uncategorized").trim() || "Uncategorized";
    const associate = String(row.associate || "Unknown").trim() || "Unknown";

    totalUnits += units;
    categoriesMap[category] = (categoriesMap[category] || 0) + units;
    associateMap[associate] = (associateMap[associate] || 0) + units;
  });

  const categoryEntries = Object.entries(categoriesMap).sort((a,b) => b[1] - a[1]);
  const associateEntries = Object.entries(associateMap).sort((a,b) => b[1] - a[1]);
  const topCategory = categoryEntries[0] ? categoryEntries[0][0] : "—";

  const statTopCategory = document.getElementById("performanceTopCategory");
  const statCategoryCount = document.getElementById("performanceCategoryCount");
  const statTotalUnits = document.getElementById("performanceTotalUnits");
  const statAssociateCount = document.getElementById("performanceAssociateCount");
  const assocEl = document.getElementById("performanceAssociateBreakdown");
  const catEl = document.getElementById("performanceCategoryBreakdown");

  if (statTopCategory) statTopCategory.textContent = topCategory;
  if (statCategoryCount) statCategoryCount.textContent = String(categoryEntries.length);
  if (statTotalUnits) statTotalUnits.textContent = String(totalUnits);
  if (statAssociateCount) statAssociateCount.textContent = String(associates.length);

  if (assocEl) {
    assocEl.innerHTML = associateEntries.length
      ? associateEntries.map(([name, units]) => `
          <div class="ranking-item">
            <div>${name}</div>
            <strong>${units} units</strong>
          </div>
        `).join("")
      : `<div class="performance-empty">No associate activity found for this department.</div>`;
  }

  if (catEl) {
    catEl.innerHTML = categoryEntries.length
      ? categoryEntries.map(([name, units]) => `
          <div class="ranking-item">
            <div>${name}</div>
            <strong>${units} units</strong>
          </div>
        `).join("")
      : `<div class="performance-empty">No category activity found for this department.</div>`;
  }

  const goalInput = document.getElementById("pacePlannerGoal");
  const headcountInput = document.getElementById("pacePlannerHeadcount");
  const hoursInput = document.getElementById("pacePlannerHours");

  if (goalInput && (!goalInput.value || goalInput.dataset.lastDept !== state.performanceDeptView)) {
    goalInput.value = String(meta.goal);
  }
  if (headcountInput && (!headcountInput.value || headcountInput.dataset.lastDept !== state.performanceDeptView)) {
    headcountInput.value = String(meta.headcount);
  }
  if (hoursInput && (!hoursInput.value || hoursInput.dataset.lastDept !== state.performanceDeptView)) {
    hoursInput.value = String(meta.hours);
  }
  if (goalInput) goalInput.dataset.lastDept = state.performanceDeptView;
  if (headcountInput) headcountInput.dataset.lastDept = state.performanceDeptView;
  if (hoursInput) hoursInput.dataset.lastDept = state.performanceDeptView;

  const goal = Number(goalInput?.value || meta.goal) || 0;
  const headcount = Number(headcountInput?.value || meta.headcount) || 0;
  const hours = Number(hoursInput?.value || meta.hours) || 0;
  const actualUph = headcount > 0 && hours > 0 ? +(totalUnits / (headcount * hours)).toFixed(1) : 0;
  const goalUnits = goal * headcount * hours;
  const variance = totalUnits - goalUnits;
  const projectedUnits = totalUnits;
  const requiredUph = headcount > 0 && hours > 0 ? Math.max(0, +((goalUnits - totalUnits) / (headcount * hours)).toFixed(1)) : 0;
  const unitsPerPerson = headcount > 0 ? +(totalUnits / headcount).toFixed(1) : 0;

  const currentUphEl = document.getElementById("pacePlannerCurrentUph");
  const goalUnitsEl = document.getElementById("pacePlannerGoalUnits");
  const varianceEl = document.getElementById("pacePlannerVariance");
  const projectedEl = document.getElementById("pacePlannerProjectedUnits");
  const requiredEl = document.getElementById("pacePlannerRequiredUph");
  const unitsPerPersonEl = document.getElementById("pacePlannerUnitsPerPerson");

  if (currentUphEl) currentUphEl.textContent = String(actualUph);
  if (goalUnitsEl) goalUnitsEl.textContent = String(goalUnits);
  if (varianceEl) varianceEl.textContent = `${variance >= 0 ? "+" : ""}${variance}`;
  if (projectedEl) projectedEl.textContent = String(projectedUnits);
  if (requiredEl) requiredEl.textContent = String(requiredUph);
  if (unitsPerPersonEl) unitsPerPersonEl.textContent = String(unitsPerPerson);

  const varianceCard = document.getElementById("pacePlannerVarianceCard");
  if (varianceCard) {
    varianceCard.classList.remove("good", "bad", "warn");
    varianceCard.classList.add(variance >= 0 ? "good" : "bad");
  }
  renderCurrentDeptUphBadge();
}



function bindPerformanceEvents() {
  const assoc = document.getElementById("performanceAssociateSelect");
  const dept = document.getElementById("performanceDepartmentSelect");
  const mode = document.getElementById("performanceViewMode");
  const single = document.getElementById("performanceSingleDate");
  const start = document.getElementById("performanceRangeStart");
  const end = document.getElementById("performanceRangeEnd");
  const baseline = document.getElementById("performanceBaselineMode");
  const todayBtn = document.getElementById("performanceTodayBtn");
  if (!assoc || !dept || !todayBtn) return;
  [assoc, dept, mode, single, start, end, baseline].forEach(el => { if (el) el.addEventListener("change", renderPerformancePage); });
  todayBtn.addEventListener("click", () => {
    renderPerformancePage();
  });

  ["historyLookupType","historyLookupQuery","historyLookupScope"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(id === "historyLookupQuery" ? "input" : "change", renderHistoryLookup);
  });

  ["uphDepartment","uphAssociates","uphHoursWorked","uphUnitsCompleted","uphShiftHours"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderUPHCalculator);
    if (el) el.addEventListener("change", renderUPHCalculator);
  });
  ["receivingGoalUph","receivingHeadcount","receivingShiftHours","receivingHoursElapsed","receivingUnitsCompleted"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === "receivingUnitsCompleted") {
      el.addEventListener("input", () => { el.dataset.userEdited = "true"; renderReceivingUphPlanner(); });
    } else {
      el.addEventListener("input", renderReceivingUphPlanner);
    }
    el.addEventListener("change", renderReceivingUphPlanner);
  });
}


function getReceivingDashboardDate() {
  const mode = document.getElementById("performanceViewMode")?.value || "latest";
  const single = document.getElementById("performanceSingleDate")?.value || "";
  const rows = getAllWorkflowRows().filter(r => r.department === "QA Receiving" && r.date);
  const today = new Date().toISOString().slice(0, 10);
  if (mode === "single" && single) return single;
  if (rows.some(r => r.date === today)) return today;
  const dates = [...new Set(rows.map(r => r.date))].sort();
  return dates[dates.length - 1] || today;
}

function getReceivingDashboardRows() {
  const date = getReceivingDashboardDate();
  const rows = getAllWorkflowRows().filter(r => r.department === "QA Receiving" && r.date === date);
  return { date, rows };
}

function renderReceivingCommandDashboard() {
  const payload = getReceivingDashboardRows();
  const rows = payload.rows;
  const date = payload.date;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  const pill = document.getElementById("receivingDashboardDatePill");
  if (pill) pill.textContent = rows.length ? `Using ${date}` : "No QA Receiving rows yet";

  const totalUnits = sum(rows, r => r.units || 0);
  const peopleMap = {};
  const categoryMap = {};
  rows.forEach(r => {
    if (r.associate) peopleMap[r.associate] = (peopleMap[r.associate] || 0) + Number(r.units || 0);
    const cat = r.category || "Uncategorized";
    categoryMap[cat] = (categoryMap[cat] || 0) + Number(r.units || 0);
  });

  const associateRanking = Object.entries(peopleMap).map(([name, units]) => ({ name, units })).sort((a,b)=>b.units-a.units);
  const categoryRanking = Object.entries(categoryMap).map(([name, units]) => ({ name, units })).sort((a,b)=>b.units-a.units);
  const topCategory = categoryRanking[0];

  setText("receivingTodayUnits", totalUnits);
  setText("receivingTodayPeople", associateRanking.length);
  setText("receivingTopCategory", topCategory ? topCategory.name : "—");
  setText("receivingCategoryCount", categoryRanking.length);
  setText("receivingTopCategoryMeta", topCategory ? `${topCategory.units} units today` : "No category activity yet");

  const peopleEl = document.getElementById("receivingAssociateLeaderboard");
  if (peopleEl) {
    peopleEl.innerHTML = associateRanking.length
      ? associateRanking.map((item, idx) => `
        <div class="ranking-item receiving-rank-item">
          <div><span class="ranking-rank">${idx + 1}</span><span class="receiving-rank-name">${item.name}</span></div>
          <strong>${item.units} units</strong>
        </div>
      `).join("")
      : `<div class="performance-empty">No QA Receiving work logged for this day yet.</div>`;
  }

  const catEl = document.getElementById("receivingCategoryBreakdown");
  if (catEl) {
    catEl.innerHTML = categoryRanking.length
      ? categoryRanking.map((item) => `
        <div class="ranking-item receiving-category-item">
          <div class="receiving-category-name">${item.name}</div>
          <strong>${item.units} units</strong>
        </div>
      `).join("")
      : `<div class="performance-empty">No categories logged for this day yet.</div>`;
  }

  const unitsInput = document.getElementById("receivingUnitsCompleted");
  if (unitsInput && (!unitsInput.dataset.userEdited || unitsInput.dataset.userEdited !== "true")) {
    unitsInput.value = totalUnits;
  }
  renderReceivingUphPlanner();
}

function renderReceivingUphPlanner() {
  const goal = Number(document.getElementById("receivingGoalUph")?.value || 200);
  const headcount = Number(document.getElementById("receivingHeadcount")?.value || 5);
  const shiftHours = Number(document.getElementById("receivingShiftHours")?.value || 8);
  const hoursElapsed = Number(document.getElementById("receivingHoursElapsed")?.value || 0);
  const unitsDone = Number(document.getElementById("receivingUnitsCompleted")?.value || 0);

  const laborHoursSoFar = Math.max(0, headcount * hoursElapsed);
  const plannedLaborHours = Math.max(0, headcount * shiftHours);
  const currentUph = laborHoursSoFar > 0 ? unitsDone / laborHoursSoFar : 0;
  const goalUnitsSoFar = goal * laborHoursSoFar;
  const projectedUnits = currentUph * plannedLaborHours;
  const goalTotalUnits = goal * plannedLaborHours;
  const remainingUnits = Math.max(0, goalTotalUnits - unitsDone);
  const remainingLaborHours = Math.max(0, plannedLaborHours - laborHoursSoFar);
  const requiredUph = remainingLaborHours > 0 ? remainingUnits / remainingLaborHours : 0;
  const variance = unitsDone - goalUnitsSoFar;
  const unitsPerPerson = headcount > 0 ? unitsDone / headcount : 0;

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("receivingCurrentUph", currentUph.toFixed(1));
  set("receivingGoalUnitsSoFar", Math.round(goalUnitsSoFar));
  set("receivingProjectedUnits", Math.round(projectedUnits));
  set("receivingRequiredUph", requiredUph.toFixed(1));
  set("receivingVariance", `${variance >= 0 ? "+" : ""}${Math.round(variance)}`);
  set("receivingUnitsPerPerson", unitsPerPerson.toFixed(1));
}

function renderUPHCalculator() {
  const dep = document.getElementById("uphDepartment")?.value || "Prep";
  const associates = Number(document.getElementById("uphAssociates")?.value || 0);
  const hoursWorked = Number(document.getElementById("uphHoursWorked")?.value || 0);
  const unitsDone = Number(document.getElementById("uphUnitsCompleted")?.value || 0);
  const shiftHours = Number(document.getElementById("uphShiftHours")?.value || 8);

  const goal = UPH_GOALS[dep] || 0;
  const laborHoursSoFar = associates * hoursWorked;
  const totalPlannedLaborHours = associates * shiftHours;
  const currentUPH = laborHoursSoFar > 0 ? unitsDone / laborHoursSoFar : 0;
  const goalUnitsSoFar = goal * laborHoursSoFar;
  const variance = unitsDone - goalUnitsSoFar;
  const projected = currentUPH * totalPlannedLaborHours;
  const goalTotalUnits = goal * totalPlannedLaborHours;
  const remainingUnitsNeeded = Math.max(0, goalTotalUnits - unitsDone);
  const remainingLaborHours = Math.max(0, totalPlannedLaborHours - laborHoursSoFar);
  const requiredUPH = remainingLaborHours > 0 ? remainingUnitsNeeded / remainingLaborHours : 0;

  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set("uphCurrent", currentUPH.toFixed(1));
  set("uphGoal", goal);
  set("uphGoalUnitsSoFar", Math.round(goalUnitsSoFar));
  set("uphVariance", `${variance >= 0 ? "+" : ""}${Math.round(variance)}`);
  set("uphProjected", Math.round(projected));
  set("uphRequired", requiredUPH.toFixed(1));
}


init();

async function init() {
  todayLabel.textContent = formatToday();
  bindPageEvents();
  bindMasterEvents();
  bindOverstockEvents();
  bindPutawayEvents();
  bindPerformanceEvents();
  bindImportControls();
  bindRoleTabs();
  bindLanguageSwitch();
  bindFilterToggles();
  bindCurrentUserControls();
  await Promise.all([loadWorkflowFromBackend(), refreshImportedLibraryCache()]);
  applyLanguage();
  renderAll();
  restoreSavedTab();
  // Refresh workflow data when user tabs back — so associates always see latest pallets
  window.addEventListener('focus', () => { if(workflowSyncEnabled) loadWorkflowFromBackend().catch(()=>{}); });
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible' && workflowSyncEnabled) loadWorkflowFromBackend().catch(()=>{});
  });
}

function t(key) {
  return (translations[state.language] && translations[state.language][key]) || key;
}

function bindLanguageSwitch() {
  langEnBtn.addEventListener("click", () => {
    state.language = "en";
    localStorage.setItem(LANGUAGE_KEY, "en");
    applyLanguage();
    renderAll();
  });
  langEsBtn.addEventListener("click", () => {
    state.language = "es";
    localStorage.setItem(LANGUAGE_KEY, "es");
    applyLanguage();
    renderAll();
  });
}

function bindFilterToggles() {
  document.querySelectorAll(".filter-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panelId = btn.getAttribute("data-target");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;
      const isOpen = !panel.classList.contains("hidden");
      panel.classList.toggle("hidden", isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
      const labelEl = btn.querySelector("span");
      if (labelEl) labelEl.textContent = isOpen ? t("filterResults") : t("hideFilter");
    });
  });
}

function applyLanguage() {
  // 1. data-i18n attributes (declarative, always up to date)
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  // 2. data-i18n-placeholder attributes
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // 3. Specific elements updated by ID
  const byId = {
    todayLabelText: "today", totalQtyLabel: "totalQty", languageLabel: "language",
  };
  Object.entries(byId).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  });
  // 4. Placeholders
  if (associateInput) associateInput.placeholder = t("addAssociatePlaceholder");
  if (categoryInput) categoryInput.placeholder = t("addCategoryPlaceholder");
  if (locationInput) locationInput.placeholder = t("addLocationPlaceholder");
  document.querySelectorAll(".search-field input").forEach((el) => el.placeholder = t("searchPlaceholder"));
  const overstockPo = document.getElementById("overstockEntryPo");
  if (overstockPo) overstockPo.placeholder = t("po");
  // 5. Dynamically rendered button text (class-based)
  const classBtnMap = {
    ".edit-section":            "editSection",
    ".add-inline-row":          "addRow",
    ".delete-section":          "deleteSection",
    ".save-section-edit":       "save",
    ".cancel-section-edit":     "cancel",
    ".save-inline-edit":        "save",
    ".cancel-inline-edit":      "cancel",
    ".history-row":             "viewTimeline",
    ".filter-toggle-btn span":  "filterResults",
    ".overstock-edit-btn":      "edit",
    ".overstock-delete-btn":    "delete",
    ".lock-note":               "notYourEntry",
    ".batch-history-close":     "close",
    ".putaway-expand-btn":      "viewTimeline",
  };
  // data-i18n-btn: a general-purpose attribute for any button needing translation
  // Works automatically for any new button that sets data-i18n-btn="keyName"
  document.querySelectorAll("[data-i18n-btn]").forEach((el) => {
    const key = el.dataset.i18nBtn;
    if (key) el.textContent = t(key);
  });
  Object.entries(classBtnMap).forEach(([sel, key]) => {
    document.querySelectorAll(sel).forEach((el) => { el.textContent = t(key); });
  });
  // 6. Filter toggle buttons — update label based on open/closed state
  document.querySelectorAll(".filter-toggle-btn").forEach((btn) => {
    const panelId = btn.getAttribute("data-target");
    const panel = panelId ? document.getElementById(panelId) : null;
    if (panel) {
      const isOpen = !panel.classList.contains("hidden");
      const labelEl = btn.querySelector("span");
      if (labelEl) labelEl.textContent = isOpen ? t("hideFilter") : t("filterResults");
    }
  });
  // 7. Language toggle buttons
  langEnBtn.classList.toggle("active", state.language === "en");
  langEsBtn.classList.toggle("active", state.language === "es");
  // 8. User display
  renderCurrentUser();
  // 9. Performance / summary buttons
  const perfBtn = document.getElementById("performanceTodayBtn");
  if (perfBtn) perfBtn.textContent = t("refreshView");
  const summaryBtn = document.getElementById("toggleSummaryBtn");
  if (summaryBtn) summaryBtn.textContent = summaryVisible ? t("hideSummary") : t("showSummary");
  // 10. My Items Only buttons (populated dynamically)
  document.querySelectorAll("[id$='MyItemsBtn']").forEach((btn) => {
    btn.textContent = t("myItemsOnly");
  });
  // 11. Clear Filters buttons
  document.querySelectorAll("[id$='ClearFiltersBtn']").forEach((btn) => {
    btn.textContent = t("clearFilters");
  });
  // 12. Re-render pages that have inline translated content
  // (called after full renderAll, so just refresh stat pills in timeline modal if open)
  const batchBackdrop = document.getElementById("batchHistoryBackdrop");
  if (batchBackdrop && !batchBackdrop.hidden) {
    // Modal is open — update its TH headers
    const head = document.getElementById("batchHistoryHead");
    if (head && head.innerHTML.trim()) {
      head.innerHTML = `<tr>
        <th>${t("stage")}</th><th>${t("date")}</th><th>${t("associate")}</th>
        <th>${t("location")}</th><th>${t("boxes")}</th><th>${t("orderedQty")}</th>
        <th>${t("receivedQty")}</th><th>${t("variance")}</th><th>${t("status")}</th>
        <th>${t("notes")}</th><th>${t("editTrail")}</th>
      </tr>`;
    }
  }
}

function bindPageEvents() {
  // The old section forms and filter controls have been removed from the DOM
  // (replaced by the pallet module). Guard every getElementById so the init
  // chain does not throw and kill tab-switching and other unrelated features.
  Object.entries(pageConfig).forEach(([pageKey, cfg]) => {
    const sectionForm = document.getElementById(cfg.sectionForm);
    if (sectionForm) {
      sectionForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const date = document.getElementById(cfg.sectionDate).value;
        const name = state.currentUser || "";
        const location = document.getElementById(cfg.sectionLocation).value;
        if (!location) { showToast("Location is required.", "error"); return; }
        if (!name) { showToast(state.language === "es" ? "Primero selecciona un usuario actual." : "Select a current user first.", "error"); return; }
        state.data[cfg.sectionKey].unshift({ id: makeId(), date, name, location, rows: [], createdAt: Date.now(), updatedAt: Date.now() });
        persistData();
        sectionForm.reset();
        renderPage(pageKey);
      });
    }

    const personFilter = document.getElementById(cfg.personFilter);
    if (personFilter) personFilter.addEventListener("change", (e) => { state.data[cfg.filterKey].person = e.target.value; renderPage(pageKey); });

    const dayFilter = document.getElementById(cfg.dayFilter);
    if (dayFilter) dayFilter.addEventListener("change", (e) => { state.data[cfg.filterKey].day = e.target.value; renderPage(pageKey); });

    const searchInput = document.getElementById(cfg.searchInput);
    if (searchInput) searchInput.addEventListener("input", (e) => { state.data[cfg.filterKey].search = e.target.value.trim().toLowerCase(); renderPage(pageKey); });

    const mineBtnId = pageKey === "dock" ? "myItemsBtn" : pageKey === "receiving" ? "receivingMyItemsBtn" : "prepMyItemsBtn";
    const mineBtn = document.getElementById(mineBtnId);
    if (mineBtn) mineBtn.addEventListener("click", () => { state.data[cfg.filterKey].mineOnly = !state.data[cfg.filterKey].mineOnly; renderPage(pageKey); });

    const clearBtn = document.getElementById(cfg.clearFiltersBtn);
    if (clearBtn) clearBtn.addEventListener("click", () => { state.data[cfg.filterKey] = { person: "All", day: "", search: "", mineOnly: false }; renderPage(pageKey); });

    const seedBtn = document.getElementById(cfg.seedBtn);
    if (seedBtn) seedBtn.addEventListener("click", () => { state.data[cfg.sectionKey] = demoSections(pageKey); persistData(); renderPage(pageKey); });
  });
}

function bindMasterEvents() {
  if (associateForm && associateInput) {
    associateForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addMasterItem("associates", associateInput.value);
      associateInput.value = "";
    });
  }
  if (categoryForm && categoryInput) {
    categoryForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addMasterItem("categories", categoryInput.value);
      categoryInput.value = "";
    });
  }
  if (locationForm && locationInput) {
    locationForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addMasterItem("locations", locationInput.value);
      locationInput.value = "";
    });
  }
}



// ── #10 Overstock draft persistence (survives tab switches) ─────────────
const OVERSTOCK_DRAFT_KEY = "overstockFormDraft_v1";
// Module-level so updateOverstockPoQuantity (called during re-renders) can always sync it
let _overstockAutoQty = null;
function overstockSaveDraft() {
  const draft = {
    date:      document.getElementById("overstockEntryDate")?.value || "",
    po:        document.getElementById("overstockEntryPo")?.value || "",
    poManual:  document.getElementById("overstockEntryPoManual")?.value || "",
    qty:       document.getElementById("overstockEntryQty")?.value || "",
    category:  document.getElementById("overstockEntryCategory")?.value || "",
    status:    document.getElementById("overstockEntryStatus")?.value || "",
    action:    document.getElementById("overstockEntryAction")?.value || "",
    location:  document.getElementById("overstockEntryLocation")?.value || "",
    associate: document.getElementById("overstockEntryAssociate")?.value || "",
    sizes:     [...document.querySelectorAll(".overstock-size-input")].reduce((acc, el) => {
      if (el.value) acc[el.dataset.size] = el.value; return acc;
    }, {}),
    isManual:  document.getElementById("overstockEntryPoManual")?.style.display !== "none",
  };
  try { sessionStorage.setItem(OVERSTOCK_DRAFT_KEY, JSON.stringify(draft)); } catch(e) {}
}
function overstockRestoreDraft() {
  try {
    const raw = sessionStorage.getItem(OVERSTOCK_DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    const dateEl = document.getElementById("overstockEntryDate");
    if (dateEl && d.date) dateEl.value = d.date;
    if (d.isManual) {
      const toggleBtn = document.getElementById("overstockPoModeToggle");
      if (toggleBtn) toggleBtn.click();
      const manualEl = document.getElementById("overstockEntryPoManual");
      if (manualEl && d.poManual) manualEl.value = d.poManual;
    } else {
      const poEl = document.getElementById("overstockEntryPo");
      if (poEl && d.po) { poEl.value = d.po; updateOverstockPoQuantity(); }
    }
    if (d.qty) {
      const qtyEl = document.getElementById("overstockEntryQty");
      if (qtyEl) qtyEl.value = d.qty;
    }
    const catEl = document.getElementById("overstockEntryCategory");
    if (catEl && d.category) {
      catEl.value = d.category;
      // Show apparel size panel if category was Apparel
      const apparelPanel = document.getElementById("overstockApparelSizes");
      if (apparelPanel) apparelPanel.style.display = isApparelCategory(d.category) ? "" : "none";
    }
    const statusEl = document.getElementById("overstockEntryStatus");
    if (statusEl && d.status) statusEl.value = d.status;
    const actionEl = document.getElementById("overstockEntryAction");
    if (actionEl && d.action) actionEl.value = d.action;
    const locEl = document.getElementById("overstockEntryLocation");
    if (locEl && d.location) locEl.value = d.location;
    const assocEl = document.getElementById("overstockEntryAssociate");
    if (assocEl && d.associate) assocEl.value = d.associate;
    if (d.sizes && Object.keys(d.sizes).length) {
      document.querySelectorAll(".overstock-size-input").forEach(el => {
        if (d.sizes[el.dataset.size]) el.value = d.sizes[el.dataset.size];
      });
    }
  } catch(e) {}
}
function overstockClearDraft() {
  try { sessionStorage.removeItem(OVERSTOCK_DRAFT_KEY); } catch(e) {}
}

function bindOverstockEvents() {
  const dateFilter = document.getElementById("overstockDateFilter");
  const associateFilter = document.getElementById("overstockAssociateFilter");
  const locationFilter = document.getElementById("overstockLocationFilter");
  const statusFilter = document.getElementById("overstockStatusFilter");
  const searchInput = document.getElementById("overstockSearchInput");

  dateFilter.addEventListener("change", (e) => { state.data.overstockFilters.date = e.target.value; renderOverstockPage(); });
  associateFilter.addEventListener("change", (e) => { state.data.overstockFilters.associate = e.target.value; renderOverstockPage(); });
  locationFilter.addEventListener("change", (e) => { state.data.overstockFilters.location = e.target.value; renderOverstockPage(); });
  statusFilter.addEventListener("change", (e) => { state.data.overstockFilters.status = e.target.value; renderOverstockPage(); });
  searchInput.addEventListener("input", (e) => { state.data.overstockFilters.search = e.target.value.trim().toLowerCase(); renderOverstockPage(); });

  document.getElementById("overstockMyItemsBtn").addEventListener("click", () => {
    state.data.overstockFilters.mineOnly = !state.data.overstockFilters.mineOnly;
    renderOverstockPage();
  });

  document.getElementById("overstockClearFiltersBtn").addEventListener("click", () => {
    state.data.overstockFilters = { date: "", associate: "All", location: "All", status: "All", search: "", mineOnly: false };
    renderOverstockPage();
  });

  document.getElementById("overstockSeedBtn").addEventListener("click", () => {
    state.data.overstockEntries = demoOverstockEntries();
    persistData();
    renderOverstockPage();
  });

  const overstockPoSelect = document.getElementById("overstockEntryPo");

  // ── #3 Auto-qty warning + delta signal ──────────────────────────────────
  // _overstockAutoQty is module-level (defined above bindOverstockEvents)
  const qtyInputEl      = document.getElementById("overstockEntryQty");
  const qtyAutoLbl      = document.getElementById("overstockQtyAutoLabel");
  const qtyAdjBadge     = document.getElementById("overstockQtyAdjustedBadge");
  const qtyAutoWarn     = document.getElementById("overstockAutoQtyWarn");

  function overstockCheckQtyAdjust() {
    if (_overstockAutoQty === null || !qtyInputEl) return;
    const cur = Number(qtyInputEl.value || 0);
    const auto = Number(_overstockAutoQty);
    if (cur !== auto) {
      const delta = cur - auto;
      if (qtyAdjBadge) { qtyAdjBadge.style.display = ""; qtyAdjBadge.textContent = `⚠️ Adjusted from auto (${auto}) — ${delta > 0 ? "+" : ""}${delta} from calculated`; }
      if (qtyAutoWarn) qtyAutoWarn.style.display = "";
    } else {
      if (qtyAdjBadge) qtyAdjBadge.style.display = "none";
      if (qtyAutoWarn) qtyAutoWarn.style.display = "none";
    }
  }

  if (qtyInputEl) {
    qtyInputEl.addEventListener("input", overstockCheckQtyAdjust);
    qtyInputEl.addEventListener("blur", overstockCheckQtyAdjust);
  }

  // updateOverstockPoQuantityWithSignal: called when user changes the PO dropdown
  // updateOverstockPoQuantity (module-level) already syncs _overstockAutoQty on every call
  function updateOverstockPoQuantityWithSignal() {
    updateOverstockPoQuantity(); // this already sets _overstockAutoQty and clears badges
  }
  if (overstockPoSelect) overstockPoSelect.addEventListener("change", updateOverstockPoQuantityWithSignal);

  // ── Manual PO entry toggle (Overstock) ──────────────────────────────────
  let overstockPoManualMode = false;
  const overstockToggleBtn   = document.getElementById("overstockPoModeToggle");
  const overstockModeLabel   = document.getElementById("overstockPoModeLabel");
  const overstockManualInput = document.getElementById("overstockEntryPoManual");
  const overstockManualWarn  = document.getElementById("overstockManualPoWarning");

  function setOverstockPoMode(manual) {
    overstockPoManualMode = manual;
    if (manual) {
      overstockPoSelect.style.display    = "none";
      overstockPoSelect.required         = false;
      overstockManualInput.style.display = "";
      overstockManualInput.required      = true;
      overstockManualWarn.style.display  = "";
      overstockModeLabel.textContent     = "Manual entry";
      overstockToggleBtn.textContent     = "Back to list";
      // Manual mode: qty is free to edit — clear auto signal
      _overstockAutoQty = null;
      if (qtyAutoLbl) { qtyAutoLbl.style.display = ""; qtyAutoLbl.textContent = " (enter manually)"; }
      if (qtyAdjBadge) qtyAdjBadge.style.display = "none";
      if (qtyAutoWarn) qtyAutoWarn.style.display = "none";
      if (qtyInputEl) qtyInputEl.readOnly = false;
      overstockManualInput.focus();
    } else {
      overstockPoSelect.style.display    = "";
      overstockPoSelect.required         = true;
      overstockManualInput.style.display = "none";
      overstockManualInput.required      = false;
      overstockManualWarn.style.display  = "none";
      overstockModeLabel.textContent     = "From Prep list";
      overstockToggleBtn.textContent     = "Enter manually";
      overstockManualInput.value         = "";
      updateOverstockPoQuantityWithSignal();
    }
  }
  if (overstockToggleBtn) overstockToggleBtn.addEventListener("click", () => setOverstockPoMode(!overstockPoManualMode));

  // ── #7 Apparel size breakdown toggle ────────────────────────────────────
  const catSelectEl       = document.getElementById("overstockEntryCategory");
  const apparelSizesPanel = document.getElementById("overstockApparelSizes");
  const sizeTotalHint     = document.getElementById("overstockSizeTotalHint");

  function updateApparelSizes() {
    if (!catSelectEl || !apparelSizesPanel) return;
    const isApparel = isApparelCategory(catSelectEl.value);
    apparelSizesPanel.style.display = isApparel ? "" : "none";
  }
  function updateSizeTotals() {
    if (!sizeTotalHint) return;
    const total = [...document.querySelectorAll(".overstock-size-input")]
      .reduce((s, el) => s + (Number(el.value) || 0), 0);
    const orderedQty = Number(qtyInputEl?.value || 0);
    if (total === 0) { sizeTotalHint.textContent = ""; return; }
    if (orderedQty && total !== orderedQty) {
      sizeTotalHint.style.color = "#dc2626";
      sizeTotalHint.textContent = `Size total: ${total} — does not match Overstock Qty (${orderedQty})`;
    } else {
      sizeTotalHint.style.color = "#059669";
      sizeTotalHint.textContent = `Size total: ${total} ✓`;
    }
  }
  if (catSelectEl) catSelectEl.addEventListener("change", updateApparelSizes);
  document.querySelectorAll(".overstock-size-input").forEach(el => {
    el.addEventListener("input", updateSizeTotals);
  });

  // ── #5 Location Audit ───────────────────────────────────────────────────
  const auditLocationSel = document.getElementById("overstockAuditLocation");
  const auditStartBtn    = document.getElementById("overstockAuditStartBtn");
  const auditClearBtn    = document.getElementById("overstockAuditClearBtn");
  const auditResults     = document.getElementById("overstockAuditResults");

  function populateAuditLocations() {
    if (!auditLocationSel) return;
    const prev = auditLocationSel.value;
    auditLocationSel.innerHTML = "";
    appendOption(auditLocationSel, "", "— Select location —");
    overstockLocations.forEach(loc => appendOption(auditLocationSel, loc, loc));
    if (prev) auditLocationSel.value = prev;
  }
  populateAuditLocations();

  function runLocationAudit() {
    if (!auditResults || !auditLocationSel) return;
    const loc = auditLocationSel.value;
    if (!loc) { showToast("Please select a location to audit.", "error"); return; }
    if (auditClearBtn) auditClearBtn.style.display = "";
    const entries = (state.data.overstockEntries || []).filter(r => r.location === loc);
    if (!entries.length) {
      auditResults.innerHTML = `<div style="padding:12px;color:#6b7280;font-size:13px;">No overstock entries logged for location <strong>${escapeHtml(loc)}</strong>.</div>`;
      return;
    }
    const rows = entries.map(r => {
      const sizesHtml = r.sizeBreakdown && Object.keys(r.sizeBreakdown).length
        ? `<div style="font-size:10px;color:#6b7280;">Sizes: ${Object.entries(r.sizeBreakdown).map(([s,qty])=>`${s}:${qty}`).join(' · ')}</div>` : '';
      return `<tr>
        <td><strong>${escapeHtml(r.po)}</strong></td>
        <td>${escapeHtml(r.category || '—')}</td>
        <td>${Number(r.quantity||0)}${sizesHtml}</td>
        <td>${translateStatus(r.status)}</td>
        <td>${translateStatus(r.action)}</td>
        <td>${escapeHtml(r.associate)}</td>
        <td><span class="day-pill ${getDayClass(formatDayCode(r.date))}">${formatDate(r.date)}</span></td>
        <td>
          <select class="audit-status-update" data-row-id="${r.id}" style="font-size:11px;">
            ${overstockStatusOptions.map(opt => `<option value="${opt}" ${opt===r.status?'selected':''}>${translateStatus(opt)}</option>`).join('')}
          </select>
        </td>
        <td>
          <select class="audit-action-update" data-row-id="${r.id}" style="font-size:11px;">
            ${overstockActionOptions.map(opt => `<option value="${opt}" ${opt===r.action?'selected':''}>${translateStatus(opt)}</option>`).join('')}
          </select>
        </td>
      </tr>`;
    }).join('');
    auditResults.innerHTML = `
      <div style="margin-bottom:8px;font-size:12px;color:#6b7280;">${entries.length} PO(s) at <strong>${escapeHtml(loc)}</strong>. Update status/action inline — changes save immediately.</div>
      <div class="table-wrap"><table class="sheet-table">
        <thead><tr><th>PO#</th><th>Category</th><th>Qty</th><th>Status</th><th>Action</th><th>Associate</th><th>Date</th><th>Update Status</th><th>Update Action</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;

    auditResults.querySelectorAll(".audit-status-update, .audit-action-update").forEach(sel => {
      sel.addEventListener("change", () => {
        const rowId = sel.dataset.rowId;
        const row = state.data.overstockEntries.find(r => r.id === rowId);
        if (!row) return;
        if (sel.classList.contains("audit-status-update")) row.status = sel.value;
        if (sel.classList.contains("audit-action-update")) row.action = sel.value;
        row.updatedAt = Date.now();
        persistData();
        renderOverstockPage();
        // Re-run audit after re-render so inline selects reflect fresh state
        if (auditLocationSel.value) runLocationAudit();
      });
    });
  }

  if (auditStartBtn) auditStartBtn.addEventListener("click", runLocationAudit);
  if (auditClearBtn) auditClearBtn.addEventListener("click", () => {
    if (auditResults) auditResults.innerHTML = "";
    auditClearBtn.style.display = "none";
  });

  // ── #4 PO Lookup ────────────────────────────────────────────────────────
  const poLookupInput   = document.getElementById("overstockPoLookupInput");
  const poLookupBtn     = document.getElementById("overstockPoLookupBtn");
  const poLookupClear   = document.getElementById("overstockPoLookupClear");
  const poLookupResults = document.getElementById("overstockPoLookupResults");

  function runPoLookup() {
    const q = (poLookupInput?.value || "").trim().toLowerCase();
    if (!poLookupResults) return;
    if (!q) { poLookupResults.innerHTML = ""; if (poLookupClear) poLookupClear.style.display = "none"; return; }
    if (poLookupClear) poLookupClear.style.display = "";
    const hits = (state.data.overstockEntries || []).filter(r => String(r.po || "").toLowerCase().includes(q));
    if (!hits.length) {
      poLookupResults.innerHTML = `<div style="padding:10px;color:#6b7280;font-size:13px;">No overstock entries found for "<strong>${escapeHtml(q)}</strong>".</div>`;
      return;
    }
    const rows = hits.map(r => {
      const sizesHtml = r.sizeBreakdown && Object.keys(r.sizeBreakdown).length
        ? `<div style="font-size:10px;color:#6b7280;">Sizes: ${Object.entries(r.sizeBreakdown).map(([s,qty])=>`${s}:${qty}`).join(' · ')}</div>` : '';
      const adjBadge = r.autoQtyAdjusted
        ? `<span style="font-size:10px;color:#92400e;background:#fef3c7;padding:1px 5px;border-radius:4px;">⚠️ adj. from ${r.originalAutoQty}</span>` : '';
      const srcBadge = r.sourceType === 'manual'
        ? `<span style="font-size:10px;background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:4px;">Manual</span>`
        : `<span style="font-size:10px;background:#d1fae5;color:#065f46;padding:1px 5px;border-radius:4px;">Auto</span>`;
      return `<tr>
        <td><span class="day-pill ${getDayClass(formatDayCode(r.date))}">${formatDate(r.date)}</span></td>
        <td><strong>${escapeHtml(r.po)}</strong> ${srcBadge} ${adjBadge}</td>
        <td>${escapeHtml(r.category || '—')}</td>
        <td>${Number(r.quantity||0)}${sizesHtml}</td>
        <td>${translateStatus(r.status)}</td>
        <td>${translateStatus(r.action)}</td>
        <td>${escapeHtml(r.location)}</td>
        <td>${escapeHtml(r.associate)}</td>
        <td>${r.updatedAt && r.updatedAt !== r.createdAt ? `<span style="font-size:10px;color:#6b7280;">edited ${new Date(r.updatedAt).toLocaleDateString()}</span>` : '—'}</td>
      </tr>`;
    }).join('');
    poLookupResults.innerHTML = `
      <div style="margin-bottom:6px;font-size:12px;color:#6b7280;">${hits.length} entr${hits.length===1?'y':'ies'} found for "<strong>${escapeHtml(q)}</strong>"</div>
      <div class="table-wrap"><table class="sheet-table">
        <thead><tr><th>Date</th><th>PO#</th><th>Category</th><th>Qty</th><th>Status</th><th>Action</th><th>Location</th><th>Associate</th><th>Last Edit</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  }

  if (poLookupBtn)   poLookupBtn.addEventListener("click", runPoLookup);
  if (poLookupInput) poLookupInput.addEventListener("keydown", e => { if (e.key === "Enter") runPoLookup(); });
  if (poLookupClear) poLookupClear.addEventListener("click", () => {
    if (poLookupInput) poLookupInput.value = "";
    if (poLookupResults) poLookupResults.innerHTML = "";
    poLookupClear.style.display = "none";
  });

  // ── #5 Audit function (see below, wired in renderOverstockPage) ──────────

  // ── #9 Default date to today ─────────────────────────────────────────────
  const entryDateEl = document.getElementById("overstockEntryDate");
  if (entryDateEl && !entryDateEl.value) {
    entryDateEl.value = new Date().toISOString().slice(0, 10);
  }

  // ── #10 Save draft on any form input (survives tab switch) ───────────────
  const formEl = document.getElementById("overstockEntryForm");
  if (formEl) {
    formEl.addEventListener("input", overstockSaveDraft);
    formEl.addEventListener("change", overstockSaveDraft);
  }

  document.getElementById("overstockEntryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!Array.isArray(state.data.overstockEntries)) state.data.overstockEntries = [];
    if (!state.data.overstockFilters) state.data.overstockFilters = { date: "", associate: "All", location: "All", status: "All", search: "" };

    // #8 PO required — reject if blank
    const selectedPo = overstockPoManualMode
      ? (overstockManualInput ? overstockManualInput.value.trim() : "")
      : document.getElementById("overstockEntryPo").value;

    if (!selectedPo) {
      if (overstockPoManualMode && overstockManualInput) {
        overstockManualInput.style.borderColor = "#dc2626";
        overstockManualInput.focus();
      } else if (!overstockPoManualMode && overstockPoSelect) {
        overstockPoSelect.style.borderColor = "#dc2626";
        overstockPoSelect.focus();
        showToast("Please select a PO before adding the row.", "error");
      }
      return;
    }
    if (overstockPoManualMode && overstockManualInput) overstockManualInput.style.borderColor = "";
    if (!overstockPoManualMode && overstockPoSelect) overstockPoSelect.style.borderColor = "";

    // Collect size breakdown if Apparel
    const sizeBreakdown = {};
    let hasSizes = false;
    document.querySelectorAll(".overstock-size-input").forEach(el => {
      if (el.value && Number(el.value) > 0) {
        sizeBreakdown[el.dataset.size] = Number(el.value);
        hasSizes = true;
      }
    });

    const qtyValue = Number(document.getElementById("overstockEntryQty").value || 0) || 0;
    const autoQtyWasAdjusted = _overstockAutoQty !== null && qtyValue !== Number(_overstockAutoQty);
    state.data.overstockEntries.unshift({
      id: makeId(),
      date: document.getElementById("overstockEntryDate").value,
      po: selectedPo,
      manualPo: overstockPoManualMode || undefined,
      sourceType: overstockPoManualMode ? 'manual' : 'auto',
      autoQtyAdjusted: autoQtyWasAdjusted || undefined,
      originalAutoQty: autoQtyWasAdjusted ? Number(_overstockAutoQty) : undefined,
      quantity: qtyValue,
      category: document.getElementById("overstockEntryCategory")?.value || "",
      sizeBreakdown: isApparelCategory(document.getElementById("overstockEntryCategory")?.value) ? (hasSizes ? sizeBreakdown : undefined) : undefined,
      status: document.getElementById("overstockEntryStatus").value,
      action: document.getElementById("overstockEntryAction").value,
      location: document.getElementById("overstockEntryLocation").value,
      associate: state.currentUser || document.getElementById("overstockEntryAssociate").value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    persistData();
    overstockClearDraft();
    document.getElementById("overstockEntryForm").reset();
    if (overstockPoManualMode) overstockManualInput.value = "";
    _overstockAutoQty = null;
    if (qtyAdjBadge) qtyAdjBadge.style.display = "none";
    if (qtyAutoWarn) qtyAutoWarn.style.display = "none";
    if (apparelSizesPanel) apparelSizesPanel.style.display = "none";
    // Re-default date to today after reset
    if (entryDateEl) entryDateEl.value = new Date().toISOString().slice(0, 10);
    updateOverstockPoQuantityWithSignal();
    renderOverstockPage();
  });
}

function translateStatus(value) {
  const map = {
    "Donation": t("donation"),
    "Not Donation": t("notDonation"),
    "Pending PB": t("pendingPb"),
    "Donated": t("donated"),
    "Required": t("required"),
    "Replaced": t("replaced"),
    "Missing from Box": t("missingFromBox"),
    "Lost": state.language === "es" ? "Perdido" : "Lost",
  };
  return map[value] || value;
}

function getFilteredOverstockEntries() {
  const filters = state.data.overstockFilters;
  if (typeof filters.mineOnly !== "boolean") filters.mineOnly = false;
  let rows = [...state.data.overstockEntries].sort((a,b)=> (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0));
  if (filters.date) rows = rows.filter(r => r.date === filters.date);
  if (filters.mineOnly && state.currentUser) rows = rows.filter(r => r.associate === state.currentUser);
  if (filters.associate !== "All") rows = rows.filter(r => r.associate === filters.associate);
  if (filters.location !== "All") rows = rows.filter(r => r.location === filters.location);
  if (filters.status !== "All") rows = rows.filter(r => r.status === filters.status);
  if (filters.search) rows = rows.filter(r => [r.date, r.po, r.status, r.action, r.location, r.associate].join(" ").toLowerCase().includes(filters.search));
  return rows;
}

function populateOverstockFormSelects() {
  const associateSelect = document.getElementById("overstockEntryAssociate");
  if (associateSelect) {
    associateSelect.innerHTML = "";
    appendOption(associateSelect, "", t("selectAssociate"));
    [...state.masters.associates].sort((a,b)=>a.localeCompare(b)).forEach(name => appendOption(associateSelect, name, name));
    if (state.currentUser && state.masters.associates.includes(state.currentUser)) {
      associateSelect.value = state.currentUser;
      associateSelect.disabled = true;
    } else {
      associateSelect.disabled = false;
    }
  }

  // ── #6 Category dropdown (manual entries) ────────────────────────────
  const categorySelect = document.getElementById("overstockEntryCategory");
  if (categorySelect) {
    const prev = categorySelect.value;
    categorySelect.innerHTML = "";
    appendOption(categorySelect, "", "— Category (optional) —");
    (Array.isArray(state.masters.categories) ? state.masters.categories : ['Drinkware','Apparel','Electronics','Kitchen','Toys','Misc'])
      .forEach(c => appendOption(categorySelect, c, c));
    if (prev) categorySelect.value = prev;
  }

  const poSelect = document.getElementById("overstockEntryPo");
  if (poSelect) {
    const prepMap = getPrepPoReferenceMap();
    const previous = poSelect.value;
    poSelect.innerHTML = "";
    appendOption(poSelect, "", "Select PO from Prep");
    [...prepMap.values()]
      .filter(item => item.quantity > 0 && item.extrasSource === 'prep')
      .sort((a,b)=>a.po.localeCompare(b.po))
      .forEach(item => {
        const overLabel = `+${item.quantity} overstock`;
        const compareLabel = item.prepVsReceiving == null
          ? ''
          : `Prep vs Recv ${item.prepVsReceiving > 0 ? '+' : ''}${item.prepVsReceiving}`;
        const label = [
          item.po,
          item.palletLabel ? `[${item.palletLabel}]` : '',
          item.category ? item.category : '',
          overLabel,
          compareLabel,
        ].filter(Boolean).join(' • ');
        appendOption(poSelect, item.po, label);
      });
    poSelect.value = prepMap.has(previous) ? previous : "";
  }

  const qtyInput = document.getElementById("overstockEntryQty");
  if (qtyInput && !qtyInput.value) updateOverstockPoQuantity();

  const locationSelect = document.getElementById("overstockEntryLocation");
  if (locationSelect) {
    locationSelect.innerHTML = "";
    appendOption(locationSelect, "", t("selectLocation"));
    overstockLocations.forEach(loc => appendOption(locationSelect, loc, loc));
  }

  const statusSelect = document.getElementById("overstockEntryStatus");
  if (statusSelect) {
    statusSelect.innerHTML = "";
    appendOption(statusSelect, "", t("status"));
    overstockStatusOptions.forEach(opt => appendOption(statusSelect, opt, translateStatus(opt)));
  }

  const actionSelect = document.getElementById("overstockEntryAction");
  if (actionSelect) {
    actionSelect.innerHTML = "";
    appendOption(actionSelect, "", t("actionNeeded"));
    overstockActionOptions.forEach(opt => appendOption(actionSelect, opt, translateStatus(opt)));
  }
}

function populateOverstockFilterSelects() {
  const filters = state.data.overstockFilters;

  const associateFilter = document.getElementById("overstockAssociateFilter");
  associateFilter.innerHTML = "";
  appendOption(associateFilter, "All", t("everyone"));
  [...state.masters.associates].sort((a,b)=>a.localeCompare(b)).forEach(name => appendOption(associateFilter, name, name));
  associateFilter.value = filters.associate || "All";

  const locationFilter = document.getElementById("overstockLocationFilter");
  locationFilter.innerHTML = "";
  appendOption(locationFilter, "All", t("everyone"));
  overstockLocations.forEach(loc => appendOption(locationFilter, loc, loc));
  locationFilter.value = filters.location || "All";

  const statusFilter = document.getElementById("overstockStatusFilter");
  statusFilter.innerHTML = "";
  appendOption(statusFilter, "All", t("everyone"));
  overstockStatusOptions.forEach(opt => appendOption(statusFilter, opt, translateStatus(opt)));
  statusFilter.value = filters.status || "All";

  document.getElementById("overstockDateFilter").value = filters.date || "";
  document.getElementById("overstockSearchInput").value = filters.search || "";
  const overstockMineBtn = document.getElementById("overstockMyItemsBtn");
  if (overstockMineBtn) overstockMineBtn.classList.toggle("active-filter", !!filters.mineOnly);
}


function renderOverstockPage() {
  if (!Array.isArray(state.data.overstockEntries)) state.data.overstockEntries = [];
  if (!state.data.overstockFilters) state.data.overstockFilters = { date: "", associate: "All", location: "All", status: "All", search: "", mineOnly: false };

  // ── Pallet-sourced overstock queue ───────────────────────────────────────
  const overstockQueueEl = document.getElementById("overstockPalletQueue");
  if (overstockQueueEl) {
    const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
    const palletOverstockPOs = [];
    pallets.filter(p => p.status === 'prep' || p.status === 'done').forEach(pallet => {
      (pallet.pos || []).forEach(po => {
        const ref = getPoPrepVarianceRef(po);
        // Only show as overstock if Prep actually counted AND prep count > ordered qty
        // (not just "receiving > ordered" — Prep is the verification step)
        const over = ref.extras;
        if (over > 0 && ref.extrasSource === 'prep') palletOverstockPOs.push({
          po: po.po,
          overstock: over,
          ordered: ref.ordered || 0,
          received: ref.received || 0,
          prep: ref.prep || 0,
          prepVsReceiving: ref.prepVsReceiving,
          extrasSource: ref.extrasSource,
          category: po.category || '—',
          pallet: pallet.label,
          palletDate: pallet.date || '',
          status: pallet.status
        });
      });
    });

    if (palletOverstockPOs.length === 0) {
      overstockQueueEl.innerHTML = '';
    } else {
      const rows = palletOverstockPOs.map(item => `
        <tr>
          <td><strong>PO# ${escapeHtml(item.po)}</strong></td>
          <td>${escapeHtml(item.category)}</td>
          <td>${item.ordered}</td>
          <td>${item.received}</td>
          <td>${item.prep || '—'}</td>
          <td>${item.prepVsReceiving == null ? '—' : `${item.prepVsReceiving > 0 ? '+' : ''}${item.prepVsReceiving}`}</td>
          <td><span style="font-weight:700;color:#854d0e;background:#fef9c3;padding:2px 8px;border-radius:6px;">+${item.overstock}</span></td>
          <td>${escapeHtml(item.pallet)}${item.palletDate ? ' · ' + item.palletDate : ''}</td>
          <td><span style="font-size:0.75rem;color:#555;">${item.status === 'done' ? '✅ Done' : '🔀 In Prep'}</span></td>
        </tr>`).join('');
      overstockQueueEl.innerHTML = `
        <section class="panel" style="border-left:4px solid #d97706;">
          <div class="panel-header">
            <div>
              <h2>📤 Overstock from Pallets</h2>
              <p>These POs have true extras after Prep. Overstock is based on Prep count minus Ordered quantity, while Prep vs Receiving is shown separately for comparison.</p>
            </div>
          </div>
          <div class="table-wrap">
            <table class="sheet-table">
              <thead><tr>
                <th>PO #</th><th>Category</th>
                <th>Ordered</th><th>Receiving</th><th>Prep</th><th>Prep vs Recv</th><th>Overstock Qty</th>
                <th>Pallet</th><th>Stage</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>`;
    }
  }

  populateOverstockFormSelects();
  populateOverstockFilterSelects();

  // #9 default date to today if blank, #10 restore any in-progress draft
  const entryDateEl2 = document.getElementById("overstockEntryDate");
  if (entryDateEl2 && !entryDateEl2.value) {
    entryDateEl2.value = new Date().toISOString().slice(0, 10);
  }
  overstockRestoreDraft();

  const entries = getFilteredOverstockEntries();
  document.getElementById("overstockStatRows").textContent = entries.length;
  document.getElementById("overstockStatDonation").textContent = entries.filter(r => r.status === "Donation").length;
  document.getElementById("overstockStatRequired").textContent = entries.filter(r => r.action === "Required").length;
  document.getElementById("overstockStatAssociates").textContent = new Set(entries.map(r => r.associate)).size;

  const tbody = document.getElementById("overstockTableBody");
  tbody.innerHTML = "";
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state-cell">${t("noRows")}</td></tr>`;
    return;
  }

  entries.forEach((row) => {
    const isAutoRow = row.sourceType === 'auto' || (!!row.po && !row.manualPo);
    const ownerLocked = isAutoRow || !!(state.currentUser && state.currentUser !== LEADERSHIP_USER && row.associate && row.associate !== state.currentUser);
    const tr = document.createElement("tr");
    const batchCount = getPoHistoryCount("overstock", row.po);
    const batchBtn = batchCount >= 1
      ? `<button class="tiny-btn history-row" type="button">${t("viewTimeline")}</button>`
      : `<span class="lock-note">—</span>`;
    const sizesHtml = row.sizeBreakdown && Object.keys(row.sizeBreakdown).length
      ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;">${Object.entries(row.sizeBreakdown).map(([s,q])=>`${s}:${q}`).join(' · ')}</div>`
      : '';
    const adjBadge = row.autoQtyAdjusted
      ? `<div style="font-size:10px;color:#92400e;background:#fef3c7;padding:1px 5px;border-radius:4px;margin-top:2px;display:inline-block;">⚠️ adj. from ${row.originalAutoQty}</div>`
      : '';
    tr.innerHTML = `
      <td><span class="day-pill ${getDayClass(formatDayCode(row.date))}">${formatDate(row.date)}</span></td>
      <td>${escapeHtml(row.po)} ${isAutoRow ? '<span class="lock-note" style="margin-left:6px;">Auto</span>' : ''}</td>
      <td>${escapeHtml(row.category || '—')}</td>
      <td>${Number(row.quantity || 0) || 0}${sizesHtml}${adjBadge}</td>
      <td>${translateStatus(row.status)}</td>
      <td>${translateStatus(row.action)}</td>
      <td>${escapeHtml(row.location)}</td>
      <td>${escapeHtml(row.associate)}</td>
      <td class="action-stack">
        ${batchBtn}
        <button class="tiny-btn overstock-edit-btn" type="button" ${ownerLocked ? "disabled" : ""}>${state.language === "es" ? "Editar" : "Edit"}</button>
        <button class="tiny-btn ghost-btn overstock-delete-btn" type="button" ${ownerLocked ? "disabled" : ""}>${state.language === "es" ? "Eliminar" : "Delete"}</button>
      </td>
    `;
    const histBtn = tr.querySelector(".history-row");
    if (histBtn) histBtn.addEventListener("click", () => openBatchHistoryModal("overstock", row.po));
    if (!ownerLocked) {
      tr.querySelector(".overstock-delete-btn").addEventListener("click", () => {
        state.data.overstockEntries = state.data.overstockEntries.filter(item => item.id !== row.id);
        persistData();
        renderOverstockPage();
      });
      tr.querySelector(".overstock-edit-btn").addEventListener("click", () => toggleOverstockEditRow(tr, row.id));
    }
    tbody.appendChild(tr);
  });
}

function toggleOverstockEditRow(tableRow, rowId) {
  const tbody = tableRow.parentElement;
  const existing = tbody.querySelector(".overstock-edit-row");
  if (existing && existing !== tableRow.nextElementSibling) existing.remove();
  const alreadyOpen = tableRow.nextElementSibling && tableRow.nextElementSibling.classList.contains("overstock-edit-row");
  if (alreadyOpen) return tableRow.nextElementSibling.remove();

  const row = state.data.overstockEntries.find(item => item.id === rowId);
  const editTr = document.createElement("tr");
  editTr.className = "overstock-edit-row";
  const manualRow = row.sourceType === 'manual' || row.manualPo;
  editTr.innerHTML = `
    <td colspan="9">
      <div class="overstock-edit-grid">
        <input type="date" value="${row.date}" data-field="date" />
        ${manualRow
          ? `<input type="text" value="${row.po || ''}" data-field="po" placeholder="PO number" />`
          : `<select data-field="po"></select>`}
        <select data-field="category"></select>
        <input type="number" value="${Number(row.quantity || 0) || 0}" data-field="quantity" ${manualRow ? '' : 'readonly'} />
        <select data-field="status"></select>
        <select data-field="action"></select>
        <select data-field="location"></select>
        <select data-field="associate"></select>
        <button class="tiny-btn save-overstock-edit" type="button">${t("save")}</button>
        <button class="tiny-btn ghost-btn cancel-overstock-edit" type="button">${t("cancel")}</button>
      </div>
    </td>
  `;

  const poSel = editTr.querySelector('[data-field="po"]');
  const qtyInput = editTr.querySelector('[data-field="quantity"]');
  const prepMap = getPrepPoReferenceMap();
  // Only wire the prep-PO dropdown if this is an auto row (manual rows use a text input)
  if (!manualRow && poSel && poSel.tagName === 'SELECT') {
    poSel.innerHTML = "";
    appendOption(poSel, "", "Select Prep PO");
    [...prepMap.values()].sort((a,b)=>a.po.localeCompare(b.po)).forEach(item => appendOption(poSel, item.po, `${item.po} • Qty ${item.quantity}`));
    poSel.value = prepMap.has(row.po) ? row.po : "";
    const syncEditQty = () => {
      const ref = prepMap.get(poSel.value);
      qtyInput.value = ref ? String(ref.quantity || 0) : "";
    };
    poSel.addEventListener("change", syncEditQty);
    syncEditQty();
  }

  const categorySel = editTr.querySelector('[data-field="category"]');
  categorySel.innerHTML = "";
  appendOption(categorySel, "", "— Category —");
  (Array.isArray(state.masters.categories) ? state.masters.categories : ['Drinkware','Apparel','Electronics','Kitchen','Toys','Misc'])
    .forEach(c => appendOption(categorySel, c, c));
  categorySel.value = row.category || "";

  const statusSel = editTr.querySelector('[data-field="status"]');
  statusSel.innerHTML = "";
  overstockStatusOptions.forEach(opt => appendOption(statusSel, opt, translateStatus(opt)));
  statusSel.value = row.status;

  const actionSel = editTr.querySelector('[data-field="action"]');
  actionSel.innerHTML = "";
  overstockActionOptions.forEach(opt => appendOption(actionSel, opt, translateStatus(opt)));
  actionSel.value = row.action;

  const locationSel = editTr.querySelector('[data-field="location"]');
  locationSel.innerHTML = "";
  overstockLocations.forEach(loc => appendOption(locationSel, loc, loc));
  locationSel.value = row.location;

  const associateSel = editTr.querySelector('[data-field="associate"]');
  associateSel.innerHTML = "";
  [...state.masters.associates].sort((a,b)=>a.localeCompare(b)).forEach(name => appendOption(associateSel, name, name));
  associateSel.value = row.associate;

  editTr.querySelector(".save-overstock-edit").addEventListener("click", () => {
    const beforeSnapshot = cloneForAudit(row);
    ensureRowAuditFields(row, { date: row.date || "" });

    row.date = editTr.querySelector('[data-field="date"]').value;
    const poField = editTr.querySelector('[data-field="po"]');
    row.po = (poField ? poField.value : row.po).trim();
    row.category = editTr.querySelector('[data-field="category"]').value;
    row.quantity = Number(editTr.querySelector('[data-field="quantity"]').value || 0) || 0;
    row.status = editTr.querySelector('[data-field="status"]').value;
    row.action = editTr.querySelector('[data-field="action"]').value;
    row.location = editTr.querySelector('[data-field="location"]').value;
    row.associate = editTr.querySelector('[data-field="associate"]').value;
    row.updatedAt = Date.now();

    row.date = row.originalDate || row.date || "";
    const afterSnapshot = cloneForAudit(row);
    recordRowEditAudit(row, beforeSnapshot, afterSnapshot, { date: row.originalDate || row.date || "" }, state.currentUser || row.associate || "Unknown");

    persistData();
    renderOverstockPage();
  });
  editTr.querySelector(".cancel-overstock-edit").addEventListener("click", () => editTr.remove());
  tableRow.insertAdjacentElement("afterend", editTr);
}

function demoOverstockEntries() {
  return [
    { id: makeId(), date: "2026-02-24", po: "281208", status: "Not Donation", action: "Required", location: "E-19", associate: "Marcela", createdAt: Date.now()-50000, updatedAt: Date.now()-50000 },
    { id: makeId(), date: "2026-02-24", po: "281618", status: "Donation", action: "Donated", location: "E-19", associate: "Marcela", createdAt: Date.now()-45000, updatedAt: Date.now()-45000 },
    { id: makeId(), date: "2026-02-25", po: "281807", status: "Not Donation", action: "Replaced", location: "E-3", associate: "Rosa", createdAt: Date.now()-40000, updatedAt: Date.now()-40000 },
    { id: makeId(), date: "2026-02-26", po: "267551", status: "Not Donation", action: "Required", location: "E-21", associate: "Rosa", createdAt: Date.now()-35000, updatedAt: Date.now()-35000 },
    { id: makeId(), date: "2026-02-24", po: "281464", quantity: 7, status: "Pending PB", action: "Donated", location: "E-19", associate: "Marcela", createdAt: Date.now()-30000, updatedAt: Date.now()-30000 },
  ];
}


function formatDayCode(dateValue) {
  const d = new Date(dateValue + "T00:00:00");
  const names = ["sun","mon","tue","wed","thu","fri","sat"];
  return names[d.getDay()] || "";
}

function bindRoleTabs() {
  const TAB_KEY = "wf_activeTab";
  roleTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".role-tab");
    if (!button) return;
    state.currentPage = button.dataset.page;
    try { sessionStorage.setItem(TAB_KEY, state.currentPage); } catch(e) {}

    document.querySelectorAll(".role-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.page === state.currentPage);
    });

    pages.forEach((page) => {
      page.classList.toggle("active", page.id === `page-${state.currentPage}`);
    });

    statsGrid.style.display = ["dock", "receiving", "prep"].includes(state.currentPage) ? "grid" : "none";
    if (state.currentPage === "performance") renderPerformancePage();
    if (state.currentPage === "overstock") renderOverstockPage();
    if (state.currentPage === "putaway") renderPutawayPage();
    // Re-render pallet panels whenever a tab is clicked (they are lazy-rendered)
    if (typeof plt_renderAllPanels === "function") plt_renderAllPanels();
    renderStats();
    renderCurrentDeptUphBadge();
  });
}

function restoreSavedTab() {
  try {
    const saved = sessionStorage.getItem("wf_activeTab");
    if (saved && saved !== "dock") {
      const btn = roleTabs.querySelector(`.role-tab[data-page="${saved}"]`);
      if (btn) btn.click();
    }
  } catch(e) {}
}


function normalizeAuditFieldsAcrossWorkflow() {
  const touchRows = (sections) => {
    (sections || []).forEach(section => {
      (section.rows || []).forEach(row => ensureRowAuditFields(row, section));
    });
  };
  touchRows(state.data.dockSections || []);
  touchRows(state.data.receivingSections || []);
  touchRows(state.data.prepSections || []);
  (state.data.overstockEntries || []).forEach(row => ensureRowAuditFields(row, { date: row.date || "" }));
  (state.data.putawayEntries || []).forEach(row => ensureRowAuditFields(row, { date: row.date || "" }));
}
function renderAll() {
  normalizeAuditFieldsAcrossWorkflow();
  syncAssociatesFromAttendance();
  // dock/receiving/prep are now pallet-driven; their old section DOM is removed.
  // inbound-pallets.js handles those panels via plt_renderAllPanels().
  renderOverstockPage();
  renderPutawayPage();
  renderPerformancePage();
  populateImportSelectors();
  updateImportStatus();
  renderMasterLists();
  renderStats();
  renderCurrentDeptUphBadge();
  bindUphPaceCustomizer();
  populateCurrentUserSelect();
  applyLanguage();
}

function renderPage(pageKey) {
  const cfg = pageConfig[pageKey];

  // All three inbound tabs (dock/receiving/prep) had their section DOM removed
  // and replaced by the pallet module. Guard every getElementById call so we
  // never throw on a missing element and kill the rest of the init chain.
  const sectionLocation = document.getElementById(cfg.sectionLocation);
  if (sectionLocation) fillSelect(sectionLocation, state.masters.locations, t("selectLocation"));

  const filters = state.data[cfg.filterKey];
  const personSelect = document.getElementById(cfg.personFilter);
  if (personSelect) {
    personSelect.innerHTML = "";
    appendOption(personSelect, "All", t("everyone"));
    [...state.masters.associates].sort((a, b) => a.localeCompare(b)).forEach((name) => appendOption(personSelect, name, name));
    personSelect.value = state.masters.associates.includes(filters.person) || filters.person === "All" ? filters.person : "All";
    filters.person = personSelect.value;
  }

  if (typeof filters.mineOnly !== "boolean") filters.mineOnly = false;
  const dayFilterEl = document.getElementById(cfg.dayFilter);
  if (dayFilterEl) dayFilterEl.value = filters.day;
  const searchInputEl = document.getElementById(cfg.searchInput);
  if (searchInputEl) searchInputEl.value = filters.search;
  const mineBtn = document.getElementById(pageKey === "dock" ? "myItemsBtn" : pageKey === "receiving" ? "receivingMyItemsBtn" : "prepMyItemsBtn");
  if (mineBtn) mineBtn.classList.toggle("active-filter", !!filters.mineOnly);

  // If the section container is gone this tab is pallet-driven — skip renderSections
  const container = document.getElementById(cfg.container);
  if (!container) {
    if (state.currentPage === pageKey) renderStats();
    renderCurrentDeptUphBadge();
    applyLanguage();
    return;
  }

  renderSections(pageKey);
  if (state.currentPage === pageKey) renderStats();
  renderCurrentDeptUphBadge();
  applyLanguage();
}

function renderSections(pageKey) {
  const cfg = pageConfig[pageKey];
  const container = document.getElementById(cfg.container);
  if (!container) return; // pallet-driven tab — no section DOM
  container.innerHTML = "";

  const visibleSections = getVisibleSections(pageKey);

  if (!visibleSections.length) {
    container.innerHTML = `<div class="empty-state">${t("noRows")}</div>`;
    return;
  }

  visibleSections.forEach((section) => {
    const fragment = sectionTemplate.content.cloneNode(true);
    const sectionRoot = fragment.querySelector(".sheet-section");
    fragment.querySelector(".date-text").textContent = formatDate(section.date);
    fragment.querySelector(".name-text").textContent = section.name || "—";

    const chip = fragment.querySelector(".location-chip");
    chip.textContent = section.location || "—";
    chip.classList.add(getDayClass(section.location));
    const ownerTag = fragment.querySelector(".section-owner-tag");
    ownerTag.textContent = section.location ? `${state.language === "es" ? "Ubicación" : "Location"}: ${section.location}` : `${state.language === "es" ? "Ubicación" : "Location"}: —`;

    if (section.name) sectionRoot.classList.add("has-associate-name");
    const ownerLocked = !!(state.currentUser && state.currentUser !== LEADERSHIP_USER && section.name && section.name !== state.currentUser);
    const editor = fragment.querySelector(".section-editor");
    editor.querySelector(".edit-section-date").value = section.date || "";
    fillSelect(editor.querySelector(".edit-section-location"), state.masters.locations, t("selectLocation"), section.location);

    const translatedColumns = cfg.mode === "simple"
      ? [t("po"), t("boxes"), t("requestedQty"), t("category"), t("notes")]
      : [t("po"), t("boxes"), t("orderedQty"), t("receivedQty"), t("extras"), t("category"), t("notes")];
    fragment.querySelector(".section-thead").innerHTML = `<tr>${translatedColumns.map(c => `<th>${c}</th>`).join("")}<th class="action-col">${state.language === "es" ? "Acción" : "Action"}</th></tr>`;

    const tbody = fragment.querySelector(".section-tbody");
    renderSectionRows(pageKey, tbody, section);

    fragment.querySelector(".edit-section").textContent = t("editSection");
    fragment.querySelector(".add-inline-row").textContent = t("addRow");
    fragment.querySelector(".delete-section").textContent = t("deleteSection");
    fragment.querySelector(".save-section-edit").textContent = t("save");
    fragment.querySelector(".cancel-section-edit").textContent = t("cancel");

    const deleteSectionBtn = fragment.querySelector(".delete-section");
    const addRowBtn = fragment.querySelector(".add-inline-row");
    const editSectionBtn = fragment.querySelector(".edit-section");

    if (ownerLocked) {
      deleteSectionBtn.disabled = true;
      addRowBtn.disabled = true;
      editSectionBtn.disabled = true;
      sectionRoot.classList.add("owner-lock");
      const lockNote = document.createElement("span");
      lockNote.className = "lock-note";
      lockNote.textContent = t("notYourEntry");
      fragment.querySelector(".section-actions").appendChild(lockNote);
    } else {
      deleteSectionBtn.addEventListener("click", () => deleteSection(pageKey, section.id));
      addRowBtn.addEventListener("click", () => toggleInlineAddRow(pageKey, sectionRoot, section.id));
      editSectionBtn.addEventListener("click", () => editor.classList.toggle("hidden"));
    }

    fragment.querySelector(".save-section-edit").addEventListener("click", () => {
      if (ownerLocked) return;
      const date = editor.querySelector(".edit-section-date").value;
      const location = editor.querySelector(".edit-section-location").value;
      if (!location) { showToast("Location is required.", "error"); return; }
      section.date = date;
      section.location = location;
      touchSection(section);
      persistData();
      renderPage(pageKey);
    });

    fragment.querySelector(".cancel-section-edit").addEventListener("click", () => editor.classList.add("hidden"));
    container.appendChild(fragment);
  });
}


function renderSectionRows(pageKey, tbody, section) {
  const cfg = pageConfig[pageKey];
  const ownerLocked = !!(state.currentUser && state.currentUser !== LEADERSHIP_USER && section.name && section.name !== state.currentUser);
  tbody.innerHTML = "";
  const rowsToShow = getFilteredRows(pageKey, section);

  if (!rowsToShow.length) {
    tbody.innerHTML = `<tr><td colspan="${cfg.mode === "simple" ? 6 : 8}" class="empty-state-cell">${t("noRows")}</td></tr>`;
    return;
  }

  rowsToShow.forEach((row) => {
    const tr = document.createElement("tr");
    const batchCount = getPoHistoryCount(pageKey, row.po);
    const batchBtn = batchCount >= 1
      ? `<button class="tiny-btn history-row" type="button">${t("viewTimeline")}</button>`
      : `<span class="lock-note">—</span>`;

    const cells = cfg.mode === "simple"
      ? `
        <td>${escapeHtml(row.po)} ${isAutoRow ? '<span class="lock-note" style="margin-left:6px;">Auto</span>' : ''}</td>
        <td>${row.boxes}</td>
        <td>${row.qty}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${renderNotesCell(row)}${renderAuditSummary(row)}</td>
      `
      : `
        <td>${escapeHtml(row.po)} ${isAutoRow ? '<span class="lock-note" style="margin-left:6px;">Auto</span>' : ''}</td>
        <td>${row.boxes}</td>
        <td>${row.orderedQty}</td>
        <td>${row.receivedQty}</td>
        <td>${renderExtras(row.extras)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${renderNotesCell(row)}${renderAuditSummary(row)}</td>
      `;

    tr.innerHTML = `${cells}
      <td class="action-col action-stack">
        ${batchBtn}
        <button class="tiny-btn edit-row" type="button">${state.language === "es" ? "Editar" : "Edit"}</button>
        <button class="tiny-btn ghost-btn delete-row" type="button">${state.language === "es" ? "Eliminar" : "Delete"}</button>
      </td>
    `;

    const histBtn = tr.querySelector(".history-row");
    if (histBtn) histBtn.addEventListener("click", () => openBatchHistoryModal(pageKey, row.po));

    const deleteBtn = tr.querySelector(".delete-row");
    const editBtn = tr.querySelector(".edit-row");
    if (ownerLocked) {
      deleteBtn.disabled = true;
      editBtn.disabled = true;
    } else {
      deleteBtn.addEventListener("click", () => deleteRow(pageKey, section.id, row.id));
      editBtn.addEventListener("click", () => toggleInlineEditRow(pageKey, tr, section.id, row.id));
    }

    tbody.appendChild(tr);
  });
}

function renderExtras(extras) {
  const n = Number(extras || 0);
  if (n > 0) return `<span class="pill-good">+${n}</span>`;
  if (n < 0) return `<span class="pill-bad">${n}</span>`;
  return `<span class="pill-neutral">0</span>`;
}

function getVisibleSections(pageKey) {
  const cfg = pageConfig[pageKey];
  const filters = state.data[cfg.filterKey];
  let sections = [...(state.data[cfg.sectionKey] || [])].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  if (!sections.length) {
    sections = buildSyntheticSectionsFromImported(pageKey);
  }

  if (typeof filters.mineOnly !== "boolean") filters.mineOnly = false;

  if (filters.mineOnly && state.currentUser) sections = sections.filter((s) => s.name === state.currentUser);
  if (filters.person && filters.person !== "All") sections = sections.filter((s) => s.name === filters.person);
  if (filters.day) sections = sections.filter((s) => s.date === filters.day);

  const q = String(filters.search || "").toLowerCase().trim();
  if (!q) return sections;

  return sections.filter((section) => {
    const haystack = [
      section.name,
      section.location,
      formatDate(section.date),
      ...((section.rows || []).flatMap((row) => Object.values(row)))
    ].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}


function groupRowsByPo(rows) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const po = String(row.po || "").trim() || "No PO";
    if (!groups.has(po)) groups.set(po, []);
    groups.get(po).push(row);
  });
  return [...groups.entries()];
}

function getFilteredRows(pageKey, section) {
  const filters = state.data[pageConfig[pageKey].filterKey];
  let rows = [...section.rows].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!filters.search) return rows;

  return rows.filter((row) => Object.values(row).join(" ").toLowerCase().includes(filters.search));
}


function stripSizeBreakdownFromNotes(notes) {
  const text = String(notes || "");
  return text
    .replace(/\s*\|\s*(Apparel|Ropa|Tallas|Extras by size|Extras por talla):\s*[^|]*$/i, "")
    .replace(/^(Apparel|Ropa|Tallas|Extras by size|Extras por talla):\s*[^|]*$/i, "")
    .trim();
}

function appendSizeBreakdownToNotes(notes, sizeData) {
  const cleanNotes = stripSizeBreakdownFromNotes(notes);
  const sizeText = sizeBreakdownToText(sizeData);
  if (!sizeText) return cleanNotes;
  const label = t("sizesInExtras");
  return cleanNotes ? `${cleanNotes} | ${label}: ${sizeText}` : `${label}: ${sizeText}`;
}


function collectPoHistoryEntries(pageKey, po) {
  // Always collect the full cross-stage lifecycle for this PO
  const targetPo = String(po || "").trim();
  if (!targetPo) return [];
  const entries = [];
  const lang = state.language;
  const stageLabel = {
    dock: lang === "es" ? "Descarga" : "Dock",
    receiving: lang === "es" ? "Recepción QA" : "QA Receiving",
    prep: lang === "es" ? "Preparación" : "Prep",
    overstock: lang === "es" ? "Exceso / Sobrante" : "Overstock",
    putaway: lang === "es" ? "Ubicación" : "Putaway",
  };
  const eventTypeLabel = {
    created: lang === "es" ? "Tarima creada" : "Pallet created",
    label_changed: lang === "es" ? "Tarima renombrada" : "Pallet renamed",
    date_changed: lang === "es" ? "Fecha cambiada" : "Pallet date changed",
    po_added: lang === "es" ? "OC agregada" : "PO added",
    po_removed: lang === "es" ? "OC eliminada" : "PO removed",
    po_prior_receipt: lang === "es" ? "OC parcial detectada" : "Partial order continued",
    po_recv_qty: lang === "es" ? "Conteo de recepción actualizado" : "Receiving count updated",
    po_recv_done: lang === "es" ? "Recepción terminada" : "Receiving count marked done",
    po_unrecv: lang === "es" ? "Recepción reabierta" : "Receiving count reopened",
    po_prep_qty: lang === "es" ? "Conteo de prep actualizado" : "Prep count updated",
    po_prep_verified: lang === "es" ? "Prep terminado" : "Prep count marked done",
    po_routed: lang === "es" ? "OC enrutada" : "PO routed",
    po_unrouted: lang === "es" ? "Ruta limpiada" : "PO routing cleared",
    advanced: lang === "es" ? "Enviada a siguiente etapa" : "Sent to next stage",
    pulled_back: lang === "es" ? "Regresada a etapa previa" : "Pulled back to previous stage",
    deleted_restored: lang === "es" ? "Tarima restaurada" : "Pallet restored",
  };
  const eventStage = (ev) => {
    const type = String(ev?.type || "");
    const detail = String(ev?.detail || "").toLowerCase();
    if (["po_recv_qty", "po_recv_done", "po_unrecv", "po_partial"].includes(type)) return "receiving";
    if (["po_prep_qty", "po_prep_verified", "po_routed", "po_unrouted"].includes(type)) return "prep";
    if (type === "advanced" || type === "pulled_back") {
      if (detail.includes("receiv") || detail.includes("recep")) return "receiving";
      if (detail.includes("prep") || detail.includes("prepar")) return "prep";
      if (detail.includes("putaway") || detail.includes("ubic")) return "putaway";
      return "dock";
    }
    return "dock";
  };
  const push = (entry) => entries.push({ entryKind: "summary", ...entry });
  const pushEvent = (entry) => entries.push({ entryKind: "event", ...entry });

  // New pallet-first system (source of truth)
  (state.data.pallets || []).forEach((pallet) => {
    const poRow = (pallet.pos || []).find((row) => String(row.po || "").trim() === targetPo);
    if (!poRow) return;
    const orderedQty = Number(poRow.orderedQty || 0) || 0;
    const receivedQty = Number(poRow.receivedQty || 0) || 0;
    const prepQty = Number(poRow.prepReceivedQty || 0) || 0;
    const extras = plt_hasVal(poRow.receivedQty) && plt_hasVal(poRow.orderedQty) ? Math.max(0, receivedQty - orderedQty) : 0;
    const missing = plt_hasVal(poRow.receivedQty) && plt_hasVal(poRow.orderedQty) ? Math.max(0, orderedQty - receivedQty) : 0;
    const prepMissing = plt_hasVal(poRow.prepReceivedQty) && plt_hasVal(poRow.receivedQty) ? Math.max(0, receivedQty - prepQty) : 0;
    const recvActor = (pallet.events || []).slice().reverse().find((evt) => ["po_recv_done", "po_recv_qty", "po_unrecv"].includes(String(evt.type || "")) && (String(evt.poNum || "").trim() === targetPo || !evt.poNum))?.by || "";
    const prepActor = (pallet.events || []).slice().reverse().find((evt) => ["po_prep_verified", "po_prep_qty", "po_routed", "po_unrouted"].includes(String(evt.type || "")) && (String(evt.poNum || "").trim() === targetPo || !evt.poNum))?.by || "";
    const recvEventTs = (pallet.events || []).slice().reverse().find((evt) => ["po_recv_done", "po_recv_qty", "po_unrecv"].includes(String(evt.type || "")) && (String(evt.poNum || "").trim() === targetPo || !evt.poNum))?.ts || 0;
    const prepEventTs = (pallet.events || []).slice().reverse().find((evt) => ["po_prep_verified", "po_prep_qty", "po_routed", "po_unrouted"].includes(String(evt.type || "")) && (String(evt.poNum || "").trim() === targetPo || !evt.poNum))?.ts || 0;

    push({
      sourcePage: "dock",
      sourceLabel: stageLabel.dock,
      createdAt: poRow.createdAt || pallet.createdAt || 0,
      date: pallet.date || "",
      associate: pallet.createdBy || "",
      location: pallet.label || "",
      boxes: Number(poRow.boxes || 0) || 0,
      qty: orderedQty,
      orderedQty,
      receivedQty: 0,
      extras: 0,
      category: poRow.category || "",
      notes: [poRow.dockNotes, poRow.category ? `Category: ${poRow.category}` : ""].filter(Boolean).join(" • "),
      status: pallet.status || "",
      originalDate: pallet.date || "",
      editHistory: [],
    });

    if (plt_hasVal(poRow.receivedQty) || poRow.receivingDone) {
      push({
        sourcePage: "receiving",
        sourceLabel: stageLabel.receiving,
        createdAt: recvEventTs || pallet.updatedAt || pallet.createdAt || 0,
        date: pallet.date || "",
        associate: recvActor,
        location: pallet.label || "",
        boxes: Number(poRow.boxes || 0) || 0,
        qty: 0,
        orderedQty,
        receivedQty,
        extras: receivedQty - orderedQty,
        category: poRow.category || "",
        notes: [
          poRow.receivingNotes,
          missing > 0 ? `Missing ${missing}` : "",
          extras > 0 ? `Extras ${extras}` : "",
          poRow.receivingDone ? "Receiving done" : "Receiving in progress",
        ].filter(Boolean).join(" • "),
        status: poRow.receivingDone ? "Done" : "In Progress",
        originalDate: pallet.date || "",
        editHistory: [],
      });
    }

    if (plt_hasVal(poRow.prepReceivedQty) || poRow.prepVerified || plt_hasVal(poRow.stsQty) || plt_hasVal(poRow.ltsQty)) {
      const splitBits = [];
      if (plt_hasVal(poRow.stsQty)) splitBits.push(`STS ${poRow.stsQty}`);
      if (plt_hasVal(poRow.ltsQty)) splitBits.push(`LTS ${poRow.ltsQty}`);
      push({
        sourcePage: "prep",
        sourceLabel: stageLabel.prep,
        createdAt: prepEventTs || pallet.updatedAt || pallet.createdAt || 0,
        date: pallet.date || "",
        associate: prepActor,
        location: pallet.label || "",
        boxes: Number(poRow.boxes || 0) || 0,
        qty: 0,
        orderedQty: receivedQty || orderedQty,
        receivedQty: prepQty,
        extras: prepQty - receivedQty,
        category: poRow.category || "",
        notes: [
          poRow.prepNotes,
          splitBits.length ? `Split: ${splitBits.join(" / ")}` : "",
          prepMissing > 0 ? `Still missing ${prepMissing}` : "",
          poRow.prepVerified ? "Prep done" : "Prep in progress",
        ].filter(Boolean).join(" • "),
        status: poRow.prepVerified ? "Done" : (splitBits.length ? "Routed" : "In Progress"),
        originalDate: pallet.date || "",
        editHistory: [],
      });
    }

    const prepOverstock = plt_hasVal(poRow.prepReceivedQty) && plt_hasVal(poRow.orderedQty) ? Math.max(0, prepQty - orderedQty) : extras;

    if (prepOverstock > 0) {
      push({
        sourcePage: "overstock",
        sourceLabel: stageLabel.overstock,
        createdAt: recvEventTs || pallet.updatedAt || pallet.createdAt || 0,
        date: pallet.date || "",
        associate: recvActor,
        location: pallet.label || "",
        status: "Extras",
        action: "Auto from prep extras",
        quantity: prepOverstock,
        orderedQty,
        receivedQty: prepQty || receivedQty,
        extras: prepOverstock,
        notes: `Extras created from prep count (+${prepOverstock})`,
        originalDate: pallet.date || "",
        editHistory: [],
      });
    }

    (pallet.events || []).forEach((evt) => {
      const appliesToPo = String(evt.poNum || "").trim() === targetPo || (!evt.poNum && ["created", "label_changed", "date_changed", "advanced", "pulled_back", "deleted_restored"].includes(String(evt.type || "")));
      if (!appliesToPo) return;
      const src = eventStage(evt);
      pushEvent({
        sourcePage: src,
        sourceLabel: stageLabel[src],
        createdAt: evt.ts || 0,
        date: pallet.date || "",
        associate: evt.by || "",
        location: pallet.label || "",
        boxes: 0,
        orderedQty: 0,
        receivedQty: 0,
        extras: 0,
        status: eventTypeLabel[String(evt.type || "")] || String(evt.type || ""),
        notes: evt.detail || "",
        originalDate: pallet.date || "",
        editHistory: [],
      });
    });
  });

  // Legacy Dock stage
  (state.data.dockSections || []).forEach((section) => {
    (section.rows || []).forEach((row) => {
      if (String(row.po || "").trim() !== targetPo) return;
      push({
        sourcePage: "dock",
        sourceLabel: lang === "es" ? "Descarga" : "Docker",
        createdAt: row.createdAt || section.updatedAt || section.createdAt || 0,
        date: section.date || "",
        associate: section.name || "",
        location: section.location || "",
        boxes: Number(row.boxes || 0) || 0,
        qty: Number(row.qty || 0) || 0,
        orderedQty: 0, receivedQty: 0, extras: 0,
        category: row.category || "",
        notes: row.notes || "",
        originalDate: row.originalDate || section.date || "",
        editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
      });
    });
  });

  // Legacy QA Receiving stage
  (state.data.receivingSections || []).forEach((section) => {
    (section.rows || []).forEach((row) => {
      if (String(row.po || "").trim() !== targetPo) return;
      push({
        sourcePage: "receiving",
        sourceLabel: lang === "es" ? "Recepción QA" : "QA Receiving",
        createdAt: row.createdAt || section.updatedAt || section.createdAt || 0,
        date: section.date || "",
        associate: section.name || "",
        location: section.location || "",
        boxes: Number(row.boxes || 0) || 0,
        qty: 0,
        orderedQty: Number(row.orderedQty || 0) || 0,
        receivedQty: Number(row.receivedQty || 0) || 0,
        extras: Number(row.extras || 0) || 0,
        category: row.category || "",
        notes: row.notes || "",
        originalDate: row.originalDate || section.date || "",
        editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
      });
    });
  });

  // Legacy Prep stage
  (state.data.prepSections || []).forEach((section) => {
    (section.rows || []).forEach((row) => {
      if (String(row.po || "").trim() !== targetPo) return;
      push({
        sourcePage: "prep",
        sourceLabel: lang === "es" ? "Preparación" : "Prep",
        createdAt: row.createdAt || section.updatedAt || section.createdAt || 0,
        date: section.date || "",
        associate: section.name || "",
        location: section.location || "",
        boxes: Number(row.boxes || 0) || 0,
        qty: 0,
        orderedQty: Number(row.orderedQty || 0) || 0,
        receivedQty: Number(row.receivedQty || 0) || 0,
        extras: Number(row.extras || 0) || 0,
        category: row.category || "",
        notes: row.notes || "",
        originalDate: row.originalDate || section.date || "",
        editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
      });
    });
  });

  // Legacy Overstock stage
  (state.data.overstockEntries || []).forEach((row) => {
    if (String(row.po || "").trim() !== targetPo) return;
    push({
      sourcePage: "overstock",
      sourceLabel: lang === "es" ? "Exceso / Sobrante" : "Overstock",
      createdAt: row.updatedAt || row.createdAt || 0,
      date: row.date || "",
      associate: row.associate || "",
      location: row.location || "",
      status: row.status || "",
      action: row.action || "",
      quantity: Number(row.quantity || 0) || 0,
      notes: row.notes || "",
      originalDate: row.originalDate || row.date || "",
      editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
    });
  });

  // Legacy Putaway stage
  (state.data.putawayEntries || []).forEach((row) => {
    if (String(row.po || "").trim() !== targetPo) return;
    push({
      sourcePage: "putaway",
      sourceLabel: lang === "es" ? "Ubicación" : "Putaway",
      createdAt: row.updatedAt || row.createdAt || 0,
      date: row.date || "",
      associate: row.associate || "",
      location: row.location || "",
      status: row.status || "",
      notes: row.notes || "",
      originalDate: row.originalDate || row.date || "",
      editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
    });
  });

  // Sort oldest first so lifecycle reads chronologically top → bottom
  return entries.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function getPoHistoryCount(pageKey, po) {
  return collectPoHistoryEntries(pageKey, po).length;
}

function openBatchHistoryModal(pageKey, po) {
  const backdrop = document.getElementById("batchHistoryBackdrop");
  const title = document.getElementById("batchHistoryTitle");
  const subtitle = document.getElementById("batchHistorySubtitle");
  const stats = document.getElementById("batchHistoryStats");
  const head = document.getElementById("batchHistoryHead");
  const body = document.getElementById("batchHistoryBody");
  if (!backdrop || !title || !subtitle || !stats || !head || !body) return;

  const rows = collectPoHistoryEntries(pageKey, po);
  title.textContent = `PO ${po}`;
  subtitle.textContent = rows.length > 1
    ? `This PO has ${rows.length} logged timeline entries.`
    : `This PO currently has a single timeline entry.`;

  const summaryRows = rows.filter(r => r.entryKind !== "event");
  const uniqueAssociates = [...new Set(rows.map(r => r.associate).filter(Boolean))];
  const uniqueLocations = [...new Set(rows.map(r => r.location).filter(Boolean))];
  const totalBoxes = summaryRows.reduce((sum, r) => sum + (Number(r.boxes || 0) || 0), 0);
  const totalOrdered = summaryRows.reduce((sum, r) => sum + (Number(r.orderedQty || 0) || 0), 0);
  const totalReceived = summaryRows.reduce((sum, r) => {
    const received = Number(r.receivedQty || 0);
    const qty = Number(r.qty || 0);
    const quantity = Number(r.quantity || 0);
    return sum + (received || qty || quantity || 0);
  }, 0);
  const totalExtras = summaryRows.reduce((sum, r) => sum + (Number(r.extras || 0) || 0), 0);

  stats.innerHTML = `
    <span class="batch-history-pill">${t("timelineEntries")} <strong>${rows.length}</strong></span>
    <span class="batch-history-pill">${t("monthlyTotal")} <strong>${totalReceived}</strong></span>
    <span class="batch-history-pill">${t("boxesTotal")} <strong>${totalBoxes}</strong></span>
    <span class="batch-history-pill">${t("orderedTotal")} <strong>${totalOrdered}</strong></span>
    <span class="batch-history-pill">${t("varianceTotal")} <strong>${totalExtras}</strong></span>
    <span class="batch-history-pill">${t("associates")} <strong>${uniqueAssociates.length}</strong></span>
    <span class="batch-history-pill">${t("locations")} <strong>${uniqueLocations.length}</strong></span>
  `;

  // Universal cross-stage timeline — one table for all stages
  const stageBadgeClass = {
    dock: "stage-badge-dock", receiving: "stage-badge-receiving", prep: "stage-badge-prep",
    overstock: "stage-badge-overstock", putaway: "stage-badge-putaway"
  };
  head.innerHTML = `<tr>
    <th>${t("stage")}</th>
    <th>${t("date")}</th>
    <th>${t("associate")}</th>
    <th>${t("location")}</th>
    <th>${t("boxes")}</th>
    <th>${t("orderedQty")}</th>
    <th>${t("receivedQty")}</th>
    <th>${t("variance")}</th>
    <th>${t("status")}</th>
    <th>${t("notes")}</th>
    <th>${t("editTrail")}</th>
  </tr>`;
  body.innerHTML = rows.length ? rows.map(r => {
    const sc = stageBadgeClass[r.sourcePage] || "stage-badge-dock";
    const received = r.receivedQty || r.qty || r.quantity || 0;
    const variance = (r.sourcePage === "receiving" || r.sourcePage === "prep" || r.sourcePage === "overstock")
      ? renderExtras(r.extras) : "—";
    const statusAction = [r.status, r.action].filter(Boolean).map(v => translateStatus(v)).join(" / ") || "—";
    return `<tr class="${r.entryKind === "event" ? "batch-history-event-row" : ""}">
      <td><span class="stage-badge ${sc}">${escapeHtml(r.sourceLabel)}</span></td>
      <td>${escapeHtml(formatDate(r.originalDate || r.date))}</td>
      <td><strong>${escapeHtml(r.associate || "—")}</strong></td>
      <td>${escapeHtml(r.location || "—")}</td>
      <td>${r.boxes || "—"}</td>
      <td>${r.orderedQty || "—"}</td>
      <td>${received || "—"}</td>
      <td>${variance}</td>
      <td>${escapeHtml(statusAction)}</td>
      <td>${renderNotesCell(r)}</td>
      <td>${renderEditHistoryList(r)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="11" class="batch-history-empty">${t("noHistoryFound")}</td></tr>`;

  backdrop.hidden = false;
}

function closeBatchHistoryModal() {
  const backdrop = document.getElementById("batchHistoryBackdrop");
  if (backdrop) backdrop.hidden = true;
}


function cloneForAudit(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function ensureRowAuditFields(row, section) {
  if (!row || typeof row !== "object") return row;
  if (!row.originalDate) row.originalDate = row.date || section?.date || "";
  if (!row.createdAt) row.createdAt = Date.now();
  if (!Array.isArray(row.editHistory)) row.editHistory = [];
  return row;
}

function recordRowEditAudit(row, beforeSnapshot, afterSnapshot, section, editorName) {
  if (!row || typeof row !== "object") return;
  ensureRowAuditFields(row, section);
  const changedFields = [];

  const keys = new Set([
    ...Object.keys(beforeSnapshot || {}),
    ...Object.keys(afterSnapshot || {})
  ]);

  keys.forEach((key) => {
    if (["editHistory"].includes(key)) return;
    const beforeVal = JSON.stringify((beforeSnapshot || {})[key] ?? null);
    const afterVal = JSON.stringify((afterSnapshot || {})[key] ?? null);
    if (beforeVal !== afterVal) {
      changedFields.push({
        field: key,
        before: (beforeSnapshot || {})[key] ?? null,
        after: (afterSnapshot || {})[key] ?? null,
      });
    }
  });

  if (!changedFields.length) return;

  row.lastEditedAt = Date.now();
  row.lastEditedBy = editorName || state.currentUser || "Unknown";
  row.editHistory.unshift({
    editedAt: row.lastEditedAt,
    editedBy: row.lastEditedBy,
    changedFields,
    workDateAtTimeOfEdit: row.originalDate || row.date || section?.date || "",
  });
}

function renderAuditSummary(row) {
  const edits = Array.isArray(row?.editHistory) ? row.editHistory.length : 0;
  if (!edits) return "";
  const last = row.editHistory[0];
  const who = escapeHtml(last?.editedBy || "Unknown");
  const when = escapeHtml(formatDateTimeShort(last?.editedAt || 0));
  return `<div class="audit-note">Edited ${edits}x • Last edit ${when} by ${who}</div>`;
}

function renderEditHistoryList(row) {
  const history = Array.isArray(row?.editHistory) ? row.editHistory : [];
  if (!history.length) return `<div class="batch-history-empty">No edits recorded.</div>`;
  return history.map((entry, idx) => {
    const changes = (entry.changedFields || []).map(change => {
      const field = escapeHtml(change.field);
      const before = escapeHtml(String(change.before ?? "—"));
      const after = escapeHtml(String(change.after ?? "—"));
      return `<div class="edit-history-change"><strong>${field}</strong>: ${before} → ${after}</div>`;
    }).join("");
    return `
      <div class="edit-history-entry">
        <div class="edit-history-head">
          <strong>Edit ${history.length - idx}</strong>
          <span>${escapeHtml(formatDateTimeShort(entry.editedAt))} • ${escapeHtml(entry.editedBy || "Unknown")}</span>
        </div>
        <div class="edit-history-sub">Original work date: ${escapeHtml(formatDate(entry.workDateAtTimeOfEdit || row.originalDate || row.date || ""))}</div>
        <div class="edit-history-changes">${changes}</div>
      </div>
    `;
  }).join("");
}

function renderNotesCell(row) {
  const safeNotes = escapeHtml(stripSizeBreakdownFromNotes(row.notes || ""));
  const sizeText = sizeBreakdownToText((row && row.sizeBreakdown) || {});
  if (!sizeText) return safeNotes || "—";
  const label = escapeHtml(t("sizesInExtras"));
  const breakdown = escapeHtml(sizeText);
  if (safeNotes && safeNotes !== "—") {
    return `${safeNotes}<br><span class="lock-note">${label}: ${breakdown}</span>`;
  }
  return `<span class="lock-note">${label}: ${breakdown}</span>`;
}

function isApparelCategory(category) {
  const value = String(category || "").toLowerCase();
  return value.includes("apparel") || value.includes("ropa");
}

function renderSizeBreakdownInputs(existingValues = {}) {
  const sizes = ["XS","S","M","L","XL","2XL"];
  const wrapper = document.createElement("div");
  wrapper.className = "size-breakdown";
  wrapper.innerHTML = `<div class="size-breakdown-label">${t("sizeBreakdown")}</div>`;
  sizes.forEach((size) => {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.placeholder = size;
    input.dataset.sizeKey = size;
    input.value = existingValues[size] ?? "";
    wrapper.appendChild(input);
  });
  return wrapper;
}

function getSizeBreakdownData(root) {
  const values = {};
  root.querySelectorAll("[data-size-key]").forEach((input) => {
    const num = Number(input.value || 0);
    if (num > 0) values[input.dataset.sizeKey] = num;
  });
  return values;
}

function sizeBreakdownToText(values) {
  const entries = Object.entries(values || {}).filter(([,v]) => Number(v) > 0);
  if (!entries.length) return "";
  return entries.map(([k,v]) => `${k}:${v}`).join(", ");
}

function setupCategoryResponsiveLayout(editor, existingSizeValues = {}, allowSizes = true) {
  if (!allowSizes) return;
  const categorySelect = editor.querySelector('[data-field="category"]');
  if (!categorySelect) return;

  const toggle = () => {
    const old = editor.querySelector(".size-breakdown");
    if (old) old.remove();
    if (isApparelCategory(categorySelect.value)) {
      const sizeBox = renderSizeBreakdownInputs(existingSizeValues);
      const firstBtn = editor.querySelector(".tiny-btn");
      editor.insertBefore(sizeBox, firstBtn);
    }
  };

  categorySelect.addEventListener("change", toggle);
  toggle();
}

function hasUnsavedContent(el) {
  if (!el) return false;
  for (const inp of el.querySelectorAll('input[type="text"], input[type="number"]')) {
    const v = String(inp.value || "").trim();
    if (v && v !== "0") return true;
  }
  return false;
}

function toggleInlineAddRow(pageKey, sectionRoot, sectionId) {
  const existing = sectionRoot.querySelector(".inline-row-editor");
  if (existing) {
    if (hasUnsavedContent(existing)) {
      const msg = state.language === "es"
        ? "Tienes datos sin guardar. ¿Guardar antes de cerrar?"
        : "You have unsaved data. Save before closing?";
      if (window.confirm(msg)) {
        const saveBtn = existing.querySelector("button:not(.ghost-btn)");
        if (saveBtn) { saveBtn.click(); return; }
      }
    }
    existing.remove();
    return;
  }

  const cfg = pageConfig[pageKey];
  const editor = document.createElement("div");
  editor.className = `inline-row-editor ${cfg.mode === "simple" ? "simple" : ""}`;

  if (cfg.mode === "simple") {
    editor.innerHTML = `
      <input type="text" placeholder="${t("po")}" data-field="po" />
      <input type="number" min="0" placeholder="${t("boxes")}" data-field="boxes" />
      <input type="number" min="0" placeholder="${t("requestedQty")}" data-field="qty" />
      <select data-field="category"></select>
      <input type="text" placeholder="${t("notes")}" data-field="notes" />
      <button class="tiny-btn" type="button">${t("save")}</button>
      <button class="tiny-btn ghost-btn" type="button">${t("cancel")}</button>
    `;
  } else {
    editor.innerHTML = `
      <input type="text" placeholder="${t("po")}" data-field="po" />
      <input type="number" min="0" placeholder="${t("boxes")}" data-field="boxes" />
      <input type="number" min="0" placeholder="${t("orderedQty")}" data-field="orderedQty" />
      <input type="number" min="0" placeholder="${t("receivedQty")}" data-field="receivedQty" />
      <input type="text" placeholder="${t("extras")} (auto)" data-field="extrasDisplay" disabled />
      <select data-field="category"></select>
      <input type="text" placeholder="${t("notes")}" data-field="notes" />
      <button class="tiny-btn" type="button">${t("save")}</button>
      <button class="tiny-btn ghost-btn" type="button">${t("cancel")}</button>
    `;

    const orderedInput = editor.querySelector('[data-field="orderedQty"]');
    const receivedInput = editor.querySelector('[data-field="receivedQty"]');
    const extrasDisplay = editor.querySelector('[data-field="extrasDisplay"]');

    const recalc = () => {
      const orderedQty = Number(orderedInput.value || 0);
      const receivedQty = Number(receivedInput.value || 0);
      const extras = receivedQty - orderedQty;
      extrasDisplay.value = extras > 0 ? `+${extras}` : String(extras);
    };
    orderedInput.addEventListener("input", recalc);
    receivedInput.addEventListener("input", recalc);
  }

  fillSelect(editor.querySelector('select[data-field="category"]'), state.masters.categories, t("selectCategory"));
  setupCategoryResponsiveLayout(editor, {}, cfg.mode === "counting");

  const [saveBtn, cancelBtn] = editor.querySelectorAll("button");
  saveBtn.addEventListener("click", () => {
    const po = editor.querySelector('[data-field="po"]').value.trim();
    const boxes = Number(editor.querySelector('[data-field="boxes"]').value || 0);
    const category = editor.querySelector('[data-field="category"]').value;
    let notes = editor.querySelector('[data-field="notes"]').value.trim();

    if (!po || !category) { showToast("PO# and Category are required.", "error"); return; }

    const sizeData = cfg.mode === "counting" ? getSizeBreakdownData(editor) : {};
    notes = appendSizeBreakdownToNotes(notes, sizeData);

    const section = state.data[cfg.sectionKey].find((item) => item.id === sectionId);
    if (!section) return;

    let newRow;
    if (cfg.mode === "simple") {
      const qty = Number(editor.querySelector('[data-field="qty"]').value || 0);
      newRow = { id: makeId(), po, boxes, qty, category, notes, sizeBreakdown: sizeData, createdAt: Date.now() };
    } else {
      const orderedQty = Number(editor.querySelector('[data-field="orderedQty"]').value || 0);
      const receivedQty = Number(editor.querySelector('[data-field="receivedQty"]').value || 0);
      const extras = receivedQty - orderedQty;
      newRow = { id: makeId(), po, boxes, orderedQty, receivedQty, extras, category, notes, sizeBreakdown: sizeData, createdAt: Date.now() };
    }

    section.rows.unshift(newRow);
    touchSection(section);
    persistData();
    renderPage(pageKey);
  });

  cancelBtn.addEventListener("click", () => editor.remove());
  sectionRoot.querySelector(".section-right").appendChild(editor);
}

function toggleInlineEditRow(pageKey, tableRow, sectionId, rowId) {
  const tbody = tableRow.parentElement;
  const existing = tbody.querySelector(".row-editing");
  if (existing && existing !== tableRow.nextElementSibling) {
    if (hasUnsavedContent(existing)) {
      const msg = state.language === "es"
        ? "Otra fila tiene datos sin guardar. ¿Guardar antes de abrir esta?"
        : "Another row has unsaved changes. Save before opening this one?";
      if (window.confirm(msg)) {
        const saveBtn = existing.querySelector(".save-inline-edit");
        if (saveBtn) { saveBtn.click(); return; }
      }
    }
    existing.remove();
  }
  const alreadyOpen = tableRow.nextElementSibling && tableRow.nextElementSibling.classList.contains("row-editing");
  if (alreadyOpen) return tableRow.nextElementSibling.remove();

  const cfg = pageConfig[pageKey];
  const section = state.data[cfg.sectionKey].find((item) => item.id === sectionId);
  const row = section.rows.find((item) => item.id === rowId);

  const editTr = document.createElement("tr");
  editTr.className = "row-editing";

  if (cfg.mode === "simple") {
    editTr.innerHTML = `
      <td colspan="6">
        <div class="row-edit-grid simple">
          <input class="row-inline-input" type="text" value="${escapeAttribute(row.po)}" data-field="po" />
          <input class="row-inline-input" type="number" min="0" value="${row.boxes}" data-field="boxes" />
          <input class="row-inline-input" type="number" min="0" value="${row.qty}" data-field="qty" />
          <select class="row-inline-input" data-field="category"></select>
          <input class="row-inline-input" type="text" value="${escapeAttribute(stripSizeBreakdownFromNotes(row.notes || ""))}" data-field="notes" />
          <button class="tiny-btn save-inline-edit" type="button">${t("save")}</button>
          <button class="tiny-btn ghost-btn cancel-inline-edit" type="button">${t("cancel")}</button>
        </div>
      </td>
    `;
  } else {
    editTr.innerHTML = `
      <td colspan="8">
        <div class="row-edit-grid">
          <input class="row-inline-input" type="text" value="${escapeAttribute(row.po)}" data-field="po" />
          <input class="row-inline-input" type="number" min="0" value="${row.boxes}" data-field="boxes" />
          <input class="row-inline-input" type="number" min="0" value="${row.orderedQty}" data-field="orderedQty" />
          <input class="row-inline-input" type="number" min="0" value="${row.receivedQty}" data-field="receivedQty" />
          <input class="row-inline-input" type="text" value="${row.extras > 0 ? '+' + row.extras : row.extras}" data-field="extrasDisplay" disabled />
          <select class="row-inline-input" data-field="category"></select>
          <input class="row-inline-input" type="text" value="${escapeAttribute(stripSizeBreakdownFromNotes(row.notes || ""))}" data-field="notes" />
          <button class="tiny-btn save-inline-edit" type="button">${t("save")}</button>
          <button class="tiny-btn ghost-btn cancel-inline-edit" type="button">${t("cancel")}</button>
        </div>
      </td>
    `;

    const orderedInput = editTr.querySelector('[data-field="orderedQty"]');
    const receivedInput = editTr.querySelector('[data-field="receivedQty"]');
    const extrasDisplay = editTr.querySelector('[data-field="extrasDisplay"]');

    const recalc = () => {
      const orderedQty = Number(orderedInput.value || 0);
      const receivedQty = Number(receivedInput.value || 0);
      const extras = receivedQty - orderedQty;
      extrasDisplay.value = extras > 0 ? `+${extras}` : String(extras);
    };
    orderedInput.addEventListener("input", recalc);
    receivedInput.addEventListener("input", recalc);
  }

  fillSelect(editTr.querySelector('select[data-field="category"]'), state.masters.categories, t("selectCategory"), row.category);
  setupCategoryResponsiveLayout(editTr, row.sizeBreakdown || {}, cfg.mode === "counting");

  editTr.querySelector(".save-inline-edit").addEventListener("click", () => {
    const beforeSnapshot = cloneForAudit(row);
    ensureRowAuditFields(row, section);

    const po = editTr.querySelector('[data-field="po"]').value.trim();
    const boxes = Number(editTr.querySelector('[data-field="boxes"]').value || 0);
    const category = editTr.querySelector('[data-field="category"]').value;
    let notes = editTr.querySelector('[data-field="notes"]').value.trim();

    if (!po || !category) { showToast("PO# and Category are required.", "error"); return; }

    const sizeData = cfg.mode === "counting" ? getSizeBreakdownData(editTr) : {};
    notes = appendSizeBreakdownToNotes(notes, sizeData);

    row.po = po;
    row.boxes = boxes;
    row.category = category;
    row.notes = notes;
    row.sizeBreakdown = sizeData;

    if (cfg.mode === "simple") {
      row.qty = Number(editTr.querySelector('[data-field="qty"]').value || 0);
    } else {
      row.orderedQty = Number(editTr.querySelector('[data-field="orderedQty"]').value || 0);
      row.receivedQty = Number(editTr.querySelector('[data-field="receivedQty"]').value || 0);
      row.extras = row.receivedQty - row.orderedQty;
    }

    row.date = row.originalDate || row.date || section.date || "";
    const afterSnapshot = cloneForAudit(row);
    recordRowEditAudit(row, beforeSnapshot, afterSnapshot, section, state.currentUser || section.name || "Unknown");

    touchSection(section);
    persistData();
    renderPage(pageKey);
  });

  editTr.querySelector(".cancel-inline-edit").addEventListener("click", () => editTr.remove());
  tableRow.insertAdjacentElement("afterend", editTr);
}

function deleteSection(pageKey, sectionId) {
  if (!window.confirm("Delete this whole section?")) return;
  const key = pageConfig[pageKey].sectionKey;
  state.data[key] = state.data[key].filter((section) => section.id !== sectionId);
  persistData();
  renderPage(pageKey);
}

function deleteRow(pageKey, sectionId, rowId) {
  const section = state.data[pageConfig[pageKey].sectionKey].find((item) => item.id === sectionId);
  if (!section) return;
  section.rows = section.rows.filter((row) => row.id !== rowId);
  touchSection(section);
  persistData();
  renderPage(pageKey);
}

function getPalletDeptMetrics(pageKey, dateStr) {
  const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
  const targetDate = String(dateStr || new Date().toISOString().slice(0,10));
  const isOnDate = (pallet) => {
    const created = pallet.createdAt ? new Date(pallet.createdAt).toISOString().slice(0,10) : '';
    const updated = pallet.updatedAt ? new Date(pallet.updatedAt).toISOString().slice(0,10) : '';
    if (created === targetDate || updated === targetDate) return true;
    return Array.isArray(pallet.events) && pallet.events.some(evt => {
      try { return new Date(evt.ts || 0).toISOString().slice(0,10) === targetDate; } catch(_) { return false; }
    });
  };
  const relevant = pallets.filter(isOnDate);
  let rows = 0, boxes = 0, units = 0, poCount = 0;
  relevant.forEach(pallet => {
    (pallet.pos || []).forEach(po => {
      const poCode = String(po.po || '').trim();
      if (pageKey === 'dock') {
        rows += 1;
        boxes += Number(po.boxes || 0) || 0;
        units += Number(po.orderedQty || 0) || 0;
        if (poCode) poCount += 1;
      } else if (pageKey === 'receiving') {
        const hasReceiving = po.receivingDone === true || Number(po.receivedQty || 0) > 0;
        if (!hasReceiving) return;
        rows += 1;
        boxes += Number(po.boxes || 0) || 0;
        units += Number(po.receivedQty || 0) || 0;
        if (poCode) poCount += 1;
      } else if (pageKey === 'prep') {
        const hasPrep = po.prepVerified === true || Number(po.prepReceivedQty || 0) > 0;
        if (!hasPrep) return;
        rows += 1;
        boxes += Number(po.boxes || 0) || 0;
        units += Number(po.prepReceivedQty || 0) || 0;
        if (poCode) poCount += 1;
      }
    });
  });
  return { relevantPallets: relevant.length, rows, boxes, units, poCount };
}

function getHeroPulseContext() {
  const today = new Date().toISOString().slice(0, 10);
  if (!['receiving','prep'].includes(state.currentPage)) return null;
  const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
  const relevant = pallets.filter(p => {
    const created = p.createdAt ? new Date(p.createdAt).toISOString().slice(0,10) : '';
    const updated = p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0,10) : '';
    if (created === today || updated === today) return true;
    return Array.isArray(p.events) && p.events.some(evt => {
      try { return new Date(evt.ts || 0).toISOString().slice(0,10) === today; } catch(_) { return false; }
    });
  });
  return {
    key: state.currentPage,
    label: state.currentPage === 'receiving' ? 'QA Receiving' : 'QA Prep',
    pallets: relevant,
    metrics: getPalletDeptMetrics(state.currentPage, today)
  };
}

function getPalletRowsForPulse(context) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  (context?.pallets || []).forEach(pallet => {
    (pallet.pos || []).forEach(po => {
      if (context.key === 'receiving') {
        if (!(po.receivingDone === true || Number(po.receivedQty || 0) > 0)) return;
        rows.push({
          associate: (pallet.events || []).slice().reverse().find(evt => String(evt.type || '').includes('recv'))?.by || 'Unknown',
          category: po.category || 'Uncategorized',
          units: Number(po.receivedQty || 0) || 0,
          po: po.po || '',
          location: pallet.label || '',
          date: today
        });
      } else if (context.key === 'prep') {
        if (!(po.prepVerified === true || Number(po.prepReceivedQty || 0) > 0)) return;
        rows.push({
          associate: (pallet.events || []).slice().reverse().find(evt => String(evt.type || '').includes('prep'))?.by || 'Unknown',
          category: po.category || 'Uncategorized',
          units: Number(po.prepReceivedQty || 0) || 0,
          po: po.po || '',
          location: pallet.label || '',
          date: today
        });
      }
    });
  });
  return rows;
}

function renderStats() {
  if (!["dock", "receiving", "prep"].includes(state.currentPage)) return;
  const today = new Date().toISOString().slice(0, 10);
  const statusForPage = { dock: "draft", receiving: "receiving", prep: "prep" };
  const currentStatus = statusForPage[state.currentPage];
  const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
  const activePallets = pallets.filter(p => p.status === currentStatus);
  const metrics = getPalletDeptMetrics(state.currentPage, today);

  if (statSections) statSections.textContent = activePallets.length;
  if (statRows)     statRows.textContent = metrics.poCount;
  if (statBoxes)    statBoxes.textContent = metrics.boxes;
  if (statNotes)    statNotes.textContent = metrics.relevantPallets;
  if (totalQty)     totalQty.textContent = metrics.units;
}

function renderMasterLists() {
  syncAssociatesFromAttendance();
  if (categoriesList) renderSingleMasterList("categories", categoriesList);
  if (locationsList) renderSingleMasterList("locations", locationsList);
}

function renderSingleMasterList(type, container) {
  if (!container) return;
  container.innerHTML = "";
  const items = [...state.masters[type]].sort((a, b) => a.localeCompare(b));
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">No items yet.</div>`;
    return;
  }

  items.forEach((value) => {
    const item = document.createElement("div");
    item.className = "master-list-item";
    item.innerHTML = `
      <input type="text" value="${escapeAttribute(value)}" />
      <button class="tiny-btn">${t("save")}</button>
      <button class="tiny-btn ghost-btn">${state.language === "es" ? "Eliminar" : "Delete"}</button>
    `;
    const input = item.querySelector("input");
    const [saveBtn, deleteBtn] = item.querySelectorAll("button");
    saveBtn.addEventListener("click", () => renameMasterItem(type, value, input.value.trim()));
    deleteBtn.addEventListener("click", () => removeMasterItem(type, value));
    container.appendChild(item);
  });
}

function addMasterItem(type, rawValue) {
  const value = rawValue.trim();
  if (!value || state.masters[type].includes(value)) return;
  state.masters[type].push(value);
  persistMasters();
  renderAll();
}

function renameMasterItem(type, oldValue, newValue) {
  if (!newValue || oldValue === newValue) return;
  if (state.masters[type].includes(newValue)) { showToast("That value already exists.", "error"); return; }
  state.masters[type] = state.masters[type].map((item) => item === oldValue ? newValue : item);

  Object.keys(pageConfig).forEach((pageKey) => {
    const key = pageConfig[pageKey].sectionKey;
    state.data[key].forEach((section) => {
      if (type === "associates" && section.name === oldValue) section.name = newValue;
      if (type === "locations" && section.location === oldValue) section.location = newValue;
      if (type === "categories") {
        section.rows.forEach((row) => {
          if (row.category === oldValue) row.category = newValue;
        });
      }
    });
  });

  persistMasters();
  persistData();
  renderAll();
}

function removeMasterItem(type, value) {
  const inUse = Object.keys(pageConfig).some((pageKey) => {
    const key = pageConfig[pageKey].sectionKey;
    return state.data[key].some((section) =>
      type === "associates"
        ? section.name === value
        : type === "locations"
          ? section.location === value
          : section.rows.some((row) => row.category === value)
    );
  });

  if (inUse) {
    const ok = window.confirm(`${value} is currently in use. Remove it anyway?`);
    if (!ok) return;
  }

  state.masters[type] = state.masters[type].filter((item) => item !== value);
  persistMasters();
  renderAll();
}

function fillSelect(select, items, placeholder, selectedValue = "") {
  select.innerHTML = "";
  appendOption(select, "", placeholder);
  items.forEach((item) => appendOption(select, item, item));
  select.value = selectedValue && items.includes(selectedValue) ? selectedValue : "";
}

function appendOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.appendChild(option);
}


function getPoPrepVarianceRef(poRow) {
  const ordered = plt_hasVal(poRow?.orderedQty) ? Number(poRow.orderedQty) : null;
  const received = plt_hasVal(poRow?.receivedQty) ? Number(poRow.receivedQty) : null;
  const prep = plt_hasVal(poRow?.prepReceivedQty) ? Number(poRow.prepReceivedQty) : null;
  const prepVsReceiving = prep !== null && received !== null ? prep - received : null;
  const extrasSourceQty = prep !== null ? prep : received;
  const extras = extrasSourceQty !== null && ordered !== null ? Math.max(0, extrasSourceQty - ordered) : 0;
  const shortage = extrasSourceQty !== null && ordered !== null ? Math.max(0, ordered - extrasSourceQty) : 0;
  return { ordered, received, prep, prepVsReceiving, extras, shortage, extrasSource: prep !== null ? "prep" : (received !== null ? "receiving" : "none") };
}

function getLegacyPrepRowVarianceRef(row) {
  const ordered = Number(row?.orderedQty || row?.qty || 0) || 0;
  const prep = plt_hasVal(row?.prepReceivedQty) ? Number(row.prepReceivedQty) : (plt_hasVal(row?.receivedQty) ? Number(row.receivedQty) : null);
  const received = plt_hasVal(row?.receivedQty) ? Number(row.receivedQty) : null;
  const prepVsReceiving = prep !== null && received !== null ? prep - received : null;
  const extras = prep !== null && ordered ? Math.max(0, prep - ordered) : 0;
  const shortage = prep !== null && ordered ? Math.max(0, ordered - prep) : 0;
  return { ordered, received, prep, prepVsReceiving, extras, shortage, extrasSource: prep !== null ? "prep" : "none" };
}

function getPrepPoReferenceMap() {
  const map = new Map();

  // Read from pallet-based workflow. Overstock must come from TRUE extras only.
  // If Prep has counted the PO, use Prep count vs Ordered. Otherwise do not guess.
  const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
  pallets
    .filter(p => p.status === 'prep' || p.status === 'done')
    .forEach(pallet => {
      (pallet.pos || []).forEach(poRow => {
        const po = String(poRow.po || '').trim();
        if (!po) return;
        const ref = getPoPrepVarianceRef(poRow);
        const category = poRow.category || '';
        const palletLabel = pallet.label || '';
        const palletDate = pallet.date || '';
        if (!map.has(po)) {
          map.set(po, {
            po,
            quantity: ref.extras,
            ordered: ref.ordered || 0,
            received: ref.received || 0,
            prep: ref.prep || 0,
            prepVsReceiving: ref.prepVsReceiving,
            overstock: ref.extras,
            shortage: ref.shortage,
            extrasSource: ref.extrasSource,
            category,
            palletLabel,
            palletDate,
            count: 1,
          });
        } else {
          const cur = map.get(po);
          cur.quantity += ref.extras;
          cur.ordered += ref.ordered || 0;
          cur.received += ref.received || 0;
          cur.prep += ref.prep || 0;
          cur.overstock += ref.extras;
          cur.shortage = (cur.shortage || 0) + (ref.shortage || 0);
          cur.count += 1;
        }
      });
    });

  // Legacy Prep rows: only trust explicit positive extras from Prep vs Ordered.
  (state.data.prepSections || []).forEach(section => {
    (section.rows || []).forEach(row => {
      const po = String(row.po || '').trim();
      if (!po) return;
      const ref = getLegacyPrepRowVarianceRef(row);
      if (!map.has(po)) {
        map.set(po, {
          po,
          quantity: ref.extras,
          ordered: ref.ordered || 0,
          received: ref.received || 0,
          prep: ref.prep || 0,
          prepVsReceiving: ref.prepVsReceiving,
          overstock: ref.extras,
          shortage: ref.shortage,
          extrasSource: ref.extrasSource,
          category: row.category || '',
          palletLabel: '',
          palletDate: '',
          count: 1,
        });
      } else {
        const cur = map.get(po);
        cur.quantity += ref.extras;
        cur.ordered += ref.ordered || 0;
        cur.received += ref.received || 0;
        cur.prep += ref.prep || 0;
        cur.overstock += ref.extras;
        cur.shortage = (cur.shortage || 0) + (ref.shortage || 0);
        cur.count += 1;
      }
    });
  });

  return map;
}

function updateOverstockPoQuantity() {
  const poSelect = document.getElementById("overstockEntryPo");
  const qtyInput = document.getElementById("overstockEntryQty");
  if (!poSelect || !qtyInput) return;
  const ref = getPrepPoReferenceMap().get(poSelect.value);
  const newVal = ref ? String(ref.quantity || 0) : "";
  qtyInput.value = newVal;
  // Keep the module-level signal in sync so the adjusted-warning doesn't fire on re-renders
  _overstockAutoQty = newVal !== "" ? newVal : null;
  // Clear any stale adjusted badges whenever the canonical auto-qty is refreshed
  const adjBadge = document.getElementById("overstockQtyAdjustedBadge");
  const autoWarn = document.getElementById("overstockAutoQtyWarn");
  if (adjBadge) adjBadge.style.display = "none";
  if (autoWarn) autoWarn.style.display = "none";
  const autoLbl = document.getElementById("overstockQtyAutoLabel");
  if (autoLbl) {
    autoLbl.style.display = newVal !== "" ? "" : "none";
    autoLbl.textContent = " (auto-filled from Prep)";
  }
}



function getUnifiedPutawayPoReferenceMap() {
  const map = new Map();

  // ── NEW: read from pallet-based workflow ─────────────────────────────────
  const pallets = Array.isArray(state.data.pallets) ? state.data.pallets : [];
  pallets.forEach(pallet => {
    const dept = pallet.status === 'draft' ? 'Docker'
               : pallet.status === 'receiving' ? 'QA Receiving'
               : 'Prep';
    (pallet.pos || []).forEach(poRow => {
      const po = String(poRow.po || '').trim();
      if (!po) return;
      const qty = poRow.receivedQty != null ? Number(poRow.receivedQty)
                : poRow.orderedQty  != null ? Number(poRow.orderedQty)
                : 0;
      if (!map.has(po)) {
        map.set(po, {
          po,
          department: dept,
          category: String(poRow.category || '').trim(),
          quantity: qty,
          palletLabel: pallet.label || '',
          stsQty: poRow.stsQty || 0,
          ltsQty: poRow.ltsQty || 0,
        });
      }
    });
  });

  // ── LEGACY: also read from old section-based data ─────────────────────────
  const addRows = (sections, departmentLabel) => {
    (sections || []).forEach(section => {
      (section.rows || []).forEach(row => {
        const po = String(row.po || "").trim();
        if (!po) return;
        if (!map.has(po)) {
          map.set(po, {
            po, department: departmentLabel,
            category: String(row.category || "").trim(),
            quantity: Number(row.receivedQty || row.orderedQty || row.qty || 0) || 0,
            palletLabel: '', stsQty: 0, ltsQty: 0,
          });
        }
      });
    });
  };
  addRows(state.data.dockSections || [], "Docker");
  addRows(state.data.receivingSections || [], "QA Receiving");
  addRows(state.data.prepSections || [], "Prep");
  return map;
}
function getPrepPutawayReferenceMap() {
  const map = new Map();
  (state.data.prepSections || []).forEach(section => {
    (section.rows || []).forEach(row => {
      const po = String(row.po || "").trim();
      if (!po) return;
      const ordered = Number(row.orderedQty || row.qty || 0) || 0;
      const received = Number(row.receivedQty || 0) || 0;
      const extras = Number(row.extras || 0) || 0;
      const qty = extras > 0 ? extras : Math.max(0, received);
      const category = String(row.category || "").trim();
      if (!map.has(po)) {
        map.set(po, { po, quantity: qty, category, ordered, received, extras, count: 1 });
      } else {
        const current = map.get(po);
        current.quantity += qty;
        current.ordered += ordered;
        current.received += received;
        current.extras += extras;
        current.count += 1;
        if (!current.category && category) current.category = category;
      }
    });
  });
  return map;
}

function updatePutawayPoFields() {
  const poSelect = document.getElementById("putawayEntryPo");
  const qtyInput = document.getElementById("putawayEntryQty");
  const categoryInput = document.getElementById("putawayEntryCategory");
  if (!poSelect || !qtyInput || !categoryInput) return;
  const ref = getPrepPutawayReferenceMap().get(poSelect.value);
  qtyInput.value = ref ? String(ref.quantity || 0) : "";
  categoryInput.value = ref ? String(ref.category || "") : "";
}


function persistData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  window.dispatchEvent(new CustomEvent('qa-workflow-data-changed'));
  scheduleWorkflowSync();
}

function persistMasters() {
  localStorage.setItem(MASTER_KEY, JSON.stringify(state.masters));
  scheduleWorkflowSync();
}

function loadWorkflowData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultData();
    const parsed = JSON.parse(raw);
    const defaults = getDefaultData();
    return {
      ...defaults,
      ...parsed,
      pallets: Array.isArray(parsed.pallets) ? parsed.pallets : defaults.pallets,
      dockFilters: { ...defaults.dockFilters, ...(parsed.dockFilters || {}) },
      receivingFilters: { ...defaults.receivingFilters, ...(parsed.receivingFilters || {}) },
      prepFilters: { ...defaults.prepFilters, ...(parsed.prepFilters || {}) },
      overstockFilters: { ...defaults.overstockFilters, ...(parsed.overstockFilters || {}) },
      dockSections: Array.isArray(parsed.dockSections) ? parsed.dockSections : defaults.dockSections,
      receivingSections: Array.isArray(parsed.receivingSections) ? parsed.receivingSections : defaults.receivingSections,
      prepSections: Array.isArray(parsed.prepSections) ? parsed.prepSections : defaults.prepSections,
      overstockEntries: Array.isArray(parsed.overstockEntries) ? parsed.overstockEntries : defaults.overstockEntries,
      putawayEntries: Array.isArray(parsed.putawayEntries) ? parsed.putawayEntries : defaults.putawayEntries,
      workflowUi: { ...defaults.workflowUi, ...(parsed.workflowUi || {}) },
    };
  } catch {
    return getDefaultData();
  }
}

function getDefaultData() {
  return {
    pallets: [],
    dockSections: [],
    dockFilters: { person: "All", day: "", search: "", mineOnly: false },
    receivingSections: [],
    receivingFilters: { person: "All", day: "", search: "", mineOnly: false },
    prepSections: [],
    prepFilters: { person: "All", day: "", search: "", mineOnly: false },
    overstockEntries: [],
    overstockFilters: { date: "", associate: "All", location: "All", status: "All", search: "", mineOnly: false },
    putawayEntries: [],
    putawayFilters: { date: "", associate: "All", zone: "All", status: "All", search: "", mineOnly: false },
  };
}

function loadMasters() {
  try {
    const raw = localStorage.getItem(MASTER_KEY);
    const base = raw ? JSON.parse(raw) : { ...defaultMasters };
    const attendanceNames = [...new Set(readAttendanceEmployees())].sort((a, b) => a.localeCompare(b));
    return {
      ...defaultMasters,
      ...base,
      associates: attendanceNames.length ? attendanceNames : (Array.isArray(base.associates) ? base.associates : defaultMasters.associates)
    };
  } catch {
    const attendanceNames = [...new Set(readAttendanceEmployees())].sort((a, b) => a.localeCompare(b));
    return {
      ...defaultMasters,
      associates: attendanceNames.length ? attendanceNames : defaultMasters.associates
    };
  }
}

function demoSections(kind) {
  const now = Date.now();
  if (kind === "dock") {
    return [
      {
        id: makeId(),
        date: "2026-03-13",
        name: "Carlton",
        location: "Dock-1 Tue",
        createdAt: now - 1000,
        updatedAt: now - 1000,
        rows: [
          { id: makeId(), po: "265923", boxes: 1, qty: 105, category: "Children / Niños", notes: "", createdAt: now - 1000 },
          { id: makeId(), po: "265461", boxes: 1, qty: 200, category: "Travel and Camping / Viajes y Acampada", notes: "", createdAt: now - 2000 },
        ],
      },
    ];
  }
  return [
    {
      id: makeId(),
      date: "2026-03-13",
      name: kind === "receiving" ? "Diana" : "Gilda",
      location: kind === "receiving" ? "QA-1 Tue" : "Prep-1 Tue",
      createdAt: now - 1000,
      updatedAt: now - 1000,
      rows: [
        { id: makeId(), po: "271100", boxes: 5, orderedQty: 100, receivedQty: 105, extras: 5, category: "Drinkware / Utensilios para Beber", notes: "", createdAt: now - 1000 },
        { id: makeId(), po: "271101", boxes: 3, orderedQty: 80, receivedQty: 74, extras: -6, category: "Apparel / Ropa", notes: "Sizes", sizeBreakdown: { S: 2, M: 1, L: 3 }, createdAt: now - 2000 },
      ],
    },
  ];
}

function getDayClass(location) {
  const text = String(location || "").toLowerCase();
  if (text.includes("mon")) return "day-monday";
  if (text.includes("tue")) return "day-tuesday";
  if (text.includes("wed")) return "day-wednesday";
  if (text.includes("thu")) return "day-thursday";
  if (text.includes("fri")) return "day-friday";
  return "";
}

function makeId() {
  return Math.random().toString(36).slice(2, 11);
}

function touchSection(section) {
  section.updatedAt = Date.now();
}


function formatDateTimeShort(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US");
}

function formatToday() {
  return new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


document.addEventListener("click", (event) => {
  const deptBtn = event.target.closest("[data-performance-dept]");
  if (!deptBtn) return;
  state.performanceDeptView = deptBtn.getAttribute("data-performance-dept") || "receiving";
  localStorage.setItem("qaWorkflowPerformanceDeptViewV1", state.performanceDeptView);
  renderPerformancePage();
});

setTimeout(() => {
  ["pacePlannerGoal","pacePlannerHeadcount","pacePlannerHours"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.dataset.boundPlanner) {
      el.addEventListener("input", () => { if (state.currentPage === "performance") renderPerformancePage(); });
      el.dataset.boundPlanner = "1";
    }
  });
}, 0);

document.addEventListener("click", (event) => {
  const resetBtn = event.target.closest("#resetPerformanceImportsBtn");
  if (!resetBtn) return;
  const confirmed = confirm("Reset imported performance data and start fresh from zero? This removes the imported month library used by performance calculations.");
  if (!confirmed) return;
  clearImportedLibraryData();
});



function getSectionRowsForPulse(section, deptKey) {
  return getPalletRowsForPulse(section);
}

function openPulseCheckModal() {
  const backdrop = document.getElementById("pulseCheckBackdrop");
  if (!backdrop) return;
  const context = getHeroPulseContext();

  const title = document.getElementById("pulseCheckTitle");
  const subtitle = document.getElementById("pulseCheckSubtitle");
  const peopleToday = document.getElementById("pulsePeopleToday");
  const unitsToday = document.getElementById("pulseUnitsToday");
  const categoriesToday = document.getElementById("pulseCategoriesToday");
  const topCategory = document.getElementById("pulseTopCategory");
  const peopleList = document.getElementById("pulsePeopleList");
  const categoryList = document.getElementById("pulseCategoryList");

  const statusImage = document.getElementById("pulseCheckStatusImage");
  const statusLabel = document.getElementById("pulseCheckStatusLabel");
  const statusText = document.getElementById("pulseCheckStatusText");

  if (!context) {
    if (title) title.textContent = "Department Pulse Check";
    if (subtitle) subtitle.textContent = "Open this from QA Receiving or QA Prep to see a live department pulse.";
    if (peopleToday) peopleToday.textContent = "0";
    if (unitsToday) unitsToday.textContent = "0";
    if (categoriesToday) categoriesToday.textContent = "0";
    if (topCategory) topCategory.textContent = "—";
    if (peopleList) peopleList.innerHTML = '<div class="pulse-empty">Switch to QA Receiving or QA Prep first.</div>';
    if (categoryList) categoryList.innerHTML = '<div class="pulse-empty">No department selected.</div>';
    if (statusImage) statusImage.src = getUphPaceAsset(1);
    if (statusLabel) statusLabel.textContent = "Current pace status";
    if (statusText) statusText.textContent = "Waiting";
    backdrop.hidden = false;
    return;
  }

  const flatRows = getPalletRowsForPulse(context);

  const peopleMap = new Map();
  const categoryMap = new Map();
  let totalUnits = 0;

  flatRows.forEach(row => {
    totalUnits += row.units;
    peopleMap.set(row.associate, (peopleMap.get(row.associate) || 0) + row.units);
    categoryMap.set(row.category, (categoryMap.get(row.category) || 0) + row.units);
  });

  const people = [...peopleMap.entries()].sort((a, b) => b[1] - a[1]);
  const categories = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);

  if (title) title.textContent = `${context.label} Pulse Check`;
  if (subtitle) subtitle.textContent = flatRows.length
    ? `Today’s people, units, and category mix for ${context.label}.`
    : `No pallet activity found for today yet in ${context.label}.`;

  const pulseSummary = getPulseUphSummary(context, flatRows);
  const uphBadgeValue = pulseSummary.uph;
  const stage = getUphPaceStage(uphBadgeValue);
  if (statusImage) statusImage.src = getUphPaceAsset(stage);
  if (statusLabel) statusLabel.textContent = `${context.label} pace status`;
  if (statusText) statusText.textContent = `${getUphPaceLabelText(stage, state.language)} • ${Number.isFinite(uphBadgeValue) ? uphBadgeValue : 0} UPH`;
  if (peopleToday) peopleToday.textContent = String(people.length);
  if (unitsToday) unitsToday.textContent = String(totalUnits);
  if (categoriesToday) categoriesToday.textContent = String(categories.length);
  if (topCategory) topCategory.textContent = categories[0] ? categories[0][0] : "—";

  if (peopleList) {
    peopleList.innerHTML = people.length
      ? people.map(([name, units]) => `<div class="pulse-row"><div><div class="pulse-row-name">${name}</div><div class="pulse-row-meta">${context.label}</div></div><div class="pulse-row-value">${units} units</div></div>`).join("")
      : '<div class="pulse-empty">No people found for this department today.</div>';
  }

  if (categoryList) {
    categoryList.innerHTML = categories.length
      ? categories.map(([name, units]) => `<div class="pulse-row"><div><div class="pulse-row-name">${name}</div><div class="pulse-row-meta">${context.label}</div></div><div class="pulse-row-value">${units} units</div></div>`).join("")
      : '<div class="pulse-empty">No category activity found for this department.</div>';
  }

  backdrop.hidden = false;
}

function closePulseCheckModal() {
  const backdrop = document.getElementById("pulseCheckBackdrop");
  if (backdrop) backdrop.hidden = true;
}



if (!window.__pulseModalBound) document.addEventListener("click", (event) => {
  const pulseClose = event.target.closest("#pulseCheckCloseBtn");
  if (pulseClose) {
    event.stopPropagation();
    closePulseCheckModal();
    return;
  }
  const pulseTrigger = event.target.closest("#uphPaceVisual");
  if (pulseTrigger) {
    event.stopPropagation();
    openPulseCheckModal();
    return;
  }
  const backdrop = document.getElementById("pulseCheckBackdrop");
  if (backdrop && event.target === backdrop) {
    closePulseCheckModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePulseCheckModal();
});
window.__pulseModalBound = true;



const putawayStatusOptions = ["Put Away", "Reserved for Assembly", "Picked", "Moved", "Missing"];



function translatePutawayStatus(value) {
  return value;
}

function populatePutawayFormSelects() {
  const poSelect = document.getElementById("putawayEntryPo");
  const poSearch = document.getElementById("putawayEntryPoSearch");
  if (poSelect) {
    const poMap = getUnifiedPutawayPoReferenceMap();
    const previous = poSelect.value;
    const search = String((poSearch && poSearch.value) || "").trim().toLowerCase();
    poSelect.innerHTML = "";
    appendOption(poSelect, "", "Select PO");
    [...poMap.values()]
      .filter(item => !search || item.po.toLowerCase().includes(search))
      .sort((a,b)=>a.po.localeCompare(b.po))
      .forEach(item => appendOption(poSelect, item.po, item.department ? `${item.po} • ${item.department}` : item.po));
    poSelect.value = poMap.has(previous) ? previous : "";
  }

  const statusSelect = document.getElementById("putawayEntryStatus");
  if (statusSelect) {
    statusSelect.innerHTML = "";
    appendOption(statusSelect, "", "Select Status");
    putawayStatusOptions.forEach(status => appendOption(statusSelect, status, translatePutawayStatus(status)));
  }
}

function populatePutawayFilterSelects() {
  const filters = state.data.putawayFilters || (state.data.putawayFilters = { date: "", associate: "All", status: "All", search: "", mineOnly: false });

  const associateFilter = document.getElementById("putawayAssociateFilter");
  if (associateFilter) {
    associateFilter.innerHTML = "";
    appendOption(associateFilter, "All", t("everyone"));
    const names = [...new Set((state.data.putawayEntries || []).map(item => item.associate).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    names.forEach(name => appendOption(associateFilter, name, name));
    associateFilter.value = filters.associate || "All";
  }

  const statusFilter = document.getElementById("putawayStatusFilter");
  if (statusFilter) {
    statusFilter.innerHTML = "";
    appendOption(statusFilter, "All", t("everyone"));
    putawayStatusOptions.forEach(status => appendOption(statusFilter, status, translatePutawayStatus(status)));
    statusFilter.value = filters.status || "All";
  }

  const dateFilter = document.getElementById("putawayDateFilter");
  const searchInput = document.getElementById("putawaySearchInput");
  if (dateFilter) dateFilter.value = filters.date || "";
  if (searchInput) searchInput.value = filters.search || "";
  const myBtn = document.getElementById("putawayMyItemsBtn");
  if (myBtn) myBtn.classList.toggle("active-filter", !!filters.mineOnly);
}

function getFilteredPutawayEntries() {
  const filters = state.data.putawayFilters || {};
  let rows = [...(state.data.putawayEntries || [])].sort((a,b)=> (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0));
  if (filters.date) rows = rows.filter(r => r.date === filters.date);
  if (filters.mineOnly && state.currentUser) rows = rows.filter(r => r.associate === state.currentUser);
  if (filters.associate && filters.associate !== "All") rows = rows.filter(r => r.associate === filters.associate);
  if (filters.status && filters.status !== "All") rows = rows.filter(r => r.status === filters.status);
  if (filters.search) {
    const q = String(filters.search || "").toLowerCase();
    rows = rows.filter(r => [r.date, r.po, r.location, r.status, r.associate, r.notes].join(" ").toLowerCase().includes(q));
  }
  return rows;
}

function renderPutawayPage() {
  if (!Array.isArray(state.data.putawayEntries)) state.data.putawayEntries = [];
  if (!state.data.putawayFilters) state.data.putawayFilters = { date: "", associate: "All", status: "All", search: "", mineOnly: false };
  if (!state.data.putawayUi) state.data.putawayUi = { expandedPos: {} };

  populatePutawayFormSelects();
  populatePutawayFilterSelects();

  const entries = getFilteredPutawayEntries();
  const uniqueLocations = new Set(entries.map(r => r.location).filter(Boolean));

  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  setText("putawayStatRows", entries.length);
  setText("putawayStatUnits", entries.length);
  setText("putawayStatLocations", uniqueLocations.size);
  setText("putawayStatOpenLocations", uniqueLocations.size);

  const groups = new Map();
  entries.forEach((row) => {
    const po = String(row.po || "").trim() || "No PO";
    if (!groups.has(po)) groups.set(po, []);
    groups.get(po).push(row);
  });

  const tbody = document.getElementById("putawayTableBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!groups.size) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state-cell">${t("noRows")}</td></tr>`;
    return;
  }

  [...groups.entries()]
    .sort((a,b) => {
      const aLatest = Math.max(...a[1].map(r => r.updatedAt || r.createdAt || 0));
      const bLatest = Math.max(...b[1].map(r => r.updatedAt || r.createdAt || 0));
      return bLatest - aLatest;
    })
    .forEach(([po, rows]) => {
      const latest = [...rows].sort((a,b)=> (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0))[0];
      const locations = [...new Set(rows.map(r => r.location).filter(Boolean))];
      const expanded = !!state.data.putawayUi.expandedPos[po];

      const parentTr = document.createElement("tr");
      parentTr.className = "putaway-parent-row";
      parentTr.innerHTML = `
        <td>
          <div class="putaway-parent-main">
            <div class="putaway-parent-title">${escapeHtml(po)}</div>
            <div class="putaway-parent-sub">${rows.length > 1 ? "Multi-batch PO" : "Single batch PO"}</div>
          </div>
        </td>
        <td>${rows.length}</td>
        <td><span class="day-pill ${getDayClass(formatDayCode(latest.date))}">${formatDate(latest.date)}</span></td>
        <td>${escapeHtml(locations.join(", ") || "—")}</td>
        <td>${escapeHtml(latest.status || "")}</td>
        <td>${escapeHtml(latest.notes || "")}</td>
        <td class="action-stack">
          <button class="tiny-btn putaway-expand-btn" type="button">${expanded ? t("hidePutawayEntries") : t("viewPutawayEntries")}</button>
          <button class="tiny-btn ghost-btn putaway-history-btn" type="button">${t("fullPoHistory")}</button>
        </td>
      `;
      parentTr.querySelector(".putaway-expand-btn").addEventListener("click", () => {
        state.data.putawayUi.expandedPos[po] = !state.data.putawayUi.expandedPos[po];
        persistData();
        renderPutawayPage();
      });
      const historyBtn = parentTr.querySelector(".putaway-history-btn");
      if (historyBtn) {
        historyBtn.addEventListener("click", () => openBatchHistoryModal("putaway", po));
      }
      tbody.appendChild(parentTr);

      if (expanded) {
        const childTr = document.createElement("tr");
        childTr.className = "putaway-child-shell";
        childTr.innerHTML = `<td colspan="7"><div class="putaway-child-list"></div></td>`;
        const shell = childTr.querySelector(".putaway-child-list");

        [...rows]
          .sort((a,b)=> (b.updatedAt||b.createdAt||0) - (a.updatedAt||a.createdAt||0))
          .forEach((row) => {
            const child = document.createElement("div");
            child.className = "putaway-child-row";
            child.innerHTML = `
              <div>
                <div class="putaway-parent-title">${formatDate(row.date)}</div>
                <div class="putaway-child-meta">Batch entry</div>
              </div>
              <div>
                <div class="putaway-parent-title">${escapeHtml(row.location || "—")}</div>
                <div class="putaway-child-meta">Location</div>
              </div>
              <div>
                <div class="putaway-parent-title">${escapeHtml(row.status || "—")}</div>
                <div class="putaway-child-meta">Status</div>
              </div>
              <div>
                <div class="putaway-parent-title">${escapeHtml(row.notes || "No notes")}</div>
                <div class="putaway-child-meta">${escapeHtml(row.associate || "Unknown associate")}</div>
              </div>
              <div class="action-stack">
                <button class="tiny-btn putaway-edit-btn" type="button">${state.language === "es" ? "Editar" : "Edit"}</button>
                <button class="tiny-btn ghost-btn putaway-delete-btn" type="button">${state.language === "es" ? "Eliminar" : "Delete"}</button>
              </div>
            `;
            child.querySelector(".putaway-delete-btn").addEventListener("click", () => {
              state.data.putawayEntries = state.data.putawayEntries.filter(item => item.id !== row.id);
              persistData();
              renderPutawayPage();
            });
            child.querySelector(".putaway-edit-btn").addEventListener("click", () => {
              const parentTableRow = childTr.previousElementSibling;
              if (parentTableRow) togglePutawayEditRow(parentTableRow, row.id);
            });
            shell.appendChild(child);
          });

        tbody.appendChild(childTr);
      }
    });
}

function togglePutawayEditRow(tableRow, rowId) {
  const tbody = tableRow.parentElement;
  const existing = tbody.querySelector(".putaway-edit-row");
  if (existing && existing !== tableRow.nextElementSibling) existing.remove();
  const alreadyOpen = tableRow.nextElementSibling && tableRow.nextElementSibling.classList.contains("putaway-edit-row");
  if (alreadyOpen) return tableRow.nextElementSibling.remove();

  const row = state.data.putawayEntries.find(item => item.id === rowId);
  const editTr = document.createElement("tr");
  editTr.className = "putaway-edit-row";
  editTr.innerHTML = `
    <td colspan="6">
      <div class="putaway-edit-grid">
        <input type="date" value="${row.date}" data-field="date" />
        <input type="text" value="${escapeAttribute(row.po)}" data-field="poSearch" placeholder="Type PO" />
        <select data-field="po"></select>
        <input type="text" value="${escapeAttribute(row.location || "")}" data-field="location" placeholder="Location" />
        <select data-field="status"></select>
        <input type="text" value="${escapeAttribute(row.notes || "")}" data-field="notes" placeholder="Notes" />
        <button class="tiny-btn save-putaway-edit" type="button">${t("save")}</button>
        <button class="tiny-btn ghost-btn cancel-putaway-edit" type="button">${t("cancel")}</button>
      </div>
    </td>
  `;

  const poSearch = editTr.querySelector('[data-field="poSearch"]');
  const poSel = editTr.querySelector('[data-field="po"]');
  const statusSel = editTr.querySelector('[data-field="status"]');

  const fillPoOptions = () => {
    const poMap = getUnifiedPutawayPoReferenceMap();
    const q = String(poSearch.value || "").trim().toLowerCase();
    poSel.innerHTML = "";
    appendOption(poSel, "", "Select PO");
    [...poMap.values()]
      .filter(item => !q || item.po.toLowerCase().includes(q))
      .sort((a,b)=>a.po.localeCompare(b.po))
      .forEach(item => appendOption(poSel, item.po, item.department ? `${item.po} • ${item.department}` : item.po));
    poSel.value = poMap.has(row.po) ? row.po : "";
  };
  poSearch.addEventListener("input", fillPoOptions);
  fillPoOptions();

  statusSel.innerHTML = "";
  putawayStatusOptions.forEach(status => appendOption(statusSel, status, status));
  statusSel.value = row.status || "";

  editTr.querySelector(".cancel-putaway-edit").addEventListener("click", () => editTr.remove());
  editTr.querySelector(".save-putaway-edit").addEventListener("click", () => {
    const beforeSnapshot = cloneForAudit(row);
    ensureRowAuditFields(row, { date: row.date || "" });

    row.date = editTr.querySelector('[data-field="date"]').value;
    row.po = poSel.value.trim();
    row.location = editTr.querySelector('[data-field="location"]').value.trim();
    row.status = statusSel.value;
    row.notes = editTr.querySelector('[data-field="notes"]').value.trim();
    row.updatedAt = Date.now();
    
    row.date = row.originalDate || row.date || "";
    const afterSnapshot = cloneForAudit(row);
    recordRowEditAudit(row, beforeSnapshot, afterSnapshot, { date: row.originalDate || row.date || "" }, state.currentUser || row.associate || "Unknown");
persistData();
    renderPutawayPage();
  });

  tableRow.insertAdjacentElement("afterend", editTr);
}



function bindPutawayEvents() {
  const dateFilter = document.getElementById("putawayDateFilter");
  const associateFilter = document.getElementById("putawayAssociateFilter");
  const statusFilter = document.getElementById("putawayStatusFilter");
  const searchInput = document.getElementById("putawaySearchInput");
  const poSelect = document.getElementById("putawayEntryPo");
  const poSearch = document.getElementById("putawayEntryPoSearch");

  if (dateFilter) dateFilter.addEventListener("change", (e) => { state.data.putawayFilters.date = e.target.value; renderPutawayPage(); });
  if (associateFilter) associateFilter.addEventListener("change", (e) => { state.data.putawayFilters.associate = e.target.value; renderPutawayPage(); });
  if (statusFilter) statusFilter.addEventListener("change", (e) => { state.data.putawayFilters.status = e.target.value; renderPutawayPage(); });
  if (searchInput) searchInput.addEventListener("input", (e) => { state.data.putawayFilters.search = e.target.value.trim().toLowerCase(); renderPutawayPage(); });
  if (poSearch) poSearch.addEventListener("input", populatePutawayFormSelects);
  if (poSelect) poSelect.addEventListener("change", () => {});

  // ── Manual PO entry toggle (Putaway) ────────────────────────────────
  let putawayPoManualMode = false;
  const putawayToggleBtn   = document.getElementById("putawayPoModeToggle");
  const putawayModeLabel   = document.getElementById("putawayPoModeLabel");
  const putawayManualInput = document.getElementById("putawayEntryPoManual");
  const putawayManualWarn  = document.getElementById("putawayManualPoWarning");

  function setPutawayPoMode(manual) {
    putawayPoManualMode = manual;
    if (manual) {
      if (poSearch)  poSearch.style.display  = "none";
      if (poSelect)  { poSelect.style.display = "none"; poSelect.required = false; }
      if (putawayManualInput) { putawayManualInput.style.display = ""; putawayManualInput.required = true; putawayManualInput.focus(); }
      if (putawayManualWarn) putawayManualWarn.style.display = "";
      if (putawayModeLabel)  putawayModeLabel.textContent = "Manual entry";
      if (putawayToggleBtn)  putawayToggleBtn.textContent = "Back to list";
    } else {
      if (poSearch)  poSearch.style.display  = "";
      if (poSelect)  { poSelect.style.display = ""; poSelect.required = true; }
      if (putawayManualInput) { putawayManualInput.style.display = "none"; putawayManualInput.required = false; putawayManualInput.value = ""; }
      if (putawayManualWarn) putawayManualWarn.style.display = "none";
      if (putawayModeLabel)  putawayModeLabel.textContent = "From list";
      if (putawayToggleBtn)  putawayToggleBtn.textContent = "Enter manually";
    }
  }
  if (putawayToggleBtn) putawayToggleBtn.addEventListener("click", () => setPutawayPoMode(!putawayPoManualMode));
  // ────────────────────────────────────────────────────────────────────

  const myBtn = document.getElementById("putawayMyItemsBtn");
  if (myBtn) myBtn.addEventListener("click", () => {
    state.data.putawayFilters.mineOnly = !state.data.putawayFilters.mineOnly;
    renderPutawayPage();
  });

  const clearBtn = document.getElementById("putawayClearFiltersBtn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    state.data.putawayFilters = { date: "", associate: "All", status: "All", search: "", mineOnly: false };
    renderPutawayPage();
  });

  const seedBtn = document.getElementById("putawaySeedBtn");
  if (seedBtn) seedBtn.addEventListener("click", () => {
    state.data.putawayEntries = demoPutawayEntries();
    persistData();
    renderPutawayPage();
  });

  const form = document.getElementById("putawayEntryForm");
  if (form) form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!Array.isArray(state.data.putawayEntries)) state.data.putawayEntries = [];

    // Read PO from whichever mode is active
    const po = putawayPoManualMode
      ? (putawayManualInput ? putawayManualInput.value.trim() : "")
      : (document.getElementById("putawayEntryPo") ? document.getElementById("putawayEntryPo").value : "");

    if (!po) {
      if (putawayPoManualMode && putawayManualInput) {
        putawayManualInput.style.borderColor = "#dc2626";
        putawayManualInput.focus();
      }
      return;
    }
    if (putawayPoManualMode && putawayManualInput) putawayManualInput.style.borderColor = "";

    state.data.putawayEntries.unshift({
      id: makeId(),
      date: document.getElementById("putawayEntryDate").value,
      po,
      manualPo: putawayPoManualMode || undefined,
      location: document.getElementById("putawayEntryLocation").value.trim(),
      status: document.getElementById("putawayEntryStatus").value,
      notes: document.getElementById("putawayEntryNotes").value.trim(),
      associate: state.currentUser || "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    persistData();
    form.reset();
    if (putawayPoManualMode && putawayManualInput) putawayManualInput.value = "";
    populatePutawayFormSelects();
    renderPutawayPage();
  });
}

function demoPutawayEntries() {
  return [
    { id: makeId(), date: "2026-03-27", po: "271100", location: "ST-A-03", status: "Put Away", associate: "Marcela", notes: "Top rack", createdAt: Date.now()-50000, updatedAt: Date.now()-50000 },
    { id: makeId(), date: "2026-03-27", po: "271101", location: "NA-02", status: "Reserved for Assembly", associate: "Rosa", notes: "Ready for next pick", createdAt: Date.now()-30000, updatedAt: Date.now()-30000 },
  ];
}

if (!window.__batchHistoryBound) document.addEventListener("click", (event) => {
  const closeBtn = event.target.closest("#batchHistoryCloseBtn");
  if (closeBtn) {
    event.stopPropagation();
    closeBatchHistoryModal();
    return;
  }
  const backdrop = document.getElementById("batchHistoryBackdrop");
  if (backdrop && event.target === backdrop) {
    closeBatchHistoryModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeBatchHistoryModal();
});
window.__batchHistoryBound = true;
