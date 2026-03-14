/**
 * Middleware de vérification HMAC-SHA256 pour les requêtes entrantes marchands
 * CDC §4.5.2 — Toutes les requêtes doivent être signées via HMAC-SHA256
 *
 * Le marchand doit envoyer le header :
 *   X-AfrikFid-Signature: sha256=<hmac_hex>
 *
 * La signature est calculée sur le corps brut (raw body) de la requête :
 *   HMAC-SHA256(api_key_secret, rawBody)
 *
 * En mode sandbox, la vérification utilise la clé sandbox_key_secret.
 */

const crypto = require('crypto');

/**
 * Middleware optionnel : vérifie la signature HMAC si le header est présent.
 * Mode "warn" en dev — bloque en production.
 * Utilisé sur les routes à haute valeur : /payments/initiate, /payments/:id/refund
 */
function verifyHmacSignature(req, res, next) {
  const signature = req.headers['x-afrikfid-signature'];

  // Si pas de signature et en mode non-strict, on passe (rétrocompat)
  if (!signature) {
    if (process.env.REQUIRE_HMAC_SIGNATURE === 'true') {
      return res.status(401).json({
        error: 'MISSING_SIGNATURE',
        message: 'Header X-AfrikFid-Signature requis. Calculez HMAC-SHA256(api_secret, raw_body).',
      });
    }
    // En mode permissif (défaut), on laisse passer sans signature
    return next();
  }

  // Le merchant doit déjà être attaché par requireApiKey
  const merchant = req.merchant;
  if (!merchant) {
    return res.status(401).json({ error: 'Marchand non identifié' });
  }

  // Choisir la bonne clé selon le mode sandbox
  const secretKey = req.isSandbox
    ? merchant.sandbox_key_secret
    : merchant.api_key_secret;

  if (!secretKey) {
    return res.status(500).json({ error: 'Clé secrète marchand non configurée' });
  }

  // Corps brut de la requête (stocké par rawBodyParser)
  const rawBody = req.rawBody || JSON.stringify(req.body);

  // Calcul de la signature attendue
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secretKey)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Comparaison à temps constant pour éviter les timing attacks
  const providedBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return res.status(401).json({
      error: 'INVALID_SIGNATURE',
      message: 'Signature HMAC-SHA256 invalide. Vérifiez votre clé secrète et le corps de la requête.',
    });
  }

  next();
}

/**
 * Middleware pour capturer le corps brut avant le parsing JSON.
 * À placer AVANT express.json() sur les routes concernées.
 */
function captureRawBody(req, res, next) {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    // Parser manuellement le JSON
    if (data && req.headers['content-type']?.includes('application/json')) {
      try {
        req.body = JSON.parse(data);
      } catch {
        return res.status(400).json({ error: 'Corps JSON invalide' });
      }
    }
    next();
  });
}

module.exports = { verifyHmacSignature, captureRawBody };
