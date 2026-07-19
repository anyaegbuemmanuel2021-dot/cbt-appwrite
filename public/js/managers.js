/**
 * SOFTLY DIGITAL V3 — centre-manager.js (Appwrite edition)
 * No duplicates · Cloudinary images optional · Dropdown syncs everywhere
 */
const CentreManager = (() => {
  'use strict';
  let editingId      = null;
  let allCentres     = [];
  let candidateCounts= {};
  let filtered       = [];
  let currentPage     = 0;
  const PAGE_SIZE      = 10;

  async function load() {
    const tbody = document.getElementById('centresBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">Loading centres…</td></tr>';
    try {
      const [centresRes, candidatesRes] = await Promise.all([
        DB.list(SD.COL.CENTRES, [SD.Q.orderAsc('name')], 500),
        DB.list(SD.COL.CANDIDATES, [], 5000),   // tally per centre
      ]);
      allCentres = centresRes.documents.map(d => ({ id: d.$id, ...d }));
      candidateCounts = {};
      candidatesRes.documents.forEach(d => {
        const cid = d.centreId;
        if (cid) candidateCounts[cid] = (candidateCounts[cid] || 0) + 1;
      });
      renderTable(allCentres);
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#dc3545">${e.message}</td></tr>`;
    }
  }

  /* renderTable() is the public entry point used by load()/filter()/filterStatus() —
     it resets to page 1 and stores the filtered list; _renderPage() draws the current page. */
  function renderTable(centres) {
    filtered = centres;
    currentPage = 0;
    _renderPage();
  }

  function goToPage(p) { currentPage = p; _renderPage(); }

  function _renderPage() {
    const tbody = document.getElementById('centresBody'); if(!tbody) return;
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 0), totalPages - 1);
    const start = currentPage * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    if (!pageItems.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">No centres found.</td></tr>';
    } else {
      tbody.innerHTML = pageItems.map(c => {
        const count    = candidateCounts[c.id] || 0;
        const cap      = c.capacity || 0;
        const over     = cap > 0 && count > cap;
        return `<tr>
          <td><strong>${_esc(c.code||'—')}</strong></td>
          <td>${_esc(c.name)}</td>
          <td>${_esc(c.state||'—')}</td>
          <td>${cap||'—'}</td>
          <td><span class="${over?'badge badge-danger':''}">${count}${cap?` / ${cap}`:''}</span></td>
          <td><span class="badge ${c.status==='active'?'badge-success':'badge-gray'}">${c.status||'inactive'}</span></td>
          <td class="action-cell">
            <button class="btn-outline-sm" onclick="CentreManager.showEdit('${c.id}')">✏️ Edit</button>
            <button class="btn-danger btn-xs" onclick="CentreManager.toggleStatus('${c.id}','${c.status}')">
              ${c.status==='active'?'⛔ Deactivate':'✅ Activate'}
            </button>
          </td>
        </tr>`;
      }).join('');
    }
    _renderPagination(totalItems, totalPages);
  }

  function _renderPagination(totalItems, totalPages) {
    const wrap = document.getElementById('centresPagination'); if(!wrap) return;
    const shown = Math.max(0, Math.min(PAGE_SIZE, totalItems - currentPage * PAGE_SIZE));
    wrap.innerHTML = `
      <div class="pagination-info">Showing ${shown} of ${totalItems} centres</div>
      <div class="pagination-btns">
        <button class="btn-outline-sm" onclick="CentreManager.goToPage(${currentPage-1})" ${currentPage===0?'disabled':''}>← Prev</button>
        <span>Page ${currentPage+1} / ${totalPages}</span>
        <button class="btn-outline-sm" onclick="CentreManager.goToPage(${currentPage+1})" ${currentPage>=totalPages-1?'disabled':''}>Next →</button>
      </div>`;
  }

  function filter(q) { renderTable(allCentres.filter(c =>
    c.name?.toLowerCase().includes(q.toLowerCase()) ||
    c.code?.toLowerCase().includes(q.toLowerCase()) ||
    c.state?.toLowerCase().includes(q.toLowerCase()))); }

  function filterStatus(s) {
    renderTable(s==='all' ? allCentres : allCentres.filter(c => c.status===s));
  }

  function showAdd() {
    editingId = null;
    document.getElementById('centreModalTitle').textContent = 'Add Centre';
    document.getElementById('centreForm').reset();
    document.getElementById('centreModal').style.display = 'flex';
  }

  function showEdit(id) {
    editingId = id;
    const c = allCentres.find(x => x.id===id); if(!c) return;
    document.getElementById('centreModalTitle').textContent = 'Edit Centre';
    const form = document.getElementById('centreForm');
    form.code.value     = c.code    ||'';
    form.name.value     = c.name    ||'';
    form.state.value    = c.state   ||'';
    form.capacity.value = c.capacity||'';
    form.address.value  = c.address ||'';
    document.getElementById('centreModal').style.display = 'flex';
  }

  async function save(e) {
    e.preventDefault();
    const form  = document.getElementById('centreForm');
    const code  = form.code.value.trim().toUpperCase();
    const name  = form.name.value.trim();
    if (!code || !name) { alert('Code and Name are required.'); return; }

    const saveBtn = form.querySelector('[type="submit"]');
    if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }

    try {
      if (!editingId) {
        // Duplicate check by code
        const ex = await DB.list(SD.COL.CENTRES, [SD.Q.equal('code', code)], 1);
        if (ex.total > 0) { alert(`Centre code "${code}" already exists.`); return; }
      }

      // Image upload (optional)
      let imageUrl = allCentres.find(x=>x.id===editingId)?.imageUrl || '';
      const imgFile = document.getElementById('centreImageInput')?.files?.[0];
      if (imgFile) imageUrl = await CLOUD.upload(imgFile, 'centres', `centre_${code}`);

      const data = {
        code, name,
        state:     form.state.value.trim(),
        capacity:  parseInt(form.capacity.value)||0,
        address:   form.address.value.trim(),
        imageUrl,
        status:    'active',
        updatedAt: new Date().toISOString(),
      };

      if (editingId) {
        await DB.update(SD.COL.CENTRES, editingId, data);
        await audit('CENTRE_UPDATED', { id: editingId, name });
      } else {
        data.createdAt = new Date().toISOString();
        await DB.create(SD.COL.CENTRES, data);
        await audit('CENTRE_CREATED', { code, name });
      }
      closeModal('centreModal');
      load();
    } catch(e) { alert('Save failed: ' + e.message); }
    finally { if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save Centre';} }
  }

  async function toggleStatus(id, current) {
    const ns = current==='active'?'inactive':'active';
    if (!confirm(`${ns==='active'?'Activate':'Deactivate'} this centre?`)) return;
    await DB.update(SD.COL.CENTRES, id, { status: ns });
    await audit('CENTRE_STATUS_CHANGED', { id, status: ns });
    load();
  }

  function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('centreForm');
    if (form) form.addEventListener('submit', save);
  });

  return { load, filter, filterStatus, showAdd, showEdit, save, toggleStatus, goToPage };
})();

/* ══════════════════════════════════════════════════════════════════════
 * SUBJECT MANAGER (Appwrite edition)
 * ════════════════════════════════════════════════════════════════════*/
const SubjectManager = (() => {
  'use strict';

  async function load() {
    const tree = document.getElementById('subjectsTree'); if(!tree) return;
    tree.innerHTML = '<div class="loading-placeholder">Loading subjects…</div>';
    try {
      const [subjRes, topicRes] = await Promise.all([
        DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 200),
        DB.list(SD.COL.TOPICS,   [SD.Q.orderAsc('name')], 1000),
      ]);
      const subjects = subjRes.documents;
      const topics   = topicRes.documents;

      tree.innerHTML = subjects.map(s => {
        const subTopics = topics.filter(t => t.subjectId === s.$id);
        return `<div class="subj-tree-node">
          <div class="subj-node-header">
            <span class="subj-icon">📚</span>
            <strong>${_esc(s.name)}</strong>
            <span class="subj-meta">(${subTopics.length} topics)</span>
            <div class="subj-actions">
              <button class="btn-outline-sm" onclick="SubjectManager.editSubject('${s.$id}','${_esc(s.name)}')">✏️</button>
              <button class="btn-primary-sm" onclick="SubjectManager.addTopic('${s.$id}','${_esc(s.name)}')">+ Topic</button>
              <button class="btn-danger btn-xs" onclick="SubjectManager.deleteSubject('${s.$id}')">🗑️</button>
            </div>
          </div>
          <div class="topic-list">
            ${subTopics.map(t => `<div class="topic-node">
              <span class="topic-icon">📖</span> ${_esc(t.name)}
              <button class="btn-outline-sm btn-xs" onclick="SubjectManager.editTopic('${t.$id}','${_esc(t.name)}')">✏️</button>
              <button class="btn-danger btn-xs" onclick="SubjectManager.deleteTopic('${t.$id}')">🗑️</button>
            </div>`).join('') || '<p class="no-topics">No topics yet.</p>'}
          </div>
        </div>`;
      }).join('') || '<p class="no-data">No subjects yet. Add one above.</p>';
    } catch(e) { tree.innerHTML = `<p style="color:#dc3545">${e.message}</p>`; }
  }

  async function showAdd() {
    const name = prompt('New Subject Name:'); if(!name?.trim()) return;
    try {
      const ex = await DB.list(SD.COL.SUBJECTS, [SD.Q.equal('name', name.trim())], 1);
      if (ex.total > 0) { alert('Subject already exists.'); return; }
      await DB.create(SD.COL.SUBJECTS, { name: name.trim(), createdAt: new Date().toISOString() });
      await audit('SUBJECT_CREATED', { name });
      load();
    } catch(e) { alert(e.message); }
  }

  async function editSubject(id, current) {
    const name = prompt('Edit Subject Name:', current); if(!name?.trim()) return;
    await DB.update(SD.COL.SUBJECTS, id, { name: name.trim() });
    load();
  }

  async function deleteSubject(id) {
    if (!confirm('Delete this subject and all its topics?')) return;
    try {
      const topics = await DB.list(SD.COL.TOPICS, [SD.Q.equal('subjectId', id)], 500);
      await Promise.all(topics.documents.map(t => DB.delete(SD.COL.TOPICS, t.$id)));
      await DB.delete(SD.COL.SUBJECTS, id);
      load();
    } catch(e) { alert(e.message); }
  }

  async function addTopic(subjectId, subjectName) {
    const name = prompt(`New Topic for "${subjectName}":`); if(!name?.trim()) return;
    await DB.create(SD.COL.TOPICS, { name: name.trim(), subjectId, createdAt: new Date().toISOString() });
    load();
  }

  async function editTopic(id, current) {
    const name = prompt('Edit Topic Name:', current); if(!name?.trim()) return;
    await DB.update(SD.COL.TOPICS, id, { name: name.trim() });
    load();
  }

  async function deleteTopic(id) {
    if (!confirm('Delete this topic?')) return;
    await DB.delete(SD.COL.TOPICS, id);
    load();
  }

  function _esc(s){ return String(s||'').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

  return { load, showAdd, editSubject, deleteSubject, addTopic, editTopic, deleteTopic };
})();

/* ══════════════════════════════════════════════════════════════════════
 * EXAM MANAGER (Appwrite edition)
 * Questions fetched by subjectId — JAMB structure
 * ════════════════════════════════════════════════════════════════════*/
const ExamManager = (() => {
  'use strict';
  let editingId  = null;
  let allExams   = [];

  async function load() {
    await _loadExams();
    await _populateSubjectDropdowns();
  }

  async function _loadExams() {
    const tbody = document.getElementById('examsBody'); if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="loading-placeholder">Loading…</td></tr>';
    try {
      const res = await DB.list(SD.COL.EXAMS, [SD.Q.orderDesc('$createdAt')], 200);
      allExams = res.documents.map(d => ({ id: d.$id, ...d }));
      renderTable(allExams);
    } catch(e) { tbody.innerHTML = `<tr><td colspan="8" style="color:#dc3545">${e.message}</td></tr>`; }
  }

  let examsFiltered = [];
  let examsPage      = 0;
  const EXAMS_PAGE_SIZE = 10;

  function renderTable(exams) {
    examsFiltered = exams;
    examsPage = 0;
    _renderExamsPage();
  }

  function goToPage(p) { examsPage = p; _renderExamsPage(); }

  function _renderExamsPage() {
    const tbody = document.getElementById('examsBody'); if(!tbody) return;
    const totalItems = examsFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / EXAMS_PAGE_SIZE));
    examsPage = Math.min(Math.max(examsPage, 0), totalPages - 1);
    const start = examsPage * EXAMS_PAGE_SIZE;
    const pageItems = examsFiltered.slice(start, start + EXAMS_PAGE_SIZE);

    if (!pageItems.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="loading-placeholder">No exams found.</td></tr>';
    } else {
      tbody.innerHTML = pageItems.map(ex => {
        const sched = ex.scheduledStart
          ? new Date(ex.scheduledStart).toLocaleString('en-NG',{dateStyle:'short',timeStyle:'short'})
          : 'Not scheduled';
        const badge = ex.active
          ? '<span class="badge badge-success">Active</span>'
          : ex.status==='completed'
            ? '<span class="badge badge-primary">Completed</span>'
            : '<span class="badge badge-gray">Inactive</span>';
        const candidateIds = ex.candidateIds ? JSON.parse(ex.candidateIds) : [];
        return `<tr>
          <td><strong>${_esc(ex.name)}</strong></td>
          <td>${_esc(ex.subject||ex.subjectName||'—')}</td>
          <td>${ex.duration} min</td>
          <td>${ex.totalQuestions}</td>
          <td>${sched}</td>
          <td>${badge}</td>
          <td>${candidateIds.length}</td>
          <td class="action-cell">
            <button class="btn-outline-sm" onclick="ExamManager.showEdit('${ex.id}')">✏️</button>
            <button class="btn-outline-sm" onclick="ExamManager.showAssign('${ex.id}')">👥 Assign</button>
            ${ex.active
              ? `<button class="btn-danger btn-xs" onclick="ExamManager.deactivate('${ex.id}')">⛔ Stop</button>`
              : `<button class="btn-success-sm btn-xs" onclick="ExamManager.activate('${ex.id}')">▶️ Start</button>`}
            <button class="btn-outline-sm" onclick="ExamManager.viewMonitor('${ex.id}')">📡 Monitor</button>
            ${!ex.active?`<button class="btn-danger btn-xs" onclick="ExamManager.delete('${ex.id}')">🗑️</button>`:''}
          </td>
        </tr>`;
      }).join('');
    }
    _renderExamsPagination(totalItems, totalPages);
  }

  function _renderExamsPagination(totalItems, totalPages) {
    const wrap = document.getElementById('examsPagination'); if(!wrap) return;
    const shown = Math.max(0, Math.min(EXAMS_PAGE_SIZE, totalItems - examsPage * EXAMS_PAGE_SIZE));
    wrap.innerHTML = `
      <div class="pagination-info">Showing ${shown} of ${totalItems} exams</div>
      <div class="pagination-btns">
        <button class="btn-outline-sm" onclick="ExamManager.goToPage(${examsPage-1})" ${examsPage===0?'disabled':''}>← Prev</button>
        <span>Page ${examsPage+1} / ${totalPages}</span>
        <button class="btn-outline-sm" onclick="ExamManager.goToPage(${examsPage+1})" ${examsPage>=totalPages-1?'disabled':''}>Next →</button>
      </div>`;
  }

  function switchTab(tab, btn) {
    document.querySelectorAll('.etab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (tab==='all')      { renderTable(allExams); return; }
    if (tab==='schedule') { _showScheduleView(); return; }
    if (tab==='assign')   { _showAssignView(); return; }
    if (tab==='activate') { _showActivateView(); return; }
    if (tab==='monitor')  { _showMonitorView(); return; }
  }

  function _showActivateView() {
    document.getElementById('examTabContent').innerHTML = `
      <div class="activate-grid">
        ${allExams.map(ex => {
          const cids = ex.candidateIds ? JSON.parse(ex.candidateIds) : [];
          return `<div class="activate-card ${ex.active?'active-card':''}">
            <h4>${_esc(ex.name)}</h4>
            <p>${ex.duration} min · ${ex.totalQuestions} questions · ${cids.length} candidates</p>
            ${ex.active
              ? `<button class="btn-danger" onclick="ExamManager.deactivate('${ex.id}')">⛔ Deactivate</button>`
              : `<button class="btn-primary" onclick="ExamManager.activate('${ex.id}')">▶️ Activate</button>`}
            <div class="activate-status">${ex.active?'🟢 Currently LIVE':'⚪ Not active'}</div>
          </div>`;
        }).join('')}
      </div>`;
  }

  function _showScheduleView() {
    document.getElementById('examTabContent').innerHTML = `
      <div class="table-wrap"><table class="admin-table">
        <thead><tr><th>Exam</th><th>Scheduled Start</th><th>Scheduled End</th><th>Action</th></tr></thead>
        <tbody>${allExams.map(ex => `<tr>
          <td>${_esc(ex.name)}</td>
          <td><input type="datetime-local" id="ss_${ex.id}" value="${ex.scheduledStart?ex.scheduledStart.slice(0,16):''}" class="date-input"></td>
          <td><input type="datetime-local" id="se_${ex.id}" value="${ex.scheduledEnd?ex.scheduledEnd.slice(0,16):''}" class="date-input"></td>
          <td><button class="btn-primary-sm" onclick="ExamManager.saveSchedule('${ex.id}')">💾 Save</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  }

  function _showAssignView() {
    document.getElementById('examTabContent').innerHTML = `
      <div class="assign-grid">${allExams.map(ex => {
        const cids = ex.candidateIds ? JSON.parse(ex.candidateIds) : [];
        return `<div class="assign-card">
          <h4>${_esc(ex.name)}</h4>
          <p>${cids.length} candidates assigned</p>
          <button class="btn-primary-sm" onclick="ExamManager.showAssign('${ex.id}')">👥 Manage</button>
        </div>`;
      }).join('')}</div>`;
  }

  function _showMonitorView() {
    const active = allExams.filter(e => e.active);
    document.getElementById('examTabContent').innerHTML = active.length
      ? `<div class="monitor-grid">${active.map(ex=>`<div class="monitor-card">
          <h4>${_esc(ex.name)}</h4><div class="live-ind"><span class="live-dot"></span> LIVE</div>
          <a href="invigilator-panel.html?exam=${ex.id}" target="_blank" class="btn-primary-sm">📡 Open Monitor</a>
        </div>`).join('')}</div>`
      : '<p class="no-data">No active exams currently running.</p>';
  }

  async function showCreate() {
    editingId = null;
    document.getElementById('examModalTitle').textContent = 'Create Examination';
    document.getElementById('examForm').reset();
    await _loadCentreOptions();
    document.getElementById('examModal').style.display = 'flex';
  }

  async function showEdit(id) {
    editingId = id;
    const ex = allExams.find(e => e.id===id); if(!ex) return;
    document.getElementById('examModalTitle').textContent = 'Edit Examination';
    const form = document.getElementById('examForm');
    form.name.value           = ex.name           ||'';
    form.duration.value       = ex.duration        ||60;
    form.totalQuestions.value = ex.totalQuestions  ||50;
    form.passingScore.value   = ex.passingScore    ||70;
    if (form.randomizeQuestions) form.randomizeQuestions.checked = ex.randomizeQuestions!==false;
    if (form.shuffleOptions)     form.shuffleOptions.checked     = ex.shuffleOptions!==false;
    await _loadCentreOptions();
    const centreIds = ex.centreIds ? JSON.parse(ex.centreIds) : [];
    if (centreIds.length) {
      const sel = document.getElementById('examFormCentres');
      if (sel) Array.from(sel.options).forEach(o => o.selected = centreIds.includes(o.value));
    }
    document.getElementById('examModal').style.display = 'flex';
  }

  async function _loadCentreOptions() {
    const sel = document.getElementById('examFormCentres'); if(!sel) return;
    while (sel.options.length) sel.remove(0);
    try {
      const res = await DB.list(SD.COL.CENTRES, [SD.Q.equal('status','active'), SD.Q.orderAsc('name')], 500);
      res.documents.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.$id; opt.textContent = c.name;
        sel.appendChild(opt);
      });
    } catch(e) { console.warn('_loadCentreOptions', e); }
  }

  async function save(e) {
    e.preventDefault();
    const form     = document.getElementById('examForm');
    const centreSel= document.getElementById('examFormCentres');
    const centreIds= centreSel ? Array.from(centreSel.selectedOptions).map(o=>o.value) : [];

    const saveBtn = form.querySelector('[type="submit"]');
    if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }

    const data = {
      name:               form.name.value.trim(),
      subjectId:          form.subjectId?.value||'',
      subject:            form.subjectId?.options[form.subjectId?.selectedIndex]?.textContent||'',
      duration:           parseInt(form.duration.value)||60,
      totalQuestions:     parseInt(form.totalQuestions.value)||50,
      passingScore:       parseInt(form.passingScore.value)||70,
      randomizeQuestions: form.randomizeQuestions?.checked??true,
      shuffleOptions:     form.shuffleOptions?.checked??true,
      centreIds:          JSON.stringify(centreIds),
      updatedAt:          new Date().toISOString(),
    };
    if (form.scheduledStart?.value) data.scheduledStart = form.scheduledStart.value;
    if (form.scheduledEnd?.value)   data.scheduledEnd   = form.scheduledEnd.value;

    try {
      if (editingId) {
        await DB.update(SD.COL.EXAMS, editingId, data);
        await audit('EXAM_UPDATED', { examId: editingId });
      } else {
        data.createdAt    = new Date().toISOString();
        data.active       = false;
        data.candidateIds = JSON.stringify([]);
        data.status       = 'draft';
        await DB.create(SD.COL.EXAMS, data);
        await audit('EXAM_CREATED', { name: data.name });
      }
      closeModal('examModal');
      await _loadExams();
    } catch(e) { alert('Save failed: ' + e.message); }
    finally { if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save Exam';} }
  }

  async function activate(examId) {
    if (!confirm('Activate this exam? Candidates will be able to start it.')) return;
    await DB.update(SD.COL.EXAMS, examId, { active: true, status: 'active', activatedAt: new Date().toISOString() });
    await audit('EXAM_ACTIVATED', { examId });
    await _loadExams();
  }

  async function deactivate(examId) {
    if (!confirm('Deactivate this exam?')) return;
    await DB.update(SD.COL.EXAMS, examId, { active: false, status: 'completed', deactivatedAt: new Date().toISOString() });
    await audit('EXAM_DEACTIVATED', { examId });
    await _loadExams();
  }

  async function saveSchedule(examId) {
    const start = document.getElementById('ss_'+examId)?.value;
    const end   = document.getElementById('se_'+examId)?.value;
    await DB.update(SD.COL.EXAMS, examId, { scheduledStart: start||null, scheduledEnd: end||null });
    await audit('EXAM_SCHEDULED', { examId });
    alert('Schedule saved!');
  }

  async function deleteExam(id) {
    const ex = allExams.find(e=>e.id===id);
    if (ex?.active) { alert('Deactivate this exam before deleting.'); return; }
    if (!confirm(`Delete "${ex?.name||id}"? This cannot be undone.`)) return;
    await DB.delete(SD.COL.EXAMS, id);
    await audit('EXAM_DELETED', { id, name: ex?.name||'' }, 'WARNING');
    await _loadExams();
  }

  async function showAssign(examId) {
    const ex    = allExams.find(e=>e.id===examId);
    const name  = ex?.name||examId;
    const cands = await DB.list(SD.COL.CANDIDATES, [SD.Q.orderAsc('fullName')], 5000);
    const current= ex?.candidateIds ? JSON.parse(ex.candidateIds) : [];

    const modal = document.createElement('div');
    modal.className='modal'; modal.style.display='flex'; modal.id='assignModal';
    modal.innerHTML=`<div class="modal-content wide-modal">
      <div class="modal-header"><h2>Assign Candidates — "${_esc(name)}"</h2>
        <button class="modal-close" onclick="document.getElementById('assignModal').remove()">✕</button></div>
      <div class="modal-form">
        <div class="assign-actions-row">
          <button class="btn-primary-sm" onclick="ExamManager._selectAll()">Select All</button>
          <button class="btn-outline-sm" onclick="ExamManager._clearAll()">Clear All</button>
          <input type="text" placeholder="Filter…" class="search-input" oninput="ExamManager._filterAssign(this.value)">
        </div>
        <div class="assign-list" id="assignList">
          ${cands.documents.map(c=>`<label class="assign-item" data-name="${(c.fullName||'').toLowerCase()}">
            <input type="checkbox" value="${c.$id}" ${current.includes(c.$id)?'checked':''}>
            <img src="${c.passportImageUrl||'../assets/images/default-avatar.png'}" class="assign-photo">
            <span><strong>${_esc(c.fullName||'—')}</strong><br>${_esc(c.candidateId||'—')} · ${_esc(c.centreName||'—')}</span>
          </label>`).join('')}
        </div>
        <div class="modal-footer">
          <button class="btn-outline" onclick="document.getElementById('assignModal').remove()">Cancel</button>
          <button class="btn-primary" onclick="ExamManager._saveAssign('${examId}')">💾 Save Assignments</button>
        </div>
      </div></div>`;
    document.body.appendChild(modal);
  }

  function _selectAll() { document.querySelectorAll('#assignList input[type=checkbox]').forEach(c=>c.checked=true); }
  function _clearAll()  { document.querySelectorAll('#assignList input[type=checkbox]').forEach(c=>c.checked=false); }
  function _filterAssign(q) {
    document.querySelectorAll('#assignList .assign-item').forEach(item =>
      item.style.display = item.dataset.name?.includes(q.toLowerCase()) ? '' : 'none');
  }

  async function _saveAssign(examId) {
    const ids = [...document.querySelectorAll('#assignList input[type=checkbox]:checked')].map(c=>c.value);
    await DB.update(SD.COL.EXAMS, examId, { candidateIds: JSON.stringify(ids) });
    await audit('EXAM_CANDIDATES_ASSIGNED', { examId, count: ids.length });
    document.getElementById('assignModal')?.remove();
    alert(`${ids.length} candidates assigned!`);
    await _loadExams();
  }

  function viewMonitor(examId) { window.open(`invigilator-panel.html?exam=${examId}`, '_blank'); }

  async function _populateSubjectDropdowns() {
    const selects = document.querySelectorAll('#examForm select[name="subjectId"]');
    if (!selects.length) return;
    const res = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 200);
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">Select Subject</option>';
      res.documents.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.$id; opt.textContent = d.name;
        sel.appendChild(opt);
      });
    });
  }

  function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('examForm');
    if (form) form.addEventListener('submit', save);
  });

  return { load, switchTab, showCreate, showEdit, save, activate, deactivate, delete: deleteExam,
    saveSchedule, showAssign, _selectAll, _clearAll, _filterAssign, _saveAssign, viewMonitor, goToPage };
})();

/* ══════════════════════════════════════════════════════════════════════
 * USER MANAGER (Appwrite edition)
 * Password toggle on all fields · No duplicates
 * ════════════════════════════════════════════════════════════════════*/
const UserManager = (() => {
  'use strict';
  let editingId = null;
  let allUsers  = [];
  let usersFiltered = [];
  let usersPage      = 0;
  const USERS_PAGE_SIZE = 10;

  async function load() {
    const tbody = document.getElementById('usersBody'); if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">Loading…</td></tr>';
    try {
      const res = await DB.list(SD.COL.USERS, [SD.Q.orderAsc('fullName')], 500);
      allUsers = res.documents.map(d => ({ id: d.$id, ...d }));
      renderTable(allUsers);
      _wireRoleTabs();
    } catch(e) { tbody.innerHTML = `<tr><td colspan="7">${e.message}</td></tr>`; }
  }

  function renderTable(users) {
    usersFiltered = users;
    usersPage = 0;
    _renderUsersPage();
  }

  function goToPage(p) { usersPage = p; _renderUsersPage(); }

  function _renderUsersPage() {
    const tbody = document.getElementById('usersBody'); if(!tbody) return;
    const totalItems = usersFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / USERS_PAGE_SIZE));
    usersPage = Math.min(Math.max(usersPage, 0), totalPages - 1);
    const start = usersPage * USERS_PAGE_SIZE;
    const pageItems = usersFiltered.slice(start, start + USERS_PAGE_SIZE);

    if (!pageItems.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">No users.</td></tr>';
    } else {
      tbody.innerHTML = pageItems.map(u => `<tr>
        <td>${_esc(u.fullName||'—')}</td>
        <td>${_esc(u.email||'—')}</td>
        <td><span class="badge badge-${u.role==='admin'?'primary':u.role==='superadmin'?'danger':'info'}">${u.role}</span></td>
        <td>${_esc(u.centreName||'—')}</td>
        <td><span class="badge ${u.status==='active'?'badge-success':'badge-gray'}">${u.status||'active'}</span></td>
        <td>${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-NG') : 'Never'}</td>
        <td class="action-cell">
          <button class="btn-outline-sm" onclick="UserManager.showEdit('${u.id}')">✏️ Edit</button>
          <button class="btn-danger btn-xs" onclick="UserManager.toggleStatus('${u.id}','${u.status||'active'}')">
            ${(u.status||'active')==='active'?'⛔':'✅'}
          </button>
        </td>
      </tr>`).join('');
    }
    _renderUsersPagination(totalItems, totalPages);
  }

  function _renderUsersPagination(totalItems, totalPages) {
    const wrap = document.getElementById('usersPagination'); if(!wrap) return;
    const shown = Math.max(0, Math.min(USERS_PAGE_SIZE, totalItems - usersPage * USERS_PAGE_SIZE));
    wrap.innerHTML = `
      <div class="pagination-info">Showing ${shown} of ${totalItems} users</div>
      <div class="pagination-btns">
        <button class="btn-outline-sm" onclick="UserManager.goToPage(${usersPage-1})" ${usersPage===0?'disabled':''}>← Prev</button>
        <span>Page ${usersPage+1} / ${totalPages}</span>
        <button class="btn-outline-sm" onclick="UserManager.goToPage(${usersPage+1})" ${usersPage>=totalPages-1?'disabled':''}>Next →</button>
      </div>`;
  }

  function _wireRoleTabs() {
    document.querySelectorAll('.rtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rtab').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const role = btn.dataset.role;
        renderTable(role==='all' ? allUsers : allUsers.filter(u=>u.role===role));
      });
    });
  }

  async function showAdd() {
    editingId = null;
    document.getElementById('userModalTitle').textContent = 'Add User';
    document.getElementById('userForm').reset();
    await _populateCentreDropdown('userForm');
    document.getElementById('userModal').style.display = 'flex';
  }

  async function showEdit(id) {
    editingId = id;
    const u = allUsers.find(x=>x.id===id); if(!u) return;
    document.getElementById('userModalTitle').textContent = 'Edit User';
    const form = document.getElementById('userForm');
    form.fullName.value = u.fullName||'';
    form.email.value    = u.email||'';
    form.role.value     = u.role||'invigilator';
    await _populateCentreDropdown('userForm', u.centreId);
    document.getElementById('userModal').style.display = 'flex';
  }

  async function save(e) {
    e.preventDefault();
    const form     = document.getElementById('userForm');
    const fullName = form.fullName.value.trim();
    const email    = form.email.value.trim().toLowerCase();
    const role     = form.role.value;
    const centreId = form.centreId?.value||'';
    const password = form.tempPassword?.value||'';

    const saveBtn = form.querySelector('[type="submit"]');
    if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }

    try {
      // Find centre name
      let centreName = '';
      if (centreId) {
        try { const c = await DB.get(SD.COL.CENTRES, centreId); centreName = c.name||''; } catch(_) {}
      }

      if (editingId) {
        await DB.update(SD.COL.USERS, editingId, { fullName, role, centreId, centreName, updatedAt: new Date().toISOString() });
        await audit('USER_UPDATED', { id: editingId });
      } else {
        if (!password) { alert('Temporary password is required.'); return; }
        // Duplicate email check
        const ex = await DB.list(SD.COL.USERS, [SD.Q.equal('email', email)], 1);
        if (ex.total > 0) { alert(`Email "${email}" already registered.`); return; }

        const newUser = await AUTH.createAccount(email, password, fullName);
        await DB.create(SD.COL.USERS, {
          fullName, email, role, centreId, centreName,
          status: 'active', createdAt: new Date().toISOString(),
        }, newUser.$id);
        await audit('USER_CREATED', { uid: newUser.$id, email, role });
      }
      closeModal('userModal');
      load();
    } catch(e) { alert('Save failed: ' + e.message); }
    finally { if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save User';} }
  }

  async function toggleStatus(id, current) {
    const ns = current==='active'?'inactive':'active';
    await DB.update(SD.COL.USERS, id, { status: ns });
    load();
  }

  async function _populateCentreDropdown(formId, selectedId) {
    const form = document.getElementById(formId); if(!form?.centreId) return;
    const res = await DB.list(SD.COL.CENTRES, [SD.Q.equal('status','active'), SD.Q.orderAsc('name')], 500);
    form.centreId.innerHTML = '<option value="">Select Centre</option>';
    res.documents.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.$id; opt.textContent = d.name;
      if (selectedId && d.$id === selectedId) opt.selected = true;
      form.centreId.appendChild(opt);
    });
  }

  function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('userForm');
    if (form) form.addEventListener('submit', save);
  });

  return { load, showAdd, showEdit, save, toggleStatus };
})();

/* ══════════════════════════════════════════════════════════════════════
 * RESULT MANAGER (Appwrite edition)
 * ════════════════════════════════════════════════════════════════════*/
const ResultManager = (() => {
  'use strict';
  let allResults  = [];
  let examsLoaded = false;

  async function load() {
    const tbody = document.getElementById('resultsBody'); if(!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">Loading results…</td></tr>';
    if (!examsLoaded) await _loadExamFilter();
    try {
      const examFilter = document.getElementById('resExamFilter')?.value;
      const queries    = [SD.Q.orderDesc('$createdAt'), SD.Q.limit(200)];
      if (examFilter) queries.push(SD.Q.equal('examId', examFilter));
      const res = await SD.tablesDB.listRows({ databaseId: SD.DB_ID, tableId: SD.COL.RESULTS, queries });
      res.documents = res.rows; // keep old field name working for the rest of this file
      allResults = res.documents.map(d => ({ id: d.$id, ...d }));
      _renderTable(allResults);
    } catch(e) { tbody.innerHTML = `<tr><td colspan="7" style="color:#dc3545">${e.message}</td></tr>`; }
  }

  async function _loadExamFilter() {
    const sel = document.getElementById('resExamFilter'); if(!sel) return;
    const res = await DB.list(SD.COL.EXAMS, [SD.Q.orderAsc('name')], 200);
    res.documents.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.$id; opt.textContent = d.name;
      sel.appendChild(opt);
    });
    examsLoaded = true;
  }

  function _renderTable(results) {
    const tbody = document.getElementById('resultsBody'); if(!tbody) return;
    if (!results.length) { tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">No results found.</td></tr>'; return; }
    tbody.innerHTML = results.map(r => {
      const date = r.createdAt ? new Date(r.createdAt).toLocaleString() : '—';
      const gradeClr = {A:'success',B:'success',C:'warning',D:'warning',F:'danger'}[r.grade]||'gray';
      return `<tr>
        <td>${_esc(r.candidateName||r.candidateId)}</td>
        <td>${_esc(r.examName||r.examId)}</td>
        <td>${r.correctAnswers}/${r.totalQuestions} (${r.percentage}%)</td>
        <td><span class="badge badge-${gradeClr}">${r.grade}</span></td>
        <td><span class="badge ${r.passed?'badge-success':'badge-danger'}">${r.passed?'Passed':'Failed'}</span></td>
        <td>${date}</td>
        <td><button class="btn-outline-sm" onclick="ResultManager.viewDetail('${r.id}')">👁 View</button></td>
      </tr>`;
    }).join('');
  }

  function search(q) {
    _renderTable(allResults.filter(r =>
      (r.candidateName||'').toLowerCase().includes(q.toLowerCase()) ||
      (r.candidateId||'').toLowerCase().includes(q.toLowerCase())));
  }

  function filterStatus(s) {
    if (s==='all') { _renderTable(allResults); return; }
    _renderTable(allResults.filter(r => (s==='passed')===!!r.passed));
  }

  async function viewDetail(resultId) {
    const modal   = document.getElementById('resultDetailModal');
    const content = document.getElementById('resultDetailContent');
    const titleEl = document.getElementById('resultDetailTitle');
    if (!modal||!content) return;
    modal.style.display='flex';
    content.innerHTML = '<div class="loading-placeholder">Loading answer key…</div>';
    try {
      const r  = allResults.find(x=>x.id===resultId);
      if (!r) { content.innerHTML = '<p class="error">Result not found.</p>'; return; }
      titleEl.textContent = `${r.candidateName||r.candidateId} — ${r.examName||r.examId}`;
      const breakdown = r.answerBreakdown ? JSON.parse(r.answerBreakdown) : {};
      const rows = Object.entries(breakdown).map(([, info], i) => {
        const status = info.isCorrect?'correct': info.studentAnswer==='NOT_ANSWERED'?'skipped':'wrong';
        const cls    = {correct:'td-correct',skipped:'td-skipped',wrong:'td-wrong'}[status];
        const label  = {correct:'Correct',skipped:'Not Answered',wrong:'Incorrect'}[status];
        return `<tr>
          <td>${i+1}</td>
          <td>${_esc((info.questionText||'').substring(0,70))}</td>
          <td>${info.studentAnswer==='NOT_ANSWERED'?'—':info.studentAnswer}</td>
          <td><strong>${info.correctAnswer||'—'}</strong></td>
          <td class="${cls}">${label}</td>
        </tr>`;
      }).join('');
      content.innerHTML = `
        <div class="result-summary-row">
          <div><strong>Score:</strong> ${r.correctAnswers}/${r.totalQuestions} (${r.percentage}%)</div>
          <div><strong>Grade:</strong> ${r.grade}</div>
          <div><strong>Status:</strong> ${r.passed?'Passed':'Failed'}</div>
        </div>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>#</th><th>Question</th><th>Candidate Answer</th><th>Correct Answer</th><th>Status</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="5" class="loading-placeholder">No answer data.</td></tr>'}</tbody>
        </table></div>`;
    } catch(e) { content.innerHTML = `<p class="error">Failed: ${e.message}</p>`; }
  }

  async function exportResults() {
    if (!window.XLSX) { alert('XLSX library not loaded'); return; }
    const rows = allResults.map(r => ({
      'Candidate': r.candidateName||r.candidateId,
      'Exam':      r.examName||r.examId,
      'Score (%)': r.percentage,
      'Grade':     r.grade,
      'Status':    r.passed?'Passed':'Failed',
      'Correct':   r.correctAnswers,
      'Total':     r.totalQuestions,
      'Date':      r.createdAt ? new Date(r.createdAt).toLocaleString() : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    XLSX.writeFile(wb, `results-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function _esc(s){ const d=document.createElement('div');d.textContent=s??'';return d.innerHTML; }

  return { load, search, filterStatus, viewDetail, exportResults };
})();

/* ══════════════════════════════════════════════════════════════════════
 * SETTINGS MANAGER (Appwrite edition)
 * ════════════════════════════════════════════════════════════════════*/
const SettingsManager = (() => {
  'use strict';

  async function load() {
    try {
      const cfg = await DB.get(SD.COL.SETTINGS, 'global');
      _set('sPlatformName',   cfg.platformName       || 'SOFTLY DIGITAL V3');
      _set('sPassPercent',    cfg.passingPercentage  || 70);
      _set('sSessionTimeout', cfg.sessionTimeout     || 60);
      _set('sMaxViol',        cfg.maxViolations      || 3);
      _set('sAutoSave',       cfg.autoSaveInterval   || 5);
      _set('sSyncInterval',   cfg.syncInterval       || 30);
      _setCb('sAutoLock',      cfg.autoLockFailedLogins ?? true);
      _setCb('sDeviceVerif',   cfg.deviceVerification   ?? true);
      _setCb('sTabSwitch',     cfg.tabSwitchDetection   ?? true);
      _setCb('sFullscreen',    cfg.fullscreenEnforce    ?? true);
      _setCb('sDevtools',      cfg.devtoolsDetection    ?? true);
      _setCb('sCopyPaste',     cfg.copyPasteDetect      ?? true);
      _setCb('sSingleSession', cfg.singleActiveSession  ?? true);
      _setCb('sBotDetect',     cfg.botDetection         ?? true);
      _setCb('sAutoCert',      cfg.autoCertificate      ?? true);
      _setCb('sCertQR',        cfg.certQrCode           ?? true);
      _set('sCertScore',      cfg.certMinScore       || 70);
      _set('sSmtpHost',       cfg.smtpHost           || '');
      _set('sSmtpPort',       cfg.smtpPort           || 587);
      _set('sFromEmail',      cfg.fromEmail          || '');
      if (cfg.smsProvider) _set('sSmsProvider', cfg.smsProvider);
      const keyField = document.getElementById('sOpenAiKey');
      if (keyField && cfg.openaiApiKey) keyField.placeholder = 'sk-•••••••• (configured — leave blank to keep)';
      if (cfg.openaiModel) _set('sOpenAiModel', cfg.openaiModel);

      // Push to runtime CFG
      SD.CFG.PASS_THRESHOLD      = cfg.passingPercentage  || 70;
      SD.CFG.MAX_VIOLATIONS      = cfg.maxViolations      || 3;
      SD.CFG.AUTO_SAVE_MS        = (cfg.autoSaveInterval  || 5)  * 1000;
      SD.CFG.SYNC_MS             = (cfg.syncInterval      || 30) * 1000;
      SD.CFG.SESSION_TIMEOUT_MIN = cfg.sessionTimeout     || 60;
      SD.CFG.SINGLE_SESSION      = cfg.singleActiveSession ?? true;
      SD.CFG.BOT_DETECTION       = cfg.botDetection       ?? true;
    } catch(_) { /* first run — no settings doc yet */ }
  }

  async function saveGeneral() {
    await _save({
      platformName:      _get('sPlatformName'),
      passingPercentage: parseInt(_get('sPassPercent'))    || 70,
      sessionTimeout:    parseInt(_get('sSessionTimeout')) || 60,
      maxViolations:     parseInt(_get('sMaxViol'))        || 3,
      autoSaveInterval:  parseInt(_get('sAutoSave'))       || 5,
      syncInterval:      parseInt(_get('sSyncInterval'))   || 30,
    }, 'General settings saved.');
  }

  async function saveSecurity() {
    await _save({
      autoLockFailedLogins: _getCb('sAutoLock'),
      deviceVerification:   _getCb('sDeviceVerif'),
      tabSwitchDetection:   _getCb('sTabSwitch'),
      fullscreenEnforce:    _getCb('sFullscreen'),
      devtoolsDetection:    _getCb('sDevtools'),
      copyPasteDetect:      _getCb('sCopyPaste'),
      singleActiveSession:  _getCb('sSingleSession'),
      botDetection:         _getCb('sBotDetect'),
    }, 'Security settings saved.');
  }

  async function saveAI() {
    const key   = _get('sOpenAiKey').trim();
    const model = _get('sOpenAiModel')||'gpt-4o-mini';
    const data  = { openaiModel: model };
    if (key) data.openaiApiKey = key;
    await _save(data, key ? 'AI configuration saved.' : 'AI model preference saved.');
    document.getElementById('sOpenAiKey').value = '';
  }

  async function saveCertificate() {
    await _save({
      autoCertificate: _getCb('sAutoCert'),
      certQrCode:      _getCb('sCertQR'),
      certMinScore:    parseInt(_get('sCertScore'))||70,
    }, 'Certificate settings saved.');
  }

  async function saveEmailSms() {
    await _save({
      smtpHost:    _get('sSmtpHost'),
      smtpPort:    parseInt(_get('sSmtpPort'))||587,
      fromEmail:   _get('sFromEmail'),
      smsProvider: _get('sSmsProvider'),
    }, 'Email/SMS config saved.');
  }

  async function _save(data, msg) {
    try {
      data.updatedAt = new Date().toISOString();
      try {
        await DB.update(SD.COL.SETTINGS, 'global', data);
      } catch(_) {
        // Doc doesn't exist yet — create it
        await DB.create(SD.COL.SETTINGS, data, 'global');
      }
      await audit('SETTINGS_UPDATED', { keys: Object.keys(data) });
      alert(msg);
      await load();
    } catch(e) { alert('Save failed: ' + e.message); }
  }

  function _get(id)       { return document.getElementById(id)?.value||''; }
  function _getCb(id)     { return document.getElementById(id)?.checked??false; }
  function _set(id, val)  { const el=document.getElementById(id); if(el) el.value=val; }
  function _setCb(id,val) { const el=document.getElementById(id); if(el) el.checked=val; }

  return { load, saveGeneral, saveSecurity, saveAI, saveCertificate, saveEmailSms };
})();

/* ── Patch: saveCloudinary (called from Settings page) ─────── */
SettingsManager.saveCloudinary = async function() {
  const cloud  = document.getElementById('sCloudName')?.value?.trim();
  const preset = document.getElementById('sCloudPreset')?.value?.trim();
  if (!cloud || !preset) { alert('Enter cloud name and preset.'); return; }
  // Update live config in memory
  window.APP_ENV.CLOUDINARY_CLOUD  = cloud;
  window.APP_ENV.CLOUDINARY_PRESET = preset;
  try {
    await DB.update(SD.COL.SETTINGS, 'global', {
      cloudinaryCloud: cloud, cloudinaryPreset: preset,
      updatedAt: new Date().toISOString(),
    });
    alert('Cloudinary settings saved!');
  } catch(_) { alert('Saved to session only — add cloudinaryCloud/Preset attrs to system_settings if needed.'); }
};

/* ── Patch: ExamManager.importExcel ─────────────────────────── */
ExamManager.importExcel = function() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.xlsx,.xls';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.XLSX) { alert('XLSX library not loaded.'); return; }
    try {
      const data = await file.arrayBuffer();
      const wb   = XLSX.read(data);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:'' });
      let added = 0;
      for (const row of rows) {
        const name = (row['Exam Name']||row['name']||'').toString().trim();
        if (!name) continue;
        await DB.create(SD.COL.EXAMS, {
          name,
          subjectId:          row['Subject ID']||'',
          subject:            row['Subject']||'',
          duration:           parseInt(row['Duration'])||60,
          totalQuestions:     parseInt(row['Total Questions'])||50,
          passingScore:       parseInt(row['Pass Score'])||70,
          randomizeQuestions: true, shuffleOptions: true,
          active: false, status: 'draft',
          candidateIds: JSON.stringify([]),
          centreIds:    JSON.stringify([]),
          createdAt:    new Date().toISOString(),
        });
        added++;
      }
      alert(`Imported ${added} exams.`);
      ExamManager.load();
    } catch(err) { alert('Import failed: ' + err.message); }
  };
  input.click();
};
