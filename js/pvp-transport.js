// pvp-transport.js - WebRTC 데이터 채널 + HTTP 폴링 시그널링
//
// 구조:
//   시그널링(방 코드로 SDP/ICE 교환)만 서버를 거친다 — server.py의 /signal/*
//   연결이 맺어지면 **게임 데이터는 P2P 직통**이다. 서버는 더 이상 관여하지 않는다.
//
// 왜 폴링인가: 기존 서버가 표준 라이브러리 python http.server라 WebSocket이 없다.
//   방 코드 교환은 몇 초에 한 번이면 충분하고, 실제 대전 데이터는 P2P로 가므로
//   폴링 지연이 게임플레이에 영향을 주지 않는다.

const SIGNAL_BASE = '/signal';
const POLL_INTERVAL_MS = 1000;

// 공개 STUN. NAT 뒤에 있어도 대부분 연결된다.
// (대칭형 NAT 환경에서는 TURN이 필요한데 그건 별도 서버가 있어야 한다)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

async function signal(action, body) {
  const resp = await fetch(`${SIGNAL_BASE}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`시그널링 실패 (${action}): HTTP ${resp.status}`);
  return resp.json();
}

/** 방 코드 생성 — 사람이 불러주기 쉬운 6자리 */
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동되는 O/0/I/1 제외
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * P2P 연결을 맺고 데이터 채널을 돌려준다.
 *
 * @param opts.room      방 코드
 * @param opts.isHost    호스트가 offer를 만든다
 * @param opts.onMessage (obj) => void — 상대 메시지
 * @param opts.onState   (status) => void — 'signaling'|'connecting'|'connected'|'closed'|'failed'
 * @returns { send, close, role, room }
 */
export async function connectPeer({ room, isHost, onMessage, onState = () => {} }) {
  const role = isHost ? 'host' : 'guest';
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  let channel = null;
  let polling = true;

  onState('signaling');
  await signal('join', { room, role });

  const send = (msg) => signal('send', { room, role, msg }).catch(e =>
    console.warn('[PvP] 시그널 전송 실패:', e.message));

  // ICE 후보를 모아 보낸다
  pc.onicecandidate = (e) => {
    if (e.candidate) send({ kind: 'ice', candidate: e.candidate.toJSON() });
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'connected') onState('connected');
    else if (s === 'failed') onState('failed');
    else if (s === 'closed' || s === 'disconnected') onState('closed');
  };

  const wireChannel = (ch) => {
    channel = ch;
    ch.onopen = () => {
      polling = false;   // 연결됐으면 폴링 중단 — 이후는 P2P 직통
      onState('connected');
    };
    ch.onclose = () => onState('closed');
    ch.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); }
      catch (err) { console.warn('[PvP] 메시지 파싱 실패:', err); }
    };
  };

  if (isHost) {
    wireChannel(pc.createDataChannel('duel', { ordered: true }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ kind: 'offer', sdp: pc.localDescription.toJSON() });
  } else {
    pc.ondatachannel = (e) => wireChannel(e.channel);
  }

  // 시그널링 폴링 루프
  (async () => {
    onState('connecting');
    while (polling) {
      try {
        const res = await signal('poll', { room, role });
        for (const msg of (res.messages || [])) {
          if (!msg) continue;
          if (msg.kind === 'offer' && !isHost) {
            await pc.setRemoteDescription(msg.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ kind: 'answer', sdp: pc.localDescription.toJSON() });
          } else if (msg.kind === 'answer' && isHost) {
            await pc.setRemoteDescription(msg.sdp);
          } else if (msg.kind === 'ice') {
            try { await pc.addIceCandidate(msg.candidate); }
            catch (e) { /* 아직 remoteDescription이 없으면 무시된다 */ }
          }
        }
      } catch (e) {
        console.warn('[PvP] 폴링 오류:', e.message);
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  })();

  return {
    role,
    room,
    /** pvp-session이 쓰는 전송 함수 */
    send(obj) {
      if (channel && channel.readyState === 'open') {
        channel.send(JSON.stringify(obj));
        return true;
      }
      console.warn('[PvP] 데이터 채널이 아직 열리지 않았습니다.');
      return false;
    },
    isOpen() {
      return !!(channel && channel.readyState === 'open');
    },
    close() {
      polling = false;
      try { if (channel) channel.close(); } catch (e) {}
      try { pc.close(); } catch (e) {}
      signal('leave', { room, role }).catch(() => {});
      onState('closed');
    }
  };
}

/** 시그널링 서버가 살아 있는지 */
export async function checkSignalingServer() {
  try {
    const r = await fetch(`${SIGNAL_BASE}/rooms`);
    return r.ok;
  } catch (e) {
    return false;
  }
}
