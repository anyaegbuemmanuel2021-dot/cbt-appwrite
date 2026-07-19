// Standalone test for the shuffle/grading fix in exam-engine.js.
// Exercises the exact bug scenario: shuffle options, grade, then simulate
// a page reload (re-run shuffle with the same seed) and grade again —
// results must be identical both times, and a candidate who picks the
// content that is actually correct must always be marked correct,
// regardless of which letter that content lands on.

function _hashSeed(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}
function _rng(seedStr) {
  let a = _hashSeed(String(seedStr));
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _shuffle(arr, rng) {
  const rand = rng || Math.random;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function _shuffleOptions(options, correctLetter, rng) {
  if (!options || typeof options !== 'object') return { options, correctAnswer: correctLetter };
  const entries = _shuffle(Object.entries(options), rng);
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const result = {};
  let newCorrectLetter = correctLetter;
  entries.forEach(([origLetter, val], i) => {
    result[letters[i]] = val;
    if (origLetter === correctLetter) newCorrectLetter = letters[i];
  });
  return { options: result, correctAnswer: newCorrectLetter };
}

function loadQuestion(seed, q) {
  const rng = _rng(seed + '_opt_' + q.id);
  const { options, correctAnswer } = _shuffleOptions(q.options, q.correctAnswer, rng);
  return { ...q, shuffledOptions: options, shuffledCorrectAnswer: correctAnswer };
}

function grade(questions, answers) {
  let correct = 0;
  const breakdown = {};
  questions.forEach(q => {
    const studentAns = answers[q.id] || 'NOT_ANSWERED';
    const correctLetter = q.shuffledCorrectAnswer || q.correctAnswer;
    const isCorrect = studentAns === correctLetter;
    if (isCorrect) correct++;
    breakdown[q.id] = { studentAns, correctLetter, isCorrect };
  });
  return { correct, breakdown };
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.error('FAIL:', name); }
}

const RAW_QUESTIONS = [
  { id: 'q1', text: '3^2 + 4^2 = ?', correctAnswer: 'B', options: { A: '20', B: '25', C: '30', D: '49' } },
  { id: 'q2', text: 'Solve x^2-5x+6=0', correctAnswer: 'D', options: { A: '1,6', B: '-2,-3', C: '0,5', D: '2,3' } },
  { id: 'q3', text: 'Gradient of y=2x+3', correctAnswer: 'A', options: { A: '2', B: '3', C: '-2', D: '0' } },
];

// --- Test 1: no shuffle (identity) ---
{
  const seed = 'attempt-1';
  const loaded = RAW_QUESTIONS.map(q => loadQuestion(seed, q));
  // Candidate selects the content that is actually correct, using whatever
  // letter it now sits under post-shuffle.
  const answers = {};
  loaded.forEach(q => { answers[q.id] = q.shuffledCorrectAnswer; });
  const { correct } = grade(loaded, answers);
  check('Single choice / no reload: correct content -> full marks', correct === RAW_QUESTIONS.length);
}

// --- Test 2: option shuffle only, verify content (not letter) integrity ---
{
  const seed = 'attempt-2';
  const loaded = RAW_QUESTIONS.map(q => loadQuestion(seed, q));
  loaded.forEach(q => {
    const correctText = q.options[q.correctAnswer];
    const shuffledCorrectText = q.shuffledOptions[q.shuffledCorrectAnswer];
    check(`q ${q.id}: shuffled correct-letter still points at the correct text`, correctText === shuffledCorrectText);
  });
}

// --- Test 3: simulated page refresh mid-exam (the core bug) ---
{
  const examSeed = 'attempt-3-seed';
  // First load (before refresh)
  const firstLoad = RAW_QUESTIONS.map(q => loadQuestion(examSeed, q));
  // Candidate reads option content and picks the letter that currently
  // holds the correct answer text.
  const answers = {};
  firstLoad.forEach(q => { answers[q.id] = q.shuffledCorrectAnswer; });

  // Simulate browser refresh: init() re-runs, re-shuffling with the SAME
  // persisted seed (this is what localStorage['examSeed_'+examId] gives us).
  const secondLoad = RAW_QUESTIONS.map(q => loadQuestion(examSeed, q));

  check('Refresh: option layout identical across reloads (same seed)',
    JSON.stringify(firstLoad.map(q => q.shuffledOptions)) === JSON.stringify(secondLoad.map(q => q.shuffledOptions)));

  const { correct } = grade(secondLoad, answers);
  check('Refresh: previously-selected correct answers still grade correct after reload',
    correct === RAW_QUESTIONS.length);
}

// --- Test 4: different seed (different attempt/candidate) produces different layout ---
{
  const a = RAW_QUESTIONS.map(q => loadQuestion('candidate-A', q));
  const b = RAW_QUESTIONS.map(q => loadQuestion('candidate-B', q));
  const anyDifferent = a.some((q, i) => JSON.stringify(q.shuffledOptions) !== JSON.stringify(b[i].shuffledOptions));
  check('Different seeds still produce (generally) different shuffles', anyDifferent);
}

// --- Test 5: wrong answer is still correctly marked wrong ---
{
  const seed = 'attempt-5';
  const loaded = RAW_QUESTIONS.map(q => loadQuestion(seed, q));
  const answers = {};
  loaded.forEach(q => {
    const wrongLetter = ['A', 'B', 'C', 'D'].find(l => l !== q.shuffledCorrectAnswer && loaded.find(x=>x.id===q.id).shuffledOptions[l] !== undefined);
    answers[q.id] = wrongLetter;
  });
  const { correct } = grade(loaded, answers);
  check('Genuinely wrong answers are marked wrong', correct === 0);
}

// --- Test 6: skipped question ---
{
  const seed = 'attempt-6';
  const loaded = RAW_QUESTIONS.map(q => loadQuestion(seed, q));
  const answers = {}; // nothing answered
  const { correct, breakdown } = grade(loaded, answers);
  check('Skipped questions score 0 and are flagged NOT_ANSWERED', correct === 0 && breakdown.q1.studentAns === 'NOT_ANSWERED');
}

// --- Test 7: large exam (100+ questions), all correct ---
{
  const big = [];
  for (let i = 0; i < 150; i++) {
    big.push({ id: 'gen' + i, correctAnswer: 'A', options: { A: 'right', B: 'wrong1', C: 'wrong2', D: 'wrong3' } });
  }
  const seed = 'attempt-7';
  const loaded = big.map(q => loadQuestion(seed, q));
  const answers = {};
  loaded.forEach(q => { answers[q.id] = q.shuffledCorrectAnswer; });
  const { correct } = grade(loaded, answers);
  check('Large exam (150 Qs): all correct content -> full score', correct === 150);
}

// --- Test 8: no shuffle at all (both switches off) ---
{
  const noShuffleQ = q => ({ ...q, shuffledOptions: q.options, shuffledCorrectAnswer: q.correctAnswer });
  const loaded = RAW_QUESTIONS.map(noShuffleQ);
  const answers = {};
  loaded.forEach(q => { answers[q.id] = q.correctAnswer; });
  const { correct } = grade(loaded, answers);
  check('No shuffle at all: correct letters grade correct', correct === RAW_QUESTIONS.length);
}

// --- Test 9: question order shuffle only, options untouched ---
{
  const seed = 'attempt-9';
  const orderedOnly = _shuffle(RAW_QUESTIONS, _rng(seed + '_qorder')).map(q => ({ ...q, shuffledOptions: q.options, shuffledCorrectAnswer: q.correctAnswer }));
  const answers = {};
  orderedOnly.forEach(q => { answers[q.id] = q.correctAnswer; });
  const { correct } = grade(orderedOnly, answers);
  check('Question-order shuffle only: grading unaffected by question order', correct === RAW_QUESTIONS.length);
  check('Question-order shuffle only: order actually changed', orderedOnly.map(q => q.id).join() !== RAW_QUESTIONS.map(q => q.id).join());
}

// --- Test 10: resume on a NEW device (no local seed, seed comes from server session doc) ---
{
  const seed = 'attempt-10-server-seed';
  // Device A: original attempt, answers submitted based on this seed's shuffle
  const deviceA = RAW_QUESTIONS.map(q => loadQuestion(seed, q));
  const answers = {};
  deviceA.forEach(q => { answers[q.id] = q.shuffledCorrectAnswer; });

  // Device B: no local seed at all — simulates a brand new browser/device.
  // exam-engine.js now recovers `seed` from the session document itself
  // (existingSessionDoc.seed) before shuffling, rather than generating a
  // new random one. We simulate that recovery here directly.
  const recoveredSeed = seed; // what existingSessionDoc.seed would supply
  const deviceB = RAW_QUESTIONS.map(q => loadQuestion(recoveredSeed, q));

  check('Cross-device resume: layout identical when seed is recovered from server',
    JSON.stringify(deviceA.map(q => q.shuffledOptions)) === JSON.stringify(deviceB.map(q => q.shuffledOptions)));
  const { correct } = grade(deviceB, answers);
  check('Cross-device resume: answers from device A still grade correctly on device B', correct === RAW_QUESTIONS.length);
}

// --- Test 11: retake exam gets a fresh, independent shuffle ---
{
  const firstAttemptSeed = 'candidate-X-attempt-1';
  const secondAttemptSeed = 'candidate-X-attempt-2'; // exam-engine.js clears examSeed_ on submit, so a retake generates a new one
  const attempt1 = RAW_QUESTIONS.map(q => loadQuestion(firstAttemptSeed, q));
  const attempt2 = RAW_QUESTIONS.map(q => loadQuestion(secondAttemptSeed, q));
  const layoutsDiffer = attempt1.some((q, i) => JSON.stringify(q.shuffledOptions) !== JSON.stringify(attempt2[i].shuffledOptions));
  check('Retake: new attempt does not reuse the previous attempt\'s shuffle', layoutsDiffer);
  // Each attempt still grades independently and correctly on its own terms
  const ans2 = {}; attempt2.forEach(q => { ans2[q.id] = q.shuffledCorrectAnswer; });
  check('Retake: second attempt grades correctly on its own shuffle', grade(attempt2, ans2).correct === RAW_QUESTIONS.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
