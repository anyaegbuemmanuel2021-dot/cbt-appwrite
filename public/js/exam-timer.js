/**
 * SOFTLY DIGITAL V3 — exam-timer.js
 * Flowchart: Start Examination Timer
 */
const ExamTimer = (() => {
  'use strict';
  let interval   = null;
  let remaining  = 0;
  let total      = 0;
  let examId     = null;
  let onExpire   = null;

  const RING_CIRCUMFERENCE = 389.6; // 2 * PI * r(62), matches the SVG ring in exam.html

  function start(seconds, eid, expireCb) {
    remaining = seconds; total = seconds || 1; examId = eid; onExpire = expireCb;
    _tick(true);
    interval = setInterval(_tick, 1000);
  }

  function stop() { clearInterval(interval); interval = null; }
  function getRemaining() { return remaining; }

  function _tick(isFirst) {
    if (!isFirst) remaining--;
    localStorage.setItem('examTimeLeft_' + examId, remaining);

    const h  = Math.floor(remaining / 3600);
    const m  = Math.floor((remaining % 3600) / 60);
    const s  = remaining % 60;
    const fmt = n => String(n).padStart(2,'0');
    const timeStr = `${fmt(h)}:${fmt(m)}:${fmt(s)}`;

    const digits = document.getElementById('timerDigits');
    if (digits) digits.textContent = timeStr;
    const mobile = document.getElementById('mobileTimerText');
    if (mobile) mobile.textContent = timeStr;

    const fill = document.getElementById('timerRingFill');
    if (fill) fill.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - remaining / total));

    const card = document.getElementById('timerCard');
    if (card) {
      card.classList.toggle('is-warning',  remaining <= 600 && remaining > 300);
      card.classList.toggle('is-critical', remaining <= 300);
    }

    if (remaining <= 0) { stop(); if (onExpire) onExpire(); }
  }

  return { start, stop, getRemaining };
})();
