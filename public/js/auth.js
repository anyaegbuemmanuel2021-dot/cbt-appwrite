/**
 * SOFTLY DIGITAL V3 — auth.js (Appwrite edition)
 * Flow: Login → Role Verification → Account Status → Dashboard
 * Password toggle on ALL password fields. No OTP/2FA.
 */
const AuthManager = (() => {
  'use strict';

  const ACTIVE = 'active';
  const STATUS_MSG = {
    disabled:  'Your account has been disabled. Please contact the Super Administrator.',
    suspended: 'Your account has been suspended. Please contact the Super Administrator.',
    locked:    'Your account is locked. Please contact the Super Administrator to unlock it.',
  };

  /* ── DOM helpers ──────────────────────────────────────────────────── */
  function $id(id) { return document.getElementById(id); }
  function showErr(id, msg) { const el=$id(id); if(el){el.textContent=msg;el.style.display='block';} }
  function hideErr(id)      { const el=$id(id); if(el) el.style.display='none'; }
  function setBtn(id, busy) {
    const b=$id(id); if(!b) return;
    b.disabled=busy;
    const t=b.querySelector('.btn-text'), l=b.querySelector('.btn-loader');
    if(t) t.style.display=busy?'none':'';
    if(l) l.style.display=busy?'':'none';
  }

  /* ── Status helpers ──────────────────────────────────────────────── */
  function isActive(doc) { return (doc?.status || ACTIVE) === ACTIVE; }
  function statusMsg(doc) {
    return STATUS_MSG[doc?.status] || 'Your account is not active. Contact the Super Administrator.';
  }

  /* ── Friendly Appwrite error messages ───────────────────────────── */
  function friendly(err) {
    const code = err?.type || err?.code || '';
    const map = {
      'user_invalid_credentials':    'Invalid email or password.',
      'user_not_found':              'No account found with these credentials.',
      'general_rate_limit_exceeded': 'Too many attempts. Please wait a moment.',
      'network_error':               'Network error. Check your internet connection.',
      'user_blocked':                'Account is blocked. Contact support.',
      'general_argument_invalid':    'Invalid input — check the fields and try again.',
      'user_session_already_exists': 'A session is already active — retrying…',
    };
    return map[code] || err?.message || 'An unexpected error occurred.';
  }

  /* ── Path resolver ───────────────────────────────────────────────── */
  function indexPath() {
    return location.pathname.includes('/html/') ? '../index.html' : 'index.html';
  }

  /**
   * CRITICAL FIX: Appwrite throws "user_session_already_exists" if
   * createEmailPasswordSession is called while a session cookie is still
   * present (e.g. a previous failed/stale login, or the user is already
   * logged in as someone else). This silently broke every login attempt
   * after the first. We now always clear any existing session BEFORE
   * attempting a new one.
   */
  async function _clearExistingSession() {
    try { await _account.deleteSession('current'); } catch (_) { /* none existed — fine */ }
  }

  /**
   * CRITICAL FIX: after createEmailPasswordSession resolves, immediately
   * calling account.get() can occasionally race ahead of the session cookie
   * being committed (seen on Safari/iOS and some corporate proxies). We
   * retry a few times with a short backoff instead of failing the whole
   * login on the first miss.
   */
  async function _getCurrentUserWithRetry(retries = 3, delayMs = 250) {
    for (let i = 0; i < retries; i++) {
      const user = await AUTH.current();
      if (user) return user;
      await new Promise(r => setTimeout(r, delayMs));
    }
    return null;
  }

  /* ── Load centres into a <select> ────────────────────────────────── */
  async function loadCentres(selectId) {
    const sel = $id(selectId); if (!sel) return;
    try {
      const res = await DB.list(SD.COL.CENTRES, [
        SD.Q.equal('status', 'active'),
        SD.Q.orderAsc('name'),
      ], 500);
      res.documents.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.$id; opt.textContent = c.name;
        sel.appendChild(opt);
      });
    } catch (e) { console.warn('loadCentres', e); }
  }

  /* ── requireRole — guard for role-protected pages ────────────────── */
  function requireRole(expectedRole) {
    return requireAnyRole([expectedRole]);
  }

  function requireAnyRole(expectedRoles) {
    return new Promise(resolve => {
      AUTH.current().then(async user => {
        if (!user) { location.href = indexPath(); return; }
        try {
          let profile = await DB.get(SD.COL.USERS, user.$id).catch(() => null);
          let resolvedRole = profile?.role;

          // Candidates live in a separate collection with no "role" field —
          // fall back to checking the candidates collection.
          if (!profile) {
            profile = await DB.get(SD.COL.CANDIDATES, user.$id).catch(() => null);
            resolvedRole = profile ? 'candidate' : null;
          }

          if (!profile || !expectedRoles.includes(resolvedRole)) {
            await AUTH.logout(); location.href = indexPath(); return;
          }
          if (!isActive(profile)) {
            await AUTH.logout();
            sessionStorage.setItem('sd_logout_reason', statusMsg(profile));
            location.href = indexPath(); return;
          }
          const userDoc = { uid: user.$id, email: user.email, role: resolvedRole, ...profile };
          window.SD.currentUser = userDoc;
          if (window.RBAC) RBAC.setCurrentUser(userDoc);
          resolve(userDoc);
        } catch (e) {
          console.error('requireAnyRole error:', e);
          location.href = indexPath();
        }
      }).catch(() => { location.href = indexPath(); });
    });
  }

  /* ── CANDIDATE LOGIN ─────────────────────────────────────────────── */
  async function candidateLogin() {
    hideErr('loginErr');
    const candidateId = $id('candidateId')?.value.trim();
    const password    = $id('password')?.value;
    const centreId    = $id('centreSelect')?.value;
    if (!candidateId || !password || !centreId) {
      showErr('loginErr', 'Please fill in all fields.'); return;
    }
    setBtn('loginBtn', true);
    try {
      // Look up candidate by candidateId + centreId first (public read, no auth needed)
      const res = await DB.list(SD.COL.CANDIDATES, [
        SD.Q.equal('candidateId', candidateId),
        SD.Q.equal('centreId', centreId),
      ], 1);
      if (!res.documents.length) throw new Error('Candidate not found at selected centre. Check your ID and centre selection.');
      const candDoc = res.documents[0];

      if (!isActive(candDoc)) throw new Error(statusMsg(candDoc));

      // FIX: clear stale session before logging in — this is what was
      // silently breaking login on repeated attempts.
      await _clearExistingSession();
      await AUTH.login(candDoc.email, password);

      // FIX: confirm session actually took before navigating away
      const user = await _getCurrentUserWithRetry();
      if (!user) throw new Error('Login succeeded but session could not be verified. Please try again.');

      await audit('CANDIDATE_LOGIN', { candidateId, centreId });

      // Device verification step
      const stepCred = $id('stepCredentials');
      const stepDev  = $id('stepDevice');
      if (stepCred && stepDev) {
        stepCred.style.display = 'none';
        stepDev.style.display  = 'block';
      }
      if (window.DeviceVerification) {
        await DeviceVerification.run(() => { location.href = 'candidate-dashboard.html'; });
      } else {
        location.href = 'candidate-dashboard.html';
      }
    } catch (err) {
      console.error('candidateLogin error:', err);
      setBtn('loginBtn', false);
      showErr('loginErr', friendly(err));
    }
  }

  /* ── INVIGILATOR LOGIN ───────────────────────────────────────────── */
  async function invigilatorLogin() {
    hideErr('loginErr');
    const staffId  = $id('staffId')?.value.trim();
    const password = $id('password')?.value;
    const centreId = $id('centreSelect')?.value;
    if (!staffId || !password || !centreId) {
      showErr('loginErr', 'Please fill in all fields.'); return;
    }
    setBtn('loginBtn', true);
    try {
      const res = await DB.list(SD.COL.USERS, [
        SD.Q.equal('staffId', staffId),
        SD.Q.equal('role', 'invigilator'),
        SD.Q.equal('centreId', centreId),
      ], 1);
      if (!res.documents.length) throw new Error('Invigilator not found at selected centre. Check your Staff ID and centre.');
      const userData = res.documents[0];

      if (!isActive(userData)) throw new Error(statusMsg(userData));

      await _clearExistingSession();
      await AUTH.login(userData.email, password);

      const user = await _getCurrentUserWithRetry();
      if (!user) throw new Error('Login succeeded but session could not be verified. Please try again.');

      await audit('INVIGILATOR_LOGIN', { staffId, centreId });
      location.href = 'invigilator-panel.html';
    } catch (err) {
      console.error('invigilatorLogin error:', err);
      setBtn('loginBtn', false);
      showErr('loginErr', friendly(err));
    }
  }

  /* ── ADMIN LOGIN ─────────────────────────────────────────────────── */
  async function adminLogin() {
    hideErr('loginErr');
    const email    = $id('adminEmail')?.value.trim();
    const password = $id('password')?.value;
    if (!email || !password) { showErr('loginErr', 'Please fill in all fields.'); return; }
    setBtn('loginBtn', true);
    try {
      // FIX: always clear any stale/previous session first. This was the
      // main bug — without this line, a second login attempt (or a leftover
      // session from another role/tab) makes createEmailPasswordSession
      // throw, and the page just silently fails to log in.
      await _clearExistingSession();

      await AUTH.login(email, password);

      // FIX: retry-based current-user fetch instead of one immediate call
      const user = await _getCurrentUserWithRetry();
      if (!user) throw new Error('Login succeeded but session could not be verified. Please refresh and try again.');

      const profile = await DB.get(SD.COL.USERS, user.$id).catch(() => null);
      const staffRoles = ['superadmin', 'admin', 'examofficer', 'resultofficer', 'questionmanager'];
      if (!profile || !staffRoles.includes(profile.role)) {
        await AUTH.logout();
        throw new Error('This account is not registered as an administrator.');
      }
      if (!isActive(profile)) {
        await AUTH.logout();
        throw new Error(statusMsg(profile));
      }

      await audit('ADMIN_LOGIN', { email, role: profile.role });
      location.href = 'admin-dashboard.html';
    } catch (err) {
      console.error('adminLogin error:', err);
      setBtn('loginBtn', false);
      showErr('loginErr', friendly(err));
    }
  }

  /* ── FORGOT PASSWORD ─────────────────────────────────────────────── */
  async function forgotPassword() {
    hideErr('fpErr');
    const email = $id('fpEmail')?.value.trim();
    if (!email) { showErr('fpErr', 'Please enter your email address.'); return; }
    setBtn('fpBtn', true);
    try {
      await AUTH.resetPassword(email);
      const ok = $id('fpSuccess');
      if (ok) ok.style.display = 'block';
    } catch (err) {
      showErr('fpErr', friendly(err));
    } finally {
      setBtn('fpBtn', false);
    }
  }

  /* ── LOGOUT ──────────────────────────────────────────────────────── */
  async function logout() {
    try {
      const user = await AUTH.current();
      if (user) await audit('LOGOUT', { uid: user.$id });
    } catch (_) {}
    await _clearExistingSession();
    ['currentExamId', 'examAnswers', 'examSession', 'candidateSession']
      .forEach(k => localStorage.removeItem(k));
    location.href = indexPath();
  }

  /* ── Show pending logout reason banner ───────────────────────────── */
  function showPendingLogoutReason() {
    const msg = sessionStorage.getItem('sd_logout_reason');
    if (!msg) return;
    sessionStorage.removeItem('sd_logout_reason');
    const banner = document.createElement('div');
    banner.className = 'sd-logout-banner';
    banner.setAttribute('role', 'alert');
    banner.innerHTML = `<span>⚠️</span><span>${msg}</span>`;
    document.body.prepend(banner);
    setTimeout(() => banner.classList.add('sd-logout-banner-hide'), 6000);
    setTimeout(() => banner.remove(), 6600);
  }

  /* ── Global UI helpers ───────────────────────────────────────────── */
  window.togglePw = id => { const i = $id(id); if (i) i.type = (i.type === 'password' ? 'text' : 'password'); };
  window.toggleSidebar      = () => $id('sidebar')?.classList.toggle('open');
  window.toggleAdminSidebar = () => $id('adminSidebar')?.classList.toggle('open');
  window.closeModal = id => { const el = $id(id); if (el) { el.style.display = 'none'; el.classList.remove('active'); } };
  window.showSection = sec => {
    document.querySelectorAll('.sec').forEach(s => s.style.display = 'none');
    const el = $id('sec-' + sec); if (el) el.style.display = 'block';
    document.querySelectorAll('.sb-item').forEach(a => {
      a.classList.toggle('active', a.dataset.sec === sec);
    });
    const t = $id('pageTitle'); if (t) t.textContent = sec.charAt(0).toUpperCase() + sec.slice(1);
  };

  document.addEventListener('DOMContentLoaded', showPendingLogoutReason);

  return {
    requireRole, requireAnyRole, loadCentres,
    candidateLogin, invigilatorLogin, adminLogin,
    forgotPassword, logout,
    isActive, statusMsg,
    indexPath,
  };
})();
