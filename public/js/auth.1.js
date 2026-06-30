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
      'user_invalid_credentials': 'Invalid email or password.',
      'user_not_found':           'No account found with these credentials.',
      'general_rate_limit_exceeded': 'Too many attempts. Please wait a moment.',
      'network_error':            'Network error. Check your internet connection.',
      'user_blocked':             'Account is blocked. Contact support.',
    };
    return map[code] || err?.message || 'An unexpected error occurred.';
  }

  /* ── Path resolver ───────────────────────────────────────────────── */
  function indexPath() {
    return location.pathname.includes('/html/') ? '../index.html' : 'index.html';
  }

  /* ── Load centres into a <select> ────────────────────────────────── */
  async function loadCentres(selectId) {
    const sel = $id(selectId); if(!sel) return;
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
    } catch(e) { console.warn('loadCentres', e); }
  }

  /* ── requireRole — guard for role-protected pages ────────────────── */
  function requireRole(expectedRole) {
    return new Promise(resolve => {
      AUTH.current().then(async user => {
        if (!user) { location.href = indexPath(); return; }
        try {
          const profile = await DB.get(SD.COL.USERS, user.$id);
          if (!profile || profile.role !== expectedRole) {
            await AUTH.logout(); location.href = indexPath(); return;
          }
          if (!isActive(profile)) {
            await AUTH.logout();
            sessionStorage.setItem('sd_logout_reason', statusMsg(profile));
            location.href = indexPath(); return;
          }
          const userDoc = { uid: user.$id, email: user.email, ...profile };
          window.SD.currentUser = userDoc;
          if (window.RBAC) RBAC.setCurrentUser(userDoc);
          resolve(userDoc);
        } catch(e) { location.href = indexPath(); }
      }).catch(() => { location.href = indexPath(); });
    });
  }

  function requireAnyRole(expectedRoles) {
    return new Promise(resolve => {
      AUTH.current().then(async user => {
        if (!user) { location.href = indexPath(); return; }
        try {
          const profile = await DB.get(SD.COL.USERS, user.$id);
          if (!profile || !expectedRoles.includes(profile.role)) {
            await AUTH.logout(); location.href = indexPath(); return;
          }
          if (!isActive(profile)) {
            await AUTH.logout();
            sessionStorage.setItem('sd_logout_reason', statusMsg(profile));
            location.href = indexPath(); return;
          }
          const userDoc = { uid: user.$id, email: user.email, ...profile };
          window.SD.currentUser = userDoc;
          if (window.RBAC) RBAC.setCurrentUser(userDoc);
          resolve(userDoc);
        } catch(e) { location.href = indexPath(); }
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
      showErr('loginErr','Please fill in all fields.'); return;
    }
    setBtn('loginBtn', true);
    try {
      // Look up candidate by candidateId + centreId
      const res = await DB.list(SD.COL.CANDIDATES, [
        SD.Q.equal('candidateId', candidateId),
        SD.Q.equal('centreId', centreId),
      ], 1);
      if (!res.documents.length) throw new Error('Candidate not found at selected centre.');
      const candDoc = res.documents[0];

      // Login with Appwrite using stored email
      await AUTH.login(candDoc.email, password);

      if (!isActive(candDoc)) {
        await AUTH.logout();
        throw new Error(statusMsg(candDoc));
      }

      await audit('CANDIDATE_LOGIN', { candidateId, centreId });

      // Device verification step
      $id('stepCredentials').style.display = 'none';
      $id('stepDevice').style.display = 'block';
      if (window.DeviceVerification) {
        await DeviceVerification.run(() => { location.href = 'candidate-dashboard.html'; });
      } else {
        location.href = 'candidate-dashboard.html';
      }
    } catch(err) {
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
      showErr('loginErr','Please fill in all fields.'); return;
    }
    setBtn('loginBtn', true);
    try {
      const res = await DB.list(SD.COL.USERS, [
        SD.Q.equal('staffId', staffId),
        SD.Q.equal('role', 'invigilator'),
        SD.Q.equal('centreId', centreId),
      ], 1);
      if (!res.documents.length) throw new Error('Invigilator not found at selected centre.');
      const userData = res.documents[0];

      /*await AUTH.login(userData.email, password);*/
      

      if (!isActive(userData)) {
        await AUTH.logout();
        throw new Error(statusMsg(userData));
      }
      await audit('INVIGILATOR_LOGIN', { staffId, centreId });
      location.href = 'invigilator-panel.html';
    } catch(err) {
      setBtn('loginBtn', false);
      showErr('loginErr', friendly(err));
    }
  }

  /* ── ADMIN LOGIN ─────────────────────────────────────────────────── */
  async function adminLogin() {
    hideErr('loginErr');
    const email    = $id('adminEmail')?.value.trim();
    const password = $id('password')?.value;
    if (!email || !password) { showErr('loginErr','Please fill in all fields.'); return; }
    setBtn('loginBtn', true);
    try {
      const session = await AUTH.login(email, password);
      const user    = await AUTH.current();

      const profile = await DB.get(SD.COL.USERS, user.$id);
      const staffRoles = ['superadmin','admin','examofficer','resultofficer','questionmanager'];
      if (!profile || !staffRoles.includes(profile.role)) {
        await AUTH.logout();
        throw new Error('Not an administrator account.');
      }
      if (!isActive(profile)) {
        await AUTH.logout();
        throw new Error(statusMsg(profile));
      }
      await audit('ADMIN_LOGIN', { email });
      location.href = 'admin-dashboard.html';
    } catch(err) {
      setBtn('loginBtn', false);
      showErr('loginErr', friendly(err));
    }
  }

  /* ── FORGOT PASSWORD ─────────────────────────────────────────────── */
  async function forgotPassword() {
    hideErr('fpErr');
    const email = $id('fpEmail')?.value.trim();
    if (!email) { showErr('fpErr','Please enter your email address.'); return; }
    setBtn('fpBtn', true);
    try {
      await _account.createRecovery(email, location.origin + '/html/reset-password.html');
      $id('fpSuccess').style.display = 'block';
    } catch(err) {
      showErr('fpErr', friendly(err));
    } finally {
      setBtn('fpBtn', false);
    }
  }

  /* ── LOGOUT ──────────────────────────────────────────────────────── */
  async function logout() {
    try {
      const user = await AUTH.current();
      if(user) await audit('LOGOUT', { uid: user.$id });
      await AUTH.logout();
    } catch(_) {}
    ['currentExamId','examAnswers','examSession','candidateSession']
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
    banner.setAttribute('role','alert');
    banner.innerHTML = `<span>⚠️</span><span>${msg}</span>`;
    document.body.prepend(banner);
    setTimeout(() => banner.classList.add('sd-logout-banner-hide'), 6000);
    setTimeout(() => banner.remove(), 6600);
  }

  /* ── Global UI helpers ───────────────────────────────────────────── */
  window.togglePw = id => { const i=$id(id); if(i) i.type=(i.type==='password'?'text':'password'); };
  window.toggleSidebar      = () => $id('sidebar')?.classList.toggle('open');
  window.toggleAdminSidebar = () => $id('adminSidebar')?.classList.toggle('open');
  window.closeModal = id => { const el=$id(id); if(el){el.style.display='none';el.classList.remove('active');} };
  window.showSection = sec => {
    document.querySelectorAll('.sec').forEach(s => s.style.display='none');
    const el=$id('sec-'+sec); if(el) el.style.display='block';
    document.querySelectorAll('.sb-item').forEach(a => {
      a.classList.toggle('active', a.dataset.sec===sec);
    });
    const t=$id('pageTitle'); if(t) t.textContent=sec.charAt(0).toUpperCase()+sec.slice(1);
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
