// Only formatPrice was used from the 200 KiB vendor bundle, so it lives here now.
function formatPrice(value) {
  return '$' + Number(value).toFixed(0);
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-price]').forEach(function (el) {
    el.textContent = ' — ' + formatPrice(el.getAttribute('data-price'));
  });

  // Card heights are equalized by the grid (align-items: stretch); no JS layout reads needed.

  // The promo slot already has its height reserved in CSS, so filling it does not shift content.
  setTimeout(function () {
    document.getElementById('promo-slot').innerHTML =
      '<div class="promo">Free shipping on orders over $75 — this weekend only</div>';
    window.acmeInsights && window.acmeInsights.track('promo-shown');
  }, 600);
});
