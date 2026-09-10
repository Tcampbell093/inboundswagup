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
    }, 4500);
  }

  function sessionFor(name) {
    const session = window.HubAssociate?.getSession?.() || { signedIn: false };
    return session.signedIn && normalize(session.name) === normalize(name) ? session : null;
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
      const response = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, assignmentId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Cleaning check-in failed.');

      if (statusEl) {
        statusEl.classList.remove('scheduled', 'in_progress', 'completed', 'missed');
        if (action === 'start') {
          statusEl.classList.add('in_progress');
          statusEl.textContent = 'In progress';
        } else {
          statusEl.classList.add('completed');
          statusEl.textContent = 'Completed';
        }
      }

      if (action === 'start') {
        link.classList.remove('is-busy');
        link.textContent = 'Finish';
        setNote(row, 'Cleaning started. Finish here when the area is done.', 'good');
      } else {
        const complete = document.createElement('span');
        complete.className = 'checkin';
        complete.textContent = '15 min ✓';
        link.replaceWith(complete);
        setNote(row, 'Cleaning completed. 15 FairShift minutes credited.', 'good');
      }
    } catch (error) {
      link.classList.remove('is-busy');
      link.textContent = originalText;
      setNote(row, error?.message || 'Cleaning check-in failed.', 'bad');
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
