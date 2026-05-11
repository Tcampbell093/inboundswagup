// Shared pure helpers: escaping + Pack Builder link rendering.
// Loaded after state.js, before queue.js — used by every classic script.

function escapeHtml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,'&quot;').replace(/'/g,'&#039;')}
function escapeJs(v){return String(v??"").replace(/\\/g,'\\\\').replace(/'/g,"\\'")}

function buildSalesforcePbLink(pbId,pdfUrl){
  if(pdfUrl && pdfUrl!=='-') return pdfUrl;
  if(!pbId) return '';
  // Salesforce IDs come in 15- and 18-character forms. The Visualforce
  // SwagUpPackBuilderPage accepts either, but we trim defensively in case
  // imports include a trailing whitespace character.
  const id = String(pbId).trim();
  if(!id) return '';
  return `https://swagup--c.vf.force.com/apex/SwagUpPackBuilderPage?Id=${encodeURIComponent(id)}`;
}

// Render a Pack Builder name as a clickable link to Salesforce when a pbId
// (or pdfUrl) is available. Falls back to escaped plain text otherwise.
function renderPbLink(name, pbId, pdfUrl, opts){
  const safeName = escapeHtml(name == null || name === '' ? '—' : String(name));
  const url = buildSalesforcePbLink(pbId, pdfUrl);
  if(!url) return safeName;
  const o = opts || {};
  const cls = o.cls || 'pb-link';
  const escUrl = escapeHtml(url);
  return `<a class="${cls}" href="${escUrl}" target="_blank" rel="noopener noreferrer" title="Open Pack Builder in Salesforce">${safeName}</a>`;
}
