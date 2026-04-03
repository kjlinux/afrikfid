/**
 * Test de charge k6 — Flux de paiement principal 
 * Cible : 500 VU simultanés, P95 < 2s, P99 < 5s
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3000 load-tests/payment-flow.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ─── Métriques personnalisées ─────────────────────────────────────────────────
const errorRate = new Rate('errors');
const initiateLatency = new Trend('initiate_latency', true);
const statusLatency = new Trend('status_latency', true);

// ─── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY_PUBLIC = __ENV.API_KEY_PUBLIC || 'test_api_key_public';
const API_KEY_SECRET = __ENV.API_KEY_SECRET || 'test_api_key_secret';
const CLIENT_AFRIKFID_ID = __ENV.CLIENT_ID || null;

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // montée progressive
    { duration: '1m', target: 200 },  // charge intermédiaire
    { duration: '2m', target: 500 },  // charge cible — 500 tx simultanées)
    { duration: '1m', target: 500 },  // maintien
    { duration: '30s', target: 0 },    // descente
  ],
  thresholds: {
    //: P95 < 2000ms, P99 < 5000ms
    'http_req_duration{scenario:default}': ['p(95)<2000', 'p(99)<5000'],
    'initiate_latency': ['p(95)<2000', 'p(99)<5000'],
    'errors': ['rate<0.05'],  // moins de 5% d'erreurs
  },
};

function getHmacSignature(body, secret) {
  // k6 ne supporte pas crypto natif — signature simplifiée pour tests fonctionnels
  // En production, utiliser un script de pré-signature ou un service externe
  return 'test_signature';
}

export default function () {
  const amount = Math.floor(Math.random() * 90000) + 10000; // 10k–100k XOF
  const operators = ['ORANGE', 'MTN', 'WAVE'];
  const operator = operators[Math.floor(Math.random() * operators.length)];
  const categories = ['general', 'electronics', 'food', 'fashion'];
  const category = categories[Math.floor(Math.random() * categories.length)];
  const idempotencyKey = `k6-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const body = JSON.stringify({
    amount,
    currency: 'XOF',
    payment_method: 'mobile_money',
    payment_operator: operator,
    client_phone: `+2250700${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
    product_category: category,
    description: `Test k6 charge ${category}`,
    idempotency_key: idempotencyKey,
  });

  // ── Étape 1 : Initier le paiement ──────────────────────────────────────────
  const initiateStart = Date.now();
  const initiateRes = http.post(
    `${BASE_URL}/api/v1/payments/initiate`,
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY_PUBLIC,
        'x-api-secret': API_KEY_SECRET,
      },
      tags: { endpoint: 'initiate' },
    }
  );
  initiateLatency.add(Date.now() - initiateStart);

  const initiateOk = check(initiateRes, {
    'initiate: status 201 ou 200': (r) => r.status === 201 || r.status === 200,
    'initiate: body contient transaction': (r) => {
      try { return !!JSON.parse(r.body).transaction; } catch { return false; }
    },
  });
  errorRate.add(!initiateOk);

  if (!initiateOk || initiateRes.status >= 400) {
    sleep(1);
    return;
  }

  const tx = JSON.parse(initiateRes.body).transaction;
  const txId = tx?.id;
  if (!txId) { sleep(1); return; }

  sleep(0.5);

  // ── Étape 2 : Vérifier le statut ───────────────────────────────────────────
  const statusStart = Date.now();
  const statusRes = http.get(
    `${BASE_URL}/api/v1/payments/${txId}/status`,
    {
      headers: {
        'x-api-key': API_KEY_PUBLIC,
        'x-api-secret': API_KEY_SECRET,
      },
      tags: { endpoint: 'status' },
    }
  );
  statusLatency.add(Date.now() - statusStart);

  check(statusRes, {
    'status: 200': (r) => r.status === 200,
    'status: champ status présent': (r) => {
      try { return !!JSON.parse(r.body).status; } catch { return false; }
    },
  });

  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s entre itérations
}

export function handleSummary(data) {
  return {
    'load-tests/results/payment-flow-summary.json': JSON.stringify(data, null, 2),
  };
}
