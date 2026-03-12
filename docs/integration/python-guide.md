# Guide d'intégration Python

Compatible Python 3.9+.

## Installation

```bash
pip install requests
```

## Client HTTP minimal

```python
# afrikfid.py
import os
import hmac
import hashlib
import requests

BASE_URL = os.getenv("AFRIKFID_BASE_URL", "https://api.afrikfid.com/api/v1")
API_KEY  = os.getenv("AFRIKFID_API_KEY")
SANDBOX  = os.getenv("AFRIKFID_SANDBOX", "false").lower() == "true"


class AfrikFidError(Exception):
    def __init__(self, message, status_code=None, data=None):
        super().__init__(message)
        self.status_code = status_code
        self.data = data


def _headers():
    h = {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
    }
    if SANDBOX:
        h["X-Sandbox"] = "true"
    return h


def request(method: str, endpoint: str, body: dict = None) -> dict:
    url = BASE_URL + endpoint
    response = requests.request(
        method=method.upper(),
        url=url,
        headers=_headers(),
        json=body,
        timeout=30,
    )
    data = response.json()
    if not response.ok:
        raise AfrikFidError(
            data.get("message") or data.get("error", "Erreur API"),
            status_code=response.status_code,
            data=data,
        )
    return data
```

## Initier un paiement Mobile Money

```python
import afrikfid

def initier_paiement_mobile(montant: float, telephone: str, operateur: str, client_phone: str = None) -> dict:
    result = afrikfid.request("POST", "/payments/initiate", {
        "amount": montant,
        "currency": "XOF",
        "payment_method": "MOBILE_MONEY",
        "payment_phone": telephone,
        "payment_operator": operateur,
        "client_phone": client_phone,
        "idempotency_key": f"py_order_{int(__import__('time').time())}",
    })

    tx = result["transaction"]
    dist = result["distribution"]
    print(f"Référence: {tx['reference']}")
    print(f"Marchand reçoit: {dist['merchantReceives']} XOF")
    print(f"Rebate client: {dist['clientRebateAmount']} XOF")
    return tx


# Exemple
tx = initier_paiement_mobile(10000, "+2250700123456", "ORANGE", "+2250700123456")
transaction_id = tx["id"]
```

## Initier un paiement Carte

```python
def initier_paiement_carte(montant: float, client_phone: str, description: str = "") -> dict:
    result = afrikfid.request("POST", "/payments/initiate", {
        "amount": montant,
        "currency": "XOF",
        "payment_method": "card",
        "payment_phone": client_phone,
        "description": description,
    })

    payment_url = result.get("paymentUrl")
    if payment_url:
        print(f"Rediriger le client vers: {payment_url}")
        # Dans Django: return redirect(payment_url)
        # Dans Flask:  return redirect(payment_url)

    return result["transaction"]
```

## Vérifier le statut

```python
def verifier_statut(transaction_id: str) -> str:
    result = afrikfid.request("GET", f"/payments/{transaction_id}/status")
    return result["transaction"]["status"]

statut = verifier_statut(transaction_id)
print(f"Statut: {statut}")
```

## Webhook Handler (Flask)

```python
# webhook_handler.py
import hmac
import hashlib
import os
from flask import Flask, request, jsonify, abort

app = Flask(__name__)
WEBHOOK_SECRET = os.getenv("AFRIKFID_WEBHOOK_SECRET", "")


def verifier_signature(payload: bytes, signature_header: str) -> bool:
    if not WEBHOOK_SECRET or not signature_header:
        return False
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


@app.route("/webhook/afrikfid", methods=["POST"])
def webhook():
    payload   = request.get_data()
    signature = request.headers.get("X-AfrikFid-Signature", "")

    if not verifier_signature(payload, signature):
        abort(401)

    event = request.get_json(force=True)
    event_type = event.get("eventType")
    data = event.get("data", {})

    if event_type == "payment.completed":
        handle_completed(data)
    elif event_type == "payment.failed":
        handle_failed(data)
    elif event_type == "payment.refunded":
        handle_refunded(data)

    return jsonify({"received": True}), 200


def handle_completed(data: dict):
    reference = data["reference"]
    amount    = data["grossAmount"]
    print(f"Paiement confirmé: {reference} — {amount} XOF")
    # Mettre à jour la commande en base de données
    # Order.objects.filter(afrikfid_ref=reference).update(status="paid")


def handle_failed(data: dict):
    print(f"Paiement échoué: {data['reference']}")


def handle_refunded(data: dict):
    print(f"Remboursement: {data['reference']}")
```

## Webhook Handler (FastAPI)

```python
# webhook_fastapi.py
import hmac
import hashlib
import os
from fastapi import FastAPI, Request, HTTPException, Header
from typing import Optional

app = FastAPI()
WEBHOOK_SECRET = os.getenv("AFRIKFID_WEBHOOK_SECRET", "")


def verifier_signature(payload: bytes, signature: str) -> bool:
    if not WEBHOOK_SECRET:
        return True  # désactivé si pas de secret configuré
    expected = "sha256=" + hmac.new(
        WEBHOOK_SECRET.encode(), payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@app.post("/webhook/afrikfid")
async def webhook(
    request: Request,
    x_afrikfid_signature: Optional[str] = Header(None)
):
    payload = await request.body()

    if not verifier_signature(payload, x_afrikfid_signature or ""):
        raise HTTPException(status_code=401, detail="Signature invalide")

    event = await request.json()

    match event.get("eventType"):
        case "payment.completed":
            print(f"Confirmé: {event['data']['reference']}")
        case "payment.failed":
            print(f"Échoué: {event['data']['reference']}")
        case "payment.refunded":
            print(f"Remboursé: {event['data']['reference']}")

    return {"received": True}
```

## Gestion des erreurs

```python
from afrikfid import AfrikFidError

try:
    tx = initier_paiement_mobile(10000, "+2250700123456", "ORANGE")
except AfrikFidError as e:
    if e.status_code == 400:
        print("Données invalides:", e.data.get("details"))
    elif e.status_code == 401:
        print("Clé API invalide")
    elif e.status_code == 422:
        print("Échec opérateur:", e.data.get("operatorError"))
    elif e.status_code == 429:
        print("Rate limit atteint")
    else:
        print(f"Erreur {e.status_code}: {e}")
```

## Variables d'environnement

```env
AFRIKFID_BASE_URL=https://api.afrikfid.com/api/v1
AFRIKFID_API_KEY=af_pub_votre_cle
AFRIKFID_SANDBOX=false
AFRIKFID_WEBHOOK_SECRET=votre_secret
```
