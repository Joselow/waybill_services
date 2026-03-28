/**
 * Proceso 2 — Solo reclamar y enviar a Nubefact (claim + emit).
 * Ejecutar en paralelo con: node daemon-generate.js
 *
 * POST /api/waybill-claim-for-send
 * POST /api/waybill-emit/:id
 */
import { sleep, createDaemonClient } from './daemon-lib.js';
import { createLogger, formatValueToString, pickWaybillEmitData } from './daemon-logger.js';

const log = createLogger('daemon-emit');

const POLL_INTERVAL_MS = Number(process.env.EMIT_POLL_INTERVAL_MS || 60000);
const POLL_INTERVAL_SEND_SUNAT = Number(process.env.EMIT_POLL_INTERVAL_SEND_SUNAT || 2000);
const BATCH_SIZE = Math.min(Number(process.env.EMIT_BATCH_SIZE || 10), 50);
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.EMIT_MAX_CONCURRENCY || 1), 5));

function maskApiKey(key) {
  if (!key) {
    return '';
  }
  const s = String(key);
  if (s.length <= 4) {
    return '****';
  }
  return `…${s.slice(-4)}`;
}

/**
 * @param {unknown} waybillId
 * @returns {number|string}
 */
function waybillMapKey(waybillId) {
  const n = Number(waybillId);
  return Number.isFinite(n) ? n : String(waybillId);
}

/**
 * Labels aligned with daemon-generate (human-readable refs).
 * @param {Record<string, unknown>} row Claim item from API
 * @returns {{ waybill: string, serviceOrder: string, manifest: string }}
 */
function claimRowToContext(row) {
  return {
    waybill: `(#: ${row.waybill_series}-${row.waybill_number}, id: ${row.waybill_id})`,
    serviceOrder: `(#: ${row.service_order_series}-${row.service_order_number}, id: ${row.service_order_id})`,
    manifest: `(#: ${row.manifest_number}, id: ${row.manifest_id})`,
  };
}

/**
 * @param {unknown[]} items
 * @returns {Map<number|string, { waybill: string, serviceOrder: string, manifest: string }>}
 */
function buildClaimContextByWaybillId(items) {
  const map = new Map();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    if (row.waybill_id === undefined || row.waybill_id === null) continue;
    map.set(waybillMapKey(row.waybill_id), claimRowToContext(row));
  }
  return map;
}

async function claimBatch(http) {
  const res = await http.post('/api/waybill-claim-for-send', { batch_size: BATCH_SIZE });

  if (!res.data || res.data.code !== 'Success') {
    throw new Error(`Claim failed: ${res.data ? res.data.Message : 'no response data'}`);
  }
  const data = res.data.data || {};
  const ids = Array.isArray(data.waybill_ids) ? data.waybill_ids : [];
  const items = Array.isArray(data.items) ? data.items : [];
  return { ids, items };
}

/**
 * @param {import('axios').AxiosInstance} http
 * @param {number|string} id
 * @param {Map<number|string, { waybill: string, serviceOrder: string, manifest: string }>} claimContextByWaybillId
 */
async function emitOne(http, id, claimContextByWaybillId) {
  const res = await http.post(`/api/waybill-emit/${id}`, {});

  const code = res.data && res.data.code;
  const msg = res.data && res.data.Message;
  const rawData = (res.data && res.data.data) || {};
  const nubefact = pickWaybillEmitData(rawData);
  const ctx = claimContextByWaybillId.get(waybillMapKey(id));
  const trace = ctx
    ? { waybill: ctx.waybill, serviceOrder: ctx.serviceOrder, manifest: ctx.manifest }
    : {};

  if (code === 'Success') {
    log.info('success', {
      ...trace,
      message: formatValueToString(msg) || '',
      nubefact,
    });
    return { ok: true };
  }
  log.error('', {
    ...trace,
    message: formatValueToString(msg) || '',
    nubefact: Object.keys(nubefact).length ? nubefact : undefined,
  });
  return { ok: false };
}

async function runOnce(http) {
  const t0 = Date.now();
  const { ids, items } = await claimBatch(http);
  if (!ids.length) {
    return { claimed: 0, ok: 0, fail: 0, durationMs: Date.now() - t0 };
  }

  const claimContextByWaybillId = buildClaimContextByWaybillId(items);

  // log.info('claim_batch', {
  //   durationMs: Date.now() - t0,
  //   count: ids.length,
  //   waybill_ids: ids,
  //   items,
  // });

  let ok = 0;
  let fail = 0;
  const queue = [...ids];
  const workers = Array.from({ length: MAX_CONCURRENCY }).map(async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) break;
      const r = await emitOne(http, id, claimContextByWaybillId);
      if (r.ok) ok++;
      else fail++;
      await sleep(POLL_INTERVAL_SEND_SUNAT);
    }
  });

  await Promise.all(workers);
  return { claimed: ids.length, ok, fail, durationMs: Date.now() - t0 };
}

async function main() {
  const http = createDaemonClient();
  log.info('startup', {
    baseURL: http.defaults.baseURL,
    apiKeySuffix: maskApiKey(process.env.DAEMON_API_KEY),
    pollIntervalMs: POLL_INTERVAL_MS,
    pollIntervalSendSunatMs: POLL_INTERVAL_SEND_SUNAT,
    claimBatch: BATCH_SIZE,
    concurrency: MAX_CONCURRENCY,
  });

  while (true) {
    try {
      const r = await runOnce(http);
      if (r.claimed > 0) {
        log.info('cycle_summary', {
          claimed: r.claimed,
          success: r.ok,
          fail: r.fail,
          durationMs: r.durationMs,
        });
      }
    } catch (e) {
      log.logHttpError('cycle_error', e, {});
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  log.logHttpError('fatal', e, {});
  process.exit(1);
});
