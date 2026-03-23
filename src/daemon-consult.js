/**
 * Consulta en lote guías ENVIADO en Nubefact (actualiza estados vía backend).
 * Ejecutar en paralelo con daemon-generate.js / daemon.js si corresponde.
 *
 * POST /api/waybill-consult-enviado-batch
 */
import { sleep, createDaemonClient } from './daemon-lib.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
const BATCH_SIZE = Math.min(Number(process.env.BATCH_SIZE || 15), 50);

async function consultBatch(http) {
  const res = await http.post('/api/waybill-consult-enviado-batch', { batch_size: BATCH_SIZE });
  if (!res.data || res.data.code !== 'Success') {
    throw new Error(`Consult batch failed: ${res.data ? res.data.Message : 'no response data'}`);
  }
  const data = res.data.data || {};
  return {
    processed: data.processed || 0,
    ok: data.ok || 0,
    fail: data.fail || 0,
  };
}

async function main() {
  const http = createDaemonClient();
  console.log(
    `[daemon-consult] started pollMs=${POLL_INTERVAL_MS} batchSize=${BATCH_SIZE}`,
  );

  while (true) {
    try {
      const r = await consultBatch(http);
      if (r.processed > 0) {
        console.log(`[CONSULT] processed=${r.processed} ok=${r.ok} fail=${r.fail}`);
      }
    } catch (e) {
      console.error(`[daemon-consult] cycle error: ${e.message || e}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
