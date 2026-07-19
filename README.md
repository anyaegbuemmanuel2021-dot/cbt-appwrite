# SOFTLY DIGITAL V3 — Enterprise CBT Platform
> Backend: **Appwrite Cloud** · Storage: **Cloudinary** · Frontend: Vanilla HTML/CSS/JS

---

## 🚀 QUICK START (Copy-paste these commands in order)

### Step 1 — Clone / Download
```bash
# If using git
git clone <your-repo-url> cbt-system
cd cbt-system

# OR just place the /public folder on any static host
```

### Step 2 — Install setup dependencies
```bash
cd scripts
npm install
```

### Step 3 — Configure your credentials
Edit `scripts/setup-appwrite.js` lines 10-12:
```js
const ENDPOINT   = 'https://fra.cloud.appwrite.io/v1';
const PROJECT_ID = '6a5cab36001397f233a6';   // ← your Appwrite project ID
const API_KEY    = 'your-server-api-key';      // ← from Appwrite Console → API Keys
```

Edit `public/js/appwrite-config.js` lines 10-16:
```js
window.APP_ENV = {
  APPWRITE_ENDPOINT:   'https://fra.cloud.appwrite.io/v1',
  APPWRITE_PROJECT_ID: '6a5cab36001397f233a6',  // ← same project ID
  CLOUDINARY_CLOUD:    'your_cloud_name',         // ← from cloudinary.com dashboard
  CLOUDINARY_PRESET:   'cbt_softly_unsigned',     // ← create this preset in Cloudinary
  CLOUDINARY_FOLDER:   'softly-digital/v3',
};
```

### Step 4 — Run the Appwrite setup script
```bash
cd scripts
node setup-appwrite.js
```
This creates:
- Database: `cbt-main`
- All 15 collections with attributes and indexes
- Super Admin account
- Default settings

### Step 5 — Set up Cloudinary (2 minutes)
1. Go to [cloudinary.com](https://cloudinary.com) → Sign up free
2. Dashboard → Settings → Upload → Add upload preset
3. Name it: `cbt_softly_unsigned`
4. Set **Signing Mode** to `Unsigned`
5. Set **Folder** to `softly-digital/v3`
6. Save
7. Copy your **Cloud Name** from the dashboard top-left

### Step 6 — Set Appwrite Platform (Web)
In Appwrite Console → Your Project → Overview → Add Platform:
- Platform: **Web**
- Name: `CBT System`
- Hostname: `localhost` (for dev) and your deployed domain (for production)

### Step 7 — Deploy / Serve
```bash
# Local development
cd ..
npm install
npm run dev
# Opens at http://localhost:3000

# Deploy to Netlify (drag-and-drop the /public folder)
# OR deploy to Vercel:
npm run deploy:vercel

# OR any static host — just upload the /public folder
```

---

## 🔐 Default Login Credentials

> **⚠️ CHANGE ALL PASSWORDS IMMEDIATELY AFTER FIRST LOGIN**

| Role | URL | Email | Password |
|------|-----|-------|----------|
| Super Admin | `/html/admin-login.html` | `superadmin@softlydigital.com` | `SuperAdmin@2025!` |
| Candidate | `/html/candidate-login.html` | Candidate ID + centre | Default = Candidate ID |
| Invigilator | `/html/invigilator-login.html` | Staff ID + centre | Set by admin |

---

## 📁 Project Structure
```
softly-digital-v3/
├── public/
│   ├── index.html                    ← Landing page / portal selector
│   ├── html/
│   │   ├── admin-login.html          ← Admin login
│   │   ├── admin-dashboard.html      ← Full admin panel (all modules)
│   │   ├── candidate-login.html      ← Candidate login
│   │   ├── candidate-dashboard.html  ← Candidate portal
│   │   ├── invigilator-login.html    ← Invigilator login
│   │   ├── invigilator-panel.html    ← Live monitoring panel
│   │   ├── exam-instructions.html    ← Pre-exam instructions + system check
│   │   ├── exam.html                 ← JAMB-style exam engine
│   │   └── results.html              ← Results + certificate
│   ├── css/
│   │   ├── main.css                  ← Global styles (fully responsive)
│   │   ├── admin.css                 ← Admin panel
│   │   ├── auth.css                  ← Login screens
│   │   ├── dashboard.css             ← Candidate dashboard
│   │   ├── exam.css                  ← Exam engine
│   │   ├── invigilator.css           ← Monitoring panel
│   │   ├── portal.css                ← Landing page
│   │   ├── results.css               ← Results page
│   │   └── exam-instructions.css     ← Instructions page
│   ├── js/
│   │   ├── appwrite-config.js        ← ⭐ Appwrite SDK + DB helper + CLOUD helper
│   │   ├── rbac.js                   ← Role-based access control
│   │   ├── auth.js                   ← Authentication (all portals)
│   │   ├── managers.js               ← Centre, Subject, Exam, User, Result, Settings
│   │   ├── candidate-manager.js      ← Candidate CRUD + Excel import
│   │   ├── question-manager.js       ← Question bank + Excel import
│   │   ├── admin-dashboard.js        ← Dashboard stats + module loader
│   │   ├── candidate-dashboard.js    ← Candidate portal logic
│   │   ├── invigilator-panel.js      ← Live monitoring (poll-based)
│   │   ├── exam-engine.js            ← JAMB-style exam with subject tabs
│   │   ├── exam-timer.js             ← Countdown timer
│   │   ├── exam-sync.js              ← Auto-save + Appwrite sync
│   │   ├── anti-cheat.js             ← Tab switch, fullscreen, devtools, bot detection
│   │   ├── device-verification.js    ← Pre-login device check
│   │   ├── exam-instructions.js      ← System check + instructions
│   │   ├── certificate.js            ← Canvas-based certificate generator
│   │   ├── ai-module.js              ← AI question generation (OpenAI)
│   │   ├── analytics-manager.js      ← Analytics charts
│   │   ├── audit-manager.js          ← Audit log viewer
│   │   └── notification-manager.js   ← Notifications
│   └── assets/
│       └── images/
│           └── default-avatar.png
├── scripts/
│   ├── setup-appwrite.js             ← ⭐ Run once — creates all collections
│   ├── package.json
│   └── seed-data.js                  ← Optional sample data
└── package.json
```

---

## 👥 Role Permissions Matrix

| Permission | Super Admin | Admin | Exam Officer | Result Officer | Q. Manager | Invigilator | Candidate |
|-----------|:-----------:|:-----:|:------------:|:--------------:|:----------:|:-----------:|:---------:|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Manage Centres | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Exams | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Monitor Exams | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Create Users | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delete Users** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delete Files** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage Candidates | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Question Bank | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| View Results | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | Own only |
| Audit Logs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **System Settings** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 🗄️ Appwrite Collections

| Collection ID | Purpose |
|--------------|---------|
| `users` | All staff accounts |
| `candidates` | Exam candidates |
| `centres` | Examination centres |
| `subjects` | Subjects (Math, English, etc.) |
| `topics` | Sub-topics per subject |
| `exams` | Exam definitions |
| `questions` | Question bank |
| `exam_sessions` | Live exam sessions |
| `submissions` | Submitted answer sheets |
| `results` | Graded results |
| `violations` | Anti-cheat violations |
| `audit_logs` | All system actions |
| `notifications` | Sent notifications |
| `certificates` | Issued certificates |
| `system_settings` | Global config (doc id: `global`) |

---

## ☁️ Cloudinary Setup

Images stored in Cloudinary by folder:
- `softly-digital/v3/candidates/` — Passport photos
- `softly-digital/v3/questions/` — Question diagrams
- `softly-digital/v3/centres/` — Centre images
- `softly-digital/v3/verification/` — Live verification photos

Only the **HTTPS URL** is saved in Appwrite. No image binary in the database.

---

## 📡 Scalability Notes

The system is designed to handle 50,000+ candidates:
- Paginated loads (50 per page for candidates, 100 for questions)
- Appwrite indexes on: `candidateId`, `email`, `centreId`, `subjectId`, `examId`
- Questions fetched **by subjectId** — exam never downloads all questions
- Duplicate prevention on: candidates (email + ID), questions (text), centres (code)
- Invigilator panel polls every 5 seconds (no WebSocket required)
- Auto-save locally every 5s, cloud sync every 30s

---

## 🐛 Troubleshooting

**"Save failed: internal fix"** → Likely a field missing in Appwrite collection. Re-run `node setup-appwrite.js`

**Images not uploading** → Check Cloudinary preset is `Unsigned` and CORS is enabled

**Login fails** → Check Appwrite project ID in `appwrite-config.js` and add your hostname as a Web platform

**Exam not loading** → Ensure the exam is `active:true` and candidate is assigned (`candidateIds` array)

**Centre dropdown empty** → Add at least one active centre first in Admin → Centres
