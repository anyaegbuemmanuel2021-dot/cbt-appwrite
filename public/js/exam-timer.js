/**
 * SOFTLY DIGITAL V3 — exam-timer.js
 * Flowchart: Start Examination Timer
 * Drives the Examina CBT ring-timer UI (timerDigits / timerRingFill / timerCard / mobileTimerText).
 */
const ExamTimer = (() => {
  'use strict';
  let interval    = null;
  let remaining   = 0;
  let totalSecs   = 0;
  let examId      = null;
  let onExpire    = null;
  let elapsed     = 0;
  const RING_CIRCUMFERENCE = 389.6; // 2 * PI * r(62), matches the SVG ring in index.html

  function start(seconds, eid, expireCb) {
    remaining = seconds; totalSecs = seconds || 1; examId = eid; onExpire = expireCb; elapsed = 0;
    _render();                       // show the true starting time immediately, don't decrement yet
    interval = setInterval(_tick, 1000);
  }

  function stop() { clearInterval(interval); interval = null; }
  function getRemaining() { return remaining; }

  function _fmt(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }

  function _tick() {
    remaining--;
    elapsed++;
    localStorage.setItem('examTimeLeft_' + examId, remaining);
    _render();
    if (remaining <= 0) { stop(); if (onExpire) onExpire(); }
  }

  function _render() {
    const timeStr = _fmt(Math.max(remaining, 0));

    const digits = document.getElementById('timerDigits');
    if (digits) digits.textContent = timeStr;

    const mobile = document.getElementById('mobileTimerText');
    if (mobile) mobile.textContent = timeStr;

    const ring = document.getElementById('timerRingFill');
    if (ring) {
      const fraction = Math.max(remaining, 0) / totalSecs;
      ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));
    }

    const card = document.getElementById('timerCard');
    if (card) {
      card.classList.toggle('is-warning',  remaining <= 600 && remaining > 300);
      card.classList.toggle('is-critical', remaining <= 300);
    }

    // Elapsed (hidden helper element, kept for parity with the invigilator/monitor views)
    const elEl = document.getElementById('elapsedDisplay');
    if (elEl) elEl.textContent = _fmt(elapsed);
  }

  return { start, stop, getRemaining };
})();
