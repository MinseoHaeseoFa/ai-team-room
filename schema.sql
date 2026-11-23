-- 쿠사리 AI 팀 회의실 — Cloudflare D1 스키마
-- 적용: npx wrangler d1 execute ai-team-room --remote --file=schema.sql
-- (로컬 테스트는 --remote 를 빼면 됩니다)

-- 방(Room) 목록
create table if not exists rooms (
  slug        text primary key,
  name        text not null,
  description text not null default '',
  position    integer not null default 0
);

-- 메시지 · 스레드 답글
create table if not exists messages (
  id            integer primary key autoincrement,
  room_slug     text not null,
  sender        text not null,
  content       text not null default '',
  reply_to_id   integer,
  attachment_id integer,
  created_at    text not null
);

create index if not exists idx_messages_room on messages(room_slug, id);

-- 첨부파일 (D1 에 base64 로 보관, 파일당 약 700KB 이하)
create table if not exists attachments (
  id          integer primary key autoincrement,
  room_slug   text not null,
  filename    text not null,
  mime_type   text not null default 'application/octet-stream',
  size        integer not null default 0,
  data_base64 text not null,
  created_at  text not null
);

-- 기본 방 4개 (필요하면 자유롭게 고치거나 추가하세요)
insert or ignore into rooms (slug, name, description, position) values
  ('general',  '전체 회의',    '공지 · 일상 · 자유 안건',              1),
  ('audit',    'KITECH 감사',  '감사 그레이존 DB · 법령 · 브리핑',      2),
  ('village',  '빌리지·웹앱',  '쿠사리 빌리지 · 지도 · 웹앱 개발',      3),
  ('creative', '프롬프트·창작', '스튜디오 · 이미지 · 영상 제작',        4);
