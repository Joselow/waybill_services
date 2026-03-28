/**
 * Proceso 1 — Solo generación diferida de GRT (manifiestos abiertos).
 * Ejecutar en paralelo con: node daemon.js
 *
 * POST /api/waybill-generate-missing
 */
import { sleep, createDaemonClient } from './daemon-lib.js';
import { createLogger } from './daemon-logger.js';

const log = createLogger('daemon-generate');

const GENERATE_POLL_INTERVAL_MS = Number(process.env.GENERATE_POLL_INTERVAL_MS || process.env.POLL_INTERVAL_MS || 10000);
const GENERATE_BATCH_SIZE = Math.min(Math.max(Number(process.env.GENERATE_BATCH_SIZE || process.env.DAEMON_GENERATE_BATCH_SIZE || 25), 1), 100);
const GENERATE_MIN_AGE_HOURS = Number(process.env.GENERATE_MIN_AGE_HOURS || process.env.DAEMON_GENERATE_MIN_AGE_HOURS || 2);
const GENERATE_MANIFEST_ID = process.env.GENERATE_MANIFEST_ID || '';

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

async function generateOnce(http) {
  const t0 = Date.now();
  const body = {
    batch_size: GENERATE_BATCH_SIZE,
    min_age_hours: GENERATE_MIN_AGE_HOURS,
  };
  if (GENERATE_MANIFEST_ID !== '' && !Number.isNaN(Number(GENERATE_MANIFEST_ID))) {
    body.manifest_id = Number(GENERATE_MANIFEST_ID);
  }

  const res = await http.post('/api/waybill-generate-missing', body);
  
  const d = res.data.data || {};
  const created = Number(d.created || 0);
  const skipped = Number(d.skipped || 0);
  const failed = Number(d.failed || 0);
  const waybillIds = Array.isArray(d.waybill_ids) ? d.waybill_ids : [];
  const createdDetails = Array.isArray(d.created_details) ? d.created_details : [];



  if (created > 0) {
    if (createdDetails.length) {
      for (const row of createdDetails) {
        log.info('success', {
          waybill: `(#: ${row.waybill_series}-${row.waybill_number}, id: ${row.waybill_id})`,
          serviceOrder: `(#: ${row.service_order_series}-${row.service_order_number}, id: ${row.service_order_id})`,
          manifest: `(#: ${row.manifest_number}, id: ${row.manifest_id})`,
        });
      }
    } else if (waybillIds.length) {
      for (const id of waybillIds) {
        log.info('success', { waybill_id: id });
      }
    }
  }

  if (failed > 0 && Array.isArray(d.errors) && d.errors.length) {
    for (const e of d.errors) {
      log.error('', {
        manifest: `(#: ${e.manifest_number}, id: ${e.manifest_id})`,
        serviceOrder: `(#: ${e.service_order_series}-${e.service_order_number}, id: ${e.service_order_id})`,
        message: e.message || '',
        reason: e.reason,
      });
    }
  }

  if (created > 0 || failed > 0) {
    log.info('cycle_summary', {
      durationMs: Date.now() - t0,
      created,
      skipped,
      failed,
      waybillIdsCount: waybillIds.length,
      apiCode: res.data && res.data.code,
    });
  }
}

async function main() {
  const http = createDaemonClient();
  log.info('startup', {
    baseURL: http.defaults.baseURL,
    apiKeySuffix: maskApiKey(process.env.DAEMON_API_KEY),
    pollMs: GENERATE_POLL_INTERVAL_MS,
    batch: GENERATE_BATCH_SIZE,
    minAgeHours: GENERATE_MIN_AGE_HOURS,
    manifestFilter: GENERATE_MANIFEST_ID !== '' && !Number.isNaN(Number(GENERATE_MANIFEST_ID))
      ? Number(GENERATE_MANIFEST_ID)
      : null,
  });

  while (true) {
    try {
      await generateOnce(http);
    } catch (e) {
      log.logHttpError('cycle_error', e, {});
    }
    await sleep(GENERATE_POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  log.logHttpError('fatal', e, {});
  process.exit(1);
});
