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
        // No-op on desktop (the sidebar has no 'open' behaviour above the
        // mobile breakpoint); on phones/tablets this closes the overlay
        // sidebar so the module you just picked isn't hidden behind it.
        window.toggleAdminSidebar?.(false);
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
    // NOTE: these modules are declared as top-level `const X = (()=>{...})()`
    // in their own script files. A top-level const/let NEVER attaches to
    // `window` (unlike var or a function declaration), so `window.X` is
    // always undefined even though the plain identifier `X` works fine —
    // that's why analytics/audit/ai/notifications silently never loaded
    // while the tabs above (which call the identifier directly) did.
    if (mod==='analytics')    _safeLoad('AnalyticsManager', () => AnalyticsManager.load());
    if (mod==='audit')        _safeLoad('AuditManager',      () => AuditManager.load());
    if (mod==='ai')           _safeLoad('AIModule',           () => AIModule.loadSubjects());
    if (mod==='notifications')_safeLoad('NotificationManager', () => NotificationManager.loadHistory());
    if (mod==='settings')     SettingsManager.load();
  }

  // Looks the module up by its plain identifier (not `window.`, see note
  // above) so a genuinely-missing script fails loudly instead of silently.
  function _safeLoad(globalName, fn) {
    try {
      fn();
    } catch (err) {
      console.error('[AdminDashboard] ' + globalName + ' failed to load/run:', err.message || err);
    }
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
        // FIX: unordered — with more than 500 results ever recorded, this
        // silently returned the OLDEST 500 (Appwrite's default order),
        // so "recent activity" charts and the pass-rate stat could be
        // computed from ancient data instead of what actually happened
        // this week. Order newest-first so recent submissions are always
        // included.
        DB.list(SD.COL.RESULTS, [SD.Q.orderDesc('createdAt')], 500),
      ]);

      const activeExams  = allExams.documents.filter(d=>d.active).length;
      // FIX: this used to be `allResults.documents.filter(passed).length /
      // allResults.total` — the numerator only ever covered a 500-row
      // sample while the denominator was the TRUE total, so once a centre
      // had more than 500 results ever recorded, the displayed pass rate
      // was mathematically wrong (understated). Get the real passed count
      // via its own totals-only query so both sides of the ratio agree.
      const passedTotalRes = await DB.list(SD.COL.RESULTS, [SD.Q.equal('passed', true)], 1);
      const passRate = results.total ? Math.round(passedTotalRes.total / results.total * 100) : 0;

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

  let _chartInstances = {};
  function _destroyAndCreate(canvasId, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (_chartInstances[canvasId]) { _chartInstances[canvasId].destroy(); }
    else { const existing = Chart.getChart(ctx); if (existing) existing.destroy(); }
    _chartInstances[canvasId] = new Chart(ctx, config);
  }

  async function _drawCharts(resultDocs) {
    if (!window.Chart) return;

    // Build the last 7 calendar days as YYYY-MM-DD keys (for accurate
    // counting) alongside their display labels.
    const dayKeys   = [];
    const dayLabels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      dayKeys.push(d.toISOString().slice(0, 10));
      dayLabels.push(d.toLocaleDateString('en-NG', { weekday: 'short' }));
    }
    // FIX: this chart used to be `Math.floor(Math.random()*50)` — pure
    // fake data with no connection to real submissions at all. Count
    // actual results per day instead.
    const countsByDay = {};
    resultDocs.forEach(r => {
      if (!r.createdAt) return;
      const key = r.createdAt.slice(0, 10);
      countsByDay[key] = (countsByDay[key] || 0) + 1;
    });
    const submissionCounts = dayKeys.map(k => countsByDay[k] || 0);

    _destroyAndCreate('submissionsChart', {type:'bar',data:{labels:dayLabels,datasets:[{label:'Submissions',
      data:submissionCounts,backgroundColor:'#667eea',borderRadius:6}]},
      options:{responsive:true,plugins:{legend:{display:false}}}});

    const passRateBySubject = {};
    resultDocs.forEach(r => {
      const k = r.examName||'Unknown';
      if (!passRateBySubject[k]) passRateBySubject[k] = {passed:0,total:0};
      passRateBySubject[k].total++;
      if (r.passed) passRateBySubject[k].passed++;
    });
    const labels = Object.keys(passRateBySubject).slice(0,6);
    const data   = labels.map(k => Math.round(passRateBySubject[k].passed/passRateBySubject[k].total*100));
    _destroyAndCreate('centrePassChart', {type:'bar',data:{labels,datasets:[{label:'Pass Rate %',data,
      backgroundColor:'#28a745',borderRadius:6}]},
      options:{responsive:true,indexAxis:'y',plugins:{legend:{display:false}}}});
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

    // Each collection is queried independently so a missing/failed index on
    // one collection (e.g. no fulltext index yet) doesn't take down the rest
    // of the search — this was the cause of the 400 error on /exams search.
    const [cands, exams] = await Promise.allSettled([
      DB.list(SD.COL.CANDIDATES, [SD.Q.search('fullName', q)], 5),
      DB.list(SD.COL.EXAMS,      [SD.Q.search('name', q)],     5),
    ]);

    if (cands.status === 'rejected') console.warn('Candidate search failed:', cands.reason?.message);
    if (exams.status === 'rejected') console.warn('Exam search failed:', exams.reason?.message);

    const candDocs = cands.status === 'fulfilled' ? cands.value.documents : [];
    const examDocs = exams.status === 'fulfilled' ? exams.value.documents : [];

    const dropdown = document.getElementById('globalSearchResults');
    if (!dropdown) return;

    const rows = [
      ...candDocs.map(c => `<a class="gs-row" href="admin-dashboard.html?module=candidates"><span>👤</span> ${c.fullName || 'Unnamed candidate'}</a>`),
      ...examDocs.map(e => `<a class="gs-row" href="admin-dashboard.html?module=exams"><span>📝</span> ${e.name || 'Unnamed exam'}</a>`),
    ];
    dropdown.innerHTML = rows.join('') || '<div class="gs-row gs-empty">No results found.</div>';
    dropdown.style.display = 'block';
  }

  document.addEventListener('click', e => {
    const wrap = document.querySelector('.global-search-wrap');
    const dropdown = document.getElementById('globalSearchResults');
    if (wrap && dropdown && !wrap.contains(e.target)) dropdown.style.display = 'none';
  });

  function refresh() { loadDashboard(); }
  function exportSummary() { window.print(); }
  function toggleNotifications() { window.NotificationManager?.toggle?.(); }

  /* ── RIGHT-HAND SCROLL RAIL ──────────────────────────────────────── */
  let _railTarget = null;
  function _initScrollRail() {
    const rail  = document.getElementById('scrollRail');
    const up    = document.getElementById('scrollRailUp');
    const down  = document.getElementById('scrollRailDown');
    const thumb = document.getElementById('scrollRailThumb');
    if (!rail) return;

    function currentMod() { return document.querySelector('.admin-mod[style*="block"]') || document.getElementById('mod-dashboard'); }

    function updateThumb() {
      const el = _railTarget; if (!el) return;
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable <= 4) { rail.classList.remove('visible'); return; }
      rail.classList.add('visible');
      const trackH = thumb.parentElement.clientHeight;
      const thumbH = Math.max(20, trackH * (el.clientHeight / el.scrollHeight));
      const top    = (el.scrollTop / scrollable) * (trackH - thumbH);
      thumb.style.height = thumbH + 'px';
      thumb.style.top    = top + 'px';
    }

    function bind(el) {
      if (_railTarget === el) return;
      if (_railTarget) _railTarget.removeEventListener('scroll', updateThumb);
      _railTarget = el;
      if (_railTarget) { _railTarget.addEventListener('scroll', updateThumb, { passive:true }); updateThumb(); }
    }

    up.addEventListener('click', () => _railTarget?.scrollTo({ top:0, behavior:'smooth' }));
    down.addEventListener('click', () => _railTarget?.scrollTo({ top:_railTarget.scrollHeight, behavior:'smooth' }));
    window.addEventListener('resize', updateThumb);

    bind(currentMod());
    // Re-bind whenever a module becomes visible (switchModule toggles display)
    const obs = new MutationObserver(() => bind(currentMod()));
    document.querySelectorAll('.admin-mod').forEach(m => obs.observe(m, { attributes:true, attributeFilter:['style'] }));
    // Data changes size of content after async loads — recheck shortly after
    setInterval(updateThumb, 1000);
  }
  document.addEventListener('DOMContentLoaded', _initScrollRail);

  return { refresh, exportSummary, globalSearch, toggleNotifications, switchModule };
})();
