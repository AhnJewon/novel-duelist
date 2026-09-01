// pvp-ui.js - PvP 방 만들기 / 참가 UI
//
// 흐름:
//   1) 방 만들기 → 방 코드 생성 → 상대에게 코드 전달 → 상대가 참가
//   2) WebRTC 연결 (시그널링은 server.py의 /signal/* 이 중계)
//   3) 덱 교환 + 시드 합의 (pvp-session.js)
//   4) 전투 시작 — 상대는 내 화면에서 "보스" 자리에 앉는다 (pvp-battle.js)
//
// ⚠️ 연결이 끊기면 대전을 이어갈 방법이 없다. 락스텝이라 중간 합류가 불가능하다.
//    끊기면 방을 새로 파는 것이 정상 동작이다.

import { state } from './storage.js';
import { escapeHtml } from './dom-utils.js';
import { connectPeer, generateRoomCode, checkSignalingServer } from './pvp-transport.js';
import { createPvpSession } from './pvp-session.js';
import { attachPvpSession, detachPvpSession, handleRemoteAction, isPvpActive } from './pvp-battle.js';
import { initBattle, renderBattleUI, addBattleLog, getActiveDeckCards } from './battle-engine.js';
import { moveArenaTo, applyArenaMode } from './battle-arena.js';
import { getProfile } from './player-profile.js';
import { MAX_DECK_SIZE } from './storage.js';

let _peer = null;       // connectPeer 결과
let _session = null;    // createPvpSession 결과
let _status = 'idle';   // idle|signaling|connecting|connected|playing|closed|failed
let _room = '';
let _isHost = false;
let _foeProfile = null;      // 상대 듀얼리스트 프로필 (이름·속성)
let _foeAvatar = '';         // 상대 초상 (없으면 이모지)
let _borrowedThemeIds = [];   // 대전 중에만 얹어둔 상대 카드군 (끝나면 제거)

const MIN_DECK_FOR_PVP = 4;

function el(id) { return document.getElementById(id); }

function setStatus(s, detail = '') {
  _status = s;
  const box = el('pvp-status');
  if (!box) return;
  const map = {
    idle:       ['대기 중',        'text-slate-400',   ''],
    signaling:  ['방 등록 중...',   'text-amber-300',   'animate-pulse'],
    connecting: ['상대 연결 중...', 'text-amber-300',   'animate-pulse'],
    connected:  ['연결됨 — 덱 교환 중...', 'text-cyan-300', 'animate-pulse'],
    playing:    ['대전 진행 중',    'text-emerald-300', ''],
    closed:     ['연결 종료',       'text-slate-400',   ''],
    failed:     ['연결 실패',       'text-red-400',     '']
  };
  const [label, color, anim] = map[s] || map.idle;
  box.className = `text-xs font-bold ${color} ${anim}`;
  box.textContent = detail ? `${label} — ${detail}` : label;
  renderPvpPanel();
}

/** 덱이 대전 가능한 상태인지 */
function deckReady() {
  const n = (state.activeDeckCardIds || []).length;
  return n >= MIN_DECK_FOR_PVP;
}

export function renderPvpPanel() {
  const panel = el('pvp-panel-body');
  if (!panel) return;

  const busy = _status === 'signaling' || _status === 'connecting' || _status === 'connected';
  const live = _status === 'playing';
  const deckN = (state.activeDeckCardIds || []).length;

  // 대전 중에는 준비 영역(매칭 + 프로필 편집)을 접고 전장을 위로 올린다
  const setup = el('versus-setup');
  const liveBar = el('versus-live-bar');
  if (setup) setup.classList.toggle('hidden', live);
  if (liveBar) {
    liveBar.classList.toggle('hidden', !live);
    if (live) {
      const me = getProfile();
      const foe = _foeProfile || {};
      liveBar.innerHTML = `
        <div class="rounded-2xl bg-[#121526]/90 border border-emerald-500/40 p-3 sm:p-4 flex flex-wrap items-center gap-3">
          <span class="flex items-center gap-1.5 text-sm font-black text-slate-100">
            <span class="text-lg">${escapeHtml(me.avatarEmoji || '🧙')}</span>${escapeHtml(me.name)}
          </span>
          <span class="text-amber-400 font-black text-xs">VS</span>
          <span class="flex items-center gap-1.5 text-sm font-black text-slate-100">
            <span class="text-lg">${escapeHtml(foe.avatarEmoji || '👤')}</span>${escapeHtml(foe.name || '상대 듀얼리스트')}
          </span>
          <span class="px-2 py-0.5 rounded-lg bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-[11px] font-bold">
            방 ${escapeHtml(_room)} · ${_isHost ? '내가 선공' : '상대가 선공'}
          </span>
          <button onclick="pvpLeave()" class="ml-auto px-3 py-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-500/60 text-red-300 text-xs font-bold transition">
            🏳️ 대전 종료
          </button>
        </div>`;
    }
  }

  if (live) {
    panel.innerHTML = '';
    return;
  }

  panel.innerHTML = `
    <div class="space-y-3">
      ${!deckReady() ? `
        <div class="px-3 py-2 rounded-lg bg-amber-950/60 border border-amber-500/50 text-amber-200 text-xs">
          ⚠️ 출전 덱이 ${deckN}장입니다. 대전하려면 <b>${MIN_DECK_FOR_PVP}장 이상</b> 편성하세요.
          (마도서 / 덱 탭)
        </div>` : ''}

      <div class="flex flex-wrap items-center gap-2">
        <button onclick="pvpHost()" ${busy || !deckReady() ? 'disabled' : ''}
          class="px-3.5 py-2 rounded-lg text-xs font-black transition ${busy || !deckReady()
            ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'
            : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-md'}">
          🎮 방 만들기
        </button>

        <span class="text-slate-600 text-xs">또는</span>

        <input id="pvp-room-input" maxlength="6" placeholder="방 코드"
          ${busy ? 'disabled' : ''}
          class="w-28 bg-[#191d33] border border-brand-border rounded-lg px-3 py-2 text-white text-xs font-mono tracking-widest uppercase outline-none focus:border-cyan-500"
          oninput="this.value=this.value.toUpperCase()">

        <button onclick="pvpJoin()" ${busy || !deckReady() ? 'disabled' : ''}
          class="px-3.5 py-2 rounded-lg text-xs font-black transition ${busy || !deckReady()
            ? 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'
            : 'bg-[#252b47] hover:bg-[#2f3654] text-cyan-200 border border-cyan-600/50'}">
          참가
        </button>

        ${busy ? `<button onclick="pvpLeave()" class="px-3 py-2 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-500/60 text-red-300 text-xs font-bold">취소</button>` : ''}
      </div>

      ${_room && busy ? `
        <div class="px-3 py-2.5 rounded-lg bg-cyan-950/50 border border-cyan-500/50">
          <div class="text-[10px] text-cyan-400 font-bold mb-1">상대에게 이 코드를 알려주세요</div>
          <div class="flex items-center gap-2">
            <span class="text-2xl font-black tracking-[0.3em] text-cyan-200 font-mono">${escapeHtml(_room)}</span>
            <button onclick="pvpCopyRoom()" class="px-2 py-1 rounded bg-cyan-900/70 hover:bg-cyan-800 text-cyan-200 text-[10px] font-bold border border-cyan-600/50">복사</button>
          </div>
        </div>` : ''}
    </div>`;
}

/** 공통 연결 절차 */
async function startConnection(room, isHost) {
  if (!deckReady()) {
    alert(`출전 덱을 ${MIN_DECK_FOR_PVP}장 이상 편성해야 대전할 수 있습니다.`);
    return;
  }
  if (!(await checkSignalingServer())) {
    alert('시그널링 서버에 연결할 수 없습니다.\nrun_game.ps1 로 서버를 켰는지 확인하세요.\n(python -m http.server 로는 동작하지 않습니다)');
    setStatus('failed', '서버 없음');
    return;
  }

  _room = room;
  _isHost = isHost;
  setStatus('signaling');

  // 세션: 덱 교환 + 시드 합의를 담당한다
  _session = createPvpSession({
    send: (m) => _peer && _peer.send(m),
    isHost,
    onStart: ({ seed, foeDeck }) => {
      // 양쪽이 같은 시드를 쓴다 → 같은 행동이면 같은 결과 (락스텝)
      attachPvpSession(_session, { foeName: '상대 듀얼리스트', isHost });
      beginPvpBattle(seed, foeDeck);
    },
    onFoeAction: (action) => handleRemoteAction(action),
    onFoeProfile: (profile) => {
      _foeProfile = profile;
      if (state.currentBoss && state.currentBoss.isDuelist) {
        state.currentBoss.name = profile.name || state.currentBoss.name;
        state.currentBoss.titleEn = profile.title || '';
        state.currentBoss.avatarEmoji = profile.avatarEmoji || '👤';
        renderBattleUI();
      }
      renderPvpPanel();
    },
    onFoeAvatar: (dataUrl) => {
      _foeAvatar = dataUrl;
      if (state.currentBoss && state.currentBoss.isDuelist) {
        state.currentBoss.imageUrl = dataUrl;
        renderBattleUI();
      }
    }
  });

  try {
    _peer = await connectPeer({
      room,
      isHost,
      onMessage: (msg) => _session && _session.receive(msg),
      onState: (s) => {
        if (s === 'connected') {
          setStatus('connected');
          // 연결되면 곧바로 덱을 교환한다
          _session.begin();
        } else if (s === 'failed' || s === 'closed') {
          if (_status !== 'playing') setStatus(s === 'failed' ? 'failed' : 'closed');
        } else {
          setStatus('connecting');
        }
      }
    });
  } catch (e) {
    console.error('[PvP] 연결 실패:', e);
    setStatus('failed', e.message);
  }
}

/** 덱 교환이 끝나면 전투를 연다 */
function beginPvpBattle(seed, foeDeck) {
  // 🐛 importDeckPayload는 배열이 아니라 { cards, themes, rejected }를 준다.
  //    배열로 착각해 .map을 부르다 대전이 시작되지 않았다.
  const foeCards = (foeDeck && foeDeck.cards) || [];
  const foeThemes = (foeDeck && foeDeck.themes) || [];

  // 상대 카드군을 등록해 둬야 상대 카드의 연계가 발동한다.
  // 저장소에는 쓰지 않는다 — 대전이 끝나면 사라져야 하므로 메모리에만 얹는다.
  _borrowedThemeIds = [];
  for (const t of foeThemes) {
    if (!t || !t.id) continue;
    if ((state.archetypesList || []).some(a => a.id === t.id)) continue;
    state.archetypesList.push({ ...t, _pvpBorrowed: true });
    _borrowedThemeIds.push(t.id);
  }

  // 상대 덱을 "보스 덱" 자리에 앉힌다
  initBattle({ seed });

  state.bossDeck = foeCards.map((c, i) => ({ ...c, instanceId: c.instanceId || `foe-${i}` }));
  state.bossHand = state.bossDeck.splice(0, 4);

  // 🐛 initBattle()은 PvE 보스를 세팅하므로 보스 고유 하수인(화염의 저주 토템,
  //    지옥불 사냥개 등)이 전장에 깔린 채로 시작한다.
  //    PvP에서 상대 전장은 반드시 비어 있어야 한다.
  //    (함정 존은 battle-engine 모듈 지역 변수라 initBattle이 이미 비운다)
  state.bossMinions = [];

  if (foeDeck && foeDeck.rejected && foeDeck.rejected.length > 0) {
    addBattleLog(`<span class="text-amber-300">⚖️ 상대 덱 ${foeDeck.rejected.length}장이 밸런스 검증으로 조정되었습니다.</span>`);
  }

  // 상대는 보스가 아니라 **듀얼리스트**다. PvE 보스의 흔적을 전부 지운다.
  const fp = _foeProfile || {};
  state.currentBoss = {
    name: fp.name || '상대 듀얼리스트',
    titleEn: fp.title || 'Opponent',
    element: fp.element || 'dark',
    avatarEmoji: fp.avatarEmoji || '👤',
    imageUrl: _foeAvatar || '',
    maxHp: 50,
    currentHp: 50,
    shield: 0,
    // ⚠️ 보스 전용 요소는 반드시 비운다 — 안 그러면 스크립트 콤보·대사가 튀어나온다
    comboPatterns: [],
    dialogueOnStart: '',
    dialogueLowHp: '',
    isDuelist: true
  };
  state.bossMana = 1;

  setStatus('playing');
  // 대전이 시작되면 전장으로 데려간다 (대전 탭에는 매칭 UI만 있다)
  moveArenaTo('pvp');
  applyArenaMode(true, (_foeProfile && _foeProfile.name) || '상대 듀얼리스트');
  if (window.switchTab) window.switchTab('versus');
  addBattleLog(`<span class="text-cyan-300 font-black">🌐 PvP 대전 시작! (방 ${escapeHtml(_room)} · 시드 ${seed})</span>`);
  addBattleLog(`<span class="text-slate-400">${_isHost ? '내가 선공입니다.' : '상대가 선공입니다. 잠시 기다리세요.'}</span>`);
  renderBattleUI();
}

// ── 전역 진입점 (index.html의 onclick) ──────────────────────

export function pvpHost() {
  startConnection(generateRoomCode(), true);
}

export function pvpJoin() {
  const input = el('pvp-room-input');
  const code = (input && input.value || '').trim().toUpperCase();
  if (code.length !== 6) {
    alert('방 코드 6자리를 입력하세요.');
    return;
  }
  startConnection(code, false);
}

export function pvpCopyRoom() {
  if (!_room) return;
  navigator.clipboard?.writeText(_room)
    .then(() => addBattleLog(`<span class="text-cyan-300">방 코드 ${escapeHtml(_room)} 를 복사했습니다.</span>`))
    .catch(() => alert(`방 코드: ${_room}`));
}

export function pvpLeave() {
  if (isPvpActive()) {
    try { _session && _session.sendAction({ kind: 'surrender' }); } catch (e) {}
  }
  try { _peer && _peer.close(); } catch (e) {}
  _peer = null;
  _session = null;
  _room = '';
  _foeProfile = null;
  _foeAvatar = '';

  // 전장을 PvE 탭으로 돌려놓는다
  moveArenaTo('pve');
  applyArenaMode(false);

  // 대전 중에만 얹어둔 상대 카드군을 걷어낸다.
  // 안 지우면 내 카드군 목록에 남의 카드군이 쌓이고, 다음 저장 때 딸려 들어간다.
  if (_borrowedThemeIds.length > 0) {
    state.archetypesList = (state.archetypesList || [])
      .filter(a => !(a._pvpBorrowed && _borrowedThemeIds.includes(a.id)));
    _borrowedThemeIds = [];
  }

  detachPvpSession();
  setStatus('idle');
  initBattle();          // PvE로 되돌린다
  renderBattleUI();
}

export function getPvpStatus() {
  return { status: _status, room: _room, isHost: _isHost };
}
