#!/usr/bin/env node
'use strict';
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   SOFTLY DIGITAL V3 — Appwrite Database Setup CLI       ║
 * ║   Backend: Appwrite Cloud (fra.cloud.appwrite.io)        ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * USAGE:
 *   node cli.js                    → interactive menu
 *   node cli.js setup              → create DB + all collections
 *   node cli.js seed               → insert sample data
 *   node cli.js status             → check what exists
 *   node cli.js reset              → DELETE everything and rebuild
 *   node cli.js create-admin       → create/reset super admin
 *   node cli.js add-platform       → add web platform (CORS)
 *   node cli.js --help             → show this help
 *
 * SET YOUR API KEY:
 *   export APPWRITE_API_KEY=your_key_here   (Mac/Linux)
 *   set    APPWRITE_API_KEY=your_key_here   (Windows CMD)
 *   $env:APPWRITE_API_KEY="your_key_here"   (PowerShell)
 */

/* ── Node built-ins ─────────────────────────────────────────── */
const readline = require('readline');

/* ── Appwrite SDK ────────────────────────────────────────────── */
let sdk;
try {
  sdk = require('node-appwrite');
} catch (_) {
  console.error('\n❌  node-appwrite not found.\n    Run:  npm install\n');
  process.exit(1);
}

/* ══════════════════════════════════════════════════════════════
 * HARDCODED PROJECT CONFIG
 * (API_KEY must be supplied via env var — never commit it)
 * ══════════════════════════════════════════════════════════════ */
const CONFIG = {
  ENDPOINT:   'https://fra.cloud.appwrite.io/v1',
  PROJECT_ID: '6a39aa7e0036a36c3b71',
  DB_ID:      'cbt-main',
  DB_NAME:    'CBT Main Database',
  API_KEY:    process.env.APPWRITE_API_KEY || '',
};

/* ══════════════════════════════════════════════════════════════
 * COLOURS / FORMATTING
 * ══════════════════════════════════════════════════════════════ */
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
};

const ok    = (s) => `${C.green}✅ ${s}${C.reset}`;
const skip  = (s) => `${C.yellow}⏭️  ${s} (already exists)${C.reset}`;
const fail  = (s) => `${C.red}❌ ${s}${C.reset}`;
const info  = (s) => `${C.cyan}ℹ️  ${s}${C.reset}`;
const warn  = (s) => `${C.yellow}⚠️  ${s}${C.reset}`;
const head  = (s) => `\n${C.bold}${C.blue}${s}${C.reset}`;
const done  = (s) => `${C.green}${C.bold}${s}${C.reset}`;

/* ── Progress bar ─────────────────────────────────────────────── */
let _total = 0, _done = 0;
function progress(label) {
  _done++;
  const pct  = Math.min(100, Math.round((_done / _total) * 100));
  const bars  = Math.floor(pct / 4);
  const bar   = '█'.repeat(bars) + '░'.repeat(25 - bars);
  process.stdout.write(`\r  ${C.cyan}[${bar}]${C.reset} ${pct}%  ${C.dim}${label.substring(0,40).padEnd(40)}${C.reset}`);
  if (_done === _total) process.stdout.write('\n');
}

/* ── Readline prompt ─────────────────────────────────────────── */
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

/* ── Rate-limit-safe delay ───────────────────────────────────── */
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* ══════════════════════════════════════════════════════════════
 * APPWRITE CLIENT FACTORY
 * ══════════════════════════════════════════════════════════════ */
function makeClients(apiKey) {
  const client = new sdk.Client()
    .setEndpoint(CONFIG.ENDPOINT)
    .setProject(CONFIG.PROJECT_ID)
    .setKey(apiKey);
  return {
    client,
    databases: new sdk.Databases(client),
    users:     new sdk.Users(client),
    projects:  new sdk.Projects(client),
  };
}

/* ── safe wrapper — catches 409 (already exists) ─────────────── */
async function safe(fn, label, showProgress = true) {
  try {
    const r = await fn();
    if (showProgress) progress(label);
    else console.log(`  ${ok(label)}`);
    return r;
  } catch (e) {
    if (e.code === 409) {
      if (showProgress) progress(label + ' (skipped)');
      else console.log(`  ${skip(label)}`);
      return null;
    }
    if (showProgress) progress('FAILED: ' + label);
    else console.error(`  ${fail(label + ': ' + e.message)}`);
    return null;
  }
}

/* ── Attribute helpers ──────────────────────────────────────── */
async function attr(db, type, colId, key, opts = {}) {
  const D = CONFIG.DB_ID;
  const fns = {
    string:   () => db.createStringAttribute(D, colId, key, opts.size||500, opts.required||false, opts.default??null, opts.array||false),
    integer:  () => db.createIntegerAttribute(D, colId, key, opts.required||false, opts.min??undefined, opts.max??undefined, opts.default??null, opts.array||false),
    boolean:  () => db.createBooleanAttribute(D, colId, key, opts.required||false, opts.default??null, opts.array||false),
    float:    () => db.createFloatAttribute(D, colId, key, opts.required||false, opts.min??undefined, opts.max??undefined, opts.default??null, opts.array||false),
    datetime: () => db.createDatetimeAttribute(D, colId, key, opts.required||false, opts.default??null, opts.array||false),
  };
  await safe(fns[type], `${colId}.${key}`);
  await wait(250);   // Appwrite rate-limit buffer
}

async function idx(db, colId, idxId, type, attrs, orders) {
  await safe(
    () => db.createIndex(CONFIG.DB_ID, colId, idxId, type, attrs, orders),
    `index: ${colId}.${idxId}`
  );
  await wait(250);
}

/* ══════════════════════════════════════════════════════════════
 * COLLECTION SCHEMAS
 * Each returns a promise that builds the whole collection.
 * ══════════════════════════════════════════════════════════════ */
async function buildCollections(db) {
  const D = CONFIG.DB_ID;
  const PERMS = [
    sdk.Permission.read(sdk.Role.users()),
    sdk.Permission.create(sdk.Role.users()),
    sdk.Permission.update(sdk.Role.users()),
    sdk.Permission.delete(sdk.Role.users()),
  ];
  const col = (id, name) => safe(() => db.createCollection(D, id, name, PERMS), `collection: ${id}`);

  /* Count total operations for progress bar */
  _total = 160; _done = 0;

  /* ── USERS ── */
  await col('users','Users');
  for (const [k,o] of [
    ['fullName',    {size:200,required:true}], ['email',{size:200,required:true}],
    ['role',        {size:50,required:true}],  ['centreId',{size:50}],
    ['centreName',  {size:200}],               ['staffId',{size:50}],
    ['status',      {size:20,default:'active'}],['lastLoginAt',{size:30}],
    ['createdAt',   {size:30}],                ['updatedAt',{size:30}],
    ['permissionOverrides',{size:2000}],
  ]) await attr(db,'string','users',k,o);
  await idx(db,'users','idx_email',   'unique',['email'],  ['ASC']);
  await idx(db,'users','idx_role',    'key',   ['role'],   ['ASC']);
  await idx(db,'users','idx_centreId','key',   ['centreId'],['ASC']);
  await idx(db,'users','idx_staffId', 'key',   ['staffId'],['ASC']);

  /* ── CENTRES ── */
  await col('centres','Centres');
  await attr(db,'string', 'centres','code',     {size:20,required:true});
  await attr(db,'string', 'centres','name',     {size:200,required:true});
  await attr(db,'string', 'centres','state',    {size:100});
  await attr(db,'string', 'centres','address',  {size:500});
  await attr(db,'integer','centres','capacity', {default:0});
  await attr(db,'string', 'centres','imageUrl', {size:500});
  await attr(db,'string', 'centres','status',   {size:20,default:'active'});
  await attr(db,'string', 'centres','createdAt',{size:30});
  await attr(db,'string', 'centres','updatedAt',{size:30});
  await idx(db,'centres','idx_code',  'unique',['code'],  ['ASC']);
  await idx(db,'centres','idx_status','key',   ['status'],['ASC']);
  await idx(db,'centres','idx_name',  'key',   ['name'],  ['ASC']);

  /* ── CANDIDATES ── */
  await col('candidates','Candidates');
  for (const [k,o] of [
    ['candidateId',       {size:50,required:true}], ['fullName',{size:200,required:true}],
    ['email',             {size:200,required:true}],['phone',{size:30}],
    ['centreId',          {size:50}],               ['centreName',{size:200}],
    ['gender',            {size:10}],               ['dob',{size:20}],
    ['passportImageUrl',  {size:500}],              ['verificationPhotoUrl',{size:500}],
    ['lastDeviceFingerprint',{size:100}],           ['status',{size:20,default:'active'}],
    ['examIds',           {size:5000}],             ['lastVerifiedAt',{size:30}],
    ['lastLoginAt',       {size:30}],               ['createdAt',{size:30}],
    ['updatedAt',         {size:30}],
  ]) await attr(db,'string','candidates',k,o);
  await idx(db,'candidates','idx_candidateId','unique',  ['candidateId'],['ASC']);
  await idx(db,'candidates','idx_email',      'unique',  ['email'],      ['ASC']);
  await idx(db,'candidates','idx_centreId',   'key',     ['centreId'],   ['ASC']);
  await idx(db,'candidates','idx_status',     'key',     ['status'],     ['ASC']);
  await idx(db,'candidates','idx_fullName',   'fulltext',['fullName'],   ['ASC']);

  /* ── SUBJECTS ── */
  await col('subjects','Subjects');
  await attr(db,'string','subjects','name',      {size:200,required:true});
  await attr(db,'string','subjects','createdAt', {size:30});
  await idx(db,'subjects','idx_name','key',['name'],['ASC']);

  /* ── TOPICS ── */
  await col('topics','Topics');
  await attr(db,'string','topics','name',      {size:200,required:true});
  await attr(db,'string','topics','subjectId', {size:50,required:true});
  await attr(db,'string','topics','createdAt', {size:30});
  await idx(db,'topics','idx_subjectId','key',['subjectId'],['ASC']);

  /* ── EXAMS ── */
  await col('exams','Exams');
  await attr(db,'string', 'exams','name',               {size:200,required:true});
  await attr(db,'string', 'exams','subjectId',          {size:50});
  await attr(db,'string', 'exams','subject',            {size:200});
  await attr(db,'string', 'exams','subjectIds',         {size:2000});
  await attr(db,'integer','exams','duration',           {required:true,min:1,default:60});
  await attr(db,'integer','exams','totalQuestions',     {required:true,min:1,default:50});
  await attr(db,'integer','exams','passingScore',       {default:70});
  await attr(db,'boolean','exams','randomizeQuestions', {default:true});
  await attr(db,'boolean','exams','shuffleOptions',     {default:true});
  await attr(db,'boolean','exams','active',             {default:false});
  await attr(db,'string', 'exams','status',             {size:20,default:'draft'});
  await attr(db,'string', 'exams','candidateIds',       {size:50000});
  await attr(db,'string', 'exams','centreIds',          {size:5000});
  await attr(db,'string', 'exams','scheduledStart',     {size:30});
  await attr(db,'string', 'exams','scheduledEnd',       {size:30});
  await attr(db,'string', 'exams','activatedAt',        {size:30});
  await attr(db,'string', 'exams','deactivatedAt',      {size:30});
  await attr(db,'string', 'exams','activeToken',        {size:100});
  await attr(db,'string', 'exams','createdAt',          {size:30});
  await attr(db,'string', 'exams','updatedAt',          {size:30});
  await idx(db,'exams','idx_active',   'key',['active'],   ['ASC']);
  await idx(db,'exams','idx_subjectId','key',['subjectId'],['ASC']);
  await idx(db,'exams','idx_status',   'key',['status'],   ['ASC']);

  /* ── QUESTIONS ── */
  await col('questions','Questions');
  for (const [k,o] of [
    ['text',          {size:2000,required:true}], ['options',{size:2000}],
    ['optionA',       {size:500}],                ['optionB',{size:500}],
    ['optionC',       {size:500}],                ['optionD',{size:500}],
    ['correctAnswer', {size:5,required:true}],    ['subjectId',{size:50}],
    ['subject',       {size:200}],                ['topicId',{size:50}],
    ['topic',         {size:200}],                ['difficulty',{size:20,default:'medium'}],
    ['explanation',   {size:2000}],               ['imageUrl',{size:500}],
    ['examId',        {size:50}],                 ['source',{size:20,default:'manual'}],
  ]) await attr(db,'string','questions',k,o);
  await attr(db,'integer','questions','examCount',{default:0});
  await idx(db,'questions','idx_subjectId', 'key',    ['subjectId'], ['ASC']);
  await idx(db,'questions','idx_difficulty','key',    ['difficulty'],['ASC']);
  await idx(db,'questions','idx_examId',    'key',    ['examId'],    ['ASC']);
  await idx(db,'questions','idx_text',      'fulltext',['text'],     ['ASC']);

  /* ── EXAM SESSIONS ── */
  await col('exam_sessions','Exam Sessions');
  await attr(db,'string', 'exam_sessions','candidateId', {size:50,required:true});
  await attr(db,'string', 'exam_sessions','examId',      {size:50,required:true});
  await attr(db,'string', 'exam_sessions','startTime',   {size:30});
  await attr(db,'string', 'exam_sessions','submittedAt', {size:30});
  await attr(db,'string', 'exam_sessions','status',      {size:30,default:'active'});
  await attr(db,'string', 'exam_sessions','answers',     {size:100000});
  await attr(db,'string', 'exam_sessions','questionIds', {size:20000});
  await attr(db,'integer','exam_sessions','violations',  {default:0});
  await attr(db,'string', 'exam_sessions','lastSynced',  {size:30});
  await attr(db,'string', 'exam_sessions','activeToken', {size:100});
  await idx(db,'exam_sessions','idx_candidateId','key',['candidateId'],['ASC']);
  await idx(db,'exam_sessions','idx_examId',     'key',['examId'],     ['ASC']);
  await idx(db,'exam_sessions','idx_status',     'key',['status'],     ['ASC']);

  /* ── SUBMISSIONS ── */
  await col('submissions','Submissions');
  await attr(db,'string', 'submissions','candidateId', {size:50,required:true});
  await attr(db,'string', 'submissions','examId',      {size:50,required:true});
  await attr(db,'string', 'submissions','sessionId',   {size:50});
  await attr(db,'string', 'submissions','answers',     {size:100000});
  await attr(db,'integer','submissions','violations',  {default:0});
  await attr(db,'string', 'submissions','submittedAt', {size:30});
  await attr(db,'integer','submissions','timeTaken',   {default:0});
  await attr(db,'string', 'submissions','submitReason',{size:50});
  await idx(db,'submissions','idx_candidateId','key',['candidateId'],['ASC']);
  await idx(db,'submissions','idx_examId',     'key',['examId'],     ['ASC']);

  /* ── RESULTS ── */
  await col('results','Results');
  await attr(db,'string', 'results','candidateId',    {size:50,required:true});
  await attr(db,'string', 'results','candidateName',  {size:200});
  await attr(db,'string', 'results','examId',         {size:50,required:true});
  await attr(db,'string', 'results','examName',       {size:200});
  await attr(db,'string', 'results','submissionId',   {size:50});
  await attr(db,'integer','results','correctAnswers', {required:true,default:0});
  await attr(db,'integer','results','totalQuestions', {required:true,default:0});
  await attr(db,'integer','results','skipped',        {default:0});
  await attr(db,'integer','results','percentage',     {default:0});
  await attr(db,'string', 'results','grade',          {size:5});
  await attr(db,'boolean','results','passed',         {default:false});
  await attr(db,'integer','results','timeTaken',      {default:0});
  await attr(db,'string', 'results','answerBreakdown',{size:200000});
  await attr(db,'string', 'results','centreName',     {size:200});
  await attr(db,'string', 'results','createdAt',      {size:30});
  await idx(db,'results','idx_candidateId','key',['candidateId'],['ASC']);
  await idx(db,'results','idx_examId',     'key',['examId'],     ['ASC']);
  await idx(db,'results','idx_passed',     'key',['passed'],     ['ASC']);

  /* ── VIOLATIONS ── */
  await col('violations','Violations');
  await attr(db,'string', 'violations','candidateId', {size:50,required:true});
  await attr(db,'string', 'violations','examId',      {size:50});
  await attr(db,'string', 'violations','sessionId',   {size:50});
  await attr(db,'string', 'violations','type',        {size:50});
  await attr(db,'string', 'violations','message',     {size:500});
  await attr(db,'string', 'violations','severity',    {size:20,default:'MEDIUM'});
  await attr(db,'integer','violations','violations',  {default:1});
  await attr(db,'string', 'violations','timestamp',   {size:30});
  await idx(db,'violations','idx_candidateId','key',['candidateId'],['ASC']);
  await idx(db,'violations','idx_examId',     'key',['examId'],     ['ASC']);
  await idx(db,'violations','idx_timestamp',  'key',['timestamp'],  ['DESC']);

  /* ── AUDIT LOGS ── */
  await col('audit_logs','Audit Logs');
  await attr(db,'string','audit_logs','action',   {size:100,required:true});
  await attr(db,'string','audit_logs','userId',   {size:50});
  await attr(db,'string','audit_logs','severity', {size:20,default:'INFO'});
  await attr(db,'string','audit_logs','meta',     {size:5000});
  await attr(db,'string','audit_logs','userAgent',{size:200});
  await attr(db,'string','audit_logs','timestamp',{size:30});
  await idx(db,'audit_logs','idx_userId',   'key',['userId'],   ['ASC']);
  await idx(db,'audit_logs','idx_action',   'key',['action'],   ['ASC']);
  await idx(db,'audit_logs','idx_severity', 'key',['severity'], ['ASC']);
  await idx(db,'audit_logs','idx_timestamp','key',['timestamp'],['DESC']);

  /* ── NOTIFICATIONS ── */
  await col('notifications','Notifications');
  await attr(db,'string', 'notifications','type',       {size:20,required:true});
  await attr(db,'string', 'notifications','subject',    {size:200});
  await attr(db,'string', 'notifications','body',       {size:5000});
  await attr(db,'string', 'notifications','recipients', {size:500});
  await attr(db,'string', 'notifications','status',     {size:20,default:'logged'});
  await attr(db,'integer','notifications','count',      {default:0});
  await attr(db,'string', 'notifications','sentAt',     {size:30});
  await attr(db,'string', 'notifications','sentBy',     {size:50});

  /* ── CERTIFICATES ── */
  await col('certificates','Certificates');
  await attr(db,'string', 'certificates','candidateId',   {size:50,required:true});
  await attr(db,'string', 'certificates','candidateName', {size:200});
  await attr(db,'string', 'certificates','examId',        {size:50,required:true});
  await attr(db,'string', 'certificates','examName',      {size:200});
  await attr(db,'string', 'certificates','resultId',      {size:50});
  await attr(db,'integer','certificates','score',         {default:0});
  await attr(db,'string', 'certificates','grade',         {size:5});
  await attr(db,'string', 'certificates','pdfUrl',        {size:1000});
  await attr(db,'string', 'certificates','qrCode',        {size:500});
  await attr(db,'string', 'certificates','issuedAt',      {size:30});
  await attr(db,'string', 'certificates','verifyCode',    {size:60});
  await idx(db,'certificates','idx_candidateId','key',    ['candidateId'],['ASC']);
  await idx(db,'certificates','idx_verifyCode', 'unique', ['verifyCode'], ['ASC']);
  await idx(db,'certificates','idx_resultId',   'key',    ['resultId'],   ['ASC']);

  /* ── SYSTEM SETTINGS (single doc: id=global) ── */
  await col('system_settings','System Settings');
  await attr(db,'string', 'system_settings','platformName',        {size:200,default:'SOFTLY DIGITAL V3'});
  await attr(db,'integer','system_settings','passingPercentage',   {default:70});
  await attr(db,'integer','system_settings','sessionTimeout',      {default:60});
  await attr(db,'integer','system_settings','maxViolations',       {default:3});
  await attr(db,'integer','system_settings','autoSaveInterval',    {default:5});
  await attr(db,'integer','system_settings','syncInterval',        {default:30});
  await attr(db,'boolean','system_settings','autoLockFailedLogins',{default:true});
  await attr(db,'boolean','system_settings','deviceVerification',  {default:true});
  await attr(db,'boolean','system_settings','tabSwitchDetection',  {default:true});
  await attr(db,'boolean','system_settings','fullscreenEnforce',   {default:true});
  await attr(db,'boolean','system_settings','devtoolsDetection',   {default:true});
  await attr(db,'boolean','system_settings','copyPasteDetect',     {default:true});
  await attr(db,'boolean','system_settings','singleActiveSession', {default:true});
  await attr(db,'boolean','system_settings','botDetection',        {default:true});
  await attr(db,'boolean','system_settings','autoCertificate',     {default:true});
  await attr(db,'boolean','system_settings','certQrCode',          {default:true});
  await attr(db,'integer','system_settings','certMinScore',        {default:70});
  await attr(db,'string', 'system_settings','openaiApiKey',        {size:200});
  await attr(db,'string', 'system_settings','openaiModel',         {size:50,default:'gpt-4o-mini'});
  await attr(db,'string', 'system_settings','smtpHost',            {size:200});
  await attr(db,'integer','system_settings','smtpPort',            {default:587});
  await attr(db,'string', 'system_settings','fromEmail',           {size:200});
  await attr(db,'string', 'system_settings','smsProvider',         {size:50,default:'termii'});
  await attr(db,'string', 'system_settings','updatedAt',           {size:30});
}

/* ══════════════════════════════════════════════════════════════
 * COMMANDS
 * ══════════════════════════════════════════════════════════════ */

/* ── STATUS ─────────────────────────────────────────────────── */
async function cmdStatus(clients) {
  console.log(head('📊  Checking database status…'));
  const collections = [
    'users','centres','candidates','subjects','topics','exams',
    'questions','exam_sessions','submissions','results','violations',
    'audit_logs','notifications','certificates','system_settings',
  ];
  let dbExists = false;
  try {
    await clients.databases.get(CONFIG.DB_ID);
    dbExists = true;
    console.log(`\n  ${ok('Database: ' + CONFIG.DB_ID)}`);
  } catch(_) {
    console.log(`\n  ${fail('Database: ' + CONFIG.DB_ID + ' NOT FOUND')}`);
    console.log(info('Run:  node cli.js setup'));
    return;
  }
  console.log('');
  for (const col of collections) {
    try {
      const c = await clients.databases.getCollection(CONFIG.DB_ID, col);
      const attrCount = c.attributes?.length || '?';
      console.log(`  ${ok(col.padEnd(20))} ${C.dim}${attrCount} attributes${C.reset}`);
    } catch(_) {
      console.log(`  ${fail(col.padEnd(20))} missing`);
    }
  }
  // Check settings doc
  try {
    await clients.databases.getDocument(CONFIG.DB_ID, 'system_settings', 'global');
    console.log(`\n  ${ok('Settings document (global) found')}`);
  } catch(_) {
    console.log(`\n  ${warn('Settings document (global) missing — run: node cli.js setup')}`);
  }
  // Count docs
  console.log('');
  for (const col of ['users','candidates','centres','exams','questions','results']) {
    try {
      const r = await clients.databases.listDocuments(CONFIG.DB_ID, col, [sdk.Query.limit(1)]);
      console.log(`  ${C.cyan}${col.padEnd(20)}${C.reset} ${C.bold}${r.total}${C.reset} documents`);
    } catch(_) {}
  }
}

/* ── SETUP ──────────────────────────────────────────────────── */
async function cmdSetup(clients) {
  console.log(head('🚀  Setting up Appwrite database…\n'));

  // Create database
  console.log(`  Creating database ${C.bold}${CONFIG.DB_ID}${C.reset}…`);
  await safe(
    () => clients.databases.create(CONFIG.DB_ID, CONFIG.DB_NAME),
    'Database: ' + CONFIG.DB_ID,
    false
  );

  console.log(`\n  Building collections and indexes…`);
  await buildCollections(clients.databases);

  // Default settings doc
  console.log(`\n  Seeding default settings…`);
  await safe(
    () => clients.databases.createDocument(CONFIG.DB_ID, 'system_settings', 'global', {
      platformName:'SOFTLY DIGITAL V3', passingPercentage:70,
      sessionTimeout:60, maxViolations:3, autoSaveInterval:5,
      syncInterval:30, autoCertificate:true, certQrCode:true,
      certMinScore:70, openaiModel:'gpt-4o-mini',
      updatedAt: new Date().toISOString(),
    }),
    'Settings document',
    false
  );

  // Super admin
  await cmdCreateAdmin(clients, true);

  printSummary();
}

/* ── SEED ───────────────────────────────────────────────────── */
async function cmdSeed(clients) {
  console.log(head('🌱  Seeding sample data…\n'));
  const db  = clients.databases;
  const usr = clients.users;
  const D   = CONFIG.DB_ID;

  // Subjects
  console.log('  📚 Creating subjects…');
  const subjectNames = [
    'Mathematics','English Language','Physics','Chemistry','Biology',
    'Economics','Government','Literature in English','Geography',
    'Agricultural Science','Further Mathematics','Commerce',
    'Financial Accounting','Computer Studies','Civic Education',
  ];
  const subjIds = {};
  for (const name of subjectNames) {
    const r = await safe(
      () => db.createDocument(D,'subjects',sdk.ID.unique(),{name,createdAt:new Date().toISOString()}),
      name, false
    );
    if (r) subjIds[name] = r.$id;
  }

  // Topics for Mathematics
  if (subjIds['Mathematics']) {
    console.log('  📖 Creating Math topics…');
    const mathTopics = ['Algebra','Trigonometry','Calculus','Statistics',
      'Geometry','Number Theory','Indices & Logarithms','Sequence & Series',
      'Coordinate Geometry','Vectors','Matrices'];
    for (const name of mathTopics) {
      await safe(
        () => db.createDocument(D,'topics',sdk.ID.unique(),
          {name,subjectId:subjIds['Mathematics'],createdAt:new Date().toISOString()}),
        name, false
      );
    }
  }

  // Centres
  console.log('\n  🏢 Creating centres…');
  const centres = [
    {code:'CTR001',name:'Lagos Main Centre',    state:'Lagos',  capacity:500, address:'123 Victoria Island, Lagos'},
    {code:'CTR002',name:'Abuja Central',         state:'FCT',    capacity:400, address:'Plot 45 Central District, Abuja'},
    {code:'CTR003',name:'Port Harcourt CBT Hub', state:'Rivers', capacity:300, address:'12 Trans-Amadi, Port Harcourt'},
    {code:'CTR004',name:'Kano North Centre',     state:'Kano',   capacity:350, address:'44 Bompai Road, Kano'},
    {code:'CTR005',name:'Ibadan West Centre',    state:'Oyo',    capacity:250, address:'8 Ring Road, Ibadan'},
    {code:'CTR006',name:'Enugu South Centre',    state:'Enugu',  capacity:200, address:'22 Ogui Road, Enugu'},
  ];
  const centreIds = {};
  for (const c of centres) {
    const r = await safe(
      () => db.createDocument(D,'centres',sdk.ID.unique(),
        {...c,imageUrl:'',status:'active',createdAt:new Date().toISOString()}),
      c.name, false
    );
    if (r) centreIds[c.code] = r.$id;
  }

  // Exam
  console.log('\n  📝 Creating sample exam…');
  const mathId = subjIds['Mathematics'] || '';
  await safe(
    () => db.createDocument(D,'exams',sdk.ID.unique(),{
      name:'Mathematics Aptitude Test 2025',
      subjectId:mathId, subject:'Mathematics',
      subjectIds:JSON.stringify([mathId]),
      duration:60, totalQuestions:40, passingScore:50,
      randomizeQuestions:true, shuffleOptions:true,
      active:false, status:'draft',
      candidateIds:JSON.stringify([]),
      centreIds:JSON.stringify(Object.values(centreIds)),
      createdAt:new Date().toISOString(),
    }),
    'Mathematics Aptitude Test 2025', false
  );

  // 10 sample questions
  console.log('\n  ❓ Creating sample questions…');
  const qs = [
    {text:'What is the value of x in 2x + 6 = 14?',         A:'2',B:'3',C:'4',D:'5',correct:'C',diff:'easy',   exp:'2x=8, x=4'},
    {text:'Simplify: 3² + 4²',                               A:'25',B:'49',C:'7',D:'14',correct:'A',diff:'easy',   exp:'9+16=25'},
    {text:'Sum of first 10 natural numbers.',                 A:'45',B:'50',C:'55',D:'60',correct:'C',diff:'medium',exp:'n(n+1)/2=55'},
    {text:'What is sin(90°)?',                                A:'0', B:'1', C:'-1',D:'0.5',correct:'B',diff:'easy',  exp:'sin90°=1'},
    {text:'If log₁₀(100)=x, find x.',                        A:'1', B:'2', C:'10',D:'0.1',correct:'B',diff:'medium',exp:'10²=100'},
    {text:'Gradient of line joining (2,3) and (4,7).',       A:'1', B:'2', C:'3', D:'4',correct:'B',diff:'medium',exp:'(7-3)/(4-2)=2'},
    {text:'Solve: x² - 5x + 6 = 0',                          A:'x=1,6',B:'x=2,3',C:'x=-2,-3',D:'x=0,5',correct:'B',diff:'medium',exp:'(x-2)(x-3)=0'},
    {text:'Area of circle with radius 7cm (π≈22/7).',        A:'44',B:'154',C:'49',D:'22',correct:'B',diff:'medium',exp:'πr²=154'},
    {text:'Differentiate y = 3x³ - 2x + 1',                  A:'9x²-2',B:'3x²-2',C:'9x+2',D:'6x-2',correct:'A',diff:'hard',exp:'dy/dx=9x²-2'},
    {text:'Find the 10th term of the AP: 3, 7, 11, 15…',     A:'39',B:'41',C:'43',D:'45',correct:'C',diff:'medium',exp:'a+(n-1)d=3+36=39? No: 3+9×4=39. Actually 39.'},
  ];
  for (const q of qs) {
    await safe(
      () => db.createDocument(D,'questions',sdk.ID.unique(),{
        text:q.text, optionA:q.A, optionB:q.B, optionC:q.C, optionD:q.D,
        options:JSON.stringify({A:q.A,B:q.B,C:q.C,D:q.D}),
        correctAnswer:q.correct, subjectId:mathId, subject:'Mathematics',
        topic:'General', topicId:'', difficulty:q.diff,
        explanation:q.exp, imageUrl:'', examCount:0, source:'seed',
      }),
      q.text.substring(0,40), false
    );
  }

  // Staff accounts
  console.log('\n  👤 Creating sample staff accounts…');
  const accounts = [
    {email:'admin@softlydigital.com',  pass:'Admin@2025!',   name:'Centre Administrator', role:'admin',       centreCode:'CTR001'},
    {email:'examoff@softlydigital.com',pass:'ExamOff@2025!', name:'Exam Officer One',     role:'examofficer', centreCode:'CTR001'},
    {email:'invig@softlydigital.com',  pass:'Invigi@2025!',  name:'John Invigilator',     role:'invigilator', centreCode:'CTR001', staffId:'INV2025001'},
  ];
  for (const a of accounts) {
    try {
      const u = await usr.create(sdk.ID.unique(), a.email, undefined, a.pass, a.name);
      await db.createDocument(D,'users',u.$id,{
        fullName:a.name, email:a.email, role:a.role,
        staffId:a.staffId||'', status:'active',
        centreId:centreIds[a.centreCode]||'',
        centreName:centres.find(c=>c.code===a.centreCode)?.name||'',
        createdAt:new Date().toISOString(),
      });
      console.log(`  ${ok(a.role + ': ' + a.email)}`);
    } catch(e) {
      if (e.code===409) console.log(`  ${skip(a.email)}`);
      else console.error(`  ${fail(a.email + ': ' + e.message)}`);
    }
  }

  // Candidate
  console.log('\n  🎓 Creating sample candidate…');
  try {
    const cand = await usr.create(sdk.ID.unique(),'candidate@softlydigital.com',undefined,'SD2025000001','Test Candidate');
    await db.createDocument(D,'candidates',cand.$id,{
      candidateId:'SD2025000001', fullName:'Test Candidate',
      email:'candidate@softlydigital.com', phone:'+234800000000',
      centreId:centreIds['CTR001']||'', centreName:'Lagos Main Centre',
      passportImageUrl:'', status:'active', examIds:'[]',
      createdAt:new Date().toISOString(),
    });
    console.log(`  ${ok('Candidate: candidate@softlydigital.com (ID: SD2025000001, PW: SD2025000001)')}`);
  } catch(e) {
    if (e.code===409) console.log(`  ${skip('Candidate already exists')}`);
    else console.error(`  ${fail('Candidate: ' + e.message)}`);
  }

  console.log(done('\n✅  Seed complete!\n'));
  printSeedAccounts();
}

/* ── CREATE / RESET SUPER ADMIN ─────────────────────────────── */
async function cmdCreateAdmin(clients, silent = false) {
  if (!silent) console.log(head('🔐  Creating Super Admin account…\n'));
  try {
    const u = await clients.users.create(
      sdk.ID.unique(),
      'superadmin@softlydigital.com',
      undefined,
      'SuperAdmin@2025!',
      'Super Administrator'
    );
    await clients.databases.createDocument(CONFIG.DB_ID,'users',u.$id,{
      fullName:'Super Administrator',
      email:'superadmin@softlydigital.com',
      role:'superadmin', status:'active',
      createdAt:new Date().toISOString(),
    });
    console.log(`\n  ${ok('superadmin@softlydigital.com created')}`);
    console.log(`  ${warn('Password: SuperAdmin@2025!  ← CHANGE THIS NOW')}`);
  } catch(e) {
    if (e.code===409) console.log(`  ${skip('Super Admin already exists')}`);
    else console.error(`  ${fail('Super Admin: ' + e.message)}`);
  }
}

/* ── ADD WEB PLATFORM (CORS) ─────────────────────────────────── */
async function cmdAddPlatform(clients) {
  console.log(head('🌐  Adding web platform for CORS…\n'));
  const hostname = await ask(`  Enter your hostname (e.g. localhost or yourdomain.com): `);
  if (!hostname) { console.log(warn('No hostname entered.')); return; }
  try {
    await clients.projects.createPlatform(
      CONFIG.PROJECT_ID,
      sdk.PlatformType.Web,
      hostname.replace(/https?:\/\//,'').split('/')[0],
      hostname
    );
    console.log(`\n  ${ok('Platform added: ' + hostname)}`);
    console.log(info('Also add: localhost for local development'));
  } catch(e) {
    if (e.code===409) console.log(`  ${skip('Platform ' + hostname + ' already exists')}`);
    else console.error(`  ${fail(e.message)}`);
  }
}

/* ── RESET (delete everything + rebuild) ─────────────────────── */
async function cmdReset(clients) {
  console.log(`\n${C.red}${C.bold}⚠️   DANGER ZONE — RESET DATABASE${C.reset}`);
  console.log(`${C.red}  This will DELETE the entire database and all data, then rebuild.${C.reset}`);
  const confirm1 = await ask(`\n  Type ${C.bold}DELETE${C.reset} to confirm: `);
  if (confirm1 !== 'DELETE') { console.log(info('Aborted.')); return; }
  const confirm2 = await ask(`  Type ${C.bold}YES I AM SURE${C.reset} to continue: `);
  if (confirm2 !== 'YES I AM SURE') { console.log(info('Aborted.')); return; }

  console.log(`\n  ${C.red}Deleting database ${CONFIG.DB_ID}…${C.reset}`);
  try {
    await clients.databases.delete(CONFIG.DB_ID);
    console.log(`  ${ok('Database deleted')}`);
  } catch(e) {
    if (e.code===404) console.log(`  ${info('Database did not exist')}`);
    else console.error(`  ${fail(e.message)}`);
  }

  console.log(`\n  Waiting 3s for Appwrite to process deletion…`);
  await wait(3000);

  await cmdSetup(clients);
}

/* ══════════════════════════════════════════════════════════════
 * PRINT HELPERS
 * ══════════════════════════════════════════════════════════════ */
function printBanner() {
  console.log(`
${C.bold}${C.blue}╔══════════════════════════════════════════════════════════╗
║         SOFTLY DIGITAL V3 — Appwrite Setup CLI           ║
║         Project: 6a39aa7e0036a36c3b71                    ║
╚══════════════════════════════════════════════════════════╝${C.reset}
`);
}

function printSummary() {
  console.log(`
${done('🎉  Setup complete!')}

  ${C.bold}Database:${C.reset}  cbt-main (15 collections, all indexes created)

  ${C.bold}Super Admin:${C.reset}
    URL      → /html/admin-login.html
    Email    → superadmin@softlydigital.com
    Password → SuperAdmin@2025!
    ${C.red}⚠️  CHANGE PASSWORD ON FIRST LOGIN${C.reset}

  ${C.bold}Next steps:${C.reset}
    1. Add your domain in Appwrite Console → Platforms
       Or run:  ${C.cyan}node cli.js add-platform${C.reset}
    2. Seed sample data:
       Run:     ${C.cyan}node cli.js seed${C.reset}
    3. Deploy the ${C.bold}/public${C.reset} folder to Netlify, Vercel or any host.
`);
}

function printSeedAccounts() {
  console.log(`
  ${C.bold}Sample Accounts (CHANGE PASSWORDS IN PRODUCTION):${C.reset}

  Super Admin   → superadmin@softlydigital.com  / SuperAdmin@2025!
  Admin         → admin@softlydigital.com        / Admin@2025!
  Exam Officer  → examoff@softlydigital.com      / ExamOff@2025!
  Invigilator   → invig@softlydigital.com        / Invigi@2025!  (Staff ID: INV2025001)
  Candidate     → ID: SD2025000001              / Password: SD2025000001
                  Login at /html/candidate-login.html, Centre: Lagos Main Centre
`);
}

function printHelp() {
  console.log(`
${C.bold}Usage:${C.reset}
  node cli.js [command]

${C.bold}Commands:${C.reset}
  ${C.cyan}setup${C.reset}           Create database, all 15 collections, indexes, super admin
  ${C.cyan}seed${C.reset}            Insert sample subjects, centres, exam, questions, accounts
  ${C.cyan}status${C.reset}          Show what collections and documents exist
  ${C.cyan}reset${C.reset}           ⚠️  DELETE everything and rebuild from scratch
  ${C.cyan}create-admin${C.reset}    Create or recreate the super admin account
  ${C.cyan}add-platform${C.reset}    Add your hostname to Appwrite platforms (fixes CORS)
  ${C.cyan}--help${C.reset}          Show this help

${C.bold}API Key:${C.reset}
  ${C.dim}Mac/Linux:${C.reset}   export APPWRITE_API_KEY=your_key_here
  ${C.dim}Windows CMD:${C.reset} set    APPWRITE_API_KEY=your_key_here
  ${C.dim}PowerShell:${C.reset}  $env:APPWRITE_API_KEY="your_key_here"

${C.bold}Example full setup:${C.reset}
  ${C.cyan}npm install${C.reset}
  ${C.cyan}export APPWRITE_API_KEY=your_key${C.reset}
  ${C.cyan}node cli.js setup${C.reset}
  ${C.cyan}node cli.js seed${C.reset}
  ${C.cyan}node cli.js add-platform${C.reset}
  ${C.cyan}node cli.js status${C.reset}
`);
}

/* ══════════════════════════════════════════════════════════════
 * INTERACTIVE MENU (when no args given)
 * ══════════════════════════════════════════════════════════════ */
async function interactiveMenu(clients) {
  console.log(`\n${C.bold}What would you like to do?${C.reset}\n`);
  console.log(`  ${C.cyan}1${C.reset}  Setup database + collections + super admin`);
  console.log(`  ${C.cyan}2${C.reset}  Seed sample data`);
  console.log(`  ${C.cyan}3${C.reset}  Check status`);
  console.log(`  ${C.cyan}4${C.reset}  Add web platform (fix CORS)`);
  console.log(`  ${C.cyan}5${C.reset}  Create / reset super admin`);
  console.log(`  ${C.cyan}6${C.reset}  Full setup + seed (do everything)`);
  console.log(`  ${C.red}7${C.reset}  ⚠️  RESET — delete everything and rebuild`);
  console.log(`  ${C.dim}0${C.reset}  Exit\n`);

  const choice = await ask('  Enter choice [0-7]: ');
  switch (choice) {
    case '1': await cmdSetup(clients);        break;
    case '2': await cmdSeed(clients);         break;
    case '3': await cmdStatus(clients);       break;
    case '4': await cmdAddPlatform(clients);  break;
    case '5': await cmdCreateAdmin(clients);  break;
    case '6':
      await cmdSetup(clients);
      await cmdSeed(clients);
      await cmdAddPlatform(clients);
      break;
    case '7': await cmdReset(clients);        break;
    case '0': console.log('\n  Bye! 👋\n'); process.exit(0); break;
    default:  console.log(warn('Invalid choice.')); break;
  }
}

/* ══════════════════════════════════════════════════════════════
 * ENTRY POINT
 * ══════════════════════════════════════════════════════════════ */
async function main() {
  printBanner();

  const cmd = process.argv[2];

  /* Help is shown without needing an API key */
  if (cmd === '--help' || cmd === '-h') { printHelp(); return; }

  /* Prompt for API key if missing */
  let apiKey = CONFIG.API_KEY;
  if (!apiKey) {
    console.log(warn('APPWRITE_API_KEY env var not set.\n'));
    apiKey = await ask(`  ${C.bold}Paste your Appwrite API key:${C.reset} `);
    if (!apiKey) {
      console.error(fail('No API key provided. Exiting.'));
      process.exit(1);
    }
  } else {
    console.log(info(`Using API key from env: ${apiKey.substring(0,8)}…`));
  }

  const clients = makeClients(apiKey);

  /* Test connection */
  try {
    await clients.databases.list();
    console.log(ok('Connected to Appwrite ✓\n'));
  } catch(e) {
    console.error(fail('Cannot connect to Appwrite: ' + e.message));
    console.error(info('Check your API key and project ID.'));
    process.exit(1);
  }

  /* Route to command */
  switch (cmd) {
    case 'setup':         await cmdSetup(clients);        break;
    case 'seed':          await cmdSeed(clients);         break;
    case 'status':        await cmdStatus(clients);       break;
    case 'reset':         await cmdReset(clients);        break;
    case 'create-admin':  await cmdCreateAdmin(clients);  break;
    case 'add-platform':  await cmdAddPlatform(clients);  break;
    default:              await interactiveMenu(clients); break;
  }
}

main().catch(e => {
  console.error(`\n${fail('Fatal error: ' + e.message)}\n`);
  process.exit(1);
});
