# ⚡ Fast Access Challenge — Multiplayer

A real-time multiplayer browser game with 3 levels: Color Vision, Spell Check, and Fruit Frenzy. Built with Vanilla JS + Firebase Realtime Database.

---

## 🚀 Quick Start

### 1. Get Firebase Keys

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"** → give it a name → Continue
3. Disable Google Analytics (optional) → Create project
4. In your project dashboard, click **"</> Web"** to add a web app
5. Register the app (any nickname) → copy the `firebaseConfig` object
6. In the left sidebar, go to **Build → Realtime Database**
7. Click **"Create Database"** → choose a region → **Start in test mode** → Enable
8. In the left sidebar, go to **Build → Authentication**
9. Click **"Get started"** → **Anonymous** → Enable → Save

### 2. Add Your Firebase Config

Open `firebase.js` and replace the placeholder config:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 3. Run Locally

Because `app.js` uses ES modules (`import`), you need a local server — not just opening `index.html`.

**Option A — VS Code Live Server:**
- Install the "Live Server" extension → right-click `index.html` → "Open with Live Server"

**Option B — Python:**
```bash
cd fast-access-challenge
python3 -m http.server 8080
# Open http://localhost:8080
```

**Option C — Node.js:**
```bash
npx serve .
```

---

## 📦 Deploy to Vercel

### Option A — Vercel CLI
```bash
npm install -g vercel
cd fast-access-challenge
vercel
# Follow prompts — deploy as static site
```

### Option B — GitHub + Vercel Dashboard
1. Push this folder to a GitHub repo (see below)
2. Go to [https://vercel.com](https://vercel.com) → Import project → select your repo
3. Framework: **Other** (static) → Deploy

---

## 📁 Upload to GitHub

```bash
git init
git add .
git commit -m "Initial commit — Fast Access Challenge"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

---

## 🗄️ Firebase Database Rules (for production)

In Firebase Console → Realtime Database → Rules, replace with:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

---

## 🎮 How to Play

1. Player 1 clicks **Create Room** → enters name → shares the 4-letter room code
2. Other players click **Join Room** → enter name + code
3. Host clicks **Start Game**
4. All 3 levels play simultaneously for all players
5. Scores sync live — leaderboard shown between levels
6. Final podium screen at the end

### Level Guide
- 🎨 **Level 1 — Color Vision**: Tap the circle with a slightly different shade (7 rounds, gets harder)
- 📝 **Level 2 — Spell Check**: Pick the correctly spelled word from 3 options (5 rounds, 8s each)
- 🍎 **Level 3 — Fruit Frenzy**: Tap the target fruit bouncing around the arena (5 waves, 14s each)

---

## 📁 File Structure

```
fast-access-challenge/
├── index.html      — All screens and UI
├── style.css       — Full styling (dark/neon theme)
├── app.js          — Game logic + Firebase sync
├── firebase.js     — Firebase config (edit this!)
├── vercel.json     — Vercel deployment config
└── README.md       — This file
```

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| "Firebase connection failed" | Check your `firebaseConfig` in `firebase.js` |
| "Room not found" | Make sure both players use the exact same 4-letter code |
| Game won't start locally | Use a local server (Live Server / Python / Node) — can't use `file://` |
| Audio not working | Click anywhere on the page first (browser autoplay policy) |
| Scores not syncing | Check Firebase Realtime Database is enabled and in test mode |
