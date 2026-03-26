const STORAGE_KEY = "qaV5SeparatedWorkflowData_v4fixed";
const MASTER_KEY = "qaBlueSheetMastersV5";
const LANGUAGE_KEY = "qaWorkflowLanguageV1";
const CURRENT_USER_KEY = "qaWorkflowCurrentUserV2";

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
    sizeBreakdown: "Apparel size breakdown", sizesInExtras: "Extras by size",
    addAssociatePlaceholder: "Add associate", addCategoryPlaceholder: "Add category", addLocationPlaceholder: "Add location",
    searchPlaceholder: "PO, category, note, location..."
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
    sizeBreakdown: "Desglose de tallas de ropa", sizesInExtras: "Extras por talla",
    addAssociatePlaceholder: "Agregar asociado", addCategoryPlaceholder: "Agregar categoría", addLocationPlaceholder: "Agregar ubicación",
    searchPlaceholder: "PO, categoría, nota, ubicación..."
  }
};

const overstockStatusOptions = ["Donation", "Not Donation", "Pending PB"];
const overstockActionOptions = ["Donated", "Required", "Replaced", "Missing from Box"];
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
  [...state.masters.associates].sort((a,b)=>a.localeCompare(b)).forEach(name => appendOption(currentUserSelect, name, name));
  currentUserSelect.value = state.currentUser || "";
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
  populateCurrentUserSelect();
  setCurrentUserBtn.addEventListener("click", () => {
    state.currentUser = currentUserSelect.value || "";
    localStorage.setItem(CURRENT_USER_KEY, state.currentUser);
    renderAll();
  });
  clearCurrentUserBtn.addEventListener("click", () => {
    state.currentUser = "";
    localStorage.setItem(CURRENT_USER_KEY, "");
    renderAll();
  });
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
      window.alert("Choose the combined line historics CSV first.");
      return;
    }
    if (!statusWorkbookFile) {
      window.alert("Choose the Salesforce PO status workbook too.");
      return;
    }
    if (!label) {
      window.alert("Enter a month label first.");
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
      window.alert(`CEO month import saved.${latest ? ` Latest detected date: ${latest}.` : ""}`);
    } catch (err) {
      console.error("Historics import failed:", err);
      window.alert("Import failed. Make sure the combined CSV and status workbook are in the expected format.");
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
      window.alert("Choose an imported month first.");
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

const UPH_GOALS = { Prep: 275, QA: 180, Assembly: 220 };

function getAllWorkflowRows() {
  const rows = [];
  const importedRows = getImportedRowsForPerformance();
  importedRows.forEach(r => rows.push(r));
  (state.data.dockSections || []).forEach(section => {
    (section.rows || []).forEach(row => {
      rows.push({
        department: "Docker",
        associate: section.name || "",
        date: section.date || "",
        units: Number(row.qty || 0),
        boxes: Number(row.boxes || 0),
        extras: 0,
        missing: 0,
        po: row.po || "",
        category: row.category || "",
      });
    });
  });
  (state.data.receivingSections || []).forEach(section => {
    (section.rows || []).forEach(row => {
      const extras = Number(row.extras || 0);
      rows.push({
        department: "QA Receiving",
        associate: section.name || "",
        date: section.date || "",
        units: Number(row.receivedQty || row.orderedQty || 0),
        boxes: Number(row.boxes || 0),
        extras: extras > 0 ? extras : 0,
        missing: extras < 0 ? Math.abs(extras) : 0,
        po: row.po || "",
        category: row.category || "",
      });
    });
  });
  (state.data.prepSections || []).forEach(section => {
    (section.rows || []).forEach(row => {
      const extras = Number(row.extras || 0);
      rows.push({
        department: "Prep",
        associate: section.name || "",
        date: section.date || "",
        units: Number(row.receivedQty || row.orderedQty || 0),
        boxes: Number(row.boxes || 0),
        extras: extras > 0 ? extras : 0,
        missing: extras < 0 ? Math.abs(extras) : 0,
        po: row.po || "",
        category: row.category || "",
      });
    });
  });
  return rows;
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
  populatePerformanceControls();
  populateImportSelectors();
  updateImportStatus();
  const rows = getPerformanceFilteredRows();
  const imported = getActiveImportedRecord();
  const compareImported = getCompareImportedRecord();
  const context = getPeriodContext(rows, imported);
  const currentRows = context.currentRows;
  const previousRows = context.previousRows;
  const focusDate = context.focusDate;
  const focusMonth = formatMonthKey(focusDate);
  const monthRows = rows.filter(r => formatMonthKey(r.date) === focusMonth);
  const focusText = document.getElementById("performanceFocusText");
  if (focusText) focusText.textContent = context.label;
  updatePerformanceLabels(context);
  renderCeoStatusBoard(imported);

  const currentUnitsValue = sum(currentRows, r => r.units);
  const monthUnitsValue = sum(monthRows, r => r.units);
  document.getElementById("perfTodayUnits").textContent = currentUnitsValue;
  document.getElementById("perfMonthUnits").textContent = monthUnitsValue;
  document.getElementById("perfTodaySections").textContent = new Set(currentRows.map(r => `${r.associate}|${r.department}|${r.date}`)).size;
  document.getElementById("perfVariance").textContent = `${sum(currentRows, r => r.extras)} / ${sum(currentRows, r => r.missing)}`;

  const selectedAssoc = document.getElementById("performanceAssociateSelect")?.value || "All";
  const selectedDept = document.getElementById("performanceDepartmentSelect")?.value || "All";

  const compareRows = compareImported ? getImportedRowsForRecord(compareImported) : [];
  let compareFilteredRows = compareRows;
  if (selectedAssoc !== "All") compareFilteredRows = compareFilteredRows.filter(r => r.associate === selectedAssoc);
  if (selectedDept !== "All") compareFilteredRows = compareFilteredRows.filter(r => r.department === selectedDept);
  const compareLatest = compareImported ? getLatestImportedDate(compareImported) : "";
  const compareMonthRows = compareFilteredRows.filter(r => formatMonthKey(r.date) === formatMonthKey(compareLatest));
  const selectedMonthUnits = sum(monthRows, r => r.units);
  const comparedMonthUnits = sum(compareMonthRows, r => r.units);
  const diffMonth = selectedMonthUnits - comparedMonthUnits;
  document.getElementById("compareMonthUnits").textContent = selectedMonthUnits;
  document.getElementById("compareOtherMonthUnits").textContent = comparedMonthUnits;
  document.getElementById("compareMonthDiff").textContent = `${diffMonth >= 0 ? "+" : ""}${diffMonth}`;
  document.getElementById("compareMonthTrend").textContent = !compareImported ? "No compare" : diffMonth > 0 ? "Up" : diffMonth < 0 ? "Down" : "Flat";

  const prevUnits = sum(previousRows, r => r.units);
  const currentUnits = currentUnitsValue;
  const baselineDiff = currentUnits - prevUnits;
  const baselinePct = prevUnits > 0 ? (baselineDiff / prevUnits) * 100 : 0;
  document.getElementById("baselinePreviousUnits").textContent = prevUnits;
  document.getElementById("baselineCurrentUnits").textContent = currentUnits;
  document.getElementById("baselineDiff").textContent = `${baselineDiff >= 0 ? "+" : ""}${baselineDiff}`;
  document.getElementById("baselinePct").textContent = `${baselinePct >= 0 ? "+" : ""}${baselinePct.toFixed(1)}%`;

  const openStatusCurrent = summarizeStatusBoard(imported);
  setMetricList("perfDailyMetrics", [
    { label: "Selected View", value: `${selectedAssoc === "All" ? "Team" : selectedAssoc}${selectedDept !== "All" ? " • " + selectedDept : ""}` },
    { label: "Focused Period Units", value: currentUnits },
    { label: "Focused Period POs", value: currentRows.length },
    { label: "Focused Period Boxes", value: sum(currentRows, r => r.boxes) },
    { label: "Focused Period Extras", value: sum(currentRows, r => r.extras) },
    { label: "Focused Period Missing", value: sum(currentRows, r => r.missing) },
  ]);

  const deptBreakdown = ["Docker","QA Receiving","Prep","Assembly"].map(dep => ({
    dep,
    units: sum(monthRows.filter(r=>r.department===dep), r=>r.units)
  })).filter(x => x.units > 0);

  setMetricList("perfMonthlyMetrics", [
    { label: "Month Units", value: monthUnitsValue },
    { label: "Month POs", value: monthRows.length },
    { label: "Month Extras", value: sum(monthRows, r => r.extras) },
    { label: "Month Missing", value: sum(monthRows, r => r.missing) },
    { label: "Receiving-Ready POs", value: openStatusCurrent["ready-receiving"]?.pos || 0 },
    { label: "Prep-Ready POs", value: openStatusCurrent["ready-prep"]?.pos || 0 },
    { label: "Exception POs", value: openStatusCurrent["exceptions"]?.pos || 0 },
    ...deptBreakdown.map(x => ({ label: `${x.dep} Units`, value: x.units }))
  ]);

  const rankingSource = currentRows;
  const rankMap = {};
  rankingSource.forEach(r => {
    if (!r.associate) return;
    rankMap[r.associate] = (rankMap[r.associate] || 0) + r.units;
  });
  const ranking = Object.entries(rankMap).map(([name, units]) => ({ name, units })).sort((a,b)=>b.units-a.units);
  renderRanking(ranking);

  const insights = [];
  const teamPeriodUnits = sum(rankingSource, r => r.units);
  const teamAvg = ranking.length ? Math.round(teamPeriodUnits / ranking.length) : 0;
  if (ranking[0]) insights.push(`${ranking[0].name} is leading the selected period with ${ranking[0].units} units.`);
  if (ranking.length) insights.push(`Team average for the selected period is ${teamAvg} units.`);
  const extrasPeriod = sum(rankingSource, r => r.extras);
  const missingPeriod = sum(rankingSource, r => r.missing);
  insights.push(`Extras found: ${extrasPeriod}. Missing units: ${missingPeriod}.`);
  const depUnits = ["Docker","QA Receiving","Prep","Assembly"].map(dep => ({dep, units: sum(rankingSource.filter(r=>r.department===dep), r=>r.units)})).sort((a,b)=>b.units-a.units);
  if (depUnits[0] && depUnits[0].units > 0) insights.push(`Most work in the selected period is in ${depUnits[0].dep} with ${depUnits[0].units} units.`);
  const topCategories = {};
  rankingSource.forEach(r => { if (r.category) topCategories[r.category] = (topCategories[r.category] || 0) + r.units; });
  const topCat = Object.entries(topCategories).sort((a,b)=>b[1]-a[1])[0];
  if (topCat) insights.push(`Top category in the selected period: ${topCat[0]} (${topCat[1]} units).`);
  if (previousRows.length) insights.push(`Baseline change vs previous period: ${baselineDiff >= 0 ? "+" : ""}${baselineDiff} units (${baselinePct.toFixed(1)}%).`);
  if ((openStatusCurrent["exceptions"]?.pos || 0) > 0) insights.push(`${openStatusCurrent["exceptions"].pos} POs are sitting in case / replacement statuses and may need escalation.`);
  if ((openStatusCurrent["ready-prep"]?.pos || 0) > 0) insights.push(`${openStatusCurrent["ready-prep"].pos} fully received POs are ready for Prep now.`);
  renderInsights(insights);

  renderDateBreakdown(currentRows);
  renderLeadershipSummary(rows, currentRows, previousRows);
  renderHistoryLookup();
  renderUPHCalculator();
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
  bindPerformanceEvents();
  bindImportControls();
  bindRoleTabs();
  bindLanguageSwitch();
  bindCurrentUserControls();
  await refreshImportedLibraryCache();
  applyLanguage();
  renderAll();
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

function applyLanguage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById("todayLabelText").textContent = t("today");
  document.getElementById("totalQtyLabel").textContent = t("totalQty");
  document.getElementById("languageLabel").textContent = t("language");
  if (associateInput) associateInput.placeholder = t("addAssociatePlaceholder");
  categoryInput.placeholder = t("addCategoryPlaceholder");
  locationInput.placeholder = t("addLocationPlaceholder");
  document.querySelectorAll(".search-field input").forEach((input) => input.placeholder = t("searchPlaceholder"));
  const overstockPo = document.getElementById("overstockEntryPo");
  if (overstockPo) overstockPo.placeholder = t("po");
  document.querySelectorAll(".edit-section").forEach((el) => el.textContent = t("editSection"));
  document.querySelectorAll(".add-inline-row").forEach((el) => el.textContent = t("addRow"));
  document.querySelectorAll(".delete-section").forEach((el) => el.textContent = t("deleteSection"));
  document.querySelectorAll(".save-section-edit").forEach((el) => el.textContent = t("save"));
  document.querySelectorAll(".cancel-section-edit").forEach((el) => el.textContent = t("cancel"));
  langEnBtn.classList.toggle("active", state.language === "en");
  langEsBtn.classList.toggle("active", state.language === "es");
  renderCurrentUser();
  const perfBtn = document.getElementById("performanceTodayBtn");
  if (perfBtn) perfBtn.textContent = state.language === "es" ? "Actualizar vista" : "Refresh View";
  const summaryBtn = document.getElementById("toggleSummaryBtn");
  if (summaryBtn) {
    summaryBtn.textContent = summaryVisible
      ? (state.language === "es" ? "Ocultar resumen" : "Hide Summary")
      : (state.language === "es" ? "Mostrar resumen" : "Show Summary");
  }
}

function bindPageEvents() {
  Object.entries(pageConfig).forEach(([pageKey, cfg]) => {
    document.getElementById(cfg.sectionForm).addEventListener("submit", (event) => {
      event.preventDefault();
      const date = document.getElementById(cfg.sectionDate).value;
      const name = state.currentUser || "";
      const location = document.getElementById(cfg.sectionLocation).value;
      if (!location) return window.alert("Location is required.");
      if (!name) return window.alert(state.language === "es" ? "Primero selecciona un usuario actual." : "Select a current user first.");

      state.data[cfg.sectionKey].unshift({
        id: makeId(),
        date,
        name,
        location,
        rows: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      persistData();
      document.getElementById(cfg.sectionForm).reset();
      renderPage(pageKey);
    });

    document.getElementById(cfg.personFilter).addEventListener("change", (e) => {
      state.data[cfg.filterKey].person = e.target.value;
      renderPage(pageKey);
    });

    document.getElementById(cfg.dayFilter).addEventListener("change", (e) => {
      state.data[cfg.filterKey].day = e.target.value;
      renderPage(pageKey);
    });

    document.getElementById(cfg.searchInput).addEventListener("input", (e) => {
      state.data[cfg.filterKey].search = e.target.value.trim().toLowerCase();
      renderPage(pageKey);
    });

    const mineBtnId = pageKey === "dock" ? "myItemsBtn" : pageKey === "receiving" ? "receivingMyItemsBtn" : "prepMyItemsBtn";
    document.getElementById(mineBtnId).addEventListener("click", () => {
      state.data[cfg.filterKey].mineOnly = !state.data[cfg.filterKey].mineOnly;
      renderPage(pageKey);
    });

    document.getElementById(cfg.clearFiltersBtn).addEventListener("click", () => {
      state.data[cfg.filterKey] = { person: "All", day: "", search: "", mineOnly: false };
      renderPage(pageKey);
    });

    document.getElementById(cfg.seedBtn).addEventListener("click", () => {
      state.data[cfg.sectionKey] = demoSections(pageKey);
      persistData();
      renderPage(pageKey);
    });
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
  categoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addMasterItem("categories", categoryInput.value);
    categoryInput.value = "";
  });
  locationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addMasterItem("locations", locationInput.value);
    locationInput.value = "";
  });
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

  document.getElementById("overstockEntryForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!Array.isArray(state.data.overstockEntries)) state.data.overstockEntries = [];
    if (!state.data.overstockFilters) state.data.overstockFilters = { date: "", associate: "All", location: "All", status: "All", search: "" };
    state.data.overstockEntries.unshift({
      id: makeId(),
      date: document.getElementById("overstockEntryDate").value,
      po: document.getElementById("overstockEntryPo").value.trim(),
      status: document.getElementById("overstockEntryStatus").value,
      action: document.getElementById("overstockEntryAction").value,
      location: document.getElementById("overstockEntryLocation").value,
      associate: state.currentUser || document.getElementById("overstockEntryAssociate").value,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    persistData();
    document.getElementById("overstockEntryForm").reset();
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
  associateSelect.innerHTML = "";
  appendOption(associateSelect, "", t("selectAssociate"));
  [...state.masters.associates].sort((a,b)=>a.localeCompare(b)).forEach(name => appendOption(associateSelect, name, name));
  if (state.currentUser && state.masters.associates.includes(state.currentUser)) {
    associateSelect.value = state.currentUser;
    associateSelect.disabled = true;
  } else {
    associateSelect.disabled = false;
  }

  const locationSelect = document.getElementById("overstockEntryLocation");
  locationSelect.innerHTML = "";
  appendOption(locationSelect, "", t("selectLocation"));
  overstockLocations.forEach(loc => appendOption(locationSelect, loc, loc));

  const statusSelect = document.getElementById("overstockEntryStatus");
  statusSelect.innerHTML = "";
  appendOption(statusSelect, "", t("status"));
  overstockStatusOptions.forEach(opt => appendOption(statusSelect, opt, translateStatus(opt)));

  const actionSelect = document.getElementById("overstockEntryAction");
  actionSelect.innerHTML = "";
  appendOption(actionSelect, "", t("actionNeeded"));
  overstockActionOptions.forEach(opt => appendOption(actionSelect, opt, translateStatus(opt)));
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
  if (!state.data.overstockFilters) state.data.overstockFilters = { date: "", associate: "All", location: "All", status: "All", search: "" };

  populateOverstockFormSelects();
  populateOverstockFilterSelects();

  const entries = getFilteredOverstockEntries();
  document.getElementById("overstockStatRows").textContent = entries.length;
  document.getElementById("overstockStatDonation").textContent = entries.filter(r => r.status === "Donation").length;
  document.getElementById("overstockStatRequired").textContent = entries.filter(r => r.action === "Required").length;
  document.getElementById("overstockStatAssociates").textContent = new Set(entries.map(r => r.associate)).size;

  const tbody = document.getElementById("overstockTableBody");
  tbody.innerHTML = "";
  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state-cell">${t("noRows")}</td></tr>`;
    return;
  }

  entries.forEach((row) => {
    const tr = document.createElement("tr");
    const ownerLocked = !!(state.currentUser && row.associate && row.associate !== state.currentUser);
    tr.innerHTML = `
      <td><span class="day-pill ${getDayClass(formatDayCode(row.date))}">${formatDate(row.date)}</span></td>
      <td>${escapeHtml(row.po)}</td>
      <td>${translateStatus(row.status)}</td>
      <td>${translateStatus(row.action)}</td>
      <td>${escapeHtml(row.location)}</td>
      <td>${escapeHtml(row.associate)}</td>
      <td class="action-stack">
        <button class="tiny-btn overstock-edit-btn" type="button" ${ownerLocked ? "disabled" : ""}>${state.language === "es" ? "Editar" : "Edit"}</button>
        <button class="tiny-btn ghost-btn overstock-delete-btn" type="button" ${ownerLocked ? "disabled" : ""}>${state.language === "es" ? "Eliminar" : "Delete"}</button>
        ${ownerLocked ? `<span class="lock-note">${t("notYourEntry")}</span>` : ""}
      </td>
    `;
    if (!ownerLocked) {
      tr.querySelector(".overstock-delete-btn").addEventListener("click", () => {
        state.data.overstockEntries = state.data.overstockEntries.filter(item => item.id !== row.id);
        persistData();
        renderOverstockPage();
      });
      tr.querySelector(".overstock-edit-btn").addEventListener("click", () => {
        toggleOverstockEditRow(tr, row.id);
      });
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
  editTr.innerHTML = `
    <td colspan="7">
      <div class="overstock-edit-grid">
        <input type="date" value="${row.date}" data-field="date" />
        <input type="text" value="${escapeAttribute(row.po)}" data-field="po" />
        <select data-field="status"></select>
        <select data-field="action"></select>
        <select data-field="location"></select>
        <select data-field="associate"></select>
        <button class="tiny-btn save-overstock-edit" type="button">${t("save")}</button>
        <button class="tiny-btn ghost-btn cancel-overstock-edit" type="button">${t("cancel")}</button>
      </div>
    </td>
  `;

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
    row.date = editTr.querySelector('[data-field="date"]').value;
    row.po = editTr.querySelector('[data-field="po"]').value.trim();
    row.status = editTr.querySelector('[data-field="status"]').value;
    row.action = editTr.querySelector('[data-field="action"]').value;
    row.location = editTr.querySelector('[data-field="location"]').value;
    row.associate = editTr.querySelector('[data-field="associate"]').value;
    row.updatedAt = Date.now();
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
    { id: makeId(), date: "2026-02-24", po: "281464", status: "Pending PB", action: "Donated", location: "E-19", associate: "Marcela", createdAt: Date.now()-30000, updatedAt: Date.now()-30000 },
  ];
}


function formatDayCode(dateValue) {
  const d = new Date(dateValue + "T00:00:00");
  const names = ["sun","mon","tue","wed","thu","fri","sat"];
  return names[d.getDay()] || "";
}

function bindRoleTabs() {
  roleTabs.addEventListener("click", (event) => {
    const button = event.target.closest(".role-tab");
    if (!button) return;
    state.currentPage = button.dataset.page;

    document.querySelectorAll(".role-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.page === state.currentPage);
    });

    pages.forEach((page) => {
      page.classList.toggle("active", page.id === `page-${state.currentPage}`);
    });

    statsGrid.style.display = ["dock", "receiving", "prep"].includes(state.currentPage) ? "grid" : "none";
    if (state.currentPage === "performance") renderPerformancePage();
    if (state.currentPage === "overstock") renderOverstockPage();
    renderStats();
  });
}

function renderAll() {
  syncAssociatesFromAttendance();
  Object.keys(pageConfig).forEach(renderPage);
  renderOverstockPage();
  renderPerformancePage();
  populateImportSelectors();
  updateImportStatus();
  renderMasterLists();
  renderStats();
  populateCurrentUserSelect();
  applyLanguage();
}

function renderPage(pageKey) {
  const cfg = pageConfig[pageKey];

  fillSelect(document.getElementById(cfg.sectionLocation), state.masters.locations, t("selectLocation"));

  const filters = state.data[cfg.filterKey];
  const personSelect = document.getElementById(cfg.personFilter);
  personSelect.innerHTML = "";
  appendOption(personSelect, "All", t("everyone"));
  [...state.masters.associates].sort((a, b) => a.localeCompare(b)).forEach((name) => appendOption(personSelect, name, name));
  personSelect.value = state.masters.associates.includes(filters.person) || filters.person === "All" ? filters.person : "All";
  filters.person = personSelect.value;

  if (typeof filters.mineOnly !== "boolean") filters.mineOnly = false;
  document.getElementById(cfg.dayFilter).value = filters.day;
  document.getElementById(cfg.searchInput).value = filters.search;
  const mineBtn = document.getElementById(pageKey === "dock" ? "myItemsBtn" : pageKey === "receiving" ? "receivingMyItemsBtn" : "prepMyItemsBtn");
  if (mineBtn) mineBtn.classList.toggle("active-filter", !!filters.mineOnly);

  renderSections(pageKey);
  if (state.currentPage === pageKey) renderStats();
  applyLanguage();
}

function renderSections(pageKey) {
  const cfg = pageConfig[pageKey];
  const container = document.getElementById(cfg.container);
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
    fragment.querySelector(".name-text").textContent = section.location || "—";

    const chip = fragment.querySelector(".location-chip");
    chip.textContent = section.location || "—";
    chip.classList.add(getDayClass(section.location));
    const ownerTag = fragment.querySelector(".section-owner-tag");
    ownerTag.textContent = section.name ? `${state.language === "es" ? "Dueño" : "Owner"}: ${section.name}` : `${state.language === "es" ? "Dueño" : "Owner"}: —`;

    const ownerLocked = !!(state.currentUser && section.name && section.name !== state.currentUser);
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
      if (!location) return window.alert("Location is required.");
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
  const ownerLocked = !!(state.currentUser && section.name && section.name !== state.currentUser);
  tbody.innerHTML = "";
  const rowsToShow = getFilteredRows(pageKey, section);

  if (!rowsToShow.length) {
    tbody.innerHTML = `<tr><td colspan="${cfg.mode === "simple" ? 6 : 8}" class="empty-state-cell">${t("noRows")}</td></tr>`;
    return;
  }

  rowsToShow.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = cfg.mode === "simple"
      ? `
        <td>${escapeHtml(row.po)}</td>
        <td>${row.boxes}</td>
        <td>${row.qty}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${renderNotesCell(row)}</td>
      `
      : `
        <td>${escapeHtml(row.po)}</td>
        <td>${row.boxes}</td>
        <td>${row.orderedQty}</td>
        <td>${row.receivedQty}</td>
        <td>${renderExtras(row.extras)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${renderNotesCell(row)}</td>
      `;

    tr.innerHTML = `${cells}
      <td class="action-col action-stack">
        <button class="tiny-btn edit-row" type="button">${state.language === "es" ? "Editar" : "Edit"}</button>
        <button class="tiny-btn ghost-btn delete-row" type="button">${state.language === "es" ? "Eliminar" : "Delete"}</button>
      </td>
    `;

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
  let sections = [...state.data[cfg.sectionKey]].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const filters = state.data[cfg.filterKey];
  if (typeof filters.mineOnly !== "boolean") filters.mineOnly = false;

  if (filters.mineOnly && state.currentUser) sections = sections.filter((s) => s.name === state.currentUser);
  if (filters.person !== "All") sections = sections.filter((s) => s.name === filters.person);
  if (filters.day) sections = sections.filter((s) => s.date === filters.day);
  if (!filters.search) return sections;

  return sections.filter((section) => {
    const haystack = [section.name, section.location, formatDate(section.date), ...section.rows.flatMap((row) => Object.values(row))]
      .join(" ").toLowerCase();
    return haystack.includes(filters.search);
  });
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
    .replace(/\s*\|\s*(Extras by size|Extras por talla):\s*[^|]*$/i, "")
    .replace(/^(Extras by size|Extras por talla):\s*[^|]*$/i, "")
    .trim();
}

function appendSizeBreakdownToNotes(notes, sizeData) {
  const cleanNotes = stripSizeBreakdownFromNotes(notes);
  const sizeText = sizeBreakdownToText(sizeData);
  if (!sizeText) return cleanNotes;
  const label = t("sizesInExtras");
  return cleanNotes ? `${cleanNotes} | ${label}: ${sizeText}` : `${label}: ${sizeText}`;
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

function toggleInlineAddRow(pageKey, sectionRoot, sectionId) {
  const existing = sectionRoot.querySelector(".inline-row-editor");
  if (existing) {
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

    if (!po || !category) return window.alert("PO# and Category are required.");

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
  if (existing && existing !== tableRow.nextElementSibling) existing.remove();
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
    const po = editTr.querySelector('[data-field="po"]').value.trim();
    const boxes = Number(editTr.querySelector('[data-field="boxes"]').value || 0);
    const category = editTr.querySelector('[data-field="category"]').value;
    let notes = editTr.querySelector('[data-field="notes"]').value.trim();

    if (!po || !category) return window.alert("PO# and Category are required.");

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

function renderStats() {
  if (!["dock", "receiving", "prep"].includes(state.currentPage)) return;
  const visibleSections = getVisibleSections(state.currentPage);
  const visibleRows = visibleSections.flatMap((section) => getFilteredRows(state.currentPage, section));

  statSections.textContent = visibleSections.length;
  statRows.textContent = visibleRows.length;
  statBoxes.textContent = visibleRows.reduce((sum, row) => sum + Number(row.boxes || 0), 0);
  statNotes.textContent = visibleRows.filter((row) => row.notes && row.notes.trim()).length;
  totalQty.textContent = pageConfig[state.currentPage].mode === "simple"
    ? visibleRows.reduce((sum, row) => sum + Number(row.qty || 0), 0)
    : visibleRows.reduce((sum, row) => sum + Number(row.receivedQty || 0), 0);
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
  if (state.masters[type].includes(newValue)) return window.alert("That value already exists.");
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

function persistData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function persistMasters() {
  localStorage.setItem(MASTER_KEY, JSON.stringify(state.masters));
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
      dockFilters: { ...defaults.dockFilters, ...(parsed.dockFilters || {}) },
      receivingFilters: { ...defaults.receivingFilters, ...(parsed.receivingFilters || {}) },
      prepFilters: { ...defaults.prepFilters, ...(parsed.prepFilters || {}) },
      overstockFilters: { ...defaults.overstockFilters, ...(parsed.overstockFilters || {}) },
      dockSections: Array.isArray(parsed.dockSections) ? parsed.dockSections : defaults.dockSections,
      receivingSections: Array.isArray(parsed.receivingSections) ? parsed.receivingSections : defaults.receivingSections,
      prepSections: Array.isArray(parsed.prepSections) ? parsed.prepSections : defaults.prepSections,
      overstockEntries: Array.isArray(parsed.overstockEntries) ? parsed.overstockEntries : defaults.overstockEntries,
    };
  } catch {
    return getDefaultData();
  }
}

function getDefaultData() {
  return {
    dockSections: [],
    dockFilters: { person: "All", day: "", search: "", mineOnly: false },
    receivingSections: [],
    receivingFilters: { person: "All", day: "", search: "", mineOnly: false },
    prepSections: [],
    prepFilters: { person: "All", day: "", search: "", mineOnly: false },
    overstockEntries: [],
    overstockFilters: { date: "", associate: "All", location: "All", status: "All", search: "", mineOnly: false },
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
