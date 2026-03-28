/**
 * Logging for daemon processes.
 * - Default: one human-readable line per event (PM2-friendly).
 * - Optional: DAEMON_LOG_JSON=1 also prints a JSON line (same payload as before).
 * Keep daemon-lib.js limited to HTTP; use this module for all log output.
 */

const MAX_BODY_SNIPPET = 2000;

/** @param {unknown} err */
export function formatAxiosError(err) {
  if (err == null) {
    return { message: 'unknown error' };
  }
  const any = /** @type {any} */ (err);
  if (any.isAxiosError || any.response) {
    const res = any.response;
    const status = res && res.status;
    const data = res && res.data;
    const message = any.message || String(err);
    let apiMessage = '';
    if (data && typeof data === 'object') {
      apiMessage = String(data.Message ?? data.message ?? '');
    }
    let responseBody = '';
    if (data !== undefined) {
      try {
        const s = typeof data === 'string' ? data : JSON.stringify(data);
        responseBody = s.length > MAX_BODY_SNIPPET ? `${s.slice(0, MAX_BODY_SNIPPET)}…` : s;
      } catch {
        responseBody = '[unserializable]';
      }
    }
    return {
      message,
      ...(status !== undefined ? { httpStatus: status } : {}),
      ...(apiMessage ? { apiMessage } : {}),
      ...(responseBody ? { responseBody } : {}),
    };
  }
  return { message: any.message || String(err) };
}

const TAG_BY_SERVICE = {
  'daemon-generate': 'GEN',
  'daemon-emit': 'EMIT',
  'daemon-consult': 'CONS',
};

function isoNow() {
  return new Date().toISOString();
}

/**
 * @param {string} service
 * @returns {string}
 */
function tagForService(service) {
  return TAG_BY_SERVICE[service] || service;
}

/**
 * @param {string} level
 * @param {string} tag
 * @param {string} event
 * @param {Record<string, unknown>} [payload]
 */
function formatHumanLine(level, tag, event, payload) {
  const parts = [];
  if (payload && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined || v === null) continue;
      if (v === '') continue;
      if (Array.isArray(v)) {
        if (v.length === 0) continue;
        const joined = v.map((x) => String(x)).join(',');
        const s = joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;
        parts.push(`${k}=${s}`);
      } else if (typeof v === 'object') {
        let s;
        try {
          s = JSON.stringify(v);
        } catch {
          s = '[object]';
        }
        parts.push(`${k}=${s.length > 160 ? `${s.slice(0, 160)}…` : s}`);
      } else {
        const s = String(v);
        parts.push(`${k}=${s.length > 200 ? `${s.slice(0, 200)}…` : s}`);
      }
    }
  }
  const tail = parts.length ? ` ${parts.join(' ')}` : '';
  return `${isoNow()} [${tag}] ${level.toUpperCase()} ${event}${tail}`;
}

/**
 * @param {string} level
 * @param {string} service
 * @param {string} event
 * @param {Record<string, unknown>} [payload]
 */
function jsonLine(level, service, event, payload) {
  const base = {
    ts: isoNow(),
    level,
    service,
    event,
    ...(payload && typeof payload === 'object' ? payload : { detail: payload }),
  };
  try {
    return JSON.stringify(base);
  } catch {
    return JSON.stringify({
      ts: isoNow(),
      level,
      service,
      event,
      detail: 'log_serialize_failed',
    });
  }
}

function shouldEmitJson() {
  return String(process.env.DAEMON_LOG_JSON || '').trim() === '1';
}

/**
 * @param {string} service  e.g. daemon-generate
 */
export function createLogger(service) {
  const tag = tagForService(service);

  /**
   * @param {'log'|'warn'|'error'} method
   * @param {string} level
   * @param {string} event
   * @param {Record<string, unknown>} [payload]
   */
  const emit = (method, level, event, payload) => {
    const p = payload && typeof payload === 'object' ? payload : {};
    const human = formatHumanLine(level, tag, event, p);
    if (method === 'log') console.log(human);
    else if (method === 'warn') console.warn(human);
    else console.error(human);
    if (shouldEmitJson()) {
      const line = jsonLine(level, service, event, p);
      if (method === 'log') console.log(line);
      else if (method === 'warn') console.warn(line);
      else console.error(line);
    }
  };

  return {
    /**
     * @param {string} event
     * @param {Record<string, unknown>} [payload]
     */
    info(event, payload) {
      emit('log', 'info', event, payload || {});
    },
    /**
     * @param {string} event
     * @param {Record<string, unknown>} [payload]
     */
    warn(event, payload) {
      emit('warn', 'warn', event, payload || {});
    },
    /**
     * @param {string} event
     * @param {Record<string, unknown>} [payload]
     */
    error(event, payload) {
      emit('error', 'error', event, payload || {});
    },
    /**
     * @param {string} event
     * @param {unknown} err
     * @param {Record<string, unknown>} [extra]
     */
    logHttpError(event, err, extra) {
      const f = formatAxiosError(err);
      const merged = { ...f, ...(extra || {}) };
      const human = formatHumanLine('error', tag, event, merged);
      console.error(human);
      if (shouldEmitJson()) {
        console.error(jsonLine('error', service, event, merged));
      }
    },
  };
}

/** Subset of Nubefact `datos` for logs (avoid huge payloads). */
export function pickWaybillEmitData(data) {
  if (!data || typeof data !== 'object') {
    return {};
  }
  const keys = [
    'serie',
    'numero',
    'serie_numero',
    'enlace',
    'aceptada_por_sunat',
    'cadena_para_codigo_qr',
    'sunat_description',
    'sunat_note',
    'codigo_hash',
  ];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(data, k)) {
      const v = /** @type {Record<string, unknown>} */ (data)[k];
      if (v !== undefined) {
        out[k] = v;
      }
    }
  }
  return out;
}
