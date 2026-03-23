/**
 * Cliente HTTP compartido por daemon.js (emit) y daemon-generate.js (generate).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log(path.join(__dirname, '..', '.env'));


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDaemonClient() {
  const key = process.env.DAEMON_API_KEY || '';
  console.log(key);
  if (!key) {
    throw new Error('DAEMON_API_KEY is required');
  }
  const baseURL = process.env.BASE_URL || 'http://localhost';
  return axios.create({
    baseURL,
    timeout: 60000,
    headers: {
      'X-DAEMON-KEY': key,
    },
  });
}

export { sleep, createDaemonClient };
