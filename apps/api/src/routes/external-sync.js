'use strict';

/**
 * Routes entrantes consommées par business-api pour propager les modifications
 * de profil vers la passerelle. Symétrique du `ExternalAuthController@syncProfileUpdate`
 * côté Laravel.
 *
 * Sécurité :
 *   - Middleware verifyBapiHmac (Bearer + signature timestamp+path+body)
 *   - Anti-boucle : si payload.source === 'gateway', on l'ignore (ne devrait pas
 *     arriver sauf bug ; côté Laravel le push n'inclut JAMAIS source: gateway).
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { v4: uuidv4 } = require('uuid');
const { verifyBapiHmac } = require('../middleware/verify-bapi-hmac');
const { logoUpload, LOGO_DIR } = require('../lib/upload');
const path = require('path');
const crypto = require('crypto');

// Suspension du push sortant pendant l'application (évite la boucle)
let _suspendOutboundPush = false;
function isPushSuspended() { return _suspendOutboundPush; }
async function withoutPush(fn) {
  const prev = _suspendOutboundPush;
  _suspendOutboundPush = true;
  try { return await fn(); }
  finally { _suspendOutboundPush = prev; }
}

router.post('/sync/profile-updated', verifyBapiHmac, async (req, res) => {
  const { type, business_api_id, changes, source } = req.body || {};
  if (!type || !business_api_id || !changes || typeof changes !== 'object') {
    return res.status(400).json({ error: 'type, business_api_id, changes requis' });
  }
  if (!['merchant', 'client'].includes(type)) {
    return res.status(400).json({ error: 'type doit être merchant ou client' });
  }
  // Anti-boucle (sécurité ceinture-bretelles)
  if (source === 'gateway') {
    return res.json({ ok: true, ignored: 'self_origin' });
  }

  const applied = [];

  await withoutPush(async () => {
    if (type === 'merchant') {
      // Mapping champs Laravel → passerelle
      //   designation → name, ville → (pas de colonne), telephone → phone, email → email
      const update = {};
      if (changes.designation != null) update.name = changes.designation;
      if (changes.telephone != null) update.phone = changes.telephone;
      if (changes.email != null) update.email = changes.email;
      if (changes.logo_url != null) update.logo_url = changes.logo_url;
      // ville/longitude/latitude : pas de colonnes dédiées sur merchants gateway, on skip

      if (Object.keys(update).length === 0) return;

      const sets = Object.keys(update).map((k, i) => `${k} = $${i + 2}`).join(', ');
      const params = [business_api_id, ...Object.values(update)];
      const r = await db.query(
        `UPDATE merchants SET ${sets}, updated_at = NOW()
         WHERE business_api_marchand_id = $1 RETURNING id`,
        params
      );
      if (r.rowCount > 0) applied.push(...Object.keys(update));
    } else {
      // client : champs consommateur Laravel → clients passerelle
      const { encrypt, hashField } = require('../lib/crypto');
      const update = {};
      const params = [business_api_id];

      // full_name : on recompose depuis prenom + nom si l'un des deux change
      if (changes.prenom != null || changes.nom != null) {
        // Récupérer l'existant pour fusionner
        const existing = (await db.query(
          'SELECT full_name FROM clients WHERE business_api_consommateur_id = $1',
          [business_api_id]
        )).rows[0];
        const cur = (existing?.full_name || '').split(' ');
        const prenom = changes.prenom != null ? changes.prenom : (cur[0] || '');
        const nom = changes.nom != null ? changes.nom : (cur.slice(1).join(' ') || '');
        update.full_name = [prenom, nom].filter(Boolean).join(' ').trim() || existing?.full_name || '';
      }
      if (changes.ville != null) update.city = changes.ville;
      if (changes.date_naissance != null) update.birth_date = changes.date_naissance;
      if (changes.sexe != null) {
        const s = String(changes.sexe).trim().toUpperCase();
        update.gender = s === 'M' || s === 'H' ? 'M' : (s === 'F' ? 'F' : 'X');
      }
      if (changes.telephone != null) {
        update.phone = encrypt(changes.telephone);
        update.phone_hash = hashField(changes.telephone);
      }
      if (changes.email != null) {
        update.email = encrypt(changes.email);
        update.email_hash = hashField(changes.email);
      }

      if (Object.keys(update).length === 0) return;

      const sets = Object.keys(update).map((k, i) => `${k} = $${i + 2}`).join(', ');
      const r = await db.query(
        `UPDATE clients SET ${sets}, updated_at = NOW()
         WHERE business_api_consommateur_id = $1 RETURNING id`,
        [business_api_id, ...Object.values(update)]
      );
      if (r.rowCount > 0) applied.push(...Object.keys(update));
    }
  });

  await db.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource_type, resource_id, payload)
     VALUES ($1, 'system', 'bapi-sync', 'profile_sync_inbound', $2, $3, $4)`,
    [uuidv4(), type, String(business_api_id), JSON.stringify({ applied, source: source || null })]
  );

  res.json({ ok: true, applied });
});

// POST /api/v1/sync/logo — Reçoit un logo depuis fidelite-api et le stocke localement.
// La signature HMAC est calculée sur body="" (multipart non signable en texte).
router.post('/sync/logo', (req, res, next) => {
  // Vérification Bearer + timestamp + signature HMAC (body vide pour multipart)
  const expectedToken = process.env.BUSINESS_API_INBOUND_TOKEN || process.env.BUSINESS_API_TOKEN || '';
  const secret = process.env.BUSINESS_API_HMAC_SECRET || '';
  if (!expectedToken || !secret) return res.status(503).json({ error: 'not_configured' });

  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const ba = Buffer.from(bearer); const bb = Buffer.from(expectedToken);
  if (!bearer || ba.length !== bb.length || !crypto.timingSafeEqual(ba, bb)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const timestamp = String(req.headers['x-afrikfid-timestamp'] || '');
  const signature = String(req.headers['x-afrikfid-signature'] || '');
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return res.status(401).json({ error: 'bad_timestamp' });
  if (Math.abs(Date.now() - parseInt(timestamp, 10)) > 5 * 60 * 1000) return res.status(401).json({ error: 'stale_timestamp' });

  let reqPath = req.originalUrl.split('?')[0].replace(/^\/api\/v1/, '');
  if (!reqPath.startsWith('/')) reqPath = '/' + reqPath;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${reqPath}.`).digest('hex');
  const sa = Buffer.from(signature, 'hex'); const sb = Buffer.from(expected, 'hex');
  if (sa.length !== sb.length || !crypto.timingSafeEqual(sa, sb)) return res.status(401).json({ error: 'bad_signature' });

  next();
}, (req, res, next) => {
  logoUpload.single('logo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
  const { business_api_marchand_id, merchant_id } = req.body || {};
  if (!business_api_marchand_id && !merchant_id) return res.status(400).json({ error: 'business_api_marchand_id ou merchant_id requis' });

  const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4001}`).replace(/\/$/, '');
  const logoUrl = `${baseUrl}/uploads/logos/${req.file.filename}`;

  // Accepte l'UUID interne (merchant_id) ou l'entier business-api
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lookupVal = merchant_id || business_api_marchand_id;
  const whereClause = isUuid.test(String(lookupVal))
    ? 'id = $2'
    : 'business_api_marchand_id = $2';

  const r = await db.query(
    `UPDATE merchants SET logo_url = $1, updated_at = NOW() WHERE ${whereClause} RETURNING id`,
    [logoUrl, lookupVal]
  );
  if (r.rowCount === 0) {
    return res.status(404).json({ error: 'Marchand introuvable' });
  }

  res.json({ ok: true, logoUrl });
});

module.exports = { router, isPushSuspended, withoutPush };
