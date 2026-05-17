// ============================================================
// app.js — Fast Access Challenge — Multiplayer v3
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
const sfxPenalty   = () => { playTone(150,'sawtooth',0.15,0.3); playTone(120,'sawtooth',0.12,0.25,0.1); };
const sfxReveal    = () => { playTone(440,'sine',0.1,0.22); playTone(660,'sine',0.14,0.28,0.1); };
const sfxDrumroll  = () => {
  [0,0.10,0.19,0.27,0.34,0.40,0.45,0.49,0.52,0.545,0.565,0.58]
    .forEach(t => playTone(rand(180,230),'sawtooth',0.045,0.2,t));
};
const sfxChampion  = () => {
  [523,659,784,880,1047].forEach((f,i) => playTone(f,'sine',0.35,0.32,i*0.13));
  setTimeout(() => [784,880,1047,1319].forEach((f,i) => playTone(f,'sine',0.4,0.35,i*0.09)), 900);
};

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
let localTimerId = null;

// Level 1 — Color Vision
let l1Round = 0, l1CanClick = false;

// Level 2 — Text Challenge
let l2Round = 0, l2CanClick = false;

// Level 3 — Moving Fruits
let l3Round = 0, l3CanHit = false, l3Hits = 0, l3Target = '', l3NeedHits = 5;
let fruitObjects = [], rafId = null, lastTime = 0, arenaW = 0, arenaH = 0;
const FRUIT_SIZE = 38;

// Level 4 — Memory
let l4Round = 0, l4Sequence = [], l4PlayerSeq = [], l4CanInput = false;

// Level 5 — Mix
let l5Round = 0, l5CanAct = false, l5RafId = null, l5FruitObjects = [];
let l5MemSeq = [], l5MemPlayerSeq = [], l5MemCanInput = false;
let l5FruitArenaW = 0, l5FruitArenaH = 0;

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
function deductScore(pts) {
  if (!myUid || !roomCode) return;
  if (!players[myUid]) return;
  const cur = players[myUid].score || 0;
  const next = Math.max(0, cur - pts);
  players[myUid].score = next;
  updateAllScoreDisplays();
  update(dbRef('rooms', roomCode, 'players', myUid), { score: next });
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

// Shared arcade-quality collision resolver used by both L3 and L5
function resolveCollisions(objects, size) {
  for (let i = 0; i < objects.length; i++) {
    const f = objects[i]; if (f.tapped) continue;
    for (let j = i+1; j < objects.length; j++) {
      const g = objects[j]; if (g.tapped) continue;
      const dx = (f.x + size/2) - (g.x + size/2);
      const dy = (f.y + size/2) - (g.y + size/2);
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < size && dist > 0.001) {
        const nx = dx/dist, ny = dy/dist;
        // Separate overlapping objects
        const overlap = (size - dist) / 2 + 0.5;
        f.x += nx * overlap; f.y += ny * overlap;
        g.x -= nx * overlap; g.y -= ny * overlap;
        // Elastic velocity exchange along collision normal
        const relV = (f.vx - g.vx)*nx + (f.vy - g.vy)*ny;
        if (relV < 0) {
          const restitution = 0.85;
          const impulse = relV * (1 + restitution) / 2;
          f.vx -= impulse*nx; f.vy -= impulse*ny;
          g.vx += impulse*nx; g.vy += impulse*ny;
          // Speed cap to prevent explosions
          const cap = 120;
          const clamp = v => { const sp = Math.sqrt(v.vx*v.vx+v.vy*v.vy); if(sp>cap){v.vx=v.vx/sp*cap;v.vy=v.vy/sp*cap;} };
          clamp(f); clamp(g);
        }
      }
    }
  }
}

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
  showLevelIntro(1, startLevel1);
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
      setTimeout(() => { overlay.classList.add('hidden'); cb(); }, 650);
    } else { numEl.textContent = count; sfxCountdown(); animateCN(numEl); }
  }, 900);
}
function animateCN(el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'popIn 0.5s ease'; }

// ============================================================
// LEVEL INTRO SYSTEM
// ============================================================
const LEVEL_INTROS = {
  1: { emoji:'🎨', title:'Colour Vision', sub:'Find the one circle with a different shade!',
       tip:'Difficulty rises every round — hues get closer together.', badge:'7 Rounds' },
  2: { emoji:'📝', title:'Text Challenge', sub:'Pick the correctly spelled word or the true statement!',
       tip:'Half the rounds use sentences — read carefully.', badge:'10 Rounds' },
  3: { emoji:'🍎', title:'Fruit Frenzy', sub:'Tap every target fruit before time runs out!',
       tip:'Wrong taps cost you points. Fruits bounce — never overlap!', badge:'5 Waves' },
  4: { emoji:'🧠', title:'Memory Flash', sub:'Memorise the sequence then recreate it!',
       tip:'Max 4 items — but viewing time shrinks each round.', badge:'5 Rounds' },
  5: { emoji:'🌀', title:'Mix Madness', sub:'All challenges combined — anything goes!',
       tip:'Cycles through Colour → Text → Fruits → Memory. Stay alert!', badge:'8 Events' },
};
function showLevelIntro(lvl, cb) {
  const info = LEVEL_INTROS[lvl];
  if (!info) { cb(); return; }
  const ov = document.getElementById('level-intro-overlay');
  document.getElementById('intro-level-emoji').textContent  = info.emoji;
  document.getElementById('intro-level-num').textContent    = `Level ${lvl}`;
  document.getElementById('intro-level-title').textContent  = info.title;
  document.getElementById('intro-level-badge').textContent  = info.badge;
  document.getElementById('intro-level-sub').textContent    = info.sub;
  document.getElementById('intro-level-tip').textContent    = `💡 ${info.tip}`;
  document.getElementById('intro-countdown').textContent    = '';
  ov.classList.remove('hidden');
  void ov.offsetWidth; ov.classList.add('intro-in');
  setTimeout(() => {
    let c = 3;
    document.getElementById('intro-countdown').textContent = c; sfxCountdown();
    const tick = setInterval(() => {
      c--;
      if (c <= 0) {
        clearInterval(tick);
        document.getElementById('intro-countdown').textContent = 'GO!'; sfxGo();
        setTimeout(() => { ov.classList.add('hidden'); ov.classList.remove('intro-in'); cb(); }, 520);
      } else { document.getElementById('intro-countdown').textContent = c; sfxCountdown(); }
    }, 800);
  }, 2000);
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
function syncScoresDisplay(id) {
  const c = document.getElementById(id); if (!c) return;
  listenOn(`rooms/${roomCode}/players`, snap => { players = snap.val() || {}; renderScoreChips(c); });
}
function updateAllScoreDisplays() {
  ['l1-scores','l2-scores','l3-scores','l4-scores','l5-scores'].forEach(id => {
    const c = document.getElementById(id); if (c && c.childElementCount > 0) renderScoreChips(c);
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
    if (barEl)   { barEl.style.width = Math.max(0,(remaining/seconds)*100)+'%'; if (remaining<=3) barEl.classList.add('warn'); }
    if (remaining <= 0) { stopLocalTimer(); onEnd(); }
  }, 1000);
}
function setupMuteButtons() {
  document.querySelectorAll('.btn-mute').forEach(b => { b.textContent = musicOn ? '🎵' : '🔇'; b.onclick = toggleMusic; });
}

// ============================================================
// LEVEL 1 — COLOUR VISION 🎨  (7 rounds)
// ============================================================
const L1_ROUNDS = 7;
const L1_CFG = [
  { grid:4, time:14, hueDiff:32 },  // Stage 1 — easy
  { grid:4, time:12, hueDiff:24 },  // Stage 2
  { grid:4, time:11, hueDiff:18 },  // Stage 3
  { grid:5, time:10, hueDiff:13 },  // Stage 4
  { grid:5, time:9,  hueDiff:9  },  // Stage 5
  { grid:6, time:8,  hueDiff:7  },  // Stage 6 — hard
  { grid:6, time:7,  hueDiff:5  },  // Stage 7 — very hard
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
  document.getElementById('l1-round').textContent = `${l1Round+1}/${L1_ROUNDS}`;
  document.getElementById('l1-stage').textContent = `Stage ${l1Round+1}`;
  buildL1Grid(cfg, l1Round * 9173 + 7);
  l1CanClick = true;
  startTimerLocal('l1-timer','l1-timer-bar', cfg.time, () => {
    l1CanClick = false;
    document.querySelectorAll('.color-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    l1Round++; setTimeout(nextL1Round, 750);
  });
}
function buildL1Grid(cfg, seed) {
  const grid = document.getElementById('color-grid');
  grid.innerHTML = '';
  const n = cfg.grid, total = n*n;
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  const oddIdx = seed % total;
  const baseHue = (seed * 37) % 360;
  const oddHue  = (baseHue + cfg.hueDiff) % 360;
  const sat = 58 + (seed % 18), lit = 52 + (seed % 13);
  for (let i = 0; i < total; i++) {
    const el = document.createElement('div');
    el.className = 'color-cell' + (i === oddIdx ? ' odd-cell' : '');
    el.style.background = `hsl(${i===oddIdx?oddHue:baseHue},${sat}%,${lit}%)`;
    el.addEventListener('click', () => handleL1Click(el, i===oddIdx));
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
// LEVEL 2 — TEXT CHALLENGE 📝  (10 rounds: 5 words + 5 sentences)
// ============================================================
// Word rounds: pick the correctly spelled word
const WORD_ITEMS = [
  { type:'word', correct:'banana',    options:['banana','bananna','bananah','bannana','banaana','banane','banannah'] },
  { type:'word', correct:'calendar',  options:['calender','calendar','calandar','callender','calandir','calenddar','callendar'] },
  { type:'word', correct:'receive',   options:['recieve','receive','receeve','recevie','recive','reciive','receivve'] },
  { type:'word', correct:'necessary', options:['necessary','neccessary','necessery','nesessary','necesary','neccesary','necessarry'] },
  { type:'word', correct:'separate',  options:['seperate','separete','separate','saparate','seperatee','saparete','separrate'] },
  { type:'word', correct:'achieve',   options:['acheive','achieve','acheeve','achiive','achivee','achive','achiev'] },
  { type:'word', correct:'occurred',  options:['occured','ocurred','occurred','occuried','ocurreed','occureed','occurrred'] },
  { type:'word', correct:'believe',   options:['beleive','beleave','believe','beleve','beliieve','beleeve','believve'] },
  { type:'word', correct:'beautiful', options:['beatiful','beutiful','beautiful','beautyful','beatyful','beautifull','beauttiful'] },
  { type:'word', correct:'tomorrow',  options:['tommorow','tomorow','tomorrow','tommorrow','tomorrrow','tomoorrow','tomorrrow'] },
];
// Statement rounds: pick the correct (true/accurate) statement
const STMT_ITEMS = [
  { type:'stmt', prompt:'Which statement is TRUE?',
    correct:'Paris is the capital of France.',
    options:['Paris is the capital of Spain.','Paris is the capital of France.','London is the capital of France.','Berlin is the capital of France.'] },
  { type:'stmt', prompt:'Which sentence is CORRECTLY written?',
    correct:'She goes to school every day.',
    options:['She go to school every day.','She gone to school every day.','She goes to school every day.','She going to school every day.'] },
  { type:'stmt', prompt:'Choose the CORRECT statement:',
    correct:'The sun rises in the east.',
    options:['The sun rises in the west.','The sun rises in the south.','The sun rises in the east.','The sun rises at midnight.'] },
  { type:'stmt', prompt:'Pick the sentence that makes SENSE:',
    correct:'The cat sat quietly on the mat.',
    options:['The cat sat quietly on the mat.','The mat sat on the cat quietly.','Quietly on the mat the sat cat.','The sat mat cat on quietly the.'] },
  { type:'stmt', prompt:'Which sentence uses the word CORRECTLY?',
    correct:'She was affected by the cold weather.',
    options:['She was effected by the cold weather.','She was affected by the cold weather.','She was affacted by the cold weather.','She was afected by the cold weather.'] },
];
// Build 10-round sequence: alternating word/statement, scaled difficulty
const L2_DATA = [
  WORD_ITEMS[0], STMT_ITEMS[0],
  WORD_ITEMS[1], STMT_ITEMS[1],
  WORD_ITEMS[2], STMT_ITEMS[2],
  WORD_ITEMS[3], STMT_ITEMS[3],
  WORD_ITEMS[4], STMT_ITEMS[4],
];
const L2_ROUNDS = 10;
const L2_CFG = [
  { time:13, opts:3 }, { time:14, opts:3 },
  { time:11, opts:4 }, { time:12, opts:4 },
  { time:10, opts:5 }, { time:11, opts:4 },
  { time: 9, opts:6 }, { time:10, opts:4 },
  { time: 7, opts:7 }, { time: 8, opts:4 },
];
function startLevel2() {
  l2Round = 0;
  showScreen('screen-level2'); setupMuteButtons(); syncScoresDisplay('l2-scores');
  nextL2Round();
}
function nextL2Round() {
  stopLocalTimer();
  if (l2Round >= L2_ROUNDS) { finishLevel(2); return; }
  const cfg  = L2_CFG[l2Round];
  const item = L2_DATA[l2Round];
  document.getElementById('l2-round').textContent = `${l2Round+1}/${L2_ROUNDS}`;
  document.getElementById('l2-stage').textContent = item.type === 'stmt' ? 'Statement' : 'Spelling';
  document.getElementById('word-prompt').textContent = item.type === 'stmt' ? item.prompt : 'Which is spelled correctly?';
  const container = document.getElementById('word-options');
  container.innerHTML = '';
  container.className = item.type === 'stmt' ? 'word-options stmt-mode' : 'word-options';
  const pool = item.type === 'stmt'
    ? shuffle(item.options).slice(0, cfg.opts)
    : shuffle(item.options.filter(o => o !== item.correct)).slice(0, cfg.opts - 1);
  const opts = item.type === 'stmt'
    ? pool
    : shuffle([item.correct, ...pool]);
  // Ensure correct is in the stmt pool
  const finalOpts = item.type === 'stmt' && !opts.includes(item.correct)
    ? shuffle([item.correct, ...opts.slice(0,-1)])
    : opts;
  finalOpts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'word-btn';
    btn.textContent = opt;
    btn.onclick = () => handleL2Click(btn, opt === item.correct, item.correct);
    container.appendChild(btn);
  });
  l2CanClick = true;
  startTimerLocal('l2-timer','l2-timer-bar', cfg.time, () => {
    l2CanClick = false;
    document.querySelectorAll('.word-btn').forEach(b => {
      if (b.textContent === item.correct) b.classList.add('correct-pick');
      b.disabled = true;
    });
    showToast(`⏱ Correct: "${item.correct}"`);
    l2Round++; setTimeout(nextL2Round, 1300);
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
  l2Round++; setTimeout(nextL2Round, 1100);
}

// ============================================================
// LEVEL 3 — FRUIT FRENZY 🍎  (5 waves, gradual speed increase)
// ============================================================
const ALL_FRUITS = ['🍎','🍌','🍇','🍓','🍍','🍊','🫐','🍑'];
const L3_ROUNDS  = 5;
const L3_CFG     = [
  { time:16, total:12, speedMin:22, speedMax:42, penalty:25 },
  { time:15, total:14, speedMin:28, speedMax:50, penalty:25 },
  { time:14, total:15, speedMin:33, speedMax:58, penalty:30 },
  { time:13, total:17, speedMin:38, speedMax:66, penalty:30 },
  { time:11, total:19, speedMin:43, speedMax:74, penalty:35 },
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
  document.getElementById('l3-round').textContent = `${l3Round+1}/${L3_ROUNDS}`;
  document.getElementById('l3-stage').textContent = `Wave ${l3Round+1}`;
  l3Target = pick(ALL_FRUITS);
  document.getElementById('l3-target').textContent = l3Target;
  document.getElementById('l3-hits').textContent = `0/${l3NeedHits}`;
  const arena = document.getElementById('l3-arena');
  arena.innerHTML = '';
  arenaW = arena.offsetWidth  || 360;
  arenaH = arena.offsetHeight || 220;
  // Separate fruits with no starting overlap
  const positions = [];
  const fruitList = [];
  for (let i = 0; i < l3NeedHits; i++) fruitList.push(l3Target);
  while (fruitList.length < cfg.total) {
    const f = pick(ALL_FRUITS); if (f !== l3Target) fruitList.push(f);
  }
  shuffle(fruitList).forEach(emoji => {
    let x, y, tries = 0;
    do {
      x = rand(4, arenaW - FRUIT_SIZE - 4);
      y = rand(4, arenaH - FRUIT_SIZE - 4);
      tries++;
    } while (tries < 20 && positions.some(p => Math.hypot(p.x-x, p.y-y) < FRUIT_SIZE+4));
    positions.push({x,y});
    const el = document.createElement('div');
    el.className = 'fruit'; el.textContent = emoji; el.style.fontSize = FRUIT_SIZE+'px';
    el.style.left = x+'px'; el.style.top = y+'px';
    const speed = rand(cfg.speedMin, cfg.speedMax), angle = rand(0, Math.PI*2);
    const fObj = { el, x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, emoji, tapped:false };
    fruitObjects.push(fObj); arena.appendChild(el);
    el.addEventListener('click', () => handleL3Tap(fObj, cfg.penalty));
    el.addEventListener('touchstart', e => { e.preventDefault(); handleL3Tap(fObj, cfg.penalty); }, {passive:false});
  });
  lastTime = performance.now(); animateFruits();
  startTimerLocal('l3-timer','l3-timer-bar', cfg.time, () => {
    l3CanHit = false; stopFruitAnimation();
    showToast(`⏱ Wave over! ${l3Hits}/${l3NeedHits}`);
    l3Round++; setTimeout(nextL3Round, 900);
  });
}
function animateFruits() {
  rafId = requestAnimationFrame(now => {
    const dt = Math.min((now - lastTime)/1000, 0.05); lastTime = now;
    for (const f of fruitObjects) {
      if (f.tapped) continue;
      f.x += f.vx*dt; f.y += f.vy*dt;
      if (f.x < 0)              { f.x = 0;              f.vx =  Math.abs(f.vx); }
      if (f.x > arenaW-FRUIT_SIZE) { f.x = arenaW-FRUIT_SIZE; f.vx = -Math.abs(f.vx); }
      if (f.y < 0)              { f.y = 0;              f.vy =  Math.abs(f.vy); }
      if (f.y > arenaH-FRUIT_SIZE) { f.y = arenaH-FRUIT_SIZE; f.vy = -Math.abs(f.vy); }
      f.el.style.left = f.x+'px'; f.el.style.top = f.y+'px';
    }
    resolveCollisions(fruitObjects, FRUIT_SIZE);
    animateFruits();
  });
}
function handleL3Tap(fObj, penalty) {
  if (!l3CanHit || fObj.tapped) return;
  if (fObj.emoji === l3Target) {
    fObj.tapped = true; fObj.el.classList.add('popped');
    l3Hits++; addMyScore(50); sfxCorrect();
    document.getElementById('l3-hits').textContent = `${l3Hits}/${l3NeedHits}`;
    showToast('🎯 +50 pts!');
    setTimeout(() => fObj.el.remove(), 260);
    if (l3Hits >= l3NeedHits) {
      l3CanHit = false; stopLocalTimer(); stopFruitAnimation(); sfxLevelUp();
      showToast('🔥 Wave clear!'); l3Round++; setTimeout(nextL3Round, 700);
    }
  } else {
    fObj.el.classList.add('wrong-tap');
    setTimeout(() => fObj.el.classList.remove('wrong-tap'), 300);
    sfxPenalty(); deductScore(penalty);
    showToast(`❌ Wrong! −${penalty} pts`);
  }
}

// ============================================================
// LEVEL 4 — MEMORY FLASH 🧠  (5 rounds, max seq 4)
// ============================================================
const L4_ROUNDS = 5;
const L4_EMOJIS = ['🍎','⭐','🎲','🍌','🔥','💎','🎯','🌙','🎪','🦋'];
const L4_CFG    = [
  { seqLen:3, showTime:6000, answerTime:12 },
  { seqLen:3, showTime:5000, answerTime:11 },
  { seqLen:4, showTime:4500, answerTime:10 },
  { seqLen:4, showTime:3500, answerTime:9  },
  { seqLen:4, showTime:2800, answerTime:8  },
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
  document.getElementById('l4-round').textContent = `${l4Round+1}/${L4_ROUNDS}`;
  document.getElementById('l4-stage').textContent = `Round ${l4Round+1}`;
  l4Sequence = []; l4PlayerSeq = []; l4CanInput = false;
  for (let i = 0; i < cfg.seqLen; i++) l4Sequence.push(L4_EMOJIS[randInt(0, L4_EMOJIS.length-1)]);
  const display   = document.getElementById('l4-sequence-display');
  const prompt    = document.getElementById('l4-prompt');
  const inputArea = document.getElementById('l4-input-area');
  const feedback  = document.getElementById('l4-feedback');
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
    startTimerLocal('l4-timer','l4-timer-bar', cfg.answerTime, () => { l4CanInput = false; showL4Result(false); });
  }, cfg.showTime);
}
function buildL4Input() {
  const inputArea = document.getElementById('l4-input-area');
  const slotArea  = document.getElementById('l4-slots');
  inputArea.innerHTML = ''; slotArea.innerHTML = '';
  const counts = {};
  l4Sequence.forEach(e => { counts[e] = (counts[e]||0)+1; });
  const pool = Object.keys(counts);
  while (pool.length < Math.min(L4_EMOJIS.length, l4Sequence.length + 3)) {
    const e = L4_EMOJIS[randInt(0, L4_EMOJIS.length-1)]; if (!pool.includes(e)) pool.push(e);
  }
  shuffle(pool).forEach(emoji => {
    const max = counts[emoji]||0; let left = max;
    const btn = document.createElement('button'); btn.className = 'mem-btn'; btn.textContent = emoji;
    const upd = () => {
      btn.dataset.uses = left;
      if (max > 1) btn.setAttribute('data-count', left > 0 ? `×${left}` : '');
      btn.disabled = left <= 0;
    };
    upd();
    btn.onclick = () => { if (!l4CanInput || left<=0) return; left--; upd(); handleL4Pick(emoji); };
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
  if (l4PlayerSeq.length === l4Sequence.length) { l4CanInput = false; stopLocalTimer(); showL4Result(l4PlayerSeq.every((e,i) => e===l4Sequence[i])); }
}
function showL4Result(correct) {
  const fb  = document.getElementById('l4-feedback');
  const dis = document.getElementById('l4-sequence-display');
  dis.innerHTML = l4Sequence.map((e,i) => {
    const pe = l4PlayerSeq[i], ok = pe === e;
    return `<span class="mem-emoji ${correct?'correct':(pe?(ok?'correct':'wrong'):'missing')}">${e}</span>`;
  }).join('');
  dis.classList.remove('hidden');
  if (correct) { addMyScore(150); sfxCorrect(); fb.textContent='✅ Perfect! +150 pts'; fb.className='l4-feedback correct'; }
  else { sfxWrong(); fb.textContent='❌ Wrong order!'; fb.className='l4-feedback wrong'; }
  l4Round++; setTimeout(nextL4Round, 1600);
}

// ============================================================
// LEVEL 5 — MIX MADNESS 🌀  (8 events, cycling all types)
// ============================================================
const L5_ROUNDS = 8;
const L5_TYPES  = ['color','word','fruit','memory'];
const L5_COLOR_CFG = [
  {grid:3,time:11,hueDiff:26},{grid:4,time:9,hueDiff:19},
  {grid:4,time:8,hueDiff:14},{grid:5,time:7,hueDiff:10},
  {grid:5,time:6,hueDiff:7}
];
const L5_WORD_TIME = [11,10,9,8,7,6];
let l5ColorSeed = 0;

function startLevel5() {
  l5Round = 0;
  showScreen('screen-level5'); setupMuteButtons(); syncScoresDisplay('l5-scores');
  nextL5Round();
}
function nextL5Round() {
  stopLocalTimer(); stopL5Fruits();
  const arena    = document.getElementById('l5-arena');
  const feedback = document.getElementById('l5-feedback');
  if (arena)    { arena.innerHTML = ''; arena.style.cssText = ''; }
  if (feedback) feedback.textContent = '';
  document.getElementById('l5-fruit-target-wrap').classList.add('hidden');
  if (l5Round >= L5_ROUNDS) { finishLevel(5); return; }
  document.getElementById('l5-round').textContent = `${l5Round+1}/${L5_ROUNDS}`;
  const type = L5_TYPES[l5Round % L5_TYPES.length];
  if      (type==='color')  buildL5Color();
  else if (type==='word')   buildL5Word();
  else if (type==='fruit')  buildL5Fruit();
  else                      buildL5Memory();
}
function buildL5Color() {
  const cfgIdx = Math.min(Math.floor(l5Round/4), L5_COLOR_CFG.length-1);
  const cfg    = L5_COLOR_CFG[cfgIdx];
  const arena  = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '🎨 Find the odd colour!';
  arena.style.display = 'grid';
  arena.style.gridTemplateColumns = `repeat(${cfg.grid},1fr)`;
  arena.style.gap = '6px';
  l5ColorSeed = l5Round * 3311 + 42;
  const total = cfg.grid*cfg.grid;
  const oddIdx = l5ColorSeed % total;
  const baseHue = (l5ColorSeed*37)%360, oddHue = (baseHue+cfg.hueDiff)%360;
  const sat = 56+(l5ColorSeed%18), lit = 50+(l5ColorSeed%14);
  l5CanAct = true;
  for (let i = 0; i < total; i++) {
    const el = document.createElement('div');
    el.className = 'color-cell l5-color-cell'+(i===oddIdx?' odd-cell':'');
    el.style.background = `hsl(${i===oddIdx?oddHue:baseHue},${sat}%,${lit}%)`;
    el.addEventListener('click', () => {
      if (!l5CanAct) return; l5CanAct = false; stopLocalTimer();
      const fb = document.getElementById('l5-feedback');
      if (i===oddIdx) { addMyScore(100); sfxCorrect(); fb.textContent='✅ +100'; fb.className='l5-fb correct'; }
      else { sfxWrong(); fb.textContent='❌ Wrong!'; fb.className='l5-fb wrong'; }
      l5Round++; setTimeout(nextL5Round, 700);
    });
    arena.appendChild(el);
  }
  startTimerLocal('l5-timer','l5-timer-bar', cfg.time, () => {
    l5CanAct = false;
    document.querySelectorAll('.l5-color-cell.odd-cell').forEach(c => c.classList.add('reveal'));
    const fb = document.getElementById('l5-feedback'); fb.textContent="⏱ Time's up!"; fb.className='l5-fb timeout';
    l5Round++; setTimeout(nextL5Round, 700);
  });
}
function buildL5Word() {
  const tIdx = Math.min(Math.floor(l5Round/4), L5_WORD_TIME.length-1);
  const t    = L5_WORD_TIME[tIdx];
  const item = L2_DATA[l5Round % L2_DATA.length];
  const arena = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = item.type==='stmt' ? '📝 True statement?' : '📝 Correct spelling?';
  arena.style.display = 'flex'; arena.style.flexWrap = 'wrap'; arena.style.gap = '8px';
  const pool = item.type==='stmt'
    ? shuffle(item.options).slice(0,3)
    : shuffle(item.options.filter(o=>o!==item.correct)).slice(0,3);
  let opts = item.type==='stmt' ? (pool.includes(item.correct)?pool:shuffle([item.correct,...pool.slice(0,2)])) : shuffle([item.correct,...pool]);
  l5CanAct = true;
  opts.forEach(opt => {
    const btn = document.createElement('button'); btn.className = 'word-btn l5-word-btn'; btn.textContent = opt;
    btn.onclick = () => {
      if (!l5CanAct) return; l5CanAct = false; stopLocalTimer();
      arena.querySelectorAll('button').forEach(b => b.disabled = true);
      const fb = document.getElementById('l5-feedback');
      if (opt===item.correct) { btn.classList.add('correct-pick'); addMyScore(100); sfxCorrect(); fb.textContent='✅ +100'; fb.className='l5-fb correct'; }
      else { btn.classList.add('wrong-pick'); arena.querySelectorAll('button').forEach(b=>{if(b.textContent===item.correct)b.classList.add('correct-pick');}); sfxWrong(); fb.textContent='❌ Wrong!'; fb.className='l5-fb wrong'; }
      l5Round++; setTimeout(nextL5Round, 950);
    };
    arena.appendChild(btn);
  });
  startTimerLocal('l5-timer','l5-timer-bar', t, () => {
    l5CanAct = false; arena.querySelectorAll('button').forEach(b=>{b.disabled=true;if(b.textContent===item.correct)b.classList.add('correct-pick');});
    const fb = document.getElementById('l5-feedback'); fb.textContent="⏱ Time's up!"; fb.className='l5-fb timeout';
    l5Round++; setTimeout(nextL5Round, 950);
  });
}
function buildL5Fruit() {
  const tVal = Math.max(8, 14 - l5Round);
  const arena = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '🍎 Tap the target fruit!';
  arena.style.display = 'block'; arena.style.position = 'relative';
  const target = pick(ALL_FRUITS);
  document.getElementById('l5-fruit-target').textContent = target;
  document.getElementById('l5-fruit-target-wrap').classList.remove('hidden');
  document.getElementById('l5-fruit-hits').textContent = '0/3';
  l5FruitArenaW = arena.offsetWidth||320; l5FruitArenaH = arena.offsetHeight||180;
  l5FruitObjects = []; l5CanAct = true;
  let hits = 0; const needHits = 3;
  const total = Math.min(10 + l5Round, 16);
  const flist = [target, target, target];
  while (flist.length < total) { const f = pick(ALL_FRUITS); if (f!==target) flist.push(f); }
  shuffle(flist).forEach(emoji => {
    const el = document.createElement('div'); el.className='fruit'; el.textContent=emoji; el.style.fontSize=FRUIT_SIZE+'px'; el.style.position='absolute';
    const x = rand(2, l5FruitArenaW-FRUIT_SIZE-2), y = rand(2, l5FruitArenaH-FRUIT_SIZE-2);
    const speed = rand(30+l5Round*3, 55+l5Round*4), angle = rand(0,Math.PI*2);
    el.style.left=x+'px'; el.style.top=y+'px';
    const fObj = {el,x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,emoji,tapped:false};
    l5FruitObjects.push(fObj); arena.appendChild(el);
    const tap = () => {
      if (!l5CanAct||fObj.tapped) return;
      if (fObj.emoji===target) {
        fObj.tapped=true; fObj.el.classList.add('popped'); addMyScore(50); sfxCorrect();
        hits++; document.getElementById('l5-fruit-hits').textContent=`${hits}/${needHits}`;
        setTimeout(()=>fObj.el.remove(),250);
        if (hits>=needHits) {
          l5CanAct=false; stopLocalTimer(); stopL5Fruits();
          document.getElementById('l5-fruit-target-wrap').classList.add('hidden');
          const fb=document.getElementById('l5-feedback'); fb.textContent='🔥 +150!'; fb.className='l5-fb correct';
          addMyScore(100); l5Round++; setTimeout(nextL5Round,700);
        }
      } else { fObj.el.classList.add('wrong-tap'); setTimeout(()=>fObj.el.classList.remove('wrong-tap'),300); sfxPenalty(); deductScore(20); showToast('❌ Wrong! −20'); }
    };
    el.addEventListener('click', tap);
    el.addEventListener('touchstart', e2=>{e2.preventDefault();tap();},{passive:false});
  });
  let lastT = performance.now();
  const animL5 = now => {
    const dt = Math.min((now-lastT)/1000,0.05); lastT = now;
    for (const f of l5FruitObjects) {
      if (f.tapped) continue;
      f.x+=f.vx*dt; f.y+=f.vy*dt;
      if(f.x<0){f.x=0;f.vx=Math.abs(f.vx);}
      if(f.x>l5FruitArenaW-FRUIT_SIZE){f.x=l5FruitArenaW-FRUIT_SIZE;f.vx=-Math.abs(f.vx);}
      if(f.y<0){f.y=0;f.vy=Math.abs(f.vy);}
      if(f.y>l5FruitArenaH-FRUIT_SIZE){f.y=l5FruitArenaH-FRUIT_SIZE;f.vy=-Math.abs(f.vy);}
      f.el.style.left=f.x+'px'; f.el.style.top=f.y+'px';
    }
    resolveCollisions(l5FruitObjects, FRUIT_SIZE);
    l5RafId = requestAnimationFrame(animL5);
  };
  l5RafId = requestAnimationFrame(animL5);
  startTimerLocal('l5-timer','l5-timer-bar', tVal, () => {
    l5CanAct=false; stopL5Fruits();
    document.getElementById('l5-fruit-target-wrap').classList.add('hidden');
    const fb=document.getElementById('l5-feedback'); fb.textContent=`⏱ Got ${hits}/${needHits}`; fb.className='l5-fb timeout';
    l5Round++; setTimeout(nextL5Round,700);
  });
}
function buildL5Memory() {
  const showMs = Math.max(1400, 3800 - l5Round*280);
  const arena  = document.getElementById('l5-arena');
  document.getElementById('l5-type-label').textContent = '🧠 Memorise & recreate!';
  arena.style.display='flex'; arena.style.flexWrap='wrap'; arena.style.gap='8px';
  const seqLen = 3;
  l5MemSeq=[]; l5MemPlayerSeq=[]; l5MemCanInput=false;
  for(let i=0;i<seqLen;i++) l5MemSeq.push(L4_EMOJIS[randInt(0,L4_EMOJIS.length-1)]);
  arena.innerHTML=`<div class="l5-mem-display">${l5MemSeq.map(e=>`<span class="mem-emoji">${e}</span>`).join('')}</div>`;
  l5CanAct=false;
  setTimeout(()=>{
    arena.innerHTML=''; arena.style.flexWrap='wrap';
    const slotRow=document.createElement('div'); slotRow.className='mem-slots'; slotRow.style.marginBottom='8px';
    for(let i=0;i<l5MemSeq.length;i++){const s=document.createElement('div');s.className='mem-slot';slotRow.appendChild(s);}
    arena.appendChild(slotRow);
    const counts={}; l5MemSeq.forEach(e=>{counts[e]=(counts[e]||0)+1;});
    const pool=Object.keys(counts);
    while(pool.length<Math.min(L4_EMOJIS.length,l5MemSeq.length+2)){const e=L4_EMOJIS[randInt(0,L4_EMOJIS.length-1)];if(!pool.includes(e))pool.push(e);}
    const btnRow=document.createElement('div'); btnRow.className='mem-input';
    shuffle(pool).forEach(emoji=>{
      const max=counts[emoji]||0; let left=max;
      const btn=document.createElement('button'); btn.className='mem-btn'; btn.textContent=emoji;
      const upd=()=>{btn.dataset.uses=left;if(max>1)btn.setAttribute('data-count',left>0?`×${left}`:'');btn.disabled=left<=0;};
      upd();
      btn.onclick=()=>{
        if(!l5MemCanInput||left<=0)return; left--; upd();
        l5MemPlayerSeq.push(emoji);
        const slots=slotRow.querySelectorAll('.mem-slot'); const idx=l5MemPlayerSeq.length-1;
        if(slots[idx]){slots[idx].textContent=emoji;slots[idx].classList.add('filled');}
        if(l5MemPlayerSeq.length===l5MemSeq.length){
          l5MemCanInput=false; stopLocalTimer();
          const ok=l5MemPlayerSeq.every((e2,i)=>e2===l5MemSeq[i]);
          const fb=document.getElementById('l5-feedback');
          if(ok){addMyScore(150);sfxCorrect();fb.textContent='✅ Perfect! +150';fb.className='l5-fb correct';}
          else{sfxWrong();fb.textContent='❌ Wrong order!';fb.className='l5-fb wrong';}
          l5Round++; setTimeout(nextL5Round,1200);
        }
      };
      btnRow.appendChild(btn);
    });
    arena.appendChild(btnRow);
    l5MemCanInput=true; l5CanAct=true;
    startTimerLocal('l5-timer','l5-timer-bar',10,()=>{
      l5MemCanInput=false; l5CanAct=false;
      const fb=document.getElementById('l5-feedback'); fb.textContent="⏱ Time's up!"; fb.className='l5-fb timeout';
      l5Round++; setTimeout(nextL5Round,800);
    });
  }, showMs);
}

// ============================================================
// BETWEEN LEVELS / LEADERBOARD
// ============================================================
function finishLevel(lvl) {
  stopLocalTimer(); stopFruitAnimation(); stopL5Fruits(); sfxLevelUp();
  get(dbRef('rooms', roomCode, 'players')).then(s => { players = s.val()||{}; showBetweenScreen(lvl); });
}
function showBetweenScreen(lvl) {
  document.getElementById('between-title').textContent = lvl < 5 ? `Level ${lvl} Complete! 🎉` : 'All Done! 🏆';
  document.getElementById('between-sub').textContent   = `Leaderboard after Level ${lvl}`;
  renderLeaderboard('leaderboard-between', players);
  showScreen('screen-between');
  const nextBtn = document.getElementById('btn-next-level');
  const cd      = document.getElementById('between-countdown');
  if (isHost) {
    nextBtn.classList.remove('hidden'); nextBtn.disabled = false;
    nextBtn.textContent = lvl < 5 ? 'Next Level →' : 'See Results →';
    nextBtn.onclick = () => {
      nextBtn.disabled = true; sfxClick();
      const nextLvl = lvl < 5 ? lvl+1 : 'results';
      update(dbRef('rooms', roomCode), { 'game/level': nextLvl });
      const go = () => {
        if      (lvl===1) startLevel2();
        else if (lvl===2) startLevel3();
        else if (lvl===3) startLevel4();
        else if (lvl===4) startLevel5();
        else showFinalResults();
      };
      if (lvl < 5) showLevelIntro(lvl+1, go); else go();
    };
    cd.textContent = '';
  } else {
    nextBtn.classList.add('hidden');
    cd.textContent = 'Waiting for host...';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/level`, snap => {
      const v = snap.val();
      if (v === 'results') { clearListeners(); showFinalResults(); return; }
      if (v > lvl) {
        clearListeners();
        const go = () => {
          if      (v===2) startLevel2();
          else if (v===3) startLevel3();
          else if (v===4) startLevel4();
          else if (v===5) startLevel5();
        };
        showLevelIntro(v, go);
      }
    });
  }
}
function renderLeaderboard(id, playerData) {
  const container = document.getElementById(id); if(!container) return;
  container.innerHTML = '';
  const sorted = Object.entries(playerData).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
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
// FINAL RESULTS — Dramatic sequential reveal
// ============================================================
function showFinalResults() {
  stopLocalTimer(); stopFruitAnimation(); stopL5Fruits(); stopJazz();
  get(dbRef('rooms', roomCode, 'players')).then(s => { players = s.val()||{}; renderResults(); });
}
function renderResults() {
  const sorted = Object.entries(players)
    .sort((a,b)=>(b[1].score||0)-(a[1].score||0))
    .map(([uid,p],i)=>({uid,...p,rank:i+1}));
  showScreen('screen-results');
  document.getElementById('podium').innerHTML = '';
  document.getElementById('full-leaderboard').innerHTML = '';
  document.getElementById('results-actions').innerHTML = '';
  document.getElementById('champion-overlay').classList.add('hidden');
  document.getElementById('champion-overlay').classList.remove('champion-reveal');

  // Reveal 5th→2nd in cards, then champion overlay for 1st
  const toReveal = sorted.slice(0,5).reverse(); // [5th,4th,3rd,2nd,1st]
  const rankLabel = {1:'🥇 CHAMPION',2:'🥈 2nd Place',3:'🥉 3rd Place',4:'4th Place',5:'5th Place'};
  let delay = 600;
  toReveal.forEach(p => {
    if (p.rank === 1) {
      // First place — champion overlay
      setTimeout(() => {
        sfxDrumroll();
        const ov = document.getElementById('champion-overlay');
        document.getElementById('champion-name').textContent  = p.name + (p.uid===myUid ? ' 🎉' : '');
        document.getElementById('champion-score').textContent = (p.score||0) + ' pts';
        ov.classList.remove('hidden');
        setTimeout(() => {
          ov.classList.add('champion-reveal');
          sfxChampion();
          spawnConfetti(); setTimeout(spawnConfetti,500); setTimeout(spawnConfetti,1000);
        }, 2400);
      }, delay);
    } else {
      setTimeout(() => {
        sfxReveal();
        const card = document.createElement('div'); card.className=`reveal-card rank-${p.rank}`;
        card.innerHTML = `<span class="reveal-rank">${rankLabel[p.rank]||('#'+p.rank)}</span>
          <span class="reveal-name">${p.name}${p.uid===myUid?' (you)':''}</span>
          <span class="reveal-score">${p.score||0} pts</span>`;
        document.getElementById('podium').appendChild(card);
      }, delay);
    }
    delay += p.rank === 1 ? 3800 : 4000;
  });

  // Show full leaderboard + buttons after all reveals
  setTimeout(() => {
    renderLeaderboard('full-leaderboard', players);
    if (isHost) {
      const paBtn = document.createElement('button'); paBtn.className='btn-main'; paBtn.style.marginBottom='10px';
      paBtn.textContent='🔁 Play Again'; paBtn.onclick=()=>{sfxClick();resetGame();};
      document.getElementById('results-actions').appendChild(paBtn);
    }
  }, delay + 1200);
}

// ============================================================
// CONFETTI
// ============================================================
function spawnConfetti() {
  const colors = ['#e94560','#4f8ef7','#4ade80','#fbbf24','#c084fc','#ff8c42'];
  for (let i = 0; i < 70; i++) {
    setTimeout(() => {
      const el = document.createElement('div'); el.className='confetti';
      el.style.cssText = `left:${rand(5,95)}vw;top:-12px;width:${rand(6,12)}px;height:${rand(6,12)}px;background:${pick(colors)};border-radius:${Math.random()>.5?'50%':'3px'};animation:confettiFall ${rand(1.4,3)}s linear forwards;`;
      document.body.appendChild(el); setTimeout(()=>el.remove(),3300);
    }, i*45);
  }
  if (!document.getElementById('confetti-style')) {
    const s = document.createElement('style'); s.id='confetti-style';
    s.textContent='@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(720deg);opacity:0}}';
    document.head.appendChild(s);
  }
}

// ============================================================
// RESET / NAVIGATION
// ============================================================
async function resetGame() {
  if (isHost && roomCode) {
    const upd = {};
    Object.keys(players).forEach(uid => { upd[`players/${uid}/score`]=0; });
    Object.assign(upd,{'game/level':1,'game/round':0,'game/phase':'countdown','game/roundSeed':Math.floor(Math.random()*100000),'status':'lobby'});
    await update(dbRef('rooms',roomCode),upd);
  }
  clearListeners(); stopLocalTimer(); stopFruitAnimation(); stopL5Fruits();
  Object.keys(players).forEach(uid=>{if(players[uid])players[uid].score=0;});
  openLobby();
}
function resetToMenu() {
  clearListeners(); stopLocalTimer(); stopFruitAnimation(); stopL5Fruits(); stopJazz();
  players={}; roomCode=''; isHost=false; showScreen('screen-menu');
}

// ============================================================
// BUTTON EVENT LISTENERS (registered once at boot)
// ============================================================
document.getElementById('btn-create').addEventListener('click', ()=>{sfxClick();document.getElementById('modal-create').classList.remove('hidden');document.getElementById('input-host-name').focus();});
document.getElementById('btn-create-cancel').addEventListener('click', ()=>document.getElementById('modal-create').classList.add('hidden'));
document.getElementById('btn-create-confirm').addEventListener('click', async ()=>{
  const name=document.getElementById('input-host-name').value.trim();
  if(!name){showError('create-error','Please enter your name.');return;}
  document.getElementById('btn-create-confirm').disabled=true; sfxClick();
  try{await createRoom(name);document.getElementById('modal-create').classList.add('hidden');}
  catch(e){showError('create-error','Failed to create room.');console.error(e);}
  document.getElementById('btn-create-confirm').disabled=false;
});
document.getElementById('btn-join-open').addEventListener('click', ()=>{sfxClick();document.getElementById('modal-join').classList.remove('hidden');document.getElementById('input-name').focus();});
document.getElementById('btn-join-cancel').addEventListener('click', ()=>document.getElementById('modal-join').classList.add('hidden'));
document.getElementById('btn-join-confirm').addEventListener('click', async ()=>{
  const name=document.getElementById('input-name').value.trim();
  const code=document.getElementById('input-code').value.trim().toUpperCase();
  if(!name){showError('join-error','Enter your name.');return;}
  if(code.length<4){showError('join-error','Enter the 4-character room code.');return;}
  document.getElementById('btn-join-confirm').disabled=true; sfxClick();
  const err=await joinRoom(name,code);
  if(err)showError('join-error',err); else document.getElementById('modal-join').classList.add('hidden');
  document.getElementById('btn-join-confirm').disabled=false;
});
document.getElementById('btn-copy-code').addEventListener('click', ()=>{navigator.clipboard?.writeText(roomCode).catch(()=>{});showToast('Room code copied!');});
document.getElementById('btn-leave-lobby').addEventListener('click', async ()=>{
  sfxClick();
  if(roomCode&&myUid){await remove(dbRef('rooms',roomCode,'players',myUid));if(isHost)await remove(dbRef('rooms',roomCode));}
  resetToMenu();
});
document.getElementById('btn-main-menu').addEventListener('click', ()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-menu').addEventListener('click', ()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-again').addEventListener('click', ()=>{sfxClick();resetGame();});
document.addEventListener('keydown', e=>{
  if(e.key==='Enter'){
    const cm=document.getElementById('modal-create'),jm=document.getElementById('modal-join');
    if(!cm.classList.contains('hidden'))document.getElementById('btn-create-confirm').click();
    else if(!jm.classList.contains('hidden'))document.getElementById('btn-join-confirm').click();
  }
  if(e.key==='Escape'){document.getElementById('modal-create').classList.add('hidden');document.getElementById('modal-join').classList.add('hidden');}
});
document.getElementById('input-code').addEventListener('input', e=>{e.target.value=e.target.value.toUpperCase();});
document.addEventListener('click', ()=>{if(musicOn&&!jazzInterval)startJazz();},{once:true});

// ============================================================
// BOOT
// ============================================================
async function boot() {
  document.getElementById('loading-msg').textContent='Connecting...';
  showScreen('screen-loading');
  try {
    await initAuth(); initConnectionMonitor();
    document.getElementById('loading-msg').textContent='Ready!';
    await new Promise(r=>setTimeout(r,600));
    showScreen('screen-menu');
  } catch(e) {
    document.getElementById('loading-msg').textContent='Firebase connection failed. Check firebase.js';
    console.error('Boot error:',e);
  }
}
boot();
