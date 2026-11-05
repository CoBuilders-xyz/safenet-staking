import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyQuery, historyPages, waitForIndexedBlock } from '../../docs/qa/history-queries.mjs';
const wait = async () => {};

test('comparison retries transport, non-JSON and GraphQL failures without exposing responses', async () => {
  let calls = 0;
  const query = historyQuery('https://example.invalid', { wait, attempts: 4, fetch: async () => {
    calls++;
    if (calls === 1) throw new Error('synthetic-private-marker');
    if (calls === 2) return new Response('not JSON', { status: 503 });
    if (calls === 3) return Response.json({ errors: [{ message: 'synthetic-private-marker' }] });
    return Response.json({ data: { value: 42 } });
  } });
  assert.deepEqual(await query('{}'), { value: 42 });
  assert.equal(calls, 4);
  const denied = historyQuery('https://example.invalid', { wait, attempts: 2, fetch: async () => { throw new Error('synthetic-private-marker'); } });
  await assert.rejects(denied('{}'), (error) => {
    assert.match(error.message, /bounded retries/);
    assert.doesNotMatch(error.message, /synthetic-private-marker/);
    return true;
  });
});

test('comparison waits for its captured block and fails explicitly when indexing stalls', async () => {
  let block = 98;
  await waitForIndexedBlock(async () => ({ _meta: { block: { number: block++ }, hasIndexingErrors: false } }), '100', { wait, attempts: 3 });
  assert.equal(block, 101);
  await assert.rejects(waitForIndexedBlock(async () => ({ _meta: { block: { number: 99 }, hasIndexingErrors: false } }), 100, { wait, attempts: 2 }), /has not indexed/);
});

test('comparison pages 1001 rows at one block, and refuses duplicate pages', async () => {
  const rows = Array.from({ length: 1001 }, (_, i) => ({ id: String(i).padStart(4, '0') }));
  const queries = [];
  const query = async (q) => {
    queries.push(q);
    const cursor = /id_gt: "([^"]*)"/.exec(q)[1];
    return { withdrawals: rows.filter((r) => r.id > cursor).slice(0, 1000) };
  };
  assert.deepEqual(await historyPages(query, 'withdrawals', 'amount', '123'), rows);
  assert.equal(queries.length, 2);
  assert.ok(queries.every((q) => q.includes('block: {number: 123}')));
  await assert.rejects(historyPages(async () => ({ withdrawals: rows.slice(0, 1000) }), 'withdrawals', 'amount', '123'), /duplicate or unordered/);
});
