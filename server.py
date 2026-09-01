#!/usr/bin/env python3
"""
Novel Duelist 로컬 서버.

기존 `python -m http.server`를 대체한다. 하는 일:
  1) 정적 파일 서빙 (index.html, js/, styles.css)
  2) P2P 대전용 시그널링 중계 (/signal/*)

⚠️ 외부 의존성이 없다. 표준 라이브러리만 쓴다.
   WebSocket 대신 **HTTP 폴링**으로 시그널링을 처리한다 —
   방 코드 교환은 몇 초에 한 번이면 충분하고, 실제 게임 데이터는
   연결 후 WebRTC 데이터 채널로 P2P 직통하므로 서버를 거치지 않는다.

실행:  python server.py [포트]
"""

import json
import os
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173

# ── 시그널링 방 저장소 ────────────────────────────────────────
# rooms[code] = {
#   'created': ts,
#   'peers': { 'host': {...}, 'guest': {...} },   # SDP/ICE 보관함
#   'mailbox': { 'host': [msg, ...], 'guest': [...] }
# }
_rooms = {}
_lock = threading.Lock()

ROOM_TTL = 600          # 10분간 활동 없으면 방 폐기
MAX_ROOMS = 100
MAX_MAILBOX = 200


def _prune_rooms():
    """오래된 방 정리. 서버가 무한히 자라지 않게 한다."""
    now = time.time()
    dead = [c for c, r in _rooms.items() if now - r['touched'] > ROOM_TTL]
    for c in dead:
        del _rooms[c]
    # 그래도 너무 많으면 오래된 것부터 버린다
    if len(_rooms) > MAX_ROOMS:
        for c, _ in sorted(_rooms.items(), key=lambda kv: kv[1]['touched'])[:len(_rooms) - MAX_ROOMS]:
            del _rooms[c]


def _room(code, create=False):
    r = _rooms.get(code)
    if r is None and create:
        r = _rooms[code] = {
            'touched': time.time(),
            'mailbox': {'host': [], 'guest': []},
        }
    if r is not None:
        r['touched'] = time.time()
    return r


class Handler(SimpleHTTPRequestHandler):
    # 기본 로그가 너무 시끄러워서 시그널링만 남긴다
    def log_message(self, fmt, *args):
        if '/signal/' in (self.path or ''):
            sys.stderr.write("[signal] %s\n" % (fmt % args))

    # ── 공통 응답 헬퍼 ──
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n <= 0:
                return {}
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}

    def end_headers(self):
        # 개발 중에는 캐시가 수정 반영을 방해한다
        if not self.path.startswith('/signal/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    # ── 시그널링 ──
    def do_POST(self):
        if not self.path.startswith('/signal/'):
            self.send_error(404)
            return

        action = self.path[len('/signal/'):].split('?')[0]
        data = self._read_json()
        code = str(data.get('room') or '').strip().upper()
        role = data.get('role')

        if not code or role not in ('host', 'guest'):
            self._json({'ok': False, 'error': 'room / role 이 필요합니다'}, 400)
            return

        with _lock:
            _prune_rooms()

            if action == 'join':
                r = _room(code, create=True)
                other = 'guest' if role == 'host' else 'host'
                self._json({
                    'ok': True,
                    'room': code,
                    'role': role,
                    'peerPresent': len(r['mailbox'][other]) > 0 or r.get(other + '_seen', False),
                })
                r[role + '_seen'] = True
                return

            if action == 'send':
                r = _room(code, create=True)
                target = 'guest' if role == 'host' else 'host'
                box = r['mailbox'][target]
                if len(box) >= MAX_MAILBOX:
                    self._json({'ok': False, 'error': '메일박스가 가득 찼습니다'}, 429)
                    return
                box.append(data.get('msg'))
                self._json({'ok': True, 'queued': len(box)})
                return

            if action == 'poll':
                r = _room(code)
                if r is None:
                    self._json({'ok': True, 'messages': [], 'roomExists': False})
                    return
                box = r['mailbox'][role]
                msgs, box[:] = list(box), []
                other = 'guest' if role == 'host' else 'host'
                self._json({
                    'ok': True,
                    'messages': msgs,
                    'roomExists': True,
                    'peerPresent': r.get(other + '_seen', False),
                })
                return

            if action == 'leave':
                if code in _rooms:
                    del _rooms[code]
                self._json({'ok': True})
                return

        self._json({'ok': False, 'error': 'unknown action'}, 404)

    def do_GET(self):
        if self.path.startswith('/signal/rooms'):
            with _lock:
                _prune_rooms()
                self._json({'ok': True, 'rooms': list(_rooms.keys())})
            return
        super().do_GET()


def main():
    # 실행 위치와 무관하게 이 파일이 있는 폴더를 서빙한다.
    # (Start-Process 등으로 띄우면 CWD가 달라져 404가 난다)
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('=' * 56)
    print('  Novel Duelist 서버')
    print('  게임      : http://localhost:%d/index.html' % PORT)
    print('  시그널링  : POST /signal/{join,send,poll,leave}')
    print('  (Ctrl+C 로 종료)')
    print('=' * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n서버를 종료합니다.')
        server.shutdown()


if __name__ == '__main__':
    main()
