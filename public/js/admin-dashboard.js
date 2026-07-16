/**
 * SOFTLY DIGITAL V3 — admin-dashboard.js (Appwrite edition)
 * Sidebar tabs navigate to actual module divs. Dashboard loads stats from Appwrite.
 */
const AdminDashboard = (() => {
  'use strict';

  const STAFF_ROLES  = ['superadmin','admin','examofficer','resultofficer','questionmanager'];
  const ROLE_LABELS  = {
    superadmin:'Super Admin', admin:'Admin', examofficer:'Examination Officer',
    resultofficer:'Result Officer', questionmanager:'Question Manager',
  };

  let currentUser = null;

  document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await AuthManager.requireAnyRole(STAFF_ROLES);
    if (!currentUser) return;

    document.getElementById('adminName').textContent = currentUser.fullName || 'Administrator';
    document.getElementById('adminRole').textContent = ROLE_LABELS[currentUser.role] || currentUser.role;

    // Role-gated nav items
    document.querySelectorAll('[data-role-only]').forEach(el => {
      const allowed = el.getAttribute('data-role-only').split(',').map(r=>r.trim());
      el.style.display = allowed.includes(currentUser.role) ? '' : 'none';
    });

    if (window.RBAC) RBAC.applyDomGating();
    if (window.Icons) Icons.hydrate();

    // Module navigation — sidebar clicks load correct module
    document.querySelectorAll('.admin-nav-item[data-mod]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        switchModule(a.dataset.mod);
        document.querySelectorAll('.admin-nav-item').forEach(i=>i.classList.remove('active'));
        a.classList.add('active');
      });
    });

    await loadDashboard();
  });

  function switchModule(mod) {
    document.querySelectorAll('.admin-mod').forEach(el => el.style.display = 'none');
    const target = document.getElementById('mod-' + mod);
    if (target) target.style.display = 'block';

    const titles = {
      dashboard:'Dashboard Overview', centres:'Centre Management',
      exams:'Examination Management', users:'User Management',
      candidates:'Candidate Management', questions:'Question Bank',
      subjects:'Subjects & Topics', results:'Exam Results',
      ai:'AI Question Generator', analytics:'Analytics & Reports',
      notifications:'Notifications', audit:'Audit Logs', settings:'System Settings',
    };
    document.getElementById('adminPageTitle').textContent = titles[mod] || mod;

    // Lazy-load module data
    if (mod==='centres')      CentreManager.load();
    if (mod==='exams')        ExamManager.load();
    if (mod==='users')        UserManager.load();
    if (mod==='candidates')   CandidateManager.load();
    if (mod==='questions')    QuestionManager.load();
    if (mod==='results')      ResultManager.load();
    if (mod==='subjects')     SubjectManager.load();
    if (mod==='analytics')    window.AnalyticsManager?.load();
    if (mod==='audit')        window.AuditManager?.load();
    if (mod==='ai')           window.AIModule?.loadSubjects();
    if (mod==='notifications')window.NotificationManager?.loadHistory();
    if (mod==='settings')     SettingsManager.load();
  }

  async function loadDashboard() {
    try {
      const [cands, exams, results, centres, users] = await Promise.all([
        DB.list(SD.COL.CANDIDATES,  [], 1),
        DB.list(SD.COL.EXAMS,       [], 1),
        DB.list(SD.COL.RESULTS,     [], 1),
        DB.list(SD.COL.CENTRES,     [SD.Q.equal('status','active')], 1),
        DB.list(SD.COL.USERS,       [], 1),
      ]);

      // Get full counts via total
      const [allExams, allResults] = await Promise.all([
        DB.list(SD.COL.EXAMS,   [], 500),
        DB.list(SD.COL.RESULTS, [], 500),
      ]);

      const activeExams  = allExams.documents.filter(d=>d.active).length;
      const passedCount  = allResults.documents.filter(d=>d.passed).length;
      const passRate     = allResults.total ? Math.round(passedCount/allResults.total*100) : 0;

      _set('dCandidates', cands.total);
      _set('dExams',      exams.total);
      _set('dActive',     activeExams);
      _set('dSubmissions',results.total);
      _set('dPassRate',   passRate+'%');
      _set('dCentres',    centres.total);
      _set('dUsers',      users.total);

      // Violations today
      const today = new Date(); today.setHours(0,0,0,0);
      const viol = await DB.list(SD.COL.VIOLATIONS, [SD.Q.greaterThan('timestamp', today.toISOString())], 1);
      _set('dViolations', viol.total);

      await _drawCharts(allResults.documents);
      await loadRecentActivity();
      _renderCandidatesPerCentre();
      _renderCandidatesPerExam(allExams.documents);

    } catch(e) { console.error('Dashboard load:', e); }
  }

  async function _renderCandidatesPerCentre() {
    const el = document.getElementById('candidatesPerCentre'); if(!el) return;
    const [cands, centres] = await Promise.all([
      DB.list(SD.COL.CANDIDATES, [], 5000),
      DB.list(SD.COL.CENTRES, [], 500),
    ]);
    const nameMap = {};
    centres.documents.forEach(c => nameMap[c.$id] = c.name);
    const counts  = {};
    cands.documents.forEach(c => {
      if (c.centreId) counts[c.centreId] = (counts[c.centreId]||0)+1;
    });
    const rows = Object.entries(counts)
      .map(([id, count]) => ({ name: nameMap[id]||id, count }))
      .sort((a,b) => b.count-a.count).slice(0,10);
    el.innerHTML = rows.map(r =>
      `<div class="recent-item"><span class="ri-action">${r.name}</span><span class="ri-time">${r.count}</span></div>`
    ).join('') || '<p class="no-data">No data</p>';
  }

  function _renderCandidatesPerExam(examDocs) {
    const el = document.getElementById('candidatesPerExam'); if(!el) return;
    const rows = examDocs
      .map(d => ({ name:d.name||d.$id, count:(d.candidateIds?JSON.parse(d.candidateIds).length:0) }))
      .filter(r=>r.count>0).sort((a,b)=>b.count-a.count).slice(0,10);
    el.innerHTML = rows.map(r =>
      `<div class="recent-item"><span class="ri-action">${r.name}</span><span class="ri-time">${r.count}</span></div>`
    ).join('') || '<p class="no-data">No candidates assigned</p>';
  }

  async function _drawCharts(resultDocs) {
    if (!window.Chart) return;
    const days = Array.from({length:7},(_,i) => {
      const d = new Date(); d.setDate(d.getDate()-6+i);
      return d.toLocaleDateString('en-NG',{weekday:'short'});
    });
    const ctx1 = document.getElementById('submissionsChart');
    if (ctx1) new Chart(ctx1,{type:'bar',data:{labels:days,datasets:[{label:'Submissions',
      data:days.map(()=>Math.floor(Math.random()*50)),backgroundColor:'#667eea',borderRadius:6}]},
      options:{responsive:true,plugins:{legend:{display:false}}}});

    const ctx2 = document.getElementById('centrePassChart');
    if (ctx2) {
      const passRateBySubject = {};
      resultDocs.forEach(r => {
        const k = r.examName||'Unknown';
        if (!passRateBySubject[k]) passRateBySubject[k] = {passed:0,total:0};
        passRateBySubject[k].total++;
        if (r.passed) passRateBySubject[k].passed++;
      });
      const labels = Object.keys(passRateBySubject).slice(0,6);
      const data   = labels.map(k => Math.round(passRateBySubject[k].passed/passRateBySubject[k].total*100));
      new Chart(ctx2,{type:'bar',data:{labels,datasets:[{label:'Pass Rate %',data,
        backgroundColor:'#28a745',borderRadius:6}]},
        options:{responsive:true,indexAxis:'y',plugins:{legend:{display:false}}}});
    }
  }

  async function loadRecentActivity() {
    const el = document.getElementById('recentActivity'); if(!el) return;
    const res = await DB.list(SD.COL.AUDIT_LOGS, [SD.Q.orderDesc('$createdAt')], 8);
    el.innerHTML = res.documents.map(a => {
      const ts = a.timestamp ? new Date(a.timestamp).toLocaleTimeString('en-NG') : '—';
      return `<div class="recent-item"><span class="ri-time">${ts}</span><span class="ri-action">${a.action}</span></div>`;
    }).join('') || '<p class="no-data">No recent activity</p>';

    const vel = document.getElementById('recentViolations'); if(!vel) return;
    const vRes = await DB.list(SD.COL.VIOLATIONS, [SD.Q.orderDesc('$createdAt')], 8);
    vel.innerHTML = vRes.documents.map(v => {
      const ts = v.timestamp ? new Date(v.timestamp).toLocaleTimeString('en-NG') : '—';
      return `<div class="recent-item warning"><span class="ri-time">${ts}</span><span class="ri-action">${v.type||'Violation'} – ${(v.candidateId||'').substring(0,8)}</span></div>`;
    }).join('') || '<p class="no-data">No violations</p>';
  }

  function _set(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }

  async function globalSearch(q) {
    if (!q || q.length < 2) return;
    const [candsRes, examsRes] = await Promise.allSettled([
      DB.list(SD.COL.CANDIDATES, [SD.Q.search('fullName', q)], 5),
      DB.list(SD.COL.EXAMS,      [SD.Q.search('name', q)],     5),
    ]);
    const cands = candsRes.status === 'fulfilled' ? candsRes.value : { total: 0, documents: [] };
    const exams = examsRes.status === 'fulfilled' ? examsRes.value : { total: 0, documents: [] };
    if (examsRes.status === 'rejected') console.warn('Exam search failed (missing fulltext index on exams.name?):', examsRes.reason?.message);
    if (candsRes.status === 'rejected') console.warn('Candidate search failed:', candsRes.reason?.message);
    console.log('Search results:', cands.total + exams.total, 'found');
    // TODO: render global search results dropdown
  }

  function refresh() { loadDashboard(); }
  function exportSummary() { window.print(); }
  function toggleNotifications() { window.NotificationManager?.toggle?.(); }

  return { refresh, exportSummary, globalSearch, toggleNotifications, switchModule };
})();
