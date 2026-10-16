// 청소노트 중간 서버 (Cloudflare Worker)
// - /mcp/<비밀키>      : 그록·클로드가 연결하는 주소 (예약·민원·청구·메모를 보관함에 넣기)
// - /inbox/<비밀키>    : 휴대폰 청소노트가 보관함을 가져가는 주소
// 보관함에 들어간 항목은 휴대폰이 가져가면 서버에서 지워집니다.

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version',
};
const PROTOCOL_VERSION = '2025-06-18';
const MAX_ITEMS = 200;

const TOOLS = [
  {
    name: 'add_reservation',
    description: '청소 예약을 보관함에 넣습니다. 사용자가 휴대폰 청소노트에서 "서버에서 가져오기"를 누르면 예약으로 옮겨집니다. 날짜와 시간은 꼭 필요합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        building: { type: 'string', description: '건물명. 예: 래미안 아파트' },
        unit: { type: 'string', description: '호수. 예: 101동 1203호' },
        doorPw: { type: 'string', description: '출입 비밀번호. 예: 1234*' },
        date: { type: 'string', description: '날짜 YYYY-MM-DD. 예: 2026-10-20' },
        time: { type: 'string', description: '시작 시간 HH:MM (24시간). 예: 14:00' },
        price: { type: 'number', description: '금액(원). 예: 150000' },
        type: { type: 'string', description: '청소 종류. 예: 입주청소, 이사청소, 에어컨청소, 기타' },
        memo: { type: 'string', description: '메모' },
      },
      required: ['date', 'time'],
    },
  },
  {
    name: 'add_complaint',
    description: '주택관리 민원(고장 신고)을 접수합니다. 사용자가 휴대폰 청소노트에서 "서버에서 가져오기"를 누르면 주택관리 > 민원처리에 나타납니다. 시간이나 요청 사항도 content에 함께 적어 주세요.',
    inputSchema: {
      type: 'object',
      properties: {
        building: { type: 'string', description: '건물 이름. 예: 래미안 아파트' },
        unit: { type: 'string', description: '호수. 예: 101동 1203호' },
        phone: { type: 'string', description: '연락처. 예: 010-1234-5678' },
        content: { type: 'string', description: '고장 신고 내용. 시간·요청 사항도 함께 적기' },
      },
      required: ['content'],
    },
  },
  {
    name: 'add_repair_charge',
    description: '수리비 청구 내역을 넣습니다. 휴대폰 청소노트 주택관리 > 청구내역에 나타나고, 사용자가 금액을 확인하고 고칠 수 있습니다. 금액을 모르면 생략하세요.',
    inputSchema: {
      type: 'object',
      properties: {
        building: { type: 'string', description: '건물 이름. 예: 래미안 아파트' },
        unit: { type: 'string', description: '호수. 예: 101동 1203호' },
        phone: { type: 'string', description: '연락처. 예: 010-1234-5678' },
        item: { type: 'string', description: '수리 내용. 예: 싱크대 누수 수리' },
        amount: { type: 'number', description: '청구 금액(원). 예: 80000' },
        date: { type: 'string', description: '날짜 YYYY-MM-DD. 생략하면 오늘' },
        memo: { type: 'string', description: '메모' },
      },
      required: ['item'],
    },
  },
  {
    name: 'add_housing_memo',
    description: '주택관리 메모를 남깁니다. 건물·호수별 메모로 휴대폰 청소노트 주택관리 > 메모에 나타납니다.',
    inputSchema: {
      type: 'object',
      properties: {
        building: { type: 'string', description: '건물 이름. 예: 래미안 아파트' },
        unit: { type: 'string', description: '호수. 예: 101동 1203호' },
        text: { type: 'string', description: '메모 내용' },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_pending',
    description: '아직 휴대폰으로 가져가지 않은 보관함 항목(예약·민원·청구·메모) 목록을 보여줍니다.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const validDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : kstToday());
const money = v => Math.max(0, Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0));
const place = r => [r.building, r.unit].filter(Boolean).join(' ') || '장소 미정';

function cleanReservation(a) {
  const date = clip(a.date, 10);
  const time = clip(a.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 해요. 예: 2026-10-20');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('시간은 HH:MM 형식이어야 해요. 예: 14:00');
  return {
    kind: 'reservation',
    building: clip(a.building, 60),
    unit: clip(a.unit, 40),
    doorPw: clip(a.doorPw, 30),
    date,
    time,
    price: money(a.price),
    type: clip(a.type, 20),
    memo: clip(a.memo, 300),
    createdAt: new Date().toISOString(),
  };
}

function cleanComplaint(a) {
  const content = clip(a.content, 500);
  if (!content) throw new Error('고장 신고 내용(content)을 적어 주세요');
  return {
    kind: 'complaint',
    building: clip(a.building, 60),
    unit: clip(a.unit, 40),
    phone: clip(a.phone, 30),
    content,
    date: kstToday(),
    createdAt: new Date().toISOString(),
  };
}

function cleanCharge(a) {
  const item = clip(a.item, 200);
  if (!item) throw new Error('수리 내용(item)을 적어 주세요');
  return {
    kind: 'charge',
    building: clip(a.building, 60),
    unit: clip(a.unit, 40),
    phone: clip(a.phone, 30),
    item,
    amount: money(a.amount),
    date: validDate(a.date),
    memo: clip(a.memo, 300),
    createdAt: new Date().toISOString(),
  };
}

function cleanNote(a) {
  const text = clip(a.text, 500);
  if (!text) throw new Error('메모 내용(text)을 적어 주세요');
  return {
    kind: 'note',
    building: clip(a.building, 60),
    unit: clip(a.unit, 40),
    text,
    date: kstToday(),
    createdAt: new Date().toISOString(),
  };
}

async function listInbox(env) {
  const { keys } = await env.KV.list({ prefix: 'r:', limit: MAX_ITEMS });
  const items = [];
  for (const k of keys) {
    const v = await env.KV.get(k.name, 'json');
    if (v) items.push({ id: k.name.slice(2), kind: 'reservation', ...v });
  }
  return items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

const summary = r => {
  if (r.kind === 'complaint') return `[민원] ${place(r)} · ${r.content.slice(0, 40)}`;
  if (r.kind === 'charge') return `[청구] ${place(r)} · ${r.item} · ${r.amount ? r.amount.toLocaleString('ko-KR') + '원' : '금액 미정'}`;
  if (r.kind === 'note') return `[메모] ${place(r)} · ${r.text.slice(0, 40)}`;
  return `[예약] ${r.date} ${r.time} · ${place(r)}${r.type ? ' · ' + r.type : ''}`;
};

const DONE_TEXT = {
  reservation: '예약을 보관함에 넣었어요',
  complaint: '민원을 보관함에 넣었어요',
  charge: '수리비 청구를 보관함에 넣었어요',
  note: '주택관리 메모를 보관함에 넣었어요',
};

async function callTool(name, args, env) {
  const a = args || {};
  const keep = async (r, kind) => {
    await env.KV.put('r:' + crypto.randomUUID(), JSON.stringify(r));
    return { text: `${DONE_TEXT[kind]}: ${summary(r)}\n사용자가 휴대폰 청소노트에서 "서버에서 가져오기"를 누르면 옮겨져요.` };
  };
  if (name === 'add_reservation') return keep(cleanReservation(a), 'reservation');
  if (name === 'add_complaint') return keep(cleanComplaint(a), 'complaint');
  if (name === 'add_repair_charge') return keep(cleanCharge(a), 'charge');
  if (name === 'add_housing_memo') return keep(cleanNote(a), 'note');
  if (name === 'list_pending') {
    const items = await listInbox(env);
    if (!items.length) return { text: '보관함이 비어 있어요. 아직 가져가지 않은 항목이 없어요.' };
    return { text: `아직 가져가지 않은 항목 ${items.length}건:\n` + items.map(summary).join('\n') };
  }
  throw new Error('알 수 없는 도구예요: ' + name);
}

async function handleMcp(req, env) {
  let msg;
  try { msg = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const isNotification = msg.id === undefined;
  const ok = result => json({ jsonrpc: '2.0', id: msg.id, result });

  if (isNotification) return new Response(null, { status: 202, headers: JSON_HEADERS });

  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: msg.params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'cleannote', version: '1.1.0' },
        instructions: '청소노트 보관함에 예약·민원·청구·메모를 넣는 서버예요. 날짜는 YYYY-MM-DD, 시간은 HH:MM 형식으로 맞춰 주세요.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call':
      try {
        const out = await callTool(msg.params?.name, msg.params?.arguments, env);
        return ok({ content: [{ type: 'text', text: out.text }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: '오류: ' + e.message }], isError: true });
      }
    default:
      return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });

    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const [area, key, id] = parts;

    if (!env.SECRET || key !== env.SECRET) return json({ error: '주소가 맞지 않아요' }, 401);

    // 그록·클로드가 연결하는 주소
    if (area === 'mcp') {
      if (req.method !== 'POST') return json({ error: 'POST만 받아요' }, 405);
      return handleMcp(req, env);
    }

    // 휴대폰 청소노트가 쓰는 주소
    if (area === 'inbox') {
      if (req.method === 'GET' && !id) return json({ items: await listInbox(env) });
      if (req.method === 'POST' && id === 'ack') {
        const body = await req.json().catch(() => ({}));
        const ids = Array.isArray(body.ids) ? body.ids.slice(0, MAX_ITEMS) : [];
        for (const x of ids) await env.KV.delete('r:' + String(x));
        return json({ removed: ids.length });
      }
    }

    return json({ error: '없는 주소예요' }, 404);
  },
};
