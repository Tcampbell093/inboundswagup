(() => {
  const PROXY = '/.netlify/functions/fairshift-checkin-proxy';
  const cleaningList = document.getElementById('todayCleaning');
  if (!cleaningList) return;

  const normalize = (value) => String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-');

  const style = document.createElement('style');
  style.textContent = `
    .cleaning-inline-note{grid-column:1/-1;font-size:12px;font-weight:800;margin-top:5px;color:var(--muted)}
    .cleaning-inline-note.good{color:var(--green)}
    .cleaning-inline-note.bad{color:#8f2d22}
    .checkin.is-busy{opacity:.6;pointer-events:none}
  `;
  document.head.appendChild(style);

  function assignmentIdFromLink(link) {
    try {
      const url = new URL(link.href, window.location.origin);
      return Number(url.searchParams.get('assignment') || url.searchParams.get('assignmentId')) || 0;
    } catch {
      return 0;
    }
  }

  function setNote(row, message, kind = '') {
    let note = row.querySelector('.cleaning-inline-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'cleaning-inline-note';
      row.appendChild(note);
    }
    note.className = `cleaning-inline-note${kind ? ' ' + kind : ''}`;
    note.textContent = message;
    if (message) setTimeout(() => {
      if (note.textContent === message) note.textContent = '';
    }, 6000);
  }

  function sessionFor(name) {
    const session = window.HubAssociate?.getSession?.() || { signedIn: false };
    return session.signedIn && normalize(session.name) === normalize(name) ? session : null;
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 13000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      return { response, body };
    } finally {
      clearTimeout(timer);
    }
  }

  function markInProgress(row, link, statusEl) {
    if (statusEl) {
      statusEl.classList.remove('scheduled', 'completed', 'missed');
      statusEl.classList.add('in_progress');
      statusEl.textContent = 'In progress';
    }
    if (link?.isConnected) {
      link.classList.remove('is-busy');
      link.textContent = 'Finish';
    }
    setNote(row, 'Cleaning started. Finish here when the area is done.', 'good');
  }

  function markCompleted(row, link, statusEl, bingoCoinAwarded = false) {
    if (statusEl) {
      statusEl.classList.remove('scheduled', 'in_progress', 'missed');
      statusEl.classList.add('completed');
      statusEl.textContent = 'Completed';
    }
    if (link?.isConnected) {
      const complete = document.createElement('span');
      complete.className = 'checkin';
      complete.textContent = '15 min ✓';
      link.replaceWith(complete);
    }
    setNote(
      row,
      bingoCoinAwarded
        ? 'Cleaning completed. 15 FairShift minutes + 1 Bingo Coin earned.'
        : 'Cleaning completed. 15 FairShift minutes credited.',
      'good',
    );
  }

  async function reconcileAssignment(assignmentId, row, link, statusEl, action) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const { response, body } = await fetchJsonWithTimeout(
        `${PROXY}?assignmentId=${encodeURIComponent(assignmentId)}`,
        {},
        7000,
      );
      if (!response.ok) return false;
      const currentStatus = body?.assignment?.dutyStatus || body?.assignment?.status || '';
      if (currentStatus === 'in_progress') {
        markInProgress(row, link, statusEl);
        return true;
      }
      if (currentStatus === 'completed') {
        markCompleted(row, link, statusEl, false);
        document.dispatchEvent(new CustomEvent('hub-bingo-refresh'));
        return true;
      }
      if (action === 'start' && currentStatus === 'scheduled') return false;
      return false;
    } catch {
      return false;
    }
  }

  async function handleCleaning(link) {
    const row = link.closest('.cleaning-row');
    if (!row) return;
    const person = row.querySelector('.person')?.textContent?.trim() || '';
    const statusEl = row.querySelector('.status');
    const assignmentId = assignmentIdFromLink(link);
    if (!assignmentId) return;

    const session = sessionFor(person);
    if (!session) {
      setNote(row, `Sign in as ${person} to update this cleaning duty.`, 'bad');
      window.HubAssociate?.open?.(person);
      return;
    }

    const inProgress = statusEl?.classList.contains('in_progress') || /finish/i.test(link.textContent || '');
    const action = inProgress ? 'finish' : 'start';
    const originalText = link.textContent;
    link.classList.add('is-busy');
    link.textContent = action === 'start' ? 'Starting…' : 'Finishing…';
    setNote(row, '');

    try {
      const { response, body } = await fetchJsonWithTimeout(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, assignmentId }),
      }, 13000);

      if (!response.ok) {
        if (response.status === 401) {
          const refreshed = await window.HubAssociate?.refresh?.().catch?.(() => ({ signedIn: false }));
          if (link.isConnected) {
            link.classList.remove('is-busy');
            link.textContent = originalText;
          }
          if (refreshed?.signedIn && normalize(refreshed.name) === normalize(person)) {
            setNote(row, 'Your Hub sign-in was refreshed. Tap Start again.', 'bad');
          } else {
            setNote(row, `Sign in as ${person} again, then tap Start.`, 'bad');
            window.HubAssociate?.open?.(person);
          }
          return;
        }
        throw new Error(body.error || 'Cleaning check-in failed.');
      }

      if (action === 'start') {
        markInProgress(row, link, statusEl);
      } else {
        markCompleted(row, link, statusEl, !!body.bingoCoinAwarded);
        document.dispatchEvent(new CustomEvent('hub-bingo-refresh', {
          detail: { awarded: !!body.bingoCoinAwarded, coins: body.bingoCoins ?? null },
        }));
      }
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      if (timedOut) {
        setNote(row, 'FairShift is taking longer than expected. Checking whether the update went through…');
        const reconciled = await reconcileAssignment(assignmentId, row, link, statusEl, action);
        if (reconciled) return;
      }

      if (link.isConnected) {
        link.classList.remove('is-busy');
        link.textContent = originalText;
      }
      setNote(
        row,
        timedOut
          ? 'FairShift did not confirm the update. Please try again — the button is safe to use again.'
          : (error?.message || 'Cleaning check-in failed.'),
        'bad',
      );
    }
  }

  cleaningList.addEventListener('click', (event) => {
    const link = event.target.closest('a.checkin');
    if (!link || !cleaningList.contains(link)) return;
    const href = link.getAttribute('href') || '';
    if (!href.includes('checkin')) return;
    event.preventDefault();
    handleCleaning(link);
  });
})();
