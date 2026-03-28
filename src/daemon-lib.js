/**
 * Cliente HTTP compartido por daemon.js (emit) y daemon-generate.js (generate).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDaemonClient() {
  const key = process.env.DAEMON_API_KEY || '';
  if (!key) {
    throw new Error('DAEMON_API_KEY is required');
  }
  const baseURL = process.env.BASE_URL || 'http://localhost';
  const timeout =
    Number(process.env.DAEMON_HTTP_TIMEOUT_MS || process.env.HTTP_TIMEOUT_MS || 60000) || 60000;
  return axios.create({
    baseURL,
    timeout,
    headers: {
      'X-DAEMON-KEY': key,
    },
  });
}

export { sleep, createDaemonClient }