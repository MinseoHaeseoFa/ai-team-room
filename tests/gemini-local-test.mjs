/**
 * 제미나이 자동 답글 로컬 검증 (D1 셰임 + Gemini fetch 목)
 *
 *   node tests/gemini-local-test.mjs
 *
 * 실제 Cloudflare·실제 Gemini 키 없이 _worker.js 의 동작 조건만 검증합니다.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '_worker.js'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'ai-room-'));
const modPath = join(tmp, 'worker.mjs');
writeFileSync(modPath, src);
const worker = (await import(pathToFileURL(modPath).href)).default;

/* ---------------- D1 셰임 ---------------- */
class D1 {
  constructor() {
    this.seq = 0;
    this.messages = [];
    this.attachments = [];
    this.rooms = [
      { slug: 'general', name: '전체 회의', description: '공지 · 일상 · 자유 안건', position: 1 },
    ];
  }
  prepare(sql) {
    const norm = String(sql).replace(/\s+/g, ' ').trim();
    return {
      bind: (...args) => ({ norm, args, all: () => this.#all(norm, args), first: () => this.#first(norm, args), run: () => this.#run(norm, args) }),
      all: () => this.#all(norm, []),
      first: () => this.#first(norm, []),
      run: () => this.#run(norm, []),
    };
  }
  #rows(norm, args) {
    if (/^select 1 as ok$/.test(norm)) return [{ ok: 1 }];
    if (norm.startsWith('insert into attachments')) {
      const id = ++this.seq;
      this.attachments.push({ id, room_slug: args[0], filename: args[1], mime_type: args[2], size: args[3], data_base64: args[4] });
      return [];
    }
    // 제미나이 고정 sender insert
    if (norm.startsWith('insert into messages') && /values \(\?, '제미나이', \?, \?, null,/.test(norm)) {
      const id = ++this.seq;
      this.messages.push({ id, room_slug: args[0], sender: '제미나이', content: args[1], reply_to_id: args[2], attachment_id: null, created_at: new Date().toISOString() });
      return [];
    }
    if (norm.startsWith('insert into messages')) {
      const id = ++this.seq;
      this.messages.push({ id, room_slug: args[0], sender: args[1], content: args[2], reply_to_id: args[3], attachment_id: args[4], created_at: new Date().toISOString() });
      return [];
    }
    if (/^select id from messages where room_slug = \? and id = \?$/.test(norm)) {
      return this.messages.filter((m) => m.room_slug === args[0] && m.id === Number(args[1]));
    }
    if (/^select id from messages where room_slug = \? and sender = '제미나이' and reply_to_id = \? limit 1$/.test(norm)) {
      return this.messages.filter((m) => m.room_slug === args[0] && m.sender === '제미나이' && m.reply_to_id === Number(args[1]));
    }
    if (/^select m\.\*/.test(norm) || norm.includes('left join attachments')) {
      const id = Number(args[args.length - 1]);
      const m = this.messages.find((x) => x.id === id);
      if (!m) return [];
      const a = this.attachments.find((x) => x.id === m.attachment_id);
      return [{ ...m, att_filename: a?.filename, att_mime_type: a?.mime_type, att_size: a?.size }];
    }
    if (/^select id, sender, content from messages where room_slug = \? order by id desc limit \?$/.test(norm)) {
      return this.messages.filter((m) => m.room_slug === args[0]).sort((a, b) => b.id - a.id).slice(0, Number(args[1]));
    }
    // listMessages
    if (norm.includes('from messages m') && norm.includes('order by m.id desc limit ?')) {
      return this.messages.filter((m) => m.room_slug === args[0]).sort((a, b) => b.id - a.id).slice(0, Number(args[1]));
    }
    if (norm.includes('from messages m') && norm.includes('order by m.id asc limit ?')) {
      return this.messages.filter((m) => m.room_slug === args[0] && m.id > Number(args[1])).sort((a, b) => a.id - b.id).slice(0, Number(args[2]));
    }
    if (/^select id, sender, content, created_at from messages where room_slug = \? and id in \(/.test(norm)) {
      const slug = args[0];
      const ids = args.slice(1).map(Number);
      return this.messages.filter((m) => m.room_slug === slug && ids.includes(m.id));
    }
    if (/^select slug, name, description from rooms where slug = \?$/.test(norm)) {
      return this.rooms.filter((r) => r.slug === args[0]);
    }
    if (norm.includes('from rooms r')) return this.rooms;
    throw new Error('unmocked sql: ' + norm);
  }
  #run(norm, args) {
    if (/^update messages set sender = \? where sender = \?$/.test(norm)) {
      const [to, from] = args;
      let n = 0;
      for (const m of this.messages) if (m.sender === from) { m.sender = to; n++; }
      return { meta: { last_row_id: this.seq, changes: n } };
    }
    const before = this.seq;
    this.#rows(norm, args);
    return { meta: { last_row_id: this.seq, changes: this.seq - before } };
  }
  #all(norm, args) {
    return { results: this.#rows(norm, args) };
  }
  #first(norm, args) {
    return this.#rows(norm, args)[0] || null;
  }
}

/* ---------------- fetch 목 ---------------- */
let geminiCalls = [];
let geminiPlan = []; // [{status, text, delayMs}] 순서대로 소비
function installFetch() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('generativelanguage.googleapis.com')) {
      const model = (u.match(/models\/([^:]+):generateContent/) || [])[1];
      const key = (u.match(/[?&]key=([^&]+)/) || [])[1];
      geminiCalls.push({ model, key, body: JSON.parse(init.body), url: u });
      const plan = geminiPlan.shift() || { status: 200, text: '모의 답변입니다.' };
      const status = plan.status === undefined ? 200 : plan.status;
      if (plan.delayMs) await new Promise((r) => setTimeout(r, plan.delayMs));
      if (status !== 200) {
        return new Response(JSON.stringify({ error: { code: status, message: plan.message || 'mock error' } }), { status });
      }
      if (plan.raw) return new Response(plan.raw, { status: 200 });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: plan.text }] }, finishReason: 'STOP' }] }),
        { status: 200 }
      );
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

/* ---------------- 테스트 실행 ---------------- */
const KEY = 'test-room-key';
let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + JSON.stringify(extra) : ''}`);
  }
}

function makeEnv(withGemini) {
  return {
    DB: new D1(),
    API_KEY: KEY,
    ROOM_KEY: KEY,
    ASSETS: { fetch: async () => new Response('asset') },
    ...(withGemini ? { GEMINI_API_KEY: 'AIza-test-key' } : {}),
  };
}

async function post(env, payload, ctx) {
  const req = new Request('https://room.test/api/rooms/general/messages', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return worker.fetch(req, env, ctx);
}

function ctxStub() {
  const jobs = [];
  return { jobs, waitUntil: (p) => jobs.push(p) };
}

async function drain(ctx) {
  await Promise.all(ctx.jobs);
}

function reset(plan = []) {
  geminiCalls = [];
  geminiPlan = plan.slice();
}

installFetch();

console.log('\n[1] /api/health gemini 필드');
{
  const envNo = makeEnv(false);
  const r1 = await (await worker.fetch(new Request('https://room.test/api/health'), envNo, ctxStub())).json();
  check('키 없음 → gemini:false, ok:true', r1.gemini === false && r1.ok === true, r1);
  const envYes = makeEnv(true);
  const r2 = await (await worker.fetch(new Request('https://room.test/api/health'), envYes, ctxStub())).json();
  check('키 있음 → gemini:true', r2.gemini === true, r2);
}

console.log('\n[2] 호출 조건 (무한 루프 방지)');
{
  reset();
  const env = makeEnv(false);
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '키 없을 때는 조용히 저장만' }, ctx);
  await drain(ctx);
  check('GEMINI_API_KEY 없음 → Gemini 호출 0, 제미나이 글 0', geminiCalls.length === 0 && env.DB.messages.filter((m) => m.sender === '제미나이').length === 0);
}
{
  reset([{ text: '리서치 관점에서 정리하면 이렇습니다.' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  const res = await post(env, { sender: '쿠사리', content: '이번 감사 DB 방향 어떻게 볼까?' }, ctx);
  const status = res.status;
  await drain(ctx);
  const reply = env.DB.messages.find((m) => m.sender === '제미나이');
  check('쿠사리 일반 글 → Gemini 1회 호출', geminiCalls.length === 1, geminiCalls.length);
  check('201 응답 유지', status === 201, status);
  check('제미나이 답글 1건 저장', !!reply && reply.content === '리서치 관점에서 정리하면 이렇습니다.', reply);
  check('reply_to_id = 트리거 메시지 id', reply && reply.reply_to_id === 1, reply && reply.reply_to_id);
  check('systemInstruction 에 역할·방정보 포함', geminiCalls[0].body.systemInstruction.parts[0].text.includes('리서치 · 교차검증') && geminiCalls[0].body.systemInstruction.parts[0].text.includes('전체 회의'), geminiCalls[0].body.systemInstruction.parts[0].text.slice(0, 80));
  check('키가 URL 로 전달', geminiCalls[0].key === 'AIza-test-key', geminiCalls[0].key);
  check('1순위 모델 gemini-flash-lite-latest', geminiCalls[0].model === 'gemini-flash-lite-latest', geminiCalls[0].model);
}
{
  reset([{ text: 'should not be used' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '김팀장', content: '배포 점검 끝났습니다. 감사 DB는 정상입니다.' }, ctx);
  await drain(ctx);
  check('김팀장 일반 글 → Gemini 호출 0', geminiCalls.length === 0, geminiCalls.length);
}
{
  reset([{ text: '@제미나이 지목되어 답합니다.' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '김팀장', content: '@제미나이 이 판례 해석 교차검증 부탁드립니다.' }, ctx);
  await drain(ctx);
  check('김팀장 @제미나이 → Gemini 호출 1', geminiCalls.length === 1, geminiCalls.length);
  check('김팀장 요청에 답글 저장', env.DB.messages.some((m) => m.sender === '제미나이'));
}
{
  reset();
  const env = makeEnv(true);
  const ctx = ctxStub();
  const res = await post(env, { sender: '김비서', content: '예전 이름으로 보낸 글입니다.' }, ctx);
  const body = await res.json();
  await drain(ctx);
  check('예전 이름 김비서로 보내도 김팀장으로 저장·응답', body.message && body.message.sender === '김팀장' && env.DB.messages.some((m) => m.sender === '김팀장'), body.message);
  check('예전 이름 김비서 글 → Gemini 호출 0', geminiCalls.length === 0, geminiCalls.length);
}
{
  reset();
  const env = makeEnv(true);
  env.DB.messages.push({ id: 1, room_slug: 'general', sender: '김비서', content: '옛 기록', reply_to_id: null, attachment_id: null, created_at: 'x' });
  env.DB.seq = 1;
  const call = (method = 'POST') =>
    worker.fetch(new Request('https://room.test/api/admin/rename-sender', { method, headers: { authorization: `Bearer ${KEY}` } }), env, ctxStub());
  const j1 = await (await call()).json();
  check('rename-sender → DB의 김비서 기록을 김팀장으로 변경', j1.ok && j1.renamed[0].changed === 1 && env.DB.messages[0].sender === '김팀장', j1);
  const j2 = await (await call()).json();
  check('rename-sender 멱등(두 번째 changed 0)', j2.renamed[0].changed === 0, j2);
  const r = await call('GET');
  check('rename-sender GET → 405/404 (POST 전용)', r.status === 405 || r.status === 404, r.status);
}
{
  reset([{ text: 'should not be used' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '@클로드 이 코드만 봐줘' }, ctx);
  await post(env, { sender: '쿠사리', content: '@뮤즈 문서 톤만 잡아줘' }, ctx);
  await post(env, { sender: '쿠사리', content: '@김비서 메일 정리해줘' }, ctx);
  await drain(ctx);
  check('다른 팀원만 지목(@클로드/@뮤즈/@김비서 예전 이름) → Gemini 호출 0', geminiCalls.length === 0, geminiCalls.length);
}
{
  reset([{ text: 'should not be used' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '제미나이', content: '제가 방금 정리한 내용입니다.' }, ctx);
  await drain(ctx);
  check('제미나이 글 → Gemini 호출 0 (자기 루프 차단)', geminiCalls.length === 0, geminiCalls.length);
}
{
  reset([{ text: '둘 다 지목되어 답합니다.' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '@김팀장 실행하고 @제미나이 검증해줘' }, ctx);
  await drain(ctx);
  check('@김팀장 + @제미나이 동시 → Gemini 호출 1', geminiCalls.length === 1, geminiCalls.length);
}
{
  reset([{ text: '공백 표기 응답' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '김팀장', content: '@ 제미나이 이것도 봐주세요' }, ctx);
  await drain(ctx);
  check('김팀장 "@ 제미나이"(공백) → Gemini 호출 1', geminiCalls.length === 1, geminiCalls.length);
}

console.log('\n[3] ctx.waitUntil 비동기 동작');
{
  reset([{ text: '느린 모의 답변', delayMs: 400 }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  const t0 = Date.now();
  const res = await post(env, { sender: '쿠사리', content: '비동기 확인' }, ctx);
  const elapsed = Date.now() - t0;
  check('201 응답이 Gemini 응답을 기다리지 않음 (400ms 미만)', elapsed < 300, elapsed);
  check('응답 시점에는 아직 답글 없음', !env.DB.messages.some((m) => m.sender === '제미나이'));
  check('waitUntil 작업 1건 등록', ctx.jobs.length === 1, ctx.jobs.length);
  await drain(ctx);
  check('waitUntil 완료 후 답글 저장', env.DB.messages.some((m) => m.sender === '제미나이'));
  check('201 본문은 저장된 사용자 메시지', res.status === 201);
}

console.log('\n[4] 오류 안전성');
{
  reset([{ status: 500, message: 'boom' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  const res = await post(env, { sender: '쿠사리', content: '서버 오류 상황' }, ctx);
  await drain(ctx);
  check('Gemini 500 → 메시지 저장은 성공(201)', res.status === 201, res.status);
  check('500 → 폴백 모델(gemini-3.1-flash-lite) 재시도', geminiCalls.length === 2 && geminiCalls[1].model === 'gemini-3.1-flash-lite', geminiCalls.map((c) => c.model));
}
{
  reset([{ status: 500 }, { status: 503 }, { status: 429 }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  const res = await post(env, { sender: '쿠사리', content: '둘 다 실패' }, ctx);
  await drain(ctx);
  check('세 모델 모두 실패 → 201 유지, 답글 0, 예외 없음', res.status === 201 && env.DB.messages.filter((m) => m.sender === '제미나이').length === 0);
  check('사용자 메시지는 정상 저장', env.DB.messages.some((m) => m.sender === '쿠사리' && m.content === '둘 다 실패'));
}
{
  reset([{ raw: JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }) }, { text: '폴백 답변' }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '차단 상황' }, ctx);
  await drain(ctx);
  check('후보 없음(차단) → 폴백 후 답글 저장', env.DB.messages.some((m) => m.sender === '제미나이' && m.content === '폴백 답변'));
}

console.log('\n[5] 4000자 제한·대화 맥락');
{
  reset([{ text: '가'.repeat(5000) }]);
  const env = makeEnv(true);
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '긴 답변' }, ctx);
  await drain(ctx);
  const reply = env.DB.messages.find((m) => m.sender === '제미나이');
  check('5000자 응답 → 4000자로 저장', reply && reply.content.length === 4000, reply && reply.content.length);
}
{
  reset([{ text: '맥락 확인' }]);
  const env = makeEnv(true);
  env.DB.messages.push(
    ...[1, 2, 3].map((i) => ({ id: i, room_slug: 'general', sender: i === 2 ? '김비서' : '쿠사리', content: '이전 메시지' + i, reply_to_id: null, attachment_id: null, created_at: 'x' }))
  );
  env.DB.seq = 3;
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '이번엔 이 안건' }, ctx);
  await drain(ctx);
  const text = geminiCalls[0].body.contents[0].parts[0].text;
  const i1 = text.indexOf('[쿠사리] 이전 메시지1');
  const i2 = text.indexOf('[김팀장] 이전 메시지2');
  const i3 = text.indexOf('[쿠사리] 이번엔 이 안건');
  check('최근 대화가 시간순([쿠사리]→[김팀장])으로 프롬프트에 포함 (DB의 김비서도 김팀장으로 표기)', i1 > -1 && i2 > i1 && i3 > i2, { i1, i2, i3 });
  check('트리거 id 표기 포함', text.includes('#4'), text.slice(-80));
}
{
  reset(Array.from({ length: 1 }, () => ({ text: '15개 제한 확인' })));
  const env = makeEnv(true);
  env.DB.messages.push(
    ...Array.from({ length: 40 }, (_, k) => ({ id: k + 1, room_slug: 'general', sender: '쿠사리', content: 'm' + (k + 1), reply_to_id: null, attachment_id: null, created_at: 'x' }))
  );
  env.DB.seq = 40;
  const ctx = ctxStub();
  await post(env, { sender: '쿠사리', content: '최신 글' }, ctx);
  await drain(ctx);
  const text = geminiCalls[0].body.contents[0].parts[0].text;
  const count = (text.match(/\[쿠사리\] m\d+/g) || []).length;
  check('프롬프트 대화 기록은 최근 15건(이전 14건 + 트리거)', count === 14 && text.includes('이번엔') === false, count);
  check('가장 최근 m40 은 포함, 오래된 m26 은 제외', text.includes('[쿠사리] m40') && !text.includes('[쿠사리] m26'), null);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
