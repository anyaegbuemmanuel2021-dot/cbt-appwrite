/**
 * SOFTLY DIGITAL V3 — analytics-manager.js (Appwrite edition)
 */
const AnalyticsManager = (() => {
  'use strict';
  let currentRange = 30;
  let charts       = {};
  let centreNameCache = null; // candidateId -> centreName, built once per load cycle

  async function load() { await _loadCharts(); }
  function changeRange(days) { currentRange = parseInt(days); centreNameCache = null; _loadCharts(); }
  function switchTab(tab, btn) {
    document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _loadCharts(tab);
  }

  // Results never carry a centreName of their own — a candidate's centre
  // lives on the candidates collection. Build a candidateId -> centreName
  // map once (candidate document $id === the account/candidateId used on
  // every result), so the centre-ranking chart reflects real centres
  // instead of bucketing everything under "Unknown".
  async function _centreNameFor() {
    if (centreNameCache) return centreNameCache;
    centreNameCache = {};
    try {
      const cands = await DB.list(SD.COL.CANDIDATES, [], 2000);
      cands.documents.forEach(c => { centreNameCache[c.$id] = c.centreName || 'Unknown'; });
    } catch (_) { /* leave cache empty — chart just falls back to Unknown */ }
    return centreNameCache;
  }

  async function _loadCharts() {
    try {
      const since = new Date();
      since.setDate(since.getDate() - currentRange);
      // NOTE: bumped from 500 -> 1500. At 500 rows, any range with more
      // submissions than that silently truncated to the newest 500 and
      // every chart below (pass-rate trend, centre ranking, score spread)
      // was quietly computed on a partial, non-representative sample.
      const [res, centreMap] = await Promise.all([
        DB.list(SD.COL.RESULTS, [
          SD.Q.greaterThan('createdAt', since.toISOString()),
          SD.Q.orderDesc('createdAt'),
        ], 1500),
        _centreNameFor(),
      ]);
      const results = res.documents;
      _drawPassRateChart(results);
      _drawCentreRankingChart(results, centreMap);
      _drawDiffDistChart(results);
      _drawScoreBucketChart(results);
    } catch (e) { console.error('Analytics:', e); }
  }

  function _drawPassRateChart(results) {
    const ctx = document.getElementById('passRateChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (charts.passRate) charts.passRate.destroy();

    const byDay = {};
    results.forEach(r => {
      if (!r.createdAt) return;
      const dateKey = r.createdAt.slice(0, 10); // sortable YYYY-MM-DD
      if (!byDay[dateKey]) byDay[dateKey] = { pass: 0, fail: 0 };
      r.passed ? byDay[dateKey].pass++ : byDay[dateKey].fail++;
    });

    // FIX: results arrive newest-first (orderDesc), so the object's key
    // insertion order was newest-first too. The old code did
    // `Object.keys(byDay).slice(-14)`, which grabbed the OLDEST 14 days
    // in the range (and plotted them backwards) instead of the most
    // recent 14 — the trend line was reading the wrong slice of history
    // in the wrong direction. Sort ascending by real date, then take the
    // last 14 (i.e. the most recent 14 days), so the chart reads
    // left-to-right, oldest to newest.
    const sortedDays = Object.keys(byDay).sort();
    const last14 = sortedDays.slice(-14);
    const labels = last14.map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }));

    charts.passRate = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Passed', data: last14.map(d => byDay[d]?.pass || 0), borderColor: '#28a745', backgroundColor: 'rgba(40,167,69,.1)', fill: true, tension: 0.4 },
          { label: 'Failed', data: last14.map(d => byDay[d]?.fail || 0), borderColor: '#dc3545', backgroundColor: 'rgba(220,53,69,.1)',  fill: true, tension: 0.4 },
        ],
      },
      options: { responsive: true, interaction: { mode: 'index', intersect: false } },
    });
  }

  function _drawCentreRankingChart(results, centreMap) {
    const ctx = document.getElementById('centreRankChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (charts.centreRank) charts.centreRank.destroy();

    const byCentre = {};
    results.forEach(r => {
      // FIX: results never stored a centreName field, so this chart used
      // to lump every single result into one "Unknown" bar. Resolve the
      // real centre through the candidate the result belongs to instead.
      const c = centreMap[r.candidateId] || 'Unknown';
      if (!byCentre[c]) byCentre[c] = { pass: 0, total: 0 };
      byCentre[c].total++;
      if (r.passed) byCentre[c].pass++;
    });
    const sorted = Object.entries(byCentre).sort((a, b) => (b[1].pass / b[1].total) - (a[1].pass / a[1].total));
    const labels = sorted.map(([k]) => k).slice(0, 10);
    const data   = sorted.map(([, v]) => Math.round(v.pass / Math.max(1, v.total) * 100)).slice(0, 10);
    charts.centreRank = new Chart(ctx, {
      type: 'bar', data: { labels, datasets: [{ label: 'Pass Rate %', data, backgroundColor: '#667eea', borderRadius: 6 }] },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } },
    });
  }

  function _drawDiffDistChart(results) {
    const ctx = document.getElementById('diffDistChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (charts.diffDist) charts.diffDist.destroy();

    // FIX: a whole exam result can't have one "difficulty" — that field
    // never existed on the results collection, so this chart was always
    // empty. Difficulty is a per-question attribute, recorded per-answer
    // inside answerBreakdown (see exam-engine.js), so tally it from there.
    const counts = { easy: 0, medium: 0, hard: 0 };
    results.forEach(r => {
      if (!r.answerBreakdown) return;
      let breakdown = {};
      try { breakdown = JSON.parse(r.answerBreakdown); } catch (_) { return; }
      Object.values(breakdown).forEach(ans => {
        const d = (ans.difficulty || 'medium').toLowerCase();
        if (counts[d] !== undefined) counts[d]++;
      });
    });
    charts.diffDist = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Easy', 'Medium', 'Hard'], datasets: [{ data: [counts.easy, counts.medium, counts.hard], backgroundColor: ['#28a745', '#ffc107', '#dc3545'] }] },
      options: { responsive: true },
    });
  }

  function _drawScoreBucketChart(results) {
    const ctx = document.getElementById('candStatsChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (charts.candStats) charts.candStats.destroy();
    const buckets = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
    results.forEach(r => {
      const p = r.percentage || 0;
      if (p <= 20) buckets['0-20']++;
      else if (p <= 40) buckets['21-40']++;
      else if (p <= 60) buckets['41-60']++;
      else if (p <= 80) buckets['61-80']++;
      else buckets['81-100']++;
    });
    charts.candStats = new Chart(ctx, {
      type: 'bar',
      data: { labels: Object.keys(buckets), datasets: [{ label: 'Candidates', data: Object.values(buckets), backgroundColor: '#667eea', borderRadius: 6 }] },
      options: { responsive: true, plugins: { legend: { display: false } } },
    });
  }

  async function exportReport() {
    if (typeof XLSX === 'undefined') { alert('XLSX not loaded'); return; }
    const centreMap = await _centreNameFor();
    const res = await DB.list(SD.COL.RESULTS, [SD.Q.orderDesc('$createdAt')], 2000);
    const rows = res.documents.map(r => ({
      'Candidate':   r.candidateName || r.candidateId || '',
      'Centre':      centreMap[r.candidateId] || 'Unknown',
      'Exam':        r.examName || r.examId || '',
      'Score (%)':   r.percentage || 0,
      'Grade':       r.grade || '',
      'Passed':      r.passed ? 'Yes' : 'No',
      'Correct':     r.correctAnswers || 0,
      'Total':       r.totalQuestions || 0,
      'Time Taken':  r.timeTaken || 0,
      'Date':        r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-NG') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analytics Report');
    XLSX.writeFile(wb, `softly-analytics-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return { load, switchTab, changeRange, export: exportReport };
})();
