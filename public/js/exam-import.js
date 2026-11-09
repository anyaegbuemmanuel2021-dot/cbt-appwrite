/* SOFTLY DIGITAL V3 — Excel/Word exam importer */
(() => {
  'use strict';
  const MAX_BYTES = 15 * 1024 * 1024, MAX_ROWS = 1000;
  const ALIASES = {
    name:['examname','name','title'], subject:['subject','subjectname'], subjectid:['subjectid'],
    duration:['duration','durationminutes','time','timeminutes'],
    totalquestions:['totalquestions','questioncount','numberofquestions','questions'],
    passingscore:['passingscore','passscore','passmark','passingmark']
  };
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function canonical(value) { const key = norm(value); for (const pair of Object.entries(ALIASES)) if (pair[1].includes(key)) return pair[0]; return ''; }
  function allowed() { return !!(window.RBAC && RBAC.can('uploadFiles') && RBAC.can('manageExams')); }
  function open() {
    if (!allowed()) return alert('Your account cannot import exams.');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls,.csv,.docx';
    input.onchange = event => { const file = event.target.files && event.target.files[0]; if (file) importFile(file); };
    input.click();
  }
  async function importFile(file) {
    if (file.size > MAX_BYTES) return alert('File exceeds the 15 MB limit.');
    try {
      const ext = file.name.toLowerCase().split('.').pop();
      let raw;
      if (['xlsx','xls','csv'].includes(ext)) raw = await readExcel(file);
      else if (ext === 'docx') raw = await readWord(file);
      else throw new Error('Use .xlsx, .xls, .csv or .docx files.');
      if (!raw.length) throw new Error('No exam records found. Use the exam import template headings.');
      if (raw.length > MAX_ROWS) throw new Error('Maximum 1,000 exams per upload.');
      const subjectsResult = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 500);
      const subjects = subjectsResult.documents || [];
      const parsed = raw.map((item, i) => validate(item, i + 2, subjects));
      const valid = parsed.filter(item => !item.error);
      const invalid = parsed.filter(item => item.error);
      if (!valid.length) return alert('No valid exams found.\n\n' + invalid.slice(0,8).map(x => 'Row ' + x.line + ': ' + x.error).join('\n'));
      const sample = valid.slice(0,5).map(x => '• ' + x.name + ' — ' + x.subject.name + ' — ' + x.totalQuestions + ' questions').join('\n');
      const proceed = confirm('Exam import preview\n\nValid: ' + valid.length + '\nInvalid: ' + invalid.length + '\n\n' + sample + '\n\nImport valid exams now?');
      if (!proceed) return;
      const existingResult = await DB.list(SD.COL.EXAMS, [], 500);
      const existingNames = new Set((existingResult.documents || []).map(x => norm(x.name)));
      const seen = new Set(); let added = 0, duplicates = 0, failed = 0;
      for (let i = 0; i < valid.length; i++) {
        const item = valid[i], key = norm(item.name);
        if (seen.has(key) || existingNames.has(key)) { duplicates++; continue; }
        seen.add(key);
        try {
          await DB.create(SD.COL.EXAMS, {
            name:item.name, subjectId:item.subject.$id, subject:item.subject.name,
            duration:item.duration, totalQuestions:item.totalQuestions, passingScore:item.passingScore,
            randomizeQuestions:true, shuffleOptions:true, active:false, status:'draft',
            candidateIds:JSON.stringify([]), centreIds:JSON.stringify([]),
            createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
          });
          added++;
        } catch (error) { failed++; console.error('[ExamImport] Failed row ' + item.line, error); }
      }
      if (added && typeof window.audit === 'function') { try { await window.audit('EXAMS_IMPORTED', {added,duplicates,failed,fileName:file.name}); } catch (_) {} }
      alert('Exam import finished.\n\nAdded: ' + added + '\nDuplicates skipped: ' + duplicates + '\nInvalid rows: ' + invalid.length + '\nDatabase failures: ' + failed);
      if (added && typeof ExamManager !== 'undefined') ExamManager.load();
    } catch (error) { alert('Exam import failed: ' + (error.message || error)); }
  }
  async function readExcel(file) {
    if (!window.XLSX) throw new Error('Excel reader did not load. Refresh the page and retry.');
    const book = XLSX.read(await file.arrayBuffer(), {type:'array'});
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) throw new Error('Workbook has no worksheet.');
    return matrixToRows(XLSX.utils.sheet_to_json(sheet, {header:1, defval:'', raw:false}));
  }
  async function readWord(file) {
    if (!window.JSZip) throw new Error('Word reader did not load. Refresh the page and retry.');
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('Invalid .docx file.');
    const xml = new DOMParser().parseFromString(await entry.async('text'), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('Word document XML is invalid.');
    const rows = Array.from(xml.getElementsByTagNameNS('*','tr')).map(tr => Array.from(tr.getElementsByTagNameNS('*','tc')).map(tc => wordText(tc))).filter(row => row.some(Boolean));
    if (rows.length) return matrixToRows(rows);
    const paragraphs = Array.from(xml.getElementsByTagNameNS('*','p')).map(wordText).filter(Boolean);
    const result = []; let current = {};
    const labels = {
      'exam name':'name','name':'name','title':'name','subject':'subject','subject id':'subjectid',
      'duration':'duration','duration minutes':'duration','total questions':'totalquestions',
      'question count':'totalquestions','passing score':'passingscore','pass score':'passingscore','pass mark':'passingscore'
    };
    for (const paragraph of paragraphs) {
      const match = paragraph.match(/^\s*(Exam\s*Name|Name|Title|Subject(?:\s*ID)?|Duration(?:\s*Minutes)?|Total\s*Questions|Question\s*Count|Passing\s*Score|Pass\s*Score|Pass\s*Mark)\s*:\s*(.*)$/i);
      if (!match) continue;
      const label = match[1].toLowerCase().replace(/\s+/g,' ').trim();
      const key = labels[label];
      if (key === 'name' && current.name) { result.push(current); current = {}; }
      if (key) current[key] = match[2].trim();
    }
    if (current.name) result.push(current);
    return result;
  }
  function wordText(node) { return Array.from(node.getElementsByTagNameNS('*','t')).map(t => t.textContent || '').join('').replace(/\u00a0/g,' ').trim(); }
  function matrixToRows(matrix) {
    const values = matrix.map(row => row.map(cell => String(cell == null ? '' : cell).trim()));
    const headerIndex = values.findIndex(row => row.some(cell => canonical(cell) === 'name') && row.some(cell => canonical(cell) === 'duration'));
    if (headerIndex < 0) throw new Error('Exam headings not found. Include Exam Name, Subject, Duration, Total Questions and Pass Score.');
    const headers = values[headerIndex].map(canonical);
    return values.slice(headerIndex + 1).filter(row => row.some(Boolean)).map(row => { const item = {}; headers.forEach((key,i) => { if (key) item[key] = row[i] || ''; }); return item; });
  }
  function validate(source, line, subjects) {
    const name = String(source.name || '').trim();
    const subjectName = String(source.subject || '').trim();
    const subjectId = String(source.subjectid || '').trim();
    const subject = subjects.find(s => (subjectId && s.$id === subjectId) || (subjectName && norm(s.name) === norm(subjectName)));
    const duration = Number.parseInt(source.duration, 10);
    const totalQuestions = Number.parseInt(source.totalquestions, 10);
    const passingScore = source.passingscore === '' || source.passingscore == null ? 70 : Number.parseInt(source.passingscore, 10);
    let error = '';
    if (!name) error = 'Exam name is required';
    else if (!subject) error = 'Subject is missing or does not exist';
    else if (!Number.isInteger(duration) || duration < 1 || duration > 600) error = 'Duration must be 1–600 minutes';
    else if (!Number.isInteger(totalQuestions) || totalQuestions < 1 || totalQuestions > 1000) error = 'Total questions must be 1–1,000';
    else if (!Number.isInteger(passingScore) || passingScore < 0 || passingScore > 100) error = 'Pass score must be 0–100';
    return {line,name,subject,duration,totalQuestions,passingScore,error};
  }
  window.ExamImport = {open};
})();
