'use strict';
// 空当接龙 FreeCell —— 纯原生 JS，无依赖

// ---------- 牌面 ----------
// 牌编号 0..51：点数 = (c >> 2) + 1，花色 = c & 3（♣ ♦ ♥ ♠）
const SUITS = ['♣', '♦', '♥', '♠'];
const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankOf = c => (c >> 2) + 1;
const suitOf = c => c & 3;
const isRed = c => (c & 3) === 1 || (c & 3) === 2;
const cardName = c => RANKS[rankOf(c)] + SUITS[suitOf(c)];

// 经典编号发牌算法（与 Windows 空当接龙的局号一致）
function dealGame(n) {
  let seed = n;
  const rnd = () => ((seed = (seed * 214013 + 2531011) & 0x7fffffff) >> 16);
  const cards = [];
  for (let i = 51; i >= 0; i--) cards.push(i);
  for (let i = 0; i < 52; i++) {
    const j = 51 - (rnd() % (52 - i));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const cols = [[], [], [], [], [], [], [], []];
  cards.forEach((c, i) => cols[i % 8].push(c));
  return cols;
}

// ---------- 状态 ----------
let S = null;            // 当前局面
let selected = null;     // { type:'col'|'cell', idx, n }
let busy = false;        // 自动上牌动画中
let timerId = null;
const els = {};          // 牌的 DOM 元素
let L = null;            // 布局尺寸

const board = document.getElementById('board');
const $ = id => document.getElementById(id);

function newState(n) {
  return {
    gameNo: n, cols: dealGame(n), cells: [null, null, null, null], found: [[], [], [], []],
    origin: [null, null, null, null],   // 空当中的牌来自哪一列：{ col, ver }
    colVer: [0, 0, 0, 0, 0, 0, 0, 0],   // 每列被改动的次数
    held: [],                           // 玩家从收牌区拿回来的牌：不自动收回
    score: 0,
    moves: 0, history: [], elapsed: 0, started: false, won: false,
  };
}

const snapshot = () => JSON.stringify({ cols: S.cols, cells: S.cells, found: S.found, moves: S.moves, origin: S.origin, colVer: S.colVer, held: S.held, score: S.score });
function restore(s) { Object.assign(S, JSON.parse(s)); }

// ---------- 音效（Web Audio 实时合成，无需音频文件） ----------
const Sound = (() => {
  let ctx = null;
  let unlocked = false; // 浏览器要求用户操作后才能发声
  let muted = false;
  try { muted = localStorage.getItem('freecell-muted') === '1'; } catch { /* 忽略 */ }

  function ac() {
    if (muted || !unlocked) return null;
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const unlock = () => { unlocked = true; };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);

  /** 一小段滤波噪声：模拟纸牌摩擦、拍在桌上的声音 */
  function noise(dur, { freq = 2200, q = 0.9, gain = 0.25, delay = 0, type = 'bandpass', sweep = 0 } = {}) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + delay;
    const n = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(50, freq * sweep), t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** 一个带衰减的音符 */
  function tone(freq, dur, { type = 'sine', gain = 0.14, delay = 0, slide = 0, attack = 0.005 } = {}) {
    const a = ac(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  const flick = (delay = 0, vol = 1) => {
    noise(0.06, { freq: 1700, q: 0.7, gain: 0.3 * vol, delay });
    noise(0.035, { freq: 5200, q: 1.2, gain: 0.1 * vol, delay: delay + 0.008 });
    tone(150, 0.05, { gain: 0.06 * vol, delay, slide: 0.6 });
  };
  // 五声音阶，收牌时点数越大音越高，听起来不会刺耳
  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

  return {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('freecell-muted', muted ? '1' : '0'); } catch { /* 忽略 */ }
      if (!muted) { unlocked = true; flick(); }
      return muted;
    },
    pick() { noise(0.04, { freq: 3200, q: 0.8, gain: 0.12, sweep: 1.6 }); },
    card() { flick(); },
    cell() { flick(0, 0.8); tone(330, 0.08, { type: 'triangle', gain: 0.05, delay: 0.01 }); },
    found(rank) {
      const f = 523.25 * 2 ** (SCALE[rank - 1] / 12);
      flick(0, 0.5);
      tone(f, 0.28, { type: 'triangle', gain: 0.13, delay: 0.015 });
      tone(f * 2, 0.18, { gain: 0.05, delay: 0.015 });
    },
    error() {
      tone(160, 0.12, { type: 'triangle', gain: 0.16, slide: 0.7 });
      tone(120, 0.16, { type: 'triangle', gain: 0.14, delay: 0.09, slide: 0.7 });
    },
    undo() { noise(0.14, { freq: 900, q: 1.5, gain: 0.18, sweep: 3.5 }); },
    hint() { tone(880, 0.14, { gain: 0.1 }); tone(1318.5, 0.24, { gain: 0.09, delay: 0.09 }); },
    click() { tone(660, 0.05, { type: 'triangle', gain: 0.07 }); },
    deal() { for (let i = 0; i < 13; i++) flick(i * 0.056, 0.55); },
    win() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
      notes.forEach((f, i) => {
        tone(f, 0.35, { type: 'triangle', gain: 0.13, delay: i * 0.11 });
        tone(f * 2, 0.2, { gain: 0.04, delay: i * 0.11 });
      });
      const end = notes.length * 0.11 + 0.05;
      [523.25, 659.25, 783.99, 1046.5].forEach(f => tone(f, 1.4, { type: 'triangle', gain: 0.09, delay: end, attack: 0.02 }));
    },
  };
})();

// ---------- 规则 ----------
const canStack = (below, c) => isRed(below) !== isRed(c) && rankOf(below) === rankOf(c) + 1;
function validSeq(cards) {
  for (let i = 1; i < cards.length; i++) if (!canStack(cards[i - 1], cards[i])) return false;
  return true;
}
const emptyCells = () => S.cells.filter(c => c === null).length;
const emptyCols = () => S.cols.filter(c => c.length === 0).length;
/** 一次最多能移动的张数（借助空当和空列） */
const maxMovable = toEmptyCol => (emptyCells() + 1) * 2 ** Math.max(0, emptyCols() - (toEmptyCol ? 1 : 0));

function canFoundOn(c, i) {
  const f = S.found[i];
  return f.length ? suitOf(f[f.length - 1]) === suitOf(c) && rankOf(c) === f.length + 1 : rankOf(c) === 1;
}
function foundationFor(c) {
  // 已有同花色的优先，否则第一个空位
  for (let i = 0; i < 4; i++) if (S.found[i].length && canFoundOn(c, i)) return i;
  for (let i = 0; i < 4; i++) if (canFoundOn(c, i)) return i;
  return -1;
}

function cardsOf(from) {
  if (from.type === 'found') { const f = S.found[from.idx]; return f.length ? [f[f.length - 1]] : []; }
  if (from.type === 'cell') return S.cells[from.idx] === null ? [] : [S.cells[from.idx]];
  const col = S.cols[from.idx];
  return col.slice(col.length - from.n);
}

/** 空当里的牌放回原处：它原来所在的列自那以后没有被动过（等同于那一步没走） */
function isReturn(from, to) {
  if (from.type !== 'cell' || to.type !== 'col') return false;
  const o = S.origin[from.idx];
  return !!o && o.col === to.idx && S.colVer[to.idx] === o.ver;
}

/** strict = true 时只按标准规则判断（用于提示和"无路可走"检测） */
function isLegal(from, to, strict = false) {
  const cards = cardsOf(from);
  const n = cards.length;
  if (!n || !validSeq(cards)) return false;
  if (from.type === to.type && from.idx === to.idx) return false;
  if (from.type === 'found' && to.type === 'found') return false;
  if (to.type === 'cell') return n === 1 && S.cells[to.idx] === null;
  if (to.type === 'found') return n === 1 && canFoundOn(cards[0], to.idx);
  if (!strict && isReturn(from, to)) return true;
  const col = S.cols[to.idx];
  if (!col.length) return n <= maxMovable(true);
  return canStack(col[col.length - 1], cards[0]) && n <= maxMovable(false);
}

function applyMove(from, to) {
  let cards, origin = null;
  if (from.type === 'cell') {
    cards = [S.cells[from.idx]]; S.cells[from.idx] = null;
    origin = S.origin[from.idx]; S.origin[from.idx] = null;
  } else if (from.type === 'found') {
    cards = [S.found[from.idx].pop()];
    S.held.push(cards[0]);
    S.score -= 10;
  } else {
    cards = S.cols[from.idx].splice(S.cols[from.idx].length - from.n, from.n);
    S.colVer[from.idx]++;
    origin = { col: from.idx, ver: S.colVer[from.idx] };
  }
  if (to.type === 'cell') { S.cells[to.idx] = cards[0]; S.origin[to.idx] = origin; }
  else if (to.type === 'found') { S.found[to.idx].push(cards[0]); S.held = S.held.filter(c => c !== cards[0]); S.score += 10; }
  else { S.cols[to.idx].push(...cards); S.colVer[to.idx]++; }
  S.moves++;
}

/** 从列中选中的长度为 n 的牌组，找到能放到目标的最大合法子组 */
function resolveMove(from, to) {
  if (from.type !== 'col') return isLegal(from, to) ? from : null;
  for (let n = from.n; n >= 1; n--) {
    const f = { ...from, n };
    if (isLegal(f, to)) return f;
  }
  return null;
}

// ---------- 执行与自动上牌 ----------
async function userMove(from, to) {
  if (busy || S.won) return false;
  const f = resolveMove(from, to);
  if (!f) return false;
  S.history.push(snapshot());
  applyMove(f, to);
  if (to.type === 'found') Sound.found(rankOf(cardsOfAfter(to, f)[0]));
  else if (to.type === 'cell') Sound.cell();
  else Sound.card();
  startTimer();
  selected = null;
  render([...cardsOfAfter(to, f)]);
  await autoPlay();
  afterMove();
  return true;
}
function cardsOfAfter(to, f) {
  const n = f.type === 'col' ? f.n : 1;
  if (to.type === 'cell') return [S.cells[to.idx]];
  if (to.type === 'found') return [S.found[to.idx][S.found[to.idx].length - 1]];
  return S.cols[to.idx].slice(-n);
}

function isSafeToFound(c) {
  if (S.held.includes(c)) return false;
  const r = rankOf(c);
  if (r <= 2) return true;
  const lens = [0, 0, 0, 0];
  for (const f of S.found) if (f.length) lens[suitOf(f[0])] = f.length;
  const opp = isRed(c) ? [0, 3] : [1, 2];
  return opp.every(s => lens[s] >= r - 1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function autoPlay() {
  busy = true;
  let moved = true;
  while (moved) {
    moved = false;
    const sources = [];
    S.cells.forEach((c, i) => { if (c !== null) sources.push({ from: { type: 'cell', idx: i }, c }); });
    S.cols.forEach((col, i) => { if (col.length) sources.push({ from: { type: 'col', idx: i, n: 1 }, c: col[col.length - 1] }); });
    for (const { from, c } of sources) {
      const fi = foundationFor(c);
      if (fi >= 0 && isSafeToFound(c)) {
        await sleep(110);
        applyMove(from, { type: 'found', idx: fi });
        Sound.found(rankOf(c));
        S.moves--; // 自动上牌不计步数
        render([c]);
        moved = true;
        break;
      }
    }
  }
  busy = false;
}

/** 自动播放：把所有能收的牌依次收到收牌区（包括玩家拿回来的牌） */
async function autoCollect() {
  if (busy || S.won) return;
  const snap = snapshot();
  let n = 0;
  busy = true;
  while (true) {
    let moved = false;
    const tops = [];
    S.cells.forEach((c, i) => { if (c !== null) tops.push({ from: { type: 'cell', idx: i }, c }); });
    S.cols.forEach((col, i) => { if (col.length) tops.push({ from: { type: 'col', idx: i, n: 1 }, c: col[col.length - 1] }); });
    tops.sort((a, b) => rankOf(a.c) - rankOf(b.c));
    for (const { from, c } of tops) {
      const fi = foundationFor(c);
      if (fi < 0) continue;
      if (!n) { S.history.push(snap); startTimer(); }
      await sleep(90);
      applyMove(from, { type: 'found', idx: fi });
      S.held = S.held.filter(x => x !== c);
      Sound.found(rankOf(c));
      render([c]); updateInfo();
      n++; moved = true;
      break;
    }
    if (!moved) break;
  }
  busy = false;
  if (!n) { Sound.error(); toast('现在没有能收到右上角的牌'); return; }
  afterMove();
}

function afterMove() {
  updateInfo();
  if (S.found.every(f => f.length === 13)) return win();
  if (!anyLegalMove()) toast('已经无路可走了，试试撤销吧', 4000);
}

function undo() {
  if (busy || !S.history.length || S.won) return;
  restore(S.history.pop());
  Sound.undo();
  selected = null;
  render();
  updateInfo();
}

// ---------- 提示 ----------
function allMoves() {
  const moves = [];
  const sources = [];
  S.cells.forEach((c, i) => { if (c !== null) sources.push({ type: 'cell', idx: i }); });
  S.cols.forEach((col, i) => {
    for (let n = 1; n <= col.length; n++) {
      if (!validSeq(col.slice(col.length - n))) break;
      sources.push({ type: 'col', idx: i, n });
    }
  });
  const targets = [];
  for (let i = 0; i < 4; i++) targets.push({ type: 'found', idx: i }, { type: 'cell', idx: i });
  for (let i = 0; i < 8; i++) targets.push({ type: 'col', idx: i });
  for (const from of sources) for (const to of targets) {
    if (to.type === 'cell' && S.cells.indexOf(null) !== to.idx) continue; // 空当只算一个
    if (isLegal(from, to, true)) moves.push({ from, to });
  }
  return moves;
}
const anyLegalMove = () => allMoves().length > 0;

function scoreMove({ from, to }) {
  const srcCol = from.type === 'col' ? S.cols[from.idx] : null;
  const revealsOrEmpties = srcCol && srcCol.length > from.n;
  if (to.type === 'found') return 100;
  if (to.type === 'col') {
    const empty = !S.cols[to.idx].length;
    if (from.type === 'cell') return empty ? 40 : 70;
    if (srcCol && srcCol.length === from.n) return empty ? -1 : 50; // 整列挪动
    if (empty) return 20 + from.n;
    return revealsOrEmpties ? 60 + from.n : 10;
  }
  if (to.type === 'cell') return from.type === 'col' ? 5 : -1;
  return 0;
}

function hint() {
  if (busy || S.won) return;
  const moves = allMoves().map(m => ({ m, s: scoreMove(m) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s);
  if (!moves.length) return toast('没有可走的步了');
  const { from, to } = moves[0].m;
  Sound.hint();
  const src = cardsOf(from);
  let dst = [];
  if (to.type === 'col' && S.cols[to.idx].length) dst = [S.cols[to.idx][S.cols[to.idx].length - 1]];
  if (to.type === 'found' && S.found[to.idx].length) dst = [S.found[to.idx][S.found[to.idx].length - 1]];
  const ids = [...src, ...dst];
  ids.forEach(c => els[c].classList.add('hint'));
  const slot = !dst.length ? slotEl(to) : null;
  slot?.classList.add('drop-ok');
  setTimeout(() => { ids.forEach(c => els[c].classList.remove('hint')); slot?.classList.remove('drop-ok'); }, 1300);
}

// ---------- 布局与渲染 ----------
const slots = { cell: [], found: [], col: [] };

function buildBoard() {
  board.innerHTML = '';
  for (let i = 0; i < 4; i++) slots.cell.push(mkSlot('slot', ''));
  for (let i = 0; i < 4; i++) slots.found.push(mkSlot('slot', ''));
  for (let i = 0; i < 8; i++) slots.col.push(mkSlot('slot col', ''));
  for (let c = 0; c < 52; c++) {
    const e = document.createElement('div');
    e.className = 'card ' + (isRed(c) ? 'red' : 'black') + (rankOf(c) > 10 ? ' court' : '');
    e.innerHTML = cardFace(c);
    e.dataset.c = c;
    e.addEventListener('pointerdown', onPointerDown);
    board.appendChild(e);
    els[c] = e;
  }
  slots.cell.concat(slots.found, slots.col).forEach(s => s.addEventListener('pointerdown', onSlotDown));
  slots.cell.forEach((s, i) => { s.dataset.type = 'cell'; s.dataset.idx = i; });
  slots.found.forEach((s, i) => { s.dataset.type = 'found'; s.dataset.idx = i; });
  slots.col.forEach((s, i) => { s.dataset.type = 'col'; s.dataset.idx = i; });
}
// 牌面使用 SVG-cards 图集（cards/svg-cards.js，LGPL-2.1）
const CARD_W = 169.075, CARD_H = 244.64;
const SVG_SUIT = ['club', 'diamond', 'heart', 'spade'];
const SVG_RANK = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];

function injectSprite() {
  if (!window.SVG_CARDS || document.getElementById('svg-cards-sprite')) return;
  const holder = document.createElement('div');
  // 不能用 display:none，否则图集里的渐变在部分浏览器中不渲染
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  holder.innerHTML = window.SVG_CARDS;
  document.body.prepend(holder);
}

/**
 * 人头牌：从图集的整张牌里只取出人物（两个半身像 + 中间斜带），
 * 去掉原牌的底板、角标和大花色，生成 fig_<花色>_<jack|queen|king> 供牌面引用
 */
function buildFigures() {
  const sprite = document.getElementById('svg-cards-sprite');
  if (!sprite || document.getElementById('fig_spade_king')) return;
  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS, 'defs');
  for (const suit of SVG_SUIT) for (const k of ['jack', 'queen', 'king']) {
    const src = document.getElementById(`${suit}_${k}`);
    if (!src) continue;
    const g = document.createElementNS(NS, 'g');
    g.id = `fig_${suit}_${k}`;
    g.setAttribute('transform', src.getAttribute('transform') || '');
    for (const ch of src.children) {
      const href = ch.getAttribute('xlink:href') || ch.getAttribute('href') || '';
      const isFigure = ch.tagName === 'use' && /#(king|queen|jack)_\d/.test(href);
      const isBand = ch.tagName === 'g' && ch.querySelector('line');
      if (isFigure || isBand) g.appendChild(ch.cloneNode(true));
    }
    defs.appendChild(g);
  }
  sprite.appendChild(defs);
}
// 原牌画框的范围（牌面坐标），人物正好占满它
const FIG_BOX = '9.25 4.85 151.57 233.94';
const CARD_RATIO = 1.36;   // 牌的高宽比

// 数字牌点阵（传统排法；x、y 为牌面百分比，下半部分倒置）
const PIP_X = [28, 50, 72];
const R1 = 15, R4 = 85;                           // 最上、最下一排
const R2 = R1 + (R4 - R1) / 3, R3 = R1 + (R4 - R1) * 2 / 3;
const PIP_LAYOUT = {
  2: [[1, R1], [1, R4]],
  3: [[1, R1], [1, 50], [1, R4]],
  4: [[0, R1], [2, R1], [0, R4], [2, R4]],
  5: [[0, R1], [2, R1], [1, 50], [0, R4], [2, R4]],
  6: [[0, R1], [2, R1], [0, 50], [2, 50], [0, R4], [2, R4]],
  7: [[0, R1], [2, R1], [1, (R1 + 50) / 2], [0, 50], [2, 50], [0, R4], [2, R4]],
  8: [[0, R1], [2, R1], [1, (R1 + 50) / 2], [0, 50], [2, 50], [1, (R4 + 50) / 2], [0, R4], [2, R4]],
  9: [[0, R1], [2, R1], [0, R2], [2, R2], [1, 50], [0, R3], [2, R3], [0, R4], [2, R4]],
  10: [[0, R1], [2, R1], [1, (R1 + R2) / 2], [0, R2], [2, R2], [0, R3], [2, R3], [1, (R3 + R4) / 2], [0, R4], [2, R4]],
};

const suitSvg = (suit, cls, style = '') =>
  `<svg class="${cls}" ${style ? `style="${style}"` : ''} viewBox="0 0 15.42 15.88"><use href="#suit-${SVG_SUIT[suit]}"/></svg>`;

function cardFace(c) {
  const rank = rankOf(c), suit = suitOf(c), r = RANKS[rank];
  const corner = cls => `<div class="corner ${cls}"><b${rank === 10 ? ' class="ten"' : rank === 11 ? ' class="jack"' : ''}>${r}</b>${suitSvg(suit, 'cs')}</div>`;
  let body;
  if (rank === 1) body = suitSvg(suit, 'ace');
  else if (rank <= 10) body = PIP_LAYOUT[rank].map(([xi, y]) =>
    suitSvg(suit, 'pip' + (y > 50 ? ' flip' : ''), `left:${PIP_X[xi]}%;top:${y}%`)).join('');
  else {
    body = `<div class="art"><svg viewBox="${FIG_BOX}" preserveAspectRatio="xMidYMid meet"><use href="#fig_${SVG_SUIT[suit]}_${SVG_RANK[rank]}"/></svg></div>`;
  }
  return corner('tl') + body + corner('br');
}

function mkSlot(cls, text) {
  const d = document.createElement('div');
  d.className = cls; d.textContent = text;
  board.appendChild(d);
  return d;
}
const slotEl = p => slots[p.type][p.idx];

/**
 * 布局比例（以牌宽 cw 为单位）：
 * 8 列之间间距 0.35cw，两侧留白约 0.32cw；空当靠左、收牌区靠右，同组间距 0.27cw；
 * 空位上沿距顶栏 0.085 牌高，空位与牌列之间 0.145 牌高；叠放间距 0.25 牌高
 */
function computeLayout() {
  // 可用区域：顶栏以下、右侧工具栏以左
  const W = Math.max(200, $('toolbar').getBoundingClientRect().left - board.getBoundingClientRect().left);
  const barH = $('bar').offsetHeight;
  const H = window.innerHeight - barH - 16;
  const cw = Math.max(36, Math.min(W / 11.09, H / (3.9 * CARD_RATIO)));
  const ch = cw * CARD_RATIO;
  const g = cw * 0.35, sg = cw * 0.27;
  const G = cw * 8 + g * 7;
  const left = (W - G) / 2;
  const colX = i => left + i * (cw + g);
  const cellX = i => left + i * (cw + sg);
  const foundX = i => left + G - (4 - i) * cw - (3 - i) * sg;
  const topY = ch * 0.085;
  const colY = topY + ch * 1.145;
  const avail = Math.max(ch * 0.6, H - colY - ch - ch * 0.05);
  L = { cw, ch, gap: ch * 0.05, colX, cellX, foundX, topY, colY, avail };
  board.style.width = W + 'px';
  board.style.setProperty('--cw', cw + 'px');
}

function colOffset(n) {
  if (n <= 1) return 0;
  // 正常间距为牌高的 25%；画面不能滚动，所以列太长时继续压缩，保证整列都在屏幕内
  return Math.max(L.ch * 0.08, Math.min(L.ch * 0.25, L.avail / (n - 1)));
}

/** 计算每张牌的位置；movedIds 内的牌在动画期间临时置顶 */
function render(movedIds = []) {
  if (!L) computeLayout();
  const { cw, ch, colX, cellX, foundX, topY, colY } = L;
  const place = (s, left, top) => { s.style.left = left + 'px'; s.style.top = top + 'px'; s.style.width = cw + 'px'; s.style.height = ch + 'px'; };
  slots.cell.forEach((s, i) => place(s, cellX(i), topY));
  slots.found.forEach((s, i) => place(s, foundX(i), topY));
  let bottom = colY + ch;
  slots.col.forEach((s, i) => place(s, colX(i), colY));

  const pos = (c, left, top, z) => {
    const e = els[c];
    e.style.left = left + 'px'; e.style.top = top + 'px';
    e.style.zIndex = movedIds.includes(c) ? 500 + z : z;
    e.classList.remove('dragging');
    e.style.transform = '';
  };
  S.cells.forEach((c, i) => { if (c !== null) pos(c, cellX(i), topY, 10); });
  S.found.forEach((f, i) => f.forEach((c, k) => pos(c, foundX(i), topY, 10 + k)));
  S.cols.forEach((col, i) => {
    const off = colOffset(col.length);
    col.forEach((c, k) => pos(c, colX(i), colY + k * off, 20 + k));
    if (col.length) bottom = Math.max(bottom, colY + (col.length - 1) * off + ch);
  });
  board.style.height = bottom + L.gap * 2 + 'px';
  if (movedIds.length) setTimeout(() => movedIds.forEach(c => {
    const e = els[c]; if (e.style.zIndex >= 500) e.style.zIndex = e.style.zIndex - 500;
  }), 200);

  // 选中高亮
  document.querySelectorAll('.card.sel').forEach(e => e.classList.remove('sel'));
  if (selected) cardsOf(selected).forEach(c => els[c].classList.add('sel'));
}

// ---------- 输入：点击 / 双击 / 拖拽 ----------
function locate(c) {
  const ci = S.cells.indexOf(c);
  if (ci >= 0) return { type: 'cell', idx: ci };
  for (let i = 0; i < 8; i++) {
    const k = S.cols[i].indexOf(c);
    if (k >= 0) return { type: 'col', idx: i, n: S.cols[i].length - k };
  }
  for (let i = 0; i < 4; i++) if (S.found[i].includes(c)) return { type: 'found', idx: i };
  return null;
}
const pileOf = loc => ({ type: loc.type, idx: loc.idx });

let drag = null;
let lastClick = { c: -1, t: 0 };

function onPointerDown(e) {
  if (busy || S.won || e.button > 0) return;
  e.stopPropagation();
  const c = +e.currentTarget.dataset.c;
  const loc = locate(c);
  if (!loc) return;
  if (loc.type === 'found' && S.found[loc.idx][S.found[loc.idx].length - 1] !== c) return; // 只有最上面一张能动
  drag = { c, loc, x0: e.clientX, y0: e.clientY, active: false, ids: [], id: e.pointerId };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  window.addEventListener('pointercancel', onPointerCancel, { once: true });
}

function onPointerCancel() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  document.querySelectorAll('.slot.drop-ok').forEach(s => s.classList.remove('drop-ok'));
  if (drag) { drag = null; render(); }
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < 6) return;
    const ids = cardsOf(drag.loc);
    if (!validSeq(ids)) { drag = null; return; }
    drag.active = true;
    Sound.pick();
    drag.ids = ids;
    selected = null;
    render();
    ids.forEach((c, i) => { els[c].classList.add('dragging'); els[c].style.zIndex = 1000 + i; });
  }
  drag.ids.forEach(c => els[c].style.transform = `translate(${dx}px, ${dy}px)`);
  // 高亮可放置的位置
  const tgt = dropTarget(e);
  document.querySelectorAll('.slot.drop-ok').forEach(s => s.classList.remove('drop-ok'));
  if (tgt && isLegal(drag.loc, tgt)) slotEl(tgt).classList.add('drop-ok');
}

async function onPointerUp(e) {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointercancel', onPointerCancel);
  document.querySelectorAll('.slot.drop-ok').forEach(s => s.classList.remove('drop-ok'));
  if (!drag) return;
  const d = drag; drag = null;
  if (d.active) {
    const tgt = dropTarget(e);
    if (!tgt || !isLegal(d.loc, tgt)) {
      if (tgt && !(tgt.type === d.loc.type && tgt.idx === d.loc.idx)) Sound.error();
      if (tgt && tgt.type === 'col' && d.loc.type === 'col') {
        const need = d.loc.n, max = maxMovable(!S.cols[tgt.idx].length);
        if (need > max) toast(`空当不足，当前最多只能移动 ${max} 张`);
      }
      render();
      return;
    }
    await userMove(d.loc, tgt);
    return;
  }
  onCardClick(d.c, d.loc);
}

/** 拖拽释放点所在的牌堆：取与被拖牌重叠面积最大的那个 */
function dropTarget(e) {
  const first = els[drag ? drag.ids[0] : -1];
  const br = board.getBoundingClientRect();
  let rx, ry;
  if (first) { const r = first.getBoundingClientRect(); rx = r.left - br.left; ry = r.top - br.top; }
  else { rx = e.clientX - br.left - L.cw / 2; ry = e.clientY - br.top - L.ch / 3; }
  const piles = [];
  for (let i = 0; i < 4; i++) {
    piles.push({ p: { type: 'cell', idx: i }, x: L.cellX(i), y: L.topY, h: L.ch });
    piles.push({ p: { type: 'found', idx: i }, x: L.foundX(i), y: L.topY, h: L.ch });
  }
  for (let i = 0; i < 8; i++) {
    const n = S.cols[i].length;
    piles.push({ p: { type: 'col', idx: i }, x: L.colX(i), y: L.colY, h: Math.max(1, n - 1) * colOffset(n) + L.ch });
  }
  let best = null, bestA = 0;
  for (const q of piles) {
    const ox = Math.max(0, Math.min(rx + L.cw, q.x + L.cw) - Math.max(rx, q.x));
    const oy = Math.max(0, Math.min(ry + L.ch, q.y + q.h) - Math.max(ry, q.y));
    const a = ox * oy;
    if (a > bestA) { bestA = a; best = q.p; }
  }
  return best;
}

/** 单击：自动把牌移到最合适的位置 */
async function onCardClick(c, loc) {
  if (loc.type === 'found') { await clickFoundation(c, loc); return; }
  const seq = cardsOf(loc);
  if (!validSeq(seq)) { Sound.error(); shake(seq); toast('这几张牌不是连续的，不能一起移动'); return; }
  const top = loc.type === 'cell' || loc.n === 1;
  const wholeCol = loc.type === 'col' && loc.n === S.cols[loc.idx].length;
  const tries = [];
  // 1. 收牌区
  if (top) { const fi = foundationFor(c); if (fi >= 0) tries.push({ type: 'found', idx: fi }); }
  // 2. 能接上的非空列
  for (let i = 0; i < 8; i++) if (S.cols[i].length) tries.push({ type: 'col', idx: i });
  // 3. 空列（整列挪到空列没有意义）
  const ei = S.cols.findIndex(col => !col.length);
  if (ei >= 0 && !wholeCol) tries.push({ type: 'col', idx: ei });
  // 4. 空当
  const ci = S.cells.indexOf(null);
  if (top && ci >= 0 && loc.type !== 'cell') tries.push({ type: 'cell', idx: ci });

  for (const to of tries) {
    if (isLegal(loc, to)) { await userMove(loc, to); return; }
  }
  Sound.error();
  shake(seq);
  if (loc.type === 'col' && loc.n > 1 && loc.n > maxMovable(false)) toast(`空当不足，当前最多只能一次移动 ${maxMovable(false)} 张`);
  else if (loc.type === 'cell' && S.origin[loc.idx]) toast('原来那一列已经变动，不能放回了；目前也没有别的位置能接这张牌');
  else toast('这张牌暂时没有地方可以移动');
}

/** 点击收牌区最上面的牌：拿回牌局（接到能接的列，否则放到空列） */
async function clickFoundation(c, loc) {
  for (let i = 0; i < 8; i++) {
    if (S.cols[i].length && isLegal(loc, { type: 'col', idx: i })) { await userMove(loc, { type: 'col', idx: i }); return; }
  }
  const ei = S.cols.findIndex(col => !col.length);
  if (ei >= 0) { await userMove(loc, { type: 'col', idx: ei }); return; }
  Sound.error();
  shake([c]);
  toast('没有能接这张牌的列（也可以把它拖到空当）');
}

function shake(cards) {
  cards.forEach(c => {
    const e = els[c];
    e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake');
    setTimeout(() => e.classList.remove('shake'), 400);
  });
}

function onSlotDown() { /* 单击模式下点空位无操作 */ }

// ---------- 计时、信息、统计 ----------
function startTimer() {
  if (S.started) return;
  S.started = true;
  const st = loadStats(); st.played++; saveStats(st);
  const t0 = performance.now() - S.elapsed * 1000;
  clearInterval(timerId);
  timerId = setInterval(() => { S.elapsed = Math.floor((performance.now() - t0) / 1000); updateInfo(); }, 500);
}
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
function updateInfo() {
  $('game-no').textContent = S.gameNo;
  $('time').textContent = fmt(S.elapsed);
  $('score').textContent = S.score;
  $('btn-undo').disabled = !S.history.length || S.won;
  $('btn-auto').disabled = S.won;
}

const STATS_KEY = 'freecell-stats';
function loadStats() {
  try { return { played: 0, won: 0, best: null, streak: 0, bestStreak: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') }; }
  catch { return { played: 0, won: 0, best: null, streak: 0, bestStreak: 0 }; }
}
function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* 忽略 */ } }

function win() {
  S.won = true;
  Sound.win();
  clearInterval(timerId);
  const st = loadStats();
  st.won++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
  const newBest = st.best === null || S.elapsed < st.best;
  if (newBest) st.best = S.elapsed;
  saveStats(st);
  updateInfo();
  S.found.forEach(f => els[f[12]].classList.add('celebrate'));
  setTimeout(() => showModal(`<h2>🎉 恭喜过关！</h2>
    <p>第 ${S.gameNo} 局，得分 <b>${S.score}</b>，用时 <b>${fmt(S.elapsed)}</b>，共 <b>${S.moves}</b> 步${newBest ? '，<b>刷新最快纪录！</b>' : ''}</p>
    ${statsHtml(st)}`, [{ label: '再来一局', primary: true, fn: () => startGame(randomGameNo()) }]), 700);
}

function statsHtml(st) {
  const rate = st.played ? Math.round(st.won / st.played * 100) : 0;
  return `<div class="stats">
    <span>已玩<b>${st.played}</b></span><span>胜局<b>${st.won}</b></span>
    <span>胜率<b>${rate}%</b></span><span>最快<b>${st.best === null ? '-' : fmt(st.best)}</b></span>
    <span>连胜<b>${st.streak}</b></span><span>最高连胜<b>${st.bestStreak}</b></span></div>`;
}

// ---------- 弹窗与提示 ----------
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function showModal(html, buttons) {
  const box = $('modal-box');
  box.innerHTML = html + `<div class="btns">${buttons.map((b, i) =>
    `<button data-i="${i}" class="${b.primary ? 'primary' : ''}">${b.label}</button>`).join('')}</div>`;
  $('modal').classList.remove('hidden');
  box.querySelectorAll('.btns button').forEach(el => el.onclick = () => {
    const b = buttons[+el.dataset.i];
    if (b.fn && b.fn() === false) return;
    hideModal();
  });
}
const hideModal = () => $('modal').classList.add('hidden');

// ---------- 开局 ----------
const randomGameNo = () => 1 + Math.floor(Math.random() * 32000);

function startGame(n) {
  // 中途放弃一局视为输，连胜中断
  if (S && S.started && !S.won) { const st = loadStats(); st.streak = 0; saveStats(st); }
  clearInterval(timerId);
  S = newState(n);
  selected = null;
  busy = false;
  document.querySelectorAll('.card.celebrate').forEach(e => e.classList.remove('celebrate'));
  dealAnimation();
  updateInfo();
  try { localStorage.setItem('freecell-last', String(n)); } catch { /* 忽略 */ }
}

/** 所有牌先收拢到牌桌上方中央，再依次发到各列 */
function dealAnimation() {
  if (!L) computeLayout();
  const x = (L.cellX(3) + L.foundX(0)) / 2, y = L.topY;
  for (let c = 0; c < 52; c++) {
    const e = els[c];
    e.style.transition = 'none'; e.style.left = x + 'px'; e.style.top = y + 'px'; e.style.zIndex = 1;
  }
  void board.offsetWidth;
  let i = 0;
  for (let row = 0; row < 7; row++) for (let col = 0; col < 8; col++) {
    const c = S.cols[col][row];
    if (c === undefined) continue;
    els[c].style.transition = '';
    els[c].style.transitionDelay = (i++) * 14 + 'ms';
  }
  render();
  Sound.deal();
  const state = S;
  busy = true;
  setTimeout(() => {
    for (let c = 0; c < 52; c++) els[c].style.transitionDelay = '';
    if (S === state) busy = false;
  }, 52 * 14 + 260);
}

function confirmLeave(fn) {
  if (!S.started || S.won) return fn();
  showModal('<h2>放弃本局？</h2><p>当前这局还没完成，放弃会中断连胜。</p>', [
    { label: '取消' }, { label: '确定', primary: true, fn },
  ]);
}

function pickGame() {
  showModal(`<h2>选择局号</h2><p>输入 1 – 1000000 之间的局号（与经典版局号相同）。</p>
    <input id="pick-no" type="number" min="1" max="1000000" value="${S.gameNo}" />`, [
    { label: '取消' },
    { label: '开始', primary: true, fn: () => {
      const n = Math.floor(+$('pick-no').value);
      if (!(n >= 1 && n <= 1000000)) { toast('局号无效'); return false; }
      startGame(n);
    } },
  ]);
  setTimeout(() => { const i = $('pick-no'); i?.focus(); i?.select(); }, 0);
}

function help() {
  showModal(`<h2>玩法说明</h2><ul>
    <li>目标：把 52 张牌按花色从 A 到 K 全部移到右上角的收牌区。</li>
    <li>列中的牌只能叠在<b>颜色相反、点数大 1</b> 的牌上。</li>
    <li>左上角 4 个空当各能暂放一张牌；空列可放任意牌。</li>
    <li>空当里的牌，如果它原来那一列之后没被动过，点一下可以<b>放回原处</b>。</li>
    <li>收牌区最上面的牌可以<b>拿回牌局</b>：点击会接到能接的列或空列，也可以拖到空当。</li>
    <li>可以一次移动多张连续的牌，张数受空当和空列数量限制。</li>
    <li><b>操作</b>：<b>单击</b>牌会自动移到最合适的位置（收牌区 → 能接上的列 → 空列 → 空当）；也可以拖拽到指定位置。</li>
    <li><b>自动播放</b>：把当前能收的牌全部收到右上角。</li>
    <li>快捷键：Ctrl+Z 撤销、H 提示、A 自动播放、M 音效开关、F2 新游戏。</li></ul>
    ${statsHtml(loadStats())}`, [{ label: '知道了', primary: true }]);
}

// ---------- 启动 ----------
const restartGame = () => confirmLeave(() => { const n = S.gameNo; if (S.started && !S.won) { const st = loadStats(); st.streak = 0; saveStats(st); } S = null; startGame(n); });
const newGame = () => confirmLeave(() => startGame(randomGameNo()));
function toggleSound() { Sound.toggle(); toast(Sound.muted ? '音效已关闭' : '音效已开启'); }
// iPad / iPhone：Safari 的网页全屏模式下频繁点击会弹出"网站可能在诱导你输入密码"的安全警告，
// 所以在这些设备上不用全屏 API，而是引导用户"添加到主屏幕"，从主屏幕图标打开即为全屏，没有警告。
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches || window.navigator.standalone === true;
if (IS_STANDALONE) document.documentElement.classList.add('standalone');

function iosFullscreenHelp() {
  showModal(`<h2>在 iPad 上全屏玩</h2>
    <p>把游戏添加到主屏幕，就能像 App 一样全屏打开：</p>
    <ol class="steps">
      <li>点 Safari 地址栏右侧的 <b>分享</b> 按钮（方框加向上箭头）</li>
      <li>在菜单里选 <b>添加到主屏幕</b></li>
      <li>点右上角 <b>添加</b></li>
      <li>以后从主屏幕上的 <b>空当接龙</b> 图标打开即可</li>
    </ol>
    <p class="note">这种方式不会出现"网站诱导输入密码"的警告。Safari 自带的网页全屏模式会对频繁点击发出这个警告，所以在 iPad 上不再使用它。</p>`,
    [{ label: '知道了', primary: true }]);
}

function toggleFullscreen() {
  if (IS_IOS) { iosFullscreenHelp(); return; }
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('浏览器不允许全屏'));
}

function menuModal(title, items) {
  showModal(`<h2>${title}</h2><div class="menu">${items.map((it, i) => `<button data-m="${i}">${it.label}</button>`).join('')}</div>`, [{ label: '关闭' }]);
  $('modal-box').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { hideModal(); items[+b.dataset.m].fn(); });
}

$('btn-game').onclick = () => menuModal('游戏', [
  { label: '🎲 随机新局', fn: newGame },
  { label: '🔢 按局号选局', fn: () => confirmLeave(pickGame) },
  { label: '↺ 重玩本局', fn: restartGame },
]);
$('btn-new').onclick = newGame;
$('btn-undo').onclick = undo;
$('btn-hint').onclick = hint;
$('btn-auto').onclick = autoCollect;
$('btn-score').onclick = () => showModal(`<h2>得分</h2>
  <p>本局（第 ${S.gameNo} 局）：得分 <b>${S.score}</b>　用时 <b>${fmt(S.elapsed)}</b>　步数 <b>${S.moves}</b></p>
  <p style="color:#666;font-size:14px;margin:0">每收一张牌到右上角 +10 分，从右上角拿回 −10 分。</p>
  ${statsHtml(loadStats())}`, [{ label: '确定', primary: true }]);
$('btn-menu').onclick = () => menuModal('菜单', [
  { label: (Sound.muted ? '🔇 音效：关（点击开启）' : '🔊 音效：开（点击关闭）'), fn: toggleSound },
  ...(IS_STANDALONE ? [] : [{ label: IS_IOS ? '⛶ 全屏玩（添加到主屏幕）' : '⛶ 全屏 / 退出全屏', fn: toggleFullscreen }]),
  { label: '❓ 玩法说明', fn: help },
]);
$('btn-full').onclick = toggleFullscreen;
$('modal').addEventListener('pointerdown', e => { if (e.target === $('modal')) hideModal(); });

window.addEventListener('keydown', e => {
  if (!$('modal').classList.contains('hidden')) {
    if (e.key === 'Escape') hideModal();
    if (e.key === 'Enter') $('modal-box').querySelector('button.primary')?.click();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'F2') { e.preventDefault(); $('btn-new').click(); }
  else if (e.key.toLowerCase() === 'h') hint();
  else if (e.key.toLowerCase() === 'm') toggleSound();
  else if (e.key.toLowerCase() === 'a') autoCollect();
  else if (e.key === 'Escape') { selected = null; render(); }
});
window.addEventListener('resize', () => { computeLayout(); render(); });
window.addEventListener('orientationchange', () => setTimeout(() => { computeLayout(); render(); }, 300));
document.addEventListener('fullscreenchange', () => setTimeout(() => { computeLayout(); render(); }, 50));

// ---------- 锁定画面：不缩放、不滚动 ----------
(() => {
  const stop = e => e.preventDefault();
  const opt = { passive: false };
  // Safari 的双指缩放手势
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, stop, opt));
  // 多指触摸（双指缩放），以及弹窗外的任何拖动滚动
  document.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, opt);
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1 || !e.target.closest('#modal .box')) e.preventDefault();
  }, opt);
  // 双击放大：第二次轻点时阻止默认行为；若点的是按钮，手动补发一次点击
  let lastEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastEnd < 400 && e.changedTouches.length === 1) {
      e.preventDefault();
      const btn = e.target.closest('button');
      if (btn && !btn.disabled) btn.click();
    }
    lastEnd = now;
  }, opt);
  document.addEventListener('dblclick', stop, opt);
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input')) e.preventDefault(); });
  // 电脑浏览器：Ctrl+滚轮、触控板双指缩放、Ctrl +/-/0
  window.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); }, opt);
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault();
  }, opt);
  // 万一页面被系统滚动了，立即复位
  window.addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
})();

injectSprite();
buildFigures();
buildBoard();
let first = randomGameNo();
try { const last = +localStorage.getItem('freecell-last'); if (last) first = last; } catch { /* 忽略 */ }
startGame(first);
if (new URLSearchParams(location.search).has('debug')) window.__fc = { autoCollect, get L() { return L; }, get S() { return S; }, dealGame, render, autoPlay, afterMove, cardName, userMove, undo, allMoves, isLegal, maxMovable, hint, onCardClick, locate };
