(() => {
  const API = '/.netlify/functions/hub-auth';
  const root = document.documentElement;
  let session = { signedIn: false };
  let roster = [];
  let selected = null;

  const style = document.createElement('style');
  style.textContent = `
    .associate-btn{cursor:pointer;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .associate-btn.signed-in{color:var(--ink);border-color:#c6d8cf;background:var(--green-soft)}
    .associate-modal{border:0;border-radius:22px;padding:0;max-width:min(500px,calc(100% - 28px));width:100%;background:var(--bg);color:var(--ink);box-shadow:0 30px 90px rgba(18,61,52,.28)}
    .associate-modal::backdrop{background:rgba(16,32,28,.45);backdrop-filter:blur(3px)}
    .associate-body{padding:22px}
    .associate-intro{margin:0 0 16px;color:var(--muted);font-size:14px;line-height:1.55}
    .associate-state{border:1px solid var(--line);border-radius:16px;background:var(--paper);padding:14px;margin:12px 0 16px;display:none}
    .associate-state.show{display:block}
    .associate-state strong{display:block;margin-bottom:4px}
    .associate-state span{font-size:13px;color:var(--muted);line-height:1.45}
    .associate-form{display:grid;gap:12px}
    .associate-form label{display:grid;gap:6px;font-size:12px;font-weight:850;color:#5f6b65}
    .associate-form select,.associate-form input{width:100%;border:1px solid #cfd6d0;border-radius:11px;background:#fff;padding:12px;color:var(--ink);font-size:16px}
    .associate-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:4px}
    .associate-actions .action{flex:1;min-width:150px}
    .associate-link{border:0;background:transparent;color:var(--muted);font-weight:800;cursor:pointer;padding:10px}
    .associate-note{font-size:12px;color:var(--muted);line-height:1.5;margin-top:12px}
    .associate-error{display:none;border-radius:11px;padding:10px 12px;background:#f8e9e6;color:#8f2d22;font-size:13px;font-weight:750}
    .associate-error.show{display:block}
    .associate-success{display:none;border-radius:11px;padding:10px 12px;background:var(--green-soft);color:var(--green);font-size:13px;font-weight:800}
    .associate-success.show{display:block}
    .bingo-reward-btn{display:none;position:relative;white-space:nowrap}
    .bingo-reward-btn.show{display:inline-flex;align-items:center;gap:6px}
    .bingo-reward-count{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#9e2d25;color:#fff;font-size:10px;font-weight:950}
    .bingo-reward-modal{border:0;border-radius:22px;padding:0;max-width:min(760px,calc(100% - 28px));width:100%;background:var(--bg);color:var(--ink);box-shadow:0 30px 90px rgba(18,61,52,.28)}
    .bingo-reward-modal::backdrop{background:rgba(16,32,28,.45);backdrop-filter:blur(3px)}
    .bingo-reward-body{padding:18px;max-height:min(72vh,760px);overflow:auto}
    .bingo-reward-intro{margin:0 0 14px;color:var(--muted);font-size:13px;line-height:1.5}
    .bingo-reward-section{margin-top:16px}
    .bingo-reward-section:first-of-type{margin-top:0}
    .bingo-reward-section h4{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;font-size:13px}
    .bingo-reward-list{display:grid;gap:8px}
    .bingo-reward-card{border:1px solid var(--line);border-radius:14px;background:var(--paper);padding:12px}
    .bingo-reward-card.pending{border-color:#e4c98d;background:#fffaf0}
    .bingo-reward-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .bingo-reward-name{font-size:14px;font-weight:950}
    .bingo-reward-meta{margin-top:3px;color:var(--muted);font-size:11px;line-height:1.45}
    .bingo-reward-status{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:900;background:#edf2ef;color:#59665f}
    .bingo-reward-card.pending .bingo-reward-status{background:#fff0cb;color:#805d0d}
    .bingo-reward-actions{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}
    .bingo-reward-actions input{min-width:0;width:100%;border:1px solid #cfd6d0;border-radius:10px;background:#fff;padding:9px 10px;color:var(--ink)}
    .bingo-reward-actions button{border:1px solid var(--green);border-radius:10px;background:var(--green);color:#fff;padding:9px 12px;font-weight:900}
    .bingo-reward-history-note{margin-top:7px;padding-top:7px;border-top:1px dashed var(--line);font-size:11px;color:#4e5b55}
    .bingo-reward-empty{padding:18px;text-align:center;border:1px dashed var(--line);border-radius:13px;color:var(--muted);font-size:12px}
    .bingo-reward-message{display:none;margin-bottom:10px;border-radius:10px;padding:9px 10px;font-size:12px;font-weight:800}
    .bingo-reward-message.show{display:block;background:var(--green-soft);color:var(--green)}
    .bingo-reward-message.error{display:block;background:#f8e9e6;color:#8f2d22}
    .bingo-admin-controls{border:1px solid var(--line);border-radius:16px;background:var(--paper);padding:14px;margin-bottom:16px}
    .bingo-admin-controls h4{margin:0 0 5px;font-size:14px}
    .bingo-admin-controls p{margin:0;color:var(--muted);font-size:11px;line-height:1.45}
    .bingo-admin-control-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
    .bingo-size-buttons{display:flex;gap:7px;flex-wrap:wrap}
    .bingo-size-btn,.bingo-reset-btn{border:1px solid #cbd7d0;border-radius:10px;background:#fff;color:var(--ink);padding:9px 12px;font-weight:900;cursor:pointer}
    .bingo-size-btn.active{background:var(--ink);border-color:var(--ink);color:#fff}
    .bingo-reset-btn{border-color:#d9aaa4;color:#8f2d22;background:#fff7f5}
    .bingo-reset-btn:hover{background:#f8e9e6}
    .bingo-admin-current{font-size:11px;color:var(--muted);font-weight:800;text-align:right}
    .bingo-photo-admin{border:1px solid var(--line);border-radius:16px;background:var(--paper);padding:14px;margin-bottom:16px}
    .bingo-photo-admin-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .bingo-photo-admin h4{margin:0 0 5px;font-size:14px}
    .bingo-photo-admin p{margin:0;color:var(--muted);font-size:11px;line-height:1.45}
    .bingo-photo-count{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px;background:var(--green-soft);color:var(--green);font-size:10px;font-weight:900;white-space:nowrap}
    .bingo-photo-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
    .bingo-photo-upload{border:1px solid var(--green);border-radius:10px;background:var(--green);color:#fff;padding:9px 12px;font-weight:900;cursor:pointer}
    .bingo-photo-upload:disabled{opacity:.55;cursor:not-allowed}
    .bingo-photo-tip{font-size:10px;color:var(--muted);font-weight:750}
    .bingo-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:9px;margin-top:12px}
    .bingo-photo-card{position:relative;border:1px solid var(--line);border-radius:13px;background:#fff;overflow:hidden}
    .bingo-photo-card img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#eef2ef}
    .bingo-photo-card-footer{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:7px}
    .bingo-photo-card-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:850;color:#46534d}
    .bingo-photo-remove{border:0;border-radius:8px;background:#fff0ed;color:#922f25;width:25px;height:25px;display:grid;place-items:center;font-weight:950;cursor:pointer;flex:0 0 auto}
    .bingo-photo-empty{grid-column:1/-1;padding:16px;border:1px dashed var(--line);border-radius:12px;text-align:center;color:var(--muted);font-size:11px;line-height:1.45}
    @media(max-width:620px){.associate-btn{max-width:145px}.associate-actions{display:grid}.associate-actions .action{width:100%}.bingo-reward-btn{padding-left:9px;padding-right:9px}.bingo-reward-actions{grid-template-columns:1fr}.bingo-reward-body{padding:13px}.bingo-admin-control-row{display:grid}.bingo-admin-current{text-align:left}}
  `;
  document.head.appendChild(style);

  const topActions = document.querySelector('.top-actions');
  if (!topActions) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'toolcount associate-btn';
  btn.id = 'associateBtn';
  btn.textContent = 'Who’s using Hub?';
  topActions.insertBefore(btn, document.getElementById('manageBtn') || null);

  const rewardBtn = document.createElement('button');
  rewardBtn.type = 'button';
  rewardBtn.className = 'toolcount bingo-reward-btn';
  rewardBtn.id = 'bingoRewardBtn';
  rewardBtn.innerHTML = '🎲 Bingo Admin';
  topActions.insertBefore(rewardBtn, document.getElementById('manageBtn') || null);

  const dialog = document.createElement('dialog');
  dialog.className = 'associate-modal';
  dialog.id = 'associateDialog';
  dialog.innerHTML = `
    <div class="dialog-head"><h3 id="associateTitle">Who’s using the Hub?</h3><button class="close" id="associateClose" type="button">×</button></div>
    <div class="associate-body">
      <p class="associate-intro" id="associateIntro">Choose your name once for the shift. Associates and Team Leads can use the same Hub sign-in for personal Hub features without signing into Houston.</p>
      <div class="associate-success" id="associateSuccess"></div>
      <div class="associate-error" id="associateError"></div>
      <div class="associate-state" id="associateCurrent"></div>
      <form class="associate-form" id="associateForm">
        <label>Your name
          <select id="associateName"><option value="">Choose your name…</option></select>
        </label>
        <div id="associatePinWrap" style="display:none">
          <label id="associatePinLabel">PIN
            <input id="associatePin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="4–8 digits" />
          </label>
        </div>
        <div id="associateConfirmWrap" style="display:none">
          <label>Confirm PIN
            <input id="associateConfirm" type="password" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="Enter it again" />
          </label>
        </div>
        <div class="associate-actions" id="associateActions">
          <button class="action" id="associateSubmit" type="submit">Continue</button>
          <button class="associate-link" id="associateNotNow" type="button">Not now</button>
        </div>
      </form>
      <div class="associate-note" id="associateNote">Warehouse Hub manages associate PINs. If you do not have a Hub PIN yet, create one here; the Hub will sync it to Cleaning automatically when available.</div>
    </div>`;
  document.body.appendChild(dialog);

  const rewardDialog = document.createElement('dialog');
  rewardDialog.className = 'bingo-reward-modal';
  rewardDialog.id = 'bingoRewardDialog';
  rewardDialog.innerHTML = `
    <div class="dialog-head">
      <div><h3>Bingo Admin</h3><p class="bingo-reward-intro" style="margin:4px 0 0">Board controls + reward ledger</p></div>
      <button class="close" id="bingoRewardClose" type="button">×</button>
    </div>
    <div class="bingo-reward-body">
      <div class="bingo-reward-message" id="bingoRewardMessage"></div>
      <section class="bingo-admin-controls">
        <h4>Game controls</h4>
        <p>Choose 3×3 for a faster game or 5×5 for traditional Bingo with a center FREE square. 4×4 is intentionally skipped because it has no single center square.</p>
        <div class="bingo-admin-control-row">
          <div>
            <div class="bingo-size-buttons">
              <button class="bingo-size-btn" type="button" data-bingo-size="3">3 × 3</button>
              <button class="bingo-size-btn" type="button" data-bingo-size="5">5 × 5</button>
            </div>
          </div>
          <div class="bingo-admin-current" id="bingoAdminCurrent">Current board: 5 × 5</div>
        </div>
        <div class="bingo-admin-control-row">
          <div>
            <strong style="font-size:12px">Start a fresh round</strong>
            <p>Resets everyone’s card, draws, wins, and weekly free draw. Bingo Coins and reward history stay.</p>
          </div>
          <button class="bingo-reset-btn" id="bingoResetRound" type="button">Reset Bingo</button>
        </div>
      </section>
      <section class="bingo-photo-admin">
        <div class="bingo-photo-admin-head">
          <div>
            <h4>Bingo photos</h4>
            <p>Upload the faces you want used on fresh Bingo cards. Removing a photo stops it from appearing on future cards; existing cards keep working until the next reset.</p>
          </div>
          <span class="bingo-photo-count" id="bingoPhotoCount">0 active</span>
        </div>
        <div class="bingo-photo-actions">
          <input id="bingoPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden />
          <button class="bingo-photo-upload" id="bingoPhotoPick" type="button">＋ Upload photos</button>
          <span class="bingo-photo-tip">Photos are cropped square and compressed automatically.</span>
        </div>
        <div class="bingo-photo-grid" id="bingoPhotoGrid"></div>
      </section>
      <p class="bingo-reward-intro">Bingo wins appear below automatically. Mark a reward given only after the winner actually receives it.</p>
      <section class="bingo-reward-section">
        <h4><span>Pending rewards</span><span id="bingoPendingLabel">0 pending</span></h4>
        <div class="bingo-reward-list" id="bingoPendingList"></div>
      </section>
      <section class="bingo-reward-section">
        <h4><span>Reward history</span><span id="bingoHistoryLabel">0 given</span></h4>
        <div class="bingo-reward-list" id="bingoHistoryList"></div>
      </section>
    </div>`;
  document.body.appendChild(rewardDialog);

  const nameEl = document.getElementById('associateName');
  const pinEl = document.getElementById('associatePin');
  const confirmEl = document.getElementById('associateConfirm');
  const pinWrap = document.getElementById('associatePinWrap');
  const confirmWrap = document.getElementById('associateConfirmWrap');
  const submit = document.getElementById('associateSubmit');
  const current = document.getElementById('associateCurrent');
  const form = document.getElementById('associateForm');
  const error = document.getElementById('associateError');
  const success = document.getElementById('associateSuccess');
  const note = document.getElementById('associateNote');
  const rewardMessage = document.getElementById('bingoRewardMessage');
  const rewardPendingList = document.getElementById('bingoPendingList');
  const rewardHistoryList = document.getElementById('bingoHistoryList');
  const bingoAdminCurrent = document.getElementById('bingoAdminCurrent');
  const bingoResetRound = document.getElementById('bingoResetRound');
  const bingoPhotoInput = document.getElementById('bingoPhotoInput');
  const bingoPhotoPick = document.getElementById('bingoPhotoPick');
  const bingoPhotoGrid = document.getElementById('bingoPhotoGrid');
  const bingoPhotoCount = document.getElementById('bingoPhotoCount');
  const bingoSizeButtons = [...rewardDialog.querySelectorAll('[data-bingo-size]')];
  let rewardLedger = { pendingCount: 0, pending: [], history: [], photos: [], settings: { boardSize: 5 } };
  let rewardLoading = false;
  let bingoControlSaving = false;
  let bingoPhotoSaving = false;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const displayRole = (role) => String(role || '').toLowerCase() === 'manager' ? 'Admin' : String(role || '');
  const normalize = (v) => String(v || '').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-');

  function setError(message = '') {
    error.textContent = message;
    error.classList.toggle('show', !!message);
  }
  function setSuccess(message = '') {
    success.textContent = message;
    success.classList.toggle('show', !!message);
  }

  function isRewardAdmin() {
    const role = String(session?.role || '').toLowerCase();
    return !!session?.signedIn && (role === 'manager' || role === 'team lead');
  }

  function rewardDate(value) {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString([], { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
    } catch {
      return String(value);
    }
  }

  function setRewardMessage(message = '', error = false) {
    rewardMessage.textContent = message;
    rewardMessage.className = 'bingo-reward-message' + (message ? (error ? ' error' : ' show') : '');
  }

  function renderRewardButton() {
    const allowed = isRewardAdmin();
    rewardBtn.classList.toggle('show', allowed);
    rewardBtn.hidden = !allowed;
    if (!allowed) {
      rewardBtn.innerHTML = '🎲 Bingo Admin';
      if (rewardDialog.open) rewardDialog.close();
      return;
    }
    const count = Number(rewardLedger.pendingCount || 0);
    rewardBtn.innerHTML = count > 0
      ? `🎲 Bingo Admin <span class="bingo-reward-count">${count}</span>`
      : '🎲 Bingo Admin';
    rewardBtn.title = count > 0 ? `${count} Bingo reward${count === 1 ? '' : 's'} waiting to be given` : 'Bingo game controls and reward history';
  }

  function renderBingoControls() {
    const size = Number(rewardLedger.settings?.boardSize || 5);
    bingoPhotoPick.addEventListener('click', () => {
    if (!bingoPhotoSaving) bingoPhotoInput.click();
  });
  bingoPhotoInput.addEventListener('change', () => uploadBingoPhotos(bingoPhotoInput.files));

  bingoSizeButtons.forEach((button) => {
      const active = Number(button.dataset.bingoSize) === size;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = bingoControlSaving;
    });
    bingoResetRound.disabled = bingoControlSaving;
    const resetBy = rewardLedger.settings?.resetBy;
    const resetAt = rewardLedger.settings?.resetAt;
    bingoAdminCurrent.textContent = resetAt
      ? `Current board: ${size} × ${size} · Last reset ${rewardDate(resetAt)}${resetBy ? ' by ' + resetBy : ''}`
      : `Current board: ${size} × ${size}`;
  }

  function renderBingoPhotos() {
    const photos = Array.isArray(rewardLedger.photos) ? rewardLedger.photos : [];
    bingoPhotoCount.textContent = `${photos.length} active`;
    bingoPhotoPick.disabled = bingoPhotoSaving;
    bingoPhotoPick.textContent = bingoPhotoSaving ? 'Uploading…' : '＋ Upload photos';
    bingoPhotoGrid.innerHTML = photos.length
      ? photos.map((photo) => `
          <article class="bingo-photo-card">
            <img src="${esc(photo.url)}" alt="${esc(photo.label || 'Bingo photo')}" loading="lazy" />
            <div class="bingo-photo-card-footer">
              <span class="bingo-photo-card-name" title="${esc(photo.label || 'Bingo photo')}">${esc(photo.label || 'Bingo photo')}</span>
              <button class="bingo-photo-remove" type="button" data-bingo-photo-remove="${esc(photo.id)}" aria-label="Remove ${esc(photo.label || 'Bingo photo')}">×</button>
            </div>
          </article>`).join('')
      : '<div class="bingo-photo-empty">No custom photos yet. Bingo will keep using the current symbol cards until you upload photos and start a fresh round.</div>';

    bingoPhotoGrid.querySelectorAll('[data-bingo-photo-remove]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (bingoPhotoSaving) return;
        const photo = photos.find((item) => item.id === button.dataset.bingoPhotoRemove);
        if (!photo) return;
        if (!confirm(`Remove "${photo.label || 'this photo'}" from future Bingo cards? Existing cards will keep working.`)) return;
        bingoPhotoSaving = true;
        renderBingoPhotos();
        try {
          const body = await postBingoAdmin('removePhoto', { photoId: photo.id });
          rewardLedger.photos = Array.isArray(body.photos) ? body.photos : rewardLedger.photos.filter((item) => item.id !== photo.id);
          setRewardMessage(body.message || 'Photo removed from future Bingo cards.');
        } catch (error) {
          setRewardMessage(error.message || 'Could not remove the Bingo photo.', true);
        } finally {
          bingoPhotoSaving = false;
          renderBingoPhotos();
        }
      });
    });
  }

  function fileAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read that photo.'));
      reader.readAsDataURL(blob);
    });
  }

  async function prepareBingoPhoto(file) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file?.type || '')) throw new Error('Choose a JPG, PNG, or WebP image.');
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const node = new Image();
        node.onload = () => resolve(node);
        node.onerror = () => reject(new Error(`${file.name || 'Photo'} could not be opened.`));
        node.src = objectUrl;
      });
      const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
      if (!side) throw new Error(`${file.name || 'Photo'} has no usable image data.`);
      const sx = Math.max(0, ((img.naturalWidth || img.width) - side) / 2);
      const sy = Math.max(0, ((img.naturalHeight || img.height) - side) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 640;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f4f6f4';
      ctx.fillRect(0, 0, 640, 640);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 640, 640);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .84));
      if (!blob) throw new Error(`${file.name || 'Photo'} could not be processed.`);
      if (blob.size > 650000) throw new Error(`${file.name || 'Photo'} is still too large after processing.`);
      return {
        label: String(file.name || 'Bingo photo').replace(/\.[^.]+$/, '').slice(0, 100) || 'Bingo photo',
        dataUrl: await fileAsDataUrl(blob),
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadBingoPhotos(fileList) {
    const files = [...(fileList || [])];
    if (!files.length || bingoPhotoSaving) return;
    bingoPhotoSaving = true;
    renderBingoPhotos();
    let uploaded = 0;
    try {
      for (const file of files) {
        setRewardMessage(`Preparing ${file.name || 'photo'}…`);
        const photo = await prepareBingoPhoto(file);
        const body = await postBingoAdmin('addPhoto', photo);
        if (Array.isArray(body.photos)) rewardLedger.photos = body.photos;
        uploaded += 1;
        renderBingoPhotos();
      }
      setRewardMessage(`${uploaded} photo${uploaded === 1 ? '' : 's'} added. Start a fresh Bingo round whenever you want everyone to get cards from the updated photo pool.`);
    } catch (error) {
      setRewardMessage(error.message || 'Could not upload the Bingo photos.', true);
    } finally {
      bingoPhotoSaving = false;
      bingoPhotoInput.value = '';
      renderBingoPhotos();
    }
  }

  async function postBingoAdmin(action, payload = {}) {
    const response = await fetch('/api/bingo-rewards', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Could not update Bingo.');
    return body;
  }

  function rewardCard(row, pending = false) {
    if (pending) {
      return `<article class="bingo-reward-card pending" data-reward-row="${esc(row.roundKey)}|${esc(row.employeeKey)}">
        <div class="bingo-reward-top">
          <div><div class="bingo-reward-name">${esc(row.employeeName)}</div><div class="bingo-reward-meta">Won ${esc(rewardDate(row.wonAt))} · Round ${esc(row.roundKey)}</div></div>
          <span class="bingo-reward-status">Reward pending</span>
        </div>
        <div class="bingo-reward-actions">
          <input type="text" maxlength="500" data-reward-note placeholder="Reward / note (optional)" aria-label="Reward note for ${esc(row.employeeName)}" />
          <button type="button" data-reward-given data-round="${esc(row.roundKey)}" data-employee="${esc(row.employeeKey)}">Mark Reward Given</button>
        </div>
      </article>`;
    }
    return `<article class="bingo-reward-card">
      <div class="bingo-reward-top">
        <div><div class="bingo-reward-name">${esc(row.employeeName)}</div><div class="bingo-reward-meta">Won ${esc(rewardDate(row.wonAt))} · Reward given ${esc(rewardDate(row.rewardedAt))}</div><div class="bingo-reward-meta">Given by ${esc(row.rewardedBy || 'Unknown')}${row.rewardedByRole ? ' · ' + esc(displayRole(row.rewardedByRole)) : ''} · Round ${esc(row.roundKey)}</div></div>
        <span class="bingo-reward-status">✓ Given</span>
      </div>
      ${row.rewardNote ? `<div class="bingo-reward-history-note">${esc(row.rewardNote)}</div>` : ''}
    </article>`;
  }

  function renderRewardLedger() {
    const pending = Array.isArray(rewardLedger.pending) ? rewardLedger.pending : [];
    const history = Array.isArray(rewardLedger.history) ? rewardLedger.history : [];
    document.getElementById('bingoPendingLabel').textContent = `${pending.length} pending`;
    document.getElementById('bingoHistoryLabel').textContent = `${history.length} given`;
    rewardPendingList.innerHTML = pending.length
      ? pending.map((row) => rewardCard(row, true)).join('')
      : '<div class="bingo-reward-empty">No Bingo rewards are waiting to be given.</div>';
    rewardHistoryList.innerHTML = history.length
      ? history.map((row) => rewardCard(row, false)).join('')
      : '<div class="bingo-reward-empty">No rewards have been marked given yet.</div>';
    renderBingoControls();
    renderBingoPhotos();
    rewardPendingList.querySelectorAll('[data-reward-given]').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('[data-reward-row]');
        const note = card?.querySelector('[data-reward-note]')?.value?.trim() || '';
        const winner = pending.find((row) => row.roundKey === button.dataset.round && row.employeeKey === button.dataset.employee);
        if (!winner) return;
        if (!confirm(`Confirm that ${winner.employeeName} has received their Bingo reward?`)) return;
        button.disabled = true;
        button.textContent = 'Saving…';
        try {
          const response = await fetch('/api/bingo-rewards', {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'markGiven',
              roundKey: winner.roundKey,
              employeeKey: winner.employeeKey,
              rewardNote: note,
            }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error || 'Could not save the reward.');
          setRewardMessage(body.message || 'Reward marked given.');
          await loadRewardLedger(false);
        } catch (error) {
          setRewardMessage(error.message || 'Could not save the reward.', true);
          button.disabled = false;
          button.textContent = 'Mark Reward Given';
        }
      });
    });
    renderRewardButton();
  }

  async function loadRewardLedger(showLoading = false) {
    if (!isRewardAdmin() || rewardLoading) return;
    rewardLoading = true;
    if (showLoading) {
      rewardPendingList.innerHTML = '<div class="bingo-reward-empty">Loading rewards…</div>';
      rewardHistoryList.innerHTML = '';
    }
    try {
      const response = await fetch('/api/bingo-rewards', { cache:'no-store', credentials:'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Bingo rewards are unavailable.');
      rewardLedger = body;
      renderRewardLedger();
    } catch (error) {
      if (showLoading) setRewardMessage(error.message || 'Bingo rewards are unavailable.', true);
    } finally {
      rewardLoading = false;
    }
  }

  function updateButton() {
    if (session.signedIn) {
      btn.textContent = `${session.name}${String(session.role || '').toLowerCase() === 'manager' ? ' · Admin' : (session.department ? ' · ' + session.department : '')}`;
      btn.classList.add('signed-in');
      btn.title = 'Associate signed in for this shift';
    } else {
      btn.textContent = 'Who’s using Hub?';
      btn.classList.remove('signed-in');
      btn.title = 'Sign in once for this shift';
    }
    renderRewardButton();
    if (isRewardAdmin()) loadRewardLedger(false);
  }

  function resetForm() {
    setError('');
    setSuccess('');
    selected = null;
    nameEl.value = '';
    pinEl.value = '';
    confirmEl.value = '';
    pinWrap.style.display = 'none';
    confirmWrap.style.display = 'none';
    submit.textContent = 'Continue';
    submit.disabled = false;
    note.textContent = 'Warehouse Hub manages associate PINs. If you do not have a Hub PIN yet, create one here; the Hub will sync it to Cleaning automatically when available.';
  }

  function showSignedInState() {
    current.classList.add('show');
    current.innerHTML = `<strong>Signed in as ${esc(session.name)}${session.role ? ' · ' + esc(displayRole(session.role)) : ''}</strong><span>${esc(session.department || 'Warehouse team')} · Your Hub session stays active for this shift.</span>`;
    form.style.display = 'none';
    const existing = current.querySelector('[data-signout]');
    if (!existing) {
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'action secondary';
      out.dataset.signout = '1';
      out.style.marginTop = '12px';
      out.textContent = 'Change associate / Sign out';
      out.addEventListener('click', logout);
      current.appendChild(out);
    }
  }

  function showSignInState(prefillName = '') {
    current.classList.remove('show');
    current.innerHTML = '';
    form.style.display = 'grid';
    resetForm();
    if (prefillName) {
      const match = roster.find((person) => normalize(person.name) === normalize(prefillName));
      if (match) {
        nameEl.value = match.name;
        nameEl.dispatchEvent(new Event('change'));
      }
    }
  }

  function openDialog(prefillName = '') {
    if (session.signedIn && !prefillName) showSignedInState();
    else showSignInState(prefillName);
    if (!dialog.open) dialog.showModal();
  }

  async function api(path = '', options = {}) {
    const response = await fetch(`${API}${path}`, { cache: 'no-store', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Hub sign-in is unavailable.');
      error.needsSetup = body.needsSetup === true;
      throw error;
    }
    return body;
  }

  async function loadRoster(force = false) {
    const data = await api(`?action=roster${force ? '&refresh=1' : ''}`);
    roster = Array.isArray(data.employees) ? data.employees : [];
    nameEl.innerHTML = `<option value="">Choose your name…</option>${roster.map((person) => `<option value="${esc(person.name)}">${esc(person.name)}</option>`).join('')}`;
    if (data.selfServiceConnected === false) {
      note.textContent = 'Create and manage associate PINs in Warehouse Hub. Cleaning will use the same PIN after its sync connection is available.';
    }
  }

  async function loadSession() {
    try {
      session = await api('?action=session');
    } catch {
      session = { signedIn: false };
    }
    updateButton();
  }

  nameEl.addEventListener('change', () => {
    setError('');
    setSuccess('');
    selected = roster.find((person) => person.name === nameEl.value) || null;
    if (!selected) {
      pinWrap.style.display = 'none';
      confirmWrap.style.display = 'none';
      submit.textContent = 'Continue';
      return;
    }
    pinWrap.style.display = 'block';
    setPinMode(false);
    setTimeout(() => pinEl.focus(), 30);
  });

  // PIN status isn't in the public roster, so the form starts in sign-in mode
  // and switches to setup when the server says this person has no PIN yet.
  let setupMode = false;
  function setPinMode(setup) {
    setupMode = setup;
    if (!setup) {
      document.getElementById('associatePinLabel').firstChild.nodeValue = 'PIN';
      confirmWrap.style.display = 'none';
      submit.textContent = 'Sign in for this shift';
      note.textContent = 'Enter your PIN once. You should not need to enter it again for cleaning during this Hub session. First time here? Enter the PIN you want to use.';
    } else {
      document.getElementById('associatePinLabel').firstChild.nodeValue = 'Create a PIN';
      confirmWrap.style.display = 'block';
      submit.textContent = 'Create PIN & sign in';
      note.textContent = 'Create a private 4–8 digit Warehouse Hub PIN. This PIN is managed from the Hub and is used for Hub sign-in.';
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!selected) return setError('Choose your name first.');
    const pin = pinEl.value.trim();
    if (!/^\d{4,8}$/.test(pin)) return setError('Enter a 4–8 digit PIN.');
    const action = setupMode ? 'setup' : 'login';
    if (action === 'setup' && pin !== confirmEl.value.trim()) return setError('The two PINs do not match.');
    submit.disabled = true;
    submit.textContent = action === 'setup' ? 'Saving PIN…' : 'Signing in…';
    try {
      const data = await api('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, employeeName: selected.name, pin, confirmPin: confirmEl.value.trim() }),
      });
      session = data;
      updateButton();
      sessionStorage.removeItem('hubAssociatePromptDismissed');
      setSuccess(data.warning || (action === 'setup' ? 'PIN saved. You’re signed in for this shift.' : 'You’re signed in for this shift.'));
      setTimeout(() => dialog.close(), data.warning ? 1800 : 650);
      document.dispatchEvent(new CustomEvent('hub-associate-session', { detail: session }));
    } catch (err) {
      submit.disabled = false;
      if (err.needsSetup) {
        setPinMode(true);
        setSuccess('Welcome! You don’t have a PIN yet. Enter the same PIN again to create it.');
        confirmEl.value = '';
        setTimeout(() => confirmEl.focus(), 30);
        return;
      }
      setError(err.message || 'Could not sign in.');
      submit.textContent = action === 'setup' ? 'Create PIN & sign in' : 'Sign in for this shift';
    }
  });

  async function logout() {
    try { await window.HubPush?.disableForSignout?.(); } catch {}
    try {
      await api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) });
    } catch {}
    session = { signedIn: false };
    updateButton();
    showSignInState();
    document.dispatchEvent(new CustomEvent('hub-associate-session', { detail: session }));
  }

  btn.addEventListener('click', () => openDialog());

  bingoSizeButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      if (bingoControlSaving) return;
      const size = Number(button.dataset.bingoSize);
      const currentSize = Number(rewardLedger.settings?.boardSize || 5);
      if (size === currentSize) return;
      if (!confirm(`Switch Warehouse Bingo to ${size}×${size}? Active cards will resize. Bingo Coins and reward history will stay.`)) return;
      bingoControlSaving = true;
      renderBingoControls();
      try {
        const body = await postBingoAdmin('setBoardSize', { boardSize: size });
        rewardLedger.settings = body.settings || { ...rewardLedger.settings, boardSize: size };
        setRewardMessage(body.message || `Bingo changed to ${size}×${size}.`);
        document.dispatchEvent(new CustomEvent('hub-bingo-refresh'));
        await loadRewardLedger(false);
      } catch (error) {
        setRewardMessage(error.message || 'Could not change the Bingo board size.', true);
      } finally {
        bingoControlSaving = false;
        renderBingoControls();
      }
    });
  });

  bingoResetRound.addEventListener('click', async () => {
    if (bingoControlSaving) return;
    if (!confirm('Reset Warehouse Bingo for everyone now? Everyone gets a fresh card and a new 28-day round. Bingo Coins and reward history will NOT be deleted.')) return;
    bingoControlSaving = true;
    bingoResetRound.textContent = 'Resetting…';
    renderBingoControls();
    try {
      const body = await postBingoAdmin('resetRound');
      rewardLedger.settings = body.settings || rewardLedger.settings;
      setRewardMessage(body.message || 'Bingo reset complete.');
      document.dispatchEvent(new CustomEvent('hub-bingo-refresh'));
      await loadRewardLedger(false);
    } catch (error) {
      setRewardMessage(error.message || 'Could not reset Bingo.', true);
    } finally {
      bingoControlSaving = false;
      bingoResetRound.textContent = 'Reset Bingo';
      renderBingoControls();
    }
  });

  rewardBtn.addEventListener('click', async () => {
    setRewardMessage('');
    if (!isRewardAdmin()) return;
    if (!rewardDialog.open) rewardDialog.showModal();
    await loadRewardLedger(true);
  });
  document.getElementById('bingoRewardClose').addEventListener('click', () => rewardDialog.close());
  document.getElementById('associateClose').addEventListener('click', () => dialog.close());
  document.getElementById('associateNotNow').addEventListener('click', () => {
    sessionStorage.setItem('hubAssociatePromptDismissed', '1');
    dialog.close();
  });

  window.HubAssociate = {
    getSession: () => ({ ...session }),
    open: (name = '') => openDialog(name),
    refresh: async () => { await loadSession(); return { ...session }; },
    refreshRoster: async () => { await loadRoster(true); return roster.map((person) => ({ ...person })); },
  };

  Promise.allSettled([loadRoster(), loadSession()]).then(() => {
    if (!session.signedIn && !sessionStorage.getItem('hubAssociatePromptDismissed') && roster.length) {
      setTimeout(() => openDialog(), 450);
    }
  });

  setInterval(() => {
    if (!document.hidden && isRewardAdmin()) loadRewardLedger(false);
  }, 30000);
})();
