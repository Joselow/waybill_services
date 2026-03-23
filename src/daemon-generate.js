/**
 * Proceso 1 — Solo generación diferida de GRT (manifiestos abiertos).
 * Ejecutar en paralelo con: node daemon.js
 *
 * POST /api/waybill-generate-missing
 */
import { sleep, createDaemonClient } from './daemon-lib.js';

const GENERATE_POLL_INTERVAL_MS = Number(process.env.GENERATE_POLL_INTERVAL_MS || process.env.POLL_INTERVAL_MS || 10000);
const GENERATE_BATCH_SIZE = Math.min(Math.max(Number(process.env.GENERATE_BATCH_SIZE || process.env.DAEMON_GENERATE_BATCH_SIZE || 25), 1), 100);
const GENERATE_MIN_AGE_HOURS = Number(process.env.GENERATE_MIN_AGE_HOURS || process.env.DAEMON_GENERATE_MIN_AGE_HOURS || 2);
const GENERATE_MANIFEST_ID = process.env.GENERATE_MANIFEST_ID || '';

async function generateOnce(http) {
  const body = {
    batch_size: GENERATE_BATCH_SIZE,
    min_age_hours: GENERATE_MIN_AGE_HOURS,
  };
  if (GENERATE_MANIFEST_ID !== '' && !Number.isNaN(Number(GENERATE_MANIFEST_ID))) {
    body.manifest_id = Number(GENERATE_MANIFEST_ID);
  }

  const res = await http.post('/api/waybill-generate-missing', body);

  if (!res.data || res.data.code !== 'Success') {
    throw new Error(`Generate failed: ${res.data ? res.data.Message : 'no response data'}`);
  }

  const d = res.data.data || {};
  const created = Number(d.created || 0);
  const skipped = Number(d.skipped || 0);
  const failed = Number(d.failed || 0);
  const waybillIds = Array.isArray(d.waybill_ids) ? d.waybill_ids : [];

  if (created > 0 || failed > 0) {
    console.log(
      `[GEN] created=${created} skipped=${skipped} failed=${failed} new_ids=${waybillIds.length}`,
    );
  }
  if (failed > 0 && Array.isArray(d.errors) && d.errors.length) {
    const sample = d.errors.slice(0, 3).map((e) => `os=${e.service_order_id} ${e.message || ''}`).join(' | ');
    console.error(`[GEN] errors (sample): ${sample}${d.errors.length > 3 ? ' …' : ''}`);
  }
}

async function main() {
  const http = createDaemonClient();
  console.log(
    `[daemon-generate] started pollMs=${GENERATE_POLL_INTERVAL_MS} batch=${GENERATE_BATCH_SIZE} minAgeH=${GENERATE_MIN_AGE_HOURS}`,
  );

  while (true) {
    try {
      await generateOnce(http);
    } catch (e) {
      console.error(`[daemon-generate] error: ${e.message || e}`);
    }
    await sleep(GENERATE_POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
