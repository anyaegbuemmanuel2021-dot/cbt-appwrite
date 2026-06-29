/**
 * SOFTLY DIGITAL V3 — invigilator-panel.js (Appwrite edition)
 * Invigilators ONLY see: live monitoring, candidates, violations, activity log.
 * No exam management, no candidates edit — monitor only.
 */
const InvigilatorPanel = (() => {
  'use strict';

  let currentUser   = null;
  let currentExamId = null;
  let pollTimer     = null;
  let clockTimer    = null;

  document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await AuthManager.requireRole('invigilator');
    if (!currentUser) return;

    document.getElementById('invigiName').textContent   = currentUser.fullName || 'Invigilator';
    document.getElementById('invigiCentre').textContent = currentUser.centreName || '—';

    // Clock
    clockTimer = setInterval(() => {
      const cl = document.getElementById('invigiClock');
      if (cl) cl.textContent = new Date().toLocaleTimeString('en-NG');
    }, 1000);

    await loadActiveExams();
    if (window.Icons) Icons.hydrate();

    // Check URL for pre-selected exam
    const params = new URLSearchParams(location.search);
    const preExam = params.get('exam');
    if (preExam) {
      const sel = document.getElementById('activeExamSel');
      if (sel) { sel.value = preExam; changeExam(preExam); }
    }

    // Sidebar nav
    document.querySelectorAll('.in-item').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const panel = a.dataset.panel;
        document.querySelectorAll('.invigi-panel').forEach(p => p.style.display='none');
        document.querySelectorAll('.in-item').forEach(i => i.classList.remove('active'));
        const target = document.getElementById('panel-'+panel);
        if (target) target.style.display = 'block';
        a.classList.add('active');
        document.getElementById('invigiPageTitle').textContent =
          { live:'Live Exam Monitoring', candidates:'Candidates', violations:'Violations Log', activity:'Activity Log' }[panel] || panel;
        if (panel==='candidates') loadCandidatesTable();
        if (panel==='violations') loadViolationsTable();
        if (panel==='activity')   loadActivityLog();
      });
    });
  });

  async function loadActiveExams() {
    const sel = document.getElementById('activeExamSel'); if (!sel) return;
    try {
      // Load all active exams — filter by centreId if set
      const queries = [SD.Q.equal('active', true), SD.Q.orderAsc('name')];
      const res = await DB.list(SD.COL.EXAMS, queries, 100);
      // Filter by invigilator's centre if assigned
      let exams = res.documents;
      if (currentUser.centreId) {
        exams = exams.filter(e => {
          const ids = e.centreIds ? JSON.parse(e.centreIds) : [];
          return !ids.length || ids.includes(currentUser.centreId);
        });
      }
      sel.innerHTML = '<option value="">-- Select Active Exam --</option>';
      exams.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.$id; opt.textContent = e.name;
        sel.appendChild(opt);
      });
      if (!exams.length) sel.innerHTML = '<option value="">No active exams</option>';
    } catch(err) { console.error('loadActiveExams:', err); }
  }

  function changeExam(examId) {
    if (pollTimer) clearInterval(pollTimer);
    currentExamId = examId;
    if (!examId) {
      document.getElementById('candidateGrid').innerHTML = '<div class="loading-placeholder">Select an active exam to begin monitoring.</div>';
      return;
    }
    _loadDuration(examId);
    startLivePoll(examId);
  }

  async function _loadDuration(examId) {
    try {
      const ex = await DB.get(SD.COL.EXAMS, examId);
      const inp = document.getElementById('examDurationInput');
      const btn = document.getElementById('saveDurationBtn');
      if (inp) { inp.value = ex.duration || 60; inp.disabled = false; }
      if (btn) btn.disabled = false;
      // Time remaining in exam
      const left = document.getElementById('liveTimeLeft');
      if (left && ex.activatedAt) {
        const elapsed = Math.floor((Date.now() - new Date(ex.activatedAt).getTime()) / 1000);
        const remaining = Math.max(0, ex.duration*60 - elapsed);
        const m = Math.floor(remaining/60), s = remaining%60;
        left.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      }
    } catch(_) {}
  }

  async function saveDuration() {
    if (!currentExamId) return;
    const val = parseInt(document.getElementById('examDurationInput')?.value);
    if (!val || val < 1) { alert('Enter a valid duration.'); return; }
    try {
      await DB.update(SD.COL.EXAMS, currentExamId, {
        duration: val,
        durationUpdatedAt: new Date().toISOString(),
        durationUpdatedBy: currentUser.uid,
      });
      await audit('EXAM_DURATION_UPDATED', { examId:currentExamId, duration:val }, 'WARNING');
      alert(`Duration updated to ${val} minutes. Applies to candidates who have not yet started.`);
    } catch(e) { alert('Failed: '+e.message); }
  }

  /* Poll sessions every 5 seconds for live monitoring */
  function startLivePoll(examId) {
    _fetchSessions(examId);
    pollTimer = setInterval(() => _fetchSessions(examId), 5000);
  }

  async function _fetchSessions(examId) {
    try {
      const res = await DB.list(SD.COL.SESSIONS, [SD.Q.equal('examId', examId)], 500);
      updateLiveStats(res.documents);
      renderCandidateGrid(res.documents);
    } catch(_) {}
  }

  function updateLiveStats(sessions) {
    const total     = sessions.length;
    const active    = sessions.filter(s => s.status==='active').length;
    const submitted = sessions.filter(s => s.status==='submitted' || (s.status||'').startsWith('auto')).length;
    const violations= sessions.reduce((a,s) => a+(s.violations||0), 0);
    const s = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    s('liveTotal',      total);
    s('liveActive',     active);
    s('liveSubmitted',  submitted);
    s('liveViolations', violations);
  }

  function renderCandidateGrid(sessions) {
    const grid = document.getElementById('candidateGrid'); if (!grid) return;
    if (!sessions.length) {
      grid.innerHTML = '<div class="loading-placeholder">No candidates have started yet.</div>'; return;
    }
    grid.innerHTML = sessions.map(s => {
      const answers  = s.answers ? JSON.parse(s.answers) : {};
      const answered = Object.values(answers).filter(Boolean).length;
      const total    = s.questionIds ? JSON.parse(s.questionIds).length : 0;
      const pct      = total ? Math.round(answered/total*100) : 0;
      const statusCls= s.status==='active'?'card-active':s.status==='submitted'?'card-submitted':(s.violations||0)>0?'card-danger':'';
      const barColor = pct>70?'#28a745':pct>40?'#ffc107':'#667eea';
      return `<div class="cand-grid-card ${statusCls}" onclick="InvigilatorPanel.viewCandidate('${s.candidateId}','${s.$id}')">
        <div class="cgc-header">
          <div class="cgc-id">${(s.candidateId||'').substring(0,12)}</div>
          <div class="cgc-status">${s.status||'active'}</div>
        </div>
        <div class="cgc-progress">
          <div class="cgc-pbar"><div style="width:${pct}%;background:${barColor};height:100%;border-radius:999px;transition:width .5s"></div></div>
          <span>${answered}/${total}</span>
        </div>
        ${(s.violations||0)>0?`<div class="cgc-violations">⚠️ ${s.violations} violation${s.violations>1?'s':''}</div>`:''}
        <div class="cgc-time">${s.lastSynced ? new Date(s.lastSynced).toLocaleTimeString('en-NG') : '--'}</div>
      </div>`;
    }).join('');
  }

  async function loadCandidatesTable() {
    if (!currentExamId) { document.getElementById('candTableBody').innerHTML='<tr><td colspan="7" class="loading-placeholder">Select an exam first.</td></tr>'; return; }
    const tbody = document.getElementById('candTableBody'); if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">Loading…</td></tr>';
    try {
      const [sesRes, candRes] = await Promise.all([
        DB.list(SD.COL.SESSIONS, [SD.Q.equal('examId', currentExamId)], 500),
        DB.list(SD.COL.CANDIDATES, [], 5000),
      ]);
      const candMap = {};
      candRes.documents.forEach(c => candMap[c.$id] = c);
      tbody.innerHTML = sesRes.documents.map(s => {
        const cand     = candMap[s.candidateId] || {};
        const answers  = s.answers ? JSON.parse(s.answers) : {};
        const answered = Object.values(answers).filter(Boolean).length;
        const total    = s.questionIds ? JSON.parse(s.questionIds).length : 0;
        return `<tr>
          <td><img src="${cand.passportImageUrl||'../assets/images/default-avatar.png'}" class="table-photo" alt="Photo" loading="lazy"></td>
          <td>${cand.candidateId||s.candidateId?.substring(0,10)||'—'}</td>
          <td>${cand.fullName||'—'}</td>
          <td><span class="badge ${s.status==='active'?'badge-success':'badge-gray'}">${s.status||'—'}</span></td>
          <td><span class="${(s.violations||0)>0?'badge badge-danger':''}">${s.violations||0}</span></td>
          <td>${answered}/${total} (${total?Math.round(answered/total*100):0}%)</td>
          <td><button class="btn-outline-sm" onclick="InvigilatorPanel.viewCandidate('${s.candidateId}','${s.$id}')">👁 View</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="7" class="loading-placeholder">No candidates found.</td></tr>';
    } catch(e) { tbody.innerHTML=`<tr><td colspan="7" style="color:red">${e.message}</td></tr>`; }
  }

  async function loadViolationsTable() {
    if (!currentExamId) return;
    const tbody = document.getElementById('violTableBody'); if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="loading-placeholder">Loading…</td></tr>';
    try {
      const res = await DB.list(SD.COL.VIOLATIONS, [
        SD.Q.equal('examId', currentExamId),
        SD.Q.orderDesc('timestamp'),
      ], 200);
      if (!res.documents.length) {
        tbody.innerHTML='<tr><td colspan="6" class="loading-placeholder">No violations recorded.</td></tr>'; return;
      }
      tbody.innerHTML = res.documents.map(v => {
        const ts = v.timestamp ? new Date(v.timestamp).toLocaleTimeString('en-NG') : '--';
        const sev = v.severity==='CRITICAL'?'badge-danger':v.severity==='HIGH'?'badge-warning':'badge-info';
        return `<tr>
          <td>${ts}</td>
          <td>${(v.candidateId||'—').substring(0,12)}</td>
          <td>${v.type||'—'}</td>
          <td><span class="badge ${sev}">${v.severity||'—'}</span></td>
          <td>${v.violations||1}</td>
          <td><button class="btn-outline-sm" onclick="InvigilatorPanel.viewCandidate('${v.candidateId}','${v.sessionId||''}')">View</button></td>
        </tr>`;
      }).join('');
    } catch(e) { tbody.innerHTML=`<tr><td colspan="6">${e.message}</td></tr>`; }
  }

  async function loadActivityLog() {
    const container = document.getElementById('activityLog'); if(!container) return;
    if (!currentExamId) { container.innerHTML='<p class="no-data">Select an exam first.</p>'; return; }
    container.innerHTML = '<div class="loading-placeholder">Loading…</div>';
    try {
      const filter = document.getElementById('actFilter')?.value || 'all';
      const queries = [SD.Q.orderDesc('timestamp')];
      const res = await DB.list(SD.COL.AUDIT_LOGS, queries, 200);
      const items = res.documents.filter(a => {
        if (filter==='all') return true;
        if (filter==='login') return a.action?.includes('LOGIN');
        if (filter==='submit') return a.action?.includes('SUBMIT');
        if (filter==='violation') return a.action?.includes('VIOLATION')||a.action?.includes('VIOL');
        return true;
      });
      if (!items.length) { container.innerHTML='<p class="no-data">No activity yet.</p>'; return; }
      container.innerHTML = items.map(a => {
        const ts = a.timestamp ? new Date(a.timestamp).toLocaleTimeString('en-NG') : '--';
        const meta = a.meta ? (() => { try { return JSON.parse(a.meta); } catch(_){ return {}; } })() : {};
        return `<div class="activity-item">
          <span class="act-time">${ts}</span>
          <span class="act-action badge badge-${a.severity==='INFO'?'primary':'warning'}">${a.action}</span>
          <span class="act-detail">${meta.candidateId||meta.uid||'—'}</span>
        </div>`;
      }).join('');
    } catch(e) { container.innerHTML=`<p class="error">${e.message}</p>`; }
  }

  async function viewCandidate(candidateId, sessionId) {
    const modal   = document.getElementById('candDetailModal');
    const content = document.getElementById('candDetailContent');
    const titleEl = document.getElementById('cdModalTitle');
    if (!modal||!content) return;
    modal.style.display='flex';
    content.innerHTML='<div class="loading-placeholder">Loading…</div>';
    try {
      const [cand, ses, vRes] = await Promise.all([
        DB.get(SD.COL.CANDIDATES, candidateId).catch(()=>({})),
        sessionId ? DB.get(SD.COL.SESSIONS, sessionId).catch(()=>({})) : Promise.resolve({}),
        DB.list(SD.COL.VIOLATIONS, [SD.Q.equal('candidateId', candidateId)], 50),
      ]);
      if (titleEl) titleEl.textContent = cand.fullName || candidateId;
      const answers  = ses.answers ? JSON.parse(ses.answers) : {};
      const qIds     = ses.questionIds ? JSON.parse(ses.questionIds) : [];
      const answered = Object.values(answers).filter(Boolean).length;
      content.innerHTML = `
        <div class="cand-detail-grid">
          <div class="cd-photo"><img src="${cand.passportImageUrl||'../assets/images/default-avatar.png'}" alt="Photo" style="width:90px;height:90px;border-radius:8px;object-fit:cover"></div>
          <div class="cd-info">
            <p><strong>Name:</strong> ${cand.fullName||'—'}</p>
            <p><strong>Candidate ID:</strong> ${cand.candidateId||'—'}</p>
            <p><strong>Centre:</strong> ${cand.centreName||'—'}</p>
            <p><strong>Status:</strong> <span class="badge ${ses.status==='active'?'badge-success':'badge-gray'}">${ses.status||'—'}</span></p>
            <p><strong>Progress:</strong> ${answered}/${qIds.length} (${qIds.length?Math.round(answered/qIds.length*100):0}%)</p>
            <p><strong>Violations:</strong> <strong class="${(ses.violations||0)>0?'badge badge-danger':''}">${ses.violations||0}</strong></p>
            <p><strong>Last Sync:</strong> ${ses.lastSynced?new Date(ses.lastSynced).toLocaleTimeString('en-NG'):'—'}</p>
          </div>
        </div>
        <h4 style="margin:16px 0 10px;font-size:.9rem">Violations (${vRes.total})</h4>
        <div class="cd-violations">
          ${vRes.documents.length
            ? vRes.documents.map(v=>`<div class="cd-viol-item">
                <span class="badge badge-${v.severity==='CRITICAL'?'danger':v.severity==='HIGH'?'warning':'info'}">${v.type}</span>
                <span style="font-size:.8rem;margin-left:8px">${v.message||''}</span>
                <span style="font-size:.75rem;color:#6c757d;margin-left:auto">${v.timestamp?new Date(v.timestamp).toLocaleTimeString('en-NG'):'—'}</span>
              </div>`).join('')
            : '<p class="no-data">No violations recorded for this candidate.</p>'}
        </div>`;
    } catch(e) { content.innerHTML=`<p class="error">${e.message}</p>`; }
  }

  function filterGrid(q) {
    document.querySelectorAll('.cand-grid-card').forEach(card =>
      card.style.display = card.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none');
  }

  function filterStatus(status) {
    document.querySelectorAll('.cand-grid-card').forEach(card => {
      if (status==='all') { card.style.display=''; return; }
      if (status==='active')     card.style.display=card.classList.contains('card-active')?'':'none';
      if (status==='submitted')  card.style.display=card.classList.contains('card-submitted')?'':'none';
      if (status==='violation')  card.style.display=card.classList.contains('card-danger')?'':'none';
      if (status==='disconnected') card.style.display='none'; // Appwrite doesn't have realtime by default
    });
  }

  function filterActivity() { loadActivityLog(); }
  function refresh() { if (currentExamId) changeExam(currentExamId); else loadActiveExams(); }

  async function exportList() {
    if (!window.XLSX) { alert('XLSX not loaded.'); return; }
    const tbody = document.getElementById('candTableBody');
    if (!tbody) return;
    const rows = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.cells];
      if (cells.length < 6) return;
      rows.push({ ID: cells[1]?.textContent, Name: cells[2]?.textContent, Status: cells[3]?.textContent, Violations: cells[4]?.textContent, Progress: cells[5]?.textContent });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    XLSX.writeFile(wb, `candidates-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  async function exportViolations() {
    if (!window.XLSX) { alert('XLSX not loaded.'); return; }
    if (!currentExamId) { alert('Select an exam first.'); return; }
    const res = await DB.list(SD.COL.VIOLATIONS, [SD.Q.equal('examId', currentExamId)], 500);
    const rows = res.documents.map(v => ({
      Time: v.timestamp ? new Date(v.timestamp).toLocaleString() : '—',
      Candidate: v.candidateId || '—',
      Type: v.type, Severity: v.severity, Count: v.violations, Message: v.message,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Violations');
    XLSX.writeFile(wb, `violations-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function exportActivity() { exportList(); }

  return {
    loadActiveExams, changeExam, saveDuration,
    viewCandidate, filterGrid, filterStatus, filterActivity,
    refresh, exportList, exportViolations, exportActivity,
  };
})();
