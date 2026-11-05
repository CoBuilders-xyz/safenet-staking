/** Retry transient transport, JSON and GraphQL failures without exposing provider responses. */
export function historyQuery(endpoint, { fetch: fetcher = fetch, wait = pause, attempts = 16 } = {}) {
  return async (query) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetcher(endpoint, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query }), signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json();
        if (response.ok && !body.errors?.length && body.data) return body.data;
      } catch { /* Transport and non-JSON failures consume one bounded attempt. */ }
      if (attempt + 1 < attempts) await wait(4_000);
    }
    throw new Error('comparison subgraph request unavailable after bounded retries');
  };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for coverage of the captured CLI head before asking for that immutable comparison snapshot. */
export async function waitForIndexedBlock(query, block, { wait = pause, attempts = 16 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const meta = (await query('{ _meta { block { number } hasIndexingErrors } }'))._meta;
    if (meta?.hasIndexingErrors !== false || !Number.isSafeInteger(meta.block?.number)) {
      throw new Error('comparison subgraph metadata is invalid');
    }
    if (BigInt(meta.block.number) >= BigInt(block)) return;
    if (attempt + 1 < attempts) await wait(4_000);
  }
  throw new Error('comparison subgraph has not indexed the captured CLI block; no comparison claimed');
}

/** Read every entity by strict ID cursor, pinning all comparison pages to the same captured block. */
export async function historyPages(query, entity, fields, block, filter = '') {
  const rows = [];
  let cursor = '';
  for (;;) {
    const data = await query(`{ ${entity}(first: 1000, orderBy: id, orderDirection: asc, block: {number: ${block}}, where: {id_gt: "${cursor}" ${filter}}) {id ${fields}} }`);
    const page = data[entity];
    if (!Array.isArray(page) || page.length > 1000) throw new Error('invalid comparison page');
    for (const row of page) {
      if (typeof row.id !== 'string' || !/^[0-9a-fx-]+$/.test(row.id) || row.id <= cursor) {
        throw new Error('comparison page has duplicate or unordered IDs');
      }
      cursor = row.id;
      rows.push(row);
    }
    if (page.length < 1000) return rows;
  }
}
