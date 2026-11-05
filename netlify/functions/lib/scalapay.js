// Réglages Scalapay partagés par toutes les fonctions.
//
// Variables Netlify :
//   SCALAPAY_API_KEY        clé API (clé de test publique fournie par Scalapay, ou clé de production)
//   SCALAPAY_API_URL        optionnel, sinon déduit de la clé
//   SCALAPAY_ENABLED        "true" pour afficher Scalapay à toutes les clientes
//                           (laisser vide pendant les tests : visible seulement
//                           avec ?scalapay=test dans l'adresse)
//   SCALAPAY_MERCHANT_TOKEN jeton du widget (portail marchand > Developer) en production

const crypto = require('crypto');
// Empreinte de la clé de test publique Scalapay (la clé elle-même n'est pas
// écrite ici, sinon Netlify bloque le déploiement).
const TEST_API_KEY_SHA256 = 'cb509c41b123e11b2171995b48e52b6ba90f2a9d8f1e2fde070856b98b0ce80b';
const TEST_WIDGET_TOKEN = '8KDS3SPEL';

function isTest() {
  const url = process.env.SCALAPAY_API_URL || '';
  if (url) return /integration/i.test(url);
  const key = process.env.SCALAPAY_API_KEY || '';
  return !!key && crypto.createHash('sha256').update(key).digest('hex') === TEST_API_KEY_SHA256;
}

function apiUrl() {
  return process.env.SCALAPAY_API_URL ||
    (isTest() ? 'https://integration.api.scalapay.com' : 'https://api.scalapay.com');
}

function headers(extra) {
  return Object.assign({
    Authorization: `Bearer ${process.env.SCALAPAY_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }, extra || {});
}

function publicConfig() {
  const test = isTest();
  return {
    configured: !!process.env.SCALAPAY_API_KEY,
    enabled: process.env.SCALAPAY_ENABLED === 'true',
    environment: test ? 'integration' : 'production',
    merchantToken: process.env.SCALAPAY_MERCHANT_TOKEN || (test ? TEST_WIDGET_TOKEN : '')
  };
}

module.exports = { apiUrl, headers, isTest, publicConfig };
