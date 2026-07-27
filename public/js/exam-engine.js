/**
 * SOFTLY DIGITAL V3 — exam-engine.js (Appwrite edition)
 * Backend logic (Appwrite data, timer, anti-cheat, sync, grading) wired to
 * the "Examina CBT" front-end design (sidebar subject list, timer ring,
 * single question palette, dark mode, mobile sidebar).
 */
const ExamEngine = (() => {
  'use strict';

  let exam          = null;
  let allQuestions  = [];          // flat array of all questions (every subject)
  let subjectMap    = {};          // subjectName -> [questions]
  let activeSubject = null;        // current subject key
  let answers       = {};
  let flags         = new Set();
  let currentIdx    = 0;           // index within activeSubject's question list
  let sessionId     = null;
  let examSeed      = null;        // stable per-attempt seed so shuffle survives page reloads
  let isSubmitting  = false;
  let isActive      = false;
  let candidateName = 'Candidate';
  let paletteFilter = 'all';

  /* ── INIT ────────────────────────────────────────────────────────── */
  async function init() {
    const user = await AUTH.current();
    if (!user) { location.href = 'candidate-login.html'; return; }

    // Populate sidebar: candidate photo, name, reg no.
    try {
      const candDoc = await DB.get(SD.COL.CANDIDATES, user.$id);
      candidateName = candDoc.fullName || user.name || 'Candidate';
      _setEl('candidateName', candidateName);
      _setEl('candidateReg', candDoc.candidateId || candDoc.regNo || '—');
      const photoEl = document.getElementById('candidatePhoto');
      if (photoEl && candDoc.passportImageUrl) photoEl.src = candDoc.passportImageUrl;
    } catch (_) {
      candidateName = user.name || 'Candidate';
      _setEl('candidateName', candidateName);
    }

    const params  = new URLSearchParams(location.search);
    const examId  = params.get('examId') || localStorage.getItem('currentExamId');
    if (!examId) { _loadError('No exam ID provided. Please return to your dashboard.'); return; }

    try {
      /* ── Step 1: Load exam ── */
      _setLoading('Loading exam data…');
      const examDoc = await DB.get(SD.COL.EXAMS, examId);
      exam = { id: examDoc.$id, ...examDoc };
      exam.subjectIds = _parseJsonArray(exam.subjectIds);
      _setEl('examNameDisplay', exam.name);
      _setEl('topbarTitle', exam.name);
      _setEl('examDurationDisplay', (exam.duration || 60) + ' minutes');
      document.title = exam.name + ' — SOFTLY DIGITAL V3';

      /* ── Step 2: Load questions by subject (JAMB style) ── */
      _setLoading('Loading questions by subject…');
      let qRes;
      if (exam.subjectIds && exam.subjectIds.length) {
        const perSubject = await Promise.all(
          exam.subjectIds.map(sid =>
            DB.list(SD.COL.QUESTIONS, [SD.Q.equal('subjectId', sid)], exam.totalQuestions || 200))
        );
        qRes = { documents: perSubject.flatMap(r => r.documents) };
      } else {
        qRes = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('examId', examId)], exam.totalQuestions || 200);
        if (!qRes.documents.length && exam.subjectId) {
          qRes = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('subjectId', exam.subjectId)], exam.totalQuestions || 200);
        }
      }
      if (!qRes.documents.length) throw new Error('No questions found for this exam.');

      allQuestions = qRes.documents.map(d => ({ id: d.$id, ...d, options: _normalizeOptions(d) }));

      /* ── Step 3a: Resolve session + seed BEFORE shuffling ──
         Look up an active session for this candidate+exam on the server
         first (works even on a new browser/device), falling back to the
         locally-remembered sessionId, before creating a new one. This is
         what makes question/option order survive not just a refresh but
         a genuine "resume on another device" scenario — the seed that
         drives the shuffle lives on the session document, not just in
         this browser's localStorage. */
      _setLoading('Starting your session…');
      let existingSessionDoc = null;
      try {
        const active = await DB.list(SD.COL.SESSIONS, [
          SD.Q.equal('candidateId', user.$id),
          SD.Q.equal('examId', examId),
          SD.Q.equal('status', 'active'),
        ], 1);
        if (active.documents.length) existingSessionDoc = active.documents[0];
      } catch (_) { /* query may fail if index missing; fall back below */ }

      if (!existingSessionDoc) {
        const localSessionId = localStorage.getItem('examSession_' + examId);
        if (localSessionId) {
          try { existingSessionDoc = await DB.get(SD.COL.SESSIONS, localSessionId); } catch (_) {}
        }
      }

      examSeed = existingSessionDoc?.seed || localStorage.getItem('examSeed_' + examId);
      if (!examSeed) {
        examSeed = (crypto?.randomUUID?.() || (Date.now() + '_' + Math.random()));
      }
      localStorage.setItem('examSeed_' + examId, examSeed);

      _setLoading('Randomising & shuffling options…');
      if (exam.randomizeQuestions !== false) allQuestions = _shuffle(allQuestions, _rng(examSeed + '_qorder'));
      if (exam.totalQuestions && allQuestions.length > exam.totalQuestions) {
        allQuestions = allQuestions.slice(0, exam.totalQuestions);
      }
      if (exam.shuffleOptions !== false) {
        allQuestions = allQuestions.map(q => {
          const { options: shuffledOptions, correctAnswer } = _shuffleOptions(q.options, q.correctAnswer, _rng(examSeed + '_opt_' + q.id));
          return { ...q, shuffledOptions, shuffledCorrectAnswer: correctAnswer };
        });
      }

      subjectMap = {};
      allQuestions.forEach(q => {
        const subj = q.subject || q.subjectName || 'General';
        (subjectMap[subj] = subjectMap[subj] || []).push(q);
      });

      /* ── Step 3b: Restore saved answers ── */
      const saved = localStorage.getItem('examAnswers_' + examId);
      if (saved) try { answers = JSON.parse(saved); } catch (_) {}
      allQuestions.forEach(q => { if (answers[q.id] === undefined) answers[q.id] = null; });

      /* ── Step 4: Create or resume session (order never regenerated after this point) ── */
      if (existingSessionDoc) {
        sessionId = existingSessionDoc.$id;
        localStorage.setItem('examSession_' + examId, sessionId);
        if (existingSessionDoc.answers) {
          try { answers = { ...answers, ...JSON.parse(existingSessionDoc.answers) }; } catch (_) {}
        }
      } else {
        const ses = await DB.create(SD.COL.SESSIONS, {
          candidateId: user.$id, examId,
          startTime:   new Date().toISOString(),
          status:      'active',
          answers:     JSON.stringify({}),
          violations:  0,
          questionIds: JSON.stringify(allQuestions.map(q => q.id)),
          seed:        examSeed,
        });
        sessionId = ses.$id;
        localStorage.setItem('examSession_' + examId, sessionId);
      }

      /* ── Step 4b: Was this exam left mid-attempt (tab closed, refreshed,
         browser-navigated away, or history back) last time? If so, finish
         the job now instead of letting the candidate quietly resume — the
         page-leave listener below (see _armLeaveGuard) stamps this flag
         the instant the exam tab is torn down while still active, and we
         only get a chance to act on it the next time this page loads. ── */
      let leftFlag = null;
      try { leftFlag = JSON.parse(localStorage.getItem('examAutoSubmitPending_' + examId) || 'null'); } catch (_) {}
      if (leftFlag && leftFlag.sessionId === sessionId && existingSessionDoc && existingSessionDoc.status === 'active') {
        localStorage.removeItem('examAutoSubmitPending_' + examId);
        _setLoading('You left the exam earlier — submitting your exam now…');
        document.getElementById('loadingScreen')?.classList.remove('is-hidden');
        isActive = true;
        await _doSubmit('auto_left_page');
        document.getElementById('loadingScreen')?.classList.add('is-hidden');
        return;
      }
      localStorage.removeItem('examAutoSubmitPending_' + examId);

      /* ── Step 5: Security config + AntiCheat ── */
      _setLoading('Starting security monitor…');
      await _loadSecurityConfig();
      if (window.AntiCheat) AntiCheat.init({ sessionId, examId, candidateId: user.$id });

      activeSubject = Object.keys(subjectMap)[0];
      _renderSubjectList();
      renderQuestion(0);
      updatePalette();
      updateProgress();

      /* ── Step 6: Everything is ready — wait for a real click before
         requesting fullscreen. Browsers refuse fullscreen requests that
         aren't triggered directly by a user gesture (click/keypress);
         calling it automatically here would silently fail every time. ── */
      _setLoading('Ready — click below to begin.');
      document.querySelector('.loading-ring')?.style.setProperty('display', 'none');
      document.querySelector('.skeleton-row')?.style.setProperty('display', 'none');
      const beginBtn = document.getElementById('beginExamBtn');
      if (beginBtn) {
        beginBtn.style.display = 'inline-block';
        beginBtn.addEventListener('click', async () => {
          beginBtn.disabled = true;
          await enforceFullscreen();     // real user gesture — this will succeed
          _startExamProper();
        }, { once: true });
      } else {
        // Fallback: no button present in this HTML build — start immediately
        // without fullscreen (better than blocking the exam entirely).
        _startExamProper();
      }

    } catch (err) {
      console.error('ExamEngine init error:', err);
      _loadError(err.message + ' — please contact your invigilator.');
    }
  }

  function _startExamProper() {
    /* ── Timer ── */
    const savedTime = localStorage.getItem('examTimeLeft_' + exam.id);
    const timeLeft  = savedTime ? parseInt(savedTime) : (exam.duration || 60) * 60;
    ExamTimer.start(timeLeft, exam.id, () => autoSubmit('timeout'));

    isActive = true;
    ExamSync.start(exam.id, sessionId, answers);
    _armLeaveGuards();

    /* ── Reveal app, hide loading screen ── */
    document.getElementById('loadingScreen')?.classList.add('is-hidden');
    const app = document.getElementById('app');
    if (app) { app.classList.add('is-ready'); app.setAttribute('aria-hidden', 'false'); }
  }

  function _setLoading(msg) { _setEl('loadingText', msg); }
  function _loadError(msg) {
    const el = document.getElementById('loadingText');
    if (el) { el.textContent = '❌ ' + msg; el.style.color = '#F5A6AE'; }
    document.querySelector('.loading-ring')?.style.setProperty('display', 'none');
  }

  /* ── LEAVE GUARDS ────────────────────────────────────────────────────
     Two ways a candidate can "leave" mid-exam, handled differently:

     1) Browser back/forward button — we can intercept this in real time
        (popstate fires before the page actually unloads), so we trap the
        candidate on the page and submit immediately, right here.

     2) Tab close, refresh, typing a new URL, or any other hard navigation
        — the page is destroyed before an async submit (grading, DB
        writes) could ever finish, so it can't be done reliably in the
        unload handler itself. Instead we stamp a flag in localStorage the
        instant the page starts tearing down; Step 4b in init() checks for
        that flag the next time this exam is opened and finishes the
        submission then, using the answers that were already autosaved.
  ── */
  function _armLeaveGuards() {
    // (1) Back/forward button
    history.pushState({ examGuard: true }, '', location.href);
    window.addEventListener('popstate', () => {
      if (!isActive || isSubmitting) return;
      history.pushState({ examGuard: true }, '', location.href); // stay put
      autoSubmit('left_page');
    });

    // (2) Tab close / refresh / typed URL / any other hard navigation
    window.addEventListener('pagehide', () => {
      if (!isActive || isSubmitting) return;
      try {
        localStorage.setItem('examAutoSubmitPending_' + exam.id, JSON.stringify({
          sessionId, ts: Date.now(),
        }));
      } catch (_) {}
    });
  }

  /* ── SUBJECT LIST (sidebar) ─────────────────────────────────────── */
  function _renderSubjectList() {
    const list = document.getElementById('subjectList');
    if (!list) return;
    const subjects = Object.keys(subjectMap);
    list.innerHTML = subjects.map(s => `
      <li class="subject-item ${s === activeSubject ? 'is-active' : ''}" role="option" tabindex="0"
          onclick="ExamEngine.switchSubject('${_escAttr(s)}')"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ExamEngine.switchSubject('${_escAttr(s)}')}">
        <span>${_esc(s)}</span>
        <span class="subj-badge">${_subjectAnswered(s)}/${subjectMap[s].length}</span>
      </li>`).join('');
  }

  function switchSubject(subjectName) {
    if (subjectName === activeSubject) return;
    activeSubject = subjectName;
    currentIdx = 0;
    _renderSubjectList();
    renderQuestion(0);
    updatePalette();
  }

  function _subjectAnswered(subj) {
    return (subjectMap[subj] || []).filter(q => answers[q.id]).length;
  }

  /* ── FULLSCREEN ─────────────────────────────────────────────────── */
  async function enforceFullscreen() {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch (_) {}
  }

  /* ── RENDER QUESTION ────────────────────────────────────────────── */
  function renderQuestion(idx) {
    const questions = subjectMap[activeSubject] || [];
    if (!questions.length || idx < 0 || idx >= questions.length) return;
    currentIdx = idx;
    const q = questions[idx];

    _setEl('activeSubjectChip', (q.subject || activeSubject || '—').toUpperCase());
    _setEl('questionCounter', `Question ${idx + 1} of ${questions.length}`);
    _setEl('questionText', q.text || '');

    const imgWrap = document.getElementById('qImgWrap');
    const imgEl   = document.getElementById('qImg');
    if (imgWrap && imgEl) {
      if (q.imageUrl) { imgEl.src = q.imageUrl; imgWrap.style.display = 'block'; }
      else imgWrap.style.display = 'none';
    }

    const opts = q.shuffledOptions || q.options || {};
    const list = document.getElementById('optionsList');
    if (list) {
      list.innerHTML = '';
      Object.entries(opts).forEach(([letter, text]) => {
        const isSelected = answers[q.id] === letter;
        const row = document.createElement('div');
        row.className = 'option' + (isSelected ? ' is-selected' : '');
        row.setAttribute('role', 'radio');
        row.setAttribute('aria-checked', String(isSelected));
        row.setAttribute('tabindex', '0');
        row.innerHTML = `
          <span class="option-radio"></span>
          <span class="option-letter">${letter}.</span>
          <span class="option-text">${text}</span>`;
        row.onclick = () => selectAnswer(q.id, letter);
        row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAnswer(q.id, letter); } });
        list.appendChild(row);
      });
    }

    const flagBtn = document.getElementById('flagBtn');
    const flagTxt = document.getElementById('flagBtnText');
    const isFlagged = flags.has(q.id);
    if (flagBtn) flagBtn.classList.toggle('is-flagged', isFlagged);
    if (flagTxt) flagTxt.textContent = isFlagged ? 'Unflag' : 'Flag';

    // Prev/Next are only disabled at the true first/last question across all subjects.
    const globalIdx = allQuestions.findIndex(x => x.id === q.id);
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.disabled = globalIdx === 0;
    if (nextBtn) nextBtn.disabled = globalIdx === allQuestions.length - 1;

    updatePalette();
    updateProgress();
    _renderSubjectList();
  }

  /* ── ANSWER ACTIONS ─────────────────────────────────────────────── */
  async function selectAnswer(qId, letter) {
    if (!isActive) return;
    answers[qId] = letter;
    localStorage.setItem('examAnswers_' + exam.id, JSON.stringify(answers));
    ExamSync.updateAnswers(answers);
    renderQuestion(currentIdx);
  }

  function clearAnswer() {
    if (!isActive) return;
    const qs = subjectMap[activeSubject] || [];
    const q  = qs[currentIdx]; if (!q) return;
    answers[q.id] = null;
    localStorage.setItem('examAnswers_' + exam.id, JSON.stringify(answers));
    ExamSync.updateAnswers(answers);
    renderQuestion(currentIdx);
  }

  function prev() {
    if (currentIdx > 0) { renderQuestion(currentIdx - 1); return; }
    const subjects = Object.keys(subjectMap);
    const si = subjects.indexOf(activeSubject);
    if (si > 0) {
      activeSubject = subjects[si - 1];
      renderQuestion((subjectMap[activeSubject] || []).length - 1);
    }
  }

  function next() {
    const qs = subjectMap[activeSubject] || [];
    if (currentIdx < qs.length - 1) { renderQuestion(currentIdx + 1); return; }
    const subjects = Object.keys(subjectMap);
    const si = subjects.indexOf(activeSubject);
    if (si < subjects.length - 1) {
      activeSubject = subjects[si + 1];
      renderQuestion(0);
    } else {
      requestSubmit();
    }
  }

  function skip() { next(); }

  function jumpTo(globalIdx) {
    const q = allQuestions[globalIdx]; if (!q) return;
    const subj = q.subject || q.subjectName || 'General';
    if (!subjectMap[subj]) return;
    activeSubject = subj;
    const localIdx = subjectMap[subj].findIndex(x => x.id === q.id);
    renderQuestion(localIdx >= 0 ? localIdx : 0);
  }

  function toggleFlag() {
    const qs = subjectMap[activeSubject] || [];
    const q  = qs[currentIdx]; if (!q) return;
    flags.has(q.id) ? flags.delete(q.id) : flags.add(q.id);
    renderQuestion(currentIdx);
  }

  function setPaletteFilter(f) { paletteFilter = f; updatePalette(); }

  /* ── PALETTE (current subject) ──────────────────────────────────── */
  function updatePalette() {
    const grid = document.getElementById('paletteGrid');
    const questions = subjectMap[activeSubject] || [];
    if (grid) {
      grid.innerHTML = questions.map((q, idx) => {
        const isAnswered = !!answers[q.id];
        const isFlagged  = flags.has(q.id);
        const isCurrent  = idx === currentIdx;
        let cls = 'palette-cell';
        if (isCurrent) cls += ' is-current';
        else if (isFlagged) cls += ' is-flagged';
        else if (isAnswered) cls += ' is-answered';
        let visible = true;
        if (paletteFilter === 'answered')   visible = isAnswered;
        if (paletteFilter === 'unanswered') visible = !isAnswered;
        if (paletteFilter === 'flagged')    visible = isFlagged;
        if (!visible) cls += ' is-filtered-out';
        return `<button type="button" class="${cls}" title="Q${idx + 1}" onclick="ExamEngine.renderQuestion(${idx})">${idx + 1}</button>`;
      }).join('');
    }
  }

  /* ── PROGRESS (global, across all subjects) ─────────────────────── */
  function updateProgress() {
    const answered   = Object.values(answers).filter(Boolean).length;
    const total      = allQuestions.length;
    const flagged    = flags.size;
    const unanswered = total - answered;
    const pct        = total ? Math.round((answered / total) * 100) : 0;

    _setEl('countAnswered',   answered);
    _setEl('countUnanswered', unanswered);
    _setEl('countFlagged',    flagged);
    const bar = document.getElementById('progressBarFill');
    if (bar) bar.style.width = pct + '%';
  }

  /* ── SUBMIT ──────────────────────────────────────────────────────── */
  function requestSubmit() {
    if (!isActive) return;
    const answered   = Object.values(answers).filter(Boolean).length;
    const flagged    = flags.size;
    const total      = allQuestions.length;
    const unanswered = total - answered;
    _setEl('modalAnsweredCount', answered);
    _setEl('modalTotalCount', total);
    const summary = document.getElementById('modalSummary');
    if (summary) summary.innerHTML = `
      <div><strong>${answered}</strong><span>Answered</span></div>
      <div><strong>${unanswered}</strong><span>Unanswered</span></div>
      <div><strong>${flagged}</strong><span>Flagged</span></div>`;
    document.getElementById('submitModal')?.classList.add('is-visible');
  }

  function closeSubmitModal() { document.getElementById('submitModal')?.classList.remove('is-visible'); }

  async function confirmSubmit() { closeSubmitModal(); await _doSubmit('manual'); }

  async function autoSubmit(reason) {
    isActive = false;
    if (window.AntiCheat) AntiCheat.stop();
    ExamTimer.stop();
    const msgs = {
      violations:           'Your exam was auto-submitted due to repeated security violations.',
      timeout:              'Time is up — your exam has been automatically submitted.',
      bot_detected:         'Automated activity detected. Exam submitted for review.',
      multiple_login:       'Exam opened in another tab/device. This session submitted.',
      session_idle_timeout: 'Auto-submitted due to extended inactivity.',
      left_page:            'You left the exam page. Your exam has been automatically submitted.',
      ended_session:        'Your exam was submitted because you ended the session.',
    };
    if (reason !== 'timeout') {
      _setEl('autoSubmitMsg', msgs[reason] || 'Your exam was automatically submitted.');
      document.getElementById('autoSubmitModal')?.classList.add('is-visible');
      let t = 5;
      const iv = setInterval(() => {
        t--; _setEl('asTimer', t);
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
      const timeTaken = (exam.duration || 60) * 60 - ExamTimer.getRemaining();

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

      await DB.update(SD.COL.SESSIONS, sessionId, { status: 'submitted', submittedAt: new Date().toISOString() });

      const result = await _gradeExam(sub.$id, timeTaken);

      ['examAnswers_', 'examTimeLeft_', 'examSession_', 'examSeed_'].forEach(k => localStorage.removeItem(k + exam.id));
      localStorage.removeItem('currentExamId');

      const answered   = Object.values(answers).filter(Boolean).length;
      const total      = allQuestions.length;
      _setEl('resultCandidateName', candidateName);
      _setEl('resultAnswered', answered);
      _setEl('resultUnanswered', total - answered);
      _setEl('resultFlagged', flags.size);
      _setEl('resultTimeUsed', _fmtTime(timeTaken));

      document.getElementById('autoSubmitModal')?.classList.remove('is-visible');
      document.getElementById('resultModal')?.classList.add('is-visible');

      let t = 5;
      const iv = setInterval(() => {
        t--; _setEl('succTimer', t);
        if (t <= 0) { clearInterval(iv); location.href = `results.html?resultId=${result.$id}`; }
      }, 1000);
      document.getElementById('printResultBtn')?.addEventListener('click', () => window.print());

    } catch (err) {
      console.error('Submit error:', err);
      isSubmitting = false; isActive = true;
      alert('Submission failed: ' + err.message + '\n\nYour answers are saved locally. Please contact your invigilator.');
    }
  }

  /* ── GRADE EXAM ──────────────────────────────────────────────────── */
  async function _gradeExam(submissionId, timeTaken) {
    let correct = 0;
    let skipped = 0;
    const breakdown = {};
    const debug = localStorage.getItem('sd_debug_grading') === '1';
    allQuestions.forEach(q => {
      const studentAns    = answers[q.id] || 'NOT_ANSWERED';
      if (studentAns === 'NOT_ANSWERED') skipped++;
      const correctLetter = q.shuffledCorrectAnswer || q.correctAnswer;
      const isCorrect     = studentAns === correctLetter;
      if (isCorrect) correct++;
      breakdown[q.id] = { questionText: q.text, studentAnswer: studentAns, correctAnswer: correctLetter, isCorrect, subject: q.subject || '', difficulty: q.difficulty || 'medium' };
      if (debug) {
        console.log('[grading]', {
          questionId: q.id,
          originalOptions: q.options,
          shuffledOptions: q.shuffledOptions,
          originalCorrectAnswer: q.correctAnswer,
          shuffledCorrectAnswer: q.shuffledCorrectAnswer,
          studentSelected: studentAns,
          comparedAgainst: correctLetter,
          isCorrect,
        });
      }
    });

    const total      = allQuestions.length;
    const percentage = total ? Math.round((correct / total) * 100) : 0;
    const passing    = SD.CFG.PASS_THRESHOLD || 70;
    const passed     = percentage >= passing;
    const grade      = percentage >= 90 ? 'A' : percentage >= 80 ? 'B' : percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : 'F';

    const user = await AUTH.current();

    const resultDoc = await DB.create(SD.COL.RESULTS, {
      candidateId: user.$id, candidateName,
      examId: exam.id, examName: exam.name, submissionId,
      correctAnswers: correct, totalQuestions: total, percentage, grade, passed,
      skipped, timeTaken: timeTaken || 0,
      answerBreakdown: JSON.stringify(breakdown),
      createdAt: new Date().toISOString(),
    });
    return resultDoc;
  }

  /* ── SECURITY CONFIG ─────────────────────────────────────────────── */
  async function _loadSecurityConfig() {
    try {
      const cfg = await DB.get(SD.COL.SETTINGS, 'global');
      if (cfg.passingPercentage != null) SD.CFG.PASS_THRESHOLD = cfg.passingPercentage;
      if (cfg.maxViolations     != null) SD.CFG.MAX_VIOLATIONS = cfg.maxViolations;
      if (cfg.autoSaveInterval  != null) SD.CFG.AUTO_SAVE_MS   = cfg.autoSaveInterval * 1000;
      if (cfg.syncInterval      != null) SD.CFG.SYNC_MS        = cfg.syncInterval * 1000;
      SD.CFG.SESSION_TIMEOUT_MIN = cfg.sessionTimeout     ?? 60;
      SD.CFG.SINGLE_SESSION      = cfg.singleActiveSession ?? true;
      SD.CFG.BOT_DETECTION       = cfg.botDetection        ?? true;
    } catch (_) {}
  }

  /* ── HELPERS ─────────────────────────────────────────────────────── */
  function _parseJsonArray(val) {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string' && val.trim()) {
      try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; }
      catch (_) { return []; }
    }
    return [];
  }
  function _hashSeed(str) {
    // djb2 string hash -> 32-bit unsigned int, used to seed the PRNG
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h >>> 0;
  }
  function _rng(seedStr) {
    // mulberry32 — deterministic PRNG so the same seed always reproduces
    // the same shuffle order. Used instead of Math.random() so that a
    // page refresh / resume does not re-shuffle questions or options
    // out from under answers the candidate already selected.
    let a = _hashSeed(String(seedStr));
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function _shuffle(arr, rng) {
    const rand = rng || Math.random;
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function _shuffleOptions(options, correctLetter, rng) {
    if (!options || typeof options !== 'object') return { options, correctAnswer: correctLetter };
    const entries = _shuffle(Object.entries(options), rng);
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const result = {};
    let newCorrectLetter = correctLetter;
    entries.forEach(([origLetter, val], i) => {
      result[letters[i]] = val;
      if (origLetter === correctLetter) newCorrectLetter = letters[i];
    });
    return { options: result, correctAnswer: newCorrectLetter };
  }
  function _normalizeOptions(d) {
    let opts = d.options;
    if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch (_) { opts = null; } }
    if (opts && typeof opts === 'object' && !Array.isArray(opts) && Object.keys(opts).length) return opts;
    const fallback = {};
    ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
      const val = d['option' + letter];
      if (val !== undefined && val !== null && val !== '') fallback[letter] = val;
    });
    return fallback;
  }
  function _fmtTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = totalSeconds % 60;
    const p = n => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}`;
  }
  function _setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function _esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function _escAttr(s) { return String(s ?? '').replace(/'/g, "\\'"); }

  function dismissViolation() { if (window.AntiCheat) AntiCheat.dismiss(); }

  /* ── KEYBOARD SHORTCUTS ──────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (!isActive) return;
    if (document.querySelector('.modal-overlay.is-visible')) return;
    if (e.key === 'ArrowLeft')  prev();
    if (e.key === 'ArrowRight') next();
    if (['1', 'a', 'A'].includes(e.key)) _clickOption('A');
    if (['2', 'b', 'B'].includes(e.key)) _clickOption('B');
    if (['3', 'c', 'C'].includes(e.key)) _clickOption('C');
    if (['4', 'd', 'D'].includes(e.key)) _clickOption('D');
  });
  function _clickOption(letter) {
    const qs = subjectMap[activeSubject] || [];
    const q  = qs[currentIdx]; if (!q) return;
    const opts = q.shuffledOptions || q.options || {};
    if (opts[letter] !== undefined) selectAnswer(q.id, letter);
  }

  /* ── UI CHROME (dark mode, mobile sidebar, network banner, filters,
        wire up buttons that used to be inline onclick) ─────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('prevBtn')?.addEventListener('click', prev);
    document.getElementById('nextBtn')?.addEventListener('click', next);
    document.getElementById('skipBtn')?.addEventListener('click', skip);
    document.getElementById('clearBtn')?.addEventListener('click', clearAnswer);
    document.getElementById('flagBtn')?.addEventListener('click', toggleFlag);
    document.getElementById('submitBtn')?.addEventListener('click', requestSubmit);
    document.getElementById('modalReviewBtn')?.addEventListener('click', closeSubmitModal);
    document.getElementById('modalConfirmBtn')?.addEventListener('click', confirmSubmit);

    document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else document.exitFullscreen?.();
    });

    document.getElementById('darkModeToggle')?.addEventListener('click', () => {
      const root = document.documentElement;
      const isDark = root.getAttribute('data-theme') === 'dark';
      root.setAttribute('data-theme', isDark ? 'light' : 'dark');
      try { localStorage.setItem('examTheme', isDark ? 'light' : 'dark'); } catch (_) {}
    });
    try {
      const savedTheme = localStorage.getItem('examTheme');
      if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    } catch (_) {}

    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        setPaletteFilter(chip.dataset.filter);
      });
    });

    // Mobile sidebar
    const sidebar = document.getElementById('sidebar');
    const scrim = document.createElement('div');
    scrim.className = 'sidebar-scrim';
    document.body.appendChild(scrim);
    const openSidebar  = () => { sidebar?.classList.add('is-open'); scrim.classList.add('is-visible'); };
    const closeSidebar = () => { sidebar?.classList.remove('is-open'); scrim.classList.remove('is-visible'); };
    document.getElementById('mobileMenuBtn')?.addEventListener('click', openSidebar);
    document.getElementById('sidebarToggle')?.addEventListener('click', closeSidebar);
    scrim.addEventListener('click', closeSidebar);
    document.getElementById('mobileTimerBtn')?.addEventListener('click', openSidebar);

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      if (!isActive) { location.href = 'candidate-dashboard.html'; return; }
      if (!confirm('Ending this session will submit your exam immediately with your current answers. This cannot be undone. Continue?')) return;
      window.onbeforeunload = null;
      await autoSubmit('ended_session');
    });

    // Network status
    const networkBanner = document.getElementById('networkBanner');
    const networkStatus = document.getElementById('networkStatus');
    function updateNetworkStatus() {
      if (!networkBanner || !networkStatus) return;
      if (navigator.onLine) {
        networkBanner.classList.remove('is-visible');
        networkStatus.innerHTML = '<span class="pulse-dot"></span> Online';
        networkStatus.className = 'status-badge status-badge-ok';
      } else {
        networkBanner.classList.add('is-visible');
        networkStatus.textContent = 'Offline';
        networkStatus.className = 'status-badge status-badge-warn';
      }
    }
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    updateNetworkStatus();

    // Warn before leaving mid-exam — leaving the page now auto-submits the exam
    window.onbeforeunload = () => isActive ? 'Leaving this page will submit your exam immediately. Are you sure?' : undefined;

    // Integrity: block copy/paste (fullscreen right-click already blocked via body attribute)
    document.addEventListener('copy',  e => { if (isActive) e.preventDefault(); });
    document.addEventListener('cut',   e => { if (isActive) e.preventDefault(); });
    document.addEventListener('paste', e => { if (isActive) e.preventDefault(); });
  });

  document.addEventListener('DOMContentLoaded', init);

  return {
    init, enforceFullscreen,
    prev, next, skip, jumpTo, toggleFlag, clearAnswer, selectAnswer,
    switchSubject, setPaletteFilter,
    renderQuestion, updatePalette, updateProgress,
    requestSubmit, closeSubmitModal, confirmSubmit,
    autoSubmit, dismissViolation,
    getAnswers:   () => answers,
    getExam:      () => exam,
    getSessionId: () => sessionId,
  };
})();