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
    if (d && Array.isArray(d.jobs)) { d.types ||= [...DEFAULT_TYPES]; return d; }
  } catch (e) { /* 손상된 데이터면 새로 시작 */ }
  return { customers: [], jobs: [], types: [...DEFAULT_TYPES] };
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
  const pages = { home, schedule, customers, stats, settings, job: jobPage, customer: customerPage };
  const fn = pages[page] || home;
  document.body.classList.toggle('detail', ['job', 'customer', 'settings'].includes(page));
  app.innerHTML = fn(id);
  document.querySelectorAll('#tabbar [data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === (pages[page] ? page : 'home')));
  hydratePhotos();
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
      <p class="job-meta">${showDate ? `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]}) · ` : ''}${j.time} · ${t.emoji} ${t.id}</p>
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
  const upcoming = db.jobs.filter(j => j.date >= t && !j.done).sort(byDateTime).slice(0, 5);
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
  const mj = db.jobs.filter(j => j.date.startsWith(m));
  const done = mj.filter(j => j.done);
  const sales = sum(done), paid = sum(done.filter(j => j.paid)), planned = sum(mj.filter(j => !j.done));
  const timed = done.filter(j => j.durationMin > 0);
  const avgMin = timed.length ? Math.round(timed.reduce((a, j) => a + j.durationMin, 0) / timed.length) : 0;

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(m, i - 5));
  const vals = months.map(k => sum(db.jobs.filter(j => j.done && j.date.startsWith(k))));
  const max = Math.max(...vals, 1);

  const byType = [...new Set(done.map(j => j.type))].map(name => ({ t: typeOf(name), v: sum(done.filter(j => j.type === name)) }));
  const tMax = Math.max(...byType.map(x => x.v), 1);
  const byPay = PAY.map(p => ({ p, v: sum(done.filter(j => j.paid && j.payMethod === p)) })).filter(x => x.v);
  const pMax = Math.max(...byPay.map(x => x.v), 1);
  const unpaid = db.jobs.filter(j => j.done && !j.paid).sort(byDateTime);

  return `
  <section class="page-head">
    <div class="row"><h1>매출 · 통계</h1></div>
    <div class="month-nav" style="margin-bottom:0">
      <button class="icon-btn" data-action="month-shift" data-n="-1" aria-label="이전 달">${IC.left}</button>
      <b style="font-size:17px">${y}년 ${mm}월</b>
      <button class="icon-btn" data-action="month-shift" data-n="1" aria-label="다음 달">${IC.right}</button>
    </div>
  </section>

  <section class="stat-hero">
    <p class="lbl">${mm}월 완료 매출</p>
    <p class="big">${won(sales)}</p>
    <p class="s">완료 ${done.length}건 · 남은 예정 ${won(planned)}</p>
    <span class="b-art" aria-hidden="true">📈</span>
  </section>
  <div class="tiles">
    <div class="tile"><small>결제 완료</small><b class="green">${man(paid)}</b></div>
    <div class="tile"><small>미수금</small><b class="orange">${man(sales - paid)}</b></div>
    <div class="tile"><small>평균 소요</small><b>${avgMin ? fmtDur(avgMin) : '-'}</b></div>
  </div>

  <section class="card">
    <h3>월별 매출 <span class="right">최근 6개월</span></h3>
    <div class="bars">${months.map((k, i) => `
      <button class="bar-col ${k === m ? 'on' : ''}" data-action="set-month" data-m="${k}">
        <em>${vals[i] ? man(vals[i]) : ''}</em>
        <div class="bar-fill" style="height:${Math.round(vals[i] / max * 100)}%"></div>
        <span>${+k.slice(5)}월</span>
      </button>`).join('')}
    </div>
  </section>

  ${byType.length ? `<section class="card"><h3>청소 종류별</h3>${byType.map(x => `
    <div class="hrow"><span class="name">${x.t.emoji} ${x.t.id}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(x.v / tMax * 100)}%"></span></span><span class="val">${man(x.v)}</span></div>`).join('')}
  </section>` : ''}
  ${byPay.length ? `<section class="card"><h3>결제 수단별</h3>${byPay.map(x => `
    <div class="hrow"><span class="name">${x.p}</span><span class="track"><span class="fill" style="display:block;width:${Math.round(x.v / pMax * 100)}%;background:#FFB35C"></span></span><span class="val">${man(x.v)}</span></div>`).join('')}
  </section>` : ''}

  <section class="card">
    <h3>받을 돈 (미수) <span class="right">${won(sum(unpaid))}</span></h3>
    ${unpaid.length ? unpaid.map(j => `
      <div class="unpaid-row">
        <div class="who" data-go="job/${j.id}"><b>${esc(jobTitle(j))}</b><small>${dateLabel(j.date)} · ${typeOf(j.type).id}</small></div>
        <span class="amt">${won(j.price)}</span>
        <button class="mini-btn" data-action="quick-pay" data-id="${j.id}">받음</button>
      </div>`).join('') : '<p style="color:var(--muted);font-weight:600">미수금이 없어요 🎉</p>'}
  </section>`;
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
    <span class="badge ${j.done ? 'done' : ''}">${j.done ? '✓ 청소 완료' : '예정'}</span>
  </section>

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
  const j = job || { date: preset.date || today(), time: '10:00', type: db.types[0] || '기타', price: 0, customerId: preset.customerId || '', memo: '' };

  openSheet(`
  <form class="form" id="job-form" autocomplete="off">
    <h2>${isNew ? '청소 예약 등록' : '예약 수정'}</h2>
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
    // 전에 쓴 건물명을 입력하면 지난 예약의 호수·비밀번호를 채워줌
    form.building.addEventListener('change', () => {
      const last = db.jobs.filter(x => x.building && x.building === form.building.value.trim()).sort(byDateTime).pop();
      if (last) for (const k of ['unit', 'doorPw']) if (!form[k].value) form[k].value = last[k] || '';
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(form);
      if ($('.type-chips', form).classList.contains('editing')) { toast('청소 종류 편집을 먼저 완료해 주세요'); return; }
      const base = { customerId: j.customerId || '', type: f.get('type') || $('.type-chips', form).dataset.sel || '기타', date: f.get('date'), time: f.get('time'), price: toNum(f.get('price')), memo: f.get('memo').trim(),
        building: f.get('building').trim(), unit: f.get('unit').trim(), doorPw: f.get('doorPw').trim() };
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
    db = { customers: [], jobs: [], types: [...DEFAULT_TYPES] };
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
render();
setTimeout(() => $('#splash').classList.add('hide'), 1200);
// 휴대폰 저장공간이 부족해도 브라우저가 데이터를 지우지 않도록 요청
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
