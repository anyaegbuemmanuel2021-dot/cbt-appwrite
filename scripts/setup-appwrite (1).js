#!/usr/bin/env node
/**
 * SOFTLY DIGITAL V3 — Appwrite Setup Script
 * Run once to create database, all collections, attributes and indexes.
 *
 * Usage:
 *   npm install node-appwrite
 *   node setup-appwrite.js
 *
 * Set your credentials below or as env vars:
 *   APPWRITE_ENDPOINT  APPWRITE_PROJECT_ID  APPWRITE_API_KEY
 */

const sdk = require('node-appwrite');

const ENDPOINT   = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6a39aa7e0036a36c3b71';
const API_KEY    = process.env.APPWRITE_API_KEY    || 'YOUR_SERVER_API_KEY_HERE';

const DB_ID = 'cbt-main';

const client = new sdk.Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)
  .setKey(API_KEY);

const databases = new sdk.Databases(client);

/* ── helpers ─────────────────────────────────────────────────────── */
async function safe(fn, label) {
  try {
    const r = await fn();
    console.log(`  ✅ ${label}`);
    return r;
  } catch(e) {
    if (e.code === 409) { console.log(`  ⏭️  ${label} (already exists)`); }
    else console.error(`  ❌ ${label}: ${e.message}`);
  }
}

async function attr(type, dbId, colId, key, options = {}) {
  const fn = {
    string:  () => databases.createStringAttribute(dbId, colId, key, options.size||500, options.required||false, options.default||null, options.array||false),
    integer: () => databases.createIntegerAttribute(dbId, colId, key, options.required||false, options.min||undefined, options.max||undefined, options.default||null, options.array||false),
    boolean: () => databases.createBooleanAttribute(dbId, colId, key, options.required||false, options.default||null, options.array||false),
    float:   () => databases.createFloatAttribute(dbId, colId, key, options.required||false, options.min||undefined, options.max||undefined, options.default||null, options.array||false),
    datetime:() => databases.createDatetimeAttribute(dbId, colId, key, options.required||false, options.default||null, options.array||false),
  }[type];
  await safe(fn, `  attr ${colId}.${key} (${type})`);
  await new Promise(r => setTimeout(r, 200)); // rate-limit buffer
}

async function idx(dbId, colId, indexId, type, attrs, orders) {
  await safe(
    () => databases.createIndex(dbId, colId, indexId, type, attrs, orders),
    `  index ${colId}.${indexId}`
  );
  await new Promise(r => setTimeout(r, 200));
}

/* ── MAIN ─────────────────────────────────────────────────────────── */
async function main() {
  console.log('\n🚀 SOFTLY DIGITAL V3 — Appwrite Setup\n');

  // ── 1. Database ────────────────────────────────────────────────────
  console.log('📦 Creating database…');
  await safe(
    () => databases.create(DB_ID, 'CBT Main Database'),
    'Database: cbt-main'
  );

  const PERMS = [
    sdk.Permission.read(sdk.Role.users()),
    sdk.Permission.create(sdk.Role.users()),
    sdk.Permission.update(sdk.Role.users()),
    sdk.Permission.delete(sdk.Role.users()),
  ];

  // ── 2. Collections ─────────────────────────────────────────────────

  // USERS
  console.log('\n👥 Creating collection: users');
  await safe(() => databases.createCollection(DB_ID, 'users', 'Users', PERMS), 'Collection: users');
  await attr('string', DB_ID, 'users', 'fullName',    { size:200, required:true });
  await attr('string', DB_ID, 'users', 'email',       { size:200, required:true });
  await attr('string', DB_ID, 'users', 'role',        { size:50,  required:true });
  await attr('string', DB_ID, 'users', 'centreId',    { size:50 });
  await attr('string', DB_ID, 'users', 'centreName',  { size:200 });
  await attr('string', DB_ID, 'users', 'staffId',     { size:50 });
  await attr('string', DB_ID, 'users', 'status',      { size:20, default:'active' });
  await attr('string', DB_ID, 'users', 'lastLoginAt', { size:30 });
  await attr('string', DB_ID, 'users', 'createdAt',   { size:30 });
  await attr('string', DB_ID, 'users', 'updatedAt',   { size:30 });
  await idx(DB_ID, 'users', 'idx_email',   'unique', ['email'],   ['ASC']);
  await idx(DB_ID, 'users', 'idx_role',    'key',    ['role'],    ['ASC']);
  await idx(DB_ID, 'users', 'idx_centreId','key',    ['centreId'],['ASC']);
  await idx(DB_ID, 'users', 'idx_staffId', 'key',    ['staffId'], ['ASC']);

  // CENTRES
  console.log('\n🏢 Creating collection: centres');
  await safe(() => databases.createCollection(DB_ID, 'centres', 'Centres', PERMS), 'Collection: centres');
  await attr('string',  DB_ID, 'centres', 'code',       { size:20,  required:true });
  await attr('string',  DB_ID, 'centres', 'name',       { size:200, required:true });
  await attr('string',  DB_ID, 'centres', 'state',      { size:100 });
  await attr('string',  DB_ID, 'centres', 'address',    { size:500 });
  await attr('integer', DB_ID, 'centres', 'capacity',   { default:0 });
  await attr('string',  DB_ID, 'centres', 'imageUrl',   { size:500 });
  await attr('string',  DB_ID, 'centres', 'status',     { size:20, default:'active' });
  await attr('string',  DB_ID, 'centres', 'createdAt',  { size:30 });
  await attr('string',  DB_ID, 'centres', 'updatedAt',  { size:30 });
  await idx(DB_ID, 'centres', 'idx_code',   'unique', ['code'],   ['ASC']);
  await idx(DB_ID, 'centres', 'idx_status', 'key',    ['status'], ['ASC']);
  await idx(DB_ID, 'centres', 'idx_name',   'key',    ['name'],   ['ASC']);

  // CANDIDATES
  console.log('\n🎓 Creating collection: candidates');
  await safe(() => databases.createCollection(DB_ID, 'candidates', 'Candidates', PERMS), 'Collection: candidates');
  await attr('string',  DB_ID, 'candidates', 'candidateId',      { size:50,  required:true });
  await attr('string',  DB_ID, 'candidates', 'fullName',         { size:200, required:true });
  await attr('string',  DB_ID, 'candidates', 'email',            { size:200, required:true });
  await attr('string',  DB_ID, 'candidates', 'phone',            { size:30 });
  await attr('string',  DB_ID, 'candidates', 'centreId',         { size:50 });
  await attr('string',  DB_ID, 'candidates', 'centreName',       { size:200 });
  await attr('string',  DB_ID, 'candidates', 'gender',           { size:10 });
  await attr('string',  DB_ID, 'candidates', 'dob',              { size:20 });
  await attr('string',  DB_ID, 'candidates', 'passportImageUrl', { size:500 });
  await attr('string',  DB_ID, 'candidates', 'verificationPhotoUrl', { size:500 });
  await attr('string',  DB_ID, 'candidates', 'status',           { size:20, default:'active' });
  await attr('string',  DB_ID, 'candidates', 'examIds',          { size:2000 });   // JSON array
  await attr('string',  DB_ID, 'candidates', 'lastVerifiedAt',   { size:30 });
  await attr('string',  DB_ID, 'candidates', 'createdAt',        { size:30 });
  await attr('string',  DB_ID, 'candidates', 'updatedAt',        { size:30 });
  await idx(DB_ID, 'candidates', 'idx_candidateId', 'unique', ['candidateId'], ['ASC']);
  await idx(DB_ID, 'candidates', 'idx_email',       'unique', ['email'],       ['ASC']);
  await idx(DB_ID, 'candidates', 'idx_centreId',    'key',    ['centreId'],    ['ASC']);
  await idx(DB_ID, 'candidates', 'idx_status',      'key',    ['status'],      ['ASC']);
  await idx(DB_ID, 'candidates', 'idx_fullName',    'fulltext',['fullName'],   ['ASC']);

  // SUBJECTS
  console.log('\n📚 Creating collection: subjects');
  await safe(() => databases.createCollection(DB_ID, 'subjects', 'Subjects', PERMS), 'Collection: subjects');
  await attr('string', DB_ID, 'subjects', 'name',      { size:200, required:true });
  await attr('string', DB_ID, 'subjects', 'createdAt', { size:30 });
  await idx(DB_ID, 'subjects', 'idx_name', 'key', ['name'], ['ASC']);

  // TOPICS
  console.log('\n📖 Creating collection: topics');
  await safe(() => databases.createCollection(DB_ID, 'topics', 'Topics', PERMS), 'Collection: topics');
  await attr('string', DB_ID, 'topics', 'name',      { size:200, required:true });
  await attr('string', DB_ID, 'topics', 'subjectId', { size:50, required:true });
  await attr('string', DB_ID, 'topics', 'createdAt', { size:30 });
  await idx(DB_ID, 'topics', 'idx_subjectId', 'key', ['subjectId'], ['ASC']);

  // EXAMS
  console.log('\n📝 Creating collection: exams');
  await safe(() => databases.createCollection(DB_ID, 'exams', 'Exams', PERMS), 'Collection: exams');
  await attr('string',  DB_ID, 'exams', 'name',               { size:200, required:true });
  await attr('string',  DB_ID, 'exams', 'subjectId',          { size:50 });
  await attr('string',  DB_ID, 'exams', 'subject',            { size:200 });
  await attr('string',  DB_ID, 'exams', 'subjectIds',         { size:1000 });  // JSON array for multi-subject JAMB
  await attr('integer', DB_ID, 'exams', 'duration',           { required:true, min:1, default:60 });
  await attr('integer', DB_ID, 'exams', 'totalQuestions',     { required:true, min:1, default:50 });
  await attr('integer', DB_ID, 'exams', 'passingScore',       { default:70 });
  await attr('boolean', DB_ID, 'exams', 'randomizeQuestions', { default:true });
  await attr('boolean', DB_ID, 'exams', 'shuffleOptions',     { default:true });
  await attr('boolean', DB_ID, 'exams', 'active',             { default:false });
  await attr('string',  DB_ID, 'exams', 'status',             { size:20, default:'draft' });
  await attr('string',  DB_ID, 'exams', 'candidateIds',       { size:10000 }); // JSON array
  await attr('string',  DB_ID, 'exams', 'centreIds',          { size:2000 });  // JSON array
  await attr('string',  DB_ID, 'exams', 'scheduledStart',     { size:30 });
  await attr('string',  DB_ID, 'exams', 'scheduledEnd',       { size:30 });
  await attr('string',  DB_ID, 'exams', 'activatedAt',        { size:30 });
  await attr('string',  DB_ID, 'exams', 'deactivatedAt',      { size:30 });
  await attr('string',  DB_ID, 'exams', 'createdAt',          { size:30 });
  await attr('string',  DB_ID, 'exams', 'updatedAt',          { size:30 });
  await idx(DB_ID, 'exams', 'idx_active',    'key', ['active'],    ['ASC']);
  await idx(DB_ID, 'exams', 'idx_subjectId', 'key', ['subjectId'], ['ASC']);
  await idx(DB_ID, 'exams', 'idx_status',    'key', ['status'],    ['ASC']);
  await idx(DB_ID, 'exams', 'idx_examName',  'fulltext', ['name'], ['ASC']);

  // QUESTIONS
  console.log('\n❓ Creating collection: questions');
  await safe(() => databases.createCollection(DB_ID, 'questions', 'Questions', PERMS), 'Collection: questions');
  await attr('string', DB_ID, 'questions', 'text',          { size:2000, required:true });
  await attr('string', DB_ID, 'questions', 'options',       { size:1000 }); // JSON {A,B,C,D}
  await attr('string', DB_ID, 'questions', 'optionA',       { size:500 });
  await attr('string', DB_ID, 'questions', 'optionB',       { size:500 });
  await attr('string', DB_ID, 'questions', 'optionC',       { size:500 });
  await attr('string', DB_ID, 'questions', 'optionD',       { size:500 });
  await attr('string', DB_ID, 'questions', 'correctAnswer', { size:5, required:true });
  await attr('string', DB_ID, 'questions', 'subjectId',     { size:50 });
  await attr('string', DB_ID, 'questions', 'subject',       { size:200 });
  await attr('string', DB_ID, 'questions', 'topicId',       { size:50 });
  await attr('string', DB_ID, 'questions', 'topic',         { size:200 });
  await attr('string', DB_ID, 'questions', 'difficulty',    { size:20, default:'medium' });
  await attr('string', DB_ID, 'questions', 'explanation',   { size:1000 });
  await attr('string', DB_ID, 'questions', 'imageUrl',      { size:500 });
  await attr('string', DB_ID, 'questions', 'examId',        { size:50 });  // optional direct exam link
  await attr('integer',DB_ID, 'questions', 'examCount',     { default:0 });
  await idx(DB_ID, 'questions', 'idx_subjectId',  'key',     ['subjectId'],  ['ASC']);
  await idx(DB_ID, 'questions', 'idx_difficulty', 'key',     ['difficulty'], ['ASC']);
  await idx(DB_ID, 'questions', 'idx_examId',     'key',     ['examId'],     ['ASC']);
  await idx(DB_ID, 'questions', 'idx_text',       'fulltext',['text'],       ['ASC']);

  // EXAM SESSIONS
  console.log('\n🖥️  Creating collection: exam_sessions');
  await safe(() => databases.createCollection(DB_ID, 'exam_sessions', 'Exam Sessions', PERMS), 'Collection: exam_sessions');
  await attr('string',  DB_ID, 'exam_sessions', 'candidateId', { size:50, required:true });
  await attr('string',  DB_ID, 'exam_sessions', 'examId',      { size:50, required:true });
  await attr('integer', DB_ID, 'exam_sessions', 'duration',    { required:false, default:0 });
  await attr('string',  DB_ID, 'exam_sessions', 'startTime',   { size:30 });
  await attr('string',  DB_ID, 'exam_sessions', 'submittedAt', { size:30 });
  await attr('string',  DB_ID, 'exam_sessions', 'status',      { size:20, default:'active' });
  await attr('string',  DB_ID, 'exam_sessions', 'answers',     { size:50000 }); // JSON
  await attr('string',  DB_ID, 'exam_sessions', 'questionIds', { size:10000 }); // JSON
  await attr('integer', DB_ID, 'exam_sessions', 'violations',  { default:0 });
  await attr('string',  DB_ID, 'exam_sessions', 'lastSynced',  { size:30 });
  await idx(DB_ID, 'exam_sessions', 'idx_candidateId', 'key', ['candidateId'], ['ASC']);
  await idx(DB_ID, 'exam_sessions', 'idx_examId',      'key', ['examId'],      ['ASC']);
  await idx(DB_ID, 'exam_sessions', 'idx_status',      'key', ['status'],      ['ASC']);

  // SUBMISSIONS
  console.log('\n📤 Creating collection: submissions');
  await safe(() => databases.createCollection(DB_ID, 'submissions', 'Submissions', PERMS), 'Collection: submissions');
  await attr('string',  DB_ID, 'submissions', 'candidateId',  { size:50, required:true });
  await attr('string',  DB_ID, 'submissions', 'examId',       { size:50, required:true });
  await attr('string',  DB_ID, 'submissions', 'sessionId',    { size:50 });
  await attr('string',  DB_ID, 'submissions', 'answers',      { size:50000 }); // JSON
  await attr('integer', DB_ID, 'submissions', 'violations',   { default:0 });
  await attr('string',  DB_ID, 'submissions', 'submittedAt',  { size:30 });
  await attr('integer', DB_ID, 'submissions', 'timeTaken',    { default:0 });
  await attr('string',  DB_ID, 'submissions', 'submitReason', { size:50 });
  await idx(DB_ID, 'submissions', 'idx_candidateId', 'key', ['candidateId'], ['ASC']);
  await idx(DB_ID, 'submissions', 'idx_examId',      'key', ['examId'],      ['ASC']);

  // RESULTS
  console.log('\n🏆 Creating collection: results');
  await safe(() => databases.createCollection(DB_ID, 'results', 'Results', PERMS), 'Collection: results');
  await attr('string',  DB_ID, 'results', 'candidateId',     { size:50, required:true });
  await attr('string',  DB_ID, 'results', 'candidateName',   { size:200 });
  await attr('string',  DB_ID, 'results', 'examId',          { size:50, required:true });
  await attr('string',  DB_ID, 'results', 'examName',        { size:200 });
  await attr('string',  DB_ID, 'results', 'submissionId',    { size:50 });
  await attr('integer', DB_ID, 'results', 'correctAnswers',  { required:true, default:0 });
  await attr('integer', DB_ID, 'results', 'totalQuestions',  { required:true, default:0 });
  await attr('integer', DB_ID, 'results', 'percentage',      { default:0 });
  await attr('string',  DB_ID, 'results', 'grade',           { size:5 });
  await attr('boolean', DB_ID, 'results', 'passed',          { default:false });
  await attr('string',  DB_ID, 'results', 'answerBreakdown', { size:100000 }); // JSON
  await attr('string',  DB_ID, 'results', 'createdAt',       { size:30 });
  await idx(DB_ID, 'results', 'idx_candidateId', 'key', ['candidateId'], ['ASC']);
  await idx(DB_ID, 'results', 'idx_examId',      'key', ['examId'],      ['ASC']);
  await idx(DB_ID, 'results', 'idx_passed',      'key', ['passed'],      ['ASC']);

  // VIOLATIONS
  console.log('\n⚠️  Creating collection: violations');
  await safe(() => databases.createCollection(DB_ID, 'violations', 'Violations', PERMS), 'Collection: violations');
  await attr('string', DB_ID, 'violations', 'candidateId', { size:50, required:true });
  await attr('string', DB_ID, 'violations', 'examId',      { size:50 });
  await attr('string', DB_ID, 'violations', 'sessionId',   { size:50 });
  await attr('string', DB_ID, 'violations', 'type',        { size:50 });
  await attr('string', DB_ID, 'violations', 'description', { size:500 });
  await attr('string', DB_ID, 'violations', 'severity',    { size:20, default:'MEDIUM' });
  await attr('string', DB_ID, 'violations', 'timestamp',   { size:30 });
  await idx(DB_ID, 'violations', 'idx_candidateId', 'key', ['candidateId'], ['ASC']);
  await idx(DB_ID, 'violations', 'idx_timestamp',   'key', ['timestamp'],   ['ASC']);

  // AUDIT LOGS
  console.log('\n🔍 Creating collection: audit_logs');
  await safe(() => databases.createCollection(DB_ID, 'audit_logs', 'Audit Logs', PERMS), 'Collection: audit_logs');
  await attr('string', DB_ID, 'audit_logs', 'action',    { size:100, required:true });
  await attr('string', DB_ID, 'audit_logs', 'userId',    { size:50 });
  await attr('string', DB_ID, 'audit_logs', 'severity',  { size:20, default:'INFO' });
  await attr('string', DB_ID, 'audit_logs', 'meta',      { size:2000 }); // JSON
  await attr('string', DB_ID, 'audit_logs', 'userAgent', { size:200 });
  await attr('string', DB_ID, 'audit_logs', 'timestamp', { size:30 });
  await idx(DB_ID, 'audit_logs', 'idx_userId',    'key', ['userId'],    ['ASC']);
  await idx(DB_ID, 'audit_logs', 'idx_action',    'key', ['action'],    ['ASC']);
  await idx(DB_ID, 'audit_logs', 'idx_severity',  'key', ['severity'],  ['ASC']);
  await idx(DB_ID, 'audit_logs', 'idx_timestamp', 'key', ['timestamp'], ['DESC']);

  // NOTIFICATIONS
  console.log('\n🔔 Creating collection: notifications');
  await safe(() => databases.createCollection(DB_ID, 'notifications', 'Notifications', PERMS), 'Collection: notifications');
  await attr('string',  DB_ID, 'notifications', 'type',       { size:20, required:true }); // email/sms/push
  await attr('string',  DB_ID, 'notifications', 'subject',    { size:200 });
  await attr('string',  DB_ID, 'notifications', 'body',       { size:5000 });
  await attr('string',  DB_ID, 'notifications', 'recipients', { size:200 }); // JSON
  await attr('string',  DB_ID, 'notifications', 'status',     { size:20, default:'sent' });
  await attr('integer', DB_ID, 'notifications', 'count',      { default:0 });
  await attr('string',  DB_ID, 'notifications', 'sentAt',     { size:30 });
  await attr('string',  DB_ID, 'notifications', 'sentBy',     { size:50 });

  // CERTIFICATES
  console.log('\n📜 Creating collection: certificates');
  await safe(() => databases.createCollection(DB_ID, 'certificates', 'Certificates', PERMS), 'Collection: certificates');
  await attr('string',  DB_ID, 'certificates', 'candidateId',   { size:50, required:true });
  await attr('string',  DB_ID, 'certificates', 'candidateName', { size:200 });
  await attr('string',  DB_ID, 'certificates', 'examId',        { size:50, required:true });
  await attr('string',  DB_ID, 'certificates', 'examName',      { size:200 });
  await attr('integer', DB_ID, 'certificates', 'score',         { default:0 });
  await attr('string',  DB_ID, 'certificates', 'grade',         { size:5 });
  await attr('string',  DB_ID, 'certificates', 'pdfUrl',        { size:500 });
  await attr('string',  DB_ID, 'certificates', 'qrCode',        { size:200 });
  await attr('string',  DB_ID, 'certificates', 'issuedAt',      { size:30 });
  await attr('string',  DB_ID, 'certificates', 'verifyCode',    { size:50 });
  await idx(DB_ID, 'certificates', 'idx_candidateId', 'key',    ['candidateId'], ['ASC']);
  await idx(DB_ID, 'certificates', 'idx_verifyCode',  'unique', ['verifyCode'],  ['ASC']);

  // SYSTEM SETTINGS (single doc: id='global')
  console.log('\n⚙️  Creating collection: system_settings');
  await safe(() => databases.createCollection(DB_ID, 'system_settings', 'System Settings', PERMS), 'Collection: system_settings');
  await attr('string',  DB_ID, 'system_settings', 'platformName',          { size:200, default:'SOFTLY DIGITAL V3' });
  await attr('integer', DB_ID, 'system_settings', 'passingPercentage',     { default:70 });
  await attr('integer', DB_ID, 'system_settings', 'sessionTimeout',        { default:60 });
  await attr('integer', DB_ID, 'system_settings', 'maxViolations',         { default:3 });
  await attr('integer', DB_ID, 'system_settings', 'autoSaveInterval',      { default:5 });
  await attr('integer', DB_ID, 'system_settings', 'syncInterval',          { default:30 });
  await attr('boolean', DB_ID, 'system_settings', 'autoLockFailedLogins',  { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'deviceVerification',    { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'tabSwitchDetection',    { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'fullscreenEnforce',     { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'devtoolsDetection',     { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'copyPasteDetect',       { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'singleActiveSession',   { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'botDetection',          { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'autoCertificate',       { default:true });
  await attr('boolean', DB_ID, 'system_settings', 'certQrCode',            { default:true });
  await attr('integer', DB_ID, 'system_settings', 'certMinScore',          { default:70 });
  await attr('string',  DB_ID, 'system_settings', 'openaiApiKey',          { size:200 });
  await attr('string',  DB_ID, 'system_settings', 'openaiModel',           { size:50, default:'gpt-4o-mini' });
  await attr('string',  DB_ID, 'system_settings', 'smtpHost',              { size:200 });
  await attr('integer', DB_ID, 'system_settings', 'smtpPort',              { default:587 });
  await attr('string',  DB_ID, 'system_settings', 'fromEmail',             { size:200 });
  await attr('string',  DB_ID, 'system_settings', 'smsProvider',           { size:50, default:'termii' });
  await attr('string',  DB_ID, 'system_settings', 'updatedAt',             { size:30 });

  // ── 3. Seed Super Admin ────────────────────────────────────────────
  console.log('\n🔐 Creating Super Admin account…');
  const users = new sdk.Users(client);
  try {
    const sa = await users.create(sdk.ID.unique(), 'superadmin@softlydigital.com', '+2348000000000', 'SuperAdmin@2025!', 'Super Administrator');
    await databases.createDocument(DB_ID, 'users', sa.$id, {
      fullName:  'Super Administrator',
      email:     'superadmin@softlydigital.com',
      role:      'superadmin',
      status:    'active',
      createdAt: new Date().toISOString(),
    });
    console.log('  ✅ Super Admin created: superadmin@softlydigital.com / SuperAdmin@2025!');
    console.log('  ⚠️  CHANGE THIS PASSWORD IMMEDIATELY after first login!');
  } catch(e) {
    if (e.code === 409) console.log('  ⏭️  Super Admin already exists');
    else console.error('  ❌ Super Admin creation failed:', e.message);
  }

  // ── 4. Seed default settings ───────────────────────────────────────
  console.log('\n⚙️  Seeding default settings…');
  await safe(
    () => databases.createDocument(DB_ID, 'system_settings', 'global', {
      platformName: 'SOFTLY DIGITAL V3',
      passingPercentage: 70,
      sessionTimeout: 60,
      maxViolations: 3,
      autoSaveInterval: 5,
      syncInterval: 30,
      autoCertificate: true,
      certQrCode: true,
      certMinScore: 70,
      openaiModel: 'gpt-4o-mini',
      updatedAt: new Date().toISOString(),
    }),
    'Default settings document'
  );

  console.log('\n\n🎉 Setup complete!\n');
  console.log('📋 Summary:');
  console.log('   Database ID : cbt-main');
  console.log('   Collections : users, centres, candidates, subjects, topics,');
  console.log('                 exams, questions, exam_sessions, submissions,');
  console.log('                 results, violations, audit_logs, notifications,');
  console.log('                 certificates, system_settings');
  console.log('\n🔑 Super Admin Login:');
  console.log('   URL      : /html/admin-login.html');
  console.log('   Email    : superadmin@softlydigital.com');
  console.log('   Password : SuperAdmin@2025!  ← CHANGE THIS NOW');
  console.log('\n🌩️  Cloudinary:');
  console.log('   Set your cloud name and unsigned upload preset in appwrite-config.js');
  console.log('   CLOUDINARY_CLOUD  = your-cloud-name');
  console.log('   CLOUDINARY_PRESET = cbt_softly_unsigned  (create in Cloudinary dashboard)');
  console.log('\n✅ You are ready to go!\n');
}

main().catch(e => {
  console.error('\n💥 Setup failed:', e.message);
  process.exit(1);
});
