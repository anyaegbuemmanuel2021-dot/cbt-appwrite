/**
 * SOFTLY DIGITAL V3 — notification-manager.js (Appwrite edition)
 * Notifications are logged to Appwrite. Email/SMS require a server or Appwrite Function.
 */
const NotificationManager = (() => {
  'use strict';

  async function sendEmail() {
    const subject = document.getElementById('emailSubj')?.value?.trim();
    const body    = document.getElementById('emailBody')?.value?.trim();
    if (!subject || !body) { alert('Enter subject and body.'); return; }
    const recips = [...document.querySelectorAll('.notif-recips input[type=checkbox]:checked')].map(c=>c.value);
    if (!recips.length) { alert('Select at least one recipient group.'); return; }
    try {
      await _logNotif('EMAIL', subject, body, recips);
      alert('Email notification logged. Configure SMTP in Settings → Email/SMS to send real emails.');
      await loadHistory();
    } catch(e) { alert('Failed: '+e.message); }
  }

  async function sendSms() {
    const body = document.getElementById('smsBody')?.value?.trim();
    if (!body) { alert('Enter SMS message.'); return; }
    try {
      await _logNotif('SMS', body.substring(0,40), body, ['candidates']);
      alert('SMS notification logged. Configure SMS provider in Settings → Email/SMS.');
      await loadHistory();
    } catch(e) { alert('Failed: '+e.message); }
  }

  async function sendPush() {
    const title = document.getElementById('pushTitle')?.value?.trim();
    const body  = document.getElementById('pushBody')?.value?.trim();
    if (!title || !body) { alert('Enter title and body.'); return; }
    try {
      await _logNotif('PUSH', title, body, ['all']);
      alert('Push notification logged.');
      await loadHistory();
    } catch(e) { alert('Failed: '+e.message); }
  }

  async function _logNotif(type, subject, body, recipients) {
    const user = await AUTH.current();
    await DB.create(SD.COL.NOTIFICATIONS, {
      type, subject, body,
      recipients: JSON.stringify(recipients),
      status: 'logged',
      count: 0,
      sentAt: new Date().toISOString(),
      sentBy: user?.$id || 'unknown',
    });
    await audit('NOTIFICATION_SENT', { type, subject, recipients });
  }

  async function loadHistory() {
    const tbody = document.getElementById('notifHistBody'); if(!tbody) return;
    try {
      const res = await DB.list(SD.COL.NOTIFICATIONS, [SD.Q.orderDesc('sentAt')], 50);
      tbody.innerHTML = res.documents.map(n => {
        const ts = n.sentAt ? new Date(n.sentAt).toLocaleString('en-NG') : '--';
        let recips = [];
        try { recips = JSON.parse(n.recipients||'[]'); } catch(_) {}
        return `<tr>
          <td style="white-space:nowrap">${ts}</td>
          <td><span class="badge badge-info">${n.type}</span></td>
          <td>${n.subject||'—'}</td>
          <td>${recips.join(', ')||'—'}</td>
          <td><span class="badge badge-success">${n.status||'sent'}</span></td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="loading-placeholder">No notifications sent yet.</td></tr>';
    } catch(e) { tbody.innerHTML=`<tr><td colspan="5" style="color:#dc3545">${e.message}</td></tr>`; }
  }

  return { sendEmail, sendSms, sendPush, loadHistory };
})();
