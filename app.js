// ============================================================
// Between Stops: Escape Journey
// Cooperative 2-player platformer — built on Mind Maze infra
// ============================================================

import {
  db, auth, ref, set, get, update, onValue, onDisconnect,
  serverTimestamp, off, remove, signInAnonymously, onAuthStateChanged
} from './firebase.js';

// ============================================================
// AUDIO ENGINE (reused)
// ============================================================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx=null, musicInterval=null, musicOn=true;
function getACtx(){ if(!actx)actx=new AudioCtx(); if(actx.state==='suspended')actx.resume(); return actx; }
function playTone(freq,type='sine',dur=0.18,vol=0.15,delay=0){
  if(!musicOn)return;
  try{
    const ctx=getACtx(); const osc=ctx.createOscillator(); const gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination); osc.type=type;
    osc.frequency.setValueAtTime(freq,ctx.currentTime+delay);
    gain.gain.setValueAtTime(vol,ctx.currentTime+delay);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+delay+dur);
    osc.start(ctx.currentTime+delay); osc.stop(ctx.currentTime+delay+dur+0.05);
  }catch(e){}
}
const sfxJump    = ()=>{ playTone(440,'sine',0.08,0.18); playTone(600,'sine',0.06,0.12,0.05); };
const sfxLand    = ()=>playTone(180,'triangle',0.06,0.15);
const sfxHit     = ()=>playTone(150,'sawtooth',0.25,0.3);
const sfxRevive  = ()=>{ [523,659,784].forEach((f,i)=>playTone(f,'sine',0.12,0.2,i*0.08)); };
const sfxGoal    = ()=>{ [523,659,784,1047,1318].forEach((f,i)=>playTone(f,'sine',0.2,0.25,i*0.1)); };
const sfxCheckpt = ()=>{ playTone(880,'sine',0.15,0.2); playTone(1100,'sine',0.15,0.18,0.1); };
const sfxClick   = ()=>playTone(660,'triangle',0.06,0.12);
const sfxSync    = ()=>{ playTone(784,'sine',0.08,0.15); playTone(784,'sine',0.08,0.15,0.12); };
let ambiInterval=null;
function startAmbi(levelId){
  stopAmbi();
  const patterns=[
    [()=>{ playTone(130,'triangle',1.5,0.04); playTone(196,'triangle',1.2,0.03,0.5); }], // airport hum
    [()=>{ playTone(80,'sine',2,0.03); playTone(160,'sine',1.5,0.02,0.8); }],             // city rain
    [()=>{ playTone(110,'triangle',2,0.04); playTone(165,'triangle',1.5,0.03,1); }],      // station
    [()=>{ playTone(60,'sawtooth',0.5,0.06); playTone(90,'sawtooth',0.4,0.04,0.3); }],   // storm
    [()=>{ playTone(220,'sine',3,0.03); playTone(330,'sine',2.5,0.02,1); }],              // stars
  ];
  const p=patterns[(levelId-1)%patterns.length];
  ambiInterval=setInterval(()=>{ if(musicOn)p[0](); },3000);
}
function stopAmbi(){ if(ambiInterval){clearInterval(ambiInterval);ambiInterval=null;} }
function toggleMusic(){
  musicOn=!musicOn;
  document.querySelectorAll('.btn-mute-game').forEach(b=>b.textContent=musicOn?'🎵':'🔇');
  if(!musicOn) stopAmbi();
}

// ============================================================
// GAME CONSTANTS
// ============================================================
const VW=640, VH=360;           // virtual canvas resolution
const GND=310;                   // ground y in virtual coords
const GRAV=0.5;                  // gravity per frame
const JUMP_V=-11.5;              // jump velocity
const WALK_SPD=3.2;              // horizontal speed
const MAX_FALL=16;               // terminal velocity
const CHAR_W=22, CHAR_H=40;     // character bounding box
const SYNC_MS=50;                // firebase sync interval
const MAX_REVIVES=3;             // per level

// ============================================================
// STATE
// ============================================================
let myUid=null, myName='', roomCode='', isHost=false;
let partnerUid=null, partnerName='';
let activeListeners=[], syncTimer=null;
let gameRunning=false, gamePaused=false, rafId=null;
let currentLevelIdx=0, levelTime=0, teamworkScore=0, revivesLeft=MAX_REVIVES;
let totalRevives=0, syncBonuses=0;
let lastSyncTime=0;

// Player characters
const P1_COLOR='#4f8ef7', P2_COLOR='#e94560';
let myChar=null, partnerChar=null;

// Input state
const keys={};
const mobileKeys={left:false,right:false,down:false,jump:false,help:false};
let jumpConsumed=false, helpConsumed=false;

// Partner network state (what we received from Firebase)
let partnerNet={x:100,y:GND,vx:0,vy:0,state:'idle',face:1,grounded:true};

// Goal tracking
let p1AtGoal=false, p2AtGoal=false;
let goalHoldTime=0;
let checkpointActive=false, checkpointX=0;
let levelComplete=false;

// ============================================================
// UTILS
// ============================================================
function rand(a,b){return Math.random()*(b-a)+a;}
function randInt(a,b){return Math.floor(rand(a,b+1));}
function lerp(a,b,t){return a+(b-a)*t;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function dbRef(...parts){return ref(db,parts.join('/'));}
function listenOn(path,cb){ const r=dbRef(path); onValue(r,cb); activeListeners.push(r); return r; }
function clearListeners(){ activeListeners.forEach(r=>off(r)); activeListeners=[]; }
function stopSync(){ if(syncTimer){clearInterval(syncTimer);syncTimer=null;} }
function stopGame(){ gameRunning=false; if(rafId){cancelAnimationFrame(rafId);rafId=null;} stopSync(); stopAmbi(); }

function showToast(msg,dur=2000){
  const t=document.getElementById('toast');
  t.classList.remove('hidden'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tid); t._tid=setTimeout(()=>t.classList.remove('show'),dur);
}
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(id); if(el)el.classList.add('active');
}
function setConnected(ok){
  const el=document.getElementById('conn-indicator');
  el.classList.toggle('offline',!ok);
  document.getElementById('conn-label').textContent=ok?'Connected':'Reconnecting…';
}
function showError(id,msg){
  const el=document.getElementById(id); if(!el)return;
  el.textContent=msg; el.classList.remove('hidden');
  setTimeout(()=>el.classList.add('hidden'),4000);
}
function genCode(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:4},()=>c[randInt(0,c.length-1)]).join('');
}

// Touch ripple
function ripple(el,touch){
  const rect=el.getBoundingClientRect();
  const x=(touch?.clientX??rect.left+rect.width/2)-rect.left;
  const y=(touch?.clientY??rect.top+rect.height/2)-rect.top;
  const r=document.createElement('span');
  r.className='touch-ripple'; r.style.cssText=`left:${x}px;top:${y}px`;
  el.appendChild(r); setTimeout(()=>r.remove(),400);
}
function touchBtn(el,cb){
  if(!el)return;
  let t=false;
  el.addEventListener('touchstart',e=>{
    e.preventDefault(); t=true;
    ripple(el,e.touches[0]);
    el.classList.add('touch-active');
    try{navigator.vibrate?.(12);}catch(e){}
    cb(e);
  },{passive:false});
  el.addEventListener('touchend',()=>setTimeout(()=>{t=false;el.classList.remove('touch-active');},80),{passive:true});
  el.addEventListener('click',e=>{if(t){return;} ripple(el); cb(e);});
}

// ============================================================
// AUTH
// ============================================================
async function initAuth(){
  document.getElementById('loading-msg').textContent='Authenticating…';
  await signInAnonymously(auth);
  return new Promise(res=>{
    const u=onAuthStateChanged(auth,user=>{if(user){myUid=user.uid;u();res();}});
  });
}
function initConn(){ onValue(dbRef('.info/connected'),s=>setConnected(!!s.val())); }

// ============================================================
// ROOM CREATION
// ============================================================
async function createRoom(hostName){
  myName=hostName.trim(); isHost=true; roomCode=genCode();
  const r=dbRef('rooms',roomCode);
  if((await get(r)).exists()) roomCode=genCode();
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await set(r,{
    host:myUid, status:'lobby', created:serverTimestamp(),
    game:{level:0,teamwork:0,revives:0},
    players:{[myUid]:{name:myName,slot:1,ready:false,x:80,y:GND,state:'idle',face:1}}
  });
  openLobby();
}
async function joinRoom(name,code){
  myName=name.trim();
  const upper=code.trim().toUpperCase();
  const snap=await get(dbRef('rooms',upper));
  if(!snap.exists()) return 'Room not found.';
  const d=snap.val();
  if(d.status==='playing') return 'Game already in progress.';
  const list=Object.keys(d.players||{});
  if(list.length>=2) return 'Room is full (2 players max).';
  roomCode=upper; isHost=false;
  await onDisconnect(dbRef('rooms',roomCode,'players',myUid)).remove();
  await update(dbRef('rooms',roomCode,'players'),{
    [myUid]:{name:myName,slot:2,ready:false,x:120,y:GND,state:'idle',face:1}
  });
  openLobby(); return null;
}

// ============================================================
// LOBBY
// ============================================================
function openLobby(){
  showScreen('screen-lobby');
  document.getElementById('lobby-room-code').textContent=roomCode;

  // Generate QR code pointing to this page with the room code pre-filled
  const qrEl = document.getElementById('lobby-qr');
  qrEl.innerHTML = '';
  const joinUrl = `${location.origin}${location.pathname}?code=${roomCode}`;
  new QRCode(qrEl, {
    text: joinUrl,
    width: 120, height: 120,
    colorDark: '#ffffff', colorLight: '#10102a',
    correctLevel: QRCode.CorrectLevel.M
  });
  clearListeners();
  listenOn(`rooms/${roomCode}/players`,snap=>{
    const pl=snap.val()||{};
    updateLobbySlots(pl);
    // Check if partner joined/left
    const uids=Object.keys(pl);
    partnerUid=uids.find(u=>u!==myUid)||null;
    if(partnerUid) partnerName=pl[partnerUid].name;
  });
  listenOn(`rooms/${roomCode}/status`,snap=>{
    if(snap.val()==='playing'){ clearListeners(); launchGame(); }
  });
  listenOn(`rooms/${roomCode}`,snap=>{
    if(!snap.exists()){ showToast('Room closed.'); resetToMenu(); }
  });
}
function updateLobbySlots(players){
  const entries=Object.entries(players);
  // My slot
  const me=players[myUid];
  if(me){
    const slot=me.slot===1?'p1':'p2';
    document.getElementById(`slot-${slot}-name`).textContent=myName;
    const st=document.getElementById(`slot-${slot}-status`);
    st.textContent='● Connected'; st.className='slot-status online';
  }
  // Partner slot
  const partner=entries.find(([u])=>u!==myUid);
  if(partner){
    const [,pd]=partner;
    const slot=pd.slot===1?'p1':'p2';
    document.getElementById(`slot-${slot}-name`).textContent=pd.name;
    const st=document.getElementById(`slot-${slot}-status`);
    st.textContent='● Connected'; st.className='slot-status online';
  }
  const count=entries.length;
  const hint=document.getElementById('lobby-hint');
  const startBtn=document.getElementById('btn-start-game');
  if(count===2){
    hint.textContent='Both players connected! Ready to go!';
    if(isHost){ startBtn.classList.remove('hidden'); startBtn.disabled=false; }
  } else {
    hint.textContent='Share the room code with your travel partner!';
    if(isHost) startBtn.classList.add('hidden');
  }
}
async function hostStartGame(){
  document.getElementById('btn-start-game').disabled=true;
  await update(dbRef('rooms',roomCode),{status:'playing','game/level':1});
}

// ============================================================
// LEVEL DATA
// ============================================================
// Platform: {x,y,w,h,type:'solid'|'conveyor'|'crumble', vx?}
// Hazard: {type:'cart'|'car'|'crowd'|'debris', x,y,w,h, speed,range, dir:1|-1}
// All hazards are deterministic from levelTime — both clients compute same positions
function getHazardPos(h,t){
  if(h.type==='debris'){
    // Falls periodically from above
    const cycle=(t*0.001)%h.period;
    const fall=cycle<h.period*0.5 ? cycle/(h.period*0.5)*h.fallDist : h.fallDist;
    return {x:h.x,y:h.startY+fall,w:h.w,h:h.h};
  }
  // Patrol: bounce between x and x+range
  const period=h.range/h.speed*2;
  const phase=(t*0.001*h.speed)%period;
  const off=phase<period/2 ? phase*h.speed : (period-phase)*h.speed;
  const ox=h.dir===1?off:-off;
  return {x:h.x+ox,y:h.y,w:h.w,h:h.h};
}

const LEVELS=[
  // ── LEVEL 1: AIRPORT RUSH ──────────────────────────────────
  {id:1, name:'Airport Rush', emoji:'✈️', desc:'Late for your flight. Both of you. Run!',
   worldW:2800,
   bgFn:'drawBgAirport',
   platforms:[
    {x:0,   y:GND, w:480, h:50,type:'solid'},
    {x:530, y:GND, w:300, h:50,type:'conveyor',vx:-1.8},
    {x:530, y:230, w:120, h:18,type:'solid'},
    {x:880, y:GND, w:250, h:50,type:'solid'},
    {x:1000,y:240, w:100, h:18,type:'solid'},
    {x:1180,y:GND, w:500, h:50,type:'conveyor',vx:2},
    {x:1180,y:210, w:80,  h:18,type:'solid'},
    {x:1740,y:GND, w:300, h:50,type:'solid'},
    {x:1800,y:230, w:120, h:18,type:'solid'},
    {x:2100,y:GND, w:200, h:50,type:'solid'},
    {x:2100,y:220, w:160, h:18,type:'solid'},
    {x:2360,y:GND, w:440, h:50,type:'solid'},
    {x:2360,y:200, w:80,  h:18,type:'solid'},
   ],
   hazards:[
    {type:'cart',x:200, y:GND-38,w:42,h:38,speed:1.8,range:180,dir:1},
    {type:'cart',x:620, y:GND-38,w:42,h:38,speed:2.2,range:120,dir:-1},
    {type:'cart',x:1300,y:GND-38,w:42,h:38,speed:2.5,range:200,dir:1},
    {type:'cart',x:1900,y:GND-38,w:36,h:38,speed:3.0,range:160,dir:-1},
    {type:'crowd',x:2200,y:GND-36,w:28,h:36,speed:1.5,range:100,dir:1},
    {type:'crowd',x:2450,y:GND-36,w:28,h:36,speed:2.0,range:120,dir:-1},
   ],
   spawnP1:{x:60,y:GND}, spawnP2:{x:110,y:GND},
   checkpoint:{x:1500,y:GND-50,w:80,h:50},
   goal:{x:2620,y:GND-70,w:100,h:70},
   goalLabel:'✈️ Gate B7',
  },
  // ── LEVEL 2: CITY CROSSING ─────────────────────────────────
  {id:2, name:'City Crossing', emoji:'🌆', desc:'Neon city at night. The train leaves in minutes.',
   worldW:3000,
   bgFn:'drawBgCity',
   platforms:[
    {x:0,   y:GND, w:300, h:50,type:'solid'},
    {x:0,   y:200, w:160, h:18,type:'solid'},
    {x:360, y:240, w:200, h:18,type:'solid'},
    {x:620, y:200, w:140, h:18,type:'solid'},
    {x:820, y:260, w:120, h:18,type:'solid'},
    {x:1010,y:220, w:180, h:18,type:'solid'},
    {x:1250,y:260, w:100, h:18,type:'solid'},
    {x:1420,y:200, w:160, h:18,type:'solid'},
    {x:1650,y:240, w:200, h:50,type:'solid'},
    {x:1910,y:220, w:120, h:18,type:'solid'},
    {x:2090,y:260, w:140, h:18,type:'solid'},
    {x:2300,y:200, w:200, h:18,type:'solid'},
    {x:2560,y:240, w:160, h:18,type:'solid'},
    {x:2780,y:GND, w:220, h:50,type:'solid'},
    {x:2780,y:180, w:180, h:18,type:'solid'},
   ],
   hazards:[
    // Cars on street level (deadly fall zone y>330 handled separately)
    {type:'car',x:400, y:GND-30,w:60,h:30,speed:4.5,range:300,dir:1},
    {type:'car',x:900, y:GND-30,w:60,h:30,speed:5,  range:350,dir:-1},
    {type:'car',x:1700,y:GND-30,w:60,h:30,speed:6,  range:400,dir:1},
    {type:'car',x:2400,y:GND-30,w:60,h:30,speed:5.5,range:350,dir:-1},
    {type:'crowd',x:1100,y:GND-36,w:28,h:36,speed:2,range:100,dir:1},
   ],
   spawnP1:{x:50,y:GND}, spawnP2:{x:100,y:GND},
   checkpoint:{x:1550,y:200,w:80,h:50},
   goal:{x:2820,y:150,w:100,h:70},
   goalLabel:'🚉 Train Station',
  },
  // ── LEVEL 3: LOST IN THE STATION ───────────────────────────
  {id:3, name:'Lost in the Station', emoji:'🚉', desc:'Massive station, wrong platforms everywhere.',
   worldW:2600,
   bgFn:'drawBgStation',
   platforms:[
    {x:0,   y:GND, w:500, h:50,type:'solid'},
    {x:0,   y:220, w:200, h:18,type:'solid'},
    {x:0,   y:140, w:140, h:18,type:'solid'},
    {x:560, y:GND, w:220, h:50,type:'solid'},
    {x:560, y:240, w:180, h:18,type:'solid'},
    {x:840, y:200, w:150, h:18,type:'solid'},
    {x:840, y:GND, w:300, h:50,type:'solid'},
    {x:1200,y:260, w:100, h:18,type:'solid'},
    {x:1200,y:180, w:160, h:18,type:'solid'},
    {x:1420,y:GND, w:400, h:50,type:'solid'},
    {x:1420,y:220, w:120, h:18,type:'solid'},
    {x:1600,y:140, w:100, h:18,type:'solid'},
    {x:1880,y:260, w:140, h:18,type:'solid'},
    {x:1880,y:GND, w:300, h:50,type:'solid'},
    {x:2240,y:GND, w:360, h:50,type:'solid'},
    {x:2240,y:200, w:180, h:18,type:'solid'},
   ],
   hazards:[
    {type:'crowd',x:120, y:GND-36,w:28,h:36,speed:2,  range:120,dir:1},
    {type:'crowd',x:300, y:GND-36,w:28,h:36,speed:1.5,range:80, dir:-1},
    {type:'crowd',x:700, y:GND-36,w:28,h:36,speed:2.5,range:100,dir:1},
    {type:'crowd',x:950, y:GND-36,w:28,h:36,speed:2,  range:150,dir:-1},
    {type:'crowd',x:1500,y:GND-36,w:28,h:36,speed:3,  range:120,dir:1},
    {type:'crowd',x:2000,y:GND-36,w:28,h:36,speed:2.5,range:90, dir:-1},
    {type:'crowd',x:2300,y:GND-36,w:28,h:36,speed:2,  range:100,dir:1},
   ],
   spawnP1:{x:50,y:GND}, spawnP2:{x:100,y:GND},
   checkpoint:{x:1300,y:150,w:80,h:50},
   goal:{x:2400,y:170,w:100,h:70},
   goalLabel:'🚆 Platform 7',
   syncDoor:{x:1350,y:GND-80,w:60,h:80}, // both players needed nearby to open
  },
  // ── LEVEL 4: STORM JOURNEY ─────────────────────────────────
  {id:4, name:'Storm Journey', emoji:'⛈️', desc:'Dangerous storm. Stay together or fall.',
   worldW:3000,
   bgFn:'drawBgStorm',
   wind:-1.2, // constant left push
   platforms:[
    {x:0,   y:GND, w:350, h:50,type:'solid'},
    {x:400, y:GND, w:200, h:50,type:'solid'},
    {x:400, y:240, w:120, h:18,type:'solid'},
    {x:660, y:260, w:100, h:18,type:'crumble'},
    {x:820, y:220, w:140, h:18,type:'solid'},
    {x:1020,y:260, w:100, h:18,type:'crumble'},
    {x:1180,y:GND, w:300, h:50,type:'solid'},
    {x:1180,y:200, w:140, h:18,type:'solid'},
    {x:1540,y:240, w:120, h:18,type:'crumble'},
    {x:1720,y:200, w:160, h:18,type:'solid'},
    {x:1940,y:260, w:100, h:18,type:'crumble'},
    {x:2100,y:GND, w:350, h:50,type:'solid'},
    {x:2100,y:220, w:120, h:18,type:'solid'},
    {x:2510,y:240, w:120, h:18,type:'crumble'},
    {x:2690,y:GND, w:310, h:50,type:'solid'},
    {x:2690,y:190, w:200, h:18,type:'solid'},
   ],
   hazards:[
    {type:'debris',x:500, y:0,startY:-40,fallDist:320,w:30,h:30,period:3.5},
    {type:'debris',x:900, y:0,startY:-40,fallDist:280,w:24,h:24,period:2.8},
    {type:'debris',x:1300,y:0,startY:-40,fallDist:310,w:28,h:28,period:3.2},
    {type:'debris',x:1800,y:0,startY:-40,fallDist:290,w:32,h:32,period:2.5},
    {type:'debris',x:2200,y:0,startY:-40,fallDist:300,w:26,h:26,period:3.0},
    {type:'debris',x:2600,y:0,startY:-40,fallDist:320,w:30,h:30,period:2.7},
   ],
   spawnP1:{x:50,y:GND}, spawnP2:{x:100,y:GND},
   checkpoint:{x:1600,y:170,w:80,h:50},
   goal:{x:2750,y:160,w:100,h:70},
   goalLabel:'⛺ Shelter',
  },
  // ── LEVEL 5: BETWEEN STOPS FINAL ──────────────────────────
  {id:5, name:'Between Stops', emoji:'🌌', desc:'Quiet. Stars. The journey ends together.',
   worldW:2400,
   bgFn:'drawBgFinal',
   platforms:[
    // Train carriages
    {x:0,   y:GND, w:300, h:50,type:'solid'},
    {x:0,   y:GND, w:300, h:8, type:'solid'}, // carriage top edge accent
    {x:320, y:GND, w:280, h:50,type:'solid'},
    {x:620, y:GND, w:280, h:50,type:'solid'},
    {x:920, y:GND, w:280, h:50,type:'solid'},
    {x:1220,y:GND, w:280, h:50,type:'solid'},
    // Upper carriages
    {x:100, y:220, w:200, h:18,type:'solid'},
    {x:380, y:200, w:160, h:18,type:'solid'},
    {x:620, y:240, w:140, h:18,type:'solid'},
    {x:840, y:200, w:180, h:18,type:'solid'},
    {x:1100,y:240, w:140, h:18,type:'solid'},
    {x:1280,y:200, w:160, h:18,type:'solid'},
    // Final stretch
    {x:1520,y:GND, w:880, h:50,type:'solid'},
    {x:1560,y:220, w:120, h:18,type:'solid'},
    {x:1780,y:200, w:160, h:18,type:'solid'},
    {x:2000,y:230, w:120, h:18,type:'solid'},
   ],
   hazards:[
    {type:'crowd',x:400, y:GND-36,w:20,h:36,speed:1,range:60,dir:1},
    {type:'crowd',x:900, y:GND-36,w:20,h:36,speed:1.2,range:60,dir:-1},
    {type:'crowd',x:1600,y:GND-36,w:20,h:36,speed:0.8,range:50,dir:1},
   ],
   spawnP1:{x:50,y:GND}, spawnP2:{x:100,y:GND},
   checkpoint:{x:1100,y:GND-50,w:80,h:50},
   goal:{x:2180,y:GND-80,w:160,h:80}, // final bench — wide goal
   goalLabel:'🌌 Final Stop',
  },
];

// ============================================================
// CHARACTER FACTORY
// ============================================================
function makeChar(spawn,color,name,slot){
  return {
    x:spawn.x, y:spawn.y,
    vx:0, vy:0,
    grounded:false,
    face:1, // 1=right, -1=left
    state:'idle', // idle|walk|jump|fall|crouch|down
    walkCycle:0,
    color, name, slot,
    downed:false, downTimer:0,
    crumbleTimers:{}, // track crumble platform timers
  };
}

// ============================================================
// PHYSICS
// ============================================================
function updatePhysics(char,platforms,wind=0){
  if(char.downed) return;

  // Apply gravity + wind
  char.vy+=GRAV;
  char.vy=Math.min(char.vy,MAX_FALL);
  if(wind) char.vx+=wind*0.05;

  // Clamp horizontal speed
  const maxSpd=WALK_SPD+1;
  char.vx=clamp(char.vx,-maxSpd,maxSpd);

  // Store previous position
  const prevY=char.y;
  const prevX=char.x;

  char.x+=char.vx;
  char.y+=char.vy;
  char.grounded=false;

  // Platform collision
  const lvl=LEVELS[currentLevelIdx];
  for(const p of platforms){
    const cL=char.x-CHAR_W/2, cR=char.x+CHAR_W/2;
    const cT=char.y-CHAR_H, cB=char.y;
    const pL=p.x, pR=p.x+p.w, pT=p.y, pB=p.y+p.h;

    // Horizontal overlap?
    if(cR<=pL||cL>=pR) continue;

    // Top collision (landing)
    if(prevY<=pT&&cB>=pT&&char.vy>=0){
      char.y=pT; char.vy=0; char.grounded=true;
      if(char.vy===0&&!char._wasGrounded) sfxLand();

      if(p.type==='conveyor'&&p.vx) char.x+=p.vx;

      if(p.type==='crumble'){
        const pid=`${p.x}_${p.y}`;
        if(!char.crumbleTimers[pid]) char.crumbleTimers[pid]=Date.now();
        else if(Date.now()-char.crumbleTimers[pid]>1200){
          // Platform dissolves — nothing to do in data, player just falls
          char.crumbleTimers[pid]=Date.now()+5000; // grace period
        }
      }
      break;
    }
    // Bottom collision (head bump)
    if(prevY-CHAR_H>=pB&&cT<=pB&&char.vy<0){
      char.vy=0; char.y=pB+CHAR_H;
    }
    // Side collisions (walls) — only for solid platforms
    if(p.type==='solid'&&cB>pT&&cT<pB){
      if(char.vx>0&&prevX!==undefined&&char.x-CHAR_W/2<pR&&prevX+CHAR_W/2<=pL){
        char.x=pL-CHAR_W/2; char.vx=0;
      } else if(char.vx<0&&char.x+CHAR_W/2>pL){
        char.x=pR+CHAR_W/2; char.vx=0;
      }
    }
  }
  char._wasGrounded=char.grounded;

  // World bounds
  const lvlW=LEVELS[currentLevelIdx].worldW;
  char.x=clamp(char.x,CHAR_W/2,lvlW-CHAR_W/2);

  // Friction
  if(char.grounded){
    char.vx*=0.78;
    if(Math.abs(char.vx)<0.1) char.vx=0;
  }

  // Update state
  if(char.downed) char.state='down';
  else if(!char.grounded) char.state=char.vy<0?'jump':'fall';
  else if(char.state==='crouch') {}
  else if(Math.abs(char.vx)>0.2) char.state='walk';
  else char.state='idle';

  if(char.state==='walk') char.walkCycle+=2.5;

  // Face direction
  if(char.vx>0.2) char.face=1;
  else if(char.vx<-0.2) char.face=-1;
}

// ============================================================
// CAMERA
// ============================================================
let cam={x:0,y:0};
function updateCamera(){
  const lvlW=LEVELS[currentLevelIdx].worldW;
  const midX=(myChar.x+(partnerChar.downed?myChar.x:partnerChar.x))/2;
  const targetX=midX-VW/2;
  cam.x=lerp(cam.x,clamp(targetX,0,lvlW-VW),0.07);
}

// ============================================================
// HAZARD COLLISION
// ============================================================
function checkHazardHit(char,hazards,t){
  if(char.downed) return false;
  const cL=char.x-CHAR_W/2+4, cR=char.x+CHAR_W/2-4;
  const cT=char.y-CHAR_H+4, cB=char.y-2;
  for(const h of hazards){
    const p=getHazardPos(h,t);
    if(cR>p.x&&cL<p.x+p.w&&cB>p.y&&cT<p.y+p.h) return true;
  }
  return false;
}

// ============================================================
// PLAYER INPUT PROCESSING
// ============================================================
function processInput(char){
  if(!char||char.downed) return;
  const left  = keys['ArrowLeft']||keys['a']||keys['A']||mobileKeys.left;
  const right = keys['ArrowRight']||keys['d']||keys['D']||mobileKeys.right;
  const jump  = keys[' ']||keys['ArrowUp']||keys['w']||keys['W']||mobileKeys.jump;
  const down  = keys['ArrowDown']||keys['s']||keys['S']||mobileKeys.down;
  const help  = keys['e']||keys['E']||mobileKeys.help;

  if(left)  char.vx-=0.7;
  if(right) char.vx+=0.7;

  if(jump&&!jumpConsumed&&char.grounded){
    char.vy=JUMP_V; char.grounded=false;
    jumpConsumed=true; sfxJump();
  }
  if(!jump) jumpConsumed=false;

  if(down&&char.grounded) char.state='crouch';
  else if(char.state==='crouch'&&!down) char.state='idle';

  // Help/revive
  if(help&&!helpConsumed){
    helpConsumed=true;
    tryRevivePartner();
  }
  if(!help) helpConsumed=false;
}

// ============================================================
// COOPERATIVE MECHANICS
// ============================================================
function tryRevivePartner(){
  if(!partnerChar.downed) return;
  const dist=Math.abs(myChar.x-partnerChar.x);
  if(dist<80){
    // Start revive — show progress, complete after 2s
    revivePartner();
  } else {
    showToast('Get closer to revive your partner! 🤝');
  }
}
function revivePartner(){
  if(revivesLeft<=0){ showToast('No revives left! ❤️'); return; }
  revivesLeft--;
  totalRevives++;
  partnerChar.downed=false;
  partnerChar.x=myChar.x+30; partnerChar.y=myChar.y;
  partnerChar.vx=0; partnerChar.vy=0;
  partnerChar.state='idle';
  addTeamwork(25);
  sfxRevive();
  showToast(`${partnerName} revived! 🤝 +25 teamwork`);
  document.getElementById('hud-rv-val').textContent=revivesLeft;
  // Sync to firebase
  update(dbRef('rooms',roomCode),{
    'game/revives':(totalRevives),
    [`players/${partnerUid}/downed`]:false,
    [`players/${partnerUid}/x`]:partnerChar.x,
    [`players/${partnerUid}/y`]:partnerChar.y,
  });
}
function addTeamwork(pts){
  teamworkScore+=pts;
  document.getElementById('hud-tw-val').textContent=teamworkScore;
}

// ============================================================
// GOAL / CHECKPOINT LOGIC
// ============================================================
function checkGoals(lvl,t){
  if(levelComplete) return;

  // Sync door (Level 3)
  if(lvl.syncDoor){
    const d=lvl.syncDoor;
    const p1Near=Math.abs(myChar.x-d.x-d.w/2)<90&&myChar.y>=d.y;
    const p2Near=Math.abs(partnerChar.x-d.x-d.w/2)<90&&partnerChar.y>=d.y;
    if(p1Near&&p2Near){
      // Door opens — mark it
      if(!lvl._doorOpen){ lvl._doorOpen=true; sfxSync(); addTeamwork(15); showToast('Door opened! 🤝'); }
    }
  }

  // Checkpoint
  if(!checkpointActive&&lvl.checkpoint){
    const ck=lvl.checkpoint;
    const p1On=myChar.x>ck.x&&myChar.x<ck.x+ck.w&&myChar.y<=ck.y+ck.h&&!myChar.downed;
    const p2On=partnerChar.x>ck.x&&partnerChar.x<ck.x+ck.w&&partnerChar.y<=ck.y+ck.h&&!partnerChar.downed;
    if(p1On&&p2On){
      checkpointActive=true; checkpointX=ck.x+ck.w/2;
      sfxCheckpt(); addTeamwork(20);
      showToast('Checkpoint! ✅ +20 teamwork');
    }
  }

  // Goal — both players need to be on it
  const g=lvl.goal;
  const p1AtG=myChar.x>g.x&&myChar.x<g.x+g.w&&myChar.y<=g.y+g.h&&!myChar.downed;
  const p2AtG=partnerChar.x>g.x&&partnerChar.x<g.x+g.w&&partnerChar.y<=g.y+g.h&&!partnerChar.downed;

  if(p1AtG&&p2AtG){
    goalHoldTime+=1/60;
    if(goalHoldTime>=1.5){ completeLevelTrigger(lvl); }
  } else {
    goalHoldTime=Math.max(0,goalHoldTime-0.5/60);
  }

  // Progress bar
  const pct=Math.min(1,myChar.x/lvl.worldW);
  document.getElementById('hud-progress-fill').style.width=(pct*100)+'%';
}

function completeLevelTrigger(lvl){
  if(levelComplete) return;
  levelComplete=true;
  addTeamwork(50);
  sfxGoal();
  const isLast=currentLevelIdx>=LEVELS.length-1;
  const ov=document.getElementById('goal-overlay');
  ov.classList.remove('hidden');
  document.getElementById('goal-emoji').textContent=isLast?'🌌':'🎉';
  document.getElementById('goal-title').textContent=isLast?'Journey Complete!':'Level Complete!';
  document.getElementById('goal-sub').textContent=isLast?'What a trip together…':'Loading next stop…';
  // Sync via firebase
  if(isHost){
    update(dbRef('rooms',roomCode),{'game/teamwork':teamworkScore,'game/level':isLast?'end':lvl.id+1});
  }
  setTimeout(()=>{
    ov.classList.add('hidden');
    if(isLast) showEndingScreen();
    else loadNextLevel();
  },2800);
}

function loadNextLevel(){
  currentLevelIdx++;
  levelComplete=false; goalHoldTime=0; checkpointActive=false;
  revivesLeft=MAX_REVIVES; levelTime=0;
  const lvl=LEVELS[currentLevelIdx];
  myChar=makeChar(lvl.spawnP1,isHost?P1_COLOR:P2_COLOR,myName,isHost?1:2);
  partnerChar=makeChar(lvl.spawnP2,isHost?P2_COLOR:P1_COLOR,partnerName,isHost?2:1);
  document.getElementById('hud-rv-val').textContent=revivesLeft;
  document.getElementById('hud-level-name').textContent=lvl.name;
  showLevelIntro(lvl);
}

// ============================================================
// SYNC TO FIREBASE
// ============================================================
function startSync(){
  stopSync();
  syncTimer=setInterval(()=>{
    if(!myChar||!roomCode||!myUid) return;
    update(dbRef('rooms',roomCode,'players',myUid),{
      x:Math.round(myChar.x), y:Math.round(myChar.y),
      vx:Math.round(myChar.vx*10)/10,
      vy:Math.round(myChar.vy*10)/10,
      state:myChar.state, face:myChar.face,
      downed:myChar.downed||false,
    });
  },SYNC_MS);
}
function listenPartner(){
  if(!partnerUid) return;
  listenOn(`rooms/${roomCode}/players/${partnerUid}`,snap=>{
    if(!snap.exists()) return;
    const d=snap.val();
    partnerNet={x:d.x||100,y:d.y||GND,vx:d.vx||0,vy:d.vy||0,state:d.state||'idle',face:d.face||1,downed:d.downed||false};
    partnerChar.state=partnerNet.state;
    partnerChar.face=partnerNet.face;
    partnerChar.downed=partnerNet.downed;
    // Smooth interpolation — let partnerChar smoothly catch up
    partnerChar.x=lerp(partnerChar.x,partnerNet.x,0.25);
    partnerChar.y=lerp(partnerChar.y,partnerNet.y,0.25);
  });
  listenOn(`rooms/${roomCode}/players/${partnerUid}/downed`,snap=>{
    if(!snap.exists()) return;
    partnerChar.downed=snap.val();
  });
  // Listen for disconnect
  listenOn(`rooms/${roomCode}/players/${partnerUid}`,snap=>{
    if(!snap.exists()&&gameRunning){
      document.getElementById('pause-overlay').classList.remove('hidden');
      gamePaused=true;
    } else if(snap.exists()&&gamePaused){
      document.getElementById('pause-overlay').classList.add('hidden');
      gamePaused=false;
    }
  });
}

// ============================================================
// RENDERING HELPERS
// ============================================================
let canv, ctx2;
function getRenderCtx(){ return ctx2; }

function roundRect(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.arcTo(x+w,y,x+w,y+r,r);
  c.lineTo(x+w,y+h-r); c.arcTo(x+w,y+h,x+w-r,y+h,r);
  c.lineTo(x+r,y+h); c.arcTo(x,y+h,x,y+h-r,r);
  c.lineTo(x,y+r); c.arcTo(x,y,x+r,y,r);
  c.closePath();
}

function drawPlatforms(c,platforms,camX){
  for(const p of platforms){
    const sx=p.x-camX;
    if(sx+p.w<0||sx>VW) continue;
    if(p.type==='conveyor'){
      c.fillStyle='#2a3a5c';
      roundRect(c,sx,p.y,p.w,p.h,4); c.fill();
      c.fillStyle='rgba(79,142,247,0.4)';
      const arrowSpacing=32;
      const offset=((levelTime*p.vx*0.8)%arrowSpacing+arrowSpacing)%arrowSpacing;
      for(let ax=sx-arrowSpacing+offset;ax<sx+p.w;ax+=arrowSpacing){
        c.fillText(p.vx>0?'→':'←',ax,p.y+12);
      }
    } else if(p.type==='crumble'){
      c.fillStyle='#5a3a2a';
      roundRect(c,sx,p.y,p.w,p.h,4); c.fill();
      c.strokeStyle='rgba(200,100,50,0.5)'; c.lineWidth=1;
      for(let xi=sx;xi<sx+p.w;xi+=8){ c.beginPath();c.moveTo(xi,p.y);c.lineTo(xi-4,p.y+p.h);c.stroke(); }
    } else {
      const grad=c.createLinearGradient(0,p.y,0,p.y+p.h);
      grad.addColorStop(0,'#2d3a5a'); grad.addColorStop(1,'#1a2440');
      c.fillStyle=grad;
      roundRect(c,sx,p.y,p.w,p.h,4); c.fill();
      c.strokeStyle='rgba(79,142,247,0.25)'; c.lineWidth=1;
      c.stroke();
      // Top edge highlight
      c.strokeStyle='rgba(100,160,255,0.4)'; c.lineWidth=2;
      c.beginPath(); c.moveTo(sx+4,p.y); c.lineTo(sx+p.w-4,p.y); c.stroke();
    }
  }
}

function drawHazards(c,hazards,t,camX){
  const HCOLORS={cart:'#e6a830',car:'#e94560',crowd:'#8888aa',debris:'#7a5a3a'};
  const HEMOJI ={cart:'🧳',car:'🚗',crowd:'👤',debris:'🪨'};
  for(const h of hazards){
    const p=getHazardPos(h,t);
    const sx=p.x-camX;
    if(sx+p.w<-20||sx>VW+20) continue;
    // Glow
    c.shadowColor=HCOLORS[h.type]; c.shadowBlur=6;
    c.fillStyle=HCOLORS[h.type]+'88';
    roundRect(c,sx,p.y,p.w,p.h,4); c.fill();
    c.shadowBlur=0;
    c.font=`${Math.min(p.w,p.h)*0.8}px sans-serif`;
    c.textAlign='center';
    c.fillText(HEMOJI[h.type],sx+p.w/2,p.y+p.h*0.85);
  }
}

function drawCharacter(c,char,camX){
  const sx=char.x-camX;
  if(sx<-40||sx>VW+40) return;
  const sy=char.y;

  c.save();
  if(char.face===-1){ c.translate(sx*2,0); c.scale(-1,1); }

  // Down state — slumped
  if(char.downed){
    c.globalAlpha=0.7;
    c.fillStyle=char.color;
    roundRect(c,sx-12,sy-12,24,12,4); c.fill();
    c.fillStyle='#f5c89a';
    c.beginPath(); c.arc(sx,sy-20,9,0,Math.PI*2); c.fill();
    // Help prompt
    c.globalAlpha=1;
    c.font='11px sans-serif'; c.textAlign='center';
    c.fillStyle='#fff';
    c.fillText('[E] Revive',sx,sy-34);
    c.restore(); return;
  }

  // Shadow
  c.globalAlpha=0.3;
  c.fillStyle='#000';
  c.beginPath(); c.ellipse(sx,sy+1,11,4,0,0,Math.PI*2); c.fill();
  c.globalAlpha=1;

  // Glow
  c.shadowColor=char.color; c.shadowBlur=10;

  // Backpack
  c.fillStyle=char.color+'99';
  roundRect(c,sx-15,sy-30,9,16,3); c.fill();

  // Body
  c.fillStyle=char.color;
  roundRect(c,sx-10,sy-26,20,18,4); c.fill();

  // Head
  c.shadowBlur=0;
  c.fillStyle='#f5c89a';
  c.beginPath(); c.arc(sx,sy-36,10,0,Math.PI*2); c.fill();

  // Hair
  c.fillStyle=char.slot===1?'#1a1a3e':'#3a1a0a';
  c.beginPath(); c.arc(sx,sy-41,10,Math.PI*1.05,Math.PI*0.05,true); c.fill();

  // Eyes (animated — blink sometimes)
  c.fillStyle='#222';
  c.fillRect(sx-4,sy-39,3,3);
  c.fillRect(sx+2,sy-39,3,3);

  // Mouth — smile when grounded
  if(char.grounded&&char.state!=='crouch'){
    c.strokeStyle='#333'; c.lineWidth=1.5;
    c.beginPath(); c.arc(sx,sy-32,4,0,Math.PI,false); c.stroke();
  }

  // Legs
  const legColor=c.fillStyle=char.slot===1?'#3a6abf':'#bf3a5a';
  c.fillStyle=legColor;
  if(char.state==='jump'){
    c.fillRect(sx-8,sy-8,6,10); c.fillRect(sx+2,sy-8,6,10);
  } else if(char.state==='crouch'){
    c.fillRect(sx-8,sy-4,6,4); c.fillRect(sx+2,sy-4,6,4);
    c.fillStyle='#f5c89a';
    c.beginPath(); c.arc(sx,sy-32+12,10,0,Math.PI*2); c.fill();
  } else {
    const swing=char.state==='walk'?Math.sin(char.walkCycle*Math.PI/18)*7:0;
    c.fillRect(sx-8,sy-8,6,8+swing); c.fillRect(sx+2,sy-8,6,8-swing);
  }

  // Name tag
  c.shadowBlur=0;
  c.font='bold 9px "Segoe UI"'; c.textAlign='center';
  c.fillStyle='rgba(255,255,255,0.85)';
  c.fillText(char.name,sx,sy-50);

  // Slot badge
  c.fillStyle=char.color;
  c.beginPath(); c.arc(sx+12,sy-46,5,0,Math.PI*2); c.fill();
  c.fillStyle='#fff'; c.font='bold 7px sans-serif';
  c.fillText(char.slot,sx+12,sy-43);

  c.restore();
}

function drawGoalZone(c,lvl,camX,t){
  const g=lvl.goal;
  const sx=g.x-camX;
  if(sx+g.w<0||sx>VW) return;
  const glow=0.6+Math.sin(t*0.004)*0.4;
  c.shadowColor=P1_COLOR; c.shadowBlur=20*glow;
  c.fillStyle=`rgba(79,142,247,${0.2*glow})`;
  roundRect(c,sx,g.y,g.w,g.h,8); c.fill();
  c.strokeStyle=`rgba(79,142,247,${0.8*glow})`; c.lineWidth=2;
  roundRect(c,sx,g.y,g.w,g.h,8); c.stroke();
  c.shadowBlur=0;
  c.font='bold 11px "Segoe UI"'; c.textAlign='center';
  c.fillStyle='rgba(255,255,255,0.9)';
  c.fillText(lvl.goalLabel,sx+g.w/2,g.y+g.h/2+4);
  // Fill progress bar
  if(goalHoldTime>0){
    c.fillStyle=P1_COLOR;
    roundRect(c,sx+2,g.y+g.h-8,Math.max(0,(g.w-4)*(goalHoldTime/1.5)),6,3); c.fill();
  }
}

function drawCheckpoint(c,lvl,camX,t){
  if(checkpointActive||!lvl.checkpoint) return;
  const ck=lvl.checkpoint;
  const sx=ck.x-camX;
  const glow=0.5+Math.sin(t*0.005)*0.5;
  c.fillStyle=`rgba(255,215,0,${0.15*glow})`;
  roundRect(c,sx,ck.y,ck.w,ck.h,6); c.fill();
  c.strokeStyle=`rgba(255,215,0,${0.7*glow})`; c.lineWidth=2;
  roundRect(c,sx,ck.y,ck.w,ck.h,6); c.stroke();
  c.font='14px sans-serif'; c.textAlign='center';
  c.fillText('⭐',sx+ck.w/2,ck.y+ck.h/2+5);
}

function drawReviveZone(c,camX){
  if(!partnerChar.downed) return;
  const sx=partnerChar.x-camX;
  const pulse=0.5+Math.sin(levelTime*0.01)*0.5;
  c.strokeStyle=`rgba(233,69,96,${0.5+pulse*0.5})`; c.lineWidth=2;
  c.setLineDash([4,4]);
  c.beginPath(); c.arc(sx,partnerChar.y-CHAR_H/2,40,0,Math.PI*2); c.stroke();
  c.setLineDash([]);
  c.font='12px sans-serif'; c.textAlign='center';
  c.fillStyle='rgba(255,255,255,0.8)';
  c.fillText('🤝 [E]',sx,partnerChar.y-CHAR_H-4);
}

// ============================================================
// LEVEL BACKGROUNDS
// ============================================================
let raindrops=Array.from({length:60},()=>({x:rand(0,VW),y:rand(0,VH),len:rand(6,12),spd:rand(3,6)}));
let stars=Array.from({length:80},()=>({x:rand(0,VW*3),y:rand(0,VH*0.6),r:rand(0.5,2),blink:rand(0,Math.PI*2)}));
let lightFlash=0;

function drawBgAirport(c,camX,t){
  // Sky gradient
  const g=c.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,'#05050f'); g.addColorStop(1,'#0d0d2a');
  c.fillStyle=g; c.fillRect(0,0,VW,VH);
  // Terminal windows (parallax 0.2)
  const px=camX*0.2;
  c.fillStyle='rgba(60,80,140,0.18)';
  for(let i=0;i<18;i++){
    const wx=((i*180-px)%2800+2800)%2800;
    if(wx>VW+180) continue;
    roundRect(c,wx,10,160,100,4); c.fill();
    // window grid
    for(let r=0;r<3;r++) for(let co=0;co<6;co++){
      c.fillStyle=Math.sin(i*7+r*3+co*2)>0?'rgba(180,210,255,0.35)':'rgba(30,40,80,0.4)';
      c.fillRect(wx+co*24+4,15+r*30,20,24);
    }
  }
  // Gates (parallax 0.5)
  const px2=camX*0.5;
  for(let i=0;i<8;i++){
    const gx=((i*400-px2)%3200+3200)%3200;
    if(gx>VW+80) continue;
    c.fillStyle='rgba(79,142,247,0.12)';
    c.fillRect(gx,VH-120,70,120);
    c.fillStyle='rgba(79,142,247,0.4)'; c.font='10px sans-serif'; c.textAlign='center';
    c.fillText(`✈ Gate ${String.fromCharCode(65+i)}${(i+1)*2}`,gx+35,VH-110);
  }
  // Ground texture
  c.fillStyle='#1a1a30'; c.fillRect(0,GND,VW,VH-GND);
  c.fillStyle='rgba(79,142,247,0.1)'; c.fillRect(0,GND,VW,2);
  // Announcement flash
  if(Math.floor(t/180)%2===0){
    c.fillStyle='rgba(255,200,50,0.08)'; c.fillRect(0,0,VW,VH);
  }
}

function drawBgCity(c,camX,t){
  const g=c.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,'#0a0014'); g.addColorStop(0.6,'#14003a'); g.addColorStop(1,'#1a0828');
  c.fillStyle=g; c.fillRect(0,0,VW,VH);
  // Skyline (parallax 0.15)
  const bpx=camX*0.15;
  const BCOLS=['#0d0d1a','#0f0f20','#0c0c18'];
  const bldW=[30,25,40,20,35,28,45,22];
  const bldH=[120,100,150,80,130,110,160,90];
  for(let i=0;i<20;i++){
    const bx=((i*90-bpx)%3000+3000)%3000;
    if(bx>VW+50) continue;
    const bw=bldW[i%bldW.length]; const bh=bldH[i%bldH.length];
    c.fillStyle=BCOLS[i%3];
    c.fillRect(bx,VH-bh-GND+GND-120,bw,bh+130);
    // Windows
    for(let wr=0;wr<Math.floor(bh/14);wr++) for(let wc=0;wc<Math.floor(bw/10);wc++){
      if(Math.sin(i*13+wr*7+wc*5+t*0.001)>0.1){
        const wcol=['#ffee80','#80aaff','#ffaa40','#aaffaa'];
        c.fillStyle=wcol[(i+wr+wc)%wcol.length]+'55';
        c.fillRect(bx+wc*10+2,VH-bh-GND+GND-118+wr*14+2,7,10);
      }
    }
  }
  // Neon signs (parallax 0.4)
  const spx=camX*0.4;
  const signs=['NEON','BAR','CAFE','TAXI','STOP','LIVE'];
  const scols=['#ff4488','#44aaff','#ffaa00','#44ffaa','#ff6600','#aa44ff'];
  for(let i=0;i<8;i++){
    const sx2=((i*400-spx)%3200+3200)%3200;
    if(sx2>VW+100) continue;
    c.shadowColor=scols[i%scols.length]; c.shadowBlur=12;
    c.fillStyle=scols[i%scols.length];
    c.font='bold 14px "Courier New"';
    c.textAlign='center';
    c.fillText(signs[i%signs.length],sx2,60+i*20%60);
    c.shadowBlur=0;
  }
  // Rain
  for(const rd of raindrops){
    c.strokeStyle='rgba(120,180,255,0.25)'; c.lineWidth=1;
    c.beginPath(); c.moveTo(rd.x,rd.y); c.lineTo(rd.x-2,rd.y+rd.len); c.stroke();
    rd.y+=rd.spd; rd.x-=0.8;
    if(rd.y>VH){ rd.y=-10; rd.x=rand(0,VW); }
  }
  // Street
  c.fillStyle='#0a0a14'; c.fillRect(0,GND,VW,VH-GND);
  c.fillStyle='rgba(100,120,255,0.08)'; c.fillRect(0,GND,VW,VH-GND);
}

function drawBgStation(c,camX,t){
  const g=c.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,'#0d0a1a'); g.addColorStop(1,'#1a1228');
  c.fillStyle=g; c.fillRect(0,0,VW,VH);
  // Station pillars (parallax 0.3)
  const ppx=camX*0.3;
  for(let i=0;i<10;i++){
    const px=((i*250-ppx)%2800+2800)%2800;
    if(px>VW+30) continue;
    c.fillStyle='rgba(60,50,90,0.6)';
    c.fillRect(px,20,28,VH-20);
    c.fillStyle='rgba(120,100,180,0.3)';
    c.fillRect(px,20,28,8);
  }
  // Departure boards
  const bpx=camX*0.45;
  for(let i=0;i<5;i++){
    const bx=((i*600-bpx)%3000+3000)%3000;
    if(bx>VW+200) continue;
    c.fillStyle='rgba(20,40,20,0.8)';
    roundRect(c,bx,15,200,50,4); c.fill();
    c.fillStyle='#4ade80'; c.font='9px "Courier New"'; c.textAlign='left';
    const departures=['12:45 Warsaw  DELAYED','14:20 Berlin  ON TIME','09:55 Paris   DELAYED','16:10 London  CANCELLED'];
    departures.forEach((d,di)=> c.fillText(d,bx+4,26+di*12));
  }
  // Clock
  c.font='18px "Courier New"'; c.fillStyle='#4ade80'; c.textAlign='center';
  const mn=Math.floor(t/3600)%60; const sec=Math.floor(t/60)%60;
  c.fillText(`${String(mn).padStart(2,'0')}:${String(sec).padStart(2,'0')}`,VW/2,24);
  // Ground
  c.fillStyle='#121020'; c.fillRect(0,GND,VW,VH-GND);
  c.fillStyle='rgba(120,100,180,0.1)'; c.fillRect(0,GND,VW,2);
}

function drawBgStorm(c,camX,t){
  // Lightning flash
  if(lightFlash>0){ lightFlash--; c.fillStyle=`rgba(200,220,255,${lightFlash*0.06})`; c.fillRect(0,0,VW,VH); }
  if(Math.random()<0.004&&lightFlash===0){ lightFlash=6; playTone(60,'sawtooth',0.2,0.3); }

  const g=c.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,'#050510'); g.addColorStop(1,'#0a0820');
  c.fillStyle=g; c.fillRect(0,0,VW,VH);

  // Storm clouds (parallax 0.1)
  const cpx=camX*0.1;
  c.fillStyle='rgba(20,20,40,0.9)';
  for(let i=0;i<8;i++){
    const cx=((i*400-cpx)%3200+3200)%3200;
    c.beginPath(); c.arc(cx,40,60,0,Math.PI*2); c.arc(cx+50,30,50,0,Math.PI*2); c.arc(cx-40,35,45,0,Math.PI*2); c.fill();
  }
  // Heavy rain
  c.strokeStyle='rgba(100,130,200,0.35)'; c.lineWidth=1.5;
  for(const rd of raindrops){
    c.beginPath(); c.moveTo(rd.x,rd.y); c.lineTo(rd.x-4,rd.y+rd.len*1.5); c.stroke();
    rd.y+=rd.spd*1.5; rd.x-=2;
    if(rd.y>VH){ rd.y=rand(-20,0); rd.x=rand(0,VW+50); }
  }
  // Wind lines
  if(Math.random()<0.05){
    c.strokeStyle='rgba(150,180,255,0.1)'; c.lineWidth=1;
    const wy=rand(0,VH);
    c.beginPath(); c.moveTo(VW,wy); c.lineTo(0,wy+rand(-5,5)); c.stroke();
  }
  c.fillStyle='#08080f'; c.fillRect(0,GND,VW,VH-GND);
}

function drawBgFinal(c,camX,t){
  const g=c.createLinearGradient(0,0,0,VH);
  g.addColorStop(0,'#03030f'); g.addColorStop(0.5,'#060618'); g.addColorStop(1,'#080820');
  c.fillStyle=g; c.fillRect(0,0,VW,VH);
  // Stars
  for(const s of stars){
    const sx2=(s.x-camX*0.05)%VW;
    const alpha=0.4+Math.sin(s.blink+t*0.003)*0.4;
    c.fillStyle=`rgba(200,220,255,${alpha})`;
    c.beginPath(); c.arc(sx2,s.y,s.r,0,Math.PI*2); c.fill();
    s.blink+=0.01;
  }
  // Moving city lights below
  c.fillStyle='rgba(10,10,30,0.7)'; c.fillRect(0,VH*0.55,VW,VH*0.45);
  const lpx=(camX*0.7)%80;
  for(let i=0;i<VW/8+2;i++){
    const lx=i*8-lpx%8+Math.sin(i*0.5+t*0.01)*2;
    const lcols=['#4f8ef7','#e94560','#ffd700','#4ade80'];
    c.fillStyle=lcols[(i+Math.floor(t/60))%lcols.length]+'44';
    c.fillRect(lx,VH*0.55,3,rand(20,60));
  }
  // Moonlight
  c.shadowColor='#aabbff'; c.shadowBlur=40;
  c.fillStyle='rgba(200,210,255,0.08)';
  c.beginPath(); c.arc(VW*0.8-camX*0.02,50,40,0,Math.PI*2); c.fill();
  c.shadowBlur=0;
  // Train rails
  c.strokeStyle='rgba(79,142,247,0.2)'; c.lineWidth=2;
  c.beginPath(); c.moveTo(0,GND+10); c.lineTo(VW,GND+10); c.stroke();
  c.strokeStyle='rgba(79,142,247,0.1)';
  const railPx=(camX*1.0)%40;
  for(let i=0;i<VW/40+2;i++){
    const rx=i*40-railPx;
    c.beginPath(); c.moveTo(rx,GND+4); c.lineTo(rx,GND+16); c.stroke();
  }
  c.fillStyle='#050515'; c.fillRect(0,GND+18,VW,VH-GND-18);
}

// ============================================================
// MAIN GAME LOOP
// ============================================================
function gameLoop(timestamp){
  if(!gameRunning) return;
  if(!gamePaused){
    levelTime++;
    const lvl=LEVELS[currentLevelIdx];

    // Process input for my character
    processInput(myChar);

    // Physics for my character
    updatePhysics(myChar,lvl.platforms,lvl.wind||0);

    // Hazard hit detection — only for my char (partner handles their own)
    if(!myChar.downed&&checkHazardHit(myChar,lvl.hazards,levelTime)){
      myChar.downed=true; sfxHit();
      showToast(`💀 ${myName} is down! Partner can revive you.`);
      // Notify partner via Firebase
      update(dbRef('rooms',roomCode,'players',myUid),{downed:true});
    }

    // Partner char smoothly updates (already set in listener)
    // Update partner walk cycle for animation
    if(partnerChar.state==='walk') partnerChar.walkCycle=(partnerChar.walkCycle||0)+2.5;

    // Check if I fell off world
    if(myChar.y>VH+60&&!myChar.downed){
      myChar.downed=true; sfxHit();
      update(dbRef('rooms',roomCode,'players',myUid),{downed:true});
    }

    updateCamera();
    checkGoals(lvl,levelTime);
  }
  renderFrame();
  rafId=requestAnimationFrame(gameLoop);
}

function renderFrame(){
  const c=ctx2;
  const lvl=LEVELS[currentLevelIdx];
  const camX=cam.x;

  // Resize canvas to fit container
  const wrap=document.getElementById('game-wrap');
  const cw=wrap.clientWidth, ch=wrap.clientHeight;
  const scale=Math.min(cw/VW,ch/VH);
  const sw=VW*scale, sh=VH*scale;
  if(canv.width!==sw||canv.height!==sh){ canv.width=sw; canv.height=sh; }
  c.setTransform(scale,0,0,scale,0,0);

  // Draw background
  window[lvl.bgFn](c,camX,levelTime);

  // Platforms
  c.font='12px sans-serif'; c.textAlign='center';
  drawPlatforms(c,lvl.platforms,camX);

  // Checkpoint & goal
  drawCheckpoint(c,lvl,camX,levelTime);
  drawGoalZone(c,lvl,camX,levelTime);

  // Sync door
  if(lvl.syncDoor&&!lvl._doorOpen){
    const d=lvl.syncDoor; const sx=d.x-camX;
    c.fillStyle='rgba(255,150,50,0.4)'; roundRect(c,sx,d.y,d.w,d.h,4); c.fill();
    c.font='10px sans-serif'; c.fillStyle='#fff'; c.textAlign='center';
    c.fillText('Both here',sx+d.w/2,d.y-6);
  }

  // Hazards
  drawHazards(c,lvl.hazards,levelTime,camX);

  // Revive zone
  drawReviveZone(c,camX);

  // Characters (partner first so mine draws on top)
  drawCharacter(c,partnerChar,camX);
  drawCharacter(c,myChar,camX);

  c.setTransform(1,0,0,1,0,0);
}

// ============================================================
// ENDING SCREEN
// ============================================================
function showEndingScreen(){
  stopGame();
  const pct=Math.min(100,Math.round((teamworkScore/300)*100));
  const names=[myName,partnerName].filter(Boolean).join(' & ');
  document.getElementById('ending-names').textContent=`${names}`;
  const statsEl=document.getElementById('ending-stats');
  const moments=['Got lost together 🗺️','Survived the storm ⛈️','Missed a platform (twice) 😅','Made it anyway ✅'];
  statsEl.innerHTML=`
    <div class="stat-row"><span class="stat-label">🤝 Teamwork Score</span><span class="stat-val">${teamworkScore}</span></div>
    <div class="stat-row"><span class="stat-label">❤️ Total Revives</span><span class="stat-val">${totalRevives}</span></div>
    <div class="stat-row"><span class="stat-label">⭐ Cooperation %</span><span class="stat-val">${pct}%</span></div>
    <div class="stat-row"><span class="stat-label">🎭 Funniest Moment</span><span class="stat-val">${moments[randInt(0,moments.length-1)]}</span></div>
  `;
  showScreen('screen-ending');
  spawnEndingConfetti();
  // Ending music
  if(musicOn){
    setTimeout(()=>[440,554,659,784,880].forEach((f,i)=>playTone(f,'sine',1.5,0.1,i*0.3)),300);
  }
}

function spawnEndingConfetti(){
  const cols=['#4f8ef7','#e94560','#ffd700','#4ade80','#a78bfa'];
  for(let i=0;i<50;i++){
    setTimeout(()=>{
      const el=document.createElement('div');
      el.className='confetti-piece';
      el.style.cssText=`left:${rand(5,95)}vw;top:-10px;width:${rand(6,12)}px;height:${rand(6,12)}px;background:${cols[randInt(0,cols.length-1)]};animation:confettiFall ${rand(1.5,3)}s linear forwards;`;
      document.body.appendChild(el);
      setTimeout(()=>el.remove(),3200);
    },i*60);
  }
  if(!document.getElementById('conf-kf')){
    const s=document.createElement('style'); s.id='conf-kf';
    s.textContent='@keyframes confettiFall{from{transform:translateY(0) rotate(0deg);opacity:1}to{transform:translateY(100vh) rotate(720deg);opacity:0}}';
    document.head.appendChild(s);
  }
}

// ============================================================
// GAME LAUNCH
// ============================================================
function launchGame(){
  clearListeners();
  // Find partner
  get(dbRef('rooms',roomCode,'players')).then(snap=>{
    const pl=snap.val()||{};
    const uids=Object.keys(pl);
    partnerUid=uids.find(u=>u!==myUid)||null;
    if(partnerUid) partnerName=pl[partnerUid].name;
    showLevelIntro(LEVELS[0]);
  });
}

function showLevelIntro(lvl){
  document.getElementById('intro-badge').textContent=`Level ${lvl.id} of ${LEVELS.length}`;
  document.getElementById('intro-emoji').textContent=lvl.emoji;
  document.getElementById('intro-title').textContent=lvl.name;
  document.getElementById('intro-desc').textContent=lvl.desc;
  document.getElementById('intro-coop').textContent=`🤝 ${lvl.goalLabel} — reach it together`;
  showScreen('screen-level-intro');
  startAmbi(lvl.id);
}

function startCurrentLevel(){
  const lvl=LEVELS[currentLevelIdx];
  const mySlot=isHost?1:2;
  myChar=makeChar(mySlot===1?lvl.spawnP1:lvl.spawnP2, mySlot===1?P1_COLOR:P2_COLOR, myName, mySlot);
  partnerChar=makeChar(mySlot===1?lvl.spawnP2:lvl.spawnP1, mySlot===1?P2_COLOR:P1_COLOR, partnerName, mySlot===1?2:1);

  teamworkScore=0; revivesLeft=MAX_REVIVES; levelTime=0;
  totalRevives=0; syncBonuses=0; goalHoldTime=0;
  levelComplete=false; checkpointActive=false; cam.x=0; cam.y=0;
  lvl._doorOpen=false;

  document.getElementById('hud-p1-name').textContent=isHost?myName:partnerName;
  document.getElementById('hud-p2-name').textContent=isHost?partnerName:myName;
  document.getElementById('hud-rv-val').textContent=MAX_REVIVES;
  document.getElementById('hud-tw-val').textContent=0;
  document.getElementById('hud-level-name').textContent=lvl.name;

  // Setup canvas
  canv=document.getElementById('game-canvas');
  ctx2=canv.getContext('2d');

  // Show mobile controls on touch device
  const isMobile='ontouchstart' in window;
  document.getElementById('mobile-controls').style.display=isMobile?'flex':'none';

  showScreen('screen-game');
  listenPartner();
  startSync();

  gameRunning=true; gamePaused=false;
  rafId=requestAnimationFrame(gameLoop);
}

// ============================================================
// INPUT SYSTEM
// ============================================================
document.addEventListener('keydown',e=>{
  keys[e.key]=true;
  if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});
document.addEventListener('keyup',e=>{ keys[e.key]=false; });

function setupMobileControls(){
  const map=[
    ['mc-left',  ()=>{mobileKeys.left=true},  ()=>{mobileKeys.left=false}],
    ['mc-right', ()=>{mobileKeys.right=true},  ()=>{mobileKeys.right=false}],
    ['mc-down',  ()=>{mobileKeys.down=true},   ()=>{mobileKeys.down=false}],
    ['mc-jump',  ()=>{mobileKeys.jump=true},   ()=>{mobileKeys.jump=false}],
    ['mc-help',  ()=>{mobileKeys.help=true},   ()=>{mobileKeys.help=false}],
  ];
  map.forEach(([id,down,up])=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.addEventListener('touchstart',e=>{e.preventDefault();el.classList.add('mc-pressed');down();},{passive:false});
    el.addEventListener('touchend',()=>{el.classList.remove('mc-pressed');up();},{passive:true});
    el.addEventListener('touchcancel',()=>{el.classList.remove('mc-pressed');up();},{passive:true});
  });
  // Prevent scroll in game
  document.getElementById('game-wrap')?.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
}

// ============================================================
// RESET / NAVIGATION
// ============================================================
function resetToMenu(){
  stopGame(); clearListeners();
  roomCode=''; partnerUid=''; partnerName='';
  isHost=false; currentLevelIdx=0;
  showScreen('screen-menu');
}
async function playAgain(){
  if(isHost){
    currentLevelIdx=0;
    await update(dbRef('rooms',roomCode),{status:'playing','game/level':1});
    showLevelIntro(LEVELS[0]);
  }
}

// ============================================================
// STATIC BUTTON WIRING
// ============================================================
function wireButtons(){
  // Menu
  touchBtn(document.getElementById('btn-create'),()=>{
    sfxClick(); document.getElementById('modal-create').classList.remove('hidden');
    document.getElementById('input-host-name').focus();
  });
  touchBtn(document.getElementById('btn-create-cancel'),()=>document.getElementById('modal-create').classList.add('hidden'));
  touchBtn(document.getElementById('btn-create-confirm'),async()=>{
    const n=document.getElementById('input-host-name').value.trim();
    if(!n){showError('create-error','Please enter your name.');return;}
    document.getElementById('btn-create-confirm').disabled=true; sfxClick();
    try{ await createRoom(n); document.getElementById('modal-create').classList.add('hidden'); }
    catch(e){ showError('create-error','Failed. Check Firebase config.'); }
    document.getElementById('btn-create-confirm').disabled=false;
  });
  touchBtn(document.getElementById('btn-join-open'),()=>{
    sfxClick(); document.getElementById('modal-join').classList.remove('hidden');
    document.getElementById('input-name').focus();
  });
  touchBtn(document.getElementById('btn-join-cancel'),()=>document.getElementById('modal-join').classList.add('hidden'));
  touchBtn(document.getElementById('btn-join-confirm'),async()=>{
    const n=document.getElementById('input-name').value.trim();
    const c=document.getElementById('input-code').value.trim().toUpperCase();
    if(!n){showError('join-error','Enter your name.');return;}
    if(c.length<4){showError('join-error','Enter the 4-character room code.');return;}
    document.getElementById('btn-join-confirm').disabled=true; sfxClick();
    const err=await joinRoom(n,c);
    if(err) showError('join-error',err);
    else document.getElementById('modal-join').classList.add('hidden');
    document.getElementById('btn-join-confirm').disabled=false;
  });
  touchBtn(document.getElementById('btn-copy-code'),()=>{
    navigator.clipboard?.writeText(roomCode).catch(()=>{});
    showToast('Room code copied!');
  });
  touchBtn(document.getElementById('btn-leave-lobby'),async()=>{
    sfxClick();
    if(roomCode&&myUid){
      await remove(dbRef('rooms',roomCode,'players',myUid));
      if(isHost) await remove(dbRef('rooms',roomCode));
    }
    resetToMenu();
  });
  touchBtn(document.getElementById('btn-start-game'),()=>{ sfxClick(); hostStartGame(); });
  touchBtn(document.getElementById('btn-intro-start'),()=>{
    sfxClick(); startCurrentLevel();
  });
  touchBtn(document.getElementById('btn-abandon'),()=>{ sfxClick(); resetToMenu(); });
  touchBtn(document.getElementById('btn-play-again'),()=>{ sfxClick(); playAgain(); });
  touchBtn(document.getElementById('btn-ending-menu'),()=>{ sfxClick(); resetToMenu(); });

  document.getElementById('input-code')?.addEventListener('input',e=>{ e.target.value=e.target.value.toUpperCase(); });
  document.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      const mc=document.getElementById('modal-create'); const mj=document.getElementById('modal-join');
      if(!mc.classList.contains('hidden')) document.getElementById('btn-create-confirm').click();
      else if(!mj.classList.contains('hidden')) document.getElementById('btn-join-confirm').click();
    }
    if(e.key==='Escape'){
      document.getElementById('modal-create').classList.add('hidden');
      document.getElementById('modal-join').classList.add('hidden');
    }
  });
}

// ============================================================
// BOOT
// ============================================================
async function boot(){
  document.getElementById('loading-msg').textContent='Connecting…';
  showScreen('screen-loading');
  try{
    await initAuth();
    initConn();
    setupMobileControls();
    wireButtons();
    document.getElementById('loading-msg').textContent='Ready!';
    await new Promise(r=>setTimeout(r,600));
    showScreen('screen-menu');
    // Unlock AudioContext on first touch
    document.addEventListener('touchstart',()=>{ try{getACtx();}catch(e){} },{once:true});
    document.addEventListener('click',()=>{ try{getACtx();}catch(e){} },{once:true});
  }catch(e){
    document.getElementById('loading-msg').textContent='Firebase connection failed. Check config.';
    console.error(e);
  }
}
boot();
