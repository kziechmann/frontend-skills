function subscribe() {
  var email = document.getElementById('email').value.trim();
  var status = document.getElementById('form-status');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    status.textContent = 'Please enter a valid email address.';
    status.style.color = 'red';
    return;
  }
  status.textContent = 'Thanks! Check your inbox to confirm.';
  status.style.color = 'green';
}
