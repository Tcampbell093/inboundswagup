(() => {
  const SESSION_API = '/.netlify/functions/hub-auth?action=session';
  let session = null;
  const normalize = (v) => String(v || '').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-');

  function applySession() {
    if (!session?.signedIn) return;
    const form = document.getElementById('form');
    const name = document.getElementById('name');
    const pin = document.getElementById('pin');
    if (!form || !name || !pin) return;
    if (normalize(name.value) !== normalize(session.name)) return;

    name.value = session.name;
    pin.value = '0000';
    const nameField = name.closest('.field');
    const pinField = pin.closest('.field');
    if (nameField) nameField.style.display = 'none';
    if (pinField) pinField.style.display = 'none';

    if (!form.querySelector('[data-hub-session-note]')) {
      const note = document.createElement('div');
      note.dataset.hubSessionNote = '1';
      note.className = 'complete';
      note.textContent = `Signed in as ${session.name}. No PIN needed again this shift.`;
      form.prepend(note);
    }
  }

  fetch(SESSION_API, { cache: 'no-store' })
    .then((response) => response.json())
    .then((data) => { session = data; applySession(); })
    .catch(() => {});

  const observer = new MutationObserver(() => applySession());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
