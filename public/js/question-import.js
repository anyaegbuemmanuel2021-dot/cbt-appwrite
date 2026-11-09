/* SOFTLY DIGITAL V3 — local Excel/Word question-bank importer */
(() => {
  'use strict';
  const MAX_BYTES = 15 * 1024 * 1024, MAX_ROWS = 2000;
  const ALIASES = {
    question:['question','questiontext','text'], optiona:['optiona','a','option1','choicea'],
    optionb:['optionb','b','option2','choiceb'], optionc:['optionc','c','option3','choicec'],
    optiond:['optiond','d','option4','choiced'], correctanswer:['correctanswer','correct','answer','key'],
    subject:['subject','subjectname'], topic:['topic','topicname'],
    difficulty:['difficulty','level'], explanation:['explanation','solution','rationale']
  };
  let rows = [], busy = false, sourceFile = null;

  function allowed() { return !!(window.RBAC && RBAC.can('uploadFiles') && RBAC.can('questions')); }
  function modal() {
    let el = document.getElementById('questionImportModal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'questionImportModal'; el.className = 'modal';
    el.innerHTML = \`
      <div class="modal-content wide-modal" style="width:min(1080px,96vw);max-height:92vh;overflow:auto">
        <div class="modal-header"><h2>Import Questions</h2><button type="button" class="modal-close" data-close>✕</button></div>
        <div class="modal-form">
          <p>Upload Excel (.xlsx, .xls, .csv) or Word (.docx). The file is parsed locally and validated before saving.</p>
          <div class="form-row">
            <div class="form-group" style="flex:1"><label>Default subject *</label><select id="qiSubject"><option value="">Loading subjects…</option></select></div>
            <div class="form-group" style="flex:1"><label>Question file *</label><input id="qiFile" type="file" accept=".xlsx,.xls,.csv,.docx"></div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0 14px">
            <button type="button" class="btn-outline-sm" id="qiTemplate">Download Excel template</button>
            <span class="field-hint">Required columns: Question, Option A–D, Correct Answer.</span>
          </div>
          <div id="qiStatus" role="status" aria-live="polite" style="padding:10px;border-radius:8px;background:#f3f4f6;margin:10px 0">Choose a file to preview.</div>
          <div id="qiPreview" style="overflow:auto;max-height:330px"></div>
          <div class="modal-footer" style="position:sticky;bottom:-24px;background:#fff;padding:14px 0">
            <button type="button" class="btn-outline" data-close>Cancel</button>
            <button type="button" class="btn-primary" id="qiImport" disabled>Import valid questions</button>
          </div>
        </div>
      </div>\`;
    document.body.appendChild(el);
    el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    el.querySelector('#qiFile').addEventListener('change', readFile);
    el.querySelector('#qiTemplate').addEventListener('click', template);
    el.querySelector('#qiImport').addEventListener('click', saveRows);
    return el;
  }
  async function open() {
    if (!allowed()) return alert('Your account cannot import questions.');
    const el = modal(); rows = []; sourceFile = null;
    el.querySelector('#qiFile').value = '';
    el.querySelector('#qiPreview').innerHTML = '';
    el.querySelector('#qiImport').disabled = true;
    el.querySelector('#qiStatus').textContent = 'Choose an Excel or Word file to preview.';
    el.style.display = 'flex';
    try {
      const result = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 500);
      const select = el.querySelector('#qiSubject');
      select.innerHTML = '<option value="">Select a subject</option>';
      (result.documents || []).forEach(s => {
        const option = document.createElement('option'); option.value = s.$id; option.textContent = s.name; select.appendChild(option);
      });
      if (!result.documents?.length) select.innerHTML = '<option value="">Create a subject first</option>';
    } catch (error) { status('Could not load subjects: ' + error.message, true); }
  }
  function close() { if (busy) return; const el = document.getElementById('questionImportModal'); if (el) el.style.display = 'none'; }
  async function readFile(event) {
    const file = event.target.files?.[0]; rows = []; sourceFile = file || null;
    const el = modal(), preview = el.querySelector('#qiPreview'), button = el.querySelector('#qiImport');
    preview.innerHTML = ''; button.disabled = true;
    if (!file) return;
    if (file.size > MAX_BYTES) return status('File exceeds the 15 MB limit.', true);
    try {
      status('Reading ' + file.name + '…');
      const ext = file.name.toLowerCase().split('.').pop();
      let raw;
      if (['xlsx','xls','csv'].includes(ext)) raw = await readExcel(file);
      else if (ext === 'docx') raw = await readWord(file);
      else throw new Error('Unsupported format. Use Excel, CSV or .docx.');
      if (!raw.length) throw new Error('No question rows found. Check the file format and template.');
      if (raw.length > MAX_ROWS) throw new Error('Maximum 2,000 questions per upload. Split this file into smaller batches.');
      rows = raw.map((item, index) => validate(item, index + 2));
      previewRows();
    } catch (error) { rows = []; status(error.message || 'Could not read file.', true); }
  }
  async function readExcel(file) {
    if (!window.XLSX) throw new Error('Excel reader did not load. Refresh and retry.');
    const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('Workbook has no worksheet.');
    return matrixToRows(XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:false}));
  }
  async function readWord(file) {
    if (!window.JSZip) throw new Error('Word reader did not load. Refresh and retry.');
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('Invalid .docx document.');
    const xml = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Word document XML is invalid.');
    const trs = Array.from(xml.getElementsByTagName('w:tr'));
    const table = trs.map(tr => Array.from(tr.getElementsByTagName('w:tc')).map(tc => wordText(tc))).filter(r => r.some(Boolean));
    if (table.length) return matrixToRows(table);
    const paragraphs = Array.from(xml.getElementsByTagName('w:p')).map(wordText).filter(Boolean);
    const result = []; let current = {};
    const labels = {'question':'question','question text':'question','option a':'optiona','a':'optiona','a)':'optiona','a.':'optiona','option b':'optionb','b':'optionb','b)':'optionb','b.':'optionb','option c':'optionc','c':'optionc','c)':'optionc','c.':'optionc','option d':'optiond','d':'optiond','d)':'optiond','d.':'optiond','correct answer':'correctanswer','answer':'correctanswer','subject':'subject','topic':'topic','difficulty':'difficulty','explanation':'explanation'};
    for (const p of paragraphs) {
      const m = p.match(/^\s*(Question(?:\s*Text)?|Option\s*[A-D]|[A-D][).:]?|Correct\s*Answer|Answer|Subject|Topic|Difficulty|Explanation)\s*:\s*(.*)$/i);
      if (!m) { if (current.question) current.question += '\n' + p; continue; }
      const key = labels[m[1].toLowerCase().replace(/\s+/g,' ').trim()];
      if (key === 'question' && current.question) { result.push(current); current = {}; }
      if (key) current[key] = m[2].trim();
    }
    if (current.question) result.push(current);
    return result;
  }
  function wordText(node) { return Array.from(node.getElementsByTagName('w:t')).map(t => t.textContent || '').join('').replace(/\u00a0/g,' ').trim(); }
  function matrixToRows(matrix) {
    const values = matrix.map(row => row.map(cell => String(cell ?? '').trim()));
    const headerIndex = values.findIndex(row => row.map(normalize).includes('question') && row.map(normalize).includes('optiona'));
    if (headerIndex < 0) throw new Error('Header row not found. Use the provided template or a Word table with column headings.');
    const headers = values[headerIndex].map(normalize);
    return values.slice(headerIndex + 1).filter(row => row.some(Boolean)).map(row => {
      const item = {};
      headers.forEach((header, i) => { const key = canonical(header); if (key) item[key] = row[i] ?? ''; });
      return item;
    });
  }
  function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function canonical(header) { for (const [key, list] of Object.entries(ALIASES)) if (list.includes(header)) return key; return ''; }
  function validate(source, line) {
    const get = key => String(source[key] ?? '').trim();
    const answer = get('correctanswer').toUpperCase().replace(/[^A-D]/g,'');
    const item = {line, question:get('question'), optiona:get('optiona'), optionb:get('optionb'), optionc:get('optionc'), optiond:get('optiond'), correctanswer:answer, subject:get('subject'), topic:get('topic'), difficulty:['easy','medium','hard'].includes(get('difficulty').toLowerCase()) ? get('difficulty').toLowerCase() : 'medium', explanation:get('explanation'), errors:[]};
    if (!item.question) item.errors.push('Question is empty');
    if (![item.optiona,item.optionb,item.optionc,item.optiond].every(Boolean)) item.errors.push('All four options are required');
    if (!['A','B','C','D'].includes(answer)) item.errors.push('Correct Answer must be A, B, C or D');
    if (item.question.length > 2000) item.errors.push('Question exceeds 2,000 characters');
    if ([item.optiona,item.optionb,item.optionc,item.optiond].some(v => v.length > 500)) item.errors.push('Option exceeds 500 characters');
    if (item.explanation.length > 1000) item.errors.push('Explanation exceeds 1,000 characters');
    return item;
  }
  function previewRows() {
    const el = modal(), good = rows.filter(r => !r.errors.length), bad = rows.length - good.length;
    el.querySelector('#qiPreview').innerHTML = \`
      <p><strong>\${rows.length} rows</strong> · <span style="color:#16803c">\${good.length} valid</span> · <span style="color:#b45309">\${bad} invalid</span></p>
      <table class="admin-table" style="min-width:740px"><thead><tr><th>Row</th><th>Question</th><th>Subject</th><th>Answer</th><th>Check</th></tr></thead><tbody>
      \${rows.slice(0,30).map(r => \`<tr><td>\${r.line}</td><td>\${escape(r.question.slice(0,100))}</td><td>\${escape(r.subject || 'Default subject')}</td><td>\${escape(r.correctanswer)}</td><td style="color:\${r.errors.length?'#b91c1c':'#16803c'}">\${r.errors.length?escape(r.errors.join('; ')):'Ready'}</td></tr>\`).join('')}
      </tbody></table>\${rows.length>30?'<p class="field-hint">Showing first 30 rows.</p>':''}\`;
    el.querySelector('#qiImport').disabled = !good.length;
    status(good.length + ' valid and ' + bad + ' invalid rows. Invalid rows will not be imported.');
  }
  async function saveRows() {
    if (busy || !allowed()) return alert('Your account cannot import questions.');
    const el = modal(), subjectId = el.querySelector('#qiSubject').value;
    const subjectResult = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 500);
    const subjects = subjectResult.documents || [], fallback = subjects.find(s => s.$id === subjectId);
    if (!fallback) return status('Select a valid default subject.', true);
    const valid = rows.filter(r => !r.errors.length);
    if (!valid.length) return;
    busy = true; const button = el.querySelector('#qiImport'); button.disabled = true; button.textContent = 'Importing…';
    let added = 0, duplicates = 0, failed = 0; const seen = new Set();
    try {
      for (let i=0; i<valid.length; i++) {
        const r = valid[i], fingerprint = r.question.toLowerCase().replace(/\s+/g,' ').trim();
        if (seen.has(fingerprint)) { duplicates++; continue; }
        seen.add(fingerprint);
        try {
          const existing = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('text',r.question)], 1);
          if (existing.total > 0) { duplicates++; continue; }
          const subject = r.subject ? subjects.find(s => s.name.toLowerCase() === r.subject.toLowerCase()) : fallback;
          if (!subject) { failed++; r.errors.push('Subject "' + r.subject + '" does not exist'); continue; }
          await DB.create(SD.COL.QUESTIONS, {
            text:r.question, optionA:r.optiona, optionB:r.optionb, optionC:r.optionc, optionD:r.optiond,
            options:JSON.stringify({A:r.optiona,B:r.optionb,C:r.optionc,D:r.optiond}),
            correctAnswer:r.correctanswer, subjectId:subject.$id, subject:subject.name,
            topicId:'', topic:r.topic, difficulty:r.difficulty, explanation:r.explanation, examCount:0
          });
          added++;
        } catch (error) { failed++; r.errors.push(error.message || 'Database write failed'); }
        if ((i+1)%5===0 || i===valid.length-1) status('Importing ' + (i+1) + '/' + valid.length + ' · Added ' + added + ' · Duplicates ' + duplicates + ' · Failed ' + failed);
      }
      if (added && typeof window.audit === 'function') { try { await window.audit('QUESTIONS_IMPORTED',{added,duplicates,failed,fileName:sourceFile?.name || ''}); } catch (_) {} }
      status('Import complete. Added: ' + added + '. Duplicates: ' + duplicates + '. Failed: ' + failed + '.', failed>0);
      alert('Import complete\n\nAdded: ' + added + '\nDuplicates skipped: ' + duplicates + '\nFailed: ' + failed);
      if (added && window.QuestionManager) QuestionManager.load(0);
    } catch (error) { status('Import stopped: ' + error.message, true); }
    finally { busy = false; button.disabled = !rows.some(r => !r.errors.length); button.textContent = 'Import valid questions'; }
  }
  function template() {
    if (!window.XLSX) return alert('Excel template generator did not load.');
    const data = [['Question','Option A','Option B','Option C','Option D','Correct Answer','Subject','Topic','Difficulty','Explanation'],['What is the capital of Nigeria?','Abuja','Lagos','Kano','Ibadan','A','','Geography','easy','Abuja is the federal capital.']];
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),'Questions');
    XLSX.writeFile(book,'softly-cbt-question-template.xlsx');
  }
  function status(message, error=false) {
    const el = document.getElementById('qiStatus'); if (!el) return;
    el.textContent = message; el.style.color = error ? '#b91c1c' : '#263238'; el.style.background = error ? '#fef2f2' : '#f3f4f6';
  }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  window.QuestionImport = {open};
})();