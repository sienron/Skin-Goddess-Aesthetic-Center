document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('reset-password-form');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const submitBtn = document.getElementById('submitBtn');
  const successMessage = document.getElementById('success-message');

  // Get the token from the URL, e.g.
  // ResetPassword.html?token=abc123 -> "abc123"
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  function setFieldError(fieldName, message) {
    const errorEl = document.querySelector(`[data-error-for="${fieldName}"]`);
    const group = document.getElementById(`${fieldName}-group`);
    if (errorEl) errorEl.textContent = message || '';
    if (group) group.classList.toggle('has-error', Boolean(message));
  }

  function clearErrors() {
    form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    form.querySelectorAll('.auth-form-group').forEach((el) => el.classList.remove('has-error'));
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.querySelector('.btn-label').textContent = isLoading ? 'RESETTING...' : 'RESET PASSWORD';
  }

  // Show/hide password toggle
  function setupPasswordToggle(buttonId, inputEl) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const isPassword = inputEl.type === 'password';
      inputEl.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  setupPasswordToggle('toggleNewPassword', newPasswordInput);
  setupPasswordToggle('toggleConfirmPassword', confirmPasswordInput);

  // If there's no token in the URL, don't show the form at all
  if (!token) {
    form.hidden = true;
    setFieldError('form', 'This reset link is invalid or incomplete. Please request a new one.');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    let hasError = false;

    if (!newPassword) {
      setFieldError('new-password', 'Password is required.');
      hasError = true;
    } else if (newPassword.length < 8) {
      setFieldError('new-password', 'Password must be at least 8 characters.');
      hasError = true;
    }

    if (!confirmPassword) {
      setFieldError('confirm-password', 'Please confirm your password.');
      hasError = true;
    } else if (newPassword !== confirmPassword) {
      setFieldError('confirm-password', 'Passwords do not match.');
      hasError = true;
    }

    if (hasError) return;

    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError('form', data.message || 'Something went wrong. Please try again.');
        setLoading(false);
        return;
      }

      // Success — hide the form, show the success message
      form.hidden = true;
      successMessage.hidden = false;
    } catch (err) {
      setFieldError('form', 'Something went wrong. Please try again.');
      console.error('Reset password request failed:', err);
      setLoading(false);
    }
  });
});