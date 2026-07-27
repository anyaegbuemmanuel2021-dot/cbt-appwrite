/**
 * SOFTLY DIGITAL V3 — appwrite-config.js
 * Backend : Appwrite Cloud  (fra.cloud.appwrite.io)
 * Storage : Cloudinary      (cloud: dfppqz2tk)
 * All credentials hardcoded — no .env needed for static deployment.
 */

/* ── LIVE CREDENTIALS ───────────────────────────────────────────── */
window.APP_ENV = {
  /* Appwrite */
  APPWRITE_ENDPOINT:    'https://fra.cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID:  '6a5cab36001397f233a6',

  /* Cloudinary — unsigned upload only (api_secret stays server-side) */
  CLOUDINARY_CLOUD:     'dfppqz2tk',
  CLOUDINARY_API_KEY:   '469832992668418',
  CLOUDINARY_PRESET:    'cbt_softly_unsigned',
  CLOUDINARY_FOLDER:    'softly-digital/v3',
};

/* ── Appwrite SDK (loaded via CDN) ───────────────────────────────────
 * NOTE: cbt-main is a TablesDB-type database (created via the newer
 * Appwrite Tables API), NOT a classic Collections/Documents database.
 * We must use the TablesDB service (listRows/createRow/etc.), not the
 * classic Databases service (listDocuments/createDocument/etc.) — the
 * classic endpoints simply don't exist for this database and were
 * causing every call to be rejected before CORS headers could attach.
 * ──────────────────────────────────────────────────────────────────── */
const {
  Client, Account, TablesDB, Storage, Query, ID, Permission, Role,
} = Appwrite;

const _client = new Client()
  .setEndpoint(window.APP_ENV.APPWRITE_ENDPOINT)
  .setProject(window.APP_ENV.APPWRITE_PROJECT_ID);

const _account   = new Account(_client);
const _tablesDB  = new TablesDB(_client);

/* ── Database ID & Collection IDs ───────────────────────────────── */
const DB_ID = 'cbt-main';

const COL = {
  USERS:         'users',
  CANDIDATES:    'candidates',
  CENTRES:       'centres',
  SUBJECTS:      'subjects',
  TOPICS:        'topics',
  EXAMS:         'exams',
  QUESTIONS:     'questions',
  SESSIONS:      'exam_sessions',
  SUBMISSIONS:   'submissions',
  RESULTS:       'results',
  VIOLATIONS:    'violations',
  AUDIT_LOGS:    'audit_logs',
  NOTIFICATIONS: 'notifications',
  CERTIFICATES:  'certificates',
  SETTINGS:      'system_settings',
};

/* ── Shared password helper ──────────────────────────────────────────
 * Appwrite requires passwords to be 8+ characters. Candidate temp
 * passwords default to their candidateId, which can be shorter than
 * that. Pad deterministically so creation (candidate-manager.js) and
 * login (auth.js) always derive the exact same password for a given
 * candidateId — used ONLY as the initial/default password.
 * ──────────────────────────────────────────────────────────────────── */
window.padPassword = function padPassword(candidateId) {
  const id = String(candidateId || '');
  return id.length >= 8 ? id : id.padEnd(8, '0');
};

/* ── Global namespace ───────────────────────────────────────────── */
window.SD = {
  client:    _client,
  account:   _account,
  tablesDB:  _tablesDB,
  DB_ID,
  COL,
  Q:   Query,
  ID,
  CFG: {
    PASS_THRESHOLD:    70,
    MAX_VIOLATIONS:    3,
    AUTO_SAVE_MS:      5000,
    SYNC_MS:           30000,
    MAX_IMAGE:         10 * 1024 * 1024,   // 10 MB
    MAX_FILE:          50 * 1024 * 1024,   // 50 MB
    SESSION_TIMEOUT_MIN: 60,
    SINGLE_SESSION:    true,
    BOT_DETECTION:     true,
    GRADE_SCALE:       { A:90, B:80, C:70, D:60, F:0 },
    ALLOWED_IMAGE_TYPES: ['image/jpeg','image/png','image/webp','image/jpg'],
  },
};

/* ── Convenience aliases ────────────────────────────────────────── */
window.db      = _tablesDB;   // legacy alias (now points at TablesDB)
window.account = _account;

/* ═══════════════════════════════════════════════════════════════════
 * DB — clean helper that every module calls instead of the raw SDK
 * ═══════════════════════════════════════════════════════════════════ */
window.DB = {

  /** List rows (documents) with optional Query array */
  list(col, queries = [], limit = 100) {
    const q = [...queries, Query.limit(limit)];
    return _tablesDB.listRows({ databaseId: DB_ID, tableId: col, queries: q })
      .then(res => ({ ...res, documents: res.rows })); // keep .documents alias for old call sites
  },

  /** Cursor-paginated list — returns { documents, total, cursor } */
  async page(col, queries = [], pageSize = 50, cursor = null) {
    const q = [...queries, Query.limit(pageSize)];
    if (cursor) q.push(Query.cursorAfter(cursor));
    const res = await _tablesDB.listRows({ databaseId: DB_ID, tableId: col, queries: q });
    return {
      documents: res.rows,
      total:     res.total,
      cursor:    res.rows.length
        ? res.rows[res.rows.length - 1].$id
        : null,
    };
  },

  /** Get single row (document) */
  get(col, id) {
    return _tablesDB.getRow({ databaseId: DB_ID, tableId: col, rowId: id });
  },

  /** Create row (document) — auto-generates ID if none passed */
  create(col, data, id = ID.unique(), perms = []) {
    // Strip undefined values — Appwrite rejects them
    const clean = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    return _tablesDB.createRow({ databaseId: DB_ID, tableId: col, rowId: id, data: clean, permissions: perms });
  },

  /** Partial update */
  update(col, id, data) {
    const clean = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    return _tablesDB.updateRow({ databaseId: DB_ID, tableId: col, rowId: id, data: clean });
  },

  /** Delete row (document) */
  delete(col, id) {
    return _tablesDB.deleteRow({ databaseId: DB_ID, tableId: col, rowId: id });
  },
};

/* ═══════════════════════════════════════════════════════════════════
 * CLOUD — Cloudinary unsigned upload helper
 * Uses real credentials from APP_ENV above.
 * ═══════════════════════════════════════════════════════════════════ */
window.CLOUD = {

  /**
   * Upload a File or Blob to Cloudinary.
   * @param {File|Blob} file
   * @param {string}    folder   sub-folder under softly-digital/v3/
   * @param {string}    [publicId]
   * @returns {Promise<string>}  secure HTTPS URL
   */
  async upload(file, folder, publicId) {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp'];
    if (file instanceof File && !allowed.includes(file.type)) {
      throw new Error('Only JPEG, PNG or WebP images are allowed.');
    }
    if (file.size > SD.CFG.MAX_IMAGE) {
      throw new Error('Image must be under 10 MB.');
    }

    const fd = new FormData();
    fd.append('file',          file);
    fd.append('upload_preset', APP_ENV.CLOUDINARY_PRESET);   // cbt_softly_unsigned
    fd.append('api_key',       APP_ENV.CLOUDINARY_API_KEY);  // 469832992668418
    fd.append('folder',        `${APP_ENV.CLOUDINARY_FOLDER}/${folder}`);
    if (publicId) fd.append('public_id', publicId);

    const res  = await fetch(
      `https://api.cloudinary.com/v1_1/${APP_ENV.CLOUDINARY_CLOUD}/image/upload`,
      { method: 'POST', body: fd }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.secure_url;
  },

  /**
   * Upload a base64 data-URI string (used by certificate generator)
   */
  async uploadBase64(dataUri, folder, publicId) {
    const fd = new FormData();
    fd.append('file',          dataUri);
    fd.append('upload_preset', APP_ENV.CLOUDINARY_PRESET);
    fd.append('api_key',       APP_ENV.CLOUDINARY_API_KEY);
    fd.append('folder',        `${APP_ENV.CLOUDINARY_FOLDER}/${folder}`);
    if (publicId) fd.append('public_id', publicId);

    const res  = await fetch(
      `https://api.cloudinary.com/v1_1/${APP_ENV.CLOUDINARY_CLOUD}/image/upload`,
      { method: 'POST', body: fd }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.secure_url;
  },
};

/* ═══════════════════════════════════════════════════════════════════
 * AUTH — thin wrapper around Appwrite Account
 * ═══════════════════════════════════════════════════════════════════ */
window.AUTH = {

  /** Returns current Appwrite user or null */
  async current() {
    try   { return await _account.get(); }
    catch (_) { return null; }
  },

  /** Email + password session */
  async login(email, password) {
    return _account.createEmailPasswordSession(email, password);
  },

  /** Delete current session */
  async logout() {
    try { await _account.deleteSession('current'); } catch (_) {}
  },

  /** Get user profile document from DB */
  async profile(uid) {
    try   { return await DB.get(COL.USERS, uid); }
    catch (_) { return null; }
  },

  /** Create new Appwrite account */
  async createAccount(email, password, name) {
    return _account.create(ID.unique(), email, password, name);
  },

  /** Send password-reset email */
  async resetPassword(email) {
    const resetUrl = `${location.origin}/${location.pathname.includes('/html/') ? '' : 'html/'}reset-password.html`;
    return _account.createRecovery(email, resetUrl);
  },
};

/* ═══════════════════════════════════════════════════════════════════
 * AUDIT — write one log entry to Appwrite (fire-and-forget)
 * ═══════════════════════════════════════════════════════════════════ */
window.audit = async function auditLog(action, meta = {}, severity = 'INFO') {
  try {
    const user = await AUTH.current().catch(() => null);
    // Stamp the acting user's name/email into meta (kept inside the free-form
    // JSON blob, not as new top-level columns, so this never risks a schema
    // mismatch on the audit_logs table). This is what lets the Audit Logs
    // screen show "Jane Doe (jane@x.com)" instead of a bare document ID.
    const enrichedMeta = {
      ...meta,
      ...(user ? { name: user.name || undefined, email: user.email || undefined } : {}),
    };
    await DB.create(COL.AUDIT_LOGS, {
      action,
      severity,
      userId:    user?.$id || 'anonymous',
      userAgent: navigator.userAgent.substring(0, 200),
      meta:      JSON.stringify(enrichedMeta),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    // Non-blocking — never break the UI over an audit log — but DO surface
    // the failure to the console. If this collection is missing a
    // permission (e.g. candidates/invigilators need "create" access on
    // audit_logs) or the write ever fails, it used to fail 100% silently,
    // which made the Audit Logs screen look "broken" with nothing to show.
    console.warn('[audit] failed to write log for action "' + action + '":', err?.message || err);
  }
};

/* ── Friendly error messages for Appwrite error codes ───────────── */
window.friendlyError = function(err) {
  const map = {
    'user_invalid_credentials':     'Invalid email or password.',
    'user_not_found':               'No account found with these credentials.',
    'general_rate_limit_exceeded':  'Too many attempts. Please wait a moment.',
    'user_blocked':                 'Account is blocked. Contact support.',
    'document_not_found':           'Record not found.',
    'document_already_exists':      'This record already exists.',
    'collection_not_found':         'Database not configured. Run the setup script.',
    'network_error':                'Network error — check your internet connection.',
  };
  return map[err?.type || err?.code] || err?.message || 'An unexpected error occurred.';
};

/* ── Global UI helpers used across all pages ────────────────────── */
window.closeModal = function(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; el.classList.remove('active'); }
};
window.togglePw = function(id) {
  const el = document.getElementById(id);
  if (el) el.type = (el.type === 'password' ? 'text' : 'password');
};
window.toggleSidebar      = () => document.getElementById('sidebar')?.classList.toggle('open');
/* ── Toast notification (lightweight, no library) ───────────────── */
window.Toast = {
  show(msg, type = 'info') {
    const colors = { success:'#28a745', danger:'#dc3545', warning:'#ffc107', info:'#667eea' };
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 20px;
      background:${colors[type]||colors.info};color:#fff;border-radius:8px;font-size:.9rem;
      font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.2);
      animation:sd-toast-in .3s ease;max-width:360px;word-break:break-word`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(8px)';
      t.style.transition='all .3s'; setTimeout(()=>t.remove(), 300); }, 3500);
  },
};

/* ── Logout banner (account suspended etc.) ─────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const msg = sessionStorage.getItem('sd_logout_reason');
  if (!msg) return;
  sessionStorage.removeItem('sd_logout_reason');
  const b = document.createElement('div');
  b.className = 'sd-logout-banner';
  b.setAttribute('role', 'alert');
  b.innerHTML = `<span>⚠️</span><span>${msg}</span>`;
  document.body.prepend(b);
  setTimeout(() => b.classList.add('sd-logout-banner-hide'), 5000);
  setTimeout(() => b.remove(), 5600);
});

console.log(
  '%cSOFTLY DIGITAL V3%c — Appwrite Ready ✅',
  'color:#667eea;font-weight:900;font-size:14px',
  'color:#28a745;font-weight:600'
);
