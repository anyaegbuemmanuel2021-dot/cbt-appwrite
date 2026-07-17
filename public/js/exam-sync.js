/**
 * SOFTLY DIGITAL V3 — exam-sync.js (Appwrite edition)
 * Flowchart: Activity Logging → Save Locally (5s) → Sync Appwrite DB (30s)
 */
const ExamSync = (() => {
  'use strict';
  let localInterval  = null;
  let remoteInterval = null;
  let examId         = null;
  let sessionId      = null;
  let answersRef     = null;

  function start(eid, sid, answersObj) {
    examId    = eid;
    sessionId = sid;
    answersRef = answersObj;

    // Local save every 5 seconds
    localInterval = setInterval(() => {
      localStorage.setItem('examAnswers_' + examId, JSON.stringify(answersRef));
      _setSavedStatus('Saved');
    }, SD.CFG.AUTO_SAVE_MS || 5000);

    // Appwrite sync every 30 seconds
    remoteInterval = setInterval(() => {
      _syncToAppwrite();
    }, SD.CFG.SYNC_MS || 30000);
  }

  function stop() {
    clearInterval(localInterval);
    clearInterval(remoteInterval);
  }

  function updateAnswers(answers) { answersRef = answers; }

  async function _syncToAppwrite() {
    if (!sessionId) return;
    try {
      _setSavedStatus('Syncing…', true);
      await DB.update(SD.COL.SESSIONS, sessionId, {
        answers:    JSON.stringify(answersRef),
        lastSynced: new Date().toISOString(),
      });
      _setSavedStatus('Synced');
    } catch(e) {
      _setSavedStatus('Offline — retrying');
      console.warn('Sync failed (will retry):', e.message);
    }
  }

  function _setSavedStatus(text, saving) {
    const el   = document.getElementById('autosaveText');
    const pill = document.getElementById('autosavePill');
    if (el) el.textContent = text;
    if (pill) pill.classList.toggle('is-saving', !!saving);
  }

  async function forceSync() { await _syncToAppwrite(); }

  return { start, stop, updateAnswers, forceSync };
})();
