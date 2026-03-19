'use strict';

/**
 * Module IA Insights — appelle Claude Haiku avec le contexte RFM du marchand
 * pour générer des recommandations commerciales en langage naturel.
 * Réservé aux marchands PREMIUM.
 */

const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY non configurée');
    }
    client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Récupère le contexte RFM + CA du marchand depuis la DB
 */
async function getMerchantContext(merchantId) {
  const [segmentsResult, caResult, topClientsResult] = await Promise.all([
    db.query(`
      SELECT segment, COUNT(*) as count
      FROM rfm_scores
      WHERE merchant_id = $1
        AND scored_at >= NOW() - INTERVAL '30 days'
      GROUP BY segment
      ORDER BY count DESC
    `, [merchantId]),
    db.query(`
      SELECT
        COUNT(*) as total_tx,
        SUM(gross_amount) as ca_total,
        AVG(gross_amount) as panier_moyen,
        COUNT(DISTINCT client_id) as clients_actifs,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN gross_amount ELSE 0 END) as ca_30j,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN gross_amount ELSE 0 END) as ca_7j
      FROM transactions
      WHERE merchant_id = $1 AND status = 'completed'
    `, [merchantId]),
    db.query(`
      SELECT r.segment, r.rfm_score, r.r_score, r.f_score, r.m_score
      FROM rfm_scores r
      WHERE r.merchant_id = $1
        AND r.scored_at >= NOW() - INTERVAL '30 days'
      ORDER BY r.rfm_score DESC
      LIMIT 5
    `, [merchantId]),
  ]);

  const segments = {};
  for (const row of segmentsResult.rows) {
    segments[row.segment] = parseInt(row.count, 10);
  }

  const ca = caResult.rows[0] || {};
  const topClients = topClientsResult.rows;

  return { segments, ca, topClients };
}

/**
 * Construit le prompt pour Claude
 */
function buildPrompt(merchantId, context) {
  const { segments, ca } = context;

  const totalClients = Object.values(segments).reduce((a, b) => a + b, 0);
  const segmentLines = Object.entries(segments)
    .map(([seg, count]) => `  - ${seg}: ${count} clients (${totalClients > 0 ? Math.round(count / totalClients * 100) : 0}%)`)
    .join('\n');

  const caTotal = parseFloat(ca.ca_total || 0);
  const ca30j = parseFloat(ca.ca_30j || 0);
  const ca7j = parseFloat(ca.ca_7j || 0);
  const panierMoyen = parseFloat(ca.panier_moyen || 0);
  const clientsActifs = parseInt(ca.clients_actifs || 0, 10);

  return `Tu es un conseiller commercial expert en fidélisation client pour des marchands africains.

Voici les données RFM et CA du marchand (ID: ${merchantId}) sur Afrik'Fid :

**Segmentation RFM** (${totalClients} clients segmentés) :
${segmentLines || '  Aucun client segmenté pour le moment'}

**Chiffre d'affaires** :
  - CA total : ${caTotal.toLocaleString('fr-FR')} FCFA
  - CA 30 derniers jours : ${ca30j.toLocaleString('fr-FR')} FCFA
  - CA 7 derniers jours : ${ca7j.toLocaleString('fr-FR')} FCFA
  - Panier moyen : ${Math.round(panierMoyen).toLocaleString('fr-FR')} FCFA
  - Clients actifs : ${clientsActifs}

**Ta mission** : Génère 3 à 5 recommandations concrètes et actionnables pour ce marchand. Chaque recommandation doit :
1. Être basée sur les données RFM ci-dessus
2. Proposer une action précise (ex: campagne SMS, offre spéciale, relance)
3. Mentionner le segment ciblé et l'objectif attendu
4. Être adaptée au marché africain (Mobile Money, disponibilité, prix)

Réponds en français, de façon concise et professionnelle. Format JSON strict :
{
  "resume": "1-2 phrases sur l'état général du portefeuille client",
  "recommandations": [
    {
      "titre": "Titre court",
      "segment": "Segment cible",
      "action": "Action concrète à mener",
      "objectif": "Résultat attendu",
      "priorite": "haute|moyenne|faible"
    }
  ],
  "alerte": "Message d'alerte si un segment critique dépasse 30% du portefeuille (null sinon)"
}`;
}

/**
 * Génère les insights IA pour un marchand
 * @param {string} merchantId
 * @returns {Promise<Object>} insights JSON parsé
 */
async function generateInsights(merchantId) {
  const context = await getMerchantContext(merchantId);
  const prompt = buildPrompt(merchantId, context);

  const ai = getClient();
  const response = await ai.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content.find(b => b.type === 'text')?.text || '{}';

  // Extraire le JSON de la réponse (Claude peut ajouter du texte autour)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Réponse IA invalide: pas de JSON trouvé');
  }

  const insights = JSON.parse(jsonMatch[0]);

  // Sauvegarder le coût d'utilisation (optionnel, pour tracking)
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;

  return {
    ...insights,
    generated_at: new Date().toISOString(),
    context_snapshot: {
      total_clients_segmented: Object.values(context.segments).reduce((a, b) => a + b, 0),
      segments: context.segments,
      ca_30j: parseFloat(context.ca.ca_30j || 0),
    },
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

module.exports = { generateInsights };
