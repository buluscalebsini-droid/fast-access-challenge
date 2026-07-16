// ============================================================
// app.js — AI Prompt Arena — Arcade Edition
// Firebase/multiplayer/scoring/timers: 100% preserved
// Gameplay: 7 arcade mini-games replacing quiz screens
// ============================================================
import {
  db, auth, ref, set, get, update, onValue, onDisconnect,
  serverTimestamp, off, remove, push, child,
  signInAnonymously, onAuthStateChanged
} from './firebase.js';

// ============================================================
// PARTICLE BACKGROUND ENGINE
// ============================================================
(function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 28; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 3 + 1,
      dx: (Math.random() - 0.5) * 0.4,
      dy: (Math.random() - 0.5) * 0.4,
      alpha: Math.random() * 0.3 + 0.05,
      color: ['#4F46E5','#7C3AED','#06B6D4','#10B981'][Math.floor(Math.random()*4)]
    });
  }
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > canvas.width)  p.dx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();

// ============================================================
// AUDIO ENGINE (unchanged from original)
// ============================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null, jazzInterval = null, musicOn = true, jazzStep = 0;
function getACtx() { if (!actx) actx = new AudioCtx(); if (actx.state === 'suspended') actx.resume(); return actx; }
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
    osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + dur + 0.05);
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
const sfxDrumroll  = () => { [0,0.10,0.19,0.27,0.34,0.40,0.45,0.49,0.52,0.545,0.565,0.58].forEach(t => playTone(rand(180,230),'sawtooth',0.045,0.2,t)); };
const sfxChampion  = () => { [523,659,784,880,1047].forEach((f,i) => playTone(f,'sine',0.35,0.32,i*0.13)); setTimeout(() => [784,880,1047,1319].forEach((f,i) => playTone(f,'sine',0.4,0.35,i*0.09)), 900); };
const sfxBonus     = () => [784,880,1047,1319,1568].forEach((f,i) => playTone(f,'sine',0.2,0.28,i*0.08));
const sfxSwipe     = () => playTone(600,'triangle',0.08,0.2);
const sfxSlice     = () => { playTone(900,'sawtooth',0.06,0.3); playTone(700,'sawtooth',0.06,0.25,0.04); };
const JAZZ_CHORDS  = [[261,330,392,494],[294,370,440,554],[349,440,523,659],[392,494,587,740],[330,415,494,622]];
function playJazzChord() { if (!musicOn) return; const c = JAZZ_CHORDS[jazzStep % JAZZ_CHORDS.length]; c.forEach((f,i) => playTone(f/2,'sine',0.5,0.045,i*0.04)); playTone(c[0]/4,'triangle',0.55,0.07); jazzStep++; }
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
let currentStage = 1, stageScoreLocal = 0;

// Per-game state
let comboCount = 0;
let ninjaInterval2 = null, ninjaTimer2 = null;
let rainAnimFrame = null, rainDrops = [], rainLives = 3, rainCaught = 0, rainMissed = 0, rainSpawned = 0, rainActive = false;
let honItems = [], honIdx = 0, honCanAct = false;
let factoryDragState = {}, factoryDragSrcId = null;
let builderPuzzles = [], builderIdx = 0, builderSlots = [], builderCanAct = false;
let memCards = [], memFlipped = [], memPairs = 0, memMoves = 0, memLocked = false;
let sniperItems = [], sniperIdx = 0, sniperCanAct = false;
let ninjaScore2 = 0, ninjaLives2 = 3, ninjaCombo2 = 0, ninjaSpawned2 = 0;
const NINJA_TOTAL = 22;

// ============================================================
// UTILS (unchanged)
// ============================================================
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function shuffle(arr) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=randInt(0,i);[a[i],a[j]]=[a[j],a[i]];} return a; }
function pick(arr) { return arr[randInt(0, arr.length-1)]; }
const AVATAR_COLORS = ['avatar-0','avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9'];
function playerColor(idx) { return AVATAR_COLORS[idx % AVATAR_COLORS.length]; }
function playerInitials(name) { return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?'; }
function showToast(msg, dur=2200) {
  const t = document.getElementById('toast');
  t.classList.remove('hidden'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tid); t._tid = setTimeout(() => t.classList.remove('show'), dur);
}
function showScreen(id) { document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active')); const el=document.getElementById(id); if(el) el.classList.add('active'); }
function genRoomCode() { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:4},()=>c[randInt(0,c.length-1)]).join(''); }
function setConnected(ok) { const el=document.getElementById('conn-indicator'),lbl=document.getElementById('conn-label'); if(!el)return; el.classList.toggle('offline',!ok); lbl.textContent=ok?'● Live':'● Reconnecting…'; }
function showError(elId, msg) { const el=document.getElementById(elId);if(!el)return;el.textContent=msg;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4000); }

function showCombo(n) {
  const b = document.getElementById('combo-banner');
  const t = document.getElementById('combo-text');
  if (!b || !t) return;
  t.textContent = n >= 5 ? `🔥 ${n}× MEGA COMBO!` : `⚡ ${n}× COMBO!`;
  b.classList.remove('hidden');
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = 'comboPop 0.4s cubic-bezier(0.34,1.56,0.64,1)';
  clearTimeout(b._tid); b._tid = setTimeout(() => b.classList.add('hidden'), 1200);
}

function updateHudScore() {
  const chip = document.getElementById('my-score-chip');
  if (chip && players[myUid]) {
    const s = players[myUid].score || 0;
    chip.textContent = s.toLocaleString() + ' pts';
  }
}

// ============================================================
// FIREBASE HELPERS (unchanged)
// ============================================================
function dbRef(...parts) { return ref(db, parts.join('/')); }
function listenOn(path, cb) { const r=dbRef(path); onValue(r,cb); activeListeners.push(r); return r; }
function clearListeners() { activeListeners.forEach(r=>off(r)); activeListeners=[]; }
function stopLocalTimer() { if (localTimerId) { clearInterval(localTimerId); localTimerId=null; } }

// ============================================================
// AUTH (unchanged)
// ============================================================
async function initAuth() {
  document.getElementById('loading-msg').textContent = 'Authenticating…';
  await signInAnonymously(auth);
  return new Promise(resolve => { const unsub=onAuthStateChanged(auth,user=>{ if(user){myUid=user.uid;unsub();resolve();} }); });
}
function initConnectionMonitor() { onValue(dbRef('.info/connected'), snap=>setConnected(!!snap.val())); }

// ============================================================
// ROOM CREATION / JOINING (unchanged)
// ============================================================
async function createRoom(hostName) {
  myName=hostName.trim(); isHost=true; roomCode=genRoomCode();
  const roomRef=dbRef('rooms',roomCode);
  if((await get(roomRef)).exists()) roomCode=genRoomCode();
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await set(roomRef,{host:myUid,status:'lobby',created:serverTimestamp(),players:{[myUid]:{name:myName,score:0,color:0,ready:true}},game:{level:0,round:0,roundSeed:0,phase:'waiting',betweenPhase:'leaderboard'}});
  openLobby();
}
async function joinRoom(name, code) {
  myName=name.trim();
  const upper=code.trim().toUpperCase();
  const snap=await get(dbRef('rooms',upper));
  if(!snap.exists()) return 'Room not found.';
  const data=snap.val();
  if(data.status!=='lobby') return 'Game already started.';
  const existing=data.players||{};
  const list=Object.keys(existing);
  if(list.length>=40) return 'Room is full (max 40 players).';
  roomCode=upper; isHost=data.host===myUid;
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await update(dbRef('rooms',roomCode,'players'),{[myUid]:{name:myName,score:0,color:list.length,ready:true}});
  openLobby(); return null;
}

// ============================================================
// LOBBY (unchanged structure)
// ============================================================
function openLobby() { showScreen('screen-lobby'); document.getElementById('lobby-room-code').textContent=roomCode; updateHostControls(); listenLobby(); startJazz(); }
function updateHostControls() { const btn=document.getElementById('btn-start-game'); if(isHost){btn.classList.remove('hidden');btn.onclick=()=>{sfxClick();hostStartGame();};}else btn.classList.add('hidden'); }
function listenLobby() {
  clearListeners();
  listenOn(`rooms/${roomCode}/players`,snap=>{players=snap.val()||{};renderLobbyPlayers();if(!players[myUid]){showToast('You were removed.');resetToMenu();}});
  listenOn(`rooms/${roomCode}/status`,snap=>{if(snap.val()==='playing'){clearListeners();startGame();}});
  listenOn(`rooms/${roomCode}`,snap=>{if(!snap.exists()){showToast('Room closed.');resetToMenu();}});
}
function renderLobbyPlayers() {
  const list=document.getElementById('lobby-player-list'); list.innerHTML='';
  const entries=Object.entries(players);
  entries.forEach(([uid,p],idx)=>{
    const card=document.createElement('div'); card.className='player-card';
    const av=document.createElement('div'); av.className=`player-avatar ${playerColor(p.color??idx)}`; av.textContent=playerInitials(p.name);
    const nm=document.createElement('div'); nm.className='player-name'; nm.textContent=p.name;
    const bg=document.createElement('div'); bg.style.cssText='display:flex;gap:6px';
    get(dbRef('rooms',roomCode,'host')).then(s=>{if(s.val()===uid){const h=document.createElement('span');h.className='player-badge';h.textContent='HOST';bg.appendChild(h);}});
    if(uid===myUid){const y=document.createElement('span');y.className='player-badge you';y.textContent='YOU';bg.appendChild(y);}
    card.appendChild(av); card.appendChild(nm); card.appendChild(bg); list.appendChild(card);
  });
  const count=entries.length;
  document.getElementById('lobby-status').textContent=count===1?'Waiting for players… (1/40)':`${count}/40 players connected`;
  if(isHost){const btn=document.getElementById('btn-start-game');btn.disabled=count<1;btn.textContent=count<2?'▶ START SOLO':'▶ START GAME';}
}
async function hostStartGame() {
  document.getElementById('btn-start-game').disabled=true;
  await update(dbRef('rooms',roomCode),{status:'playing','game/level':1,'game/round':0,'game/phase':'intro','game/betweenPhase':'leaderboard','game/roundSeed':Math.floor(Math.random()*100000),'game/roundStartTime':serverTimestamp()});
}

// ============================================================
// GAME START
// ============================================================
function startGame() {
  clearListeners();
  get(dbRef('rooms',roomCode,'players')).then(s=>{if(s.exists())players=s.val();});
  showStageIntro(1,()=>startStage(1));
}
function animateCN(el) { el.style.animation='none'; void el.offsetWidth; el.style.animation='popIn 0.5s ease'; }

// ============================================================
// SCORE SYNC (unchanged)
// ============================================================
function addMyScore(pts) {
  if(!myUid||!roomCode) return;
  if(!players[myUid]) players[myUid]={score:0};
  players[myUid].score=(players[myUid].score||0)+pts;
  stageScoreLocal+=pts;
  updateHudScore(); renderGameScores();
  get(dbRef('rooms',roomCode,'players',myUid,'score')).then(s=>{const cur=s.val()||0;update(dbRef('rooms',roomCode,'players',myUid),{score:cur+pts});});
}
function deductScore(pts) {
  if(!myUid||!roomCode||!players[myUid]) return;
  const next=Math.max(0,(players[myUid].score||0)-pts);
  players[myUid].score=next;
  updateHudScore(); renderGameScores();
  update(dbRef('rooms',roomCode,'players',myUid),{score:next});
}
function syncGameScores() { listenOn(`rooms/${roomCode}/players`,snap=>{players=snap.val()||{};renderGameScores();updateHudScore();}); }
function renderGameScores() {
  const c=document.getElementById('game-scores'); if(!c) return;
  const sorted=Object.entries(players).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  c.innerHTML='';
  sorted.slice(0,8).forEach(([uid,p],idx)=>{
    const chip=document.createElement('div'); chip.className='score-chip'+(idx===0?' leader':'');
    chip.innerHTML=`<span class="chip-name">${p.name}</span><span class="chip-score">${p.score||0}</span>`;
    c.appendChild(chip);
  });
}

// ============================================================
// TIMER (unchanged)
// ============================================================
function startTimerLocal(timerId, barId, seconds, onEnd) {
  stopLocalTimer();
  let remaining=seconds;
  const timerEl=document.getElementById(timerId), barEl=document.getElementById(barId);
  const CIRC=113;
  if(timerEl){timerEl.textContent=remaining;timerEl.classList.remove('warn');}
  if(barEl){if(barEl.tagName==='circle'){barEl.style.strokeDashoffset='0';barEl.classList.remove('warn');}else{barEl.style.width='100%';barEl.classList.remove('warn');}}
  localTimerId=setInterval(()=>{
    remaining--;
    if(timerEl){timerEl.textContent=remaining;if(remaining<=5){timerEl.classList.add('warn');sfxTimerWarn();}}
    if(barEl){const pct=Math.max(0,remaining/seconds);if(barEl.tagName==='circle'){barEl.style.strokeDashoffset=CIRC*(1-pct)+'';if(remaining<=5)barEl.classList.add('warn');}else{barEl.style.width=(pct*100)+'%';if(remaining<=5)barEl.classList.add('warn');}}
    if(remaining<=0){stopLocalTimer();onEnd();}
  },1000);
}

// ============================================================
// STAGE INTRO SYSTEM
// ============================================================
const STAGE_INTROS = {
  1:{icon:'🌧️',title:'Prompt Rain',badge:'GAME 1',how:'Move your finger/mouse to control the bucket. Catch ✅ GOOD prompt components. Avoid ❌ BAD ones or lose a life!',color:'#6366f1'},
  2:{icon:'🔥',title:'Hot or Not',badge:'GAME 2',how:'Cards slide in fast. Tap 👍 if it\'s a GOOD prompt component, 👎 if it should be AVOIDED. Speed = more points!',color:'#8b5cf6'},
  3:{icon:'🏭',title:'Sort Factory',badge:'GAME 3',how:'Drag each prompt chip onto the correct conveyor belt. 🤖 TO AI = good prompts. 🗑️ RECYCLE = bad prompts.',color:'#06b6d4'},
  4:{icon:'🧩',title:'Prompt Builder',badge:'GAME 4',how:'Build the perfect prompt! Click pieces in the correct order to assemble a strong AI prompt. Wrong order = penalty!',color:'#10b981'},
  5:{icon:'🧠',title:'Memory Match',badge:'GAME 5',how:'Flip cards to find matching pairs. Each pair links a prompt concept to its definition. Fewer moves = bigger bonus!',color:'#f59e0b'},
  6:{icon:'🎯',title:'Prompt Sniper',badge:'GAME 6',how:'Two prompts appear. Click the BETTER one before time runs out! Speed bonus for quick correct answers.',color:'#ef4444'},
  7:{icon:'⚡',title:'Ninja BOSS',badge:'FINAL BOSS',how:'Components fly up. Tap ✅ GOOD ones to slice them for points. Tap ❌ BAD ones and you lose a life. Build COMBOS!',color:'#ec4899'},
};
function showStageIntro(n, cb) {
  const info=STAGE_INTROS[n]; if(!info){cb();return;}
  const ov=document.getElementById('stage-intro-overlay');
  document.getElementById('si-game-badge').textContent=info.badge;
  document.getElementById('si-icon').textContent=info.icon;
  document.getElementById('si-icon').style.background=info.color;
  document.getElementById('si-num').textContent=`ROUND ${n} OF 7`;
  document.getElementById('si-title').textContent=info.title;
  document.getElementById('si-how').textContent=info.how;
  document.getElementById('si-count').textContent='';
  ov.classList.remove('hidden'); void ov.offsetWidth; ov.classList.add('si-in');
  const subEl = document.getElementById('countdown-sub');
  setTimeout(()=>{
    let c=3; document.getElementById('si-count').textContent=c; sfxCountdown();
    const tick=setInterval(()=>{
      c--;
      if(c<=0){clearInterval(tick);document.getElementById('si-count').textContent='GO!';sfxGo();setTimeout(()=>{ov.classList.add('hidden');ov.classList.remove('si-in');cb();},520);}
      else{document.getElementById('si-count').textContent=c;sfxCountdown();}
    },800);
  },2400);
}

// ============================================================
// STAGE CONTROLLER
// ============================================================
function startStage(n) {
  currentStage=n; stageScoreLocal=0; comboCount=0;
  showScreen('screen-game');
  document.getElementById('stage-num-label').textContent=`ROUND ${n}/7`;
  document.getElementById('stage-title-label').textContent=STAGE_INTROS[n].title;
  document.getElementById('combo-banner').classList.add('hidden');
  syncGameScores(); updateHudScore();
  ['s1-panel','s2-panel','s3-panel','s4-panel','s5-panel','s6-panel','s7-panel'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.add('hidden');});
  document.getElementById('waiting-msg').classList.add('hidden');
  stopAllGameLoops();
  if(n===1) startRainGame();
  else if(n===2) startHotOrNot();
  else if(n===3) startFactory();
  else if(n===4) startBuilder();
  else if(n===5) startMemory();
  else if(n===6) startSniper();
  else if(n===7) startNinjaBoss();
}

function showGamePanel(id) {
  ['s1-panel','s2-panel','s3-panel','s4-panel','s5-panel','s6-panel','s7-panel'].forEach(pid=>{const el=document.getElementById(pid);if(el)el.classList.add('hidden');});
  const el=document.getElementById(id); if(el) el.classList.remove('hidden');
}

function stopAllGameLoops() {
  stopLocalTimer();
  if(ninjaInterval2){clearInterval(ninjaInterval2);ninjaInterval2=null;}
  if(ninjaTimer2){clearInterval(ninjaTimer2);ninjaTimer2=null;}
  if(rainAnimFrame){cancelAnimationFrame(rainAnimFrame);rainAnimFrame=null;}
  rainActive=false;
}

// ============================================================
// CONTENT DATA
// ============================================================
const GOOD_ITEMS = [
  {emoji:'🎯',text:'Clear objective'},
  {emoji:'👥',text:'Target audience'},
  {emoji:'💬',text:'Specify tone'},
  {emoji:'📋',text:'Output format'},
  {emoji:'📝',text:'Add context'},
  {emoji:'📖',text:'Give examples'},
  {emoji:'📏',text:'Word limit'},
  {emoji:'🔢',text:'Step by step'},
  {emoji:'🔍',text:'Scope defined'},
  {emoji:'🔄',text:'Iterate prompt'},
  {emoji:'🎨',text:'Style guide'},
  {emoji:'📊',text:'Provide data'},
];
const BAD_ITEMS = [
  {emoji:'🔒',text:'Personal data'},
  {emoji:'❓',text:'Vague request'},
  {emoji:'😵',text:'No format'},
  {emoji:'🚫',text:'Harmful intent'},
  {emoji:'🤷',text:'Missing context'},
  {emoji:'📢',text:'ALL CAPS'},
  {emoji:'🌀',text:'Wall of text'},
  {emoji:'🗑️',text:'No objective'},
];

// ============================================================
// GAME 1: PROMPT RAIN
// ============================================================
const RAIN_TOTAL = 18;
function startRainGame() {
  rainLives=3; rainCaught=0; rainMissed=0; rainSpawned=0; rainDrops=[];
  showGamePanel('s1-panel');
  const arena = document.getElementById('rain-arena');
  arena.innerHTML = '<div class="rain-catcher" id="rain-catcher"><div class="catcher-bucket">🪣</div></div>';
  updateRainHUD();

  const catcher = document.getElementById('rain-catcher');
  let catcherX = 50; // percent
  function moveCatcher(x) {
    const arenaRect = arena.getBoundingClientRect();
    const pct = Math.max(5, Math.min(90, ((x - arenaRect.left) / arenaRect.width) * 100));
    catcherX = pct;
    catcher.style.left = pct + '%';
    catcher.style.transform = 'translateX(-50%)';
  }
  arena.addEventListener('mousemove', e => moveCatcher(e.clientX));
  arena.addEventListener('touchmove', e => { e.preventDefault(); moveCatcher(e.touches[0].clientX); }, {passive:false});

  rainActive = true;
  let lastSpawn = 0;
  const SPAWN_INTERVAL = 1200;

  function rainLoop(ts) {
    if (!rainActive) return;
    if (ts - lastSpawn > SPAWN_INTERVAL && rainSpawned < RAIN_TOTAL) {
      lastSpawn = ts;
      spawnRainDrop(arena);
      rainSpawned++;
    }
    checkRainCatches(arena, catcherX);
    if (rainSpawned >= RAIN_TOTAL && rainDrops.length === 0) {
      rainActive = false;
      showRainResult();
      return;
    }
    if (rainLives <= 0) { rainActive = false; showRainResult(); return; }
    rainAnimFrame = requestAnimationFrame(rainLoop);
  }
  rainAnimFrame = requestAnimationFrame(rainLoop);

  // 30 second overall timer
  startTimerLocal('train-timer','train-timer-bar',30,()=>{rainActive=false;showRainResult();});
}

function spawnRainDrop(arena) {
  const isGood = Math.random() < 0.58;
  const item = isGood ? pick(GOOD_ITEMS) : pick(BAD_ITEMS);
  const drop = document.createElement('div');
  drop.className = `rain-drop ${isGood?'good':'bad'}`;
  drop.dataset.good = isGood ? '1' : '0';
  drop.dataset.caught = '0';
  const left = rand(5, 85);
  drop.style.left = left + '%';
  const dur = rand(2.8, 4.5);
  drop.style.animationDuration = dur + 's';
  drop.innerHTML = `<span class="rd-emoji">${item.emoji}</span><span class="rd-text">${item.text}</span>`;
  arena.appendChild(drop);

  const dropObj = { el: drop, left, good: isGood, startTime: performance.now(), dur: dur * 1000 };
  rainDrops.push(dropObj);

  drop.addEventListener('animationend', () => {
    if (drop.dataset.caught === '0') {
      rainDrops = rainDrops.filter(d => d.el !== drop);
      if (isGood && rainActive) {
        rainLives = Math.max(0, rainLives - 1);
        rainMissed++;
        updateRainHUD();
        spawnRainEffect(arena, left + '%', '80%', '💔 Missed!', '#ef4444');
      }
      drop.remove();
    }
  });
}

function checkRainCatches(arena, catcherX) {
  const arenaH = arena.getBoundingClientRect().height;
  const now = performance.now();
  rainDrops = rainDrops.filter(d => {
    if (d.el.dataset.caught === '1') return false;
    const elapsed = now - d.startTime;
    const progress = elapsed / d.dur;
    const dropY = progress * (arenaH + 60) - 60;
    const catcherY = arenaH - 60;
    if (dropY >= catcherY - 20 && dropY <= catcherY + 40) {
      const distX = Math.abs(d.left - catcherX);
      if (distX < 12) {
        d.el.dataset.caught = '1';
        d.el.style.opacity = '0';
        setTimeout(() => d.el.remove(), 100);
        if (d.good) {
          rainCaught++;
          comboCount++;
          const mult = Math.min(comboCount, 5);
          const pts = 40 * mult;
          addMyScore(pts);
          sfxCorrect();
          spawnRainEffect(arena, d.left + '%', '70%', `+${pts} ✅`, '#10b981');
          if (comboCount >= 2) showCombo(comboCount);
        } else {
          comboCount = 0;
          rainLives = Math.max(0, rainLives - 1);
          sfxWrong(); deductScore(10);
          spawnRainEffect(arena, d.left + '%', '70%', '-10 ❌', '#ef4444');
          updateRainHUD();
        }
        updateRainHUD();
        return false;
      }
    }
    return true;
  });
}

function spawnRainEffect(arena, x, y, text, color) {
  const el = document.createElement('div');
  el.className = 'rain-catch-effect';
  el.textContent = text;
  el.style.cssText = `left:${x};top:${y};color:${color};position:absolute;font-size:16px;font-weight:900;pointer-events:none;z-index:30;`;
  arena.appendChild(el);
  setTimeout(() => el.remove(), 750);
}

function updateRainHUD() {
  document.getElementById('rain-caught').textContent = rainCaught;
  document.getElementById('rain-missed').textContent = rainMissed;
  const h = '❤️'.repeat(Math.max(0, rainLives)) + '🖤'.repeat(Math.max(0, 3 - rainLives));
  document.getElementById('rain-lives').textContent = h;
}

function showRainResult() {
  stopLocalTimer();
  const bonus = rainLives >= 3 ? 200 : rainLives === 2 ? 100 : rainLives === 1 ? 40 : 0;
  if (bonus > 0) { addMyScore(bonus); sfxBonus(); showToast(rainLives>=3?'🏆 Flawless Rain! +200 pts!':rainLives>=2?'⭐ Great catch! +100 pts!':'✅ Survived! +40 pts!'); }
  else showToast('💔 Dropped too many — practice more!');
  setTimeout(()=>finishStage(1), 1800);
}

// ============================================================
// GAME 2: HOT OR NOT
// ============================================================
const HON_DATA = shuffle([
  ...GOOD_ITEMS.map(i=>({...i,type:'good'})),
  ...BAD_ITEMS.map(i=>({...i,type:'bad'})),
  {emoji:'🎯',text:'State your goal clearly',type:'good'},
  {emoji:'📝',text:'Give relevant background',type:'good'},
  {emoji:'👤',text:'Identify who will read this',type:'good'},
  {emoji:'🔒',text:"Include employee's ID number",type:'bad'},
  {emoji:'❓',text:'Write something about AI',type:'bad'},
  {emoji:'😵',text:'Just do it ASAP!!!',type:'bad'},
]);

function startHotOrNot() {
  honItems = shuffle(HON_DATA).slice(0, 14);
  honIdx = 0; honCanAct = false;
  showGamePanel('s2-panel');
  showNextHonCard();
  startTimerLocal('train-timer','train-timer-bar',35,()=>{honCanAct=false;finishStage(2);});
}

function showNextHonCard() {
  if (honIdx >= honItems.length) { stopLocalTimer(); finishStage(2); return; }
  const item = honItems[honIdx];
  const inner = document.getElementById('hon-card-inner');
  inner.innerHTML = `<span class="hon-card-emoji">${item.emoji}</span><span>${item.text}</span>`;
  const card = document.getElementById('hon-card');
  card.classList.remove('swipe-left','swipe-right');
  // Touch swipe support
  let startX = null;
  card.ontouchstart = e => { startX = e.touches[0].clientX; };
  card.ontouchend = e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) handleHon(dx > 0 ? 'good' : 'bad');
    startX = null;
  };
  const progress = (honIdx / honItems.length) * 100;
  document.getElementById('hon-progress-fill').style.width = progress + '%';
  document.getElementById('hon-counter').textContent = `${honIdx+1}/${honItems.length}`;
  honCanAct = true;
}

function handleHon(choice) {
  if (!honCanAct) return;
  honCanAct = false;
  const item = honItems[honIdx];
  const correct = choice === item.type;
  const card = document.getElementById('hon-card');
  card.classList.add(choice === 'good' ? 'swipe-right' : 'swipe-left');
  sfxSwipe();
  if (correct) {
    comboCount++;
    const mult = Math.min(comboCount, 4);
    const pts = 60 * mult;
    addMyScore(pts);
    sfxCorrect();
    showToast(`✅ +${pts} pts${mult>1?' ×'+mult+' COMBO!':''}`, 800);
    if (comboCount >= 2) showCombo(comboCount);
  } else {
    comboCount = 0; sfxWrong(); deductScore(10);
    showToast(`❌ ${item.type==='good'?'That was a GOOD component!':'That was BAD — avoid it!'}`, 1000);
  }
  honIdx++;
  setTimeout(showNextHonCard, 380);
}
window.handleHon = handleHon;

// ============================================================
// GAME 3: SORT FACTORY
// ============================================================
const FACTORY_CHIPS = [
  {id:'f01',text:'🎯 Clear objective',answer:'good'},
  {id:'f02',text:'👥 Target audience',answer:'good'},
  {id:'f03',text:'📋 Output format',answer:'good'},
  {id:'f04',text:'📝 Background context',answer:'good'},
  {id:'f05',text:'📖 Example provided',answer:'good'},
  {id:'f06',text:'💬 Tone specified',answer:'good'},
  {id:'f07',text:'📏 Length limit',answer:'good'},
  {id:'f08',text:'🔢 Step-by-step ask',answer:'good'},
  {id:'f09',text:'🔒 Personal ID number',answer:'bad'},
  {id:'f10',text:'❓ "Write something"',answer:'bad'},
  {id:'f11',text:'🚫 Deceptive content',answer:'bad'},
  {id:'f12',text:'🌀 Contradictory ask',answer:'bad'},
  {id:'f13',text:'😵 No format stated',answer:'bad'},
  {id:'f14',text:'🤷 Missing the why',answer:'bad'},
  {id:'f15',text:'📢 SHOUT REQUEST!!!',answer:'bad'},
  {id:'f16',text:'🗑️ No goal at all',answer:'bad'},
];

function startFactory() {
  factoryDragState = {};
  FACTORY_CHIPS.forEach(c => { factoryDragState[c.id] = null; });
  showGamePanel('s3-panel');
  renderFactory();
  setupFactoryZones();
  updateFactorySubmit();
  startTimerLocal('train-timer','train-timer-bar',100,()=>submitFactory());
}

function renderFactory() {
  const pool = document.getElementById('factory-pool');
  const good = document.getElementById('factory-belt-good');
  const bad  = document.getElementById('factory-belt-bad');
  pool.innerHTML='';
  good.querySelectorAll('.factory-chip').forEach(e=>e.remove());
  bad.querySelectorAll('.factory-chip').forEach(e=>e.remove());
  shuffle(FACTORY_CHIPS).forEach(chip=>{
    const el = makeFactoryChip(chip);
    const placed = factoryDragState[chip.id];
    if (placed==='good') good.appendChild(el);
    else if (placed==='bad') bad.appendChild(el);
    else pool.appendChild(el);
  });
}

function makeFactoryChip(chip) {
  const el = document.createElement('div');
  el.className='factory-chip'; el.dataset.id=chip.id; el.textContent=chip.text; el.draggable=true;
  el.addEventListener('dragstart',e=>{factoryDragSrcId=chip.id;el.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',chip.id);});
  el.addEventListener('dragend',()=>el.classList.remove('dragging'));
  el.addEventListener('touchstart',e=>{factoryDragSrcId=chip.id;el.classList.add('dragging');},{passive:true});
  el.addEventListener('touchend',e=>{
    el.classList.remove('dragging');
    const t=e.changedTouches[0];
    const target=document.elementFromPoint(t.clientX,t.clientY);
    const zone=target&&target.closest('[data-zone]');
    if(zone) dropFactory(zone.dataset.zone);
  },{passive:true});
  return el;
}

function setupFactoryZones() {
  ['factory-belt-bad','factory-belt-good','factory-pool'].forEach(id=>{
    const z=document.getElementById(id); if(!z) return;
    const zn=z.dataset.zone;
    z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('drag-over');});
    z.addEventListener('dragleave',()=>z.classList.remove('drag-over'));
    z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('drag-over');if(factoryDragSrcId)dropFactory(zn);});
  });
}

function dropFactory(zone) {
  if (!factoryDragSrcId) return;
  factoryDragState[factoryDragSrcId] = (zone==='good'||zone==='bad') ? zone : null;
  factoryDragSrcId=null; renderFactory(); updateFactorySubmit();
}

function updateFactorySubmit() {
  const all = FACTORY_CHIPS.every(c=>factoryDragState[c.id]!==null);
  const btn = document.getElementById('factory-submit-btn');
  if(btn){btn.disabled=!all;btn.style.opacity=all?'1':'0.45';}
}

function submitFactory() {
  stopLocalTimer();
  const btn=document.getElementById('factory-submit-btn'); if(btn)btn.disabled=true;
  let correct=0;
  ['factory-belt-good','factory-belt-bad','factory-pool'].forEach(id=>{
    const z=document.getElementById(id); if(!z) return;
    z.querySelectorAll('.factory-chip').forEach(el=>{
      const chip=FACTORY_CHIPS.find(c=>c.id===el.dataset.id);
      const placed=factoryDragState[el.dataset.id];
      if(placed===chip.answer){el.classList.add('fc-correct');correct++;}
      else el.classList.add('fc-wrong');
    });
  });
  const wrong=FACTORY_CHIPS.length-correct;
  const pts=Math.max(0,correct*18-wrong*3);
  if(pts>0) addMyScore(pts);
  if(wrong===0){sfxBonus();} else sfxWrong();
  const r=document.getElementById('factory-result');
  if(r){
    r.innerHTML=`<div style="font-size:28px">${wrong===0?'🏆':'📊'}</div><div style="font-weight:800;font-size:16px">${correct}/${FACTORY_CHIPS.length} correct — +${pts} pts</div>`;
    r.className=`factory-result${wrong===0?' all-correct':''}`;
    r.classList.remove('hidden');
  }
  showToast(wrong===0?'🏆 Perfect factory run!':` ${correct}/${FACTORY_CHIPS.length} sorted — +${pts} pts`);
  setTimeout(()=>finishStage(3), 2600);
}
window.submitFactory = submitFactory;

// ============================================================
// GAME 4: PROMPT BUILDER
// ============================================================
const BUILDER_PUZZLES = [
  {
    goal:'Build a strong prompt: You need a summary of a company policy document for a new employee.',
    pieces:['📝 Summarise the key points','👤 for a new employee on day one','📋 as 5 bullet points','📁 from this document','💬 in plain English'],
    order:[0,3,1,4,2],
    hint:'The correct order builds: What to do → From what → For whom → In what style → In what format.'
  },
  {
    goal:'Assemble the perfect prompt for writing a LinkedIn post about a product launch.',
    pieces:['✍️ Write a LinkedIn post','🎯 announcing our new AI tool TimeFlow','👥 for HR managers','💬 enthusiastic but professional tone','📋 2 sentences + call to action'],
    order:[0,1,2,3,4],
    hint:'Goal → Subject → Audience → Tone → Format. This order makes the request immediately actionable.'
  },
  {
    goal:'Build a prompt asking the AI to help you prepare for a difficult conversation.',
    pieces:['💬 Give me 3 opening phrases','🔍 for a conversation about missed deadlines','📝 with context: 3 weeks late, prior chats done','👔 professional tone','📋 then a suggested discussion structure'],
    order:[0,1,2,3,4],
    hint:'What you need → Topic → Context → Style → Full structure. Every element shapes a better response.'
  },
];

function startBuilder() {
  builderIdx=0; builderPuzzles=shuffle(BUILDER_PUZZLES);
  showGamePanel('s4-panel');
  showBuilderPuzzle();
  startTimerLocal('train-timer','train-timer-bar',45,()=>finishStage(4));
}

function showBuilderPuzzle() {
  if (builderIdx>=builderPuzzles.length){stopLocalTimer();finishStage(4);return;}
  const p=builderPuzzles[builderIdx];
  builderSlots=Array(p.pieces.length).fill(null);
  builderCanAct=true;

  document.getElementById('builder-goal').innerHTML=`<strong>GOAL:</strong> ${p.goal}`;
  const fb=document.getElementById('builder-feedback');
  fb.className='builder-feedback hidden'; fb.textContent='';

  // Drop row — empty slots
  const dropRow=document.getElementById('builder-drop-row');
  dropRow.innerHTML='';
  for(let i=0;i<p.pieces.length;i++){
    const slot=document.createElement('div');
    slot.className='builder-slot'; slot.dataset.slot=i;
    slot.textContent=`${i+1}`;
    dropRow.appendChild(slot);
  }

  // Bank — shuffled pieces
  const bank=document.getElementById('builder-bank');
  bank.innerHTML='';
  shuffle(p.pieces.map((t,i)=>({text:t,origIdx:i}))).forEach(item=>{
    const btn=document.createElement('button');
    btn.className='builder-piece'; btn.textContent=item.text;
    btn.dataset.origIdx=item.origIdx;
    btn.onclick=()=>handleBuilderClick(btn,item.origIdx,p);
    bank.appendChild(btn);
  });
}

function handleBuilderClick(btn, origIdx, p) {
  if (!builderCanAct) return;
  // Find next empty slot
  const nextSlot=builderSlots.findIndex(s=>s===null);
  if(nextSlot===-1) return;
  const expectedOrig=p.order[nextSlot];
  const correct=origIdx===expectedOrig;
  if(correct){
    builderSlots[nextSlot]=origIdx;
    btn.disabled=true; btn.style.opacity='0.35';
    const slotEl=document.getElementById('builder-drop-row').children[nextSlot];
    if(slotEl){slotEl.textContent=p.pieces[origIdx];slotEl.classList.add('filled');}
    sfxCorrect();
    if(builderSlots.every(s=>s!==null)){
      builderCanAct=false;
      addMyScore(150); sfxBonus();
      const fb=document.getElementById('builder-feedback');
      fb.textContent=`✅ Perfect build! +150 pts. ${p.hint}`;
      fb.className='builder-feedback correct'; fb.classList.remove('hidden');
      builderIdx++;
      setTimeout(showBuilderPuzzle, 2400);
    }
  } else {
    sfxWrong(); deductScore(10);
    btn.classList.add('piece-shake');
    setTimeout(()=>btn.classList.remove('piece-shake'),400);
    // Flash wrong slot
    const slotEl=document.getElementById('builder-drop-row').children[nextSlot];
    if(slotEl){slotEl.classList.add('wrong');setTimeout(()=>slotEl.classList.remove('wrong'),400);}
    const fb=document.getElementById('builder-feedback');
    fb.textContent='❌ Wrong order! Try the next piece.';
    fb.className='builder-feedback wrong'; fb.classList.remove('hidden');
    setTimeout(()=>fb.classList.add('hidden'),1000);
  }
}

// ============================================================
// GAME 5: MEMORY MATCH
// ============================================================
const MEM_PAIRS = [
  {a:{emoji:'🎯',text:'Objective'},     b:{emoji:'🏁',text:'Goal / What'}},
  {a:{emoji:'👥',text:'Audience'},      b:{emoji:'🏫',text:'Who reads it'}},
  {a:{emoji:'💬',text:'Tone'},          b:{emoji:'😊',text:'Friendly style'}},
  {a:{emoji:'📋',text:'Format'},        b:{emoji:'📌',text:'Bullet list'}},
  {a:{emoji:'📝',text:'Context'},       b:{emoji:'🗂️',text:'Background info'}},
  {a:{emoji:'🔒',text:'Avoid: PII'},    b:{emoji:'🚫',text:'No personal data'}},
];

function startMemory() {
  memPairs=0; memMoves=0; memFlipped=[]; memLocked=false;
  showGamePanel('s5-panel');
  document.getElementById('mem-pairs').textContent='0';
  document.getElementById('mem-moves').textContent='0';

  // Build shuffled card deck
  const deck=[];
  MEM_PAIRS.forEach((pair,i)=>{
    deck.push({id:`p${i}a`,pairId:i,side:'a',emoji:pair.a.emoji,text:pair.a.text});
    deck.push({id:`p${i}b`,pairId:i,side:'b',emoji:pair.b.emoji,text:pair.b.text});
  });
  memCards=shuffle(deck);

  const grid=document.getElementById('memory-grid');
  grid.innerHTML='';
  memCards.forEach(card=>{
    const el=document.createElement('div');
    el.className='mem-card'; el.dataset.id=card.id;
    el.innerHTML=`<div class="mem-card-inner"><div class="mem-front">✨</div><div class="mem-back">${card.emoji}<br>${card.text}</div></div>`;
    el.addEventListener('click',()=>handleMemClick(el,card));
    grid.appendChild(el);
  });

  startTimerLocal('train-timer','train-timer-bar',60,()=>{stopLocalTimer();finishStage(5);});
}

function handleMemClick(el, card) {
  if(memLocked||el.classList.contains('flipped')||el.classList.contains('matched')) return;
  el.classList.add('flipped'); sfxClick();
  memFlipped.push({el,card});
  if(memFlipped.length===2){
    memMoves++;
    document.getElementById('mem-moves').textContent=memMoves;
    memLocked=true;
    const [a,b]=memFlipped;
    if(a.card.pairId===b.card.pairId&&a.card.id!==b.card.id){
      // Match!
      a.el.classList.add('matched'); b.el.classList.add('matched');
      memPairs++;
      document.getElementById('mem-pairs').textContent=memPairs;
      sfxCorrect();
      const speedBonus=Math.max(0,50-memMoves*5);
      addMyScore(100+speedBonus);
      showToast(`✅ Match! +${100+speedBonus} pts`,800);
      memFlipped=[]; memLocked=false;
      if(memPairs===MEM_PAIRS.length){
        stopLocalTimer();
        const bonus=memMoves<=8?300:memMoves<=12?150:50;
        addMyScore(bonus); sfxBonus();
        showToast(`🏆 All matched! Efficiency bonus +${bonus} pts!`);
        setTimeout(()=>finishStage(5),1800);
      }
    } else {
      setTimeout(()=>{
        a.el.classList.remove('flipped'); b.el.classList.remove('flipped');
        memFlipped=[]; memLocked=false;
      },900);
    }
  }
}

// ============================================================
// GAME 6: PROMPT SNIPER
// ============================================================
const SNIPER_ROUNDS = [
  {
    goal:'Write a message to a client about a delayed project.',
    a:{text:'Hey, project is late. Sorry.'},
    b:{text:'Write a professional 3-sentence email to our client explaining a 2-week delay on the data migration project, due to unexpected infrastructure issues, and suggesting a revised timeline. Apologetic but confident tone.'},
    correct:'b',hint:'Prompt B specifies length, recipient context, reason, timeline, and tone — everything for an immediately usable response.'
  },
  {
    goal:'Get a summary of a 30-page HR policy.',
    a:{text:'Summarise the attached HR policy in bullet points for new employees, covering: key rights, 3 main responsibilities, and who to contact. Max 150 words. Plain English.'},
    b:{text:'Summarise this document for me.'},
    correct:'a',hint:'Prompt A defines audience, focus areas, format (bullets), length limit, and reading level. Prompt B has none of these.'
  },
  {
    goal:'Generate ideas for a team-building event.',
    a:{text:'Team building ideas.'},
    b:{text:'Give me 5 team-building activity ideas for a remote software team of 15, suitable for a 1-hour online session. Mix creative and collaborative. Budget: low/no cost. List format with a one-line description per idea.'},
    correct:'b',hint:'Prompt B provides count, team type, format, time constraint, budget, and structure — giving the AI everything it needs to generate useful ideas.'
  },
  {
    goal:'Help write a performance review for an employee.',
    a:{text:'Help me write a performance review for an employee who met targets in 3 of 4 areas, showed strong collaboration, and needs to improve on meeting deadlines. Professional tone. Use the format: Strengths, Development Areas, Goals.'},
    b:{text:'Write a review for John Smith, employee ID 4421, salary £45k, who was late 12 times this year.'},
    correct:'a',hint:'Prompt A is specific and anonymised correctly. Prompt B shares real personal data (name, ID, salary) with a public AI tool — a serious privacy violation.'
  },
  {
    goal:'Get step-by-step help solving a complex data analysis problem.',
    a:{text:'Analyse this.'},
    b:{text:'I have sales data for Q1–Q3 across 5 product lines. Think step by step: first identify the top-performing product line, then the worst month overall, then suggest 2 reasons for the variance. Output as a brief report with headings.'},
    correct:'b',hint:'Prompt B uses chain-of-thought ("think step by step"), provides context, and specifies a structured output format — dramatically improving analytical quality.'
  },
  {
    goal:'Create a quiz question about GDPR for employees.',
    a:{text:'Write a quiz question about GDPR for non-legal employees. Multiple choice, 4 options, 1 correct. Include a brief explanation after the answer. Format: Question → A/B/C/D → Answer + Why.'},
    b:{text:'GDPR quiz question please.'},
    correct:'a',hint:'Prompt A defines topic, audience, format, option count, and output structure. Prompt B requires the AI to guess every single detail — leading to an unusable result.'
  },
];

function startSniper() {
  sniperItems=shuffle(SNIPER_ROUNDS); sniperIdx=0; sniperCanAct=false;
  showGamePanel('s6-panel');
  document.getElementById('sniper-prog-fill').style.width='0%';
  showNextSniper();
  startTimerLocal('train-timer','train-timer-bar',40,()=>finishStage(6));
}

function showNextSniper() {
  if(sniperIdx>=sniperItems.length){stopLocalTimer();finishStage(6);return;}
  const d=sniperItems[sniperIdx];
  const pct=(sniperIdx/sniperItems.length)*100;
  document.getElementById('sniper-prog-fill').style.width=pct+'%';
  document.getElementById('sniper-goal').textContent=`🎯 ${d.goal}`;
  const cards=document.getElementById('sniper-cards');
  cards.innerHTML='';
  const fb=document.getElementById('sniper-feedback');
  fb.className='sniper-feedback hidden';

  ['a','b'].forEach(which=>{
    const card=document.createElement('button');
    card.className='sniper-card';
    card.innerHTML=`<div class="sniper-card-label">PROMPT ${which.toUpperCase()}</div><div>${d[which].text}</div>`;
    card.onclick=()=>handleSniper(which,d,card);
    cards.appendChild(card);
  });
  sniperCanAct=true;
}

function handleSniper(which, d, clickedCard) {
  if(!sniperCanAct) return;
  sniperCanAct=false;
  const correct=which===d.correct;
  document.querySelectorAll('.sniper-card').forEach(c=>{
    c.disabled=true;
    const isCorrect=c.querySelector('.sniper-card-label').textContent.includes(d.correct.toUpperCase());
    if(isCorrect) c.classList.add('correct-card');
    else c.classList.add('wrong-card');
  });
  if(correct){
    comboCount++;
    const mult=Math.min(comboCount,4);
    const pts=120*mult;
    addMyScore(pts); sfxCorrect();
    if(comboCount>=2) showCombo(comboCount);
    const fb=document.getElementById('sniper-feedback');
    fb.textContent=`✅ +${pts} pts! ${d.hint}`; fb.className='sniper-feedback correct'; fb.classList.remove('hidden');
  } else {
    comboCount=0; sfxWrong(); deductScore(15);
    const fb=document.getElementById('sniper-feedback');
    fb.textContent=`❌ ${d.hint}`; fb.className='sniper-feedback wrong'; fb.classList.remove('hidden');
  }
  sniperIdx++;
  setTimeout(showNextSniper,correct?1600:2000);
}

// ============================================================
// GAME 7: NINJA BOSS (upgraded from previous)
// ============================================================
function startNinjaBoss() {
  ninjaScore2=0; ninjaLives2=3; ninjaCombo2=0; ninjaSpawned2=0;
  stopLocalTimer();
  if(ninjaInterval2){clearInterval(ninjaInterval2);ninjaInterval2=null;}
  if(ninjaTimer2){clearInterval(ninjaTimer2);ninjaTimer2=null;}

  showGamePanel('s7-panel');
  updateNinjaHUD2();
  document.getElementById('ninja-progress-fill').style.width='0%';

  const arena=document.getElementById('ninja-arena');
  arena.innerHTML='<canvas id="slash-canvas"></canvas>';

  // Slash canvas effect
  const slashCanvas=document.getElementById('slash-canvas');
  const slashCtx=slashCanvas.getContext('2d');
  let slashPoints=[];
  let slashTimer=null;

  function resizeSlash(){
    const r=arena.getBoundingClientRect();
    slashCanvas.width=r.width; slashCanvas.height=r.height;
  }
  resizeSlash();
  window.addEventListener('resize',resizeSlash);

  function drawSlash(){
    slashCtx.clearRect(0,0,slashCanvas.width,slashCanvas.height);
    if(slashPoints.length<2) return;
    slashCtx.beginPath();
    slashCtx.moveTo(slashPoints[0].x,slashPoints[0].y);
    for(let i=1;i<slashPoints.length;i++) slashCtx.lineTo(slashPoints[i].x,slashPoints[i].y);
    slashCtx.strokeStyle='rgba(255,255,255,0.7)';
    slashCtx.lineWidth=4; slashCtx.lineCap='round'; slashCtx.lineJoin='round';
    slashCtx.stroke();
    clearTimeout(slashTimer);
    slashTimer=setTimeout(()=>{slashPoints=[];slashCtx.clearRect(0,0,slashCanvas.width,slashCanvas.height);},300);
  }
  arena.addEventListener('mousemove',e=>{const r=arena.getBoundingClientRect();slashPoints.push({x:e.clientX-r.left,y:e.clientY-r.top});if(slashPoints.length>12)slashPoints.shift();drawSlash();});
  arena.addEventListener('touchmove',e=>{e.preventDefault();const r=arena.getBoundingClientRect();const t=e.touches[0];slashPoints.push({x:t.clientX-r.left,y:t.clientY-r.top});if(slashPoints.length>12)slashPoints.shift();drawSlash();},{passive:false});

  // Spawn bubbles — faster than Game 1
  ninjaInterval2=setInterval(()=>{
    if(ninjaSpawned2>=NINJA_TOTAL||ninjaLives2<=0){clearInterval(ninjaInterval2);ninjaInterval2=null;endNinjaBoss();return;}
    spawnNinjaBubble2(arena);
    ninjaSpawned2++;
    const pct=(ninjaSpawned2/NINJA_TOTAL)*100;
    document.getElementById('ninja-progress-fill').style.width=pct+'%';
  },1100);

  let ninjaTimeLeft=38;
  document.getElementById('train-timer').textContent=ninjaTimeLeft;
  ninjaTimer2=setInterval(()=>{
    ninjaTimeLeft--;
    document.getElementById('train-timer').textContent=Math.max(0,ninjaTimeLeft);
    if(ninjaTimeLeft<=5) sfxTimerWarn();
    if(ninjaTimeLeft<=0){clearInterval(ninjaTimer2);ninjaTimer2=null;clearInterval(ninjaInterval2);ninjaInterval2=null;endNinjaBoss();}
  },1000);
}

function spawnNinjaBubble2(arena) {
  const isGood=Math.random()<0.58;
  const item=isGood?pick(GOOD_ITEMS):pick(BAD_ITEMS);
  const bubble=document.createElement('div');
  bubble.className=`ninja-bubble ${isGood?'good':'bad'}`;
  bubble.dataset.type=isGood?'good':'bad';
  const left=rand(5,80);
  bubble.style.left=left+'%';
  bubble.style.bottom='-60px';
  const dur=rand(3.8,6);
  bubble.style.animationDuration=dur+'s';
  bubble.innerHTML=`<span class="nb-emoji">${item.emoji}</span><span class="nb-text">${item.text}</span>`;

  bubble.addEventListener('click',()=>handleNinjaTap2(bubble,isGood,arena,left));
  bubble.addEventListener('touchstart',e=>{e.preventDefault();handleNinjaTap2(bubble,isGood,arena,left);},{passive:false});

  arena.appendChild(bubble);

  bubble.addEventListener('animationend',()=>{
    if(bubble.parentNode){
      bubble.remove();
      if(isGood&&!bubble.dataset.tapped&&ninjaLives2>0){
        ninjaLives2=Math.max(0,ninjaLives2-1); ninjaCombo2=0;
        updateNinjaHUD2();
        spawnNinjaHit(arena,left+'%','85%','💔 Missed!','miss');
        if(ninjaLives2<=0){clearInterval(ninjaInterval2);ninjaInterval2=null;clearInterval(ninjaTimer2);ninjaTimer2=null;setTimeout(endNinjaBoss,400);}
      }
    }
  });
}

function handleNinjaTap2(bubble, isGood, arena, left) {
  if(!bubble.parentNode||bubble.dataset.tapped) return;
  bubble.dataset.tapped='1';
  bubble.style.animation='none'; bubble.style.opacity='0';
  const arenaR=arena.getBoundingClientRect();
  const bR=bubble.getBoundingClientRect();
  const x=((bR.left-arenaR.left)/arenaR.width*100)+'%';
  const y=((bR.top-arenaR.top)/arenaR.height*100)+'%';
  sfxSlice();
  if(isGood){
    ninjaCombo2++; ninjaScore2+=50;
    const mult=Math.min(ninjaCombo2,5);
    const pts=50*mult;
    addMyScore(pts); sfxCorrect();
    spawnNinjaHit(arena,x,y,`+${pts}${mult>1?' ×'+mult:''}!`,'good');
    if(ninjaCombo2>=2){showCombo(ninjaCombo2);document.getElementById('ninja-streak').textContent=ninjaCombo2;}
  } else {
    ninjaCombo2=0; ninjaLives2=Math.max(0,ninjaLives2-1);
    sfxWrong(); deductScore(10);
    spawnNinjaHit(arena,x,y,'-10 ⚠️','bad');
    document.getElementById('ninja-streak').textContent=0;
    if(ninjaLives2<=0){clearInterval(ninjaInterval2);ninjaInterval2=null;clearInterval(ninjaTimer2);ninjaTimer2=null;setTimeout(endNinjaBoss,400);}
  }
  setTimeout(()=>bubble.remove(),80);
  updateNinjaHUD2();
  document.getElementById('ninja-score').textContent=ninjaScore2;
}

function spawnNinjaHit(arena,x,y,text,type) {
  const el=document.createElement('div');
  el.className=`ninja-hit ${type}`;
  el.textContent=text; el.style.left=x; el.style.top=y;
  arena.appendChild(el);
  setTimeout(()=>el.remove(),750);
}

function updateNinjaHUD2() {
  document.getElementById('ninja-lives').textContent='❤️'.repeat(Math.max(0,ninjaLives2))+'🖤'.repeat(Math.max(0,3-ninjaLives2));
  document.getElementById('ninja-score').textContent=ninjaScore2;
}

function endNinjaBoss() {
  if(ninjaInterval2){clearInterval(ninjaInterval2);ninjaInterval2=null;}
  if(ninjaTimer2){clearInterval(ninjaTimer2);ninjaTimer2=null;}
  const arena=document.getElementById('ninja-arena');
  arena.innerHTML='';
  const bonus=ninjaLives2>=3?400:ninjaLives2===2?200:ninjaLives2===1?75:0;
  if(bonus>0){addMyScore(bonus);sfxBonus();showToast(ninjaLives2>=3?'🏆 NINJA MASTER! +400 pts!':ninjaLives2>=2?'⭐ Ninja Pro! +200 pts!':'✅ Ninja survived! +75 pts!');}
  else showToast('💔 Ninja defeated! Great effort!');
  arena.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;padding:20px;text-align:center;">
    <div style="font-size:56px">${ninjaLives2>0?'🥷':'💔'}</div>
    <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#4F46E5">Ninja Score: ${ninjaScore2}</div>
    <div style="font-size:14px;color:#64748b">Lives: ${'❤️'.repeat(Math.max(0,ninjaLives2))}</div>
    ${bonus>0?`<div style="font-size:15px;font-weight:800;color:#10b981">+${bonus} bonus pts!</div>`:''}
  </div>`;
  sfxLevelUp();
  setTimeout(()=>finishStage(7),2400);
}

// ============================================================
// STAGE COMPLETION & FLOW (unchanged structure)
// ============================================================
function finishStage(n) {
  stopAllGameLoops();
  sfxLevelUp();
  document.getElementById('waiting-msg').classList.remove('hidden');
  get(dbRef('rooms',roomCode,'players')).then(s=>{players=s.val()||{};showStageBetween(n);});
}

function showStageBetween(n) {
  const isLast=n>=7;
  const icon=STAGE_INTROS[n]?.icon||'📊';
  document.getElementById('between-game-icon').textContent=icon;
  document.getElementById('between-title').textContent=isLast?`${icon} GAME COMPLETE!`:`${icon} Round ${n} Done!`;
  document.getElementById('between-sub').textContent=isLast?'Final scores — host will reveal the winner!':'Live standings — host will show what you learned.';
  renderLeaderboard('leaderboard-between',players);
  showScreen('screen-between');
  const nextBtn=document.getElementById('btn-next-level');
  const cd=document.getElementById('between-countdown');
  if(isHost){
    nextBtn.classList.remove('hidden'); nextBtn.disabled=false;
    nextBtn.textContent=isLast?'🏆 Reveal Champion →':'💡 Show Lessons →';
    nextBtn.onclick=()=>{
      nextBtn.disabled=true; sfxClick();
      if(isLast){update(dbRef('rooms',roomCode),{'game/level':'results'});showFinalResults();}
      else{update(dbRef('rooms',roomCode),{'game/level':n,'game/betweenPhase':'explanation'});showExplanation(n);}
    };
    cd.textContent='';
  } else {
    nextBtn.classList.add('hidden');
    cd.textContent=isLast?'Waiting for host to reveal winner…':'Waiting for host to show lessons…';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/betweenPhase`,snap=>{if(snap.val()==='explanation'){clearListeners();showExplanation(n);}});
    listenOn(`rooms/${roomCode}/game/level`,snap=>{const lv=snap.val();if(lv==='results'){clearListeners();showFinalResults();}});
  }
}

// ============================================================
// EXPLANATIONS
// ============================================================
const EXPLANATIONS = {
  1:{
    title:'🌧️ Prompt Rain — What to Collect',
    points:[
      {icon:'✅',color:'green',text:'<strong>Good components to always include:</strong> Clear objective, target audience, output format, background context, tone specification, examples, and word limits. Each one removes a guessing variable.'},
      {icon:'❌',color:'red',text:'<strong>Always avoid:</strong> Personal data (names, IDs), vague requests, missing format, harmful intent, conflicting instructions. These make AI responses generic and unusable.'},
      {icon:'🔄',color:'indigo',text:'<strong>Prompting is iterative.</strong> If the first result isn\'t right, refine your prompt — don\'t accept a poor output.'},
    ],
    takeaway:'Every good component you include narrows what the AI has to guess. Specificity in → precision out.'
  },
  2:{
    title:'🔥 Hot or Not — Split-Second Decisions',
    points:[
      {icon:'🎯',color:'indigo',text:'<strong>The 5 must-haves:</strong> Objective (what), Audience (who), Context (why), Format (how structured), Tone (what style). Miss any one and the AI guesses.'},
      {icon:'🔒',color:'red',text:'<strong>Privacy is never optional.</strong> Personal identifiers — names, IDs, salaries, medical data — must never enter a public AI tool. Anonymise everything.'},
      {icon:'⚡',color:'green',text:'<strong>Recognition speed matters.</strong> In practice, you should be able to spot a good vs bad prompt component instantly. That\'s what this game trains.'},
    ],
    takeaway:'Good or bad? You now know in a split second. Apply that instinct every time you build a prompt.'
  },
  3:{
    title:'🏭 Sort Factory — Two Conveyor Belts',
    points:[
      {icon:'🤖',color:'green',text:'<strong>TO THE AI:</strong> Objective, audience, context, format, tone, examples, word limit, step-by-step instruction. These belong in every strong prompt.'},
      {icon:'🗑️',color:'red',text:'<strong>TO THE RECYCLE BIN:</strong> Personal data, vague requests, no format, harmful intent, missing context, conflicting directions. These produce generic or risky outputs.'},
      {icon:'💡',color:'orange',text:'<strong>Quick test:</strong> Before submitting a prompt, ask — "Would a new colleague understand exactly what I need from this?" If not, add more.'},
    ],
    takeaway:'Sort before you send. Every element that goes in the wrong direction produces a proportionally worse AI response.'
  },
  4:{
    title:'🧩 Prompt Builder — Assembly Matters',
    points:[
      {icon:'1️⃣',color:'indigo',text:'<strong>Always start with the objective.</strong> What do you want the AI to produce? State the outcome, not just the topic.'},
      {icon:'2️⃣',color:'blue',text:'<strong>Add the who, why, and background</strong> — audience, purpose, and context narrow the AI\'s interpretation dramatically.'},
      {icon:'3️⃣',color:'green',text:'<strong>End with format and tone.</strong> How long? What structure? What style? These shape an immediately usable response.'},
    ],
    takeaway:'Objective → Audience → Context → Format → Tone. Build in this order and every prompt becomes dramatically more effective.'
  },
  5:{
    title:'🧠 Memory Match — Concepts Paired',
    points:[
      {icon:'🎯',color:'indigo',text:'<strong>Objective = Goal / What</strong> — the most important element. Without it, the AI has no direction.'},
      {icon:'👥',color:'blue',text:'<strong>Audience = Who reads it</strong> — shapes depth, vocabulary, and assumed knowledge. A CEO and a new graduate need different responses.'},
      {icon:'📋',color:'green',text:'<strong>Format = Structure</strong> — bullets, table, JSON, numbered list. Tell the AI how to present, and you get a usable result immediately.'},
    ],
    takeaway:'Every concept has a real-world pair. Knowing these pairings lets you build any prompt from memory, fast.'
  },
  6:{
    title:'🎯 Prompt Sniper — Precision Counts',
    points:[
      {icon:'🔍',color:'indigo',text:'<strong>The winning prompt always had 3+ of:</strong> objective, audience, format, length, tone, scope, context, or examples. Weaker prompts had 0–1.'},
      {icon:'⏱',color:'green',text:'<strong>Better prompts save real time.</strong> One strong prompt = usable result immediately. One weak prompt = multiple rounds of editing.'},
      {icon:'🔒',color:'red',text:'<strong>Anonymisation is not optional.</strong> Real names, IDs, and salaries in a public AI tool = GDPR and compliance violations.'},
    ],
    takeaway:'Five checks before you submit: objective, audience, context, format, tone. These five transform any prompt from vague to valuable.'
  },
  7:{
    title:'⚡ Ninja Boss — You Know the Moves',
    points:[
      {icon:'⚡',color:'indigo',text:'<strong>You sliced the good ones:</strong> Objective, audience, tone, format, context, examples, limits, and step-by-step reasoning all strengthen prompts.'},
      {icon:'🚫',color:'red',text:'<strong>You dodged the bad ones:</strong> Personal data, vague requests, missing format, harmful intent, and walls of text all weaken prompts and waste time.'},
      {icon:'🏆',color:'green',text:'<strong>Mastery = daily practice.</strong> The more you apply objective → audience → context → format → tone in your work, the faster and more natural it becomes.'},
    ],
    takeaway:'You\'ve now played through all 7 dimensions of AI prompting. Apply the framework every day and watch your AI results transform.'
  },
};

function showExplanation(n) {
  const exp=EXPLANATIONS[n]; if(!exp){return;}
  showScreen('screen-explanation');
  document.getElementById('exp-stage-label').textContent=`ROUND ${n} OF 7 — WHAT YOU LEARNED`;
  document.getElementById('exp-title').textContent=exp.title;
  document.getElementById('exp-points').innerHTML=exp.points.map(p=>`<div class="exp-point exp-${p.color}"><span class="exp-point-icon">${p.icon}</span><span class="exp-point-text">${p.text}</span></div>`).join('');
  document.getElementById('exp-takeaway').textContent=exp.takeaway;
  const nextBtn=document.getElementById('btn-next-stage');
  const waiting=document.getElementById('exp-waiting');
  if(isHost){
    nextBtn.classList.remove('hidden'); nextBtn.disabled=false;
    waiting.classList.add('hidden');
    nextBtn.textContent=n<7?`▶ Play Round ${n+1}`:'🏆 See Final Results';
    nextBtn.onclick=()=>{
      nextBtn.disabled=true; sfxClick();
      update(dbRef('rooms',roomCode),{'game/level':n+1,'game/betweenPhase':'leaderboard'});
      if(n<7) showStageIntro(n+1,()=>startStage(n+1));
      else showFinalResults();
    };
  } else {
    nextBtn.classList.add('hidden'); waiting.classList.remove('hidden');
    clearListeners();
    listenOn(`rooms/${roomCode}/game/level`,snap=>{
      const lv=snap.val();
      if(lv==='results'){clearListeners();showFinalResults();return;}
      if(typeof lv==='number'&&lv>n){clearListeners();showStageIntro(lv,()=>startStage(lv));}
    });
  }
}

// ============================================================
// LEADERBOARD + RESULTS (unchanged)
// ============================================================
function animateCount(el, target) {
  const dur=900,start=performance.now();
  const tick=now=>{const t=Math.min((now-start)/dur,1);const e=1-Math.pow(1-t,3);el.textContent=Math.round(e*target)+' pts';if(t<1)requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
}

function renderLeaderboard(id, playerData) {
  const container=document.getElementById(id); if(!container) return;
  container.innerHTML='';
  const sorted=Object.entries(playerData).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i)=>{
    const row=document.createElement('div'); row.className=`lb-row rank-${i+1}`;
    row.style.animationDelay=`${i*80}ms`;
    const initials=(p.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    row.innerHTML=`<span class="lb-avatar av-${i%10}">${initials}</span><span class="lb-rank">${medals[i]||i+1}</span><span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span><span class="lb-score" data-score="${p.score||0}">0 pts</span>`;
    container.appendChild(row);
    setTimeout(()=>animateCount(row.querySelector('.lb-score'),p.score||0),200+i*80);
  });
}

function showFinalResults() { stopLocalTimer(); stopJazz(); get(dbRef('rooms',roomCode,'players')).then(s=>{players=s.val()||{};renderResults();}); }

function renderResults() {
  const sorted=Object.entries(players).sort((a,b)=>(b[1].score||0)-(a[1].score||0)).map(([uid,p],i)=>({uid,...p,rank:i+1}));
  showScreen('screen-results');
  ['podium','full-leaderboard','results-actions','awards-row'].forEach(id=>{document.getElementById(id).innerHTML='';});
  const champOv=document.getElementById('champion-overlay');
  champOv.classList.add('hidden'); champOv.classList.remove('champion-reveal','champion-building');

  const AWARDS=[
    {icon:'🏆',label:'AI Prompt Master',cond:p=>p.rank===1},
    {icon:'🥇',label:'Prompt Champion',cond:p=>p.rank===1},
    {icon:'⭐',label:'Prompt Expert',cond:p=>p.score>2000},
    {icon:'⚡',label:'Fastest Thinker',cond:p=>p.rank<=3},
    {icon:'🎯',label:'Most Accurate',cond:p=>p.score>1500&&p.rank<=5},
    {icon:'🤝',label:'Best Team Player',cond:p=>p.uid===myUid},
  ];
  const RL={2:'🥈 2nd Place',3:'🥉 3rd Place',4:'4th Place',5:'5th Place'};
  const others=sorted.filter(p=>p.rank!==1).slice(0,4).reverse();
  const winner=sorted.find(p=>p.rank===1);
  const CARD_GAP=4200; let delay=800;

  others.forEach(p=>{
    setTimeout(()=>{
      sfxReveal();
      const card=document.createElement('div'); card.className=`reveal-card rank-${p.rank}`;
      card.innerHTML=`<span class="reveal-rank">${RL[p.rank]||('#'+p.rank)}</span><span class="reveal-name">${p.name}${p.uid===myUid?' (you)':''}</span><span class="reveal-score">${p.score||0} pts</span>`;
      document.getElementById('podium').appendChild(card);
    },delay); delay+=CARD_GAP;
  });

  if(winner){
    const bs=delay;
    setTimeout(()=>{champOv.classList.remove('hidden');champOv.classList.add('champion-building');document.getElementById('champion-who').classList.remove('hidden');sfxDrumroll();},bs);
    setTimeout(()=>spawnConfetti(),bs+2000);
    setTimeout(()=>{spawnConfetti();[0,150,300,450,600].forEach(t=>{setTimeout(()=>{const fl=document.createElement('div');fl.className='champ-flash';document.body.appendChild(fl);setTimeout(()=>fl.remove(),300);},t);});},bs+4000);
    setTimeout(()=>{spawnConfetti();sfxDrumroll();},bs+5500);
    setTimeout(()=>{document.getElementById('champion-who').classList.add('hidden');champOv.classList.remove('champion-building');document.getElementById('champion-name').textContent=winner.name+(winner.uid===myUid?' 🎉':'');document.getElementById('champion-score').textContent=(winner.score||0)+' pts';champOv.classList.add('champion-reveal');sfxChampion();spawnConfetti();setTimeout(spawnConfetti,400);setTimeout(spawnConfetti,800);},bs+7000);
    delay=bs+7000+3000;
  }

  setTimeout(()=>{
    renderLeaderboard('full-leaderboard',players);
    const aw=document.getElementById('awards-row');
    sorted.forEach(p=>AWARDS.forEach(a=>{if(a.cond(p)){const b=document.createElement('div');b.className='award-badge';b.innerHTML=`<span class="aw-icon">${a.icon}</span><span>${p.name}: ${a.label}</span>`;aw.appendChild(b);}}));
    if(isHost){const pb=document.createElement('button');pb.className='btn-arcade-primary';pb.style.marginBottom='10px';pb.textContent='🔁 Play Again';pb.onclick=()=>{sfxClick();resetGame();};document.getElementById('results-actions').appendChild(pb);}
  },delay+800);
}

// ============================================================
// CONFETTI (unchanged)
// ============================================================
function spawnConfetti() {
  const colors=['#4F46E5','#7C3AED','#06B6D4','#10B981','#F59E0B','#EC4899','#EF4444','#818CF8'];
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
  if(isHost&&roomCode){const upd={};Object.keys(players).forEach(uid=>{upd[`players/${uid}/score`]=0;});Object.assign(upd,{'game/level':1,'game/round':0,'game/phase':'intro','game/betweenPhase':'leaderboard','game/roundSeed':Math.floor(Math.random()*100000),'status':'lobby'});await update(dbRef('rooms',roomCode),upd);}
  clearListeners(); stopAllGameLoops();
  Object.keys(players).forEach(uid=>{if(players[uid])players[uid].score=0;});
  openLobby();
}
function resetToMenu() { clearListeners(); stopAllGameLoops(); stopJazz(); players={}; roomCode=''; isHost=false; comboCount=0; showScreen('screen-menu'); }

// ============================================================
// EVENT LISTENERS (unchanged)
// ============================================================
document.getElementById('btn-create').addEventListener('click',()=>{sfxClick();document.getElementById('modal-create').classList.remove('hidden');document.getElementById('input-host-name').focus();});
document.getElementById('btn-create-cancel').addEventListener('click',()=>document.getElementById('modal-create').classList.add('hidden'));
document.getElementById('btn-create-confirm').addEventListener('click',async()=>{
  const name=document.getElementById('input-host-name').value.trim();
  if(!name){showError('create-error','Enter your name.');return;}
  document.getElementById('btn-create-confirm').disabled=true; sfxClick();
  try{await createRoom(name);document.getElementById('modal-create').classList.add('hidden');}
  catch(e){showError('create-error',`Error: ${e?.code||e?.message||'Unknown'}`);console.error(e);}
  document.getElementById('btn-create-confirm').disabled=false;
});
document.getElementById('btn-join-open').addEventListener('click',()=>{sfxClick();document.getElementById('modal-join').classList.remove('hidden');document.getElementById('input-name').focus();});
document.getElementById('btn-join-cancel').addEventListener('click',()=>document.getElementById('modal-join').classList.add('hidden'));
document.getElementById('btn-join-confirm').addEventListener('click',async()=>{
  const name=document.getElementById('input-name').value.trim();
  const code=document.getElementById('input-code').value.trim().toUpperCase();
  if(!name){showError('join-error','Enter your name.');return;}
  if(code.length<4){showError('join-error','Enter the 4-letter room code.');return;}
  document.getElementById('btn-join-confirm').disabled=true; sfxClick();
  const err=await joinRoom(name,code);
  if(err)showError('join-error',err); else document.getElementById('modal-join').classList.add('hidden');
  document.getElementById('btn-join-confirm').disabled=false;
});
document.getElementById('btn-copy-code').addEventListener('click',()=>{navigator.clipboard?.writeText(roomCode).catch(()=>{});showToast('Room code copied!');});
document.getElementById('btn-leave-lobby').addEventListener('click',async()=>{sfxClick();if(roomCode&&myUid){await remove(dbRef('rooms',roomCode,'players',myUid));if(isHost)await remove(dbRef('rooms',roomCode));}resetToMenu();});
document.getElementById('btn-main-menu').addEventListener('click',()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-menu').addEventListener('click',()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-again').addEventListener('click',()=>{sfxClick();resetGame();});
document.getElementById('mute-btn-game').addEventListener('click',toggleMusic);
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){const cm=document.getElementById('modal-create'),jm=document.getElementById('modal-join');if(!cm.classList.contains('hidden'))document.getElementById('btn-create-confirm').click();else if(!jm.classList.contains('hidden'))document.getElementById('btn-join-confirm').click();}
  if(e.key==='Escape'){document.getElementById('modal-create').classList.add('hidden');document.getElementById('modal-join').classList.add('hidden');}
});
document.getElementById('input-code').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
document.addEventListener('click',()=>{if(musicOn&&!jazzInterval)startJazz();},{once:true});

// ============================================================
// BOOT
// ============================================================
async function boot() {
  document.getElementById('loading-msg').textContent='Booting arcade engine…';
  showScreen('screen-loading');
  try {
    await initAuth(); initConnectionMonitor();
    document.getElementById('loading-msg').textContent='Arena ready!';
    await new Promise(r=>setTimeout(r,800));
    showScreen('screen-menu');
  } catch(e) {
    document.getElementById('loading-msg').textContent='Connection failed — check firebase.js';
    console.error('Boot error:',e);
  }
}
boot();
