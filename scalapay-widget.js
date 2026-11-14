// Widget Scalapay « Payez en 3 ou 4 fois »
// Affiché seulement si Scalapay est activé (variable Netlify SCALAPAY_ENABLED=true)
// ou, pendant les tests, si l'adresse contient ?scalapay=test (mémorisé pour la session).
// Usage : <div data-scalapay-widget data-type="cart" data-amount-selector="#cart-total"></div>
// (data-type="checkout" uniquement à l'étape de paiement)
(function () {
  try {
    if (/[?&]scalapay=test\b/.test(location.search)) sessionStorage.setItem('scalapay_test', '1');
  } catch (e) {}

  function testMode() {
    try { return sessionStorage.getItem('scalapay_test') === '1'; } catch (e) { return false; }
  }

  let configPromise = null;
  window.scalapayConfig = function () {
    if (!configPromise) {
      configPromise = fetch('/.netlify/functions/config')
        .then(r => r.json())
        .then(c => {
          const s = (c && c.scalapay) || {};
          s.active = !!(s.configured && (s.enabled || testMode()));
          return s;
        })
        .catch(() => ({ active: false }));
    }
    return configPromise;
  };

  function mount(cfg) {
    const holders = document.querySelectorAll('[data-scalapay-widget]');
    if (!holders.length) return;
    if (!document.querySelector('script[data-scalapay-loader]')) {
      const s = document.createElement('script');
      s.type = 'module';
      s.src = 'https://cdn.scalapay.com/widget/scalapay-widget-loader.js?version=V5';
      s.setAttribute('data-scalapay-loader', '1');
      document.head.appendChild(s);
    }
    holders.forEach(h => {
      if (h.querySelector('scalapay-widget')) return;
      const w = document.createElement('scalapay-widget');
      w.setAttribute('amount-selectors', JSON.stringify([h.dataset.amountSelector]));
      // Doc Scalapay : pages produit et panier = widget SANS attribut type ;
      // seule la page de paiement utilise type='checkout'.
      if (h.dataset.type === 'checkout') w.setAttribute('type', 'checkout');
      w.setAttribute('locale', 'fr');
      w.setAttribute('channel', 'travel');
      w.setAttribute('currency-position', 'after');
      if (cfg.merchantToken) w.setAttribute('merchant-token', cfg.merchantToken);
      if (cfg.environment === 'integration') w.setAttribute('environment', 'integration');
      h.appendChild(w);
      h.style.display = '';
    });
  }

  window.scalapayMount = function () {
    return window.scalapayConfig().then(cfg => { if (cfg.active) mount(cfg); return cfg; });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.scalapayMount);
  } else {
    window.scalapayMount();
  }
})();
