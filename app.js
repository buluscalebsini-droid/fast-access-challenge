// ============================================================
// app.js — Fast Access Challenge — Multiplayer
// ============================================================

import {
  db, auth, ref, set, get, update, onValue, onDisconnect,
  serverTimestamp, off, remove, push, child,
  signInAnonymously, onAuthStateChanged
} from './firebase.js';

// ============================================================
// AUDIO ENGINE
// ============================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null;
let jazzInterval = null;
let musicOn = true;
let jazzStep = 0;

function getACtx() {
  if (!actx) actx = new AudioCtx();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function playTone(freq, type = 'sine', dur = 0.18, vol = 0.15, delay = 0) {
  if (!musicOn) return;
  try {
    const ctx = getACtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.05);
  } catch (e) {}
}

const sfxCorrect  = () => { playTone(880,'sine',0.12,0.25); playTone(1100,'sine',0.12,0.22,0.1); };
const sfxWrong    = () => playTone(200,'sawtooth',0.22,0.25);
const sfxCountdown= () => playTone(440,'square',0.1,0.18);
const sfxGo       = () => [523,659,784].forEach((f,i) => playTone(f,'sine',0.1,0.25,i*0.06));
const sfxTimerWarn= () => playTone(330,'triangle',0.08,0.12);
const sfxLevelUp  = () => [523,659,784,1047].forEach((f,i) => playTone(f,'sine',0.18,0.25,i*0.12));
const sfxClick    = () => playTone(660,'triangle',0.06,0.12);

const JAZZ_CHORDS = [
  [261,330,392,494],[294,370,440,554],[349,440,523,659],
  [392,494,587,740],[330,415,494,622],[261,330,392,523]
];
function playJazzChord() {
  if (!musicOn) return;
  const chord = JAZZ_CHORDS[jazzStep % JAZZ_CHORDS.length];
  chord.forEach((f,i) => playTone(f/2,'sine',0.5,0.055,i*0.04));
  playTone(chord[0]/4,'triangle',0.55,0.09);
  jazzStep++;
}
function startJazz() { stopJazz(); if (!musicOn) return; playJazzChord(); jazzInterval = setInterval(playJazzChord,1400); }
function stopJazz()  { if (jazzInterval) { clearInterval(jazzInterval); jazzInterval = null; } }
function toggleMusic() {
  musicOn = !musicOn;
  document.querySelectorAll('.btn-mute').forEach(b => b.textContent = musicOn ? '🎵' : '🔇');
  if (musicOn) startJazz(); else stopJazz();
}

// ============================================================
// STATE
// ============================================================
let myUid = null;
let myName = '';
let roomCode = '';
let isHost = false;
let players = {};
let gameState = {};
let activeListeners = [];
let localTimerId = null;
let localTimerRemaining = 0;

// Per-level state
let l1Round = 0, l1CanClick = false;
let l2Round = 0, l2CanClick = false;
let l3Round = 0, l3CanClick = false;
let l4Round = 0, l4Sequence = [], l4PlayerSeq = [], l4CanInput = false, l4DistractorInterval = null;
let l5Round = 0, l5CanClick = false, l5DistractorRaf = null, l5DistractorObjects = [];

// ============================================================
// UTILS
// ============================================================
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) { const j = randInt(0,i); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}
function pick(arr) { return arr[randInt(0, arr.length-1)]; }

const AVATAR_COLORS = ['avatar-0','avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9'];
function playerColor(idx) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }
function playerInitials(name) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) || '?'; }

function showToast(msg, dur = 1800) {
  const t = document.getElementById('toast');
  t.classList.remove('hidden');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), dur);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => chars[randInt(0,chars.length-1)]).join('');
}

function setConnected(ok) {
  const el = document.getElementById('conn-indicator');
  const lbl = document.getElementById('conn-label');
  if (!el) return;
  el.classList.toggle('offline', !ok);
  lbl.textContent = ok ? 'Connected' : 'Reconnecting...';
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ============================================================
// FIREBASE HELPERS
// ============================================================
function dbRef(...parts) { return ref(db, parts.join('/')); }

function listenOn(path, cb) {
  const r = dbRef(path);
  onValue(r, cb);
  activeListeners.push(r);
  return r;
}

function clearListeners() {
  activeListeners.forEach(r => off(r));
  activeListeners = [];
}

function stopLocalTimer() {
  if (localTimerId) { clearInterval(localTimerId); localTimerId = null; }
}

// ============================================================
// AUTH
// ============================================================
async function initAuth() {
  document.getElementById('loading-msg').textContent = 'Authenticating...';
  await signInAnonymously(auth);
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { myUid = user.uid; unsub(); resolve(); }
    });
  });
}

// ============================================================
// CONNECTION MONITORING
// ============================================================
function initConnectionMonitor() {
  const connRef = dbRef('.info/connected');
  onValue(connRef, snap => setConnected(!!snap.val()));
}

// ============================================================
// ROOM CREATION
// ============================================================
async function createRoom(hostName) {
  myName = hostName.trim();
  isHost = true;
  roomCode = genRoomCode();
  const roomRef = dbRef('rooms', roomCode);
  const snap = await get(roomRef);
  if (snap.exists()) roomCode = genRoomCode();

  const presenceRef = dbRef('rooms', roomCode, 'players', myUid);
  await onDisconnect(presenceRef).remove();

  await set(roomRef, {
    host: myUid, status: 'lobby', created: serverTimestamp(),
    players: { [myUid]: { name: myName, score: 0, color: 0, ready: true } },
    game: { level: 0, round: 0, roundSeed: 0, phase: 'waiting' }
  });
  openLobby();
}

// ============================================================
// ROOM JOINING
// ============================================================
async function joinRoom(name, code) {
  myName = name.trim();
  const upper = code.trim().toUpperCase();
  const roomSnap = await get(dbRef('rooms', upper));
  if (!roomSnap.exists()) return 'Room not found.';
  const data = roomSnap.val();
  if (data.status !== 'lobby') return 'Game already started.';
  const existingPlayers = data.players || {};
  const playerList = Object.keys(existingPlayers);
  if (playerList.length >= 40) return 'Room is full (max 40 players).';
  roomCode = upper;
  isHost = data.host === myUid;
  const playerIdx = playerList.length;
  const presenceRef = dbRef('rooms', roomCode, 'players', myUid);
  await onDisconnect(presenceRef).remove();
  await update(dbRef('rooms', roomCode, 'players'), {
    [myUid]: { name: myName, score: 0, color: playerIdx, ready: true }
  });
  openLobby();
  return null;
}

// ============================================================
// LOBBY
// ============================================================
function openLobby() {
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = roomCode;
  updateHostControls();
  listenLobby();
  startJazz();
}

function updateHostControls() {
  const startBtn = document.getElementById('btn-start-game');
  if (isHost) {
    startBtn.classList.remove('hidden');
    startBtn.onclick = () => { sfxClick(); hostStartGame(); };
  } else {
    startBtn.classList.add('hidden');
  }
}

function listenLobby() {
  clearListeners();
  listenOn(`rooms/${roomCode}/players`, snap => {
    players = snap.val() || {};
    renderLobbyPlayers();
    if (!players[myUid]) { showToast('You were removed from the room.'); resetToMenu(); }
  });
  listenOn(`rooms/${roomCode}/status`, snap => {
    if (snap.val() === 'playing') { clearListeners(); startGame(); }
  });
  listenOn(`rooms/${roomCode}`, snap => {
    if (!snap.exists()) { showToast('Room closed.'); resetToMenu(); }
  });
}

function renderLobbyPlayers() {
  const list = document.getElementById('lobby-player-list');
  list.innerHTML = '';
  const entries = Object.entries(players);
  entries.forEach(([uid, p], idx) => {
    const card = document.createElement('div');
    card.className = 'player-card';
    const avatar = document.createElement('div');
    avatar.className = `player-avatar ${playerColor(p.color ?? idx)}`;
    avatar.textContent = playerInitials(p.name);
    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = p.name;
    const badges = document.createElement('div');
    badges.style.display = 'flex'; badges.style.gap = '6px';
    get(dbRef('rooms', roomCode, 'host')).then(s => {
      if (s.val() === uid) {
        const hb = document.createElement('span');
        hb.className = 'player-badge'; hb.textContent = 'HOST';
        badges.appendChild(hb);
      }
    });
    if (uid === myUid) {
      const yb = document.createElement('span');
      yb.className = 'player-badge you'; yb.textContent = 'YOU';
      badges.appendChild(yb);
    }
    card.appendChild(avatar); card.appendChild(nameEl); card.appendChild(badges);
    list.appendChild(card);
  });
  const count = entries.length;
  document.getElementById('lobby-status').textContent =
    count === 1 ? 'Waiting for more players... (1/40)' : `${count}/40 players connected`;
  if (isHost) {
    const startBtn = document.getElementById('btn-start-game');
    startBtn.disabled = count < 1;
    startBtn.textContent = count < 2 ? '▶ Start Solo' : '▶ Start Game';
  }
}

async function hostStartGame() {
  const startBtn = document.getElementById('btn-start-game');
  startBtn.disabled = true;
  await update(dbRef('rooms', roomCode), {
    status: 'playing', 'game/level': 1, 'game/round': 0,
    'game/phase': 'countdown',
    'game/roundSeed': Math.floor(Math.random() * 100000),
    'game/roundStartTime': serverTimestamp()
  });
}

// ============================================================
// GAME START
// ============================================================
function startGame() {
  clearListeners();
  updatePlayerCache();
  doCountdown(() => startLevel1());
}

function updatePlayerCache() {
  get(dbRef('rooms', roomCode, 'players')).then(s => { if (s.exists()) players = s.val(); });
}

// ============================================================
// COUNTDOWN
// ============================================================
function doCountdown(cb) {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-num');
  let count = 3;
  overlay.classList.remove('hidden');
  numEl.textContent = count;
  animateCountdownNum(numEl);
  sfxCountdown();
  const tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(tick);
      numEl.textContent = 'GO!';
      sfxGo();
      animateCountdownNum(numEl);
      setTimeout(() => { overlay.classList.add('hidden'); cb(); }, 700);
    } else {
      numEl.textContent = count;
      sfxCountdown();
      animateCountdownNum(numEl);
    }
  }, 900);
}

function animateCountdownNum(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'popIn 0.5s ease';
}

// ============================================================
// LEVEL 1 — SPOT THE DIFFERENCE 🎨
// ============================================================
const L1_ROUNDS = 6;
const L1_CFG = [
  { grid: 3, time: 12 },
  { grid: 4, time: 10 },
  { grid: 4, time: 9  },
  { grid: 5, time: 8  },
  { grid: 5, time: 7  },
  { grid: 6, time: 6  }
];

// Pools of similar-looking emoji groups
const SPOT_POOLS = [
  { base: '🔵', odd: '🟣' },
  { base: '🟥', odd: '🟧' },
  { base: '⭐', odd: '🌟' },
  { base: '🍎', odd: '🍅' },
  { base: '🐶', odd: '🐱' },
  { base: '🌙', odd: '☀️' },
  { base: '💎', odd: '🔷' },
  { base: '🎯', odd: '🎪' },
  { base: '🌿', odd: '🌱' },
  { base: '🔔', odd: '🔕' },
  { base: '👁️', odd: '👀' },
  { base: '🏠', odd: '🏡' },
];

function startLevel1() {
  l1Round = 0;
  showScreen('screen-level1');
  setupMuteButtons();
  syncScoresDisplay('l1-scores');
  nextL1Round();
}

function nextL1Round() {
  stopLocalTimer();
  if (l1Round >= L1_ROUNDS) { finishLevel(1); return; }
  const cfg = L1_CFG[l1Round];
  document.getElementById('l1-round').textContent = `${l1Round + 1}/${L1_ROUNDS}`;
  buildL1Grid(cfg);
  l1CanClick = true;
  startTimerLocal('l1-timer', 'l1-timer-bar', cfg.time, () => {
    l1CanClick = false;
    // Briefly reveal the odd one
    document.querySelectorAll('.spot-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    l1Round++;
    setTimeout(nextL1Round, 900);
  });
}

function buildL1Grid(cfg) {
  const grid = document.getElementById('spot-grid');
  grid.innerHTML = '';
  const n = cfg.grid;
  const total = n * n;
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;

  const pool = pick(SPOT_POOLS);
  const oddIdx = randInt(0, total - 1);

  // Occasionally flip the odd item instead of using different emoji
  const useFlip = Math.random() < 0.3;

  for (let i = 0; i < total; i++) {
    const el = document.createElement('div');
    el.className = 'spot-cell';
    const isOdd = i === oddIdx;
    if (isOdd) {
      el.classList.add('odd-cell');
      el.textContent = useFlip ? pool.base : pool.odd;
      if (useFlip) el.style.transform = 'scaleX(-1)';
    } else {
      el.textContent = pool.base;
    }
    el.addEventListener('click', () => handleL1Click(el, isOdd));
    grid.appendChild(el);
  }
}

function handleL1Click(el, isOdd) {
  if (!l1CanClick) return;
  l1CanClick = false;
  stopLocalTimer();
  if (isOdd) {
    el.classList.add('correct');
    addMyScore(100);
    sfxCorrect();
    showToast('✅ +100 pts!');
  } else {
    el.classList.add('wrong');
    document.querySelectorAll('.spot-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    sfxWrong();
    showToast('❌ Wrong!');
  }
  l1Round++;
  setTimeout(nextL1Round, 900);
}

// ============================================================
// LEVEL 2 — HUMAN OR AI? 🤖
// ============================================================
const L2_ROUNDS = 6;
const L2_CFG = [
  { time: 12 }, { time: 10 }, { time: 9 },
  { time: 8  }, { time: 7  }, { time: 6 }
];

const L2_SAMPLES = [
  // HUMAN samples
  { text: "omg i literally dropped my coffee this morning and it went EVERYWHERE. mondays are not it 😭☕", label: 'human', hint: 'Casual slang, typo energy, relatable moment' },
  { text: "just pulled an all-nighter for this presentation and honestly it's so mid. why do i do this to myself", label: 'human', hint: 'Authentic frustration, modern slang' },
  { text: "ok but can we talk about how unhinged it is that birds exist. like... flying dinosaurs. just vibing.", label: 'human', hint: 'Stream of consciousness, humor' },
  { text: "my dog looked me dead in the eyes and then knocked my phone off the table on purpose i KNOW it was on purpose", label: 'human', hint: 'Personal, emotional, storytelling' },
  { text: "ngl i cried at that movie trailer. just the trailer. 30 seconds. i need help", label: 'human', hint: 'Vulnerability, abbreviations, humor' },
  { text: "the wifi at my job is so bad that i genuinely downloaded 6 emails in the last 3 hours. this is not okay", label: 'human', hint: 'Specific complaint, frustration' },

  // AI samples
  { text: "As an AI language model, I understand that you may be experiencing some frustration. I want to assure you that your feelings are valid and there are many resources available to help you navigate this situation effectively.", label: 'ai', hint: 'Overly formal opener, generic validation' },
  { text: "The intersection of technology and human experience presents fascinating opportunities for growth. By leveraging data-driven insights, we can optimize our daily routines for maximum productivity and wellbeing.", label: 'ai', hint: 'Buzzwords, vague, no personality' },
  { text: "Greetings! I hope this message finds you in good health and high spirits. I am writing to express my enthusiasm regarding the topic you have raised, which I find to be quite thought-provoking indeed.", label: 'ai', hint: 'Stilted greeting, verbose formality' },
  { text: "In conclusion, it is important to note that various factors contribute to this multifaceted phenomenon. Further research may be beneficial in order to gain a comprehensive understanding of all relevant variables.", label: 'ai', hint: 'Filler conclusion, no actual opinion' },
  { text: "Certainly! I'd be happy to assist you with that. Here is a comprehensive overview of the subject matter that addresses your inquiry from multiple relevant perspectives:", label: 'ai', hint: 'Classic AI opener, hollow enthusiasm' },
  { text: "It is worth considering that the aforementioned situation presents both challenges and opportunities. From a holistic standpoint, one must weigh the pros and cons in a balanced and measured manner.", label: 'ai', hint: 'No stance, hedging, corporate speak' },
  // More tricky ones
  { text: "I stayed up way too late last night reading about black holes and now im scared but also amazed?? space is terrifying honestly", label: 'human', hint: 'Emotional contradiction, late-night curiosity' },
  { text: "Wow, what a fantastic question! There are actually several wonderful approaches you could take here. Each one has its own unique set of advantages that might suit different needs and preferences.", label: 'ai', hint: 'Hollow enthusiasm, non-committal answer' },
];

function startLevel2() {
  l2Round = 0;
  showScreen('screen-level2');
  setupMuteButtons();
  syncScoresDisplay('l2-scores');
  nextL2Round();
}

function nextL2Round() {
  stopLocalTimer();
  if (l2Round >= L2_ROUNDS) { finishLevel(2); return; }
  const cfg = L2_CFG[l2Round];
  const sample = L2_SAMPLES[l2Round % L2_SAMPLES.length];
  document.getElementById('l2-round').textContent = `${l2Round + 1}/${L2_ROUNDS}`;
  document.getElementById('l2-text-card').textContent = sample.text;
  document.getElementById('l2-feedback').textContent = '';
  document.getElementById('l2-feedback').className = 'l2-feedback';

  // Reset buttons
  document.querySelectorAll('.hai-btn').forEach(b => {
    b.disabled = false;
    b.classList.remove('correct-pick', 'wrong-pick');
  });

  l2CanClick = true;
  startTimerLocal('l2-timer', 'l2-timer-bar', cfg.time, () => {
    l2CanClick = false;
    document.querySelectorAll('.hai-btn').forEach(b => b.disabled = true);
    showL2Feedback(null, sample);
    l2Round++;
    setTimeout(nextL2Round, 1600);
  });
}

function handleL2Click(chosen) {
  if (!l2CanClick) return;
  l2CanClick = false;
  stopLocalTimer();
  document.querySelectorAll('.hai-btn').forEach(b => b.disabled = true);
  const sample = L2_SAMPLES[l2Round % L2_SAMPLES.length];
  const correct = chosen === sample.label;
  const btn = document.querySelector(`.hai-btn[data-val="${chosen}"]`);
  if (correct) {
    btn.classList.add('correct-pick');
    addMyScore(100);
    sfxCorrect();
  } else {
    btn.classList.add('wrong-pick');
    sfxWrong();
  }
  showL2Feedback(correct, sample);
  l2Round++;
  setTimeout(nextL2Round, 1600);
}

function showL2Feedback(correct, sample) {
  const fb = document.getElementById('l2-feedback');
  const isAI = sample.label === 'ai';
  if (correct === null) {
    fb.textContent = `⏱ Time's up! It was ${isAI ? '🤖 AI' : '👤 Human'}. Clue: ${sample.hint}`;
    fb.className = 'l2-feedback timeout';
  } else if (correct) {
    fb.textContent = `✅ Correct! It was ${isAI ? '🤖 AI' : '👤 Human'}. +100 pts`;
    fb.className = 'l2-feedback correct';
  } else {
    fb.textContent = `❌ Wrong! It was ${isAI ? '🤖 AI' : '👤 Human'}. Clue: ${sample.hint}`;
    fb.className = 'l2-feedback wrong';
  }
}
// ============================================================
// LEVEL 3 — REAL OR AI IMAGE? 🖼️
// ============================================================

const L3_ROUNDS = 6;

const L3_CFG = [
  { time: 12 },
  { time: 10 },
  { time: 9  },
  { time: 8  },
  { time: 7  },
  { time: 6  }
];

// REAL PHOTOS + AI IMAGES
const L3_IMAGES = [

  // REAL
  {
    image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=1200&auto=format&fit=crop',
    caption: 'Mountain sunset landscape',
    label: 'real',
    tell: 'Natural lighting and realistic environment'
  },

  // AI
  {
    image: 'https://images.unsplash.com/photo-1546182990-dffeafbe841d?q=80&w=1200&auto=format&fit=crop',
    caption: 'Dog portrait with strange anatomy',
    label: 'ai',
    tell: 'Distorted body structure and unrealistic details'
  },

  // REAL
  {
    image: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?q=80&w=1200&auto=format&fit=crop',
    caption: 'Forest hiking trail',
    label: 'real',
    tell: 'Consistent shadows and natural depth'
  },

  // AI
  {
    image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?q=80&w=1200&auto=format&fit=crop',
    caption: 'Office workers with warped fingers',
    label: 'ai',
    tell: 'Unnatural hands and distorted proportions'
  },

  // REAL
  {
    image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1200&auto=format&fit=crop',
    caption: 'City skyline at sunset',
    label: 'real',
    tell: 'Real reflections and perspective'
  },

  // AI
  {
    image: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=1200&auto=format&fit=crop',
    caption: 'Portrait with unrealistic facial details',
    label: 'ai',
    tell: 'Artificial facial texture and symmetry issues'
  }

];

function startLevel3() {
  l3Round = 0;

  showScreen('screen-level3');

  setupMuteButtons();

  syncScoresDisplay('l3-scores');

  nextL3Round();
}

function nextL3Round() {

  stopLocalTimer();

  if (l3Round >= L3_ROUNDS) {
    finishLevel(3);
    return;
  }

  const cfg = L3_CFG[l3Round];

  const img = L3_IMAGES[l3Round % L3_IMAGES.length];

  document.getElementById('l3-round').textContent =
    `${l3Round + 1}/${L3_ROUNDS}`;

  document.getElementById('l3-feedback').textContent = '';

  document.getElementById('l3-feedback').className =
    'l3-feedback';

  buildL3Card(img);

  document.querySelectorAll('.rai-btn').forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('correct-pick', 'wrong-pick');
  });

  l3CanClick = true;

  startTimerLocal(
    'l3-timer',
    'l3-timer-bar',
    cfg.time,
    () => {

      l3CanClick = false;

      document.querySelectorAll('.rai-btn').forEach(btn => {
        btn.disabled = true;
      });

      showL3Feedback(null, img);

      l3Round++;

      setTimeout(nextL3Round, 1800);
    }
  );
}

function buildL3Card(img) {

  const card = document.getElementById('l3-image-card');

  card.innerHTML = `
    <img
      src="${img.image}"
      class="real-image"
      alt="Challenge image"
      draggable="false"
    />

    <div class="img-caption">
      ${img.caption}
    </div>
  `;
}

function handleL3Click(chosen) {

  if (!l3CanClick) return;

  l3CanClick = false;

  stopLocalTimer();

  document.querySelectorAll('.rai-btn').forEach(btn => {
    btn.disabled = true;
  });

  const img = L3_IMAGES[l3Round % L3_IMAGES.length];

  const correct = chosen === img.label;

  const btn = document.querySelector(
    `.rai-btn[data-val="${chosen}"]`
  );

  if (correct) {

    btn.classList.add('correct-pick');

    addMyScore(100);

    sfxCorrect();

  } else {

    btn.classList.add('wrong-pick');

    sfxWrong();
  }

  showL3Feedback(correct, img);

  l3Round++;

  setTimeout(nextL3Round, 1800);
}

function showL3Feedback(correct, img) {

  const fb = document.getElementById('l3-feedback');

  const label =
    img.label === 'ai'
      ? '🤖 AI Generated'
      : '📷 Real Photo';

  if (correct === null) {

    fb.textContent =
      `⏱ Time's up! It was ${label}. ${img.tell}`;

    fb.className = 'l3-feedback timeout';

  } else if (correct) {

    fb.textContent =
      `✅ Correct! ${label} — ${img.tell}. +100 pts`;

    fb.className = 'l3-feedback correct';

  } else {

    fb.textContent =
      `❌ Wrong! It was ${label} — ${img.tell}`;

    fb.className = 'l3-feedback wrong';
  }
}

// ============================================================
// LEVEL 4 — MEMORY & DISTRACTION PANIC 🧠
// ============================================================
const L4_ROUNDS = 5;
const L4_EMOJIS = ['🍎','⭐','🎲','🍌','🔥','💎','🎯','🌙','🎪','🦋','🚀','🎸'];
const L4_CFG = [
  { seqLen: 3, showTime: 6000, distractors: 0 },
  { seqLen: 4, showTime: 5000, distractors: 2 },
  { seqLen: 5, showTime: 4000, distractors: 3 },
  { seqLen: 5, showTime: 3000, distractors: 4 },
  { seqLen: 6, showTime: 2400, distractors: 5 }
];

const FAKE_POPUPS = [
  '🔔 YOU HAVE WON A PRIZE! Click here!',
  '⚠️ VIRUS DETECTED! Tap to remove!',
  '📱 New message from: Unknown',
  '🎁 Free gift waiting for you!',
  '❗ Your battery is critically low',
  '💬 Someone is typing...',
  '🔄 Update required immediately',
  '📢 URGENT: Verify your account',
];

function startLevel4() {
  l4Round = 0;
  showScreen('screen-level4');
  setupMuteButtons();
  syncScoresDisplay('l4-scores');
  nextL4Round();
}

function nextL4Round() {
  stopLocalTimer();
  clearL4Distractors();
  if (l4Round >= L4_ROUNDS) { finishLevel(4); return; }
  const cfg = L4_CFG[l4Round];
  document.getElementById('l4-round').textContent = `${l4Round + 1}/${L4_ROUNDS}`;
  l4Sequence = [];
  l4PlayerSeq = [];
  l4CanInput = false;

  for (let i = 0; i < cfg.seqLen; i++) l4Sequence.push(pick(L4_EMOJIS));

  const display = document.getElementById('l4-sequence-display');
  const prompt = document.getElementById('l4-prompt');
  const inputArea = document.getElementById('l4-input-area');
  const feedback = document.getElementById('l4-feedback');
  const distractorLayer = document.getElementById('l4-distractor-layer');

  feedback.textContent = '';
  inputArea.innerHTML = '';
  distractorLayer.innerHTML = '';
  display.innerHTML = l4Sequence.map(e => `<span class="mem-emoji">${e}</span>`).join('');
  prompt.textContent = 'Memorise the sequence!';
  display.classList.remove('hidden');

  const bar = document.getElementById('l4-flash-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  setTimeout(() => {
    bar.style.transition = `width ${cfg.showTime}ms linear`;
    bar.style.width = '0%';
  }, 50);

  // Spawn distractors during flash phase
  if (cfg.distractors > 0) {
    let spawnCount = 0;
    const interval = cfg.showTime / (cfg.distractors + 1);
    l4DistractorInterval = setInterval(() => {
      spawnCount++;
      spawnFakePopup(distractorLayer);
      if (spawnCount >= cfg.distractors) {
        clearInterval(l4DistractorInterval);
        l4DistractorInterval = null;
      }
    }, interval);
  }

  setTimeout(() => {
    clearL4Distractors();
    display.classList.add('hidden');
    prompt.textContent = 'Recreate the sequence!';
    bar.style.transition = 'none';
    bar.style.width = '0%';
    buildL4Input();
    l4CanInput = true;
    startTimerLocal('l4-timer', 'l4-timer-bar', 12, () => {
      l4CanInput = false;
      showL4Result(false);
    });
  }, cfg.showTime);
}

function spawnFakePopup(container) {
  const popup = document.createElement('div');
  popup.className = 'fake-popup';
  popup.textContent = pick(FAKE_POPUPS);
  popup.style.left = `${randInt(5, 65)}%`;
  popup.style.top  = `${randInt(10, 70)}%`;
  popup.onclick = () => popup.remove(); // clicking it dismisses (no penalty)
  container.appendChild(popup);
  setTimeout(() => { if (popup.parentNode) popup.remove(); }, 2000);
}

function clearL4Distractors() {
  if (l4DistractorInterval) { clearInterval(l4DistractorInterval); l4DistractorInterval = null; }
  const layer = document.getElementById('l4-distractor-layer');
  if (layer) layer.innerHTML = '';
}

function buildL4Input() {
  const inputArea = document.getElementById('l4-input-area');
  const slotArea = document.getElementById('l4-slots');
  inputArea.innerHTML = '';
  slotArea.innerHTML = '';

  const seqCounts = {};
  l4Sequence.forEach(e => { seqCounts[e] = (seqCounts[e] || 0) + 1; });
  const pool = Object.keys(seqCounts);
  while (pool.length < Math.min(L4_EMOJIS.length, l4Sequence.length + 3)) {
    const e = pick(L4_EMOJIS);
    if (!pool.includes(e)) pool.push(e);
  }

  shuffle(pool).forEach(emoji => {
    const maxUses = seqCounts[emoji] || 0;
    let usesLeft = maxUses;
    const btn = document.createElement('button');
    btn.className = 'mem-btn';
    btn.textContent = emoji;
    const updateBadge = () => {
      btn.dataset.uses = usesLeft;
      if (maxUses > 1) btn.setAttribute('data-count', usesLeft > 0 ? `×${usesLeft}` : '');
      btn.disabled = usesLeft <= 0;
    };
    updateBadge();
    btn.onclick = () => {
      if (!l4CanInput || usesLeft <= 0) return;
      usesLeft--;
      updateBadge();
      handleL4Pick(emoji);
    };
    inputArea.appendChild(btn);
  });

  for (let i = 0; i < l4Sequence.length; i++) {
    const slot = document.createElement('div');
    slot.className = 'mem-slot';
    slot.dataset.idx = i;
    slotArea.appendChild(slot);
  }
}

function handleL4Pick(emoji) {
  if (!l4CanInput) return;
  const idx = l4PlayerSeq.length;
  if (idx >= l4Sequence.length) return;
  l4PlayerSeq.push(emoji);
  const slots = document.querySelectorAll('.mem-slot');
  if (slots[idx]) { slots[idx].textContent = emoji; slots[idx].classList.add('filled'); }
  if (l4PlayerSeq.length === l4Sequence.length) {
    l4CanInput = false;
    stopLocalTimer();
    showL4Result(l4PlayerSeq.every((e, i) => e === l4Sequence[i]));
  }
}

function showL4Result(correct) {
  const feedback = document.getElementById('l4-feedback');
  const display = document.getElementById('l4-sequence-display');
  display.innerHTML = l4Sequence.map((e, i) => {
    const pe = l4PlayerSeq[i];
    const ok = pe === e;
    return `<span class="mem-emoji ${correct ? 'correct' : (pe ? (ok ? 'correct' : 'wrong') : 'missing')}">${e}</span>`;
  }).join('');
  display.classList.remove('hidden');
  if (correct) {
    addMyScore(150); sfxCorrect();
    feedback.textContent = '✅ Perfect memory! +150 pts';
    feedback.className = 'l4-feedback correct';
  } else {
    sfxWrong();
    feedback.textContent = '❌ Wrong order! Focus harder next time.';
    feedback.className = 'l4-feedback wrong';
  }
  l4Round++;
  setTimeout(nextL4Round, 1600);
}

// ============================================================
// LEVEL 5 — CROWDED SCREEN EXTREME 👀
// ============================================================
const L5_ROUNDS = 6;
const L5_CFG = [
  { time: 10, distractors: 4  },
  { time: 9,  distractors: 6  },
  { time: 8,  distractors: 8  },
  { time: 7,  distractors: 10 },
  { time: 6,  distractors: 12 },
  { time: 5,  distractors: 14 }
];

const CHAOS_EMOJIS = ['🔔','💬','⚠️','📱','🎁','❗','🔄','📢','💥','🌀','⭐','🔥','💎','🎯','🎪'];

// Mini-challenge types for chaos mode
const L5_CHALLENGES = [
  () => ({
    type: 'spot',
    pool: pick(SPOT_POOLS),
    generate(el) {
      const items = 9;
      el.innerHTML = '';
      const p = this.pool;
      const oddIdx = randInt(0, items - 1);
      el.style.display = 'grid';
      el.style.gridTemplateColumns = 'repeat(3,1fr)';
      el.style.gap = '6px';
      this.oddEl = null;
      for (let i = 0; i < items; i++) {
        const c = document.createElement('button');
        c.className = 'chaos-spot-cell';
        c.textContent = i === oddIdx ? p.odd : p.base;
        if (i === oddIdx) { this.oddEl = c; this.isOdd = true; }
        el.appendChild(c);
        c.onclick = () => this.onPick(i === oddIdx);
      }
    },
    prompt: 'Find the ODD ONE OUT! 🔍',
    onPick(correct) { this._resolve(correct); }
  }),
  () => ({
    type: 'hai',
    sample: pick(L2_SAMPLES),
    generate(el) {
      el.style.display = 'block';
      el.innerHTML = '';
      const card = document.createElement('div');
      card.className = 'chaos-text-card';
      card.textContent = this.sample.text;
      el.appendChild(card);
      const btns = document.createElement('div');
      btns.className = 'chaos-btns';
      ['human','ai'].forEach(v => {
        const b = document.createElement('button');
        b.className = 'hai-btn chaos-hai';
        b.dataset.val = v;
        b.textContent = v === 'human' ? '👤 Human' : '🤖 AI';
        b.onclick = () => this.onPick(v === this.sample.label);
        btns.appendChild(b);
      });
      el.appendChild(btns);
    },
    prompt: 'Human or AI? 🤖',
    onPick(correct) { this._resolve(correct); }
  }),
  () => {
    const target = pick(CHAOS_EMOJIS);
    const pool = shuffle([...CHAOS_EMOJIS]).slice(0, 6);
    if (!pool.includes(target)) pool[0] = target;
    return {
      type: 'find',
      target, pool: shuffle(pool),
      generate(el) {
        el.style.display = 'flex';
        el.style.flexWrap = 'wrap';
        el.style.gap = '8px';
        el.innerHTML = '';
        this.pool.forEach(e => {
          const b = document.createElement('button');
          b.className = 'chaos-find-btn';
          b.textContent = e;
          b.onclick = () => this.onPick(e === this.target);
          el.appendChild(b);
        });
      },
      prompt: `Tap: ${target}`,
      onPick(correct) { this._resolve(correct); }
    };
  }
];

function startLevel5() {
  l5Round = 0;
  showScreen('screen-level5');
  setupMuteButtons();
  syncScoresDisplay('l5-scores');
  nextL5Round();
}

function nextL5Round() {
  stopLocalTimer();
  stopL5Distractors();
  if (l5Round >= L5_ROUNDS) { finishLevel(5); return; }

  const cfg = L5_CFG[l5Round];
  document.getElementById('l5-round').textContent = `${l5Round + 1}/${L5_ROUNDS}`;
  document.getElementById('l5-feedback').textContent = '';

  // Pick and build a random mini-challenge
  const factory = pick(L5_CHALLENGES);
  const challenge = factory();
  challenge._resolve = null;
  l5CanClick = true;

  const arena = document.getElementById('l5-arena');
  const prompt = document.getElementById('l5-prompt');
  prompt.textContent = challenge.prompt;
  challenge.generate(arena);

  // Wire resolve
  challenge._resolve = (correct) => {
    if (!l5CanClick) return;
    l5CanClick = false;
    stopLocalTimer();
    stopL5Distractors();
    const fb = document.getElementById('l5-feedback');
    if (correct) {
      addMyScore(120); sfxCorrect();
      fb.textContent = '✅ +120 pts!';
      fb.className = 'l5-feedback correct';
    } else {
      sfxWrong();
      fb.textContent = '❌ Wrong!';
      fb.className = 'l5-feedback wrong';
    }
    // Disable all buttons
    arena.querySelectorAll('button').forEach(b => b.disabled = true);
    l5Round++;
    setTimeout(nextL5Round, 900);
  };

  // Spawn background chaos
  spawnL5Distractors(cfg.distractors);

  startTimerLocal('l5-timer', 'l5-timer-bar', cfg.time, () => {
    if (!l5CanClick) return;
    l5CanClick = false;
    stopL5Distractors();
    sfxWrong();
    const fb = document.getElementById('l5-feedback');
    fb.textContent = '⏱ Too slow!';
    fb.className = 'l5-feedback timeout';
    arena.querySelectorAll('button').forEach(b => b.disabled = true);
    l5Round++;
    setTimeout(nextL5Round, 900);
  });
}

function spawnL5Distractors(count) {
  const bg = document.getElementById('l5-distractor-bg');
  bg.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'chaos-distractor';
    el.textContent = pick(CHAOS_EMOJIS);
    const x = randInt(0, 85);
    const y = randInt(0, 85);
    const dur = rand(2, 5).toFixed(1);
    const delay = rand(0, 2).toFixed(1);
    el.style.cssText = `left:${x}%;top:${y}%;animation:chaosFloat ${dur}s ${delay}s ease-in-out infinite alternate;`;
    bg.appendChild(el);
  }
}

function stopL5Distractors() {
  const bg = document.getElementById('l5-distractor-bg');
  if (bg) bg.innerHTML = '';
}

// ============================================================
// SCORE SYNC
// ============================================================
function addMyScore(pts) {
  if (!myUid || !roomCode) return;
  if (!players[myUid]) players[myUid] = { score: 0 };
  players[myUid].score = (players[myUid].score || 0) + pts;
  updateAllScoreDisplays();
  get(dbRef('rooms', roomCode, 'players', myUid, 'score')).then(s => {
    const cur = s.val() || 0;
    update(dbRef('rooms', roomCode, 'players', myUid), { score: cur + pts });
  });
}

function syncScoresDisplay(containerId) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  listenOn(`rooms/${roomCode}/players`, snap => {
    players = snap.val() || {};
    renderScoreChips(cont);
  });
}

function updateAllScoreDisplays() {
  ['l1-scores','l2-scores','l3-scores','l4-scores','l5-scores'].forEach(id => {
    const cont = document.getElementById(id);
    if (cont && cont.childElementCount > 0) renderScoreChips(cont);
  });
}

function renderScoreChips(container) {
  const sorted = Object.entries(players).sort((a,b) => (b[1].score||0)-(a[1].score||0));
  container.innerHTML = '';
  sorted.forEach(([uid,p], idx) => {
    const chip = document.createElement('div');
    chip.className = 'score-chip' + (idx===0 ? ' leader' : '');
    chip.innerHTML = `<span class="chip-name">${p.name}</span><span class="chip-score">${p.score||0}</span>`;
    container.appendChild(chip);
  });
}

// ============================================================
// GAME STATE LISTENER
// ============================================================
function listenGameSync(cb) {
  listenOn(`rooms/${roomCode}/game`, snap => {
    if (!snap.exists()) return;
    gameState = snap.val();
    cb(gameState);
  });
}

// ============================================================
// BETWEEN LEVELS / LEADERBOARD
// ============================================================
function finishLevel(levelNum) {
  stopLocalTimer();
  clearL4Distractors();
  stopL5Distractors();
  sfxLevelUp();
  get(dbRef('rooms', roomCode, 'players')).then(snap => {
    players = snap.val() || {};
    showBetweenScreen(levelNum);
  });
}

function showBetweenScreen(levelNum) {
  const nextLevel = levelNum + 1;
  document.getElementById('between-title').textContent =
    levelNum < 5 ? `Level ${levelNum} Complete! 🎉` : 'Final Level Done! 🏆';
  document.getElementById('between-sub').textContent = `Leaderboard after Level ${levelNum}`;
  renderLeaderboard('leaderboard-between', players);
  showScreen('screen-between');

  const nextBtn = document.getElementById('btn-next-level');
  const cd = document.getElementById('between-countdown');

  if (isHost) {
    nextBtn.classList.remove('hidden');
    nextBtn.disabled = false;
    nextBtn.textContent = nextLevel <= 5 ? `Next Level →` : 'See Results →';
    nextBtn.onclick = () => {
      nextBtn.disabled = true;
      sfxClick();
      const nextLvl = levelNum < 5 ? levelNum + 1 : 'results';
      update(dbRef('rooms', roomCode), { 'game/level': nextLvl });
      doCountdown(() => {
        if (levelNum === 1) startLevel2();
        else if (levelNum === 2) startLevel3();
        else if (levelNum === 3) startLevel4();
        else if (levelNum === 4) startLevel5();
        else showFinalResults();
      });
    };
    cd.textContent = '';
  } else {
    nextBtn.classList.add('hidden');
    cd.textContent = 'Waiting for host to continue...';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/level`, snap => {
      const lvl = snap.val();
      if (lvl === 'results') { clearListeners(); showFinalResults(); return; }
      if (lvl > levelNum) {
        clearListeners();
        doCountdown(() => {
          if (lvl === 2) startLevel2();
          else if (lvl === 3) startLevel3();
          else if (lvl === 4) startLevel4();
          else if (lvl === 5) startLevel5();
        });
      }
    });
  }
}

// ============================================================
// FINAL RESULTS
// ============================================================
function showFinalResults() {
  stopLocalTimer();
  clearL4Distractors();
  stopL5Distractors();
  stopJazz();
  get(dbRef('rooms', roomCode, 'players')).then(snap => {
    players = snap.val() || {};
    renderResults();
  });
}

function renderResults() {
  const sorted = Object.entries(players)
    .sort((a,b) => (b[1].score||0)-(a[1].score||0))
    .map(([uid,p],i) => ({uid,...p,rank:i+1}));

  const podium = document.getElementById('podium');
  podium.innerHTML = '';
  const podiumOrder = sorted.length >= 2
    ? [sorted[1], sorted[0], sorted[2], sorted[3], sorted[4]].filter(Boolean)
    : sorted;
  const medals = ['🥈','🥇','🥉','4️⃣','5️⃣'];
  const heights = ['70px','90px','55px','45px','40px'];

  podiumOrder.forEach((p,i) => {
    const realRank = sorted.findIndex(s => s.uid === p.uid) + 1;
    const block = document.createElement('div');
    block.className = `podium-block rank-${realRank}`;
    block.innerHTML = `
      <div class="podium-name">${p.name}${p.uid===myUid?' (you)':''}</div>
      <div class="podium-score">${p.score||0} pts</div>
      <div class="podium-platform" style="min-height:${heights[i]}">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-pos">#${realRank}</div>
      </div>`;
    podium.appendChild(block);
  });

  renderLeaderboard('full-leaderboard', players, true);

  const paBtn = document.getElementById('btn-play-again');
  if (isHost) {
    paBtn.classList.remove('hidden');
    paBtn.onclick = () => { sfxClick(); resetGame(); };
  } else {
    paBtn.classList.add('hidden');
  }
  showScreen('screen-results');
  if (sorted[0]?.uid === myUid) spawnConfetti();
}

function renderLeaderboard(containerId, playerData, isFinal = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const sorted = Object.entries(playerData).sort((a,b) => (b[1].score||0)-(a[1].score||0));
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',
    ...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i) => {
    const row = document.createElement('div');
    row.className = `lb-row rank-${i+1}`;
    const nameEl = `<span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span>`;
    row.innerHTML = `<span class="lb-rank">${medals[i]||i+1}</span>${nameEl}<span class="lb-score">${p.score||0}</span>`;
    container.appendChild(row);
  });
}

// ============================================================
// TIMER
// ============================================================
function startTimerLocal(timerId, barId, seconds, onEnd) {
  stopLocalTimer();
  let remaining = seconds;
  const timerEl = document.getElementById(timerId);
  const barEl   = document.getElementById(barId);
  if (timerEl) { timerEl.textContent = remaining; timerEl.classList.remove('warn'); }
  if (barEl)   { barEl.style.width = '100%'; barEl.classList.remove('warn'); }
  localTimerId = setInterval(() => {
    remaining--;
    if (timerEl) {
      timerEl.textContent = remaining;
      if (remaining <= 3) { timerEl.classList.add('warn'); sfxTimerWarn(); }
    }
    if (barEl) {
      barEl.style.width = Math.max(0,(remaining/seconds)*100) + '%';
      if (remaining <= 3) barEl.classList.add('warn');
    }
    if (remaining <= 0) { stopLocalTimer(); onEnd(); }
  }, 1000);
  localTimerRemaining = seconds;
}

// ============================================================
// MUTE BUTTONS
// ============================================================
function setupMuteButtons() {
  document.querySelectorAll('.btn-mute').forEach(btn => {
    btn.textContent = musicOn ? '🎵' : '🔇';
    btn.onclick = toggleMusic;
  });
}

// ============================================================
// CONFETTI
// ============================================================
function spawnConfetti() {
  const colors = ['#e94560','#4f8ef7','#4ade80','#fbbf24','#c084fc'];
  for (let i = 0; i < 60; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.cssText = `left:${rand(10,90)}vw;top:-10px;width:${rand(6,12)}px;height:${rand(6,12)}px;background:${pick(colors)};border-radius:${Math.random()>0.5?'50%':'2px'};animation:confettiFall ${rand(1.5,3)}s linear forwards;`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    }, i * 40);
  }
  if (!document.getElementById('confetti-style')) {
    const s = document.createElement('style');
    s.id = 'confetti-style';
    s.textContent = `@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(720deg);opacity:0}}`;
    document.head.appendChild(s);
  }
}

// ============================================================
// RESET / NAVIGATION
// ============================================================
async function resetGame() {
  if (isHost && roomCode) {
    const updates = {};
    Object.keys(players).forEach(uid => { updates[`players/${uid}/score`] = 0; });
    updates['game/level'] = 1; updates['game/round'] = 0;
    updates['game/phase'] = 'countdown';
    updates['game/roundSeed'] = Math.floor(Math.random() * 100000);
    updates['status'] = 'lobby';
    await update(dbRef('rooms', roomCode), updates);
  }
  clearListeners(); stopLocalTimer(); clearL4Distractors(); stopL5Distractors();
  Object.keys(players).forEach(uid => { if (players[uid]) players[uid].score = 0; });
  openLobby();
}

function resetToMenu() {
  clearListeners(); stopLocalTimer(); clearL4Distractors(); stopL5Distractors(); stopJazz();
  players = {}; roomCode = ''; isHost = false;
  showScreen('screen-menu');
}

// ============================================================
// BUTTONS
// ============================================================
document.getElementById('btn-create').addEventListener('click', () => {
  sfxClick();
  document.getElementById('modal-create').classList.remove('hidden');
  document.getElementById('input-host-name').focus();
});
document.getElementById('btn-create-cancel').addEventListener('click', () => {
  document.getElementById('modal-create').classList.add('hidden');
});
document.getElementById('btn-create-confirm').addEventListener('click', async () => {
  const name = document.getElementById('input-host-name').value.trim();
  if (!name) { showError('create-error','Please enter your name.'); return; }
  document.getElementById('btn-create-confirm').disabled = true;
  sfxClick();
  try {
    await createRoom(name);
    document.getElementById('modal-create').classList.add('hidden');
  } catch(e) {
    showError('create-error','Failed to create room. Check Firebase config.');
    console.error(e);
  }
  document.getElementById('btn-create-confirm').disabled = false;
});
document.getElementById('btn-join-open').addEventListener('click', () => {
  sfxClick();
  document.getElementById('modal-join').classList.remove('hidden');
  document.getElementById('input-name').focus();
});
document.getElementById('btn-join-cancel').addEventListener('click', () => {
  document.getElementById('modal-join').classList.add('hidden');
});
document.getElementById('btn-join-confirm').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!name) { showError('join-error','Enter your name.'); return; }
  if (code.length < 4) { showError('join-error','Enter the 4-character room code.'); return; }
  document.getElementById('btn-join-confirm').disabled = true;
  sfxClick();
  const err = await joinRoom(name, code);
  if (err) { showError('join-error', err); }
  else { document.getElementById('modal-join').classList.add('hidden'); }
  document.getElementById('btn-join-confirm').disabled = false;
});
document.getElementById('btn-copy-code').addEventListener('click', () => {
  navigator.clipboard?.writeText(roomCode).catch(() => {});
  showToast('Room code copied!');
});
document.getElementById('btn-leave-lobby').addEventListener('click', async () => {
  sfxClick();
  if (roomCode && myUid) {
    await remove(dbRef('rooms', roomCode, 'players', myUid));
    if (isHost) await remove(dbRef('rooms', roomCode));
  }
  resetToMenu();
});
document.getElementById('btn-main-menu').addEventListener('click', () => { sfxClick(); resetToMenu(); });
document.getElementById('btn-gameover-menu').addEventListener('click', () => { sfxClick(); resetToMenu(); });
document.getElementById('btn-gameover-again').addEventListener('click', () => { sfxClick(); resetGame(); });

// ============================================================
// KEYBOARD SUPPORT
// ============================================================
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const cm = document.getElementById('modal-create');
    const jm = document.getElementById('modal-join');
    if (!cm.classList.contains('hidden')) document.getElementById('btn-create-confirm').click();
    else if (!jm.classList.contains('hidden')) document.getElementById('btn-join-confirm').click();
  }
  if (e.key === 'Escape') {
    document.getElementById('modal-create').classList.add('hidden');
    document.getElementById('modal-join').classList.add('hidden');
  }
});
document.getElementById('input-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });

// ============================================================
// AUTOPLAY FIX
// ============================================================
document.addEventListener('click', () => { if (musicOn && !jazzInterval) startJazz(); }, { once: true });

// ============================================================
// BOOT
// ============================================================
async function boot() {
  document.getElementById('loading-msg').textContent = 'Connecting...';
  showScreen('screen-loading');
  try {
    await initAuth();
    initConnectionMonitor();
    document.getElementById('loading-msg').textContent = 'Ready!';
    await new Promise(r => setTimeout(r, 600));
    showScreen('screen-menu');
  } catch(e) {
    document.getElementById('loading-msg').textContent = 'Firebase connection failed. Check your config in firebase.js';
    console.error('Boot error:', e);
  }
}

boot();

// ===== EXPOSE CLICK HANDLERS (module scope fix) =====
window.handleL2Click = handleL2Click;
window.handleL3Click = handleL3Click;
