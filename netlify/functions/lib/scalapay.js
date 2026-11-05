// Réglages Scalapay partagés par toutes les fonctions.
//
// Variables Netlify :
//   SCALAPAY_API_KEY        clé API (test : qhtfs87hjnc12kkos, fournie par Scalapay)
//   SCALAPAY_API_URL        optionnel, sinon déduit de la clé
//   SCALAPAY_ENABLED        "true" pour afficher Scalapay à toutes les clientes
//                           (laisser vide pendant les tests : visible seulement
//                           avec ?scalapay=test dans l'adresse)
//   SCALAPAY_MERCHANT_TOKEN jeton du widget (portail marchand > Developer) en production

const TEST_API_KEY = 'qhtfs87hjnc12kkos';
const TEST_WIDGET_TOKEN = '8KDS3SPEL';

function isTest() {
  const url = process.env.SCALAPAY_API_URL || '';
  if (url) return /integration/i.test(url);
  return (process.env.SCALAPAY_API_KEY || '') === TEST_API_KEY;
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
