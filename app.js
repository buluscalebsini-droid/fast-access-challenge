// ============================================================
// app.js — Arcade Blitz
// Infrastructure: 100% preserved from original
// Games: 7 pure arcade mini-games
// ============================================================
import {
  db, auth, ref, set, get, update, onValue, onDisconnect,
  serverTimestamp, off, remove, push, child,
  signInAnonymously, onAuthStateChanged
} from './firebase.js';

// ============================================================
// PARTICLE BACKGROUND
// ============================================================
(function initParticles() {
  const cv = document.getElementById('particle-canvas');
  if (!cv) return;
  const cx = cv.getContext('2d');
  const P = [];
  function resize() { cv.width = innerWidth; cv.height = innerHeight; }
  resize(); window.addEventListener('resize', resize);
  const COLS = ['#ff4757','#ffa502','#2ed573','#1e90ff','#a855f7','#ec4899'];
  for (let i = 0; i < 35; i++)
    P.push({ x: rand(0,innerWidth), y: rand(0,innerHeight), r: rand(1,2.5), dx: (Math.random()-.5)*.5, dy: (Math.random()-.5)*.5, c: COLS[i%COLS.length], a: rand(.04,.18) });
  function draw() {
    cx.clearRect(0,0,cv.width,cv.height);
    P.forEach(p => {
      cx.beginPath(); cx.arc(p.x,p.y,p.r,0,Math.PI*2);
      cx.fillStyle=p.c; cx.globalAlpha=p.a; cx.fill();
      p.x+=p.dx; p.y+=p.dy;
      if(p.x<0||p.x>cv.width) p.dx*=-1;
      if(p.y<0||p.y>cv.height) p.dy*=-1;
    });
    cx.globalAlpha=1; requestAnimationFrame(draw);
  }
  draw();
})();

// ============================================================
// AUDIO ENGINE  (identical to original)
// ============================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx=null, jazzInterval=null, musicOn=true, jazzStep=0;
function getACtx(){if(!actx)actx=new AudioCtx();if(actx.state==='suspended')actx.resume();return actx;}
function playTone(freq,type='sine',dur=0.18,vol=0.15,delay=0){
  if(!musicOn)return;
  try{const ctx=getACtx(),osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.connect(gain);gain.connect(ctx.destination);osc.type=type;
  osc.frequency.setValueAtTime(freq,ctx.currentTime+delay);
  gain.gain.setValueAtTime(vol,ctx.currentTime+delay);
  gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+delay+dur);
  osc.start(ctx.currentTime+delay);osc.stop(ctx.currentTime+delay+dur+.05);}catch(e){}
}
const sfxCorrect = ()=>{playTone(880,'sine',.1,.25);playTone(1100,'sine',.1,.22,.09);};
const sfxWrong   = ()=>playTone(180,'sawtooth',.2,.28);
const sfxCountdown=()=>playTone(440,'square',.1,.18);
const sfxGo      = ()=>[523,659,784].forEach((f,i)=>playTone(f,'sine',.1,.25,i*.06));
const sfxTimerWarn=()=>playTone(330,'triangle',.07,.12);
const sfxLevelUp = ()=>[523,659,784,1047].forEach((f,i)=>playTone(f,'sine',.18,.25,i*.12));
const sfxClick   = ()=>playTone(660,'triangle',.05,.12);
const sfxReveal  = ()=>{playTone(440,'sine',.1,.22);playTone(660,'sine',.14,.28,.1);};
const sfxDrumroll= ()=>[0,.1,.19,.27,.34,.4,.45,.49,.52,.545,.565,.58].forEach(t=>playTone(rand(180,230),'sawtooth',.045,.2,t));
const sfxChampion= ()=>{[523,659,784,880,1047].forEach((f,i)=>playTone(f,'sine',.35,.32,i*.13));setTimeout(()=>[784,880,1047,1319].forEach((f,i)=>playTone(f,'sine',.4,.35,i*.09)),900);};
const sfxBonus   = ()=>[784,880,1047,1319,1568].forEach((f,i)=>playTone(f,'sine',.2,.28,i*.08));
const sfxPop     = ()=>{playTone(900,'sine',.06,.3);playTone(700,'sine',.06,.2,.04);};
const sfxSlice   = ()=>{playTone(1200,'sawtooth',.05,.25);playTone(800,'sawtooth',.05,.2,.03);};
const sfxWhack   = ()=>{playTone(300,'square',.06,.3);playTone(200,'sawtooth',.08,.25,.04);};
const JAZZ=[[261,330,392,494],[294,370,440,554],[349,440,523,659],[392,494,587,740],[330,415,494,622]];
function playJazz(){if(!musicOn)return;const c=JAZZ[jazzStep%JAZZ.length];c.forEach((f,i)=>playTone(f/2,'sine',.5,.04,i*.04));playTone(c[0]/4,'triangle',.55,.07);jazzStep++;}
function startJazz(){stopJazz();if(!musicOn)return;playJazz();jazzInterval=setInterval(playJazz,1600);}
function stopJazz(){if(jazzInterval){clearInterval(jazzInterval);jazzInterval=null;}}
function toggleMusic(){musicOn=!musicOn;document.querySelectorAll('.btn-mute,.btn-mute-sm').forEach(b=>b.textContent=musicOn?'🔊':'🔇');if(musicOn)startJazz();else stopJazz();}

// ============================================================
// STATE  (identical structure to original)
// ============================================================
let myUid=null,myName='',roomCode='',isHost=false;
let players={},gameState={},activeListeners=[];
let localTimerId=null;
let currentStage=1, stageScoreLocal=0, comboCount=0;

// Per-game timers/intervals
let gameIntervals=[], gameRafs=[];
// Named RAF ids for canvas games — declared here so clearGameLoops can reach them
let fruitRafId=null, bubbleRafId=null, dodgeRafId=null;
function clearGameLoops(){
  gameIntervals.forEach(clearInterval); gameIntervals=[];
  gameRafs.forEach(cancelAnimationFrame); gameRafs=[];
  // Cancel per-game named RAF ids (idempotent)
  if(fruitRafId){cancelAnimationFrame(fruitRafId);fruitRafId=null;}
  if(bubbleRafId){cancelAnimationFrame(bubbleRafId);bubbleRafId=null;}
  if(dodgeRafId){cancelAnimationFrame(dodgeRafId);dodgeRafId=null;}
}

// ============================================================
// UTILS  (identical to original)
// ============================================================
function rand(a,b){return Math.random()*(b-a)+a;}
function randInt(a,b){return Math.floor(rand(a,b+1));}
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=randInt(0,i);[b[i],b[j]]=[b[j],b[i]];}return b;}
function pick(a){return a[randInt(0,a.length-1)];}
const AV_COLS=['avatar-0','avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6','avatar-7','avatar-8','avatar-9'];
function playerColor(i){return AV_COLS[i%AV_COLS.length];}
function playerInitials(n){return n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'?';}
function showToast(msg,dur=2200){const t=document.getElementById('toast');t.classList.remove('hidden');t.textContent=msg;t.classList.add('show');clearTimeout(t._tid);t._tid=setTimeout(()=>t.classList.remove('show'),dur);}
function showScreen(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));const el=document.getElementById(id);if(el)el.classList.add('active');}
function genRoomCode(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from({length:4},()=>c[randInt(0,c.length-1)]).join('');}
function setConnected(ok){const el=document.getElementById('conn-indicator'),lb=document.getElementById('conn-label');if(!el)return;el.classList.toggle('offline',!ok);lb.textContent=ok?'● Live':'● Reconnecting…';}
function showError(id,msg){const el=document.getElementById(id);if(!el)return;el.textContent=msg;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4000);}
function showCombo(n){
  const b=document.getElementById('combo-banner'),t=document.getElementById('combo-text');if(!b||!t)return;
  t.textContent=n>=6?`🔥 ${n}× MEGA!!`:n>=4?`⚡ ${n}× GREAT!`:`✨ ${n}× COMBO!`;
  b.classList.remove('hidden');b.style.animation='none';void b.offsetWidth;b.style.animation='comboPop 0.4s cubic-bezier(0.34,1.56,0.64,1)';
  clearTimeout(b._tid);b._tid=setTimeout(()=>b.classList.add('hidden'),1200);
}
function updateHudScore(){const c=document.getElementById('my-score-chip');if(c&&players[myUid])c.textContent=(players[myUid].score||0).toLocaleString()+' pts';}

// ============================================================
// FIREBASE HELPERS  (identical to original)
// ============================================================
function dbRef(...p){return ref(db,p.join('/'));}
function listenOn(path,cb){const r=dbRef(path);onValue(r,cb);activeListeners.push(r);return r;}
function clearListeners(){activeListeners.forEach(r=>off(r));activeListeners=[];}
function stopLocalTimer(){if(localTimerId){clearInterval(localTimerId);localTimerId=null;}}

// ============================================================
// AUTH  (identical)
// ============================================================
async function initAuth(){
  document.getElementById('loading-msg').textContent='Authenticating…';
  await signInAnonymously(auth);
  return new Promise(r=>{const u=onAuthStateChanged(auth,user=>{if(user){myUid=user.uid;u();r();}});});
}
function initConnectionMonitor(){onValue(dbRef('.info/connected'),s=>setConnected(!!s.val()));}

// ============================================================
// ROOM  (identical)
// ============================================================
async function createRoom(hostName){
  myName=hostName.trim();isHost=true;roomCode=genRoomCode();
  const rr=dbRef('rooms',roomCode);
  if((await get(rr)).exists())roomCode=genRoomCode();
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await set(rr,{host:myUid,status:'lobby',created:serverTimestamp(),players:{[myUid]:{name:myName,score:0,color:0,ready:true}},game:{level:0,round:0,roundSeed:0,phase:'waiting',betweenPhase:'leaderboard'}});
  openLobby();
}
async function joinRoom(name,code){
  myName=name.trim();const upper=code.trim().toUpperCase();
  const snap=await get(dbRef('rooms',upper));
  if(!snap.exists())return 'Room not found.';
  const data=snap.val();
  if(data.status!=='lobby')return 'Game already started.';
  const ex=data.players||{};const list=Object.keys(ex);
  if(list.length>=40)return 'Room is full (max 40).';
  roomCode=upper;isHost=data.host===myUid;
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await update(dbRef('rooms',roomCode,'players'),{[myUid]:{name:myName,score:0,color:list.length,ready:true}});
  openLobby();return null;
}

// ============================================================
// LOBBY  (identical)
// ============================================================
function openLobby(){showScreen('screen-lobby');document.getElementById('lobby-room-code').textContent=roomCode;updateHostControls();listenLobby();startJazz();}
function updateHostControls(){const btn=document.getElementById('btn-start-game');if(isHost){btn.classList.remove('hidden');btn.onclick=()=>{sfxClick();hostStartGame();};}else btn.classList.add('hidden');}
function listenLobby(){
  clearListeners();
  listenOn(`rooms/${roomCode}/players`,s=>{players=s.val()||{};renderLobbyPlayers();if(!players[myUid]){showToast('Removed from room.');resetToMenu();}});
  listenOn(`rooms/${roomCode}/status`,s=>{if(s.val()==='playing'){clearListeners();startGame();}});
  listenOn(`rooms/${roomCode}`,s=>{if(!s.exists()){showToast('Room closed.');resetToMenu();}});
}
function renderLobbyPlayers(){
  const list=document.getElementById('lobby-player-list');list.innerHTML='';
  const ent=Object.entries(players);
  ent.forEach(([uid,p],idx)=>{
    const card=document.createElement('div');card.className='player-card';
    const av=document.createElement('div');av.className=`player-avatar ${playerColor(p.color??idx)}`;av.textContent=playerInitials(p.name);
    const nm=document.createElement('div');nm.className='player-name';nm.textContent=p.name;
    const bg=document.createElement('div');bg.style.cssText='display:flex;gap:5px';
    get(dbRef('rooms',roomCode,'host')).then(s=>{if(s.val()===uid){const h=document.createElement('span');h.className='player-badge';h.textContent='HOST';bg.appendChild(h);}});
    if(uid===myUid){const y=document.createElement('span');y.className='player-badge you';y.textContent='YOU';bg.appendChild(y);}
    card.appendChild(av);card.appendChild(nm);card.appendChild(bg);list.appendChild(card);
  });
  const n=ent.length;
  document.getElementById('lobby-status').textContent=n===1?'1/40 connected — waiting…':`${n}/40 connected`;
  if(isHost){const btn=document.getElementById('btn-start-game');btn.disabled=n<1;btn.textContent=n<2?'▶ SOLO':'▶ START GAME';}
}
async function hostStartGame(){
  document.getElementById('btn-start-game').disabled=true;
  await update(dbRef('rooms',roomCode),{status:'playing','game/level':1,'game/round':0,'game/phase':'intro','game/betweenPhase':'leaderboard','game/roundSeed':Math.floor(Math.random()*100000),'game/roundStartTime':serverTimestamp()});
}

// ============================================================
// GAME START  (identical)
// ============================================================
function startGame(){clearListeners();get(dbRef('rooms',roomCode,'players')).then(s=>{if(s.exists())players=s.val();});showStageIntro(1,()=>startStage(1));}

// ============================================================
// SCORE  (identical to original)
// ============================================================
function addMyScore(pts){
  if(!myUid||!roomCode)return;
  if(!players[myUid])players[myUid]={score:0};
  players[myUid].score=(players[myUid].score||0)+pts;
  stageScoreLocal+=pts;updateHudScore();renderGameScores();
  get(dbRef('rooms',roomCode,'players',myUid,'score')).then(s=>{const cur=s.val()||0;update(dbRef('rooms',roomCode,'players',myUid),{score:cur+pts});});
}
function deductScore(pts){
  if(!myUid||!roomCode||!players[myUid])return;
  const next=Math.max(0,(players[myUid].score||0)-pts);
  players[myUid].score=next;updateHudScore();renderGameScores();
  update(dbRef('rooms',roomCode,'players',myUid),{score:next});
}
function syncGameScores(){listenOn(`rooms/${roomCode}/players`,s=>{players=s.val()||{};renderGameScores();updateHudScore();});}
function renderGameScores(){
  const c=document.getElementById('game-scores');if(!c)return;
  const sorted=Object.entries(players).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  c.innerHTML='';
  sorted.slice(0,8).forEach(([uid,p],i)=>{
    const ch=document.createElement('div');ch.className='score-chip'+(i===0?' leader':'');
    ch.innerHTML=`<span class="chip-name">${p.name}</span><span class="chip-score">${p.score||0}</span>`;c.appendChild(ch);
  });
}

// ============================================================
// TIMER  (identical to original)
// ============================================================
function startTimerLocal(tid,bid,sec,onEnd){
  stopLocalTimer();let rem=sec;
  const te=document.getElementById(tid),be=document.getElementById(bid);const CIRC=113;
  if(te){te.textContent=rem;te.classList.remove('warn');}
  if(be){if(be.tagName==='circle'){be.style.strokeDashoffset='0';be.classList.remove('warn');}else{be.style.width='100%';be.classList.remove('warn');}}
  localTimerId=setInterval(()=>{
    rem--;
    if(te){te.textContent=rem;if(rem<=5){te.classList.add('warn');sfxTimerWarn();}}
    if(be){const pct=Math.max(0,rem/sec);if(be.tagName==='circle'){be.style.strokeDashoffset=CIRC*(1-pct)+'';if(rem<=5)be.classList.add('warn');}else{be.style.width=(pct*100)+'%';if(rem<=5)be.classList.add('warn');}}
    if(rem<=0){stopLocalTimer();onEnd();}
  },1000);
}

// ============================================================
// STAGE INTROS
// ============================================================
const STAGE_INTROS={
  1:{icon:'🍉',title:'Fruit Slicer',badge:'GAME 1',how:'Swipe or drag across flying fruits to slice them! Slice 🍉🍊🍋 for points. Slice 💣 bombs and lose a life. Build combos — waves get busier as time goes on!',color:'#ef4444'},
  2:{icon:'🎨',title:'Odd Color Out',badge:'GAME 2',how:'One tile is a slightly different color from the others. Find it and tap it as fast as you can! Speed = bigger bonus points.',color:'#f59e0b'},
  3:{icon:'⚡',title:'Whack-a-Mole',badge:'GAME 3',how:'Moles 🐹 pop up from holes — smash them! Avoid bombs 💣 or lose points. Build a streak for a multiplier bonus!',color:'#10b981'},
  4:{icon:'🫧',title:'Bubble Pop',badge:'GAME 4',how:'The screen is PACKED with bubbles! Pop 🟢 green bubbles for points. Tap 🔴 red bombs and lose a life. Catch the rare 🌟 golden bonus bubbles for big scores!',color:'#06b6d4'},
  5:{icon:'🧠',title:'Memory Flip',badge:'GAME 5',how:'Flip cards to find matching emoji pairs. Match them all as fast as possible. Fewer moves = huge efficiency bonus!',color:'#8b5cf6'},
  6:{icon:'🎯',title:'Target Rush',badge:'GAME 6',how:'Click the green ✅ targets before they shrink and vanish. Avoid red ❌ targets — clicking them costs points. Up to 6 targets at once!',color:'#ec4899'},
  7:{icon:'💣',title:'Dodge & Collect',badge:'FINAL GAME',how:'Move your player with mouse/touch. Collect ⭐ stars for points. Dodge 💣 bombs — they shrink your score! Build streaks!',color:'#6366f1'},
};

function showStageIntro(n,cb){
  const info=STAGE_INTROS[n];if(!info){cb();return;}
  const ov=document.getElementById('stage-intro-overlay');
  document.getElementById('si-game-badge').textContent=info.badge;
  document.getElementById('si-icon').textContent=info.icon;
  document.getElementById('si-icon').style.background=info.color;
  document.getElementById('si-num').textContent=`ROUND ${n} OF 7`;
  document.getElementById('si-title').textContent=info.title;
  document.getElementById('si-how').textContent=info.how;
  document.getElementById('si-count').textContent='';
  ov.classList.remove('hidden');void ov.offsetWidth;ov.classList.add('si-in');
  setTimeout(()=>{
    let c=3;document.getElementById('si-count').textContent=c;sfxCountdown();
    const t=setInterval(()=>{c--;if(c<=0){clearInterval(t);document.getElementById('si-count').textContent='GO!';sfxGo();setTimeout(()=>{ov.classList.add('hidden');ov.classList.remove('si-in');cb();},520);}else{document.getElementById('si-count').textContent=c;sfxCountdown();}},850);
  },2200);
}

// ============================================================
// STAGE CONTROLLER
// ============================================================
const PANELS=['s1-panel','s2-panel','s3-panel','s4-panel','s5-panel','s6-panel','s7-panel'];
function showGamePanel(id){PANELS.forEach(p=>{const el=document.getElementById(p);if(el)el.classList.add('hidden');});const el=document.getElementById(id);if(el)el.classList.remove('hidden');}
function startStage(n){
  currentStage=n;stageScoreLocal=0;comboCount=0;
  showScreen('screen-game');
  document.getElementById('stage-num-label').textContent=`ROUND ${n}/7`;
  document.getElementById('stage-title-label').textContent=STAGE_INTROS[n].title;
  document.getElementById('combo-banner').classList.add('hidden');
  syncGameScores();updateHudScore();
  PANELS.forEach(p=>{const el=document.getElementById(p);if(el)el.classList.add('hidden');});
  document.getElementById('waiting-msg').classList.add('hidden');
  stopLocalTimer();clearGameLoops();
  if(n===1) startFruitSlicer();
  else if(n===2) startOddColor();
  else if(n===3) startWhackMole();
  else if(n===4) startBubblePop();
  else if(n===5) startMemoryFlip();
  else if(n===6) startTargetRush();
  else if(n===7) startDodgeCollect();
}

// ============================================================
// ── GAME 1: FRUIT SLICER ──────────────────────────────────
// Canvas-based; mouse/touch drag creates a "blade" that slices
// ============================================================
const FRUITS=[{e:'🍉',v:30},{e:'🍊',v:25},{e:'🍋',v:20},{e:'🍇',v:35},{e:'🍓',v:40},{e:'🥝',v:28},{e:'🍑',v:22},{e:'🍍',v:45},{e:'🍒',v:32},{e:'🫐',v:38}];
let fruitObjs=[],sliceBlade=[],fruitSliced=0,fruitMissed=0,fruitLives=3,fruitActive=false;
// fruitRafId declared at module level above

function startFruitSlicer(){
  fruitObjs=[];sliceBlade=[];fruitSliced=0;fruitMissed=0;fruitLives=3;fruitActive=true;
  if(fruitRafId){cancelAnimationFrame(fruitRafId);fruitRafId=null;}
  showGamePanel('s1-panel');
  updateFruitHUD();
  const cv=document.getElementById('slice-canvas');
  if(!cv){console.error('slice-canvas missing');return;}
  cv.width=cv.offsetWidth||360; cv.height=cv.offsetHeight||310;
  const ctx=cv.getContext('2d');

  // --- Input: remove old listeners before adding new ones ---
  let isDown=false;
  function getXY(e){const r=cv.getBoundingClientRect();const src=e.touches?e.touches[0]:e;return[(src.clientX-r.left)*(cv.width/r.width),(src.clientY-r.top)*(cv.height/r.height)];}
  function onDown(e){e.preventDefault();isDown=true;sliceBlade=[[...getXY(e)]];}
  function onMove(e){e.preventDefault();if(!isDown)return;const pt=getXY(e);sliceBlade.push(pt);if(sliceBlade.length>14)sliceBlade.shift();checkSlice(pt[0],pt[1]);}
  function onUp(){isDown=false;sliceBlade=[];}
  // Clone canvas node to wipe all previous listeners, then re-append
  const newCv=cv.cloneNode(true);
  cv.parentNode.replaceChild(newCv,cv);
  const canvas=newCv;
  canvas.width=canvas.offsetWidth||360;canvas.height=canvas.offsetHeight||310;
  const ctx2=canvas.getContext('2d');
  canvas.addEventListener('mousedown',onDown);canvas.addEventListener('mousemove',onMove);canvas.addEventListener('mouseup',onUp);
  canvas.addEventListener('touchstart',onDown,{passive:false});canvas.addEventListener('touchmove',onMove,{passive:false});canvas.addEventListener('touchend',onUp);

  // --- Spawn: faster rate + multi-spawn waves for engagement ---
  // Wave 1 (0-20s): relaxed, 1 fruit at a time every 650ms, bomb rate 12%
  // Wave 2 (20-35s): 2 fruits sometimes, every 500ms, bomb rate 16%
  // Wave 3 (35-52s): busier, occasional double-launch, bomb rate 18%
  let elapsed=0;
  const spawnId=setInterval(()=>{
    if(!fruitActive)return;
    elapsed+=0.55;
    const bombChance = elapsed<20?0.12:elapsed<35?0.16:0.18;
    const doubleChance = elapsed<20?0:elapsed<35?0.2:0.4;
    // Always spawn at least one fruit
    spawnOneFruit(canvas,bombChance);
    // Sometimes spawn a second simultaneously for variety
    if(Math.random()<doubleChance) setTimeout(()=>{if(fruitActive)spawnOneFruit(canvas,bombChance*0.5);},120);
  },550);
  gameIntervals.push(spawnId);

  // --- Physics loop: single RAF id, never accumulates ---
  const G=0.45;
  function loop(ts){
    if(!fruitActive){
      // Game ended — clean up and transition (called exactly once)
      if(fruitRafId!==null){fruitRafId=null;endFruitSlicer();}
      return;
    }
    ctx2.clearRect(0,0,canvas.width,canvas.height);
    // Draw blade trail
    if(sliceBlade.length>1){
      ctx2.beginPath();ctx2.moveTo(sliceBlade[0][0],sliceBlade[0][1]);
      for(let i=1;i<sliceBlade.length;i++){ctx2.lineTo(sliceBlade[i][0],sliceBlade[i][1]);}
      ctx2.strokeStyle='rgba(255,255,255,0.85)';ctx2.lineWidth=3;ctx2.lineCap='round';ctx2.stroke();
    }
    // Update & draw fruits
    fruitObjs.forEach(f=>{
      f.x+=f.vx;f.y+=f.vy;f.vy+=G;f.rot+=0.04;
      if(f.hit){f.opacity-=0.06;if(f.opacity<=0)f.dead=true;}
      else if(f.y>canvas.height+60&&!f.hit){
        f.dead=true;
        if(!f.bomb){fruitMissed++;fruitLives=Math.max(0,fruitLives-1);updateFruitHUD();sfxWrong();comboCount=0;if(fruitLives<=0)fruitActive=false;}
      }
      if(!f.dead){
        ctx2.save();ctx2.globalAlpha=f.opacity;ctx2.translate(f.x,f.y);ctx2.rotate(f.rot);
        ctx2.font=`${f.r*2}px serif`;ctx2.textAlign='center';ctx2.textBaseline='middle';ctx2.fillText(f.e,0,0);
        ctx2.restore();
      }
    });
    fruitObjs=fruitObjs.filter(f=>!f.dead);
    // Keep single RAF id — overwrite previous (it was already executed)
    fruitRafId=requestAnimationFrame(loop);
  }
  fruitRafId=requestAnimationFrame(loop);
  // Extended duration: ~52 seconds (35% longer than original 35s)
  startTimerLocal('train-timer','train-timer-bar',52,()=>{fruitActive=false;});
}

function spawnOneFruit(canvas,bombChance){
  const isBomb=Math.random()<bombChance;
  const x=rand(40,canvas.width-40);
  const vy=-rand(7,13);
  const vx=(Math.random()-.5)*5;
  const item=isBomb?{e:'💣',v:0,bomb:true}:pick(FRUITS);
  fruitObjs.push({e:item.e,v:item.v||0,bomb:item.bomb||false,x,y:canvas.height+30,vx,vy,r:28,hit:false,dead:false,rot:rand(-0.15,0.15),opacity:1});
}

function checkSlice(bx,by){
  fruitObjs.forEach(f=>{
    if(f.hit)return;
    const dx=bx-f.x,dy=by-f.y;
    if(Math.sqrt(dx*dx+dy*dy)<f.r+6){
      f.hit=true;sfxSlice();
      if(f.bomb){sfxWrong();fruitLives=Math.max(0,fruitLives-1);comboCount=0;updateFruitHUD();showToast('💣 BOMB! −1 life',700);if(fruitLives<=0)fruitActive=false;}
      else{comboCount++;const mult=Math.min(comboCount,6);const pts=f.v*mult;addMyScore(pts);fruitSliced++;updateFruitHUD();sfxPop();if(comboCount>=2)showCombo(comboCount);showToast(`+${pts}${mult>1?` ×${mult}`:''}`,500);}
    }
  });
}

function updateFruitHUD(){
  document.getElementById('fruit-sliced').textContent=fruitSliced;
  document.getElementById('fruit-missed').textContent=fruitMissed;
  document.getElementById('fruit-lives-row').textContent='❤️'.repeat(Math.max(0,fruitLives))+'🖤'.repeat(Math.max(0,3-fruitLives));
}

let _fruitEnded=false;
function endFruitSlicer(){
  if(_fruitEnded)return; _fruitEnded=true;
  fruitActive=false;
  if(fruitRafId){cancelAnimationFrame(fruitRafId);fruitRafId=null;}
  stopLocalTimer();clearGameLoops();
  const bonus=fruitLives>=3?300:fruitLives===2?150:fruitLives===1?50:0;
  if(bonus>0){addMyScore(bonus);sfxBonus();showToast(fruitLives>=3?'🏆 FLAWLESS! +300':fruitLives>=2?'⭐ Great! +150':'✅ Survived +50');}
  else showToast('💀 Wiped out!');
  setTimeout(()=>{_fruitEnded=false;finishStage(1);},1800);
}

// ============================================================
// ── GAME 2: ODD COLOR OUT ─────────────────────────────────
// ============================================================
let colorRound=0,colorScore=0,colorActive=false,colorTimer=null;

function startOddColor(){
  colorRound=0;colorScore=0;colorActive=true;
  showGamePanel('s2-panel');
  document.getElementById('color-pts').textContent='0';
  nextColorRound();
  startTimerLocal('train-timer','train-timer-bar',50,()=>{
    colorActive=false;
    if(colorTimer){clearTimeout(colorTimer);colorTimer=null;}
    finishStage(2);
  });
}

function nextColorRound(){
  if(!colorActive)return;  // guard: timer may fire after game ended
  if(colorRound>=12){colorActive=false;stopLocalTimer();if(colorTimer){clearTimeout(colorTimer);colorTimer=null;}finishStage(2);return;}
  colorRound++;
  document.getElementById('color-round').textContent=colorRound;
  document.getElementById('color-feedback-inline').textContent='';
  // Grid size increases with rounds
  const gridSize=colorRound<=4?9:colorRound<=8?16:25;
  const cols=Math.sqrt(gridSize);
  const grid=document.getElementById('color-grid');
  grid.style.gridTemplateColumns=`repeat(${cols},1fr)`;
  // Base hue
  const hue=randInt(0,360);const sat=randInt(55,90);const lit=randInt(35,60);
  const diffAmt=Math.max(8,28-colorRound*1.5); // gets harder
  const oddIdx=randInt(0,gridSize-1);
  const oddHue=(hue+diffAmt)%360;
  grid.innerHTML='';
  const roundStart=performance.now();
  let roundAnswered=false; // prevent double-advance per round
  for(let i=0;i<gridSize;i++){
    const tile=document.createElement('div');tile.className='color-tile';
    const isOdd=i===oddIdx;
    tile.style.background=isOdd?`hsl(${oddHue},${sat}%,${lit}%)`:`hsl(${hue},${sat}%,${lit}%)`;
    tile.addEventListener('click',()=>{
      if(!colorActive||roundAnswered)return;
      roundAnswered=true;
      if(colorTimer){clearTimeout(colorTimer);colorTimer=null;}
      const elapsed=(performance.now()-roundStart)/1000;
      if(isOdd){
        comboCount++;const mult=Math.min(comboCount,4);
        const speed=Math.max(0,Math.round((5-elapsed)*20));
        const pts=(100+speed)*mult;
        colorScore+=pts;addMyScore(pts);sfxCorrect();
        tile.classList.add('correct-tile');
        if(comboCount>=2)showCombo(comboCount);
        document.getElementById('color-feedback-inline').textContent=`+${pts}${mult>1?` ×${mult}`:''}`;
        document.getElementById('color-pts').textContent=colorScore;
        setTimeout(nextColorRound,400);
      }else{
        comboCount=0;sfxWrong();deductScore(20);
        tile.classList.add('wrong-tile');
        document.getElementById('color-feedback-inline').textContent='❌ −20';
        setTimeout(nextColorRound,600);
      }
    });
    grid.appendChild(tile);
  }
  // Auto-advance if too slow
  colorTimer=setTimeout(()=>{
    if(!colorActive||roundAnswered)return;
    roundAnswered=true;comboCount=0;sfxWrong();deductScore(10);nextColorRound();
  },4000);
}

// ============================================================
// ── GAME 3: WHACK-A-MOLE ─────────────────────────────────
// ============================================================
const MOLE_COUNT=9;
let moleHits=0,moleMisses=0,moleStreak=0,moleActive=false;

function startWhackMole(){
  moleHits=0;moleMisses=0;moleStreak=0;moleActive=true;
  showGamePanel('s3-panel');
  updateMoleHUD();
  const grid=document.getElementById('mole-grid');grid.innerHTML='';
  for(let i=0;i<MOLE_COUNT;i++){
    const hole=document.createElement('div');hole.className='mole-hole';hole.dataset.idx=i;
    hole.innerHTML='<span class="mole-emoji"> </span>';
    hole.addEventListener('click',()=>handleMoleClick(hole));
    grid.appendChild(hole);
  }
  // Scheduler
  let spawnSpeed=1200;
  const id=setInterval(()=>{
    if(!moleActive)return;
    spawnSpeed=Math.max(500,spawnSpeed-20);
    const holes=Array.from(grid.querySelectorAll('.mole-hole:not(.mole-up):not(.bomb-up)'));
    if(holes.length===0)return;
    const hole=pick(holes);
    const isBomb=Math.random()<0.2;
    hole.classList.add(isBomb?'bomb-up':'mole-up');
    hole.dataset.bomb=isBomb?'1':'0';
    hole.querySelector('.mole-emoji').textContent=isBomb?'💣':'🐹';
    const upTime=Math.max(600,spawnSpeed-200);
    setTimeout(()=>{
      if(hole.classList.contains('mole-up')||hole.classList.contains('bomb-up')){
        hole.classList.remove('mole-up','bomb-up');
        hole.querySelector('.mole-emoji').textContent=' ';
        if(!isBomb&&!hole.dataset.hit){moleMisses++;moleStreak=0;updateMoleHUD();}
        delete hole.dataset.hit;
      }
    },upTime);
  },spawnSpeed);
  gameIntervals.push(id);
  startTimerLocal('train-timer','train-timer-bar',30,()=>{moleActive=false;clearGameLoops();endWhackMole();});
}

function handleMoleClick(hole){
  if(!moleActive)return;
  if(hole.classList.contains('mole-up')){
    hole.dataset.hit='1';hole.classList.remove('mole-up');hole.classList.add('mole-hit');
    hole.querySelector('.mole-emoji').textContent=' ';
    moleHits++;moleStreak++;comboCount++;
    const mult=Math.min(moleStreak,5);const pts=50*mult;
    addMyScore(pts);sfxWhack();
    if(comboCount>=2)showCombo(comboCount);
    spawnSplat(hole,'💥');
    updateMoleHUD();
    setTimeout(()=>hole.classList.remove('mole-hit'),200);
  }else if(hole.classList.contains('bomb-up')){
    hole.dataset.hit='1';hole.classList.remove('bomb-up');
    hole.querySelector('.mole-emoji').textContent=' ';
    moleStreak=0;comboCount=0;sfxWrong();deductScore(30);spawnSplat(hole,'😵');
    updateMoleHUD();
  }else{
    // Clicked empty hole
    moleMisses++;moleStreak=0;comboCount=0;deductScore(10);sfxWrong();updateMoleHUD();
  }
}

function spawnSplat(hole,e){
  const s=document.createElement('div');s.className='mole-splat';s.textContent=e;
  s.style.cssText=`top:10%;left:30%;`;hole.appendChild(s);
  setTimeout(()=>s.remove(),500);
}

function updateMoleHUD(){
  document.getElementById('mole-hits').textContent=moleHits;
  document.getElementById('mole-misses').textContent=moleMisses;
  document.getElementById('mole-streak').textContent=moleStreak;
}

function endWhackMole(){
  stopLocalTimer();
  const bonus=moleStreak>=8?300:moleStreak>=5?150:moleStreak>=3?75:0;
  if(bonus>0){addMyScore(bonus);sfxBonus();showToast(`🔥 Streak bonus +${bonus}!`);}
  setTimeout(()=>finishStage(3),1500);
}

// ============================================================
// ── GAME 4: BUBBLE POP ────────────────────────────────────
// Canvas-based physics bubbles — CROWDED MODE
// Fixed: single RAF id, endBubblePop always called, no listener duplication
// ============================================================
let bubbleObjs=[],bubblePopped=0,bubbleLives=3,bubbleStreak=0,bubbleActive=false;
// bubbleRafId declared at module level above
let _bubbleEnded=false;

function startBubblePop(){
  bubbleObjs=[];bubblePopped=0;bubbleLives=3;bubbleStreak=0;bubbleActive=true;_bubbleEnded=false;
  if(bubbleRafId){cancelAnimationFrame(bubbleRafId);bubbleRafId=null;}
  showGamePanel('s4-panel');
  updateBubbleHUD();

  // Clone canvas to wipe all previous event listeners
  const oldCv=document.getElementById('bubble-canvas');
  if(!oldCv){console.error('bubble-canvas missing');return;}
  const cv=oldCv.cloneNode(true);
  oldCv.parentNode.replaceChild(cv,oldCv);
  cv.width=cv.offsetWidth||360;cv.height=cv.offsetHeight||310;
  const ctx=cv.getContext('2d');
  const W=cv.width,H=cv.height;

  // Click/touch handler — attached once to the fresh clone
  function onClick(e){
    e.preventDefault();
    if(!bubbleActive)return;
    const r=cv.getBoundingClientRect();
    const src=e.touches?e.touches[0]:e;
    const x=(src.clientX-r.left)*(W/r.width);
    const y=(src.clientY-r.top)*(H/r.height);
    let hitAny=false;
    // Check in reverse so topmost bubble wins
    for(let i=bubbleObjs.length-1;i>=0;i--){
      const b=bubbleObjs[i];
      if(b.dead)continue;
      const dx=x-b.x,dy=y-b.y;
      if(Math.sqrt(dx*dx+dy*dy)<b.r+4){
        b.dead=true;hitAny=true;
        if(b.bomb){
          bubbleLives=Math.max(0,bubbleLives-1);bubbleStreak=0;comboCount=0;
          sfxWrong();updateBubbleHUD();showToast('💥 Bomb! −1 life',700);
          if(bubbleLives<=0){bubbleActive=false;}
        }else{
          bubblePopped++;bubbleStreak++;comboCount++;
          const mult=Math.min(comboCount,5);const pts=Math.round(b.pts*mult);
          addMyScore(pts);sfxPop();if(comboCount>=2)showCombo(comboCount);
          showToast(`+${pts}${mult>1?` ×${mult}`:''}`,500);updateBubbleHUD();
        }
        break; // one hit per tap
      }
    }
    if(!hitAny){comboCount=0;bubbleStreak=0;}
  }
  cv.addEventListener('mousedown',onClick);
  cv.addEventListener('touchstart',onClick,{passive:false});

  // --- CROWDED SPAWN: multiple bubbles at once, varied patterns ---
  // Initial burst: 5 bubbles to fill the arena immediately
  for(let i=0;i<5;i++) setTimeout(()=>{if(bubbleActive)spawnBubble(W,H);},i*120);

  // Ongoing: faster spawn rate + occasional triple-burst
  let spawnTick=0;
  const spawnId=setInterval(()=>{
    if(!bubbleActive)return;
    spawnTick++;
    // Always spawn 1
    spawnBubble(W,H);
    // Every 3rd tick spawn 2 more (burst)
    if(spawnTick%3===0){
      setTimeout(()=>{if(bubbleActive)spawnBubble(W,H);},180);
      setTimeout(()=>{if(bubbleActive)spawnBubble(W,H);},360);
    }
    // Every 7th tick spawn a large slow bonus bubble
    if(spawnTick%7===0) setTimeout(()=>{if(bubbleActive)spawnBonusBubble(W,H);},90);
  },600); // 600ms vs original 900ms — much busier
  gameIntervals.push(spawnId);

  // --- RAF draw loop: single id, transition handled here ---
  function loop(){
    // If game ended, call end exactly once then stop
    if(!bubbleActive){
      if(bubbleRafId!==null){bubbleRafId=null;endBubblePop();}
      return;
    }
    ctx.clearRect(0,0,W,H);
    bubbleObjs.forEach(b=>{
      if(b.dead)return;
      // Movement: sinusoidal drift for variety
      b.y+=b.vy;
      b.x+=b.vx+Math.sin(Date.now()/900+b.phase)*b.drift;
      // Bounce off walls
      if(b.x<b.r){b.x=b.r;b.vx=Math.abs(b.vx);}
      else if(b.x>W-b.r){b.x=W-b.r;b.vx=-Math.abs(b.vx);}
      // Remove if off top
      if(b.y<-b.r*3){b.dead=true;return;}
      drawBubble(ctx,b);
    });
    bubbleObjs=bubbleObjs.filter(b=>!b.dead);
    bubbleRafId=requestAnimationFrame(loop);
  }
  bubbleRafId=requestAnimationFrame(loop);

  // Watchdog: if no pops for 8s and >3 bubbles on screen, player isn't stuck
  // (bubbles keep flowing regardless — no deadlock possible)
  startTimerLocal('train-timer','train-timer-bar',38,()=>{
    bubbleActive=false; // RAF loop will detect this and call endBubblePop
  });
}

function spawnBubble(W,H){
  const isBomb=Math.random()<0.22;
  const r=isBomb?rand(20,28):rand(18,36);
  // Ensure spawn within bounds
  const x=rand(r+4,Math.max(r+5,W-r-4));
  bubbleObjs.push({
    x,y:H+r,r,bomb:isBomb,
    pts:Math.round(Math.max(1,(80/r)*20)),
    vy:-rand(1.8,3.4),vx:(Math.random()-.5)*1.8,
    drift:rand(0.3,1.2),phase:rand(0,Math.PI*2),
    dead:false,pulse:rand(0,Math.PI*2)
  });
}

function spawnBonusBubble(W,H){
  // Large slow golden bonus bubble worth more points
  const r=rand(38,48);
  const x=rand(r+4,Math.max(r+5,W-r-4));
  bubbleObjs.push({
    x,y:H+r,r,bomb:false,
    pts:Math.round((80/r)*28), // boosted
    vy:-rand(1.0,1.8),vx:(Math.random()-.5)*1.0,
    drift:rand(0.5,1.5),phase:rand(0,Math.PI*2),
    dead:false,pulse:rand(0,Math.PI*2),bonus:true
  });
}

function drawBubble(ctx,b){
  b.pulse=(b.pulse||0)+0.06;
  const pulseR=b.r+Math.sin(b.pulse)*1.5;
  const grad=ctx.createRadialGradient(b.x-b.r*.3,b.y-b.r*.3,0,b.x,b.y,pulseR);
  if(b.bomb){
    grad.addColorStop(0,'rgba(255,100,100,0.95)');grad.addColorStop(1,'rgba(180,0,0,0.9)');
  }else if(b.bonus){
    grad.addColorStop(0,'rgba(255,230,80,0.98)');grad.addColorStop(1,'rgba(200,130,0,0.9)');
  }else{
    grad.addColorStop(0,'rgba(100,255,160,0.95)');grad.addColorStop(1,'rgba(0,160,80,0.85)');
  }
  ctx.beginPath();ctx.arc(b.x,b.y,pulseR,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
  // Shine highlight
  ctx.beginPath();ctx.arc(b.x-b.r*.28,b.y-b.r*.28,b.r*.22,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,0.38)';ctx.fill();
  // Emoji label
  ctx.font=`${b.r*0.9}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(b.bomb?'💣':b.bonus?'🌟':'🫧',b.x,b.y);
}

function updateBubbleHUD(){
  document.getElementById('bubble-popped').textContent=bubblePopped;
  document.getElementById('bubble-lives-row').textContent='❤️'.repeat(Math.max(0,bubbleLives))+'🖤'.repeat(Math.max(0,3-bubbleLives));
  document.getElementById('bubble-streak').textContent=bubbleStreak;
}

function endBubblePop(){
  if(_bubbleEnded)return; _bubbleEnded=true;
  bubbleActive=false;
  if(bubbleRafId){cancelAnimationFrame(bubbleRafId);bubbleRafId=null;}
  stopLocalTimer();clearGameLoops();
  const bonus=bubbleLives>=3?250:bubbleLives===2?100:bubbleLives===1?40:0;
  if(bonus>0){addMyScore(bonus);sfxBonus();showToast(bubbleLives>=3?'🏆 Perfect! +250':bubbleLives>=2?'⭐ Good! +100':'✅ Survived +40');}
  else showToast('💔 Wiped out! Better luck next time.');
  setTimeout(()=>{_bubbleEnded=false;finishStage(4);},1500);
}

// ============================================================
// ── GAME 5: MEMORY FLIP ───────────────────────────────────
// Pure emoji memory — 8 pairs (16 cards)
// ============================================================
const MEM_EMOJIS=['🍕','🚀','🎸','🐉','🦊','🌈','💎','⚡','🎯','🏆','🎪','🦋','🌺','🎭','🍭','🎃'];
let memCards=[],memFlipped2=[],memPairs2=0,memMoves2=0,memLocked2=false;

function startMemoryFlip(){
  memPairs2=0;memMoves2=0;memFlipped2=[];memLocked2=false;
  showGamePanel('s5-panel');
  document.getElementById('mem-pairs').textContent='0';
  document.getElementById('mem-moves').textContent='0';
  document.getElementById('mem-bonus-label').textContent='';
  const emojis=shuffle(MEM_EMOJIS).slice(0,8);
  const deck=shuffle([...emojis,...emojis]);
  const grid=document.getElementById('memory-grid');
  grid.style.gridTemplateColumns='repeat(4,1fr)';
  grid.innerHTML='';
  deck.forEach((e,i)=>{
    const card=document.createElement('div');card.className='mem-card';card.dataset.emoji=e;card.dataset.idx=i;
    card.innerHTML='<div class="mem-card-inner"><div class="mem-front">⭐</div><div class="mem-back">'+e+'</div></div>';
    card.addEventListener('click',()=>handleMemClick2(card,e));
    grid.appendChild(card);
  });
  startTimerLocal('train-timer','train-timer-bar',55,()=>{stopLocalTimer();finishStage(5);});
}

function handleMemClick2(card,e){
  if(memLocked2||card.classList.contains('flipped')||card.classList.contains('matched'))return;
  card.classList.add('flipped');sfxClick();memFlipped2.push({card,e});
  if(memFlipped2.length===2){
    memMoves2++;document.getElementById('mem-moves').textContent=memMoves2;
    memLocked2=true;
    const [a,b]=memFlipped2;
    if(a.e===b.e&&a.card!==b.card){
      a.card.classList.add('matched');b.card.classList.add('matched');
      memPairs2++;document.getElementById('mem-pairs').textContent=memPairs2;
      comboCount++;const mult=Math.min(comboCount,4);
      const speed=Math.max(0,50-memMoves2*4);
      const pts=(120+speed)*mult;
      addMyScore(pts);sfxCorrect();
      if(comboCount>=2)showCombo(comboCount);
      document.getElementById('mem-bonus-label').textContent=`+${pts}`;
      memFlipped2=[];memLocked2=false;
      if(memPairs2===8){stopLocalTimer();const eff=memMoves2<=10?400:memMoves2<=14?200:50;addMyScore(eff);sfxBonus();showToast(`🏆 All matched! Efficiency +${eff}`);setTimeout(()=>finishStage(5),1600);}
    }else{
      comboCount=0;
      setTimeout(()=>{a.card.classList.remove('flipped');b.card.classList.remove('flipped');memFlipped2=[];memLocked2=false;},900);
    }
  }
}

// ============================================================
// ── GAME 6: TARGET RUSH ───────────────────────────────────
// Moving, shrinking targets appear — click green, avoid red
// Fixed: removed recursive spawn pattern that caused exponential spawning
// ============================================================
let targetHits=0,targetMisses=0,targetStreak=0,targetActive=false;

function startTargetRush(){
  targetHits=0;targetMisses=0;targetStreak=0;targetActive=true;
  showGamePanel('s6-panel');
  updateTargetHUD();
  const arena=document.getElementById('target-arena');
  arena.innerHTML='';
  const ar=arena.getBoundingClientRect();
  const AW=ar.width||340;const AH=ar.height||240;

  // Fixed-interval spawner — no recursive calls, no race conditions
  // Starts with 3 concurrent targets, spawns one new every 900ms
  let activeTargetCount=0;
  const MAX_CONCURRENT=6;

  function spawnTarget(){
    if(!targetActive||activeTargetCount>=MAX_CONCURRENT)return;
    activeTargetCount++;
    const isBad=Math.random()<0.25;
    const size=randInt(38,66);
    const x=rand(4,Math.max(5,AW-size-4));
    const y=rand(4,Math.max(5,AH-size-4));
    const t=document.createElement('div');
    t.className=`target ${isBad?'target-bad':'target-good'}`;
    t.style.cssText=`width:${size}px;height:${size}px;left:${x}px;top:${y}px;font-size:${size*.45}px;`;
    t.textContent=isBad?'❌':'✅';
    let handled=false; // prevents both click and timeout from acting

    const lifeTime=Math.max(900,2200-targetHits*25);
    t.style.transition=`transform ${lifeTime}ms linear`;
    setTimeout(()=>t.style.transform='scale(0)',10);

    t.addEventListener('click',()=>{
      if(!targetActive||handled)return;
      handled=true;
      if(t.parentNode)t.remove();
      activeTargetCount=Math.max(0,activeTargetCount-1);
      if(isBad){
        targetStreak=0;comboCount=0;sfxWrong();deductScore(40);
        showHitEffect(arena,x,y,'−40','#ff4757');updateTargetHUD();
      }else{
        targetHits++;targetStreak++;comboCount++;
        const mult=Math.min(comboCount,5);const pts=80*mult;
        addMyScore(pts);sfxPop();if(comboCount>=2)showCombo(comboCount);
        showHitEffect(arena,x,y,`+${pts}${mult>1?` ×${mult}`:''}`, '#2ed573');
        updateTargetHUD();
      }
    });

    arena.appendChild(t);

    // Auto-expire
    setTimeout(()=>{
      if(handled)return;
      handled=true;
      if(t.parentNode)t.remove();
      activeTargetCount=Math.max(0,activeTargetCount-1);
      if(!isBad){targetMisses++;targetStreak=0;comboCount=0;updateTargetHUD();}
    },lifeTime+80);
  }

  // Seed initial targets
  for(let i=0;i<3;i++) setTimeout(()=>{if(targetActive)spawnTarget();},i*280);
  // Regular interval spawner
  const spawnId=setInterval(()=>{if(targetActive)spawnTarget();},820);
  gameIntervals.push(spawnId);

  startTimerLocal('train-timer','train-timer-bar',30,()=>{
    targetActive=false;clearGameLoops();endTargetRush();
  });
}

function showHitEffect(arena,x,y,text,color){
  const el=document.createElement('div');el.className='target-hit-effect';
  el.textContent=text;el.style.cssText=`left:${x}px;top:${y}px;color:${color};font-weight:900;`;
  arena.appendChild(el);setTimeout(()=>el.remove(),750);
}

function updateTargetHUD(){
  document.getElementById('target-hits').textContent=targetHits;
  document.getElementById('target-misses').textContent=targetMisses;
  document.getElementById('target-streak').textContent=targetStreak;
}

function endTargetRush(){
  stopLocalTimer();
  const bonus=targetStreak>=8?300:targetStreak>=5?150:targetStreak>=3?60:0;
  if(bonus>0){addMyScore(bonus);sfxBonus();showToast(`⚡ Streak bonus +${bonus}!`);}
  setTimeout(()=>finishStage(6),1500);
}

// ============================================================
// ── GAME 7: DODGE & COLLECT ───────────────────────────────
// Canvas: player moves, collects stars, dodges bombs
// Fixed: single RAF id, listener wipe via clone, end always fires
// ============================================================
let dodgeStars=0,dodgeLives=3,dodgeStreak=0,dodgeActive=false;
// dodgeRafId declared at module level above
let _dodgeEnded=false;

function startDodgeCollect(){
  dodgeStars=0;dodgeLives=3;dodgeStreak=0;dodgeActive=true;_dodgeEnded=false;
  if(dodgeRafId){cancelAnimationFrame(dodgeRafId);dodgeRafId=null;}
  showGamePanel('s7-panel');
  updateDodgeHUD();

  // Clone canvas to wipe all previous event listeners
  const oldCv=document.getElementById('dodge-canvas');
  if(!oldCv){console.error('dodge-canvas missing');return;}
  const cv=oldCv.cloneNode(true);
  oldCv.parentNode.replaceChild(cv,oldCv);
  cv.width=cv.offsetWidth||360;cv.height=cv.offsetHeight||310;
  const ctx=cv.getContext('2d');
  const W=cv.width,H=cv.height;

  const player={x:W/2,y:H-50,r:18,tx:W/2,ty:H-50};
  let items=[];

  function spawnItem(){
    if(!dodgeActive)return;
    const isBomb=Math.random()<0.3+dodgeStars*.008;
    const r=isBomb?17:13;
    // Clamp x within canvas bounds
    const x=rand(r+4,Math.max(r+5,W-r-4));
    items.push({x,y:-20,r,bomb:isBomb,speed:rand(2.5,4.8),pts:isBomb?0:30+Math.floor(dodgeStreak*5),dead:false});
  }
  for(let i=0;i<4;i++) spawnItem();
  const spawnId=setInterval(()=>{if(dodgeActive)spawnItem();},900);
  gameIntervals.push(spawnId);

  // Input: attached once to the cloned canvas
  function move(e){
    e.preventDefault();
    const r=cv.getBoundingClientRect();const src=e.touches?e.touches[0]:e;
    player.tx=Math.max(player.r,Math.min(W-player.r,(src.clientX-r.left)*(W/r.width)));
    player.ty=Math.max(player.r,Math.min(H-player.r,(src.clientY-r.top)*(H/r.height)));
  }
  cv.addEventListener('mousemove',move);
  cv.addEventListener('touchmove',move,{passive:false});

  function loop(){
    if(!dodgeActive){
      if(dodgeRafId!==null){dodgeRafId=null;endDodgeCollect();}
      return;
    }
    player.x+=(player.tx-player.x)*.18;
    player.y+=(player.ty-player.y)*.18;
    player.x=Math.max(player.r,Math.min(W-player.r,player.x));
    player.y=Math.max(player.r,Math.min(H-player.r,player.y));
    ctx.clearRect(0,0,W,H);
    // Draw player
    const pg=ctx.createRadialGradient(player.x-4,player.y-4,0,player.x,player.y,player.r);
    pg.addColorStop(0,'#818cf8');pg.addColorStop(1,'#4f46e5');
    ctx.beginPath();ctx.arc(player.x,player.y,player.r,0,Math.PI*2);ctx.fillStyle=pg;ctx.fill();
    ctx.font=`${player.r*1.2}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🚀',player.x,player.y);
    // Update & draw items
    items.forEach(item=>{
      if(item.dead)return;
      item.y+=item.speed;
      if(item.y>H+30){item.dead=true;return;}
      const g=ctx.createRadialGradient(item.x-3,item.y-3,0,item.x,item.y,item.r);
      if(item.bomb){g.addColorStop(0,'#ff6b6b');g.addColorStop(1,'#c0392b');}
      else{g.addColorStop(0,'#ffd700');g.addColorStop(1,'#f39c12');}
      ctx.beginPath();ctx.arc(item.x,item.y,item.r,0,Math.PI*2);ctx.fillStyle=g;ctx.fill();
      ctx.font=`${item.r*1.4}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(item.bomb?'💣':'⭐',item.x,item.y);
      // Collision
      const dx=player.x-item.x,dy=player.y-item.y;
      if(Math.sqrt(dx*dx+dy*dy)<player.r+item.r){
        item.dead=true;
        if(item.bomb){
          dodgeLives=Math.max(0,dodgeLives-1);dodgeStreak=0;comboCount=0;
          sfxWrong();updateDodgeHUD();showToast('💣 Bomb!',600);
          if(dodgeLives<=0){dodgeActive=false;}
        }else{
          dodgeStars++;dodgeStreak++;comboCount++;
          const mult=Math.min(comboCount,5);const pts=item.pts*mult;
          addMyScore(pts);sfxPop();if(comboCount>=2)showCombo(comboCount);updateDodgeHUD();
        }
      }
    });
    items=items.filter(i=>!i.dead);
    dodgeRafId=requestAnimationFrame(loop);
  }
  dodgeRafId=requestAnimationFrame(loop);
  startTimerLocal('train-timer','train-timer-bar',35,()=>{dodgeActive=false;});
}

function updateDodgeHUD(){
  document.getElementById('dodge-stars').textContent=dodgeStars;
  document.getElementById('dodge-lives-row').textContent='❤️'.repeat(Math.max(0,dodgeLives))+'🖤'.repeat(Math.max(0,3-dodgeLives));
  document.getElementById('dodge-streak').textContent=dodgeStreak;
}

function endDodgeCollect(){
  if(_dodgeEnded)return; _dodgeEnded=true;
  dodgeActive=false;
  if(dodgeRafId){cancelAnimationFrame(dodgeRafId);dodgeRafId=null;}
  stopLocalTimer();clearGameLoops();
  const bonus=dodgeLives>=3?350:dodgeLives===2?150:dodgeLives===1?60:0;
  if(bonus>0){addMyScore(bonus);sfxBonus();showToast(dodgeLives>=3?'🏆 PERFECT! +350':dodgeLives>=2?'⭐ Great! +150':'✅ Survived +60');}
  else showToast('💀 Wiped out!');
  setTimeout(()=>{_dodgeEnded=false;finishStage(7);},1800);
}

// ============================================================
// FINISH STAGE → BETWEEN → RECAP (identical structure)
// ============================================================
function finishStage(n){
  stopLocalTimer();clearGameLoops();sfxLevelUp();
  document.getElementById('waiting-msg').classList.remove('hidden');
  get(dbRef('rooms',roomCode,'players')).then(s=>{players=s.val()||{};showStageBetween(n);});
}

function showStageBetween(n){
  const isLast=n>=7;
  document.getElementById('between-game-icon').textContent=STAGE_INTROS[n]?.icon||'📊';
  document.getElementById('between-title').textContent=isLast?'🏁 GAME COMPLETE!':'Round '+n+' Done!';
  document.getElementById('between-sub').textContent=isLast?'Final scores — host reveals the winner!':'Live standings — next round coming up!';
  renderLeaderboard('leaderboard-between',players);
  showScreen('screen-between');
  const nextBtn=document.getElementById('btn-next-level');
  const cd=document.getElementById('between-countdown');
  if(isHost){
    nextBtn.classList.remove('hidden');nextBtn.disabled=false;
    nextBtn.textContent=isLast?'🏆 Reveal Champion →':'Next Round →';
    nextBtn.onclick=()=>{
      nextBtn.disabled=true;sfxClick();
      if(isLast){update(dbRef('rooms',roomCode),{'game/level':'results'});showFinalResults();}
      else{update(dbRef('rooms',roomCode),{'game/level':n,'game/betweenPhase':'explanation'});showRecap(n);}
    };cd.textContent='';
  }else{
    nextBtn.classList.add('hidden');
    cd.textContent=isLast?'Waiting for host to reveal winner…':'Waiting for host…';
    clearListeners();
    listenOn(`rooms/${roomCode}/game/betweenPhase`,s=>{if(s.val()==='explanation'){clearListeners();showRecap(n);}});
    listenOn(`rooms/${roomCode}/game/level`,s=>{const lv=s.val();if(lv==='results'){clearListeners();showFinalResults();}});
  }
}

// ============================================================
// RECAP (replaces explanation screen — brief fun tips)
// ============================================================
const RECAPS={
  1:{title:'🍉 Fruit Slicer',tips:[{icon:'⚡',c:'green',t:'<strong>Combos</strong> multiply every slice. Chain 5+ for ×5 points per fruit!'},
    {icon:'💣',c:'red',t:'<strong>Bombs kill combos</strong> and cost a life. Slow your blade near red!'},
    {icon:'🎯',c:'yellow',t:'<strong>Rare fruits</strong> like pineapple 🍍 score highest — prioritise them!'}],next:'Spot the odd tile — speed is everything!'},
  2:{title:'🎨 Odd Color Out',tips:[{icon:'👁',c:'yellow',t:'<strong>Grid gets bigger</strong> each round — scan systematically!'},
    {icon:'⚡',c:'green',t:'<strong>Speed bonus</strong> — tap in under 1 second for maximum points!'},
    {icon:'🔁',c:'blue',t:'<strong>Combos</strong> stack across rounds — stay accurate!'}],next:'Moles are waiting to be whacked!'},
  3:{title:'⚡ Whack-a-Mole',tips:[{icon:'💥',c:'green',t:'<strong>Smash streaks</strong> — hitting 5+ in a row gives ×5 multiplier!'},
    {icon:'💣',c:'red',t:'<strong>Bombs</strong> look similar — check the emoji before clicking!'},
    {icon:'🖱',c:'yellow',t:'<strong>Empty holes</strong> cost points — only click when you see a mole!'}],next:'Pop bubbles, dodge bombs!'},
  4:{title:'🫧 Bubble Pop',tips:[{icon:'🎯',c:'green',t:'<strong>Small bubbles</strong> score higher per size — they are worth hunting!'},
    {icon:'💣',c:'red',t:'<strong>Red bombs</strong> explode on tap — you lose a life!'},
    {icon:'⚡',c:'yellow',t:'<strong>Chain pops</strong> build your combo multiplier!'}],next:'Time to test your memory!'},
  5:{title:'🧠 Memory Flip',tips:[{icon:'🔢',c:'green',t:'<strong>Fewer moves</strong> = bigger efficiency bonus at the end!'},
    {icon:'⚡',c:'yellow',t:'<strong>Consecutive matches</strong> stack a combo multiplier!'},
    {icon:'👁',c:'blue',t:'<strong>Watch what flips</strong> — you only need to remember 8 emojis!'}],next:'Shoot moving targets!'},
  6:{title:'🎯 Target Rush',tips:[{icon:'✅',c:'green',t:'<strong>Green targets</strong> shrink fast — click early for max points!'},
    {icon:'❌',c:'red',t:'<strong>Red targets</strong> look tempting — clicking them costs −40 pts!'},
    {icon:'⚡',c:'yellow',t:'<strong>Streak bonus</strong> — 8 hits in a row is worth 300 bonus points!'}],next:'Final game — dodge and collect!'},
  7:{title:'💣 Dodge & Collect',tips:[{icon:'🚀',c:'green',t:'<strong>Smooth movement</strong> — follow stars, curve away from bombs!'},
    {icon:'⭐',c:'yellow',t:'<strong>Streaks</strong> boost star value — chase them back-to-back!'},
    {icon:'💣',c:'red',t:'<strong>Survice all 3 lives</strong> for a 350-point perfect run bonus!'}],next:'Check out your final ranking!'},
};

function showRecap(n){
  const r=RECAPS[n];if(!r)return;
  showScreen('screen-explanation');
  document.getElementById('exp-stage-label').textContent=`ROUND ${n} RECAP`;
  document.getElementById('exp-title').textContent=r.title;
  document.getElementById('exp-points').innerHTML=r.tips.map(t=>`<div class="exp-point exp-${t.c}"><span class="exp-point-icon">${t.icon}</span><span class="exp-point-text">${t.t}</span></div>`).join('');
  document.getElementById('exp-takeaway').textContent=r.next;
  const nb=document.getElementById('btn-next-stage'),w=document.getElementById('exp-waiting');
  if(isHost){
    nb.classList.remove('hidden');nb.disabled=false;w.classList.add('hidden');
    nb.textContent=n<7?`▶ Play Round ${n+1}`:'🏆 See Results';
    nb.onclick=()=>{nb.disabled=true;sfxClick();update(dbRef('rooms',roomCode),{'game/level':n+1,'game/betweenPhase':'leaderboard'});if(n<7)showStageIntro(n+1,()=>startStage(n+1));else showFinalResults();};
  }else{
    nb.classList.add('hidden');w.classList.remove('hidden');
    clearListeners();
    listenOn(`rooms/${roomCode}/game/level`,s=>{const lv=s.val();if(lv==='results'){clearListeners();showFinalResults();return;}if(typeof lv==='number'&&lv>n){clearListeners();showStageIntro(lv,()=>startStage(lv));}});
  }
}

// ============================================================
// LEADERBOARD + RESULTS  (identical to original)
// ============================================================
function animateCount(el,target){const dur=900,start=performance.now();const tick=now=>{const t=Math.min((now-start)/dur,1);const e=1-Math.pow(1-t,3);el.textContent=Math.round(e*target)+' pts';if(t<1)requestAnimationFrame(tick);};requestAnimationFrame(tick);}
function renderLeaderboard(id,pd){
  const c=document.getElementById(id);if(!c)return;c.innerHTML='';
  const sorted=Object.entries(pd).sort((a,b)=>(b[1].score||0)-(a[1].score||0));
  const medals=['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',...Array.from({length:30},(_,i)=>`${i+11}`)];
  sorted.forEach(([uid,p],i)=>{
    const row=document.createElement('div');row.className=`lb-row rank-${i+1}`;row.style.animationDelay=`${i*75}ms`;
    const init=(p.name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    row.innerHTML=`<span class="lb-avatar av-${i%10}">${init}</span><span class="lb-rank">${medals[i]||i+1}</span><span class="lb-name${uid===myUid?' you-tag':''}">${p.name}</span><span class="lb-score" data-score="${p.score||0}">0 pts</span>`;
    c.appendChild(row);
    setTimeout(()=>animateCount(row.querySelector('.lb-score'),p.score||0),200+i*75);
  });
}
function showFinalResults(){stopLocalTimer();stopJazz();get(dbRef('rooms',roomCode,'players')).then(s=>{players=s.val()||{};renderResults();});}
function renderResults(){
  const sorted=Object.entries(players).sort((a,b)=>(b[1].score||0)-(a[1].score||0)).map(([uid,p],i)=>({uid,...p,rank:i+1}));
  showScreen('screen-results');
  ['podium','full-leaderboard','results-actions','awards-row'].forEach(id=>{document.getElementById(id).innerHTML='';});
  const chOv=document.getElementById('champion-overlay');chOv.classList.add('hidden');chOv.classList.remove('champion-reveal','champion-building');
  const AWARDS=[{icon:'🏆',label:'Arcade Master',cond:p=>p.rank===1},{icon:'⚡',label:'Speed Demon',cond:p=>p.rank<=2},{icon:'🎯',label:'Precision Pro',cond:p=>p.score>3000},{icon:'🔥',label:'Combo King',cond:p=>p.rank<=3},{icon:'💎',label:'High Scorer',cond:p=>p.score>2000}];
  const RL={2:'🥈 2nd',3:'🥉 3rd',4:'4th',5:'5th'};
  const others=sorted.filter(p=>p.rank!==1).slice(0,4).reverse();
  const winner=sorted.find(p=>p.rank===1);
  const GAP=4000;let delay=800;
  others.forEach(p=>{setTimeout(()=>{sfxReveal();const card=document.createElement('div');card.className=`reveal-card rank-${p.rank}`;card.innerHTML=`<span class="reveal-rank">${RL[p.rank]||'#'+p.rank}</span><span class="reveal-name">${p.name}${p.uid===myUid?' (you)':''}</span><span class="reveal-score">${p.score||0} pts</span>`;document.getElementById('podium').appendChild(card);},delay);delay+=GAP;});
  if(winner){
    const bs=delay;
    setTimeout(()=>{chOv.classList.remove('hidden');chOv.classList.add('champion-building');document.getElementById('champion-who').classList.remove('hidden');sfxDrumroll();},bs);
    setTimeout(()=>spawnConfetti(),bs+2000);
    setTimeout(()=>{spawnConfetti();[0,150,300,450,600].forEach(t=>{setTimeout(()=>{const fl=document.createElement('div');fl.className='champ-flash';document.body.appendChild(fl);setTimeout(()=>fl.remove(),300);},t);});},bs+4000);
    setTimeout(()=>{spawnConfetti();sfxDrumroll();},bs+5500);
    setTimeout(()=>{document.getElementById('champion-who').classList.add('hidden');chOv.classList.remove('champion-building');document.getElementById('champion-name').textContent=winner.name+(winner.uid===myUid?' 🎉':'');document.getElementById('champion-score').textContent=(winner.score||0)+' pts';chOv.classList.add('champion-reveal');sfxChampion();spawnConfetti();setTimeout(spawnConfetti,400);setTimeout(spawnConfetti,800);},bs+7000);
    delay=bs+10000;
  }
  setTimeout(()=>{
    renderLeaderboard('full-leaderboard',players);
    const aw=document.getElementById('awards-row');
    sorted.forEach(p=>AWARDS.forEach(a=>{if(a.cond(p)){const b=document.createElement('div');b.className='award-badge';b.innerHTML=`<span class="aw-icon">${a.icon}</span><span>${p.name}: ${a.label}</span>`;aw.appendChild(b);}}));
    if(isHost){const pb=document.createElement('button');pb.className='btn-arcade-primary';pb.style.marginBottom='10px';pb.textContent='🔁 Play Again';pb.onclick=()=>{sfxClick();resetGame();};document.getElementById('results-actions').appendChild(pb);}
  },delay+500);
}

// ============================================================
// CONFETTI  (identical to original)
// ============================================================
function spawnConfetti(){
  const C=['#ff4757','#ffa502','#2ed573','#1e90ff','#a855f7','#ec4899','#ffd700','#06b6d4'];
  for(let i=0;i<75;i++){setTimeout(()=>{const el=document.createElement('div');el.className='confetti';el.style.cssText=`left:${rand(5,95)}vw;top:-14px;width:${rand(6,13)}px;height:${rand(6,13)}px;background:${pick(C)};border-radius:${Math.random()>.5?'50%':'3px'};animation:confettiFall ${rand(1.4,3.2)}s linear forwards;`;document.body.appendChild(el);setTimeout(()=>el.remove(),3500);},i*40);}
  if(!document.getElementById('confetti-style')){const s=document.createElement('style');s.id='confetti-style';s.textContent='@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(760deg);opacity:0}}';document.head.appendChild(s);}
}

// ============================================================
// RESET / MENU  (identical to original)
// ============================================================
async function resetGame(){
  if(isHost&&roomCode){const upd={};Object.keys(players).forEach(uid=>{upd[`players/${uid}/score`]=0;});Object.assign(upd,{'game/level':1,'game/round':0,'game/phase':'intro','game/betweenPhase':'leaderboard','game/roundSeed':Math.floor(Math.random()*100000),'status':'lobby'});await update(dbRef('rooms',roomCode),upd);}
  clearListeners();stopLocalTimer();clearGameLoops();Object.keys(players).forEach(uid=>{if(players[uid])players[uid].score=0;});openLobby();
}
function resetToMenu(){clearListeners();stopLocalTimer();clearGameLoops();stopJazz();players={};roomCode='';isHost=false;comboCount=0;showScreen('screen-menu');}

// ============================================================
// BUTTON LISTENERS  (identical to original)
// ============================================================
document.getElementById('btn-create').addEventListener('click',()=>{sfxClick();document.getElementById('modal-create').classList.remove('hidden');document.getElementById('input-host-name').focus();});
document.getElementById('btn-create-cancel').addEventListener('click',()=>document.getElementById('modal-create').classList.add('hidden'));
document.getElementById('btn-create-confirm').addEventListener('click',async()=>{const name=document.getElementById('input-host-name').value.trim();if(!name){showError('create-error','Enter your name.');return;}document.getElementById('btn-create-confirm').disabled=true;sfxClick();try{await createRoom(name);document.getElementById('modal-create').classList.add('hidden');}catch(e){showError('create-error',`Error: ${e?.code||e?.message||'?'}`);console.error(e);}document.getElementById('btn-create-confirm').disabled=false;});
document.getElementById('btn-join-open').addEventListener('click',()=>{sfxClick();document.getElementById('modal-join').classList.remove('hidden');document.getElementById('input-name').focus();});
document.getElementById('btn-join-cancel').addEventListener('click',()=>document.getElementById('modal-join').classList.add('hidden'));
document.getElementById('btn-join-confirm').addEventListener('click',async()=>{const name=document.getElementById('input-name').value.trim();const code=document.getElementById('input-code').value.trim().toUpperCase();if(!name){showError('join-error','Enter your name.');return;}if(code.length<4){showError('join-error','Enter 4-letter code.');return;}document.getElementById('btn-join-confirm').disabled=true;sfxClick();const err=await joinRoom(name,code);if(err)showError('join-error',err);else document.getElementById('modal-join').classList.add('hidden');document.getElementById('btn-join-confirm').disabled=false;});
document.getElementById('btn-copy-code').addEventListener('click',()=>{navigator.clipboard?.writeText(roomCode).catch(()=>{});showToast('Code copied!');});
document.getElementById('btn-leave-lobby').addEventListener('click',async()=>{sfxClick();if(roomCode&&myUid){await remove(dbRef('rooms',roomCode,'players',myUid));if(isHost)await remove(dbRef('rooms',roomCode));}resetToMenu();});
document.getElementById('btn-main-menu').addEventListener('click',()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-menu').addEventListener('click',()=>{sfxClick();resetToMenu();});
document.getElementById('btn-gameover-again').addEventListener('click',()=>{sfxClick();resetGame();});
document.getElementById('mute-btn-game').addEventListener('click',toggleMusic);
document.addEventListener('keydown',e=>{if(e.key==='Enter'){const cm=document.getElementById('modal-create'),jm=document.getElementById('modal-join');if(!cm.classList.contains('hidden'))document.getElementById('btn-create-confirm').click();else if(!jm.classList.contains('hidden'))document.getElementById('btn-join-confirm').click();}if(e.key==='Escape'){document.getElementById('modal-create').classList.add('hidden');document.getElementById('modal-join').classList.add('hidden');}});
document.getElementById('input-code').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase();});
document.addEventListener('click',()=>{if(musicOn&&!jazzInterval)startJazz();},{once:true});

// ============================================================
// BOOT  (identical to original)
// ============================================================
async function boot(){
  document.getElementById('loading-msg').textContent='Loading arcade…';
  showScreen('screen-loading');
  try{
    await initAuth();initConnectionMonitor();
    document.getElementById('loading-msg').textContent='Ready!';
    await new Promise(r=>setTimeout(r,800));
    showScreen('screen-menu');
  }catch(e){
    document.getElementById('loading-msg').textContent='Connection failed — check firebase.js';
    console.error('Boot error:',e);
  }
}
boot();
