/**
 * Adapters Mobile Money — Mode Sandbox
 * Simule les appels aux opérateurs: Orange Money, MTN MoMo, Airtel, M-Pesa, Wave, Moov
 */

const OPERATORS = {
  ORANGE_MONEY: {
    name: 'Orange Money',
    code: 'ORANGE',
    countries: ['CI', 'SN', 'BF', 'ML', 'NE', 'CM'],
    currencies: ['XOF', 'XAF'],
    minAmount: 100,
    maxAmount: 1000000,
  },
  MTN_MOMO: {
    name: 'MTN Mobile Money',
    code: 'MTN',
    countries: ['CI', 'CM', 'BF', 'BJ', 'CG'],
    currencies: ['XOF', 'XAF'],
    minAmount: 100,
    maxAmount: 2000000,
  },
  AIRTEL_MONEY: {
    name: 'Airtel Money',
    code: 'AIRTEL',
    countries: ['NE', 'TD', 'BF', 'KE'],
    currencies: ['XOF', 'XAF', 'KES'],
    minAmount: 50,
    maxAmount: 500000,
  },
  MPESA: {
    name: 'M-Pesa (Safaricom)',
    code: 'MPESA',
    countries: ['KE'],
    currencies: ['KES'],
    minAmount: 10,
    maxAmount: 150000,
  },
  WAVE: {
    name: 'Wave',
    code: 'WAVE',
    countries: ['SN', 'CI', 'ML', 'BF'],
    currencies: ['XOF'],
    minAmount: 100,
    maxAmount: 500000,
  },
  MOOV_MONEY: {
    name: 'Moov Money',
    code: 'MOOV',
    countries: ['CI', 'BF', 'BJ', 'TG', 'NE'],
    currencies: ['XOF'],
    minAmount: 100,
    maxAmount: 500000,
  },
};

/**
 * Simule une demande de paiement mobile money
 * En production: remplacer par les vrais appels API
 */
async function initiatePayment({ operator, phone, amount, currency, reference, description }) {
  await simulateDelay(800, 2000);

  const op = Object.values(OPERATORS).find(o => o.code === operator.toUpperCase());
  if (!op) {
    return { success: false, error: 'OPERATOR_NOT_FOUND', message: `Opérateur ${operator} non supporté` };
  }

  if (amount < op.minAmount || amount > op.maxAmount) {
    return {
      success: false,
      error: 'AMOUNT_OUT_OF_RANGE',
      message: `Montant doit être entre ${op.minAmount} et ${op.maxAmount} ${currency}`,
    };
  }

  // Simulation: 5% d'échec aléatoire en sandbox
  if (Math.random() < 0.05) {
    return { success: false, error: 'INSUFFICIENT_FUNDS', message: 'Solde insuffisant (simulé)' };
  }

  const operatorRef = `${operator.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    success: true,
    operatorRef,
    operator: op.code,
    phone,
    amount,
    currency,
    reference,
    status: 'pending',
    message: `Demande de paiement envoyée au ${op.name}. En attente de confirmation OTP.`,
    sandbox: true,
  };
}

/**
 * Confirme un paiement (simulation de callback opérateur)
 */
async function confirmPayment({ operatorRef, operator }) {
  await simulateDelay(500, 1500);

  // En sandbox, on confirme toujours avec succès
  return {
    success: true,
    operatorRef,
    status: 'completed',
    confirmedAt: new Date().toISOString(),
    sandbox: true,
  };
}

/**
 * Vérifie le statut d'une transaction
 */
async function checkPaymentStatus({ operatorRef, operator }) {
  await simulateDelay(200, 500);
  return {
    operatorRef,
    status: 'completed',
    sandbox: true,
  };
}

/**
 * Disbursement: envoyer de l'argent à un bénéficiaire
 */
async function disburseFunds({ operator, phone, amount, currency, reference }) {
  await simulateDelay(1000, 3000);

  const operatorRef = `DISB-${operator.toUpperCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    success: true,
    operatorRef,
    operator,
    phone,
    amount,
    currency,
    reference,
    status: 'completed',
    message: `Transfert de ${amount} ${currency} effectué vers ${phone}`,
    sandbox: true,
  };
}

/**
 * Liste des opérateurs disponibles pour un pays
 */
function getOperatorsForCountry(countryCode) {
  return Object.values(OPERATORS).filter(op => op.countries.includes(countryCode));
}

function simulateDelay(min, max) {
  const delay = min + Math.random() * (max - min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

module.exports = {
  OPERATORS,
  initiatePayment,
  confirmPayment,
  checkPaymentStatus,
  disburseFunds,
  getOperatorsForCountry,
};
