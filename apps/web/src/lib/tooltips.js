// Dictionnaire centralisé des tooltips d'aide contextuelle
// Utilisé avec les composants Tooltip et InfoTooltip de ui.jsx

export const TOOLTIPS = {
  // --- Statuts fidélité ---
  OPEN: "Statut de départ. Vous bénéficiez des avantages de base du programme de fidélité.",
  LIVE: "Statut actif. Vous avez effectué vos premiers achats et bénéficiez de remises sur vos transactions.",
  GOLD: "Statut Premium. Vos achats réguliers vous donnent droit à des remises améliorées.",
  ROYAL: "Statut Élite. Réservé aux clients les plus fidèles avec les meilleures remises disponibles.",
  ROYAL_ELITE: "Statut Suprême. Le niveau de fidélité le plus élevé — avantages exclusifs et remises maximales.",

  // --- Termes business (marchand) ---
  RFM: "RFM (Récence, Fréquence, Montant) : méthode qui classe vos clients selon 3 critères — la date de leur dernier achat, la fréquence de leurs visites, et le montant total dépensé chez vous.",
  churn: "Churn : risque qu'un client ne revienne plus. Un score élevé signifie que ce client est sur le point de vous quitter et nécessite une action rapide.",
  LTV: "LTV (Lifetime Value) : estimation du revenu total qu'un client va générer pour votre commerce sur toute la durée de sa fidélité.",
  panier_moyen: "Panier moyen : montant moyen dépensé par transaction. Calculé en divisant le chiffre d'affaires par le nombre de transactions.",
  taux_retour: "Taux de retour clients : pourcentage de clients qui reviennent faire au moins un deuxième achat après leur première visite.",
  chiffre_affaires: "Chiffre d'affaires : total des montants encaissés via Afrik'Fid sur la période sélectionnée.",

  // --- Modèle X / Y / Z ---
  remise_x: "Remise X (taux marchand) : pourcentage total que vous accordez sur chaque transaction. Il se divise entre la remise client (Y) et la commission Afrik'Fid (Z).",
  remise_y: "Remise Y (part client) : portion de la remise X reversée directement à votre client, sous forme de réduction immédiate ou de cashback. Toujours ≤ X.",
  commission_z: "Commission Z (part Afrik'Fid) : frais de gestion du programme = X − Y. C'est la rémunération d'Afrik'Fid pour le service de fidélisation.",
  cashback: "Cashback différé : la remise du client est créditée sur son compte Afrik'Fid et utilisable lors d'un prochain achat (pas déduire immédiatement).",
  remise_immediate: "Remise immédiate : la réduction est appliquée directement sur le montant à payer lors de cet achat, sans délai.",
  recu_net: "Reçu net : montant réellement encaissé sur votre compte après déduction de la commission Afrik'Fid (Z).",
  montant_brut: "Montant brut : montant total payé par le client avant toute déduction ou commission.",

  // --- Segments RFM ---
  seg_champions: "Champions : vos meilleurs clients. Ils achètent souvent, récemment, et dépensent le plus. Récompensez-les pour maintenir leur engagement.",
  seg_fideles: "Fidèles : clients réguliers avec un bon historique d'achats. Moins récents que les Champions, mais très fiables.",
  seg_prometteurs: "Prometteurs : clients récents qui montrent un bon potentiel. À encourager avec des offres adaptées pour les transformer en Fidèles.",
  seg_a_risque: "À Risque : clients qui achetaient régulièrement mais dont l'activité diminue. Une relance rapide peut les retenir.",
  seg_hibernants: "Hibernants : clients inactifs depuis longtemps. Une offre spéciale ou une campagne de réactivation peut les faire revenir.",
  seg_perdus: "Perdus : clients très anciens sans activité récente. Difficiles à récupérer, mais une campagne win-back ciblée peut en ramener une partie.",

  // --- Technique marchand ---
  KYC: "KYC (Know Your Customer — Connaissance Client) : vérification d'identité réglementaire obligatoire pour activer votre compte marchand et débloquer les paiements.",
  webhook: "Webhook : notification automatique envoyée vers votre système dès qu'un événement se produit (paiement, remboursement, etc.). Permet de connecter Afrik'Fid à votre logiciel de caisse ou ERP.",
  api_key: "Clé API : identifiant secret qui permet à votre application ou site web de communiquer avec les serveurs Afrik'Fid de façon sécurisée. Ne la partagez jamais.",
  sandbox: "Sandbox (Bac à sable) : environnement de test isolé pour simuler des paiements sans argent réel. Idéal pour intégrer et tester avant le lancement en production.",
  production: "Production : environnement réel où les transactions impliquent de l'argent réel. À utiliser uniquement après avoir testé en Sandbox.",
  settlement: "Settlement (versement) : délai et méthode de reversement des fonds collectés sur votre compte bancaire (ex. : virement sous 48h).",
  deux_fa: "Authentification à deux facteurs (2FA) : couche de sécurité supplémentaire qui demande un code généré par une application mobile (Google Authenticator, Authy) en plus de votre mot de passe.",
  totp: "TOTP (Time-based One-Time Password) : code à 6 chiffres généré par votre application d'authentification, valable seulement 30 secondes. Utilisé pour la 2FA.",
  hmac: "HMAC-SHA256 : signature cryptographique qui garantit l'authenticité des webhooks reçus. Permet de vérifier que la notification vient bien d'Afrik'Fid et non d'un tiers.",
  RCCM: "RCCM (Registre du Commerce et du Crédit Mobilier) : numéro d'immatriculation officielle de votre entreprise dans le registre du commerce local.",

  // --- RGPD / légal ---
  droit_oubli: "Droit à l'oubli : droit de demander la suppression définitive et irréversible de toutes vos données personnelles de nos systèmes, conformément au RGPD.",
  RGPD: "RGPD (Règlement Général sur la Protection des Données) : réglementation qui protège vos données personnelles et vous donne des droits sur leur collecte, utilisation et suppression.",
  anonymise: "Anonymisation : processus irréversible qui supprime toutes les informations permettant de vous identifier, tout en conservant les données statistiques agrégées.",

  // --- Packages ---
  pkg_starter_boost: "Starter Boost : formule d'entrée avec les essentiels — tableau de bord KPIs, score fidélité mensuel, notifications WhatsApp clients.",
  pkg_starter_plus: "Starter Plus : tout du Starter Boost + taux de retour clients, top clients fidèles, alertes churn basiques, et rapport annuel automatique.",
  pkg_growth: "Growth Intelligent : tout du Starter Plus + prédiction de churn détaillée, segmentation RFM complète, campagnes automatisées, et 2 rapports trimestriels par an.",
  pkg_premium: "Premium Performance : accès complet — LTV, élasticité-prix, cartographie des zones de chalandise, analytics avancés IA, et 4 rapports trimestriels par an.",

  // --- Fonctionnalités avancées ---
  elasticite_prix: "Élasticité-prix : analyse la sensibilité de vos clients aux variations de prix pour vous aider à fixer le niveau de remise optimal qui maximise vos revenus.",
  zones_chalandise: "Zones de chalandise : cartographie géographique montrant d'où viennent vos clients, pour identifier vos zones d'attraction et planifier votre développement commercial.",
  protocole_abandon: "Protocole abandon : séquence automatique de relances (SMS, email, WhatsApp) déclenchée quand un client cesse ses achats pendant une période définie, pour le réengager avant qu'il parte.",
  score_fidelite: "Score fidélité mensuel : note de 0 à 100 calculée chaque mois résumant la santé de votre programme (activité clients, taux de rétention, montant moyen des achats).",
  bonus_recrutement: "Bonus recrutement : commission versée au marchand pour chaque nouveau client Afrik'Fid recruté grâce à son commerce.",
  success_fee: "Success Fee : commission prélevée par Afrik'Fid uniquement sur les transactions réussies, selon votre formule d'abonnement.",
  litige: "Litige : contestation formelle d'une transaction. Vous pouvez ouvrir un litige si vous pensez qu'un paiement est erroné ou frauduleux.",
  score_churn: "Score churn : probabilité (de 0% à 100%) qu'un client ne revienne plus. Au-dessus de 70%, une action immédiate est recommandée.",
}
