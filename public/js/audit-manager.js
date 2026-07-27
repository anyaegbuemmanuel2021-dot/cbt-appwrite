/**
 * SOFTLY DIGITAL V3 — audit-manager.js (Appwrite edition)
 *
 * Shows who logged in/out (and every other tracked action) with a
 * human-readable name, not just a raw Appwrite document ID.
 */
const AuditManager = (() => {
  'use strict';
  let allLogs = [];

  const ACTION_LABELS = {
    CANDIDATE_LOGIN:    { label: 'Candidate Login',    icon: '🔓' },
    INVIGILATOR_LOGIN:  { label: 'Invigilator Login',  icon: '🔓' },
    ADMIN_LOGIN:        { label: 'Admin Login',        icon: '🔓' },
    LOGOUT:             { label: 'Logout',             icon: '🔒' },
    CANDIDATE_CREATED:  { label: 'Candidate Created',  icon: '➕' },
  };
  function actionMeta(action) {
    return ACTION_LABELS[action] || { label: (action || '—').replace(/_/g, ' '), icon: '•' };
  }
  function isLoginAction(action) { return /LOGIN/i.test(action || ''); }
  function isLogoutAction(action) { return /LOGOUT/i.test(action || ''); }

  async function load() {
    const tbody = document.getElementById('auditBody'); if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" class="loading-placeholder">Loading audit logs…</td></tr>';
    try {
      const res = await DB.list(SD.COL.AUDIT_LOGS, [SD.Q.orderDesc('timestamp')], 300);
      allLogs = res.documents.map(d => ({ id: d.$id, ...d }));
      renderTable(allLogs);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:#dc3545">${_esc(e.message)}</td></tr>`;
    }
  }

  function _who(l, meta) {
    const bits = [];
    if (meta.name)  bits.push(meta.name);
    if (meta.email) bits.push(meta.email);
    if (!bits.length) {
      const fallback = meta.candidateId || meta.staffId || meta.email || meta.uid;
      if (fallback) bits.push(fallback);
    }
    if (!bits.length) bits.push(l.userId || 'Unknown user');
    return bits.join(' — ');
  }

  function _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function renderTable(logs) {
    const tbody = document.getElementById('auditBody'); if (!tbody) return;
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="5" class="loading-placeholder">No logs found.</td></tr>'; return; }
    tbody.innerHTML = logs.map(l => {
      const ts = l.timestamp ? new Date(l.timestamp).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'medium' }) : '--';
      const sevCls = { INFO: 'badge-primary', WARNING: 'badge-warning', ERROR: 'badge-danger', CRITICAL: 'badge-danger' }[l.severity] || 'badge-gray';
      let meta = {};
      try { meta = l.meta ? JSON.parse(l.meta) : {}; } catch (_) {}
      const { label, icon } = actionMeta(l.action);
      const who = _who(l, meta);
      const { name, email, ...restMeta } = meta;
      const details = Object.keys(restMeta).length ? JSON.stringify(restMeta).substring(0, 80) : '—';
      return `<tr>
        <td style="white-space:nowrap;font-family:monospace;font-size:.8rem">${ts}</td>
        <td style="white-space:nowrap">${icon} ${_esc(label)}</td>
        <td>${_esc(who)}</td>
        <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.8rem" title="${_esc(details)}">${_esc(details)}</td>
        <td><span class="badge ${sevCls}">${l.severity || 'INFO'}</span></td>
      </tr>`;
    }).join('');
  }

  function filter() {
    const type     = document.getElementById('auditType')?.value     || 'all';
    const severity = document.getElementById('auditSeverity')?.value || 'all';
    const from     = document.getElementById('auditFrom')?.value;
    const to       = document.getElementById('auditTo')?.value;
    renderTable(allLogs.filter(l => {
      if (type === 'login') {
        if (!isLoginAction(l.action) && !isLogoutAction(l.action)) return false;
      } else if (type !== 'all' && !l.action?.toLowerCase().includes(type.toLowerCase())) {
        return false;
      }
      if (severity !== 'all' && l.severity !== severity) return false;
      if (from && new Date(l.timestamp) < new Date(from)) return false;
      if (to   && new Date(l.timestamp) > new Date(to + 'T23:59:59')) return false;
      return true;
    }));
  }

  function search(q) {
    renderTable(allLogs.filter(l => JSON.stringify(l).toLowerCase().includes(q.toLowerCase())));
  }

  async function exportLogs() {
    if (typeof XLSX === 'undefined') { alert('XLSX not loaded'); return; }
    const rows = allLogs.map(l => {
      let meta = {};
      try { meta = l.meta ? JSON.parse(l.meta) : {}; } catch (_) {}
      return {
        Timestamp: l.timestamp ? new Date(l.timestamp).toLocaleString('en-NG') : '',
        Action:    actionMeta(l.action).label,
        User:      _who(l, meta),
        Severity:  l.severity || '',
        Details:   JSON.stringify(meta).substring(0, 200),
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs');
    XLSX.writeFile(wb, `audit-logs-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return { load, filter, search, export: exportLogs };
})();
