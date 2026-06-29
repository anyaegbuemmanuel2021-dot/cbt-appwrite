/**
 * SOFTLY DIGITAL V3 — ai-module.js (Appwrite edition)
 * OpenAI called directly from client using key stored in Appwrite settings.
 * PDF extraction uses client-side text parsing (no Cloud Functions needed).
 */
const AIModule = (() => {
  'use strict';

  let _openAiKey   = '';
  let _openAiModel = 'gpt-4o-mini';

  /* Load OpenAI key from Appwrite settings on module init */
  async function _loadConfig() {
    if (_openAiKey) return;
    try {
      const cfg = await DB.get(SD.COL.SETTINGS, 'global');
      _openAiKey   = cfg.openaiApiKey   || '';
      _openAiModel = cfg.openaiModel    || 'gpt-4o-mini';
    } catch(_) {}
  }

  async function loadSubjects() {
    const sel = document.getElementById('aiSubj'); if (!sel) return;
    try {
      const res = await DB.list(SD.COL.SUBJECTS, [SD.Q.orderAsc('name')], 200);
      sel.innerHTML = '<option value="">Select Subject</option>';
      res.documents.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name; opt.textContent = d.name;
        sel.appendChild(opt);
      });
    } catch(e) { console.warn('AI loadSubjects:', e); }
  }

  async function generate() {
    const subj  = document.getElementById('aiSubj')?.value;
    const topic = document.getElementById('aiTopic')?.value?.trim();
    const diff  = document.getElementById('aiDiff')?.value || 'medium';
    const count = Math.min(50, parseInt(document.getElementById('aiCount')?.value || '5'));
    if (!subj) { alert('Please select a subject.'); return; }

    const btn      = document.querySelector('[onclick="AIModule?.generate()"]') || document.querySelector('.btn-ai');
    const resultEl = document.getElementById('aiGenResult');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    if (resultEl) { resultEl.style.display = 'block'; resultEl.innerHTML = '<p style="color:#667eea;text-align:center;padding:16px">🤖 Contacting OpenAI…</p>'; }

    await _loadConfig();
    if (!_openAiKey) {
      if (resultEl) resultEl.innerHTML = '<div class="alert alert-danger">OpenAI API key not configured. Go to Settings → AI Configuration.</div>';
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate'; }
      return;
    }

    try {
      const prompt = `Generate exactly ${count} multiple-choice questions for a Nigerian CBT exam.
Subject: ${subj}${topic ? '\nTopic: ' + topic : ''}
Difficulty: ${diff}
Format each question as a JSON object with: text, optionA, optionB, optionC, optionD, correctAnswer (A/B/C/D), explanation.
Return ONLY a JSON array, no markdown, no extra text.`;

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_openAiKey}` },
        body: JSON.stringify({
          model: _openAiModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7, max_tokens: 4000,
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);

      let raw = data.choices[0].message.content.trim();
      if (raw.startsWith('```')) raw = raw.replace(/```json|```/g, '').trim();
      const questions = JSON.parse(raw);

      if (!Array.isArray(questions) || !questions.length) throw new Error('No questions returned.');

      if (resultEl) {
        resultEl.innerHTML = `
          <div style="padding:12px;background:#d4edda;border-radius:8px;margin-bottom:12px;font-weight:600">
            ✅ ${questions.length} questions generated for <em>${subj}</em>${topic?' → '+topic:''}
          </div>
          <div style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:10px">
            ${questions.map((q,i) => `
              <div style="background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:14px">
                <p style="font-weight:600;margin-bottom:8px">Q${i+1}: ${_esc(q.text)}</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:.875rem">
                  <span>A: ${_esc(q.optionA)}</span><span>B: ${_esc(q.optionB)}</span>
                  <span>C: ${_esc(q.optionC)}</span><span>D: ${_esc(q.optionD)}</span>
                </div>
                <p style="margin-top:8px;font-size:.8rem;color:#28a745">✅ Answer: ${q.correctAnswer}</p>
                ${q.explanation?`<p style="font-size:.78rem;color:#6c757d;margin-top:4px">${_esc(q.explanation)}</p>`:''}
              </div>`).join('')}
          </div>
          <div style="margin-top:14px;display:flex;gap:10px">
            <button class="btn-primary" onclick='AIModule.saveGenerated(${JSON.stringify(questions).replace(/'/g,"&#39;")})'>
              💾 Save All ${questions.length} to Question Bank
            </button>
            <button class="btn-outline" onclick="document.getElementById('aiGenResult').style.display='none'">Dismiss</button>
          </div>`;
      }
    } catch(e) {
      if (resultEl) resultEl.innerHTML = `<div class="alert alert-danger">❌ ${_esc(e.message)}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate'; }
    }
  }

  async function saveGenerated(questions) {
    if (!Array.isArray(questions) || !questions.length) { alert('No questions to save.'); return; }
    const btn = event?.target;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }
    let saved = 0, skipped = 0;
    for (const q of questions) {
      const text = (q.text||'').trim();
      if (!text) { skipped++; continue; }
      // Duplicate check
      const ex = await DB.list(SD.COL.QUESTIONS, [SD.Q.equal('text', text)], 1).catch(()=>({total:0}));
      if (ex.total > 0) { skipped++; continue; }
      // Find subject ID
      const subjRes = await DB.list(SD.COL.SUBJECTS, [SD.Q.equal('name', document.getElementById('aiSubj')?.value||'')], 1).catch(()=>({documents:[]}));
      const subjectId = subjRes.documents[0]?.$id || '';
      await DB.create(SD.COL.QUESTIONS, {
        text,
        optionA: q.optionA||'', optionB: q.optionB||'', optionC: q.optionC||'', optionD: q.optionD||'',
        options: JSON.stringify({ A:q.optionA, B:q.optionB, C:q.optionC, D:q.optionD }),
        correctAnswer: q.correctAnswer||'A',
        subjectId, subject: document.getElementById('aiSubj')?.value||'',
        topic: document.getElementById('aiTopic')?.value||'',
        difficulty: document.getElementById('aiDiff')?.value||'medium',
        explanation: q.explanation||'',
        examCount: 0, source: 'ai',
      });
      saved++;
    }
    alert(`Saved ${saved} questions to Question Bank.${skipped?` (${skipped} duplicates skipped)`:''}`);
    if (window.QuestionManager) QuestionManager.load();
    if (btn) { btn.disabled = false; btn.textContent = `💾 Save All to Question Bank`; }
  }

  async function extractPdf(file) {
    if (!file) return;
    const resultEl = document.getElementById('aiPdfResult');
    if (resultEl) { resultEl.style.display='block'; resultEl.innerHTML='<p style="text-align:center;padding:16px;color:#667eea">📄 Reading PDF…</p>'; }
    await _loadConfig();
    if (!_openAiKey) {
      if (resultEl) resultEl.innerHTML = '<div class="alert alert-danger">OpenAI API key not configured. Go to Settings → AI Configuration.</div>';
      return;
    }
    try {
      // Read file as text (works for text-based PDFs)
      const text = await _readPdfText(file);
      if (!text.trim()) throw new Error('Could not extract text from PDF. Ensure it is a text-based PDF.');

      const prompt = `Extract MCQ questions from this exam paper text. Return ONLY a JSON array of objects with: text, optionA, optionB, optionC, optionD, correctAnswer (A/B/C/D), explanation. If correct answer is not determinable, put "A".
Text:
${text.substring(0, 12000)}`;

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${_openAiKey}` },
        body: JSON.stringify({ model:_openAiModel, messages:[{role:'user',content:prompt}], temperature:0.3, max_tokens:4000 }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      let raw = data.choices[0].message.content.trim();
      if (raw.startsWith('```')) raw = raw.replace(/```json|```/g,'').trim();
      const questions = JSON.parse(raw);
      if (resultEl) resultEl.innerHTML = `
        <p style="color:#28a745;font-weight:600">✅ ${questions.length} questions extracted from PDF.</p>
        <button class="btn-primary" style="margin-top:10px" onclick='AIModule.saveGenerated(${JSON.stringify(questions).replace(/'/g,"&#39;")})'>
          💾 Save All to Question Bank
        </button>`;
    } catch(e) {
      if (resultEl) resultEl.innerHTML = `<div class="alert alert-danger">❌ Extraction failed: ${_esc(e.message)}</div>`;
    }
  }

  async function _readPdfText(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => {
        // Basic text extraction — real PDFs need PDF.js for full support
        const bytes = new Uint8Array(e.target.result);
        let text = '';
        for (let i = 0; i < bytes.length; i++) {
          const c = bytes[i];
          if (c >= 32 && c < 127) text += String.fromCharCode(c);
          else if (c === 10 || c === 13) text += '\n';
        }
        resolve(text.replace(/\s{3,}/g, '\n'));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function analyzeDifficulty() {
    const el = document.getElementById('diffSuggestions');
    if (el) { el.style.display='block'; el.innerHTML='<p style="text-align:center;padding:16px;color:#667eea">🔍 Analyzing…</p>'; }
    try {
      const [easyR, medR, hardR] = await Promise.all([
        DB.list(SD.COL.QUESTIONS, [SD.Q.equal('difficulty','easy')],   1),
        DB.list(SD.COL.QUESTIONS, [SD.Q.equal('difficulty','medium')], 1),
        DB.list(SD.COL.QUESTIONS, [SD.Q.equal('difficulty','hard')],   1),
      ]);
      const easy=easyR.total, medium=medR.total, hard=hardR.total;
      const total = Math.max(1, easy+medium+hard);
      const easyPct=Math.round(easy/total*100), medPct=Math.round(medium/total*100), hardPct=Math.round(hard/total*100);
      if (el) el.innerHTML = `
        <h4 style="margin-bottom:12px;font-size:.9rem;font-weight:700">📊 Difficulty Distribution (${total} questions)</h4>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${[['Easy','#28a745',easy,easyPct,30],['Medium','#ffc107',medium,medPct,50],['Hard','#dc3545',hard,hardPct,20]].map(([l,c,n,pct,rec])=>`
            <div style="display:flex;align-items:center;gap:10px;font-size:.85rem">
              <div style="width:60px;font-weight:600;color:${c}">${l}</div>
              <div style="flex:1;height:16px;background:#e9ecef;border-radius:999px;overflow:hidden">
                <div style="width:${pct}%;height:100%;background:${c};border-radius:999px;transition:width 1s"></div>
              </div>
              <div style="width:40px;text-align:right">${n} (${pct}%)</div>
              <div style="font-size:.75rem;color:#6c757d">rec: ${rec}%</div>
            </div>`).join('')}
        </div>
        <p style="margin-top:12px;font-size:.8rem;color:#6c757d;font-style:italic">Recommendation: 30% Easy · 50% Medium · 20% Hard</p>`;
    } catch(e) { if(el) el.innerHTML=`<div class="alert alert-danger">${_esc(e.message)}</div>`; }
  }

  async function generateInsights() {
    const el = document.getElementById('aiInsights');
    if (el) { el.style.display='block'; el.innerHTML='<p style="text-align:center;padding:16px;color:#667eea">📊 Generating insights…</p>'; }
    try {
      const [results, violations, candidates] = await Promise.all([
        DB.list(SD.COL.RESULTS,    [SD.Q.orderDesc('$createdAt')], 200),
        DB.list(SD.COL.VIOLATIONS, [SD.Q.orderDesc('$createdAt')], 200),
        DB.list(SD.COL.CANDIDATES, [], 1),
      ]);
      const total      = results.total;
      const passed     = results.documents.filter(d=>d.passed).length;
      const passRate   = total ? Math.round(passed/total*100) : 0;
      const avgScore   = total ? Math.round(results.documents.reduce((a,d)=>a+(d.percentage||0),0)/total) : 0;
      const topViol    = violations.documents.reduce((acc,v) => { acc[v.type]=(acc[v.type]||0)+1; return acc; },{});
      const topViolStr = Object.entries(topViol).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([t,c])=>`${t}: ${c}`).join(', ') || 'None';
      if (el) el.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="background:#fff;border-left:4px solid #667eea;padding:14px;border-radius:0 8px 8px 0">
            <div style="font-size:1.4rem;font-weight:800;color:#1a1a2e">${passRate}%</div>
            <div style="font-size:.8rem;color:#6c757d">Overall Pass Rate (${total} results)</div>
          </div>
          <div style="background:#fff;border-left:4px solid #28a745;padding:14px;border-radius:0 8px 8px 0">
            <div style="font-size:1.4rem;font-weight:800;color:#1a1a2e">${avgScore}%</div>
            <div style="font-size:.8rem;color:#6c757d">Average Score</div>
          </div>
          <div style="background:#fff;border-left:4px solid #dc3545;padding:14px;border-radius:0 8px 8px 0">
            <div style="font-size:1.4rem;font-weight:800;color:#1a1a2e">${violations.total}</div>
            <div style="font-size:.8rem;color:#6c757d">Total Violations Logged</div>
          </div>
          <div style="background:#fff;padding:14px;border-radius:8px;border:1px solid #dee2e6;font-size:.85rem">
            <strong>Top Violations:</strong> ${topViolStr}<br>
            <strong>Candidates:</strong> ${candidates.total}<br>
            ${passRate<60?'<span style="color:#dc3545">⚠️ Pass rate below 60% — review question difficulty.</span>':''}
            ${violations.total>50?'<span style="color:#ffc107">⚠️ High violations — review anti-cheat settings.</span>':''}
          </div>
        </div>`;
    } catch(e) { if(el) el.innerHTML=`<div class="alert alert-danger">${_esc(e.message)}</div>`; }
  }

  function _esc(s) { const d=document.createElement('div');d.textContent=s??'';return d.innerHTML; }

  return { loadSubjects, generate, saveGenerated, extractPdf, analyzeDifficulty, generateInsights };
})();
