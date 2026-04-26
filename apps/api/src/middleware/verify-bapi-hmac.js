'use strict';

/**
 * Middleware vérifiant les requêtes entrantes émises par business-api vers la
 * passerelle. Symétrique au VerifyAfrikidHmac.php côté Laravel.
 *
 * Headers attendus :
 *   Authorization:         Bearer <BUSINESS_API_INBOUND_TOKEN>
 *   X-AfrikFid-Timestamp:  millisecondes epoch (fenêtre 5 min)
 *   X-AfrikFid-Signature:  hex(HMAC_SHA256(secret, "$ts.$path.$body"))
 *
 * `path` correspond au chemin après /api/v1 (ex: "/external/sync/profile-updated").
 *
 * Variables d'environnement :
 *   BUSINESS_API_INBOUND_TOKEN  — Bearer attendu (peut être différent du token sortant)
 *   BUSINESS_API_HMAC_SECRET    — secret partagé (réutilise celui des appels sortants)
 */

const crypto = require('crypto');

const CLOCK_SKEW_MS = 5 * 60 * 1000;

function verifyBapiHmac(req, res, next) {
  const expectedToken = process.env.BUSINESS_API_INBOUND_TOKEN || process.env.BUSINESS_API_TOKEN || '';
  const secret = process.env.BUSINESS_API_HMAC_SECRET || '';
  if (!expectedToken || !secret) {
    return res.status(503).json({ error: 'business_api_inbound_not_configured' });
  }

  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!bearer || !timingEqualString(bearer, expectedToken)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const timestamp = String(req.headers['x-afrikfid-timestamp'] || '');
  const signature = String(req.headers['x-afrikfid-signature'] || '');
  if (!timestamp || !signature) {
    return res.status(401).json({ error: 'missing_signature' });
  }
  if (!/^\d+$/.test(timestamp)) {
    return res.status(401).json({ error: 'bad_timestamp' });
  }
  if (Math.abs(Date.now() - parseInt(timestamp, 10)) > CLOCK_SKEW_MS) {
    return res.status(401).json({ error: 'stale_timestamp' });
  }

  // Path tel que vu par Laravel : on enlève le prefix /api/v1 si présent.
  let path = req.originalUrl.split('?')[0];
  path = path.replace(/^\/api\/v1/, '');
  if (!path.startsWith('/')) path = '/' + path;

  const body = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${path}.${body}`)
    .digest('hex');

  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'bad_signature' });
  }

  req.bapiAuthenticated = true;
  next();
}

function timingEqualString(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = { verifyBapiHmac };
