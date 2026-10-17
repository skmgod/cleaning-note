'use strict';
/* 반짝 청소노트 — 청소 일정 · 고객 · 매출 관리 (오프라인 PWA)
 * 데이터: localStorage(일정/고객), IndexedDB(사진) — 모두 휴대폰 안에만 저장됩니다. */

const $ = (s, el = document) => el.querySelector(s);
const KEY = 'cleannote.v1';

// 기본 청소 종류 (앱에서 추가 · 이름변경 · 삭제 가능 → db.types)
const DEFAULT_TYPES = ['입주청소', '이사청소', '에어컨청소', '기타'];
const TYPE_LOOK = {
  정기청소: ['🧹', '#FFEFA8'], 입주청소: ['🏠', '#FFD9BD'], 이사청소: ['📦', '#DCE8FF'],
  사무실청소: ['🏢', '#D9F2E3'], 에어컨청소: ['❄️', '#D4F0FA'], 기타: ['✨', '#ECE2FF'],
};
const TYPE_COLORS = ['#FFEFA8', '#FFD9BD', '#DCE8FF', '#D9F2E3', '#D4F0FA', '#ECE2FF', '#F9DDE8'];
const PAY = ['현금', '카드', '계좌이체'];
const AVATAR = ['#FFE58A', '#FFD3B0', '#D8E6FF', '#D6F0E0', '#F5DDF0', '#E2E2FF'];
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/* ---------- 저장소 ---------- */
let db = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.jobs)) { d.types ||= [...DEFAULT_TYPES]; d.repairs ||= []; d.repairPhotos ||= []; d.complaints ||= []; d.housingNotes ||= []; return d; }
  } catch (e) { /* 손상된 데이터면 새로 시작 */ }
  return { customers: [], jobs: [], types: [...DEFAULT_TYPES], repairs: [], repairPhotos: [], complaints: [], housingNotes: [] };
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }

const PhotoDB = (() => {
  let conn;
  const open = () => conn ||= new Promise((res, rej) => {
    const r = indexedDB.open('cleannote-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('photos');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('photos', mode);
      const req = fn(t.objectStore('photos'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    put: (id, blob) => tx('readwrite', s => s.put(blob, id)),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id)),
    clear: () => tx('readwrite', s => s.clear()),
  };
})();

/* ---------- 유틸 ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
function addMonths(s, n) {
  const d = parseYmd(s), day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  r.setDate(Math.min(day, new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return ymd(r);
}
function shiftMonth(m, n) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
const won = n => (n || 0).toLocaleString('ko-KR') + '원';
const man = n => n >= 10000 ? `${Math.round(n / 1000) / 10}만` : (n || 0).toLocaleString('ko-KR');
const toNum = v => +String(v ?? '').replace(/[^\d]/g, '') || 0;
const sum = arr => arr.reduce((a, j) => a + (j.price || 0), 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const smsHref = p => 'sms:' + String(p || '').replace(/[^\d+]/g, '');
const mapHref = a => 'https://map.naver.com/p/search/' + encodeURIComponent(a || '');
const dateLabel = s => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]})`; };
const byDateTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
function fmtDur(min) {
  if (!min) return '기록 없음';
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h}시간`, m && `${m}분`].filter(Boolean).join(' ');
}
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const hm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/* ---------- AI 답 · 말한 내용 → 예약 칸 채우기 ---------- */
// AI가 준 문장(또는 🎤로 말한 문장)에서 건물명·호수·비번·날짜·시간·금액·종류를 찾아 채웁니다.
// 완벽하지 않으니 채운 뒤 꼭 확인하고 등록하세요.
const AI_PASTE_HTML = `
  <details class="ai-paste" open>
    <summary>🤖 AI 답 · 말한 내용 붙여넣기</summary>
    <textarea id="ai-text" rows="4" placeholder="예: 다음주 화요일 오후 2시 래미안 아파트 101동 1203호 입주청소 15만원 비번 1234"></textarea>
    <div class="ai-paste-foot"><span>🎤 키보드 마이크로 말해도 돼요</span><button type="button" class="chip-btn on" data-action="paste-fill">채우기</button></div>
  </details>`;
const RAW_LABELS = [
  [/^(건물명?|장소|아파트|빌딩)$/, 'building'],
  [/^(호|호수|동호수|호실)$/, 'unit'],
  [/^(비번|비밀번호|암호|도어락|pw)$/i, 'doorPw'],
  [/^(날짜|일자|일정)$/, 'date'],
  [/^(시간|시각)$/, 'time'],
  [/^(금액|가격|요금|비용)$/, 'price'],
  [/^(종류|청소종류|유형)$/, 'type'],
  [/^(메모|비고|특이사항|특이)$/, 'memo'],
];
const PLACE_END = /(아파트|빌딩|타워|오피스텔|맨션|빌라|오피스|상가|센터|파크|캐슬|자이|푸르지오|힐스테이트|단지)$/;
const plusDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// 문장 → { building, unit, doorPw, date, time, price, type, memo } (찾은 것만 담김)
function parseReservation(text, types = db.types, now = new Date()) {
  const raw = {};
  const free = [];
  for (const line of String(text || '').split(/\n+/)) {
    const m = line.match(/^\s*[-*•]?\s*([가-힣a-zA-Z]{1,6})\s*[:：]\s*(.+?)\s*$/);
    const hit = m && RAW_LABELS.find(([re]) => re.test(m[1]));
    if (hit) raw[hit[1]] = m[2];
    else free.push(line);
  }
  const s = free.join(' ');
  const out = {
    building: (raw.building || '').trim() || findBuilding(s),
    unit: extractUnit(raw.unit || s) || (raw.unit || '').trim(),
    doorPw: raw.doorPw ? raw.doorPw.replace(/\s/g, '') : extractPw(s),
    date: parseDate(raw.date || s, now),
    time: parseTime(raw.time || s),
    price: parsePrice(raw.price || s),
    type: matchType(raw.type || s, types),
    memo: (raw.memo || '').trim(),
    phone: findPhone(raw.phone || s),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

function findBuilding(s) {
  const words = s.split(/\s+/).map(w => w.replace(/[,.!?]+$/, ''));
  const i = words.findIndex(w => PLACE_END.test(w));
  if (i < 0) return '';
  const prev = words[i - 1];
  const usePrev = prev && /^[가-힣A-Za-z·]+$/.test(prev) && !/(요일|주|시|분|원|오전|오후|다음|이번|오늘|내일|모레|예약|등록)$/.test(prev);
  return (usePrev ? prev + ' ' : '') + words[i];
}
function extractUnit(s) {
  const m = s.match(/(\d{1,4}\s*동\s*)?\d{1,4}\s*호/);
  return m ? m[0].replace(/\s*동\s*/, '동 ').replace(/\s+호/, '호').trim() : '';
}
function extractPw(s) {
  const m = s.match(/(?:비밀번호|비번|암호|도어락|pw)\s*[:은는이가]?\s*([0-9*#]{3,})/i);
  return m ? m[1] : '';
}
function parseDate(s, now) {
  if (!s) return '';
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m = s.match(/(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
  if (m) return ymd(new Date(+m[1], +m[2] - 1, +m[3]));
  if (/오늘/.test(s)) return ymd(base);
  if (/내일/.test(s)) return ymd(plusDays(base, 1));
  if (/모레/.test(s)) return ymd(plusDays(base, 2));
  m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || s.match(/(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (m) {
    const d = new Date(base.getFullYear(), +m[1] - 1, +m[2]);
    if (d < base) d.setFullYear(d.getFullYear() + 1);
    return ymd(d);
  }
  m = s.match(/([일월화수목금토])\s*요일/);
  if (m) {
    const target = WD.indexOf(m[1]);
    const monday = plusDays(base, -((base.getDay() + 6) % 7));
    if (/다음\s*주/.test(s)) return ymd(plusDays(monday, ((target + 6) % 7) + 7));
    if (/이번\s*주/.test(s)) return ymd(plusDays(monday, (target + 6) % 7));
    return ymd(plusDays(base, (target - base.getDay() + 7) % 7));
  }
  m = s.match(/(\d{1,2})\s*일/);
  if (m) {
    const d = new Date(base.getFullYear(), base.getMonth(), +m[1]);
    if (d < base) d.setMonth(d.getMonth() + 1);
    return ymd(d);
  }
  return '';
}
function parseTime(s) {
  if (!s) return '';
  let m = s.match(/(\d{1,2}):(\d{2})/);
  if (m && +m[1] < 24) return `${pad(+m[1])}:${m[2]}`;
  m = s.match(/(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분)?(\s*반)?/);
  if (!m) return '';
  let h = +m[2];
  const min = m[4] ? 30 : (m[3] ? +m[3] : 0);
  if (['오후', '저녁', '밤'].includes(m[1])) { if (h < 12) h += 12; }
  else if (['오전', '아침'].includes(m[1])) { if (h === 12) h = 0; }
  else if (h >= 1 && h <= 6) h += 12; // 오전/오후 말이 없으면 1~6시는 오후로 봄
  if (h > 23) return '';
  return `${pad(h)}:${pad(min)}`;
}
function parsePrice(s) {
  if (!s) return 0;
  let m = s.match(/(\d+(?:\.\d+)?)\s*만/);
  if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = s.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/);
  return m ? +m[1].replace(/,/g, '') : 0;
}
function matchType(s, types) {
  let best = '';
  for (const t of types) {
    const key = t.replace(/청소$/, '');
    if ((s.includes(t) || (key.length >= 2 && s.includes(key))) && t.length > best.length) best = t;
  }
  return best;
}
// 찾은 값을 예약 칸에 넣기 (저장은 사용자가 확인 후 직접)
function applyParsed(form, p) {
  const filled = [];
  if (p.building) { form.building.value = p.building; form.building.dispatchEvent(new Event('change')); filled.push('건물명'); }
  if (p.unit) { form.unit.value = p.unit; filled.push('호수'); }
  if (p.doorPw) { form.doorPw.value = p.doorPw; filled.push('비밀번호'); }
  if (p.phone && form.phone) { form.phone.value = p.phone; filled.push('전화번호'); }
  if (p.date) { form.date.value = p.date; filled.push('날짜'); }
  if (p.time) { form.time.value = p.time; filled.push('시간'); }
  if (p.price) { form.price.value = p.price.toLocaleString('ko-KR'); filled.push('금액'); }
  if (p.type) {
    const r = [...form.querySelectorAll('input[name=type]')].find(x => x.value === p.type);
    if (r) { r.checked = true; $('.type-chips', form).dataset.sel = p.type; filled.push('종류'); }
  }
  if (p.memo) { form.memo.value = p.memo; filled.push('메모'); }
  toast(filled.length ? `${filled.join(' · ')} 채웠어요. 확인 후 등록하세요` : '채울 내용을 찾지 못했어요');
}

const cust = id => db.customers.find(c => c.id === id);
const findJob = id => db.jobs.find(j => j.id === id);
function typeOf(t) {
  const name = t || '기타';
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const [emoji, color] = TYPE_LOOK[name] || ['✨', TYPE_COLORS[hash % TYPE_COLORS.length]];
  return { id: name, emoji, color };
}
// 예약 제목: 고객 이름이 있으면 이름, 없으면 건물명 호수
const jobTitle = j => cust(j.customerId)?.name || [j.building, j.unit].filter(Boolean).join(' ') || '청소 예약';
const jobsOn = d => db.jobs.filter(j => j.date === d).sort(byDateTime);
// "(주)밝은사무" → "밝"
const initial = n => (n.replace(/\(.*?\)|[^\p{L}\p{N}]/gu, '')[0] || n[0] || '?');
const avatarColor = s => AVATAR[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

const I = d => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const IC = {
  back: I('<path d="M15 5l-7 7 7 7"/>'),
  left: I('<path d="M15 6l-6 6 6 6"/>'),
  right: I('<path d="M9 6l6 6-6 6"/>'),
  down: I('<path d="M6 9l6 6 6-6"/>'),
  phone: I('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>'),
  msg: I('<path d="M4 5h16v11H9l-5 4z"/>'),
  pin: I('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trash: I('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
  gear: I('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M2.5 12h3M18.5 12h3M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  camera: I('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  search: I('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),
  cal: I('<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  won: I('<path d="M4 7l3 10 3-8 2 0 3 8 3-10M3 11h18"/>'),
  photo: I('<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20 16l-5-5-8 8"/>'),
  note: I('<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z"/><path d="M9 11h7M9 15h5"/>'),
};
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M16 30 32 17l16 13v17a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2z" fill="#4A2C12"/><path d="M32 29.5l2.2 5 5 2.2-5 2.2-2.2 5-2.2-5-5-2.2 5-2.2z" fill="#FFD000"/><path d="M48 9l1.4 3.4 3.4 1.4-3.4 1.4L48 18.6l-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#FFB800"/></svg>`;

/* ---------- 화면 상태 ---------- */
const ui = { selDate: today(), statMonth: today().slice(0, 7), custQuery: '' };
let navCount = 0;
const app = $('#app');
const currentPage = () => location.hash.replace(/^#\/?/, '').split('/');

function render(keepScroll = false) {
  const y = window.scrollY;
  const [page = 'home', id] = currentPage();
  const pages = { home, schedule, customers, housing: housingPage, complaints: complaintsPage, billing: billingPage, stats, settings, job: jobPage, customer: customerPage };
  const fn = pages[page] || home;
  document.body.classList.toggle('detail', ['job', 'customer', 'settings', 'complaints', 'billing'].includes(page));
  app.innerHTML = fn(id);
  document.querySelectorAll('#tabbar [data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === (pages[page] ? page : 'home')));
  hydratePhotos();
  document.querySelector('[data-autofocus]')?.focus();
  tickTimer();
  window.scrollTo(0, keepScroll ? y : 0);
}
const refresh = () => render(true);
const go = path => { location.hash = '#/' + path; };
// 앱 안에서 이동해 온 경우에만 history.back (뒤로 가면 hashchange로 다시 +1 되므로 2를 뺌)
function goBack() {
  if (navCount > 0) { navCount -= 2; history.back(); } else go('home');
}

/* ---------- 공통 조각 ---------- */
function jobCard(j, showDate = false) {
  const c = cust(j.customerId), t = typeOf(j.type), d = parseYmd(j.date);
  const nPh = j.photos.before.length + j.photos.after.length;
  const state = j.paid ? ['paid', '결제완료'] : j.done ? ['unpaid', '미수'] : ['', '예정'];
  return `
  <article class="job ${j.done ? 'is-done' : ''}" data-go="job/${j.id}">
    <button class="check ${j.done ? 'on' : ''}" data-action="toggle-done" data-id="${j.id}" aria-label="완료 체크">${IC.check}</button>
    <div class="job-main">
      <p class="job-meta">${showDate ? `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) · ` : ''}${j.time} · ${t.emoji} ${t.id}${j.source === 'housing' ? ' · 🏢 주택관리' : ''}</p>
      <p class="job-name">${esc(jobTitle(j))}</p>
      ${placeOf(j) || c?.address ? `<p class="job-addr">${esc(placeOf(j) || c.address)}</p>` : ''}
    </div>
    <div class="job-side">
      <p class="job-price">${won(j.price)}</p>
      <span class="badge ${state[0]}">${state[1]}</span>
      ${nPh ? `<span class="ph-count">📸 ${nPh}</span>` : ''}
    </div>
  </article>`;
}
const placeOf = j => [j.building, j.unit].filter(Boolean).join(' ');
// 비밀번호는 가려두고 눌러야 보이게
const pwBox = j => j.doorPw
  ? `<button class="pw" data-action="toggle-pw"><span class="pw-hide">●●●● 보기</span><span class="pw-show">${esc(j.doorPw)}</span></button>`
  : '<span class="muted">없음</span>';
function resvCard(j) {
  const c = cust(j.customerId), t = typeOf(j.type);
  return `
  <article class="resv ${j.done ? 'is-done' : ''}">
    <div class="resv-top" data-go="job/${j.id}">
      <span class="resv-circ" style="background:${t.color}">${t.emoji}</span>
      <div class="resv-main">
        <p class="job-meta">${dateLabel(j.date)} ${j.time} · ${t.id}</p>
        <p class="job-name">${esc(jobTitle(j))}</p>
      </div>
      <span class="badge ${j.done ? 'done' : ''}">${j.done ? '완료' : '예약'}</span>
    </div>
    ${j.phone ? `<a class="resv-call" href="${telHref(j.phone)}">📞 ${esc(j.phone)}</a>` : ''}
    <dl class="resv-info">
      <div><dt>건물명</dt><dd>${esc(j.building) || '<span class="muted">없음</span>'}</dd></div>
      <div><dt>호수</dt><dd>${esc(j.unit) || '<span class="muted">없음</span>'}</dd></div>
      <div><dt>비밀번호</dt><dd>${pwBox(j)}</dd></div>
    </dl>
    <div class="resv-btns">
      <button class="btn" data-action="edit-job" data-id="${j.id}">${IC.edit}수정</button>
      <button class="btn danger" data-action="delete-job" data-id="${j.id}">${IC.trash}삭제</button>
    </div>
  </article>`;
}
const emptyBox = (emo, text, btn = '') => `<div class="empty"><span class="emo">${emo}</span>${text}${btn}</div>`;

/* ---------- 홈 ---------- */
function home() {
  const t = today(), d = parseYmd(t);
  const td = jobsOn(t), left = td.filter(j => !j.done).length;
  const m = t.slice(0, 7);
  const mj = db.jobs.filter(j => j.date.startsWith(m));
  const sales = sum(mj.filter(j => j.done)), planned = sum(mj.filter(j => !j.done));
  const unpaid = db.jobs.filter(j => j.done && !j.paid);
  const weekJobs = db.jobs.filter(j => j.date > t && j.date <= addDays(t, 7));
  const tomorrow = jobsOn(addDays(t, 1)).length;
  const upcoming = db.jobs.filter(j => j.date >= t && !j.done).sort(byDateTime).slice(0, 50);
  const isEmpty = !db.jobs.length && !db.customers.length;

  const headline = td.length
    ? `오늘 청소 <em>${td.length}건</em>,<br>${left ? `남은 일정 ${left}건이에요!` : '모두 끝! 수고했어요 👏'}`
    : `오늘은 쉬는 날!<br>새 청소를 <em>잡아볼까요?</em>`;

  const circles = td.map(j => {
    const c = cust(j.customerId), ty = typeOf(j.type);
    return `<button class="circ" data-go="job/${j.id}">
      <span class="circ-img" style="background:${ty.color}">${ty.emoji}${j.done ? `<i class="done-mark">${IC.check}</i>` : ''}</span>
      <b>${esc(jobTitle(j))}</b><small>${j.time} · ${ty.id}</small></button>`;
  }).join('') + `<button class="circ add" data-action="new-job" data-date="${t}"><span class="circ-img">${IC.plus}</span><b>일정 추가</b><small>오늘</small></button>`;

  return `
  <section class="home-top">
    <div class="topline">
      <div class="brand">${LOGO}반짝 청소노트</div>
      <button class="icon-btn" data-go="settings" aria-label="설정">${IC.gear}</button>
    </div>
    <div class="hero">
      <h1>${headline}</h1>
      <p class="tags">#${d.getMonth() + 1}월${d.getDate()}일 #${WD[d.getDay()]}요일</p>
      <button class="pill" data-go="schedule">${IC.cal} 전체 일정 보기 <b>${db.jobs.filter(j => j.date >= t && !j.done).length}건</b></button>
      <div class="hero-art" aria-hidden="true">
        <span class="blob"></span><span class="emo">🧽</span>
        <span class="spark" style="right:8px;top:6px">✨</span><span class="spark" style="right:112px;top:34px;font-size:16px">🫧</span>
      </div>
    </div>
    <div class="circles">${circles}</div>
  </section>

  ${isEmpty ? `
  <section class="welcome">
    <h3>반가워요! 🧹</h3>
    <p>청소 일정, 고객, 매출을 한 곳에서 관리해요.<br>샘플 데이터로 먼저 둘러보셔도 좋아요.</p>
    <div class="btns"><button class="btn ghost" data-action="sample">샘플로 둘러보기</button><button class="btn yellow" data-action="new-job">첫 일정 등록</button></div>
  </section>` : ''}

  <section class="banner" data-go="stats">
    <span class="b-more">통계 보기</span>
    <p class="b-sub">${d.getMonth() + 1}월 매출</p>
    <p class="b-big">${won(sales)}</p>
    <p class="b-sub2">완료 ${mj.filter(j => j.done).length}건 · 예정 ${won(planned)}</p>
    <span class="b-art" aria-hidden="true">💰</span>
  </section>

  <article class="promo" data-go="stats">
    <div><p>아직 받지 못한 금액</p><p class="strong orange">미수금 ${unpaid.length}건 · ${won(sum(unpaid))}</p></div>
    <span class="promo-art" style="background:#FF8A4C">💸</span>
  </article>
  <article class="promo" data-go="schedule">
    <div><p>다가오는 청소 일정</p><p class="strong blue">내일 ${tomorrow}건 · 7일 내 ${weekJobs.length}건</p></div>
    <span class="promo-art" style="background:#FFD54A">📅</span>
  </article>
  <article class="promo" data-go="customers">
    <div><p>관리 중인 고객</p><p class="strong green">총 ${db.customers.length}명</p></div>
    <span class="promo-art" style="background:#BFE3FF">👥</span>
  </article>

  <h2 class="sec-title">청소 예약 <button class="more" data-go="schedule">전체보기${IC.right}</button></h2>
  <button class="resv-add" data-action="new-job" data-date="${t}">
    <span class="fab-mini">${IC.plus}</span>
    <span><b>청소 예약 등록</b><small>건물명 · 호수 · 비밀번호까지 한 번에</small></span>
    ${IC.right}
  </button>
  ${upcoming.length ? upcoming.map(resvCard).join('') : emptyBox('🗓️', '예약된 청소가 없어요')}`;
}

/* ---------- 일정 ---------- */
function schedule() {
  const sel = ui.selDate, t = today(), sd = parseYmd(sel);
  const start = addDays(sel, -sd.getDay());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const list = jobsOn(sel);
  const doneN = list.filter(j => j.done).length;

  return `
  <section class="page-head">
    <div class="row"><h1>청소 일정</h1><button class="btn yellow" style="height:40px;padding:0 14px" data-action="new-job" data-date="${sel}">${IC.plus}추가</button></div>
    <div class="month-nav">
      <label class="month-pick">${sd.getFullYear()}년 ${sd.getMonth() + 1}월 ${IC.down}<input type="date" data-date-jump value="${sel}"></label>
      <div class="arrows">
        <button class="small-pill" data-action="go-today">오늘</button>
        <button class="icon-btn" data-action="week-shift" data-n="-7" aria-label="이전 주">${IC.left}</button>
        <button class="icon-btn" data-action="week-shift" data-n="7" aria-label="다음 주">${IC.right}</button>
      </div>
    </div>
    <div class="week">${days.map((ds, i) => `
      <button class="day ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''} ${ds === sel ? 'on' : ''} ${ds === t ? 'today' : ''} ${jobsOn(ds).length ? 'has' : ''}" data-action="pick-date" data-date="${ds}">
        <small>${WD[i]}</small><b>${parseYmd(ds).getDate()}</b><span class="dot"></span>
      </button>`).join('')}
    </div>
  </section>
  <div class="list-head"><h2>${dateLabel(sel)}${sel === t ? ' · 오늘' : ''}</h2><span>${list.length}건${list.length ? ` · 완료 ${doneN}` : ''}</span></div>
  ${list.length ? list.map(j => jobCard(j)).join('')
    : emptyBox('🫧', '이 날은 청소 일정이 없어요', `<br><button class="btn yellow" data-action="new-job" data-date="${sel}">${IC.plus}일정 추가</button>`)}`;
}

/* ---------- 고객 ---------- */
function custList() {
  const q = ui.custQuery.trim();
  const list = db.customers
    .filter(c => !q || `${c.name} ${c.phone} ${c.address}`.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  if (!list.length) return emptyBox('👥', q ? '검색 결과가 없어요' : '등록된 고객이 없어요', q ? '' : `<br><button class="btn yellow" data-action="new-customer">${IC.plus}고객 등록</button>`);
  return list.map(c => {
    const jobs = db.jobs.filter(j => j.customerId === c.id);
    const total = sum(jobs.filter(j => j.done));
    return `
    <article class="cust" data-go="customer/${c.id}">
      <span class="avatar" style="background:${avatarColor(c.name)}">${esc(initial(c.name))}</span>
      <div class="cust-main">
        <b>${esc(c.name)}</b>
        <p>${esc(c.phone || '연락처 없음')}${c.address ? ' · ' + esc(c.address) : ''}</p>
        <p class="meta">청소 ${jobs.filter(j => j.done).length}회 · 누적 ${won(total)}</p>
      </div>
      ${c.phone ? `<a class="round-btn" href="${telHref(c.phone)}" aria-label="전화">${IC.phone}</a>` : ''}
    </article>`;
  }).join('');
}
function customers() {
  return `
  <section class="page-head">
    <div class="row"><h1>고객 관리</h1><button class="btn yellow" style="height:40px;padding:0 14px" data-action="new-customer">${IC.plus}등록</button></div>
    <p class="sub">총 ${db.customers.length}명</p>
    <label class="search">${IC.search}<input type="search" placeholder="이름, 전화번호, 주소 검색" value="${esc(ui.custQuery)}" data-cust-search></label>
  </section>
  <div style="height:14px"></div>
  <div id="cust-list">${custList()}</div>`;
}

/* ---------- 매출 ---------- */
function stats() {
  const m = ui.statMonth, [y, mm] = m.split('-').map(Number);
  const rows = salesRows(m);
  const isClean = r => r.kind === 'clean';
  const cleanDirect = sumBy(rows.filter(r => isClean(r) && r.src === 'direct'), r => r.sales);
  const cleanHouse = sumBy(rows.filter(r => isClean(r) && r.src === 'housing'), r => r.sales);
  const houseRows = rows.filter(r => !isClean(r));
  const houseSales = sumBy(houseRows, r => r.sales);
  const houseRetail = sumBy(houseRows, r => r.retail);
  const houseCost = sumBy(houseRows, r => r.wholesale);
  const total = cleanDirect + cleanHouse + houseSales;
  const unpaidAmt = sumBy(rows.filter(r => !r.paid), r => r.retail);
  const paidAmt = sumBy(rows.filter(r => r.paid), r => r.retail);

  // 최근 6개월 추이
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(m, i - 5));
  const hist = months.map(k => {
    const rr = salesRows(k);
    return {
      direct: sumBy(rr.filter(r => r.kind === 'clean' && r.src === 'direct'), r => r.sales),
      cleanHouse: sumBy(rr.filter(r => r.kind === 'clean' && r.src === 'housing'), r => r.sales),
      house: sumBy(rr.filter(r => r.kind === 'housing'), r => r.sales),
    };
  });

  // 묶어서 합계 (건물별 · 수리내용별 · 청소 종류별 · 결제 수단별)
  const group = (list, keyFn) => {
    const map = {};
    for (const r of list) { const k = keyFn(r) || '기타'; map[k] = (map[k] || 0) + r.sales; }
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const topBld = group(rows, r => r.bld || r.place).slice(0, 5);
  const byItem = group(houseRows, r => r.what).slice(0, 6);
  const byType = group(rows.filter(isClean), r => r.what).slice(0, 6);
  const byPay = PAY.map(p => ({ label: p, value: sumBy(rows.filter(r => r.paid && r.pay === p), r => r.sales) })).filter(x => x.value);

  const rowHtml = r => {
    const tag = r.kind === 'housing' ? ['hs', '🏢 주택관리 수리'] : r.src === 'housing' ? ['hs', '🧹 청소 · 주택관리에서'] : ['cl', '🧹 청소 · 직접 고객'];
    const payBtn = r.paid ? '<span class="sl-paid">받음</span>'
      : `<button class="mini-btn" data-action="${r.kind === 'clean' ? 'quick-pay' : 'hs-toggle-paid'}" data-id="${r.id}">받음</button>`;
    return `
    <article class="sl-row ${r.paid ? 'is-paid' : ''}">
      <div class="sl-main" data-action="sales-open" data-kind="${r.kind}" data-id="${r.id}">
        <div class="sl-top"><span class="sl-badge ${tag[0]}">${tag[1]}</span><span class="sl-date">${dateLabel(r.date)}</span></div>
        <b class="sl-place">${esc(r.place)}</b>
        <p class="sl-what">${esc(r.what)}</p>
        <div class="sl-nums"><span>소비자가격 ${won(r.retail)}</span>${r.kind === 'housing' ? `<span>도매가 ${won(r.wholesale)}</span>` : ''}<strong>매출 ${won(r.sales)}</strong></div>
      </div>
      <div class="sl-side">${payBtn}</div>
    </article>`;
  };

  return `
  <section class="page-head">
    <div class="row"><h1>매출 · 그래프</h1></div>
    <div class="month-nav" style="margin-bottom:0">
      <button class="icon-btn" data-action="month-shift" data-n="-1" aria-label="이전 달">${IC.left}</button>
      <b style="font-size:17px">${y}년 ${mm}월</b>
      <button class="icon-btn" data-action="month-shift" data-n="1" aria-label="다음 달">${IC.right}</button>
    </div>
  </section>

  <section class="stat-hero">
    <p class="lbl">${mm}월 매출</p>
    <p class="big">${won(total)}</p>
    <p class="s">청소 ${won(cleanDirect + cleanHouse)} · 주택관리 ${won(houseSales)}</p>
    <span class="b-art" aria-hidden="true">📈</span>
  </section>
  <div class="tiles sl-tiles">
    <div class="tile"><small>청소 · 직접 고객</small><b>${man(cleanDirect)}</b></div>
    <div class="tile"><small>청소 · 주택관리에서</small><b>${man(cleanHouse)}</b></div>
    <div class="tile"><small>주택관리 수리 매출</small><b class="green">${man(houseSales)}</b></div>
    <div class="tile"><small>도매가 (원가)</small><b>${man(houseCost)}</b></div>
    <div class="tile"><small>받을 금액</small><b class="orange">${man(unpaidAmt)}</b></div>
    <div class="tile"><small>받은 금액</small><b class="green">${man(paidAmt)}</b></div>
  </div>

  <h2 class="sl-sec">🧾 무엇이 매출이 되었나 <small>${rows.length}건</small></h2>
  <p class="sl-help">청소는 완료한 예약 금액 전체, 주택관리는 소비자가격에서 도매가를 뺀 금액이 매출이에요. 누르면 자세히 볼 수 있어요.</p>
  ${rows.length ? rows.map(rowHtml).join('') : emptyBox('🫧', '이 달에는 매출이 없어요')}

  <h2 class="sl-sec">📊 그래프</h2>
  <div class="ch-grid">
    <section class="ch-card wide">
      <h3>월별 매출 추이 <small>최근 6개월 · 청소와 주택관리 나눠 보기</small></h3>
      ${svgStackedBars(months.map(k => +k.slice(5) + '월'), [
        { name: '청소·직접', color: CHART_COLOR.direct, values: hist.map(h => h.direct) },
        { name: '청소·주택관리', color: CHART_COLOR.house2, values: hist.map(h => h.cleanHouse) },
        { name: '주택관리 수리', color: CHART_COLOR.house, values: hist.map(h => h.house) },
      ])}
      <div class="ch-legend-row">
        <span><i style="background:${CHART_COLOR.direct}"></i>청소·직접</span>
        <span><i style="background:${CHART_COLOR.house2}"></i>청소·주택관리</span>
        <span><i style="background:${CHART_COLOR.house}"></i>주택관리 수리</span>
      </div>
    </section>
    <section class="ch-card">
      <h3>매출 구성</h3>
      ${svgDonut([
        { label: '청소 · 직접', value: cleanDirect, color: CHART_COLOR.direct },
        { label: '청소 · 주택관리', value: cleanHouse, color: CHART_COLOR.house2 },
        { label: '주택관리 수리', value: houseSales, color: CHART_COLOR.house },
      ], man(total))}
    </section>
    <section class="ch-card">
      <h3>받을 돈 · 받은 돈 <small>소비자가격 기준</small></h3>
      ${svgDonut([
        { label: '받은 금액', value: paidAmt, color: CHART_COLOR.ok },
        { label: '받을 금액', value: unpaidAmt, color: CHART_COLOR.warn },
      ], man(unpaidAmt))}
    </section>
    <section class="ch-card wide">
      <h3>주택관리 가격 구조 <small>이번 달 수리 전체</small></h3>
      ${priceBar(houseRetail, houseCost)}
    </section>
    <section class="ch-card wide">
      <h3>건물별 매출 TOP 5</h3>
      ${svgHBars(topBld)}
    </section>
    <section class="ch-card">
      <h3>수리내용별 매출</h3>
      ${svgHBars(byItem, CHART_COLOR.house)}
    </section>
    <section class="ch-card">
      <h3>청소 종류별 매출</h3>
      ${svgHBars(byType, CHART_COLOR.direct)}
    </section>
    <section class="ch-card wide">
      <h3>결제 수단별 <small>받은 청소 매출</small></h3>
      ${svgHBars(byPay, CHART_COLOR.ok)}
    </section>
  </div>
  <div style="height:12px"></div>`;
}

/* ---------- 일정 상세 ---------- */
function photoBlock(j, kind, label) {
  const arr = j.photos[kind];
  return `
  <div class="ph-group">
    <p class="ph-label">${label}<small>${arr.length}장</small></p>
    <div class="ph-grid">
      ${arr.map(pid => `<button class="ph" data-action="view-photo" data-id="${j.id}" data-kind="${kind}" data-pid="${pid}"><img data-photo="${pid}" alt="${label} 사진"></button>`).join('')}
      <label class="ph add">${IC.camera}<span>추가</span><input type="file" accept="image/*" multiple hidden data-photo-input data-kind="${kind}" data-id="${j.id}"></label>
    </div>
  </div>`;
}
function jobPage(id) {
  const j = findJob(id);
  if (!j) return notFound();
  const c = cust(j.customerId);
  const t = typeOf(j.type);
  const running = j.startedAt && !j.endedAt;

  return `
  <header class="bar">
    <button class="icon-btn" data-action="back" aria-label="뒤로">${IC.back}</button><h2>일정 상세</h2>
    <button class="icon-btn" data-action="edit-job" data-id="${j.id}" aria-label="수정">${IC.edit}</button>
    <button class="icon-btn" data-action="delete-job" data-id="${j.id}" aria-label="삭제">${IC.trash}</button>
  </header>

  <section class="detail-hero">
    <span class="hero-circ" style="background:${t.color}">${t.emoji}</span>
    <p class="type">${t.id}</p>
    <h1>${esc(jobTitle(j))}</h1>
    <p class="when">${dateLabel(j.date)} ${j.time}</p>
    <p class="price">${won(j.price)}</p>
    <span class="badge ${j.done ? 'done' : ''}">${j.done ? '✓ 청소 완료' : '예정'}</span>${j.source === 'housing' ? '<span class="badge job-src">🏢 주택관리에서</span>' : ''}
  </section>

  ${j.phone ? `<section class="card">
    <h3>👤 고객 연락처</h3>
    <div class="info-row">${IC.phone}<span>${esc(j.phone)}</span></div>
    <div class="btn-row"><a class="btn yellow" href="${telHref(j.phone)}">${IC.phone}전화 걸기</a><a class="btn" href="${smsHref(j.phone)}">${IC.msg}문자</a></div>
  </section>` : ''}

  <section class="card">
    <h3>🏢 청소 장소 <button class="right" data-action="edit-job" data-id="${j.id}">수정 ›</button></h3>
    <dl class="resv-info flat">
      <div><dt>건물명</dt><dd>${esc(j.building) || '<span class="muted">없음</span>'}</dd></div>
      <div><dt>호수</dt><dd>${esc(j.unit) || '<span class="muted">없음</span>'}</dd></div>
      <div><dt>비밀번호</dt><dd>${pwBox(j)}</dd></div>
    </dl>
  </section>

  ${c ? `<section class="card">
    <h3>고객 정보 <button class="right" data-go="customer/${c.id}">고객 보기 ›</button></h3>
    <div class="info-row">${IC.pin}<span>${esc(c.address || '주소 없음')}</span>${c.address ? `<a class="link" href="${mapHref(c.address)}" target="_blank" rel="noopener">지도</a>` : ''}</div>
    <div class="info-row">${IC.phone}<span>${esc(c.phone || '연락처 없음')}</span></div>
    ${c.phone ? `<div class="btn-row"><a class="btn yellow" href="${telHref(c.phone)}">${IC.phone}전화 걸기</a><a class="btn" href="${smsHref(c.phone)}">${IC.msg}문자</a></div>` : ''}
  </section>` : ''}

  <section class="card">
    <h3>${IC.clock}소요 시간 <button class="right" data-action="edit-duration" data-id="${j.id}">직접 입력</button></h3>
    ${running
      ? `<p class="timer"><span class="running-dot"></span><span id="timer-live" data-start="${j.startedAt}">${clock(Date.now() - j.startedAt)}</span></p>
         <p class="timer-sub">${hm(j.startedAt)} 시작 · 측정 중</p>
         <button class="btn dark big" data-action="timer-stop" data-id="${j.id}">■ 측정 종료</button>`
      : `<p class="timer off">${fmtDur(j.durationMin)}</p>
         <p class="timer-sub">${j.startedAt && j.endedAt ? `${hm(j.startedAt)} ~ ${hm(j.endedAt)}` : '청소 시작할 때 눌러주세요'}</p>
         <button class="btn yellow big" data-action="timer-start" data-id="${j.id}">▶ ${j.durationMin ? '다시 측정' : '청소 시작'}</button>`}
  </section>

  <section class="card">
    <h3>${IC.won}결제</h3>
    <div class="seg">
      <button class="${!j.paid ? 'on unpaid' : ''}" data-action="set-paid" data-id="${j.id}" data-v="0">미수</button>
      <button class="${j.paid ? 'on paid' : ''}" data-action="set-paid" data-id="${j.id}" data-v="1">결제 완료</button>
    </div>
    <div class="chips" style="margin:0">${PAY.map(p => `<button class="chip-btn ${j.payMethod === p ? 'on' : ''}" data-action="set-method" data-id="${j.id}" data-v="${p}">${p}</button>`).join('')}</div>
    ${j.paid && j.paidAt ? `<p class="pay-note">${dateLabel(ymd(new Date(j.paidAt)))} ${hm(j.paidAt)} 결제 확인</p>` : ''}
  </section>

  <section class="card">
    <h3>${IC.photo}청소 사진</h3>
    ${photoBlock(j, 'before', '청소 전')}
    ${photoBlock(j, 'after', '청소 후')}
  </section>

  ${j.memo ? `<section class="card"><h3>${IC.note}메모</h3><p class="memo">${esc(j.memo)}</p></section>` : ''}

  <div class="action-bar">
    <button class="btn big ${j.done ? 'ghost' : 'yellow'}" data-action="toggle-done" data-id="${j.id}">
      ${j.done ? '✓ 완료됨 · 취소하려면 누르세요' : `${IC.check}청소 완료 체크`}
    </button>
  </div>`;
}

/* ---------- 고객 상세 ---------- */
function customerPage(id) {
  const c = cust(id);
  if (!c) return notFound();
  const jobs = db.jobs.filter(j => j.customerId === id).sort(byDateTime).reverse();
  const done = jobs.filter(j => j.done);
  const unpaid = done.filter(j => !j.paid);
  return `
  <header class="bar">
    <button class="icon-btn" data-action="back" aria-label="뒤로">${IC.back}</button><h2>고객 정보</h2>
    <button class="icon-btn" data-action="edit-customer" data-id="${c.id}" aria-label="수정">${IC.edit}</button>
    <button class="icon-btn" data-action="delete-customer" data-id="${c.id}" aria-label="삭제">${IC.trash}</button>
  </header>
  <section class="detail-hero">
    <span class="hero-circ" style="background:${avatarColor(c.name)};font-size:36px;font-weight:800;color:var(--brown)">${esc(initial(c.name))}</span>
    <h1>${esc(c.name)}</h1>
    <p class="when">${esc(c.phone || '연락처 없음')}</p>
    ${c.phone ? `<div class="btn-row"><a class="btn yellow" href="${telHref(c.phone)}">${IC.phone}전화</a><a class="btn" href="${smsHref(c.phone)}">${IC.msg}문자</a>${c.address ? `<a class="btn" href="${mapHref(c.address)}" target="_blank" rel="noopener">${IC.pin}지도</a>` : ''}</div>` : ''}
  </section>
  <div class="kv">
    <div class="tile"><small>청소 횟수</small><b>${done.length}회</b></div>
    <div class="tile"><small>누적 매출</small><b>${man(sum(done))}</b></div>
    <div class="tile"><small>미수금</small><b class="orange">${man(sum(unpaid))}</b></div>
  </div>
  <section class="card">
    <h3>기본 정보</h3>
    <div class="info-row">${IC.pin}<span>${esc(c.address || '주소 없음')}</span></div>
    ${c.memo ? `<div class="info-row">${IC.note}<span class="memo">${esc(c.memo)}</span></div>` : ''}
  </section>
  <h2 class="sec-title">청소 기록 <button class="more" data-action="new-job" data-cid="${c.id}">+ 일정 추가</button></h2>
  ${jobs.length ? jobs.map(j => jobCard(j, true)).join('') : emptyBox('🧹', '아직 청소 기록이 없어요')}`;
}

/* ---------- 설정 ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
function settings() {
  return `
  <header class="bar"><button class="icon-btn" data-action="back" aria-label="뒤로">${IC.back}</button><h2>설정</h2></header>
  <section class="card">
    <h3>앱</h3>
    ${installEvt ? `<button class="set-item" data-action="install"><span class="emo">📲</span><span>홈 화면에 앱 설치<small>앱처럼 바로 실행돼요</small></span></button>` : ''}
    <button class="set-item" data-action="sample"><span class="emo">🧪</span><span>샘플 데이터 넣기<small>기능을 둘러볼 수 있는 예시 고객·일정</small></span></button>
  </section>
  <section class="card">
    <h3>🌐 AI 서버 연결</h3>
    <p class="pay-note">그록·클로드·제미나이가 보낸 예약·민원·청구·메모를 가져와요. 주소는 이 휴대폰에만 저장돼요.</p>
    <label class="f">서버 주소<input id="sync-url" placeholder="https://.../inbox/비밀키" value="${esc(syncUrl())}"></label>
    <div class="btn-row"><button class="btn ghost" data-action="sync-save">주소 저장</button><button class="btn yellow" data-action="sync-pull">서버에서 가져오기</button></div>
  </section>
  <section class="card">
    <h3>백업 · 복원</h3>
    <button class="set-item" data-action="export"><span class="emo">💾</span><span>백업 파일 내보내기<small>일정·고객·사진을 파일 하나로 저장</small></span></button>
    <label class="set-item"><span class="emo">📂</span><span>백업 파일 불러오기<small>현재 데이터를 백업 내용으로 바꿔요</small></span><input type="file" accept="application/json,.json" hidden data-import></label>
    <p class="pay-note">데이터는 이 휴대폰 안에만 저장돼요. 휴대폰을 바꾸거나 앱을 지우기 전에 꼭 백업하세요.</p>
  </section>
  <section class="card">
    <button class="set-item danger" data-action="reset"><span class="emo">🗑️</span><span>모든 데이터 삭제</span></button>
  </section>
  <p style="text-align:center;color:var(--muted);font-size:12px;font-weight:600;margin:20px 0">반짝 청소노트 v1.0</p>`;
}

function notFound() {
  return `<header class="bar"><button class="icon-btn" data-action="back">${IC.back}</button><h2></h2></header>${emptyBox('🤔', '찾을 수 없는 항목이에요')}`;
}

/* ---------- 바텀시트 ---------- */
const sheetRoot = $('#sheet-root');
let sheetOpen = false, popResolve = null;
function openSheet(html, mount, cls = '') {
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet ${cls}">${html}</div>`;
  if (!sheetOpen) history.pushState({ sheet: true }, '');
  sheetOpen = true;
  requestAnimationFrame(() => requestAnimationFrame(() => sheetRoot.classList.add('open')));
  mount?.(sheetRoot.querySelector('.sheet'));
}
function hideSheet() {
  sheetOpen = false;
  sheetRoot.classList.remove('open');
  setTimeout(() => { if (!sheetOpen) sheetRoot.innerHTML = ''; }, 300);
}
// 안드로이드 뒤로가기로도 시트가 닫히도록 history 한 칸을 사용
function closeSheet() {
  if (!sheetOpen) return Promise.resolve();
  return new Promise(res => { popResolve = res; history.back(); });
}
window.addEventListener('popstate', () => {
  if (sheetOpen) hideSheet();
  if (popResolve) { const r = popResolve; popResolve = null; r(); }
});

function newJob(base) {
  return {
    id: uid(), ...base,
    done: false, doneAt: null, paid: false, payMethod: '', paidAt: null,
    startedAt: null, endedAt: null, durationMin: 0,
    photos: { before: [], after: [] }, createdAt: Date.now(),
  };
}

function typeChips(selected, editing) {
  return db.types.map(name => {
    const t = typeOf(name);
    return editing
      ? `<span class="chip edit"><button type="button" data-action="rename-type" data-v="${esc(name)}">${t.emoji} ${esc(name)} ✎</button><button type="button" class="chip-x" data-action="remove-type" data-v="${esc(name)}" aria-label="${esc(name)} 삭제">×</button></span>`
      : `<label class="chip"><input type="radio" name="type" value="${esc(name)}" ${name === selected ? 'checked' : ''}><span>${t.emoji} ${esc(name)}</span></label>`;
  }).join('') + (editing
    ? `<span class="type-add"><input data-type-new placeholder="새 종류 이름" maxlength="12"><button type="button" class="chip-btn on" data-action="add-type">추가</button></span>`
    : (db.types.length ? '' : '<span class="muted">편집을 눌러 청소 종류를 추가해 주세요</span>'));
}
function renderTypeChips(form) {
  const box = $('.type-chips', form);
  const editing = box.classList.contains('editing');
  const cur = form.querySelector('input[name=type]:checked')?.value || box.dataset.sel;
  box.dataset.sel = cur || '';
  box.innerHTML = typeChips(cur, editing);
  $('[data-action=edit-types]', form).textContent = editing ? '완료' : '편집';
}

function openJobForm(job = null, preset = {}) {
  const isNew = !job;
  const j = job || { date: preset.date || today(), time: '10:00', type: db.types[0] || '기타', price: 0, customerId: preset.customerId || '', memo: '', phone: '', source: preset.source || 'direct' };
  const fromHousing = j.source === 'housing';

  openSheet(`
  <form class="form" id="job-form" autocomplete="off">
    <h2>${isNew ? '청소 예약 등록' : '예약 수정'}</h2>
    ${isNew ? AI_PASTE_HTML : ''}
    <label class="f">고객 전화번호 <small class="req">필수</small>
      <input name="phone" type="tel" inputmode="tel" placeholder="010-0000-0000" value="${esc(j.phone)}">
    </label>
    <p class="f-label">매출 출처</p>
    <div class="chips src-chips">
      <label class="chip"><input type="radio" name="source" value="direct" ${fromHousing ? '' : 'checked'}><span>👤 직접 고객</span></label>
      <label class="chip"><input type="radio" name="source" value="housing" ${fromHousing ? 'checked' : ''}><span>🏢 주택관리에서</span></label>
    </div>
    <div class="place">
      <p class="f-label">🏢 청소 장소</p>
      <label class="f">건물명<input name="building" placeholder="예: 래미안 아파트 / 한빛빌딩" value="${esc(j.building)}"></label>
      <div class="f-row">
        <label class="f">호수<input name="unit" placeholder="예: 101동 1203호" value="${esc(j.unit)}"></label>
        <label class="f">비밀번호<input name="doorPw" placeholder="예: *1234#" value="${esc(j.doorPw)}"></label>
      </div>
    </div>
    <div class="f-label type-head">청소 종류 <button type="button" class="chip-btn" data-action="edit-types">편집</button></div>
    <div class="chips type-chips" data-sel="${esc(j.type)}">${typeChips(j.type, false)}</div>
    <div class="f-row">
      <label class="f">날짜<input type="date" name="date" value="${j.date}" required></label>
      <label class="f">시간<input type="time" name="time" value="${j.time}" required></label>
    </div>
    <label class="f">금액 (원)<input name="price" inputmode="numeric" placeholder="예: 150,000" value="${j.price ? j.price.toLocaleString('ko-KR') : ''}" data-money></label>
    <div class="chips quick">${[50000, 80000, 100000, 150000, 200000, 300000].map(v => `<button type="button" class="chip-btn" data-action="set-price" data-v="${v}">${man(v)}</button>`).join('')}</div>
    <label class="f">메모<textarea name="memo" rows="2" placeholder="주차, 반려동물, 특이사항 등">${esc(j.memo)}</textarea></label>
    <button class="btn yellow big" type="submit">${isNew ? '예약 등록' : '저장하기'}</button>
  </form>`, sheet => {
    const form = $('#job-form', sheet);
    // 전에 쓴 건물명을 입력하면 지난 예약의 호수·비밀번호·전화번호를 채워줌 (비어 있을 때만)
    form.building.addEventListener('change', () => {
      const last = db.jobs.filter(x => x.building && x.building === form.building.value.trim()).sort(byDateTime).pop();
      if (last) for (const k of ['unit', 'doorPw', 'phone']) if (!form[k].value) form[k].value = last[k] || '';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      if ($('.type-chips', form).classList.contains('editing')) { toast('청소 종류 편집을 먼저 완료해 주세요'); return; }
      const phone = f.get('phone').trim();
      if (phone.replace(/\D/g, '').length < 9) { toast('고객 전화번호를 입력해 주세요'); form.phone.focus(); return; }
      const base = {
        customerId: j.customerId || '', type: f.get('type') || $('.type-chips', form).dataset.sel || '기타',
        date: f.get('date'), time: f.get('time'), price: toNum(f.get('price')), memo: f.get('memo').trim(),
        building: f.get('building').trim(), unit: f.get('unit').trim(), doorPw: f.get('doorPw').trim(),
        phone, source: f.get('source') === 'housing' ? 'housing' : 'direct',
      };
      if (job) {
        Object.assign(job, base);
      } else {
        db.jobs.push(newJob(base));
        toast('예약을 등록했어요');
      }
      save();
      await closeSheet();
      if (job) { toast('저장했어요'); refresh(); }
      else { ui.selDate = base.date; refresh(); }
    });
  });
}

function openCustomerForm(c = null) {
  openSheet(`
  <form class="form" id="cust-form" autocomplete="off">
    <h2>${c ? '고객 정보 수정' : '새 고객 등록'}</h2>
    <label class="f">이름<input name="name" required placeholder="홍길동" value="${esc(c?.name)}"></label>
    <label class="f">연락처<input name="phone" type="tel" inputmode="tel" placeholder="010-0000-0000" value="${esc(c?.phone)}"></label>
    <label class="f">주소<input name="address" placeholder="서울시 ○○구 ○○로 00, 000호" value="${esc(c?.address)}"></label>
    <label class="f">메모<textarea name="memo" rows="3" placeholder="현관 비밀번호, 반려동물, 선호 사항 등">${esc(c?.memo)}</textarea></label>
    <button class="btn yellow big" type="submit">${c ? '저장하기' : '고객 등록'}</button>
  </form>`, sheet => {
    const form = $('#cust-form', sheet);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const data = { name: f.get('name').trim(), phone: f.get('phone').trim(), address: f.get('address').trim(), memo: f.get('memo').trim() };
      if (!data.name) return;
      let target = c;
      if (c) Object.assign(c, data);
      else { target = { id: uid(), ...data, createdAt: Date.now() }; db.customers.push(target); }
      save();
      await closeSheet();
      toast(c ? '저장했어요' : '고객을 등록했어요');
      if (c) refresh(); else go('customer/' + target.id);
    });
  });
}

function openDurationForm(j) {
  const h = Math.floor((j.durationMin || 0) / 60), m = (j.durationMin || 0) % 60;
  openSheet(`
  <form class="form" id="dur-form">
    <h2>소요 시간 직접 입력</h2>
    <div class="f-row">
      <label class="f">시간<input type="number" name="h" min="0" max="23" inputmode="numeric" value="${h}"></label>
      <label class="f">분<input type="number" name="m" min="0" max="59" inputmode="numeric" value="${m}"></label>
    </div>
    <button class="btn yellow big" type="submit">저장하기</button>
  </form>`, sheet => {
    const form = $('#dur-form', sheet);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      j.durationMin = (+form.h.value || 0) * 60 + (+form.m.value || 0);
      if (j.startedAt && !j.endedAt) j.startedAt = null;
      save();
      await closeSheet();
      refresh();
    });
  });
}

/* ---------- 사진 ---------- */
const urlCache = new Map();
async function photoURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await PhotoDB.get(id);
  if (!b) return '';
  const u = URL.createObjectURL(b);
  urlCache.set(id, u);
  return u;
}
function hydratePhotos(root = document) {
  root.querySelectorAll('img[data-photo]').forEach(async img => { img.src = await photoURL(img.dataset.photo); });
}
async function compress(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s);
  cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
}
async function removePhotos(ids) {
  for (const id of ids) {
    await PhotoDB.del(id).catch(() => {});
    if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  }
}
const jobPhotoIds = j => [...j.photos.before, ...j.photos.after];

/* ---------- 타이머 ---------- */
function tickTimer() {
  const el = $('#timer-live');
  if (el) el.textContent = clock(Date.now() - +el.dataset.start);
}
setInterval(tickTimer, 1000);
function stopTimer(j) {
  j.endedAt = Date.now();
  j.durationMin = Math.max(1, Math.round((j.endedAt - j.startedAt) / 60000));
}

/* ---------- AI 서버 보관함 → 휴대폰 ---------- */
// 그록·클로드·제미나이가 보관함에 넣은 예약을 가져옵니다. 주소는 이 휴대폰에만 저장돼요.
const SYNC_KEY = 'cleannote.sync';
const syncUrl = () => { try { return localStorage.getItem(SYNC_KEY) || ''; } catch { return ''; } };
async function pullFromServer() {
  const base = syncUrl().trim().replace(/\/+$/, '');
  if (!base) throw new Error('서버 주소를 먼저 넣고 저장해 주세요');
  const res = await fetch(base, { cache: 'no-store' });
  if (!res.ok) throw new Error(`서버 응답이 없어요 (${res.status}). 주소를 확인해 주세요`);
  const { items = [] } = await res.json();
  const n = { reservation: 0, complaint: 0, charge: 0, note: 0 };
  let autoBill = 0;
  for (const it of items) {
    const kind = ['complaint', 'charge', 'note'].includes(it.kind) ? it.kind : 'reservation';
    n[kind]++;
    if (kind === 'complaint') {
      db.complaints.push({
        id: uid(), building: it.building || '', unit: it.unit || '', phone: it.phone || '',
        content: it.content || '', date: it.date || today(), status: 'open', billingId: null, createdAt: Date.now(),
      });
    } else if (kind === 'charge') {
      db.repairs.push({
        id: uid(), building: it.building || '', unit: it.unit || '', phone: it.phone || '',
        item: it.item || '', amount: it.amount || 0, wholesale: it.wholesale || 0, date: it.date || today(), memo: it.memo || '',
        paid: false, complaintId: null, source: 'housing', createdAt: Date.now(),
      });
    } else if (kind === 'note') {
      const note = {
        id: uid(), building: it.building || '', unit: it.unit || '', text: it.text || '',
        date: it.date || today(), source: 'ai', createdAt: Date.now(),
      };
      db.housingNotes.push(note);
      if (autoBillFromNote(note)) autoBill++;
    } else {
      // "주택관리" 종류로 들어온 예약은 주택관리 출처로 표시 (청소 종류 목록에는 넣지 않음)
      const housing = it.source === 'housing' || it.type === '주택관리';
      const type = it.type && it.type !== '주택관리' ? it.type : (housing ? '기타' : (db.types[0] || '기타'));
      if (!db.types.includes(type)) db.types.push(type);
      db.jobs.push(newJob({
        customerId: '', type, date: it.date, time: it.time,
        price: it.price || 0, memo: it.memo || '', building: it.building || '', unit: it.unit || '', doorPw: it.doorPw || '',
        phone: it.phone || '', source: housing ? 'housing' : 'direct',
      }));
    }
  }
  if (items.length) {
    save(); // 휴대폰에 먼저 저장한 뒤에만 서버에서 지움
    await fetch(base + '/ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: items.map(x => x.id) }),
    });
  }
  const parts = [];
  if (n.reservation) parts.push(`예약 ${n.reservation}건`);
  if (n.complaint) parts.push(`민원 ${n.complaint}건`);
  if (n.charge) parts.push(`청구 ${n.charge}건`);
  if (n.note) parts.push(`메모 ${n.note}건${autoBill ? ` (청구 자동 등록 ${autoBill}건)` : ''}`);
  return { n: items.length, msg: items.length ? `${parts.join(' · ')}을 가져왔어요` : '새로 들어온 항목이 없어요' };
}


/* ---------- 주택관리: 검색 · 수리비 청구 · 수리 사진 · 문자 ---------- */
const HOUSING_TEMPLATES = {
  '수리 안내': ({ place, item }) => `안녕하세요. ${place} 수리 건으로 안내드립니다.${item ? ' 수리 내용: ' + item + '.' : ''} 자세한 일정은 곧 다시 연락드리겠습니다.`,
  '방문 일정': ({ place }) => `안녕하세요. ${place} 방문 일정을 안내드립니다. 편하신 시간을 알려 주시면 맞춰 방문하겠습니다.`,
  '수리비 청구': ({ place, amount }) => `안녕하세요. ${place} 수리비 ${amount || '○○원'}을 청구드립니다. 입금 확인 후 연락 부탁드립니다.`,
  '직접 입력': () => '',
};
const housingBuildings = () => [...new Set([...db.jobs, ...db.repairs, ...db.complaints, ...db.housingNotes].map(x => (x.building || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
const repairAmount = arr => arr.reduce((a, r) => a + (r.amount || 0), 0);
const housingDatalist = () => `<datalist id="hs-buildings">${housingBuildings().map(b => `<option value="${esc(b)}">`).join('')}</datalist>`;

function repairCard(r) {
  return `
  <article class="hs-card ${r.paid ? 'is-paid' : ''}">
    <div class="hs-card-main">
      <span class="hs-tag ${r.paid ? 'paid' : ''}">${r.paid ? '받음' : '청구'}</span>
      <b>${esc(placeOf(r) || '장소 미정')}</b>
      <p>${esc(r.item || '수리')} · ${dateLabel(r.date)}</p>
      ${r.memo ? `<p class="hs-memo">${esc(r.memo)}</p>` : ''}
    </div>
    <div class="hs-card-side">
      <strong>${won(r.amount)}</strong>
      <button class="hs-mini" data-action="hs-toggle-paid" data-id="${r.id}">${r.paid ? '취소' : '받음'}</button>
    </div>
  </article>`;
}

function housingSearch(q) {
  q = q.trim();
  if (!q) return '<p class="hs-hint">건물명, 호수, 고객 이름, 메모로 찾아요</p>';
  const hit = (...xs) => xs.some(x => String(x || '').includes(q));
  const custs = db.customers.filter(c => hit(c.name, c.phone, c.address));
  const jobs = db.jobs.filter(j => hit(j.building, j.unit, j.memo, cust(j.customerId)?.name)).sort(byDateTime);
  const cps = db.complaints.filter(c => hit(c.building, c.unit, c.phone, c.content));
  const reps = db.repairs.filter(r => hit(r.building, r.unit, r.item, r.memo));
  const ns = db.housingNotes.filter(n => hit(n.building, n.unit, n.text));
  const rows = [
    ...custs.map(c => `<button class="hs-row" data-action="hs-open" data-go="customer/${c.id}"><b>${esc(c.name)}</b><small>고객 · ${esc(c.phone || c.address || '')}</small></button>`),
    ...jobs.map(j => `<button class="hs-row" data-action="hs-open" data-go="job/${j.id}"><b>${esc(jobTitle(j))}</b><small>예약 · ${dateLabel(j.date)} ${j.time}</small></button>`),
    ...cps.map(c => `<button class="hs-row" data-action="hs-open" data-go="complaints"><b>${esc(placeOf(c) || '장소 미정')}</b><small>민원 · ${esc(String(c.content).slice(0, 30))}</small></button>`),
    ...reps.map(r => `<button class="hs-row" data-action="hs-toggle-paid" data-id="${r.id}"><b>${esc(placeOf(r) || '장소 미정')}</b><small>청구 · ${esc(r.item || '')} · ${won(r.amount)}</small></button>`),
    ...ns.map(n => `<button class="hs-row" data-action="memo-edit" data-id="${n.id}"><b>${esc(placeOf(n) || '건물 미정')}</b><small>메모 · ${esc(String(n.text).slice(0, 30))}</small></button>`),
  ];
  return rows.length ? rows.join('') : '<p class="hs-hint">찾는 내용이 없어요</p>';
}

function noteCard(n) {
  const ai = n.source === 'ai';
  return `
  <article class="cp-card">
    <div class="cp-top">
      <span class="cp-tag ${ai ? 'ai' : ''}">${ai ? '🤖 AI 작성' : '직접 작성'}</span>
      <span class="cp-date">${dateLabel(n.date)}</span>
    </div>
    <b class="cp-place">${esc(placeOf(n) || '건물 미정')}</b>
    <p class="cp-content">${esc(n.text)}</p>
    <div class="cp-btns">
      <button class="hs-mini ghost" data-action="memo-edit" data-id="${n.id}">수정</button>
      <button class="hs-mini danger" data-action="memo-delete" data-id="${n.id}">삭제</button>
    </div>
  </article>`;
}

function housingPage() {
  const repairs = [...db.repairs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const unpaid = repairs.filter(r => !r.paid);
  const monthKey = today().slice(0, 7);
  const thisMonth = repairs.filter(r => (r.date || '').startsWith(monthKey)).length;
  const notes = [...db.housingNotes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const openCount = db.complaints.filter(c => c.status !== 'done').length;
  return `
  <section class="hs-head">
    <p class="hs-kicker">HOUSING CARE</p>
    <h1>주택관리</h1>
    <p class="hs-sub">건물 수리를 한 곳에서 관리해요</p>
    <div class="hs-stats">
      <div><small>받을 수리비</small><b>${man(repairAmount(unpaid))}</b></div>
      <div><small>이번 달 수리</small><b>${thisMonth}건</b></div>
      <div><small>접수된 민원</small><b>${openCount}건</b></div>
    </div>
  </section>

  <button class="hs-complaint" data-action="hs-complaints">
    <span>🛠️</span>
    <div><b>민원처리</b><small>${openCount ? `접수된 민원 ${openCount}건 · 처리 완료하면 청구내역으로` : '고장 신고 접수 → 처리 완료 → 청구내역'}</small></div>
    <svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
  </button>

  <button class="hs-ai" data-action="hs-paste">
    <span>🤖</span>
    <div><b>AI 답 붙여넣기</b><small>그록·제미나이가 쓴 민원·청구·메모를 알맞은 칸에 채워요</small></div>
    <svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
  </button>

  <section class="hs-grid">
    <button class="hs-btn" data-action="hs-search"><span class="hs-ico" style="background:#DDF3FF">🔍</span><b>검색</b><small>건물 · 호수 · 고객</small></button>
    <button class="hs-btn" data-action="hs-billing"><span class="hs-ico" style="background:#FFE6D6">🧾</span><b>청구내역</b><small>금액 입력 · 수정 · 삭제</small></button>
    <button class="hs-btn" data-action="hs-photo"><span class="hs-ico" style="background:#DDF5EA">📷</span><b>수리 사진</b><small>전 · 후 사진 보관</small></button>
    <button class="hs-btn" data-action="hs-sms"><span class="hs-ico" style="background:#EDE4FF">💬</span><b>문자</b><small>안내 · 청구 문자</small></button>
  </section>

  <h2 class="hs-sec">메모</h2>
  <div class="bill-add"><button class="cp-new" data-action="memo-new">＋ 메모 추가</button></div>
  ${notes.length
    ? notes.slice(0, 20).map(noteCard).join('')
    : emptyBox('📝', '아직 메모가 없어요', '<p class="cp-note">그록에게 "주택관리 메모 남겨줘"라고 말하면 여기에 나와요</p>')}

  <h2 class="hs-sec">최근 수리 · 청구</h2>
  ${repairs.length ? repairs.slice(0, 12).map(repairCard).join('') : '<div class="hs-empty"><span>🧾</span>아직 청구 내역이 없어요</div>'}

  <h2 class="hs-sec">수리 사진</h2>
  ${db.repairPhotos.length
    ? `<div class="hs-photos">${db.repairPhotos.slice().reverse().slice(0, 12).map(p => `
        <button class="hs-photo" data-action="hs-photo-view" data-id="${p.id}">
          <img data-photo="${p.pids[0]}" alt="">
          ${p.pids.length > 1 ? `<i>${p.pids.length}</i>` : ''}
          <span>${esc(placeOf(p) || '장소 미정')}</span>
        </button>`).join('')}</div>`
    : '<div class="hs-empty"><span>📷</span>아직 사진이 없어요</div>'}
  <div style="height:10px"></div>`;
}

// 주택관리 메모 (직접 작성 · AI 작성 공용)
function memoForm(n = null, pre = {}) {
  const v = n || pre;
  openSheet(`
  <form class="form" id="memo-form" autocomplete="off">
    <h2>${n ? '메모 수정' : '주택관리 메모'}</h2>
    ${housingDatalist()}
    <label class="f">건물이름<input name="building" list="hs-buildings" placeholder="예: 래미안 아파트" value="${esc(v.building)}"></label>
    <label class="f">호수<input name="unit" placeholder="예: 101동 1203호" value="${esc(v.unit)}"></label>
    <label class="f">메모 내용<textarea name="text" rows="5" placeholder="예: 싱크대 누수 수리 80,000원 / 다음 달 소방 점검 예정">${esc(v.text)}</textarea></label>
    <p class="cp-note">메모에 금액(예: 80,000원, 8만원)을 적으면 청구내역에 자동으로 들어가요.</p>
    <button class="btn dark big" type="submit">${n ? '저장하기' : '메모 저장'}</button>
  </form>`, sheet => {
    const form = $('#memo-form', sheet);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const data = { building: f.get('building').trim(), unit: f.get('unit').trim(), text: f.get('text').trim() };
      if (!data.text) { toast('메모 내용을 적어 주세요'); form.text.focus(); return; }
      let note = n;
      if (note) Object.assign(note, data);
      else {
        note = { id: uid(), ...data, date: today(), source: pre.source || 'manual', createdAt: Date.now() };
        db.housingNotes.push(note);
      }
      const bill = autoBillFromNote(note);
      save();
      await closeSheet();
      toast(bill ? `메모 저장 · 청구내역에 ${won(bill.amount)} 자동 등록` : (n ? '메모를 수정했어요' : '메모를 저장했어요'));
      refresh();
    });
  });
}

// AI 답 → 종류 인식: "민원:", "[청구]", "메모:" 같은 첫머리 표시로 구분
const AI_KIND_TAGS = { 민원: 'complaint', 청구: 'charge', 수리비: 'charge', 메모: 'note', 예약: 'reservation' };
const AI_TAG_RE = /^\s*(?:\[\s*(민원|청구|수리비|메모|예약)\s*\]\s*[:：]?|(민원|청구|수리비|메모|예약)\s*[:：]|(민원|청구|수리비|메모|예약)\s*$)\s*(.*)$/;

function parseAiText(text) {
  const src = String(text || '');
  const lines = src.split(/\n/);
  const firstNonEmpty = lines.findIndex(l => l.trim());
  // "메모"는 첫 줄이거나 [메모]처럼 확실히 적힌 경우만 인식 (예약 글 안의 "메모:" 줄과 헷갈리지 않게)
  const idx = lines.findIndex((l, i) => {
    const m = l.match(AI_TAG_RE);
    if (!m) return false;
    const tag = m[1] || m[2] || m[3];
    return tag !== '메모' || i === firstNonEmpty || !!m[1];
  });
  if (idx < 0) return { kind: 'reservation', text: src };
  const m = lines[idx].match(AI_TAG_RE);
  const kind = AI_KIND_TAGS[m[1] || m[2] || m[3]];
  if (kind === 'reservation') return { kind, text: src };
  const body = [m[4], ...lines.slice(idx + 1)].join('\n');
  return { kind, fields: extractHousingFields(body) };
}

const HS_KEYS = [
  [/^(건물이름|건물명|건물|장소|아파트|빌딩)$/, 'building'],
  [/^(호|호수|동호수|호실)$/, 'unit'],
  [/^(전화번호|전화|연락처|휴대폰|번호)$/, 'phone'],
  [/^(고장신고내용|고장 신고 내용|신고내용|고장|내용|증상|요청)$/, 'content'],
  [/^(수리내용|수리 내용|수리|항목|품목|작업)$/, 'item'],
  [/^(금액|청구금액|청구 금액|수리비|비용|가격)$/, 'amount'],
  [/^(날짜|일자|일정)$/, 'date'],
  [/^(메모|비고|특이사항)$/, 'memo'],
  [/^(비번|비밀번호)$/, 'doorPw'],
];

// "건물이름: 값" 줄은 그대로 쓰고, 나머지 글에서는 건물·호수·전화·금액·날짜를 찾아냄
function extractHousingFields(body) {
  const raw = {};
  const free = [];
  for (const line of String(body || '').split(/\n+/)) {
    const t = line.replace(/^\s*[-*•]\s*/, '').trim();
    if (!t) continue;
    const m = t.match(/^([가-힣a-zA-Z ]{1,12}?)\s*[:：]\s*(.+)$/);
    const hit = m && HS_KEYS.find(([re]) => re.test(m[1].trim()));
    if (hit) raw[hit[1]] = raw[hit[1]] ? `${raw[hit[1]]} ${m[2].trim()}` : m[2].trim();
    else free.push(t);
  }
  const all = free.join(' ');
  const pm = (raw.phone || all).match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/);
  const phone = pm ? pm[0].replace(/\s/g, '') : (raw.phone || '');
  const building = (raw.building || findBuilding(all) || '').trim();
  const unit = (raw.unit || extractUnit(all) || '').trim();
  let rest = all;
  if (!raw.building && building) rest = rest.replace(building, '');
  if (!raw.unit && unit) rest = rest.replace(unit, '');
  if (!raw.phone && pm) rest = rest.replace(pm[0], '');
  rest = rest.replace(/\s+/g, ' ').trim();
  return {
    building,
    unit,
    phone,
    content: (raw.content || rest).trim(),
    item: (raw.item || raw.content || rest).trim(),
    text: (raw.memo || raw.content || rest).trim(),
    memo: (raw.memo || '').trim(),
    amount: raw.amount ? (parsePrice(raw.amount) || toNum(raw.amount)) : parsePrice(all),
    date: parseDate(raw.date || all, new Date()),
    doorPw: (raw.doorPw || '').trim(),
  };
}

// AI 답 붙여넣기 화면
function openHousingPaste() {
  openSheet(`
  <form class="form hs-form" id="hs-paste-form" autocomplete="off">
    <h2>🤖 AI 답 붙여넣기</h2>
    <p class="cp-note">그록·제미나이 답을 그대로 붙여넣으세요. 첫 줄에 종류(민원·청구·메모)를 적으면 알맞은 칸에 채워져요.</p>
    <div class="chips quick hs-tags">
      <button type="button" class="chip-btn" data-action="hs-paste-tag" data-v="민원">민원</button>
      <button type="button" class="chip-btn" data-action="hs-paste-tag" data-v="청구">청구</button>
      <button type="button" class="chip-btn" data-action="hs-paste-tag" data-v="메모">메모</button>
      <button type="button" class="chip-btn" data-action="hs-paste-tag" data-v="예약">예약</button>
    </div>
    <textarea id="hs-paste-text" rows="8" placeholder="예: 민원 / 건물이름: 래미안 아파트 / 호수: 101동 1203호 / 전화번호: 010-1234-5678 / 내용: 화장실 물이 안 내려감"></textarea>
    <button class="btn dark big" type="button" data-action="hs-paste-fill">채우기</button>
  </form>`, () => { $('#hs-paste-text').focus(); });
}

const HS_FORM_HEAD = '<form class="form hs-form" autocomplete="off">';

// 검색
function openHousingSearch() {
  openSheet(`
    ${HS_FORM_HEAD}
      <h2>검색</h2>
      <label class="hs-search"><span>🔍</span><input id="hs-q" type="search" placeholder="건물명, 호수, 고객 이름"></label>
      <div id="hs-results" class="hs-results"><p class="hs-hint">건물명, 호수, 고객 이름, 메모로 찾아요</p></div>
    </form>`, sheet => {
    const q = $('#hs-q', sheet);
    q.addEventListener('input', () => { $('#hs-results', sheet).innerHTML = housingSearch(q.value); });
    setTimeout(() => q.focus(), 300);
  });
}

// 수리비 청구
// 청구 추가 (직접 추가 · AI 답 붙여넣기 공용)
// 청구 추가 (수리내용 · 소비자가격 · 도매가 → 매출 = 소비자가격 − 도매가)
function openRepairForm(pre = {}) {
  openSheet(`
  <form class="form" id="hs-rep-form" autocomplete="off">
    <h2>청구 추가</h2>
    ${housingDatalist()}
    <label class="f">건물이름<input name="building" list="hs-buildings" placeholder="예: 래미안 아파트" value="${esc(pre.building)}"></label>
    <div class="f-row">
      <label class="f">호수<input name="unit" placeholder="예: 101동 1203호" value="${esc(pre.unit)}"></label>
      <label class="f">전화번호<input name="phone" type="tel" inputmode="tel" placeholder="010-0000-0000" value="${esc(pre.phone)}"></label>
    </div>
    <p class="f-label">수리내용</p>
    <div class="chips quick hs-presets">${REPAIR_PRESETS.map(p => `<button type="button" class="chip-btn" data-action="hs-item-preset" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <label class="f"><input name="item" placeholder="예: 싱크대 누수 수리 (직접 적어도 돼요)" value="${esc(pre.item)}"></label>
    <div class="f-row">
      <label class="f">소비자가격 (원)<input name="amount" inputmode="numeric" placeholder="고객이 내는 금액" value="${pre.amount ? Number(pre.amount).toLocaleString('ko-KR') : ''}" data-money></label>
      <label class="f">도매가 (원)<input name="wholesale" inputmode="numeric" placeholder="자재·원가" value="${pre.wholesale ? Number(pre.wholesale).toLocaleString('ko-KR') : ''}" data-money></label>
    </div>
    <div class="chips quick">${[30000, 50000, 80000, 100000, 150000].map(v => `<button type="button" class="chip-btn" data-action="hs-set-amount" data-v="${v}">${man(v)}</button>`).join('')}</div>
    <p class="sale-preview">매출 = 소비자가격 − 도매가 → <b data-margin>0원</b></p>
    <label class="f">날짜<input type="date" name="date" value="${pre.date || today()}" required></label>
    <label class="f">메모<textarea name="memo" rows="2" placeholder="특이사항">${esc(pre.memo)}</textarea></label>
    <button class="btn dark big" type="submit">청구 기록 저장</button>
  </form>`, sheet => {
    const form = $('#hs-rep-form', sheet);
    const upd = () => { $('[data-margin]', sheet).textContent = won(toNum(form.amount.value) - toNum(form.wholesale.value)); };
    form.amount.addEventListener('input', upd);
    form.wholesale.addEventListener('input', upd);
    upd();
    // 같은 건물의 지난 기록에서 호수·전화번호를 채워줌 (비어 있을 때만)
    form.building.addEventListener('change', () => {
      const b = form.building.value.trim();
      const same = [...db.repairs, ...db.complaints].filter(x => x.building === b);
      const u = same.filter(x => x.unit).pop();
      if (u && !form.unit.value) form.unit.value = u.unit;
      const p = same.filter(x => x.phone).pop();
      if (p && !form.phone.value) form.phone.value = p.phone;
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const retail = toNum(f.get('amount')), cost = toNum(f.get('wholesale'));
      if (cost > retail) { toast('도매가가 소비자가격보다 높아요. 다시 확인해 주세요'); form.wholesale.focus(); return; }
      db.repairs.push({
        id: uid(), building: f.get('building').trim(), unit: f.get('unit').trim(), phone: f.get('phone').trim(),
        item: f.get('item').trim(), amount: retail, wholesale: cost, date: f.get('date') || today(),
        memo: f.get('memo').trim(), paid: false, complaintId: null, source: 'housing', createdAt: Date.now(),
      });
      save();
      await closeSheet();
      toast(`청구를 기록했어요 · 매출 ${won(retail - cost)}`);
      refresh();
    });
  });
}

// 수리 사진
function openRepairPhotoForm() {
  openSheet(`
  <form class="form" id="hs-photo-form" autocomplete="off">
    <h2>수리 사진</h2>
    ${housingDatalist()}
    <label class="f">건물명<input name="building" list="hs-buildings" placeholder="예: 래미안 아파트"></label>
    <div class="f-row">
      <label class="f">호수<input name="unit" placeholder="예: 101동 1203호"></label>
      <label class="f">날짜<input type="date" name="date" value="${today()}" required></label>
    </div>
    <label class="f">메모<input name="memo" placeholder="예: 수리 전 벽면 누수"></label>
    <label class="hs-pick"><input type="file" accept="image/*" multiple name="files" hidden>📷 사진 고르기 (여러 장 가능)</label>
    <p class="hs-hint" id="hs-pick-count">선택한 사진이 없어요</p>
    <button class="btn dark big" type="submit">사진 저장</button>
  </form>`, sheet => {
    const form = $('#hs-photo-form', sheet);
    form.files.addEventListener('change', () => { $('#hs-pick-count', sheet).textContent = `선택한 사진 ${form.files.files.length}장`; });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const files = [...form.files.files];
      if (!files.length) { toast('사진을 골라 주세요'); return; }
      toast('사진 저장 중...');
      const pids = [];
      for (const file of files) {
        try {
          const pid = uid();
          await PhotoDB.put(pid, await compress(file));
          pids.push(pid);
        } catch (err) { console.error(err); }
      }
      if (!pids.length) { toast('사진을 저장하지 못했어요'); return; }
      db.repairPhotos.push({
        id: uid(), building: form.building.value.trim(), unit: form.unit.value.trim(),
        date: form.date.value, memo: form.memo.value.trim(), pids, createdAt: Date.now(),
      });
      save();
      await closeSheet();
      toast(`사진 ${pids.length}장을 저장했어요`);
      refresh();
    });
  });
}

// 문자
function openHousingSms() {
  const cs = [...db.customers].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  openSheet(`
  <form class="form" id="hs-sms-form" autocomplete="off">
    <h2>문자 보내기</h2>
    <label class="f">받는 고객
      <select name="cid"><option value="">직접 입력</option>${cs.map(c => `<option value="${c.id}" data-phone="${esc(c.phone)}">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`).join('')}</select>
    </label>
    <label class="f">전화번호<input name="phone" type="tel" inputmode="tel" placeholder="010-0000-0000"></label>
    ${housingDatalist()}
    <div class="f-row">
      <label class="f">건물명<input name="building" list="hs-buildings" placeholder="예: 래미안 아파트"></label>
      <label class="f">호수<input name="unit" placeholder="예: 101동 1203호"></label>
    </div>
    <label class="f">금액 (수리비가 있으면)<input name="amount" inputmode="numeric" placeholder="예: 80,000" data-money></label>
    <div class="chips quick">${Object.keys(HOUSING_TEMPLATES).map(k => `<button type="button" class="chip-btn" data-action="hs-tpl" data-v="${k}">${k}</button>`).join('')}</div>
    <label class="f">문자 내용<textarea name="body" rows="4" placeholder="위 버튼을 누르면 내용이 채워져요"></textarea></label>
    <button class="btn dark big" type="submit">문자 앱 열기</button>
  </form>`, sheet => {
    const form = $('#hs-sms-form', sheet);
    form.cid.addEventListener('change', () => {
      const o = form.cid.selectedOptions[0];
      if (o && o.dataset.phone) form.phone.value = o.dataset.phone;
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const number = form.phone.value.replace(/[^\d+]/g, '');
      const body = form.body.value.trim();
      if (!number) { toast('받는 번호를 입력해 주세요'); form.phone.focus(); return; }
      if (!body) { toast('문자 내용을 입력해 주세요'); form.body.focus(); return; }
      location.href = `sms:${number}?body=${encodeURIComponent(body)}`;
    });
  });
}


/* ---------- 민원처리 → 청구내역 ---------- */
// 고장 신고(민원)를 접수하고, 처리 완료하면 청구내역으로 넘어가 금액을 바로 넣습니다.
function complaintForm(c = null, pre = {}) {
  const isNew = !c;
  const v = c || pre;
  openSheet(`
  <form class="form" id="cp-form" autocomplete="off">
    <h2>${isNew ? '민원 접수' : '민원 수정'}</h2>
    ${housingDatalist()}
    <label class="f">건물이름<input name="building" list="hs-buildings" placeholder="예: 래미안 아파트" value="${esc(v.building)}"></label>
    <div class="f-row">
      <label class="f">호수<input name="unit" placeholder="예: 101동 1203호" value="${esc(v.unit)}"></label>
      <label class="f">전화번호<input name="phone" type="tel" inputmode="tel" placeholder="010-0000-0000" value="${esc(v.phone)}"></label>
    </div>
    <label class="f">고장 신고 내용
      <textarea name="content" rows="5" placeholder="예: 화장실 변기 물이 안 내려감. 오후 3시 이후 방문 요청">${esc(v.content)}</textarea>
    </label>
    <p class="cp-note">시간이나 요청 사항도 여기에 자유롭게 적어 주세요.</p>
    <button class="btn dark big" type="submit">${isNew ? '민원 접수' : '저장하기'}</button>
  </form>`, sheet => {
    const form = $('#cp-form', sheet);
    // 같은 건물의 지난 기록에서 호수·전화번호를 채워줌 (비어 있을 때만)
    form.building.addEventListener('change', () => {
      const b = form.building.value.trim();
      const same = [...db.complaints, ...db.repairs].filter(x => x.building === b);
      if (!form.phone.value) { const p = same.filter(x => x.phone).pop(); if (p) form.phone.value = p.phone; }
      if (!form.unit.value) { const u = same.filter(x => x.unit).pop(); if (u) form.unit.value = u.unit; }
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const data = {
        building: f.get('building').trim(), unit: f.get('unit').trim(),
        phone: f.get('phone').trim(), content: f.get('content').trim(),
      };
      if (!data.building) { toast('건물이름을 입력해 주세요'); form.building.focus(); return; }
      if (!data.content) { toast('고장 신고 내용을 적어 주세요'); form.content.focus(); return; }
      if (c) Object.assign(c, data);
      else db.complaints.push({ id: uid(), ...data, date: today(), status: 'open', billingId: null, createdAt: Date.now() });
      save();
      await closeSheet();
      toast(isNew ? '민원을 접수했어요' : '저장했어요');
      refresh();
    });
  });
}


function complaintCard(c) {
  const isDone = c.status === 'done';
  return `
  <article class="cp-card ${isDone ? 'is-done' : ''}">
    <div class="cp-top">
      <span class="cp-tag ${isDone ? 'done' : ''}">${isDone ? '처리 완료' : '접수'}</span>
      <span class="cp-date">${dateLabel(c.date)}</span>
    </div>
    <b class="cp-place">${esc(placeOf(c) || '장소 미정')}</b>
    ${c.phone ? `<a class="cp-phone" href="${telHref(c.phone)}">📞 ${esc(c.phone)}</a>` : '<span class="cp-phone muted">전화번호 없음</span>'}
    <p class="cp-content">${esc(c.content)}</p>
    <div class="cp-btns">
      ${isDone
        ? (c.billingId
          ? `<button class="hs-mini" data-action="bill-open">청구내역 보기</button>`
          : `<span class="cp-phone muted">청구 내역이 삭제됐어요</span>`)
        : `<button class="hs-mini" data-action="cp-done" data-id="${c.id}">처리 완료 → 청구</button>`}
      <button class="hs-mini ghost" data-action="cp-edit" data-id="${c.id}">수정</button>
      <button class="hs-mini danger" data-action="cp-delete" data-id="${c.id}">삭제</button>
    </div>
  </article>`;
}

function complaintsPage() {
  const open = db.complaints.filter(c => c.status !== 'done').sort((a, b) => b.createdAt - a.createdAt);
  const done = db.complaints.filter(c => c.status === 'done').sort((a, b) => b.createdAt - a.createdAt);
  return `
  <header class="bar"><button class="icon-btn" data-action="back" aria-label="뒤로">${IC.back}</button><h2>민원처리</h2></header>
  <section class="cp-head two">
    <div><small>접수된 민원</small><b>${open.length}건</b></div>
    <div><small>처리 완료</small><b>${done.length}건</b></div>
  </section>
  <div class="bill-add"><button class="cp-new" data-action="cp-new">＋ 민원 접수</button></div>

  <h2 class="hs-sec">접수된 민원</h2>
  ${open.length ? open.map(complaintCard).join('') : emptyBox('🛠️', '접수된 민원이 없어요')}

  ${done.length ? `<h2 class="hs-sec">처리 완료</h2>${done.map(complaintCard).join('')}` : ''}
  <div style="height:10px"></div>`;
}

function billCard(r, focusId) {
  const paid = !!r.paid;
  const cost = r.wholesale || 0;
  const from = r.complaintId ? '민원 처리' : r.noteId ? '메모 자동 등록' : '직접 청구';
  return `
  <article class="bill ${paid ? 'is-paid' : ''}">
    <div class="bill-top">
      <div class="bill-place">
        <b>${esc(placeOf(r) || '장소 미정')}</b>
        <small>${dateLabel(r.date)} · ${from}</small>
      </div>
      <span class="cp-tag ${paid ? 'done' : ''}">${paid ? '받음' : '미수'}</span>
    </div>
    ${r.item ? `<p class="bill-item">${esc(r.item)}</p>` : ''}
    ${r.phone ? `<a class="cp-phone" href="${telHref(r.phone)}">📞 ${esc(r.phone)}</a>` : ''}
    <div class="bill-money"><span>소비자가격 ${won(r.amount)}</span><span>도매가 ${won(cost)}</span><b>매출 ${won((r.amount || 0) - cost)}</b></div>
    <div class="bill-amt bill-amt2">
      <label><small>소비자가격</small><input class="bill-input" inputmode="numeric" placeholder="0" value="${r.amount ? r.amount.toLocaleString('ko-KR') : ''}" data-money ${focusId === r.id ? 'data-autofocus' : ''}></label>
      <label><small>도매가</small><input class="bill-wholesale" inputmode="numeric" placeholder="0" value="${cost ? cost.toLocaleString('ko-KR') : ''}" data-money></label>
      <button class="hs-mini" data-action="bill-save" data-id="${r.id}">저장</button>
    </div>
    <div class="cp-btns">
      <button class="hs-mini ghost" data-action="hs-toggle-paid" data-id="${r.id}">${paid ? '받음 취소' : '받음 표시'}</button>
      <button class="hs-mini ghost" data-action="bill-edit" data-id="${r.id}">수정</button>
      <button class="hs-mini danger" data-action="bill-delete" data-id="${r.id}">삭제</button>
    </div>
  </article>`;
}

function billingPage(focusId) {
  const list = [...db.repairs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const retail = sumBy(list, r => r.amount), cost = sumBy(list, r => r.wholesale);
  const unpaid = sumBy(list.filter(r => !r.paid), r => r.amount);
  return `
  <header class="bar"><button class="icon-btn" data-action="back" aria-label="뒤로">${IC.back}</button><h2>청구내역</h2></header>
  <section class="cp-head">
    <div><small>소비자가격 합계</small><b>${won(retail)}</b></div>
    <div><small>도매가 합계</small><b>${won(cost)}</b></div>
    <div><small>매출 (마진)</small><b class="ok">${won(retail - cost)}</b></div>
  </section>
  <p class="cp-note bill-help">받을 금액 ${won(unpaid)} · 소비자가격에서 도매가를 뺀 금액이 매출로 잡혀요.</p>
  <div class="bill-add"><button class="cp-new" data-action="hs-repair">＋ 청구 추가 (수리내용 · 도매가)</button></div>
  ${list.length
    ? list.map(r => billCard(r, focusId)).join('')
    : emptyBox('🧾', '청구 내역이 없어요', '<p class="cp-note">민원을 처리 완료하거나, 메모에 금액을 적으면 여기에 자동으로 나와요</p>')}
  <div style="height:10px"></div>`;
}

function billForm(r) {
  openSheet(`
  <form class="form" id="bill-form" autocomplete="off">
    <h2>청구 수정</h2>
    ${housingDatalist()}
    <label class="f">건물이름<input name="building" list="hs-buildings" value="${esc(r.building)}"></label>
    <div class="f-row">
      <label class="f">호수<input name="unit" value="${esc(r.unit)}"></label>
      <label class="f">전화번호<input name="phone" type="tel" inputmode="tel" value="${esc(r.phone)}"></label>
    </div>
    <p class="f-label">수리내용</p>
    <div class="chips quick hs-presets">${REPAIR_PRESETS.map(p => `<button type="button" class="chip-btn" data-action="hs-item-preset" data-v="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <label class="f"><textarea name="item" rows="2">${esc(r.item)}</textarea></label>
    <div class="f-row">
      <label class="f">소비자가격 (원)<input name="amount" inputmode="numeric" value="${r.amount ? r.amount.toLocaleString('ko-KR') : ''}" data-money></label>
      <label class="f">도매가 (원)<input name="wholesale" inputmode="numeric" value="${r.wholesale ? r.wholesale.toLocaleString('ko-KR') : ''}" data-money></label>
    </div>
    <p class="sale-preview">매출 = 소비자가격 − 도매가 → <b data-margin>0원</b></p>
    <label class="f">날짜<input type="date" name="date" value="${r.date || today()}"></label>
    <label class="f">메모<input name="memo" value="${esc(r.memo)}"></label>
    <button class="btn dark big" type="submit">저장하기</button>
  </form>`, sheet => {
    const form = $('#bill-form', sheet);
    const upd = () => { $('[data-margin]', sheet).textContent = won(toNum(form.amount.value) - toNum(form.wholesale.value)); };
    form.amount.addEventListener('input', upd);
    form.wholesale.addEventListener('input', upd);
    upd();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      const retail = toNum(f.get('amount')), cost = toNum(f.get('wholesale'));
      if (cost > retail) { toast('도매가가 소비자가격보다 높아요. 다시 확인해 주세요'); form.wholesale.focus(); return; }
      Object.assign(r, {
        building: f.get('building').trim(), unit: f.get('unit').trim(), phone: f.get('phone').trim(),
        item: f.get('item').trim(), amount: retail, wholesale: cost, date: f.get('date') || r.date, memo: f.get('memo').trim(),
      });
      save();
      await closeSheet();
      toast(`수정했어요 · 매출 ${won(retail - cost)}`);
      refresh();
    });
  });
}

// 청구 금액칸에서 Enter를 누르면 바로 저장
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.bill-input')) {
    e.preventDefault();
    e.target.closest('.bill')?.querySelector('[data-action=bill-save]')?.click();
  }
});


/* ---------- 매출 · 청구 · 그래프 공용 ---------- */
const CHART_COLOR = { direct: '#FFB84D', house: '#2F6E8F', house2: '#8E6CF0', cost: '#C9D6E3', ok: '#13875A', warn: '#E0612B' };
const REPAIR_PRESETS = ['수도·누수', '싱크대', '변기', '보일러', '배관', '전기', '도배·장판', '방충망', '에어컨', '욕실', '기타 수리'];
// 문장 속 전화번호 찾기 (010-1234-5678, 02-333-4444 등)
const findPhone = s => (String(s || '').match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/) || [''])[0].replace(/\s/g, '');
const sumBy = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

// 매출이 된 항목 한눈에: 청소(완료 예약 금액 전체) + 주택관리 수리(소비자가격 − 도매가)
function salesRows(m) {
  const rows = [];
  for (const j of db.jobs) {
    if (!j.done || !(j.date || '').startsWith(m)) continue;
    rows.push({
      kind: 'clean', src: j.source === 'housing' ? 'housing' : 'direct', id: j.id, date: j.date || '',
      bld: j.building || '', place: placeOf(j) || jobTitle(j), what: typeOf(j.type).id,
      retail: j.price || 0, wholesale: 0, sales: j.price || 0, paid: !!j.paid, pay: j.payMethod || '',
    });
  }
  for (const r of db.repairs) {
    if (!(r.date || '').startsWith(m)) continue;
    const cost = r.wholesale || 0;
    rows.push({
      kind: 'housing', src: 'housing', id: r.id, date: r.date || '',
      bld: r.building || '', place: placeOf(r) || '장소 미정', what: r.item || '수리',
      retail: r.amount || 0, wholesale: cost, sales: (r.amount || 0) - cost, paid: !!r.paid, pay: '',
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

// 메모에 금액(예: 80,000원, 8만원)이 적혀 있으면 청구내역에 자동으로 넣어요
function autoBillFromNote(n) {
  const amt = parsePrice(n.text);
  if (!amt) return null;
  const linked = n.repairId && db.repairs.find(x => x.id === n.repairId);
  if (linked) { linked.amount = amt; if (!linked.item) linked.item = n.text; return linked; }
  const rec = {
    id: uid(), building: n.building || '', unit: n.unit || '', phone: '', item: n.text,
    amount: amt, wholesale: 0, date: n.date || today(), memo: '메모에서 자동 등록',
    paid: false, complaintId: null, noteId: n.id, source: 'housing', createdAt: Date.now(),
  };
  db.repairs.push(rec);
  n.repairId = rec.id;
  return rec;
}

// 그래프 (외부 라이브러리 없이 SVG로 그림 → 휴대폰에서도 바로 보임)
function svgStackedBars(labels, series) {
  const W = 340, H = 200, top = 22, base = H - 26, pad = 12;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const max = Math.max(...totals, 1);
  const bw = (W - pad * 2) / labels.length;
  let g = '';
  labels.forEach((lab, i) => {
    const x = pad + i * bw + bw * 0.18, w = bw * 0.64;
    let y = base;
    for (const s of series) {
      const v = s.values[i] || 0;
      const h = (v / max) * (base - top);
      if (h > 0) {
        y -= h;
        g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${s.color}"><title>${esc(s.name)} ${won(v)}</title></rect>`;
      }
    }
    g += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle" class="ch-lab">${esc(lab)}</text>`;
    if (totals[i]) g += `<text x="${x + w / 2}" y="${base - (totals[i] / max) * (base - top) - 6}" text-anchor="middle" class="ch-val">${man(totals[i])}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img" aria-label="월별 매출">${g}</svg>`;
}

function svgDonut(parts, center) {
  const total = sumBy(parts, p => p.value);
  const R = 50, C = 2 * Math.PI * R;
  let off = 0;
  let g = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="#EEF2F6" stroke-width="20"/>`;
  if (total) {
    for (const p of parts) {
      if (!p.value) continue;
      const len = p.value / total * C;
      g += `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.color}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(p.label)} ${won(p.value)}</title></circle>`;
      off += len;
    }
  }
  return `<div class="ch-donut">
    <svg viewBox="0 0 140 140" class="ch-svg" role="img" aria-label="${esc(center)}">${g}
      <text x="70" y="68" text-anchor="middle" class="ch-c1">${esc(center)}</text>
      <text x="70" y="86" text-anchor="middle" class="ch-c2">${total ? '' : '자료 없음'}</text>
    </svg>
    <ul class="ch-legend">${parts.map(p => `<li><i style="background:${p.color}"></i><span>${esc(p.label)}</span><b>${total ? Math.round(p.value / total * 100) : 0}%</b></li>`).join('')}</ul>
  </div>`;
}

function svgHBars(items, color = CHART_COLOR.house) {
  if (!items.length) return '<p class="cp-note">자료가 없어요</p>';
  const max = Math.max(...items.map(x => x.value), 1);
  return `<div class="ch-hbars">${items.map(x => `
    <div class="ch-hrow">
      <span class="ch-hname" title="${esc(x.label)}">${esc(x.label)}</span>
      <span class="ch-htrack"><span class="ch-hfill" style="width:${Math.max(4, Math.round(x.value / max * 100))}%;background:${x.color || color}"></span></span>
      <b class="ch-hval">${man(x.value)}</b>
    </div>`).join('')}</div>`;
}

// 주택관리 가격 구조: 소비자가격 = 도매가 + 매출
function priceBar(retail, cost) {
  const margin = retail - cost, t = retail || 1;
  return `<div class="ch-price">
    <div class="ch-pbar"><span style="width:${Math.round(cost / t * 100)}%;background:${CHART_COLOR.cost}"></span><span style="width:${Math.max(0, Math.round(margin / t * 100))}%;background:${CHART_COLOR.house}"></span></div>
    <div class="ch-plegend"><span><i style="background:${CHART_COLOR.cost}"></i>도매가 ${won(cost)}</span><span><i style="background:${CHART_COLOR.house}"></i>매출 ${won(margin)}</span></div>
    <p class="cp-note">소비자가격 ${won(retail)} = 도매가 + 매출</p>
  </div>`;
}

/* ---------- 샘플 / 백업 ---------- */
function loadSample() {
  const people = [
    ['김민지', '010-1234-5678', '서울 마포구 월드컵로 12, 301호', '현관 비밀번호 1234*, 강아지 있음'],
    ['박서준', '010-2345-6789', '서울 서대문구 연희로 45', ''],
    ['이하늘', '010-3456-7890', '경기 고양시 일산동구 중앙로 1100', '주차 지하 2층'],
    ['(주)밝은사무', '02-333-4444', '서울 중구 세종대로 110, 7층', '평일 19시 이후 방문'],
    ['최유나', '010-5678-9012', '서울 은평구 통일로 684', ''],
  ];
  const PLACES = [
    { building: '래미안 월드컵', unit: '103동 301호', doorPw: '*1234#' },
    { building: '연희 파크빌', unit: '202호', doorPw: '5580' },
    { building: '일산 호수마을', unit: '1102동 804호', doorPw: '#0909' },
    { building: '세종타워', unit: '7층 701호', doorPw: '2468*' },
    { building: '은평 뉴타운', unit: '502동 1203호', doorPw: '' },
  ];
  const C = people.map(([name, phone, address, memo]) => ({ id: uid(), name, phone, address, memo, createdAt: Date.now() }));
  const t = today();
  // [고객, 날짜(오늘 기준), 시간, 종류, 금액, 완료, 결제, 수단, 소요(분)]
  const spec = [
    [0, 0, '09:30', '기타', 80000, true, true, '계좌이체', 150],
    [3, 0, '13:00', '입주청소', 120000, false, false, '', 0],
    [1, 0, '17:00', '에어컨청소', 90000, false, false, '', 0],
    [2, 1, '10:00', '입주청소', 350000, false, false, '', 0],
    [4, 3, '14:00', '이사청소', 280000, false, false, '', 0],
    [0, 7, '09:30', '기타', 80000, false, false, '', 0],
    [0, -7, '09:30', '기타', 80000, true, true, '계좌이체', 140],
    [1, -5, '11:00', '기타', 70000, true, false, '', 120],
    [4, -12, '10:00', '입주청소', 320000, true, true, '카드', 300],
    [3, -20, '19:00', '입주청소', 120000, true, true, '계좌이체', 110],
    [2, -35, '10:00', '이사청소', 250000, true, true, '카드', 260],
    [0, -40, '09:30', '기타', 80000, true, true, '현금', 150],
    [3, -60, '19:00', '입주청소', 120000, true, true, '계좌이체', 100],
    [1, -80, '10:00', '에어컨청소', 90000, true, true, '카드', 80],
    [4, -100, '10:00', '기타', 70000, true, true, '현금', 130],
    [2, -130, '10:00', '입주청소', 330000, true, true, '카드', 280],
  ];
  const J = spec.map(([ci, off, time, type, price, done, paid, payMethod, dur]) => {
    const j = newJob({ customerId: C[ci].id, type, date: addDays(t, off), time, price, memo: '', ...PLACES[ci] });
    const at = parseYmd(j.date).getTime() + 12 * 3600e3;
    Object.assign(j, { done, doneAt: done ? at : null, paid, payMethod, paidAt: paid ? at : null, durationMin: dur });
    return j;
  });
  db.customers.push(...C);
  db.jobs.push(...J);
  save();
}

const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function exportBackup() {
  toast('백업 파일 만드는 중...');
  const photos = {};
  for (const id of db.jobs.flatMap(jobPhotoIds)) {
    const b = await PhotoDB.get(id);
    if (b) photos[id] = await blobToDataURL(b);
  }
  const blob = new Blob([JSON.stringify({ app: 'cleannote', version: 1, exportedAt: new Date().toISOString(), db, photos })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `청소노트-백업-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('백업 파일을 저장했어요');
}
async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data?.db?.jobs || !data.db.customers) throw new Error('bad file');
    if (!confirm(`백업(${(data.exportedAt || '').slice(0, 10)})으로 현재 데이터를 바꿀까요?`)) return;
    await PhotoDB.clear();
    urlCache.clear();
    for (const [id, url] of Object.entries(data.photos || {})) await PhotoDB.put(id, await (await fetch(url)).blob());
    db = data.db;
    db.repairs ||= [];
    db.repairPhotos ||= [];
    db.complaints ||= [];
    db.housingNotes ||= [];
    db.types ||= [...DEFAULT_TYPES];
    save();
    toast('복원했어요');
    go('home');
  } catch (e) {
    toast('올바른 백업 파일이 아니에요');
  }
}

/* ---------- 토스트 ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

/* ---------- 이벤트 ---------- */
const actions = {
  back: goBack,
  fab() {
    const [page, id] = currentPage();
    openJobForm(null, { date: page === 'schedule' ? ui.selDate : today(), customerId: page === 'customer' ? id : undefined });
  },
  'new-job': el => openJobForm(null, { date: el.dataset.date, customerId: el.dataset.cid }),
  'edit-job': el => openJobForm(findJob(el.dataset.id)),
  async 'delete-job'(el) {
    const j = findJob(el.dataset.id);
    if (!j || !confirm('이 일정을 삭제할까요?\n사진도 함께 삭제돼요.')) return;
    await removePhotos(jobPhotoIds(j));
    db.jobs = db.jobs.filter(x => x !== j);
    save();
    toast('삭제했어요');
    if (currentPage()[0] === 'job') goBack(); else refresh();
  },
  'paste-fill'(el) {
    const form = el.closest('form');
    applyParsed(form, parseReservation($('#ai-text', form).value));
  },
  async 'sync-pull'() {
    try {
      const r = await pullFromServer();
      toast(r.msg);
      refresh();
    } catch (e) {
      toast(e.message || '가져오지 못했어요. 인터넷을 확인해 주세요');
    }
  },
  'sync-save'() {
    const v = $('#sync-url').value.trim();
    try { localStorage.setItem(SYNC_KEY, v); } catch { /* 저장 불가 환경 */ }
    toast(v ? '서버 주소를 저장했어요' : '서버 주소를 지웠어요');
    refresh();
  },
  'hs-search': () => openHousingSearch(),
  'hs-repair': () => openRepairForm(),
  'hs-photo': () => openRepairPhotoForm(),
  'hs-sms': () => openHousingSms(),
  'hs-open'(el) { closeSheet().then(() => go(el.dataset.go)); },
  'hs-set-amount'(el) {
    const f = el.closest('form');
    f.amount.value = (+el.dataset.v).toLocaleString('ko-KR');
    f.amount.dispatchEvent(new Event('input', { bubbles: true }));
  },
  'hs-tpl'(el) {
    const form = el.closest('form');
    const place = [form.building.value.trim(), form.unit.value.trim()].filter(Boolean).join(' ') || '해당 장소';
    const amount = toNum(form.amount.value);
    form.body.value = HOUSING_TEMPLATES[el.dataset.v]({ place, item: '', amount: amount ? won(amount) : '' });
  },
  'hs-toggle-paid'(el) {
    const r = db.repairs.find(x => x.id === el.dataset.id);
    if (!r) return;
    r.paid = !r.paid;
    save();
    refresh();
    toast(r.paid ? '받음으로 표시했어요' : '받음을 취소했어요');
  },
  'hs-photo-view'(el) {
    const rec = db.repairPhotos.find(p => p.id === el.dataset.id);
    if (!rec) return;
    openSheet(`
      <div class="viewer">
        <div class="hs-viewer-grid">${rec.pids.map(pid => `<img data-photo="${pid}" alt="">`).join('')}</div>
        <div class="viewer-bar"><button class="btn danger" data-action="hs-photo-del" data-id="${rec.id}">${IC.trash}삭제</button><button class="btn yellow" data-action="close-sheet">닫기</button></div>
      </div>`, sheet => hydratePhotos(sheet), 'full');
  },
  async 'hs-photo-del'(el) {
    const rec = db.repairPhotos.find(p => p.id === el.dataset.id);
    if (!rec || !confirm('이 수리 사진을 모두 삭제할까요?')) return;
    await removePhotos(rec.pids);
    db.repairPhotos = db.repairPhotos.filter(p => p !== rec);
    save();
    await closeSheet();
    refresh();
  },
  'hs-complaints': () => go('complaints'),
  'hs-billing': () => go('billing'),
  'cp-new': () => complaintForm(),
  'cp-edit'(el) {
    const c = db.complaints.find(x => x.id === el.dataset.id);
    if (c) complaintForm(c);
  },
  'cp-done'(el) {
    const c = db.complaints.find(x => x.id === el.dataset.id);
    if (!c || c.status === 'done') return;
    // 처리 완료 → 청구내역에 금액 0원으로 넣고, 바로 금액 입력칸으로 이동
    const rec = {
      id: uid(), building: c.building, unit: c.unit, phone: c.phone, item: c.content,
      amount: 0, date: today(), memo: '', paid: false, complaintId: c.id, createdAt: Date.now(),
    };
    db.repairs.push(rec);
    Object.assign(c, { status: 'done', doneAt: Date.now(), billingId: rec.id });
    save();
    toast('처리 완료! 청구 금액을 넣어 주세요');
    go('billing/' + rec.id);
  },
  'cp-delete'(el) {
    const c = db.complaints.find(x => x.id === el.dataset.id);
    if (!c || !confirm('이 민원을 삭제할까요?\n청구내역은 그대로 남아요.')) return;
    db.complaints = db.complaints.filter(x => x !== c);
    save();
    refresh();
    toast('민원을 삭제했어요');
  },
  'bill-open': () => go('billing'),
  'bill-save'(el) {
    const r = db.repairs.find(x => x.id === el.dataset.id);
    if (!r) return;
    const card = el.closest('.bill');
    const retail = toNum(card.querySelector('.bill-input').value);
    const cost = toNum(card.querySelector('.bill-wholesale').value);
    if (cost > retail) { toast('도매가가 소비자가격보다 높아요'); return; }
    Object.assign(r, { amount: retail, wholesale: cost });
    save();
    refresh();
    toast(retail ? `저장했어요 · 매출 ${won(retail - cost)}` : '금액을 비웠어요');
  },
  'bill-edit'(el) {
    const r = db.repairs.find(x => x.id === el.dataset.id);
    if (r) billForm(r);
  },
  'bill-delete'(el) {
    const r = db.repairs.find(x => x.id === el.dataset.id);
    if (!r || !confirm('이 청구 내역을 삭제할까요?')) return;
    db.repairs = db.repairs.filter(x => x !== r);
    db.complaints.forEach(c => { if (c.billingId === r.id) c.billingId = null; });
    save();
    refresh();
    toast('청구 내역을 삭제했어요');
  },
  'hs-paste': () => openHousingPaste(),
  'hs-paste-tag'(el) {
    const ta = $('#hs-paste-text');
    const tag = `${el.dataset.v}:`;
    if (!ta.value.trim().startsWith(tag)) ta.value = `${tag}\n${ta.value}`;
    ta.focus();
  },
  'hs-paste-fill'() {
    const text = $('#hs-paste-text').value;
    if (!text.trim()) { toast('내용을 붙여넣어 주세요'); return; }
    const r = parseAiText(text);
    if (r.kind === 'complaint') complaintForm(null, r.fields);
    else if (r.kind === 'charge') openRepairForm(r.fields);
    else if (r.kind === 'note') memoForm(null, { building: r.fields.building, unit: r.fields.unit, text: r.fields.text, source: 'ai' });
    else { openJobForm(null, {}); applyParsed($('#job-form'), parseReservation(r.text)); }
  },
  'memo-new': () => memoForm(),
  'memo-edit'(el) {
    const n = db.housingNotes.find(x => x.id === el.dataset.id);
    if (n) memoForm(n);
  },
  'memo-delete'(el) {
    const n = db.housingNotes.find(x => x.id === el.dataset.id);
    if (!n || !confirm('이 메모를 삭제할까요?')) return;
    const linked = n.repairId && db.repairs.find(x => x.id === n.repairId);
    if (linked && confirm('이 메모로 자동 등록된 청구내역도 함께 지울까요?')) db.repairs = db.repairs.filter(x => x !== linked);
    db.housingNotes = db.housingNotes.filter(x => x !== n);
    save();
    refresh();
    toast('메모를 삭제했어요');
  },
  'hs-item-preset'(el) {
    const f = el.closest('form');
    f.item.value = el.dataset.v;
    f.item.focus();
  },
  'sales-open'(el) {
    if (el.dataset.kind === 'clean') go('job/' + el.dataset.id);
    else go('billing');
  },
  'toggle-pw'(el) { el.classList.toggle('on'); },
  'edit-types'(el) {
    const form = el.closest('form');
    $('.type-chips', form).classList.toggle('editing');
    renderTypeChips(form);
    $('[data-type-new]', form)?.focus();
  },
  'add-type'(el) {
    const form = el.closest('form'), inp = $('[data-type-new]', form);
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    if (db.types.includes(name)) { toast('이미 있는 종류예요'); return; }
    db.types.push(name);
    save();
    renderTypeChips(form);
    $('[data-type-new]', form).focus();
  },
  'remove-type'(el) {
    const form = el.closest('form'), name = el.dataset.v;
    if (!confirm(`'${name}' 종류를 목록에서 뺄까요?\n이미 등록된 예약은 그대로 남아요.`)) return;
    db.types = db.types.filter(x => x !== name);
    save();
    renderTypeChips(form);
  },
  'rename-type'(el) {
    const form = el.closest('form'), old = el.dataset.v;
    const name = prompt('청소 종류 이름 수정', old)?.trim();
    if (!name || name === old) return;
    if (db.types.includes(name)) { toast('이미 있는 종류예요'); return; }
    db.types = db.types.map(x => x === old ? name : x);
    db.jobs.forEach(x => { if (x.type === old) x.type = name; });
    const box = $('.type-chips', form);
    if (box.dataset.sel === old) box.dataset.sel = name;
    save();
    renderTypeChips(form);
  },
  'toggle-done'(el) {
    const j = findJob(el.dataset.id);
    j.done = !j.done;
    j.doneAt = j.done ? Date.now() : null;
    if (j.done && j.startedAt && !j.endedAt) stopTimer(j);
    save();
    refresh();
    toast(j.done ? (j.paid ? '청소 완료! 수고하셨어요 👏' : '청소 완료! 결제도 확인해 주세요') : '완료를 취소했어요');
  },
  'timer-start'(el) {
    const j = findJob(el.dataset.id);
    Object.assign(j, { startedAt: Date.now(), endedAt: null });
    save(); refresh();
    toast('시간 측정을 시작했어요');
  },
  'timer-stop'(el) {
    const j = findJob(el.dataset.id);
    stopTimer(j);
    save(); refresh();
    toast(`소요 시간 ${fmtDur(j.durationMin)}`);
  },
  'edit-duration': el => openDurationForm(findJob(el.dataset.id)),
  'set-paid'(el) {
    const j = findJob(el.dataset.id);
    j.paid = el.dataset.v === '1';
    j.paidAt = j.paid ? Date.now() : null;
    save(); refresh();
  },
  'set-method'(el) {
    const j = findJob(el.dataset.id);
    j.payMethod = j.payMethod === el.dataset.v ? '' : el.dataset.v;
    if (j.payMethod && !j.paid) { j.paid = true; j.paidAt = Date.now(); }
    save(); refresh();
  },
  'quick-pay'(el) {
    const j = findJob(el.dataset.id);
    Object.assign(j, { paid: true, paidAt: Date.now() });
    save(); refresh();
    toast(`${won(j.price)} 결제 완료 처리했어요`);
  },
  'view-photo'(el) {
    const { id, kind, pid } = el.dataset;
    openSheet(`
      <div class="viewer">
        <img data-photo="${pid}" alt="">
        <div class="viewer-bar"><button class="btn danger" data-action="delete-photo" data-id="${id}" data-kind="${kind}" data-pid="${pid}">${IC.trash}삭제</button><button class="btn yellow" data-action="close-sheet">닫기</button></div>
      </div>`, sheet => hydratePhotos(sheet), 'full');
  },
  async 'delete-photo'(el) {
    const { id, kind, pid } = el.dataset;
    if (!confirm('이 사진을 삭제할까요?')) return;
    const j = findJob(id);
    j.photos[kind] = j.photos[kind].filter(x => x !== pid);
    await removePhotos([pid]);
    save();
    await closeSheet();
    refresh();
  },
  'pick-date'(el) { ui.selDate = el.dataset.date; refresh(); },
  'week-shift'(el) { ui.selDate = addDays(ui.selDate, +el.dataset.n); refresh(); },
  'go-today'() { ui.selDate = today(); refresh(); },
  'month-shift'(el) { ui.statMonth = shiftMonth(ui.statMonth, +el.dataset.n); refresh(); },
  'set-month'(el) { ui.statMonth = el.dataset.m; refresh(); },
  'new-customer': () => openCustomerForm(),
  'edit-customer': el => openCustomerForm(cust(el.dataset.id)),
  async 'delete-customer'(el) {
    const c = cust(el.dataset.id);
    const jobs = db.jobs.filter(j => j.customerId === c.id);
    if (!confirm(`${c.name} 고객을 삭제할까요?${jobs.length ? `\n청소 기록 ${jobs.length}건도 함께 삭제돼요.` : ''}`)) return;
    await removePhotos(jobs.flatMap(jobPhotoIds));
    db.jobs = db.jobs.filter(j => j.customerId !== c.id);
    db.customers = db.customers.filter(x => x !== c);
    save();
    toast('삭제했어요');
    goBack();
  },
  'close-sheet': () => closeSheet(),
  'set-price'(el) { $('#job-form').price.value = (+el.dataset.v).toLocaleString('ko-KR'); },
  sample() {
    if (db.jobs.length && !confirm('지금 데이터에 샘플을 추가할까요?')) return;
    loadSample();
    toast('샘플 데이터를 넣었어요');
    go('home');
    render();
  },
  export: exportBackup,
  async install() { if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; refresh(); } },
  async reset() {
    if (!confirm('정말 모든 일정·고객·사진을 삭제할까요?\n되돌릴 수 없어요.')) return;
    await PhotoDB.clear();
    urlCache.clear();
    db = { customers: [], jobs: [], types: [...DEFAULT_TYPES], repairs: [], repairPhotos: [], complaints: [], housingNotes: [] };
    save();
    toast('모두 삭제했어요');
    go('home');
  },
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-action]');
  if (a) { e.preventDefault(); actions[a.dataset.action]?.(a, e); return; }
  if (e.target.closest('a[href], label')) return;
  const g = e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.matches('[data-photo-input]')) {
    const j = findJob(el.dataset.id), files = [...el.files];
    if (!j || !files.length) return;
    toast('사진 저장 중...');
    let ok = 0;
    for (const f of files) {
      try {
        const pid = uid();
        await PhotoDB.put(pid, await compress(f));
        j.photos[el.dataset.kind].push(pid);
        ok++;
      } catch (err) { console.error(err); }
    }
    save();
    refresh();
    toast(ok === files.length ? `사진 ${ok}장을 저장했어요` : `사진 ${files.length - ok}장은 저장하지 못했어요`);
  } else if (el.matches('[data-date-jump]') && el.value) {
    ui.selDate = el.value;
    refresh();
  } else if (el.matches('[data-import]')) {
    importBackup(el.files[0]);
    el.value = '';
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-money]')) {
    const n = toNum(el.value);
    el.value = n ? n.toLocaleString('ko-KR') : '';
  } else if (el.matches('[data-cust-search]')) {
    ui.custQuery = el.value;
    $('#cust-list').innerHTML = custList();
  }
});

window.addEventListener('hashchange', () => { navCount++; render(); });

/* ---------- 시작 ---------- */
// 앱을 열거나 다시 보일 때 AI 보관함의 새 예약을 자동으로 가져오기 (주소를 저장한 경우만)
let autoPulling = false;
async function autoPull() {
  if (autoPulling || !syncUrl().trim()) return;
  autoPulling = true;
  try {
    const r = await pullFromServer();
    if (r.n) { toast(r.msg); refresh(); }
  } catch { /* 인터넷이 없을 때는 조용히 넘어가요. 설정의 “예약 가져오기”로 다시 할 수 있어요 */ }
  finally { autoPulling = false; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoPull(); });
render();
setTimeout(() => $('#splash').classList.add('hide'), 1200);
autoPull();
// 휴대폰 저장공간이 부족해도 브라우저가 데이터를 지우지 않도록 요청
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
