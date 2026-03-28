/**
 * Consulta en lote guías ENVIADO en Nubefact (actualiza estados vía backend).
 * Ejecutar en paralelo con daemon-generate.js / daemon.js si corresponde.
 *
 * POST /api/waybill-consult-enviado-batch
 */
import { sleep, createDaemonClient } from './daemon-lib.js';
import { createLogger } from './daemon-logger.js';

const log = createLogger('daemon-consult');

const POLL_INTERVAL_MS = Number(process.env.CONSULT_POLL_INTERVAL_MS || 10000);
const BATCH_SIZE = Math.min(Number(process.env.CONSULT_BATCH_SIZE || 15), 50);

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

async function consultBatch(http) {
  const t0 = Date.now();
  const res = await http.post('/api/waybill-consult-enviado-batch', { batch_size: BATCH_SIZE });
  const data = res.data.data || {};
  return {
    durationMs: Date.now() - t0,
    processed: data.processed || 0,
    ok: data.ok || 0,
    fail: data.fail || 0,
    results: Array.isArray(data.results) ? data.results : [],
  };
}

async function main() {
  const http = createDaemonClient();
  log.info('startup', {
    baseURL: http.defaults.baseURL,
    apiKeySuffix: maskApiKey(process.env.DAEMON_API_KEY),
    pollMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  while (true) {
    try {
      const r = await consultBatch(http);
      if (r.processed > 0) {
        log.info('cycle_summary', {
          durationMs: r.durationMs,
          processed: r.processed,
          ok: r.ok,
          fail: r.fail,
        });
        for (const row of r.results) {
          const payload = {
            waybill_id: row.waybill_id,
            document_status: row.document_status,
            series: row.series,
            number: row.number,
            manifest_id: row.manifest_id,
            service_order_id: row.service_order_id,
            message: row.Message || '',
            ok: row.ok,
          };
          if (row.ok) {
            log.info('consult_ok', payload);
          } else {
            log.warn('consult_fail', payload);
          }
        }
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
