/**
 * SOFTLY DIGITAL V3 — candidate-dashboard.js (Appwrite edition)
 * Flowchart: Candidate Dashboard → Assigned Exams → Verification → Instructions → Exam
 */
const CandidateDashboard = (() => {
  'use strict';

  let currentUser   = null;
  let pendingExamId = null;
  let cameraStream  = null;

  document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await AuthManager.requireRole('candidate');
    if (!currentUser) return;

    document.getElementById('candName').textContent =
      currentUser.fullName || currentUser.email.split('@')[0];
    const chip = document.getElementById('userChip');
    if (chip) chip.textContent = (currentUser.fullName || 'C')[0].toUpperCase();

    // Load passport photo
    if (currentUser.passportImageUrl) {
      const ph = document.getElementById('profilePhoto');
      if (ph) ph.src = currentUser.passportImageUrl;
    }

    await Promise.all([loadStats(), loadUpcomingExams(), loadRecentResults()]);

    // Sidebar nav — each item shows its section
    document.querySelectorAll('.sb-item').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        const sec = a.dataset.sec;
        showSection(sec);
        document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));
        a.classList.add('active');
        if (sec === 'certs')   loadCertificates();
        if (sec === 'profile') _loadProfileInfo();
      });
    });
  });

  /* ── STATS ───────────────────────────────────────────────────────── */
  async function loadStats() {
    try {
      const [examsRes, resultsRes] = await Promise.all([
        DB.list(SD.COL.EXAMS,   [], 500),   // we filter client-side since candidateIds is JSON string
        DB.list(SD.COL.RESULTS, [SD.Q.equal('candidateId', currentUser.uid)], 200),
      ]);
      // filter exams that include this candidate
      const myExams = examsRes.documents.filter(e => {
        const ids = e.candidateIds ? JSON.parse(e.candidateIds) : [];
        return ids.includes(currentUser.uid);
      });
      const total     = myExams.length;
      const completed = resultsRes.total;
      const passed    = resultsRes.documents.filter(r => r.passed).length;
      const pending   = Math.max(0, total - completed);

      document.getElementById('sAssigned').textContent  = total;
      document.getElementById('sPending').textContent   = pending;
      document.getElementById('sCompleted').textContent = completed;
      document.getElementById('sPassed').textContent    = passed;
    } catch(e) { console.error('loadStats', e); }
  }

  /* ── UPCOMING EXAMS ──────────────────────────────────────────────── */
  async function loadUpcomingExams() {
    const container = document.getElementById('upcomingExams'); if(!container) return;
    try {
      const res = await DB.list(SD.COL.EXAMS, [SD.Q.equal('active', true)], 100);
      const myExams = res.documents.filter(e => {
        const ids = e.candidateIds ? JSON.parse(e.candidateIds) : [];
        return ids.includes(currentUser.uid);
      });

      if (!myExams.length) {
        container.innerHTML = '<p class="no-data">No active exams assigned to you.</p>';
        const listEl = document.getElementById('examList');
        if (listEl) listEl.innerHTML = container.innerHTML;
        return;
      }

      const html = myExams.map(e => {
        const date = e.scheduledStart
          ? new Date(e.scheduledStart).toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short' })
          : 'Available Now';
        return `<div class="exam-card">
          <div class="ec-subject">${_esc(e.subject || e.subjectName || 'General')}</div>
          <h4 class="ec-title">${_esc(e.name)}</h4>
          <div class="ec-meta">
            <span>⏱️ ${e.duration} min</span>
            <span>❓ ${e.totalQuestions || '—'} Qs</span>
            <span>📊 Pass: ${e.passingScore || 70}%</span>
          </div>
          <div class="ec-date">📅 ${date}</div>
          <button class="ec-btn" onclick="CandidateDashboard.startVerification('${e.$id}')">
            Start Exam →
          </button>
        </div>`;
      }).join('');

      container.innerHTML = html;
      const listEl = document.getElementById('examList');
      if (listEl) listEl.innerHTML = html;
    } catch(e) { container.innerHTML = `<p class="error">Error: ${e.message}</p>`; }
  }

  /* ── RECENT RESULTS ──────────────────────────────────────────────── */
  async function loadRecentResults() {
    const container = document.getElementById('recentResults'); if(!container) return;
    try {
      const res = await DB.list(SD.COL.RESULTS, [
        SD.Q.equal('candidateId', currentUser.uid),
        SD.Q.orderDesc('$createdAt'),
      ], 5);

      if (!res.documents.length) {
        container.innerHTML = '<p class="no-data">No results yet.</p>';
        const listEl = document.getElementById('resultsList');
        if (listEl) listEl.innerHTML = container.innerHTML;
        return;
      }

      const html = res.documents.map(r => {
        const cls = r.passed ? 'pass-tag' : 'fail-tag';
        const tag = r.passed ? '✅ PASSED' : '❌ FAILED';
        return `<div class="result-mini-card">
          <div class="rmc-left"><div class="rmc-circle ${(r.grade||'').toLowerCase()}">${r.grade || '—'}</div></div>
          <div class="rmc-mid">
            <div class="rmc-exam">${_esc(r.examName || r.examId || '—')}</div>
            <div class="rmc-score">${r.correctAnswers}/${r.totalQuestions} · ${r.percentage}%</div>
          </div>
          <div class="rmc-right">
            <span class="${cls}">${tag}</span>
            <a href="results.html?resultId=${r.$id}" class="view-result-link">View →</a>
          </div>
        </div>`;
      }).join('');

      container.innerHTML = html;
      const listEl = document.getElementById('resultsList');
      if (listEl) listEl.innerHTML = html;
    } catch(e) { container.innerHTML = `<p class="error">Error: ${e.message}</p>`; }
  }

  /* ── START VERIFICATION (flowchart: Candidate Verification) ─────── */
  async function startVerification(examId) {
    pendingExamId = examId;
    localStorage.setItem('currentExamId', examId);

    const modal = document.getElementById('verifyModal');
    if (!modal) { location.href = `exam-instructions.html?examId=${examId}`; return; }
    modal.style.display = 'flex';

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      document.getElementById('camFeed').srcObject = cameraStream;
    } catch(_) {
      // Camera not available — skip verification
      modal.style.display = 'none';
      location.href = `exam-instructions.html?examId=${examId}`;
    }
  }

  function capturePhoto() {
    const video  = document.getElementById('camFeed');
    const canvas = document.getElementById('captureCanvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const img = document.getElementById('capturedImg');
    img.src = canvas.toDataURL('image/jpeg', 0.85);
    img.style.display = 'block'; video.style.display = 'none';
    document.getElementById('captureControls').style.display = 'none';
    document.getElementById('confirmControls').style.display = 'flex';
  }

  function retakePhoto() {
    document.getElementById('capturedImg').style.display = 'none';
    document.getElementById('camFeed').style.display = 'block';
    document.getElementById('captureControls').style.display = 'flex';
    document.getElementById('confirmControls').style.display = 'none';
  }

  async function confirmVerification() {
    try {
      const canvas = document.getElementById('captureCanvas');
      canvas.toBlob(async blob => {
        try {
          const file = new File([blob], 'verification.jpg', { type: 'image/jpeg' });
          const url  = await CLOUD.upload(file, 'verification', `verif_${currentUser.uid}_${Date.now()}`);
          await DB.update(SD.COL.CANDIDATES, currentUser.uid, {
            verificationPhotoUrl: url,
            lastVerifiedAt: new Date().toISOString(),
          });
        } catch(_) { /* non-blocking */ }
        _closeVerification();
        location.href = `exam-instructions.html?examId=${pendingExamId}`;
      }, 'image/jpeg', 0.85);
    } catch(_) {
      _closeVerification();
      location.href = `exam-instructions.html?examId=${pendingExamId}`;
    }
  }

  function _closeVerification() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    const modal = document.getElementById('verifyModal');
    if (modal) modal.style.display = 'none';
  }

  /* ── PROFILE & PHOTO ─────────────────────────────────────────────── */
  async function updatePhoto(event) {
    const file = event.target.files[0]; if(!file) return;
    try {
      const url = await CLOUD.upload(file, 'candidates', `passport_${currentUser.uid}_${Date.now()}`);
      await DB.update(SD.COL.CANDIDATES, currentUser.uid, { passportImageUrl: url });
      document.getElementById('profilePhoto').src = url;
      alert('Photo updated successfully!');
    } catch(e) { alert('Photo update failed: ' + e.message); }
  }

  async function _loadProfileInfo() {
    const el = document.getElementById('profileInfo'); if(!el) return;
    try {
      const cand = await DB.get(SD.COL.CANDIDATES, currentUser.uid);
      el.innerHTML = `
        <div class="profile-field"><label>Full Name</label><span>${_esc(cand.fullName||'—')}</span></div>
        <div class="profile-field"><label>Candidate ID</label><span>${_esc(cand.candidateId||'—')}</span></div>
        <div class="profile-field"><label>Email</label><span>${_esc(cand.email||'—')}</span></div>
        <div class="profile-field"><label>Phone</label><span>${_esc(cand.phone||'—')}</span></div>
        <div class="profile-field"><label>Centre</label><span>${_esc(cand.centreName||'—')}</span></div>
        <div class="profile-field"><label>Status</label>
          <span class="badge ${cand.status==='active'?'badge-success':'badge-gray'}">${cand.status||'active'}</span>
        </div>`;
      if (cand.passportImageUrl) {
        document.getElementById('profilePhoto').src = cand.passportImageUrl;
      }
    } catch(e) { el.innerHTML = `<p class="error">${e.message}</p>`; }
  }

  /* ── CERTIFICATES ────────────────────────────────────────────────── */
  async function loadCertificates() {
    const container = document.getElementById('certsList'); if(!container) return;
    try {
      const res = await DB.list(SD.COL.CERTIFICATES, [SD.Q.equal('candidateId', currentUser.uid)], 50);
      if (!res.documents.length) {
        container.innerHTML = '<p class="no-data">No certificates yet. Pass an exam to earn a certificate!</p>'; return;
      }
      container.innerHTML = res.documents.map(c => `
        <div class="cert-item-card">
          <div class="cic-icon">🏆</div>
          <div class="cic-info">
            <h4>${_esc(c.examName||'—')}</h4>
            <p>Score: ${c.score}% · Grade: ${c.grade}</p>
            <p>Issued: ${c.issuedAt ? new Date(c.issuedAt).toLocaleDateString('en-NG') : '—'}</p>
          </div>
          <div class="cic-actions">
            ${c.pdfUrl ? `<a href="${c.pdfUrl}" target="_blank" class="btn-primary-sm">📜 Download</a>` : ''}
            <button class="btn-outline-sm" onclick="CandidateDashboard.verifyCert('${c.$id}')">🔍 Verify</button>
          </div>
        </div>`).join('');
    } catch(e) { container.innerHTML = `<p class="error">${e.message}</p>`; }
  }

  async function verifyCert(id) {
    try {
      const c = await DB.get(SD.COL.CERTIFICATES, id);
      alert(`Certificate valid ✅\nCandidate: ${c.candidateName}\nExam: ${c.examName}\nScore: ${c.score}%\nGrade: ${c.grade}`);
    } catch(e) { alert('Certificate not found or invalid.'); }
  }

  function toggleNotifs() { /* handled by notifications.js */ }
  function _esc(s) { const d=document.createElement('div');d.textContent=s??'';return d.innerHTML; }

  return { startVerification, capturePhoto, retakePhoto, confirmVerification, updatePhoto, loadCertificates, verifyCert, toggleNotifs };
})();
