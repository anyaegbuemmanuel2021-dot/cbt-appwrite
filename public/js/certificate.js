/**
 * SOFTLY DIGITAL V3 — certificate.js (Appwrite + Cloudinary edition)
 * Canvas → Cloudinary → URL stored in Appwrite.
 */
const CertificateManager = (() => {
  'use strict';

  // Cloudinary opens images inline by default. Inserting fl_attachment
  // into the delivery URL tells Cloudinary to respond with
  // Content-Disposition: attachment, so the browser downloads the file
  // instead of just displaying it in a new tab.
  function _forceDownloadUrl(url) {
    if (!url || !url.includes('/upload/')) return url;
    return url.replace('/upload/', '/upload/fl_attachment/');
  }

  async function download() {
    const params   = new URLSearchParams(location.search);
    const resultId = params.get('resultId');
    const user     = await AUTH.current();
    if (!resultId || !user) { alert('Cannot generate certificate — missing result ID.'); return; }

    const btn = document.querySelector('[onclick*="CertificateManager.download"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

    try {
      // Return existing certificate if already generated
      const existing = await DB.list(SD.COL.CERTIFICATES, [SD.Q.equal('resultId', resultId)], 1);
      if (existing.total > 0) {
        const cert = existing.documents[0];
        if (cert.pdfUrl) window.open(_forceDownloadUrl(cert.pdfUrl), '_blank');
        _showQr(cert.qrCode);
        if (btn) { btn.disabled = false; btn.textContent = '📜 Download Certificate'; }
        return;
      }

      // Load result + candidate
      const [result, cand] = await Promise.all([
        DB.get(SD.COL.RESULTS,    resultId),
        DB.get(SD.COL.CANDIDATES, user.$id).catch(() => ({})),
      ]);

      // Draw certificate on canvas
      const dataUri = await _drawCertificate(result, cand);

      // Upload to Cloudinary → get permanent URL
      const certUrl = await CLOUD.uploadBase64(
        dataUri,
        'certificates',
        `cert_${user.$id}_${Date.now()}`
      );

      // Generate QR code URL (points to a verify page)
      const verCode = `SD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
      const verifyUrl = `${location.origin}/html/verify.html?cert=${verCode}`;
      const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(verifyUrl)}`;

      // Save certificate record in Appwrite
      await DB.create(SD.COL.CERTIFICATES, {
        candidateId:   user.$id,
        candidateName: cand.fullName || '',
        examId:        result.examId || '',
        examName:      result.examName || '',
        score:         result.percentage || 0,
        grade:         result.grade || '',
        resultId,
        pdfUrl:        certUrl,
        qrCode:        qrUrl,
        verifyCode:    verCode,
        issuedAt:      new Date().toISOString(),
      });

      await audit('CERTIFICATE_ISSUED', { resultId, candidateId: user.$id, score: result.percentage });

      window.open(_forceDownloadUrl(certUrl), '_blank');
      _showQr(qrUrl);
      Toast.show('Certificate generated and saved! 🏆', 'success');
    } catch (e) {
      console.error('Certificate error:', e);
      Toast.show('Certificate failed: ' + e.message, 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '📜 Download Certificate'; }
    }
  }

  function _showQr(url) {
    const wrap = document.getElementById('certQrWrap');
    const img  = document.getElementById('certQrCode');
    if (wrap && img && url) { img.src = url; wrap.style.display = 'block'; }
  }

  async function _drawCertificate(result, cand) {
    return new Promise(resolve => {
      const canvas = document.createElement('canvas');
      canvas.width  = 1122;  // A4 landscape at 96dpi
      canvas.height = 794;
      const ctx = canvas.getContext('2d');

      /* ── Background ── */
      const bg = ctx.createLinearGradient(0, 0, 1122, 794);
      bg.addColorStop(0,   '#0f1117');
      bg.addColorStop(0.5, '#1a1a2e');
      bg.addColorStop(1,   '#16213e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1122, 794);

      /* ── Gold outer border ── */
      ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 10;
      ctx.strokeRect(20, 20, 1082, 754);
      ctx.strokeStyle = '#e8d48b'; ctx.lineWidth = 2;
      ctx.strokeRect(34, 34, 1054, 726);

      /* ── Corner ornaments ── */
      const corners = [[44,44],[1078,44],[44,750],[1078,750]];
      corners.forEach(([x,y]) => {
        ctx.fillStyle = '#c9a84c';
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
      });

      /* ── Header ribbon ── */
      ctx.fillStyle = 'rgba(102,126,234,0.15)';
      ctx.fillRect(34, 34, 1054, 80);
      ctx.strokeStyle = 'rgba(102,126,234,0.3)'; ctx.lineWidth = 1;
      ctx.strokeRect(34, 34, 1054, 80);

      /* ── SOFTLY DIGITAL branding ── */
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = 'bold 13px Arial, sans-serif';
      ctx.fillText('SOFTLY DIGITAL V3  ·  ENTERPRISE CBT PLATFORM  ·  POWERED BY APPWRITE', 561, 60);
      ctx.fillStyle = '#e8d48b';
      ctx.font = '11px Arial';
      ctx.fillText('VERIFIED DIGITAL CERTIFICATE', 561, 80);

      /* ── Title ── */
      ctx.fillStyle = '#e8d48b';
      ctx.font = 'bold 38px Georgia, "Times New Roman", serif';
      ctx.fillText('CERTIFICATE OF ACHIEVEMENT', 561, 155);

      /* ── Gold divider ── */
      const grad = ctx.createLinearGradient(180, 0, 942, 0);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.3, '#c9a84c');
      grad.addColorStop(0.7, '#e8d48b');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(180, 170, 762, 2);

      /* ── Certify text ── */
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = 'italic 18px Georgia, serif';
      ctx.fillText('This is to proudly certify that', 561, 220);

      /* ── Candidate name ── */
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 54px Georgia, "Times New Roman", serif';
      ctx.fillText(cand.fullName || 'Candidate Name', 561, 295);

      /* ── Underline name ── */
      const nameWidth = ctx.measureText(cand.fullName || 'Candidate Name').width;
      ctx.fillStyle = '#c9a84c';
      ctx.fillRect(561 - nameWidth/2, 306, nameWidth, 2);

      /* ── Completion text ── */
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = 'italic 18px Georgia, serif';
      ctx.fillText('has successfully completed the examination', 561, 348);

      /* ── Exam name ── */
      ctx.fillStyle = '#e8d48b';
      ctx.font = 'bold 28px Georgia, serif';
      ctx.fillText(result.examName || 'Examination', 561, 398);

      /* ── Score & Grade row ── */
      const scoreItems = [
        { label: 'SCORE',  value: `${result.percentage || 0}%` },
        { label: 'GRADE',  value: result.grade || '—' },
        { label: 'STATUS', value: result.passed ? 'PASSED' : 'FAILED' },
        { label: 'CORRECT', value: `${result.correctAnswers || 0}/${result.totalQuestions || 0}` },
      ];
      const boxW = 160, boxH = 64, startX = 561 - (scoreItems.length * (boxW+14))/2 + 80;
      scoreItems.forEach((item, i) => {
        const x = startX + i * (boxW + 14);
        const isPass = item.label === 'STATUS' && result.passed;
        const isFail = item.label === 'STATUS' && !result.passed;
        ctx.fillStyle = isPass ? 'rgba(40,167,69,0.2)' : isFail ? 'rgba(220,53,69,0.2)' : 'rgba(255,255,255,0.06)';
        _roundRect(ctx, x - boxW/2, 428, boxW, boxH, 8);
        ctx.strokeStyle = isPass ? '#28a745' : isFail ? '#dc3545' : 'rgba(201,168,76,0.4)';
        ctx.lineWidth = 1.5;
        _roundRectStroke(ctx, x - boxW/2, 428, boxW, boxH, 8);
        ctx.fillStyle = isPass ? '#28a745' : isFail ? '#dc3545' : '#e8d48b';
        ctx.font = `bold 22px Arial, sans-serif`;
        ctx.fillText(item.value, x, 463);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '11px Arial';
        ctx.fillText(item.label, x, 482);
      });

      /* ── Bottom divider ── */
      ctx.fillStyle = grad;
      ctx.fillRect(180, 515, 762, 1);

      /* ── Footer row: ID + Date + Centre ── */
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '13px Arial';
      const issued = new Date().toLocaleDateString('en-NG', { dateStyle: 'long' });
      ctx.textAlign = 'left';
      ctx.fillText(`Candidate ID: ${cand.candidateId || '—'}`, 80, 545);
      ctx.textAlign = 'center';
      ctx.fillText(`Issued: ${issued}`, 561, 545);
      ctx.textAlign = 'right';
      ctx.fillText(`Centre: ${cand.centreName || '—'}`, 1042, 545);
      ctx.textAlign = 'center';

      /* ── Seal placeholder ── */
      ctx.beginPath();
      ctx.arc(561, 640, 70, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(102,126,234,0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(102,126,234,0.4)'; ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = 'bold 11px Arial';
      ctx.fillText('OFFICIAL SEAL', 561, 636);
      ctx.fillStyle = '#667eea';
      ctx.font = 'bold 14px Arial';
      ctx.fillText('SD V3', 561, 656);

      /* ── Verify URL ── */
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '11px Arial';
      ctx.fillText('Verify at: softlydigital.com/verify', 561, 740);

      resolve(canvas.toDataURL('image/png', 0.95));
    });
  }

  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath(); ctx.fill();
  }
  function _roundRectStroke(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath(); ctx.stroke();
  }

  /** Verify a certificate by code */
  async function verify(code) {
    const certCode = code || new URLSearchParams(location.search).get('cert');
    if (!certCode) { alert('No certificate code provided.'); return; }
    try {
      const res = await DB.list(SD.COL.CERTIFICATES, [SD.Q.equal('verifyCode', certCode)], 1);
      if (!res.total) { alert('❌ Certificate NOT found or invalid.'); return; }
      const c = res.documents[0];
      const issued = c.issuedAt ? new Date(c.issuedAt).toLocaleDateString('en-NG', {dateStyle:'long'}) : '—';
      alert(
        `✅ Certificate VALID\n\n` +
        `Candidate : ${c.candidateName}\n` +
        `Exam      : ${c.examName}\n` +
        `Score     : ${c.score}%\n` +
        `Grade     : ${c.grade}\n` +
        `Issued    : ${issued}\n` +
        `Code      : ${certCode}`
      );
    } catch (e) { alert('Verification failed: ' + e.message); }
  }

  return { download, verify };
})();
