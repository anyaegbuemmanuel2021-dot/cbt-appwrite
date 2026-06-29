/**
 * SOFTLY DIGITAL V3 — notifications.js (Appwrite edition)
 * Bell icon notification panel for candidates/staff.
 * Uses Appwrite polling (no realtime needed).
 */
const NotificationsUI = (() => {
  'use strict';
  let pollTimer = null;

  async function init(userId) {
    if (!userId) return;
    await _fetchNotifs(userId);
    // Poll every 60s
    pollTimer = setInterval(() => _fetchNotifs(userId), 60000);
  }

  async function _fetchNotifs(userId) {
    try {
      const res = await DB.list(SD.COL.NOTIFICATIONS, [
        SD.Q.orderDesc('sentAt'),
      ], 20);
      const unread  = res.documents.filter(n => !n.readBy?.includes(userId));
      const badge   = document.getElementById('notifBadge') || document.getElementById('adminNotifBadge');
      if (badge) { badge.textContent = unread.length; badge.style.display = unread.length ? 'flex' : 'none'; }
      const list = document.getElementById('notifList');
      if (list) {
        list.innerHTML = res.documents.length
          ? res.documents.map(n => {
              const ts = n.sentAt ? new Date(n.sentAt).toLocaleTimeString('en-NG') : '--';
              const read = (n.readBy||[]).includes(userId);
              return `<div class="notif-item ${read?'read':''}" style="padding:10px 14px;border-bottom:1px solid #f0f0f0;cursor:pointer;${read?'opacity:.6':''}">
                <div style="font-weight:600;font-size:.875rem">${n.subject||'Notification'}</div>
                <div style="font-size:.8rem;color:#6c757d;margin-top:2px">${(n.body||'').substring(0,80)}</div>
                <div style="font-size:.75rem;color:#adb5bd;margin-top:4px">${ts}</div>
              </div>`;
            }).join('')
          : '<p style="text-align:center;padding:20px;color:#6c757d;font-size:.85rem">No notifications</p>';
      }
    } catch(_) {}
  }

  function toggle() {
    let panel = document.getElementById('notifDropdown');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'notifDropdown';
      panel.style.cssText = 'position:fixed;top:64px;right:16px;width:320px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15);z-index:9999;overflow:hidden;border:1px solid #e9ecef;max-height:400px;overflow-y:auto';
      panel.innerHTML = '<div style="padding:12px 16px;font-weight:700;border-bottom:1px solid #e9ecef;font-size:.9rem">🔔 Notifications</div><div id="notifList"><div style="text-align:center;padding:20px;color:#6c757d">Loading…</div></div>';
      document.body.appendChild(panel);
      document.addEventListener('click', e => {
        if (!panel.contains(e.target) && !e.target.closest('.admin-notif,.notif-bell')) {
          panel.remove();
        }
      }, { once:true });
    } else {
      panel.remove();
    }
  }

  function stop() { clearInterval(pollTimer); }

  return { init, toggle, stop };
})();

window.toggleNotifs = () => NotificationsUI.toggle();
