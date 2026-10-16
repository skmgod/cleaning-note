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
const rpc = (body) => call('/mcp/test-secret-123', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 1) 비밀키가 틀리면 막기
assert.equal((await call('/mcp/wrong', { method: 'POST', body: '{}' })).status, 401);

// 2) 연결 과정 (initialize → initialized 알림 → tools/list)
let r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } } });
let j = await r.json();
assert.equal(j.result.serverInfo.name, 'cleannote');
assert.ok(j.result.capabilities.tools);
assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
j = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
assert.deepEqual(j.result.tools.map(t => t.name), ['add_reservation', 'list_pending']);

// 3) 예약 넣기 (그록·클로드·제미나이가 하는 일)
j = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_reservation', arguments: { building: '래미안 아파트', unit: '101동 1203호', doorPw: '1234', date: '2026-10-20', time: '14:00', price: 150000, type: '입주청소' } } })).json();
assert.ok(!j.result.isError, j.result.content[0].text);
assert.match(j.result.content[0].text, /보관함에 넣었어요/);

// 4) 잘못된 날짜는 거절
j = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_reservation', arguments: { date: '내일', time: '14:00' } } })).json();
assert.equal(j.result.isError, true);

// 5) 보관함 목록 (휴대폰이 가져가는 주소)
let inbox = await (await call('/inbox/test-secret-123', { method: 'GET' })).json();
assert.equal(inbox.items.length, 1);
assert.equal(inbox.items[0].building, '래미안 아파트');
assert.equal(inbox.items[0].price, 150000);

// 6) 목록 보기 도구
j = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_pending', arguments: {} } })).json();
assert.match(j.result.content[0].text, /1건/);

// 7) 휴대폰이 가져간 뒤 확인(ack) → 보관함 비워짐
await call('/inbox/test-secret-123/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: inbox.items.map(x => x.id) }) });
inbox = await (await call('/inbox/test-secret-123', { method: 'GET' })).json();
assert.equal(inbox.items.length, 0);

// 8) CORS: 휴대폰 앱(다른 주소)에서 불러올 수 있어야 함
const pre = await call('/inbox/test-secret-123', { method: 'OPTIONS' });
assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');

console.log('✅ 서버 테스트 모두 통과 (8/8)');
