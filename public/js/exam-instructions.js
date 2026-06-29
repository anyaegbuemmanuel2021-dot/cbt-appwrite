/**
 * SOFTLY DIGITAL V3 — exam-instructions.js (Appwrite edition)
 */
document.addEventListener('DOMContentLoaded', async () => {
  const user = await AUTH.current();
  if (!user) { location.href = 'candidate-login.html'; return; }

  const params = new URLSearchParams(location.search);
  const examId = params.get('examId');
  if (!examId) { location.href = 'candidate-dashboard.html'; return; }
  localStorage.setItem('currentExamId', examId);

  try {
    const [examDoc, candDoc] = await Promise.all([
      DB.get(SD.COL.EXAMS, examId),
      DB.get(SD.COL.CANDIDATES, user.$id).catch(() => ({})),
    ]);

    const s = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    s('examTitle',       examDoc.name || 'Examination');
    s('emDuration',      (examDoc.duration||60) + ' minutes');
    s('emQuestions',     examDoc.totalQuestions || '—');
    s('emPass',          (examDoc.passingScore||70) + '%');
    s('emDate',          examDoc.scheduledStart
      ? new Date(examDoc.scheduledStart).toLocaleDateString('en-NG',{dateStyle:'full'}) : '—');
    s('candDisplayName', candDoc.fullName || user.email || '—');
    s('candDisplayId',   'ID: ' + (candDoc.candidateId || user.$id.substring(0,8)));
    s('candCentre',      candDoc.centreName || '—');
    const photo = document.getElementById('candPhoto');
    if (photo && candDoc.passportImageUrl) photo.src = candDoc.passportImageUrl;
  } catch(e) { console.error('Instructions load error:', e); }

  await runChecks();
});

async function runChecks() {
  const ok = '✅', fail = '❌';

  const fsOk = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  document.querySelector('#scFullscreen .sc-status').textContent = fsOk ? ok : fail;

  const brOk = !!(window.crypto?.subtle) && !!window.indexedDB;
  document.querySelector('#scBrowser .sc-status').textContent = brOk ? ok : fail;

  let netOk = navigator.onLine;
  try { await DB.list(SD.COL.SETTINGS, [], 1); netOk = true; } catch(_) {}
  document.querySelector('#scInternet .sc-status').textContent = netOk ? ok : fail;

  // Check Appwrite instead of Firebase label
  let awOk = false;
  try { await DB.list(SD.COL.EXAMS, [], 1); awOk = true; } catch(_) {}
  const awEl = document.querySelector('#scFirebase .sc-status');
  if (awEl) awEl.textContent = awOk ? ok : fail;
  const awLabel = document.querySelector('#scFirebase');
  if (awLabel) awLabel.innerHTML = awLabel.innerHTML.replace('Server Connection', 'Appwrite Connection');

  ['scFullscreen','scBrowser','scInternet','scFirebase'].forEach((id, i) => {
    const passes = [fsOk, brOk, netOk, awOk][i];
    document.getElementById(id)?.classList.add(passes ? 'sc-pass' : 'sc-fail');
  });

  if (!(fsOk && brOk && netOk && awOk)) {
    document.getElementById('startBtn').disabled = true;
    document.getElementById('agreeCheck').disabled = true;
  }
}

function toggleStart() {
  document.getElementById('startBtn').disabled = !document.getElementById('agreeCheck').checked;
}

function startExam() {
  location.href = `exam.html?examId=${localStorage.getItem('currentExamId')}`;
}
