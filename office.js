/**
 * 3D 오피스 — 화면과 회의실 데이터
 *
 * - 3D 장면은 office-scene.js 가 그립니다.
 *   (가운데 김팀장 총괄석 · 왼쪽 비서실 존 · 오른쪽 폴리코드팀 존 · 앞쪽 회의·휴게공간)
 * - 이 파일은 회의실 API(/api/rooms, /api/rooms/general/messages)에서 읽어
 *   캐릭터 상태(작업 중/대기)와 두 현황판(비서실 · 폴리코드팀) 내용을 만들고,
 *   클릭하면 정보 패널을 엽니다.
 * - 읽기 전용입니다. 글을 쓰지 않습니다.
 */

import { createOffice } from './office-scene.js';

var KST = 'Asia/Seoul';
var POLL_MS = 20000;
var KEY_STORAGE = 'ai_team_room_key'; // 회의실(index.html)과 같은 저장소를 씁니다.
var NOTICE_ROOM = 'general';

/* 사람 정보 — 장면(office-scene.js)의 key 와 맞춰야 합니다. */
var PEOPLE = {
  kim: {
    name: '김팀장', emoji: '🌸', color: '#ff6b9d',
    role: '비서실 총괄 (Chief of Staff)',
    seat: '중앙 총괄석 · 비서실 존과 폴리코드팀 존 사이',
    about: '대표님 지시를 접수해 비서실과 폴리코드팀을 함께 총괄합니다. 두 존 사이 중앙석에서 양쪽을 살피고, 회의실에서는 🌸 김팀장으로 활동합니다.',
    sends: ['김팀장', '김비서'],
  },
  kkobung: {
    name: '꼬붕이', emoji: '🐣', color: '#f6b45c',
    role: '조사·실행 워커',
    seat: '비서실 존 · 실행 데스크',
    handle: '@iseohaeseopa2',
    about: '자료 조사와 실행을 도맡는 비서실 워커입니다. 김팀장의 지시를 받아 빠르게 확인하고 처리합니다.',
    sends: ['꼬붕이'],
  },
  muse: {
    name: '뮤즈', emoji: '🎨', color: '#a78bfa',
    role: '전략·기획',
    seat: '폴리코드팀 존 · 기획 데스크',
    about: '전략과 기획을 맡습니다. 신중하게 따져 보고 안을 세웁니다.',
    sends: ['뮤즈'],
  },
  gemini: {
    name: '제미나이', emoji: '💎', color: '#6fc3ff',
    role: '조사·실행',
    seat: '폴리코드팀 존 · 리서치 데스크',
    about: '조사와 실행을 맡습니다. 회의실에서는 리서치·교차검증을 담당합니다.',
    sends: ['제미나이'],
  },
  claude: {
    name: '클로드', emoji: '🧠', color: '#5ed6a8',
    role: '개발·아키텍처 · 채용중',
    seat: '폴리코드팀 존 · 빈 자리',
    about: '개발·아키텍처 자리입니다. 지금은 채용 공고 중이라 책상만 놓여 있습니다.',
    sends: ['클로드'],
    hiring: true,
  },
};

var SLOT_INFO = {
  name: '신규 피클 자리', emoji: '➕',
  role: '새 동료가 앉을 비서실 자리',
  about: '새 피클 친구가 합류하면 비서실 존의 이 책상을 쓰게 됩니다. 꼬붕이 옆, 김팀장 바로 왼쪽에 비워 두었습니다.',
};

/* 비서실 현황판에 세울 워커 목록 */
var SEC_WORKERS = [
  { key: 'kim', name: '김팀장', role: '총괄 · 조율' },
  { key: 'kkobung', name: '꼬붕이', role: '실행 워커' },
  { key: 'slot', name: '신규', role: '합류 대기' },
];

/* ---------- 작은 도우미 ---------- */
function $(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function kstTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) { return ''; }
}
function kstStamp(d) {
  try {
    var p = new Intl.DateTimeFormat('ko-KR', {
      timeZone: KST, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    var o = {};
    p.forEach(function (x) { o[x.type] = x.value; });
    return o.month + '/' + o.day + ' ' + o.hour + ':' + o.minute;
  } catch (e) { return ''; }
}
function kstClock(d) {
  try {
    return new Intl.DateTimeFormat('ko-KR', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch (e) { return ''; }
}
function stripMd(s) {
  return String(s || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`>#]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function relTime(iso) {
  var t = new Date(iso).getTime();
  if (!isFinite(t)) return '';
  var m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  var h = Math.round(m / 60);
  if (h < 24) return h + '시간 전';
  return Math.round(h / 24) + '일 전';
}

/* ---------- 상태 ---------- */
var state = {
  key: '',
  connected: false,
  rooms: [],
  messages: [],
  lastBy: {},
  statuses: {},
  board: null,
  secBoard: null,
  updatedAt: null,
  error: '',
  selection: null,
  timer: null,
};

var api = null;

/* ---------- 연결 ---------- */
function storedKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (e) { return ''; }
}
function saveKey(k) {
  try { if (k) localStorage.setItem(KEY_STORAGE, k); } catch (e) { /* 저장 실패는 무시 */ }
}
function urlKey() {
  try {
    var p = new URLSearchParams(window.location.search);
    return (p.get('key') || '').trim();
  } catch (e) { return ''; }
}

function getJson(path, key) {
  var headers = {};
  if (key) headers['X-Room-Key'] = key;
  return fetch(path, { headers: headers, cache: 'no-store' }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok || !data || !data.ok) {
        var err = new Error((data && data.message) || ('HTTP ' + res.status));
        err.status = res.status;
        throw err;
      }
      return data;
    });
  });
}

function loadData() {
  if (!state.key) {
    setOffline('비밀번호가 필요합니다.');
    return Promise.resolve();
  }
  return getJson('/api/rooms', state.key)
    .then(function (roomsData) {
      var raw = roomsData.rooms || [];
      state.rooms = raw.map(function (r) {
        return { slug: r.slug, name: r.name, description: r.description, count: r.message_count || 0, lastId: r.last_id || 0 };
      });
      return getJson('/api/rooms/' + encodeURIComponent(NOTICE_ROOM) + '/messages?limit=30', state.key);
    })
    .then(function (msgData) {
      state.messages = (msgData && msgData.messages) || [];
      state.connected = true;
      state.error = '';
      state.updatedAt = new Date();
      rebuildModel();
      setOnline();
    })
    .catch(function (err) {
      var status = err && err.status;
      if (status === 401 || status === 403) {
        setOffline('비밀번호가 맞지 않습니다. 다시 연결해 주세요.');
      } else {
        setOffline('회의실에 연결하지 못했습니다.');
      }
    });
}

function setOnline() {
  var chip = $('connChip');
  chip.className = 'chip live';
  $('connText').textContent = '실시간 연결';
  chip.title = '회의실 연결됨 · ' + kstClock(state.updatedAt || new Date()) + ' 기준';
  $('connBtn').hidden = true;
}
function setOffline(msg) {
  state.connected = false;
  state.error = msg || '';
  state.rooms = [];
  state.messages = [];
  state.lastBy = {};
  state.board = null;
  state.secBoard = null;
  var chip = $('connChip');
  chip.className = 'chip offline';
  $('connText').textContent = '오프라인';
  chip.title = msg || '회의실 연결이 필요합니다.';
  $('connBtn').hidden = false;
  rebuildModel();
}

/* ---------- 상태 계산 ---------- */
function statusOfLast(last) {
  if (!last) return { code: 'idle', label: '대기' };
  var mins = (Date.now() - new Date(last.created_at).getTime()) / 60000;
  if (!isFinite(mins)) return { code: 'idle', label: '대기' };
  if (mins < 25) return { code: 'active', label: '작업 중' };
  if (mins < 180) return { code: 'recent', label: '최근 활동' };
  return { code: 'idle', label: '대기' };
}

function lastMessageFor(key) {
  var p = PEOPLE[key];
  if (!p) return null;
  var last = null;
  (p.sends || []).forEach(function (name) {
    var m = state.lastBy[name];
    if (m && (!last || (m.id || 0) > (last.id || 0))) last = m;
  });
  return last;
}

function rebuildModel() {
  // 발신자별 최근 발언
  var lastBy = {};
  state.messages.forEach(function (m) {
    var prev = lastBy[m.sender];
    if (!prev || (m.id || 0) > (prev.id || 0)) lastBy[m.sender] = m;
  });
  state.lastBy = lastBy;

  var statuses = {};
  Object.keys(PEOPLE).forEach(function (key) {
    var p = PEOPLE[key];
    if (p.hiring) {
      statuses[key] = { code: 'hiring', label: '채용중' };
      return;
    }
    statuses[key] = statusOfLast(lastMessageFor(key));
  });
  statuses.slot = { code: 'planned', label: '새 자리' };
  state.statuses = statuses;

  // 폴리코드팀 현황판: 방별 건수 + 최근 #general 공지(김팀장 우선, 없으면 최신 글)
  var notice = null;
  for (var i = state.messages.length - 1; i >= 0; i--) {
    var m = state.messages[i];
    if (m.sender === '김팀장' || m.sender === '김비서') { notice = m; break; }
  }
  if (!notice && state.messages.length) notice = state.messages[state.messages.length - 1];

  state.board = state.connected ? {
    connected: true,
    updated: kstStamp(state.updatedAt || new Date()) + ' KST',
    rooms: state.rooms.map(function (r) { return { name: r.name, count: r.count }; }),
    notice: notice ? {
      who: notice.emoji ? notice.emoji + ' ' + notice.sender : notice.sender,
      time: kstTime(notice.created_at),
      text: stripMd(notice.content).slice(0, 320),
    } : null,
  } : { connected: false };

  // 비서실 현황판: 픽클 워커 상태 + 최근 지시/보고
  var directs = [];
  for (var d = state.messages.length - 1; d >= 0 && directs.length < 2; d--) {
    var dm = state.messages[d];
    if (dm.sender === '쿠사리') {
      directs.push({
        who: dm.sender,
        time: kstTime(dm.created_at),
        text: stripMd(dm.content).slice(0, 120),
      });
    }
  }
  var reportMsg = null;
  for (var r = state.messages.length - 1; r >= 0; r--) {
    if (state.messages[r].sender === '김팀장' || state.messages[r].sender === '김비서') { reportMsg = state.messages[r]; break; }
  }

  state.secBoard = state.connected ? {
    connected: true,
    updated: kstStamp(state.updatedAt || new Date()) + ' KST',
    workers: SEC_WORKERS.map(function (w) {
      var st = state.statuses[w.key] || { code: 'idle', label: '대기' };
      var last = w.key === 'slot' ? null : lastMessageFor(w.key);
      return {
        name: w.name,
        role: w.role,
        code: st.code,
        label: st.label,
        last: last ? kstTime(last.created_at) : '',
      };
    }),
    directs: directs,
    report: reportMsg ? {
      who: reportMsg.emoji ? reportMsg.emoji + ' ' + reportMsg.sender : reportMsg.sender,
      time: kstTime(reportMsg.created_at),
      text: stripMd(reportMsg.content).slice(0, 150),
    } : null,
  } : { connected: false };

  api.applyData({
    connected: state.connected,
    statuses: state.statuses,
    board: state.board,
    secBoard: state.secBoard,
    devBoard: state.board,
    rooms: state.board && state.board.rooms,
    clock: kstClock(new Date()),
  });

  if (state.selection) renderInspector(state.selection);
}

/* ---------- 정보 패널 ---------- */
function closeInspector() {
  state.selection = null;
  var ins = $('inspector');
  ins.classList.remove('show');
  ins.setAttribute('aria-hidden', 'true');
  api.hideBubble();
}

function openInspector(kind, key) {
  state.selection = { kind: kind, key: key };
  var ins = $('inspector');
  ins.classList.add('show');
  ins.setAttribute('aria-hidden', 'false');
  renderInspector(state.selection);
}

function stateBadge(code, label) {
  return '<span class="state ' + esc(code) + '">' + esc(label) + '</span>';
}

function roomRows() {
  if (!state.rooms.length) return '';
  return '<div class="rows">' + state.rooms.map(function (r) {
    return '<div class="row">' +
      '<span class="hash">#</span>' +
      '<span class="nm">' + esc(r.name) + '</span>' +
      '<span class="cnt">' + r.count + '건</span>' +
      '<a class="go" href="/?room=' + encodeURIComponent(r.slug) + '" target="_blank" rel="noopener">열기</a>' +
      '</div>';
  }).join('') + '</div>';
}

function connectBlock() {
  return '<div class="ins-sec">' +
    '<p style="margin-bottom:9px">' + esc(state.error || '회의실 비밀번호를 넣으면 실시간 현황이 표시됩니다.') + '</p>' +
    '<button class="btn" type="button" data-act="connect">🔑 회의실 연결하기</button>' +
    '</div>';
}

/* 비서실 워커 한 줄 */
function workerRow(w) {
  return '<div class="row">' +
    '<span class="nm">' + esc(w.name) + ' <span class="role">' + esc(w.role) + '</span></span>' +
    '<span class="cnt">' + esc(w.label || '대기') + '</span>' +
    '</div>';
}

function renderInspector(sel) {
  var ins = $('inspector');
  var html = '';
  var last = null;
  if (sel.kind === 'person') {
    var p = PEOPLE[sel.key];
    if (!p) return;
    var st = state.statuses[sel.key] || { code: 'idle', label: '대기' };
    last = lastMessageFor(sel.key);
    html += '<div class="ins-head">' +
      '<div class="ins-avatar" style="background:' + esc(p.color) + '22;border-color:' + esc(p.color) + '66">' + p.emoji + '</div>' +
      '<div class="ins-title"><h2>' + esc(p.name) + ' ' + stateBadge(st.code, st.label) + '</h2>' +
      '<p>' + esc(p.role) + (p.handle ? ' · <span class="mono">' + esc(p.handle) + '</span>' : '') + '</p></div>' +
      '<button class="ins-close" type="button" data-act="close" aria-label="닫기">×</button>' +
      '</div>';
    html += '<div class="ins-sec"><h3>하는 일</h3><p>' + esc(p.about) + '</p>' +
      '<div class="meta-line"><span>🪑 ' + esc(p.seat) + '</span></div></div>';

    if (last) {
      html += '<div class="ins-sec"><h3>회의실 최근 발언 · #general</h3>' +
        '<blockquote class="quote"><span class="who">' + esc(last.emoji ? last.emoji + ' ' + last.sender : last.sender) +
        ' · ' + esc(kstTime(last.created_at)) + ' (' + esc(relTime(last.created_at)) + ')</span>' +
        esc(stripMd(last.content).slice(0, 420)) + '</blockquote></div>';
    } else if (state.connected) {
      html += '<div class="ins-sec"><h3>회의실 최근 발언 · #general</h3><p>최근 30개 메시지에 이 사람의 발언이 없습니다.</p></div>';
    } else {
      html += connectBlock();
    }
    html += '<div class="ins-sec"><a class="btn" href="/?room=general" target="_blank" rel="noopener">💬 회의실에서 대화하기</a></div>';
  } else if (sel.kind === 'board' && sel.key === 'secretariat') {
    var sec = state.secBoard || { connected: false };
    html += '<div class="ins-head">' +
      '<div class="ins-avatar">🗂️</div>' +
      '<div class="ins-title"><h2>비서실 현황판 ' + (state.connected ? '<span class="state planned">실시간</span>' : '') + '</h2>' +
      '<p>Pickle Desk · 워커 상태 · 최근 지시</p></div>' +
      '<button class="ins-close" type="button" data-act="close" aria-label="닫기">×</button></div>';
    if (state.connected) {
      html += '<div class="ins-sec"><h3>픽클 워커 현황</h3><div class="rows">' +
        (sec.workers || []).map(workerRow).join('') + '</div></div>';
      if (sec.directs && sec.directs.length) {
        html += '<div class="ins-sec"><h3>최근 지시 · #general</h3>' +
          sec.directs.map(function (d) {
            return '<blockquote class="quote"><span class="who">👤 ' + esc(d.who) + ' · ' + esc(d.time) + '</span>' +
              esc(d.text) + '</blockquote>';
          }).join('<div style="height:7px"></div>') + '</div>';
      }
      if (sec.report) {
        html += '<div class="ins-sec"><h3>최근 보고</h3><blockquote class="quote">' +
          '<span class="who">' + esc(sec.report.who) + ' · ' + esc(sec.report.time) + '</span>' +
          esc(sec.report.text) + '</blockquote></div>';
      }
      html += '<div class="ins-sec"><a class="btn" href="/?room=general" target="_blank" rel="noopener">💬 회의실 열기</a></div>';
    } else {
      html += connectBlock() + '<div class="ins-sec"><a class="btn ghost" href="/" target="_blank" rel="noopener">💬 회의실로 이동</a></div>';
    }
  } else if (sel.kind === 'board' && sel.key === 'poly') {
    html += '<div class="ins-head">' +
      '<div class="ins-avatar">🧑‍💻</div>' +
      '<div class="ins-title"><h2>폴리코드팀 현황판 ' + (state.connected ? '<span class="state planned">실시간</span>' : '') + '</h2>' +
      '<p>방별 메시지 수와 최근 #general 공지</p></div>' +
      '<button class="ins-close" type="button" data-act="close" aria-label="닫기">×</button></div>';
    if (state.connected) {
      html += '<div class="ins-sec"><h3>회의실 방</h3>' + roomRows() + '</div>';
      if (state.board && state.board.notice) {
        html += '<div class="ins-sec"><h3>최근 공지</h3><blockquote class="quote">' +
          '<span class="who">' + esc(state.board.notice.who) + ' · ' + esc(state.board.notice.time) + '</span>' +
          esc(state.board.notice.text) + '</blockquote></div>';
      }
      html += '<div class="ins-sec"><a class="btn" href="/?room=general" target="_blank" rel="noopener">💬 회의실 열기</a></div>';
    } else {
      html += connectBlock() + '<div class="ins-sec"><a class="btn ghost" href="/" target="_blank" rel="noopener">💬 회의실로 이동</a></div>';
    }
  } else if (sel.kind === 'phone') {
    html += '<div class="ins-head">' +
      '<div class="ins-avatar">☎️</div>' +
      '<div class="ins-title"><h2>회의 전화</h2><p>김팀장 중앙석 · 회의 소집 · 방 전환</p></div>' +
      '<button class="ins-close" type="button" data-act="close" aria-label="닫기">×</button></div>';
    html += '<div class="ins-sec"><h3>바로 걸기</h3><p>방을 고르면 회의실이 새 창으로 열립니다. 비밀번호는 이미 기억된 상태면 다시 묻지 않습니다.</p></div>';
    if (state.connected) {
      html += '<div class="ins-sec">' + roomRows() + '</div>';
      html += '<div class="ins-sec"><a class="btn" href="/?room=general" target="_blank" rel="noopener">☎️ 전체 회의 소집</a></div>';
    } else {
      html += connectBlock();
    }
  } else if (sel.kind === 'slot') {
    html += '<div class="ins-head">' +
      '<div class="ins-avatar">➕</div>' +
      '<div class="ins-title"><h2>신규 피클 자리 <span class="state planned">새 자리</span></h2>' +
      '<p>' + esc(SLOT_INFO.role) + '</p></div>' +
      '<button class="ins-close" type="button" data-act="close" aria-label="닫기">×</button></div>';
    html += '<div class="ins-sec"><h3>설명</h3><p>' + esc(SLOT_INFO.about) + '</p></div>';
    html += '<div class="ins-sec"><a class="btn" href="/?room=general" target="_blank" rel="noopener">💬 합류 안내를 회의실에 남기기</a></div>';
  } else if (sel.kind === 'common') {
    html += '<div class="ins-head">' +
      '<div class="ins-avatar">🛋️</div>' +
      '<div class="ins-title"><h2>회의·휴게공간</h2><p>앞쪽 공용 공간 · 회의 테이블 · 빈백 라운지</p></div>' +
      '<button class="ins-close" type="button" data-act="close" aria-label="닫기">×</button></div>';
    html += '<div class="ins-sec"><h3>이렇게 씁니다</h3><p>여럿이 모여 정할 안건은 둥근 회의 테이블에서, 잠깐 쉴 때는 빈백 라운지에서. 회의 소집은 김팀장 책상의 ☎로 걸면 됩니다.</p></div>';
    html += '<div class="ins-sec"><a class="btn" href="/?room=general" target="_blank" rel="noopener">💬 회의실 열기</a></div>';
  }
  ins.innerHTML = html;
}

/* ---------- 클릭 처리 ---------- */
function bubbleTextFor(kind, key) {
  if (kind === 'person') {
    var p = PEOPLE[key] || {};
    var st = state.statuses[key] || { label: '대기' };
    if (p.hiring) return '채용 중인 자리입니다. 곧 새 팀원이 앉을 거예요.';
    if (!state.connected) return p.name + ' · ' + (p.role || '') + ' (회의실을 연결하면 활동 상태가 보입니다)';
    var last = lastMessageFor(key);
    if (last) return st.label + ' · ' + relTime(last.created_at) + '에 #general에 글을 남겼습니다.';
    return st.label + ' · 최근 #general 발언이 없습니다.';
  }
  if (kind === 'board') {
    if (key === 'secretariat') {
      if (!state.connected) return '회의실을 연결하면 픽클 워커 상태와 최근 지시가 이 보드에 뜹니다.';
      var sec = state.secBoard || {};
      var busy = 0;
      (sec.workers || []).forEach(function (w) { if (w.code === 'active') busy += 1; });
      return '픽클 워커 ' + (sec.workers || []).length + '명 · 작업 중 ' + busy + '명 · 최근 지시 ' +
        (sec.directs && sec.directs.length ? sec.directs[0].time : '없음');
    }
    if (!state.connected) return '회의실을 연결하면 방별 현황과 최근 공지가 이 보드에 뜹니다.';
    var total = state.rooms.reduce(function (a, r) { return a + r.count; }, 0);
    return state.rooms.length + '개 방 · 메시지 ' + total + '건 · ' + (state.board && state.board.notice ? '최근 공지 ' + state.board.notice.time : '공지 없음');
  }
  if (kind === 'phone') return state.connected ? '회의 소집 · 방을 골라 바로 들어갑니다.' : '회의실 비밀번호를 넣으면 방 목록이 열립니다.';
  if (kind === 'slot') return '새 피클이 앉을 자리 · 꼬붕이 옆, 김팀장 왼쪽에 비워 두었습니다.';
  if (kind === 'common') return '회의 테이블과 빈백 라운지 · 회의 소집은 ☎로.';
  return '';
}

function onPick(kind, key) {
  openInspector(kind, key);
  var t = bubbleTextFor(kind, key);
  if (t) api.say(key, t);
}

/* ---------- 카메라 프리셋 ---------- */
function setPreset(name) {
  var btns = document.querySelectorAll('#presets button');
  Array.prototype.forEach.call(btns, function (b) {
    b.setAttribute('aria-pressed', b.getAttribute('data-view') === name ? 'true' : 'false');
  });
  api.setView(name);
}

/* ---------- 비밀번호 입력 ---------- */
function openGate(msg) {
  var gate = $('gate');
  gate.hidden = false;
  $('gateErr').textContent = msg || '';
  setTimeout(function () { $('gateInput').focus(); }, 80);
}
function closeGate() { $('gate').hidden = true; }

function tryConnect(key) {
  var v = String(key || '').trim();
  if (!v) { $('gateErr').textContent = '비밀번호를 입력하세요.'; return; }
  $('gateErr').textContent = '확인 중…';
  getJson('/api/rooms', v).then(function () {
    state.key = v;
    saveKey(v);
    closeGate();
    $('gateInput').value = '';
    loadData();
  }).catch(function (err) {
    $('gateErr').textContent = (err && err.status === 401) ? '비밀번호가 맞지 않습니다.' : '연결할 수 없습니다. 잠시 후 다시 시도하세요.';
  });
}

/* ---------- 부팅 ---------- */
function boot() {
  var mount = $('stage');
  try {
    api = createOffice(mount, {
      onPick: onPick,
      bubbleLayer: $('bubbleLayer'),
    });
  } catch (err) {
    $('loader').innerHTML = '<div class="box"><b>3D 장면을 열 수 없습니다</b>' +
      '<span>이 브라우저에서 WebGL 을 쓸 수 없어요. 회의실은 그대로 쓸 수 있습니다.</span><br><br>' +
      '<a href="/" style="color:#a34d2a;font-weight:700">💬 회의실로 이동</a></div>';
    return;
  }

  // 프리셋
  Array.prototype.forEach.call(document.querySelectorAll('#presets button'), function (b) {
    b.addEventListener('click', function () { setPreset(b.getAttribute('data-view')); });
  });

  // 정보 패널 안의 버튼
  $('inspector').addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== this) {
      var act = t.getAttribute && t.getAttribute('data-act');
      if (act === 'close') { closeInspector(); return; }
      if (act === 'connect') { openGate(); return; }
      t = t.parentNode;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!$('gate').hidden) closeGate();
      else if (state.selection) closeInspector();
    }
  });

  // 연결 칩
  $('connBtn').addEventListener('click', function () { openGate(state.error ? '비밀번호를 다시 입력해 주세요.' : ''); });
  $('gateBtn').addEventListener('click', function () { tryConnect($('gateInput').value); });
  $('gateCancel').addEventListener('click', closeGate);
  $('gateInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryConnect($('gateInput').value); });
  $('gate').addEventListener('click', function (e) { if (e.target === $('gate')) closeGate(); });

  // 첫 연결: ?key= → 저장 → localStorage 순서
  var k = urlKey();
  if (k) { state.key = k; saveKey(k); }
  else state.key = storedKey();

  loadData().then(function () {
    var loader = $('loader');
    loader.classList.add('hide');
    setTimeout(function () { loader.style.display = 'none'; }, 600);
    // 비밀번호 없이 들어온 경우는 장면을 그대로 보여 주고, 오른쪽 위 '연결'로 안내합니다.
  });

  // 주기 갱신 (탭이 보일 때만)
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(function () {
    if (document.hidden || !state.key) return;
    loadData();
  }, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.key) loadData();
  });

  // 벽시계는 30초마다 KST 로
  setInterval(function () {
    if (api && state.statuses) {
      api.applyData({
        connected: state.connected,
        statuses: state.statuses,
        board: state.board,
        secBoard: state.secBoard,
        devBoard: state.board,
        rooms: state.board && state.board.rooms,
        clock: kstClock(new Date()),
      });
    }
  }, 30000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
