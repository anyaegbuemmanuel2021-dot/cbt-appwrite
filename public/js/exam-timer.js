/**
 * SOFTLY DIGITAL V3 — exam-timer.js
 * Flowchart: Start Examination Timer
 */
const ExamTimer = (() => {
  'use strict';
  let interval   = null;
  let remaining  = 0;
  let examId     = null;
  let onExpire   = null;
  let elapsed    = 0;

  function start(seconds, eid, expireCb) {
    remaining = seconds; examId = eid; onExpire = expireCb; elapsed = 0;
    _tick();
    interval = setInterval(_tick, 1000);
  }

  function stop() { clearInterval(interval); interval = null; }
  function getRemaining() { return remaining; }

  function _tick() {
    remaining--;
    elapsed++;
    localStorage.setItem('examTimeLeft_' + examId, remaining);

    const h  = Math.floor(remaining / 3600);
    const m  = Math.floor((remaining % 3600) / 60);
    const s  = remaining % 60;
    const fmt = n => String(n).padStart(2,'0');
    const timeStr = `${fmt(h)}:${fmt(m)}:${fmt(s)}`;

    const disp = document.getElementById('timerDisplay');
    if (disp) {
      disp.textContent = timeStr;
      disp.className   = 'timer-display' +
        (remaining <= 60 ? ' critical' : remaining <= 300 ? ' warning' : '');
    }

    // Elapsed
    const eh = Math.floor(elapsed / 3600);
    const em = Math.floor((elapsed % 3600) / 60);
    const es = elapsed % 60;
    const elEl = document.getElementById('elapsedDisplay');
    if (elEl) elEl.textContent = `${fmt(eh)}:${fmt(em)}:${fmt(es)}`;

    if (remaining <= 0) { stop(); if (onExpire) onExpire(); }
  }

  return { start, stop, getRemaining };
})();
