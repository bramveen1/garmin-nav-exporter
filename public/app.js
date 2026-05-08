(function () {
  'use strict';

  const form = document.getElementById('form');
  const input = document.getElementById('input');
  const nameInput = document.getElementById('name');
  const submit = document.getElementById('submit');
  const status = document.getElementById('status');
  const endpointEl = document.getElementById('endpoint');
  if (endpointEl) endpointEl.textContent = location.origin + '/api/convert';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  prefillFromShareTarget();
  prefillFromQuery();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Converting…', '');
    submit.disabled = true;
    try {
      const text = input.value.trim();
      if (!text) {
        setStatus('Paste a Google Maps URL or share text first.', 'error');
        return;
      }
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, name: nameInput.value.trim() || undefined }),
      });
      if (!res.ok) {
        let msg = `Error ${res.status}`;
        try {
          const j = await res.json();
          if (j && j.message) msg += ' — ' + j.message;
        } catch (_) {}
        setStatus(msg, 'error');
        return;
      }
      const blob = await res.blob();
      const filename = filenameFromHeaders(res.headers) || 'waypoint.gpx';
      triggerDownload(blob, filename);
      setStatus('Downloaded ' + filename, 'ok');
    } catch (err) {
      setStatus('Network error: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      submit.disabled = false;
    }
  });

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function filenameFromHeaders(headers) {
    const cd = headers.get('content-disposition') || '';
    const m = cd.match(/filename="?([^";]+)"?/i);
    return m ? m[1] : null;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function prefillFromQuery() {
    const params = new URLSearchParams(location.search);
    const shared = params.get('url') || params.get('text') || params.get('shared');
    if (shared && !input.value) {
      input.value = shared;
      maybeAutoSubmit();
    }
  }

  function prefillFromShareTarget() {
    if (!('launchQueue' in window)) return;
    try {
      window.launchQueue.setConsumer(async (params) => {
        if (!params || !params.files) return;
      });
    } catch (_) {}
  }

  function maybeAutoSubmit() {
    if (new URLSearchParams(location.search).get('auto') === '1') {
      form.requestSubmit();
    }
  }
})();
