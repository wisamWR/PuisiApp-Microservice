import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const MOODS = ['senang', 'sedih', 'cinta', 'marah', 'takut'];
const MODES = ['senada', 'menghibur'];

export default function () {
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
  const mode = MODES[Math.floor(Math.random() * MODES.length)];
  const res = http.get(`${BASE_URL}/api/feed/mood/${mood}?mode=${mode}&page=1`);
  check(res, {
    'status 200': (r) => r.status === 200,
  });
}
