/**
 * SOFTLY DIGITAL V3 — anti-cheat.js (Appwrite edition)
 * All Firebase calls replaced with Appwrite DB calls.
 * Violations logged to SD.COL.VIOLATIONS. Single-session via Appwrite polling.
 */
const AntiCheat = (() => {
  'use strict';

  let violations       = 0;
  let sessionId        = null;
  let examId           = null;
  let candidateId      = null;
  let isActive         = false;
  let devtoolsInterval = null;
  let tabToken         = null;
  let sessionPollTimer = null;
  let idleTimer        = null;
  let idleWarnTimer    = null;

  const IDLE_WARNING_MS = () => Math.max(1, (SD.CFG.SESSION_TIMEOUT_MIN||60)-2)*60*1000;
  const IDLE_LIMIT_MS   = () => (SD.CFG.SESSION_TIMEOUT_MIN||60)*60*1000;

  function init(config) {
    sessionId   = config.sessionId;
    examId      = config.examId;
    candidateId = config.candidateId;
    violations  = config.violations || 0;
    isActive    = true;

    _attachTabSwitch();
    _attachVisibilityChange();
    _attachFullscreenExit();
    _attachCopyPaste();
    _attachDevTools();
    _attachKeyboardBlock();
    if (SD.CFG.SINGLE_SESSION !== false) _attachSingleSessionPoll();
    if (SD.CFG.BOT_DETECTION  !== false) _runBotDetection();
    _attachIdleTimeout();
  }

  function stop() {
    isActive = false;
    clearInterval(devtoolsInterval);
    clearInterval(sessionPollTimer);
    clearTimeout(idleTimer);
    clearTimeout(idleWarnTimer);
    document.removeEventListener('visibilitychange', _onVisibility);
    window.removeEventListener('blur', _onWindowBlur);
    document.removeEventListener('copy',  _onCopy);
    document.removeEventListener('cut',   _onCopy);
    document.removeEventListener('paste', _onPaste);
    ['mousemove','keydown','click','scroll','touchstart']
      .forEach(e => document.removeEventListener(e, _resetIdleTimer));
  }

  function _attachTabSwitch() { window.addEventListener('blur', _onWindowBlur); }
  function _onWindowBlur() { if(isActive) _record('TAB_SWITCH','Candidate switched to another window/tab.','HIGH'); }
  function _attachVisibilityChange() { document.addEventListener('visibilitychange', _onVisibility); }
  function _onVisibility() { if(isActive && document.hidden) _record('VISIBILITY_HIDDEN','Page hidden — possible tab switch.','HIGH'); }

  function _attachFullscreenExit() {
    const h = () => {
      if (!isActive) return;
      if (!(document.fullscreenElement||document.webkitFullscreenElement))
        _record('FULLSCREEN_EXIT','Candidate exited fullscreen mode.','HIGH');
    };
    document.addEventListener('fullscreenchange', h);
    document.addEventListener('webkitfullscreenchange', h);
  }

  function _attachCopyPaste() {
    document.addEventListener('copy',  _onCopy);
    document.addEventListener('cut',   _onCopy);
    document.addEventListener('paste', _onPaste);
  }
  function _onCopy(e)  { if(isActive){e.preventDefault();_record('COPY_CUT','Candidate tried to copy/cut content.','MEDIUM');} }
  function _onPaste(e) { if(isActive){e.preventDefault();_record('PASTE','Candidate tried to paste content.','MEDIUM');} }

  function _attachDevTools() {
    let triggered = false;
    devtoolsInterval = setInterval(() => {
      if (!isActive) return;
      if ((window.outerWidth-window.innerWidth>160 || window.outerHeight-window.innerHeight>160) && !triggered) {
        triggered = true;
        _record('DEVTOOLS_OPEN','Developer Tools detected.','CRITICAL');
        setTimeout(()=>{ triggered=false; }, 5000);
      }
    }, 1000);
  }

  function _attachKeyboardBlock() {
    document.addEventListener('keydown', e => {
      if (!isActive) return;
      if (e.key==='F12'||(e.ctrlKey&&e.shiftKey&&'IJC'.includes(e.key.toUpperCase()))
          ||(e.ctrlKey&&'US'.includes(e.key.toUpperCase()))||(e.altKey&&e.key==='F4')) {
        e.preventDefault();
        _record('KEYBOARD_SHORTCUT',`Blocked shortcut: ${e.key}`,'MEDIUM');
      }
    });
    document.addEventListener('contextmenu', e=>{ if(isActive) e.preventDefault(); });
  }

  /* Single session via polling — Appwrite doesn't have realtime on free tier without functions */
  async function _attachSingleSessionPoll() {
    if (!candidateId || !sessionId) return;
    tabToken = `${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    // Write our token into the session
    try {
      await DB.update(SD.COL.SESSIONS, sessionId, { activeToken: tabToken });
    } catch(_) {}
    // Poll every 10s to check if token changed (means another tab claimed it)
    sessionPollTimer = setInterval(async () => {
      if (!isActive) return;
      try {
        const ses = await DB.get(SD.COL.SESSIONS, sessionId);
        if (ses.activeToken && ses.activeToken !== tabToken) {
          clearInterval(sessionPollTimer);
          _record('MULTIPLE_LOGIN','Another device/tab started this exam. This session is terminated.','CRITICAL');
        }
      } catch(_) {}
    }, 10000);
  }

  function _runBotDetection() {
    let score = 0;
    if (navigator.webdriver===true) score+=50;
    if (!window.chrome && /Chrome/.test(navigator.userAgent)) score+=15;
    if (navigator.plugins?.length===0) score+=10;
    if (/HeadlessChrome|PhantomJS|Selenium|Puppeteer|Playwright/i.test(navigator.userAgent)) score+=60;
    if (window.outerWidth===0||window.outerHeight===0) score+=20;
    if (score>=50) _record('BOT_DETECTED','Automated/headless browser signals detected.','CRITICAL');
  }

  function _attachIdleTimeout() {
    ['mousemove','keydown','click','scroll','touchstart']
      .forEach(e => document.addEventListener(e, _resetIdleTimer, { passive:true }));
    _resetIdleTimer();
  }

  function _resetIdleTimer() {
    if (!isActive) return;
    clearTimeout(idleTimer); clearTimeout(idleWarnTimer);
    idleWarnTimer = setTimeout(() => {
      if (!isActive) return;
      const modal = document.getElementById('violationModal');
      const msg   = document.getElementById('violationMsg');
      if (msg) msg.textContent = 'You have been inactive. Exam will auto-submit soon due to inactivity.';
      if (modal) modal.classList.add('is-visible');
    }, IDLE_WARNING_MS());
    idleTimer = setTimeout(() => {
      if (!isActive) return;
      _record('SESSION_IDLE_TIMEOUT','Exam auto-submitted due to extended inactivity.','CRITICAL');
    }, IDLE_LIMIT_MS());
  }

  async function _record(type, message, severity) {
    if (!isActive) return;

    const IMMEDIATE = ['BOT_DETECTED','MULTIPLE_LOGIN','SESSION_IDLE_TIMEOUT','TAB_SWITCH','VISIBILITY_HIDDEN'];
    const willAutoSubmit = IMMEDIATE.includes(type);
    // Stop synchronously (before any awaits) so a second event firing in the
    // same tick — blur and visibilitychange both fire when switching tabs —
    // can't sneak past the isActive guard above and double-process.
    if (willAutoSubmit) isActive = false;

    violations++;
    const vCount = document.getElementById('vCount');
    const ehViol = document.getElementById('ehViolations');
    const chip   = document.getElementById('violChip');
    if (vCount) vCount.textContent = violations;
    if (ehViol) ehViol.textContent = violations;
    if (chip)   chip.style.display = 'flex';

    // Log to Appwrite
    try {
      await DB.create(SD.COL.VIOLATIONS, {
        sessionId, examId, candidateId,
        type, message, severity, violations,
        timestamp: new Date().toISOString(),
      });
      if (sessionId) {
        const ses = await DB.get(SD.COL.SESSIONS, sessionId);
        await DB.update(SD.COL.SESSIONS, sessionId, { violations: (ses.violations||0)+1 });
      }
    } catch(_) {}

    if (willAutoSubmit) {
      try { if(sessionId) await DB.update(SD.COL.SESSIONS, sessionId, { status:'auto_'+type.toLowerCase() }); } catch(_){}
      window.ExamEngine?.autoSubmit(type.toLowerCase());
      return;
    }

    const modal = document.getElementById('violationModal');
    const msg   = document.getElementById('violationMsg');
    if (msg)   msg.textContent = message;
    if (modal) modal.classList.add('is-visible');

    if (violations >= (SD.CFG.MAX_VIOLATIONS||3)) {
      isActive = false;
      try { if(sessionId) await DB.update(SD.COL.SESSIONS, sessionId, { status:'auto_submitted_violations' }); } catch(_){}
      window.ExamEngine?.autoSubmit('violations');
    }
  }

  function dismiss() {
    document.getElementById('violationModal')?.classList.remove('is-visible');
    window.ExamEngine?.enforceFullscreen();
    _resetIdleTimer();
  }

  function getViolations() { return violations; }
  return { init, stop, dismiss, getViolations };
})();
