/**
 * SOFTLY DIGITAL V3 — question-manager.js (Appwrite edition)
 * - No duplicate questions (text hash check)
 * - Tagged by subject → exam fetches by subjectId
 * - Paginated, Cloudinary image upload
 * - Excel & PDF import
 */
const QuestionManager = (() => {
  'use strict';
  let allQuestions = [];
  let editingId    = null;
  let subjectsCache= [];
  let currentPage  = 0;
  const PAGE_SIZE  = 100;
  let totalCount   = 0;

  async function load(page = 0) {
    const tbody = document.getElementById('questionsBody');
    if (!tbody) return;
    currentPage = page;
    tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">Loading questions…</td></tr>';
    try {
      const queries = [SD.Q.orderDesc('$createdAt'), SD.Q.limit(PAGE_SIZE), SD.Q.offset(page * PAGE_SIZE)];

      // Apply filters
      const subj = document.getElementById('qSubjF')?.value;
      const diff = document.getElementById('qDiffF')?.value;
      if (subj) queries.push(SD.Q.equal('subjectId', subj));
      if (diff) queries.push(SD.Q.equal('difficulty', diff));

      const res = await SD.databases.listDocuments(SD.DB_ID, SD.COL.QUESTIONS, queries);
      totalCount   = res.total;
      allQuestions = res.documents.map(d => ({ id: d.$id, ...d }));
      renderTable(allQuestions);
      _renderPagination();
      await _loadSubjectFilter();
    } catch(e) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:#dc3545">${e.message}</td></tr>`;
    }
  }

  function renderTable(questions) {
    const tbody = document.getElementById('questionsBody'); if(!tbody) return;
    if (!questions.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="loading-placeholder">No questions found.</td></tr>'; return;
    }
    tbody.innerHTML = questions.map((q, i) => `
      <tr>
        <td>${(currentPage * PAGE_SIZE) + i + 1}</td>
        <td class="q-text-cell" title="${_esc(q.text)}">${_esc((q.text||'').substring(0,70))}…</td>
        <td>${_esc(q.subject||q.subjectName||'—')}</td>
        <td>${_esc(q.topic||'—')}</td>
        <td><span class="badge ${q.difficulty==='easy'?'badge-success':q.difficulty==='medium'?'badge-warning':'badge-danger'}">${q.difficulty||'—'}</span></td>
        <td>${q.examCount||0}</td>
        <td class="action-cell">
          <button class="btn-outline-sm" onclick="QuestionManager.showEdit('${q.id}')">✏️ Edit</button>
          <button class="btn-danger btn-xs" onclick="QuestionManager.delete('${q.id}')">🗑️</button>
        </td>
      </tr>`).join('');
  }

  function _renderPagination() {
    const wrap = document.getElementById('questionsPagination'); if(!wrap) return;
    const pages = Math.ceil(totalCount / PAGE_SIZE);
    wrap.innerHTML = `
      <div class="pagination-info">Showing ${allQuestions.length} of ${totalCount} questions</div>
      <div class="pagination-btns">
        <button class="btn-outline-sm" onclick="QuestionManager.load(${currentPage-1})" ${currentPage===0?'disabled':''}>← Prev</button>
        <span>Page ${currentPage+1}/${Math.max(1,pages)}</span>
        <button class="btn-outline-sm" onclick="QuestionManager.load(${currentPage+1})" ${currentPage>=pages-1?'disabled':''}>Next →</button>
      </div>`;
  }

  function filter() { load(0); }
  function search(q) {
    // Client-side search on loaded page
    renderTable(allQuestions.filter(x => x.text?.toLowerCase().includes(q.toLowerCase())));
  }

  /* ── ADD / EDIT ──────────────────────────────────────────────────── */
  async function showAdd() {
    editingId = null;
    document.getElementById('questionModalTitle').textContent = 'Add Question';
    document.getElementById('questionForm').reset();
    await _loadSubjectDropdown('questionForm');
    document.getElementById('questionModal').style.display = 'flex';
  }

  async function showEdit(id) {
    editingId = id;
    const q = allQuestions.find(x => x.id === id); if(!q) return;
    document.getElementById('questionModalTitle').textContent = 'Edit Question';
    const form = document.getElementById('questionForm');
    let opts = q.options;
    if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch(_) { opts = null; } }
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) opts = {};
    form.text.value          = q.text          || '';
    form.optionA.value       = opts.A || q.optionA || '';
    form.optionB.value       = opts.B || q.optionB || '';
    form.optionC.value       = opts.C || q.optionC || '';
    form.optionD.value       = opts.D || q.optionD || '';
    form.correctAnswer.value = q.correctAnswer  || 'A';
    form.difficulty.value    = q.difficulty     || 'medium';
    form.explanation.value   = q.explanation    || '';
    await _loadSubjectDropdown('questionForm', q.subjectId, q.topicId);
    document.getElementById('questionModal').style.display = 'flex';
  }

  async function save(e) {
    e.preventDefault();
    const form = document.getElementById('questionForm');
    const text = form.text.value.trim();
    if (!text) { alert('Question text is required.'); return; }

    const saveBtn = form.querySelector('[type="submit"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
      // Get subject name for denormalisation
      const subjectId = form.subjectId?.value || '';
      const subj = subjectsCache.find(s => s.$id === subjectId);
      const subjectName = subj?.name || '';

      const optionA = form.optionA.value.trim();
      const optionB = form.optionB.value.trim();
      const optionC = form.optionC.value.trim();
      const optionD = form.optionD.value.trim();

      const data = {
        text,
        options:       JSON.stringify({ A: optionA, B: optionB, C: optionC, D: optionD }),
        optionA, optionB, optionC, optionD,       // also store flat for easy query
        correctAnswer: form.correctAnswer.value,
        subjectId,
        subject:       subjectName,
        topicId:       form.topicId?.value || '',
        topic:         form.topicId?.options[form.topicId?.selectedIndex]?.textContent || '',
        difficulty:    form.difficulty.value,
        explanation:   form.explanation?.value?.trim() || '',
        examCount:     editingId ? undefined : 0,
      };

      // Upload image if present
      const imgFile = form.querySelector('[name="image"]')?.files?.[0];
      if (imgFile) {
        data.imageUrl = await CLOUD.upload(imgFile, 'questions', `q_${Date.now()}`);
      }

      if (editingId) {
        delete data.examCount;
        await DB.update(SD.COL.QUESTIONS, editingId, data);
        await audit('QUESTION_UPDATED', { id: editingId });
      } else {
        // Duplicate check by text
        const existing = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('text', text)], 1);
        if (existing.total > 0) { alert('This question already exists in the bank.'); return; }

        await DB.create(SD.COL.QUESTIONS, { ...data, examCount: 0 });
        await audit('QUESTION_CREATED', { subjectId });
      }

      closeModal('questionModal');
      load(currentPage);
    } catch(e) {
      alert('Save failed: ' + e.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Question'; }
    }
  }

  async function deleteQuestion(id) {
    if (!confirm('Delete this question? It will be removed from all exams.')) return;
    try {
      await DB.delete(SD.COL.QUESTIONS, id);
      await audit('QUESTION_DELETED', { id });
      load(currentPage);
    } catch(e) { alert('Delete failed: ' + e.message); }
  }

  /* ── EXCEL IMPORT ────────────────────────────────────────────────── */
  async function importExcel() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls';
    input.onchange = async e => {
      const file = e.target.files[0]; if(!file) return;
      if (!window.XLSX) { alert('XLSX library not loaded.'); return; }
      const statusEl = document.getElementById('qImportStatus') || { textContent: '' };
      try {
        const data  = await file.arrayBuffer();
        const wb    = XLSX.read(data);
        const rows  = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:'' });
        let added=0, skipped=0;
        for (const row of rows) {
          const text = (row['Question Text'] || row['question'] || '').toString().trim();
          if (!text) { skipped++; continue; }

          // Duplicate check
          const ex = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('text', text)], 1);
          if (ex.total > 0) { skipped++; continue; }

          const subjectName = (row['Subject'] || row['subject'] || '').toString().trim();
          const subj = subjectsCache.find(s => s.name.toLowerCase() === subjectName.toLowerCase());

          await DB.create(SD.COL.QUESTIONS, {
            text,
            optionA:       String(row['Option A']||''),
            optionB:       String(row['Option B']||''),
            optionC:       String(row['Option C']||''),
            optionD:       String(row['Option D']||''),
            options:       JSON.stringify({ A:String(row['Option A']||''), B:String(row['Option B']||''), C:String(row['Option C']||''), D:String(row['Option D']||'') }),
            correctAnswer: String(row['Correct Answer']||'A'),
            subjectId:     subj?.$id || '',
            subject:       subjectName,
            topic:         String(row['Topic']||''),
            difficulty:    String(row['Difficulty']||'medium').toLowerCase(),
            explanation:   String(row['Explanation']||''),
            examCount:     0,
          });
          added++;
          if (statusEl) statusEl.textContent = `Importing… ${added} added`;
        }
        alert(`Import complete: ${added} added, ${skipped} duplicates skipped.`);
        load(0);
      } catch(err) { alert('Import failed: ' + err.message); }
    };
    input.click();
  }

  /* ── SUBJECT DROPDOWNS ───────────────────────────────────────────── */
  async function _loadSubjectFilter() {
    const sel = document.getElementById('qSubjF'); if(!sel || sel.dataset.loaded) return;
    try {
      const res = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 200);
      subjectsCache = res.documents;
      sel.innerHTML = '<option value="">All Subjects</option>';
      res.documents.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.$id; opt.textContent = d.name;
        sel.appendChild(opt);
      });
      sel.dataset.loaded = '1';
    } catch(e) { console.warn('_loadSubjectFilter', e); }
  }

  async function _loadSubjectDropdown(formId, selectedSubj, selectedTopic) {
    const form = document.getElementById(formId); if(!form) return;
    try {
      const res = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 200);
      subjectsCache = res.documents;
      form.subjectId.innerHTML = '<option value="">Select Subject</option>';
      res.documents.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.$id; opt.textContent = d.name;
        if (selectedSubj && d.$id === selectedSubj) opt.selected = true;
        form.subjectId.appendChild(opt);
      });
      if (selectedSubj) await _loadTopics(selectedSubj, form.topicId, selectedTopic);
      form.subjectId.onchange = () => _loadTopics(form.subjectId.value, form.topicId);
    } catch(e) { console.warn('_loadSubjectDropdown', e); }
  }

  async function _loadTopics(subjectId, topicSelect, selectedTopic) {
    if (!topicSelect || !subjectId) return;
    try {
      const res = await DB.list(SD.COL.TOPICS, [SD.Q.equal('subjectId', subjectId), SD.Q.orderAsc('name')], 200);
      topicSelect.innerHTML = '<option value="">All Topics</option>';
      res.documents.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.$id; opt.textContent = d.name;
        if (selectedTopic && d.$id === selectedTopic) opt.selected = true;
        topicSelect.appendChild(opt);
      });
    } catch(e) { console.warn('_loadTopics', e); }
  }

  function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('questionForm');
    if (form) form.addEventListener('submit', save);
  });

  return { load, filter, search, showAdd, showEdit, save, delete: deleteQuestion, importExcel };
})();
