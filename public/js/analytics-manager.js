/**
 * SOFTLY DIGITAL V3 — analytics-manager.js (Appwrite edition)
 */
const AnalyticsManager = (() => {
  'use strict';
  let currentRange = 30;
  let charts       = {};

  async function load() { await _loadCharts(); }
  function changeRange(days) { currentRange = parseInt(days); _loadCharts(); }
  function switchTab(tab, btn) {
    document.querySelectorAll('.atab').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    _loadCharts(tab);
  }

  async function _loadCharts() {
    try {
      const since = new Date();
      since.setDate(since.getDate() - currentRange);
      const res = await DB.list(SD.COL.RESULTS, [
        SD.Q.greaterThan('createdAt', since.toISOString()),
        SD.Q.orderDesc('createdAt'),
      ], 500);
      const results = res.documents;
      _drawPassRateChart(results);
      _drawCentreRankingChart(results);
      _drawDiffDistChart(results);
      _drawScoreBucketChart(results);
    } catch(e) { console.error('Analytics:', e); }
  }

  function _drawPassRateChart(results) {
    const ctx = document.getElementById('passRateChart');
    if (!ctx || typeof Chart==='undefined') return;
    if (charts.passRate) charts.passRate.destroy();
    const byDay = {};
    results.forEach(r => {
      const day = r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-NG',{month:'short',day:'numeric'}) : 'Unknown';
      if (!byDay[day]) byDay[day]={pass:0,fail:0};
      r.passed ? byDay[day].pass++ : byDay[day].fail++;
    });
    const labels = Object.keys(byDay).slice(-14);
    charts.passRate = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[
        { label:'Passed', data:labels.map(d=>byDay[d]?.pass||0), borderColor:'#28a745', backgroundColor:'rgba(40,167,69,.1)', fill:true, tension:0.4 },
        { label:'Failed', data:labels.map(d=>byDay[d]?.fail||0), borderColor:'#dc3545', backgroundColor:'rgba(220,53,69,.1)',  fill:true, tension:0.4 },
      ]},
      options:{ responsive:true, interaction:{mode:'index',intersect:false} },
    });
  }

  function _drawCentreRankingChart(results) {
    const ctx = document.getElementById('centreRankChart');
    if (!ctx || typeof Chart==='undefined') return;
    if (charts.centreRank) charts.centreRank.destroy();
    const byCentre = {};
    results.forEach(r => {
      const c = r.centreName || 'Unknown';
      if (!byCentre[c]) byCentre[c]={pass:0,total:0};
      byCentre[c].total++;
      if(r.passed) byCentre[c].pass++;
    });
    const sorted = Object.entries(byCentre).sort((a,b)=>b[1].pass/b[1].total - a[1].pass/a[1].total);
    const labels = sorted.map(([k])=>k).slice(0,10);
    const data   = sorted.map(([,v])=>Math.round(v.pass/Math.max(1,v.total)*100)).slice(0,10);
    charts.centreRank = new Chart(ctx,{
      type:'bar', data:{labels,datasets:[{label:'Pass Rate %',data,backgroundColor:'#667eea',borderRadius:6}]},
      options:{responsive:true,indexAxis:'y',plugins:{legend:{display:false}}},
    });
  }

  function _drawDiffDistChart(results) {
    const ctx = document.getElementById('diffDistChart');
    if (!ctx || typeof Chart==='undefined') return;
    if (charts.diffDist) charts.diffDist.destroy();
    const counts = {easy:0,medium:0,hard:0};
    results.forEach(r => {
      if (r.difficulty) counts[r.difficulty]=(counts[r.difficulty]||0)+1;
    });
    charts.diffDist = new Chart(ctx,{
      type:'doughnut',
      data:{labels:['Easy','Medium','Hard'],datasets:[{data:[counts.easy,counts.medium,counts.hard],backgroundColor:['#28a745','#ffc107','#dc3545']}]},
      options:{responsive:true},
    });
  }

  function _drawScoreBucketChart(results) {
    const ctx = document.getElementById('candStatsChart');
    if (!ctx || typeof Chart==='undefined') return;
    if (charts.candStats) charts.candStats.destroy();
    const buckets = {'0-20':0,'21-40':0,'41-60':0,'61-80':0,'81-100':0};
    results.forEach(r => {
      const p = r.percentage||0;
      if(p<=20) buckets['0-20']++;
      else if(p<=40) buckets['21-40']++;
      else if(p<=60) buckets['41-60']++;
      else if(p<=80) buckets['61-80']++;
      else buckets['81-100']++;
    });
    charts.candStats = new Chart(ctx,{
      type:'bar',
      data:{labels:Object.keys(buckets),datasets:[{label:'Candidates',data:Object.values(buckets),backgroundColor:'#667eea',borderRadius:6}]},
      options:{responsive:true,plugins:{legend:{display:false}}},
    });
  }

  async function exportReport() {
    if (typeof XLSX==='undefined') { alert('XLSX not loaded'); return; }
    const res = await DB.list(SD.COL.RESULTS, [SD.Q.orderDesc('$createdAt')], 2000);
    const rows = res.documents.map(r => ({
      'Candidate':   r.candidateName||r.candidateId||'',
      'Exam':        r.examName||r.examId||'',
      'Score (%)':   r.percentage||0,
      'Grade':       r.grade||'',
      'Passed':      r.passed?'Yes':'No',
      'Correct':     r.correctAnswers||0,
      'Total':       r.totalQuestions||0,
      'Time Taken':  r.timeTaken||0,
      'Date':        r.createdAt?new Date(r.createdAt).toLocaleDateString('en-NG'):'',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Analytics Report');
    XLSX.writeFile(wb, `softly-analytics-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  return { load, switchTab, changeRange, export: exportReport };
})();
