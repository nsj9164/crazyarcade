/* =========================================================================
   검증 스위트
     1) 서버 단위   — 방 생성/입장/중계/방장이양/에러처리
     2) 클라이언트  — 게임 코어를 헤드리스로 구동 (싱글/협동/대전)
     3) 통합        — 실제 서버에 3명이 붙어 한 판을 끝까지 진행
   ========================================================================= */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const assert = require('assert');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
let failures = 0, checks = 0;

function check(name, fn){
  checks++;
  try { fn(); console.log('  PASS  ' + name); }
  catch(e){ failures++; console.log('  FAIL  ' + name + '\n        ' + (e.message || e)); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

/* -------------------------------------------------- 캔버스/DOM 스텁 */
function mkGradient(){ return { addColorStop(){} }; }
function mkCtx(){
  return new Proxy({}, {
    get(t,k){
      if(k==='createLinearGradient'||k==='createRadialGradient') return mkGradient;
      if(k==='measureText') return ()=>({width:10});
      if(k in t) return t[k];
      return ()=>{};
    },
    set(t,k,v){ t[k]=v; return true; },
  });
}
function mkCanvas(w,h){ return { width:w||300, height:h||150, getContext:()=>mkCtx(), style:{} }; }

function makeClientSandbox(){
  const listeners = {};
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Date, URLSearchParams, WebSocket,
    performance: { now: () => sb.__t },
    requestAnimationFrame: () => 0,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    document: {
      getElementById: id => id === 'cv' ? sb.__cv : mkEl(),
      createElement: tag => tag === 'canvas' ? mkCanvas() : mkEl(),
    },
    localStorage: { getItem:()=>null, setItem(){}, removeItem(){} },
    location: { protocol:'http:', host:'localhost:0', hostname:'localhost',
                origin:'http://localhost:0', pathname:'/', search:'' },
    navigator: { clipboard: { writeText: async()=>{} } },
    __t: 0, __listeners: listeners,
  };
  function mkEl(){
    const el = {
      style:{}, classList:{ add(){}, remove(){}, toggle(){} },
      value:'', textContent:'', innerHTML:'', disabled:false,
      childNodes:[], firstChild:null, scrollTop:0, scrollHeight:0,
      appendChild(c){ el.childNodes.push(c); }, removeChild(){},
      querySelector: () => mkEl(),
      addEventListener(){}, onclick:null, onchange:null, select(){},
    };
    return el;
  }
  sb.window = sb; sb.globalThis = sb;
  sb.__cv = mkCanvas(620, 640);
  return sb;
}

function loadGame(sb){
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'public','game.js'),'utf8'), sb, {filename:'game.js'});
  vm.runInContext('G.init(document.getElementById("cv"));', sb);
  return sb.G;
}

/* 게임 내부에 접근하기 위해 드라이버를 같은 스코프에서 실행 */
function runInGame(sb, code){ return vm.runInContext(code, sb); }

/* ===================================================================== */
/* 1) 서버 단위 테스트                                                    */
/* ===================================================================== */
async function serverTests(){
  section('1) 서버');

  process.env.PORT = '0';
  delete require.cache[require.resolve(path.join(ROOT,'server','server.js'))];
  const srv = require(path.join(ROOT,'server','server.js'));
  await new Promise(r => srv.server.listen(0, r));
  const port = srv.server.address().port;
  const url = 'ws://127.0.0.1:' + port;

  /* 편의 래퍼: 메시지를 큐에 쌓고 기다릴 수 있게 */
  function client(){
    const c = { ws:new WebSocket(url), q:[], waiters:[] };
    c.ws.on('message', d => {
      const m = JSON.parse(d);
      c.q.push(m);
      for(let i=c.waiters.length-1;i>=0;i--){
        if(c.waiters[i].pred(m)){ c.waiters[i].resolve(m); c.waiters.splice(i,1); }
      }
    });
    c.send = o => c.ws.send(JSON.stringify(o));
    c.wait = (pred, ms=3000) => new Promise((res,rej)=>{
      const found = c.q.find(pred);
      if(found) return res(found);
      const w = { pred, resolve:res };
      c.waiters.push(w);
      setTimeout(()=>rej(new Error('timeout waiting for message')), ms);
    });
    c.open = () => new Promise(r => c.ws.on('open', r));
    return c;
  }
  const T = t => m => m.t === t;

  const host = client(); await host.open();
  host.send({ t:'create', nick:'방장', charIdx:0, mode:'coop', bots:1 });
  const joined = await host.wait(T('joined'));
  const code = joined.code;

  check('방 코드는 4자리', () => assert.strictEqual(code.length, 4));
  const lb1 = await host.wait(T('lobby'));
  check('방장이 host 로 표시', () => assert.ok(lb1.players[0].host));
  check('생성 시 모드/봇 반영', () => {
    assert.strictEqual(lb1.mode, 'coop');
    assert.strictEqual(lb1.bots, 1);
  });

  const g1 = client(); await g1.open();
  g1.send({ t:'join', code, nick:'친구1', charIdx:1 });
  await g1.wait(T('joined'));
  const lb2 = await g1.wait(m => m.t==='lobby' && m.players.length===2);
  check('두 번째 플레이어 입장', () => assert.strictEqual(lb2.players.length, 2));
  check('닉네임의 공백이 보존됨', () => {
    // 제어문자만 제거해야 하고 일반 문자는 그대로여야 합니다
    assert.strictEqual(lb2.players[1].nick, '친구1');
  });

  /* 잘못된 코드 */
  const bad = client(); await bad.open();
  bad.send({ t:'join', code:'ZZZZ', nick:'x' });
  const err = await bad.wait(T('error'));
  check('없는 방 코드는 에러 반환', () => assert.ok(/방이 없/.test(err.msg)));
  bad.ws.close();

  /* 준비 안 됐는데 시작하면 거부 */
  host.q.length = 0;
  host.send({ t:'start' });
  const err2 = await host.wait(T('error'));
  check('미준비 상태에서 시작 거부', () => assert.ok(/준비/.test(err2.msg)));

  /* 채팅 */
  g1.q.length = 0;
  host.send({ t:'chat', msg:'안녕 하세요' });
  const chat = await g1.wait(T('chat'));
  check('채팅 중계 + 공백 유지', () => {
    assert.strictEqual(chat.msg, '안녕 하세요');
    assert.strictEqual(chat.from, '방장');
  });

  /* 준비 후 시작 */
  g1.send({ t:'ready', v:true });
  await host.wait(m => m.t==='lobby' && m.players.some(p=>p.ready));
  host.q.length = 0; g1.q.length = 0;
  host.send({ t:'start' });
  const st = await g1.wait(T('start'));
  check('start 브로드캐스트에 시드/플레이어 포함', () => {
    assert.ok(Number.isFinite(st.seed));
    assert.strictEqual(st.players.length, 2);
    assert.strictEqual(st.hostId, lb1.hostId);
  });

  /* 입력은 방장에게만, 스냅샷은 게스트에게만 */
  host.q.length = 0; g1.q.length = 0;
  g1.send({ t:'input', k:{ l:1, bomb:3 } });
  const inp = await host.wait(T('input'));
  check('게스트 입력이 방장에게 전달', () => {
    assert.strictEqual(inp.k.bomb, 3);
    assert.ok(inp.from > 0);
  });
  check('입력이 게스트 본인에게 되돌아오지 않음',
        () => assert.ok(!g1.q.some(T('input'))));

  host.send({ t:'snap', s:{ k:'play' } });
  const snap = await g1.wait(T('snap'));
  check('방장 스냅샷이 게스트에게 전달', () => assert.strictEqual(snap.s.k, 'play'));

  /* 게스트가 스냅샷을 보내면 무시되어야 함 (권한 없음) */
  host.q.length = 0;
  g1.send({ t:'snap', s:{ k:'해킹' } });
  await new Promise(r => setTimeout(r, 120));
  check('게스트의 스냅샷은 무시됨', () => assert.ok(!host.q.some(T('snap'))));

  /* 진행 중인 방에는 입장 불가 */
  const late = client(); await late.open();
  late.send({ t:'join', code, nick:'늦은사람' });
  const err3 = await late.wait(T('error'));
  check('게임 중인 방 입장 거부', () => assert.ok(/시작된/.test(err3.msg)));
  late.ws.close();

  /* 방장이 나가면 이양 + 판 종료 통보 */
  g1.q.length = 0;
  host.ws.close();
  const hl = await g1.wait(T('hostLeft'));
  check('방장 이탈 시 hostLeft 통보', () => assert.ok(hl));
  const lb3 = await g1.wait(m => m.t==='lobby' && m.players.length===1);
  check('방장 권한이 남은 사람에게 이양',
        () => assert.strictEqual(lb3.hostId, lb3.players[0].id));
  check('방장 이탈 후 playing 해제', () => assert.strictEqual(lb3.playing, false));

  g1.ws.close();
  await new Promise(r => setTimeout(r, 150));
  check('마지막 사람이 나가면 방 삭제', () => assert.strictEqual(srv.rooms.size, 0));

  await new Promise(r => srv.server.close(r));
}

/* ===================================================================== */
/* 2) 클라이언트 게임 코어                                                */
/* ===================================================================== */
function clientTests(){
  section('2) 게임 코어 (헤드리스)');

  /* --- 싱글 플레이 장시간 구동 --- */
  {
    const sb = makeClientSandbox();
    loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick,draw,keys,pressed}=T;
        const CODES=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'];
        const R=n=>Math.floor(Math.random()*n);
        const seen=new Set(); let frames=0;
        function step(n,drive){
          for(let i=0;i<n;i++){
            __t+=16.7;
            if(drive){
              for(const k in keys) keys[k]=false;
              const c=CODES[R(CODES.length)];
              pressed[c]=true; keys[c]=true;
              if(Math.random()<0.25) pressed['Space']=true;
            }
            tick(1/60); draw(); seen.add(T.scene);
            for(const k in pressed) pressed[k]=false;
            frames++;
          }
        }
        step(20,false);
        pressed['Enter']=true; step(5,false);       // 게임시작
        step(160,false);                            // ready -> play
        step(7000,true);
        return JSON.stringify({frames, scenes:[...seen].sort().join(','),
          role:T.role, mode:T.mode, players:T.players.length});
      })()
    `);
    const st = JSON.parse(res);
    check('싱글: 장시간 구동 무오류 (' + st.frames + ' 프레임)', () => assert.ok(st.frames > 7000));
    check('싱글: play 씬 진입', () => assert.ok(st.scenes.includes('play')));
    check('싱글: 역할은 single/coop', () => {
      assert.strictEqual(st.role, 'single');
      assert.strictEqual(st.mode, 'coop');
    });
  }

  /* --- 협동 4인 + 대전 4인 --- */
  for(const mode of ['coop','versus']){
    const sb = makeClientSandbox();
    loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick,draw,keys,pressed,buildSnap}=T;
        G.startNet({ role:'host', mode:'${mode}', myId:1, seed:12345,
          players:[{id:1,nick:'A',charIdx:0},{id:2,nick:'B',charIdx:1},
                   {id:3,nick:'C',charIdx:2},{id:4,nick:'D',charIdx:0}],
          bots:${mode === 'versus' ? 0 : 2} });
        // 사람 4명 중 3명은 원격 입력을 흉내냅니다
        let frames=0, snapBytes=0, maxSnap=0;
        const seen=new Set();
        for(let i=0;i<9000;i++){
          __t+=16.7;
          for(const p of T.players){
            if(p.isAI||p.local) continue;
            const k=p.input;
            if(i%7===0){ k.l=Math.random()<.3?1:0; k.r=Math.random()<.3?1:0;
                         k.u=Math.random()<.3?1:0; k.d=Math.random()<.3?1:0; }
            if(Math.random()<0.02) k.bomb++;
            if(p.trapped && Math.random()<0.4) k.mash++;
          }
          for(const c of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'])
            keys[c]=Math.random()<0.25;
          if(Math.random()<0.02) pressed['Space']=true;
          if((T.scene==='clear'||T.scene==='round') && Math.random()<0.2) pressed['Enter']=true;
          tick(1/60); draw(); seen.add(T.scene);
          if(i%20===0){
            const s=JSON.stringify(buildSnap());
            snapBytes+=s.length; maxSnap=Math.max(maxSnap,s.length);
          }
          for(const k in pressed) pressed[k]=false;
          frames++;
        }
        return JSON.stringify({frames, scenes:[...seen].sort().join(','),
          maxSnap, avgSnap:Math.round(snapBytes/(frames/20)),
          humans:T.players.filter(p=>!p.isAI).length});
      })()
    `);
    const st = JSON.parse(res);
    check(mode + ': 4인 장시간 구동 무오류', () => assert.ok(st.frames >= 9000));
    check(mode + ': 사람 4명 유지', () => assert.strictEqual(st.humans, 4));
    check(mode + ': 스냅샷 크기 합리적 (평균 ' + st.avgSnap + 'B / 최대 ' + st.maxSnap + 'B)',
          () => assert.ok(st.maxSnap < 8000, '스냅샷이 너무 큽니다: ' + st.maxSnap));
  }

  /* --- 대전 승패 판정 (무작위 플레이에 의존하지 않는 결정적 검증) --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick}=T;
        G.startNet({ role:'host', mode:'versus', myId:1, seed:5150,
          players:[{id:1,nick:'가',charIdx:0},{id:2,nick:'나',charIdx:1},
                   {id:3,nick:'다',charIdx:2},{id:4,nick:'라',charIdx:0}], bots:0 });
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }   // ready -> play
        const midScene = T.scene;
        // 4명 중 3명을 탈락시키면 남은 1명이 승자여야 합니다
        for(const p of T.players) if(p.id!==3){ p.alive=false; p.out=true; p.lives=0; }
        for(let i=0;i<10;i++){ __t+=16.7; tick(1/60); }
        const winner = T.players.find(p=>!p.out);
        return JSON.stringify({ midScene, endScene:T.scene, winnerId: winner?winner.id:null });
      })()
    `);
    const r = JSON.parse(res);
    check('versus: ready 이후 play 진입', () => assert.strictEqual(r.midScene, 'play'));
    check('versus: 마지막 1명이 남으면 round 결과 화면',
          () => assert.strictEqual(r.endScene, 'round'));
    check('versus: 생존자가 승자로 판정', () => assert.strictEqual(r.winnerId, 3));
  }

  /* --- 협동 승패 판정 --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick}=T;
        G.startNet({ role:'host', mode:'coop', myId:1, seed:31337,
          players:[{id:1,nick:'가',charIdx:0},{id:2,nick:'나',charIdx:1}], bots:0 });
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        // 봇을 모두 제거하면 스테이지 클리어
        for(const p of T.players) if(p.isAI){ p.alive=false; p.out=true; }
        for(let i=0;i<10;i++){ __t+=16.7; tick(1/60); }
        const clear = T.scene;
        // 이번엔 사람이 전멸하면 게임오버
        G.startNet({ role:'host', mode:'coop', myId:1, seed:31337,
          players:[{id:1,nick:'가',charIdx:0},{id:2,nick:'나',charIdx:1}], bots:0 });
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        for(const p of T.players) if(!p.isAI){ p.alive=false; p.out=true; p.lives=0; }
        for(let i=0;i<10;i++){ __t+=16.7; tick(1/60); }
        return JSON.stringify({ clear, over:T.scene });
      })()
    `);
    const r = JSON.parse(res);
    check('coop: 봇 전멸 시 스테이지 클리어', () => assert.strictEqual(r.clear, 'clear'));
    check('coop: 사람 전멸 시 게임오버', () => assert.strictEqual(r.over, 'gameover'));
  }

  /* --- host -> guest 스냅샷 왕복 --- */
  {
    const hostSb = makeClientSandbox(); loadGame(hostSb);
    const guestSb = makeClientSandbox(); loadGame(guestSb);
    const cfg = `{ mode:'coop', seed:777,
      players:[{id:1,nick:'호스트',charIdx:0},{id:2,nick:'게스트',charIdx:1}], bots:2 }`;
    runInGame(hostSb,  `G.startNet(Object.assign({role:'host', myId:1},  ${cfg}));`);
    runInGame(guestSb, `G.startNet(Object.assign({role:'guest',myId:2},  ${cfg}));`);

    const out = runInGame(hostSb, `
      (function(){
        const T=G._test, {tick,keys,pressed,buildSnap}=T;
        const snaps=[];
        for(let i=0;i<900;i++){
          __t+=16.7;
          for(const p of T.players) if(!p.isAI && !p.local){
            const k=p.input;
            if(i%9===0){ k.l=(i%2)?1:0; k.d=(i%3)?1:0; }
            if(i%50===0) k.bomb++;
          }
          keys['ArrowRight'] = (i%80)<40;
          if(i%60===0) pressed['Space']=true;
          tick(1/60);
          if(i%3===0) snaps.push(buildSnap());
          for(const k in pressed) pressed[k]=false;
        }
        return JSON.stringify({ snaps, boxes:T.boxCount(), scene:T.scene,
          ids:T.players.map(p=>p.id).sort((a,b)=>a-b),
          pos:T.players.map(p=>[p.id, Math.round(p.x), Math.round(p.y)]) });
      })()
    `);
    const host = JSON.parse(out);

    const applied = runInGame(guestSb, `
      (function(){
        const T=G._test, {tick,draw}=T;
        const list = ${JSON.stringify(host.snaps)};
        for(const s of list){ G.applySnap(s); __t+=50; tick(1/60); draw(); }
        return JSON.stringify({
          boxes:T.boxCount(), scene:T.scene, mode:T.mode,
          ids:T.players.map(p=>p.id).sort((a,b)=>a-b),
          pos:T.players.map(p=>[p.id, Math.round(p.x), Math.round(p.y)]),
        });
      })()
    `);
    const g = JSON.parse(applied);
    check('스냅샷 왕복: 맵 상태 일치', () => assert.strictEqual(g.boxes, host.boxes));
    check('스냅샷 왕복: 플레이어 구성이 방장과 정확히 일치',
          () => assert.deepStrictEqual(g.ids, host.ids));
    check('스냅샷 왕복: 씬 동기화', () => assert.strictEqual(g.scene, host.scene));
    check('스냅샷 왕복: 모드 전달', () => assert.strictEqual(g.mode, 'coop'));
    check('스냅샷 왕복: 원격 플레이어 위치가 방장과 거의 일치', () => {
      const hp = new Map(host.pos.map(a=>[a[0],a]));
      for(const [id,x,y] of g.pos){
        if(id === 2) continue;                     // 내 캐릭터는 로컬 예측이 섞임
        const h = hp.get(id);
        assert.ok(h, 'id ' + id + ' 가 방장에 없음');
        const d = Math.hypot(h[1]-x, h[2]-y);
        assert.ok(d < 6, 'id ' + id + ' 위치 오차 ' + d.toFixed(1) + 'px');
      }
    });
  }

  /* --- 물풍선을 놓은 자리에서 빠져나올 수 있는가 (회귀 방지) ---
         중심 기준으로 통과 판정을 하면 몸통이 13px 걸친 구간에서 완전히 갇힙니다. */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick,keys,pressed}=T;
        G.charSel=0; G.startSingle();
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        for(let i=T.players.length-1;i>=0;i--) if(T.players[i].isAI) T.players.splice(i,1);
        const p=T.players[0];
        const move={};
        for(const [dir,key,axis] of [['left','ArrowLeft','x'],['right','ArrowRight','x'],
                                     ['up','ArrowUp','y'],['down','ArrowDown','y']]){
          for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(T.map[y][x]===2) T.map[y][x]=0;
          T.balloons.length=0;
          p.x=7*40+20; p.y=5*40+20; p.alive=true; p.trapped=false;
          const s0=p[axis];
          pressed['Space']=true; tick(1/60);
          for(const k in keys) keys[k]=false;
          keys[key]=true;
          for(let i=0;i<90;i++){ __t+=16.7; tick(1/60); }
          for(const k in keys) keys[k]=false;
          move[dir]=Math.round(Math.abs(p[axis]-s0));
        }
        // 완전히 빠져나온 뒤에는 다시 통과할 수 없어야 합니다
        for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(T.map[y][x]===2) T.map[y][x]=0;
        T.balloons.length=0;
        p.x=1*40+20; p.y=1*40+20;
        pressed['Space']=true; tick(1/60);
        for(const k in keys) keys[k]=false;
        keys['ArrowDown']=true;
        for(let i=0;i<60;i++){ __t+=16.7; tick(1/60); }
        for(const k in keys) keys[k]=false;
        keys['ArrowUp']=true;
        for(let i=0;i<60;i++){ __t+=16.7; tick(1/60); }
        for(const k in keys) keys[k]=false;
        return JSON.stringify({ move, backTileY:Math.floor(p.y/40),
          balloonY: T.balloons[0]?T.balloons[0].gy:null });
      })()
    `);
    const r = JSON.parse(res);
    for(const d of ['left','right','up','down'])
      check('물풍선 설치 후 ' + d + ' 방향으로 탈출 가능 (' + r.move[d] + 'px)',
            () => assert.ok(r.move[d] >= 30,
              '갇혔습니다 — ' + d + ' 이동량 ' + r.move[d] + 'px'));
    check('빠져나온 뒤에는 물풍선이 다시 벽이 됨', () => {
      assert.strictEqual(r.balloonY, 1, '검증 시점에 물풍선이 사라짐');
      assert.ok(r.backTileY > r.balloonY, '물풍선을 통과해 되돌아갔습니다');
    });
  }

  /* --- 시작 능력치 / 실제 폭발 범위 --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick,pressed}=T;
        const out={chars:[], bots:{}};
        for(const ci of [0,1,2]){
          G.charSel=ci; G.startSingle();
          for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
          for(let i=T.players.length-1;i>=0;i--) if(T.players[i].isAI) T.players.splice(i,1);
          const p=T.players[0];
          for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(T.map[y][x]===2) T.map[y][x]=0;
          // 봇이 미리 깔아둔 물풍선/물줄기를 치워야 내 폭발만 측정됩니다
          T.balloons.length=0; T.waters.length=0;
          p.x=7*40+20; p.y=5*40+20;
          pressed['Space']=true; tick(1/60);
          let reach=0;
          for(let i=0;i<260;i++){
            __t+=16.7; tick(1/60);
            for(const w of T.waters) if(w.t>=0)
              reach=Math.max(reach, Math.abs(w.gx-7)+Math.abs(w.gy-5));
          }
          out.chars.push({name:p.skin.name, power:p.power, maxB:p.maxB, reach});
        }
        G.charSel=0; G.startSingle();
        out.bots = { power:T.players.filter(x=>x.isAI).map(b=>b.power) };
        return JSON.stringify(out);
      })()
    `);
    const r = JSON.parse(res);
    check('1스테이지 시작 물줄기는 1 (기본 캐릭터)',
          () => assert.strictEqual(r.chars[0].power, 1));
    check('1스테이지 시작 물풍선은 1 (기본 캐릭터)',
          () => assert.strictEqual(r.chars[0].maxB, 1));
    check('1스테이지 봇 물줄기도 1', () => assert.ok(r.bots.power.every(v=>v===1),
          '봇 물줄기 ' + JSON.stringify(r.bots.power)));
    for(const c of r.chars)
      check(c.name + ': 실제 폭발 범위(' + c.reach + ') = 물줄기 수치(' + c.power + ')',
            () => assert.strictEqual(c.reach, c.power));
    check('어떤 캐릭터도 시작 물줄기가 2를 넘지 않음',
          () => assert.ok(r.chars.every(c => c.power <= 2)));
  }

  /* --- 아이템 시스템 --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const R = code => JSON.parse(runInGame(sb, `(function(){
      const T=G._test, {tick,keys,pressed}=T;
      function arena(){                       // 봇 없는 빈 경기장
        G.charSel=0; G.startSingle();
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        for(let i=T.players.length-1;i>=0;i--) if(T.players[i].isAI) T.players.splice(i,1);
        for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(T.map[y][x]===2) T.map[y][x]=0;
        T.balloons.length=0; T.waters.length=0; T.items.length=0;
        for(const k in keys) keys[k]=false;
        return T.players[0];
      }
      ${code}
    })()`));

    /* 보유 슬롯 2칸 + FIFO */
    const inv = R(`
      const p=arena();
      const seq=[];
      for(const k of ['jump','needle','throw','kick']){
        T.applyItem(p,k); seq.push(p.hold.slice());
      }
      return JSON.stringify({seq, final:p.hold});
    `);
    check('보유 아이템은 최대 2개', () => assert.strictEqual(inv.final.length, 2));
    check('3번째를 먹으면 먼저 먹은 것이 밀려남',
          () => assert.deepStrictEqual(inv.seq[2], ['needle','throw']));
    check('4번째까지 먹으면 최신 2개만 남음',
          () => assert.deepStrictEqual(inv.final, ['throw','kick']));

    /* 누적 스탯은 슬롯을 차지하지 않음 */
    const stat = R(`
      const p=arena();
      const b0=p.maxB, w0=p.power, s0=p.spd;
      T.applyItem(p,'balloon'); T.applyItem(p,'power'); T.applyItem(p,'shoes');
      return JSON.stringify({dB:p.maxB-b0, dW:p.power-w0, dS:p.spd-s0, hold:p.hold.length});
    `);
    check('물방울/물줄기/신발은 누적 스탯 (+1씩)', () => {
      assert.strictEqual(stat.dB, 1); assert.strictEqual(stat.dW, 1);
      assert.ok(stat.dS > 0);
    });
    check('누적 스탯은 보유 슬롯을 쓰지 않음', () => assert.strictEqual(stat.hold, 0));

    /* 즉시 발동 아이템도 슬롯을 쓰지 않음 */
    const inst = R(`
      const p=arena();
      T.applyItem(p,'devil');
      const devil=p.devilT>0;
      T.applyItem(p,'super');
      const cured=p.devilT<=0 && p.superT>0;
      T.applyItem(p,'devil');
      const blocked=p.devilT<=0;         // 슈퍼맨 중에는 악마에 안 걸림
      const p2=arena();
      T.applyItem(p2,'web');   const web=p2.webT>0;
      T.applyItem(p2,'ship');  const ship=p2.shipT>0;
      return JSON.stringify({devil,cured,blocked,web,ship,hold:p.hold.length});
    `);
    check('악마를 먹으면 효과가 걸림', () => assert.ok(inst.devil));
    check('슈퍼맨을 먹으면 악마가 해제됨', () => assert.ok(inst.cured));
    check('슈퍼맨 상태에서는 악마에 걸리지 않음', () => assert.ok(inst.blocked));
    check('거미줄/우주선도 즉시 발동', () => { assert.ok(inst.web); assert.ok(inst.ship); });
    check('즉시 발동 아이템은 보유 슬롯을 쓰지 않음', () => assert.strictEqual(inst.hold, 0));

    /* 악마: 조작 반대 + 자동 발사 */
    const dev = R(`
      const p=arena();
      p.x=7*40+20; p.y=5*40+20;
      T.applyItem(p,'devil');
      const x0=p.x;
      keys['ArrowRight']=true;
      for(let i=0;i<30;i++){ __t+=16.7; tick(1/60); }
      for(const k in keys) keys[k]=false;
      const wentLeft = p.x < x0;
      const before=T.balloons.length;
      for(let i=0;i<70;i++){ __t+=16.7; tick(1/60); }
      return JSON.stringify({wentLeft, autoFired: T.balloons.length>0 || before>0});
    `);
    check('악마: 오른쪽을 눌러도 왼쪽으로 감', () => assert.ok(dev.wentLeft));
    check('악마: 물풍선이 자동으로 나감', () => assert.ok(dev.autoFired));

    /* 거미줄은 느려지고 슈퍼맨은 빨라짐 */
    const spd = R(`
      const p=arena();
      const base=T.moveSpeed(p);
      T.applyItem(p,'web');   const slow=T.moveSpeed(p);
      const p2=arena();
      T.applyItem(p2,'super'); const fast=T.moveSpeed(p2);
      return JSON.stringify({base, slow, fast});
    `);
    check('거미줄을 밟으면 느려짐', () => assert.ok(spd.slow < spd.base));
    check('슈퍼맨은 최고 속도', () => assert.ok(spd.fast > spd.base));

    /* 방패는 물줄기를 한 번 막고 사라짐 */
    const shd = R(`
      const p=arena();
      T.applyItem(p,'shield');
      p.inv=0;
      T.trapPlayer(p);
      const blocked = !p.trapped && p.hold.length===0;
      p.inv=0;
      T.trapPlayer(p);
      return JSON.stringify({blocked, thenTrapped:p.trapped});
    `);
    check('방패: 물줄기를 한 번 막아줌', () => assert.ok(shd.blocked));
    check('방패: 한 번 쓰면 사라짐 (다음엔 갇힘)', () => assert.ok(shd.thenTrapped));

    /* 바늘은 갇혔을 때 혼자 빠져나옴 */
    const ndl = R(`
      const p=arena();
      T.applyItem(p,'needle');
      p.inv=0; T.trapPlayer(p);
      const trapped=p.trapped;
      for(let i=0;i<6;i++){ __t+=16.7; tick(1/60); }
      return JSON.stringify({trapped, escaped:!p.trapped, hold:p.hold.length});
    `);
    check('바늘: 갇혀도 혼자 탈출', () => { assert.ok(ndl.trapped); assert.ok(ndl.escaped); });
    check('바늘: 쓰고 나면 사라짐', () => assert.strictEqual(ndl.hold, 0));

    /* 점프 / 던지기 / 발차기 */
    const abil = R(`
      const p=arena();
      // 점프: 앞으로 건너뜀
      p.x=1*40+20; p.y=1*40+20; p.dir='down';
      T.applyItem(p,'jump');
      const y0=p.y;
      p.input.jump++; T.applyHumanInput(p, 1/60);
      const jumped=Math.round((p.y-y0)/40);

      // 던지기: 밟고 있는 물풍선을 앞으로 날림
      const p2=arena();
      p2.x=7*40+20; p2.y=5*40+20; p2.dir='right';
      T.applyItem(p2,'throw');
      T.placeBalloon(p2);
      p2.input.bomb++; T.applyHumanInput(p2, 1/60);
      const b=T.balloons[0];
      const flying = !!(b && b.fly);
      const dest = b && b.fly ? b.fly.tx - 7 : 0;
      for(let i=0;i<40;i++){ __t+=16.7; tick(1/60); }
      const landed = T.balloons[0] ? T.balloons[0].gx : null;

      // 발차기: 앞의 물풍선을 밀어냄
      const p3=arena();
      p3.x=7*40+20; p3.y=5*40+20;
      T.applyItem(p3,'kick');
      T.balloons.push({gx:8,gy:5,t:3,power:1,owner:null,pass:[]});
      p3.dir='right';
      // 실제 플레이처럼 여러 프레임에 걸쳐 물풍선 쪽으로 걸어갑니다
      let kicked=false;
      for(let i=0;i<12 && !kicked;i++){
        T.moveWithAbility(p3, 1, 0, 1.5);
        kicked = !!(T.balloons[0] && T.balloons[0].slide);
      }
      const kickedGx = T.balloons[0] ? T.balloons[0].gx : null;
      return JSON.stringify({jumped, flying, dest, landed, kicked, kickedGx});
    `);
    check('점프: 앞으로 건너뜀 (' + abil.jumped + '칸)', () => assert.ok(abil.jumped >= 1));
    check('던지기: 물풍선이 날아감', () => assert.ok(abil.flying));
    check('던지기: 바라보는 방향으로 날아감', () => assert.ok(abil.dest > 0));
    check('던지기: 날아간 자리에 착지', () => assert.ok(abil.landed > 7));
    check('발차기: 앞의 물풍선이 굴러감', () => assert.ok(abil.kicked));

    /* 상자를 부수면 아이템이 실제로 남아서 주울 수 있어야 합니다.
       (상자를 부순 그 물줄기가 방금 나온 아이템을 지워버리던 버그 회귀 방지) */
    const drop = R(`
      const p=arena();
      let rounds=0, survived=0, boxes=0;
      for(let n=0;n<120;n++){
        for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(T.map[y][x]===2) T.map[y][x]=0;
        T.balloons.length=0; T.waters.length=0; T.items.length=0;
        T.map[4][7]=2; T.map[6][7]=2;            // 물풍선 위아래에 상자
        p.x=7*40+20; p.y=5*40+20; p.power=1; p.maxB=1; p.alive=true; p.trapped=false;
        T.placeBalloon(p);
        p.x=1*40+20; p.y=1*40+20;                // 멀리 피신 (주워버리지 않게)
        const b0=T.map.flat().filter(t=>t===2).length;
        for(let i=0;i<240;i++){ __t+=16.7; tick(1/60); }
        boxes += b0 - T.map.flat().filter(t=>t===2).length;
        rounds++;
        if(T.items.length>0) survived++;
      }
      return JSON.stringify({rounds, survived, boxes});
    `);
    check('상자를 부수면 아이템이 남음 (' + drop.survived + '/' + drop.rounds + '라운드, 상자 ' + drop.boxes + '개)',
          () => {
            assert.ok(drop.boxes > 100, '상자가 충분히 부서지지 않음');
            assert.ok(drop.survived > 30,
              '아이템이 물줄기에 즉시 지워지고 있습니다 — ' + drop.survived + '/' + drop.rounds);
          });

    /* 나온 아이템을 실제로 주울 수 있는지 */
    const pick = R(`
      const p=arena();
      let got=null;
      for(let n=0;n<60 && !got;n++){
        for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(T.map[y][x]===2) T.map[y][x]=0;
        T.balloons.length=0; T.waters.length=0; T.items.length=0;
        p.hold.length=0; p.maxB=1; p.power=1; p.spd=100;
        T.map[6][7]=2;
        p.x=7*40+20; p.y=5*40+20; p.alive=true; p.trapped=false;
        T.placeBalloon(p);
        p.x=1*40+20; p.y=1*40+20;
        for(let i=0;i<240;i++){ __t+=16.7; tick(1/60); }
        if(!T.items.length) continue;
        const it=T.items[0];
        const before={maxB:p.maxB, power:p.power, spd:p.spd, hold:p.hold.length,
                      devilT:p.devilT, superT:p.superT, webT:p.webT, shipT:p.shipT};
        p.x=it.gx*40+20; p.y=it.gy*40+20;        // 아이템 위로 이동
        for(let i=0;i<4;i++){ __t+=16.7; tick(1/60); }
        const changed = p.maxB!==before.maxB || p.power!==before.power || p.spd!==before.spd ||
                        p.hold.length!==before.hold || p.devilT!==before.devilT ||
                        p.superT!==before.superT || p.webT!==before.webT || p.shipT!==before.shipT;
        got={kind:it.kind, consumed:T.items.length===0, changed};
      }
      return JSON.stringify(got||{});
    `);
    check('나온 아이템을 밟으면 실제로 주워짐',
          () => { assert.ok(pick.consumed, '아이템이 사라지지 않음'); });
    check('주우면 효과가 적용됨 (' + (pick.kind||'?') + ')',
          () => assert.ok(pick.changed, '아무 변화가 없음'));

    /* 물줄기에 닿은 아이템은 사라짐 */
    const wash = R(`
      const p=arena();
      p.x=1*40+20; p.y=1*40+20;
      T.items.push({gx:7,gy:5,kind:'balloon',t:0});
      const before=T.items.length;
      T.addWater(7,5,'center',0);
      for(let i=0;i<8;i++){ __t+=16.7; tick(1/60); }
      return JSON.stringify({before, after:T.items.length});
    `);
    check('아이템이 물줄기에 닿으면 사라짐', () => {
      assert.strictEqual(wash.before, 1);
      assert.strictEqual(wash.after, 0);
    });
  }

  /* --- 물방울 갇힘: 상대편은 죽이고 같은 편은 살림 --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick}=T;
        // 대전: 서로 다른 팀
        G.startNet({role:'host',mode:'versus',myId:1,seed:4242,
          players:[{id:1,nick:'가',charIdx:0},{id:2,nick:'나',charIdx:1}], bots:0});
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        let a=T.players.find(p=>p.id===1), b=T.players.find(p=>p.id===2);
        b.trapped=true; b.trapT=5; b.x=a.x+8; b.y=a.y;
        for(let i=0;i<4;i++){ __t+=16.7; tick(1/60); }
        const enemyKilled = !b.alive && b.out;

        // 협동: 같은 팀
        G.startNet({role:'host',mode:'coop',myId:1,seed:4242,
          players:[{id:1,nick:'가',charIdx:0},{id:2,nick:'나',charIdx:1}], bots:0});
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        a=T.players.find(p=>p.id===1); b=T.players.find(p=>p.id===2);
        b.trapped=true; b.trapT=5; b.x=a.x+8; b.y=a.y;
        for(let i=0;i<4;i++){ __t+=16.7; tick(1/60); }
        const allyFreed = b.alive && !b.trapped;
        return JSON.stringify({enemyKilled, allyFreed});
      })()
    `);
    const r = JSON.parse(res);
    check('상대편 물방울에 부딪히면 터뜨리고 죽임', () => assert.ok(r.enemyKilled));
    check('같은 편 물방울에 부딪히면 살려줌', () => assert.ok(r.allyFreed));
  }

  /* --- 죽으면 스테이지 중 부활 없음 / 다음 스테이지에서 부활 --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {tick,pressed}=T;
        G.startNet({role:'host',mode:'coop',myId:1,seed:900,
          players:[{id:1,nick:'가',charIdx:0},{id:2,nick:'나',charIdx:1}], bots:0});
        for(let i=0;i<130;i++){ __t+=16.7; tick(1/60); }
        const dead=T.players.find(p=>p.id===2);
        T.killPlayer(dead, null);
        const itemsAfterDeath = T.items.length;
        for(let i=0;i<400;i++){ __t+=16.7; tick(1/60); }   // 6초 넘게 대기
        const stillDead = !dead.alive && dead.out;
        // 봇을 모두 제거해 스테이지 클리어 -> 다음 스테이지로
        for(const p of T.players) if(p.isAI){ p.alive=false; p.out=true; }
        for(let i=0;i<10;i++){ __t+=16.7; tick(1/60); }
        const cleared=T.scene;
        pressed['Enter']=true;
        for(let i=0;i<5;i++){ __t+=16.7; tick(1/60); }
        const revived=T.players.find(p=>p.id===2);
        return JSON.stringify({itemsAfterDeath, stillDead, cleared,
                               revivedAlive: !!(revived && revived.alive && !revived.out)});
      })()
    `);
    const r = JSON.parse(res);
    check('죽어도 아이템을 떨어뜨리지 않음', () => assert.strictEqual(r.itemsAfterDeath, 0));
    check('스테이지 도중에는 부활하지 않음', () => assert.ok(r.stillDead));
    check('스테이지를 넘기면 다시 살아남',
          () => { assert.strictEqual(r.cleared,'clear'); assert.ok(r.revivedAlive); });
  }

  /* --- 맵 생성 결정성 (같은 시드 -> 같은 맵) --- */
  {
    const a = makeClientSandbox(); loadGame(a);
    const b = makeClientSandbox(); loadGame(b);
    const m1 = runInGame(a, 'G._test.buildStage(3, 424242); G._test.mapString();');
    const m2 = runInGame(b, 'G._test.buildStage(3, 424242); G._test.mapString();');
    const m3 = runInGame(b, 'G._test.buildStage(3, 999999); G._test.mapString();');
    check('같은 시드 -> 동일한 맵', () => assert.strictEqual(m1, m2));
    check('다른 시드 -> 다른 맵', () => assert.notStrictEqual(m1, m3));
  }

  /* --- 맵 연결성 --- */
  {
    const sb = makeClientSandbox(); loadGame(sb);
    const res = runInGame(sb, `
      (function(){
        const T=G._test, {buildStage,SPAWNS}=T;
        function flood(map){
          const seen=new Set(['1,1']); const q=[[1,1]];
          while(q.length){
            const [x,y]=q.pop();
            for(const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
              if(nx<1||ny<1||nx>13||ny>11) continue;
              if(map[ny][nx]===1) continue;
              const k=nx+','+ny;
              if(!seen.has(k)){ seen.add(k); q.push([nx,ny]); }
            }
          }
          return seen.size;
        }
        let bad=0, sealed=0, n=0;
        for(let s=0;s<8;s++) for(let i=0;i<40;i++){
          buildStage(s, (s*1000+i)*7919);
          const map=T.map;
          let total=0;
          for(let y=1;y<12;y++) for(let x=1;x<14;x++) if(map[y][x]!==1) total++;
          if(flood(map)!==total) bad++;
          for(const [x,y] of SPAWNS){
            if(map[y][x]!==0){ sealed++; continue; }
            const open=[[x+1,y],[x-1,y],[x,y+1],[x,y-1]]
              .filter(([a,b])=>a>0&&b>0&&a<14&&b<12&&map[b][a]===0).length;
            if(open===0) sealed++;
          }
          n++;
        }
        return JSON.stringify({n,bad,sealed});
      })()
    `);
    const r = JSON.parse(res);
    check('맵 ' + r.n + '개 전부 완전 연결', () => assert.strictEqual(r.bad, 0));
    check('막힌 스폰 없음', () => assert.strictEqual(r.sealed, 0));
  }
}

/* ===================================================================== */
/* 3) 통합 — 실제 서버 + 3 클라이언트                                     */
/* ===================================================================== */
async function integrationTest(){
  section('3) 통합 (서버 + 방장 1 + 게스트 2)');

  process.env.PORT = '0';
  delete require.cache[require.resolve(path.join(ROOT,'server','server.js'))];
  const srv = require(path.join(ROOT,'server','server.js'));
  await new Promise(r => srv.server.listen(0, r));
  const port = srv.server.address().port;
  const url = 'ws://127.0.0.1:' + port;

  /* 각 참가자는 실제 game.js 인스턴스를 가지고, 실제 WebSocket 으로 통신합니다. */
  function makePeer(nick, charIdx){
    const sb = makeClientSandbox();
    const G = loadGame(sb);
    const peer = { sb, G, nick, charIdx, ws:new WebSocket(url), id:0, started:false, snapsIn:0 };
    peer.send = o => { if(peer.ws.readyState===1) peer.ws.send(JSON.stringify(o)); };
    /* net.js 대신 최소 연결부만 직접 구현 (브라우저 DOM 없이) */
    sb.NET = { send:peer.send, openLobby(){}, backToLobby(){}, hostLeft(){} };
    peer.ws.on('message', d => {
      const m = JSON.parse(d);
      if(m.t==='joined') peer.id = m.you;
      if(m.t==='lobby')  peer.lobby = m;
      if(m.t==='start'){
        peer.started = true;
        peer.role = (m.hostId === peer.id) ? 'host' : 'guest';
        G.startNet({ role:peer.role, mode:m.mode, myId:peer.id,
                     seed:m.seed, players:m.players, bots:m.bots });
      }
      if(m.t==='input') G.setHostInput(m.from, m.k);
      if(m.t==='snap'){ peer.snapsIn++; G.applySnap(m.s); }
      if(m.t==='over')  G.onOver(m.r);
      if(m.t==='hostLeft'){ peer.hostLeft = true; G.hostLeft(); }
    });
    peer.open = () => new Promise(r => peer.ws.on('open', r));
    peer.state = () => JSON.parse(vm.runInContext(`(function(){
      const T=G._test;
      return JSON.stringify({
        scene:T.scene, mode:T.mode, role:T.role, boxes:T.boxCount(),
        players:T.players.length, humans:T.players.filter(p=>!p.isAI).length,
      });
    })()`, sb));
    peer.scene = () => vm.runInContext('G._test.scene', sb);
    peer.pump = (frames, drive) => vm.runInContext(`
      (function(){
        const T=G._test, {tick,draw,keys,pressed}=T;
        for(let i=0;i<${frames};i++){
          __t+=16.7;
          ${drive ? `
            keys['ArrowRight'] = (i%50)<25;
            keys['ArrowDown']  = (i%70)<20;
            if(i%45===0) pressed['Space']=true;
          ` : ''}
          tick(1/60); draw();
          for(const k in pressed) pressed[k]=false;
        }
      })()
    `, sb);
    return peer;
  }

  const host = makePeer('방장', 0);
  const gA   = makePeer('친구A', 1);
  const gB   = makePeer('친구B', 2);
  await Promise.all([host.open(), gA.open(), gB.open()]);

  host.send({ t:'create', nick:host.nick, charIdx:0, mode:'coop', bots:1 });
  await wait(() => host.id > 0);
  const code = host.lobby.code;

  gA.send({ t:'join', code, nick:gA.nick, charIdx:1 });
  gB.send({ t:'join', code, nick:gB.nick, charIdx:2 });
  await wait(() => host.lobby && host.lobby.players.length === 3);
  check('통합: 3명이 같은 방에 모임',
        () => assert.strictEqual(host.lobby.players.length, 3));

  gA.send({ t:'ready', v:true });
  gB.send({ t:'ready', v:true });
  await wait(() => host.lobby.players.filter(p=>p.ready).length === 2);

  host.send({ t:'start' });
  await wait(() => host.started && gA.started && gB.started);
  check('통합: 세 명 모두 게임 시작', () => {
    assert.strictEqual(host.role, 'host');
    assert.strictEqual(gA.role, 'guest');
    assert.strictEqual(gB.role, 'guest');
  });

  /* 실제로 프레임을 돌립니다. 방장은 시뮬레이션 + 스냅샷 송신,
     게스트는 입력 송신 + 스냅샷 수신. 사이사이 이벤트 루프를 비워줍니다. */
  for(let round=0; round<60; round++){
    host.pump(10, true);
    gA.pump(10, true);
    gB.pump(10, true);
    await new Promise(r => setTimeout(r, 6));
  }

  const hs = host.state(), as = gA.state(), bs = gB.state();

  check('통합: 게스트가 스냅샷을 실제로 수신 (A ' + gA.snapsIn + '개, B ' + gB.snapsIn + '개)',
        () => { assert.ok(gA.snapsIn > 5); assert.ok(gB.snapsIn > 5); });
  check('통합: 맵 상태가 세 클라이언트에서 일치', () => {
    assert.strictEqual(as.boxes, hs.boxes, 'A 불일치');
    assert.strictEqual(bs.boxes, hs.boxes, 'B 불일치');
  });
  check('통합: 플레이어 구성 일치 (사람 3 + 봇 1)', () => {
    assert.strictEqual(hs.humans, 3);
    assert.strictEqual(as.humans, 3);
    assert.strictEqual(bs.players, hs.players);
  });
  check('통합: 게스트 입력이 방장 시뮬레이션에 반영되어 이동 발생', () => {
    const moved = vm.runInContext(
      'JSON.stringify(G._test.players.filter(p=>!p.isAI).map(p=>Math.round(p.x)))', host.sb);
    const xs = JSON.parse(moved);
    assert.ok(new Set(xs).size > 1, '모든 사람이 같은 X 좌표 — 입력이 반영되지 않음');
  });
  check('통합: 상자가 실제로 파괴됨 (물풍선 동작)',
        () => assert.ok(hs.boxes < 90, '상자 수 ' + hs.boxes));

  host.ws.close(); gA.ws.close(); gB.ws.close();
  await new Promise(r => setTimeout(r, 150));

  /* --- 방장 이탈은 별도의 깨끗한 방에서 결정적으로 검증합니다.
         (위 판이 도중에 끝나 playing 이 풀리면 조건이 흐려지므로) --- */
  const h2 = makePeer('방장2', 0);
  const g2 = makePeer('게스트2', 1);
  await Promise.all([h2.open(), g2.open()]);

  h2.send({ t:'create', nick:h2.nick, charIdx:0, mode:'versus', bots:0 });
  await wait(() => h2.id > 0);
  const code2 = h2.lobby.code;
  g2.send({ t:'join', code:code2, nick:g2.nick, charIdx:1 });
  await wait(() => h2.lobby && h2.lobby.players.length === 2);
  g2.send({ t:'ready', v:true });
  await wait(() => h2.lobby.players.some(p => p.ready));
  h2.send({ t:'start' });
  await wait(() => h2.started && g2.started);

  h2.pump(30, true); g2.pump(30, true);
  await new Promise(r => setTimeout(r, 30));
  check('통합: 이탈 검증용 방이 실제 진행 중', () => assert.strictEqual(g2.scene() !== 'lobby', true));

  h2.ws.close();
  await wait(() => g2.hostLeft === true, 3000);
  check('통합: 방장 이탈 시 게스트가 hostLeft 수신', () => assert.strictEqual(g2.hostLeft, true));
  check('통합: 방장 이탈 직후 안내 화면(dc)으로 전환',
        () => assert.strictEqual(g2.scene(), 'dc'));

  /* 안내 화면은 잠시 후 로비로 돌아가야 합니다 */
  g2.pump(140, false);
  check('통합: 안내 후 자동으로 로비 복귀', () => assert.strictEqual(g2.scene(), 'lobby'));

  g2.ws.close();
  await new Promise(r => setTimeout(r, 200));
  await new Promise(r => srv.server.close(r));
}

function wait(pred, ms=5000){
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function loop(){
      let ok = false;
      try { ok = pred(); } catch(_) {}
      if(ok) return res();
      if(Date.now()-t0 > ms) return rej(new Error('조건 대기 시간 초과'));
      setTimeout(loop, 10);
    })();
  });
}

/* ===================================================================== */
(async function main(){
  try {
    await serverTests();
    clientTests();
    await integrationTest();
  } catch(e){
    failures++;
    console.log('\n치명적 오류: ' + (e.stack || e));
  }
  console.log('\n----------------------------------------');
  console.log(failures === 0
    ? `전체 통과 (${checks}개 검사)`
    : `${failures} / ${checks} 실패`);
  process.exit(failures === 0 ? 0 : 1);
})();
