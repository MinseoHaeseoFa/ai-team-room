/**
 * 3D 오피스 — 김팀장 중앙 총괄석
 * 작은 3D 미니어처 사무실을 three.js 로 그립니다.
 *
 *   [비서실 현황판]  ｜  비서실 존 ｜ **김팀장(중앙 총괄석)** ｜ 폴리코드팀 존 ｜  [폴리코드팀 현황판]
 *                                   (앞쪽·아래)  회의공간 · 휴게공간
 *
 * 이 파일은 '그리는 일' 만 합니다. 회의실 데이터·상태 판단은 office.js 가 하고,
 * applyData() 로 상태(작업 중/대기)와 두 현황판 내용을 받아 화면에 반영합니다.
 */

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

/* ------------------------------------------------------------------ */
/* 설정                                                                */
/* ------------------------------------------------------------------ */

const ROOM = { w: 21, d: 15.5, h: 3.4 }; // 방 크기 (x, z, 높이)

// 사람 명부. key 는 office.js 와 주고받는 식별자입니다.
// 김팀장은 비서실 존(왼쪽)과 폴리코드팀 존(오른쪽) 사이, 가운데 총괄석에 앉습니다.
const PEOPLE = [
  {
    key: 'kim', name: '김팀장', emoji: '🌸', color: '#ff6b9d', hair: '#2f2733',
    lead: true, desk: { x: 0, z: -5.9, rotY: 0 },
    badge: 'ㄱ',       // 총괄 배지 (빨간 ㄱ)
    tag: '중앙 총괄',  // 이름표 아랫줄
  },
  { key: 'kkobung', name: '꼬붕이', emoji: '🐣', color: '#f6b45c', hair: '#3b2f24', screen: 'cool', tag: '@iseohaeseopa2', desk: { x: -7.7, z: -4.9, rotY: 0.2 } },
  { key: 'muse', name: '뮤즈', emoji: '🎨', color: '#a78bfa', hair: '#2b2a3a', screen: 'violet', desk: { x: 4.9, z: -4.9, rotY: -0.2 } },
  { key: 'gemini', name: '제미나이', emoji: '💎', color: '#6fc3ff', hair: '#25313f', screen: 'cool', desk: { x: 7.7, z: -4.9, rotY: -0.2 } },
  { key: 'claude', name: '클로드', emoji: '🧠', color: '#5ed6a8', hair: '#26302c', tag: '채용 중', desk: { x: 9.2, z: -3.1, rotY: -0.6 }, empty: true },
];

const SLOT = { x: -4.9, z: -4.9, rotY: 0.2 };   // 신규 피클 합류 슬롯 (비서실 존 · 꼬붕이 옆)
const PHONE = { x: 0.62, z: -0.02 };            // 김팀장 책상 오른쪽의 회의 전화
const BOARD_X = 6.3;                            // 두 현황판의 좌우 위치
const CONSOLE_Z = -ROOM.d / 2 + 0.34;
const MEET = { x: -3.9, z: 3.2 };               // 공용 회의공간
const LOUNGE = { x: 4.1, z: 3.3 };              // 휴게공간

const STATUS_COLOR = {
  active: '#3ecf7e',
  recent: '#f5b73d',
  idle: '#b9c2cf',
  hiring: '#f5b73d',
  planned: '#cfd6e1',
};

/* ------------------------------------------------------------------ */
/* 작은 도우미들                                                        */
/* ------------------------------------------------------------------ */

function stdMat(color, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: roughness === undefined ? 0.86 : roughness,
    metalness: metalness === undefined ? 0 : metalness,
  });
}

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function addBox(parent, w, h, d, material, x, y, z, cast) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast !== false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function addCyl(parent, rt, rb, h, material, x, y, z, seg) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 18), material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

function addSphere(parent, r, material, x, y, z, seg) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg || 20, (seg || 20) / 2), material);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* 텍스트를 글자 단위로 줄바꿈 (한글 대응) */
function wrapChars(ctx, text, maxWidth, maxLines) {
  const chars = Array.from(String(text || '').replace(/\s+/g, ' '));
  const lines = [];
  let line = '';
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = chars[i];
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  const joined = lines.join('');
  const truncated = Array.from(String(text || '').replace(/\s+/g, ' ')).length > Array.from(joined).length;
  if (truncated && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* 텍스처 만들기                                                       */
/* ------------------------------------------------------------------ */

function woodFloorTexture() {
  const c = canvas2d(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d3ac82';
  ctx.fillRect(0, 0, 512, 512);
  const rows = 8, rh = 512 / rows;
  const tones = ['#d8b389', '#d0a87d', '#dcb992', '#cda275', '#d6b087', '#d1aa80', '#dbb68e', '#cfa77c'];
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = tones[r % tones.length];
    ctx.fillRect(0, r * rh, 512, rh);
    // 나뭇결
    for (let g = 0; g < 26; g++) {
      ctx.strokeStyle = 'rgba(120,84,52,' + (0.03 + Math.random() * 0.05).toFixed(3) + ')';
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      const y = r * rh + Math.random() * rh;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(140, y + (Math.random() - 0.5) * 5, 320, y + (Math.random() - 0.5) * 5, 512, y);
      ctx.stroke();
    }
    // 이음매
    ctx.strokeStyle = 'rgba(96,66,40,.28)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, r * rh + 0.5); ctx.lineTo(512, r * rh + 0.5); ctx.stroke();
    const seam = ((r % 2) * 0.5 + 0.18) * 512;
    ctx.beginPath(); ctx.moveTo(seam, r * rh); ctx.lineTo(seam, (r + 1) * rh); ctx.stroke();
  }
  const t = canvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4.4, 3.2);
  return t;
}

function rugTexture(base, border, accent) {
  const c = canvas2d(512, 384);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 384);
  ctx.strokeStyle = border;
  ctx.lineWidth = 12;
  roundRect(ctx, 16, 16, 480, 352, 26);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  roundRect(ctx, 34, 34, 444, 316, 18);
  ctx.stroke();
  // 잔결
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#7a5b45';
  for (let i = 0; i < 90; i++) {
    ctx.beginPath();
    const x = Math.random() * 512, y = Math.random() * 384;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 26, y + (Math.random() - 0.5) * 26);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvasTexture(c);
}

/* 동그란 러그 (회의·휴게·총괄석) */
function roundRugTexture(base, ring, ring2) {
  const c = canvas2d(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  ctx.beginPath(); ctx.arc(256, 256, 250, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(256, 256, 214, 0, Math.PI * 2); ctx.stroke();
  if (ring2) {
    ctx.strokeStyle = ring2;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 256, 186, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#6b5747';
  for (let i = 0; i < 240; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 250;
    ctx.fillRect(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 3, 3);
  }
  ctx.globalAlpha = 1;
  return canvasTexture(c);
}

function screenTexture(variant) {
  const c = canvas2d(256, 160);
  const ctx = c.getContext('2d');
  const bg = variant === 'dark' ? '#12161f' : '#171c26';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 160);
  // 창 상단 바
  ctx.fillStyle = variant === 'empty' ? '#242a35' : '#232a36';
  ctx.fillRect(0, 0, 256, 16);
  const dots = ['#ff6058', '#ffbd2e', '#28c840'];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = dots[i];
    ctx.beginPath(); ctx.arc(10 + i * 11, 8, 3.2, 0, Math.PI * 2); ctx.fill();
  }
  if (variant === 'empty') {
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    roundRect(ctx, 52, 52, 152, 62, 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.font = 'bold 20px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('채용 중', 128, 90);
  } else {
    const color = variant === 'warm' ? '#ffb4c8' : variant === 'violet' ? '#c4b5fd' : '#8fd3ff';
    const lines = [0.62, 0.4, 0.78, 0.5, 0.68, 0.34, 0.56];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 2 ? color : 'rgba(214,226,240,.5)';
      const w = 40 + lines[i] * 130;
      ctx.fillRect(18 + (i % 3) * 8, 34 + i * 17, w, 6);
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.fillRect(150, 100, 78, 44);
    ctx.globalAlpha = 1;
  }
  return canvasTexture(c);
}

function nameLabelTexture(name, emoji, sub) {
  const H = sub ? 118 : 96;
  const c = canvas2d(340, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 340, H);
  ctx.fillStyle = 'rgba(255,253,247,.94)';
  roundRect(ctx, 8, 8, 324, H - 16, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,96,74,.28)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#2f2a24';
  ctx.font = 'bold 38px "Malgun Gothic","Noto Sans KR",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji + ' ' + name, 170, sub ? H / 2 - 16 : H / 2 + 2);
  if (sub) {
    ctx.fillStyle = '#8b7663';
    ctx.font = '23px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText(sub, 170, H / 2 + 22);
  }
  return canvasTexture(c);
}

/* 공간 이름표 (회의공간 · 휴게공간 · 신규 자리) */
function pillTexture(text, bg, fg) {
  const c = canvas2d(512, 128);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = bg;
  roundRect(ctx, 6, 10, 500, 108, 54);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = 'bold 46px "Malgun Gothic","Noto Sans KR",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);
  return canvasTexture(c);
}

/* 대표 비서실장 배지 — 빨간 바탕에 흰 ㄱ */
function badgeTexture() {
  const c = canvas2d(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#e8455f');
  grad.addColorStop(1, '#b3162f');
  ctx.fillStyle = grad;
  roundRect(ctx, 10, 10, 236, 236, 54);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 150px "Malgun Gothic","Noto Sans KR",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ㄱ', 128, 138);
  return canvasTexture(c);
}

/* ------------------------------------------------------------------ */
/* 장면 조립                                                           */
/* ------------------------------------------------------------------ */

export function createOffice(mount, options) {
  const opts = options || {};
  const pickHandler = typeof opts.onPick === 'function' ? opts.onPick : function () {};
  const bubbleLayer = opts.bubbleLayer || document.body;

  const scene = new THREE.Scene();
  // 배경은 위아래로 부드러운 그라데이션 (모형 촬영 배경처럼)
  const bgCanvas = canvas2d(4, 256);
  const bgCtx = bgCanvas.getContext('2d');
  const bgGrad = bgCtx.createLinearGradient(0, 0, 0, 256);
  bgGrad.addColorStop(0, '#faf2e6');
  bgGrad.addColorStop(0.55, '#f3e6d4');
  bgGrad.addColorStop(1, '#e8d7c0');
  bgCtx.fillStyle = bgGrad;
  bgCtx.fillRect(0, 0, 4, 256);
  scene.background = canvasTexture(bgCanvas);
  scene.fog = new THREE.Fog('#e9d8c2', 40, 95);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 140);
  camera.position.set(0, 11.2, 14.6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.domElement.setAttribute('aria-label', '3D 오피스 — 드래그로 회전, 스크롤로 확대');
  mount.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.7;
  controls.minDistance = 3.2;
  controls.maxDistance = 46;
  controls.minPolarAngle = 0.16;
  controls.maxPolarAngle = Math.PI * 0.487;
  controls.screenSpacePanning = false;
  controls.target.set(0, 0.6, -1.2);

  const picks = [];              // 클릭 가능한 메시들
  const people = {};             // key -> { group, head, armL, armR, ring, label, cfg }
  const boards = {};             // key -> { ctx, tex }
  let clockCtx = null, clockTex = null;
  let phoneRing = null;
  let slotRing = null;
  const clockTime = { text: '' };

  /* ---------- 조명 ---------- */
  const hemi = new THREE.HemisphereLight('#fff7ec', '#d9bb99', 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff1dc', 2.05);
  sun.position.set(7, 14, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 13;
  sun.shadow.camera.bottom = -13;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 46;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.024;
  scene.add(sun);

  const fill = new THREE.DirectionalLight('#dfe9ff', 0.42);
  fill.position.set(-10, 8, -6);
  scene.add(fill);

  const ambient = new THREE.AmbientLight('#fff6ea', 0.22);
  scene.add(ambient);

  /* ---------- 바닥과 벽 ---------- */
  const floorMat = new THREE.MeshStandardMaterial({ map: woodFloorTexture(), roughness: 0.78, metalness: 0.02 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.w, ROOM.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 미니어처 모형처럼 보이도록 바닥 아래 받침대
  const plinth = addBox(scene, ROOM.w + 1.4, 0.55, ROOM.d + 1.4, stdMat('#c9a882', 0.9), 0, -0.28, 0, false);
  plinth.receiveShadow = true;
  addBox(scene, ROOM.w + 1.8, 0.1, ROOM.d + 1.8, stdMat('#b08c63', 0.9), 0, -0.58, 0, false);

  // 모형이 놓인 넓은 작업대 (좁은 화면에서도 빈 공간이 배경처럼 보이게)
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(170, 72),
    new THREE.MeshStandardMaterial({ color: '#ecdfcb', roughness: 0.99, metalness: 0 })
  );
  table.rotation.x = -Math.PI / 2;
  table.position.set(0, -0.66, -1.5);
  table.receiveShadow = true;
  scene.add(table);

  // 벽 (뒤 · 좌 · 우)
  const wallMat = stdMat('#f7eddc', 0.95);
  const baseMat = stdMat('#efe0cb', 0.9);
  const backWall = addBox(scene, ROOM.w + 0.5, ROOM.h, 0.26, wallMat, 0, ROOM.h / 2, -ROOM.d / 2 - 0.1);
  backWall.receiveShadow = true;
  const leftWall = addBox(scene, 0.26, ROOM.h, ROOM.d + 0.4, wallMat, -ROOM.w / 2 - 0.1, ROOM.h / 2, 0);
  const rightWall = addBox(scene, 0.26, ROOM.h, ROOM.d + 0.4, wallMat, ROOM.w / 2 + 0.1, ROOM.h / 2, 0);
  leftWall.receiveShadow = true;
  rightWall.receiveShadow = true;

  // 걸레받이
  addBox(scene, ROOM.w, 0.16, 0.06, baseMat, 0, 0.08, -ROOM.d / 2 + 0.03, false);
  addBox(scene, 0.06, 0.16, ROOM.d, baseMat, -ROOM.w / 2 + 0.03, 0.08, 0, false);
  addBox(scene, 0.06, 0.16, ROOM.d, baseMat, ROOM.w / 2 - 0.03, 0.08, 0, false);

  // 존 러그 (좌: 비서실 / 우: 폴리코드팀)
  const rugA = new THREE.Mesh(
    new THREE.PlaneGeometry(9.4, 6.4),
    new THREE.MeshStandardMaterial({ map: rugTexture('#f7e2d8', '#e9bfae', '#f0cbbd'), roughness: 0.95 })
  );
  rugA.rotation.x = -Math.PI / 2;
  rugA.position.set(-5.6, 0.012, -3.2);
  rugA.receiveShadow = true;
  scene.add(rugA);

  const rugB = new THREE.Mesh(
    new THREE.PlaneGeometry(9.4, 6.4),
    new THREE.MeshStandardMaterial({ map: rugTexture('#dfeee9', '#b3d6cb', '#cae4dc'), roughness: 0.95 })
  );
  rugB.rotation.x = -Math.PI / 2;
  rugB.position.set(5.6, 0.012, -3.2);
  rugB.receiveShadow = true;
  scene.add(rugB);

  // 총괄석 표시 — 가운데 둥근 러그
  const commandRug = new THREE.Mesh(
    new THREE.CircleGeometry(1.64, 56),
    new THREE.MeshStandardMaterial({ map: roundRugTexture('#f8ead2', '#d8b26a', '#c99a4e'), roughness: 0.94 })
  );
  commandRug.rotation.x = -Math.PI / 2;
  commandRug.position.set(0, 0.018, -5.9);
  commandRug.receiveShadow = true;
  scene.add(commandRug);

  /* ---------- 창 (따뜻한 자연광) ---------- */
  function buildWindow(x, z, flip, withLight) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = flip ? -Math.PI / 2 : Math.PI / 2;

    const c = canvas2d(256, 256);
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#fff8e8');
    grad.addColorStop(0.55, '#ffeccd');
    grad.addColorStop(1, '#ffe1b6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#dfeaf5';
    ctx.beginPath(); ctx.arc(184, 66, 40, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 1.9),
      new THREE.MeshBasicMaterial({ map: canvasTexture(c), toneMapped: false })
    );
    glass.position.set(0, 2.12, 0.02);
    g.add(glass);

    const frameMat = stdMat('#f4e8d6', 0.8);
    addBox(g, 3.66, 0.13, 0.14, frameMat, 0, 3.13, 0, false);
    addBox(g, 3.66, 0.13, 0.14, frameMat, 0, 1.11, 0, false);
    addBox(g, 0.13, 2.15, 0.14, frameMat, -1.76, 2.12, 0, false);
    addBox(g, 0.13, 2.15, 0.14, frameMat, 1.76, 2.12, 0, false);
    addBox(g, 0.09, 2.15, 0.1, frameMat, 0, 2.12, 0.02, false);
    addBox(g, 3.5, 0.08, 0.5, frameMat, 0, 1.06, 0.2, false);
    scene.add(g);

    if (withLight) {
      const light = new THREE.PointLight('#ffe2b8', 12, 9, 2);
      light.position.set(x + (flip ? -1.6 : 1.6), 2.3, z);
      scene.add(light);
    }
    return g;
  }
  buildWindow(-ROOM.w / 2 + 0.06, -4.0, false, true);
  buildWindow(ROOM.w / 2 - 0.06, -4.0, true, true);
  buildWindow(-ROOM.w / 2 + 0.06, 2.6, false, false);
  buildWindow(ROOM.w / 2 - 0.06, 2.6, true, false);

  /* ---------- 펜던트 조명 ---------- */
  // 천장이 없는 모형이라 등기구는 보이지 않게 두고, 따뜻한 빛만 방 안에 내려앉게 합니다.
  function dropLight(x, z, color, intensity) {
    const lamp = new THREE.PointLight(color, intensity, 9, 2);
    lamp.position.set(x, 2.72, z);
    scene.add(lamp);
  }
  dropLight(0, -5.6, '#ffe0bd', 7);
  dropLight(-6.3, -4.6, '#ffe0bd', 6);
  dropLight(6.3, -4.6, '#d9ecff', 6);
  dropLight(MEET.x, MEET.z, '#ffe0bd', 6);
  dropLight(LOUNGE.x, LOUNGE.z, '#ffe4c8', 5);

  /* ---------- 화이트보드 (두 개: 비서실 / 폴리코드팀) ---------- */
  function buildBoard(cfg) {
    const g = new THREE.Group();
    g.position.set(cfg.x, 0, -ROOM.d / 2 + 0.05);
    scene.add(g);

    const c = canvas2d(1280, 720);
    const ctx = c.getContext('2d');
    const tex = canvasTexture(c);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.3, 2.42),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    plane.position.set(0, 2.02, 0.045);
    g.add(plane);

    const frameMat2 = stdMat('#c9bfae', 0.7, 0.15);
    addBox(g, 4.46, 0.07, 0.1, frameMat2, 0, 3.25, 0.03, false);
    addBox(g, 4.46, 0.07, 0.1, frameMat2, 0, 0.79, 0.03, false);
    addBox(g, 0.07, 2.53, 0.1, frameMat2, -2.2, 2.02, 0.03, false);
    addBox(g, 0.07, 2.53, 0.1, frameMat2, 2.2, 2.02, 0.03, false);
    addBox(g, 4.3, 0.05, 0.12, stdMat('#e9e2d5', 0.6), 0, 0.76, 0.08, false);
    // 마커
    const markerColors = ['#e05263', '#4b93d1', '#3f9c6d'];
    markerColors.forEach(function (col, i) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10),
        stdMat(col, 0.6)
      );
      m.rotation.z = Math.PI / 2;
      m.position.set(-1.6 + i * 0.24, 0.8, 0.1);
      g.add(m);
    });

    g.traverse(function (o) {
      if (o.isMesh) { o.userData.pick = { kind: 'board', key: cfg.key }; picks.push(o); }
    });

    // 현황판 아래 콘솔
    addBox(scene, 2.2, 0.7, 0.42, stdMat('#e8d9c4', 0.8), cfg.x, 0.35, CONSOLE_Z);
    addBox(scene, 2.32, 0.06, 0.5, stdMat('#f2e6d4', 0.7), cfg.x, 0.72, CONSOLE_Z);
    addBox(scene, 0.5, 0.09, 0.34, stdMat('#6f7f97', 0.8), cfg.x - 0.66, 0.8, CONSOLE_Z);
    addBox(scene, 0.46, 0.06, 0.3, stdMat('#c25555', 0.8), cfg.x - 0.66, 0.87, CONSOLE_Z);
    scene.add(buildPlant(cfg.x + 0.7, 0.75, CONSOLE_Z + 0.02, 0.5));

    return { ctx: ctx, tex: tex };
  }
  boards.secretariat = buildBoard({ x: -BOARD_X, key: 'secretariat' });
  boards.poly = buildBoard({ x: BOARD_X, key: 'poly' });

  /* ---------- 벽시계 (가운데, 김팀장 뒤) ---------- */
  const clockCanvas = canvas2d(256, 256);
  clockCtx = clockCanvas.getContext('2d');
  clockTex = canvasTexture(clockCanvas);
  const clockGroup = new THREE.Group();
  clockGroup.position.set(0, 2.58, -ROOM.d / 2 + 0.03);
  const clockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.06, 32), stdMat('#f4ead8', 0.6, 0.1));
  clockBody.rotation.x = Math.PI / 2;
  clockGroup.add(clockBody);
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.31, 40),
    new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false })
  );
  clockFace.position.z = 0.035;
  clockGroup.add(clockFace);
  scene.add(clockGroup);

  /* ---------- 액자 그림 ---------- */
  function buildFrame(x, z, w, h, rotY, colors) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const c = canvas2d(256, 256);
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff7e6';
    ctx.beginPath(); ctx.arc(80, 80, 34, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(90, 150); ctx.lineTo(180, 220); ctx.lineTo(256, 170); ctx.lineTo(256, 256); ctx.fill();
    ctx.globalAlpha = 1;
    const art = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: canvasTexture(c), toneMapped: false })
    );
    art.position.set(0, 2.0, 0.03);
    g.add(art);
    const fr = stdMat('#cbb79b', 0.65, 0.1);
    addBox(g, w + 0.12, 0.06, 0.06, fr, 0, 2.0 + h / 2 + 0.03, 0.02, false);
    addBox(g, w + 0.12, 0.06, 0.06, fr, 0, 2.0 - h / 2 - 0.03, 0.02, false);
    addBox(g, 0.06, h + 0.12, 0.06, fr, -w / 2 - 0.03, 2.0, 0.02, false);
    addBox(g, 0.06, h + 0.12, 0.06, fr, w / 2 + 0.03, 2.0, 0.02, false);
    scene.add(g);
  }
  buildFrame(-ROOM.w / 2 + 0.16, -0.9, 1.1, 0.8, Math.PI / 2, ['#f2b7a0', '#e08e79']);
  buildFrame(-ROOM.w / 2 + 0.16, 5.4, 1.1, 0.8, Math.PI / 2, ['#bcd9c8', '#8fbfae']);
  buildFrame(ROOM.w / 2 - 0.16, -0.9, 1.1, 0.8, -Math.PI / 2, ['#cdc2ee', '#a996dd']);
  buildFrame(ROOM.w / 2 - 0.16, 5.4, 1.1, 0.8, -Math.PI / 2, ['#f4d7a8', '#e0b97c']);

  /* ---------- 책장 ---------- */
  function buildBookshelf(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const wood = stdMat('#dbc3a5', 0.82);
    addBox(g, 1.9, 0.06, 0.42, wood, 0, 0.03, 0);
    addBox(g, 1.9, 0.06, 0.42, wood, 0, 1.86, 0);
    addBox(g, 0.06, 1.86, 0.42, wood, -0.92, 0.93, 0);
    addBox(g, 0.06, 1.86, 0.42, wood, 0.92, 0.93, 0);
    addBox(g, 1.9, 1.86, 0.04, stdMat('#f3e7d6', 0.9), 0, 0.93, -0.19);
    addBox(g, 1.84, 0.05, 0.4, wood, 0, 0.62, 0);
    addBox(g, 1.84, 0.05, 0.4, wood, 0, 1.24, 0);
    const bookColors = ['#c9535f', '#4a7fa8', '#d8a13c', '#5f956f', '#8b6aa8', '#c97b4a'];
    for (let shelf = 0; shelf < 3; shelf++) {
      const y = 0.1 + shelf * 0.62;
      let cursor = -0.78;
      while (cursor < 0.62) {
        const w = 0.06 + Math.random() * 0.07;
        const h = 0.26 + Math.random() * 0.1;
        addBox(g, w, h, 0.26, stdMat(bookColors[(shelf * 3 + Math.floor(cursor * 10)) % bookColors.length], 0.85),
          cursor + w / 2, y + h / 2, 0.02, false);
        cursor += w + 0.012;
      }
    }
    scene.add(g);
  }
  buildBookshelf(ROOM.w / 2 - 0.55, -6.3, -Math.PI / 2);

  /* ---------- 식물 ---------- */
  function buildPlant(x, y, z, scale) {
    const g = new THREE.Group();
    const s = scale || 1;
    g.position.set(x, y, z);
    g.scale.set(s, s, s);
    const pot = addCyl(g, 0.17, 0.13, 0.28, stdMat('#c98a68', 0.85), 0, 0.14, 0);
    pot.receiveShadow = true;
    addCyl(g, 0.155, 0.155, 0.04, stdMat('#7d5a44', 0.95), 0, 0.28, 0, 14);
    const leafMat = stdMat('#5aa06a', 0.85);
    const leafMat2 = stdMat('#78bb7f', 0.85);
    const leaves = [
      [0, 0.62, 0, 0.22, 0.34, 0],
      [0.13, 0.7, 0.05, 0.18, 0.3, 0.5],
      [-0.14, 0.66, -0.04, 0.19, 0.28, -0.55],
      [0.05, 0.82, -0.1, 0.16, 0.26, 0.9],
      [-0.06, 0.55, 0.12, 0.16, 0.24, -0.3],
    ];
    leaves.forEach(function (L, i) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), i % 2 ? leafMat2 : leafMat);
      leaf.scale.set(L[3], L[4], L[3] * 0.55);
      leaf.position.set(L[0], L[1], L[2]);
      leaf.rotation.z = L[5];
      leaf.castShadow = true;
      g.add(leaf);
    });
    return g;
  }
  scene.add(buildPlant(-9.7, 0, -7.0, 1.2));
  scene.add(buildPlant(8.95, 0, -7.1, 1.0));
  scene.add(buildPlant(-9.6, 0, 0.4, 0.85));

  /* ---------- 복사·서류 스테이션 (비서실 존) ---------- */
  function buildPrinterStation(x, z, rotY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    addBox(g, 1.5, 0.62, 0.42, stdMat('#e8d9c4', 0.8), 0, 0.31, 0);
    addBox(g, 1.56, 0.05, 0.48, stdMat('#f2e6d4', 0.7), 0, 0.645, 0);
    addBox(g, 0.6, 0.02, 0.02, stdMat('#b9a68f', 0.7), -0.34, 0.35, 0.22, false);
    addBox(g, 0.6, 0.02, 0.02, stdMat('#b9a68f', 0.7), -0.34, 0.52, 0.22, false);
    // 프린터
    addBox(g, 0.46, 0.24, 0.36, stdMat('#f4f2ee', 0.6), 0.26, 0.79, 0);
    addBox(g, 0.4, 0.03, 0.3, stdMat('#dfe2e7', 0.6), 0.26, 0.915, 0, false);
    addBox(g, 0.3, 0.02, 0.22, stdMat('#cfd3d9', 0.6), 0.26, 0.93, 0.01, false);
    addBox(g, 0.3, 0.06, 0.22, stdMat('#fdf8ef', 0.9), -0.34, 0.7, 0.02, false);
    scene.add(g);
  }
  buildPrinterStation(-9.9, -1.6, Math.PI / 2);
  scene.add(buildPlant(-9.6, 0, 6.3, 1.05));
  scene.add(buildPlant(9.5, 0, 6.2, 1.0));

  /* ---------- 사람 ---------- */
  function buildPerson(cfg) {
    const g = new THREE.Group();
    const skin = stdMat('#f4cfb2', 0.82);
    const shirt = stdMat(cfg.color, 0.75);
    const pants = stdMat('#3f4757', 0.9);
    const hair = stdMat(cfg.hair || '#2d2530', 0.92);

    // 앉은 다리
    const legGeo = new THREE.CapsuleGeometry(0.062, 0.2, 4, 10);
    const thighL = new THREE.Mesh(legGeo, pants);
    thighL.position.set(-0.075, 0.42, 0.12);
    thighL.rotation.x = Math.PI / 2 * 0.82;
    thighL.castShadow = true;
    g.add(thighL);
    const thighR = thighL.clone();
    thighR.position.x = 0.075;
    g.add(thighR);

    const shinGeo = new THREE.CapsuleGeometry(0.055, 0.2, 4, 10);
    const shinL = new THREE.Mesh(shinGeo, pants);
    shinL.position.set(-0.075, 0.26, 0.25);
    shinL.castShadow = true;
    g.add(shinL);
    const shinR = shinL.clone();
    shinR.position.x = 0.075;
    g.add(shinR);

    // 몸통
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.163, 0.27, 6, 16), shirt);
    torso.position.set(0, 0.7, 0);
    torso.castShadow = true;
    g.add(torso);

    // 어깨 장식(스웨터 느낌)
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.028, 8, 20), stdMat(cfg.color, 0.7));
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0.93, 0);
    g.add(collar);

    // 목 · 머리
    addCyl(g, 0.055, 0.055, 0.07, skin, 0, 0.97, 0, 12);
    const head = addSphere(g, 0.15, skin, 0, 1.075, 0, 24);
    head.scale.set(1, 1.03, 0.98);

    // 머리카락 (윗 캡)
    const hairMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.158, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.6),
      hair
    );
    hairMesh.position.set(0, 1.077, 0);
    hairMesh.rotation.y = 0.3;
    hairMesh.castShadow = true;
    g.add(hairMesh);

    // 눈
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#2a2a33' });
    addSphere(g, 0.019, eyeMat, -0.053, 1.09, 0.133, 10).castShadow = false;
    addSphere(g, 0.019, eyeMat, 0.053, 1.09, 0.133, 10).castShadow = false;
    // 볼
    const blushMat = new THREE.MeshBasicMaterial({ color: '#f3a79a', transparent: true, opacity: 0.55 });
    addSphere(g, 0.022, blushMat, -0.098, 1.04, 0.112, 8).castShadow = false;
    addSphere(g, 0.022, blushMat, 0.098, 1.04, 0.112, 8).castShadow = false;

    // 팔
    const armGeo = new THREE.CapsuleGeometry(0.045, 0.17, 4, 10);
    const armL = new THREE.Mesh(armGeo, shirt);
    armL.position.set(-0.195, 0.78, 0.05);
    armL.rotation.set(-0.62, 0, 0.34);
    armL.castShadow = true;
    g.add(armL);
    const armR = new THREE.Mesh(armGeo, shirt);
    armR.position.set(0.195, 0.78, 0.05);
    armR.rotation.set(-0.62, 0, -0.34);
    armR.castShadow = true;
    g.add(armR);

    addSphere(g, 0.045, skin, -0.212, 0.7, 0.17, 12);
    addSphere(g, 0.045, skin, 0.212, 0.7, 0.17, 12);

    return { group: g, head: head, armL: armL, armR: armR };
  }

  /* ---------- 의자 ---------- */
  function buildChair(fabric) {
    const g = new THREE.Group();
    const fab = stdMat(fabric || '#5b6478', 0.92);
    const metal = stdMat('#8d95a6', 0.4, 0.65);
    addBox(g, 0.5, 0.07, 0.48, fab, 0, 0.46, 0);
    const back = addBox(g, 0.48, 0.5, 0.07, fab, 0, 0.72, -0.22);
    back.rotation.x = -0.1;
    addCyl(g, 0.042, 0.042, 0.3, metal, 0, 0.28, 0, 12);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = addBox(g, 0.05, 0.035, 0.26, metal, Math.sin(a) * 0.13, 0.11, Math.cos(a) * 0.13, false);
      arm.rotation.y = a;
      addSphere(g, 0.032, metal, Math.sin(a) * 0.26, 0.06, Math.cos(a) * 0.26, 8).castShadow = false;
    }
    return g;
  }

  /* ---------- 책상 한 세트 ---------- */
  function buildWorkstation(cfg) {
    const g = new THREE.Group();
    g.position.set(cfg.desk.x, 0, cfg.desk.z);
    g.rotation.y = cfg.desk.rotY || 0;

    const wood = stdMat(cfg.lead ? '#e6c9a4' : '#e9d5b8', 0.8);
    const woodDark = stdMat('#c9ad8b', 0.85);
    const topMat = stdMat('#f5ead8', 0.62);

    // 상판 · 다리
    addBox(g, 1.95, 0.075, 0.9, topMat, 0, 0.75, 0);
    addBox(g, 1.86, 0.02, 0.82, wood, 0, 0.71, 0);
    [[-0.86, -0.36], [0.86, -0.36], [-0.86, 0.36], [0.86, 0.36]].forEach(function (p) {
      addBox(g, 0.075, 0.71, 0.075, woodDark, p[0], 0.355, p[1]);
    });
    // 서랍장
    addBox(g, 0.48, 0.6, 0.72, woodDark, 0.66, 0.31, -0.02);
    addBox(g, 0.4, 0.03, 0.02, stdMat('#a98d6d', 0.6), 0.66, 0.46, 0.35, false);
    addBox(g, 0.4, 0.03, 0.02, stdMat('#a98d6d', 0.6), 0.66, 0.26, 0.35, false);
    // 총괄석 금색 앞 테두리
    if (cfg.lead) {
      addBox(g, 1.95, 0.022, 0.04, stdMat('#c9a35c', 0.45, 0.5), 0, 0.72, 0.455, false);
    }

    // 모니터 (비스듬히 — 얼굴이 보이도록)
    const monitor = new THREE.Group();
    monitor.position.set(-0.5, 0.79, -0.2);
    monitor.rotation.y = 0.52;
    addBox(monitor, 0.3, 0.02, 0.2, stdMat('#5a606e', 0.6, 0.3), 0, 0.01, 0.02, false);
    addBox(monitor, 0.06, 0.18, 0.06, stdMat('#5a606e', 0.6, 0.3), 0, 0.1, 0.02, false);
    addBox(monitor, 0.66, 0.42, 0.035, stdMat('#3b414d', 0.55, 0.35), 0, 0.32, 0.02);
    const screenMat = new THREE.MeshBasicMaterial({
      map: screenTexture(cfg.empty ? 'empty' : cfg.screen || 'warm'),
      toneMapped: false,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), screenMat);
    screen.position.set(0, 0.32, 0.041);
    monitor.add(screen);
    g.add(monitor);

    // 키보드 · 마우스 · 머그
    const keyCanvas = canvas2d(160, 64);
    const kctx = keyCanvas.getContext('2d');
    kctx.fillStyle = '#ecebe7'; kctx.fillRect(0, 0, 160, 64);
    kctx.fillStyle = '#cfd3d9';
    for (let r = 0; r < 3; r++) {
      for (let c2 = 0; c2 < 12; c2++) {
        roundRect(kctx, 6 + c2 * 12.4, 8 + r * 16, 10.5, 12, 2.4); kctx.fill();
      }
    }
    const keyTop = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.165),
      new THREE.MeshBasicMaterial({ map: canvasTexture(keyCanvas), toneMapped: false })
    );
    keyTop.rotation.x = -Math.PI / 2;
    keyTop.position.set(-0.12, 0.808, 0.19);
    g.add(keyTop);
    addBox(g, 0.52, 0.022, 0.17, stdMat('#e8e6e1', 0.7), -0.12, 0.795, 0.19, false);
    addBox(g, 0.07, 0.03, 0.11, stdMat('#dfe2e7', 0.6), 0.3, 0.8, 0.2, false);
    const mug = addCyl(g, 0.055, 0.05, 0.1, stdMat(cfg.color, 0.6), 0.6, 0.83, 0.22);
    mug.castShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.011, 6, 12), stdMat(cfg.color, 0.6));
    handle.position.set(0.66, 0.84, 0.22);
    handle.rotation.y = Math.PI / 2;
    g.add(handle);

    // 서류 · 명패
    addBox(g, 0.3, 0.012, 0.22, stdMat('#fdf8ef', 0.9), 0.28, 0.795, -0.28, false);
    addBox(g, 0.26, 0.012, 0.19, stdMat('#f4ecdd', 0.9), 0.3, 0.808, -0.27, false);

    const plaqueCanvas = canvas2d(384, 128);
    const pctx = plaqueCanvas.getContext('2d');
    pctx.fillStyle = cfg.empty ? '#efe9dd' : '#fffaf0';
    roundRect(pctx, 4, 4, 376, 120, 14);
    pctx.fill();
    pctx.strokeStyle = 'rgba(150,120,90,.35)';
    pctx.lineWidth = 4; pctx.stroke();
    pctx.fillStyle = '#3a332b';
    pctx.font = 'bold 52px "Malgun Gothic","Noto Sans KR",sans-serif';
    pctx.textAlign = 'center'; pctx.textBaseline = 'middle';
    pctx.fillText(cfg.name, 192, 66);
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.133),
      new THREE.MeshBasicMaterial({ map: canvasTexture(plaqueCanvas), toneMapped: false })
    );
    plaque.position.set(-0.62, 0.83, 0.42);
    plaque.rotation.x = -0.22;
    g.add(plaque);
    addBox(g, 0.44, 0.02, 0.06, woodDark, -0.62, 0.79, 0.4, false);

    // 의자 · 사람
    const chair = buildChair();
    chair.position.set(0.02, 0, -0.74);
    chair.rotation.y = 0.06;
    g.add(chair);

    // 화분
    if (!cfg.empty && cfg.key !== 'kkobung') {
      const plant = buildPlant(0.42, 0.79, -0.3, 0.55);
      g.add(plant);
    }

    // 총괄 ㄱ 배지
    if (cfg.badge) {
      addBox(g, 1.5, 0.42, 0.04, stdMat('#f6e7d3', 0.8), 0, 0.5, 0.46, false);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.34),
        new THREE.MeshBasicMaterial({ map: badgeTexture(), transparent: true, toneMapped: false })
      );
      plate.position.set(-0.56, 0.5, 0.485);
      g.add(plate);
      const small = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.16),
        new THREE.MeshBasicMaterial({ map: badgeTexture(), transparent: true, toneMapped: false })
      );
      small.position.set(0.56, 0.5, 0.485);
      g.add(small);
    }

    // 사람
    const person = buildPerson(cfg);
    person.group.position.set(0.02, 0, -0.72);
    person.group.scale.setScalar(1.07);
    g.add(person.group);

    scene.add(g);
    return { group: g, person: person };
  }

  /* ---------- 캐릭터 배치 ---------- */
  PEOPLE.forEach(function (cfg) {
    const built = buildWorkstation(cfg);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nameLabelTexture(cfg.name, cfg.emoji, cfg.tag), transparent: true, depthWrite: false,
    }));
    if (cfg.tag) label.scale.set(1.16, 0.4, 1);
    else label.scale.set(1.05, 0.315, 1);
    label.position.set(0.02, 1.62, -0.72);
    built.group.add(label);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.37, 40),
      new THREE.MeshBasicMaterial({ color: STATUS_COLOR.idle, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0.02, 0.025, -0.72);
    built.group.add(ring);

    const entry = {
      key: cfg.key, cfg: cfg, group: built.group, person: built.person, ring: ring, label: label,
    };
    people[cfg.key] = entry;

    built.group.traverse(function (o) {
      if (o.isMesh) {
        o.userData.pick = { kind: 'person', key: cfg.key };
        picks.push(o);
      }
    });
    label.userData.pick = { kind: 'person', key: cfg.key };
    picks.push(label);
  });

  // 클로드 자리는 빈 의자 + '채용 중' 팻말로 보이게 합니다.
  if (people.claude) {
    people.claude.person.group.visible = false;
    people.claude.label.visible = true;
  }

  /* ---------- 회의 전화 (김팀장 중앙석) ---------- */
  const phoneGroup = new THREE.Group();
  phoneGroup.position.set(PHONE.x, 0.79, -5.9 + PHONE.z);
  phoneGroup.rotation.y = -0.18;
  scene.add(phoneGroup);
  addBox(phoneGroup, 0.3, 0.055, 0.22, stdMat('#2f3644', 0.55, 0.35), 0, 0.03, 0);
  addBox(phoneGroup, 0.2, 0.02, 0.12, stdMat('#4d5567', 0.6, 0.3), 0, 0.065, 0.02, false);
  const handset = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.24, 4, 10), stdMat('#3c4453', 0.5, 0.3));
  handset.rotation.z = Math.PI / 2;
  handset.position.set(0, 0.1, -0.08);
  handset.castShadow = true;
  phoneGroup.add(handset);
  const ledMat = new THREE.MeshBasicMaterial({ color: '#ff9db0', toneMapped: false });
  const led = addSphere(phoneGroup, 0.016, ledMat, 0.1, 0.062, 0.06, 8);
  led.castShadow = false;

  // 전화 위의 ☎ 안내 스프라이트
  const phoneCanvas = canvas2d(256, 256);
  const phCtx = phoneCanvas.getContext('2d');
  phCtx.fillStyle = 'rgba(255,255,255,.95)';
  phCtx.beginPath(); phCtx.arc(128, 128, 108, 0, Math.PI * 2); phCtx.fill();
  phCtx.strokeStyle = 'rgba(217,72,97,.55)';
  phCtx.lineWidth = 8; phCtx.stroke();
  phCtx.font = '130px "Segoe UI Emoji","Noto Color Emoji",sans-serif';
  phCtx.textAlign = 'center'; phCtx.textBaseline = 'middle';
  phCtx.fillText('☎', 128, 136);
  const phoneSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTexture(phoneCanvas), transparent: true, depthWrite: false,
  }));
  phoneSprite.scale.set(0.4, 0.4, 1);
  phoneSprite.position.set(0, 0.4, 0.02);
  phoneGroup.add(phoneSprite);
  phoneRing = phoneSprite;

  // 보이지 않는 클릭 영역 — 작은 전화기를 조준하기 쉽게 넓혀 둡니다.
  const phoneHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.5, 0.52),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  phoneHit.position.set(0, 0.22, 0.02);
  phoneGroup.add(phoneHit);

  phoneGroup.traverse(function (o) {
    if (o.isMesh) { o.userData.pick = { kind: 'phone' }; picks.push(o); }
  });
  phoneSprite.userData.pick = { kind: 'phone' };
  picks.push(phoneSprite);

  /* ---------- 신규 피클 슬롯 (비서실 존) ---------- */
  const slotGroup = new THREE.Group();
  slotGroup.position.set(SLOT.x, 0, SLOT.z);
  slotGroup.rotation.y = SLOT.rotY;
  scene.add(slotGroup);

  const ghostMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffd9b0'), roughness: 0.8, transparent: true, opacity: 0.42,
  });
  const ghostLine = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ff9ec4'), roughness: 0.6, transparent: true, opacity: 0.6,
  });
  addBox(slotGroup, 1.7, 0.06, 0.8, ghostMat, 0, 0.75, 0, false);
  [[-0.72, -0.3], [0.72, -0.3], [-0.72, 0.3], [0.72, 0.3]].forEach(function (p) {
    addBox(slotGroup, 0.06, 0.72, 0.06, ghostMat, p[0], 0.36, p[1], false);
  });
  addBox(slotGroup, 0.26, 0.34, 0.02, ghostLine, 0, 1.02, -0.18, false);

  // ＋ 표시
  addBox(slotGroup, 0.34, 0.05, 0.02, ghostLine, 0, 1.02, -0.17, false);
  addBox(slotGroup, 0.05, 0.34, 0.02, ghostLine, 0, 1.02, -0.17, false);

  slotRing = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.78, 48),
    new THREE.MeshBasicMaterial({ color: '#ff8fb4', transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  slotRing.rotation.x = -Math.PI / 2;
  slotRing.position.set(0, 0.02, 0);
  slotGroup.add(slotRing);

  const slotLabel = new THREE.Sprite(new THREE.SpriteMaterial({
    map: pillTexture('＋ 신규 피클 자리', 'rgba(255,255,255,.94)', '#8a3d55'),
    transparent: true, depthWrite: false,
  }));
  slotLabel.scale.set(1.5, 0.375, 1);
  slotLabel.position.set(0, 1.5, 0);
  slotGroup.add(slotLabel);

  slotGroup.traverse(function (o) {
    if (o.isMesh) { o.userData.pick = { kind: 'slot', key: 'slot' }; picks.push(o); }
  });
  slotLabel.userData.pick = { kind: 'slot', key: 'slot' };
  picks.push(slotLabel);

  /* ---------- 휴게공간 ---------- */
  function buildLoungeBean(x, z, color) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const bean = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 18), stdMat(color, 0.95));
    bean.scale.set(1, 0.64, 1);
    bean.position.y = 0.28;
    bean.castShadow = true;
    bean.receiveShadow = true;
    g.add(bean);
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.014, 6, 28), stdMat('#ffffff', 0.9));
    seam.rotation.x = Math.PI / 2;
    seam.position.y = 0.42;
    seam.scale.set(1, 1, 0.9);
    g.add(seam);
    scene.add(g);
  }

  function buildCoffeeTable(x, z, color) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    addCyl(g, 0.5, 0.5, 0.05, stdMat(color, 0.7), 0, 0.42, 0, 30);
    addCyl(g, 0.05, 0.05, 0.4, stdMat('#a98d6d', 0.8), 0, 0.21, 0, 12);
    addCyl(g, 0.26, 0.26, 0.03, stdMat('#a98d6d', 0.8), 0, 0.02, 0, 22);
    const cup = addCyl(g, 0.05, 0.042, 0.08, stdMat('#ffffff', 0.5), 0.14, 0.485, 0.06, 14);
    cup.castShadow = false;
    addBox(g, 0.22, 0.015, 0.17, stdMat('#e8e2d5', 0.9), -0.14, 0.45, -0.02, false);
    const book = addBox(g, 0.16, 0.035, 0.22, stdMat('#c97b6a', 0.8), -0.02, 0.465, 0.16, false);
    book.rotation.y = 0.3;
    scene.add(g);
  }

  function buildFloorLamp(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    addCyl(g, 0.11, 0.13, 0.035, stdMat('#8d95a6', 0.5, 0.45), 0, 0.018, 0, 18);
    addCyl(g, 0.018, 0.018, 1.42, stdMat('#6f7684', 0.5, 0.5), 0, 0.73, 0, 10);
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 0.3, 22, 1, true),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#f8ecd6'), roughness: 0.9, side: THREE.DoubleSide,
        emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0.4,
      })
    );
    shade.position.set(0, 1.48, 0);
    shade.castShadow = false;
    g.add(shade);
    scene.add(g);
  }

  // 휴게공간 러그
  const loungeRug = new THREE.Mesh(
    new THREE.CircleGeometry(2.55, 56),
    new THREE.MeshStandardMaterial({ map: roundRugTexture('#e7f2ec', '#bcdccd', '#d4e9df'), roughness: 0.95 })
  );
  loungeRug.rotation.x = -Math.PI / 2;
  loungeRug.position.set(LOUNGE.x, 0.016, LOUNGE.z);
  loungeRug.receiveShadow = true;
  scene.add(loungeRug);

  buildLoungeBean(LOUNGE.x - 1.25, LOUNGE.z - 0.55, '#f7c3b0');
  buildLoungeBean(LOUNGE.x + 1.2, LOUNGE.z - 0.7, '#f8d8c4');
  buildLoungeBean(LOUNGE.x - 0.7, LOUNGE.z + 1.35, '#f3cdb9');
  buildCoffeeTable(LOUNGE.x + 0.1, LOUNGE.z + 0.2, '#efe3d1');
  buildFloorLamp(LOUNGE.x + 2.05, LOUNGE.z + 1.35);

  /* ---------- 공용 회의공간 ---------- */
  const meetRug = new THREE.Mesh(
    new THREE.CircleGeometry(2.9, 60),
    new THREE.MeshStandardMaterial({ map: roundRugTexture('#f5efe0', '#d8cdb4', '#e6ddca'), roughness: 0.95 })
  );
  meetRug.rotation.x = -Math.PI / 2;
  meetRug.position.set(MEET.x, 0.016, MEET.z);
  meetRug.receiveShadow = true;
  scene.add(meetRug);

  const meetingGroup = new THREE.Group();
  meetingGroup.position.set(MEET.x, 0, MEET.z);
  scene.add(meetingGroup);
  // 둥근 회의 테이블
  addCyl(meetingGroup, 1.12, 1.12, 0.08, stdMat('#f2e6d2', 0.55), 0, 0.74, 0, 44);
  addCyl(meetingGroup, 1.08, 1.08, 0.03, stdMat('#d9c9b0', 0.8), 0, 0.69, 0, 44);
  addCyl(meetingGroup, 0.13, 0.17, 0.66, stdMat('#b9a68f', 0.8), 0, 0.35, 0, 18);
  addCyl(meetingGroup, 0.52, 0.6, 0.05, stdMat('#b9a68f', 0.8), 0, 0.03, 0, 30);
  // 테이블 위 소품
  addBox(meetingGroup, 0.42, 0.02, 0.3, stdMat('#5a606e', 0.6, 0.2), -0.18, 0.79, 0.05, false);
  addBox(meetingGroup, 0.36, 0.015, 0.26, stdMat('#e9eef5', 0.8), -0.18, 0.8, 0.05, false);
  const meetMug1 = addCyl(meetingGroup, 0.05, 0.045, 0.085, stdMat('#ffffff', 0.5), 0.34, 0.81, -0.22, 14);
  meetMug1.castShadow = false;
  const meetMug2 = addCyl(meetingGroup, 0.05, 0.045, 0.085, stdMat('#e9b7a6', 0.5), 0.12, 0.81, 0.44, 14);
  meetMug2.castShadow = false;
  addBox(meetingGroup, 0.24, 0.03, 0.32, stdMat('#fdf8ef', 0.9), 0.46, 0.795, 0.24, false);
  addCyl(meetingGroup, 0.16, 0.14, 0.05, stdMat('#cfd8e2', 0.5), -0.44, 0.8, -0.4, 20);

  // 회의 의자 6개
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.24;
    const ch = buildChair('#8a7b6b');
    ch.position.set(MEET.x + Math.sin(a) * 1.86, 0, MEET.z + Math.cos(a) * 1.86);
    ch.rotation.y = a + Math.PI;
    scene.add(ch);
  }

  /* ---------- 공간 이름표 ---------- */
  function spaceLabel(text, x, y, z) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: pillTexture(text, 'rgba(255,253,247,.95)', '#6a5a49'),
      transparent: true, depthWrite: false,
    }));
    sp.scale.set(1.16, 0.29, 1);
    sp.position.set(x, y, z);
    scene.add(sp);
    return sp;
  }
  spaceLabel('회의공간', MEET.x, 1.0, MEET.z + 3.1);
  spaceLabel('휴게공간', LOUNGE.x, 1.0, LOUNGE.z + 2.85);

  // 회의·휴게 영역은 눌러서 안내를 볼 수 있습니다.
  meetingGroup.traverse(function (o) {
    if (o.isMesh) { o.userData.pick = { kind: 'common', key: 'meeting' }; picks.push(o); }
  });

  /* ---------- 화이트보드 그리기 : 폴리코드팀 ---------- */
  function drawPolicyBoard(data) {
    const b = boards.poly;
    if (!b) return;
    const ctx = b.ctx;
    const W = 1280, H = 720;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#7e8c99';
    for (let i = 0; i < 30; i++) ctx.fillRect(0, i * 24, W, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3d8f7a';
    ctx.fillRect(0, 0, W, 10);

    const connected = !!(data && data.connected);
    const now = (data && data.updated) || '';

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2c333d';
    ctx.font = 'bold 44px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('폴리코드팀 현황판', 44, 72);
    ctx.fillStyle = '#8d97a4';
    ctx.font = '24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(now, W - 44, 68);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 22px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('폴리코드팀 존 · PolyCode Dev', 44, 108);
    ctx.strokeStyle = 'rgba(120,132,146,.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(44, 126); ctx.lineTo(W - 44, 126); ctx.stroke();

    if (!connected) {
      ctx.fillStyle = '#43505f';
      ctx.font = 'bold 34px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('회의실 연결 대기', 44, 208);
      ctx.font = '27px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillStyle = '#68727f';
      const lines = wrapChars(ctx, '입장 비밀번호를 넣으면 이 보드에 방별 메시지 수와 최근 #general 공지가 실시간으로 표시됩니다.', 860, 3);
      lines.forEach(function (ln, i) { ctx.fillText(ln, 44, 258 + i * 38); });
      ctx.fillStyle = '#3d8f7a';
      ctx.font = 'bold 28px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('[회의실 연결]  →  💬 회의실에서 입장하거나, 보드를 눌러 비밀번호를 넣으세요.', 44, 440);
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = 'rgba(61,143,122,.45)';
      ctx.lineWidth = 2;
      roundRect(ctx, 30, 24, W - 60, H - 48, 14);
      ctx.stroke();
      ctx.setLineDash([]);
      b.tex.needsUpdate = true;
      return;
    }

    const rooms = (data && data.rooms) || [];
    const maxCount = rooms.reduce(function (m, r) { return Math.max(m, r.count || 0); }, 1);

    // 왼쪽: 방별 메시지 수
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('회의실 방 · 메시지 수', 44, 176);
    rooms.slice(0, 4).forEach(function (r, i) {
      const y = 236 + i * 74;
      ctx.fillStyle = '#3f4a57';
      ctx.font = 'bold 32px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('#' + r.name, 44, y);
      const ratio = maxCount ? Math.max(0.04, (r.count || 0) / maxCount) : 0.04;
      ctx.fillStyle = 'rgba(120,140,160,.16)';
      roundRect(ctx, 300, y - 24, 290, 18, 9);
      ctx.fill();
      ctx.fillStyle = i === 0 ? '#d94861' : '#5c9e8c';
      roundRect(ctx, 300, y - 24, Math.max(22, 290 * ratio), 18, 9);
      ctx.fill();
      ctx.fillStyle = '#5c6673';
      ctx.font = 'bold 28px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText((r.count || 0) + '건', 690, y);
      ctx.textAlign = 'left';
    });

    // 오른쪽: 최근 #general 공지
    ctx.strokeStyle = 'rgba(120,132,146,.28)';
    ctx.beginPath(); ctx.moveTo(730, 150); ctx.lineTo(730, H - 60); ctx.stroke();

    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('최근 #general 공지', 770, 176);

    const n = (data && data.notice) || null;
    if (n) {
      ctx.fillStyle = '#c9535f';
      ctx.font = 'bold 28px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText(n.who || '', 770, 232);
      ctx.fillStyle = '#8d97a4';
      ctx.font = '23px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(n.time || '', W - 44, 232);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#3f4a57';
      ctx.font = '26px "Malgun Gothic","Noto Sans KR",sans-serif';
      const lines = wrapChars(ctx, n.text || '', 440, 11);
      lines.forEach(function (ln, i) { ctx.fillText(ln, 770, 278 + i * 36); });
    } else {
      ctx.fillStyle = '#8d97a4';
      ctx.font = '26px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('아직 공지가 없습니다.', 770, 238);
    }

    b.tex.needsUpdate = true;
  }

  /* ---------- 화이트보드 그리기 : 비서실 ---------- */
  function drawSecretariatBoard(data) {
    const b = boards.secretariat;
    if (!b) return;
    const ctx = b.ctx;
    const W = 1280, H = 720;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#7e8c99';
    for (let i = 0; i < 30; i++) ctx.fillRect(0, i * 24, W, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d94861';
    ctx.fillRect(0, 0, W, 10);

    const connected = !!(data && data.connected);
    const now = (data && data.updated) || '';

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2c333d';
    ctx.font = 'bold 44px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('비서실 현황판', 44, 72);
    ctx.fillStyle = '#8d97a4';
    ctx.font = '24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(now, W - 44, 68);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 22px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('비서실 존 · Pickle Desk · Secretariat', 44, 108);
    ctx.strokeStyle = 'rgba(120,132,146,.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(44, 126); ctx.lineTo(W - 44, 126); ctx.stroke();

    if (!connected) {
      ctx.fillStyle = '#43505f';
      ctx.font = 'bold 34px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('회의실 연결 대기', 44, 208);
      ctx.font = '27px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillStyle = '#68727f';
      const lines = wrapChars(ctx, '입장 비밀번호를 넣으면 픽클 워커의 상태와 최근 지시·보고가 이 보드에 실시간으로 표시됩니다.', 860, 3);
      lines.forEach(function (ln, i) { ctx.fillText(ln, 44, 258 + i * 38); });
      ctx.fillStyle = '#c9535f';
      ctx.font = 'bold 28px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('[회의실 연결]  →  💬 회의실에서 입장하거나, 보드를 눌러 비밀번호를 넣으세요.', 44, 440);
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = 'rgba(217,72,97,.45)';
      ctx.lineWidth = 2;
      roundRect(ctx, 30, 24, W - 60, H - 48, 14);
      ctx.stroke();
      ctx.setLineDash([]);
      b.tex.needsUpdate = true;
      return;
    }

    const workers = (data && data.workers) || [];
    const statusStyle = {
      active: ['#d8f5e3', '#1c6b43'],
      recent: ['#ffefcd', '#8a5a12'],
      idle: ['#eceff3', '#5d6773'],
      hiring: ['#ffefcd', '#8a5a12'],
      planned: ['#eef1f6', '#5d6773'],
    };

    // 왼쪽: 픽클 워커 현황
    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('픽클 워커 현황', 44, 176);

    workers.slice(0, 3).forEach(function (w, i) {
      const y = 244 + i * 92;
      const st = statusStyle[w.code] || statusStyle.idle;
      ctx.fillStyle = st[1];
      ctx.beginPath(); ctx.arc(60, y - 11, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f3742';
      ctx.font = 'bold 34px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText(w.name, 86, y);
      ctx.fillStyle = '#8d97a4';
      ctx.font = '22px "Malgun Gothic","Noto Sans KR",sans-serif';
      const meta = (w.role || '') + (w.last ? '  ·  최근 ' + w.last : '');
      ctx.fillText(meta, 86, y + 32);
      // 상태 배지
      const bw = 150;
      ctx.fillStyle = st[0];
      roundRect(ctx, 630 - bw, y - 32, bw, 40, 20);
      ctx.fill();
      ctx.fillStyle = st[1];
      ctx.font = 'bold 22px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(w.label || '대기', 630 - bw / 2, y - 11);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    });

    // 왼쪽 아래: 운영 메모
    ctx.fillStyle = '#8d97a4';
    ctx.font = '22px "Malgun Gothic","Noto Sans KR",sans-serif';
    const note = wrapChars(ctx, 'Pickle Desk 작업함과 #general 기준으로 정리합니다. 지시는 김팀장이 접수해 워커에게 배분하고, 결과는 #general에 남깁니다.', 600, 2);
    note.forEach(function (ln, i) { ctx.fillText(ln, 44, 560 + i * 32); });

    // 구분선
    ctx.strokeStyle = 'rgba(120,132,146,.28)';
    ctx.beginPath(); ctx.moveTo(690, 150); ctx.lineTo(690, H - 60); ctx.stroke();

    // 오른쪽: 최근 지시 · 최근 보고
    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('최근 지시 · #general', 726, 176);

    const directs = (data && data.directs) || [];
    if (!directs.length) {
      ctx.fillStyle = '#8d97a4';
      ctx.font = '26px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('최근 지시가 없습니다.', 726, 226);
    }
    directs.slice(0, 2).forEach(function (d, i) {
      const y = 232 + i * 122;
      ctx.fillStyle = '#c9535f';
      ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('👤 ' + (d.who || ''), 726, y);
      ctx.fillStyle = '#8d97a4';
      ctx.font = '22px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(d.time || '', W - 44, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#3f4a57';
      ctx.font = '25px "Malgun Gothic","Noto Sans KR",sans-serif';
      const lines = wrapChars(ctx, d.text || '', 500, 2);
      lines.forEach(function (ln, j) { ctx.fillText(ln, 726, y + 34 + j * 32); });
    });

    ctx.fillStyle = '#7b8492';
    ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
    ctx.fillText('최근 보고', 726, 486);

    const rep = (data && data.report) || null;
    if (rep) {
      ctx.fillStyle = '#3d8f7a';
      ctx.font = 'bold 24px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText(rep.who || '', 726, 526);
      ctx.fillStyle = '#8d97a4';
      ctx.font = '22px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(rep.time || '', W - 44, 526);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#3f4a57';
      ctx.font = '25px "Malgun Gothic","Noto Sans KR",sans-serif';
      const rl = wrapChars(ctx, rep.text || '', 500, 2);
      rl.forEach(function (ln, j) { ctx.fillText(ln, 726, 562 + j * 32); });
    } else {
      ctx.fillStyle = '#8d97a4';
      ctx.font = '26px "Malgun Gothic","Noto Sans KR",sans-serif';
      ctx.fillText('최근 보고가 없습니다.', 726, 526);
    }

    b.tex.needsUpdate = true;
  }

  /* ---------- 벽시계 그리기 ---------- */
  function drawClock(text) {
    if (!clockCtx) return;
    const ctx = clockCtx;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = '#fffdf7';
    ctx.beginPath(); ctx.arc(128, 128, 126, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d9cbb6';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r1 = i % 3 === 0 ? 96 : 104;
      ctx.strokeStyle = i % 3 === 0 ? '#4a5665' : '#b3a795';
      ctx.lineWidth = i % 3 === 0 ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * r1, 128 - Math.cos(a) * r1);
      ctx.lineTo(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
      ctx.stroke();
    }
    const m = /(\d{1,2}):(\d{2})/.exec(text || '');
    const hh = m ? parseInt(m[1], 10) % 12 : 10;
    const mm = m ? parseInt(m[2], 10) : 10;
    const hAng = ((hh + mm / 60) / 12) * Math.PI * 2;
    const mAng = (mm / 60) * Math.PI * 2;
    ctx.strokeStyle = '#3a4552';
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.sin(hAng) * 58, 128 - Math.cos(hAng) * 58);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#d94861';
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.sin(mAng) * 88, 128 - Math.cos(mAng) * 88);
    ctx.stroke();
    ctx.fillStyle = '#3a4552';
    ctx.beginPath(); ctx.arc(128, 128, 8, 0, Math.PI * 2); ctx.fill();
    clockTex.needsUpdate = true;
    clockTime.text = text || '';
  }

  /* ---------- 카메라 시점 ---------- */
  const VIEWS = {
    all: { pos: [0, 11.2, 14.6], tgt: [0, 0.5, -1.0] },
    kim: { pos: [0, 5.6, 4.8], tgt: [0, 1.3, -4.6] },
    secretariat: { pos: [-1.8, 5.6, 1.2], tgt: [-6.4, 1.5, -5.2] },
    poly: { pos: [1.8, 5.6, 1.2], tgt: [6.4, 1.5, -5.2] },
    common: { pos: [0, 7.2, 12.8], tgt: [0, 0.7, 3.0] },
  };
  let tween = null;
  let currentView = 'all';
  let aspectClass = '';

  function aspectKind(a) {
    if (a < 0.85) return 'portrait';
    if (a < 1.05) return 'tall';
    if (a < 1.4) return 'mid';
    return 'wide';
  }

  // 세로로 긴 화면에서는 시야각을 넓혀 방이 화면 안에 더 들어오게 합니다.
  function fovForAspect(a) {
    const k = aspectKind(a);
    if (k === 'portrait') return 74;
    if (k === 'tall') return 58;
    if (k === 'mid') return 48;
    return 45;
  }

  function viewDistanceScale() {
    const k = aspectKind(camera.aspect || 1.6);
    if (k === 'portrait') return 1.55;
    if (k === 'tall') return 1.18;
    if (k === 'mid') return 1.07;
    return 1;
  }

  function setView(name, instant) {
    const v = VIEWS[name] || VIEWS.all;
    currentView = VIEWS[name] ? name : 'all';
    const tgt = new THREE.Vector3(v.tgt[0], v.tgt[1], v.tgt[2]);
    const pos = new THREE.Vector3(v.pos[0], v.pos[1], v.pos[2]);
    const dir = pos.clone().sub(tgt);
    dir.multiplyScalar(viewDistanceScale());
    pos.copy(tgt).add(dir);
    if (instant) {
      camera.position.copy(pos);
      controls.target.copy(tgt);
      controls.update();
      tween = null;
      return;
    }
    tween = {
      t0: performance.now(),
      dur: 820,
      fromPos: camera.position.clone(),
      toPos: pos,
      fromTgt: controls.target.clone(),
      toTgt: tgt,
    };
  }

  /* ---------- 상태 반영 ---------- */
  function applyData(data) {
    const d = data || {};
    const statuses = d.statuses || {};
    Object.keys(people).forEach(function (key) {
      const p = people[key];
      const st = statuses[key] || { code: 'idle' };
      const col = STATUS_COLOR[st.code] || STATUS_COLOR.idle;
      p.ring.material.color.set(col);
      p.ring.material.opacity = st.code === 'active' ? 0.95 : 0.62;
      p.stateCode = st.code;
      if (p.label && p.label.material) {
        p.label.material.opacity = st.code === 'hiring' ? 0.75 : 1;
      }
    });
    drawSecretariatBoard(d.secBoard || { connected: d.connected });
    drawPolicyBoard(d.devBoard || { connected: d.connected });
    if (d.clock) drawClock(d.clock);
  }

  /* ---------- 말풍선 ---------- */
  let bubbleEl = null, bubbleKey = null, bubbleUntil = 0;
  const anchorWorld = new THREE.Vector3();
  const tmpVec = new THREE.Vector3();

  function anchorFor(key) {
    if (key === 'secretariat') return new THREE.Vector3(-BOARD_X, 3.0, -ROOM.d / 2 + 0.2);
    if (key === 'poly') return new THREE.Vector3(BOARD_X, 3.0, -ROOM.d / 2 + 0.2);
    if (key === 'phone') return new THREE.Vector3(PHONE.x, 1.55, -5.9 + PHONE.z);
    if (key === 'slot') return new THREE.Vector3(SLOT.x, 1.9, SLOT.z);
    if (key === 'meeting') return new THREE.Vector3(MEET.x, 1.5, MEET.z);
    const p = people[key];
    if (p) {
      p.group.updateWorldMatrix(true, false);
      return new THREE.Vector3(0.02, 1.72, -0.72).applyMatrix4(p.group.matrixWorld);
    }
    return new THREE.Vector3(0, 1, 0);
  }

  function bubbleTitle(key) {
    if (key === 'secretariat') return '비서실 현황판';
    if (key === 'poly') return '폴리코드팀 현황판';
    if (key === 'phone') return '회의 전화';
    if (key === 'slot') return '신규 자리';
    if (key === 'meeting') return '회의·휴게공간';
    return people[key] ? people[key].cfg.name : '';
  }

  function say(key, text, ms) {
    if (!text) return;
    if (!bubbleEl) {
      bubbleEl = document.createElement('div');
      bubbleEl.className = 'bubble';
      bubbleLayer.appendChild(bubbleEl);
    }
    bubbleEl.innerHTML = '<b></b><span></span>';
    bubbleEl.firstChild.textContent = bubbleTitle(key);
    bubbleEl.lastChild.textContent = text;
    bubbleEl.classList.add('show');
    bubbleKey = key;
    bubbleUntil = performance.now() + (ms || 5200);
  }

  function hideBubble() {
    if (bubbleEl) bubbleEl.classList.remove('show');
    bubbleKey = null;
  }

  function projectKey(key) {
    const w = anchorFor(key);
    tmpVec.copy(w).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (tmpVec.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-tmpVec.y * 0.5 + 0.5) * rect.height,
      visible: tmpVec.z < 1,
    };
  }

  /* ---------- 클릭 · 호버 ---------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  let hoverPick = null;

  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(picks, false);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      if (o.userData && o.userData.pick) return o.userData.pick;
      // 스프라이트·자식 메시도 부모의 pick 을 따라갑니다.
      let par = o.parent;
      while (par) {
        if (par.userData && par.userData.pick) return par.userData.pick;
        par = par.parent;
      }
    }
    return null;
  }

  renderer.domElement.addEventListener('pointerdown', function (e) {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });

  renderer.domElement.addEventListener('pointerup', function (e) {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 8 || dt > 700) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p) pickHandler(p.kind, p.key);
    else hideBubble();
  });

  renderer.domElement.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    const p = pickAt(e.clientX, e.clientY);
    const id = p ? p.kind + ':' + (p.key || '') : '';
    if (id !== hoverPick) {
      hoverPick = id;
      renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
    }
  });

  renderer.domElement.addEventListener('pointerleave', function () {
    renderer.domElement.style.cursor = 'grab';
  });

  /* ---------- 루프 ---------- */
  const clock = new THREE.Clock();

  function frame() {
    const t = clock.getElapsedTime();

    // 카메라 트윈
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.t0) / tween.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      controls.target.lerpVectors(tween.fromTgt, tween.toTgt, e);
      if (k >= 1) tween = null;
    }

    // 사람들 미세 동작
    Object.keys(people).forEach(function (key, i) {
      const p = people[key];
      const ph = i * 1.7;
      p.person.group.position.y = Math.sin(t * 1.1 + ph) * 0.006;
      if (p.stateCode === 'active') {
        const tap = Math.sin(t * 6 + ph) * 0.09;
        p.person.armL.rotation.x = -0.62 + tap;
        p.person.armR.rotation.x = -0.62 - tap;
        p.person.head.rotation.y = Math.sin(t * 0.9 + ph) * 0.12;
        p.ring.scale.setScalar(1 + Math.sin(t * 2.2) * 0.03);
      } else {
        p.person.armL.rotation.x = -0.62 + Math.sin(t * 0.8 + ph) * 0.015;
        p.person.armR.rotation.x = -0.62 - Math.sin(t * 0.9 + ph) * 0.015;
        p.person.head.rotation.y = Math.sin(t * 0.45 + ph) * 0.07;
        p.ring.scale.setScalar(1);
      }
    });

    // 신규 자리 펄스
    if (slotRing) {
      const s = 1 + Math.sin(t * 1.6) * 0.05;
      slotRing.scale.setScalar(s);
      slotRing.material.opacity = 0.32 + (Math.sin(t * 1.6) + 1) * 0.12;
    }
    // 전화 표시 펄스
    if (phoneRing) {
      const s = 1 + Math.sin(t * 2.3) * 0.06;
      phoneRing.scale.setScalar(0.4 * s);
      phoneRing.material.opacity = 0.82 + Math.sin(t * 2.3) * 0.14;
    }

    // 말풍선 따라가기
    if (bubbleEl && bubbleKey) {
      if (performance.now() > bubbleUntil) {
        hideBubble();
      } else {
        const p = projectKey(bubbleKey);
        if (p.visible) {
          bubbleEl.style.left = p.x + 'px';
          bubbleEl.style.top = (p.y - 10) + 'px';
          bubbleEl.style.visibility = 'visible';
        } else {
          bubbleEl.style.visibility = 'hidden';
        }
      }
    }

    // 패닝 한도를 방 안으로
    controls.target.x = Math.max(-8.5, Math.min(8.5, controls.target.x));
    controls.target.y = Math.max(0.2, Math.min(2.6, controls.target.y));
    controls.target.z = Math.max(-7.0, Math.min(6.6, controls.target.z));

    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.fov = fovForAspect(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const cls = aspectKind(camera.aspect);
    if (cls !== aspectClass) {
      const first = aspectClass === '';
      aspectClass = cls;
      if (!first) setView(currentView, true);
    }
  }

  window.addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(frame);
  setView('all', true);
  applyData({ connected: false, statuses: {} });
  drawClock('');

  return {
    setView: setView,
    applyData: applyData,
    say: say,
    hideBubble: hideBubble,
    projectKey: projectKey,
    resize: resize,
    appearance: function (key) {
      const p = people[key];
      if (!p) return null;
      return { name: p.cfg.name, emoji: p.cfg.emoji };
    },
  };
}
