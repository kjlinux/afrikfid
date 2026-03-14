/**
 * Test de charge k6 — Batch fidélité & rapports (CDC §5.5)
 * Cible : latence P95 < 2s pour les endpoints de reporting
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3000 --env ADMIN_TOKEN=xxx load-tests/loyalty-batch.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const reportLatency = new Trend('report_latency', true);
const funnelLatency = new Trend('funnel_latency', true);
const errorRate = new Rate('errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

export const options = {
  stages: [
    { duration: '20s', target: 20 },
    { duration: '1m',  target: 100 },
    { duration: '2m',  target: 200 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'report_latency': ['p(95)<2000', 'p(99)<5000'],
    'funnel_latency': ['p(95)<2000'],
    'errors': ['rate<0.05'],
  },
};

const adminHeaders = {
  'Authorization': `Bearer ${ADMIN_TOKEN}`,
  'Content-Type': 'application/json',
};

export default function () {
  const scenario = Math.random();

  if (scenario < 0.3) {
    // ── Rapport funnel de conversion (CDC §4.6.1) ──────────────────────────
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/v1/reports/loyalty-funnel?days=30`,
      { headers: adminHeaders, tags: { endpoint: 'funnel' } }
    );
    funnelLatency.add(Date.now() - start);

    const ok = check(res, {
      'funnel: 200': (r) => r.status === 200,
      'funnel: contient funnel array': (r) => {
        try { return Array.isArray(JSON.parse(r.body).funnel); } catch { return false; }
      },
    });
    errorRate.add(!ok);

  } else if (scenario < 0.6) {
    // ── Rapport vue d'ensemble ─────────────────────────────────────────────
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/v1/reports/overview?period=30`,
      { headers: adminHeaders, tags: { endpoint: 'overview' } }
    );
    reportLatency.add(Date.now() - start);

    check(res, {
      'overview: 200': (r) => r.status === 200,
    });

  } else if (scenario < 0.8) {
    // ── Stats fidélité ─────────────────────────────────────────────────────
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/v1/loyalty/stats`,
      { headers: adminHeaders, tags: { endpoint: 'loyalty-stats' } }
    );
    reportLatency.add(Date.now() - start);

    check(res, {
      'loyalty-stats: 200': (r) => r.status === 200,
    });

  } else {
    // ── Rapport quotidien ──────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/api/v1/reports/daily?date=${today}`,
      { headers: adminHeaders, tags: { endpoint: 'daily' } }
    );
    reportLatency.add(Date.now() - start);

    check(res, {
      'daily: 200': (r) => r.status === 200,
    });
  }

  sleep(Math.random() * 1.5 + 0.5);
}

export function handleSummary(data) {
  return {
    'load-tests/results/loyalty-batch-summary.json': JSON.stringify(data, null, 2),
  };
}
