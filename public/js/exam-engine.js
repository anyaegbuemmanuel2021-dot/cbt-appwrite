/**
 * SOFTLY DIGITAL V3 — exam-engine.js (Appwrite edition)
 * JAMB-style: multiple subjects per exam, subject tabs, question palette,
 * timer, anti-cheat, auto-submit, Appwrite backend.
 */
const ExamEngine = (() => {
  'use strict';

  let exam         = null;
  let allQuestions = [];          // flat array of all questions
  let subjectMap   = {};          // subjectName -> [questions]
  let activeSubject= null;        // current subject tab
  let answers      = {};
  let flags        = new Set();
  let currentIdx   = 0;           // index within activeSubject questions
  let sessionId    = null;
  let isSubmitting = false;
  let isActive     = false;

  /* ── INIT ────────────────────────────────────────────────────────── */
  async function init() {
    const user = await AUTH.current();
    if (!user) { location.href = 'candidate-login.html'; return; }

    // Populate header: candidate photo + name
    try {
      const candDoc = await DB.get(SD.COL.CANDIDATES, user.$id);
      const nameEl  = document.getElementById('candName');
      const photoEl = document.getElementById('candPhoto');
      if (nameEl)  nameEl.textContent = candDoc.fullName || user.name || 'Candidate';
      if (photoEl && candDoc.passportImageUrl) photoEl.src = candDoc.passportImageUrl;
      _setEl('candidateReg', candDoc.candidateId || '—');
    } catch (_) {
      const nameEl = document.getElementById('candName');
      if (nameEl) nameEl.textContent = user.name || 'Candidate';
    }

    const params = new URLSearchParams(location.search);
    const examId = params.get('examId') || localStorage.getItem('currentExamId');
    if (!examId) { _setStep('ls1','❌ No exam ID provided'); return; }

    try {
      /* ── Step 1: Load exam ── */
      _setStep('ls1', '✅ Exam data loaded');
      const examDoc = await DB.get(SD.COL.EXAMS, examId);
      exam = { id: examDoc.$id, ...examDoc };
      _setEl('ehTitle', exam.name);

      /* ── Step 2: Load questions by subject (JAMB style) ── */
      _setStep('ls2', '⏳ Loading questions…');
      // Questions linked to exam by examId field OR by subjectId if exam has subjectIds[]
      let qRes;
      if (exam.subjectIds && exam.subjectIds.length) {
        // Multi-subject exam — fetch per subject in parallel
        const perSubject = await Promise.all(
          exam.subjectIds.map(sid =>
            DB.list(SD.COL.QUESTIONS, [SD.Q.equal('subjectId', sid)], exam.totalQuestions || 200)
          )
        );
        const all = perSubject.flatMap(r => r.documents);
        qRes = { documents: all };
      } else {
        qRes = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('examId', examId)], exam.totalQuestions || 200);
        if (!qRes.documents.length) {
          // Fallback: fetch by subjectId
          if (exam.subjectId) {
            qRes = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('subjectId', exam.subjectId)], exam.totalQuestions || 200);
          }
        }
      }

      if (!qRes.documents.length) throw new Error('No questions found for this exam.');

      allQuestions = qRes.documents.map(d => ({ id: d.$id, ...d, options: _normalizeOptions(d) }));

      // Randomise if enabled
      if (exam.randomizeQuestions !== false) allQuestions = _shuffle(allQuestions);

      // Limit to totalQuestions
      if (exam.totalQuestions && allQuestions.length > exam.totalQuestions) {
        allQuestions = allQuestions.slice(0, exam.totalQuestions);
      }

      // Shuffle options
      if (exam.shuffleOptions !== false) {
        allQuestions = allQuestions.map(q => ({ ...q, shuffledOptions: _shuffleOptions(q.options) }));
      }

      // Build subject map (JAMB tabs)
      subjectMap = {};
      allQuestions.forEach(q => {
        const subj = q.subject || q.subjectName || 'General';
        if (!subjectMap[subj]) subjectMap[subj] = [];
        subjectMap[subj].push(q);
      });
      _setStep('ls2', '✅ Questions loaded & randomised');

      /* ── Step 3: Restore saved answers ── */
      _setStep('ls3', '✅ Options shuffled');
      const saved = localStorage.getItem('examAnswers_' + examId);
      if (saved) try { answers = JSON.parse(saved); } catch(_) {}
      allQuestions.forEach(q => { if (answers[q.id] === undefined) answers[q.id] = null; });

      /* ── Step 4: Create or resume session ── */
      const existingSession = localStorage.getItem('examSession_' + examId);
      if (existingSession) {
        sessionId = existingSession;
        try {
          const ses = await DB.get(SD.COL.SESSIONS, sessionId);
          if (ses.answers) {
            const remote = JSON.parse(ses.answers);
            answers = { ...answers, ...remote };
          }
        } catch(_) {}
      } else {
        const ses = await DB.create(SD.COL.SESSIONS, {
          candidateId: user.$id,
          examId,
          duration:    exam.duration || 60,
          startTime:   new Date().toISOString(),
          status:      'active',
          answers:     JSON.stringify({}),
          violations:  0,
          questionIds: JSON.stringify(allQuestions.map(q => q.id)),
        });
        sessionId = ses.$id;
        localStorage.setItem('examSession_' + examId, sessionId);
      }

      /* ── Step 5: Security config + AntiCheat ── */
      _setStep('ls4', '✅ Security monitoring started');
      await _loadSecurityConfig();
      if (window.AntiCheat) AntiCheat.init({ sessionId, examId, candidateId: user.$id });

      /* ── Step 6: Start timer ── */
      const savedTime = localStorage.getItem('examTimeLeft_' + examId);
      const timeLeft  = savedTime ? parseInt(savedTime) : exam.duration * 60;
      ExamTimer.start(timeLeft, examId, () => autoSubmit('timeout'));

      isActive = true;
      await enforceFullscreen();

      /* ── Start sync loop ── */
      ExamSync.start(examId, sessionId, answers);

      /* ── Build subject tabs (JAMB style) ── */
      _buildSubjectTabs();

      /* ── Hide loading, show exam ── */
      _setEl('totalQCount', allQuestions.length);
      _setEl('ehQCount', `1/${allQuestions.length}`);

      // Show first subject
      activeSubject = Object.keys(subjectMap)[0];
      renderQuestion(0);
      updatePalette();

      document.getElementById('loadingScreen')?.classList.add('is-hidden');
      document.getElementById('app')?.classList.add('is-ready');
      document.getElementById('app')?.setAttribute('aria-hidden', 'false');

    } catch(err) {
      console.error('ExamEngine init error:', err);
      const stepsEl = document.querySelector('.load-steps');
      if (stepsEl) stepsEl.innerHTML =
        `<div style="color:#dc3545;padding:12px">❌ ${err.message}<br><small>Please contact your invigilator.</small></div>`;
      else alert('Failed to load exam: ' + err.message);
    }
  }

  /* ── SUBJECT TABS (JAMB structure) ─────────────────────────────── */
  function _buildSubjectTabs() {
    const legacyContainer = document.getElementById('subjectTabs');
    const listContainer   = document.getElementById('subjectList');
    const subjects = Object.keys(subjectMap);

    if (legacyContainer) {
      legacyContainer.innerHTML = subjects.map(s => `
        <button class="subj-tab ${s === activeSubject ? 'active' : ''}"
                onclick="ExamEngine.switchSubject('${s}')" data-subj="${s}">
          ${s}
          <span class="subj-count">${_subjectAnswered(s)}/${subjectMap[s].length}</span>
        </button>`).join('');
    }

    if (listContainer) {
      listContainer.innerHTML = subjects.map(s => `
        <li class="subject-item ${s === activeSubject ? 'is-active' : ''}" data-subj="${s}" role="option" tabindex="0">
          <span>${s}</span>
          <span class="subj-badge">${_subjectAnswered(s)}/${subjectMap[s].length}</span>
        </li>`).join('');
      listContainer.querySelectorAll('.subject-item').forEach(li => {
        li.addEventListener('click', () => switchSubject(li.dataset.subj));
        li.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchSubject(li.dataset.subj); }
        });
      });
    }
  }

  function switchSubject(subjectName) {
    activeSubject = subjectName;
    currentIdx = 0;
    document.querySelectorAll('.subj-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.subj === subjectName));
    document.querySelectorAll('#subjectList .subject-item').forEach(li =>
      li.classList.toggle('is-active', li.dataset.subj === subjectName));
    renderQuestion(0);
    updatePalette();
  }

  function _subjectAnswered(subj) {
    return (subjectMap[subj] || []).filter(q => answers[q.id]).length;
  }

  /* ── FULLSCREEN ──────────────────────────────────────────────────── */
  async function enforceFullscreen() {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch(_) {}
  }

  /* ── RENDER QUESTION ─────────────────────────────────────────────── */
  function renderQuestion(idx) {
    const questions = subjectMap[activeSubject] || [];
    if (!questions.length) return;
    if (idx < 0 || idx >= questions.length) return;
    currentIdx = idx;
    const q = questions[idx];

    // Global index for header
    const globalIdx = allQuestions.findIndex(x => x.id === q.id);
    _setEl('qBadge', `Q ${globalIdx + 1}`);
    _setEl('qMeta', [q.subject, q.topic].filter(Boolean).join(' → '));
    _setEl('ehQCount', `${globalIdx + 1}/${allQuestions.length}`);
    _setEl('questionCounter', `Question ${globalIdx + 1} of ${allQuestions.length}`);
    const subjChip = document.getElementById('ehSubject');
    if (subjChip) subjChip.textContent = (q.subject || activeSubject || '—').toUpperCase();
    _setEl('activeSubjectChip', q.subject || activeSubject || '—');

    // Difficulty
    const diff = document.getElementById('qDiff');
    if (diff) diff.textContent = { easy:'🟢 Easy', medium:'🟡 Medium', hard:'🔴 Hard' }[q.difficulty] || '';

    // Question text
    _setEl('qText', q.text || '');
    _setEl('questionText', q.text || '');

    // Question image
    const imgWrap = document.getElementById('qImgWrap');
    const imgEl   = document.getElementById('qImg');
    if (imgWrap && imgEl) {
      if (q.imageUrl) { imgEl.src = q.imageUrl; imgWrap.style.display = 'block'; }
      else imgWrap.style.display = 'none';
    }

    // Options
    const opts = q.shuffledOptions || q.options || {};
    const list = document.getElementById('optionsList');
    if (list) {
      list.innerHTML = '';
      Object.entries(opts).forEach(([letter, text]) => {
        const isSelected = answers[q.id] === letter;
        const div = document.createElement('div');
        div.className = 'option' + (isSelected ? ' is-selected' : '');
        div.setAttribute('role', 'radio');
        div.setAttribute('aria-checked', String(isSelected));
        div.innerHTML = `
          <span class="option-radio"></span>
          <span class="option-letter">${letter}.</span>
          <span class="option-text">${text}</span>`;
        div.onclick = () => selectAnswer(q.id, letter);
        list.appendChild(div);
      });
    }

    // Flag
    const flagBtn = document.getElementById('flagBtn');
    const isFlagged = flags.has(q.id);
    if (flagBtn) flagBtn.classList.toggle('flagged', isFlagged);
    if (flagBtn) flagBtn.classList.toggle('is-flagged', isFlagged);
    _setEl('flagBtnText', isFlagged ? 'Unflag' : 'Flag');

    const subjects = Object.keys(subjectMap);
    const isFirstSubject = subjects.indexOf(activeSubject) === 0;
    const isLastSubject  = subjects.indexOf(activeSubject) === subjects.length - 1;
    const prevBtnEl = document.getElementById('prevBtn');
    const nextBtnEl = document.getElementById('nextBtn');
    if (prevBtnEl) prevBtnEl.disabled = idx === 0 && isFirstSubject;
    if (nextBtnEl) nextBtnEl.disabled = idx === questions.length - 1 && isLastSubject;

    updateProgress();
    _buildSubjectTabs(); // refresh answered counts
  }

  /* ── SELECT ANSWER ───────────────────────────────────────────────── */
  async function selectAnswer(qId, letter) {
    if (!isActive) return;
    answers[qId] = letter;
    localStorage.setItem('examAnswers_' + exam.id, JSON.stringify(answers));
    ExamSync.updateAnswers(answers);
    renderQuestion(currentIdx);
    updatePalette();
    updateProgress();
  }

  function clearAnswer() {
    if (!isActive) return;
    const qs = subjectMap[activeSubject] || [];
    const q  = qs[currentIdx]; if (!q) return;
    answers[q.id] = null;
    localStorage.setItem('examAnswers_' + exam.id, JSON.stringify(answers));
    ExamSync.updateAnswers(answers);
    renderQuestion(currentIdx);
    updatePalette();
    updateProgress();
  }

  function prev() {
    const qs = subjectMap[activeSubject] || [];
    if (currentIdx > 0) renderQuestion(currentIdx - 1);
    else {
      // Jump to previous subject
      const subjects = Object.keys(subjectMap);
      const si = subjects.indexOf(activeSubject);
      if (si > 0) {
        activeSubject = subjects[si - 1];
        renderQuestion((subjectMap[activeSubject] || []).length - 1);
        _buildSubjectTabs();
      }
    }
  }

  function next() {
    const qs = subjectMap[activeSubject] || [];
    if (currentIdx < qs.length - 1) renderQuestion(currentIdx + 1);
    else {
      // Jump to next subject
      const subjects = Object.keys(subjectMap);
      const si = subjects.indexOf(activeSubject);
      if (si < subjects.length - 1) {
        activeSubject = subjects[si + 1];
        renderQuestion(0);
        _buildSubjectTabs();
      }
    }
  }

  function jumpTo(globalIdx) {
    const q = allQuestions[globalIdx];
    if (!q) return;
    const subj = q.subject || q.subjectName || 'General';
    if (subjectMap[subj]) {
      activeSubject = subj;
      const localIdx = subjectMap[subj].findIndex(x => x.id === q.id);
      _buildSubjectTabs();
      renderQuestion(localIdx >= 0 ? localIdx : 0);
    }
  }

  function toggleFlag() {
    const qs = subjectMap[activeSubject] || [];
    const q  = qs[currentIdx]; if (!q) return;
    flags.has(q.id) ? flags.delete(q.id) : flags.add(q.id);
    renderQuestion(currentIdx);
    updatePalette();
  }

  /* ── PALETTE ─────────────────────────────────────────────────────── */
  function updatePalette() {
    const sidebarTarget = document.getElementById('questionPalette');
    const rowTarget     = document.getElementById('questionRow');
    const gridTarget    = document.getElementById('paletteGrid');

    let answered = 0, flaggedCount = 0;
    const buildHtml = (cls, currentTest) => allQuestions.map((q, idx) => {
      const isAnswered = !!answers[q.id];
      const isFlagged  = flags.has(q.id);
      const isCurrent  = currentTest(q, idx);
      if (isAnswered) answered++;
      if (isFlagged)  flaggedCount++;
      const stateClasses = [
        isCurrent  ? 'current is-current'   : '',
        isFlagged  ? 'flagged is-flagged'   : (isAnswered ? 'answered is-answered' : ''),
      ].filter(Boolean).join(' ');
      return `<button type="button" class="${cls} ${stateClasses}" data-idx="${idx}" title="Q${idx+1}">${idx+1}</button>`;
    }).join('');

    const isCurrentFn = q => q === (subjectMap[activeSubject] || [])[currentIdx];

    if (sidebarTarget || rowTarget) {
      answered = 0; flaggedCount = 0;
      const html = buildHtml('pal-btn', isCurrentFn);
      if (sidebarTarget) {
        sidebarTarget.innerHTML = html;
        sidebarTarget.querySelectorAll('.pal-btn').forEach(b =>
          b.onclick = () => jumpTo(parseInt(b.dataset.idx)));
      }
      if (rowTarget) {
        rowTarget.innerHTML = html;
        rowTarget.querySelectorAll('.pal-btn').forEach(b =>
          b.onclick = () => jumpTo(parseInt(b.dataset.idx)));
        rowTarget.querySelector('.pal-btn.current')
          ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }

    if (gridTarget) {
      answered = 0; flaggedCount = 0;
      const html = buildHtml('palette-cell', isCurrentFn);
      gridTarget.innerHTML = html;
      gridTarget.querySelectorAll('.palette-cell').forEach(b =>
        b.onclick = () => jumpTo(parseInt(b.dataset.idx)));
    }

    const unanswered = allQuestions.length - answered;
    _setEl('palAnswered',  answered);
    _setEl('palFlagged',   flaggedCount);
    _setEl('palUnanswered',unanswered);
    _setEl('countAnswered',  answered);
    _setEl('countFlagged',  flaggedCount);
    _setEl('countUnanswered', unanswered);
  }

  /* ── PROGRESS ────────────────────────────────────────────────────── */
  function updateProgress() {
    const answered = Object.values(answers).filter(Boolean).length;
    const total    = allQuestions.length;
    const pct      = total ? Math.round((answered / total) * 100) : 0;
    const bar      = document.getElementById('progressBar');
    if (bar) { bar.style.width = pct + '%'; bar.textContent = pct + '%'; }
    const fill = document.getElementById('progressBarFill');
    if (fill) fill.style.width = pct + '%';
    _setEl('answeredCount', answered);
  }

  /* ── SUBMIT ──────────────────────────────────────────────────────── */
  function requestSubmit() {
    if (!isActive) return;
    const answered   = Object.values(answers).filter(Boolean).length;
    const unanswered = allQuestions.length - answered;
    const flaggedCount = flags.size;
    _setEl('smAnswered',   answered);
    _setEl('smUnanswered', unanswered);
    _setEl('smTotal',      allQuestions.length);
    _setEl('modalAnsweredCount', answered);
    _setEl('modalTotalCount',    allQuestions.length);
    const summaryEl = document.getElementById('modalSummary');
    if (summaryEl) summaryEl.innerHTML = `
      <div><strong>${answered}</strong><span>Answered</span></div>
      <div><strong>${unanswered}</strong><span>Unanswered</span></div>
      <div><strong>${flaggedCount}</strong><span>Flagged</span></div>`;
    const modal = document.getElementById('submitModal');
    if (modal) { modal.classList.add('active'); modal.classList.add('is-visible'); }
  }

  function closeSubmitModal() {
    const modal = document.getElementById('submitModal');
    modal?.classList.remove('active');
    modal?.classList.remove('is-visible');
  }

  async function confirmSubmit() {
    closeSubmitModal();
    await _doSubmit('manual');
  }

  async function autoSubmit(reason) {
    isActive = false;
    if (window.AntiCheat) AntiCheat.stop();
    ExamTimer.stop();
    const msgs = {
      violations:          'Your exam was auto-submitted due to repeated security violations.',
      timeout:             'Time is up — your exam has been automatically submitted.',
      bot_detected:        'Automated activity detected. Exam submitted for review.',
      multiple_login:      'Exam opened in another tab/device. This session submitted.',
      session_idle_timeout:'Auto-submitted due to extended inactivity.',
    };
    if (reason !== 'timeout') {
      const modal = document.getElementById('autoSubmitModal');
      const msgEl = document.getElementById('autoSubmitMsg');
      if (msgEl) msgEl.textContent = msgs[reason] || 'Your exam was automatically submitted.';
      if (modal) modal.classList.add('active');
      let t = 5;
      const el = document.getElementById('asTimer');
      const iv = setInterval(() => {
        t--; if(el) el.textContent = t;
        if (t <= 0) { clearInterval(iv); _doSubmit('auto_' + reason); }
      }, 1000);
    } else {
      await _doSubmit('auto_timeout');
    }
  }

  async function _doSubmit(reason) {
    if (isSubmitting) return;
    isSubmitting = true; isActive = false;
    if (window.AntiCheat) AntiCheat.stop();
    ExamTimer.stop(); ExamSync.stop();

    try {
      const user      = await AUTH.current();
      const timeTaken = exam.duration * 60 - ExamTimer.getRemaining();

      // Save submission
      const sub = await DB.create(SD.COL.SUBMISSIONS, {
        candidateId:  user.$id,
        examId:       exam.id,
        sessionId,
        answers:      JSON.stringify(answers),
        violations:   window.AntiCheat ? AntiCheat.getViolations() : 0,
        submittedAt:  new Date().toISOString(),
        timeTaken,
        submitReason: reason,
      });

      // Update session
      await DB.update(SD.COL.SESSIONS, sessionId, {
        status:      'submitted',
        submittedAt: new Date().toISOString(),
      });

      // Grade exam client-side (server Appwrite Functions can also do this)
      const result = await _gradeExam(sub.$id);

      // Clear local storage
      ['examAnswers_','examTimeLeft_','examSession_'].forEach(k =>
        localStorage.removeItem(k + exam.id));
      localStorage.removeItem('currentExamId');

      const answeredCount = Object.values(answers).filter(Boolean).length;
      _setEl('resultAnswered',   answeredCount);
      _setEl('resultUnanswered', allQuestions.length - answeredCount);
      _setEl('resultFlagged',    flags.size);
      _setEl('resultTimeUsed',   _fmtHMS(timeTaken));
      _setEl('resultCandidateName', document.getElementById('candName')?.textContent || '');

      // Show success modal + redirect
      const modal = document.getElementById('successModal') || document.getElementById('resultModal');
      if (modal) { modal.classList.add('active'); modal.classList.add('is-visible'); }
      let t = 5;
      const el = document.getElementById('succTimer');
      const iv = setInterval(() => {
        t--; if(el) el.textContent = t;
        if (t <= 0) { clearInterval(iv); location.href = `results.html?resultId=${result.id}`; }
      }, 1000);

    } catch(err) {
      console.error('Submit error:', err);
      isSubmitting = false; isActive = true;
      alert('Submission failed: ' + err.message + '\n\nYour answers are saved locally. Please contact your invigilator.');
    }
  }

  /* ── GRADE EXAM (client-side with Appwrite) ──────────────────────── */
  async function _gradeExam(submissionId) {
    let correct = 0;
    const breakdown = {};

    allQuestions.forEach(q => {
      const studentAns = answers[q.id] || 'NOT_ANSWERED';
      const isCorrect  = studentAns === q.correctAnswer;
      if (isCorrect) correct++;
      breakdown[q.id] = {
        questionText:   q.text,
        studentAnswer:  studentAns,
        correctAnswer:  q.correctAnswer,
        isCorrect,
        subject:        q.subject || '',
      };
    });

    const total      = allQuestions.length;
    const percentage = total ? Math.round((correct / total) * 100) : 0;
    const passing    = SD.CFG.PASS_THRESHOLD || 70;
    const passed     = percentage >= passing;
    const grade      = percentage >= 90 ? 'A' : percentage >= 80 ? 'B' :
                       percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : 'F';

    const user = await AUTH.current();
    let candidateName = '';
    try {
      const cand = await DB.get(SD.COL.CANDIDATES, user.$id);
      candidateName = cand.fullName || '';
    } catch(_) {}

    const resultDoc = await DB.create(SD.COL.RESULTS, {
      candidateId:     user.$id,
      candidateName,
      examId:          exam.id,
      examName:        exam.name,
      submissionId,
      correctAnswers:  correct,
      totalQuestions:  total,
      percentage,
      grade,
      passed,
      answerBreakdown: JSON.stringify(breakdown),
      createdAt:       new Date().toISOString(),
    });

    return resultDoc;
  }

  /* ── SECURITY CONFIG (from Appwrite DB settings) ─────────────────── */
  async function _loadSecurityConfig() {
    try {
      const cfg = await DB.get(SD.COL.SETTINGS, 'global');
      if (cfg.passingPercentage != null) SD.CFG.PASS_THRESHOLD    = cfg.passingPercentage;
      if (cfg.maxViolations     != null) SD.CFG.MAX_VIOLATIONS    = cfg.maxViolations;
      if (cfg.autoSaveInterval  != null) SD.CFG.AUTO_SAVE_MS      = cfg.autoSaveInterval * 1000;
      if (cfg.syncInterval      != null) SD.CFG.SYNC_MS           = cfg.syncInterval * 1000;
      SD.CFG.SESSION_TIMEOUT_MIN = cfg.sessionTimeout    ?? 60;
      SD.CFG.SINGLE_SESSION      = cfg.singleActiveSession ?? true;
      SD.CFG.BOT_DETECTION       = cfg.botDetection       ?? true;
    } catch(_) {}
  }

  /* ── HELPERS ─────────────────────────────────────────────────────── */
  function _fmtHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }

  function _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function _shuffleOptions(options) {
    if (!options || typeof options !== 'object') return options;
    const entries = _shuffle(Object.entries(options));
    const letters = ['A','B','C','D','E'];
    const result  = {};
    entries.forEach(([, val], i) => { result[letters[i]] = val; });
    return result;
  }

  /** Normalize a question document's options into a plain {A:text, B:text, ...} object.
   *  Handles: options stored as JSON string, options already an object,
   *  or falls back to individual optionA/optionB/optionC/optionD fields. */
  function _normalizeOptions(d) {
    let opts = d.options;
    if (typeof opts === 'string') {
      try { opts = JSON.parse(opts); } catch (_) { opts = null; }
    }
    if (opts && typeof opts === 'object' && !Array.isArray(opts) && Object.keys(opts).length) {
      return opts;
    }
    // Fallback to discrete optionA-D fields
    const fallback = {};
    ['A','B','C','D','E'].forEach(letter => {
      const val = d['option' + letter];
      if (val !== undefined && val !== null && val !== '') fallback[letter] = val;
    });
    return fallback;
  }

  function _setEl(id, val) { const el = document.getElementById(id); if(el) el.textContent = val; }
  function _setStep(id, msg) { const el = document.getElementById(id); if(el) el.textContent = msg; }

  function dismissViolation() { if(window.AntiCheat) AntiCheat.dismiss(); }

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (!isActive) return;
    if (e.key === 'ArrowLeft')  prev();
    if (e.key === 'ArrowRight') next();
    if (['1','a','A'].includes(e.key)) _clickOption('A');
    if (['2','b','B'].includes(e.key)) _clickOption('B');
    if (['3','c','C'].includes(e.key)) _clickOption('C');
    if (['4','d','D'].includes(e.key)) _clickOption('D');
  });

  function _clickOption(letter) {
    const qs = subjectMap[activeSubject] || [];
    const q  = qs[currentIdx]; if (!q) return;
    const opts = q.shuffledOptions || q.options || {};
    if (opts[letter] !== undefined) selectAnswer(q.id, letter);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    init, enforceFullscreen,
    prev, next, jumpTo, toggleFlag, clearAnswer,
    switchSubject,
    renderQuestion, updatePalette, updateProgress,
    requestSubmit, closeSubmitModal, confirmSubmit,
    autoSubmit, dismissViolation,
    getAnswers:   () => answers,
    getExam:      () => exam,
    getSessionId: () => sessionId,
  };
})();
