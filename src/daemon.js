/**
 * Proceso 2 — Solo reclamar y enviar a Nubefact (claim + emit).
 * Ejecutar en paralelo con: node daemon-generate.js
 *
 * POST /api/waybill-claim-for-send
 * POST /api/waybill-emit/:id
 */
import { sleep, createDaemonClient } from './daemon-lib.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const BATCH_SIZE = Math.min(Number(process.env.BATCH_SIZE || 10), 50);
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.MAX_CONCURRENCY || 1), 5));

async function claimBatch(http) {
  const res = await http.post('/api/waybill-claim-for-send', { batch_size: BATCH_SIZE });

  if (!res.data || res.data.code !== 'Success') {
    throw new Error(`Claim failed: ${res.data ? res.data.Message : 'no response data'}`);
  }
  return (res.data.data && res.data.data.waybill_ids) 
        ? res.data.data.waybill_ids 
        : [];
}

async function emitOne(http, id) {
  const res = await http.post(`/api/waybill-emit/${id}`, {});
  const code = res.data && res.data.code;
  const msg = res.data && res.data.Message;
  if (code === 'Success') {
    console.log(`[EMIT OK] waybill_id=${id} ${msg || ''}`);
    return { ok: true };
  }
  console.error(`[EMIT ERR] waybill_id=${id} ${msg || ''}`);
  return { ok: false };
}

async function runOnce(http) {
  const ids = await claimBatch(http);
  if (!ids.length) {
    return { claimed: 0, ok: 0, fail: 0 };
  }

  let ok = 0;
  let fail = 0;
  const queue = [...ids];
  const workers = Array.from({ length: MAX_CONCURRENCY }).map(async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      const r = await emitOne(http, id);
      if (r.ok) ok++;
      else fail++;
    }
  });

  await Promise.all(workers);
  return { claimed: ids.length, ok, fail };
}

async function main() {
  const http = createDaemonClient();
  console.log(
    `[daemon-emit] started pollMs=${POLL_INTERVAL_MS} claimBatch=${BATCH_SIZE} concurrency=${MAX_CONCURRENCY}`,
  );

  while (true) {
    try {
      const r = await runOnce(http);
      if (r.claimed > 0) {
        console.log(`[EMIT] cycle claimed=${r.claimed} ok=${r.ok} fail=${r.fail}`);
      }
    } catch (e) {
      const errorData = e.response ? e.response.data : e;
      
      console.error(`[daemon-emit] cycle error: ${e.message || e}, Message: ${errorData.Message || ''}`);

    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
