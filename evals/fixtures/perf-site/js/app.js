document.addEventListener('DOMContentLoaded', function () {
  // Prices are rendered client-side with the vendor bundle's formatter.
  document.querySelectorAll('[data-price]').forEach(function (el) {
    el.textContent = ' — ' + window.Vendor.formatPrice(el.getAttribute('data-price'));
  });

  // Equalize product card heights.
  var cards = document.querySelectorAll('.product');
  for (var i = 0; i < cards.length; i++) {
    var height = cards[i].offsetHeight; // read layout
    cards[i].style.minHeight = height + 8 + 'px'; // write style -> next read forces layout
  }

  // The promo banner arrives after a (simulated) API call and is inserted
  // above the header, pushing the whole page down.
  setTimeout(function () {
    document.getElementById('promo-slot').innerHTML =
      '<div class="promo">Free shipping on orders over $75 — this weekend only</div>';
    window.acmeInsights && window.acmeInsights.track('promo-shown');
  }, 600);
});
