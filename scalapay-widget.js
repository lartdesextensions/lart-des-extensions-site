// Widget Scalapay « Payez en 3 ou 4 fois »
// Affiché seulement si Scalapay est activé (variable Netlify SCALAPAY_ENABLED=true)
// ou, pendant les tests, si l'adresse contient ?scalapay=test (mémorisé pour la session).
// Usage : <div data-scalapay-widget data-type="cart" data-amount-selector="#cart-total"></div>
// (data-type="cart" dans le panier, data-type="checkout" à l'étape de paiement)
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

  // Montant lisible dans l'élément de prix (ex. « 220 € ») : le widget n'est
  // créé qu'une fois qu'un vrai montant est affiché, sinon Scalapay ne trouve
  // pas de prix valide (« None of the amountSelectors resolved… »).
  function montant(sel) {
    const el = sel && document.querySelector(sel);
    if (!el) return 0;
    const n = parseFloat(String(el.textContent).replace(/[^0-9,.]/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }

  function creerWidget(h, cfg) {
    if (h.querySelector('scalapay-widget')) return;
    if (!(montant(h.dataset.amountSelector) > 0)) return;
    // Script d'origine Scalapay (doc widget V5) :
    // panier -> type="cart", page de paiement -> type="checkout".
    const w = document.createElement('scalapay-widget');
    w.setAttribute('type', h.dataset.type || 'cart');
    w.setAttribute('amount-selectors', JSON.stringify([h.dataset.amountSelector]));
    if (cfg.merchantToken) w.setAttribute('merchant-token', cfg.merchantToken);
    if (cfg.environment === 'integration') w.setAttribute('environment', 'integration');
    w.setAttribute('locale', 'fr');
    w.setAttribute('channel', 'travel');
    h.appendChild(w);
    h.style.display = '';
  }

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
      creerWidget(h, cfg);
      // Le montant change (panier qui se remplit, choix de la prestation) :
      // on crée le widget dès qu'un montant valide apparaît.
      const cible = document.querySelector(h.dataset.amountSelector);
      if (cible && !h._spObs) {
        h._spObs = new MutationObserver(() => creerWidget(h, cfg));
        h._spObs.observe(cible, { childList: true, characterData: true, subtree: true });
      }
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
