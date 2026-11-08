document.getElementById('signup-form').addEventListener('submit', function (event) {
  event.preventDefault();
  subscribe();
});

function subscribe() {
  var input = document.getElementById('email');
  var email = input.value.trim();
  var status = document.getElementById('form-status');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    input.setAttribute('aria-invalid', 'true');
    status.textContent = 'Error: please enter a valid email address.';
    status.className = 'form-status is-error';
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  status.textContent = 'Thanks! Check your inbox to confirm.';
  status.className = 'form-status is-success';
}
