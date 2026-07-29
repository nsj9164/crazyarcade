/* =========================================================================
   크레이지 아케이드 — 네트워크 + 로비 UI
   방 만들기 / 코드로 입장 / 채팅 / 준비 / 시작 을 담당합니다.
   URL 에 ?room=XXXX 가 있으면 자동으로 입장창을 채워줍니다. (끄투식 초대)
   ========================================================================= */
'use strict';

window.NET = (function () {

const $ = id => document.getElementById(id);

let ws = null, myId = 0, room = null, connected = false;
let pendingAction = null;             // 연결 직후 실행할 동작
let inMatch = false;

/* ------------------------------------------------------------ 접속 */
/* 정적 호스팅(GitHub Pages 등)에서는 config.js 의 CA_SERVER 로 접속합니다. */
function isStaticHost(){
  return /github\.io$/i.test(location.hostname) || location.protocol === 'file:';
}
function wsURL(){
  const cfg = (window.CA_SERVER || '').trim();
  if(cfg) return cfg.replace(/^http/i, 'ws').replace(/\/+$/, '');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host;
}
function serverConfigured(){
  return !!(window.CA_SERVER || '').trim() || !isStaticHost();
}
function connect(then){
  if(!serverConfigured()){
    setStatus('이 주소에는 게임 서버가 연결되어 있지 않습니다. 온라인 플레이는 Render 주소로 접속해주세요.');
    return;
  }
  if(ws && ws.readyState === 1){ then && then(); return; }
  if(ws && ws.readyState === 0){        // 이미 연결 중이면 새 소켓을 만들지 않고 예약만
    if(then) pendingAction = then;
    return;
  }
  pendingAction = then;
  setStatus('서버에 연결하는 중... (무료 서버는 첫 접속에 최대 1분이 걸릴 수 있어요)');
  try { ws = new WebSocket(wsURL()); }
  catch(e){ setStatus('연결에 실패했습니다.'); return; }

  ws.onopen = () => {
    connected = true;
    setStatus('');
    if(pendingAction){ const f = pendingAction; pendingAction = null; f(); }
  };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch(_) { return; }
    handle(m);
  };
  ws.onclose = () => {
    connected = false; ws = null;
    if(inMatch){ inMatch = false; G.hostLeft(); }
    room = null;
    showPanel('home');
    setStatus('서버와 연결이 끊어졌습니다. 다시 시도해주세요.');
  };
  ws.onerror = () => setStatus('서버에 연결할 수 없습니다.');
}
function send(obj){
  if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

/* ------------------------------------------------------------ 메시지 */
function handle(m){
  switch(m.t){
    case 'joined':
      myId = m.you;
      setStatus('');
      break;

    case 'lobby':
      room = m;
      renderLobby();
      showPanel('room');
      break;

    case 'chat':
      addChat(m.from, m.msg, 'user');
      break;
    case 'sys':
      addChat('', m.msg, 'sys');
      break;

    case 'start': {
      inMatch = true;
      hideOverlay();
      G.startNet({
        role: (m.hostId === myId) ? 'host' : 'guest',
        mode: m.mode, myId, seed: m.seed,
        players: m.players, bots: m.bots,
      });
      break;
    }

    case 'input':                       // host 만 받습니다
      G.setHostInput(m.from, m.k);
      break;

    case 'snap':                        // guest 만 받습니다
      G.applySnap(m.s);
      break;

    case 'over':
      G.onOver(m.r);
      break;

    case 'hostLeft':
      inMatch = false;
      G.hostLeft();
      break;

    case 'left':
      break;

    case 'error':
      setStatus(m.msg);
      break;
  }
}

/* ------------------------------------------------------------- 로비 UI */
function showOverlay(){ $('lobby').classList.add('on'); }
function hideOverlay(){ $('lobby').classList.remove('on'); }
function showPanel(which){
  $('panel-home').style.display = which==='home' ? '' : 'none';
  $('panel-room').style.display = which==='room' ? '' : 'none';
}
function setStatus(t){ $('lb-status').textContent = t || ''; }

function nickValue(){
  const v = $('lb-nick').value.trim();
  if(v) localStorage.setItem('ca_nick', v);
  return v;
}

function openLobby(charIdx){
  showOverlay();
  showPanel('home');
  setStatus('');
  $('lb-nick').value = localStorage.getItem('ca_nick') || '';
  $('lb-char').value = String(charIdx || 0);
  const q = new URLSearchParams(location.search).get('room');
  if(q) $('lb-code').value = q.toUpperCase();
  connect(null);
}

function renderLobby(){
  if(!room) return;
  const iAmHost = room.hostId === myId;

  $('rm-code').textContent = room.code;
  $('rm-mode').value = room.mode;
  $('rm-bots').value = String(room.bots);
  $('rm-mode').disabled = !iAmHost;
  $('rm-bots').disabled = !iAmHost;

  const link = location.origin + location.pathname + '?room=' + room.code;
  $('rm-link').value = link;

  /* 플레이어 목록 */
  const list = $('rm-players');
  list.innerHTML = '';
  for(const p of room.players){
    const li = document.createElement('div');
    li.className = 'pl' + (p.id === myId ? ' me' : '');
    const chars = ['배찌','다오','마리드'];
    li.innerHTML =
      '<span class="dot c' + p.charIdx + '"></span>' +
      '<span class="nm"></span>' +
      '<span class="ch"></span>' +
      '<span class="st ' + (p.host ? 'host' : (p.ready ? 'rdy' : 'wait')) + '"></span>';
    li.querySelector('.nm').textContent = p.nick;
    li.querySelector('.ch').textContent = chars[p.charIdx] || '';
    li.querySelector('.st').textContent = p.host ? '방장' : (p.ready ? '준비완료' : '대기중');
    list.appendChild(li);
  }
  for(let i=room.players.length;i<4;i++){
    const li=document.createElement('div');
    li.className='pl empty';
    li.textContent='빈 자리';
    list.appendChild(li);
  }

  const meP = room.players.find(p => p.id === myId);
  $('rm-char').value = String(meP ? meP.charIdx : 0);

  /* 버튼 */
  const startBtn = $('rm-start'), readyBtn = $('rm-ready');
  if(iAmHost){
    startBtn.style.display = '';
    readyBtn.style.display = 'none';
    const others = room.players.filter(p => p.id !== myId);
    const allReady = others.every(p => p.ready);
    startBtn.disabled = !allReady;
    startBtn.textContent = others.length === 0
      ? '혼자 시작하기'
      : (allReady ? '게임 시작!' : '다른 사람 준비 대기중...');
  } else {
    startBtn.style.display = 'none';
    readyBtn.style.display = '';
    readyBtn.textContent = (meP && meP.ready) ? '준비 취소' : '준비 완료';
    readyBtn.classList.toggle('on', !!(meP && meP.ready));
  }

  $('rm-hint').textContent = room.mode === 'versus'
    ? '대전 — 물풍선으로 서로를 가두고 마지막까지 살아남으세요!'
    : '협동 — 힘을 합쳐 스테이지의 적을 모두 물리치세요!';
}

function addChat(from, msg, kind){
  const box = $('rm-chat');
  const d = document.createElement('div');
  d.className = 'msg ' + kind;
  if(kind === 'sys'){ d.textContent = msg; }
  else {
    const b = document.createElement('b'); b.textContent = from + ' ';
    const s = document.createElement('span'); s.textContent = msg;
    d.appendChild(b); d.appendChild(s);
  }
  box.appendChild(d);
  while(box.childNodes.length > 120) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

/* ------------------------------------------------------------ 바인딩 */
function bind(){
  $('lb-create').onclick = () => {
    const nick = nickValue();
    if(!nick) return setStatus('닉네임을 입력해주세요.');
    connect(() => send({ t:'create', nick, charIdx:+$('lb-char').value,
                         mode:$('lb-mode').value, bots:+$('lb-bots').value }));
  };
  $('lb-join').onclick = () => {
    const nick = nickValue();
    if(!nick) return setStatus('닉네임을 입력해주세요.');
    const code = $('lb-code').value.trim().toUpperCase();
    if(code.length < 4) return setStatus('4자리 방 코드를 입력해주세요.');
    connect(() => send({ t:'join', code, nick, charIdx:+$('lb-char').value }));
  };
  $('lb-close').onclick = () => { hideOverlay(); G.toTitle(); };
  $('lb-code').addEventListener('keydown', e => { if(e.key==='Enter') $('lb-join').click(); });
  $('lb-nick').addEventListener('keydown', e => { if(e.key==='Enter') $('lb-create').click(); });

  $('rm-ready').onclick = () => {
    const meP = room && room.players.find(p => p.id === myId);
    send({ t:'ready', v: !(meP && meP.ready) });
  };
  $('rm-start').onclick = () => send({ t:'start' });
  $('rm-leave').onclick = () => {
    send({ t:'leave' });
    room = null; showPanel('home'); setStatus('');
    $('rm-chat').innerHTML = '';
  };
  $('rm-char').onchange = e => send({ t:'char', idx:+e.target.value });
  $('rm-mode').onchange = e => send({ t:'setup', mode:e.target.value });
  $('rm-bots').onchange = e => send({ t:'setup', bots:+e.target.value });

  $('rm-copy').onclick = async () => {
    const link = $('rm-link').value;
    try { await navigator.clipboard.writeText(link); $('rm-copy').textContent = '복사됨!'; }
    catch(_) { $('rm-link').select(); document.execCommand('copy'); $('rm-copy').textContent = '복사됨!'; }
    setTimeout(() => { $('rm-copy').textContent = '초대링크 복사'; }, 1500);
  };

  const chatSend = () => {
    const i = $('rm-say');
    const v = i.value.trim();
    if(!v) return;
    send({ t:'chat', msg:v });
    i.value = '';
  };
  $('rm-send').onclick = chatSend;
  $('rm-say').addEventListener('keydown', e => { if(e.key==='Enter') chatSend(); });
}

/* ---------------------------------------------------- 게임 -> 로비 복귀 */
function backToLobby(){
  inMatch = false;
  send({ t:'ready', v:false });
  showOverlay();
  showPanel('room');
}

return {
  bind, openLobby, send, backToLobby,
  get id(){ return myId; },
};
})();
