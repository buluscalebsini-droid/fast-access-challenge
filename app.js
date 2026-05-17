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
let actx = null, jazzInterval = null, musicOn = true, jazzStep = 0;

function getACtx() {
  if (!actx) actx = new AudioCtx();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function playTone(freq, type='sine', dur=0.18, vol=0.15, delay=0) {
  if (!musicOn) return;
  try {
    const ctx = getACtx();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + dur + 0.05);
  } catch(e) {}
}
const sfxCorrect   = () => { playTone(880,'sine',0.12,0.25); playTone(1100,'sine',0.12,0.22,0.1); };
const sfxWrong     = () => playTone(200,'sawtooth',0.22,0.25);
const sfxCountdown = () => playTone(440,'square',0.1,0.18);
const sfxGo        = () => [523,659,784].forEach((f,i) => playTone(f,'sine',0.1,0.25,i*0.06));
const sfxTimerWarn = () => playTone(330,'triangle',0.08,0.12);
const sfxLevelUp   = () => [523,659,784,1047].forEach((f,i) => playTone(f,'sine',0.18,0.25,i*0.12));
const sfxClick     = () => playTone(660,'triangle',0.06,0.12);
const sfxDrumroll  = () => {
  // Rapid snare hits that speed up
  const times=[0,0.12,0.22,0.30,0.37,0.43,0.48,0.52,0.55,0.575,0.595,0.61];
  times.forEach(t=>playTone(rand(180,220),'sawtooth',0.04,0.18,t));
};
const sfxChampion  = () => {
  [523,659,784,880,1047].forEach((f,i)=>playTone(f,'sine',0.3,0.3,i*0.12));
  setTimeout(()=>[784,880,1047].forEach((f,i)=>playTone(f,'sine',0.4,0.35,i*0.1)),800);
};
const sfxReveal    = () => { playTone(440,'sine',0.08,0.2); playTone(660,'sine',0.12,0.25,0.08); };

const JAZZ_CHORDS = [[261,330,392,494],[294,370,440,554],[349,440,523,659],[392,494,587,740],[330,415,494,622],[261,330,392,523]];
function playJazzChord() {
  if (!musicOn) return;
  const c = JAZZ_CHORDS[jazzStep % JAZZ_CHORDS.length];
  c.forEach((f,i) => playTone(f/2,'sine',0.5,0.055,i*0.04));
  playTone(c[0]/4,'triangle',0.55,0.09); jazzStep++;
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
let myUid = null, myName = '', roomCode = '', isHost = false;
let players = {}, gameState = {}, activeListeners = [];
let localTimerId = null, localTimerRemaining = 0;

// Level 1 — Color Vision
let l1Round = 0, l1CanClick = false;

// Level 2 — Spelling
let l2Round = 0, l2CanClick = false;

// Level 3 — Moving Fruits
let l3Round = 0, l3CanHit = false, l3Hits = 0, l3Target = '', l3NeedHits = 5;
let fruitObjects = [], rafId = null, lastTime = 0, arenaW = 0, arenaH = 0;
const FRUIT_SIZE = 36;

// Level 4 — Memory Flash
let l4Round = 0, l4Sequence = [], l4PlayerSeq = [], l4CanInput = false;

// Level 5 — Mix
let l5Round = 0, l5CanAct = false, l5RafId = null, l5FruitObjects = [];

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
function playerInitials(name) { return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?'; }

function showToast(msg, dur=1800) {
  const t = document.getElementById('toast');
  t.classList.remove('hidden'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tid); t._tid = setTimeout(() => t.classList.remove('show'), dur);
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id); if (el) el.classList.add('active');
}
function genRoomCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4}, () => c[randInt(0,c.length-1)]).join('');
}
function setConnected(ok) {
  const el = document.getElementById('conn-indicator'), lbl = document.getElementById('conn-label');
  if (!el) return;
  el.classList.toggle('offline', !ok);
  lbl.textContent = ok ? 'Connected' : 'Reconnecting...';
}
function showError(elId, msg) {
  const el = document.getElementById(elId); if (!el) return;
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ============================================================
// FIREBASE HELPERS
// ============================================================
function dbRef(...parts) { return ref(db, parts.join('/')); }
function listenOn(path, cb) {
  const r = dbRef(path); onValue(r, cb); activeListeners.push(r); return r;
}
function clearListeners() { activeListeners.forEach(r => off(r)); activeListeners = []; }
function stopLocalTimer() { if (localTimerId) { clearInterval(localTimerId); localTimerId = null; } }
function stopFruitAnimation() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
function stopL5Fruits() { if (l5RafId) { cancelAnimationFrame(l5RafId); l5RafId = null; } }

// ============================================================
// AUTH
// ============================================================
async function initAuth() {
  document.getElementById('loading-msg').textContent = 'Authenticating...';
  await signInAnonymously(auth);
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { if (user) { myUid = user.uid; unsub(); resolve(); } });
  });
}
function initConnectionMonitor() {
  onValue(dbRef('.info/connected'), snap => setConnected(!!snap.val()));
}

// ============================================================
// ROOM CREATION / JOINING
// ============================================================
async function createRoom(hostName) {
  myName = hostName.trim(); isHost = true; roomCode = genRoomCode();
  const roomRef = dbRef('rooms', roomCode);
  if ((await get(roomRef)).exists()) roomCode = genRoomCode();
  await onDisconnect(dbRef('rooms', roomCode, 'players', myUid)).remove();
  await set(roomRef, {
    host: myUid, status: 'lobby', created: serverTimestamp(),
    players: { [myUid]: { name: myName, score: 0, color: 0, ready: true } },
    game: { level: 0, round: 0, roundSeed: 0, phase: 'waiting' }
  });
  openLobby();
}

async function joinRoom(name, code) {
  myName = name.trim();
  const upper = code.trim().toUpperCase();
  const snap = await get(dbRef('rooms', upper));
  if (!snap.exists()) return 'Room not found.';
  const data = snap.val();
  if (data.status !== 'lobby') return 'Game already started.';
  const existing = data.players || {};
  const list = Object.keys(existing);
  if (list.length >= 40) return 'Room is full (max 40 players).';
  roomCode = upper; isHost = data.host === myUid;
  await onDisconnect(dbRef('rooms', roomCode, 'players', myUid)).remove();
  await update(dbRef('rooms', roomCode, 'players'), {
    [myUid]: { name: myName, score: 0, color: list.length, ready: true }
  });
  openLobby(); return null;
}

// ============================================================
// LOBBY
// ============================================================
function openLobby() {
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent = roomCode;
  updateHostControls(); listenLobby(); startJazz();
}
function updateHostControls() {
  const btn = document.getElementById('btn-start-game');
  if (isHost) { btn.classList.remove('hidden'); btn.onclick = () => { sfxClick(); hostStartGame(); }; }
  else btn.classList.add('hidden');
}
function listenLobby() {
  clearListeners();
  listenOn(`rooms/${roomCode}/players`, snap => {
    players = snap.val() || {};
    renderLobbyPlayers();
    if (!players[myUid]) { showToast('You were removed.'); resetToMenu(); }
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
    const card = document.createElement('div'); card.className = 'player-card';
    const av = document.createElement('div'); av.className = `player-avatar ${playerColor(p.color ?? idx)}`; av.textContent = playerInitials(p.name);
    const nm = document.createElement('div'); nm.className = 'player-name'; nm.textContent = p.name;
    const bg = document.createElement('div'); bg.style.cssText = 'display:flex;gap:6px';
    get(dbRef('rooms', roomCode, 'host')).then(s => {
      if (s.val() === uid) { const h = document.createElement('span'); h.className = 'player-badge'; h.textContent = 'HOST'; bg.appendChild(h); }
    });
    if (uid === myUid) { const y = document.createElement('span'); y.className = 'player-badge you'; y.textContent = 'YOU'; bg.appendChild(y); }
    card.appendChild(av); card.appendChild(nm); card.appendChild(bg); list.appendChild(card);
  });
  const count = entries.length;
  document.getElementById('lobby-status').textContent =
    count === 1 ? 'Waiting for more players... (1/40)' : `${count}/40 players connected`;
  if (isHost) {
    const btn = document.getElementById('btn-start-game');
    btn.disabled = count < 1;
    btn.textContent = count < 2 ? '▶ Start Solo' : '▶ Start Game';
  }
}
async function hostStartGame() {
  document.getElementById('btn-start-game').disabled = true;
  await update(dbRef('rooms', roomCode), {
    status: 'playing', 'game/level': 1, 'game/round': 0,
    'game/phase': 'countdown',
    'game/roundSeed': Math.floor(Math.random() * 100000),
    'game/roundStartTime': serverTimestamp()
  });
}

// ============================================================
// GAME START + COUNTDOWN
// ============================================================
function startGame() {
  clearListeners();
  get(dbRef('rooms', roomCode, 'players')).then(s => { if (s.exists()) players = s.val(); });
  showLevelIntro(1, () => startLevel1());
}
function doCountdown(cb) {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-num');
  let count = 3;
  overlay.classList.remove('hidden');
  numEl.textContent = count; animateCN(numEl); sfxCountdown();
  const tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(tick); numEl.textContent = 'GO!'; sfxGo(); animateCN(numEl);
      setTimeout(() => { overlay.classList.add('hidden'); cb(); }, 700);
    } else { numEl.textContent = count; sfxCountdown(); animateCN(numEl); }
  }, 900);
}
function animateCN(el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'popIn 0.5s ease'; }

// ============================================================
// LEVEL INTRO SYSTEM
// ============================================================
const LEVEL_INTROS = [
  null, // no entry for index 0
  { num:1, emoji:'🎨', title:'Colour Vision', sub:'Find the odd colour as fast as you can!',
    tip:'Look carefully — one circle has a slightly different shade.' },
  { num:2, emoji:'📝', title:'Dyslexia Challenge', sub:'Pick the correctly spelled word!',
    tip:'Words get trickier each round — more options, less time.' },
  { num:3, emoji:'🍎', title:'Fruit Frenzy', sub:'Tap all of the target fruit before time runs out!',
    tip:'Fruits bounce off each other — track your target carefully.' },
  { num:4, emoji:'🧠', title:'Memory Flash', sub:'Memorise the sequence, then recreate it!',
    tip:'The sequence gets longer and shows faster each round.' },
  { num:5, emoji:'🌀', title:'Mix Madness', sub:'All levels combined — anything can happen!',
    tip:'Cycles through Colour, Spelling, Fruits and Memory. Stay sharp!' },
];

function showLevelIntro(levelNum, cb) {
  const info = LEVEL_INTROS[levelNum];
  if (!info) { cb(); return; }

  const overlay = document.getElementById('level-intro-overlay');
  const oEmoji  = document.getElementById('intro-level-emoji');
  const oNum    = document.getElementById('intro-level-num');
  const oTitle  = document.getElementById('intro-level-title');
  const oSub    = document.getElementById('intro-level-sub');
  const oTip    = document.getElementById('intro-level-tip');
  const oCount  = document.getElementById('intro-countdown');

  oEmoji.textContent  = info.emoji;
  oNum.textContent    = `Level ${info.num}`;
  oTitle.textContent  = info.title;
  oSub.textContent    = info.sub;
  oTip.textContent    = `💡 ${info.tip}`;
  oCount.textContent  = '';
  overlay.classList.remove('hidden');
  overlay.classList.add('intro-in');

  // Show info for 2.2 s then count down 3-2-1-GO
  setTimeout(() => {
    let c = 3;
    oCount.textContent = c;
    sfxCountdown();
    const tick = setInterval(() => {
      c--;
      if (c <= 0) {
        clearInterval(tick);
        oCount.textContent = 'GO!';
        sfxGo();
        setTimeout(() => {
          overlay.classList.add('hidden');
          overlay.classList.remove('intro-in');
          cb();
        }, 550);
      } else {
        oCount.textContent = c;
        sfxCountdown();
      }
    }, 800);
  }, 2200);
}

// ============================================================
// LEVEL 1 — COLOUR SORTING 🎨
// (find the one circle with a slightly different shade)
// ============================================================
const L1_ROUNDS = 5;
const L1_CFG = [
  { grid: 4, time: 14, hueDiff: 30 },
  { grid: 4, time: 12, hueDiff: 22 },
  { grid: 5, time: 10, hueDiff: 15 },
  { grid: 5, time: 9,  hueDiff: 10 },
  { grid: 6, time: 7,  hueDiff: 6  }
];

function startLevel1() {
  l1Round = 0;
  showScreen('screen-level1'); setupMuteButtons(); syncScoresDisplay('l1-scores');
  nextL1Round();
}
function nextL1Round() {
  stopLocalTimer();
  if (l1Round >= L1_ROUNDS) { finishLevel(1); return; }
  const cfg = L1_CFG[l1Round];
  document.getElementById('l1-round').textContent = `${l1Round + 1}/${L1_ROUNDS}`;
  buildL1Grid(cfg, l1Round * 7777 + 1);
  l1CanClick = true;
  startTimerLocal('l1-timer', 'l1-timer-bar', cfg.time, () => {
    l1CanClick = false;
    // Briefly reveal odd cell
    document.querySelectorAll('.color-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    l1Round++;
    setTimeout(nextL1Round, 700);
  });
}
function buildL1Grid(cfg, seed) {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = '';
  const n = cfg.grid, total = n * n;
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  const oddIdx = seed % total;
  const baseHue = (seed * 37) % 360;
  const oddHue  = (baseHue + cfg.hueDiff) % 360;
  const sat = 55 + (seed % 20), lit = 50 + (seed % 15);
  for (let i = 0; i < total; i++) {
    const el = document.createElement('div');
    el.className = 'color-cell' + (i === oddIdx ? ' odd-cell' : '');
    el.style.background = `hsl(${i === oddIdx ? oddHue : baseHue},${sat}%,${lit}%)`;
    el.addEventListener('click', () => handleL1Click(el, i === oddIdx));
    grid.appendChild(el);
  }
}
function handleL1Click(el, isCorrect) {
  if (!l1CanClick) return;
  l1CanClick = false; stopLocalTimer();
  if (isCorrect) {
    el.classList.add('correct'); addMyScore(100); sfxCorrect(); showToast('✅ +100 pts!');
  } else {
    el.classList.add('wrong');
    document.querySelectorAll('.color-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    sfxWrong(); showToast('❌ Wrong!');
  }
  l1Round++; setTimeout(nextL1Round, 800);
}

// ============================================================
// LEVEL 2 — DYSLEXIA CHALLENGE 📝
// (pick the correctly spelled word from 7 options)
// ============================================================
const WORD_DATA = [
  { correct: 'banana',     options: ['banana','bananna','bananah','bannana','banaana','banane','bananna'] },
  { correct: 'calendar',   options: ['calender','calendar','calandar','callender','calandir','calenddar','calanderr'] },
  { correct: 'receive',    options: ['recieve','receive','receeve','recevie','recive','reciive','receivve'] },
  { correct: 'necessary',  options: ['necessary','neccessary','necessery','nesessary','necesary','neccesary','necessarry'] },
  { correct: 'separate',   options: ['seperate','separete','separate','saparate','seperatee','saparete','separeate'] },
  { correct: 'achieve',    options: ['acheive','achieve','acheeve','achiive','achivee','achive','achiev'] },
  { correct: 'occurred',   options: ['occured','ocurred','occurred','occuried','ocurreed','occureed','occurrred'] },
  { correct: 'believe',    options: ['beleive','beleave','believe','beleve','beliieve','beleve','beleeve'] },
  { correct: 'beautiful',  options: ['beatiful','beutiful','beautiful','beautyful','beatyful','beautifull','beauttiful'] },
  { correct: 'because',    options: ['becuase','becouse','because','becaus','becaues','becauze','becaause'] },
  { correct: 'friend',     options: ['freind','frend','friend','friand','freeind','freiend','freand'] },
  { correct: 'tomorrow',   options: ['tommorow','tomorow','tomorrow','tommorrow','tomorrrow','tomorow','tommorow'] },
];

const L2_ROUNDS = 7;
const L2_CFG = [
  { time: 12, optCount: 3 },
  { time: 10, optCount: 4 },
  { time: 9,  optCount: 5 },
  { time: 8,  optCount: 6 },
  { time: 7,  optCount: 7 },
  { time: 6,  optCount: 7 },
  { time: 5,  optCount: 7 }
];

function startLevel2() {
  l2Round = 0;
  showScreen('screen-level2'); setupMuteButtons(); syncScoresDisplay('l2-scores');
  nextL2Round();
}
function nextL2Round() {
  stopLocalTimer();
  if (l2Round >= L2_ROUNDS) { finishLevel(2); return; }
  const cfg = L2_CFG[l2Round];
  const data = WORD_DATA[l2Round % WORD_DATA.length];
  document.getElementById('l2-round').textContent = `${l2Round + 1}/${L2_ROUNDS}`;
  document.getElementById('word-prompt').textContent = 'Which is spelled correctly?';

  const container = document.getElementById('word-options');
  container.innerHTML = '';
  // Always show correct + (optCount-1) wrong options
  const wrongs = shuffle(data.options.filter(o => o !== data.correct)).slice(0, cfg.optCount - 1);
  shuffle([data.correct, ...wrongs]).forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'word-btn';
    btn.textContent = opt;
    btn.onclick = () => handleL2Click(btn, opt === data.correct, data.correct);
    container.appendChild(btn);
  });

  l2CanClick = true;
  startTimerLocal('l2-timer', 'l2-timer-bar', cfg.time, () => {
    l2CanClick = false;
    document.querySelectorAll('.word-btn').forEach(b => {
      if (b.textContent === data.correct) b.classList.add('correct-pick');
      b.disabled = true;
    });
    showToast(`⏱ Time's up! "${data.correct}" was correct`);
    l2Round++; setTimeout(nextL2Round, 1200);
  });
}
function handleL2Click(btn, isCorrect, correctWord) {
  if (!l2CanClick) return;
  l2CanClick = false; stopLocalTimer();
  document.querySelectorAll('.word-btn').forEach(b => b.disabled = true);
  if (isCorrect) {
    btn.classList.add('correct-pick'); addMyScore(100); sfxCorrect(); showToast('✅ +100 pts!');
  } else {
    btn.classList.add('wrong-pick');
    document.querySelectorAll('.word-btn').forEach(b => { if (b.textContent === correctWord) b.classList.add('correct-pick'); });
    sfxWrong(); showToast('❌ Wrong!');
  }
  l2Round++; setTimeout(nextL2Round, 1000);
}

// ============================================================
// LEVEL 3 — MOVING FRUITS 🍎
// (tap the target fruit bouncing around the arena)
// ============================================================
const ALL_FRUITS = ['🍎','🍌','🍇','🍓','🍍','🍊','🫐','🍑'];
const L3_ROUNDS = 5;
const L3_CFG = [
  { time: 16, total: 12, speed: [20, 45] },
  { time: 14, total: 14, speed: [25, 55] },
  { time: 13, total: 16, speed: [30, 65] },
  { time: 12, total: 18, speed: [35, 75] },
  { time: 10, total: 20, speed: [40, 85] }
];

function startLevel3() {
  l3Round = 0;
  showScreen('screen-level3'); setupMuteButtons(); syncScoresDisplay('l3-scores');
  nextL3Round();
}
function nextL3Round() {
  stopLocalTimer(); stopFruitAnimation(); fruitObjects = [];
  if (l3Round >= L3_ROUNDS) { finishLevel(3); return; }
  const cfg = L3_CFG[l3Round];
  l3Hits = 0; l3NeedHits = 5; l3CanHit = true;
  document.getElementById('l3-round').textContent = `${l3Round + 1}/${L3_ROUNDS}`;
  l3Target = pick(ALL_FRUITS);
  document.getElementById('l3-target').textContent = l3Target;
  document.getElementById('l3-hits').textContent = `0/${l3NeedHits}`;

  const arena = document.getElementById('l3-arena');
  arena.innerHTML = '';
  arenaW = arena.offsetWidth || 360; arenaH = arena.offsetHeight || 220;

  const fruitList = [];
  for (let i = 0; i < l3NeedHits; i++) fruitList.push(l3Target);
  while (fruitList.length < cfg.total) {
    const f = pick(ALL_FRUITS); if (f !== l3Target) fruitList.push(f);
  }
  shuffle(fruitList).forEach(emoji => {
    const el = document.createElement('div');
    el.className = 'fruit'; el.textContent = emoji; el.style.fontSize = FRUIT_SIZE + 'px';
    const x = rand(4, arenaW - FRUIT_SIZE - 4), y = rand(4, arenaH - FRUIT_SIZE - 4);
    const speed = rand(...cfg.speed), angle = rand(0, Math.PI * 2);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    const fObj = { el, x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, emoji, tapped: false };
    fruitObjects.push(fObj); arena.appendChild(el);
    el.addEventListener('click', () => handleL3Tap(fObj));
    el.addEventListener('touchstart', e => { e.preventDefault(); handleL3Tap(fObj); }, { passive: false });
  });

  lastTime = performance.now(); animateFruits();
  startTimerLocal('l3-timer', 'l3-timer-bar', cfg.time, () => {
    l3CanHit = false; stopFruitAnimation();
    showToast(`⏱ Wave over! ${l3Hits}/${l3NeedHits} found`);
    l3Round++; setTimeout(nextL3Round, 800);
  });
}
function animateFruits() {
  rafId = requestAnimationFrame(now => {
    const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now;
    for (let i = 0; i < fruitObjects.length; i++) {
      const f = fruitObjects[i]; if (f.tapped) continue;
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx); }
      if (f.x > arenaW - FRUIT_SIZE) { f.x = arenaW - FRUIT_SIZE; f.vx = -Math.abs(f.vx); }
      if (f.y < 0) { f.y = 0; f.vy = Math.abs(f.vy); }
      if (f.y > arenaH - FRUIT_SIZE) { f.y = arenaH - FRUIT_SIZE; f.vy = -Math.abs(f.vy); }
      for (let j = i+1; j < fruitObjects.length; j++) {
        const g = fruitObjects[j]; if (g.tapped) continue;
        const dx = (f.x + FRUIT_SIZE/2) - (g.x + FRUIT_SIZE/2);
        const dy = (f.y + FRUIT_SIZE/2) - (g.y + FRUIT_SIZE/2);
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < FRUIT_SIZE && dist > 0) {
          const nx = dx/dist, ny = dy/dist;
          const dot = (f.vx-g.vx)*nx + (f.vy-g.vy)*ny;
          if (dot < 0) {
            f.vx -= dot*nx; f.vy -= dot*ny; g.vx += dot*nx; g.vy += dot*ny;
            const ov = (FRUIT_SIZE-dist)/2; f.x += nx*ov; f.y += ny*ov; g.x -= nx*ov; g.y -= ny*ov;
          }
        }
      }
      f.el.style.left = f.x + 'px'; f.el.style.top = f.y + 'px';
    }
    animateFruits();
  });
}
function handleL3Tap(fObj) {
  if (!l3CanHit || fObj.tapped) return;
  if (fObj.emoji === l3Target) {
    fObj.tapped = true; fObj.el.classList.add('popped');
    l3Hits++; addMyScore(50); sfxCorrect();
    document.getElementById('l3-hits').textContent = `${l3Hits}/${l3NeedHits}`;
    showToast('🎯 +50 pts!');
    setTimeout(() => fObj.el.remove(), 250);
    if (l3Hits >= l3NeedHits) {
      l3CanHit = false; stopLocalTimer(); stopFruitAnimation(); sfxLevelUp();
      showToast('🔥 Wave clear!'); l3Round++; setTimeout(nextL3Round, 700);
    }
  } else {
    fObj.el.classList.add('wrong-tap');
    setTimeout(() => fObj.el.classList.remove('wrong-tap'), 300);
    sfxWrong(); showToast('❌ Wrong fruit!');
  }
}

// ============================================================
// LEVEL 4 — MEMORY FLASH 🧠
// (memorise sequence, then recreate it)
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
  showScreen('screen-level4'); setupMuteButtons(); syncScoresDisplay('l4-scores');
  nextL4Round();
}
function nextL4Round() {
  stopLocalTimer();
  if (l4Round >= L4_ROUNDS) { finishLevel(4); return; }
  const cfg = L4_CFG[l4Round];
  document.getElementById('l4-round').textContent = `${l4Round + 1}/${L4_ROUNDS}`;
  l4Sequence = []; l4PlayerSeq = []; l4CanInput = false;
  for (let i = 0; i < cfg.seqLen; i++) l4Sequence.push(L4_EMOJIS[randInt(0, L4_EMOJIS.length-1)]);

  const display  = document.getElementById('l4-sequence-display');
  const prompt   = document.getElementById('l4-prompt');
  const inputArea= document.getElementById('l4-input-area');
  const feedback = document.getElementById('l4-feedback');
  feedback.textContent = ''; inputArea.innerHTML = '';
  display.innerHTML = l4Sequence.map(e => `<span class="mem-emoji">${e}</span>`).join('');
  prompt.textContent = 'Memorise this sequence!';
  display.classList.remove('hidden');

  const bar = document.getElementById('l4-flash-bar');
  bar.style.transition = 'none'; bar.style.width = '100%';
  setTimeout(() => { bar.style.transition = `width ${cfg.showTime}ms linear`; bar.style.width = '0%'; }, 50);

  setTimeout(() => {
    display.classList.add('hidden');
    prompt.textContent = 'Recreate the sequence!';
    bar.style.transition = 'none'; bar.style.width = '0%';
    buildL4Input(); l4CanInput = true;
    startTimerLocal('l4-timer', 'l4-timer-bar', 10, () => { l4CanInput = false; showL4Result(false); });
  }, cfg.showTime);
}
function buildL4Input() {
  const inputArea = document.getElementById('l4-input-area');
  const slotArea  = document.getElementById('l4-slots');
  inputArea.innerHTML = ''; slotArea.innerHTML = '';
  const counts = {};
  l4Sequence.forEach(e => { counts[e] = (counts[e] || 0) + 1; });
  const pool = Object.keys(counts);
  while (pool.length < Math.min(L4_EMOJIS.length, l4Sequence.length + 3)) {
    const e = L4_EMOJIS[randInt(0, L4_EMOJIS.length-1)]; if (!pool.includes(e)) pool.push(e);
  }
  shuffle(pool).forEach(emoji => {
    const max = counts[emoji] || 0; let left = max;
    const btn = document.createElement('button'); btn.className = 'mem-btn'; btn.textContent = emoji;
    const upd = () => {
      btn.dataset.uses = left;
      if (max > 1) btn.setAttribute('data-count', left > 0 ? `×${left}` : '');
      btn.disabled = left <= 0;
    };
    upd();
    btn.onclick = () => { if (!l4CanInput || left <= 0) return; left--; upd(); handleL4Pick(emoji); };
    inputArea.appendChild(btn);
  });
  for (let i = 0; i < l4Sequence.length; i++) {
    const s = document.createElement('div'); s.className = 'mem-slot'; s.dataset.idx = i; slotArea.appendChild(s);
  }
}
function handleL4Pick(emoji) {
  if (!l4CanInput) return;
  const idx = l4PlayerSeq.length; if (idx >= l4Sequence.length) return;
  l4PlayerSeq.push(emoji);
  const slots = document.querySelectorAll('.mem-slot');
  if (slots[idx]) { slots[idx].textContent = emoji; slots[idx].classList.add('filled'); }
  if (l4PlayerSeq.length === l4Sequence.length) { l4CanInput = false; stopLocalTimer(); showL4Result(l4PlayerSeq.every((e,i) => e === l4Sequence[i])); }
}
function showL4Result(correct) {
  const feedback = document.getElementById('l4-feedback');
  const display  = document.getElementById('l4-sequence-display');
  display.innerHTML = l4Sequence.map((e,i) => {
    const pe = l4PlayerSeq[i], ok = pe === e;
    return `<span class="mem-emoji ${correct ? 'correct' : (pe ? (ok ? 'correct' : 'wrong') : 'missing')}">${e}</span>`;
  }).join('');
  display.classList.remove('hidden');
  if (correct) { addMyScore(150); sfxCorrect(); feedback.textContent = '✅ Perfect! +150 pts'; feedback.className = 'l4-feedback correct'; }
  else { sfxWrong(); feedback.textContent = '❌ Wrong order!'; feedback.className = 'l4-feedback wrong'; }
  l4Round++; setTimeout(nextL4Round, 1600);
}

// ============================================================
// LEVEL 5 — MIX OF ALL 🌀
// (rapid mini-rounds cycling through all 4 level types)
// ============================================================
const L5_ROUNDS = 8;
const L5_TYPES  = ['color','word','fruit','memory']; // cycles through
// Per-event config getting harder each cycle
const L5_COLOR_CFG  = [
  { grid:3, time:10, hueDiff:25 }, { grid:4, time:9, hueDiff:18 },
  { grid:4, time:8,  hueDiff:13 }, { grid:5, time:7, hueDiff:9  },
  { grid:5, time:6,  hueDiff:6  }
];
const L5_WORD_DATA = WORD_DATA; // reuse
const L5_WORD_TIME = [10,9,8,7,6,5];

let l5ColorSeed = 0;
let l5WordIdx   = 0;
let l5MemSeq = [], l5MemPlayerSeq = [], l5MemCanInput = false;
let l5FruitArenaW = 0, l5FruitArenaH = 0;

function startLevel5() {
  l5Round = 0;
  showScreen('screen-level5'); setupMuteButtons(); syncScoresDisplay('l5-scores');
  nextL5Round();
}

function nextL5Round() {
  stopLocalTimer(); stopL5Fruits();
  // clear arena content
  const arena = document.getElementById('l5-arena');
  if (arena) arena.innerHTML = '';
  const feedback = document.getElementById('l5-feedback');
  if (feedback) feedback.textContent = '';

  if (l5Round >= L5_ROUNDS) { finishLevel(5); return; }

  document.getElementById('l5-round').textContent = `${l5Round + 1}/${L5_ROUNDS}`;

  const type = L5_TYPES[l5Round % L5_TYPES.length];
  if      (type === 'color')  buildL5Color();
  else if (type === 'word')   buildL5Word();
  else if (type === 'fruit')  buildL5Fruit();
  else                        buildL5Memory();
}

// --- L5 Color mini-round ---
function buildL5Color() {
  const cfgIdx = Math.min(Math.floor(l5Round / 4), L5_COLOR_CFG.length - 1);
  const cfg = L5_COLOR_CFG[cfgIdx];
  const arena = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '🎨 Find the odd colour!';
  arena.style.display = 'grid';
  arena.style.gridTemplateColumns = `repeat(${cfg.grid}, 1fr)`;
  arena.style.gap = '6px';

  l5ColorSeed = l5Round * 3311 + 42;
  const total = cfg.grid * cfg.grid;
  const oddIdx  = l5ColorSeed % total;
  const baseHue = (l5ColorSeed * 37) % 360;
  const oddHue  = (baseHue + cfg.hueDiff) % 360;
  const sat = 55 + (l5ColorSeed % 20), lit = 50 + (l5ColorSeed % 15);

  l5CanAct = true;
  for (let i = 0; i < total; i++) {
    const el = document.createElement('div');
    el.className = 'color-cell l5-color-cell' + (i === oddIdx ? ' odd-cell' : '');
    el.style.background = `hsl(${i === oddIdx ? oddHue : baseHue},${sat}%,${lit}%)`;
    el.addEventListener('click', () => {
      if (!l5CanAct) return;
      l5CanAct = false; stopLocalTimer();
      if (i === oddIdx) { addMyScore(100); sfxCorrect(); document.getElementById('l5-feedback').textContent = '✅ +100'; document.getElementById('l5-feedback').className = 'l5-fb correct'; }
      else { sfxWrong(); document.getElementById('l5-feedback').textContent = '❌ Wrong!'; document.getElementById('l5-feedback').className = 'l5-fb wrong'; }
      l5Round++; setTimeout(nextL5Round, 700);
    });
    arena.appendChild(el);
  }
  startTimerLocal('l5-timer', 'l5-timer-bar', cfg.time, () => {
    l5CanAct = false;
    document.querySelectorAll('.l5-color-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    document.getElementById('l5-feedback').textContent = '⏱ Time\'s up!'; document.getElementById('l5-feedback').className = 'l5-fb timeout';
    l5Round++; setTimeout(nextL5Round, 700);
  });
}

// --- L5 Word mini-round ---
function buildL5Word() {
  const timeIdx = Math.min(Math.floor(l5Round / 4), L5_WORD_TIME.length - 1);
  const t = L5_WORD_TIME[timeIdx];
  const data = L5_WORD_DATA[l5Round % L5_WORD_DATA.length];
  const arena = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '📝 Find the correct spelling!';
  arena.style.display = 'flex';
  arena.style.flexWrap = 'wrap';
  arena.style.gridTemplateColumns = '';
  arena.style.gap = '8px';

  const opts = shuffle([data.correct, ...shuffle(data.options.filter(o => o !== data.correct)).slice(0,3)]);
  l5CanAct = true;
  opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'word-btn l5-word-btn';
    btn.textContent = opt;
    btn.onclick = () => {
      if (!l5CanAct) return;
      l5CanAct = false; stopLocalTimer();
      arena.querySelectorAll('button').forEach(b => b.disabled = true);
      if (opt === data.correct) {
        btn.classList.add('correct-pick'); addMyScore(100); sfxCorrect();
        document.getElementById('l5-feedback').textContent = '✅ +100'; document.getElementById('l5-feedback').className = 'l5-fb correct';
      } else {
        btn.classList.add('wrong-pick');
        arena.querySelectorAll('button').forEach(b => { if (b.textContent === data.correct) b.classList.add('correct-pick'); });
        sfxWrong(); document.getElementById('l5-feedback').textContent = '❌ Wrong!'; document.getElementById('l5-feedback').className = 'l5-fb wrong';
      }
      l5Round++; setTimeout(nextL5Round, 900);
    };
    arena.appendChild(btn);
  });
  startTimerLocal('l5-timer', 'l5-timer-bar', t, () => {
    l5CanAct = false;
    arena.querySelectorAll('button').forEach(b => { b.disabled = true; if (b.textContent === data.correct) b.classList.add('correct-pick'); });
    document.getElementById('l5-feedback').textContent = '⏱ Time\'s up!'; document.getElementById('l5-feedback').className = 'l5-fb timeout';
    l5Round++; setTimeout(nextL5Round, 900);
  });
}

// --- L5 Fruit mini-round ---
function buildL5Fruit() {
  const timeVal = Math.max(8, 13 - l5Round);
  const arena = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '🍎 Tap the target fruit!';
  arena.style.display = 'block';
  arena.style.gridTemplateColumns = '';
  arena.style.position = 'relative';

  const target = pick(ALL_FRUITS);
  document.getElementById('l5-fruit-target').textContent = target;
  document.getElementById('l5-fruit-target-wrap').classList.remove('hidden');
  document.getElementById('l5-fruit-hits').textContent = '0/3';

  l5FruitArenaW = arena.offsetWidth || 320; l5FruitArenaH = arena.offsetHeight || 180;
  l5FruitObjects = []; l5CanAct = true;
  let hits = 0; const needHits = 3;
  const total = 10 + l5Round;
  const fruitList = [target, target, target];
  while (fruitList.length < Math.min(total, 16)) { const f = pick(ALL_FRUITS); if (f !== target) fruitList.push(f); }
  shuffle(fruitList).forEach(emoji => {
    const el = document.createElement('div');
    el.className = 'fruit'; el.textContent = emoji; el.style.fontSize = FRUIT_SIZE + 'px';
    el.style.position = 'absolute';
    const x = rand(2, l5FruitArenaW - FRUIT_SIZE - 2), y = rand(2, l5FruitArenaH - FRUIT_SIZE - 2);
    const speed = rand(30 + l5Round*3, 55 + l5Round*4), angle = rand(0, Math.PI*2);
    el.style.left = x + 'px'; el.style.top = y + 'px';
    const fObj = { el, x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, emoji, tapped: false };
    l5FruitObjects.push(fObj); arena.appendChild(el);
    const tap = () => {
      if (!l5CanAct || fObj.tapped) return;
      if (fObj.emoji === target) {
        fObj.tapped = true; fObj.el.classList.add('popped'); addMyScore(50); sfxCorrect();
        hits++; document.getElementById('l5-fruit-hits').textContent = `${hits}/${needHits}`;
        setTimeout(() => fObj.el.remove(), 250);
        if (hits >= needHits) {
          l5CanAct = false; stopLocalTimer(); stopL5Fruits();
          document.getElementById('l5-fruit-target-wrap').classList.add('hidden');
          document.getElementById('l5-feedback').textContent = '🔥 +150!'; document.getElementById('l5-feedback').className = 'l5-fb correct';
          addMyScore(100); // bonus for clearing wave
          l5Round++; setTimeout(nextL5Round, 700);
        }
      } else { fObj.el.classList.add('wrong-tap'); setTimeout(() => fObj.el.classList.remove('wrong-tap'), 300); sfxWrong(); }
    };
    el.addEventListener('click', tap);
    el.addEventListener('touchstart', e2 => { e2.preventDefault(); tap(); }, { passive: false });
  });

  let lastT = performance.now();
  const animL5 = now => {
    const dt = Math.min((now - lastT)/1000, 0.05); lastT = now;
    for (const f of l5FruitObjects) {
      if (f.tapped) continue;
      f.x += f.vx*dt; f.y += f.vy*dt;
      if (f.x < 0) { f.x=0; f.vx=Math.abs(f.vx); }
      if (f.x > l5FruitArenaW-FRUIT_SIZE) { f.x=l5FruitArenaW-FRUIT_SIZE; f.vx=-Math.abs(f.vx); }
      if (f.y < 0) { f.y=0; f.vy=Math.abs(f.vy); }
      if (f.y > l5FruitArenaH-FRUIT_SIZE) { f.y=l5FruitArenaH-FRUIT_SIZE; f.vy=-Math.abs(f.vy); }
      f.el.style.left = f.x+'px'; f.el.style.top = f.y+'px';
    }
    l5RafId = requestAnimationFrame(animL5);
  };
  l5RafId = requestAnimationFrame(animL5);

  startTimerLocal('l5-timer', 'l5-timer-bar', timeVal, () => {
    l5CanAct = false; stopL5Fruits();
    document.getElementById('l5-fruit-target-wrap').classList.add('hidden');
    document.getElementById('l5-feedback').textContent = `⏱ Got ${hits}/${needHits}`; document.getElementById('l5-feedback').className = 'l5-fb timeout';
    l5Round++; setTimeout(nextL5Round, 700);
  });
}

// --- L5 Memory mini-round ---
function buildL5Memory() {
  const showMs = Math.max(1500, 4000 - l5Round * 300);
  const arena = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '🧠 Memorise & recreate!';
  document.getElementById('l5-fruit-target-wrap').classList.add('hidden');
  arena.style.display = 'flex'; arena.style.flexWrap = 'wrap'; arena.style.gridTemplateColumns = ''; arena.style.gap = '8px';

  const seqLen = 3 + Math.floor(l5Round / 4);
  l5MemSeq = []; l5MemPlayerSeq = []; l5MemCanInput = false;
  for (let i = 0; i < seqLen; i++) l5MemSeq.push(L4_EMOJIS[randInt(0, L4_EMOJIS.length-1)]);

  // Show sequence
  arena.innerHTML = `<div class="l5-mem-display">${l5MemSeq.map(e => `<span class="mem-emoji">${e}</span>`).join('')}</div>`;
  l5CanAct = false;

  setTimeout(() => {
    arena.innerHTML = '';
    arena.style.flexWrap = 'wrap';
    // Build input
    const slotRow = document.createElement('div'); slotRow.className = 'mem-slots'; slotRow.style.marginBottom = '8px';
    for (let i = 0; i < l5MemSeq.length; i++) {
      const s = document.createElement('div'); s.className = 'mem-slot'; s.dataset.idx = i; slotRow.appendChild(s);
    }
    arena.appendChild(slotRow);

    const counts = {};
    l5MemSeq.forEach(e => { counts[e] = (counts[e] || 0) + 1; });
    const pool = Object.keys(counts);
    while (pool.length < Math.min(L4_EMOJIS.length, l5MemSeq.length + 2)) {
      const e = L4_EMOJIS[randInt(0, L4_EMOJIS.length-1)]; if (!pool.includes(e)) pool.push(e);
    }
    const btnRow = document.createElement('div'); btnRow.className = 'mem-input';
    shuffle(pool).forEach(emoji => {
      const max = counts[emoji] || 0; let left = max;
      const btn = document.createElement('button'); btn.className = 'mem-btn'; btn.textContent = emoji;
      const upd = () => { btn.dataset.uses = left; if (max > 1) btn.setAttribute('data-count', left > 0 ? `×${left}` : ''); btn.disabled = left <= 0; };
      upd();
      btn.onclick = () => {
        if (!l5MemCanInput || left <= 0) return;
        left--; upd();
        l5MemPlayerSeq.push(emoji);
        const slots = slotRow.querySelectorAll('.mem-slot');
        const idx = l5MemPlayerSeq.length - 1;
        if (slots[idx]) { slots[idx].textContent = emoji; slots[idx].classList.add('filled'); }
        if (l5MemPlayerSeq.length === l5MemSeq.length) {
          l5MemCanInput = false; stopLocalTimer();
          const correct = l5MemPlayerSeq.every((e2,i) => e2 === l5MemSeq[i]);
          if (correct) { addMyScore(150); sfxCorrect(); document.getElementById('l5-feedback').textContent = '✅ Perfect! +150'; document.getElementById('l5-feedback').className = 'l5-fb correct'; }
          else { sfxWrong(); document.getElementById('l5-feedback').textContent = '❌ Wrong order!'; document.getElementById('l5-feedback').className = 'l5-fb wrong'; }
          l5Round++; setTimeout(nextL5Round, 1200);
        }
      };
      btnRow.appendChild(btn);
    });
    arena.appendChild(btnRow);
    l5MemCanInput = true; l5CanAct = true;
    startTimerLocal('l5-timer', 'l5-timer-bar', 10, () => {
      l5MemCanInput = false; l5CanAct = false;
      document.getElementById('l5-feedback').textContent = '⏱ Time\'s up!'; document.getElementById('l5-feedback').className = 'l5-fb timeout';
      l5Round++; setTimeout(nextL5Round, 800);
    });
  }, showMs);
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
  const cont = document.getElementById(containerId); if (!cont) return;
  listenOn(`rooms/${roomCode}/players`, snap => { players = snap.val() || {}; renderScoreChips(cont); });
}
function updateAllScoreDisplays() {
  ['l1-scores','l2-scores','l3-scores','l4-scores','l5-scores'].forEach(id => {
    const cont = document.getElementById(id); if (cont && cont.childElementCount > 0) renderScoreChips(cont);
  });
}
function renderScoreChips(container) {
  const sorted = Object.entries(players).sort((a,b) => (b[1].score||0)-(a[1].score||0));
  container.innerHTML = '';
  sorted.forEach(([uid,p],idx) => {
    const chip = document.createElement('div'); chip.className = 'score-chip' + (idx===0?' leader':'');
    chip.innerHTML = `<span class="chip-name">${p.name}</span><span class="chip-score">${p.score||0}</span>`;
    container.appendChild(chip);
  });
}
function listenGameSync(cb) {
  listenOn(`rooms/${roomCode}/game`, snap => { if (!snap.exists()) return; gameState = snap.val(); cb(gameState); });
}

// ============================================================
// BETWEEN LEVELS / LEADERBOARD
// ============================================================
function finishLevel(levelNum) {
  stopLocalTimer(); stopFruitAnimation(); stopL5Fruits(); sfxLevelUp();
  get(dbRef('rooms', roomCode, 'players')).then(snap => { players = snap.val() || {}; showBetweenScreen(levelNum); });
}

function showBetweenScreen(levelNum) {
  document.getElementById('between-title').textContent = levelNum < 5 ? `Level ${levelNum} Complete! 🎉` : 'All Done! 🏆';
  document.getElementById('between-sub').textContent = `Leaderboard after Level ${levelNum}`;
  renderLeaderboard('leaderboard-between', players);
  showScreen('screen-between');

  const nextBtn = document.getElementById('btn-next-level');
  const cd      = document.getElementById('between-countdown');

  if (isHost) {
    nextBtn.classList.remove('hidden');
    nextBtn.disabled = false;
    nextBtn.textContent = levelNum < 5 ? 'Next Level →' : 'See Results →';
    nextBtn.onclick = () => {
      nextBtn.disabled = true; sfxClick();
      const nextLvl = levelNum < 5 ? levelNum + 1 : 'results';
      update(dbRef('rooms', roomCode), { 'game/level': nextLvl });
      doCountdown(() => {
        if      (levelNum === 1) startLevel2();
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
        const goLvl = () => {
          if      (lvl === 2) startLevel2();
          else if (lvl === 3) startLevel3();
          else if (lvl === 4) startLevel4();
          else if (lvl === 5) startLevel5();
        };
        showLevelIntro(lvl, goLvl);
      }
    });
  }
}

// ============================================================
// FINAL RESULTS
// ============================================================
function showFinalResults() {
  stopLocalTimer(); stopFruitAnimation(); stopL5Fruits(); stopJazz();
  get(dbRef('rooms', roomCode, 'players')).then(snap => { players = snap.val() || {}; renderResults(); });
}
function renderResults() {
  const sorted = Object.entries(players)
    .sort((a,b) => (b[1].score||0)-(a[1].score||0))
    .map(([uid,p],i) => ({uid,...p,rank:i+1}));

  showScreen('screen-results');
  document.getElementById('podium').innerHTML = '';
  document.getElementById('full-leaderboard').innerHTML = '';
  document.getElementById('results-actions').innerHTML = '';

  // Dramatic sequential reveal: 5th → 4th → 3rd → 2nd → 1st
  const toReveal = sorted.slice(0, 5).reverse(); // worst first
  const revealContainer = document.getElementById('podium');
  let delay = 800;

  toReveal.forEach((p, revIdx) => {
    const isFirst = p.rank === 1;
    const rankLabels = {1:'🥇 CHAMPION',2:'🥈 2nd Place',3:'🥉 3rd Place',4:'4th Place',5:'5th Place'};
    setTimeout(() => {
      if (isFirst) {
        // Dramatic champion reveal
        const overlay = document.getElementById('champion-overlay');
        overlay.classList.remove('hidden');
        sfxDrumroll();
        setTimeout(() => {
          document.getElementById('champion-name').textContent = p.name + (p.uid===myUid?' 🎉':'');
          document.getElementById('champion-score').textContent = (p.score||0) + ' pts';
          overlay.classList.add('champion-reveal');
          sfxChampion();
          if (p.uid === myUid) spawnConfetti();
          setTimeout(() => spawnConfetti(), 400);
          setTimeout(() => spawnConfetti(), 800);
        }, 2200);
      } else {
        sfxReveal();
        const card = document.createElement('div');
        card.className = 'reveal-card rank-' + p.rank;
        card.innerHTML = `<span class="reveal-rank">${rankLabels[p.rank]||('#'+p.rank)}</span>
          <span class="reveal-name">${p.name}${p.uid===myUid?' (you)':''}</span>
          <span class="reveal-score">${p.score||0} pts</span>`;
        card.style.animation = 'revealSlide 0.5s ease forwards';
        revealContainer.appendChild(card);
      }
    }, delay);
    delay += isFirst ? 3500 : 4000;
  });

  // Show buttons after all reveals
  const totalDelay = delay + 1500;
  setTimeout(() => {
    renderLeaderboard('full-leaderboard', players);
    const paBtn = document.createElement('button');
    paBtn.className = 'btn-main'; paBtn.style.marginBottom='10px';
    if (isHost) { paBtn.textContent='🔁 Play Again'; paBtn.onclick=()=>{sfxClick();resetGame();}; }
    else { paBtn.textContent='🔁 Play Again'; paBtn.style.opacity='0.4'; paBtn.disabled=true; }
    const mmBtn = document.createElement('button');
    mmBtn.className='btn-ghost'; mmBtn.textContent='Main Menu'; mmBtn.onclick=()=>{sfxClick();resetToMenu();};
    const ra = document.getElementById('results-actions');
    if (isHost) ra.appendChild(paBtn);
    ra.appendChild(mmBtn);
  }, totalDelay);
}
function renderLeaderboard(containerId, playerData) {
  const container = document.getElementById(containerId); container.innerHTML = '';
  const sorted = Object.entries(playerData).sort((a,b) => (b[1].score||0)-(a[1].score||0));
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i) => {
    const row = document.createElement('div'); row.className = `lb-row rank-${i+1}`;
    row.innerHTML = `<span class="lb-rank">${medals[i]||i+1}</span>
      <span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span>
      <span class="lb-score">${p.score||0}</span>`;
    container.appendChild(row);
  });
}

// ============================================================
// TIMER
// ============================================================
function startTimerLocal(timerId, barId, seconds, onEnd) {
  stopLocalTimer();
  let remaining = seconds;
  const timerEl = document.getElementById(timerId), barEl = document.getElementById(barId);
  if (timerEl) { timerEl.textContent = remaining; timerEl.classList.remove('warn'); }
  if (barEl)   { barEl.style.width = '100%'; barEl.classList.remove('warn'); }
  localTimerId = setInterval(() => {
    remaining--;
    if (timerEl) { timerEl.textContent = remaining; if (remaining <= 3) { timerEl.classList.add('warn'); sfxTimerWarn(); } }
    if (barEl) { barEl.style.width = Math.max(0,(remaining/seconds)*100)+'%'; if (remaining<=3) barEl.classList.add('warn'); }
    if (remaining <= 0) { stopLocalTimer(); onEnd(); }
  }, 1000);
  localTimerRemaining = seconds;
}

// ============================================================
// MUTE + CONFETTI
// ============================================================
function setupMuteButtons() {
  document.querySelectorAll('.btn-mute').forEach(btn => { btn.textContent = musicOn ? '🎵' : '🔇'; btn.onclick = toggleMusic; });
}
function spawnConfetti() {
  const colors = ['#e94560','#4f8ef7','#4ade80','#fbbf24','#c084fc'];
  for (let i = 0; i < 60; i++) {
    setTimeout(() => {
      const el = document.createElement('div'); el.className = 'confetti';
      el.style.cssText = `left:${rand(10,90)}vw;top:-10px;width:${rand(6,12)}px;height:${rand(6,12)}px;background:${colors[randInt(0,colors.length-1)]};border-radius:${Math.random()>.5?'50%':'2px'};animation:confettiFall ${rand(1.5,3)}s linear forwards;`;
      document.body.appendChild(el); setTimeout(() => el.remove(), 3200);
    }, i*40);
  }
  if (!document.getElementById('confetti-style')) {
    const s = document.createElement('style'); s.id = 'confetti-style';
    s.textContent = '@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(720deg);opacity:0}}';
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
    Object.assign(updates, { 'game/level':1,'game/round':0,'game/phase':'countdown','game/roundSeed':Math.floor(Math.random()*100000),'status':'lobby' });
    await update(dbRef('rooms', roomCode), updates);
  }
  clearListeners(); stopLocalTimer(); stopFruitAnimation(); stopL5Fruits();
  Object.keys(players).forEach(uid => { if (players[uid]) players[uid].score = 0; });
  openLobby();
}
function resetToMenu() {
  clearListeners(); stopLocalTimer(); stopFruitAnimation(); stopL5Fruits(); stopJazz();
  players = {}; roomCode = ''; isHost = false; showScreen('screen-menu');
}

// ============================================================
// BUTTONS
// ============================================================
document.getElementById('btn-create').addEventListener('click', () => { sfxClick(); document.getElementById('modal-create').classList.remove('hidden'); document.getElementById('input-host-name').focus(); });
document.getElementById('btn-create-cancel').addEventListener('click', () => document.getElementById('modal-create').classList.add('hidden'));
document.getElementById('btn-create-confirm').addEventListener('click', async () => {
  const name = document.getElementById('input-host-name').value.trim();
  if (!name) { showError('create-error','Please enter your name.'); return; }
  document.getElementById('btn-create-confirm').disabled = true; sfxClick();
  try { await createRoom(name); document.getElementById('modal-create').classList.add('hidden'); }
  catch(e) { showError('create-error','Failed to create room. Check Firebase config.'); console.error(e); }
  document.getElementById('btn-create-confirm').disabled = false;
});
document.getElementById('btn-join-open').addEventListener('click', () => { sfxClick(); document.getElementById('modal-join').classList.remove('hidden'); document.getElementById('input-name').focus(); });
document.getElementById('btn-join-cancel').addEventListener('click', () => document.getElementById('modal-join').classList.add('hidden'));
document.getElementById('btn-join-confirm').addEventListener('click', async () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (!name) { showError('join-error','Enter your name.'); return; }
  if (code.length < 4) { showError('join-error','Enter the 4-character room code.'); return; }
  document.getElementById('btn-join-confirm').disabled = true; sfxClick();
  const err = await joinRoom(name, code);
  if (err) showError('join-error', err); else document.getElementById('modal-join').classList.add('hidden');
  document.getElementById('btn-join-confirm').disabled = false;
});
document.getElementById('btn-copy-code').addEventListener('click', () => { navigator.clipboard?.writeText(roomCode).catch(()=>{}); showToast('Room code copied!'); });
document.getElementById('btn-leave-lobby').addEventListener('click', async () => {
  sfxClick();
  if (roomCode && myUid) { await remove(dbRef('rooms',roomCode,'players',myUid)); if (isHost) await remove(dbRef('rooms',roomCode)); }
  resetToMenu();
});
document.getElementById('btn-main-menu').addEventListener('click', () => { sfxClick(); resetToMenu(); });
document.getElementById('btn-gameover-menu').addEventListener('click', () => { sfxClick(); resetToMenu(); });
document.getElementById('btn-gameover-again').addEventListener('click', () => { sfxClick(); resetGame(); });

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const cm = document.getElementById('modal-create'), jm = document.getElementById('modal-join');
    if (!cm.classList.contains('hidden')) document.getElementById('btn-create-confirm').click();
    else if (!jm.classList.contains('hidden')) document.getElementById('btn-join-confirm').click();
  }
  if (e.key === 'Escape') { document.getElementById('modal-create').classList.add('hidden'); document.getElementById('modal-join').classList.add('hidden'); }
});
document.getElementById('input-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
document.addEventListener('click', () => { if (musicOn && !jazzInterval) startJazz(); }, { once: true });

// ============================================================
// BOOT
// ============================================================
async function boot() {
  document.getElementById('loading-msg').textContent = 'Connecting...';
  showScreen('screen-loading');
  try {
    await initAuth(); initConnectionMonitor();
    document.getElementById('loading-msg').textContent = 'Ready!';
    await new Promise(r => setTimeout(r, 600));
    showScreen('screen-menu');
  } catch(e) {
    document.getElementById('loading-msg').textContent = 'Firebase connection failed. Check your config in firebase.js';
    console.error('Boot error:', e);
  }
}
boot();
