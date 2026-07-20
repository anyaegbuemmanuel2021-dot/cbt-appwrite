#!/usr/bin/env node
/**
 * SOFTLY DIGITAL V3 — Create "All Subjects" Exam
 * Checks how many questions exist per subject, then creates one exam
 * (name configurable below) spanning every subject that has questions.
 *
 * Usage:
 *   set APPWRITE_API_KEY=your-key-here      (Windows cmd)
 *   node scripts/create-jamb-exam.js
 */

const sdk = require('node-appwrite');

const ENDPOINT     = process.env.APPWRITE_ENDPOINT   || 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID   = process.env.APPWRITE_PROJECT_ID || '6a5cab36001397f233a6';
const API_KEY      = process.env.APPWRITE_API_KEY    || 'standard_5d7e5567b62631c4220d6fed92b3a9c2a487708b24cf055da33860ae63b972706fb5cdbb38a135b2e285ac5c210471a49a11a0d69cf2ae6c86c5005113ec817f9b454a28f1678622fce687e9b2fee26b5e9f62462b40afa90139c85d187579a042b5c3cad73f6fbcf7af5b11b08042c0f2004a098f1f0d91239c54e9c0663090';
const DB_ID        = 'cbt-main';

const EXAM_NAME       = 'All Subjects Exam';
const TOTAL_QUESTIONS = 60;
const DURATION_MIN    = 90;

if (!API_KEY) {
  console.error('\n❌ Missing APPWRITE_API_KEY. Set it before running:\n   set APPWRITE_API_KEY=your-key-here\n');
  process.exit(1);
}

const client = new sdk.Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const tablesDB = new sdk.TablesDB(client);

async function listAll(tableId, queries = []) {
  let rows = [];
  let cursor = null;
  while (true) {
    const q = [...queries, sdk.Query.limit(100)];
    if (cursor) q.push(sdk.Query.cursorAfter(cursor));
    const res = await tablesDB.listRows({ databaseId: DB_ID, tableId, queries: q });
    rows = rows.concat(res.rows);
    if (res.rows.length < 100) break;
    cursor = res.rows[res.rows.length - 1].$id;
  }
  return rows;
}

(async () => {
  console.log('\n📚 Fetching subjects...');
  const subjects = await listAll('subjects');
  if (subjects.length === 0) {
    console.error('❌ No subjects found in the "subjects" table. Add subjects first.');
    process.exit(1);
  }
  console.log(`  Found ${subjects.length} subject(s).\n`);

  console.log('🔍 Counting questions per subject...');
  const usable = [];
  for (const s of subjects) {
    const qs = await tablesDB.listRows({
      databaseId: DB_ID,
      tableId: 'questions',
      queries: [sdk.Query.equal('subjectId', s.$id), sdk.Query.limit(1)],
    });
    console.log(`  - ${s.name.padEnd(30)} ${qs.total} question(s)`);
    if (qs.total > 0) usable.push({ id: s.$id, name: s.name, count: qs.total });
  }

  if (usable.length === 0) {
    console.error('\n❌ None of your subjects have any questions yet. Add questions before creating this exam.');
    process.exit(1);
  }

  const totalAvailable = usable.reduce((sum, s) => sum + s.count, 0);
  console.log(`\n✅ ${usable.length} subject(s) have questions (${totalAvailable} total available).`);

  if (totalAvailable < TOTAL_QUESTIONS) {
    console.warn(`⚠️  Warning: only ${totalAvailable} questions available across usable subjects, but the exam wants ${TOTAL_QUESTIONS}.`);
    console.warn('   The exam will still be created, but the candidate engine may not be able to fill all 60 slots.\n');
  }

  const now = new Date().toISOString();
  const exam = await tablesDB.createRow({
    databaseId: DB_ID,
    tableId: 'exams',
    rowId: sdk.ID.unique(),
    data: {
      name: EXAM_NAME,
      subjectIds: JSON.stringify(usable.map(s => s.id)),
      subject: usable.map(s => s.name).join(', '),
      duration: DURATION_MIN,
      totalQuestions: TOTAL_QUESTIONS,
      passingScore: 70,
      randomizeQuestions: true,
      shuffleOptions: true,
      active: false,       // flip on from the dashboard when ready to go live
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    },
  });

  console.log(`\n🎉 Exam created: "${exam.name}" (id: ${exam.$id})`);
  console.log('   Status: draft — activate it from the Admin Dashboard when ready.\n');
})().catch(err => {
  console.error('\n❌ Error:', err.message || err);
  process.exit(1);
});
