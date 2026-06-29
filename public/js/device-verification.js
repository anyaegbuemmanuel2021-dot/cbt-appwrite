/**
 * SOFTLY DIGITAL V3 — device-verification.js (Appwrite edition)
 */
const DeviceVerification = (() => {
  'use strict';

  function setCheck(id, pass) {
    const el = document.getElementById(id); if (!el) return;
    const sp = el.querySelector('.dcheck-spin');
    if (sp) sp.textContent = pass ? '✅' : '❌';
    el.classList.add(pass ? 'dcheck-pass' : 'dcheck-fail');
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function run(onSuccess) {
    const results = {};

    await sleep(400);
    results.browser = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    setCheck('dchkBrowser', results.browser);

    await sleep(400);
    results.fullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || document.mozFullScreenEnabled);
    setCheck('dchkFullscreen', results.fullscreen);

    await sleep(400);
    try {
      await DB.list(SD.COL.SETTINGS, [], 1);
      results.net = true;
    } catch(_) { results.net = navigator.onLine; }
    setCheck('dchkNet', results.net);

    await sleep(500);
    try {
      const fp   = await generateFingerprint();
      const user = await AUTH.current();
      if (user) {
        await DB.update(SD.COL.CANDIDATES, user.$id, {
          lastDeviceFingerprint: fp,
          lastLoginAt: new Date().toISOString(),
        });
      }
      results.fingerprint = true;
    } catch(_) { results.fingerprint = true; }
    setCheck('dchkFingerprint', results.fingerprint);

    const allPass = Object.values(results).every(Boolean);
    const el = document.getElementById('deviceResult');
    if (el) {
      el.innerHTML = allPass
        ? '<div class="dcheck-result pass">✅ Device verified. Redirecting…</div>'
        : '<div class="dcheck-result fail">❌ Some checks failed. Use a supported browser and check your connection.<br><button onclick="location.reload()" class="auth-btn cand-btn" style="margin-top:12px">Retry</button></div>';
    }
    if (allPass) setTimeout(onSuccess, 1200);
  }

  async function generateFingerprint() {
    const raw = [navigator.userAgent, navigator.language, `${screen.width}x${screen.height}`,
      new Date().getTimezoneOffset(), navigator.hardwareConcurrency, navigator.platform].join('|');
    const buf  = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  return { run, generateFingerprint };
})();
