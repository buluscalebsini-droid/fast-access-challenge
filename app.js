// ============================================================
// app.js — Service vs Product Complaints — ICS Returns Team Knowledge Refresher
// INFRASTRUCTURE: kept 100% identical to original
// GAME CONTENT: 7 refresher stages — reinforcing existing knowledge
// ============================================================
import {
  db, auth, ref, set, get, update, onValue, onDisconnect,
  serverTimestamp, off, remove, push, child,
  signInAnonymously, onAuthStateChanged
} from './firebase.js';

// ============================================================
// AUDIO ENGINE (unchanged)
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
const sfxReveal    = () => { playTone(440,'sine',0.1,0.22); playTone(660,'sine',0.14,0.28,0.1); };
const sfxDrumroll  = () => {
  [0,0.10,0.19,0.27,0.34,0.40,0.45,0.49,0.52,0.545,0.565,0.58]
    .forEach(t => playTone(rand(180,230),'sawtooth',0.045,0.2,t));
};
const sfxChampion  = () => {
  [523,659,784,880,1047].forEach((f,i) => playTone(f,'sine',0.35,0.32,i*0.13));
  setTimeout(() => [784,880,1047,1319].forEach((f,i) => playTone(f,'sine',0.4,0.35,i*0.09)), 900);
};
const sfxBonus     = () => [784,880,1047,1319,1568].forEach((f,i) => playTone(f,'sine',0.2,0.28,i*0.08));
const JAZZ_CHORDS  = [[261,330,392,494],[294,370,440,554],[349,440,523,659],[392,494,587,740],[330,415,494,622]];
function playJazzChord() {
  if (!musicOn) return;
  const c = JAZZ_CHORDS[jazzStep % JAZZ_CHORDS.length];
  c.forEach((f,i) => playTone(f/2,'sine',0.5,0.045,i*0.04));
  playTone(c[0]/4,'triangle',0.55,0.07); jazzStep++;
}
function startJazz() { stopJazz(); if (!musicOn) return; playJazzChord(); jazzInterval = setInterval(playJazzChord,1600); }
function stopJazz()  { if (jazzInterval) { clearInterval(jazzInterval); jazzInterval = null; } }
function toggleMusic() {
  musicOn = !musicOn;
  document.querySelectorAll('.btn-mute,.btn-mute-sm').forEach(b => b.textContent = musicOn ? '🔊' : '🔇');
  if (musicOn) startJazz(); else stopJazz();
}

// ============================================================
// STATE
// ============================================================
let myUid = null, myName = '', roomCode = '', isHost = false;
let players = {}, gameState = {}, activeListeners = [];
let localTimerId = null;

// Refresher game state
let currentStage  = 1;   // 1-7
let stageItem     = 0;   // current question index within stage
let stageCanAct   = false;
let s5CaseIdx     = 0;   // stage 5: which case (0-3)
let s5QuestionIdx = 0;   // stage 5: question within case (0-3)
let s5CaseCorrect = 0;   // stage 5: correct answers in current case
let s7Step        = 0;   // stage 7: step (0-7)
let s7Mistakes    = 0;   // stage 7: mistakes count
let stageScoreLocal = 0; // points scored this stage

// ============================================================
// UTILS (unchanged)
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
function showToast(msg, dur=2200) {
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
  lbl.textContent = ok ? '● Connected' : '● Reconnecting...';
}
function showError(elId, msg) {
  const el = document.getElementById(elId); if (!el) return;
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ============================================================
// FIREBASE HELPERS (unchanged)
// ============================================================
function dbRef(...parts) { return ref(db, parts.join('/')); }
function listenOn(path, cb) {
  const r = dbRef(path); onValue(r, cb); activeListeners.push(r); return r;
}
function clearListeners() { activeListeners.forEach(r => off(r)); activeListeners = []; }
function stopLocalTimer() { if (localTimerId) { clearInterval(localTimerId); localTimerId = null; } }

// ============================================================
// AUTH (unchanged)
// ============================================================
async function initAuth() {
  document.getElementById('loading-msg').textContent = 'Authenticating...';
  console.log('[initAuth] calling signInAnonymously...');
  await signInAnonymously(auth);
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        myUid = user.uid;
        console.log('[initAuth] authenticated, uid=', myUid);
        unsub(); resolve();
      }
    });
  });
}
function initConnectionMonitor() {
  onValue(dbRef('.info/connected'), snap => setConnected(!!snap.val()));
}

// ============================================================
// ROOM CREATION / JOINING (unchanged)
// ============================================================
async function createRoom(hostName) {
  console.log('[createRoom] start, uid=', myUid);
  myName = hostName.trim(); isHost = true; roomCode = genRoomCode();
  const roomRef = dbRef('rooms', roomCode);
  console.log('[createRoom] checking if room exists:', roomCode);
  if ((await get(roomRef)).exists()) roomCode = genRoomCode();
  console.log('[createRoom] setting onDisconnect for:', roomCode);
  await onDisconnect(dbRef('rooms', roomCode, 'players', myUid)).remove();
  console.log('[createRoom] writing room to Firebase...');
  await set(roomRef, {
    host: myUid, status: 'lobby', created: serverTimestamp(),
    players: { [myUid]: { name: myName, score: 0, color: 0, ready: true } },
    game: { level: 0, round: 0, roundSeed: 0, phase: 'waiting', betweenPhase: 'leaderboard' }
  });
  console.log('[createRoom] Firebase write success, opening lobby...');
  openLobby();
  console.log('[createRoom] openLobby() returned OK');
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
// LOBBY (unchanged structure, updated text)
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
    if (!players[myUid]) { showToast('You were removed from the session.'); resetToMenu(); }
  });
  listenOn(`rooms/${roomCode}/status`, snap => {
    if (snap.val() === 'playing') { clearListeners(); startGame(); }
  });
  listenOn(`rooms/${roomCode}`, snap => {
    if (!snap.exists()) { showToast('Session closed.'); resetToMenu(); }
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
      if (s.val() === uid) { const h = document.createElement('span'); h.className = 'player-badge'; h.textContent = 'FACILITATOR'; bg.appendChild(h); }
    });
    if (uid === myUid) { const y = document.createElement('span'); y.className = 'player-badge you'; y.textContent = 'YOU'; bg.appendChild(y); }
    card.appendChild(av); card.appendChild(nm); card.appendChild(bg); list.appendChild(card);
  });
  const count = entries.length;
  document.getElementById('lobby-status').textContent =
    count === 1 ? 'Waiting for participants... (1/40)' : `${count}/40 participants connected`;
  if (isHost) {
    const btn = document.getElementById('btn-start-game');
    btn.disabled = count < 1;
    btn.textContent = count < 2 ? '▶ Start Solo Session' : '▶ Begin Refresher';
  }
}
async function hostStartGame() {
  document.getElementById('btn-start-game').disabled = true;
  await update(dbRef('rooms', roomCode), {
    status: 'playing', 'game/level': 1, 'game/round': 0,
    'game/phase': 'intro', 'game/betweenPhase': 'leaderboard',
    'game/roundSeed': Math.floor(Math.random() * 100000),
    'game/roundStartTime': serverTimestamp()
  });
}

// ============================================================
// GAME START + COUNTDOWN (unchanged)
// ============================================================
function startGame() {
  clearListeners();
  get(dbRef('rooms', roomCode, 'players')).then(s => { if (s.exists()) players = s.val(); });
  showStageIntro(1, () => startStage(1));
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
// SCORE SYNC (unchanged)
// ============================================================
function addMyScore(pts) {
  if (!myUid || !roomCode) return;
  if (!players[myUid]) players[myUid] = { score: 0 };
  players[myUid].score = (players[myUid].score || 0) + pts;
  stageScoreLocal += pts;
  renderGameScores();
  get(dbRef('rooms', roomCode, 'players', myUid, 'score')).then(s => {
    const cur = s.val() || 0;
    update(dbRef('rooms', roomCode, 'players', myUid), { score: cur + pts });
  });
}
function deductScore(pts) {
  if (!myUid || !roomCode) return;
  if (!players[myUid]) return;
  const cur = players[myUid].score || 0;
  const next = Math.max(0, cur - pts);
  players[myUid].score = next;
  renderGameScores();
  update(dbRef('rooms', roomCode, 'players', myUid), { score: next });
}
function syncGameScores() {
  listenOn(`rooms/${roomCode}/players`, snap => { players = snap.val() || {}; renderGameScores(); });
}
function renderGameScores() {
  const c = document.getElementById('game-scores'); if (!c) return;
  const sorted = Object.entries(players).sort((a,b) => (b[1].score||0)-(a[1].score||0));
  c.innerHTML = '';
  sorted.slice(0, 8).forEach(([uid, p], idx) => {
    const chip = document.createElement('div'); chip.className = 'score-chip' + (idx===0?' leader':'');
    chip.innerHTML = `<span class="chip-name">${p.name}</span><span class="chip-score">${p.score||0}</span>`;
    c.appendChild(chip);
  });
}

// ============================================================
// TIMER (unchanged)
// ============================================================
function startTimerLocal(timerId, barId, seconds, onEnd) {
  stopLocalTimer();
  let remaining = seconds;
  const timerEl = document.getElementById(timerId), barEl = document.getElementById(barId);
  const CIRC = 113; // 2 * pi * 18
  if (timerEl) { timerEl.textContent = remaining; timerEl.classList.remove('warn'); }
  if (barEl)   {
    // SVG ring: stroke-dashoffset drives the progress
    if (barEl.tagName === 'circle') { barEl.style.strokeDashoffset = '0'; barEl.classList.remove('warn'); }
    else { barEl.style.width = '100%'; barEl.classList.remove('warn'); }
  }
  localTimerId = setInterval(() => {
    remaining--;
    if (timerEl) { timerEl.textContent = remaining; if (remaining <= 4) { timerEl.classList.add('warn'); sfxTimerWarn(); } }
    if (barEl) {
      const pct = Math.max(0, remaining / seconds);
      if (barEl.tagName === 'circle') {
        barEl.style.strokeDashoffset = CIRC * (1 - pct) + '';
        if (remaining <= 4) barEl.classList.add('warn');
      } else {
        barEl.style.width = (pct*100)+'%';
        if (remaining <= 4) barEl.classList.add('warn');
      }
    }
    if (remaining <= 0) { stopLocalTimer(); onEnd(); }
  }, 1000);
}

// ============================================================
// STAGE INTRO SYSTEM
// ============================================================
const STAGE_INTROS = {
  1: { icon:'🔀', title:'Service or Product?',   sub:'Quick check — classify each complaint as Service or Product.', tip:'You know this. Service = ICS managed it. Product = from the manufacturer.', badge:'5 Scenarios', color:'var(--c-purple)' },
  2: { icon:'👤', title:'Who Owns It?',            sub:'Determine whether the Claims Team or the Client (Manufacturer) should handle each complaint.', tip:'Service Complaints → Claims. Product Complaints → Contact Client (Manufacturer).', badge:'5 Scenarios', color:'var(--c-green)' },
  3: { icon:'🃏', title:'Complaint Sorting',        sub:'Drag each complaint into the correct column — Service or Product?', tip:'You know the difference. Sort them all, then click Finish.', badge:'12 Cards', color:'var(--c-blue)' },
  4: { icon:'🔄', title:'Complete the Workflow',   sub:'Complete the routing workflow — fill in the missing step.', tip:'Recall the full routing process step by step.', badge:'5 Questions', color:'var(--c-orange)' },
  5: { icon:'📋', title:'Investigation Challenge', sub:'Test your recall on four complete complaint cases — answer all four routing questions per case.', tip:'Bonus points for a perfect case. Let\'s see what you remember!', badge:'3 Cases', color:'var(--c-purple)' },
  6: { icon:'🕐', title:'Root Cause Timeline',     sub:'Identify where in the supply chain the complaint originated.', tip:'Where it started tells you what type it is. Recall your supply chain knowledge.', badge:'5 Scenarios', color:'var(--c-green)' },
  7: { icon:'🚪', title:'Complaint Escape',        sub:'Navigate a real complaint end-to-end — every decision counts.', tip:'A perfect run earns bonus points. How sharp is your recall?', badge:'5 Decisions', color:'var(--c-blue)' },
};
function showStageIntro(n, cb) {
  const info = STAGE_INTROS[n];
  if (!info) { cb(); return; }
  const ov = document.getElementById('stage-intro-overlay');
  document.getElementById('si-icon').textContent    = info.icon;
  document.getElementById('si-num').textContent     = `Stage ${n} of 7`;
  document.getElementById('si-title').textContent   = info.title;
  document.getElementById('si-badge').textContent   = info.badge;
  document.getElementById('si-sub').textContent     = info.sub;
  document.getElementById('si-tip').textContent     = info.tip;
  document.getElementById('si-count').textContent   = '';
  document.getElementById('si-icon').style.background = info.color;
  ov.classList.remove('hidden'); void ov.offsetWidth; ov.classList.add('si-in');
  setTimeout(() => {
    let c = 3;
    document.getElementById('si-count').textContent = c; sfxCountdown();
    const tick = setInterval(() => {
      c--;
      if (c <= 0) {
        clearInterval(tick);
        document.getElementById('si-count').textContent = 'GO!'; sfxGo();
        setTimeout(() => { ov.classList.add('hidden'); ov.classList.remove('si-in'); cb(); }, 520);
      } else { document.getElementById('si-count').textContent = c; sfxCountdown(); }
    }, 800);
  }, 2200);
}

// ============================================================
// TRAINING CONTENT DATA
// ============================================================

// ── STAGE 1: Service or Product? ────────────────────────────
const S1_DATA = [
  { scenario: 'Medication arrived with crushed packaging. ICS arranged the shipment; FedEx physically transported it. Products appear unusable.', answer: 'service', hint: 'ICS arranged and managed the shipment. Even though FedEx physically transported the goods, any issue during an ICS-managed shipment is a Service Complaint. The deciding factor is who managed the shipment, not who physically drove the van.' },
  { scenario: 'A patient reports that the insulin pen does not deliver the correct dose due to a device mechanism failure.', answer: 'product', hint: 'The issue originates from the device itself, not from transportation or ICS handling. This is a Product Complaint → Contact Client (Manufacturer).' },
  { scenario: 'A hospital received 50 units instead of the ordered 100. The picking error was identified at the ICS warehouse before the shipment was handed to the carrier.', answer: 'service', hint: 'The error happened inside the ICS warehouse during pick-and-pack — before the carrier was involved. ICS managed the entire process → Service Complaint → Claims Team.' },
  { scenario: 'A batch of syringes shows visible contamination. The batch record traces the issue directly to the manufacturing facility.', answer: 'product', hint: 'Contamination originated at the manufacturing facility — nothing to do with ICS shipment or handling. The issue is with the product itself → Product Complaint → Contact Client (Manufacturer).' },
  { scenario: 'Temperature-sensitive vaccines arrived outside the required range. ICS arranged and managed the shipment. The contracted carrier (UPS) transported the goods on behalf of ICS, and data loggers show the breach occurred during transit.', answer: 'service', hint: 'ICS arranged and managed this shipment. UPS operated under ICS direction as a contracted carrier. The cold-chain breach occurred during an ICS-managed shipment — it does not matter that UPS physically moved the goods. Service Complaint → Claims Team investigates and creates the Quality Case.' },
];

// ── STAGE 2: Who Owns It? ───────────────────────────────────
const S2_DATA = [
  { scenario: 'Service complaint confirmed: carrier damaged products during ICS-managed transit.', question: 'Who owns this complaint?', answer: 'claims', hint: 'Service Complaints are owned by the Claims Team (ICS). They create and investigate the Quality Case.' },
  { scenario: 'Product complaint received: a medical device has a manufacturing defect reported by the end user.', question: 'Who should Returns contact?', answer: 'am', hint: 'Product Complaints belong to the Source Client. Returns contacts the Client (Manufacturer). No Quality Case.' },
  { scenario: 'ICS warehouse dispatched the wrong product line to a hospital.', question: 'Who investigates this?', answer: 'claims', hint: 'Wrong product from ICS warehouse = Service Complaint → Claims Team investigates.' },
  { scenario: 'A patient reports an adverse effect from using the product as directed by the prescription.', question: 'Who does Returns contact?', answer: 'am', hint: 'Adverse effects = Product Complaint → Contact Client (Manufacturer), follow Source Client direction.' },
  { scenario: 'Cold-chain excursion confirmed during an ICS-managed delivery run.', question: 'Who creates the Quality Case?', answer: 'claims', hint: 'Transport excursion = Service Complaint → Claims Team creates the Quality Case.' },
  { scenario: 'Product contamination traced to the manufacturing facility batch production.', question: 'What does Returns do?', answer: 'am', hint: 'Manufacturing contamination = Product Complaint → Contact Client (Manufacturer). Returns does NOT create a Quality Case.' },
];

// ── STAGE 3: True or False ──────────────────────────────────
const S3_DATA = [
  { statement: 'The Returns Team creates Quality Cases for all complaints.', answer: false, hint: 'FALSE — Returns does NOT create Quality Cases. The Claims Team creates them for Service Complaints only.' },
  { statement: 'Claims Team investigates Service Complaints and creates the Quality Case.', answer: true, hint: 'TRUE — Claims Team owns Service Complaints: they investigate and create the Quality Case.' },
  { statement: 'Product Complaints originate from the manufacturer or the product itself.', answer: true, hint: 'TRUE — Product Complaints include defects, adverse effects, and manufacturing issues.' },
  { statement: 'The Returns Team investigates every complaint it receives.', answer: false, hint: 'FALSE — Returns reviews and ROUTES complaints. Returns does NOT investigate.' },
  { statement: 'If ICS did not manage the shipment, Returns should contact the Client (Manufacturer).', answer: true, hint: 'TRUE — No ICS involvement = contact Client (Manufacturer) and follow Source Client direction.' },
  { statement: 'A temperature excursion during ICS delivery is a Product Complaint.', answer: false, hint: 'FALSE — Temperature excursion during ICS service = Service Complaint.' },
  { statement: 'For Product Complaints, Returns contacts the Client (Manufacturer).', answer: true, hint: 'TRUE — Product Complaints: Returns contacts AM, follows Source Client direction. No Quality Case.' },
  { statement: 'Wrong quantity delivered by ICS is classified as a Product Complaint.', answer: false, hint: 'FALSE — Wrong quantity from ICS handling = Service Complaint.' },
  { statement: 'Claims Team is responsible for Service Complaints.', answer: true, hint: 'TRUE — Claims Team (ICS) owns all Service Complaints.' },
  { statement: 'Returns Team should create a Quality Case for Product Complaints.', answer: false, hint: 'FALSE — No Quality Case for Product Complaints. Returns contacts AM only.' },
];

// ── STAGE 3: Complaint Sorting (Drag & Drop) ────────────────
const DRAG_CARDS = [
  { id:'d1',  text:'Wrong product line shipped by ICS warehouse',          answer:'service' },
  { id:'d2',  text:'Temperature excursion on a cold-chain shipment managed by ICS', answer:'service' },
  { id:'d3',  text:'Product packaging damaged during ICS transit',         answer:'service' },
  { id:'d4',  text:'Manufacturer defect found in device mechanism',        answer:'product' },
  { id:'d5',  text:'Adverse reaction reported at prescribed dose',         answer:'product' },
  { id:'d6',  text:'Product contamination traced to production batch',     answer:'product' },
  { id:'d7',  text:'Incorrect quantity dispatched from ICS facility',      answer:'service' },
  { id:'d8',  text:'Manufacturing packaging seal defect on blister pack',  answer:'product' },
  { id:'d9',  text:'Device malfunction due to faulty internal component',  answer:'product' },
  { id:'d10', text:'Wrong delivery address on an ICS-managed shipment',    answer:'service' },
  { id:'d11', text:'Batch manufacturing quality issue at factory',         answer:'product' },
  { id:'d12', text:'Product recall due to stability issue at manufacture', answer:'product' },
];

let dragState = {};  // { cardId: 'service'|'product'|null }
let dragSrcId  = null;

function startS3Drag() {
  dragState = {};
  DRAG_CARDS.forEach(c => { dragState[c.id] = null; });
  showGamePanel('s3-panel');
  setItemProgress(1, 1);
  startTimerLocal('train-timer','train-timer-bar',120,() => { submitDragStage(); });
  renderDragBoard();
}

function renderDragBoard() {
  const pool    = document.getElementById('s3-drag-pool');
  const svcZone = document.getElementById('s3-zone-service');
  const prdZone = document.getElementById('s3-zone-product');
  // Clear only drag-card children — preserve the static dz-header/dz-sub label divs
  pool.innerHTML = '';
  svcZone.querySelectorAll('.drag-card').forEach(el => el.remove());
  prdZone.querySelectorAll('.drag-card').forEach(el => el.remove());
  DRAG_CARDS.forEach(card => {
    const el = makeDragCard(card);
    const placed = dragState[card.id];
    if (placed === 'service')      svcZone.appendChild(el);
    else if (placed === 'product') prdZone.appendChild(el);
    else                           pool.appendChild(el);
  });
  updateFinishBtn();
}

function makeDragCard(card) {
  const el = document.createElement('div');
  el.className = 'drag-card';
  el.dataset.id = card.id;
  el.textContent = card.text;
  el.draggable = true;

  // Desktop drag
  el.addEventListener('dragstart', e => {
    dragSrcId = card.id; el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));

  // Touch drag (mobile)
  el.addEventListener('touchstart', e => {
    dragSrcId = card.id; el.classList.add('dragging');
  }, {passive:true});
  el.addEventListener('touchend', e => {
    el.classList.remove('dragging');
    const t = e.changedTouches[0];
    const target = document.elementFromPoint(t.clientX, t.clientY);
    const zone = target && target.closest('[data-zone]');
    if (zone) dropOnZone(zone.dataset.zone);
  }, {passive:true});

  return el;
}

function setupDragZones() {
  ['s3-zone-service','s3-zone-product','s3-drag-pool'].forEach(zoneId => {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    const zoneName = zone.dataset.zone;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (dragSrcId) dropOnZone(zoneName);
    });
  });
}

function dropOnZone(zoneName) {
  if (!dragSrcId) return;
  dragState[dragSrcId] = (zoneName === 'service' || zoneName === 'product') ? zoneName : null;
  dragSrcId = null;
  renderDragBoard();
}

function updateFinishBtn() {
  const allPlaced = DRAG_CARDS.every(c => dragState[c.id] !== null);
  const btn = document.getElementById('s3-finish-btn');
  if (btn) { btn.disabled = !allPlaced; btn.style.opacity = allPlaced ? '1' : '0.45'; }
}

function submitDragStage() {
  stopLocalTimer();
  const btn = document.getElementById('s3-finish-btn');
  if (btn) btn.disabled = true;
  let correct = 0;
  ['s3-zone-service','s3-zone-product','s3-drag-pool'].forEach(zoneId => {
    const zone = document.getElementById(zoneId);
    if (!zone) return;
    zone.querySelectorAll('.drag-card').forEach(el => {
      const card = DRAG_CARDS.find(c => c.id === el.dataset.id);
      const placed = dragState[el.dataset.id];
      if (placed === card.answer) { el.classList.add('drag-correct'); correct++; }
      else el.classList.add('drag-wrong');
    });
  });
  const wrong = DRAG_CARDS.length - correct;
  const pts = Math.max(0, correct * 15 - wrong * 2);
  if (pts > 0) addMyScore(pts);
  if (wrong > 0) sfxWrong(); else sfxBonus();
  const resultsEl = document.getElementById('s3-drag-results');
  if (resultsEl) {
    resultsEl.innerHTML = `<div class="drag-result-summary ${wrong===0?'all-correct':''}">
      <span class="dr-icon">${wrong===0?'🏆':'📊'}</span>
      <span class="dr-score">${correct}/${DRAG_CARDS.length} correct</span>
      <span class="dr-pts">+${pts} pts</span>
      ${wrong>0?`<span class="dr-wrong">${wrong} incorrect (−${wrong*2} pts)</span>`:''}
    </div>`;
    resultsEl.classList.remove('hidden');
  }
  showToast(wrong===0 ? '🏆 Perfect sort! All correct.' : `📊 ${correct}/${DRAG_CARDS.length} correct — +${pts} pts`);
  setTimeout(() => finishStage(3), 2800);
}
window.submitDragStage = submitDragStage;



// ── STAGE 4: Complete the Workflow ──────────────────────────
const S4_DATA = [
  { context: 'A complaint arrives. What is the Returns Team\'s FIRST action?',
    flow: ['📥 Complaint Received', '❓ ???', '🔍 Determine Complaint Type', '📤 Route Complaint'],
    options: ['Review Complaint', 'Create Quality Case', 'Contact Claims', 'Investigate', 'Contact Manufacturer'],
    answer: 'Review Complaint',
    hint: 'Returns always REVIEWS the complaint before determining its type.' },
  { context: 'A temperature excursion occurred during transit. ICS arranged and managed the shipment (transported by a third-party carrier on behalf of ICS). What type of complaint is this?',
    flow: ['🌡 Temperature Excursion Reported', '✅ ICS managed the shipment', '❓ ???', '📋 Claims Team creates Quality Case'],
    options: ['Product Complaint', 'Service Complaint', 'No Complaint — Normal Variation', 'Contact Client — Client managed it'],
    answer: 'Service Complaint',
    hint: 'ICS arranged and managed this shipment. Even though a third-party carrier (FedEx/UPS) physically moved the goods, the carrier operated under ICS direction. The cold-chain breach happened during an ICS-managed shipment → Service Complaint → Claims Team investigates and creates the Quality Case. The deciding factor is always: WHO MANAGED THE SHIPMENT?' },
  { context: 'The complaint is a Product Complaint. What is Returns\' next action?',
    flow: ['📦 Product Complaint Identified', '📞 ???', '📋 Follow Source Client Direction', '🚫 No Quality Case'],
    options: ['Create Quality Case', 'Contact Claims Team', 'Contact Client (Manufacturer)', 'Investigate Complaint'],
    answer: 'Contact Client (Manufacturer)',
    hint: 'Product Complaint → Returns contacts the Client (Manufacturer).' },
  { context: 'A temperature excursion occurred. The Client (Manufacturer) arranged and managed this shipment — ICS did not manage it. What should Returns do?',
    flow: ['🌡 Temperature Excursion Reported', '❌ ICS did NOT manage the shipment', '📞 Returns contacts ???', '📋 Follows Client direction — no QC'],
    options: ['Route to Claims Team — create QC', 'Contact Client (Manufacturer) for direction', 'Classify as Service Complaint', 'Investigate the carrier directly'],
    answer: 'Contact Client (Manufacturer) for direction',
    hint: 'The Client (Manufacturer) managed this shipment — not ICS. Returns does NOT create a Quality Case, does NOT route to Claims, and does NOT investigate. Returns contacts the Client (Manufacturer) and follows their direction on next steps. The rule is simple: WHO MANAGED THE SHIPMENT determines who owns the complaint.' },
  { context: 'Service complaint confirmed. Who creates the Quality Case?',
    flow: ['✅ Service Complaint', '📞 Route to ???', '📋 Quality Case Created', '🔍 Investigate'],
    options: ['Returns Team', 'Client (Manufacturer)', 'Claims Team (ICS)', 'Warehouse Team'],
    answer: 'Claims Team (ICS)',
    hint: 'Claims Team (ICS) creates and owns the Quality Case for Service Complaints.' },
];

// ── STAGE 5: Investigation Challenge ────────────────────────
const S5_CASES = [
  { title: 'Case #001 — Damaged Delivery',
    desc: 'A hospital contacts the ICS Returns Team. They received an ICS-managed shipment but multiple packages arrived with visible crush damage. Products appear unusable.',
    questions: [
      { q: 'Did ICS manage the shipment?', opts: ['YES', 'NO'], answer: 'YES', hint: 'The hospital confirms the shipment was managed by ICS.' },
      { q: 'Where did the issue originate?', opts: ['During ICS Shipment / Handling', 'From the Manufacturer'], answer: 'During ICS Shipment / Handling', hint: 'Crush damage occurred during ICS-managed transit — a service issue.' },
      { q: 'What type of complaint is this?', opts: ['Service Complaint', 'Product Complaint'], answer: 'Service Complaint', hint: 'Damage during ICS-managed transit = Service Complaint.' },
      { q: 'What should Returns do?', opts: ['Route to Claims Team', 'Contact Client (Manufacturer) — No QC', 'Create Quality Case', 'Investigate Warehouse'], answer: 'Route to Claims Team', hint: 'Service Complaints → Claims Team. Claims creates the Quality Case.' },
    ]
  },
  { title: 'Case #002 — Device Malfunction',
    desc: 'A pharmacy reports patients experiencing dosing errors with a specific insulin device. The device appears to have a mechanical failure. ICS delivered the products, manufactured by PharmaCo.',
    questions: [
      { q: 'Did ICS manage the shipment?', opts: ['YES', 'NO'], answer: 'YES', hint: 'ICS did deliver the products — but delivery is not the issue here.' },
      { q: 'Where did the issue originate?', opts: ['During ICS Shipment / Handling', 'From the Manufacturer'], answer: 'From the Manufacturer', hint: 'Mechanical failure in the device originates from the manufacturer/product.' },
      { q: 'What type of complaint is this?', opts: ['Service Complaint', 'Product Complaint'], answer: 'Product Complaint', hint: 'Device malfunction from manufacturer = Product Complaint.' },
      { q: 'What should Returns do?', opts: ['Route to Claims Team', 'Contact Client (Manufacturer) — No QC', 'Create Quality Case', 'Investigate'], answer: 'Contact Client (Manufacturer) — No QC', hint: 'Product Complaint → Contact Client (Manufacturer), follow Source Client direction, no Quality Case.' },
    ]
  },
  { title: 'Case #003 — Non-ICS Shipment',
    desc: 'A clinic contacts ICS Returns with a complaint about damaged products. After review, Returns finds that the shipment was managed entirely by the client\'s own logistics team, not ICS.',
    questions: [
      { q: 'Did ICS manage the shipment?', opts: ['YES', 'NO'], answer: 'NO', hint: 'The client\'s own logistics team managed this shipment — ICS was not responsible.' },
      { q: 'What is the immediate next step?', opts: ['Contact Client (Manufacturer)', 'Create Quality Case', 'Route to Claims', 'Investigate the Carrier'], answer: 'Contact Client (Manufacturer)', hint: 'If ICS did not manage the shipment → contact Client (Manufacturer) immediately.' },
      { q: 'Does Returns create a Quality Case?', opts: ['NO — Follow Source Client Direction', 'YES — Always Required', 'Only if Claims requests it', 'Only if severity is high'], answer: 'NO — Follow Source Client Direction', hint: 'No Quality Case when ICS did not manage the shipment. Follow Source Client direction.' },
      { q: 'Who provides direction on next steps?', opts: ['Source Client via Client (Manufacturer)', 'Claims Team', 'Returns Team Leader', 'Warehouse Manager'], answer: 'Source Client via Client (Manufacturer)', hint: 'Contact Client (Manufacturer) → the Source Client provides direction when ICS was not involved.' },
    ]
  },
];


// ── STAGE 6: Root Cause Timeline ────────────────────────────
const S6_NODES = ['🏭 Manufacturing', '🏢 Warehouse', '🚚 Transportation', '🏥 Customer Site'];
const S6_DATA = [
  { scenario: 'A patient reports medication tablets crumble when pressed from the blister pack. The batch code links to the production facility.', answer: '🏭 Manufacturing', hint: 'Tablet fragility from production = manufacturing defect.' },
  { scenario: 'Products arrived correctly but 3 boxes were mixed with another client\'s order. The mix-up was identified to have occurred at the ICS facility during picking.', answer: '🏢 Warehouse', hint: 'Mix-up during picking at ICS facility = warehouse error.' },
  { scenario: 'Temperature-sensitive vaccines arrived at 12°C instead of 2–8°C. Data logger shows the breach occurred during the truck journey.', answer: '🚚 Transportation', hint: 'Cold-chain breach during truck journey = transportation issue.' },
  { scenario: 'A device was returned as non-functional. Engineering testing confirms the internal motor was assembled incorrectly at the production facility.', answer: '🏭 Manufacturing', hint: 'Incorrect motor assembly at production = manufacturing defect.' },
  { scenario: 'Products were delivered correctly and in good condition. The clinic stored them at room temperature instead of refrigerated. When administered, they had degraded.', answer: '🏥 Customer Site', hint: 'Improper storage at the customer\'s site caused the issue.' },
];

// ── STAGE 7: Complaint Escape ────────────────────────────────
const S7_STEPS = [
  { step:1, situation:'📥 You receive a complaint: a hospital reports receiving 200 units of Product X, but ordered 300. ICS managed this delivery.', q:'What is your FIRST action as Returns Team?', opts:['Review the complaint details','Contact Claims immediately','Create a Quality Case','Escalate to management'], ans:0, hint:'Always REVIEW the complaint first before routing or escalating.' },
  { step:2, situation:'✅ You have reviewed the complaint. The delivery was managed by ICS.', q:'Did ICS manage the shipment?', opts:['YES — continue classification','NO — contact Client (Manufacturer)'], ans:0, hint:'Yes, ICS managed the shipment. Continue the classification process.' },
  { step:3, situation:'🔍 ICS managed the shipment. Determine where the issue originated.', q:'Where did the wrong-quantity issue originate?', opts:['During ICS shipment / warehouse handling','From the manufacturer'], ans:0, hint:'Wrong quantity from ICS warehouse = issue during ICS service handling.' },
  { step:4, situation:'📋 The issue originated during ICS handling.', q:'How should this complaint be classified?', opts:['Service Complaint','Product Complaint','Customer Error'], ans:0, hint:'ICS handling error = Service Complaint.' },
  { step:5, situation:'✅ Classified: Service Complaint. Route to the correct owner.', q:'Who OWNS this complaint?', opts:['Claims Team (ICS)','Client (Manufacturer)','Returns Team'], ans:0, hint:'Service Complaints are owned by the Claims Team (ICS).' },
];

// ── STAGE EXPLANATIONS ────────────────────────────────────────
const STAGE_EXPLANATIONS = {
  1: {
    title: 'Service vs Product — Key Rules',
    points: [
      { icon:'🚚', color:'green',  text:'<strong>Service Complaint</strong> — Issue occurred during an ICS-managed shipment, warehouse process, or transportation. The carrier (FedEx/UPS) may physically transport the goods, but if ICS arranged and managed the shipment, it is a Service Complaint.' },
      { icon:'🏭', color:'blue',   text:'<strong>Product Complaint</strong> — Issue originated from the MANUFACTURER or the PRODUCT ITSELF (defect, contamination, adverse effect, malfunction).' },
      { icon:'💡', color:'orange', text:'<strong>Key question: Did ICS manage the shipment?</strong> Not "who drove the truck?" — the deciding factor is whether ICS arranged and managed the shipment.' },
    ],
    diagram: 'service-product',
    takeaway: 'FedEx or UPS may carry the package — but if ICS managed the shipment, ICS owns any service issue.'
  },
  2: {
    title: 'Ownership — Who Handles What',
    points: [
      { icon:'👥', color:'green',  text:'<strong>Service Complaint → Claims Team (ICS)</strong> — Claims investigates and creates the Quality Case.' },
      { icon:'📞', color:'blue',   text:'<strong>Product Complaint → Client (Manufacturer)</strong> — Returns contacts AM. Source Client provides direction. No Quality Case.' },
      { icon:'📋', color:'purple', text:'<strong>Returns Team</strong> reviews and ROUTES. Returns does NOT investigate or create Quality Cases.' },
    ],
    diagram: 'ownership',
    takeaway: 'Route correctly the first time — the wrong owner wastes time and creates compliance risk.'
  },
  3: {
    title: 'Core Rules — Quick Reference',
    points: [
      { icon:'✅', color:'green',  text:'Returns: <strong>receives → reviews → determines type → routes</strong>.' },
      { icon:'❌', color:'red',    text:'Returns does NOT: investigate, create Quality Cases, or contact the manufacturer directly.' },
      { icon:'📋', color:'blue',   text:'Quality Cases are created by <strong>Claims Team only</strong>, for Service Complaints only.' },
    ],
    diagram: 'rules',
    takeaway: 'Know your lane: Returns routes, Claims investigates.'
  },
  4: {
    title: 'The Routing Workflow — Including Temperature Excursions',
    points: [
      { icon:'1️⃣', color:'purple', text:'<strong>The first question is always: Did ICS manage the shipment?</strong>' },
      { icon:'🌡', color:'green',  text:'<strong>Temperature excursion — ICS managed the shipment:</strong> Service Complaint → Route to Claims Team → Claims creates the Quality Case and investigates.' },
      { icon:'🌡', color:'orange', text:'<strong>Temperature excursion — Client managed the shipment:</strong> Returns does NOT create a QC. Returns contacts the Client (Manufacturer) and follows their direction.' },
    ],
    diagram: 'workflow',
    takeaway: 'Who managed the shipment determines who owns the issue — not the type of problem.'
  },
  5: {
    title: 'Investigation — Applying All Three Questions',
    points: [
      { icon:'❓', color:'purple', text:'Q1: <strong>Did ICS manage the shipment?</strong> — If NO → Contact Client (Manufacturer) immediately.' },
      { icon:'❓', color:'orange', text:'Q2: <strong>Where did it originate?</strong> — Service (ICS handling) or Product (manufacturer).' },
      { icon:'❓', color:'green',  text:'Q3: <strong>Who owns it?</strong> — Claims (Service) or Source Client via AM (Product).' },
    ],
    diagram: 'three-questions',
    takeaway: 'Always answer all three questions systematically — never skip steps.'
  },
  6: {
    title: 'Root Cause — Supply Chain Origins',
    points: [
      { icon:'🏭', color:'blue',   text:'<strong>Manufacturing</strong> defects → Product Complaint → Contact Client (Manufacturer).' },
      { icon:'🏢', color:'purple', text:'<strong>Warehouse</strong> errors (ICS facility) → Service Complaint → Claims Team.' },
      { icon:'🚚', color:'green',  text:'<strong>Transportation</strong> damage (carrier on ICS-managed shipment) → Service Complaint → Claims Team.' },
      { icon:'🏥', color:'orange', text:'<strong>Customer site</strong> mishandling → may not be ICS responsibility → Contact Client (Manufacturer).' },
    ],
    diagram: 'timeline',
    takeaway: 'Trace every complaint back to its origin before classifying.'
  },
  7: {
    title: 'Complaint Escape — Full Routing Mastered',
    points: [
      { icon:'📥', color:'purple', text:'<strong>Step 1:</strong> Receive complaint → REVIEW before any action.' },
      { icon:'🔍', color:'orange', text:'<strong>Steps 2–4:</strong> Apply three questions → classify correctly.' },
      { icon:'📤', color:'green',  text:'<strong>Steps 5–7:</strong> Route to correct owner → Claims or AM.' },
      { icon:'🏆', color:'blue',   text:'<strong>Step 8:</strong> Returns\' role ends at routing — never investigate.' },
    ],
    diagram: 'escape',
    takeaway: 'The Returns Team is the gateway — accurate routing protects quality and compliance.'
  },
};

// ============================================================
// STAGE CONTROLLER
// ============================================================
function startStage(n) {
  currentStage = n; stageItem = 0; stageScoreLocal = 0; stageCanAct = false;
  showScreen('screen-game');
  document.getElementById('stage-num-label').textContent = `Stage ${n} of 7`;
  document.getElementById('stage-title-label').textContent = STAGE_INTROS[n].title;
  syncGameScores();

  // Reset panels
  ['s1-panel','s2-panel','s3-panel','s4-panel','s5-panel','s6-panel','s7-panel'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.add('hidden');
  });
  document.getElementById('waiting-msg').classList.add('hidden');
  document.getElementById('game-scores').innerHTML = '';

  if      (n === 1) nextS1();
  else if (n === 2) nextS2();
  else if (n === 3) { nextS3(); setTimeout(setupDragZones, 60); }
  else if (n === 4) nextS4();
  else if (n === 5) startS5();
  else if (n === 6) nextS6();
  else if (n === 7) startS7();
}

function setItemProgress(cur, total) {
  document.getElementById('item-progress').textContent = `${cur}/${total}`;
}
function showGamePanel(id) {
  ['s1-panel','s2-panel','s3-panel','s4-panel','s5-panel','s6-panel','s7-panel'].forEach(pid => {
    const el = document.getElementById(pid); if (el) el.classList.add('hidden');
  });
  const el = document.getElementById(id); if (el) el.classList.remove('hidden');
}
function showAnswerFeedback(correct, hintText, panelId, delay=1200) {
  const fb = document.getElementById(panelId + '-feedback');
  if (!fb) return;
  fb.className = 'answer-feedback ' + (correct ? 'correct' : 'wrong');
  fb.innerHTML = (correct ? '<span class="fb-icon">✓</span>' : '<span class="fb-icon">✗</span>') + ` ${hintText}`;
  fb.classList.remove('hidden');
  setTimeout(() => { fb.classList.add('hidden'); fb.textContent = ''; }, delay + 400);
}

// ── STAGE 1 ──────────────────────────────────────────────────
function nextS1() {
  stopLocalTimer();
  if (stageItem >= S1_DATA.length) { finishStage(1); return; }
  const d = S1_DATA[stageItem];
  setItemProgress(stageItem+1, S1_DATA.length);
  showGamePanel('s1-panel');
  document.getElementById('s1-scenario').textContent = d.scenario;
  document.getElementById('s1-feedback').className = 'answer-feedback hidden';
  document.getElementById('s1-feedback').textContent = '';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',20,() => {
    stageCanAct = false;
    showAnswerFeedback(false, d.hint, 's1', 1400);
    stageItem++; setTimeout(nextS1,1800);
  });
}
function handleS1(chosen) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  const d = S1_DATA[stageItem];
  const correct = chosen === d.answer;
  if (correct) { addMyScore(100); sfxCorrect(); }
  else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's1', 1200);
  stageItem++; setTimeout(nextS1, 1600);
}
window.handleS1 = handleS1;

// ── STAGE 2 ──────────────────────────────────────────────────
function nextS2() {
  stopLocalTimer();
  if (stageItem >= S2_DATA.length) { finishStage(2); return; }
  const d = S2_DATA[stageItem];
  setItemProgress(stageItem+1, S2_DATA.length);
  showGamePanel('s2-panel');
  document.getElementById('s2-scenario').textContent = d.scenario;
  document.getElementById('s2-question').textContent = d.question;
  document.getElementById('s2-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',30,() => {
    stageCanAct = false;
    showAnswerFeedback(false, d.hint, 's2', 1400);
    stageItem++; setTimeout(nextS2,1800);
  });
}
function handleS2(chosen) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  const d = S2_DATA[stageItem];
  const correct = chosen === d.answer;
  if (correct) { addMyScore(100); sfxCorrect(); } else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's2', 1200);
  stageItem++; setTimeout(nextS2, 1600);
}
window.handleS2 = handleS2;

// ── STAGE 3: Complaint Sorting (Drag & Drop) ─────────────────
function nextS3() { startS3Drag(); }
function handleS3() {}   // retained for HTML compat
window.handleS3 = handleS3;

// ── STAGE 4 ──────────────────────────────────────────────────
function nextS4() {
  stopLocalTimer();
  if (stageItem >= S4_DATA.length) { finishStage(4); return; }
  const d = S4_DATA[stageItem];
  setItemProgress(stageItem+1, S4_DATA.length);
  showGamePanel('s4-panel');
  document.getElementById('s4-context').textContent = d.context;
  // Render flow
  const flowEl = document.getElementById('s4-flow');
  flowEl.innerHTML = d.flow.map((step,i) =>
    `<div class="flow-step ${step.includes('???')?'flow-missing':''}">${step}</div>${i<d.flow.length-1?'<div class="flow-arrow">↓</div>':''}`
  ).join('');
  // Render options
  const optsEl = document.getElementById('s4-options');
  optsEl.innerHTML = '';
  shuffle([...d.options]).forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn'; btn.textContent = opt;
    btn.onclick = () => handleS4(opt);
    optsEl.appendChild(btn);
  });
  document.getElementById('s4-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',20,() => {
    stageCanAct = false;
    document.querySelectorAll('#s4-options .option-btn').forEach(b => b.disabled = true);
    showAnswerFeedback(false, d.hint, 's4', 1400);
    stageItem++; setTimeout(nextS4,1800);
  });
}
function handleS4(chosen) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  document.querySelectorAll('#s4-options .option-btn').forEach(b => b.disabled = true);
  const d = S4_DATA[stageItem];
  const correct = chosen === d.answer;
  if (correct) { addMyScore(120); sfxCorrect(); } else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's4', 1200);
  stageItem++; setTimeout(nextS4, 1600);
}

// ── STAGE 5 ──────────────────────────────────────────────────
function startS5() {
  s5CaseIdx = 0; s5QuestionIdx = 0; s5CaseCorrect = 0;
  nextS5Case();
}
function nextS5Case() {
  stopLocalTimer();
  if (s5CaseIdx >= S5_CASES.length) { finishStage(5); return; }
  const c = S5_CASES[s5CaseIdx];
  s5QuestionIdx = 0; s5CaseCorrect = 0;
  setItemProgress(s5CaseIdx+1, S5_CASES.length);
  showGamePanel('s5-panel');
  document.getElementById('s5-case-title').textContent = c.title;
  document.getElementById('s5-case-desc').textContent  = c.desc;
  document.getElementById('s5-case-qarea').innerHTML = '';
  document.getElementById('s5-feedback').className = 'answer-feedback hidden';
  nextS5Question();
}
function nextS5Question() {
  stopLocalTimer();
  const c = S5_CASES[s5CaseIdx];
  if (s5QuestionIdx >= c.questions.length) {
    // Case complete — check bonus
    if (s5CaseCorrect === c.questions.length) {
      addMyScore(200); sfxBonus(); showToast('🌟 Perfect case! +200 bonus pts');
    }
    s5CaseIdx++; setTimeout(nextS5Case, 1200);
    return;
  }
  const q = c.questions[s5QuestionIdx];
  const qarea = document.getElementById('s5-case-qarea');
  qarea.innerHTML = `<div class="s5-q-label">Question ${s5QuestionIdx+1} of ${c.questions.length}</div>
    <div class="s5-q-text">${q.q}</div>
    <div class="s5-opts" id="s5-opts"></div>`;
  const optsEl = document.getElementById('s5-opts');
  q.opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn'; btn.textContent = opt;
    btn.onclick = () => handleS5(opt, q);
    optsEl.appendChild(btn);
  });
  document.getElementById('s5-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',20,() => {
    stageCanAct = false;
    document.querySelectorAll('#s5-opts .option-btn').forEach(b => b.disabled=true);
    showAnswerFeedback(false, q.hint, 's5', 1400);
    s5QuestionIdx++; setTimeout(nextS5Question,1800);
  });
}
function handleS5(chosen, q) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  document.querySelectorAll('#s5-opts .option-btn').forEach(b => b.disabled=true);
  const correct = chosen === q.answer;
  if (correct) { addMyScore(100); s5CaseCorrect++; sfxCorrect(); } else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, q.hint, 's5', 1200);
  s5QuestionIdx++; setTimeout(nextS5Question, 1600);
}

// ── STAGE 6 ──────────────────────────────────────────────────
function nextS6() {
  stopLocalTimer();
  if (stageItem >= S6_DATA.length) { finishStage(6); return; }
  const d = S6_DATA[stageItem];
  setItemProgress(stageItem+1, S6_DATA.length);
  showGamePanel('s6-panel');
  document.getElementById('s6-scenario').textContent = d.scenario;
  // Render timeline nodes
  const track = document.getElementById('s6-timeline');
  track.innerHTML = '';
  S6_NODES.forEach(node => {
    const btn = document.createElement('button');
    btn.className = 'timeline-node'; btn.textContent = node;
    btn.onclick = () => handleS6(node, d);
    track.appendChild(btn);
    if (node !== S6_NODES[S6_NODES.length-1]) {
      const arr = document.createElement('div'); arr.className = 'timeline-arrow'; arr.textContent = '↓';
      track.appendChild(arr);
    }
  });
  document.getElementById('s6-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',30,() => {
    stageCanAct = false;
    document.querySelectorAll('.timeline-node').forEach(b => b.disabled=true);
    showAnswerFeedback(false, d.hint, 's6', 1400);
    stageItem++; setTimeout(nextS6,1800);
  });
}
function handleS6(chosen, d) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  document.querySelectorAll('.timeline-node').forEach(b => b.disabled=true);
  const correct = chosen === d.answer;
  if (correct) { addMyScore(100); sfxCorrect(); } else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's6', 1200);
  stageItem++; setTimeout(nextS6, 1600);
}

// ── STAGE 7 ──────────────────────────────────────────────────
function startS7() {
  s7Step = 0; s7Mistakes = 0; stageCanAct = false;
  document.getElementById('s7-progress-fill').style.width = '0%';
  showGamePanel('s7-panel');
  setItemProgress(1, S7_STEPS.length);
  nextS7Step();
}
function nextS7Step() {
  stopLocalTimer();
  if (s7Step >= S7_STEPS.length) {
    // Bonus for perfect run
    if (s7Mistakes === 0) { addMyScore(300); sfxBonus(); showToast('🏆 Perfect Routing! +300 bonus pts'); }
    setTimeout(() => finishStage(7), 1200);
    return;
  }
  const d = S7_STEPS[s7Step];
  setItemProgress(s7Step+1, S7_STEPS.length);
  document.getElementById('s7-progress-fill').style.width = `${(s7Step/S7_STEPS.length)*100}%`;
  document.getElementById('s7-step-num').textContent = `Decision ${d.step} of ${S7_STEPS.length}`;
  document.getElementById('s7-situation').textContent = d.situation;
  document.getElementById('s7-question').textContent = d.q;
  // Render options
  const optsEl = document.getElementById('s7-opts');
  optsEl.innerHTML = '';
  d.opts.forEach((opt,i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn'; btn.textContent = opt;
    btn.onclick = () => handleS7(i, d);
    optsEl.appendChild(btn);
  });
  document.getElementById('s7-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',20,() => {
    stageCanAct = false;
    document.querySelectorAll('#s7-opts .option-btn').forEach(b=>b.disabled=true);
    s7Mistakes++;
    showAnswerFeedback(false, d.hint, 's7', 1400);
    s7Step++; setTimeout(nextS7Step, 1800);
  });
}
function handleS7(idx, d) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  document.querySelectorAll('#s7-opts .option-btn').forEach(b=>b.disabled=true);
  const correct = idx === d.ans;
  if (correct) { addMyScore(150); sfxCorrect(); }
  else { sfxWrong(); deductScore(2); s7Mistakes++; }
  showAnswerFeedback(correct, d.hint, 's7', 1200);
  s7Step++; setTimeout(nextS7Step, 1600);
}

// ============================================================
// STAGE COMPLETION & BETWEEN-STAGE FLOW
// ============================================================
function finishStage(n) {
  stopLocalTimer(); sfxLevelUp();
  // Show waiting message for players who finished first
  document.getElementById('waiting-msg').classList.remove('hidden');
  get(dbRef('rooms', roomCode, 'players')).then(s => { players = s.val()||{}; showStageBetween(n); });
}

function showStageBetween(n) {
  const isLast = n >= 7;
  document.getElementById('between-title').textContent = isLast ? 'Refresher Complete! 🏆' : `Stage ${n} Complete! ✅`;
  document.getElementById('between-sub').textContent = isLast
    ? 'Final leaderboard — facilitator will start the winner reveal'
    : `Results after Stage ${n} — facilitator will show the key reminders`;
  renderLeaderboard('leaderboard-between', players);
  showScreen('screen-between');

  const nextBtn = document.getElementById('btn-next-level');
  const cd      = document.getElementById('between-countdown');

  if (isHost) {
    nextBtn.classList.remove('hidden'); nextBtn.disabled = false;
    nextBtn.textContent = isLast ? '🏆 Reveal Winners →' : '💡 Show Key Reminders →';
    nextBtn.onclick = () => {
      nextBtn.disabled = true; sfxClick();
      if (isLast) {
        update(dbRef('rooms', roomCode), { 'game/level': 'results' });
        showFinalResults();
      } else {
        update(dbRef('rooms', roomCode), { 'game/level': n, 'game/betweenPhase': 'explanation' });
        showExplanation(n);
      }
    };
    cd.textContent = '';
  } else {
    nextBtn.classList.add('hidden');
    cd.textContent = isLast ? 'Waiting for facilitator to start winner reveal...' : 'Waiting for facilitator to show key reminders...';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/betweenPhase`, snap => {
      const bp = snap.val();
      if (bp === 'explanation') { clearListeners(); showExplanation(n); }
    });
    listenOn(`rooms/${roomCode}/game/level`, snap => {
      const lv = snap.val();
      if (lv === 'results') { clearListeners(); showFinalResults(); }
    });
  }
}

// ============================================================
// EXPLANATION SCREEN
// ============================================================
function showExplanation(n) {
  const exp = STAGE_EXPLANATIONS[n];
  if (!exp) { advanceToNextStage(n); return; }
  showScreen('screen-explanation');
  document.getElementById('exp-stage-label').textContent = `Stage ${n} of 7 — Key Reminders`;
  document.getElementById('exp-title').textContent = exp.title;

  // Build explanation content
  const content = document.getElementById('exp-points');
  content.innerHTML = exp.points.map(p =>
    `<div class="exp-point exp-${p.color}">
      <span class="exp-point-icon">${p.icon}</span>
      <span class="exp-point-text">${p.text}</span>
    </div>`
  ).join('');

  // Takeaway
  document.getElementById('exp-takeaway').textContent = exp.takeaway;

  // Workflow diagram (simplified inline)
  buildExpDiagram(n, document.getElementById('exp-diagram'));

  const nextBtn = document.getElementById('btn-next-stage');
  const waiting = document.getElementById('exp-waiting');

  if (isHost) {
    nextBtn.classList.remove('hidden'); nextBtn.disabled = false;
    waiting.classList.add('hidden');
    nextBtn.textContent = n < 7 ? `Start Stage ${n+1} →` : '🏆 Reveal Winners →';
    nextBtn.onclick = () => {
      nextBtn.disabled = true; sfxClick();
      update(dbRef('rooms', roomCode), { 'game/level': n+1, 'game/betweenPhase': 'leaderboard' });
      if (n < 7) showStageIntro(n+1, () => startStage(n+1));
      else showFinalResults();
    };
  } else {
    nextBtn.classList.add('hidden');
    waiting.classList.remove('hidden');
    waiting.textContent = 'Waiting for facilitator to start next stage...';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/level`, snap => {
      const lv = snap.val();
      if (lv === 'results') { clearListeners(); showFinalResults(); return; }
      if (typeof lv === 'number' && lv > n) {
        clearListeners();
        showStageIntro(lv, () => startStage(lv));
      }
    });
  }
}

function buildExpDiagram(n, container) {
  container.innerHTML = '';
  const diagrams = {
    'service-product': [
      { text:'Issue during ICS Service', cls:'diag-green', arrow:'→ Service Complaint → Claims Team' },
      { text:'Issue from Manufacturer / Product', cls:'diag-blue', arrow:'→ Product Complaint → Contact Client (Manufacturer)' },
    ],
    'ownership': [
      { text:'Returns Team', cls:'diag-purple', arrow:'Reviews & Routes Only' },
      { text:'Claims Team (ICS)', cls:'diag-green', arrow:'Owns Service Complaints + Quality Case' },
      { text:'Client (Manufacturer)', cls:'diag-blue', arrow:'Receives Product Complaints (from Returns)' },
    ],
    'workflow': [
      { text:'Complaint Received', cls:'diag-gray', arrow:'↓' },
      { text:'Returns Reviews', cls:'diag-purple', arrow:'↓' },
      { text:'Did ICS manage shipment?', cls:'diag-orange', arrow:'YES ↓ / NO → Contact Client (Manufacturer)' },
      { text:'Where did it originate?', cls:'diag-orange', arrow:'Service ↓ / Product → Contact Client (Manufacturer)' },
      { text:'Service → Claims | Product → AM', cls:'diag-green', arrow:'' },
    ],
  };
  const diag = diagrams[STAGE_EXPLANATIONS[n]?.diagram] || diagrams['workflow'];
  diag.forEach(step => {
    const div = document.createElement('div');
    div.className = `diag-step ${step.cls}`;
    div.innerHTML = `<span class="diag-text">${step.text}</span>${step.arrow?`<span class="diag-arrow">${step.arrow}</span>`:''}`;
    container.appendChild(div);
  });
}

// ============================================================
// LEADERBOARD + RESULTS (unchanged structure)
// ============================================================
function renderLeaderboard(id, playerData) {
  const container = document.getElementById(id); if (!container) return;
  container.innerHTML = '';
  const sorted = Object.entries(playerData).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i) => {
    const row = document.createElement('div'); row.className = `lb-row rank-${i+1}`;
    row.innerHTML = `<span class="lb-rank">${medals[i]||i+1}</span>
      <span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span>
      <span class="lb-score">${p.score||0} pts</span>`;
    container.appendChild(row);
  });
}

function showFinalResults() {
  stopLocalTimer(); stopJazz();
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
  const champOv = document.getElementById('champion-overlay');
  champOv.classList.add('hidden'); champOv.classList.remove('champion-reveal','champion-building');

  const rankLabel = {2:'🥈 2nd Place',3:'🥉 3rd Place',4:'4th Place',5:'5th Place'};
  const others = sorted.filter(p=>p.rank!==1).slice(0,4).reverse();
  const winner = sorted.find(p=>p.rank===1);
  const CARD_GAP = 5000;
  let delay = 800;

  others.forEach(p => {
    setTimeout(() => {
      sfxReveal();
      const card = document.createElement('div'); card.className=`reveal-card rank-${p.rank}`;
      card.innerHTML = `<span class="reveal-rank">${rankLabel[p.rank]||('#'+p.rank)}</span>
        <span class="reveal-name">${p.name}${p.uid===myUid?' (you)':''}</span>
        <span class="reveal-score">${p.score||0} pts</span>`;
      document.getElementById('podium').appendChild(card);
    }, delay);
    delay += CARD_GAP;
  });

  if (winner) {
    const bs = delay;
    setTimeout(()=>{ champOv.classList.remove('hidden'); champOv.classList.add('champion-building'); document.getElementById('champion-who').classList.remove('hidden'); sfxDrumroll(); }, bs);
    setTimeout(()=>spawnConfetti(), bs+2200);
    setTimeout(()=>{ spawnConfetti(); [0,150,300,450,600].forEach(t=>{ setTimeout(()=>{ const fl=document.createElement('div'); fl.className='champ-flash'; document.body.appendChild(fl); setTimeout(()=>fl.remove(),300); },t); }); }, bs+4000);
    setTimeout(()=>{ spawnConfetti(); sfxDrumroll(); }, bs+6000);
    setTimeout(()=>{
      document.getElementById('champion-who').classList.add('hidden');
      champOv.classList.remove('champion-building');
      document.getElementById('champion-name').textContent  = winner.name+(winner.uid===myUid?' 🎉':'');
      document.getElementById('champion-score').textContent = (winner.score||0)+' pts';
      champOv.classList.add('champion-reveal'); sfxChampion();
      spawnConfetti(); setTimeout(spawnConfetti,400); setTimeout(spawnConfetti,800);
    }, bs+7000);
    delay = bs+7000+3500;
  }

  setTimeout(()=>{
    renderLeaderboard('full-leaderboard', players);
    if (isHost) {
      const paBtn=document.createElement('button'); paBtn.className='btn-corp-primary'; paBtn.style.marginBottom='10px';
      paBtn.textContent='🔁 Run Refresher Again'; paBtn.onclick=()=>{sfxClick();resetGame();};
      document.getElementById('results-actions').appendChild(paBtn);
    }
  }, delay+1000);
}

// ============================================================
// CONFETTI (unchanged)
// ============================================================
function spawnConfetti() {
  const colors=['#7C3AED','#10B981','#3B82F6','#F59E0B','#6366F1','#EC4899'];
  for(let i=0;i<70;i++){
    setTimeout(()=>{
      const el=document.createElement('div'); el.className='confetti';
      el.style.cssText=`left:${rand(5,95)}vw;top:-12px;width:${rand(6,12)}px;height:${rand(6,12)}px;background:${pick(colors)};border-radius:${Math.random()>.5?'50%':'3px'};animation:confettiFall ${rand(1.4,3)}s linear forwards;`;
      document.body.appendChild(el); setTimeout(()=>el.remove(),3300);
    },i*45);
  }
  if(!document.getElementById('confetti-style')){
    const s=document.createElement('style'); s.id='confetti-style';
    s.textContent='@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(720deg);opacity:0}}';
    document.head.appendChild(s);
  }
}

// ============================================================
// RESET / NAVIGATION (unchanged)
// ============================================================
async function resetGame() {
  if (isHost && roomCode) {
    const upd={};
    Object.keys(players).forEach(uid=>{upd[`players/${uid}/score`]=0;});
    Object.assign(upd,{'game/level':1,'game/round':0,'game/phase':'intro','game/betweenPhase':'leaderboard','game/roundSeed':Math.floor(Math.random()*100000),'status':'lobby'});
    await update(dbRef('rooms',roomCode),upd);
  }
  clearListeners(); stopLocalTimer();
  Object.keys(players).forEach(uid=>{if(players[uid])players[uid].score=0;});
  openLobby();
}
function resetToMenu() {
  clearListeners(); stopLocalTimer(); stopJazz();
  players={}; roomCode=''; isHost=false; showScreen('screen-menu');
}

// ============================================================
// BUTTON EVENT LISTENERS (unchanged)
// ============================================================
document.getElementById('btn-create').addEventListener('click',()=>{sfxClick();document.getElementById('modal-create').classList.remove('hidden');document.getElementById('input-host-name').focus();});
document.getElementById('btn-create-cancel').addEventListener('click',()=>document.getElementById('modal-create').classList.add('hidden'));
document.getElementById('btn-create-confirm').addEventListener('click',async()=>{
  const name=document.getElementById('input-host-name').value.trim();
  if(!name){showError('create-error','Please enter your name.');return;}
  document.getElementById('btn-create-confirm').disabled=true; sfxClick();
  try{await createRoom(name);document.getElementById('modal-create').classList.add('hidden');}
  catch(e){const msg = e && e.code ? `Firebase error: ${e.code}` : (e && e.message ? e.message.slice(0,80) : 'Unknown error'); showError('create-error', `Failed to create session: ${msg}`); console.error('createRoom error:', e);}
  document.getElementById('btn-create-confirm').disabled=false;
});
document.getElementById('btn-join-open').addEventListener('click',()=>{sfxClick();document.getElementById('modal-join').classList.remove('hidden');document.getElementById('input-name').focus();});
document.getElementById('btn-join-cancel').addEventListener('click',()=>document.getElementById('modal-join').classList.add('hidden'));
document.getElementById('btn-join-confirm').addEventListener('click',async()=>{
  const name=document.getElementById('input-name').value.trim();
  const code=document.getElementById('input-code').value.trim().toUpperCase();
  if(!name){showError('join-error','Enter your name.');return;}
  if(code.length<4){showError('join-error','Enter the 4-character session code.');return;}
  document.getElementById('btn-join-confirm').disabled=true; sfxClick();
  const err=await joinRoom(name,code);
  if(err)showError('join-error',err); else document.getElementById('modal-join').classList.add('hidden');
  document.getElementById('btn-join-confirm').disabled=false;
});
document.getElementById('btn-copy-code').addEventListener('click',()=>{navigator.clipboard?.writeText(roomCode).catch(()=>{});showToast('Session code copied!');});
document.getElementById('btn-leave-lobby').addEventListener('click',async()=>{
  sfxClick();
  if(roomCode&&myUid){await remove(dbRef('rooms',roomCode,'players',myUid));if(isHost)await remove(dbRef('rooms',roomCode));}
  resetToMenu();
});
document.getElementById('btn-main-menu').addEventListener('click',()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-menu').addEventListener('click',()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-again').addEventListener('click',()=>{sfxClick();resetGame();});
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    const cm=document.getElementById('modal-create'),jm=document.getElementById('modal-join');
    if(!cm.classList.contains('hidden'))document.getElementById('btn-create-confirm').click();
    else if(!jm.classList.contains('hidden'))document.getElementById('btn-join-confirm').click();
  }
  if(e.key==='Escape'){document.getElementById('modal-create').classList.add('hidden');document.getElementById('modal-join').classList.add('hidden');}
});
document.getElementById('input-code').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
document.addEventListener('click',()=>{if(musicOn&&!jazzInterval)startJazz();},{once:true});

// ============================================================
// BOOT (unchanged)
// ============================================================
async function boot() {
  document.getElementById('loading-msg').textContent='Initialising...';
  showScreen('screen-loading');
  try {
    await initAuth(); initConnectionMonitor();
    document.getElementById('loading-msg').textContent='Ready to refresh!';
    await new Promise(r=>setTimeout(r,700));
    showScreen('screen-menu');
  } catch(e) {
    document.getElementById('loading-msg').textContent='Connection failed. Check firebase.js';
    console.error('Boot error:',e);
  }
}
boot();
