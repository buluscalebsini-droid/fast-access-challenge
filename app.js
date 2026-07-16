// ============================================================
// app.js — Good Prompts Challenge — AI Learning Platform
// INFRASTRUCTURE: kept 100% identical to original
// GAME CONTENT: 7 prompt-writing stages + Prompt Ninja mini-game
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

let currentStage  = 1;
let stageItem     = 0;
let stageCanAct   = false;
let s5CaseIdx     = 0;
let s5QuestionIdx = 0;
let s5CaseCorrect = 0;
let stageScoreLocal = 0;

// Prompt Ninja state
let ninjaScore    = 0;
let ninjaLives    = 3;
let ninjaCombo    = 0;
let ninjaSpawned  = 0;
let ninjaInterval = null;
let ninjaTimer    = null;
const NINJA_TOTAL = 20;

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
  await signInAnonymously(auth);
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { myUid = user.uid; unsub(); resolve(); }
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
  myName = hostName.trim(); isHost = true; roomCode = genRoomCode();
  const roomRef = dbRef('rooms', roomCode);
  if ((await get(roomRef)).exists()) roomCode = genRoomCode();
  await onDisconnect(dbRef('rooms', roomCode, 'players', myUid)).remove();
  await set(roomRef, {
    host: myUid, status: 'lobby', created: serverTimestamp(),
    players: { [myUid]: { name: myName, score: 0, color: 0, ready: true } },
    game: { level: 0, round: 0, roundSeed: 0, phase: 'waiting', betweenPhase: 'leaderboard' }
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
// LOBBY (unchanged structure)
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
      if (s.val() === uid) { const h = document.createElement('span'); h.className = 'player-badge'; h.textContent = 'HOST'; bg.appendChild(h); }
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
    btn.textContent = count < 2 ? '▶ Start Solo Session' : '▶ Begin Challenge';
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
  const CIRC = 113;
  if (timerEl) { timerEl.textContent = remaining; timerEl.classList.remove('warn'); }
  if (barEl) {
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
  1: { icon:'🎯', title:'Prompt Fundamentals',    sub:'True or False — test your core understanding of effective AI prompting.', tip:'💡 Think about what makes a prompt specific and clear.', badge:'10 Questions', color:'var(--c-indigo)' },
  2: { icon:'📋', title:'Core Components',         sub:'Multiple choice — identify the key building blocks of great prompts.', tip:'💡 A great prompt always has a clear objective and context.', badge:'8 Questions', color:'var(--c-purple)' },
  3: { icon:'🃏', title:'Component Match',          sub:'Drag each item into the correct column — good or avoid.', tip:'💡 Specificity always beats vagueness. Context beats assumptions.', badge:'16 Items', color:'var(--c-blue)' },
  4: { icon:'🔄', title:'Build the Flow',           sub:'Complete the prompt-building workflow — fill in the missing step.', tip:'💡 Great prompts follow a logical structure from goal to format.', badge:'5 Questions', color:'var(--c-green)' },
  5: { icon:'📂', title:'Prompt Case Files',         sub:'Analyse real prompt scenarios — answer 4 questions per case.', tip:'💡 Bonus points for a perfect case! Diagnose each prompt carefully.', badge:'3 Cases', color:'var(--c-orange)' },
  6: { icon:'🕐', title:'Spot the Better Prompt',   sub:'Compare two prompts — which one will get a better AI response?', tip:'💡 Look for specificity, context, and clear instructions.', badge:'6 Rounds', color:'var(--c-indigo)' },
  7: { icon:'⚡', title:'Prompt Ninja',              sub:'Catch GOOD prompt components — dodge the BAD ones! Fast reactions score big.', tip:'💡 Combos multiply your score. Don\'t lose all 3 lives!', badge:'Live Mini-Game', color:'var(--c-purple)' },
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
// GAME CONTENT — 7 STAGES
// ============================================================

// ── STAGE 1: True / False ─────────────────────────────────────
const S1_DATA = [
  { statement: 'A good AI prompt should always be as short as possible to save time.', answer: false,
    hint: 'FALSE — Shorter is NOT better. Effective prompts include necessary context, specificity, and clarity. Vague prompts produce vague results.' },
  { statement: 'Including the intended audience in your prompt helps the AI tailor its tone and depth.', answer: true,
    hint: 'TRUE — Specifying "explain this to a 10-year-old" vs "explain to a senior developer" produces very different, more targeted responses.' },
  { statement: '"Write something about climate change" is a strong prompt because it gives the AI creative freedom.', answer: false,
    hint: 'FALSE — This is too vague. A strong prompt specifies the format, length, audience, tone, and specific angle you want covered.' },
  { statement: 'Specifying the output format (e.g. bullet list, table, JSON) in your prompt improves the usefulness of the AI response.', answer: true,
    hint: 'TRUE — Format instructions prevent the AI from guessing what structure you need, saving editing time and improving accuracy.' },
  { statement: 'You should never share personal data like names, addresses, or ID numbers in a prompt sent to a public AI tool.', answer: true,
    hint: 'TRUE — Public AI tools may log inputs. Always remove personal, sensitive, or confidential data before prompting.' },
  { statement: 'If an AI gives a poor response, the best approach is to immediately accept the result as the AI\'s best capability.', answer: false,
    hint: 'FALSE — Iteration is key. Refine your prompt, add more context, or break it into smaller steps. AI responses improve dramatically with better prompts.' },
  { statement: 'Providing an example of the output you want (few-shot prompting) often significantly improves AI accuracy.', answer: true,
    hint: 'TRUE — Showing an example of what "good" looks like gives the AI a concrete pattern to follow, reducing misinterpretation.' },
  { statement: 'Asking an AI to "think step by step" tends to produce more accurate results for complex tasks.', answer: true,
    hint: 'TRUE — Chain-of-thought prompting helps the AI reason through complex problems rather than jumping to a potentially incorrect conclusion.' },
  { statement: 'It is acceptable to ask an AI to generate content that could be used to deceive or manipulate others.', answer: false,
    hint: 'FALSE — Responsible AI use means never prompting for deceptive, harmful, or manipulative content, regardless of the claimed purpose.' },
  { statement: 'A prompt that specifies the tone (e.g. professional, friendly, concise) will produce more consistent results.', answer: true,
    hint: 'TRUE — Tone instructions constrain the AI\'s style, ensuring the output matches your context, brand, or audience expectations.' },
];

// ── STAGE 2: Multiple Choice ─────────────────────────────────
const S2_DATA = [
  { question: 'Which of these prompt components most directly improves the relevance of an AI response?',
    opts: ['Adding emojis for friendliness', 'Specifying the target audience', 'Making the prompt as short as possible', 'Using all capital letters'],
    answer: 'Specifying the target audience',
    hint: 'Audience specification tells the AI the appropriate depth, vocabulary, and assumptions — directly improving relevance and usefulness.' },
  { question: 'What is the primary purpose of including "output format" instructions in a prompt?',
    opts: ['To make the AI work faster', 'To ensure the response fits your specific use case', 'To test the AI\'s capabilities', 'To reduce the length of the response'],
    answer: 'To ensure the response fits your specific use case',
    hint: 'Format instructions (e.g. "respond as a table", "use bullet points", "return JSON") mean you can use the output immediately without reformatting.' },
  { question: 'A colleague asks the AI to "write a report". What is missing from this prompt?',
    opts: ['A greeting', 'Objective, audience, format, length, and context', 'The word "please"', 'A list of questions'],
    answer: 'Objective, audience, format, length, and context',
    hint: 'Without these components, the AI has to guess everything — resulting in a generic, often unusable output.' },
  { question: 'Which prompt technique involves giving the AI an example of the response you expect?',
    opts: ['Zero-shot prompting', 'Few-shot prompting', 'Chain-of-thought prompting', 'Role prompting'],
    answer: 'Few-shot prompting',
    hint: 'Few-shot prompting: provide 1-3 examples of the input/output pattern. The AI then follows that pattern for your actual request.' },
  { question: 'You need to summarise a 50-page policy document. What is the best first step?',
    opts: ['Ask the AI to guess what the document says', 'Upload or paste the document with clear summary instructions', 'Ask the AI to write a policy document instead', 'Ask the AI to translate it first'],
    answer: 'Upload or paste the document with clear summary instructions',
    hint: 'Always provide the actual content and specific instructions: what to extract, how long the summary should be, and for whom.' },
  { question: 'Why should you avoid including personal data (names, addresses, ID numbers) in prompts to public AI tools?',
    opts: ['It confuses the AI', 'It slows down the response', 'The data may be logged, stored, or used for training', 'Personal data is not relevant to any task'],
    answer: 'The data may be logged, stored, or used for training',
    hint: 'Public AI tools often log prompts for safety and improvement purposes. Inputting personal data creates a privacy and compliance risk.' },
  { question: 'What does "chain-of-thought" prompting ask the AI to do?',
    opts: ['Answer as quickly as possible', 'Only provide bullet points', 'Reason through the problem step by step', 'Use formal academic language'],
    answer: 'Reason through the problem step by step',
    hint: 'Adding "think step by step" or "reason through this" activates more deliberate reasoning, improving accuracy on complex or multi-step problems.' },
  { question: 'Which of these is the most effective prompt for generating a professional email?',
    opts: [
      'Write an email.',
      'Write a short, professional email to a client named Sarah, declining a meeting request this week due to a conflict, and suggesting two alternative times next week. Friendly but concise tone.',
      'Make an email good.',
      'Email to client.'
    ],
    answer: 'Write a short, professional email to a client named Sarah, declining a meeting request this week due to a conflict, and suggesting two alternative times next week. Friendly but concise tone.',
    hint: 'This prompt specifies length, tone, recipient context, purpose, and desired outcome — everything the AI needs to produce a usable result immediately.' },
];

// ── STAGE 3: Component Match (Drag & Drop) ────────────────────
const DRAG_CARDS = [
  { id:'c01', text:'Clear objective: what you want the AI to do', answer:'good' },
  { id:'c02', text:'Specific audience: who the output is for',    answer:'good' },
  { id:'c03', text:'Defined tone: professional / friendly / concise', answer:'good' },
  { id:'c04', text:'Output format: bullet list / table / JSON',   answer:'good' },
  { id:'c05', text:'Relevant context: background information',    answer:'good' },
  { id:'c06', text:'Examples of the expected output',             answer:'good' },
  { id:'c07', text:'Word or length limit for the response',       answer:'good' },
  { id:'c08', text:'"Think step by step" for complex tasks',      answer:'good' },
  { id:'c09', text:'Personal data: full names, addresses, IDs',   answer:'bad' },
  { id:'c10', text:'Vague request: "write something about X"',    answer:'bad' },
  { id:'c11', text:'No format instructions — guess the structure', answer:'bad' },
  { id:'c12', text:'Conflicting instructions in the same prompt', answer:'bad' },
  { id:'c13', text:'Assuming the AI knows your internal context', answer:'bad' },
  { id:'c14', text:'Requesting harmful or deceptive content',     answer:'bad' },
  { id:'c15', text:'Asking everything in one massive paragraph',  answer:'bad' },
  { id:'c16', text:'Missing the "why" — no purpose stated',       answer:'bad' },
];

let dragState = {};
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
  const goodZone = document.getElementById('s3-zone-good');
  const badZone  = document.getElementById('s3-zone-bad');
  pool.innerHTML = '';
  goodZone.querySelectorAll('.drag-card').forEach(el => el.remove());
  badZone.querySelectorAll('.drag-card').forEach(el => el.remove());
  DRAG_CARDS.forEach(card => {
    const el = makeDragCard(card);
    const placed = dragState[card.id];
    if (placed === 'good')      goodZone.appendChild(el);
    else if (placed === 'bad')  badZone.appendChild(el);
    else                        pool.appendChild(el);
  });
  updateFinishBtn();
}
function makeDragCard(card) {
  const el = document.createElement('div');
  el.className = 'drag-card';
  el.dataset.id = card.id;
  el.textContent = card.text;
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    dragSrcId = card.id; el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
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
  ['s3-zone-good','s3-zone-bad','s3-drag-pool'].forEach(zoneId => {
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
  dragState[dragSrcId] = (zoneName === 'good' || zoneName === 'bad') ? zoneName : null;
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
  ['s3-zone-good','s3-zone-bad','s3-drag-pool'].forEach(zoneId => {
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
      ${wrong>0?`<span class="dr-wrong">${wrong} incorrect</span>`:''}
    </div>`;
    resultsEl.classList.remove('hidden');
  }
  showToast(wrong===0 ? '🏆 Perfect sort! All correct!' : `📊 ${correct}/${DRAG_CARDS.length} correct — +${pts} pts`);
  setTimeout(() => finishStage(3), 2800);
}
window.submitDragStage = submitDragStage;

// ── STAGE 4: Build the Prompt Flow ───────────────────────────
const S4_DATA = [
  { context: 'You\'re building a prompt. What is always the FIRST thing to define?',
    flow: ['🚀 Start Building Prompt','→','???','→','🎯 Define Audience','→','📝 Add Context','→','📤 Specify Format'],
    options: ['🎯 Define Your Objective', '🎨 Choose a Font Style', '🔊 Set Volume Level', '📞 Call the Team'],
    answer: '🎯 Define Your Objective',
    explain: 'The objective — what you want the AI to accomplish — is always the foundation. Without it, every other element is meaningless.' },
  { context: 'Objective defined. Audience set. What comes next to add crucial background?',
    flow: ['🎯 Objective Defined','→','🎯 Audience Set','→','???','→','📤 Specify Output Format','→','✅ Strong Prompt'],
    options: ['📝 Provide Context', '🚪 Submit Immediately', '❌ Delete Everything', '🔄 Start Over'],
    answer: '📝 Provide Context',
    explain: 'Context bridges the gap between what you ask and what the AI knows about your specific situation. It reduces assumptions and improves precision.' },
  { context: 'The prompt has context. What should you add to ensure the response is immediately usable?',
    flow: ['📝 Context Added','→','???','→','🎯 Tone Specified','→','✅ Usable Response'],
    options: ['📤 Specify Output Format', '🖊 Write in all caps', '🔇 Remove all details', '⏳ Wait for inspiration'],
    answer: '📤 Specify Output Format',
    explain: 'Output format (table, bullets, JSON, numbered list, paragraph) means you can use the response immediately without manual reformatting.' },
  { context: 'What should you do if the first AI response is not quite right?',
    flow: ['📤 First Response Received','→','🔍 Evaluate Quality','→','???','→','✅ Better Response'],
    options: ['🔄 Refine and Iterate the Prompt', '🗑 Delete the conversation', '📞 Call a colleague instead', '😤 Accept poor results'],
    answer: '🔄 Refine and Iterate the Prompt',
    explain: 'Prompting is iterative. Add missing context, clarify ambiguous terms, or break complex requests into smaller steps. Each iteration improves results.' },
  { context: 'Complete the full prompt-building workflow from start to finish.',
    flow: ['🎯 Define Objective','→','👥 Identify Audience','→','???','→','📤 Set Format','→','???'],
    options: ['📝 Add Context', '✅ Review & Iterate', '🚀 Publish Immediately', '🎨 Add Decorations'],
    answer: '📝 Add Context|||✅ Review & Iterate',
    explain: 'The complete flow: Objective → Audience → Context → Format → Review & Iterate. Iteration is what separates average prompts from excellent ones.' },
];

let s4BlanksFilled = [];
let s4BlanksNeeded = 1;

function s4RenderFlow(d) {
  const isTwo = d.answer.includes('|||');
  s4BlanksNeeded = isTwo ? 2 : 1;
  s4BlanksFilled = [];
  const flowEl = document.getElementById('s4-flow');
  const answers = isTwo ? d.answer.split('|||') : [d.answer];
  let blankIdx = 0;
  flowEl.innerHTML = '';
  d.flow.forEach((step) => {
    if (step === '→') {
      const arr = document.createElement('div');
      arr.className = 'fc-arrow'; arr.textContent = '↓';
      flowEl.appendChild(arr); return;
    }
    if (step === '???') {
      const zone = document.createElement('div');
      zone.className = 'fc-blank'; zone.dataset.blankIdx = blankIdx;
      zone.dataset.expected = answers[blankIdx];
      zone.innerHTML = '<span class="fc-blank-label">Click an option below ↓</span>';
      flowEl.appendChild(zone); blankIdx++; return;
    }
    let cls = 'fc-node-neutral';
    if (/✅|📤|🎯/.test(step)) cls = 'fc-node-green';
    if (/❌|🗑/.test(step))    cls = 'fc-node-red';
    if (/🚀|⏳/.test(step))   cls = 'fc-node-orange';
    if (/🔍|🔄/.test(step))   cls = 'fc-node-blue';
    if (/📝|👥/.test(step))   cls = 'fc-node-indigo';
    const node = document.createElement('div');
    node.className = `fc-node ${cls}`; node.textContent = step;
    flowEl.appendChild(node);
  });
}
function s4RenderOptions(d) {
  const optsEl = document.getElementById('s4-options');
  optsEl.innerHTML = '';
  shuffle([...d.options]).forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'fc-option-btn'; btn.textContent = opt;
    btn.onclick = () => handleS4Opt(btn, opt);
    optsEl.appendChild(btn);
  });
}
function handleS4Opt(btn, chosen) {
  if (!stageCanAct) return;
  const d = S4_DATA[stageItem];
  const blanks = document.querySelectorAll('.fc-blank:not(.fc-blank-filled)');
  if (!blanks.length) return;
  const target = blanks[0];
  const expected = target.dataset.expected;
  const correct = (chosen === expected);
  if (correct) {
    target.classList.add('fc-blank-filled');
    target.innerHTML = `<div class="fc-node fc-node-green fc-node-filled">${chosen}</div>`;
    s4BlanksFilled.push(chosen);
    if (btn) { btn.classList.add('fc-opt-used'); btn.disabled = true; }
    sfxCorrect();
    if (s4BlanksFilled.length >= s4BlanksNeeded) {
      stageCanAct = false; stopLocalTimer();
      addMyScore(120 * s4BlanksNeeded);
      s4ShowExplain(true, d);
      setTimeout(() => { stageItem++; nextS4(); }, 2600);
    }
  } else {
    sfxWrong(); deductScore(2);
    if (btn) { btn.classList.add('fc-opt-shake'); setTimeout(() => btn && btn.classList.remove('fc-opt-shake'), 500); }
    target.classList.add('fc-blank-wrong');
    setTimeout(() => target.classList.remove('fc-blank-wrong'), 500);
    s4ShowExplainWrong();
  }
}
function s4ShowExplain(correct, d) {
  const fb = document.getElementById('s4-feedback');
  fb.className = 'answer-feedback ' + (correct ? 'correct' : 'wrong');
  fb.innerHTML = `<span class="fb-icon">${correct?'✓':'✗'}</span> ${d.explain||''}`;
  fb.classList.remove('hidden');
}
function s4ShowExplainWrong() {
  const fb = document.getElementById('s4-feedback');
  fb.className = 'answer-feedback wrong';
  fb.innerHTML = '<span class="fb-icon">✗</span> Not quite — try another option.';
  fb.classList.remove('hidden');
  setTimeout(() => { fb.classList.add('hidden'); }, 1200);
}
function nextS4() {
  stopLocalTimer();
  if (stageItem >= S4_DATA.length) { finishStage(4); return; }
  const d = S4_DATA[stageItem];
  setItemProgress(stageItem+1, S4_DATA.length);
  showGamePanel('s4-panel');
  document.getElementById('s4-context').textContent = d.context;
  document.getElementById('s4-sublabel').textContent =
    d.answer.includes('|||') ? 'Fill in BOTH missing steps:' : 'Click the missing step:';
  s4RenderFlow(d); s4RenderOptions(d);
  document.getElementById('s4-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',25,() => {
    stageCanAct = false;
    document.querySelectorAll('.fc-blank:not(.fc-blank-filled)').forEach(z => {
      z.classList.add('fc-blank-filled');
      z.innerHTML = `<div class="fc-node fc-node-reveal">${z.dataset.expected}</div>`;
    });
    s4ShowExplain(false, d);
    stageItem++; setTimeout(nextS4, 2800);
  });
}

// ── STAGE 5: Prompt Case Files ────────────────────────────────
const S5_CASES = [
  { title: 'Prompt Case #001 — The Vague Email Request',
    desc: 'An employee asks the AI: "Write an email." They receive a generic template with no names, no purpose, and formal language they don\'t need. The employee is frustrated and edits everything manually.',
    questions: [
      { q: 'What is the core problem with this prompt?', opts: ['It is too long', 'It has no objective, audience, tone, or context', 'It used the wrong AI tool', 'The AI is broken'], answer: 'It has no objective, audience, tone, or context', hint: 'Without objective, audience, tone, and context, the AI has to guess everything — producing a generic result that serves no one.' },
      { q: 'Which element would most improve this prompt?', opts: ['Adding emojis', 'Specifying the recipient, purpose, and desired tone', 'Making it shorter', 'Using ALL CAPS'], answer: 'Specifying the recipient, purpose, and desired tone', hint: 'Recipient + purpose + tone transforms "write an email" into a specific, actionable request the AI can fulfil accurately.' },
      { q: 'What is the best revised prompt?', opts: [
        '"Write a better email please"',
        '"Write a short, professional email to my manager Sarah declining a meeting on Friday due to a project deadline, suggesting Monday as an alternative. Polite but direct tone."',
        '"EMAIL. ASAP."',
        '"Can you write an email?"'
      ], answer: '"Write a short, professional email to my manager Sarah declining a meeting on Friday due to a project deadline, suggesting Monday as an alternative. Polite but direct tone."', hint: 'This version specifies length, tone, recipient, purpose, current constraint, and desired outcome — everything needed for an immediately usable response.' },
      { q: 'What technique could further improve the response?', opts: ['Submit immediately without checking', 'Providing an example of the email style you want (few-shot)', 'Asking the AI to be more creative', 'Removing all context'], answer: 'Providing an example of the email style you want (few-shot)', hint: 'A real example of your preferred email style (few-shot prompting) constrains the AI to match your actual voice and standards.' },
    ]
  },
  { title: 'Prompt Case #002 — The Privacy Risk',
    desc: 'A team member needs to draft a performance review. They paste the employee\'s full name, employee ID, salary details, medical leave history, and past disciplinary notes into a public AI chatbot and ask it to "write a fair review".',
    questions: [
      { q: 'What is the most serious issue with this approach?', opts: ['The prompt is too long', 'Personal and sensitive employee data is shared with a public AI tool', 'The AI cannot write reviews', 'Performance reviews should be handwritten'], answer: 'Personal and sensitive employee data is shared with a public AI tool', hint: 'Sharing names, IDs, salaries, medical info, and disciplinary records with a public AI creates serious GDPR and privacy compliance risks.' },
      { q: 'What should they do instead?', opts: ['Use a shorter version of the same prompt', 'Remove all personal identifiers and use anonymised, generalised descriptions', 'Ask the AI to keep it confidential', 'Nothing — AI tools are always private'], answer: 'Remove all personal identifiers and use anonymised, generalised descriptions', hint: 'Replace all personal data with placeholders or anonymised descriptions. The AI doesn\'t need real names or IDs to help structure a review.' },
      { q: 'Which data type is safe to include in a public AI prompt?', opts: ['Employee full name and salary', 'Medical leave history', 'Anonymised performance themes like "met targets in 3 of 4 areas"', 'Employee ID numbers'], answer: 'Anonymised performance themes like "met targets in 3 of 4 areas"', hint: 'Anonymised, non-identifying themes and patterns are safe. All personal identifiers must be removed before using public AI tools.' },
      { q: 'Which principle should guide AI use with sensitive information?', opts: ['Speed over safety', 'Share everything for accuracy', '"When in doubt, leave it out" — remove personal data before prompting', 'Ask the AI if it is safe to share'], answer: '"When in doubt, leave it out" — remove personal data before prompting', hint: 'The default position for sensitive data and public AI tools: if it identifies a real person, remove it or anonymise it before submitting.' },
    ]
  },
  { title: 'Prompt Case #003 — The Iterative Improvement',
    desc: 'A marketing manager asks: "Summarise this report." The AI gives a 3-paragraph summary covering the wrong sections. Instead of giving up, she refines her prompt based on the result.',
    questions: [
      { q: 'What is missing from the original prompt?', opts: ['Nothing — it was perfect', 'Which sections to focus on, desired length, and audience for the summary', 'A greeting and sign-off', 'The AI tool version number'], answer: 'Which sections to focus on, desired length, and audience for the summary', hint: 'Without these, the AI decides what to summarise and how long to make it — which is rarely what you actually need.' },
      { q: 'The manager adds: "Summarise only the Financial Highlights and Recommendations sections in 5 bullet points for a senior leadership audience." How does this help?', opts: ['It makes the prompt too complicated', 'It narrows the scope, sets format, length, and audience — improving precision', 'It is still too vague', 'It changes the topic completely'], answer: 'It narrows the scope, sets format, length, and audience — improving precision', hint: 'Each added element removes a guessing variable. The AI now knows what to include, what to ignore, how to format it, and who will read it.' },
      { q: 'What does this case demonstrate about AI prompting?', opts: ['First attempts are always perfect', 'Prompting is iterative — refining based on output is the normal process', 'AI tools should never be trusted', 'You need to be an expert programmer'], answer: 'Prompting is iterative — refining based on output is the normal process', hint: 'Iteration is not failure — it is the standard workflow. Every refinement step teaches you more about how to prompt effectively.' },
      { q: 'Which prompting technique did she use in her second attempt?', opts: ['Zero-shot prompting', 'Adding format, scope, length, and audience constraints', 'Role prompting', 'Chain-of-thought prompting'], answer: 'Adding format, scope, length, and audience constraints', hint: 'Adding format (bullets), scope (specific sections), length (5 bullets), and audience (senior leadership) are the core structural constraints of effective prompting.' },
    ]
  },
];

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
    if (s5CaseCorrect === c.questions.length) {
      addMyScore(200); sfxBonus(); showToast('🌟 Perfect case! +200 bonus pts');
    }
    s5CaseIdx++; setTimeout(nextS5Case, 1200); return;
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

// ── STAGE 6: Spot the Better Prompt ──────────────────────────
const S6_DATA = [
  { context: 'Goal: get help writing a social media post about a new product launch.',
    promptA: { label: 'Prompt A', text: 'Write a social media post about our new product.' },
    promptB: { label: 'Prompt B', text: 'Write a 2-sentence LinkedIn post announcing the launch of our AI scheduling tool "TimeFlow". Target audience: HR managers at mid-size companies. Tone: enthusiastic but professional. End with a call to action to book a demo.' },
    answer: 'B',
    hint: 'Prompt B specifies platform (LinkedIn), length (2 sentences), product name, target audience, tone, and a call to action — producing a post you can use immediately.' },
  { context: 'Goal: understand how to improve a team\'s meeting efficiency.',
    promptA: { label: 'Prompt A', text: 'Give me 5 specific, evidence-based strategies for reducing meeting length and improving focus for a remote software development team of 12 people. Format as a numbered list with one sentence of practical guidance per point.' },
    promptB: { label: 'Prompt B', text: 'Tell me about meetings.' },
    answer: 'A',
    hint: 'Prompt A defines quantity (5), quality (evidence-based), specificity (remote dev team of 12), and format (numbered list with brief guidance) — every element the AI needs.' },
  { context: 'Goal: get a summary of a policy document for a new employee.',
    promptA: { label: 'Prompt A', text: 'Summarise this document.' },
    promptB: { label: 'Prompt B', text: 'Summarise the key points of this document in plain English, suitable for a new employee on their first day. Focus on their rights, responsibilities, and who to contact for help. Maximum 200 words. Bullet points preferred.' },
    answer: 'B',
    hint: 'Prompt B defines audience (new employee), focus areas (rights, responsibilities, contacts), length (200 words), and format (bullets) — producing a genuinely useful onboarding resource.' },
  { context: 'Goal: ask the AI to help analyse customer feedback data.',
    promptA: { label: 'Prompt A', text: 'Analyse this customer feedback and identify the top 3 most common complaints, the top 2 positive themes, and any urgent issues needing immediate attention. Format as a structured report with clear headings.' },
    promptB: { label: 'Prompt B', text: 'Look at this customer data and tell me things.' },
    answer: 'A',
    hint: 'Prompt A specifies exactly what to extract (top 3 complaints, top 2 positives, urgent issues) and the output format (structured report with headings). Prompt B gives the AI no direction.' },
  { context: 'Goal: generate a training quiz question about GDPR.',
    promptA: { label: 'Prompt A', text: 'Write a quiz question about data.' },
    promptB: { label: 'Prompt B', text: 'Write one multiple-choice question testing knowledge of GDPR data subject rights, aimed at non-legal employees. Provide 4 options with one correct answer. Include a brief explanation of why the correct answer is right. Format: Question, then A/B/C/D options, then the answer with explanation.' },
    answer: 'B',
    hint: 'Prompt B defines the topic (GDPR data subject rights), audience (non-legal), format (multiple choice, 4 options), and structure (question → options → answer + explanation) — everything for a ready-to-use quiz item.' },
  { context: 'Goal: get advice on handling a difficult team conversation.',
    promptA: { label: 'Prompt A', text: 'I need to have a conversation with a team member who has been missing deadlines for 3 weeks, despite two previous informal chats. They\'re a strong performer generally but seem disengaged. Give me 3 specific opening phrases to start this conversation constructively, then a suggested structure for the discussion. Professional tone.' },
    promptB: { label: 'Prompt B', text: 'Help me talk to someone at work.' },
    answer: 'A',
    hint: 'Prompt A provides context (3 weeks, prior chats, strong performer, disengaged), specifies deliverables (3 opening phrases + discussion structure), and sets tone (professional). Prompt B tells the AI almost nothing.' },
];

function nextS6() {
  stopLocalTimer();
  if (stageItem >= S6_DATA.length) { finishStage(6); return; }
  const d = S6_DATA[stageItem];
  setItemProgress(stageItem+1, S6_DATA.length);
  showGamePanel('s6-panel');
  document.getElementById('s6-context').textContent = `🎯 ${d.context}`;
  const choicesEl = document.getElementById('s6-choices');
  choicesEl.className = 'pc-two-col';
  choicesEl.innerHTML = '';
  ['A','B'].forEach(which => {
    const p = which === 'A' ? d.promptA : d.promptB;
    const btn = document.createElement('button');
    btn.className = 'prompt-compare-card';
    btn.innerHTML = `<div class="pc-label">${p.label}</div><div class="pc-text">${p.text}</div>`;
    btn.onclick = () => handleS6(which, d);
    choicesEl.appendChild(btn);
  });
  document.getElementById('s6-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',25,() => {
    stageCanAct = false;
    document.querySelectorAll('.prompt-compare-card').forEach(b => b.disabled=true);
    showAnswerFeedback(false, d.hint, 's6', 1400);
    stageItem++; setTimeout(nextS6,1800);
  });
}
function handleS6(chosen, d) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  document.querySelectorAll('.prompt-compare-card').forEach(b => b.disabled=true);
  const correct = chosen === d.answer;
  if (correct) { addMyScore(150); sfxCorrect(); } else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's6', 1400);
  stageItem++; setTimeout(nextS6, 1800);
}

// ── STAGE 7: Prompt Ninja (interactive mini-game) ─────────────
const NINJA_GOOD_ITEMS = [
  { emoji:'🎯', text:'Clear objective' },
  { emoji:'👥', text:'Target audience' },
  { emoji:'💬', text:'Specific tone' },
  { emoji:'📋', text:'Output format' },
  { emoji:'📝', text:'Context provided' },
  { emoji:'📖', text:'Example given' },
  { emoji:'📏', text:'Word limit set' },
  { emoji:'🔢', text:'Step by step' },
  { emoji:'🔍', text:'Scope defined' },
  { emoji:'✅', text:'Iteration used' },
  { emoji:'🎨', text:'Style specified' },
  { emoji:'📊', text:'Data provided' },
];
const NINJA_BAD_ITEMS = [
  { emoji:'🔒', text:'Personal data' },
  { emoji:'❓', text:'Vague request' },
  { emoji:'😵', text:'No format set' },
  { emoji:'🚫', text:'Harmful intent' },
  { emoji:'🤷', text:'Missing context' },
  { emoji:'💬', text:'Conflicting ask' },
  { emoji:'📢', text:'ALL CAPS ONLY' },
  { emoji:'🌀', text:'Wall of text' },
];

function startNinja() {
  ninjaScore = 0; ninjaLives = 3; ninjaCombo = 0;
  ninjaSpawned = 0;
  stopLocalTimer();
  if (ninjaInterval) { clearInterval(ninjaInterval); ninjaInterval = null; }
  if (ninjaTimer)    { clearInterval(ninjaTimer);    ninjaTimer    = null; }

  showGamePanel('s7-panel');
  setItemProgress(0, NINJA_TOTAL);
  updateNinjaHUD();
  document.getElementById('ninja-instruction').textContent = 'Tap ✅ GOOD components — avoid ⚠️ BAD ones!';

  const arena = document.getElementById('ninja-arena');
  arena.innerHTML = '';

  // Spawn bubbles every 1.4 seconds
  ninjaInterval = setInterval(() => {
    if (ninjaSpawned >= NINJA_TOTAL || ninjaLives <= 0) {
      clearInterval(ninjaInterval); ninjaInterval = null;
      endNinja(); return;
    }
    spawnNinjaBubble();
    ninjaSpawned++;
    setItemProgress(ninjaSpawned, NINJA_TOTAL);
    const pct = (ninjaSpawned / NINJA_TOTAL) * 100;
    document.getElementById('ninja-progress-fill').style.width = pct + '%';
  }, 1400);

  // Overall 35-second time limit
  let ninjaTimeLeft = 35;
  document.getElementById('train-timer').textContent = ninjaTimeLeft;
  ninjaTimer = setInterval(() => {
    ninjaTimeLeft--;
    document.getElementById('train-timer').textContent = Math.max(0, ninjaTimeLeft);
    if (ninjaTimeLeft <= 5) sfxTimerWarn();
    if (ninjaTimeLeft <= 0) {
      clearInterval(ninjaTimer); ninjaTimer = null;
      clearInterval(ninjaInterval); ninjaInterval = null;
      endNinja();
    }
  }, 1000);
}

function spawnNinjaBubble() {
  const arena = document.getElementById('ninja-arena');
  const isGood = Math.random() < 0.55; // slightly more good than bad
  const item = isGood ? pick(NINJA_GOOD_ITEMS) : pick(NINJA_BAD_ITEMS);
  const bubble = document.createElement('div');
  bubble.className = `ninja-bubble ${isGood ? 'good' : 'bad'}`;
  bubble.dataset.type = isGood ? 'good' : 'bad';

  // Random horizontal position
  const leftPct = rand(5, 75);
  bubble.style.left = leftPct + '%';
  bubble.style.bottom = '-60px';

  // Random rise duration 4-7s
  const dur = rand(4.5, 7);
  bubble.style.animationDuration = dur + 's';

  bubble.innerHTML = `<span class="nb-emoji">${item.emoji}</span><span class="nb-text">${item.text}</span>`;

  bubble.addEventListener('click', () => handleNinjaTap(bubble, isGood));
  bubble.addEventListener('touchstart', (e) => { e.preventDefault(); handleNinjaTap(bubble, isGood); }, {passive:false});

  arena.appendChild(bubble);

  // Remove bubble after animation ends (missed)
  bubble.addEventListener('animationend', () => {
    if (bubble.parentNode) {
      bubble.remove();
      // Missed a good bubble — lose a life
      if (isGood && !bubble.dataset.tapped) {
        ninjaLives = Math.max(0, ninjaLives - 1);
        ninjaCombo = 0;
        updateNinjaHUD();
        showNinjaEffect(arena, leftPct + '%', '90%', '💔 Missed!', 'ninja-hit-miss');
        if (ninjaLives <= 0) {
          clearInterval(ninjaInterval); ninjaInterval = null;
          clearInterval(ninjaTimer);    ninjaTimer    = null;
          setTimeout(endNinja, 300);
        }
      }
    }
  });
}

function handleNinjaTap(bubble, isGood) {
  if (!bubble.parentNode || bubble.dataset.tapped) return;
  bubble.dataset.tapped = '1';
  bubble.style.animation = 'none';
  bubble.style.opacity = '0';
  const arena = document.getElementById('ninja-arena');
  const rect  = bubble.getBoundingClientRect();
  const arenaRect = arena.getBoundingClientRect();
  const x = ((rect.left - arenaRect.left) / arenaRect.width * 100) + '%';
  const y = ((rect.top  - arenaRect.top)  / arenaRect.height * 100) + '%';

  if (isGood) {
    ninjaCombo++;
    const comboMult = Math.min(ninjaCombo, 5);
    const pts = 50 * comboMult;
    ninjaScore += pts;
    addMyScore(pts);
    sfxCorrect();
    showNinjaEffect(arena, x, y, `+${pts}${comboMult > 1 ? ' ×'+comboMult+'!':''} ✅`, 'ninja-hit-good');
    if (ninjaCombo >= 2) {
      const comboEl = document.getElementById('ninja-combo-wrap');
      document.getElementById('ninja-combo').textContent = `${ninjaCombo}× COMBO!`;
      comboEl.classList.remove('hidden');
      setTimeout(() => comboEl.classList.add('hidden'), 1000);
    }
  } else {
    // Tapped a bad bubble — lose a life
    ninjaCombo = 0;
    ninjaLives = Math.max(0, ninjaLives - 1);
    sfxWrong();
    showNinjaEffect(arena, x, y, '-50 ⚠️', 'ninja-hit-bad');
    deductScore(5);
    if (ninjaLives <= 0) {
      clearInterval(ninjaInterval); ninjaInterval = null;
      clearInterval(ninjaTimer);    ninjaTimer    = null;
      setTimeout(endNinja, 300);
    }
  }
  setTimeout(() => bubble.remove(), 80);
  updateNinjaHUD();
  document.getElementById('ninja-score').textContent = ninjaScore;
}

function showNinjaEffect(arena, x, y, text, cls) {
  const el = document.createElement('div');
  el.className = `ninja-hit-effect ${cls}`;
  el.textContent = text;
  el.style.left = x; el.style.top = y;
  arena.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

function updateNinjaHUD() {
  document.getElementById('ninja-score').textContent = ninjaScore;
  const hearts = '❤️'.repeat(Math.max(0, ninjaLives)) + '🖤'.repeat(Math.max(0, 3 - ninjaLives));
  document.getElementById('ninja-lives').textContent = hearts;
}

function endNinja() {
  if (ninjaInterval) { clearInterval(ninjaInterval); ninjaInterval = null; }
  if (ninjaTimer)    { clearInterval(ninjaTimer);    ninjaTimer    = null; }
  const arena = document.getElementById('ninja-arena');
  arena.innerHTML = '';

  let bonus = 0;
  if (ninjaLives === 3) { bonus = 300; addMyScore(bonus); sfxBonus(); showToast('🏆 Perfect Ninja! +300 bonus pts!'); }
  else if (ninjaLives === 2) { bonus = 150; addMyScore(bonus); showToast('⭐ Great Ninja! +150 bonus pts!'); }
  else if (ninjaLives === 1) { bonus = 50; addMyScore(bonus); showToast('✅ Ninja survived! +50 pts!'); }
  else { showToast('💔 Ninja down! Keep practising!'); }

  // Show summary in arena
  arena.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;padding:20px;text-align:center;">
    <div style="font-size:48px">${ninjaLives > 0 ? '🥷' : '💔'}</div>
    <div style="font-size:20px;font-weight:900;color:var(--indigo)">Ninja Score: ${ninjaScore}</div>
    <div style="font-size:13px;color:var(--text-3)">Lives remaining: ${'❤️'.repeat(Math.max(0,ninjaLives))}</div>
    ${bonus > 0 ? `<div style="font-size:14px;font-weight:700;color:var(--green)">+${bonus} bonus pts!</div>` : ''}
  </div>`;

  sfxLevelUp();
  setTimeout(() => finishStage(7), 2500);
}

// ============================================================
// STAGE CONTROLLER
// ============================================================
function startStage(n) {
  currentStage = n; stageItem = 0; stageScoreLocal = 0; stageCanAct = false;
  showScreen('screen-game');
  document.getElementById('stage-num-label').textContent = `Stage ${n} of 7`;
  document.getElementById('stage-title-label').textContent = STAGE_INTROS[n].title;
  syncGameScores();

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
  else if (n === 7) startNinja();
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

// ── STAGE 1 ────────────────────────────────────────────────────
function nextS1() {
  stopLocalTimer();
  if (stageItem >= S1_DATA.length) { finishStage(1); return; }
  const d = S1_DATA[stageItem];
  setItemProgress(stageItem+1, S1_DATA.length);
  showGamePanel('s1-panel');
  document.getElementById('s1-statement').textContent = d.statement;
  document.getElementById('s1-feedback').className = 'answer-feedback hidden';
  document.getElementById('s1-feedback').textContent = '';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',18,() => {
    stageCanAct = false;
    showAnswerFeedback(false, d.hint, 's1', 1400);
    stageItem++; setTimeout(nextS1,1800);
  });
}
function handleS1(chosen) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  const d = S1_DATA[stageItem];
  const correct = (chosen === 'true') === d.answer;
  if (correct) { addMyScore(100); sfxCorrect(); }
  else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's1', 1200);
  stageItem++; setTimeout(nextS1, 1600);
}
window.handleS1 = handleS1;

// ── STAGE 2 ────────────────────────────────────────────────────
function nextS2() {
  stopLocalTimer();
  if (stageItem >= S2_DATA.length) { finishStage(2); return; }
  const d = S2_DATA[stageItem];
  setItemProgress(stageItem+1, S2_DATA.length);
  showGamePanel('s2-panel');
  document.getElementById('s2-question').textContent = d.question;
  const optsEl = document.getElementById('s2-opts');
  optsEl.innerHTML = '';
  shuffle([...d.opts]).forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'option-btn'; btn.textContent = opt;
    btn.onclick = () => handleS2(opt, d);
    optsEl.appendChild(btn);
  });
  document.getElementById('s2-feedback').className = 'answer-feedback hidden';
  stageCanAct = true;
  startTimerLocal('train-timer','train-timer-bar',25,() => {
    stageCanAct = false;
    document.querySelectorAll('#s2-opts .option-btn').forEach(b => b.disabled=true);
    showAnswerFeedback(false, d.hint, 's2', 1400);
    stageItem++; setTimeout(nextS2,1800);
  });
}
function handleS2(chosen, d) {
  if (!stageCanAct) return;
  stageCanAct = false; stopLocalTimer();
  document.querySelectorAll('#s2-opts .option-btn').forEach(b => b.disabled=true);
  const correct = chosen === d.answer;
  if (correct) { addMyScore(100); sfxCorrect(); } else { sfxWrong(); deductScore(2); }
  showAnswerFeedback(correct, d.hint, 's2', 1200);
  stageItem++; setTimeout(nextS2, 1600);
}

// ── STAGE 3 ────────────────────────────────────────────────────
function nextS3() { startS3Drag(); }

// ── STAGE 4 — already defined above ───────────────────────────

// ── STAGE 5 — already defined above ───────────────────────────

// ── STAGE 6 — already defined above ───────────────────────────

// ── STAGE 7 — already defined above ───────────────────────────

// ============================================================
// STAGE EXPLANATIONS
// ============================================================
const STAGE_EXPLANATIONS = {
  1: {
    title: 'Prompt Fundamentals — What You Learned',
    points: [
      { icon:'🎯', color:'indigo', text:'<strong>Clarity beats brevity.</strong> A short, vague prompt produces a vague, unusable result. Include the context, audience, tone, and format your task actually needs.' },
      { icon:'🔒', color:'red',    text:'<strong>Privacy is non-negotiable.</strong> Never include real names, addresses, IDs, salaries, or medical data in a public AI tool. Anonymise before you prompt.' },
      { icon:'🔄', color:'green',  text:'<strong>Iteration is normal.</strong> Professional AI users refine their prompts based on the output. The first result is rarely the final result — and that\'s expected.' },
    ],
    diagram: 'fundamentals',
    takeaway: 'Every effective prompt is specific, contextual, and ethical. Vagueness in → vagueness out. Detail in → precision out.'
  },
  2: {
    title: 'Core Components — The Building Blocks',
    points: [
      { icon:'🎯', color:'indigo', text:'<strong>The 5 core components:</strong> Objective (what), Audience (who), Context (why & background), Format (how structured), Tone (what style). Miss one and the AI fills in the gap with a guess.' },
      { icon:'📖', color:'blue',   text:'<strong>Few-shot prompting</strong> — giving the AI 1-3 examples of the output you expect — dramatically improves accuracy. Show, don\'t just tell.' },
      { icon:'🔢', color:'green',  text:'<strong>Chain-of-thought prompting</strong> — asking the AI to "think step by step" — activates more deliberate reasoning and reduces errors on complex, multi-step tasks.' },
    ],
    diagram: 'components',
    takeaway: 'Objective + Audience + Context + Format + Tone = the anatomy of an effective prompt. Each element removes a guessing variable.'
  },
  3: {
    title: 'Good vs Avoid — Sorting the Signal from the Noise',
    points: [
      { icon:'✅', color:'green',  text:'<strong>Good components:</strong> Clear objective, specific audience, defined tone, output format, relevant context, examples, word limits, "think step by step" instructions. Each adds precision.' },
      { icon:'⚠️', color:'red',    text:'<strong>Avoid these:</strong> Personal data in public tools, vague requests, missing format instructions, conflicting directions, wall-of-text prompts, harmful or deceptive intent.' },
      { icon:'💡', color:'orange', text:'<strong>Quick rule:</strong> Before submitting any prompt, ask — would a new colleague understand exactly what I need from this? If not, add more specificity.' },
    ],
    diagram: 'sorting',
    takeaway: 'Specificity always beats vagueness. Everything good in a prompt narrows what the AI must guess — improving accuracy and saving time.'
  },
  4: {
    title: 'The Prompt-Building Workflow',
    points: [
      { icon:'1️⃣', color:'indigo', text:'<strong>Step 1: Define your objective</strong> — what do you want the AI to produce? Be specific about the outcome, not just the topic.' },
      { icon:'2️⃣', color:'blue',   text:'<strong>Steps 2–4: Add audience, context, and format</strong> — each element removes a guessing variable and narrows the AI\'s interpretation.' },
      { icon:'3️⃣', color:'green',  text:'<strong>Step 5: Review and iterate</strong> — evaluate the response, identify what\'s missing, refine the prompt, and improve. Iteration is the workflow, not an exception.' },
    ],
    diagram: 'workflow',
    takeaway: 'Objective → Audience → Context → Format → Review & Iterate. This is the repeatable workflow that turns average prompts into excellent ones.'
  },
  5: {
    title: 'Prompt Case Files — Key Lessons',
    points: [
      { icon:'📧', color:'indigo', text:'<strong>Case 1 — Vague Email:</strong> "Write an email" fails because it has no objective, recipient, tone, or purpose. Every missing element forces the AI to guess — producing generic, unusable output.' },
      { icon:'🔒', color:'red',    text:'<strong>Case 2 — Privacy Risk:</strong> Personal identifiers (names, IDs, salaries, medical data) must never enter public AI tools. Anonymise with placeholders — the AI doesn\'t need real names to help.' },
      { icon:'🔄', color:'green',  text:'<strong>Case 3 — Iteration:</strong> A poor first response is not failure — it\'s diagnostic. What did the AI misunderstand? What context was missing? Refine and resubmit.' },
    ],
    diagram: 'cases',
    takeaway: 'Three rules: be specific, protect privacy, and iterate. Apply all three and your prompts will produce results you can actually use.'
  },
  6: {
    title: 'Spot the Better Prompt — Why It Matters',
    points: [
      { icon:'🔍', color:'indigo', text:'<strong>Specificity is the differentiator.</strong> The better prompt in every case specified at least 3 of: objective, audience, format, length, tone, scope, or examples. The weaker prompt had 0–1.' },
      { icon:'⏱',  color:'green',  text:'<strong>Better prompts save time.</strong> A well-constructed prompt produces a usable result immediately. A vague prompt requires multiple rounds of editing — or a complete rewrite.' },
      { icon:'📐', color:'blue',   text:'<strong>Structure is learnable.</strong> Once you know the 5 core components, you can diagnose any weak prompt and improve it in seconds. This is a learnable skill, not a talent.' },
    ],
    diagram: 'comparison',
    takeaway: 'Before submitting any prompt, check: have I stated the objective, audience, context, format, and tone? Five checks, dramatically better results.'
  },
  7: {
    title: 'Prompt Ninja — Components Mastered',
    points: [
      { icon:'⚡', color:'indigo', text:'<strong>You know the good components:</strong> Clear objective, target audience, tone, output format, context, examples, word limits, and step-by-step reasoning all make prompts stronger.' },
      { icon:'🚫', color:'red',    text:'<strong>You know what to avoid:</strong> Personal data, vague requests, missing format, conflicting instructions, harmful intent, and walls of text all weaken prompts and waste time.' },
      { icon:'🏆', color:'green',  text:'<strong>Prompt mastery is practice:</strong> The more you apply the framework — objective, audience, context, format, tone — the faster and more naturally it becomes. Keep prompting!' },
    ],
    diagram: 'mastery',
    takeaway: 'You have now practised all 7 dimensions of effective AI prompting. Apply the framework in your daily work and watch the quality of your AI interactions transform.'
  },
};

function showExplanation(n) {
  const exp = STAGE_EXPLANATIONS[n];
  if (!exp) { advanceToNextStage(n); return; }
  showScreen('screen-explanation');
  document.getElementById('exp-stage-label').textContent = `Stage ${n} of 7 — Key Insights`;
  document.getElementById('exp-title').textContent = exp.title;

  const content = document.getElementById('exp-points');
  content.innerHTML = exp.points.map(p =>
    `<div class="exp-point exp-${p.color}">
      <span class="exp-point-icon">${p.icon}</span>
      <span class="exp-point-text">${p.text}</span>
    </div>`
  ).join('');

  document.getElementById('exp-takeaway').textContent = exp.takeaway;
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
    waiting.textContent = 'Waiting for host to start next stage...';
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
    fundamentals: [
      { text:'Vague prompt in', cls:'diag-gray',   arrow:'→ Vague, unusable output out' },
      { text:'Specific prompt in', cls:'diag-indigo', arrow:'→ Precise, usable output out' },
      { text:'Personal data in public AI', cls:'diag-red', arrow:'→ Privacy & compliance risk' },
      { text:'Iteration on first result', cls:'diag-green', arrow:'→ Continuously improving output' },
    ],
    components: [
      { text:'🎯 Objective', cls:'diag-indigo', arrow:'What do you need?' },
      { text:'👥 Audience', cls:'diag-blue',   arrow:'Who is this for?' },
      { text:'📝 Context', cls:'diag-orange',  arrow:'What background matters?' },
      { text:'📤 Format', cls:'diag-green',   arrow:'How should it be structured?' },
      { text:'💬 Tone', cls:'diag-purple',   arrow:'What style is needed?' },
    ],
    workflow: [
      { text:'Define Objective', cls:'diag-indigo', arrow:'↓' },
      { text:'Identify Audience', cls:'diag-blue',   arrow:'↓' },
      { text:'Add Context', cls:'diag-orange',  arrow:'↓' },
      { text:'Specify Format & Tone', cls:'diag-green',   arrow:'↓' },
      { text:'Review → Refine → Iterate', cls:'diag-purple',  arrow:'→ Better result each time' },
    ],
    cases: [
      { text:'Case 1: Vague → Specific', cls:'diag-indigo', arrow:'Add objective + audience + tone' },
      { text:'Case 2: Personal data → Anonymised', cls:'diag-red', arrow:'Remove all identifiers' },
      { text:'Case 3: Accept → Iterate', cls:'diag-green', arrow:'Refine based on output quality' },
    ],
    comparison: [
      { text:'Weak prompt (0–1 elements)', cls:'diag-gray',   arrow:'→ Generic, unusable output' },
      { text:'Strong prompt (3–5 elements)', cls:'diag-green', arrow:'→ Specific, immediately usable' },
      { text:'Time wasted on weak prompts', cls:'diag-red',    arrow:'vs Time saved with strong ones' },
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
// STAGE COMPLETION & BETWEEN-STAGE FLOW (unchanged)
// ============================================================
function finishStage(n) {
  stopLocalTimer(); sfxLevelUp();
  if (ninjaInterval) { clearInterval(ninjaInterval); ninjaInterval = null; }
  if (ninjaTimer)    { clearInterval(ninjaTimer);    ninjaTimer    = null; }
  document.getElementById('waiting-msg').classList.remove('hidden');
  get(dbRef('rooms', roomCode, 'players')).then(s => { players = s.val()||{}; showStageBetween(n); });
}

function showStageBetween(n) {
  const isLast = n >= 7;
  document.getElementById('between-title').textContent = isLast ? 'Challenge Complete! 🏆' : `Stage ${n} Complete! ✅`;
  document.getElementById('between-sub').textContent = isLast
    ? 'Final leaderboard — host will start the winner reveal'
    : `Rankings after Stage ${n} — host will show the key insights`;
  renderLeaderboard('leaderboard-between', players);
  showScreen('screen-between');

  const nextBtn = document.getElementById('btn-next-level');
  const cd      = document.getElementById('between-countdown');

  if (isHost) {
    nextBtn.classList.remove('hidden'); nextBtn.disabled = false;
    nextBtn.textContent = isLast ? '🏆 Reveal Winners →' : '💡 Show Key Insights →';
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
    cd.textContent = isLast ? 'Waiting for host to start winner reveal...' : 'Waiting for host to show key insights...';
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
// LEADERBOARD + RESULTS (unchanged)
// ============================================================
function animateCount(el, target) {
  const dur = 900, start = performance.now();
  const tick = now => {
    const t = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(eased * target) + ' pts';
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderLeaderboard(id, playerData) {
  const container = document.getElementById(id); if (!container) return;
  container.innerHTML = '';
  const sorted = Object.entries(playerData).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i) => {
    const row = document.createElement('div'); row.className = `lb-row rank-${i+1}`;
    row.style.animationDelay = `${i * 80}ms`;
    row.classList.add('lb-row-enter');
    const initials = (p.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const avClass = `av-${i % 10}`;
    const scoreVal = p.score || 0;
    row.innerHTML = `
      <span class="lb-avatar ${avClass}">${initials}</span>
      <span class="lb-rank">${medals[i]||i+1}</span>
      <span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span>
      <span class="lb-score" data-score="${scoreVal}">0 pts</span>`;
    container.appendChild(row);
    const scoreEl = row.querySelector('.lb-score');
    setTimeout(() => animateCount(scoreEl, scoreVal), 200 + i * 80);
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
  document.getElementById('awards-row').innerHTML = '';
  const champOv = document.getElementById('champion-overlay');
  champOv.classList.add('hidden'); champOv.classList.remove('champion-reveal','champion-building');

  // Awards based on performance (shown after reveal)
  const awardDefs = [
    { icon:'🏆', label:'Prompt Champion', cond: p => p.rank === 1 },
    { icon:'⭐', label:'Prompt Expert', cond: p => p.score > 1500 },
    { icon:'⚡', label:'Fastest Thinker', cond: p => p.rank <= 3 },
    { icon:'🎯', label:'Most Accurate', cond: p => p.score > 1200 && p.rank <= 5 },
    { icon:'🚀', label:'Best Team Player', cond: p => p.uid === myUid },
  ];

  const rankLabel = {2:'🥈 2nd Place',3:'🥉 3rd Place',4:'4th Place',5:'5th Place'};
  const others = sorted.filter(p=>p.rank!==1).slice(0,4).reverse();
  const winner = sorted.find(p=>p.rank===1);
  const CARD_GAP = 4500;
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
    setTimeout(()=>spawnConfetti(), bs+2000);
    setTimeout(()=>{ spawnConfetti(); [0,150,300,450,600].forEach(t=>{ setTimeout(()=>{ const fl=document.createElement('div'); fl.className='champ-flash'; document.body.appendChild(fl); setTimeout(()=>fl.remove(),300); },t); }); }, bs+4000);
    setTimeout(()=>{ spawnConfetti(); sfxDrumroll(); }, bs+5500);
    setTimeout(()=>{
      document.getElementById('champion-who').classList.add('hidden');
      champOv.classList.remove('champion-building');
      document.getElementById('champion-name').textContent  = winner.name+(winner.uid===myUid?' 🎉':'');
      document.getElementById('champion-score').textContent = (winner.score||0)+' pts';
      champOv.classList.add('champion-reveal'); sfxChampion();
      spawnConfetti(); setTimeout(spawnConfetti,400); setTimeout(spawnConfetti,800);
    }, bs+7000);
    delay = bs+7000+3000;
  }

  setTimeout(()=>{
    renderLeaderboard('full-leaderboard', players);

    // Show awards
    const awardsRow = document.getElementById('awards-row');
    sorted.forEach(p => {
      awardDefs.forEach(aw => {
        if (aw.cond(p)) {
          const badge = document.createElement('div'); badge.className = 'award-badge';
          badge.innerHTML = `<span class="aw-icon">${aw.icon}</span><span>${p.name}: ${aw.label}</span>`;
          awardsRow.appendChild(badge);
        }
      });
    });

    if (isHost) {
      const paBtn=document.createElement('button'); paBtn.className='btn-primary'; paBtn.style.marginBottom='10px';
      paBtn.textContent='🔁 Run Challenge Again'; paBtn.onclick=()=>{sfxClick();resetGame();};
      document.getElementById('results-actions').appendChild(paBtn);
    }
  }, delay+800);
}

// ============================================================
// CONFETTI (unchanged)
// ============================================================
function spawnConfetti() {
  const colors=['#4F46E5','#7C3AED','#059669','#2563EB','#D97706','#EC4899','#14B8A6','#818CF8'];
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
  if (ninjaInterval) { clearInterval(ninjaInterval); ninjaInterval = null; }
  if (ninjaTimer)    { clearInterval(ninjaTimer);    ninjaTimer    = null; }
  Object.keys(players).forEach(uid=>{if(players[uid])players[uid].score=0;});
  openLobby();
}
function resetToMenu() {
  clearListeners(); stopLocalTimer(); stopJazz();
  if (ninjaInterval) { clearInterval(ninjaInterval); ninjaInterval = null; }
  if (ninjaTimer)    { clearInterval(ninjaTimer);    ninjaTimer    = null; }
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
  catch(e){const msg=e&&e.code?`Firebase error: ${e.code}`:(e&&e.message?e.message.slice(0,80):'Unknown error');showError('create-error',`Failed to create session: ${msg}`);console.error('createRoom error:',e);}
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
document.getElementById('mute-btn-game').addEventListener('click',toggleMusic);
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
  document.getElementById('loading-msg').textContent='Initialising AI engine...';
  showScreen('screen-loading');
  try {
    await initAuth(); initConnectionMonitor();
    document.getElementById('loading-msg').textContent='Ready to prompt!';
    await new Promise(r=>setTimeout(r,700));
    showScreen('screen-menu');
  } catch(e) {
    document.getElementById('loading-msg').textContent='Connection failed. Check firebase.js';
    console.error('Boot error:',e);
  }
}
boot();
