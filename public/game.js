/* =========================================================================
   크레이지 아케이드 — 게임 코어
   싱글 / 온라인(협동·대전) 공용. 시뮬레이션은 host(또는 싱글)만 돌리고
   guest 는 스냅샷을 받아 그리기만 합니다.
   ========================================================================= */
'use strict';

window.G = (function () {

/* ------------------------------------------------------------- 상수 */
const TILE = 40, COLS = 15, ROWS = 13;
const MAPW = COLS * TILE, MAPH = ROWS * TILE;
const OX = 10, OY = 54;
const EMPTY = 0, WALL = 1, BOX = 2;
const DIRS  = ['down', 'up', 'left', 'right'];
const WKIND = ['center', 'arm', 'tip'];
const ITEMS = ['balloon', 'power', 'speed', 'needle', 'heart'];

const CHARS = [
  { name:'배찌',  hood:'#e8392f', hood2:'#a81d16', skin:'#fff4e2', trim:'#ffffff',
    ear:'#e8392f', belly:'#ffd9c0',
    desc:'모든 능력이 고루 뛰어난 기본 캐릭터.\n처음 시작하는 분께 추천해요!',
    balloons:1, power:1, speed:3 },
  { name:'다오',  hood:'#2f6fe8', hood2:'#1a3f9e', skin:'#ffeede', trim:'#ffe14a',
    ear:'#2f6fe8', belly:'#cfe2ff',
    desc:'물풍선을 한 번에 많이 놓을 수 있어\n함정을 깔고 길을 막는 데 강해요!',
    balloons:2, power:1, speed:3 },
  { name:'마리드', hood:'#6b3fb8', hood2:'#3d2172', skin:'#f0e2ff', trim:'#c9a4ff',
    ear:'#6b3fb8', belly:'#e2d1ff',
    desc:'발이 빠르고 물줄기가 조금 길어요.\n대신 물풍선은 하나뿐! 상급자용.',
    balloons:1, power:2, speed:4 },
];
const ENEMY_SKINS = [
  { name:'다크배찌', hood:'#4a4a52', hood2:'#26262c', skin:'#d9d9e2', trim:'#8e8e9c', ear:'#4a4a52', belly:'#c4c4d0' },
  { name:'초록몹',   hood:'#3aa84a', hood2:'#1d6b2a', skin:'#eaffe2', trim:'#b6ff9c', ear:'#3aa84a', belly:'#d4ffc4' },
  { name:'핑크몹',   hood:'#e05a9c', hood2:'#962f65', skin:'#fff0f7', trim:'#ffb6d8', ear:'#e05a9c', belly:'#ffd6e8' },
  { name:'노랑몹',   hood:'#e0a92a', hood2:'#966a10', skin:'#fff8e0', trim:'#ffe08a', ear:'#e0a92a', belly:'#ffeec0' },
];
/* 대전 모드에서 플레이어를 구분하는 팀 색 */
const TEAM_COLORS = ['#ffe14a', '#5ce85c', '#ff6b5c', '#8fe0ff'];

const STAGES = [
  { name:'로두마니의 문턱',    floorA:'#7bc85a', floorB:'#6cb84e', wall:'#8d6b45', wallTop:'#b08a5c', box:'#e0682f', boxTop:'#f5934f', boxes:.62, enemies:2, ai:.55, time:200 },
  { name:'필레라 사막',        floorA:'#e8c878', floorB:'#dcb964', wall:'#a8794a', wallTop:'#c99a67', box:'#3f9fd0', boxTop:'#63c2ee', boxes:.60, enemies:3, ai:.62, time:200 },
  { name:'얼음 나라를 잡아라', floorA:'#a6dcf0', floorB:'#93cfe8', wall:'#4a6f92', wallTop:'#6f9abd', box:'#cfeaff', boxTop:'#ffffff', boxes:.64, enemies:3, ai:.68, time:190 },
  { name:'농장을 지켜라',      floorA:'#c8d84e', floorB:'#b6c93f', wall:'#8a6a3c', wallTop:'#ad8b56', box:'#d94a4a', boxTop:'#f26d6d', boxes:.66, enemies:4, ai:.72, time:190 },
  { name:'로두마니의 문턱 II', floorA:'#9aa6b4', floorB:'#8794a4', wall:'#5a6270', wallTop:'#7b8593', box:'#c99a2f', boxTop:'#eec158', boxes:.68, enemies:4, ai:.78, time:180 },
  { name:'워터파크 대소동',    floorA:'#5fc0e8', floorB:'#4fb0da', wall:'#2f6f9e', wallTop:'#4a90c4', box:'#f0f070', boxTop:'#ffff9c', boxes:.70, enemies:4, ai:.84, time:180 },
  { name:'위대한 시나리',      floorA:'#8c6fc0', floorB:'#7a5eae', wall:'#4a3070', wallTop:'#6a4c96', box:'#40d8a0', boxTop:'#68f2c2', boxes:.72, enemies:5, ai:.90, time:170 },
  { name:'로두마니 최종 결전', floorA:'#b04a4a', floorB:'#9c3c3c', wall:'#4a2020', wallTop:'#6e3434', box:'#3a3a4a', boxTop:'#5c5c72', boxes:.74, enemies:5, ai:1.0, time:170 },
];

const SPAWNS = [[1,1],[COLS-2,ROWS-2],[COLS-2,1],[1,ROWS-2],
                [Math.floor(COLS/2),1],[Math.floor(COLS/2),ROWS-2]];

/* --------------------------------------------------------- 유틸 / RNG */
let cv, ctx;
const clamp = (v,a,b)=> v<a?a:v>b?b:v;
const gx = px => Math.floor(px/TILE);
const cx = g  => g*TILE + TILE/2;
const r1 = v  => Math.round(v*10)/10;
const r2 = v  => Math.round(v*100)/100;

/* 맵 생성을 host/guest 가 동일하게 하기 위한 시드 난수 */
let seedState = 1;
function srandSeed(s){ seedState = (s >>> 0) || 1; }
function srand(){
  seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rnd  = (a,b)=> a + Math.random()*(b-a);
const irnd = (a,b)=> Math.floor(rnd(a,b+1));

/* ------------------------------------------------------------ 상태 */
let ROLE = 'single';        // single | host | guest
let MODE = 'coop';          // coop | versus
let myId = 0;               // 내가 조종하는 플레이어 id

let map, bg, mapDirty = true;
let stageIdx = 0, stageDef = STAGES[0], round = 1;
let players = [], balloons = [], waters = [], items = [], fx = [];
let timeLeft = 0, sceneT = 0, shake = 0, paused = false;
let scene = 'title';        // title|select|help|ready|play|clear|gameover|win|round|lobby
let menuIdx = 0, showHelp = false, sel = 0;
let roundResult = null, nicks = {};
let netCfg = null;

/* 입력 */
const keys = {}, pressed = {};
let localInput = { l:0, r:0, u:0, d:0, bomb:0, mash:0 };

/* --------------------------------------------------------------- 오디오 */
let AC = null, muted = false;
function ac(){ if(!AC){ try{ AC = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return AC; }
function sfx(type){
  if(muted) return; const a = ac(); if(!a) return;
  if(a.state === 'suspended') a.resume();
  const t = a.currentTime, o = a.createOscillator(), g = a.createGain();
  o.connect(g); g.connect(a.destination);
  const P = {
    place:['sine',220,520,.10,.16],  boom:['sawtooth',180,40,.38,.18],
    item :['square',660,1180,.16,.12], trap:['sine',880,300,.22,.14],
    pop  :['triangle',400,980,.14,.16], die:['sawtooth',300,70,.55,.16],
    menu :['square',520,720,.07,.10],  clear:['triangle',440,1320,.55,.16],
  }[type] || ['sine',440,440,.1,.1];
  o.type = P[0];
  o.frequency.setValueAtTime(P[1], t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30,P[2]), t+P[3]);
  g.gain.setValueAtTime(P[4], t);
  g.gain.exponentialRampToValueAtTime(0.0001, t+P[3]);
  o.start(t); o.stop(t+P[3]+.02);
}

/* ============================================================ 맵 생성 */
function buildStage(idx, seed){
  stageDef = STAGES[clamp(idx,0,STAGES.length-1)];
  if(seed != null) srandSeed(seed);

  map = [];
  for(let y=0;y<ROWS;y++){
    const row=[];
    for(let x=0;x<COLS;x++){
      if(x===0||y===0||x===COLS-1||y===ROWS-1) row.push(WALL);
      else if(x%2===0 && y%2===0) row.push(WALL);
      else row.push(EMPTY);
    }
    map.push(row);
  }
  const safe = new Set();
  for(const [sx,sy] of SPAWNS)
    for(const [dx,dy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
      const X=sx+dx, Y=sy+dy;
      if(X>0&&Y>0&&X<COLS-1&&Y<ROWS-1) safe.add(X+','+Y);
    }
  for(let y=1;y<ROWS-1;y++)
    for(let x=1;x<COLS-1;x++)
      if(map[y][x]===EMPTY && !safe.has(x+','+y) && srand()<stageDef.boxes)
        map[y][x] = BOX;

  bg = renderBackground();
  mapDirty = true;
  balloons=[]; waters=[]; items=[]; fx=[];
}

function mapString(){
  let s=''; for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) s += map[y][x];
  return s;
}
function mapFromString(s){
  let i=0;
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x] = +s[i++];
}

function renderBackground(){
  const c = document.createElement('canvas');
  c.width = MAPW; c.height = MAPH;
  const g = c.getContext('2d');
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    const px=x*TILE, py=y*TILE;
    g.fillStyle = ((x+y)&1) ? stageDef.floorA : stageDef.floorB;
    g.fillRect(px,py,TILE,TILE);
    g.fillStyle='rgba(255,255,255,.05)'; g.fillRect(px,py,TILE,3);
    g.fillStyle='rgba(0,0,0,.05)';       g.fillRect(px,py+TILE-3,TILE,3);
  }
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++)
    if(map[y][x]===WALL) drawWall(g, x*TILE, y*TILE);
  return c;
}
function drawWall(g,px,py){
  g.fillStyle='rgba(0,0,0,.28)'; g.fillRect(px+3,py+7,TILE-4,TILE-4);
  g.fillStyle=stageDef.wall;     g.fillRect(px+1,py+1,TILE-2,TILE-2);
  g.fillStyle=stageDef.wallTop;  g.fillRect(px+1,py+1,TILE-2,12);
  g.fillStyle='rgba(255,255,255,.22)'; g.fillRect(px+3,py+3,TILE-6,3);
  g.strokeStyle='rgba(0,0,0,.35)'; g.lineWidth=1;
  g.strokeRect(px+1.5,py+1.5,TILE-3,TILE-3);
  g.beginPath();
  g.moveTo(px+1,py+13.5); g.lineTo(px+TILE-1,py+13.5);
  g.moveTo(px+TILE/2,py+14); g.lineTo(px+TILE/2,py+TILE-1);
  g.stroke();
}
function drawBox(g,px,py){
  g.fillStyle='rgba(0,0,0,.30)';   g.fillRect(px+5,py+9,TILE-7,TILE-9);
  g.fillStyle='rgba(20,26,40,.85)';g.fillRect(px+2,py+2,TILE-4,TILE-4);
  g.fillStyle=stageDef.box;        g.fillRect(px+4,py+4,TILE-8,TILE-8);
  g.fillStyle=stageDef.boxTop;     g.fillRect(px+4,py+4,TILE-8,10);
  g.fillStyle='rgba(255,255,255,.34)'; g.fillRect(px+6,py+6,TILE-12,3);
  g.save();
  g.beginPath(); g.rect(px+4,py+4,TILE-8,TILE-8); g.clip();
  g.lineWidth=2; g.strokeStyle='rgba(20,26,40,.40)';
  g.beginPath();
  g.moveTo(px+4,py+4); g.lineTo(px+TILE-4,py+TILE-4);
  g.moveTo(px+TILE-4,py+4); g.lineTo(px+4,py+TILE-4);
  g.stroke();
  g.restore();
  g.strokeStyle='rgba(255,255,255,.30)'; g.lineWidth=1;
  g.strokeRect(px+4.5,py+4.5,TILE-9,TILE-9);
}

/* =========================================================== 플레이어 */
function mkPlayer(o){
  const skin = o.isAI ? ENEMY_SKINS[o.charIdx % ENEMY_SKINS.length] : CHARS[o.charIdx];
  return {
    id:o.id, team:o.team, isAI:!!o.isAI, local:!!o.local, charIdx:o.charIdx, skin,
    x:cx(o.tx), y:cx(o.ty), tx:cx(o.tx), ty:cx(o.ty), spawn:[o.tx,o.ty],
    dir:'down', moving:false, anim:0,
    maxB: skin.balloons || 1, power: skin.power || 1,
    spd: 70 + (skin.speed||2)*10, needle:0,
    alive:true, out:false, trapped:false, trapT:0, struggle:0,
    inv:1.2, respawn:0, lives:o.lives, score:0,
    input:{l:0,r:0,u:0,d:0,bomb:0,mash:0}, _bomb:0, _mash:0,
    skill:.5, think:0, goal:null, wander:0,
  };
}

function setupMatch(cfg){
  MODE = cfg.mode; ROLE = cfg.role; myId = cfg.myId;
  netCfg = cfg; nicks = {};
  round = 1; stageIdx = 0; roundResult = null;

  const humans = cfg.players;                 // [{id,nick,charIdx}]
  for(const h of humans) nicks[h.id] = h.nick;

  buildStage(MODE === 'versus' ? 0 : 0, cfg.seed);
  spawnPlayers(cfg);
  timeLeft = MODE === 'versus' ? 180 : stageDef.time;
  scene = 'ready'; sceneT = 0;
}

function spawnPlayers(cfg){
  players = [];
  const humans = cfg.players;
  const botCount = MODE === 'versus'
    ? clamp(cfg.bots|0, 0, Math.max(0, 4 - humans.length))
    : stageDef.enemies;

  humans.forEach((h, i) => {
    players.push(mkPlayer({
      id:h.id, charIdx:h.charIdx, isAI:false, local:(h.id === myId),
      team: MODE === 'versus' ? i+1 : 0,
      tx:SPAWNS[i % SPAWNS.length][0], ty:SPAWNS[i % SPAWNS.length][1],
      lives: MODE === 'versus' ? 1 : 3,
    }));
  });

  for(let i=0;i<botCount;i++){
    const s = SPAWNS[(humans.length + i) % SPAWNS.length];
    players.push(tuneBot(mkPlayer({
      id: -(i+1), charIdx:i, isAI:true,
      team: MODE === 'versus' ? 100+i : 1,
      tx:s[0], ty:s[1], lives:1,
    })));
  }
}

/* 봇 능력치는 스테이지 난이도에 따라 단계적으로 올라갑니다.
   초반 스테이지부터 물줄기가 길면 손 쓸 새 없이 당하기 때문입니다. */
function botTier(){ return stageDef.ai < .7 ? 1 : stageDef.ai < .9 ? 2 : 3; }
function tuneBot(b){
  const t = botTier();
  b.maxB  = t;
  b.power = t;
  b.spd   = 62 + stageDef.ai*38;
  b.skill = stageDef.ai;
  return b;
}

const isEnemy = (a,b) => a.team !== b.team;
const me = () => players.find(p => p.id === myId) || players[0];

/* =========================================================== 충돌/이동 */
function balloonAt(x,y){ for(const b of balloons) if(b.gx===x&&b.gy===y) return b; return null; }
function solidTile(x,y){
  if(x<0||y<0||x>=COLS||y>=ROWS) return true;
  return map[y][x]===WALL || map[y][x]===BOX;
}
/* 플레이어 몸통(26x26)이 해당 타일과 겹치는지 */
function overlapsTile(p, tx, ty){
  const s = 13;
  return p.x + s > tx*TILE && p.x - s < (tx+1)*TILE &&
         p.y + s > ty*TILE && p.y - s < (ty+1)*TILE;
}
/* 물풍선을 그 플레이어가 통과할 수 있는지.
   설치한 순간 그 타일에 겹쳐 있던 사람은 몸이 완전히 빠져나갈 때까지 통과합니다.
   (중심 기준으로 판정하면 몸통이 아직 걸친 13px 구간에서 갇혀버립니다) */
function canPass(b, p){
  return !!(p && b.pass && b.pass.indexOf(p.id) >= 0);
}
function blocked(px,py,p){
  const s=13;
  for(const [ox,oy] of [[-s,-s],[s,-s],[-s,s],[s,s]]){
    const X=Math.floor((px+ox)/TILE), Y=Math.floor((py+oy)/TILE);
    if(solidTile(X,Y)) return true;
    const b = balloonAt(X,Y);
    if(b && !canPass(b,p)) return true;
  }
  return false;
}
/* 몸이 완전히 빠져나간 사람은 통과 권한을 잃습니다 */
function updateBalloonPass(){
  for(const b of balloons){
    if(!b.pass || !b.pass.length) continue;
    for(let i=b.pass.length-1;i>=0;i--){
      const p = players.find(q=>q.id===b.pass[i]);
      if(!p || !overlapsTile(p, b.gx, b.gy)) b.pass.splice(i,1);
    }
  }
}
function moveP(p,dx,dy,dist){
  if(dx){
    if(!blocked(p.x+dx*dist,p.y,p)) p.x += dx*dist;
    else{
      const c=cx(Math.floor(p.y/TILE)), d=c-p.y;
      if(Math.abs(d)>1.2){ const s=Math.sign(d)*Math.min(dist,Math.abs(d));
        if(!blocked(p.x,p.y+s,p)) p.y += s; }
    }
  }
  if(dy){
    if(!blocked(p.x,p.y+dy*dist,p)) p.y += dy*dist;
    else{
      const c=cx(Math.floor(p.x/TILE)), d=c-p.x;
      if(Math.abs(d)>1.2){ const s=Math.sign(d)*Math.min(dist,Math.abs(d));
        if(!blocked(p.x+s,p.y,p)) p.x += s; }
    }
  }
}

/* ============================================================ 물풍선 */
function placeBalloon(p){
  if(!p.alive || p.trapped) return false;
  const X=gx(p.x), Y=gx(p.y);
  if(balloonAt(X,Y)) return false;
  if(balloons.filter(b=>b.owner===p).length >= p.maxB) return false;
  /* 설치 순간 이 타일에 몸이 걸친 사람은 모두 통과 권한을 받습니다
     (놓은 사람뿐 아니라 같이 서 있던 사람도 갇히지 않도록) */
  const pass = players.filter(q => q.alive && overlapsTile(q, X, Y)).map(q => q.id);
  if(pass.indexOf(p.id) < 0) pass.push(p.id);
  balloons.push({ gx:X, gy:Y, t:3.0, owner:p, power:p.power, pass });
  sfx('place');
  return true;
}
function explode(b, chain){
  const i = balloons.indexOf(b); if(i<0) return;
  balloons.splice(i,1);
  sfx('boom'); shake = Math.min(9, shake+5);
  addWater(b.gx,b.gy,'center',0);
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
    for(let k=1;k<=b.power;k++){
      const X=b.gx+dx*k, Y=b.gy+dy*k;
      if(X<0||Y<0||X>=COLS||Y>=ROWS) break;
      if(map[Y][X]===WALL) break;
      if(map[Y][X]===BOX){
        map[Y][X]=EMPTY; mapDirty=true;
        addWater(X,Y,'tip',k*0.02); popBox(X,Y,b.owner);
        break;
      }
      addWater(X,Y, k===b.power?'tip':'arm', k*0.02);
      const other = balloonAt(X,Y);
      if(other && chain.indexOf(other)<0) chain.push(other);
    }
  }
}
function addWater(x,y,kind,delay){ waters.push({gx:x,gy:y,kind,t:-(delay||0),life:.55}); }
function popBox(x,y,owner){
  for(let i=0;i<7;i++)
    fx.push({x:cx(x)+rnd(-10,10),y:cx(y)+rnd(-10,10),vx:rnd(-60,60),vy:rnd(-120,-30),
             t:.5,c:stageDef.boxTop,s:rnd(3,6)});
  if(owner && !owner.isAI) owner.score += 20;
  if(Math.random()<0.34){
    const r=Math.random();
    const kind = r<.34?'balloon' : r<.66?'power' : r<.88?'speed' : r<.96?'needle':'heart';
    items.push({gx:x,gy:y,kind,t:0});
  }
}

/* ============================================================== 피격 */
function waterHits(p){
  if(!p.alive||p.trapped||p.inv>0) return false;
  const X=gx(p.x), Y=gx(p.y);
  for(const w of waters) if(w.t>=0 && w.gx===X && w.gy===Y) return true;
  return false;
}
function trapPlayer(p){
  if(p.needle>0){
    p.needle--; p.inv=1.4; sfx('pop');
    for(let i=0;i<12;i++)
      fx.push({x:p.x,y:p.y,vx:rnd(-110,110),vy:rnd(-140,-30),t:.5,c:'#ffe14a',s:rnd(2,5)});
    return;
  }
  p.trapped=true; p.trapT=5.0; p.struggle=0; sfx('trap');
}
function killPlayer(p, killer){
  p.trapped=false; p.alive=false; sfx('die');
  for(let i=0;i<14;i++)
    fx.push({x:p.x,y:p.y,vx:rnd(-110,110),vy:rnd(-160,-40),t:.7,c:'#9fe8ff',s:rnd(3,7)});
  if(killer && killer!==p && !killer.isAI) killer.score += 300;

  const X=gx(p.x), Y=gx(p.y);
  if(map[Y][X]===EMPTY && !balloonAt(X,Y) && Math.random()<.6)
    items.push({gx:X,gy:Y,kind:ITEMS[irnd(0,2)],t:0});

  p.lives--;
  if(p.lives>0 && MODE==='coop') p.respawn = 3.0;
  else p.out = true;
}
function freePlayer(p){
  p.trapped=false; p.inv=1.6; sfx('pop');
  for(let i=0;i<10;i++)
    fx.push({x:p.x,y:p.y,vx:rnd(-90,90),vy:rnd(-120,-20),t:.5,c:'#cdf3ff',s:rnd(2,5)});
}
function doRespawn(p){
  const free = SPAWNS.filter(([x,y])=> map[y][x]===EMPTY && !balloonAt(x,y));
  const s = free.length ? free[irnd(0,free.length-1)] : p.spawn;
  p.x=cx(s[0]); p.y=cx(s[1]); p.tx=p.x; p.ty=p.y;
  p.alive=true; p.trapped=false; p.inv=2.2;
  p.maxB=Math.max(1,p.maxB-1); p.power=Math.max(1,p.power-1);
}
function applyItem(p,kind){
  sfx('item');
  if(kind==='balloon') p.maxB=Math.min(8,p.maxB+1);
  if(kind==='power')   p.power=Math.min(8,p.power+1);
  if(kind==='speed')   p.spd=Math.min(190,p.spd+14);
  if(kind==='needle')  p.needle=Math.min(3,p.needle+1);
  if(kind==='heart' && MODE==='coop') p.lives=Math.min(9,p.lives+1);
  if(!p.isAI) p.score += 100;
  for(let i=0;i<8;i++)
    fx.push({x:p.x,y:p.y,vx:rnd(-70,70),vy:rnd(-130,-40),t:.5,c:'#ffe14a',s:rnd(2,5)});
}

/* ================================================================= AI */
function neighbors(x,y){
  return [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]
    .filter(([a,b])=> a>0&&b>0&&a<COLS-1&&b<ROWS-1 && map[b][a]===EMPTY);
}
function dangerMap(extra){
  const d=new Set(), list=balloons.slice();
  if(extra) list.push(extra);
  for(const b of list){
    d.add(b.gx+','+b.gy);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])
      for(let i=1;i<=b.power;i++){
        const X=b.gx+dx*i, Y=b.gy+dy*i;
        if(X<0||Y<0||X>=COLS||Y>=ROWS) break;
        if(map[Y][X]===WALL) break;
        d.add(X+','+Y);
        if(map[Y][X]===BOX) break;
      }
  }
  for(const w of waters) d.add(w.gx+','+w.gy);
  return d;
}
function bfs(sx,sy,avoid,passBalloon){
  const seen=new Map(), q=[[sx,sy]];
  seen.set(sx+','+sy,{dist:0,first:null});
  let head=0;
  while(head<q.length && head<400){
    const [x,y]=q[head++], cur=seen.get(x+','+y);
    for(const [nx,ny] of neighbors(x,y)){
      const k=nx+','+ny;
      if(seen.has(k)) continue;
      if(!passBalloon && balloonAt(nx,ny)) continue;
      if(avoid && avoid.has(k) && cur.dist>0) continue;
      seen.set(k,{dist:cur.dist+1, first: cur.first||[nx-x,ny-y]});
      q.push([nx,ny]);
    }
  }
  return seen;
}
function aiUpdate(p,dt){
  p.think -= dt;
  const X=gx(p.x), Y=gx(p.y);
  const danger = dangerMap();
  let want=null, place=false;

  if(danger.has(X+','+Y)){
    const seen=bfs(X,Y,null,false);
    let best=null, bd=999;
    for(const [k,v] of seen){ if(danger.has(k)) continue; if(v.dist<bd){bd=v.dist;best=v;} }
    if(best&&best.first) want=best.first;
    else{
      const n=neighbors(X,Y).filter(([a,b])=>!balloonAt(a,b));
      if(n.length){ const t=n[irnd(0,n.length-1)]; want=[t[0]-X,t[1]-Y]; }
    }
  } else {
    const seen=bfs(X,Y,danger,false);
    let target=null, td=999;
    for(const q of players){
      if(q===p||!q.alive||!isEnemy(p,q)) continue;
      const v=seen.get(gx(q.x)+','+gx(q.y));
      if(v&&v.dist<td){ td=v.dist; target=v; }
    }
    if(!target||td>7){
      for(let yy=1;yy<ROWS-1;yy++) for(let xx=1;xx<COLS-1;xx++){
        if(map[yy][xx]!==BOX) continue;
        for(const [nx,ny] of [[xx+1,yy],[xx-1,yy],[xx,yy+1],[xx,yy-1]]){
          const v=seen.get(nx+','+ny);
          if(v&&v.dist<td){ td=v.dist; target=v; }
        }
      }
    }
    if(target&&target.first) want=target.first;
    else{
      p.wander-=dt;
      if(p.wander<=0||!p.goal){
        const n=neighbors(X,Y).filter(([a,b])=>!balloonAt(a,b)&&!danger.has(a+','+b));
        if(n.length){ const t=n[irnd(0,n.length-1)]; p.goal=[t[0]-X,t[1]-Y]; p.wander=rnd(.4,1.1); }
      }
      want=p.goal;
    }
    if(p.think<=0){
      p.think = rnd(.14,.34)*(1.6-p.skill);
      let value=0;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])
        for(let i=1;i<=p.power;i++){
          const nx=X+dx*i, ny=Y+dy*i;
          if(nx<0||ny<0||nx>=COLS||ny>=ROWS) break;
          if(map[ny][nx]===WALL) break;
          if(map[ny][nx]===BOX){ value+=1; break; }
          for(const q of players)
            if(q!==p&&q.alive&&isEnemy(p,q)&&gx(q.x)===nx&&gx(q.y)===ny) value+=4;
        }
      for(const q of players)
        if(q!==p&&q.alive&&isEnemy(p,q)&&Math.hypot(q.x-p.x,q.y-p.y)<TILE*1.2) value+=4;

      if(value>0 && balloons.filter(b=>b.owner===p).length<p.maxB && !balloonAt(X,Y)){
        const d2=dangerMap({gx:X,gy:Y,power:p.power});
        const seen2=bfs(X,Y,null,true);
        let esc=false;
        for(const [k,v] of seen2) if(!d2.has(k)&&v.dist<=4){ esc=true; break; }
        if(esc && Math.random()<.35+p.skill*.6) place=true;
      }
    }
  }
  /* 갇힌 아군 구출 */
  for(const q of players){
    if(q!==p && !isEnemy(p,q) && q.trapped && Math.hypot(q.x-p.x,q.y-p.y)<TILE*2.5){
      want = Math.abs(q.x-p.x)>=6 ? [Math.sign(q.x-p.x),0] : [0,Math.sign(q.y-p.y)];
      break;
    }
  }
  if(place) placeBalloon(p);
  if(want){
    const [dx,dy]=want, dist=p.spd*dt;
    if(dx){
      p.dir = dx>0?'right':'left';
      const d=cx(Y)-p.y;
      if(Math.abs(d)>2) p.y += Math.sign(d)*Math.min(dist,Math.abs(d));
      moveP(p,dx,0,dist);
    } else if(dy){
      p.dir = dy>0?'down':'up';
      const d=cx(X)-p.x;
      if(Math.abs(d)>2) p.x += Math.sign(d)*Math.min(dist,Math.abs(d));
      moveP(p,0,dy,dist);
    }
    p.moving=true;
  } else p.moving=false;
}

/* ========================================================= 사람 입력 */
function readLocalInput(){
  localInput.l = (keys.ArrowLeft ||keys.KeyA)?1:0;
  localInput.r = (keys.ArrowRight||keys.KeyD)?1:0;
  localInput.u = (keys.ArrowUp   ||keys.KeyW)?1:0;
  localInput.d = (keys.ArrowDown ||keys.KeyS)?1:0;
  return localInput;
}
function applyHumanInput(p, dt){
  const k = p.input;
  if(p.trapped){
    if(k.mash > p._mash){
      const n = k.mash - p._mash; p._mash = k.mash;
      p.struggle += n;
      fx.push({x:p.x+rnd(-8,8),y:p.y-6,vx:rnd(-40,40),vy:rnd(-70,-20),t:.35,c:'#ffffff',s:rnd(2,4)});
      if(p.struggle>=14) freePlayer(p);
    }
    p.moving=false; return;
  }
  p._mash = k.mash;
  let dx=0, dy=0;
  if(k.l) dx=-1; else if(k.r) dx=1;
  else if(k.u) dy=-1; else if(k.d) dy=1;
  const dist = p.spd*dt;
  if(dx){ p.dir = dx>0?'right':'left'; moveP(p,dx,0,dist); }
  if(dy){ p.dir = dy>0?'down':'up';    moveP(p,0,dy,dist); }
  p.moving = !!(dx||dy);
  if(k.bomb > p._bomb){ p._bomb = k.bomb; placeBalloon(p); }
}

/* ============================================================ 시뮬레이션 */
function simulate(dt){
  timeLeft -= dt;
  if(timeLeft<=0){ timeLeft=0; return finishByTime(); }

  updateBalloonPass();

  for(const p of players){
    if(p.out && !p.alive) continue;
    if(!p.alive){
      p.respawn -= dt;
      if(p.respawn<=0) doRespawn(p);
      continue;
    }
    if(p.inv>0) p.inv -= dt;
    p.anim = p.moving ? p.anim + dt*9 : 0;

    if(p.trapped){
      p.trapT -= dt; p.moving=false;
      if(p.isAI){ if(p.trapT<=0) killPlayer(p,null); }
      else { applyHumanInput(p,dt); if(p.trapped && p.trapT<=0) killPlayer(p,null); }
      continue;
    }
    if(p.isAI) aiUpdate(p,dt); else applyHumanInput(p,dt);

    /* 아군 물방울 터뜨려 구출 */
    for(const q of players){
      if(q===p||!q.trapped) continue;
      if(Math.hypot(q.x-p.x,q.y-p.y)<20 && !isEnemy(p,q)) freePlayer(q);
    }
    /* 아이템 */
    const X=gx(p.x), Y=gx(p.y);
    for(let i=items.length-1;i>=0;i--)
      if(items[i].gx===X && items[i].gy===Y){ const it=items[i]; items.splice(i,1); applyItem(p,it.kind); }

    if(waterHits(p)) trapPlayer(p);
  }

  const chain=[];
  for(const b of balloons){ b.t-=dt; if(b.t<=0) chain.push(b); }
  while(chain.length){ const b=chain.shift(); if(balloons.includes(b)) explode(b,chain); }

  for(let i=waters.length-1;i>=0;i--){
    const w=waters[i]; w.t+=dt;
    if(w.t>w.life) waters.splice(i,1);
    else if(w.t>=0)
      for(let j=items.length-1;j>=0;j--)
        if(items[j].gx===w.gx&&items[j].gy===w.gy) items.splice(j,1);
  }
  for(let i=fx.length-1;i>=0;i--){
    const f=fx[i]; f.t-=dt; f.x+=f.vx*dt; f.y+=f.vy*dt; f.vy+=420*dt;
    if(f.t<=0) fx.splice(i,1);
  }
  for(const it of items) it.t += dt;
  if(shake>0) shake=Math.max(0,shake-dt*22);

  checkEnd();
}

function humansIn(){ return players.filter(p=>!p.isAI && !p.out); }
function aliveOf(list){ return list.filter(p=>p.alive || p.respawn>0); }

function checkEnd(){
  if(MODE==='coop'){
    const bots = players.filter(p=>p.isAI);
    if(bots.length && bots.every(b=>b.out)){
      for(const p of players) if(!p.isAI) p.score += Math.floor(timeLeft)*10 + 1000;
      sfx('clear');
      scene = (stageIdx>=STAGES.length-1) ? 'win' : 'clear';
      sceneT=0; announceOver();
      return;
    }
    if(humansIn().length===0){ scene='gameover'; sceneT=0; announceOver(); }
  } else {
    const live = players.filter(p=>!p.out);
    if(live.length<=1){
      roundResult = live.length ? { winner: live[0].id, nick: nameOf(live[0]) } : { winner:null };
      if(live.length) live[0].score += 1000;
      sfx('clear');
      scene='round'; sceneT=0; announceOver();
    }
  }
}
function finishByTime(){
  if(MODE==='coop'){
    for(const p of players) if(!p.isAI && !p.out){ p.lives--; if(p.lives<=0) p.out=true; }
    if(humansIn().length===0){ scene='gameover'; sceneT=0; announceOver(); }
    else { buildStage(stageIdx, (Math.random()*1e9)|0); resetPositions(); timeLeft=stageDef.time; scene='ready'; sceneT=0; }
  } else {
    roundResult = { winner:null };
    scene='round'; sceneT=0; announceOver();
  }
}
function resetPositions(){
  players.forEach((p,i)=>{
    const s=SPAWNS[i%SPAWNS.length];
    p.x=cx(s[0]); p.y=cx(s[1]); p.tx=p.x; p.ty=p.y;
    p.alive=!p.out; p.trapped=false; p.inv=1.5; p.respawn=0;
  });
}
function announceOver(){
  if(ROLE==='host' && window.NET) window.NET.send({t:'over', r:{scene, result:roundResult}});
}
function nameOf(p){
  if(p.isAI) return p.skin.name;
  return nicks[p.id] || p.skin.name;
}

/* ------------------------------------------ 다음 스테이지 / 다음 라운드 */
function advance(){
  if(MODE==='coop'){
    if(scene==='clear'){
      stageIdx++;
      buildStage(stageIdx, (Math.random()*1e9)|0);
      spawnKeepStats();
      timeLeft=stageDef.time; scene='ready'; sceneT=0;
    }
  } else if(scene==='round'){
    round++;
    stageIdx = (stageIdx+1) % STAGES.length;
    buildStage(stageIdx, (Math.random()*1e9)|0);
    for(const p of players){
      p.out=false; p.lives=1; p.maxB=CHARS[p.charIdx]?CHARS[p.charIdx].balloons:1;
      const sk=p.skin; p.maxB=sk.balloons||2; p.power=sk.power||2; p.spd=70+(sk.speed||2)*10; p.needle=0;
    }
    resetPositions();
    timeLeft=180; roundResult=null; scene='ready'; sceneT=0;
  }
}
function spawnKeepStats(){
  /* 협동: 사람은 능력치를 유지하고, 봇은 새 스테이지 기준으로 다시 만듭니다 */
  const humans = players.filter(p=>!p.isAI);
  players = humans;
  humans.forEach((p,i)=>{
    const s=SPAWNS[i%SPAWNS.length];
    p.x=cx(s[0]); p.y=cx(s[1]); p.tx=p.x; p.ty=p.y;
    p.alive=!p.out; p.trapped=false; p.inv=1.5; p.respawn=0;
  });
  for(let i=0;i<stageDef.enemies;i++){
    const s=SPAWNS[(humans.length+i)%SPAWNS.length];
    players.push(tuneBot(mkPlayer(
      {id:-(i+1),charIdx:i,isAI:true,team:1,tx:s[0],ty:s[1],lives:1})));
  }
}

/* ============================================================ 스냅샷 */
function buildSnap(){
  const s = {
    k:scene, si:stageIdx, rd:round, tl:r1(timeLeft), md:MODE,
    mp: mapDirty ? mapString() : null,
    rr: roundResult,
    ps: players.map(p=>[p.id, r1(p.x), r1(p.y), DIRS.indexOf(p.dir), p.moving?1:0,
        p.alive?1:0, p.trapped?1:0, r1(p.trapT), r1(p.inv), p.maxB, p.power,
        Math.round(p.spd), p.needle, p.score, p.lives, p.charIdx, p.team,
        p.isAI?1:0, p.out?1:0, r1(p.respawn)]),
    bs: balloons.map(b=>[b.gx,b.gy,r2(b.t),b.power, b.pass||[]]),
    ws: waters.map(w=>[w.gx,w.gy,WKIND.indexOf(w.kind),r2(w.t),r2(w.life)]),
    it: items.map(i=>[i.gx,i.gy,ITEMS.indexOf(i.kind)]),
  };
  mapDirty = false;
  return s;
}

function applySnap(s){
  const prevScene = scene;
  scene = s.k; stageIdx = s.si; round = s.rd; timeLeft = s.tl; MODE = s.md;
  roundResult = s.rr || null;
  if(STAGES[stageIdx] !== stageDef){ stageDef = STAGES[stageIdx]; }
  if(s.mp){ mapFromString(s.mp); bg = renderBackground(); }
  if(prevScene !== scene) sceneT = 0;

  /* 플레이어 */
  const seen = new Set();
  for(const a of s.ps){
    const [id,x,y,di,mv,al,tr,trT,inv,mb,pw,sp,nd,sc,lv,ci,tm,ai,out,rs] = a;
    seen.add(id);
    let p = players.find(q=>q.id===id);
    if(!p){
      p = mkPlayer({id, charIdx:ci, isAI:!!ai, local:(id===myId), team:tm,
                    tx:1, ty:1, lives:lv});
      players.push(p);
    }
    p.tx=x; p.ty=y;
    if(!p.local || !p.alive){ p.x=x; p.y=y; }
    p.dir=DIRS[di]; p.moving=!!mv; p.alive=!!al; p.trapped=!!tr; p.trapT=trT;
    p.inv=inv; p.maxB=mb; p.power=pw; p.spd=sp; p.needle=nd; p.score=sc;
    p.lives=lv; p.team=tm; p.out=!!out; p.respawn=rs;
    if(p.moving) p.anim += 1/60*9; else p.anim = 0;
  }
  players = players.filter(p=>seen.has(p.id));

  balloons = s.bs.map(b=>({gx:b[0],gy:b[1],t:b[2],power:b[3],owner:null,pass:b[4]||[]}));
  waters   = s.ws.map(w=>({gx:w[0],gy:w[1],kind:WKIND[w[2]],t:w[3],life:w[4]}));
  items    = s.it.map(i=>({gx:i[0],gy:i[1],kind:ITEMS[i[2]],t:0}));
}

/* guest: 내 캐릭터만 로컬 예측해서 조작감을 살립니다 */
function predictLocal(dt){
  const p = me();
  if(!p || !p.alive || p.trapped || scene!=='play') return;
  const k = p.input;
  let dx=0,dy=0;
  if(k.l) dx=-1; else if(k.r) dx=1;
  else if(k.u) dy=-1; else if(k.d) dy=1;
  const dist=p.spd*dt;
  if(dx){ p.dir=dx>0?'right':'left'; moveP(p,dx,0,dist); }
  if(dy){ p.dir=dy>0?'down':'up';    moveP(p,0,dy,dist); }
  p.moving=!!(dx||dy);
  if(p.moving) p.anim += dt*9;

  /* 서버(방장) 위치와 너무 벌어지면 보정 */
  const gap = Math.hypot(p.tx-p.x, p.ty-p.y);
  if(gap > 26){ p.x=p.tx; p.y=p.ty; }
  else if(gap > 2){ p.x += (p.tx-p.x)*0.12; p.y += (p.ty-p.y)*0.12; }
}
function smoothOthers(dt){
  for(const p of players){
    if(p.local) continue;
    const a = 1 - Math.pow(0.0001, dt);     // 부드럽게 목표 위치로
    p.x += (p.tx-p.x)*a;
    p.y += (p.ty-p.y)*a;
  }
}

/* ================================================================ 그리기 */
function roundRect(g,x,y,w,h,r){
  g.beginPath();
  g.moveTo(x+r,y); g.lineTo(x+w-r,y); g.quadraticCurveTo(x+w,y,x+w,y+r);
  g.lineTo(x+w,y+h-r); g.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  g.lineTo(x+r,y+h); g.quadraticCurveTo(x,y+h,x,y+h-r);
  g.lineTo(x,y+r); g.quadraticCurveTo(x,y,x+r,y); g.closePath();
}
function barPanel(x,y,w,h,c1,c2){
  const g=ctx.createLinearGradient(0,y,0,y+h);
  g.addColorStop(0,c1); g.addColorStop(1,c2);
  ctx.fillStyle=g; roundRect(ctx,x,y,w,h,6); ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,.5)'; ctx.lineWidth=2; roundRect(ctx,x,y,w,h,6); ctx.stroke();
  ctx.strokeStyle='rgba(255,255,255,.28)'; ctx.lineWidth=1;
  roundRect(ctx,x+2,y+2,w-4,h-4,5); ctx.stroke();
}
function outText(t,x,y,font,fill,align,ow){
  ctx.font=font; ctx.textAlign=align||'left'; ctx.textBaseline='middle';
  ctx.lineWidth=ow||3; ctx.strokeStyle='rgba(0,0,0,.85)'; ctx.lineJoin='round';
  ctx.strokeText(t,x,y); ctx.fillStyle=fill; ctx.fillText(t,x,y);
}
function dim(a){ ctx.fillStyle='rgba(0,0,0,'+a+')'; ctx.fillRect(0,0,cv.width,cv.height); }

function drawBalloon(g,b){
  const px=cx(b.gx), py=cx(b.gy), t=3.0-b.t;
  const r=15*(1+Math.sin(t*(6+t*4))*0.10);
  g.save(); g.translate(px,py);
  g.fillStyle='rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(0,14,r*.85,5,0,0,7); g.fill();
  const grd=g.createRadialGradient(-r*.35,-r*.4,2,0,0,r);
  grd.addColorStop(0,'#bfefff'); grd.addColorStop(.55,'#42b6ee'); grd.addColorStop(1,'#1d6fb8');
  g.fillStyle=grd; g.beginPath(); g.arc(0,0,r,0,7); g.fill();
  g.strokeStyle='rgba(255,255,255,.55)'; g.lineWidth=1.5;
  g.beginPath(); g.arc(0,0,r-1,0,7); g.stroke();
  g.fillStyle='rgba(255,255,255,.85)';
  g.beginPath(); g.ellipse(-r*.34,-r*.38,r*.24,r*.16,-0.6,0,7); g.fill();
  g.fillStyle='#1d6fb8';
  g.beginPath(); g.moveTo(-4,r-2); g.lineTo(4,r-2); g.lineTo(0,r+5); g.closePath(); g.fill();
  if(b.t<1){ g.globalAlpha=(Math.sin(t*26)+1)/2*.5; g.fillStyle='#fff';
    g.beginPath(); g.arc(0,0,r,0,7); g.fill(); g.globalAlpha=1; }
  g.restore();
}
function drawWater(g,w){
  const px=w.gx*TILE, py=w.gy*TILE, k=clamp(w.t/w.life,0,1);
  const grow = k<.25 ? k/.25 : 1, fade = k>.7 ? 1-(k-.7)/.3 : 1;
  g.save(); g.globalAlpha=fade; g.translate(px+TILE/2,py+TILE/2);
  const s=TILE*grow;
  const grd=g.createLinearGradient(0,-s/2,0,s/2);
  grd.addColorStop(0,'#d6f6ff'); grd.addColorStop(.5,'#5cc8f2'); grd.addColorStop(1,'#2e93d8');
  g.fillStyle=grd; roundRect(g,-s/2,-s/2,s,s,10); g.fill();
  g.fillStyle='rgba(255,255,255,.75)';
  for(let i=0;i<4;i++){
    const a=w.t*7+i*1.6;
    g.beginPath(); g.arc(Math.cos(a)*s*.22, Math.sin(a*1.3)*s*.22, s*.10*(1-k*.5),0,7); g.fill();
  }
  g.fillStyle='rgba(255,255,255,.45)';
  g.beginPath(); g.ellipse(-s*.16,-s*.2,s*.16,s*.09,-.5,0,7); g.fill();
  g.restore();
}
function drawItem(g,px,py,kind){
  g.save(); g.translate(px,py);
  g.fillStyle='rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(0,15,11,4,0,0,7); g.fill();
  const grd=g.createLinearGradient(0,-14,0,14);
  grd.addColorStop(0,'#ffffff'); grd.addColorStop(1,'#c8d8e8');
  g.fillStyle=grd; roundRect(g,-14,-14,28,28,7); g.fill();
  g.strokeStyle='#5a7ea0'; g.lineWidth=2; roundRect(g,-14,-14,28,28,7); g.stroke();
  if(kind==='balloon'){
    const b=g.createRadialGradient(-3,-4,1,0,0,9);
    b.addColorStop(0,'#cdf1ff'); b.addColorStop(1,'#2e93d8');
    g.fillStyle=b; g.beginPath(); g.arc(0,-1,8.5,0,7); g.fill();
    g.fillStyle='#2e93d8'; g.beginPath();
    g.moveTo(-3,7); g.lineTo(3,7); g.lineTo(0,12); g.closePath(); g.fill();
    g.fillStyle='rgba(255,255,255,.85)'; g.beginPath(); g.ellipse(-3,-4,2.4,1.6,-.6,0,7); g.fill();
  } else if(kind==='power'){
    g.fillStyle='#2e93d8'; g.beginPath();
    g.moveTo(0,-11); g.quadraticCurveTo(9,0,9,4);
    g.arc(0,4,9,0,Math.PI); g.quadraticCurveTo(-9,0,0,-11); g.fill();
    g.fillStyle='#8fe0ff'; g.beginPath(); g.arc(-2.5,4,3.4,0,7); g.fill();
    g.fillStyle='#fff';    g.beginPath(); g.arc(-3.4,2.4,1.5,0,7); g.fill();
  } else if(kind==='speed'){
    g.fillStyle='#d94a4a'; roundRect(g,-10,-9,20,11,3); g.fill();
    g.fillStyle='#ffffff'; roundRect(g,-10,-9,20,4,2);  g.fill();
    g.fillStyle='#3a3a44'; roundRect(g,-11,2,22,4,2);   g.fill();
    g.fillStyle='#ffe14a';
    g.beginPath(); g.arc(-6,9,3.4,0,7); g.fill();
    g.beginPath(); g.arc( 6,9,3.4,0,7); g.fill();
    g.fillStyle='#3a3a44';
    g.beginPath(); g.arc(-6,9,1.2,0,7); g.fill();
    g.beginPath(); g.arc( 6,9,1.2,0,7); g.fill();
  } else if(kind==='needle'){
    g.strokeStyle='#c0c8d4'; g.lineWidth=3;
    g.beginPath(); g.moveTo(-8,9); g.lineTo(7,-8); g.stroke();
    g.fillStyle='#ffe14a'; g.beginPath(); g.arc(8,-9,4,0,7); g.fill();
    g.strokeStyle='#a08a20'; g.lineWidth=1.5; g.beginPath(); g.arc(8,-9,4,0,7); g.stroke();
  } else {
    g.fillStyle='#e8392f'; g.beginPath();
    g.moveTo(0,10);
    g.bezierCurveTo(-13,0,-8,-11,0,-5);
    g.bezierCurveTo(8,-11,13,0,0,10); g.fill();
    g.fillStyle='rgba(255,255,255,.6)';
    g.beginPath(); g.ellipse(-4,-3,2.4,1.6,-.5,0,7); g.fill();
  }
  g.restore();
}
function drawFace(g,s){
  g.fillStyle=s.ear;
  g.beginPath(); g.arc(-9,-13,5.6,0,7); g.fill();
  g.beginPath(); g.arc( 9,-13,5.6,0,7); g.fill();
  g.fillStyle=s.skin; g.beginPath(); g.arc(0,-4,13,0,7); g.fill();
  g.fillStyle=s.hood; g.beginPath(); g.arc(0,-4,13,Math.PI*1.02,Math.PI*1.98); g.closePath(); g.fill();
  g.fillStyle=s.trim; g.fillRect(-13,-7,26,2.5);
  g.strokeStyle='rgba(0,0,0,.35)'; g.lineWidth=1.2;
  g.beginPath(); g.arc(0,-4,13,0,7); g.stroke();
  g.fillStyle='#25232b';
  g.beginPath(); g.ellipse(-4.5,-2.5,2.1,2.8,0,0,7); g.fill();
  g.beginPath(); g.ellipse( 4.5,-2.5,2.1,2.8,0,0,7); g.fill();
  g.fillStyle='#fff';
  g.beginPath(); g.arc(-5.2,-3.6,.9,0,7); g.fill();
  g.beginPath(); g.arc( 3.8,-3.6,.9,0,7); g.fill();
  g.fillStyle='rgba(255,120,120,.5)';
  g.beginPath(); g.ellipse(-8.5,1.2,3,1.9,0,0,7); g.fill();
  g.beginPath(); g.ellipse( 8.5,1.2,3,1.9,0,0,7); g.fill();
  g.strokeStyle='#25232b'; g.lineWidth=1.3;
  g.beginPath(); g.arc(0,1.5,2.6,.15*Math.PI,.85*Math.PI); g.stroke();
}
function drawBubble(g,p){
  const t=performance.now()/1000, r=19+Math.sin(t*5)*1.4, urgent=p.trapT<2;
  g.save(); g.translate(p.x,p.y-2);
  const grd=g.createRadialGradient(-r*.3,-r*.35,2,0,0,r);
  grd.addColorStop(0,'rgba(255,255,255,.75)');
  grd.addColorStop(.6,'rgba(150,225,255,.35)');
  grd.addColorStop(1,'rgba(70,180,240,.55)');
  g.fillStyle=grd; g.beginPath(); g.arc(0,0,r,0,7); g.fill();
  g.lineWidth=2;
  g.strokeStyle = urgent && Math.floor(t*10)%2===0 ? '#ff5c5c' : 'rgba(255,255,255,.9)';
  g.beginPath(); g.arc(0,0,r,0,7); g.stroke();
  g.fillStyle='rgba(255,255,255,.9)';
  g.beginPath(); g.ellipse(-r*.36,-r*.4,r*.2,r*.12,-.6,0,7); g.fill();
  g.strokeStyle=urgent?'#ff5c5c':'#ffe14a'; g.lineWidth=3;
  g.beginPath(); g.arc(0,0,r+3,-Math.PI/2,-Math.PI/2+Math.PI*2*(p.trapT/5)); g.stroke();
  g.restore();
  if(p.local){
    outText('방향키 연타!', p.x, p.y-30, 'bold 11px "Malgun Gothic",sans-serif','#ffffff','center',3);
  }
}
function drawChar(g,p){
  const s=p.skin;
  const bob = p.moving ? Math.sin(p.anim)*2.5 : Math.sin(performance.now()/420)*1.0;
  const lean= p.moving ? Math.sin(p.anim)*0.07 : 0;
  g.save(); g.translate(p.x,p.y+bob);
  if(p.inv>0 && Math.floor(p.inv*12)%2===0) g.globalAlpha=.45;
  g.fillStyle='rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(0,15-bob,13,5,0,0,7); g.fill();
  g.rotate(lean);
  const fo = p.moving ? Math.sin(p.anim)*3.5 : 0;
  g.fillStyle='#ffffff'; g.strokeStyle='rgba(0,0,0,.35)'; g.lineWidth=1;
  g.beginPath(); g.ellipse(-6,12+fo,5,3.5,0,0,7); g.fill(); g.stroke();
  g.beginPath(); g.ellipse( 6,12-fo,5,3.5,0,0,7); g.fill(); g.stroke();
  g.fillStyle=s.hood;  g.beginPath(); g.ellipse(0,5,11,9,0,0,7); g.fill();
  g.fillStyle=s.belly; g.beginPath(); g.ellipse(0,7,6.5,5.5,0,0,7); g.fill();
  g.strokeStyle='rgba(0,0,0,.30)'; g.lineWidth=1;
  g.beginPath(); g.ellipse(0,5,11,9,0,0,7); g.stroke();
  g.fillStyle=s.hood2;
  g.beginPath(); g.ellipse(-11,4,3.5,4.5,-.3,0,7); g.fill();
  g.beginPath(); g.ellipse( 11,4,3.5,4.5, .3,0,7); g.fill();
  g.fillStyle=s.ear;
  g.beginPath(); g.arc(-8,-13,5.2,0,7); g.fill();
  g.beginPath(); g.arc( 8,-13,5.2,0,7); g.fill();
  g.fillStyle=s.hood2;
  g.beginPath(); g.arc(-8,-13,2.4,0,7); g.fill();
  g.beginPath(); g.arc( 8,-13,2.4,0,7); g.fill();
  g.fillStyle=s.skin; g.beginPath(); g.arc(0,-6,10.5,0,7); g.fill();
  g.fillStyle=s.hood; g.beginPath(); g.arc(0,-6,10.5,Math.PI*1.02,Math.PI*1.98); g.closePath(); g.fill();
  g.fillStyle=s.trim; g.fillRect(-10.5,-8.5,21,2);
  g.strokeStyle='rgba(0,0,0,.32)'; g.lineWidth=1;
  g.beginPath(); g.arc(0,-6,10.5,0,7); g.stroke();
  g.fillStyle='#25232b';
  if(p.dir==='up'){
    g.beginPath(); g.arc(-4,-4,1.4,0,7); g.fill();
    g.beginPath(); g.arc( 4,-4,1.4,0,7); g.fill();
  } else {
    const ex = p.dir==='left'?-1.6 : p.dir==='right'?1.6 : 0;
    g.beginPath(); g.ellipse(-3.6+ex,-4.5,1.7,2.3,0,0,7); g.fill();
    g.beginPath(); g.ellipse( 3.6+ex,-4.5,1.7,2.3,0,0,7); g.fill();
    g.fillStyle='#fff';
    g.beginPath(); g.arc(-4.1+ex,-5.4,.7,0,7); g.fill();
    g.beginPath(); g.arc( 3.1+ex,-5.4,.7,0,7); g.fill();
    g.fillStyle='rgba(255,120,120,.45)';
    g.beginPath(); g.ellipse(-7+ex,-1.6,2.4,1.5,0,0,7); g.fill();
    g.beginPath(); g.ellipse( 7+ex,-1.6,2.4,1.5,0,0,7); g.fill();
    g.strokeStyle='#25232b'; g.lineWidth=1.2;
    g.beginPath(); g.arc(0+ex,-1.5,2.2,0.15*Math.PI,0.85*Math.PI); g.stroke();
  }
  g.globalAlpha=1;
  g.restore();

  if(p.trapped) drawBubble(g,p);

  /* 이름표 — 온라인에서는 누가 누군지 바로 보여야 합니다 */
  if(!p.isAI){
    const label = p.local ? 'YOU' : nameOf(p);
    const col = p.local ? '#ffe14a'
              : (MODE==='versus' ? TEAM_COLORS[(p.team-1)%TEAM_COLORS.length] : '#9fe8ff');
    outText(label, p.x, p.y-26, 'bold 10px "Malgun Gothic",sans-serif', col, 'center', 3);
  }
}

function drawField(){
  ctx.save();
  const sx = shake? rnd(-shake,shake):0, sy = shake? rnd(-shake,shake):0;
  ctx.translate(OX+sx, OY+sy);
  ctx.beginPath(); ctx.rect(0,0,MAPW,MAPH); ctx.clip();
  ctx.drawImage(bg,0,0);
  for(const it of items) drawItem(ctx, cx(it.gx), cx(it.gy)+Math.sin(it.t*4)*3, it.kind);
  for(const w of waters) if(w.t>=0) drawWater(ctx,w);
  for(const b of balloons) drawBalloon(ctx,b);
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(map[y][x]===BOX) drawBox(ctx,x*TILE,y*TILE);
  for(const p of players.filter(p=>p.alive).sort((a,b)=>a.y-b.y)) drawChar(ctx,p);
  for(const f of fx){
    ctx.globalAlpha=clamp(f.t*2,0,1); ctx.fillStyle=f.c;
    ctx.fillRect(f.x-f.s/2,f.y-f.s/2,f.s,f.s);
  }
  ctx.globalAlpha=1; ctx.restore();
  ctx.strokeStyle='#0a2b52'; ctx.lineWidth=2;
  ctx.strokeRect(OX-1,OY-1,MAPW+2,MAPH+2);
}

function drawHUDTop(){
  barPanel(6,6,cv.width-12,42,'#3d86d8','#1b4d8e');
  const badge = MODE==='versus' ? ('ROUND '+round) : ('STAGE '+(stageIdx+1));
  barPanel(12,11,120,32,'#ffd24a','#e08a12');
  outText(badge, 72, 28, 'bold 15px "Malgun Gothic",sans-serif','#fff','center');
  outText(MODE==='versus' ? '대전 · 마지막 생존자 승리' : stageDef.name,
          144, 28, 'bold 17px "Malgun Gothic",sans-serif','#ffffff','left');
  const mm=Math.floor(timeLeft/60), ss=Math.floor(timeLeft%60), low=timeLeft<30;
  barPanel(cv.width-136,11,124,32, low?'#ff6b5c':'#2a3f5c', low?'#c22b1c':'#16243a');
  outText('TIME', cv.width-124, 28,'bold 13px "Malgun Gothic",sans-serif','#9fd0ff','left');
  outText(mm+':'+String(ss).padStart(2,'0'), cv.width-18, 28,
          'bold 20px Consolas,monospace', low?'#fff':'#ffe14a','right');
}

function drawHUDBottom(){
  const y=OY+MAPH+6;
  barPanel(6,y,cv.width-12,54,'#3d86d8','#1b4d8e');
  const p = me(); if(!p) return;
  barPanel(12,y+5,44,44,'#dff0ff','#9dc4e8');
  ctx.save(); ctx.translate(34,y+34); ctx.scale(.95,.95); drawFace(ctx,p.skin); ctx.restore();
  outText(nameOf(p), 64, y+17, 'bold 13px "Malgun Gothic",sans-serif','#ffffff','left');
  for(let i=0;i<Math.min(p.lives,6);i++){
    ctx.save(); ctx.translate(70+i*17,y+38); ctx.scale(.42,.42);
    ctx.fillStyle='#ff5c5c';
    ctx.beginPath(); ctx.moveTo(0,10);
    ctx.bezierCurveTo(-13,0,-8,-11,0,-5);
    ctx.bezierCurveTo(8,-11,13,0,0,10); ctx.fill();
    ctx.restore();
  }
  const chips=[['balloon',p.maxB],['power',p.power],
               ['speed',Math.round((p.spd-70)/14)+1],['needle',p.needle]];
  let sx=170;
  for(const [k,v] of chips){
    const off=(k==='needle'&&v===0);
    ctx.globalAlpha = off?.35:1;
    barPanel(sx,y+7,66,40,'#2a3f5c','#16243a');
    ctx.save(); ctx.translate(sx+18,y+27); ctx.scale(.55,.55); drawItem(ctx,0,0,k); ctx.restore();
    outText('x'+v, sx+38, y+27,'bold 16px "Malgun Gothic",sans-serif', off?'#8fa8c4':'#ffe14a','left');
    ctx.globalAlpha=1;
    sx+=72;
  }
  barPanel(cv.width-158,y+7,146,40,'#2a3f5c','#16243a');
  outText('SCORE', cv.width-148, y+18,'bold 11px "Malgun Gothic",sans-serif','#9fd0ff','left');
  outText(String(p.score).padStart(7,'0'), cv.width-18, y+33,
          'bold 19px Consolas,monospace','#ffffff','right');
}

/* 온라인일 때 오른쪽 위에 플레이어 현황 */
function drawRoster(){
  const humans = players.filter(p=>!p.isAI);
  if(humans.length<2) return;
  const w=126, h=18*humans.length+10, x=cv.width-w-16, y=OY+8;
  ctx.globalAlpha=.86; barPanel(x,y,w,h,'#16375c','#0b2038'); ctx.globalAlpha=1;
  humans.forEach((p,i)=>{
    const ly=y+16+i*18;
    const col = MODE==='versus' ? TEAM_COLORS[(p.team-1)%TEAM_COLORS.length] : '#9fe8ff';
    ctx.fillStyle = p.out ? '#5a6a7c' : col;
    ctx.beginPath(); ctx.arc(x+12,ly,4,0,7); ctx.fill();
    const nm = nameOf(p) + (p.out?' (탈락)':'');
    outText(nm, x+22, ly, 'bold 11px "Malgun Gothic",sans-serif',
            p.out?'#8fa0b4':'#ffffff','left',2.5);
  });
}

/* ------------------------------------------------------------- 오버레이 */
function drawReady(){
  dim(.55);
  const t=sceneT, sc = t<.35 ? t/.35*1.25 : (t<.5 ? 1.25-(t-.35)/.15*.25 : 1);
  ctx.save(); ctx.translate(cv.width/2,cv.height/2); ctx.scale(sc,sc);
  outText(MODE==='versus'?'마지막까지 살아남으세요!':stageDef.name,
          0,-70,'bold 26px "Malgun Gothic",sans-serif','#8fe0ff','center',5);
  const label = MODE==='versus' ? ('ROUND '+round) : ('STAGE '+(stageIdx+1));
  ctx.font='bold 56px "Malgun Gothic",sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.lineJoin='round'; ctx.lineWidth=14; ctx.strokeStyle='#0b3f7a'; ctx.strokeText(label,0,-10);
  ctx.lineWidth=7; ctx.strokeStyle='#fff'; ctx.strokeText(label,0,-10);
  const lg=ctx.createLinearGradient(0,-40,0,20);
  lg.addColorStop(0,'#fff6a8'); lg.addColorStop(1,'#f08a12');
  ctx.fillStyle=lg; ctx.fillText(label,0,-10);
  outText('START !!',0,52,'bold 40px "Malgun Gothic",sans-serif','#ffffff','center',8);
  ctx.restore();
}
function drawClear(){
  dim(.6);
  const p=me();
  const w=420,h=280,x=(cv.width-w)/2,y=(cv.height-h)/2;
  barPanel(x,y,w,h,'#3d86d8','#123a6a');
  outText('STAGE CLEAR !', cv.width/2, y+42,'bold 32px "Malgun Gothic",sans-serif','#ffe14a','center',6);
  outText(stageDef.name, cv.width/2, y+76,'bold 16px "Malgun Gothic",sans-serif','#8fe0ff','center',3);
  const humans=players.filter(q=>!q.isAI).sort((a,b)=>b.score-a.score);
  let ly=y+118;
  for(const q of humans.slice(0,4)){
    outText(nameOf(q), x+40, ly,'15px "Malgun Gothic",sans-serif', q.local?'#ffe14a':'#dff0ff','left',2.5);
    outText(String(q.score), x+w-40, ly,'bold 17px Consolas,monospace','#ffffff','right');
    ly+=30;
  }
  if(p) outText('물풍선 x'+p.maxB+'   물줄기 x'+p.power+'   목숨 x'+p.lives,
                cv.width/2, y+h-58,'bold 14px "Malgun Gothic",sans-serif','#8fe0ff','center',3);
  if(Math.floor(sceneT*2)%2===0)
    outText(canAdvance()? 'ENTER 로 다음 스테이지' : '방장이 넘기기를 기다리는 중...',
            cv.width/2, y+h-26,'bold 15px "Malgun Gothic",sans-serif','#ffe14a','center',4);
}
function drawRound(){
  dim(.62);
  const w=420,h=300,x=(cv.width-w)/2,y=(cv.height-h)/2;
  barPanel(x,y,w,h,'#3d86d8','#123a6a');
  const win = roundResult && roundResult.winner != null;
  outText(win ? 'WINNER !' : '무승부', cv.width/2, y+44,
          'bold 34px "Malgun Gothic",sans-serif','#ffe14a','center',6);
  if(win)
    outText(roundResult.nick || '', cv.width/2, y+86,
            'bold 22px "Malgun Gothic",sans-serif','#ffffff','center',5);
  const humans=players.filter(q=>!q.isAI).sort((a,b)=>b.score-a.score);
  let ly=y+130;
  for(const q of humans.slice(0,4)){
    const col=TEAM_COLORS[(q.team-1)%TEAM_COLORS.length];
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(x+34,ly,5,0,7); ctx.fill();
    outText(nameOf(q), x+48, ly,'15px "Malgun Gothic",sans-serif', q.local?'#ffe14a':'#dff0ff','left',2.5);
    outText(String(q.score), x+w-40, ly,'bold 17px Consolas,monospace','#ffffff','right');
    ly+=30;
  }
  if(Math.floor(sceneT*2)%2===0)
    outText(canAdvance()? 'ENTER 로 다음 라운드' : '방장이 넘기기를 기다리는 중...',
            cv.width/2, y+h-28,'bold 15px "Malgun Gothic",sans-serif','#ffe14a','center',4);
}
function drawOver(){
  dim(.72);
  outText('GAME OVER', cv.width/2, cv.height/2-40,'bold 46px "Malgun Gothic",sans-serif','#ff6b5c','center',9);
  const p=me();
  outText('최종 점수  '+(p?p.score:0), cv.width/2, cv.height/2+16,
          'bold 22px "Malgun Gothic",sans-serif','#ffffff','center',4);
  outText('도달 스테이지  '+(stageIdx+1)+' / '+STAGES.length, cv.width/2, cv.height/2+50,
          'bold 16px "Malgun Gothic",sans-serif','#8fe0ff','center',3);
  if(Math.floor(sceneT*2)%2===0)
    outText(ROLE==='single'?'ENTER 로 처음부터':'ENTER 로 로비',
            cv.width/2, cv.height/2+104,'bold 17px "Malgun Gothic",sans-serif','#ffe14a','center',4);
}
function drawWin(){
  dim(.6);
  const t=performance.now()/1000;
  for(let i=0;i<50;i++){
    const x=(i*127)%cv.width, y=((t*90+i*53)%(cv.height+40))-20;
    ctx.fillStyle=['#ffe14a','#5ce85c','#ff6b5c','#8fe0ff','#ff9cd8'][i%5];
    ctx.save(); ctx.translate(x,y); ctx.rotate(t*3+i); ctx.fillRect(-4,-4,8,8); ctx.restore();
  }
  outText('ALL STAGE CLEAR!', cv.width/2, cv.height/2-60,'bold 38px "Malgun Gothic",sans-serif','#ffe14a','center',8);
  outText('축하합니다! 로두마니를 물리쳤어요!', cv.width/2, cv.height/2-14,
          'bold 18px "Malgun Gothic",sans-serif','#ffffff','center',4);
  const p=me();
  outText('최종 점수  '+(p?p.score:0), cv.width/2, cv.height/2+28,
          'bold 24px "Malgun Gothic",sans-serif','#8fe0ff','center',4);
  if(Math.floor(sceneT*2)%2===0)
    outText(ROLE==='single'?'ENTER 로 타이틀':'ENTER 로 로비',
            cv.width/2, cv.height/2+90,'bold 16px "Malgun Gothic",sans-serif','#ffe14a','center',4);
}
function drawPause(){
  dim(.55);
  outText('P A U S E', cv.width/2, cv.height/2,'bold 40px "Malgun Gothic",sans-serif','#ffffff','center',8);
  outText('P 키로 계속', cv.width/2, cv.height/2+46,'bold 15px "Malgun Gothic",sans-serif','#ffe14a','center',3);
}
function drawDisconnected(){
  dim(.75);
  outText('방장이 나갔습니다', cv.width/2, cv.height/2-20,
          'bold 26px "Malgun Gothic",sans-serif','#ff6b5c','center',6);
  outText('로비로 돌아갑니다...', cv.width/2, cv.height/2+22,
          'bold 15px "Malgun Gothic",sans-serif','#ffffff','center',3);
}

/* -------------------------------------------------------------- 타이틀 */
const MENU = ['게임시작','온라인 대전','캐릭터선택','게임설명'];
function drawTitle(){
  const g=ctx.createLinearGradient(0,0,0,cv.height);
  g.addColorStop(0,'#39a8f0'); g.addColorStop(.55,'#8fd8ff'); g.addColorStop(1,'#d8f4ff');
  ctx.fillStyle=g; ctx.fillRect(0,0,cv.width,cv.height);
  const t=performance.now()/1000;
  for(let i=0;i<26;i++){
    const bx=((i*97)%cv.width);
    const by=(cv.height-((t*(22+i%7*9)+i*57)%(cv.height+90)));
    const r=7+(i%5)*4;
    ctx.globalAlpha=.28; ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(bx,by,r,0,7); ctx.fill();
    ctx.globalAlpha=.5; ctx.lineWidth=1.5; ctx.strokeStyle='#fff';
    ctx.beginPath(); ctx.arc(bx,by,r,0,7); ctx.stroke();
  }
  ctx.globalAlpha=1;
  ctx.save(); ctx.translate(cv.width/2, 132+Math.sin(t*1.6)*6);
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.lineJoin='round';
  ctx.font='bold 62px "Malgun Gothic",sans-serif';
  ctx.lineWidth=14; ctx.strokeStyle='#0b3f7a'; ctx.strokeText('크레이지',0,-34);
  ctx.lineWidth=7;  ctx.strokeStyle='#ffffff'; ctx.strokeText('크레이지',0,-34);
  const lg=ctx.createLinearGradient(0,-64,0,-6);
  lg.addColorStop(0,'#fff6a8'); lg.addColorStop(.5,'#ffcf3a'); lg.addColorStop(1,'#f08a12');
  ctx.fillStyle=lg; ctx.fillText('크레이지',0,-34);
  ctx.font='bold 58px "Malgun Gothic",sans-serif';
  ctx.lineWidth=13; ctx.strokeStyle='#0b3f7a'; ctx.strokeText('아케이드',0,26);
  ctx.lineWidth=7;  ctx.strokeStyle='#ffffff'; ctx.strokeText('아케이드',0,26);
  ctx.fillStyle=lg; ctx.fillText('아케이드',0,26);
  ctx.font='italic bold 22px Georgia,serif';
  ctx.lineWidth=6; ctx.strokeStyle='#0b3f7a'; ctx.strokeText('Crazy Arcade',0,68);
  ctx.fillStyle='#ffffff'; ctx.fillText('Crazy Arcade',0,68);
  ctx.restore();
  ctx.save(); ctx.translate(104,232+Math.sin(t*2)*5);   ctx.scale(2.1,2.1); drawFace(ctx,CHARS[0]); ctx.restore();
  ctx.save(); ctx.translate(cv.width-104,232+Math.sin(t*2+1)*5); ctx.scale(2.1,2.1); drawFace(ctx,CHARS[1]); ctx.restore();
  ctx.save(); ctx.translate(cv.width/2,246+Math.sin(t*2+2)*5);   ctx.scale(1.8,1.8); drawFace(ctx,CHARS[2]); ctx.restore();

  for(let i=0;i<MENU.length;i++){
    const y=352+i*50, on=(menuIdx===i), w=on?260:230;
    barPanel(cv.width/2-w/2,y-20,w,40, on?'#ffd24a':'#5aa0e0', on?'#e08a12':'#2f6bb0');
    outText(MENU[i], cv.width/2, y,'bold 20px "Malgun Gothic",sans-serif',
            on?'#7a3c00':'#ffffff','center', on?4:3);
    if(on){ ctx.save(); ctx.translate(cv.width/2-w/2-22,y); ctx.scale(.75,.75); drawItem(ctx,0,0,'balloon'); ctx.restore(); }
  }
  outText('↑↓ 선택   ENTER 확인', cv.width/2, cv.height-28,
          'bold 15px "Malgun Gothic",sans-serif','#ffffff','center',4);
  if(showHelp) drawHelp();
}
function drawHelp(){
  dim(.72);
  const w=520,h=466,x=(cv.width-w)/2,y=(cv.height-h)/2;
  barPanel(x,y,w,h,'#3d86d8','#123a6a');
  outText('게 임 설 명', cv.width/2, y+34,'bold 24px "Malgun Gothic",sans-serif','#ffe14a','center',4);
  const lines=[
    ['조작','방향키 또는 WASD 로 이동, SPACE 로 물풍선 설치'],
    ['목표','스테이지의 적을 모두 물리치면 클리어!'],
    ['물풍선','3초 뒤 십자 모양으로 터집니다. 상자를 부수고'],
    ['','아이템을 떨어뜨려요. 다른 물풍선도 연쇄 폭발!'],
    ['물방울','물에 맞으면 물방울에 갇힙니다.'],
    ['','5초 안에 방향키를 연타해 탈출하세요!'],
    ['아이템','물풍선 = 설치 개수 +1'],
    ['','물줄기 = 폭발 길이 +1'],
    ['','롤러 = 이동 속도 +1'],
    ['','바늘 = 갇히는 즉시 자동 탈출 (1회 소모)'],
    ['','하트 = 목숨 +1'],
    ['온라인','방을 만들고 코드를 친구에게 보내면 함께 즐길 수 있어요.'],
  ];
  let ly=y+72;
  for(const [k,v] of lines){
    if(k) outText(k, x+34, ly,'bold 15px "Malgun Gothic",sans-serif','#8fe0ff','left');
    outText(v, x+112, ly,'14px "Malgun Gothic",sans-serif','#ffffff','left',2.5);
    ly+=30;
  }
  outText('ESC / ENTER 로 닫기', cv.width/2, y+h-22,'bold 14px "Malgun Gothic",sans-serif','#ffe14a','center');
}
function drawSelect(){
  const g=ctx.createLinearGradient(0,0,0,cv.height);
  g.addColorStop(0,'#1b4d8e'); g.addColorStop(1,'#0a2b52');
  ctx.fillStyle=g; ctx.fillRect(0,0,cv.width,cv.height);
  barPanel(30,26,cv.width-60,44,'#3d86d8','#1b4d8e');
  outText('캐 릭 터 선 택', cv.width/2, 48,'bold 24px "Malgun Gothic",sans-serif','#ffe14a','center',4);
  const t=performance.now()/1000;
  for(let i=0;i<CHARS.length;i++){
    const c=CHARS[i], on=(sel===i), bw=160,bh=190,bx=48+i*176,by=104;
    barPanel(bx,by,bw,bh, on?'#ffd24a':'#2a5f9e', on?'#e08a12':'#14365f');
    if(on){ ctx.strokeStyle='#fff'; ctx.lineWidth=3; roundRect(ctx,bx-3,by-3,bw+6,bh+6,8); ctx.stroke(); }
    ctx.save(); ctx.translate(bx+bw/2, by+82+(on?Math.sin(t*3)*5:0));
    ctx.scale(on?3.0:2.5, on?3.0:2.5); drawFace(ctx,c); ctx.restore();
    outText(c.name, bx+bw/2, by+bh-24,'bold 22px "Malgun Gothic",sans-serif',
            on?'#7a3c00':'#ffffff','center',4);
  }
  const c=CHARS[sel], px=48,py=320,pw=cv.width-96,ph=200;
  barPanel(px,py,pw,ph,'#2a5f9e','#0f2c4f');
  const dl=c.desc.split('\n');
  for(let i=0;i<dl.length;i++)
    outText(dl[i], px+22, py+30+i*24,'15px "Malgun Gothic",sans-serif','#dff0ff','left',2.5);
  const stats=[['물풍선',c.balloons],['물줄기',c.power],['이동속도',c.speed]];
  let sy=py+96;
  for(const [n,v] of stats){
    outText(n, px+22, sy,'bold 15px "Malgun Gothic",sans-serif','#8fe0ff','left');
    for(let i=0;i<8;i++){
      ctx.fillStyle = i<v ? (i<3?'#5ce85c':i<6?'#ffe14a':'#ff6b5c') : 'rgba(255,255,255,.13)';
      roundRect(ctx, px+120+i*30, sy-9, 24,18,3); ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,.5)'; ctx.lineWidth=1;
      roundRect(ctx, px+120+i*30, sy-9, 24,18,3); ctx.stroke();
    }
    sy+=34;
  }
  outText('← → 선택      ENTER 확인      ESC 뒤로', cv.width/2, cv.height-26,
          'bold 14px "Malgun Gothic",sans-serif','#ffe14a','center');
}

function draw(){
  ctx.clearRect(0,0,cv.width,cv.height);
  if(scene==='title'){ drawTitle(); return; }
  if(scene==='select'){ drawSelect(); return; }
  if(scene==='lobby'){                       // DOM 로비가 위에 뜹니다
    const g=ctx.createLinearGradient(0,0,0,cv.height);
    g.addColorStop(0,'#1b4d8e'); g.addColorStop(1,'#0a2b52');
    ctx.fillStyle=g; ctx.fillRect(0,0,cv.width,cv.height);
    return;
  }
  if(!map) return;
  drawHUDTop(); drawField(); drawHUDBottom();
  if(ROLE!=='single') drawRoster();
  if(scene==='ready')    drawReady();
  if(scene==='clear')    drawClear();
  if(scene==='round')    drawRound();
  if(scene==='gameover') drawOver();
  if(scene==='win')      drawWin();
  if(scene==='dc')       drawDisconnected();
  if(paused && scene==='play') drawPause();
}

/* ============================================================== 입력 */
function hit(code){ if(pressed[code]){ pressed[code]=false; return true; } return false; }
function anyHit(){ let r=false; for(const k of arguments) if(hit(k)) r=true; return r; }
const canAdvance = () => ROLE!=='guest';

/* ============================================================== 루프 */
let netAccum = 0, snapAccum = 0, lastInputSig = '';

function tick(dt){
  sceneT += dt;
  if(hit('KeyM')) muted = !muted;

  /* ---------- 타이틀 / 선택 ---------- */
  if(scene==='title'){
    if(showHelp){ if(anyHit('Enter','Escape','Space')) showHelp=false; return; }
    if(anyHit('ArrowUp','KeyW'))   { menuIdx=(menuIdx+MENU.length-1)%MENU.length; sfx('menu'); }
    if(anyHit('ArrowDown','KeyS')) { menuIdx=(menuIdx+1)%MENU.length; sfx('menu'); }
    if(anyHit('Enter','Space','NumpadEnter')){
      sfx('menu');
      if(menuIdx===0) startSingle();
      else if(menuIdx===1){ scene='lobby'; sceneT=0; if(window.NET) window.NET.openLobby(sel); }
      else if(menuIdx===2){ scene='select'; sceneT=0; }
      else showHelp=true;
    }
    return;
  }
  if(scene==='select'){
    if(anyHit('ArrowLeft','KeyA'))  { sel=(sel+CHARS.length-1)%CHARS.length; sfx('menu'); }
    if(anyHit('ArrowRight','KeyD')) { sel=(sel+1)%CHARS.length; sfx('menu'); }
    if(hit('Escape')){ scene='title'; sceneT=0; }
    if(anyHit('Enter','Space','NumpadEnter')){ sfx('menu'); scene='title'; sceneT=0; }
    return;
  }
  if(scene==='lobby') return;                // DOM 이 처리

  /* ---------- 인게임 ---------- */
  readLocalInput();
  const p = me();
  if(p){
    p.input.l=localInput.l; p.input.r=localInput.r;
    p.input.u=localInput.u; p.input.d=localInput.d;
    if(scene==='play' && !paused){
      if(hit('Space')) localInput.bomb++;
      if(p.trapped && anyHit('ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS'))
        localInput.mash++;
      p.input.bomb=localInput.bomb; p.input.mash=localInput.mash;
    }
  }

  if(scene==='ready'){
    if(ROLE!=='guest' && (sceneT>2.0 || anyHit('Enter','Space'))){ scene='play'; sceneT=0; }
  }
  else if(scene==='play'){
    if(ROLE==='single' && hit('KeyP')) paused=!paused;
    if(hit('Escape')){ leaveToMenu(); return; }
    if(ROLE==='guest'){ predictLocal(dt); smoothOthers(dt); }
    else if(!paused) simulate(dt);
  }
  else if(scene==='clear' || scene==='round'){
    if(canAdvance() && anyHit('Enter','Space')) advance();
  }
  else if(scene==='gameover' || scene==='win'){
    if(sceneT>1 && anyHit('Enter','Space')) leaveToMenu();
  }
  else if(scene==='dc'){
    if(sceneT>1.5) leaveToMenu();
  }

  if(ROLE==='guest' && scene!=='play') smoothOthers(dt);
  if(shake>0 && ROLE==='guest') shake=Math.max(0,shake-dt*22);

  /* ---------- 네트워크 ---------- */
  if(ROLE==='guest' && window.NET){
    netAccum += dt;
    const sig = localInput.l+''+localInput.r+localInput.u+localInput.d+localInput.bomb+'_'+localInput.mash;
    if(netAccum>0.033 && (sig!==lastInputSig || netAccum>0.2)){
      netAccum=0; lastInputSig=sig;
      window.NET.send({t:'input', k:{
        l:localInput.l,r:localInput.r,u:localInput.u,d:localInput.d,
        bomb:localInput.bomb, mash:localInput.mash }});
    }
  }
  if(ROLE==='host' && window.NET && (scene==='play'||scene==='ready')){
    snapAccum += dt;
    if(snapAccum >= 1/20){ snapAccum=0; window.NET.send({t:'snap', s:buildSnap()}); }
  }
}

function leaveToMenu(){
  if(ROLE==='single'){ scene='title'; menuIdx=0; sceneT=0; return; }
  scene='lobby'; sceneT=0;
  if(window.NET) window.NET.backToLobby();
}

let last = performance.now();
function frame(now){
  let dt=(now-last)/1000; last=now;
  dt=Math.min(dt,1/30);
  tick(dt);
  draw();
  for(const k in pressed) pressed[k]=false;
  requestAnimationFrame(frame);
}

/* ============================================================== 공개 API */
function startSingle(){
  ROLE='single'; MODE='coop'; myId=1;
  setupMatch({ role:'single', mode:'coop', myId:1, seed:(Math.random()*1e9)|0,
               players:[{id:1,nick:'YOU',charIdx:sel}], bots:0 });
}
function startNet(cfg){
  ROLE = cfg.role; myId = cfg.myId;
  setupMatch(cfg);
}

function init(canvas){
  cv = canvas; ctx = cv.getContext('2d');
  addEventListener('keydown', e=>{
    if(e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    if(!keys[e.code]) pressed[e.code]=true;
    keys[e.code]=true;
  });
  addEventListener('keyup', e=>{ keys[e.code]=false; });
  addEventListener('blur', ()=>{ for(const k in keys) keys[k]=false; });
  stageDef = STAGES[0];
  buildStage(0,(Math.random()*1e9)|0);
  scene='title';
  requestAnimationFrame(frame);
}

return {
  init, startSingle, startNet, applySnap,
  CHARS, STAGES,
  get scene(){ return scene; },
  set scene(v){ scene=v; sceneT=0; },
  get role(){ return ROLE; },
  get charSel(){ return sel; },
  set charSel(v){ sel=clamp(v|0,0,CHARS.length-1); },
  setHostInput(id, k){
    const p = players.find(q=>q.id===id);
    if(p && !p.isAI) p.input = k;
  },
  onOver(r){                                   // guest: 방장이 알린 판 종료
    if(r && r.scene){ scene=r.scene; sceneT=0; roundResult = r.result||null; }
  },
  hostLeft(){ scene='dc'; sceneT=0; },
  toTitle(){ ROLE='single'; scene='title'; menuIdx=0; sceneT=0; },

  /* 테스트 전용 접근구. 게임 플레이에는 쓰이지 않습니다. */
  _test: {
    tick, draw, buildSnap, buildStage, mapString, SPAWNS, keys, pressed,
    get players(){ return players; },
    get map(){ return map; },
    get scene(){ return scene; },
    get balloons(){ return balloons; },
    get waters(){ return waters; },
    get items(){ return items; },
    get mode(){ return MODE; },
    get role(){ return ROLE; },
    boxCount(){ let n=0; for(const row of map) for(const t of row) if(t===BOX) n++; return n; },
  },
};
})();
