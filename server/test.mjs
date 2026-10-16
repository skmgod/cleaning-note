// 로컬 테스트: 실제 저장소 없이 메모리 보관함으로 서버 동작을 확인합니다. 실행: npm test
import worker from './worker.js';
import assert from 'node:assert/strict';

const store = new Map();
const KV = {
  async put(k, v) { store.set(k, v); },
  async get(k, type) { const v = store.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
  async delete(k) { store.delete(k); },
  async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
};
const env = { SECRET: 'test-secret-123', KV };
const base = 'https://x.test';
const call = (path, init) => worker.fetch(new Request(base + path, init), env);
const rpc = body => call('/mcp/test-secret-123', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const tool = async (id, name, args) => (await (await rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })).json());

// 1) 비밀키가 틀리면 막기
assert.equal((await call('/mcp/wrong', { method: 'POST', body: '{}' })).status, 401);

// 2) 연결 과정 (initialize → initialized 알림 → tools/list)
let j = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } })).json();
assert.equal(j.result.serverInfo.name, 'cleannote');
assert.ok(j.result.capabilities.tools);
assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
j = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
assert.deepEqual(j.result.tools.map(t => t.name), ['add_reservation', 'add_complaint', 'add_repair_charge', 'add_housing_memo', 'list_pending']);

// 3) 예약 넣기
j = await tool(3, 'add_reservation', { building: '래미안 아파트', unit: '101동 1203호', doorPw: '1234', date: '2026-10-20', time: '14:00', price: 150000, type: '입주청소' });
assert.ok(!j.result.isError, j.result.content[0].text);
assert.match(j.result.content[0].text, /예약을 보관함에 넣었어요/);

// 4) 잘못된 날짜는 거절
j = await tool(4, 'add_reservation', { date: '내일', time: '14:00' });
assert.equal(j.result.isError, true);

// 5) 민원 접수
j = await tool(5, 'add_complaint', { building: '래미안 아파트', unit: '101동 1203호', phone: '010-1234-5678', content: '화장실 변기 물이 안 내려감' });
assert.ok(!j.result.isError, j.result.content[0].text);
assert.match(j.result.content[0].text, /민원을 보관함에 넣었어요/);

// 6) 내용 없는 민원은 거절
j = await tool(6, 'add_complaint', { building: '래미안 아파트' });
assert.equal(j.result.isError, true);

// 7) 수리비 청구 (금액은 "80,000원" 같은 글자도 허용, 날짜 생략하면 오늘)
j = await tool(7, 'add_repair_charge', { building: '래미안 아파트', unit: '101동 1203호', item: '싱크대 누수 수리', amount: '80,000원' });
assert.ok(!j.result.isError, j.result.content[0].text);

// 8) 주택관리 메모
j = await tool(8, 'add_housing_memo', { building: '래미안 아파트', text: '다음 달 소방 점검 예정' });
assert.ok(!j.result.isError, j.result.content[0].text);

// 9) 보관함에 네 종류가 모두 들어가고, 종류(kind)·금액·날짜가 맞는지 확인
let inbox = await (await call('/inbox/test-secret-123', { method: 'GET' })).json();
assert.deepEqual(inbox.items.map(x => x.kind).sort(), ['charge', 'complaint', 'note', 'reservation']);
const charge = inbox.items.find(x => x.kind === 'charge');
assert.equal(charge.amount, 80000);
assert.match(charge.date, /^\d{4}-\d{2}-\d{2}$/);
const reservation = inbox.items.find(x => x.kind === 'reservation');
assert.equal(reservation.price, 150000);

// 10) 목록 보기 도구
j = await tool(10, 'list_pending', {});
assert.match(j.result.content[0].text, /4건/);

// 11) 휴대폰이 가져간 뒤 확인(ack) → 보관함 비워짐
await call('/inbox/test-secret-123/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: inbox.items.map(x => x.id) }) });
inbox = await (await call('/inbox/test-secret-123', { method: 'GET' })).json();
assert.equal(inbox.items.length, 0);

// 12) CORS: 휴대폰 앱(다른 주소)에서 불러올 수 있어야 함
const pre = await call('/inbox/test-secret-123', { method: 'OPTIONS' });
assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');

console.log('✅ 서버 테스트 모두 통과 (12/12)');
