// =============================
// POLICY MODULE
// =============================
const POLICY_STORAGE_KEY = "ops_hub_policy_entries_v1";
const POLICY_DOC_STORAGE_KEY = "ops_hub_policy_docs_v1";

let policyEntries = loadPolicyEntries();
let policyDocs = loadPolicyDocs();
let policyEditingId = null;
let policyPreviewState = { type: "", id: "" };

function uid(prefix="id"){
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}
function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatPolicyDate(value){
  if(!value) return "—";
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
function loadPolicyEntries(){
  try{
    const raw = localStorage.getItem(POLICY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}
function savePolicyEntries(){
  localStorage.setItem(POLICY_STORAGE_KEY, JSON.stringify(policyEntries));
}
function loadPolicyDocs(){
  try{
    const raw = localStorage.getItem(POLICY_DOC_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}
function savePolicyDocs(){
  localStorage.setItem(POLICY_DOC_STORAGE_KEY, JSON.stringify(policyDocs));
}
function getPolicyEls(){
  return {
    title: document.getElementById("policyTitleInput"),
    category: document.getElementById("policyCategoryInput"),
    owner: document.getElementById("policyOwnerInput"),
    status: document.getElementById("policyStatusSelect"),
    effective: document.getElementById("policyEffectiveDateInput"),
    review: document.getElementById("policyReviewDateInput"),
    summary: document.getElementById("policySummaryInput"),
    body: document.getElementById("policyBodyInput"),
    save: document.getElementById("policySaveBtn"),
    reset: document.getElementById("policyFormResetBtn"),
    search: document.getElementById("policySearchInput"),
    categoryFilter: document.getElementById("policyCategoryFilter"),
    statusFilter: document.getElementById("policyStatusFilter"),
    list: document.getElementById("policyList"),
    preview: document.getElementById("policyPreview"),
    docsList: document.getElementById("policyDocsList"),
    fileInput: document.getElementById("policyFileInput"),
    editingPill: document.getElementById("policyEditingPill"),
    docCount: document.getElementById("policyDocCountPill"),
    ruleCount: document.getElementById("policyRuleCountPill"),
  };
}
function resetPolicyForm(){
  const els = getPolicyEls();
  if(!els.title) return;
  policyEditingId = null;
  els.title.value = "";
  els.category.value = "";
  els.owner.value = "";
  els.status.value = "Active";
  els.effective.value = "";
  els.review.value = "";
  els.summary.value = "";
  els.body.value = "";
  if(els.editingPill) els.editingPill.textContent = "Creating new policy";
}
function editPolicyEntry(id){
  const entry = policyEntries.find(item => item.id === id);
  const els = getPolicyEls();
  if(!entry || !els.title) return;
  policyEditingId = id;
  els.title.value = entry.title || "";
  els.category.value = entry.category || "";
  els.owner.value = entry.owner || "";
  els.status.value = entry.status || "Active";
  els.effective.value = entry.effectiveDate || "";
  els.review.value = entry.reviewDate || "";
  els.summary.value = entry.summary || "";
  els.body.value = entry.body || "";
  if(els.editingPill) els.editingPill.textContent = `Editing: ${entry.title || "Policy"}`;
  if(window.goToPage) window.goToPage("policyPage");
}
function upsertPolicyEntry(){
  const els = getPolicyEls();
  if(!els.title) return;
  const title = els.title.value.trim();
  if(!title){
    alert("Please give the policy a title.");
    els.title.focus();
    return;
  }
  const entry = {
    id: policyEditingId || uid("policy"),
    title,
    category: els.category.value.trim(),
    owner: els.owner.value.trim(),
    status: els.status.value,
    effectiveDate: els.effective.value,
    reviewDate: els.review.value,
    summary: els.summary.value.trim(),
    body: els.body.value.trim(),
    updatedAt: new Date().toISOString(),
    createdAt: policyEditingId ? (policyEntries.find(item => item.id === policyEditingId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
  };
  const idx = policyEntries.findIndex(item => item.id === entry.id);
  if(idx >= 0) policyEntries[idx] = entry;
  else policyEntries.unshift(entry);
  savePolicyEntries();
  policyPreviewState = { type: "policy", id: entry.id };
  resetPolicyForm();
  renderPolicyModule();
}
function deletePolicyEntry(id){
  const entry = policyEntries.find(item => item.id === id);
  if(!entry) return;
  if(!confirm(`Delete policy "${entry.title}"?`)) return;
  policyEntries = policyEntries.filter(item => item.id !== id);
  savePolicyEntries();
  if(policyPreviewState.type === "policy" && policyPreviewState.id === id){
    policyPreviewState = { type: "", id: "" };
  }
  if(policyEditingId === id) resetPolicyForm();
  renderPolicyModule();
}
function renderPolicyFilters(){
  const els = getPolicyEls();
  if(!els.categoryFilter) return;
  const current = els.categoryFilter.value;
  const categories = [...new Set(policyEntries.map(item => (item.category || "").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  els.categoryFilter.innerHTML = '<option value="">All categories</option>' + categories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join("");
  els.categoryFilter.value = categories.includes(current) ? current : "";
}
function getFilteredPolicies(){
  const els = getPolicyEls();
  const q = (els.search?.value || "").trim().toLowerCase();
  const cat = els.categoryFilter?.value || "";
  const status = els.statusFilter?.value || "";
  return policyEntries.filter(item => {
    if(cat && item.category !== cat) return false;
    if(status && item.status !== status) return false;
    if(!q) return true;
    const blob = [item.title,item.category,item.owner,item.summary,item.body].join(" ").toLowerCase();
    return blob.includes(q);
  }).sort((a,b)=> new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}
function renderPolicyList(){
  const els = getPolicyEls();
  if(!els.list) return;
  const rows = getFilteredPolicies();
  els.ruleCount.textContent = `${policyEntries.length} policies`;
  if(!rows.length){
    els.list.innerHTML = '<div class="policy-empty">No policies match the current filters.</div>';
    return;
  }
  els.list.innerHTML = rows.map(item => {
    const isActive = policyPreviewState.type === "policy" && policyPreviewState.id === item.id;
    return `
      <div class="policy-card ${isActive ? 'active' : ''}" data-policy-card="${item.id}">
        <div class="policy-card-top">
          <div>
            <div class="policy-card-title">${escapeHtml(item.title)}</div>
            <div class="policy-card-meta">
              <span class="pill">${escapeHtml(item.category || "Uncategorized")}</span>
              <span class="pill">${escapeHtml(item.status || "Active")}</span>
              <span class="pill">Owner: ${escapeHtml(item.owner || "—")}</span>
            </div>
          </div>
          <div class="policy-actions">
            <button class="btn secondary policy-mini-btn" type="button" data-policy-preview="${item.id}">View</button>
            <button class="btn secondary policy-mini-btn" type="button" data-policy-edit="${item.id}">Edit</button>
            <button class="btn danger policy-mini-btn" type="button" data-policy-delete="${item.id}">Delete</button>
          </div>
        </div>
        <div class="policy-card-summary">${escapeHtml(item.summary || "No summary added yet.")}</div>
        <div class="policy-card-foot">
          <span>Effective: ${escapeHtml(formatPolicyDate(item.effectiveDate))}</span>
          <span>Review: ${escapeHtml(formatPolicyDate(item.reviewDate))}</span>
          <span>Updated: ${escapeHtml(new Date(item.updatedAt).toLocaleString())}</span>
        </div>
      </div>
    `;
  }).join("");
}
function renderPolicyPreview(){
  const els = getPolicyEls();
  if(!els.preview) return;
  if(policyPreviewState.type === "policy"){
    const item = policyEntries.find(entry => entry.id === policyPreviewState.id);
    if(item){
      els.preview.classList.remove("empty");
      els.preview.innerHTML = `
        <div class="policy-preview-title">${escapeHtml(item.title)}</div>
        <div class="policy-preview-meta">
          <span class="pill">${escapeHtml(item.category || "Uncategorized")}</span>
          <span class="pill">${escapeHtml(item.status || "Active")}</span>
          <span class="pill">Owner: ${escapeHtml(item.owner || "—")}</span>
          <span class="pill">Effective: ${escapeHtml(formatPolicyDate(item.effectiveDate))}</span>
          <span class="pill">Review: ${escapeHtml(formatPolicyDate(item.reviewDate))}</span>
        </div>
        <div class="policy-preview-section">
          <div class="eyebrow">Summary</div>
          <div>${escapeHtml(item.summary || "No summary added.")}</div>
        </div>
        <div class="policy-preview-section">
          <div class="eyebrow">Policy</div>
          <pre class="policy-preview-pre">${escapeHtml(item.body || "No details added.")}</pre>
        </div>
      `;
      return;
    }
  }
  if(policyPreviewState.type === "doc"){
    const doc = policyDocs.find(entry => entry.id === policyPreviewState.id);
    if(doc){
      els.preview.classList.remove("empty");
      els.preview.innerHTML = `
        <div class="policy-preview-title">${escapeHtml(doc.name)}</div>
        <div class="policy-preview-meta">
          <span class="pill">${escapeHtml(doc.type || "Unknown type")}</span>
          <span class="pill">${escapeHtml(doc.sizeLabel || "—")}</span>
          <span class="pill">Imported: ${escapeHtml(new Date(doc.importedAt).toLocaleString())}</span>
        </div>
        <div class="policy-preview-section">
          <div class="eyebrow">Preview</div>
          ${doc.textContent
            ? `<pre class="policy-preview-pre">${escapeHtml(doc.textContent)}</pre>`
            : `<div>This file was saved for reference, but it does not have a built-in text preview in the browser. Keep it here as a library record or re-import a text-based version if you want searchable contents.</div>`}
        </div>
      `;
      return;
    }
  }
  els.preview.classList.add("empty");
  els.preview.textContent = "Select a policy or SOP file to preview it here.";
}
function renderPolicyDocs(){
  const els = getPolicyEls();
  if(!els.docsList) return;
  els.docCount.textContent = `${policyDocs.length} SOP files`;
  if(!policyDocs.length){
    els.docsList.innerHTML = '<div class="policy-empty">No SOP files imported yet.</div>';
    return;
  }
  els.docsList.innerHTML = policyDocs
    .sort((a,b)=> new Date(b.importedAt) - new Date(a.importedAt))
    .map(doc => {
      const isActive = policyPreviewState.type === "doc" && policyPreviewState.id === doc.id;
      return `
        <div class="policy-doc-row ${isActive ? 'active' : ''}">
          <div>
            <div class="policy-doc-title">${escapeHtml(doc.name)}</div>
            <div class="policy-doc-meta">${escapeHtml(doc.type || "Unknown")} · ${escapeHtml(doc.sizeLabel || "—")} · Imported ${escapeHtml(new Date(doc.importedAt).toLocaleString())}</div>
          </div>
          <div class="policy-actions">
            <button class="btn secondary policy-mini-btn" type="button" data-doc-preview="${doc.id}">Preview</button>
            <button class="btn danger policy-mini-btn" type="button" data-doc-delete="${doc.id}">Remove</button>
          </div>
        </div>
      `;
    }).join("");
}
function renderPolicyModule(){
  if(!document.getElementById("policyPage")) return;
  renderPolicyFilters();
  renderPolicyList();
  renderPolicyDocs();
  renderPolicyPreview();
}
function formatBytes(bytes){
  if(!bytes && bytes !== 0) return "—";
  if(bytes < 1024) return `${bytes} B`;
  if(bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/(1024*1024)).toFixed(2)} MB`;
}
function importPolicyFiles(fileList){
  const files = Array.from(fileList || []);
  if(!files.length) return;
  Promise.all(files.map(file => new Promise(resolve => {
    const base = {
      id: uid("doc"),
      name: file.name,
      type: file.type || "Unknown",
      size: file.size,
      sizeLabel: formatBytes(file.size),
      importedAt: new Date().toISOString(),
      textContent: "",
    };
    const isTextLike = /text|json|csv|markdown|md|rtf/i.test(file.type) || /\.(txt|md|csv|json|rtf)$/i.test(file.name);
    if(!isTextLike){
      resolve(base);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ ...base, textContent: String(reader.result || "").slice(0, 200000) });
    reader.onerror = () => resolve(base);
    reader.readAsText(file);
  }))).then(imported => {
    policyDocs = [...imported, ...policyDocs];
    savePolicyDocs();
    if(imported[0]) policyPreviewState = { type: "doc", id: imported[0].id };
    renderPolicyModule();
    const els = getPolicyEls();
    if(els.fileInput) els.fileInput.value = "";
  });
}
function deletePolicyDoc(id){
  const doc = policyDocs.find(item => item.id === id);
  if(!doc) return;
  if(!confirm(`Remove SOP file "${doc.name}"?`)) return;
  policyDocs = policyDocs.filter(item => item.id !== id);
  savePolicyDocs();
  if(policyPreviewState.type === "doc" && policyPreviewState.id === id){
    policyPreviewState = { type: "", id: "" };
  }
  renderPolicyModule();
}
function bindPolicyModule(){
  const els = getPolicyEls();
  if(!els.title) return;
  if(!window.__policyModuleBound){
    els.save?.addEventListener("click", upsertPolicyEntry);
    els.reset?.addEventListener("click", resetPolicyForm);
    els.search?.addEventListener("input", renderPolicyModule);
    els.categoryFilter?.addEventListener("change", renderPolicyModule);
    els.statusFilter?.addEventListener("change", renderPolicyModule);
    els.fileInput?.addEventListener("change", event => importPolicyFiles(event.target.files));
    document.addEventListener("click", event => {
      const previewBtn = event.target.closest("[data-policy-preview]");
      if(previewBtn){
        policyPreviewState = { type: "policy", id: previewBtn.getAttribute("data-policy-preview") };
        renderPolicyModule();
        return;
      }
      const editBtn = event.target.closest("[data-policy-edit]");
      if(editBtn){
        editPolicyEntry(editBtn.getAttribute("data-policy-edit"));
        return;
      }
      const deleteBtn = event.target.closest("[data-policy-delete]");
      if(deleteBtn){
        deletePolicyEntry(deleteBtn.getAttribute("data-policy-delete"));
        return;
      }
      const docPreviewBtn = event.target.closest("[data-doc-preview]");
      if(docPreviewBtn){
        policyPreviewState = { type: "doc", id: docPreviewBtn.getAttribute("data-doc-preview") };
        renderPolicyModule();
        return;
      }
      const docDeleteBtn = event.target.closest("[data-doc-delete]");
      if(docDeleteBtn){
        deletePolicyDoc(docDeleteBtn.getAttribute("data-doc-delete"));
      }
    });
    window.__policyModuleBound = true;
  }
  renderPolicyModule();
}


setTimeout(() => {
  try { bindPolicyModule(); } catch (error) { console.warn("Policy module init skipped", error); }
}, 0);
