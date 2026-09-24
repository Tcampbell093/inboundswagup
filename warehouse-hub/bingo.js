(() => {
  const API = '/.netlify/functions/hub-bingo';
  const panel = document.getElementById('bingoView');
  const root = document.getElementById('bingoApp');
  if (!panel || !root) return;

  const symbolNames = {
    '⭐':'Star','🎵':'Music','☕':'Coffee','🚗':'Car','🌴':'Palm tree','🌮':'Taco','🍕':'Pizza','🎬':'Movie',
    '🍩':'Donut','⚽':'Soccer ball','🎧':'Headphones','🌞':'Sun','🍓':'Strawberry','🎈':'Balloon','🥤':'Drink','🎲':'Dice',
    'FREE':'Free square',
  };

  let loading = false;
  let state = null;
  let message = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[char]));

  function session() {
    return window.HubAssociate?.getSession?.() || { signedIn: false };
  }

  function fmtDate(value) {
    const [y,m,d] = String(value || '').split('-').map(Number);
    if (!y || !m || !d) return value || '';
    return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderSignedOut() {
    state = null;
    root.innerHTML = `
      <div class="bingo-empty-card">
        <div class="bingo-empty-icon">◇</div>
        <div>
          <div class="bingo-kicker">Warehouse Bingo</div>
          <h3>Sign in once, then your card is ready.</h3>
          <p>Your Bingo card, coins, and draws are tied to the same associate sign-in already used by the Hub.</p>
        </div>
        <button class="action" id="bingoSignIn" type="button">Sign in to play</button>
      </div>`;
    document.getElementById('bingoSignIn')?.addEventListener('click', () => window.HubAssociate?.open?.());
  }

  function squareHtml(symbol, index, marked) {
    const isFree = symbol === 'FREE';
    const isMarked = marked.includes(index);
    const label = symbolNames[symbol] || 'Bingo symbol';
    return `
      <div class="bingo-square${isMarked ? ' marked' : ''}${isFree ? ' free' : ''}" aria-label="${esc(label)}${isMarked ? ', marked' : ', not marked'}">
        <div class="bingo-symbol">${isFree ? '🆓' : esc(symbol)}</div>
        <div class="bingo-square-label">${isFree ? 'FREE' : (isMarked ? 'FOUND' : 'NEEDED')}</div>
      </div>`;
  }

  function drawMessage(result) {
    if (!result) return message;
    if (result.bingo) return `🎉 BINGO! ${result.symbol} completed a line.`;
    if (result.matched) return `🎯 ${result.symbol} was on your card — square marked.`;
    return `${result.symbol} wasn't on your card. Keep it moving — that symbol won't repeat this round.`;
  }

  function render() {
    if (!state?.player) return renderSignedOut();
    const p = state.player;
    const marked = Array.isArray(p.marked) ? p.marked.map(Number) : [4];
    const found = marked.length;
    const drawReady = p.weeklyFreeAvailable || Number(p.coins || 0) > 0;
    const drawLabel = p.weeklyFreeAvailable ? '🎁 Free weekly draw' : '🎲 Draw symbol · 1 coin';
    const statusText = p.bingo
      ? 'BINGO complete!'
      : `${found} of 9 squares found`;
    const activeMessage = drawMessage(state.drawResult);

    root.innerHTML = `
      <div class="bingo-layout">
        <section class="bingo-card-shell">
          <div class="bingo-card-head">
            <div>
              <div class="bingo-kicker">Your card</div>
              <h3>${esc(p.name)}${p.department ? ` · ${esc(p.department)}` : ''}</h3>
            </div>
            <div class="bingo-balance">
              <strong>${Number(p.coins || 0)} 🪙</strong>
              <span>Bingo Coins</span>
            </div>
          </div>

          <div class="bingo-grid" aria-label="Warehouse Bingo card">
            ${(Array.isArray(p.card) ? p.card : []).map((symbol, index) => squareHtml(symbol, index, marked)).join('')}
          </div>

          <div class="bingo-card-footer">
            <div>
              <strong>${esc(statusText)}</strong>
              <span>${p.bingo ? 'Nice work — your board is locked until the next round.' : 'Complete a row, column, or diagonal.'}</span>
            </div>
            <button class="action bingo-draw-btn" id="bingoDraw" type="button" ${(!drawReady || p.bingo || loading) ? 'disabled' : ''}>${loading ? 'Drawing…' : esc(drawLabel)}</button>
          </div>

          ${activeMessage ? `<div class="bingo-result${state.drawResult?.bingo ? ' win' : ''}" role="status">${esc(activeMessage)}</div>` : ''}
          ${(!p.bingo && !drawReady) ? `<div class="bingo-hint">Finish a FairShift cleaning duty to earn your next Bingo Coin.</div>` : ''}
        </section>

        <aside class="bingo-side">
          <div class="bingo-info-card">
            <div class="bingo-kicker">How it works</div>
            <div class="bingo-rule"><span>1</span><p>Finish cleaning in FairShift → earn <strong>1 Bingo Coin</strong>.</p></div>
            <div class="bingo-rule"><span>2</span><p>Spend a coin for a random symbol. Everyone also gets <strong>1 free draw each week</strong>.</p></div>
            <div class="bingo-rule"><span>3</span><p>If the symbol is on your card, it marks automatically. Drawn symbols don't repeat.</p></div>
          </div>
          <div class="bingo-round-card">
            <div><strong>${Number(state.stats?.players || 0)}</strong><span>playing</span></div>
            <div><strong>${Number(state.stats?.winners || 0)}</strong><span>bingo${Number(state.stats?.winners || 0) === 1 ? '' : 's'}</span></div>
            <div><strong>${Number(state.round?.daysLeft || 0)}</strong><span>days left</span></div>
          </div>
          <div class="bingo-round-note">Round: ${esc(fmtDate(state.round?.start))} – ${esc(fmtDate(state.round?.end))}. Coins you earn stay in your wallet.</div>
        </aside>
      </div>`;

    document.getElementById('bingoDraw')?.addEventListener('click', draw);
  }

  async function load() {
    const current = session();
    if (!current.signedIn || current.fairShiftVerified !== true) {
      renderSignedOut();
      return;
    }
    try {
      const response = await fetch(API, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        renderSignedOut();
        return;
      }
      if (!response.ok) throw new Error(body.error || 'Warehouse Bingo is unavailable.');
      state = body;
      state.drawResult = null;
      message = '';
      render();
    } catch (error) {
      root.innerHTML = `<div class="bingo-empty-card"><div><div class="bingo-kicker">Warehouse Bingo</div><h3>Couldn’t load your card.</h3><p>${esc(error?.message || 'Try again in a moment.')}</p></div><button class="action secondary" id="bingoRetry" type="button">Try again</button></div>`;
      document.getElementById('bingoRetry')?.addEventListener('click', load);
    }
  }

  async function draw() {
    if (loading) return;
    loading = true;
    message = '';
    render();
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draw' }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        await window.HubAssociate?.refresh?.().catch?.(() => {});
        renderSignedOut();
        window.HubAssociate?.open?.();
        return;
      }
      if (!response.ok && !body.player) throw new Error(body.error || 'Could not draw a symbol.');
      state = body;
      message = body.error || '';
      render();
    } catch (error) {
      message = error?.message || 'Could not draw a symbol.';
      if (state) {
        state.drawResult = null;
        render();
        const result = root.querySelector('.bingo-result');
        if (!result && message) {
          const note = document.createElement('div');
          note.className = 'bingo-result';
          note.textContent = message;
          root.querySelector('.bingo-card-shell')?.appendChild(note);
        }
      }
    } finally {
      loading = false;
      if (state) render();
    }
  }

  document.addEventListener('hub-associate-session', () => load());
  document.addEventListener('hub-bingo-refresh', () => load());
  document.addEventListener('hub-view-changed', (event) => {
    if (event.detail?.view === 'bingo') load();
  });

  load();
})();
