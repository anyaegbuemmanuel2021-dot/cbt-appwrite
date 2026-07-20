#!/usr/bin/env node
/**
 * SOFTLY DIGITAL V3 — Bulk Question Seeder
 * Inserts the JAMB/WAEC-style question bank (question-bank-data.js)
 * into the "questions" table, matched to real subject IDs by name.
 * Skips any subject not found in question-bank-data.js (e.g. Mathematics,
 * which already has content) and reports a clean summary at the end.
 *
 * Usage:
 *   set APPWRITE_API_KEY=your-key
 *   node scripts/seed-all-questions.js
 */

const sdk = require('node-appwrite');
const bank = require('./question-bank-data');

const ENDPOINT   = process.env.APPWRITE_ENDPOINT   || 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = process.env.APPWRITE_PROJECT_ID || '6a5cab36001397f233a6';
const API_KEY    = process.env.APPWRITE_API_KEY    || 'standard_5d7e5567b62631c4220d6fed92b3a9c2a487708b24cf055da33860ae63b972706fb5cdbb38a135b2e285ac5c210471a49a11a0d69cf2ae6c86c5005113ec817f9b454a28f1678622fce687e9b2fee26b5e9f62462b40afa90139c85d187579a042b5c3cad73f6fbcf7af5b11b08042c0f2004a098f1f0d91239c54e9c0663090';
const DB_ID      = 'cbt-main';

if (!API_KEY) {
  console.error('\n❌ Missing APPWRITE_API_KEY. Set it before running:\n   set APPWRITE_API_KEY=your-key\n');
  process.exit(1);
}

const client   = new sdk.Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const tablesDB = new sdk.TablesDB(client);

async function listAll(tableId, queries = []) {
  let rows = [], cursor = null;
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
  const bySubjectName = {};
  subjects.forEach(s => { bySubjectName[s.name] = s.$id; });

  const subjectNamesInBank = Object.keys(bank);
  console.log(`  ${subjects.length} subject(s) in DB, ${subjectNamesInBank.length} subject(s) in question bank.\n`);

  let totalInserted = 0;
  let totalFailed   = 0;
  const missing = [];

  for (const subjectName of subjectNamesInBank) {
    const subjectId = bySubjectName[subjectName];
    if (!subjectId) {
      missing.push(subjectName);
      console.log(`  ⚠️  Skipping "${subjectName}" — no matching subject found in DB.`);
      continue;
    }

    const questions = bank[subjectName];
    let insertedForSubject = 0;

    for (const q of questions) {
      try {
        await tablesDB.createRow({
          databaseId: DB_ID,
          tableId: 'questions',
          rowId: sdk.ID.unique(),
          data: {
            text:          q.text,
            optionA:       q.A,
            optionB:       q.B,
            optionC:       q.C,
            optionD:       q.D,
            correctAnswer: q.correct,
            subjectId:     subjectId,
            subject:       subjectName,
            topic:         q.topic || '',
            difficulty:    q.difficulty || 'medium',
          },
        });
        insertedForSubject++;
        totalInserted++;
      } catch (e) {
        totalFailed++;
        console.log(`    ❌ Failed one question in ${subjectName}: ${e.message}`);
      }
    }
    console.log(`  ✅ ${subjectName.padEnd(28)} ${insertedForSubject}/${questions.length} inserted`);
  }

  console.log(`\n🎉 Done. ${totalInserted} question(s) inserted, ${totalFailed} failed.`);
  if (missing.length) {
    console.log(`\n⚠️  These subject names in the question bank had no match in your DB — check spelling/casing:`);
    missing.forEach(m => console.log(`    - ${m}`));
  }
  console.log('');
})().catch(err => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
