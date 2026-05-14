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

const sfxCorrect = () => { playTone(880, 'sine', 0.12, 0.25); playTone(1100, 'sine', 0.12, 0.22, 0.1); };
const sfxWrong = () => playTone(200, 'sawtooth', 0.22, 0.25);
const sfxCountdown = () => playTone(440, 'square', 0.1, 0.18);
const sfxGo = () => [523, 659, 784].forEach((f, i) => playTone(f, 'sine', 0.1, 0.25, i * 0.06));
const sfxTimerWarn = () => playTone(330, 'triangle', 0.08, 0.12);
const sfxLevelUp = () => [523, 659, 784, 1047].forEach((f, i) => playTone(f, 'sine', 0.18, 0.25, i * 0.12));
const sfxClick = () => playTone(660, 'triangle', 0.06, 0.12);

const JAZZ_CHORDS = [
  [261, 330, 392, 494], [294, 370, 440, 554], [349, 440, 523, 659],
  [392, 494, 587, 740], [330, 415, 494, 622], [261, 330, 392, 523]
];

function playJazzChord() {
  if (!musicOn) return;
  const chord = JAZZ_CHORDS[jazzStep % JAZZ_CHORDS.length];
  chord.forEach((f, i) => playTone(f / 2, 'sine', 0.5, 0.055, i * 0.04));
  playTone(chord[0] / 4, 'triangle', 0.55, 0.09);
  jazzStep++;
}

function startJazz() {
  stopJazz();
  if (!musicOn) return;
  playJazzChord();
  jazzInterval = setInterval(playJazzChord, 1400);
}

function stopJazz() {
  if (jazzInterval) { clearInterval(jazzInterval); jazzInterval = null; }
}

function toggleMusic() {
  musicOn = !musicOn;
  const btns = document.querySelectorAll('.btn-mute');
  btns.forEach(b => b.textContent = musicOn ? '🎵' : '🔇');
  if (musicOn) startJazz(); else stopJazz();
}

// ============================================================
// STATE
// ============================================================
let myUid = null;
let myName = '';
let roomCode = '';
let isHost = false;
let players = {};       // uid → { name, score, ready, color }
let gameState = {};     // from Firebase
let activeListeners = [];
let localTimerId = null;
let localTimerRemaining = 0;
let l1CanClick = false;
let l2CanClick = false;
let l3CanHit = false;
let l3Hits = 0;
let l3Target = '';
let l3NeedHits = 5;
let fruitObjects = [];   // { el, x, y, vx, vy, emoji, tapped }
let rafId = null;
let lastTime = 0;
let arenaW = 0, arenaH = 0;
const FRUIT_SIZE = 36;

// Level 4 — Memory Flash
let l4Round = 0;
let l4Sequence = [];
let l4PlayerSeq = [];
let l4CanInput = false;

// Level 5 — Reverse Controls
let l5Round = 0;
let l5CanClick = false;

// ============================================================
// UTILS
// ============================================================
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const AVATAR_COLORS = ['avatar-0', 'avatar-1', 'avatar-2', 'avatar-3'];
function playerColor(idx) { return AVATAR_COLORS[idx % 4]; }
function playerInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

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
  return Array.from({ length: 4 }, () => chars[randInt(0, chars.length - 1)]).join('');
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

function stopFruitAnimation() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

// ============================================================
// AUTH
// ============================================================
async function initAuth() {
  document.getElementById('loading-msg').textContent = 'Authenticating...';
  await signInAnonymously(auth);
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        myUid = user.uid;
        unsub();
        resolve();
      }
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
  if (snap.exists()) {
    roomCode = genRoomCode(); // try once more
  }

  const presenceRef = dbRef('rooms', roomCode, 'players', myUid);
  await onDisconnect(presenceRef).remove();

  await set(roomRef, {
    host: myUid,
    status: 'lobby',
    created: serverTimestamp(),
    players: {
      [myUid]: { name: myName, score: 0, color: 0, ready: true }
    },
    game: {
      level: 0,
      round: 0,
      roundSeed: 0,
      phase: 'waiting'
    }
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
  if (!roomSnap.exists()) { return 'Room not found.'; }

  const data = roomSnap.val();
  if (data.status !== 'lobby') { return 'Game already started.'; }

  const existingPlayers = data.players || {};
  const playerList = Object.keys(existingPlayers);
  if (playerList.length >= 4) { return 'Room is full (max 4 players).'; }

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

    // If we were kicked or room removed
    if (!players[myUid]) {
      showToast('You were removed from the room.');
      resetToMenu();
    }
  });

  listenOn(`rooms/${roomCode}/status`, snap => {
    const status = snap.val();
    if (status === 'playing') {
      clearListeners();
      startGame();
    }
  });

  listenOn(`rooms/${roomCode}`, snap => {
    if (!snap.exists()) {
      showToast('Room closed.');
      resetToMenu();
    }
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

    const roomData = { host: '' };
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

    card.appendChild(avatar);
    card.appendChild(nameEl);
    card.appendChild(badges);
    list.appendChild(card);
  });

  const count = entries.length;
  document.getElementById('lobby-status').textContent =
    count === 1 ? 'Waiting for more players... (1/4)' : `${count}/4 players connected`;

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
    status: 'playing',
    'game/level': 1,
    'game/round': 0,
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
  get(dbRef('rooms', roomCode, 'players')).then(s => {
    if (s.exists()) players = s.val();
  });
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
      setTimeout(() => {
        overlay.classList.add('hidden');
        cb();
      }, 700);
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
// LEVEL 1 — COLOR VISION
// ============================================================
const L1_ROUNDS = 7;
const L1_CFG = [
  { grid: 4, time: 14, hueDiff: 30 },
  { grid: 4, time: 12, hueDiff: 24 },
  { grid: 4, time: 11, hueDiff: 18 },
  { grid: 5, time: 10, hueDiff: 14 },
  { grid: 5, time: 9,  hueDiff: 10 },
  { grid: 5, time: 8,  hueDiff: 8  },
  { grid: 6, time: 7,  hueDiff: 6  }
];

let l1Round = 0;

function startLevel1() {
  l1Round = 0;
  showScreen('screen-level1');
  setupMuteButtons();
  syncScoresDisplay('l1-scores');
  listenGameSync(() => {
    // host drives rounds; all players listen
  });
  nextL1Round();
}

function nextL1Round() {
  stopLocalTimer();
  if (l1Round >= L1_ROUNDS) {
    finishLevel(1);
    return;
  }
  const cfg = L1_CFG[l1Round];
  document.getElementById('l1-round').textContent = `${l1Round + 1}/${L1_ROUNDS}`;
  buildL1Grid(cfg, l1Round * 7777 + 1);
  l1CanClick = true;
  startTimerLocal('l1-timer', 'l1-timer-bar', cfg.time, () => {
    l1CanClick = false;
    l1Round++;
    setTimeout(nextL1Round, 600);
  });
}

function buildL1Grid(cfg, seed) {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = '';
  const n = cfg.grid;
  const total = n * n;
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;

  // deterministic odd index from seed
  const oddIdx = seed % total;
  const baseHue = (seed * 37) % 360;
  const oddHue = (baseHue + cfg.hueDiff) % 360;
  const sat = 55 + (seed % 20);
  const lit = 50 + (seed % 15);

  for (let i = 0; i < total; i++) {
    const el = document.createElement('div');
    el.className = 'color-cell';
    const hue = i === oddIdx ? oddHue : baseHue;
    el.style.background = `hsl(${hue},${sat}%,${lit}%)`;
    el.addEventListener('click', () => handleL1Click(el, i === oddIdx));
    grid.appendChild(el);
  }
}

function handleL1Click(el, isCorrect) {
  if (!l1CanClick) return;
  l1CanClick = false;
  stopLocalTimer();

  if (isCorrect) {
    el.classList.add('correct');
    addMyScore(100);
    sfxCorrect();
    showToast('✅ +100 pts!');
  } else {
    el.classList.add('wrong');
    sfxWrong();
    showToast('❌ Wrong!');
  }
  l1Round++;
  setTimeout(nextL1Round, 800);
}

// ============================================================
// LEVEL 2 — SPELLING
// ============================================================
const WORD_DATA = [
  { correct: 'banana',    options: ['banana',    'bananna',   'bananah']   },
  { correct: 'calendar',  options: ['calender',  'calendar',  'calandar']  },
  { correct: 'receive',   options: ['recieve',   'receive',   'receeve']   },
  { correct: 'necessary', options: ['necessary', 'neccessary','necessery'] },
  { correct: 'separate',  options: ['seperate',  'separete',  'separate']  },
  { correct: 'achieve',   options: ['acheive',   'achieve',   'acheeve']   },
  { correct: 'occurred',  options: ['occured',   'occurred',  'ocurred']   }
];

let l2Round = 0;

function startLevel2() {
  l2Round = 0;
  showScreen('screen-level2');
  setupMuteButtons();
  syncScoresDisplay('l2-scores');
  nextL2Round();
}

function nextL2Round() {
  stopLocalTimer();
  if (l2Round >= 5) {
    finishLevel(2);
    return;
  }
  const data = WORD_DATA[l2Round % WORD_DATA.length];
  document.getElementById('l2-round').textContent = `${l2Round + 1}/5`;
  document.getElementById('word-prompt').textContent = 'Which is spelled correctly?';

  const container = document.getElementById('word-options');
  container.innerHTML = '';
  shuffle(data.options).forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'word-btn';
    btn.textContent = opt;
    btn.onclick = () => handleL2Click(btn, opt === data.correct, data.correct);
    container.appendChild(btn);
  });

  l2CanClick = true;
  startTimerLocal('l2-timer', 'l2-timer-bar', 8, () => {
    l2CanClick = false;
    // reveal correct
    document.querySelectorAll('.word-btn').forEach(b => {
      if (b.textContent === data.correct) b.classList.add('correct-pick');
      b.disabled = true;
    });
    l2Round++;
    setTimeout(nextL2Round, 1000);
  });
}

function handleL2Click(btn, isCorrect, correctWord) {
  if (!l2CanClick) return;
  l2CanClick = false;
  stopLocalTimer();
  document.querySelectorAll('.word-btn').forEach(b => b.disabled = true);

  if (isCorrect) {
    btn.classList.add('correct-pick');
    addMyScore(100);
    sfxCorrect();
    showToast('✅ +100 pts!');
  } else {
    btn.classList.add('wrong-pick');
    document.querySelectorAll('.word-btn').forEach(b => {
      if (b.textContent === correctWord) b.classList.add('correct-pick');
    });
    sfxWrong();
    showToast('❌ Wrong!');
  }
  l2Round++;
  setTimeout(nextL2Round, 1000);
}

// ============================================================
// LEVEL 3 — MOVING FRUITS
// ============================================================
const ALL_FRUITS = ['🍎','🍌','🍇','🍓','🍍','🍊','🫐','🍑'];
let l3Round = 0;

function startLevel3() {
  l3Round = 0;
  showScreen('screen-level3');
  setupMuteButtons();
  syncScoresDisplay('l3-scores');
  nextL3Round();
}

function nextL3Round() {
  stopLocalTimer();
  stopFruitAnimation();
  fruitObjects = [];

  if (l3Round >= 5) {
    finishLevel(3);
    return;
  }

  l3Hits = 0;
  l3NeedHits = 5;
  l3CanHit = true;
  document.getElementById('l3-round').textContent = `${l3Round + 1}/5`;

  l3Target = ALL_FRUITS[randInt(0, ALL_FRUITS.length - 1)];
  document.getElementById('l3-target').textContent = l3Target;
  document.getElementById('l3-hits').textContent = `0/${l3NeedHits}`;

  const arena = document.getElementById('l3-arena');
  arena.innerHTML = '';
  arenaW = arena.offsetWidth || 360;
  arenaH = arena.offsetHeight || 220;

  const totalFruits = 14;
  const targetCount = l3NeedHits;
  const fruitList = [];
  for (let i = 0; i < targetCount; i++) fruitList.push(l3Target);
  while (fruitList.length < totalFruits) {
    const f = ALL_FRUITS[randInt(0, ALL_FRUITS.length - 1)];
    if (f !== l3Target) fruitList.push(f);
  }
  shuffle(fruitList);

  fruitList.forEach((emoji, idx) => {
    const el = document.createElement('div');
    el.className = 'fruit';
    el.textContent = emoji;
    el.style.fontSize = FRUIT_SIZE + 'px';

    const x = rand(4, arenaW - FRUIT_SIZE - 4);
    const y = rand(4, arenaH - FRUIT_SIZE - 4);
    const speed = rand(25, 60);
    const angle = rand(0, Math.PI * 2);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    el.style.left = x + 'px';
    el.style.top = y + 'px';

    const fObj = { el, x, y, vx, vy, emoji, tapped: false };
    fruitObjects.push(fObj);
    arena.appendChild(el);

    el.addEventListener('click', () => handleL3Tap(fObj));
    el.addEventListener('touchstart', e => { e.preventDefault(); handleL3Tap(fObj); }, { passive: false });
  });

  lastTime = performance.now();
  animateFruits();

  startTimerLocal('l3-timer', 'l3-timer-bar', 14, () => {
    l3CanHit = false;
    stopFruitAnimation();
    l3Round++;
    showToast(`⏱ Wave over! ${l3Hits}/${l3NeedHits} found`);
    setTimeout(nextL3Round, 800);
  });
}

function animateFruits() {
  rafId = requestAnimationFrame(now => {
    const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = now;

    for (let i = 0; i < fruitObjects.length; i++) {
      const f = fruitObjects[i];
      if (f.tapped) continue;

      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // Wall bounce
      if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx); }
      if (f.x > arenaW - FRUIT_SIZE) { f.x = arenaW - FRUIT_SIZE; f.vx = -Math.abs(f.vx); }
      if (f.y < 0) { f.y = 0; f.vy = Math.abs(f.vy); }
      if (f.y > arenaH - FRUIT_SIZE) { f.y = arenaH - FRUIT_SIZE; f.vy = -Math.abs(f.vy); }

      // Simple circle collision
      for (let j = i + 1; j < fruitObjects.length; j++) {
        const g = fruitObjects[j];
        if (g.tapped) continue;
        const dx = (f.x + FRUIT_SIZE / 2) - (g.x + FRUIT_SIZE / 2);
        const dy = (f.y + FRUIT_SIZE / 2) - (g.y + FRUIT_SIZE / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < FRUIT_SIZE && dist > 0) {
          const nx = dx / dist, ny = dy / dist;
          const relVx = f.vx - g.vx, relVy = f.vy - g.vy;
          const dot = relVx * nx + relVy * ny;
          if (dot < 0) {
            f.vx -= dot * nx; f.vy -= dot * ny;
            g.vx += dot * nx; g.vy += dot * ny;
            const overlap = (FRUIT_SIZE - dist) / 2;
            f.x += nx * overlap; f.y += ny * overlap;
            g.x -= nx * overlap; g.y -= ny * overlap;
          }
        }
      }

      f.el.style.left = f.x + 'px';
      f.el.style.top = f.y + 'px';
    }

    animateFruits();
  });
}

function handleL3Tap(fObj) {
  if (!l3CanHit || fObj.tapped) return;
  if (fObj.emoji === l3Target) {
    fObj.tapped = true;
    fObj.el.classList.add('popped');
    l3Hits++;
    addMyScore(50);
    sfxCorrect();
    document.getElementById('l3-hits').textContent = `${l3Hits}/${l3NeedHits}`;
    showToast(`🎯 +50 pts!`);
    setTimeout(() => fObj.el.remove(), 250);
    if (l3Hits >= l3NeedHits) {
      l3CanHit = false;
      stopLocalTimer();
      stopFruitAnimation();
      sfxLevelUp();
      l3Round++;
      showToast('🔥 Wave clear!');
      setTimeout(nextL3Round, 700);
    }
  } else {
    fObj.el.classList.add('wrong-tap');
    setTimeout(() => fObj.el.classList.remove('wrong-tap'), 300);
    sfxWrong();
    showToast('❌ Wrong fruit!');
  }
}

// ============================================================
// SCORE SYNC
// ============================================================
function addMyScore(pts) {
  if (!myUid || !roomCode) return;
  // Optimistic local update
  if (!players[myUid]) players[myUid] = { score: 0 };
  players[myUid].score = (players[myUid].score || 0) + pts;
  updateAllScoreDisplays();

  // Firebase update
  get(dbRef('rooms', roomCode, 'players', myUid, 'score')).then(s => {
    const cur = s.val() || 0;
    update(dbRef('rooms', roomCode, 'players', myUid), { score: cur + pts });
  });
}

function syncScoresDisplay(containerId) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  // Listen to player scores live
  const r = listenOn(`rooms/${roomCode}/players`, snap => {
    players = snap.val() || {};
    renderScoreChips(cont);
  });
}

function updateAllScoreDisplays() {
  ['l1-scores', 'l2-scores', 'l3-scores'].forEach(id => {
    const cont = document.getElementById(id);
    if (cont && cont.childElementCount > 0) renderScoreChips(cont);
  });
}

function renderScoreChips(container) {
  const sorted = Object.entries(players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
  container.innerHTML = '';
  sorted.forEach(([uid, p], idx) => {
    const chip = document.createElement('div');
    chip.className = 'score-chip' + (idx === 0 ? ' leader' : '');
    chip.innerHTML = `<span class="chip-name">${p.name}</span><span class="chip-score">${p.score || 0}</span>`;
    container.appendChild(chip);
  });
}

// ============================================================
// GAME STATE LISTENER
// ============================================================
function listenGameSync(cb) {
  const r = listenOn(`rooms/${roomCode}/game`, snap => {
    if (!snap.exists()) return;
    gameState = snap.val();
    cb(gameState);
  });
}

// ============================================================
// LEVEL 4 — MEMORY FLASH CHALLENGE 🧠
// ============================================================
const L4_ROUNDS = 5;
const L4_EMOJIS = ['🍎','⭐','🎲','🍌','🔥','💎','🎯','🌙','🎪','🦋'];
const L4_CFG = [
  { seqLen: 3, showTime: 6000 },
  { seqLen: 4, showTime: 5000 },
  { seqLen: 5, showTime: 4000 },
  { seqLen: 5, showTime: 3000 },
  { seqLen: 6, showTime: 2400 }
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
  if (l4Round >= L4_ROUNDS) {
    finishLevel(4);
    return;
  }
  const cfg = L4_CFG[l4Round];
  document.getElementById('l4-round').textContent = `${l4Round + 1}/${L4_ROUNDS}`;
  l4Sequence = [];
  l4PlayerSeq = [];
  l4CanInput = false;

  // Build random sequence
  for (let i = 0; i < cfg.seqLen; i++) {
    l4Sequence.push(L4_EMOJIS[randInt(0, L4_EMOJIS.length - 1)]);
  }

  // Show phase
  const display = document.getElementById('l4-sequence-display');
  const prompt = document.getElementById('l4-prompt');
  const inputArea = document.getElementById('l4-input-area');
  const feedback = document.getElementById('l4-feedback');

  feedback.textContent = '';
  inputArea.innerHTML = '';
  display.innerHTML = l4Sequence.map(e => `<span class="mem-emoji">${e}</span>`).join('');
  prompt.textContent = `Memorise this sequence!`;
  display.classList.remove('hidden');

  // Flash countdown bar
  const bar = document.getElementById('l4-flash-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  setTimeout(() => {
    bar.style.transition = `width ${cfg.showTime}ms linear`;
    bar.style.width = '0%';
  }, 50);

  setTimeout(() => {
    // Hide sequence, show input
    display.classList.add('hidden');
    prompt.textContent = 'Recreate the sequence!';
    bar.style.transition = 'none';
    bar.style.width = '0%';
    buildL4Input(cfg);
    l4CanInput = true;
    startTimerLocal('l4-timer', 'l4-timer-bar', 10, () => {
      l4CanInput = false;
      showL4Result(false);
    });
  }, cfg.showTime);
}

function buildL4Input(cfg) {
  const inputArea = document.getElementById('l4-input-area');
  const slotArea = document.getElementById('l4-slots');
  inputArea.innerHTML = '';
  slotArea.innerHTML = '';

  // Shuffled emoji buttons
  const pool = [...new Set(l4Sequence)];
  // pad pool with extras so it's not trivially obvious
  while (pool.length < Math.min(L4_EMOJIS.length, l4Sequence.length + 3)) {
    const e = L4_EMOJIS[randInt(0, L4_EMOJIS.length - 1)];
    if (!pool.includes(e)) pool.push(e);
  }
  shuffle(pool).forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'mem-btn';
    btn.textContent = emoji;
    btn.onclick = () => handleL4Pick(emoji, btn);
    inputArea.appendChild(btn);
  });

  // Answer slots
  for (let i = 0; i < l4Sequence.length; i++) {
    const slot = document.createElement('div');
    slot.className = 'mem-slot';
    slot.dataset.idx = i;
    slotArea.appendChild(slot);
  }
}

function handleL4Pick(emoji, btn) {
  if (!l4CanInput) return;
  const idx = l4PlayerSeq.length;
  if (idx >= l4Sequence.length) return;

  l4PlayerSeq.push(emoji);
  const slots = document.querySelectorAll('.mem-slot');
  if (slots[idx]) {
    slots[idx].textContent = emoji;
    slots[idx].classList.add('filled');
  }
  btn.disabled = true;

  if (l4PlayerSeq.length === l4Sequence.length) {
    l4CanInput = false;
    stopLocalTimer();
    const correct = l4PlayerSeq.every((e, i) => e === l4Sequence[i]);
    showL4Result(correct);
  }
}

function showL4Result(correct) {
  const feedback = document.getElementById('l4-feedback');
  // Reveal correct sequence
  const display = document.getElementById('l4-sequence-display');
  display.innerHTML = l4Sequence.map((e, i) => {
    const playerE = l4PlayerSeq[i];
    const ok = playerE === e;
    return `<span class="mem-emoji ${correct ? 'correct' : (playerE ? (ok ? 'correct' : 'wrong') : 'missing')}">${e}</span>`;
  }).join('');
  display.classList.remove('hidden');

  if (correct) {
    const pts = 150;
    addMyScore(pts);
    sfxCorrect();
    feedback.textContent = `✅ Perfect! +${pts} pts`;
    feedback.className = 'l4-feedback correct';
  } else {
    sfxWrong();
    feedback.textContent = '❌ Wrong order!';
    feedback.className = 'l4-feedback wrong';
  }
  l4Round++;
  setTimeout(nextL4Round, 1600);
}

// ============================================================
// LEVEL 5 — REVERSE CONTROLS CHALLENGE 🔀
// ============================================================
const L5_ROUNDS = 6;
const L5_CFG = [
  { time: 10, reverseLabels: false, reverseOrder: false },
  { time: 9,  reverseLabels: true,  reverseOrder: false },
  { time: 8,  reverseLabels: false, reverseOrder: true  },
  { time: 7,  reverseLabels: true,  reverseOrder: true  },
  { time: 6,  reverseLabels: true,  reverseOrder: true  },
  { time: 5,  reverseLabels: true,  reverseOrder: true  }
];

const L5_QUESTIONS = [
  { prompt: 'Click the HIGHEST number', values: [3, 7, 1, 9, 4], correct: 9 },
  { prompt: 'Click the LOWEST number',  values: [8, 2, 6, 1, 5], correct: 1 },
  { prompt: 'Click the LARGEST fruit',  values: ['🍇','🍉','🍓','🍑','🍋'], correct: '🍉' },
  { prompt: 'Click the ODD number',     values: [2, 4, 7, 6, 8], correct: 7 },
  { prompt: 'Click the EVEN number',    values: [3, 5, 8, 1, 9], correct: 8 },
  { prompt: 'Click the HIGHEST number', values: [11, 5, 23, 17, 3], correct: 23 },
  { prompt: 'Click the LOWEST number',  values: [14, 6, 19, 3, 22], correct: 3 },
  { prompt: 'Click the ODD number',     values: [10, 4, 6, 13, 8], correct: 13 },
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
  if (l5Round >= L5_ROUNDS) {
    finishLevel(5);
    return;
  }
  const cfg = L5_CFG[l5Round];
  const q = L5_QUESTIONS[l5Round % L5_QUESTIONS.length];
  document.getElementById('l5-round').textContent = `${l5Round + 1}/${L5_ROUNDS}`;

  // Build prompt — if reverseLabels, show the OPPOSITE instruction
  const promptEl = document.getElementById('l5-prompt');
  if (cfg.reverseLabels) {
    // Swap highest↔lowest, odd↔even in the displayed prompt
    const flipped = q.prompt
      .replace('HIGHEST', '§LOW§').replace('LOWEST', '§HIGH§')
      .replace('§LOW§', 'LOWEST').replace('§HIGH§', 'HIGHEST')
      .replace('ODD', '§EVEN§').replace('EVEN', '§ODD§')
      .replace('§EVEN§', 'EVEN').replace('§ODD§', 'ODD');
    promptEl.innerHTML = `${flipped} <span class="reverse-tag">⚠️ Controls reversed!</span>`;
  } else {
    promptEl.innerHTML = q.prompt;
  }

  // Show warning on first reversal round
  const warn = document.getElementById('l5-warning');
  if (cfg.reverseLabels || cfg.reverseOrder) {
    warn.classList.remove('hidden');
    warn.textContent = cfg.reverseLabels && cfg.reverseOrder
      ? '🔀 Instructions AND order are reversed!'
      : cfg.reverseLabels ? '🔀 Instructions are reversed!'
      : '🔀 Button order is reversed!';
  } else {
    warn.classList.add('hidden');
  }

  // Build options
  const container = document.getElementById('l5-options');
  container.innerHTML = '';
  let values = [...q.values];
  if (cfg.reverseOrder) values = values.reverse();

  values.forEach(val => {
    const btn = document.createElement('button');
    btn.className = 'reverse-btn';
    btn.textContent = val;
    btn.onclick = () => handleL5Click(btn, val, q.correct, cfg);
    container.appendChild(btn);
  });

  l5CanClick = true;
  startTimerLocal('l5-timer', 'l5-timer-bar', cfg.time, () => {
    l5CanClick = false;
    document.querySelectorAll('.reverse-btn').forEach(b => b.disabled = true);
    // highlight correct
    document.querySelectorAll('.reverse-btn').forEach(b => {
      if (String(b.textContent) === String(q.correct)) b.classList.add('correct-pick');
    });
    sfxWrong();
    showToast('⏱ Time\'s up!');
    l5Round++;
    setTimeout(nextL5Round, 1200);
  });
}

function handleL5Click(btn, val, correct, cfg) {
  if (!l5CanClick) return;
  l5CanClick = false;
  stopLocalTimer();
  document.querySelectorAll('.reverse-btn').forEach(b => b.disabled = true);

  // The "correct" answer to click: if reverseLabels, the player must click
  // the OPPOSITE of what the prompt says, which is actually `correct` as defined
  // (we already swapped the prompt text, so clicking `correct` is right)
  const isCorrect = String(val) === String(correct);
  if (isCorrect) {
    btn.classList.add('correct-pick');
    addMyScore(120);
    sfxCorrect();
    showToast('✅ +120 pts!');
  } else {
    btn.classList.add('wrong-pick');
    document.querySelectorAll('.reverse-btn').forEach(b => {
      if (String(b.textContent) === String(correct)) b.classList.add('correct-pick');
    });
    sfxWrong();
    showToast('❌ Wrong!');
  }
  l5Round++;
  setTimeout(nextL5Round, 1000);
}


// ============================================================
// BETWEEN LEVELS / LEADERBOARD
// ============================================================
function finishLevel(levelNum) {
  stopLocalTimer();
  stopFruitAnimation();
  sfxLevelUp();

  // Fetch latest scores from Firebase
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
      if (lvl === 'results') {
        clearListeners();
        showFinalResults();
        return;
      }
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
  stopFruitAnimation();
  stopJazz();

  get(dbRef('rooms', roomCode, 'players')).then(snap => {
    players = snap.val() || {};
    renderResults();
  });
}

function renderResults() {
  const sorted = Object.entries(players)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
    .map(([uid, p], i) => ({ uid, ...p, rank: i + 1 }));

  // Podium
  const podium = document.getElementById('podium');
  podium.innerHTML = '';
  const podiumOrder = sorted.length >= 2
    ? [sorted[1], sorted[0], sorted[2]].filter(Boolean)
    : sorted;

  const medals = ['🥈', '🥇', '🥉'];
  const rankClasses = ['rank-2', 'rank-1', 'rank-3'];
  const heights = ['70px', '90px', '55px'];

  podiumOrder.forEach((p, i) => {
    const realRank = sorted.findIndex(s => s.uid === p.uid) + 1;
    const block = document.createElement('div');
    block.className = `podium-block rank-${realRank}`;
    block.innerHTML = `
      <div class="podium-name">${p.name}${p.uid === myUid ? ' (you)' : ''}</div>
      <div class="podium-score">${p.score || 0} pts</div>
      <div class="podium-platform" style="min-height:${heights[i]}">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-pos">#${realRank}</div>
      </div>
    `;
    podium.appendChild(block);
  });

  // Full list
  renderLeaderboard('full-leaderboard', players, true);

  // Host gets play again button
  const paBtn = document.getElementById('btn-play-again');
  if (isHost) {
    paBtn.classList.remove('hidden');
    paBtn.onclick = () => {
      sfxClick();
      resetGame();
    };
  } else {
    paBtn.classList.add('hidden');
  }

  showScreen('screen-results');

  // Confetti for winner
  if (sorted[0]?.uid === myUid) {
    spawnConfetti();
  }
}

function renderLeaderboard(containerId, playerData, isFinal = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const sorted = Object.entries(playerData)
    .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  sorted.forEach(([uid, p], i) => {
    const row = document.createElement('div');
    row.className = `lb-row rank-${i + 1}`;
    const nameEl = `<span class="lb-name${uid === myUid ? ' you-tag' : ''}">${p.name}</span>`;
    row.innerHTML = `
      <span class="lb-rank">${medals[i] || (i + 1)}</span>
      ${nameEl}
      <span class="lb-score">${p.score || 0}</span>
    `;
    container.appendChild(row);
  });
}

// ============================================================
// TIMER (local, visual only — each player runs their own)
// ============================================================
function startTimerLocal(timerId, barId, seconds, onEnd) {
  stopLocalTimer();
  let remaining = seconds;
  const timerEl = document.getElementById(timerId);
  const barEl = document.getElementById(barId);

  if (timerEl) { timerEl.textContent = remaining; timerEl.classList.remove('warn'); }
  if (barEl) { barEl.style.width = '100%'; barEl.classList.remove('warn'); }

  localTimerId = setInterval(() => {
    remaining--;
    if (timerEl) {
      timerEl.textContent = remaining;
      if (remaining <= 3) {
        timerEl.classList.add('warn');
        sfxTimerWarn();
      }
    }
    if (barEl) {
      const pct = Math.max(0, (remaining / seconds) * 100);
      barEl.style.width = pct + '%';
      if (remaining <= 3) barEl.classList.add('warn');
    }
    if (remaining <= 0) {
      stopLocalTimer();
      onEnd();
    }
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
  const colors = ['#e94560', '#4f8ef7', '#4ade80', '#fbbf24', '#c084fc'];
  for (let i = 0; i < 60; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.cssText = `
        left:${rand(10, 90)}vw; top:-10px;
        width:${rand(6, 12)}px; height:${rand(6, 12)}px;
        background:${colors[randInt(0, colors.length - 1)]};
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
        animation: confettiFall ${rand(1.5, 3)}s linear forwards;
      `;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3200);
    }, i * 40);
  }

  // Inject confetti keyframes once
  if (!document.getElementById('confetti-style')) {
    const s = document.createElement('style');
    s.id = 'confetti-style';
    s.textContent = `@keyframes confettiFall {
      from { transform: translateY(0) rotate(0deg); opacity: 1; }
      to { transform: translateY(100vh) rotate(720deg); opacity: 0; }
    }`;
    document.head.appendChild(s);
  }
}

// ============================================================
// RESET / NAVIGATION
// ============================================================
async function resetGame() {
  if (isHost && roomCode) {
    // Reset all player scores
    const updates = {};
    Object.keys(players).forEach(uid => {
      updates[`players/${uid}/score`] = 0;
    });
    updates['game/level'] = 1;
    updates['game/round'] = 0;
    updates['game/phase'] = 'countdown';
    updates['game/roundSeed'] = Math.floor(Math.random() * 100000);
    updates['status'] = 'lobby';
    await update(dbRef('rooms', roomCode), updates);
  }
  clearListeners();
  stopLocalTimer();
  stopFruitAnimation();
  Object.keys(players).forEach(uid => {
    if (players[uid]) players[uid].score = 0;
  });
  openLobby();
}

function resetToMenu() {
  clearListeners();
  stopLocalTimer();
  stopFruitAnimation();
  stopJazz();
  players = {};
  roomCode = '';
  isHost = false;
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
  if (!name) { showError('create-error', 'Please enter your name.'); return; }
  document.getElementById('btn-create-confirm').disabled = true;
  sfxClick();
  try {
    await createRoom(name);
    document.getElementById('modal-create').classList.add('hidden');
  } catch (e) {
    showError('create-error', 'Failed to create room. Check Firebase config.');
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
  if (!name) { showError('join-error', 'Enter your name.'); return; }
  if (code.length < 4) { showError('join-error', 'Enter the 4-character room code.'); return; }
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

document.getElementById('btn-main-menu').addEventListener('click', () => {
  sfxClick();
  resetToMenu();
});

document.getElementById('btn-gameover-menu').addEventListener('click', () => {
  sfxClick();
  resetToMenu();
});

document.getElementById('btn-gameover-again').addEventListener('click', () => {
  sfxClick();
  resetGame();
});

// ============================================================
// KEYBOARD SUPPORT
// ============================================================
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const createModal = document.getElementById('modal-create');
    const joinModal = document.getElementById('modal-join');
    if (!createModal.classList.contains('hidden')) {
      document.getElementById('btn-create-confirm').click();
    } else if (!joinModal.classList.contains('hidden')) {
      document.getElementById('btn-join-confirm').click();
    }
  }
  if (e.key === 'Escape') {
    document.getElementById('modal-create').classList.add('hidden');
    document.getElementById('modal-join').classList.add('hidden');
  }
});

// Uppercase room code input
document.getElementById('input-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

// ============================================================
// AUTOPLAY FIX
// ============================================================
document.addEventListener('click', () => {
  if (musicOn && !jazzInterval) startJazz();
}, { once: true });

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
  } catch (e) {
    document.getElementById('loading-msg').textContent =
      'Firebase connection failed. Check your config in firebase.js';
    console.error('Boot error:', e);
  }
}

boot();
