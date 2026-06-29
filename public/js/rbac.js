/**
 * SOFTLY DIGITAL V3 — rbac.js (Appwrite edition)
 * ROLE HIERARCHY:
 *   superadmin  → full access, can delete, edit everything, access ALL portals
 *   admin       → create candidates/invigilators, cannot delete or change core settings
 *   examofficer → manage exams only
 *   resultofficer → view/export results only
 *   questionmanager → manage question bank
 *   invigilator → exam monitoring only (separate portal)
 *   candidate   → exam taking only
 */
const RBAC = (() => {
  'use strict';

  const ROLES = {
    SUPERADMIN:       'superadmin',
    ADMIN:            'admin',
    EXAM_OFFICER:     'examofficer',
    RESULT_OFFICER:   'resultofficer',
    QUESTION_MANAGER: 'questionmanager',
    INVIGILATOR:      'invigilator',
    CANDIDATE:        'candidate',
  };

  const ROLE_LABELS = {
    superadmin:      'Super Admin',
    admin:           'Admin',
    examofficer:     'Exam Officer',
    resultofficer:   'Result Officer',
    questionmanager: 'Question Manager',
    invigilator:     'Invigilator',
    candidate:       'Candidate',
  };

  const PERMISSION_KEYS = [
    'dashboard','questions','results','candidates','subjects',
    'exams','uploadFiles','deleteFiles','exportData',
    'createUsers','deleteUsers','viewCredentials',
    'manageCentres','manageSettings','viewAuditLogs',
    'manageExams','monitorExams',
  ];

  /* ── PERMISSION MATRIX ──────────────────────────────────────────
   * superadmin: EVERYTHING including delete + settings
   * admin:      create but CANNOT delete/change settings/delete users
   * examofficer: exams only
   * resultofficer: results only
   * questionmanager: question bank only
   * invigilator: monitor only (their own portal)
   * candidate: exam portal only
   */
  const DEFAULT_MATRIX = {
    superadmin: {
      dashboard:true, questions:true, results:true, candidates:true, subjects:true,
      exams:true, uploadFiles:true, deleteFiles:true, exportData:true,
      createUsers:true, deleteUsers:true, viewCredentials:true,
      manageCentres:true, manageSettings:true, viewAuditLogs:true,
      manageExams:true, monitorExams:true,
    },
    admin: {
      dashboard:true, questions:true, results:true, candidates:true, subjects:true,
      exams:true, uploadFiles:true, deleteFiles:false, exportData:true,
      createUsers:true, deleteUsers:false, viewCredentials:false,
      manageCentres:true, manageSettings:false, viewAuditLogs:true,
      manageExams:true, monitorExams:false,
    },
    examofficer: {
      dashboard:true, questions:false, results:false, candidates:false, subjects:false,
      exams:true, uploadFiles:false, deleteFiles:false, exportData:true,
      createUsers:false, deleteUsers:false, viewCredentials:false,
      manageCentres:false, manageSettings:false, viewAuditLogs:false,
      manageExams:true, monitorExams:false,
    },
    resultofficer: {
      dashboard:true, questions:false, results:true, candidates:false, subjects:false,
      exams:false, uploadFiles:false, deleteFiles:false, exportData:true,
      createUsers:false, deleteUsers:false, viewCredentials:false,
      manageCentres:false, manageSettings:false, viewAuditLogs:false,
      manageExams:false, monitorExams:false,
    },
    questionmanager: {
      dashboard:true, questions:true, results:false, candidates:false, subjects:true,
      exams:false, uploadFiles:true, deleteFiles:false, exportData:false,
      createUsers:false, deleteUsers:false, viewCredentials:false,
      manageCentres:false, manageSettings:false, viewAuditLogs:false,
      manageExams:false, monitorExams:false,
    },
    invigilator: {
      dashboard:false, questions:false, results:false, candidates:false, subjects:false,
      exams:false, uploadFiles:false, deleteFiles:false, exportData:false,
      createUsers:false, deleteUsers:false, viewCredentials:false,
      manageCentres:false, manageSettings:false, viewAuditLogs:false,
      manageExams:false, monitorExams:true,
    },
    candidate: {
      dashboard:false, questions:false, results:false, candidates:false, subjects:false,
      exams:false, uploadFiles:false, deleteFiles:false, exportData:false,
      createUsers:false, deleteUsers:false, viewCredentials:false,
      manageCentres:false, manageSettings:false, viewAuditLogs:false,
      manageExams:false, monitorExams:false,
    },
  };

  const ROLE_HOME = {
    superadmin:      'admin-dashboard.html',
    admin:           'admin-dashboard.html',
    examofficer:     'admin-dashboard.html',
    resultofficer:   'admin-dashboard.html',
    questionmanager: 'admin-dashboard.html',
    invigilator:     'invigilator-panel.html',
    candidate:       'candidate-dashboard.html',
  };

  const STAFF_ROLES = ['superadmin','admin','examofficer','resultofficer','questionmanager'];

  let _perms = null;

  function resolvePermissions(userDoc) {
    if (!userDoc) return {};
    const role   = userDoc.role;
    const base   = { ...(DEFAULT_MATRIX[role] || {}) };
    // superadmin is always full — cannot be downgraded client-side
    if (role === ROLES.SUPERADMIN) { PERMISSION_KEYS.forEach(k => base[k]=true); return base; }
    const overrides = userDoc.permissionOverrides || {};
    PERMISSION_KEYS.forEach(k => { if (typeof overrides[k]==='boolean') base[k]=overrides[k]; });
    return base;
  }

  function setCurrentUser(userDoc) {
    window.SD = window.SD || {};
    window.SD.currentUser = userDoc;
    _perms = resolvePermissions(userDoc);
    window.SD.permissions = _perms;
    return _perms;
  }

  function can(key) { return !!_perms?.[key]; }

  function requirePermission(key, fallback) {
    if (!can(key)) {
      location.href = fallback || ROLE_HOME[window.SD?.currentUser?.role] || '../index.html';
      return false;
    }
    return true;
  }

  /* Apply data-perm attributes to DOM */
  function applyDomGating(root) {
    const scope = root || document;
    // Hide delete buttons from non-superadmin
    const role = window.SD?.currentUser?.role;
    if (role !== 'superadmin') {
      scope.querySelectorAll('.btn-danger, [data-del]').forEach(el => {
        el.style.display = 'none';
      });
    }
    // Hide settings from non-superadmin/admin
    if (!['superadmin','admin'].includes(role)) {
      const settingsNav = scope.querySelector('[data-mod="settings"]');
      if (settingsNav) settingsNav.style.display = 'none';
    }
    // Standard data-perm gating
    scope.querySelectorAll('[data-perm]').forEach(el => {
      const key   = el.getAttribute('data-perm');
      const mode  = el.getAttribute('data-perm-mode') || 'hide';
      if (!can(key)) {
        if (mode==='disable') { el.disabled=true; el.title='Permission denied'; }
        else el.style.display = 'none';
      }
    });
  }

  /* Build nav for current user */
  function getNavItemsForCurrentUser() {
    const role = window.SD?.currentUser?.role;
    const items = [
      { mod:'dashboard',     label:'Dashboard',            perm:'dashboard' },
      { mod:'centres',       label:'Centres',              perm:'manageCentres', roles:['superadmin','admin'] },
      { mod:'exams',         label:'Exams',                perm:'manageExams' },
      { mod:'users',         label:'Staff & Roles',        perm:'createUsers',   roles:['superadmin','admin'] },
      { mod:'candidates',    label:'Candidates',           perm:'candidates' },
      { mod:'questions',     label:'Questions',            perm:'questions' },
      { mod:'subjects',      label:'Subjects & Topics',    perm:'subjects' },
      { mod:'results',       label:'Results',              perm:'results' },
      { mod:'ai',            label:'AI Generator',         perm:'questions' },
      { mod:'analytics',     label:'Analytics',            perm:'exportData' },
      { mod:'notifications', label:'Notifications',        perm:'dashboard',     roles:['superadmin','admin'] },
      { mod:'audit',         label:'Audit Logs',           perm:'viewAuditLogs', roles:['superadmin','admin'] },
      { mod:'settings',      label:'Settings',             perm:'manageSettings',roles:['superadmin'] },
    ];
    return items.filter(i => {
      if (i.roles && !i.roles.includes(role)) return false;
      return can(i.perm);
    });
  }

  return {
    ROLES, ROLE_LABELS, PERMISSION_KEYS, DEFAULT_MATRIX, ROLE_HOME, STAFF_ROLES,
    resolvePermissions, setCurrentUser, can, requirePermission,
    applyDomGating, getNavItemsForCurrentUser,
  };
})();
window.RBAC = RBAC;
