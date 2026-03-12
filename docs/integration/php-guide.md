# Guide d'intégration PHP

Compatible PHP 8.1+ avec cURL (vanilla) ou GuzzleHttp.

## Installation (avec Composer)

```bash
composer require guzzlehttp/guzzle
```

## Client HTTP minimal (cURL vanilla)

```php
<?php
// AfrikFidClient.php

class AfrikFidClient
{
    private string $baseUrl;
    private string $apiKey;
    private bool $sandbox;

    public function __construct(string $apiKey, bool $sandbox = false, string $baseUrl = 'https://api.afrikfid.com/api/v1')
    {
        $this->apiKey  = $apiKey;
        $this->sandbox = $sandbox;
        $this->baseUrl = $baseUrl;
    }

    public function request(string $method, string $endpoint, array $body = []): array
    {
        $url  = $this->baseUrl . $endpoint;
        $json = empty($body) ? null : json_encode($body);

        $headers = [
            'Content-Type: application/json',
            'X-API-Key: ' . $this->apiKey,
        ];
        if ($this->sandbox) {
            $headers[] = 'X-Sandbox: true';
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_TIMEOUT        => 30,
        ]);

        $response   = curl_exec($ch);
        $httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError  = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            throw new RuntimeException('cURL error: ' . $curlError);
        }

        $data = json_decode($response, true);

        if ($httpCode >= 400) {
            throw new RuntimeException(
                sprintf('[%d] %s: %s', $httpCode, $data['error'] ?? 'ERROR', $data['message'] ?? ''),
                $httpCode
            );
        }

        return $data;
    }
}
```

## Initier un paiement Mobile Money

```php
<?php
require 'AfrikFidClient.php';

$client = new AfrikFidClient(
    apiKey:  getenv('AFRIKFID_API_KEY'),
    sandbox: true
);

$result = $client->request('POST', '/payments/initiate', [
    'amount'           => 10000,
    'currency'         => 'XOF',
    'payment_method'   => 'MOBILE_MONEY',
    'payment_phone'    => '+2250700123456',
    'payment_operator' => 'ORANGE',
    'client_phone'     => '+2250700123456',
    'idempotency_key'  => 'order_' . $_SESSION['order_id'],
]);

$transactionId = $result['transaction']['id'];
$reference     = $result['transaction']['reference'];

echo "Transaction créée: {$reference}\n";
echo "Client reçoit rebate: {$result['distribution']['clientRebateAmount']} XOF\n";
```

## Initier un paiement Carte (redirect CinetPay)

```php
<?php
$result = $client->request('POST', '/payments/initiate', [
    'amount'         => 25000,
    'currency'       => 'XOF',
    'payment_method' => 'card',
    'payment_phone'  => '+2250700123456',
    'description'    => 'Commande #' . $orderId,
]);

if (!empty($result['paymentUrl'])) {
    // Rediriger le client vers la page 3DS
    header('Location: ' . $result['paymentUrl']);
    exit;
}
```

## Vérifier le statut

```php
<?php
function verifierStatutPaiement(AfrikFidClient $client, string $transactionId): string
{
    $result = $client->request('GET', "/payments/{$transactionId}/status");
    return $result['transaction']['status'];
}

$statut = verifierStatutPaiement($client, $transactionId);

match ($statut) {
    'completed' => traiterCommandeConfirmee($reference),
    'failed'    => annulerCommande($reference),
    'pending'   => null, // attendre le webhook
    default     => null,
};
```

## Contrôleur Laravel

```php
<?php
// app/Http/Controllers/PaymentController.php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use AfrikFidClient;

class PaymentController extends Controller
{
    private AfrikFidClient $afrikfid;

    public function __construct()
    {
        $this->afrikfid = new AfrikFidClient(
            apiKey:  config('services.afrikfid.api_key'),
            sandbox: config('services.afrikfid.sandbox', true)
        );
    }

    public function initiate(Request $request)
    {
        $validated = $request->validate([
            'amount'           => 'required|numeric|min:100',
            'payment_operator' => 'required|in:ORANGE,MTN,WAVE,AIRTEL,MOOV',
            'phone'            => 'required|string',
        ]);

        try {
            $result = $this->afrikfid->request('POST', '/payments/initiate', [
                'amount'           => $validated['amount'],
                'currency'         => 'XOF',
                'payment_method'   => 'MOBILE_MONEY',
                'payment_phone'    => $validated['phone'],
                'payment_operator' => $validated['payment_operator'],
                'idempotency_key'  => 'order_' . $request->user()->id . '_' . time(),
            ]);

            return response()->json([
                'success'       => true,
                'transactionId' => $result['transaction']['id'],
                'reference'     => $result['transaction']['reference'],
            ]);

        } catch (\RuntimeException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], $e->getCode() ?: 500);
        }
    }

    public function webhook(Request $request)
    {
        $signature = $request->header('X-AfrikFid-Signature');
        $payload   = $request->getContent();

        if (!$this->verifierSignature($payload, $signature)) {
            return response()->json(['error' => 'Signature invalide'], 401);
        }

        $event = json_decode($payload, true);

        match ($event['eventType'] ?? '') {
            'payment.completed' => $this->handleCompleted($event['data']),
            'payment.failed'    => $this->handleFailed($event['data']),
            'payment.refunded'  => $this->handleRefunded($event['data']),
            default             => null,
        };

        return response()->json(['received' => true]);
    }

    private function verifierSignature(string $payload, ?string $signatureHeader): bool
    {
        if (!$signatureHeader) return false;
        $secret   = config('services.afrikfid.webhook_secret');
        $expected = 'sha256=' . hash_hmac('sha256', $payload, $secret);
        return hash_equals($expected, $signatureHeader);
    }

    private function handleCompleted(array $data): void
    {
        // Mettre à jour la commande en base
        \App\Models\Order::where('afrikfid_ref', $data['reference'])
            ->update(['status' => 'paid', 'paid_at' => now()]);
    }

    private function handleFailed(array $data): void
    {
        \App\Models\Order::where('afrikfid_ref', $data['reference'])
            ->update(['status' => 'payment_failed']);
    }

    private function handleRefunded(array $data): void
    {
        \App\Models\Order::where('afrikfid_ref', $data['reference'])
            ->update(['status' => 'refunded']);
    }
}
```

### config/services.php (Laravel)

```php
'afrikfid' => [
    'api_key'        => env('AFRIKFID_API_KEY'),
    'sandbox'        => env('AFRIKFID_SANDBOX', true),
    'webhook_secret' => env('AFRIKFID_WEBHOOK_SECRET'),
    'base_url'       => env('AFRIKFID_BASE_URL', 'https://api.afrikfid.com/api/v1'),
],
```

## Variables d'environnement (.env)

```env
AFRIKFID_API_KEY=af_pub_votre_cle
AFRIKFID_SANDBOX=false
AFRIKFID_WEBHOOK_SECRET=votre_secret
AFRIKFID_BASE_URL=https://api.afrikfid.com/api/v1
```
