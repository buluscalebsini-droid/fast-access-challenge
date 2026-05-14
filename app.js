// ============================================================
// app.js — Mind Maze Online — Multiplayer
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
    osc.frequency.setValueAtTime(freq, ctx.currentTime+delay);
    gain.gain.setValueAtTime(vol, ctx.currentTime+delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+delay+dur);
    osc.start(ctx.currentTime+delay);
    osc.stop(ctx.currentTime+delay+dur+0.05);
  } catch(e){}
}
const sfxCorrect  = () => { playTone(880,'sine',0.12,0.25); playTone(1100,'sine',0.12,0.22,0.1); };
const sfxWrong    = () => playTone(200,'sawtooth',0.22,0.25);
const sfxCountdown= () => playTone(440,'square',0.1,0.18);
const sfxGo       = () => [523,659,784].forEach((f,i) => playTone(f,'sine',0.1,0.25,i*0.06));
const sfxTimerWarn= () => playTone(330,'triangle',0.08,0.12);
const sfxLevelUp  = () => [523,659,784,1047].forEach((f,i) => playTone(f,'sine',0.18,0.25,i*0.12));
const sfxClick    = () => playTone(660,'triangle',0.06,0.12);
const sfxCombo    = () => [660,880,1100].forEach((f,i) => playTone(f,'sine',0.08,0.2,i*0.05));

const JAZZ_CHORDS = [[261,330,392,494],[294,370,440,554],[349,440,523,659],[392,494,587,740],[330,415,494,622],[261,330,392,523]];
function playJazzChord() {
  if (!musicOn) return;
  const c = JAZZ_CHORDS[jazzStep % JAZZ_CHORDS.length];
  c.forEach((f,i) => playTone(f/2,'sine',0.5,0.055,i*0.04));
  playTone(c[0]/4,'triangle',0.55,0.09);
  jazzStep++;
}
function startJazz() { stopJazz(); if (!musicOn) return; playJazzChord(); jazzInterval = setInterval(playJazzChord,1400); }
function stopJazz()  { if (jazzInterval) { clearInterval(jazzInterval); jazzInterval = null; } }
function toggleMusic() {
  musicOn = !musicOn;
  document.querySelectorAll('.btn-mute').forEach(b => b.textContent = musicOn?'🎵':'🔇');
  if (musicOn) startJazz(); else stopJazz();
}

// ============================================================
// STATE
// ============================================================
let myUid=null, myName='', roomCode='', isHost=false;
let players={}, gameState={}, activeListeners=[];
let localTimerId=null, localTimerRemaining=0;

// Combo system
let combo=0, comboMultiplier=1;

// Per-level state
let l1Round=0, l1CanClick=false;
let l2Round=0, l2CanClick=false, l2Arena=null, l2RafId=null, l2Objects=[];
let l3Round=0, l3Sequence=[], l3PlayerSeq=[], l3CanInput=false, l3DistractorInterval=null;
let l4Round=0, l4CanClick=false, l4DelayTimer=null;
let l5Round=0, l5CanClick=false, l5DistractorInterval=null;

// ============================================================
// UTILS
// ============================================================
function rand(min,max) { return Math.random()*(max-min)+min; }
function randInt(min,max) { return Math.floor(rand(min,max+1)); }
function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--) { const j=randInt(0,i); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function pick(arr) { return arr[randInt(0,arr.length-1)]; }

const AVATAR_COLORS=['avatar-0','avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9'];
function playerColor(idx) { return AVATAR_COLORS[idx%AVATAR_COLORS.length]; }
function playerInitials(name) { return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?'; }

function showToast(msg,dur=1800) {
  const t=document.getElementById('toast');
  t.classList.remove('hidden'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tid); t._tid=setTimeout(()=>t.classList.remove('show'),dur);
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(id); if(el) el.classList.add('active');
}
function genRoomCode() {
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4},()=>c[randInt(0,c.length-1)]).join('');
}
function setConnected(ok) {
  const el=document.getElementById('conn-indicator'), lbl=document.getElementById('conn-label');
  if(!el) return;
  el.classList.toggle('offline',!ok);
  lbl.textContent=ok?'Connected':'Reconnecting...';
}
function showError(elId,msg) {
  const el=document.getElementById(elId); if(!el) return;
  el.textContent=msg; el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),4000);
}

// ============================================================
// COMBO SYSTEM
// ============================================================
function hitCombo(basePoints) {
  combo++;
  comboMultiplier = Math.min(4, 1+Math.floor(combo/2));
  const pts = Math.round(basePoints*comboMultiplier);
  addMyScore(pts);
  updateComboDisplay();
  showScorePopup(comboMultiplier>1 ? `+${pts} 🔥×${comboMultiplier}` : `+${pts}`);
  if (comboMultiplier>=2) sfxCombo();
  return pts;
}
function missCombo() {
  combo=0; comboMultiplier=1;
  updateComboDisplay();
}
function resetCombo() {
  combo=0; comboMultiplier=1;
  updateComboDisplay();
}
function updateComboDisplay() {
  document.querySelectorAll('.combo-display').forEach(el => {
    if(combo>=2) {
      el.textContent = `🔥 ×${comboMultiplier} COMBO`;
      el.className = 'combo-display active' + (comboMultiplier>=3?' hot':'');
    } else {
      el.textContent=''; el.className='combo-display';
    }
  });
}
function showScorePopup(text) {
  const el=document.createElement('div');
  el.className='score-popup'; el.textContent=text;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),900);
}

// ============================================================
// LEVEL INTRO SYSTEM
// ============================================================
function showLevelIntro(cfg, cb) {
  document.getElementById('intro-badge').textContent  = `Level ${cfg.level}`;
  document.getElementById('intro-emoji').textContent  = cfg.emoji;
  document.getElementById('intro-title').textContent  = cfg.title;
  document.getElementById('intro-inspo').textContent  = cfg.inspiration;
  document.getElementById('intro-howto').innerHTML    = cfg.gameplay;
  document.getElementById('intro-controls').textContent = cfg.controls;
  const btn = document.getElementById('intro-start-btn');
  btn.disabled = false;
  btn.onclick = () => { btn.disabled=true; sfxClick(); doCountdown(cb); };
  showScreen('screen-intro');
}

// ============================================================
// FIREBASE HELPERS
// ============================================================
function dbRef(...parts) { return ref(db,parts.join('/')); }
function listenOn(path,cb) {
  const r=dbRef(path); onValue(r,cb); activeListeners.push(r); return r;
}
function clearListeners() { activeListeners.forEach(r=>off(r)); activeListeners=[]; }
function stopLocalTimer() { if(localTimerId){clearInterval(localTimerId);localTimerId=null;} }
function stopL2Anim()  { if(l2RafId){cancelAnimationFrame(l2RafId);l2RafId=null;} }
function stopL3Distractors() { if(l3DistractorInterval){clearInterval(l3DistractorInterval);l3DistractorInterval=null;} }
function stopL5Distractors() {
  if(l5DistractorInterval){clearInterval(l5DistractorInterval);l5DistractorInterval=null;}
  const bg=document.getElementById('l5-distractor-bg'); if(bg) bg.innerHTML='';
}
function stopL4DelayTimer() { if(l4DelayTimer){clearTimeout(l4DelayTimer);l4DelayTimer=null;} }
function stopAllLevelCleanup() {
  stopLocalTimer(); stopL2Anim(); stopL3Distractors(); stopL5Distractors(); stopL4DelayTimer();
}

// ============================================================
// AUTH
// ============================================================
async function initAuth() {
  document.getElementById('loading-msg').textContent='Authenticating...';
  await signInAnonymously(auth);
  return new Promise(resolve=>{
    const unsub=onAuthStateChanged(auth,user=>{ if(user){myUid=user.uid;unsub();resolve();} });
  });
}
function initConnectionMonitor() {
  onValue(dbRef('.info/connected'),snap=>setConnected(!!snap.val()));
}

// ============================================================
// ROOM CREATION / JOINING
// ============================================================
async function createRoom(hostName) {
  myName=hostName.trim(); isHost=true; roomCode=genRoomCode();
  const roomRef=dbRef('rooms',roomCode);
  if((await get(roomRef)).exists()) roomCode=genRoomCode();
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await set(roomRef,{
    host:myUid, status:'lobby', created:serverTimestamp(),
    players:{[myUid]:{name:myName,score:0,color:0,ready:true}},
    game:{level:0,round:0,roundSeed:0,phase:'waiting'}
  });
  openLobby();
}
async function joinRoom(name,code) {
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
  await update(dbRef('rooms',roomCode,'players'),{
    [myUid]:{name:myName,score:0,color:list.length,ready:true}
  });
  openLobby(); return null;
}

// ============================================================
// LOBBY
// ============================================================
function openLobby() {
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent=roomCode;
  updateHostControls(); listenLobby(); startJazz();
}
function updateHostControls() {
  const btn=document.getElementById('btn-start-game');
  if(isHost){ btn.classList.remove('hidden'); btn.onclick=()=>{sfxClick();hostStartGame();}; }
  else btn.classList.add('hidden');
}
function listenLobby() {
  clearListeners();
  listenOn(`rooms/${roomCode}/players`,snap=>{
    players=snap.val()||{};
    renderLobbyPlayers();
    if(!players[myUid]){showToast('You were removed.');resetToMenu();}
  });
  listenOn(`rooms/${roomCode}/status`,snap=>{
    if(snap.val()==='playing'){clearListeners();startGame();}
  });
  listenOn(`rooms/${roomCode}`,snap=>{
    if(!snap.exists()){showToast('Room closed.');resetToMenu();}
  });
}
function renderLobbyPlayers() {
  const list=document.getElementById('lobby-player-list');
  list.innerHTML='';
  const entries=Object.entries(players);
  entries.forEach(([uid,p],idx)=>{
    const card=document.createElement('div'); card.className='player-card';
    const av=document.createElement('div'); av.className=`player-avatar ${playerColor(p.color??idx)}`; av.textContent=playerInitials(p.name);
    const nm=document.createElement('div'); nm.className='player-name'; nm.textContent=p.name;
    const bg=document.createElement('div'); bg.style.cssText='display:flex;gap:6px';
    get(dbRef('rooms',roomCode,'host')).then(s=>{
      if(s.val()===uid){const h=document.createElement('span');h.className='player-badge';h.textContent='HOST';bg.appendChild(h);}
    });
    if(uid===myUid){const y=document.createElement('span');y.className='player-badge you';y.textContent='YOU';bg.appendChild(y);}
    card.appendChild(av);card.appendChild(nm);card.appendChild(bg);list.appendChild(card);
  });
  const count=entries.length;
  document.getElementById('lobby-status').textContent=
    count===1?'Waiting for more players... (1/40)':`${count}/40 players connected`;
  if(isHost){
    const btn=document.getElementById('btn-start-game');
    btn.disabled=count<1;
    btn.textContent=count<2?'▶ Start Solo':'▶ Start Game';
  }
}
async function hostStartGame() {
  document.getElementById('btn-start-game').disabled=true;
  await update(dbRef('rooms',roomCode),{
    status:'playing','game/level':1,'game/round':0,
    'game/phase':'countdown',
    'game/roundSeed':Math.floor(Math.random()*100000),
    'game/roundStartTime':serverTimestamp()
  });
}

// ============================================================
// GAME START + COUNTDOWN
// ============================================================
function startGame() {
  clearListeners(); resetCombo();
  get(dbRef('rooms',roomCode,'players')).then(s=>{ if(s.exists()) players=s.val(); });
  showLevelIntro({
    level:1, emoji:'📝', title:'Word Chaos',
    inspiration:'Inspired by dyslexia and reading-processing difficulty.',
    gameplay:'Many similar-looking words appear on screen.<br>Only <strong>ONE</strong> is spelled correctly.<br>Find it fast!',
    controls:'Tap / click the correctly spelled word.'
  }, startLevel1);
}

function doCountdown(cb) {
  const overlay=document.getElementById('countdown-overlay');
  const numEl=document.getElementById('countdown-num');
  let count=3;
  overlay.classList.remove('hidden');
  numEl.textContent=count; animateCN(numEl); sfxCountdown();
  const tick=setInterval(()=>{
    count--;
    if(count<=0){
      clearInterval(tick); numEl.textContent='GO!'; sfxGo(); animateCN(numEl);
      setTimeout(()=>{overlay.classList.add('hidden');cb();},700);
    } else { numEl.textContent=count; sfxCountdown(); animateCN(numEl); }
  },900);
}
function animateCN(el){el.style.animation='none';void el.offsetWidth;el.style.animation='popIn 0.5s ease';}

// ============================================================
// LEVEL 1 — WORD CHAOS 📝
// ============================================================
const WORD_POOL=[
  {correct:'receive',    variants:['recieve','receeve','recevie','recive','reciive','receivve','receiev','receeive']},
  {correct:'separate',   variants:['seperate','seperete','separete','saparate','seperatee','saparete','separeate','seperatte']},
  {correct:'necessary',  variants:['neccessary','necessery','nesessary','necesary','neccesary','necessarry','necesery','nessecary']},
  {correct:'calendar',   variants:['calender','calandar','calander','callender','calandir','calenddar','calanderr','callander']},
  {correct:'achieve',    variants:['acheive','acheeve','achiive','achivee','achive','achiev','acheevee','achiieve']},
  {correct:'occurred',   variants:['occured','ocurred','occuried','ocurreed','occureed','occurrred','ocured','occuride']},
  {correct:'definitely', variants:['definately','definitly','definitley','defenitely','definiteley','deffinitely','definitley','definetly']},
  {correct:'beginning',  variants:['begining','begginning','beggining','beginig','beginninng','begginig','begening','beginninng']},
  {correct:'embarrass',  variants:['embarass','embarres','embarras','embarasss','embarress','embarrase','embaresse','embaras']},
  {correct:'conscience', variants:['concience','consience','consicence','conscence','consciense','conssience','consciece','consciance']},
  {correct:'privilege',  variants:['privilage','privelege','privelige','privelage','priviledge','privillege','privlege','privelege']},
  {correct:'immediately',variants:['imediately','immediatley','imediatly','immeditaly','immediatly','imediately','immidiatly','immeditly']},
];

const L1_ROUNDS=7;
const L1_CFG=[
  {time:12,count:10},{time:12,count:10},{time:10,count:12},
  {time:9,count:12},{time:8,count:14},{time:7,count:14},{time:6,count:14}
];

function startLevel1() {
  l1Round=0; resetCombo();
  showScreen('screen-level1'); setupMuteButtons(); syncScoresDisplay('l1-scores');
  nextL1Round();
}
function nextL1Round() {
  stopLocalTimer();
  if(l1Round>=L1_ROUNDS){finishLevel(1);return;}
  const cfg=L1_CFG[l1Round];
  const wordSet=WORD_POOL[l1Round%WORD_POOL.length];
  document.getElementById('l1-round').textContent=`${l1Round+1}/${L1_ROUNDS}`;
  document.getElementById('l1-feedback').textContent='';

  // Build option list: correct + (count-1) variants, shuffled
  const opts=shuffle([wordSet.correct,...shuffle(wordSet.variants).slice(0,cfg.count-1)]);
  const grid=document.getElementById('l1-word-grid');
  grid.innerHTML='';
  opts.forEach(word=>{
    const btn=document.createElement('button');
    btn.className='word-option-btn';
    btn.textContent=word;
    btn.onclick=()=>handleL1Click(btn,word===wordSet.correct,wordSet.correct);
    grid.appendChild(btn);
  });
  l1CanClick=true;
  startTimerLocal('l1-timer','l1-timer-bar',cfg.time,()=>{
    l1CanClick=false;
    missCombo();
    grid.querySelectorAll('button').forEach(b=>{if(b.textContent===wordSet.correct)b.classList.add('correct-reveal');b.disabled=true;});
    document.getElementById('l1-feedback').textContent=`⏱ Time's up! Correct: "${wordSet.correct}"`;
    document.getElementById('l1-feedback').className='level-feedback timeout';
    l1Round++; setTimeout(nextL1Round,1200);
  });
}
function handleL1Click(btn,isCorrect,correctWord) {
  if(!l1CanClick)return;
  l1CanClick=false; stopLocalTimer();
  document.getElementById('l1-word-grid').querySelectorAll('button').forEach(b=>{
    b.disabled=true;
    if(b.textContent===correctWord)b.classList.add('correct-reveal');
  });
  if(isCorrect){
    btn.classList.add('correct-pick'); hitCombo(100); sfxCorrect();
    document.getElementById('l1-feedback').textContent='✅ Correct!';
    document.getElementById('l1-feedback').className='level-feedback correct';
  }else{
    btn.classList.add('wrong-pick'); missCombo(); sfxWrong();
    document.getElementById('l1-feedback').textContent=`❌ Wrong! Correct: "${correctWord}"`;
    document.getElementById('l1-feedback').className='level-feedback wrong';
  }
  l1Round++; setTimeout(nextL1Round,1000);
}

// ============================================================
// LEVEL 2 — FOCUS FRENZY 👀
// ============================================================
const L2_TARGET_EMOJIS=['⭐','💎','🔥','🌙','🎯','🚀','💜','🌊'];
const L2_NOISE_EMOJIS=['🔔','📱','💬','⚠️','🎁','❗','🔄','📢','💥','🌀','🎪','🎲','🎵','🍕','🎮','🐸','🦊','🌈','🍦','🎭'];
const L2_ROUNDS=6;
const L2_CFG=[
  {time:15,total:16,targetCount:3},{time:14,total:18,targetCount:2},
  {time:12,total:20,targetCount:2},{time:11,total:22,targetCount:1},
  {time:9, total:25,targetCount:1},{time:8, total:28,targetCount:1}
];
const FRUIT_SIZE=40;

function startLevel2() {
  l2Round=0; resetCombo();
  showScreen('screen-level2'); setupMuteButtons(); syncScoresDisplay('l2-scores');
  nextL2Round();
}
function nextL2Round() {
  stopLocalTimer(); stopL2Anim(); l2Objects=[];
  if(l2Round>=L2_ROUNDS){finishLevel(2);return;}
  const cfg=L2_CFG[l2Round];
  const target=pick(L2_TARGET_EMOJIS);
  document.getElementById('l2-round').textContent=`${l2Round+1}/${L2_ROUNDS}`;
  document.getElementById('l2-target').textContent=target;
  document.getElementById('l2-feedback').textContent='';

  const arena=document.getElementById('l2-arena');
  arena.innerHTML='';
  const aw=arena.offsetWidth||340, ah=arena.offsetHeight||220;

  // Build list: targetCount targets + rest noise
  const items=[];
  for(let i=0;i<cfg.targetCount;i++) items.push(target);
  while(items.length<cfg.total){
    const e=pick(L2_NOISE_EMOJIS);
    items.push(e);
  }
  shuffle(items);

  items.forEach(emoji=>{
    const el=document.createElement('div');
    el.className='frenzy-item';
    el.textContent=emoji;
    const x=rand(4,aw-FRUIT_SIZE-4), y=rand(4,ah-FRUIT_SIZE-4);
    const speed=rand(30,70), angle=rand(0,Math.PI*2);
    el.style.left=x+'px'; el.style.top=y+'px';
    const obj={el,x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,emoji,hit:false};
    l2Objects.push(obj);
    arena.appendChild(el);
    el.addEventListener('click',()=>handleL2Tap(obj,target,cfg.targetCount));
    el.addEventListener('touchstart',e2=>{e2.preventDefault();handleL2Tap(obj,target,cfg.targetCount);},{passive:false});
  });

  let last=performance.now();
  let hitsNeeded=cfg.targetCount, hitsGot=0;
  document.getElementById('l2-hits').textContent=`0/${hitsNeeded}`;

  function animLoop(now) {
    const dt=Math.min((now-last)/1000,0.05); last=now;
    for(const f of l2Objects){
      if(f.hit)continue;
      f.x+=f.vx*dt; f.y+=f.vy*dt;
      if(f.x<0){f.x=0;f.vx=Math.abs(f.vx);}
      if(f.x>aw-FRUIT_SIZE){f.x=aw-FRUIT_SIZE;f.vx=-Math.abs(f.vx);}
      if(f.y<0){f.y=0;f.vy=Math.abs(f.vy);}
      if(f.y>ah-FRUIT_SIZE){f.y=ah-FRUIT_SIZE;f.vy=-Math.abs(f.vy);}
      f.el.style.left=f.x+'px'; f.el.style.top=f.y+'px';
    }
    l2RafId=requestAnimationFrame(animLoop);
  }
  l2RafId=requestAnimationFrame(animLoop);

  // Store for tap handler
  l2Arena={hitsNeeded, hitsGot:()=>l2Objects.filter(o=>o.hit&&o.emoji===target).length};

  l2CanClick=true;
  startTimerLocal('l2-timer','l2-timer-bar',cfg.time,()=>{
    l2CanClick=false; stopL2Anim(); missCombo();
    const found=l2Objects.filter(o=>o.hit&&o.emoji===target).length;
    document.getElementById('l2-feedback').textContent=`⏱ Time's up! Found ${found}/${hitsNeeded}`;
    document.getElementById('l2-feedback').className='level-feedback timeout';
    l2Round++; setTimeout(nextL2Round,900);
  });
}
function handleL2Tap(obj,target,hitsNeeded) {
  if(!l2CanClick||obj.hit)return;
  if(obj.emoji===target){
    obj.hit=true; obj.el.classList.add('item-popped'); sfxCorrect();
    const found=l2Objects.filter(o=>o.hit&&o.emoji===target).length;
    document.getElementById('l2-hits').textContent=`${found}/${hitsNeeded}`;
    hitCombo(80);
    setTimeout(()=>obj.el.remove(),250);
    if(found>=hitsNeeded){
      l2CanClick=false; stopLocalTimer(); stopL2Anim();
      document.getElementById('l2-feedback').textContent='🎯 All found!';
      document.getElementById('l2-feedback').className='level-feedback correct';
      l2Round++; setTimeout(nextL2Round,700);
    }
  }else{
    obj.el.classList.add('item-wrong');
    setTimeout(()=>obj.el.classList.remove('item-wrong'),300);
    sfxWrong(); missCombo();
    showToast('❌ Wrong target!');
  }
}

// ============================================================
// LEVEL 3 — MEMORY PANIC 🧠
// ============================================================
const L3_EMOJIS=['🍎','⭐','🎲','🍌','🔥','💎','🎯','🌙','🎪','🦋','🚀','🎸','🌈','🐸','🍕'];
const L3_ROUNDS=5;
const L3_CFG=[
  {seqLen:3,showTime:7000,answerTime:10,distractors:0},
  {seqLen:4,showTime:6000,answerTime:10,distractors:2},
  {seqLen:5,showTime:5000,answerTime:10,distractors:3},
  {seqLen:5,showTime:4000,answerTime:10,distractors:4},
  {seqLen:6,showTime:3000,answerTime:10,distractors:5}
];
const L3_FAKE_POPUPS=[
  '🔔 YOU WON A PRIZE!','⚠️ VIRUS DETECTED!','📱 New message!',
  '🎁 Free gift!','❗ Low battery!','🔄 Update now!','📢 URGENT!','💬 Someone is typing...'
];

function startLevel3() {
  l3Round=0; resetCombo();
  showScreen('screen-level3'); setupMuteButtons(); syncScoresDisplay('l3-scores');
  nextL3Round();
}
function nextL3Round() {
  stopLocalTimer(); stopL3Distractors();
  const layer=document.getElementById('l3-distractor-layer'); if(layer) layer.innerHTML='';
  if(l3Round>=L3_ROUNDS){finishLevel(3);return;}
  const cfg=L3_CFG[l3Round];
  document.getElementById('l3-round').textContent=`${l3Round+1}/${L3_ROUNDS}`;
  l3Sequence=[]; l3PlayerSeq=[]; l3CanInput=false;

  for(let i=0;i<cfg.seqLen;i++) l3Sequence.push(pick(L3_EMOJIS));

  const display=document.getElementById('l3-sequence-display');
  const prompt=document.getElementById('l3-prompt');
  const inputArea=document.getElementById('l3-input-area');
  const feedback=document.getElementById('l3-feedback');

  feedback.textContent=''; inputArea.innerHTML='';
  display.innerHTML=l3Sequence.map(e=>`<span class="mem-emoji">${e}</span>`).join('');
  prompt.textContent='Memorise! Recreate it after.';
  display.classList.remove('hidden');

  const bar=document.getElementById('l3-flash-bar');
  bar.style.transition='none'; bar.style.width='100%';
  setTimeout(()=>{bar.style.transition=`width ${cfg.showTime}ms linear`;bar.style.width='0%';},50);

  // Spawn distractors during memorize phase
  if(cfg.distractors>0){
    let n=0;
    const iv=cfg.showTime/(cfg.distractors+1);
    l3DistractorInterval=setInterval(()=>{
      n++;
      const popup=document.createElement('div');
      popup.className='fake-popup';
      popup.textContent=pick(L3_FAKE_POPUPS);
      popup.style.left=randInt(5,60)+'%'; popup.style.top=randInt(10,65)+'%';
      popup.onclick=()=>popup.remove();
      layer.appendChild(popup);
      setTimeout(()=>{if(popup.parentNode)popup.remove();},1800);
      if(n>=cfg.distractors){clearInterval(l3DistractorInterval);l3DistractorInterval=null;}
    },iv);
  }

  setTimeout(()=>{
    stopL3Distractors(); if(layer) layer.innerHTML='';
    display.classList.add('hidden');
    prompt.textContent='Recreate the sequence!';
    bar.style.transition='none'; bar.style.width='0%';
    buildL3Input(); l3CanInput=true;
    startTimerLocal('l3-timer','l3-timer-bar',cfg.answerTime,()=>{
      l3CanInput=false; showL3Result(false);
    });
  },cfg.showTime);
}
function buildL3Input() {
  const inputArea=document.getElementById('l3-input-area');
  const slotArea=document.getElementById('l3-slots');
  inputArea.innerHTML=''; slotArea.innerHTML='';
  const counts={};
  l3Sequence.forEach(e=>{counts[e]=(counts[e]||0)+1;});
  const pool=Object.keys(counts);
  while(pool.length<Math.min(L3_EMOJIS.length,l3Sequence.length+3)){
    const e=pick(L3_EMOJIS); if(!pool.includes(e)) pool.push(e);
  }
  shuffle(pool).forEach(emoji=>{
    const max=counts[emoji]||0; let left=max;
    const btn=document.createElement('button'); btn.className='mem-btn'; btn.textContent=emoji;
    const upd=()=>{
      btn.dataset.uses=left;
      if(max>1)btn.setAttribute('data-count',left>0?`×${left}`:'');
      btn.disabled=left<=0;
    };
    upd();
    btn.onclick=()=>{if(!l3CanInput||left<=0)return;left--;upd();handleL3Pick(emoji);};
    inputArea.appendChild(btn);
  });
  for(let i=0;i<l3Sequence.length;i++){
    const s=document.createElement('div'); s.className='mem-slot'; s.dataset.idx=i;
    slotArea.appendChild(s);
  }
}
function handleL3Pick(emoji) {
  if(!l3CanInput)return;
  const idx=l3PlayerSeq.length; if(idx>=l3Sequence.length)return;
  l3PlayerSeq.push(emoji);
  const slots=document.querySelectorAll('.mem-slot');
  if(slots[idx]){slots[idx].textContent=emoji;slots[idx].classList.add('filled');}
  if(l3PlayerSeq.length===l3Sequence.length){
    l3CanInput=false; stopLocalTimer();
    showL3Result(l3PlayerSeq.every((e,i)=>e===l3Sequence[i]));
  }
}
function showL3Result(correct) {
  const feedback=document.getElementById('l3-feedback');
  const display=document.getElementById('l3-sequence-display');
  display.innerHTML=l3Sequence.map((e,i)=>{
    const pe=l3PlayerSeq[i], ok=pe===e;
    return `<span class="mem-emoji ${correct?'correct':(pe?(ok?'correct':'wrong'):'missing')}">${e}</span>`;
  }).join('');
  display.classList.remove('hidden');
  if(correct){ hitCombo(150); sfxCorrect(); feedback.textContent='✅ Perfect memory!'; feedback.className='level-feedback correct'; }
  else { missCombo(); sfxWrong(); feedback.textContent='❌ Wrong order!'; feedback.className='level-feedback wrong'; }
  l3Round++; setTimeout(nextL3Round,1600);
}

// ============================================================
// LEVEL 4 — REVERSE REALITY 🔀
// ============================================================
const L4_ROUNDS=6;
const L4_CFG=[
  {time:8, reversed:false},{time:8, reversed:false},
  {time:7, reversed:true}, {time:7, reversed:true},
  {time:5, reversed:true}, {time:4, reversed:true}
];

const L4_TASKS=[
  {prompt:'Click the SMALLEST number', values:[3,7,1,9,5],   correct:1,  flipped:9},
  {prompt:'Click the BIGGEST number',  values:[4,8,2,6,10],  correct:10, flipped:2},
  {prompt:'Click the ODD number',      values:[2,4,7,6,8],   correct:7,  flipped:2},
  {prompt:'Click the EVEN number',     values:[3,5,8,1,9],   correct:8,  flipped:3},
  {prompt:'Click the SMALLEST number', values:[11,5,23,3,17],correct:3,  flipped:23},
  {prompt:'Click the BIGGEST number',  values:[6,14,2,19,8], correct:19, flipped:2},
  {prompt:'Click the ODD number',      values:[10,4,6,13,8], correct:13, flipped:10},
  {prompt:'Click the EVEN number',     values:[7,3,12,5,9],  correct:12, flipped:7},
];

function startLevel4() {
  l4Round=0; resetCombo();
  showScreen('screen-level4'); setupMuteButtons(); syncScoresDisplay('l4-scores');
  nextL4Round();
}
function nextL4Round() {
  stopLocalTimer(); stopL4DelayTimer();
  if(l4Round>=L4_ROUNDS){finishLevel(4);return;}
  const cfg=L4_CFG[l4Round];
  const task=L4_TASKS[l4Round%L4_TASKS.length];
  document.getElementById('l4-round').textContent=`${l4Round+1}/${L4_ROUNDS}`;
  document.getElementById('l4-feedback').textContent='';

  const warn=document.getElementById('l4-warn');
  const promptEl=document.getElementById('l4-prompt');
  const container=document.getElementById('l4-options');
  container.innerHTML='';

  const effectiveCorrect=cfg.reversed?task.flipped:task.correct;

  if(cfg.reversed){
    // Flip the instruction text
    const flipped=task.prompt
      .replace('SMALLEST','§BIG§').replace('BIGGEST','§SMALL§').replace('§BIG§','BIGGEST').replace('§SMALL§','SMALLEST')
      .replace('ODD','§E§').replace('EVEN','§O§').replace('§E§','EVEN').replace('§O§','ODD');
    promptEl.innerHTML=`${flipped}`;
    warn.classList.remove('hidden');
    warn.textContent='🔀 REVERSED CONTROLS! Instructions are backwards!';
  }else{
    promptEl.textContent=task.prompt;
    warn.classList.add('hidden');
  }

  let values=[...task.values];
  if(cfg.reversed) values=values.reverse();

  values.forEach(val=>{
    const btn=document.createElement('button');
    btn.className='reverse-option-btn';
    btn.textContent=val;
    btn.onclick=()=>handleL4Click(btn,val,effectiveCorrect);
    container.appendChild(btn);
  });

  l4CanClick=true;
  startTimerLocal('l4-timer','l4-timer-bar',cfg.time,()=>{
    l4CanClick=false;
    container.querySelectorAll('button').forEach(b=>{
      b.disabled=true;
      if(String(b.textContent)===String(effectiveCorrect))b.classList.add('correct-reveal');
    });
    missCombo(); sfxWrong();
    document.getElementById('l4-feedback').textContent=`⏱ Time's up!`;
    document.getElementById('l4-feedback').className='level-feedback timeout';
    l4Round++; setTimeout(nextL4Round,1100);
  });
}
function handleL4Click(btn,val,correct) {
  if(!l4CanClick)return;
  l4CanClick=false; stopLocalTimer();
  document.getElementById('l4-options').querySelectorAll('button').forEach(b=>{
    b.disabled=true;
    if(String(b.textContent)===String(correct))b.classList.add('correct-reveal');
  });
  const isCorrect=String(val)===String(correct);
  if(isCorrect){ btn.classList.add('correct-pick'); hitCombo(100); sfxCorrect(); document.getElementById('l4-feedback').textContent='✅ Correct!'; document.getElementById('l4-feedback').className='level-feedback correct'; }
  else { btn.classList.add('wrong-pick'); missCombo(); sfxWrong(); document.getElementById('l4-feedback').textContent='❌ Wrong!'; document.getElementById('l4-feedback').className='level-feedback wrong'; }
  l4Round++; setTimeout(nextL4Round,900);
}

// ============================================================
// LEVEL 5 — MIND MAZE EXTREME ⚠️
// ============================================================
const L5_EVENTS=8;
const L5_EVENT_TIME=6;
const L5_DISTRACTOR_EMOJIS=['🔔','📱','💬','⚠️','🎁','❗','🔄','📢','💥','🌀','🎪','🎲','🎵','🍕','🎮'];

function startLevel5() {
  l5Round=0; resetCombo();
  showScreen('screen-level5'); setupMuteButtons(); syncScoresDisplay('l5-scores');
  startL5DistractorBg();
  nextL5Event();
}

function startL5DistractorBg() {
  stopL5Distractors();
  const bg=document.getElementById('l5-distractor-bg'); bg.innerHTML='';
  for(let i=0;i<20;i++){
    const el=document.createElement('div'); el.className='chaos-distractor';
    el.textContent=pick(L5_DISTRACTOR_EMOJIS);
    const x=randInt(0,88), y=randInt(0,88), dur=rand(2,5).toFixed(1), delay=rand(0,3).toFixed(1);
    el.style.cssText=`left:${x}%;top:${y}%;animation:chaosFloat ${dur}s ${delay}s ease-in-out infinite alternate;`;
    bg.appendChild(el);
  }
}

function nextL5Event() {
  stopLocalTimer();
  if(l5Round>=L5_EVENTS){finishLevel(5);return;}
  document.getElementById('l5-round').textContent=`${l5Round+1}/${L5_EVENTS}`;
  document.getElementById('l5-feedback').textContent='';

  // Cycle through event types
  const type=l5Round%4;
  if(type===0) buildL5WordEvent();
  else if(type===1) buildL5FindEvent();
  else if(type===2) buildL5MemoryEvent();
  else buildL5ReverseEvent();
}

function l5Resolve(correct) {
  if(!l5CanClick)return;
  l5CanClick=false; stopLocalTimer();
  const fb=document.getElementById('l5-feedback');
  if(correct){ hitCombo(120); sfxCorrect(); fb.textContent='✅ +pts!'; fb.className='level-feedback correct'; }
  else { missCombo(); sfxWrong(); fb.textContent='❌ Wrong!'; fb.className='level-feedback wrong'; }
  document.getElementById('l5-arena').querySelectorAll('button').forEach(b=>b.disabled=true);
  l5Round++; setTimeout(nextL5Event,700);
}

function buildL5WordEvent() {
  const wordSet=pick(WORD_POOL);
  const opts=shuffle([wordSet.correct,...shuffle(wordSet.variants).slice(0,5)]);
  const arena=document.getElementById('l5-arena');
  arena.innerHTML='';
  document.getElementById('l5-prompt').textContent='✍️ Find the correct spelling!';
  opts.forEach(w=>{
    const btn=document.createElement('button'); btn.className='l5-word-btn';
    btn.textContent=w;
    btn.onclick=()=>l5Resolve(w===wordSet.correct);
    arena.appendChild(btn);
  });
  l5CanClick=true;
  startTimerLocal('l5-timer','l5-timer-bar',L5_EVENT_TIME,()=>{ if(l5CanClick){l5CanClick=false;missCombo();l5Round++;document.getElementById('l5-feedback').textContent='⏱ Too slow!';document.getElementById('l5-feedback').className='level-feedback timeout';document.getElementById('l5-arena').querySelectorAll('button').forEach(b=>b.disabled=true);setTimeout(nextL5Event,700);} });
}
function buildL5FindEvent() {
  const target=pick(L2_TARGET_EMOJIS);
  const opts=shuffle([target,...shuffle(L2_NOISE_EMOJIS).slice(0,7)]);
  const arena=document.getElementById('l5-arena');
  arena.innerHTML='';
  document.getElementById('l5-prompt').textContent=`👀 Find: ${target}`;
  opts.forEach(e=>{
    const btn=document.createElement('button'); btn.className='l5-emoji-btn';
    btn.textContent=e;
    btn.onclick=()=>l5Resolve(e===target);
    arena.appendChild(btn);
  });
  l5CanClick=true;
  startTimerLocal('l5-timer','l5-timer-bar',L5_EVENT_TIME,()=>{ if(l5CanClick){l5CanClick=false;missCombo();l5Round++;document.getElementById('l5-feedback').textContent='⏱ Too slow!';document.getElementById('l5-feedback').className='level-feedback timeout';document.getElementById('l5-arena').querySelectorAll('button').forEach(b=>b.disabled=true);setTimeout(nextL5Event,700);} });
}
function buildL5MemoryEvent() {
  const seq=[pick(L3_EMOJIS),pick(L3_EMOJIS),pick(L3_EMOJIS)];
  const arena=document.getElementById('l5-arena');
  arena.innerHTML='';
  document.getElementById('l5-prompt').textContent='🧠 Memorise & Tap in order!';
  // Show sequence briefly
  const seqDisplay=document.createElement('div'); seqDisplay.className='l5-seq-display';
  seqDisplay.textContent=seq.join(' ');
  arena.appendChild(seqDisplay);
  l5CanClick=false;
  setTimeout(()=>{
    seqDisplay.textContent='???';
    // Build tap buttons
    const pool=shuffle([...new Set([...seq,...shuffle(L3_EMOJIS).slice(0,3)])]);
    const picked=[];
    pool.forEach(e=>{
      const btn=document.createElement('button'); btn.className='l5-emoji-btn';
      btn.textContent=e;
      btn.onclick=()=>{
        if(!l5CanClick)return;
        picked.push(e);
        btn.classList.add('picked');
        btn.disabled=true;
        if(picked.length===seq.length){
          l5Resolve(picked.every((v,i)=>v===seq[i]));
        }
      };
      arena.appendChild(btn);
    });
    l5CanClick=true;
    startTimerLocal('l5-timer','l5-timer-bar',7,()=>{ if(l5CanClick){l5CanClick=false;missCombo();l5Round++;document.getElementById('l5-feedback').textContent='⏱ Too slow!';document.getElementById('l5-feedback').className='level-feedback timeout';document.getElementById('l5-arena').querySelectorAll('button').forEach(b=>b.disabled=true);setTimeout(nextL5Event,700);} });
  },2500);
  startTimerLocal('l5-timer','l5-timer-bar',9,()=>{});// placeholder replaced above
}
function buildL5ReverseEvent() {
  const task=L4_TASKS[randInt(0,L4_TASKS.length-1)];
  const arena=document.getElementById('l5-arena');
  arena.innerHTML='';
  // always reversed in L5
  const flipped=task.prompt
    .replace('SMALLEST','§B§').replace('BIGGEST','§S§').replace('§B§','BIGGEST').replace('§S§','SMALLEST')
    .replace('ODD','§E§').replace('EVEN','§O§').replace('§E§','EVEN').replace('§O§','ODD');
  document.getElementById('l5-prompt').innerHTML=`🔀 ${flipped} <span style="color:var(--accent);font-size:12px">(reversed!)</span>`;
  const values=shuffle([...task.values]);
  values.forEach(val=>{
    const btn=document.createElement('button'); btn.className='reverse-option-btn';
    btn.textContent=val;
    btn.onclick=()=>l5Resolve(String(val)===String(task.flipped));
    arena.appendChild(btn);
  });
  l5CanClick=true;
  startTimerLocal('l5-timer','l5-timer-bar',5,()=>{ if(l5CanClick){l5CanClick=false;missCombo();l5Round++;document.getElementById('l5-feedback').textContent='⏱ Too slow!';document.getElementById('l5-feedback').className='level-feedback timeout';document.getElementById('l5-arena').querySelectorAll('button').forEach(b=>b.disabled=true);setTimeout(nextL5Event,700);} });
}

// ============================================================
// SCORE SYNC
// ============================================================
function addMyScore(pts) {
  if(!myUid||!roomCode)return;
  if(!players[myUid])players[myUid]={score:0};
  players[myUid].score=(players[myUid].score||0)+pts;
  updateAllScoreDisplays();
  get(dbRef('rooms',roomCode,'players',myUid,'score')).then(s=>{
    const cur=s.val()||0;
    update(dbRef('rooms',roomCode,'players',myUid),{score:cur+pts});
  });
}
function syncScoresDisplay(containerId) {
  const cont=document.getElementById(containerId); if(!cont)return;
  listenOn(`rooms/${roomCode}/players`,snap=>{players=snap.val()||{};renderScoreChips(cont);});
}
function updateAllScoreDisplays() {
  ['l1-scores','l2-scores','l3-scores','l4-scores','l5-scores'].forEach(id=>{
    const cont=document.getElementById(id);
    if(cont&&cont.childElementCount>0)renderScoreChips(cont);
  });
}
function renderScoreChips(container) {
  const sorted=Object.entries(players).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  container.innerHTML='';
  sorted.forEach(([uid,p],idx)=>{
    const chip=document.createElement('div');
    chip.className='score-chip'+(idx===0?' leader':'');
    chip.innerHTML=`<span class="chip-name">${p.name}</span><span class="chip-score">${p.score||0}</span>`;
    container.appendChild(chip);
  });
}
function listenGameSync(cb) {
  listenOn(`rooms/${roomCode}/game`,snap=>{if(!snap.exists())return;gameState=snap.val();cb(gameState);});
}

// ============================================================
// BETWEEN LEVELS / LEADERBOARD
// ============================================================
function finishLevel(levelNum) {
  stopAllLevelCleanup(); sfxLevelUp(); resetCombo();
  get(dbRef('rooms',roomCode,'players')).then(snap=>{
    players=snap.val()||{};
    showBetweenScreen(levelNum);
  });
}

function showBetweenScreen(levelNum) {
  const nextLevel=levelNum+1;
  document.getElementById('between-title').textContent=levelNum<5?`Level ${levelNum} Complete! 🎉`:'All Levels Done! 🏆';
  document.getElementById('between-sub').textContent=`Leaderboard after Level ${levelNum}`;
  renderLeaderboard('leaderboard-between',players);
  showScreen('screen-between');

  const nextBtn=document.getElementById('btn-next-level');
  const cd=document.getElementById('between-countdown');

  const INTROS=[null,
    {level:2,emoji:'👀',title:'Focus Frenzy',
     inspiration:'Inspired by ADHD and sensory overload.',
     gameplay:'Find the <strong>target emoji</strong> bouncing in a chaotic screen.<br>Tap every one you see!',
     controls:'Tap / click the correct moving target.'},
    {level:3,emoji:'🧠',title:'Memory Panic',
     inspiration:'Inspired by working memory difficulty and cognitive overload.',
     gameplay:'A sequence flashes briefly — then disappears.<br>Recreate it in order while <strong>distractions try to break your focus</strong>.',
     controls:'Tap emoji buttons in the correct sequence order.'},
    {level:4,emoji:'🔀',title:'Reverse Reality',
     inspiration:'Inspired by dyspraxia and coordination difficulty.',
     gameplay:'Simple tasks appear — but in some rounds <strong>everything is reversed</strong>.<br>A warning tells you when controls flip.',
     controls:'Click the correct answer — but check for the reversal warning!'},
    {level:5,emoji:'⚠️',title:'Mind Maze Extreme',
     inspiration:'Inspired by cognitive overload, multitasking pressure, and internet chaos.',
     gameplay:'All levels smashed together in rapid chaos.<br>Spelling, finding, memory, and reversals — one after another while the screen goes insane.',
     controls:'React fast. Combo multipliers reward streaks!'},
  ];

  if(isHost){
    nextBtn.classList.remove('hidden');
    nextBtn.disabled=false;
    nextBtn.textContent=nextLevel<=5?'Next Level →':'See Results →';
    nextBtn.onclick=()=>{
      nextBtn.disabled=true; sfxClick();
      const nextLvl=levelNum<5?levelNum+1:'results';
      update(dbRef('rooms',roomCode),{'game/level':nextLvl});
      const intro=INTROS[levelNum];
      if(intro){
        showLevelIntro(intro,()=>{
          if(levelNum===1)startLevel2();
          else if(levelNum===2)startLevel3();
          else if(levelNum===3)startLevel4();
          else if(levelNum===4)startLevel5();
          else showFinalResults();
        });
      } else {
        doCountdown(showFinalResults);
      }
    };
    cd.textContent='';
  }else{
    nextBtn.classList.add('hidden');
    cd.textContent='Waiting for host to continue...';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/level`,snap=>{
      const lvl=snap.val();
      if(lvl==='results'){clearListeners();showFinalResults();return;}
      if(lvl>levelNum){
        clearListeners();
        // Non-host skips the intro and goes straight in after countdown
        doCountdown(()=>{
          if(lvl===2)startLevel2();
          else if(lvl===3)startLevel3();
          else if(lvl===4)startLevel4();
          else if(lvl===5)startLevel5();
        });
      }
    });
  }
}

// ============================================================
// FINAL RESULTS
// ============================================================
function showFinalResults() {
  stopAllLevelCleanup(); stopJazz();
  get(dbRef('rooms',roomCode,'players')).then(snap=>{players=snap.val()||{};renderResults();});
}
function renderResults() {
  const sorted=Object.entries(players)
    .sort((a,b)=>(b[1].score||0)-(a[1].score||0))
    .map(([uid,p],i)=>({uid,...p,rank:i+1}));

  const podium=document.getElementById('podium'); podium.innerHTML='';
  const po=sorted.length>=2?[sorted[1],sorted[0],sorted[2],sorted[3],sorted[4]].filter(Boolean):sorted;
  const medals=['🥈','🥇','🥉','4️⃣','5️⃣'];
  const heights=['70px','90px','55px','45px','40px'];
  po.forEach((p,i)=>{
    const realRank=sorted.findIndex(s=>s.uid===p.uid)+1;
    const block=document.createElement('div'); block.className=`podium-block rank-${realRank}`;
    block.innerHTML=`<div class="podium-name">${p.name}${p.uid===myUid?' (you)':''}</div>
      <div class="podium-score">${p.score||0} pts</div>
      <div class="podium-platform" style="min-height:${heights[i]}">
        <div class="podium-medal">${medals[i]}</div><div class="podium-pos">#${realRank}</div></div>`;
    podium.appendChild(block);
  });
  renderLeaderboard('full-leaderboard',players,true);
  const paBtn=document.getElementById('btn-play-again');
  if(isHost){paBtn.classList.remove('hidden');paBtn.onclick=()=>{sfxClick();resetGame();};}
  else paBtn.classList.add('hidden');
  showScreen('screen-results');
  if(sorted[0]?.uid===myUid) spawnConfetti();
}
function renderLeaderboard(containerId,playerData) {
  const container=document.getElementById(containerId); container.innerHTML='';
  const sorted=Object.entries(playerData).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i)=>{
    const row=document.createElement('div'); row.className=`lb-row rank-${i+1}`;
    row.innerHTML=`<span class="lb-rank">${medals[i]||i+1}</span>
      <span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span>
      <span class="lb-score">${p.score||0}</span>`;
    container.appendChild(row);
  });
}

// ============================================================
// TIMER
// ============================================================
function startTimerLocal(timerId,barId,seconds,onEnd) {
  stopLocalTimer();
  let remaining=seconds;
  const timerEl=document.getElementById(timerId), barEl=document.getElementById(barId);
  if(timerEl){timerEl.textContent=remaining;timerEl.classList.remove('warn');}
  if(barEl){barEl.style.width='100%';barEl.classList.remove('warn');}
  localTimerId=setInterval(()=>{
    remaining--;
    if(timerEl){timerEl.textContent=remaining;if(remaining<=3){timerEl.classList.add('warn');sfxTimerWarn();}}
    if(barEl){barEl.style.width=Math.max(0,(remaining/seconds)*100)+'%';if(remaining<=3)barEl.classList.add('warn');}
    if(remaining<=0){stopLocalTimer();onEnd();}
  },1000);
  localTimerRemaining=seconds;
}

// ============================================================
// MUTE + CONFETTI
// ============================================================
function setupMuteButtons() {
  document.querySelectorAll('.btn-mute').forEach(btn=>{btn.textContent=musicOn?'🎵':'🔇';btn.onclick=toggleMusic;});
}
function spawnConfetti() {
  const colors=['#e94560','#4f8ef7','#4ade80','#fbbf24','#c084fc'];
  for(let i=0;i<60;i++){
    setTimeout(()=>{
      const el=document.createElement('div'); el.className='confetti';
      el.style.cssText=`left:${rand(10,90)}vw;top:-10px;width:${rand(6,12)}px;height:${rand(6,12)}px;background:${pick(colors)};border-radius:${Math.random()>.5?'50%':'2px'};animation:confettiFall ${rand(1.5,3)}s linear forwards;`;
      document.body.appendChild(el); setTimeout(()=>el.remove(),3200);
    },i*40);
  }
  if(!document.getElementById('confetti-style')){
    const s=document.createElement('style'); s.id='confetti-style';
    s.textContent='@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(720deg);opacity:0}}';
    document.head.appendChild(s);
  }
}

// ============================================================
// RESET / NAVIGATION
// ============================================================
async function resetGame() {
  if(isHost&&roomCode){
    const updates={};
    Object.keys(players).forEach(uid=>{updates[`players/${uid}/score`]=0;});
    Object.assign(updates,{'game/level':1,'game/round':0,'game/phase':'countdown','game/roundSeed':Math.floor(Math.random()*100000),'status':'lobby'});
    await update(dbRef('rooms',roomCode),updates);
  }
  stopAllLevelCleanup(); stopJazz(); resetCombo();
  Object.keys(players).forEach(uid=>{if(players[uid])players[uid].score=0;});
  clearListeners(); openLobby();
}
function resetToMenu() {
  stopAllLevelCleanup(); stopJazz(); resetCombo();
  clearListeners(); players={}; roomCode=''; isHost=false;
  showScreen('screen-menu');
}

// ============================================================
// BUTTONS
// ============================================================
document.getElementById('btn-create').addEventListener('click',()=>{sfxClick();document.getElementById('modal-create').classList.remove('hidden');document.getElementById('input-host-name').focus();});
document.getElementById('btn-create-cancel').addEventListener('click',()=>document.getElementById('modal-create').classList.add('hidden'));
document.getElementById('btn-create-confirm').addEventListener('click',async()=>{
  const name=document.getElementById('input-host-name').value.trim();
  if(!name){showError('create-error','Please enter your name.');return;}
  document.getElementById('btn-create-confirm').disabled=true; sfxClick();
  try{await createRoom(name);document.getElementById('modal-create').classList.add('hidden');}
  catch(e){showError('create-error','Failed to create room. Check Firebase config.');console.error(e);}
  document.getElementById('btn-create-confirm').disabled=false;
});
document.getElementById('btn-join-open').addEventListener('click',()=>{sfxClick();document.getElementById('modal-join').classList.remove('hidden');document.getElementById('input-name').focus();});
document.getElementById('btn-join-cancel').addEventListener('click',()=>document.getElementById('modal-join').classList.add('hidden'));
document.getElementById('btn-join-confirm').addEventListener('click',async()=>{
  const name=document.getElementById('input-name').value.trim();
  const code=document.getElementById('input-code').value.trim().toUpperCase();
  if(!name){showError('join-error','Enter your name.');return;}
  if(code.length<4){showError('join-error','Enter the 4-character room code.');return;}
  document.getElementById('btn-join-confirm').disabled=true; sfxClick();
  const err=await joinRoom(name,code);
  if(err)showError('join-error',err); else document.getElementById('modal-join').classList.add('hidden');
  document.getElementById('btn-join-confirm').disabled=false;
});
document.getElementById('btn-copy-code').addEventListener('click',()=>{navigator.clipboard?.writeText(roomCode).catch(()=>{});showToast('Room code copied!');});
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
// BOOT
// ============================================================
async function boot() {
  document.getElementById('loading-msg').textContent='Connecting...';
  showScreen('screen-loading');
  try{
    await initAuth(); initConnectionMonitor();
    document.getElementById('loading-msg').textContent='Ready!';
    await new Promise(r=>setTimeout(r,600));
    showScreen('screen-menu');
  }catch(e){
    document.getElementById('loading-msg').textContent='Firebase connection failed. Check your config in firebase.js';
    console.error('Boot error:',e);
  }
}
boot();
