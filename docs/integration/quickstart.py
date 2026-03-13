"""
Afrik'Fid Payment Gateway — Guide d'intégration Python
=======================================================
Ce fichier illustre les principales opérations disponibles via l'API.

Prérequis :
    pip install requests

Variables d'environnement :
    AFRIKFID_API_URL=https://api.afrikfid.com/api/v1
    AFRIKFID_API_KEY=af_pub_<votre_clé_publique>
    AFRIKFID_API_SECRET=af_sec_<votre_clé_secrète>
"""

import os
import hmac
import hashlib
import json
import requests

API_URL = os.getenv("AFRIKFID_API_URL", "https://api.afrikfid.com/api/v1")
API_KEY = os.getenv("AFRIKFID_API_KEY")
API_SECRET = os.getenv("AFRIKFID_API_SECRET")

session = requests.Session()
session.headers.update({"X-API-Key": API_KEY, "Content-Type": "application/json"})


# ─── 1. Initier un paiement Mobile Money ────────────────────────────────────

def initiate_payment():
    resp = session.post(f"{API_URL}/payments/initiate", json={
        "amount": 50000,
        "currency": "XOF",
        "client_afrikfid_id": "AFD-LK9A2F-B3X7",
        "payment_method": "mobile_money",
        "payment_operator": "MTN",        # ORANGE | MTN | AIRTEL | MPESA | WAVE | MOOV
        "client_phone": "+22507000001",
        "description": "Achat SuperMarché — Réf. CMD-001",
        "idempotency_key": "cmd-2026-001",
    })
    resp.raise_for_status()
    data = resp.json()
    tx = data["transaction"]
    dist = data["distribution"]

    print(f"Transaction créée: {tx['reference']}")
    print(f"Statut: {tx['status']}")
    print(f"Remise marchand (X%): {dist['merchantRebatePercent']}%")
    print(f"Remise client (Y%): {dist['clientRebatePercent']}%")
    print(f"Commission Afrik'Fid (Z%): {dist['platformCommissionPercent']}%")
    return tx["id"]


# ─── 2. Vérifier le statut d'une transaction ────────────────────────────────

def check_status(transaction_id):
    resp = session.get(f"{API_URL}/payments/{transaction_id}/status")
    resp.raise_for_status()
    data = resp.json()
    print(f"Statut: {data['transaction']['status']}")
    return data["transaction"]


# ─── 3. Remboursement (full ou partial) ─────────────────────────────────────

def refund(transaction_id, partial_amount=None):
    payload = {
        "refund_type": "partial" if partial_amount else "full",
        "reason": "Retour produit client",
    }
    if partial_amount:
        payload["amount"] = partial_amount

    resp = session.post(f"{API_URL}/payments/{transaction_id}/refund", json=payload)
    resp.raise_for_status()
    data = resp.json()
    print(f"Remboursé: {data['amount']} XOF (ratio: {data['refundRatio']})")
    print(f"Distribution remboursée: {json.dumps(data.get('distribution', {}), indent=2)}")


# ─── 4. Créer un lien de paiement ───────────────────────────────────────────

def create_payment_link():
    resp = session.post(f"{API_URL}/payment-links", json={
        "amount": 75000,
        "currency": "XOF",
        "description": "Abonnement mensuel Premium",
        "expires_in_hours": 48,
        "max_uses": 1,
    })
    resp.raise_for_status()
    link = resp.json()["paymentLink"]
    url = f"https://pay.afrikfid.com/pay/{link['code']}"
    print(f"Lien de paiement: {url}")
    return url


# ─── 5. Identifier un client avant paiement ─────────────────────────────────

def lookup_client(phone):
    resp = session.post(f"{API_URL}/clients/lookup", json={"phone": phone})
    if resp.status_code == 404:
        print("Client non trouvé — mode invité appliqué")
        return None
    resp.raise_for_status()
    client = resp.json()["client"]
    print(f"Client: {client['fullName']} | Statut: {client['loyaltyStatus']} | Remise: {client['clientRebatePercent']}%")
    print(f"Solde wallet: {client['walletBalance']} {client['currency']}")
    return client


# ─── 6. Vérifier la signature d'un webhook ──────────────────────────────────

def verify_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# Exemple Flask :
#
# from flask import Flask, request, abort
# app = Flask(__name__)
#
# @app.route("/webhooks/afrikfid", methods=["POST"])
# def afrikfid_webhook():
#     sig = request.headers.get("X-AfrikFid-Signature", "")
#     event = request.headers.get("X-AfrikFid-Event", "")
#     if not verify_webhook(request.get_data(), sig, API_SECRET):
#         abort(403)
#     data = request.get_json()
#     if event == "payment.success":
#         print("Paiement réussi:", data["reference"])
#     elif event == "loyalty.status_changed":
#         print("Statut fidélité changé:", data)
#     return "OK", 200


# ─── 7. Health check ────────────────────────────────────────────────────────

def health_check():
    resp = requests.get(f"{API_URL}/health")
    resp.raise_for_status()
    data = resp.json()
    print(f"API status: {data['status']} | DB: {data['db']['latencyMs']}ms")
    return data


# ─── Exécution exemple ───────────────────────────────────────────────────────

if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit("AFRIKFID_API_KEY manquante")
    health_check()
    tx_id = initiate_payment()
    check_status(tx_id)
    lookup_client("+22507000001")
