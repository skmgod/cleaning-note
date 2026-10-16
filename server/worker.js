// 청소노트 중간 서버 (Cloudflare Worker)
// - /mcp/<비밀키>      : 그록·클로드·제미나이가 연결하는 주소 (예약을 보관함에 넣기)
// - /inbox/<비밀키>    : 휴대폰 청소노트가 보관함을 가져가는 주소
// 보관함에 들어간 예약은 휴대폰이 가져가면 서버에서 지워집니다.

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
    description: '청소 예약을 청소노트 보관함에 넣습니다. 사용자가 휴대폰 청소노트 앱에서 "서버에서 예약 가져오기"를 누르면 휴대폰으로 옮겨집니다. 날짜와 시간은 꼭 필요합니다.',
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
    name: 'list_pending',
    description: '아직 휴대폰으로 가져가지 않은 보관함 예약 목록을 보여줍니다.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

function cleanReservation(a) {
  const date = clip(a.date, 10);
  const time = clip(a.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 해요. 예: 2026-10-20');
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('시간은 HH:MM 형식이어야 해요. 예: 14:00');
  const price = Math.max(0, Math.round(Number(a.price) || 0));
  return {
    building: clip(a.building, 60),
    unit: clip(a.unit, 40),
    doorPw: clip(a.doorPw, 30),
    date,
    time,
    price,
    type: clip(a.type, 20),
    memo: clip(a.memo, 300),
    createdAt: new Date().toISOString(),
  };
}

async function listInbox(env) {
  const { keys } = await env.KV.list({ prefix: 'r:', limit: MAX_ITEMS });
  const items = [];
  for (const k of keys) {
    const v = await env.KV.get(k.name, 'json');
    if (v) items.push({ id: k.name.slice(2), ...v });
  }
  return items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

const summary = r => `${r.date} ${r.time} · ${[r.building, r.unit].filter(Boolean).join(' ') || '장소 미정'}${r.type ? ' · ' + r.type : ''}`;

async function callTool(name, args, env) {
  if (name === 'add_reservation') {
    const r = cleanReservation(args || {});
    const id = crypto.randomUUID();
    await env.KV.put('r:' + id, JSON.stringify(r));
    return { text: `보관함에 넣었어요: ${summary(r)}\n사용자가 앱에서 "서버에서 예약 가져오기"를 누르면 휴대폰으로 옮겨져요.` };
  }
  if (name === 'list_pending') {
    const items = await listInbox(env);
    if (!items.length) return { text: '보관함이 비어 있어요. 아직 가져가지 않은 예약이 없어요.' };
    return { text: `아직 가져가지 않은 예약 ${items.length}건:\n` + items.map(summary).join('\n') };
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
        serverInfo: { name: 'cleannote', version: '1.0.0' },
        instructions: '청소 예약을 청소노트 보관함에 넣는 서버예요. 날짜(YYYY-MM-DD)와 시간(HH:MM)은 꼭 맞춰 주세요.',
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

    // 그록·클로드·제미나이 연결 주소
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
