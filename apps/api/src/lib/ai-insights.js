'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY non configuree');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function getMerchantContext(merchantId) {
  const [segmentsResult, caResult] = await Promise.all([
    db.query(`
      SELECT segment, COUNT(*) as count
      FROM rfm_scores
      WHERE merchant_id = $1
        AND calculated_at >= NOW() - INTERVAL '30 days'
      GROUP BY segment
      ORDER BY count DESC
    `, [merchantId]),
    db.query(`
      SELECT
        COUNT(*) as total_tx,
        SUM(gross_amount) as ca_total,
        AVG(gross_amount) as panier_moyen,
        COUNT(DISTINCT client_id) as clients_actifs,
        SUM(CASE WHEN initiated_at >= NOW() - INTERVAL '30 days' THEN gross_amount ELSE 0 END) as ca_30j,
        SUM(CASE WHEN initiated_at >= NOW() - INTERVAL '7 days' THEN gross_amount ELSE 0 END) as ca_7j
      FROM transactions
      WHERE merchant_id = $1 AND status = 'completed'
    `, [merchantId]),
  ]);

  const segments = {};
  for (const row of segmentsResult.rows) {
    segments[row.segment] = parseInt(row.count, 10);
  }

  const ca = caResult.rows[0] || {};
  return { segments, ca };
}

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

  return `Voici les donnees RFM et CA du marchand (ID: ${merchantId}) sur Afrik'Fid :

Segmentation RFM (${totalClients} clients segmentes) :
${segmentLines || '  Aucun client segmente pour le moment'}

Chiffre d'affaires :
  - CA total : ${caTotal.toLocaleString('fr-FR')} FCFA
  - CA 30 derniers jours : ${ca30j.toLocaleString('fr-FR')} FCFA
  - CA 7 derniers jours : ${ca7j.toLocaleString('fr-FR')} FCFA
  - Panier moyen : ${Math.round(panierMoyen).toLocaleString('fr-FR')} FCFA
  - Clients actifs : ${clientsActifs}

Genere 3 a 5 recommandations concretes et actionnables. Chaque recommandation doit :
1. Etre basee sur les donnees RFM ci-dessus
2. Proposer une action precise (campagne SMS, offre speciale, relance)
3. Mentionner le segment cible et l'objectif attendu
4. Etre adaptee au marche africain (Mobile Money, disponibilite, prix)

Reponds en francais, de facon concise et professionnelle. Appelle l'outil submit_insights.`;
}

async function generateInsights(merchantId) {
  const context = await getMerchantContext(merchantId);
  const prompt = buildPrompt(merchantId, context);

  const ai = getClient();
  const response = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: "Tu es un conseiller commercial expert en fidelisation client pour des marchands africains. Reponds UNIQUEMENT en appelant l'outil fourni. Ne genere aucun texte en dehors de l'appel outil.",
    tools: [
      {
        name: 'submit_insights',
        description: 'Soumet les recommandations commerciales generees',
        input_schema: {
          type: 'object',
          properties: {
            resume: {
              type: 'string',
              description: "1-2 phrases sur l'etat general du portefeuille client",
            },
            recommandations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  titre: { type: 'string' },
                  segment: { type: 'string' },
                  action: { type: 'string' },
                  objectif: { type: 'string' },
                  priorite: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
                },
                required: ['titre', 'segment', 'action', 'priorite'],
              },
            },
            alerte: {
              type: ['string', 'null'],
              description: 'Alerte si un segment critique depasse 30%, null sinon',
            },
          },
          required: ['resume', 'recommandations', 'alerte'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_insights' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Reponse IA invalide: aucun appel outil recu');
  }

  const insights = toolUse.input;
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
