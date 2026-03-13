<?php
/**
 * Afrik'Fid Payment Gateway — Guide d'intégration PHP
 * =====================================================
 * Ce fichier illustre les principales opérations disponibles via l'API.
 *
 * Prérequis : PHP 8.1+, extension curl activée
 *
 * Variables d'environnement :
 *   AFRIKFID_API_URL=https://api.afrikfid.com/api/v1
 *   AFRIKFID_API_KEY=af_pub_<votre_clé_publique>
 *   AFRIKFID_API_SECRET=af_sec_<votre_clé_secrète>
 */

declare(strict_types=1);

class AfrikFidClient
{
    private string $baseUrl;
    private string $apiKey;
    private string $apiSecret;

    public function __construct(string $apiKey, string $apiSecret, string $baseUrl = 'https://api.afrikfid.com/api/v1')
    {
        $this->apiKey    = $apiKey;
        $this->apiSecret = $apiSecret;
        $this->baseUrl   = rtrim($baseUrl, '/');
    }

    // ─── Requête HTTP générique ──────────────────────────────────────────────

    private function request(string $method, string $path, array $body = []): array
    {
        $url = $this->baseUrl . $path;
        $ch  = curl_init($url);

        $headers = [
            'Content-Type: application/json',
            'X-API-Key: ' . $this->apiKey,
        ];

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
        ]);

        if (!empty($body)) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $response = curl_exec($ch);
        $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false) {
            throw new \RuntimeException('Erreur cURL: ' . curl_error($ch));
        }

        $data = json_decode($response, true);

        if ($status >= 400) {
            throw new \RuntimeException(
                'API Error ' . $status . ': ' . ($data['error'] ?? $data['message'] ?? $response)
            );
        }

        return $data;
    }

    // ─── 1. Initier un paiement Mobile Money ────────────────────────────────

    public function initiatePayment(array $params): array
    {
        return $this->request('POST', '/payments/initiate', $params);
    }

    // ─── 2. Statut d'une transaction ────────────────────────────────────────

    public function getPaymentStatus(string $transactionId): array
    {
        return $this->request('GET', "/payments/{$transactionId}/status");
    }

    // ─── 3. Remboursement ───────────────────────────────────────────────────

    public function refund(string $transactionId, string $type = 'full', ?float $amount = null, ?string $reason = null): array
    {
        $body = ['refund_type' => $type];
        if ($amount !== null) $body['amount'] = $amount;
        if ($reason !== null) $body['reason'] = $reason;
        return $this->request('POST', "/payments/{$transactionId}/refund", $body);
    }

    // ─── 4. Créer un lien de paiement ───────────────────────────────────────

    public function createPaymentLink(float $amount, string $currency = 'XOF', string $description = '', int $expiresInHours = 24): array
    {
        return $this->request('POST', '/payment-links', [
            'amount'           => $amount,
            'currency'         => $currency,
            'description'      => $description,
            'expires_in_hours' => $expiresInHours,
            'max_uses'         => 1,
        ]);
    }

    // ─── 5. Identifier un client avant paiement ─────────────────────────────

    public function lookupClient(?string $phone = null, ?string $afrikfidId = null): ?array
    {
        try {
            $body = [];
            if ($phone)     $body['phone']       = $phone;
            if ($afrikfidId) $body['afrikfid_id'] = $afrikfidId;
            return $this->request('POST', '/clients/lookup', $body);
        } catch (\RuntimeException $e) {
            if (str_contains($e->getMessage(), '404')) return null;
            throw $e;
        }
    }

    // ─── 6. Vérifier la signature d'un webhook ──────────────────────────────

    public function verifyWebhookSignature(string $rawBody, string $signature): bool
    {
        $expected = hash_hmac('sha256', $rawBody, $this->apiSecret);
        return hash_equals($expected, $signature);
    }

    // ─── 7. Health check ────────────────────────────────────────────────────

    public function healthCheck(): array
    {
        $ch = curl_init($this->baseUrl . '/health');
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
        $resp = curl_exec($ch);
        curl_close($ch);
        return json_decode($resp, true);
    }
}


// ─── Exemple d'utilisation ────────────────────────────────────────────────────

$apiKey    = getenv('AFRIKFID_API_KEY')    ?: 'af_sandbox_pub_votre_cle';
$apiSecret = getenv('AFRIKFID_API_SECRET') ?: 'af_sandbox_sec_votre_secret';

$afrikfid = new AfrikFidClient($apiKey, $apiSecret);

// Health check
$health = $afrikfid->healthCheck();
echo "API: {$health['status']} | DB: {$health['db']['latencyMs']}ms\n";

// Identifier un client
$clientData = $afrikfid->lookupClient(phone: '+22507000001');
if ($clientData) {
    $client = $clientData['client'];
    echo "Client: {$client['fullName']} | Statut: {$client['loyaltyStatus']} | Remise: {$client['clientRebatePercent']}%\n";
}

// Initier un paiement Orange Money
$result = $afrikfid->initiatePayment([
    'amount'             => 50000,
    'currency'           => 'XOF',
    'client_afrikfid_id' => 'AFD-LK9A2F-B3X7',
    'payment_method'     => 'mobile_money',
    'payment_operator'   => 'ORANGE',
    'client_phone'       => '+22507000001',
    'description'        => 'Achat SuperMarché — PHP',
    'idempotency_key'    => uniqid('cmd-'),
]);

$tx   = $result['transaction'];
$dist = $result['distribution'];
echo "Transaction: {$tx['reference']} | Statut: {$tx['status']}\n";
echo "Remise X%: {$dist['merchantRebatePercent']}% | Y%: {$dist['clientRebatePercent']}% | Z%: {$dist['platformCommissionPercent']}%\n";

// Créer un lien de paiement
$linkResult = $afrikfid->createPaymentLink(75000, 'XOF', 'Abonnement Premium', 48);
$code       = $linkResult['paymentLink']['code'];
echo "Lien de paiement: https://pay.afrikfid.com/pay/{$code}\n";


// ─── Réception de webhooks (exemple avec routeur basique) ────────────────────

if (php_sapi_name() === 'cli') {
    // Ce bloc ne s'exécute qu'en CLI — en production, utilisez votre framework
    exit(0);
}

// Route webhook (à placer dans votre contrôleur/routeur)
$rawBody  = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_AFRIKFID_SIGNATURE'] ?? '';
$event     = $_SERVER['HTTP_X_AFRIKFID_EVENT'] ?? '';

if (!$afrikfid->verifyWebhookSignature($rawBody, $signature)) {
    http_response_code(403);
    exit('Signature invalide');
}

$data = json_decode($rawBody, true);

switch ($event) {
    case 'payment.success':
        // Mettre à jour la commande dans votre base
        error_log("Paiement réussi: {$data['reference']}");
        break;
    case 'refund.completed':
        error_log("Remboursement: {$data['transactionId']}");
        break;
    case 'loyalty.status_changed':
        error_log("Statut fidélité: {$data['afrikfid_id']} → {$data['new_status']}");
        break;
}

http_response_code(200);
echo 'OK';
