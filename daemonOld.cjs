const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost';
const DAEMON_API_KEY = process.env.DAEMON_API_KEY || '';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const BATCH_SIZE = Math.min(Number(process.env.BATCH_SIZE || 10), 50);
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.MAX_CONCURRENCY || 1), 5));

const claimUrl = `${BASE_URL}/api/waybill-claim-for-send`;
const emitUrl = (id) => `${BASE_URL}/api/waybill-emit/${id}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function client() {
  return axios.create({
    timeout: 60000,
    headers: {
      'X-DAEMON-KEY': DAEMON_API_KEY,
    },
  });
}

async function claimBatch(http) {
  const res = await http.post(claimUrl, { batch_size: BATCH_SIZE });
  if (!res.data || res.data.code !== 'Success') {
    throw new Error(`Claim failed: ${res.data ? res.data.Message : 'no response data'}`);
  }
  return (res.data.data && res.data.data.waybill_ids) ? res.data.data.waybill_ids : [];
}

async function emitOne(http, id) {
  const res = await http.post(emitUrl(id), {});
  const code = res.data && res.data.code;
  const msg = res.data && res.data.Message;
  if (code === 'Success') {
    console.log(`[OK] waybill_id=${id} ${msg || ''}`);
    return { ok: true };
  }
  console.error(`[ERR] waybill_id=${id} ${msg || ''}`);
  return { ok: false };
}

async function runOnce(http) {
  const ids = await claimBatch(http);
  if (!ids.length) {
    return { claimed: 0, ok: 0, fail: 0 };
  }

  let ok = 0;
  let fail = 0;

  // Concurrency control
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
  if (!DAEMON_API_KEY) {
    throw new Error('DAEMON_API_KEY is required');
  }

  const http = client();
  console.log(`Daemon started. base=${BASE_URL} batch=${BATCH_SIZE} intervalMs=${POLL_INTERVAL_MS} concurrency=${MAX_CONCURRENCY}`);

  while (true) {
    try {
      const r = await runOnce(http);
      if (r.claimed > 0) {
        console.log(`Cycle done. claimed=${r.claimed} ok=${r.ok} fail=${r.fail}`);
      }
    } catch (e) {
      console.error(`Cycle error: ${e.message || e}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
