/**
 * 쿠사리 AI 팀 회의실 — Cloudflare Pages Functions (advanced mode, _worker.js)
 *
 * 정적 파일(index.html)은 env.ASSETS 로 서빙하고, /api/* 는 D1(env.DB) 로 처리합니다.
 * 인증: Authorization: Bearer <ROOM_KEY 또는 API_KEY>  (또는 X-Room-Key 헤더, ?key= 쿼리)
 */

// ---------- 참여자(역할) 목록 ----------
// 이름을 바꾸려면 여기와 index.html 의 SENDERS 배열을 함께 바꾸세요.
const AGENTS = {
  '쿠사리':   { role: '대표 · 총괄 의사결정',     color: '#ffd166', emoji: '👑' },
  '김비서':   { role: '총괄 AI 비서 · 실행·배포', color: '#ff9ec4', emoji: '🌸' },
  '뮤즈':     { role: '크리에이티브 · 문서·기획', color: '#a78bfa', emoji: '🎨' },
  '제미나이': { role: '리서치 · 교차검증',        color: '#6fc3ff', emoji: '💎' },
  '클로드':   { role: '개발 · 아키텍처',          color: '#5ed6a8', emoji: '🧠' },
};

// 방 목록은 D1 의 rooms 테이블이 기준입니다. (schema.sql 기본값: general / audit / village / creative)

const PALETTE = ['#ff5c8a', '#6fc3ff', '#f0b070', '#a78bfa', '#5ed6a8', '#ffd166', '#ff8b6b', '#8fb8ff'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Room-Key',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });
}

function text(body, status = 200, type = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'content-type': type, 'cache-control': 'no-store', ...CORS } });
}

// 이름이 AGENTS 에 있으면 역할 배지를, 없으면 '참여자' 배지를 붙입니다.
function meta(sender) {
  const raw = String(sender == null ? '' : sender).trim();
  if (AGENTS[raw]) {
    const a = AGENTS[raw];
    return { name: raw, role: a.role, color: a.color, emoji: a.emoji };
  }
  let h = 0;
  for (const ch of raw) h = (h * 31 + ch.codePointAt(0)) % 100000;
  return { name: raw, role: '참여자', color: PALETTE[h % PALETTE.length], emoji: raw.slice(0, 1) };
}

function readKey(request, url) {
  const auth = request.headers.get('authorization') || '';
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const x = request.headers.get('x-room-key');
  if (x && x.trim()) return x.trim();
  return (url.searchParams.get('key') || url.searchParams.get('passcode') || '').trim();
}

// 타이밍 공격을 피하려고 길이를 맞춰 비교합니다.
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function authorized(request, env, url) {
  const key = readKey(request, url);
  if (!key) return false;
  const valid = [env.API_KEY, env.ROOM_KEY].filter(Boolean);
  return valid.some((v) => same(v, key));
}

function decorate(row) {
  const m = meta(row.sender);
  const out = {
    id: row.id,
    room: row.room_slug,
    sender: m.name,
    role: m.role,
    color: m.color,
    emoji: m.emoji,
    content: row.content,
    reply_to_id: row.reply_to_id || null,
    created_at: row.created_at,
  };
  if (row.attachment_id) {
    out.attachment = {
      id: row.attachment_id,
      filename: row.att_filename || 'file',
      mime_type: row.att_mime_type || 'application/octet-stream',
      size: row.att_size || 0,
      url: `/api/attachments/${row.attachment_id}`,
    };
  }
  return out;
}

async function attachReplies(env, messages, slug) {
  const ids = [...new Set(messages.map((m) => m.reply_to_id).filter(Boolean))];
  if (!ids.length) return messages;
  const holes = ids.map(() => '?').join(',');
  const res = await env.DB.prepare(
    `select id, sender, content, created_at from messages where room_slug = ? and id in (${holes})`
  )
    .bind(slug, ...ids)
    .all();
  const map = new Map((res.results || []).map((r) => [r.id, r]));
  for (const m of messages) {
    const parent = m.reply_to_id ? map.get(m.reply_to_id) : null;
    m.reply_to = parent
      ? {
          id: parent.id,
          sender: meta(parent.sender).name,
          content: String(parent.content).slice(0, 300),
        }
      : null;
  }
  return messages;
}

async function roomList(env) {
  const res = await env.DB.prepare(
    `select r.slug, r.name, r.description, r.position,
            (select count(*) from messages m where m.room_slug = r.slug) as message_count,
            (select max(id) from messages m where m.room_slug = r.slug) as last_id,
            (select created_at from messages m where m.room_slug = r.slug order by id desc limit 1) as last_message_at
       from rooms r
      order by r.position, r.slug`
  ).all();
  return res.results || [];
}

async function getRoom(env, slug) {
  return env.DB.prepare('select slug, name, description from rooms where slug = ?').bind(slug).first();
}

async function listMessages(env, slug, after, limit) {
  let rows;
  if (after > 0) {
    const res = await env.DB.prepare(
      `select m.*, a.filename as att_filename, a.mime_type as att_mime_type, a.size as att_size
         from messages m
         left join attachments a on a.id = m.attachment_id
        where m.room_slug = ? and m.id > ?
        order by m.id asc limit ?`
    )
      .bind(slug, after, limit)
      .all();
    rows = res.results || [];
  } else {
    const res = await env.DB.prepare(
      `select m.*, a.filename as att_filename, a.mime_type as att_mime_type, a.size as att_size
         from messages m
         left join attachments a on a.id = m.attachment_id
        where m.room_slug = ?
        order by m.id desc limit ?`
    )
      .bind(slug, limit)
      .all();
    rows = (res.results || []).reverse();
  }
  const messages = rows.map(decorate);
  await attachReplies(env, messages, slug);
  const latest = messages.length ? messages[messages.length - 1].id : 0;
  return { messages, latest };
}

async function postMessage(env, slug, payload) {
  const sender = String(payload.sender || '').trim();
  const content = String(payload.content || '').trim();
  const att = payload.attachment && typeof payload.attachment === 'object' ? payload.attachment : null;
  if (!sender) return { error: 'sender 가 필요합니다.', status: 400 };
  if (!content && !att) return { error: 'content 또는 attachment 가 필요합니다.', status: 400 };
  if (content.length > 4000) return { error: 'content 는 4000자까지 가능합니다.', status: 400 };
  if (sender.length > 24) return { error: 'sender 가 너무 깁니다.', status: 400 };

  let attachmentId = null;
  if (att) {
    const filename = String(att.filename || 'file').trim().slice(0, 180) || 'file';
    const mimeType = String(att.mime_type || 'application/octet-stream').trim().slice(0, 120) || 'application/octet-stream';
    let b64 = String(att.data_base64 || '').trim();
    const commaIdx = b64.indexOf(',');
    if (b64.startsWith('data:') && commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
    if (!b64) return { error: 'attachment.data_base64 가 필요합니다.', status: 400 };
    if (b64.length > 980000) return { error: '첨부 파일은 약 700KB 이하만 가능합니다.', status: 413 };
    const size = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    const attRes = await env.DB.prepare(
      `insert into attachments (room_slug, filename, mime_type, size, data_base64, created_at)
       values (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
      .bind(slug, filename, mimeType, Math.max(0, size), b64)
      .run();
    attachmentId = attRes.meta && attRes.meta.last_row_id;
  }

  let replyTo = null;
  const rt = payload.reply_to_id ?? payload.reply_to;
  if (rt !== null && rt !== undefined && rt !== '') {
    const n = parseInt(rt, 10);
    if (Number.isFinite(n) && n > 0) {
      const parent = await env.DB.prepare('select id from messages where room_slug = ? and id = ?').bind(slug, n).first();
      if (parent) replyTo = n;
    }
  }

  const res = await env.DB.prepare(
    `insert into messages (room_slug, sender, content, reply_to_id, attachment_id, created_at)
     values (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
  )
    .bind(slug, sender, content, replyTo, attachmentId)
    .run();

  const id = res.meta && res.meta.last_row_id;
  const row = await env.DB.prepare(
    `select m.*, a.filename as att_filename, a.mime_type as att_mime_type, a.size as att_size
       from messages m
       left join attachments a on a.id = m.attachment_id
      where m.id = ?`
  )
    .bind(id)
    .first();
  const messages = [decorate(row)];
  await attachReplies(env, messages, slug);
  return { message: messages[0] };
}

// ---------- 제미나이(Gemini) 자동 답글 ----------
// env.GEMINI_API_KEY 가 설정된 경우에만 동작합니다. 키가 없으면 예전과 똑같이 조용히 넘어갑니다.
// 2026-11 확인: gemini-2.5-flash·2.0-flash 는 신규 키에서 404(제공 종료).
// 플래그십(3.5~3.8 flash)은 시간대에 따라 503(혼잡)이 잦아, 기본은 가장 빠르고 안정적인 lite 계열부터 시도합니다.
// 모델은 GEMINI_MODEL 환경변수로 1순위를 바꿀 수 있습니다.
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const GEMINI_HISTORY_LIMIT = 15;
const GEMINI_TIMEOUT_MS = 22000; // 실시간 검색 grounding 왕복까지 기다릴 수 있게 넉넉히
const GEMINI_MAX_CHARS = 4000;
const GEMINI_MAX_TOKENS = 3072;

// 매 요청 시점의 한국 시간(KST).
// 모델이 학습 시점의 날짜(2024·2025년)를 "현재"로 착각하는 고질병을 막으려고
// 시스템 프롬프트에 요청마다 새로 계산해 넣습니다.
function kstNow() {
  const now = new Date();
  const parts = {};
  try {
    for (const p of new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'long',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now)) {
      parts[p.type] = p.value;
    }
  } catch (e) {
    // Intl 이 막힌 런타임에서는 UTC+9 로 직접 계산합니다.
  }
  let y = parts.year, mo = parts.month, d = parts.day, hh = parts.hour, mm = parts.minute, wd = parts.weekday;
  if (!y || !mo || !d) {
    const k = new Date(now.getTime() + 9 * 3600 * 1000);
    y = String(k.getUTCFullYear());
    mo = String(k.getUTCMonth() + 1);
    d = String(k.getUTCDate());
    hh = String(k.getUTCHours());
    mm = String(k.getUTCMinutes());
    wd = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][k.getUTCDay()];
  }
  const pad = (v) => String(v).replace(/[^0-9]/g, '').padStart(2, '0');
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return {
    iso,
    year: String(y),
    hour: pad(hh),
    ko: `${y}년 ${Number(mo)}월 ${Number(d)}일 ${wd} ${pad(hh)}:${pad(mm)} (KST)`,
    utc: now.toISOString(),
  };
}

// 본문에 @이름 이 있는지 (공백 허용: "@ 제미나이" 도 인정)
function mentions(text, name) {
  return new RegExp('@\\s*' + name).test(text);
}

// 무한 루프 방지 규칙 (이 함수 하나만 고치면 호출 정책이 바뀝니다)
//  - 제미나이 글        → 절대 응답하지 않음
//  - 김비서 글          → 본문에 @제미나이 가 있을 때만
//  - 그 외(사람 등)     → @김비서·@뮤즈·@클로드 만 콕 집어 부른 경우는 제외하고 응답
function shouldGeminiReply(sender, content) {
  const s = String(sender == null ? '' : sender).trim();
  const c = String(content == null ? '' : content);
  if (s === '제미나이') return false;
  if (s === '김비서') return mentions(c, '제미나이');
  if (mentions(c, '제미나이')) return true;
  if (mentions(c, '김비서') || mentions(c, '뮤즈') || mentions(c, '클로드')) return false;
  return true;
}

function geminiSystemPrompt(room) {
  const roomName = (room && room.name) || '회의실';
  const roomDesc = (room && room.description) || '';
  const t = kstNow();
  return [
    '당신은 쿠사리님(대표)의 "AI 팀 회의실"에 참여한 AI 팀원 "제미나이"입니다.',
    `지금 있는 방: ${roomName}${roomDesc ? ` — ${roomDesc}` : ''}`,
    '',
    '역할: 리서치 · 교차검증 · 실무 조언자.',
    '팀 구성: 쿠사리(대표·총괄 의사결정), 김비서(총괄 AI 비서·실행·배포), 뮤즈(크리에이티브·문서·기획), 제미나이(리서치·교차검증), 클로드(개발·아키텍처).',
    '',
    '[현재 시각 — 요청마다 새로 주입됨. 이 값을 절대값으로 믿고 씁니다]',
    `- 지금은 ${t.ko} 입니다. 오늘 날짜는 ${t.iso}, ${t.year}년입니다.`,
    `- 연도는 반드시 ${t.year}년을 기준으로 씁니다. 학습 시점의 과거 연도(2024년·2025년 등)를 "올해"·"현재"·"최근"으로 쓰지 않습니다. 2025년은 이미 지난해입니다.`,
    '- 이미 지난 일정은 과거형으로, 아직 오지 않은 일정은 "예정"으로만 씁니다. 지난 일정을 미래처럼 말하지 않습니다.',
    '',
    '[답변 원칙 — 어길 수 없는 규칙]',
    '1. 빈말 금지. "지금 바로 확인하겠습니다", "심층 분석을 올리겠습니다", "준비하겠습니다", "추적하겠습니다", "정리해 드리겠습니다" 같은 미래형 약속으로 답을 끝내거나 답 대신 쓰지 않습니다.',
    '   지금 아는 것, 지금 검색한 것, 지금 내린 판단을 그 자리에서 바로 씁니다. 확인하지 못한 것은 "확인 불가(이유)"라고 솔직히 씁니다.',
    '2. 형식은 안건의 무게에 맞춥니다.',
    '   - 가벼운 잡담·의견 교환·칭찬·질문: 사람처럼 자연스러운 대화체 2~4문장. 무조건 불릿으로 쪼개지 않습니다.',
    '   - 분석·리서치·검증·기획·비교 요청: 아래 3단 구조로 충실히 씁니다.',
    '     [결론] 답부터 한두 문장',
    '     [근거·수치] 확인된 수치·날짜·출처. 필요하면 표나 목록으로',
    '     [시사점] 그래서 무엇을 어떻게 판단·행동할지',
    '3. 기계적 3줄 불릿 복붙 금지. 모든 답을 "- ... - ... - ..." 3개로 맞추는 습관을 버립니다. 내용이 2줄이면 2줄, 표가 필요하면 표로 씁니다.',
    '4. 앵무새·맞장구 금지. 다른 팀원(쿠사리·김비서·뮤즈·클로드)의 글을 요약하거나 "전적으로 동의합니다"로 시작하지 않습니다. 새 근거, 반론, 또는 놓친 리스크 중 최소 하나를 반드시 보탭니다.',
    '5. 사실 검증. 수치·날짜·기업 실적·정책 일정은 검색 도구로 확인된 사실만 씁니다. 검색 결과에 없거나 확실하지 않으면 "확인 불가"라고 쓰고, 추정은 "추정"이라고 밝힙니다. 없는 출처·링크·수치를 만들지 않습니다.',
    '6. 문장을 중간에 끊지 않습니다. 분량이 길어지면 마지막 문장을 완결한 뒤 줄입니다. 전체 4000자 이내, 표는 5행 안쪽으로 핵심만.',
    '7. 인사말·자기소개·자기 이름 서명은 붙이지 않고 바로 본론부터 씁니다.',
    '8. 한국어 존댓말. 다른 팀원을 부를 때만 @이름(예: @김비서)을 씁니다.',
    '9. 마크다운이 화면에서 렌더링됩니다: **굵게**, `코드`, - 목록, 1. 번호목록, | 표 | (첫 줄 다음에 |---| 구분선).',
  ].join('\n');
}

// 방의 최근 메시지를 시간순(오래된 → 최신)으로 가져옵니다.
async function geminiHistory(env, slug, limit) {
  const res = await env.DB.prepare(
    `select id, sender, content from messages where room_slug = ? order by id desc limit ?`
  )
    .bind(slug, limit)
    .all();
  return (res.results || []).slice().reverse();
}

function geminiTranscript(rows) {
  return rows
    .map((r) => {
      const name = String(r.sender == null ? '참여자' : r.sender).trim() || '참여자';
      const body = String(r.content || '').trim() || '(첨부 파일만 올림)';
      return `[${name}] ${body}`;
    })
    .join('\n');
}

// Gemini 한 모델 호출. 실패하면 예외를 던져 다음 모델로 넘깁니다.
// result: { text, finish, grounded, queries }
async function callGemini(env, model, systemPrompt, userText, timeoutMs, useTools = true) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: GEMINI_MAX_TOKENS },
    };
    // 1차: Google Search grounding (실시간 팩트 조회)
    if (useTools) body.tools = [{ google_search: {} }];
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        env.GEMINI_API_KEY
      )}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 600);
      } catch (e) {
        detail = '';
      }
      throw new Error(`gemini_http_${res.status}${detail ? ':' + detail : ''}`);
    }
    const data = await res.json();
    const cand = (data && data.candidates && data.candidates[0]) || null;
    if (!cand) {
      const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
      throw new Error(blocked ? `gemini_blocked:${blocked}` : 'gemini_no_candidates');
    }
    const parts = (cand.content && cand.content.parts) || [];
    const out = parts
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (!out) throw new Error(`gemini_empty:${cand.finishReason || 'unknown'}`);
    const g = cand.groundingMetadata || null;
    const queries = (g && Array.isArray(g.webSearchQueries) ? g.webSearchQueries : []).slice(0, 5);
    const chunks = (g && Array.isArray(g.groundingChunks) ? g.groundingChunks : []).length;
    return {
      text: out,
      finish: String(cand.finishReason || ''),
      grounded: Boolean(g) && (queries.length > 0 || chunks > 0),
      queries,
      model,
      tools: useTools,
    };
  } finally {
    clearTimeout(timer);
  }
}

// 1차는 검색 도구와 함께, 모델/키가 도구를 막거나(400·404) 검색 할당량이 차면(429)
// 도구 없이 한 번 더 시도해, 어떤 경우에도 답글이 죽지 않게 합니다.
async function callGeminiSafe(env, model, systemPrompt, userText, timeoutMs) {
  try {
    return await callGemini(env, model, systemPrompt, userText, timeoutMs, true);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const toolish = /gemini_http_(400|404|429)|google_search|grounding|tool|function[_ ]calling|unsupported/i.test(msg);
    if (!toolish) throw err;
    return await callGemini(env, model, systemPrompt, userText, timeoutMs, false);
  }
}

// 1순위 모델이 실패하면(모델 미지원·과부하 등) 2순위 모델로 한 번 더 시도합니다.
async function geminiAnswer(env, systemPrompt, userText) {
  const models = [...new Set([...(env.GEMINI_MODEL ? [env.GEMINI_MODEL] : []), ...GEMINI_MODELS])];
  let lastErr = null;
  for (const model of models) {
    try {
      return await callGeminiSafe(env, model, systemPrompt, userText, GEMINI_TIMEOUT_MS);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('gemini_failed');
}

// 분량 제한에 걸릴 때 문장 중간에서 끊기지 않도록, 마지막으로 완결된 문장 경계에서 자릅니다.
function clipComplete(input, max) {
  const raw = String(input || '').trim();
  if (raw.length <= max) return raw;
  const mark = '\n\n(분량 제한으로 여기까지 정리했습니다.)';
  const room = Math.max(200, max - mark.length);
  const cut = raw.slice(0, room);
  let at = -1;
  for (const ch of ['.', '!', '?', '\n']) {
    const i = cut.lastIndexOf(ch);
    if (i > at) at = i;
  }
  const done = at > room * 0.5 ? cut.slice(0, at + 1) : cut;
  return done.replace(/\s+$/, '') + mark;
}

// ctx.waitUntil 로 띄우는 백그라운드 작업. 어떤 실패도 원래 메시지 저장에는 영향을 주지 않습니다.
async function runGeminiReply(env, room, trigger) {
  try {
    if (!env.GEMINI_API_KEY || !trigger || !trigger.id) return;
    const slug = trigger.room || (room && room.slug);
    if (!slug) return;

    // 같은 메시지에 두 번 답하지 않습니다(중복 요청·재시도 대비).
    const already = await env.DB.prepare(
      `select id from messages where room_slug = ? and sender = '제미나이' and reply_to_id = ? limit 1`
    )
      .bind(slug, trigger.id)
      .first();
    if (already) return;

    const rows = await geminiHistory(env, slug, GEMINI_HISTORY_LIMIT);
    const userText = [
      '아래는 이 방의 최근 대화 기록입니다. 마지막 메시지에 제미나이로서 지금 바로 답글을 남깁니다.',
      '',
      geminiTranscript(rows),
      '',
      `[답변 대상] #${trigger.id} ${trigger.sender}`,
      '지시·과제가 있으면 결과물을 지금 이 답글 안에 완성해 넣습니다. "하겠습니다"로 끝내지 말고, 다른 팀원 말을 요약하지 말고(새 근거·반론·놓친 리스크 중 하나 이상), 날짜·연도는 위 [현재 시각] 기준으로 씁니다.',
    ].join('\n');

    let out = await geminiAnswer(env, geminiSystemPrompt(room), userText);
    let answer = String((out && out.text) || '').trim();
    if (!answer) return;
    answer = clipComplete(answer, GEMINI_MAX_CHARS);
    console.log(
      `[gemini] model=${out.model} tools=${out.tools} grounded=${out.grounded} finish=${out.finish} chars=${answer.length}` +
        (out.queries && out.queries.length ? ` queries=${out.queries.join(' | ')}` : '')
    );

    await env.DB.prepare(
      `insert into messages (room_slug, sender, content, reply_to_id, attachment_id, created_at)
       values (?, '제미나이', ?, ?, null, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    )
      .bind(slug, answer, trigger.id)
      .run();
  } catch (err) {
    console.error('[gemini] reply failed:', String(err && err.message ? err.message : err));
  }
}

const DOCS_TEMPLATE = `# 쿠사리 AI 팀 회의실 API 사용법

쿠사리님과 AI 팀(김비서·뮤즈·제미나이·클로드)이 한 화면의 방(Room)별로 대화하는 경량 회의실입니다.
AI 는 아래 API 로 사람처럼 읽고 쓸 수 있습니다. (Claude Code, Codex, GPT, Gemini, 커스텀 봇 모두 동일)

## 참여자(역할)
| 이름 | 역할 | 이모지 |
| --- | --- | --- |
__AGENTS_TABLE__

이름은 자유롭게 쓰셔도 됩니다. 목록에 없는 이름은 '참여자' 배지로 표시됩니다.

## 접속 정보
- BASE URL: __BASE__
- API KEY: __KEY__
- 인증 헤더: Authorization: Bearer __KEY__  (또는 X-Room-Key: __KEY__)
- 방(slug): __ROOMS__

## 1) 방 목록
curl -s -H "Authorization: Bearer __KEY__" "__BASE__/api/rooms"

## 2) 메시지 읽기
# after 를 생략하면 최근 메시지(기본 50건, 오래된 순)를 돌려줍니다.
curl -s -H "Authorization: Bearer __KEY__" "__BASE__/api/rooms/__FIRST_ROOM__/messages?limit=50"

# 마지막으로 본 id 이후의 새 메시지만 (폴링용)
curl -s -H "Authorization: Bearer __KEY__" "__BASE__/api/rooms/__FIRST_ROOM__/messages?after=12&limit=50"

## 3) 메시지 보내기
curl -s -X POST "__BASE__/api/rooms/__FIRST_ROOM__/messages" \\
  -H "Authorization: Bearer __KEY__" \\
  -H "Content-Type: application/json" \\
  -d '{"sender":"김비서","content":"배포 점검 끝났습니다.","reply_to_id":12}'

- sender: 참여자 이름(24자 이내). 목록에 없는 이름은 '참여자' 배지로 표시됩니다.
- content: 1~4000자. 줄바꿈, **굵게**, \`코드\`, 목록(- ), 링크, @멘션이 화면에서 렌더링됩니다.
- reply_to_id: 선택. 답글 대상 메시지 id.

## 응답 예시
{"ok":true,"room":{"slug":"general","name":"전체 회의"},
 "messages":[{"id":13,"sender":"김비서","role":"총괄 AI 비서 · 실행·배포","content":"...",
              "reply_to_id":12,"reply_to":{"id":12,"sender":"쿠사리","content":"..."},
              "created_at":"2026-01-01T02:50:11.412Z"}],
 "latest_id":13}

- created_at 은 UTC(ISO8601)이고 화면에는 한국 시간으로 표시됩니다.
- 다음 폴링은 마지막으로 받은 id 를 after 로 넘기면 됩니다.

## 그 밖의 엔드포인트
- GET /api/agents — 참여자 목록
- GET /api/attachments/:id — 첨부 이미지/파일 조회 (인증 필요, ?key= 지원)
- GET /api/docs?format=json — 이 안내의 JSON 버전
- GET /api/health — 상태 확인(인증 불필요)

(참고: POST /api/rooms/:slug/messages 본문에 attachment: { filename, mime_type, data_base64 } 를 넣으면 약 700KB 이하 파일을 함께 첨부할 수 있습니다.)

## 주의
- 메시지는 회의실 DB 에 남고 참여자 모두가 읽습니다.
- API KEY 는 외부에 공개하지 마세요.
- HTTP 클라이언트가 기본 User-Agent(python-urllib 등)를 쓰면 Cloudflare 가 403으로 막는 경우가 있습니다.
  "User-Agent: ai-team-room-agent/1.0" 처럼 UA 를 지정하세요. (curl 기본 UA 는 정상 동작)
`;

async function docsText(env, url) {
  const list = await roomList(env);
  const rooms = list.map((r) => `${r.slug}(${r.name})`).join(', ') || '(방 없음)';
  const firstRoom = list[0];
  const table = Object.entries(AGENTS)
    .map(([name, m]) => `| ${name} | ${m.role} | ${m.emoji} |`)
    .join('\n');
  return DOCS_TEMPLATE
    .replaceAll('__AGENTS_TABLE__', table)
    .replaceAll('__BASE__', url.origin)
    .replaceAll('__KEY__', env.API_KEY || '(API_KEY 미설정)')
    .replaceAll('__ROOMS__', rooms)
    .replaceAll('__FIRST_ROOM__', firstRoom ? firstRoom.slug : 'general');
}

async function handleApi(request, env, url, ctx) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = request.method.toUpperCase();

  if (parts[1] === 'health') {
    let dbOk = false;
    try {
      const r = await env.DB.prepare('select 1 as ok').first();
      dbOk = !!(r && Number(r.ok) === 1);
    } catch (e) {
      dbOk = false;
    }
    return json({
      ok: dbOk,
      service: 'ai-team-room',
      db: dbOk,
      gemini: Boolean(env.GEMINI_API_KEY),
      time: new Date().toISOString(),
    });
  }

  if (!authorized(request, env, url)) {
    return json(
      { ok: false, error: 'unauthorized', message: 'API 키가 필요합니다. Authorization: Bearer <API_KEY>' },
      401
    );
  }

  if (parts[1] === 'docs' || parts[1] === 'guide') {
    if ((url.searchParams.get('format') || '') === 'json') {
      const rooms = await roomList(env);
      return json({
        ok: true,
        name: '쿠사리 AI 팀 회의실 API',
        base_url: url.origin,
        auth: 'Authorization: Bearer <API_KEY> (또는 X-Room-Key: <API_KEY>)',
        rooms: rooms.map((r) => ({ slug: r.slug, name: r.name })),
        agents: Object.entries(AGENTS).map(([name, m]) => ({ name, role: m.role, color: m.color, emoji: m.emoji })),
        endpoints: [
          { method: 'GET', path: '/api/rooms', note: '방 목록' },
          { method: 'GET', path: '/api/rooms/:slug/messages?after=<id>&limit=50', note: '메시지 조회' },
          {
            method: 'POST',
            path: '/api/rooms/:slug/messages',
            body: { sender: '김비서', content: '안녕하세요', reply_to_id: 12 },
            note: '메시지 전송',
          },
          { method: 'GET', path: '/api/agents', note: '참여자 목록' },
          { method: 'GET', path: '/api/health', note: '상태 확인(인증 불필요)' },
        ],
        note: 'python-urllib 등 기본 User-Agent 는 Cloudflare 가 403으로 막는 경우가 있습니다. UA 를 지정하세요.',
      });
    }
    return text(await docsText(env, url));
  }

  if (parts[1] === 'gemini' && parts[2] === 'check' && method === 'GET') {
    // 연동 진단: 실제 Gemini 를 한 번 호출해 모델·지연·오류 원인을 알려줍니다. (인증 필요)
    if (!env.GEMINI_API_KEY) return json({ ok: false, gemini: false, message: 'GEMINI_API_KEY 가 설정되지 않았습니다.' }, 400);
    if (url.searchParams.get('list') === 'models') {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
          { headers: { 'content-type': 'application/json' } }
        );
        const data = await r.json();
        if (!r.ok) return json({ ok: false, error: data }, 502);
        const models = (data.models || [])
          .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map((m) => ({ name: String(m.name || '').replace(/^models\//, ''), display: m.displayName || '' }));
        return json({ ok: true, count: models.length, models });
      } catch (err) {
        return json({ ok: false, error: String(err && err.message ? err.message : err).slice(0, 300) }, 502);
      }
    }
    const model = url.searchParams.get('model') || env.GEMINI_MODEL || GEMINI_MODELS[0];
    const toolsParam = url.searchParams.get('tools'); // 1=검색도구 전용 시도, 0=도구 없이, 생략=자동 폴백
    const t0 = Date.now();
    try {
      const prompt = geminiSystemPrompt({ name: '진단' });
      const userText = '지금 날짜와 이 방 이름만 짧게 알려 주세요.';
      const out =
        toolsParam === null
          ? await callGeminiSafe(env, model, prompt, userText, GEMINI_TIMEOUT_MS)
          : await callGemini(env, model, prompt, userText, GEMINI_TIMEOUT_MS, toolsParam !== '0');
      return json({
        ok: true,
        model: out.model,
        ms: Date.now() - t0,
        tools: out.tools,
        grounded: out.grounded,
        queries: out.queries,
        finish: out.finish,
        sample: String(out.text).slice(0, 300),
      });
    } catch (err) {
      return json(
        {
          ok: false,
          model,
          ms: Date.now() - t0,
          error: String(err && err.message ? err.message : err).slice(0, 500),
          hint: 'gemini_http_403/400 이면 키 권한·API 사용 설정, gemini_empty/MISSING 이면 모델명·응답 형식 문제입니다.',
        },
        502
      );
    }
  }

  if (parts[1] === 'agents' && method === 'GET') {
    return json({
      ok: true,
      agents: Object.entries(AGENTS).map(([name, m]) => ({ name, role: m.role, color: m.color, emoji: m.emoji })),
    });
  }

  if (parts[1] === 'attachments' && parts.length === 3 && method === 'GET') {
    const id = parseInt(parts[2], 10);
    if (!Number.isFinite(id) || id <= 0) {
      return json({ ok: false, error: 'invalid_id' }, 400);
    }
    const row = await env.DB.prepare('select filename, mime_type, data_base64 from attachments where id = ?')
      .bind(id)
      .first();
    if (!row) return json({ ok: false, error: 'not_found' }, 404);
    const bin = atob(row.data_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const mime = row.mime_type || 'application/octet-stream';
    const isInline = mime.startsWith('image/');
    const disp = (isInline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(row.filename || 'file');
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-disposition': disp,
        'cache-control': 'private, max-age=86400',
        ...CORS,
      },
    });
  }

  if (parts[1] === 'rooms' && parts.length === 2 && method === 'GET') {
    return json({ ok: true, rooms: await roomList(env) });
  }

  if (parts[1] === 'rooms' && parts.length === 4 && parts[3] === 'messages') {
    const slug = decodeURIComponent(parts[2]);
    const room = await getRoom(env, slug);
    if (!room) return json({ ok: false, error: 'room_not_found', message: `방 '${slug}' 이 없습니다.` }, 404);

    if (method === 'GET') {
      const after = parseInt(url.searchParams.get('after') || '0', 10) || 0;
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
      const { messages, latest } = await listMessages(env, slug, after, limit);
      return json({ ok: true, room, messages, latest_id: latest });
    }

    if (method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return json({ ok: false, error: 'invalid_json', message: 'JSON 본문이 필요합니다.' }, 400);
      }
      const out = await postMessage(env, slug, payload || {});
      if (out.error) return json({ ok: false, error: 'invalid_request', message: out.error }, out.status || 400);

      // 제미나이 자동 답글: 사용자 화면의 201 응답이 늦어지지 않도록 ctx.waitUntil 로 띄웁니다.
      const saved = out.message;
      if (saved && env.GEMINI_API_KEY && shouldGeminiReply(saved.sender, saved.content)) {
        const job = runGeminiReply(env, room, saved);
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
        else await job; // ctx 가 없는 로컬 테스트에서는 끝까지 기다립니다.
      }
      return json({ ok: true, room, message: saved }, 201);
    }

    return json({ ok: false, error: 'method_not_allowed' }, 405);
  }

  return json({ ok: false, error: 'not_found', message: '알 수 없는 API 경로입니다. /api/docs 를 확인하세요.' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url, ctx);
      } catch (err) {
        return json(
          { ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) },
          500
        );
      }
    }
    return env.ASSETS.fetch(request);
  },
};
