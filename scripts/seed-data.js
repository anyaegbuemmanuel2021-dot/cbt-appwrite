/**
 * SOFTLY DIGITAL V3 — seed-data.js
 * Creates sample subjects, topics, centres, and one test exam.
 * Run AFTER setup-appwrite.js
 *
 * Usage: node seed-data.js
 */
const sdk = require('node-appwrite');

const ENDPOINT   = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6a39aa7e0036a36c3b71';
const API_KEY    = process.env.APPWRITE_API_KEY    || 'YOUR_SERVER_API_KEY_HERE';
const DB_ID      = 'cbt-main';

const client    = new sdk.Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
const databases = new sdk.Databases(client);
const users     = new sdk.Users(client);
const ID        = sdk.ID;

async function safe(fn, label) {
  try { const r = await fn(); console.log(`  ✅ ${label}`); return r; }
  catch(e) { if(e.code===409) console.log(`  ⏭️  ${label} (exists)`); else console.error(`  ❌ ${label}: ${e.message}`); }
}

async function create(col, data, id) {
  return databases.createDocument(DB_ID, col, id || ID.unique(), data);
}

async function main() {
  console.log('\n🌱 Seeding SOFTLY DIGITAL V3 sample data…\n');

  // ── SUBJECTS ─────────────────────────────────────────────────────
  console.log('📚 Creating subjects…');
  const subjects = ['Mathematics','English Language','Physics','Chemistry','Biology',
    'Economics','Government','Literature','Geography','Agricultural Science'];
  const subjIds = {};
  for (const name of subjects) {
    const doc = await safe(() => create('subjects', { name, createdAt: new Date().toISOString() }), `Subject: ${name}`);
    if (doc) subjIds[name] = doc.$id;
  }

  // ── TOPICS (Mathematics example) ─────────────────────────────────
  console.log('\n📖 Creating sample topics for Mathematics…');
  const mathTopics = ['Algebra','Trigonometry','Calculus','Statistics','Geometry','Number Theory','Indices'];
  if (subjIds['Mathematics']) {
    for (const name of mathTopics) {
      await safe(() => create('topics', { name, subjectId: subjIds['Mathematics'], createdAt: new Date().toISOString() }), `Topic: ${name}`);
    }
  }

  // ── CENTRES ──────────────────────────────────────────────────────
  console.log('\n🏢 Creating sample centres…');
  const centres = [
    { code:'CTR001', name:'Lagos Main Centre',  state:'Lagos',  capacity:500,  address:'123 Victoria Island, Lagos' },
    { code:'CTR002', name:'Abuja Central',       state:'Abuja',  capacity:400,  address:'Plot 45, Central District, Abuja' },
    { code:'CTR003', name:'Port Harcourt CBT',   state:'Rivers', capacity:300,  address:'12 Trans-Amadi, Port Harcourt' },
    { code:'CTR004', name:'Kano North Centre',   state:'Kano',   capacity:350,  address:'44 Bompai Road, Kano' },
    { code:'CTR005', name:'Ibadan West Centre',  state:'Oyo',    capacity:250,  address:'8 Ring Road, Ibadan' },
  ];
  const centreIds = {};
  for (const c of centres) {
    const doc = await safe(() => create('centres', { ...c, imageUrl:'', status:'active', createdAt: new Date().toISOString() }), `Centre: ${c.name}`);
    if (doc) centreIds[c.code] = doc.$id;
  }

  // ── SAMPLE EXAM ───────────────────────────────────────────────────
  console.log('\n📝 Creating sample exam…');
  const mathSubjId = subjIds['Mathematics'] || '';
  await safe(() => create('exams', {
    name:               'Mathematics Aptitude Test 2025',
    subjectId:          mathSubjId,
    subject:            'Mathematics',
    subjectIds:         JSON.stringify([mathSubjId]),
    duration:           60,
    totalQuestions:     40,
    passingScore:       50,
    randomizeQuestions: true,
    shuffleOptions:     true,
    active:             false,
    status:             'draft',
    candidateIds:       JSON.stringify([]),
    centreIds:          JSON.stringify(Object.values(centreIds)),
    createdAt:          new Date().toISOString(),
  }), 'Exam: Mathematics Aptitude Test 2025');

  // ── SAMPLE QUESTIONS (10 Math questions) ──────────────────────────
  console.log('\n❓ Creating sample questions…');
  const questions = [
    { text:'What is the value of x in 2x + 6 = 14?', optionA:'2', optionB:'3', optionC:'4', optionD:'5', correctAnswer:'C', difficulty:'easy', explanation:'2x=14-6=8, x=4' },
    { text:'Simplify: 3² + 4²', optionA:'25', optionB:'49', optionC:'7', optionD:'14', correctAnswer:'A', difficulty:'easy', explanation:'9+16=25' },
    { text:'Find the sum of the first 10 natural numbers.', optionA:'45', optionB:'50', optionC:'55', optionD:'60', correctAnswer:'C', difficulty:'medium', explanation:'n(n+1)/2 = 10×11/2 = 55' },
    { text:'What is sin(90°)?', optionA:'0', optionB:'1', optionC:'-1', optionD:'0.5', correctAnswer:'B', difficulty:'easy', explanation:'sin(90°) = 1' },
    { text:'If log₁₀(100) = x, find x.', optionA:'1', optionB:'2', optionC:'10', optionD:'0.1', correctAnswer:'B', difficulty:'medium', explanation:'10²=100, so log₁₀(100)=2' },
    { text:'The gradient of a line joining (2,3) and (4,7) is:', optionA:'1', optionB:'2', optionC:'3', optionD:'4', correctAnswer:'B', difficulty:'medium', explanation:'m=(7-3)/(4-2)=4/2=2' },
    { text:'Solve: x² - 5x + 6 = 0', optionA:'x=1,6', optionB:'x=2,3', optionC:'x=-2,-3', optionD:'x=0,5', correctAnswer:'B', difficulty:'medium', explanation:'(x-2)(x-3)=0' },
    { text:'What is the area of a circle with radius 7 cm? (π≈22/7)', optionA:'44 cm²', optionB:'154 cm²', optionC:'49 cm²', optionD:'22 cm²', correctAnswer:'B', difficulty:'medium', explanation:'A=πr²=22/7×49=154' },
    { text:'If 3x ≡ 9 (mod 12), find x.', optionA:'1', optionB:'3', optionC:'4', optionD:'6', correctAnswer:'B', difficulty:'hard', explanation:'3×3=9≡9(mod 12)' },
    { text:'Differentiate y = 3x³ - 2x + 1', optionA:'9x² - 2', optionB:'3x² - 2', optionC:'9x + 2', optionD:'6x - 2', correctAnswer:'A', difficulty:'hard', explanation:'dy/dx = 9x² - 2' },
  ];
  for (const q of questions) {
    await safe(() => create('questions', {
      ...q,
      subjectId:   mathSubjId,
      subject:     'Mathematics',
      topic:       'General',
      topicId:     '',
      options:     JSON.stringify({ A:q.optionA, B:q.optionB, C:q.optionC, D:q.optionD }),
      imageUrl:    '',
      examCount:   0,
      source:      'seed',
    }), `Question: ${q.text.substring(0,40)}`);
  }

  // ── SAMPLE ADMIN USER ─────────────────────────────────────────────
  console.log('\n👤 Creating sample admin user…');
  try {
    const newUser = await users.create(ID.unique(), 'admin@softlydigital.com', undefined, 'Admin@2025!', 'Centre Administrator');
    await databases.createDocument(DB_ID, 'users', newUser.$id, {
      fullName:  'Centre Administrator',
      email:     'admin@softlydigital.com',
      role:      'admin',
      centreId:  centreIds['CTR001'] || '',
      centreName:'Lagos Main Centre',
      status:    'active',
      createdAt: new Date().toISOString(),
    });
    console.log('  ✅ Admin user: admin@softlydigital.com / Admin@2025!');
  } catch(e) {
    if (e.code===409) console.log('  ⏭️  Admin user already exists');
    else console.error('  ❌ Admin user:', e.message);
  }

  // ── SAMPLE INVIGILATOR ────────────────────────────────────────────
  console.log('\n👁️  Creating sample invigilator…');
  try {
    const inv = await users.create(ID.unique(), 'invigilator@softlydigital.com', undefined, 'Invigi@2025!', 'John Invigilator');
    await databases.createDocument(DB_ID, 'users', inv.$id, {
      fullName:   'John Invigilator',
      email:      'invigilator@softlydigital.com',
      staffId:    'INV2025001',
      role:       'invigilator',
      centreId:   centreIds['CTR001'] || '',
      centreName: 'Lagos Main Centre',
      status:     'active',
      createdAt:  new Date().toISOString(),
    });
    console.log('  ✅ Invigilator: invigilator@softlydigital.com / Invigi@2025! (Staff ID: INV2025001)');
  } catch(e) {
    if (e.code===409) console.log('  ⏭️  Invigilator already exists');
    else console.error('  ❌ Invigilator:', e.message);
  }

  // ── SAMPLE CANDIDATE ──────────────────────────────────────────────
  console.log('\n🎓 Creating sample candidate…');
  try {
    const cand = await users.create(ID.unique(), 'candidate@softlydigital.com', undefined, 'SD2025000001', 'Test Candidate');
    await databases.createDocument(DB_ID, 'candidates', cand.$id, {
      candidateId:       'SD2025000001',
      fullName:          'Test Candidate',
      email:             'candidate@softlydigital.com',
      phone:             '+234800000000',
      centreId:          centreIds['CTR001'] || '',
      centreName:        'Lagos Main Centre',
      passportImageUrl:  '',
      status:            'active',
      examIds:           JSON.stringify([]),
      createdAt:         new Date().toISOString(),
    });
    console.log('  ✅ Candidate: candidate@softlydigital.com (ID: SD2025000001, Password: SD2025000001)');
  } catch(e) {
    if (e.code===409) console.log('  ⏭️  Candidate already exists');
    else console.error('  ❌ Candidate:', e.message);
  }

  console.log('\n\n🎉 Seed complete!\n');
  console.log('📋 Sample Accounts (CHANGE PASSWORDS IN PRODUCTION):');
  console.log('   Super Admin  → superadmin@softlydigital.com / SuperAdmin@2025!');
  console.log('   Admin        → admin@softlydigital.com / Admin@2025!');
  console.log('   Invigilator  → invigilator@softlydigital.com / Invigi@2025! (Staff ID: INV2025001)');
  console.log('   Candidate    → ID: SD2025000001, Password: SD2025000001, Centre: Lagos Main Centre\n');
}

main().catch(e => { console.error('\n💥 Seed failed:', e.message); process.exit(1); });
