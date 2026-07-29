/* =========================================================================
   크레이지 아케이드 — 방 서버
   서버는 게임 로직을 돌리지 않습니다. 방을 관리하고 메시지를 중계할 뿐입니다.
   시뮬레이션은 방장(host) 브라우저가 담당하고, 서버는
     - 게스트의 입력   -> 방장에게만
     - 방장의 스냅샷   -> 게스트에게만
   전달합니다. 덕분에 무료 티어에서도 CPU를 거의 쓰지 않습니다.
   ========================================================================= */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT   = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const MAX_PLAYERS   = 4;
const MAX_ROOMS     = 300;
const NICK_MAX      = 12;
const CHAT_MAX      = 120;
const ROOM_TTL_MS   = 1000 * 60 * 60 * 3;   // 3시간 동안 조용하면 정리
const HEARTBEAT_MS  = 30000;

/* ------------------------------------------------------------ 정적 파일 */
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.webmanifest':'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = decodeURIComponent(url.pathname);

  if (p === '/healthz') { res.writeHead(200, {'Content-Type':'text/plain'}); return res.end('ok'); }
  if (p === '/') p = '/index.html';

  // 경로 탈출 방지
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p === '/index.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(buf);
  });
});

/* ----------------------------------------------------------------- 방 */
/** @type {Map<string, Room>} */
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 헷갈리는 I,O,0,1 제외
function makeCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return null;
}

let nextId = 1;

// 제어문자만 제거합니다. (공백은 닉네임·채팅에서 정상 문자이므로 유지)
const CTRL = /[\u0000-\u001f\u007f]/g;
function clean(str, max) {
  return String(str == null ? '' : str).replace(CTRL, '').trim().slice(0, max);
}

class Room {
  constructor(code, mode) {
    this.code    = code;
    this.mode    = mode === 'versus' ? 'versus' : 'coop';
    this.bots    = 1;             // 빈 자리를 채울 봇 수
    this.members = [];            // [{id, ws, nick, charIdx, ready}]
    this.hostId  = null;
    this.playing = false;
    this.touched = Date.now();
  }
  get host() { return this.members.find(m => m.id === this.hostId) || null; }

  add(member) {
    this.members.push(member);
    if (this.hostId == null) this.hostId = member.id;
    this.touched = Date.now();
  }
  remove(id) {
    const i = this.members.findIndex(m => m.id === id);
    if (i < 0) return;
    this.members.splice(i, 1);
    this.touched = Date.now();
    if (this.hostId === id) {
      // 방장이 나가면 다음 사람에게 넘기고, 진행 중이던 판은 종료합니다.
      this.hostId = this.members.length ? this.members[0].id : null;
      if (this.playing) {
        this.playing = false;
        for (const x of this.members) x.ready = false;
        this.broadcast({ t: 'hostLeft' });
      }
    }
  }
  send(member, obj) {
    if (member && member.ws.readyState === 1) {
      try { member.ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }
  broadcast(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const m of this.members) {
      if (m.id === exceptId) continue;
      if (m.ws.readyState === 1) { try { m.ws.send(s); } catch (_) {} }
    }
  }
  lobbyState() {
    return {
      t: 'lobby',
      code: this.code,
      mode: this.mode,
      bots: this.bots,
      hostId: this.hostId,
      playing: this.playing,
      players: this.members.map(m => ({
        id: m.id, nick: m.nick, charIdx: m.charIdx, ready: m.ready,
        host: m.id === this.hostId,
      })),
    };
  }
  pushLobby() { this.broadcast(this.lobbyState()); }
}

/* --------------------------------------------------------- WebSocket */
const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const self = { id: nextId++, ws, nick: '', charIdx: 0, ready: false, room: null };
  ws.meta = self;

  const fail = (msg) => { try { ws.send(JSON.stringify({ t: 'error', msg })); } catch (_) {} };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;

    const room = self.room;
    if (room) room.touched = Date.now();

    switch (m.t) {

      /* ---- 방 만들기 ---- */
      case 'create': {
        if (room) return fail('이미 방에 있습니다.');
        if (rooms.size >= MAX_ROOMS) return fail('서버가 혼잡합니다. 잠시 후 다시 시도해주세요.');
        const code = makeCode();
        if (!code) return fail('방 코드를 만들지 못했습니다.');

        self.nick    = clean(m.nick, NICK_MAX) || ('플레이어' + self.id);
        self.charIdx = Math.min(2, Math.max(0, m.charIdx | 0));
        self.ready   = false;

        const r = new Room(code, m.mode);
        r.bots = Math.min(3, Math.max(0, m.bots == null ? 1 : m.bots | 0));
        rooms.set(code, r);
        r.add(self);
        self.room = r;

        r.send(self, { t: 'joined', you: self.id, code });
        r.pushLobby();
        break;
      }

      /* ---- 방 들어가기 ---- */
      case 'join': {
        if (room) return fail('이미 방에 있습니다.');
        const code = clean(m.code, 8).toUpperCase();
        const r = rooms.get(code);
        if (!r)                             return fail('그런 방이 없습니다. 코드를 확인해주세요.');
        if (r.members.length >= MAX_PLAYERS) return fail('방이 가득 찼습니다. (최대 ' + MAX_PLAYERS + '명)');
        if (r.playing)                      return fail('이미 게임이 시작된 방입니다.');

        self.nick    = clean(m.nick, NICK_MAX) || ('플레이어' + self.id);
        self.charIdx = Math.min(2, Math.max(0, m.charIdx | 0));
        self.ready   = false;

        r.add(self);
        self.room = r;

        r.send(self, { t: 'joined', you: self.id, code });
        r.broadcast({ t: 'sys', msg: self.nick + ' 님이 들어왔습니다.' });
        r.pushLobby();
        break;
      }

      /* ---- 로비 설정 ---- */
      case 'char': {
        if (!room) return;
        self.charIdx = Math.min(2, Math.max(0, m.idx | 0));
        room.pushLobby();
        break;
      }
      case 'ready': {
        if (!room) return;
        self.ready = !!m.v;
        room.pushLobby();
        break;
      }
      case 'setup': {                       // 방장만: 모드 / 봇 수 변경
        if (!room || room.hostId !== self.id) return;
        if (m.mode) room.mode = m.mode === 'versus' ? 'versus' : 'coop';
        if (m.bots != null) room.bots = Math.min(3, Math.max(0, m.bots | 0));
        room.pushLobby();
        break;
      }
      case 'chat': {
        if (!room) return;
        const msg = clean(m.msg, CHAT_MAX);
        if (!msg) return;
        room.broadcast({ t: 'chat', from: self.nick, msg });
        break;
      }

      /* ---- 게임 시작 (방장) ---- */
      case 'start': {
        if (!room || room.hostId !== self.id) return;
        const others = room.members.filter(x => x.id !== self.id);
        if (others.length && !others.every(x => x.ready))
          return fail('아직 준비하지 않은 사람이 있습니다.');
        room.playing = true;
        room.broadcast({
          t: 'start',
          seed: (Math.random() * 0x7fffffff) | 0,
          mode: room.mode,
          bots: room.bots,
          hostId: room.hostId,
          players: room.members.map(x => ({ id: x.id, nick: x.nick, charIdx: x.charIdx })),
        });
        break;
      }

      /* ---- 인게임 중계 ---- */
      case 'input': {                       // 게스트 -> 방장
        if (!room || !room.playing) return;
        const h = room.host;
        if (!h || h.id === self.id) return;
        room.send(h, { t: 'input', from: self.id, k: m.k });
        break;
      }
      case 'snap': {                        // 방장 -> 게스트 전원
        if (!room || room.hostId !== self.id) return;
        room.broadcast({ t: 'snap', s: m.s }, self.id);
        break;
      }
      case 'over': {                        // 방장이 판 종료를 알림
        if (!room || room.hostId !== self.id) return;
        room.playing = false;
        for (const x of room.members) x.ready = false;
        room.broadcast({ t: 'over', r: m.r }, self.id);
        room.pushLobby();
        break;
      }

      /* ---- 방 나가기 ---- */
      case 'leave': {
        if (!room) return;
        leaveRoom(self);
        break;
      }
    }
  });

  ws.on('close', () => leaveRoom(self));
  ws.on('error', () => leaveRoom(self));
});

function leaveRoom(self) {
  const r = self.room;
  if (!r) return;
  self.room = null;
  const nick = self.nick;
  r.remove(self.id);
  if (r.members.length === 0) {
    rooms.delete(r.code);
  } else {
    r.broadcast({ t: 'sys', msg: nick + ' 님이 나갔습니다.' });
    r.broadcast({ t: 'left', id: self.id });
    r.pushLobby();
  }
}

/* 죽은 소켓 정리 + 오래된 빈 방 청소 */
const sweeper = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
  const now = Date.now();
  for (const [code, r] of rooms)
    if (r.members.length === 0 || now - r.touched > ROOM_TTL_MS) rooms.delete(code);
}, HEARTBEAT_MS);
if (sweeper.unref) sweeper.unref();

if (require.main === module) {
  server.listen(PORT, () => console.log('크레이지 아케이드 서버 실행 중 :' + PORT));
}

module.exports = { server, wss, rooms, PORT };
