document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('togglePassword');
  const submitBtn = document.getElementById('submitBtn');

  // ---- Notification dropdown ----
  const notifBtn = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');

  // ---- Profile dropdown (clickable profile section) ----
  const profileBtn = document.getElementById('profileBtn');
  const profileDropdown = document.getElementById('profileDropdown');

  function closeAllDropdowns() {
    if (notifDropdown) {
      notifDropdown.hidden = true;
      notifBtn.setAttribute('aria-expanded', 'false');
    }
    if (profileDropdown) {
      profileDropdown.hidden = true;
      profileBtn.setAttribute('aria-expanded', 'false');
    }
  }

  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = notifDropdown.hidden;
      closeAllDropdowns();
      notifDropdown.hidden = !willOpen;
      notifBtn.setAttribute('aria-expanded', String(willOpen));
    });
  }

  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = profileDropdown.hidden;
      closeAllDropdowns();
      profileDropdown.hidden = !willOpen;
      profileBtn.setAttribute('aria-expanded', String(willOpen));
    });
  }

  document.addEventListener('click', closeAllDropdowns);

  // ---- Fallback: show dashed placeholder if showcase.jpg hasn't been added yet ----
  const showcaseImage = document.getElementById('showcaseImage');
  const showcasePlaceholder = document.getElementById('showcasePlaceholder');
  if (showcaseImage && showcasePlaceholder) {
    showcaseImage.addEventListener('error', () => {
      showcaseImage.hidden = true;
      showcasePlaceholder.hidden = false;
    });
  }

  // ---- Fallback: hide broken logo <img> tags gracefully until the real file is added ----
  document.querySelectorAll('.brand-logo-img').forEach((img) => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
    });
  });

  // ---- Show/hide password ----
  togglePasswordBtn.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    togglePasswordBtn.classList.toggle('active', isHidden);
  });

  // ---- Helpers ----
  function setFieldError(fieldName, message) {
    const errorEl = document.querySelector(`[data-error-for="${fieldName}"]`);
    const group = document.getElementById(fieldName)?.closest('.auth-form-group');
    if (errorEl) errorEl.textContent = message || '';
    if (group) group.classList.toggle('has-error', Boolean(message));
  }

  function clearErrors(scope) {
    scope.querySelectorAll('.field-error').forEach(el => (el.textContent = ''));
    scope.querySelectorAll('.auth-form-group').forEach(el => el.classList.remove('has-error'));
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.querySelector('.btn-label').textContent = isLoading ? 'SIGNING IN...' : 'SIGN IN';
  }

  // ---- Submit handler (Sign In) ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const staysignedin = document.getElementById('staysignedin').checked;

    let hasError = false;

    if (!email) {
      setFieldError('email', 'Email address is required.');
      hasError = true;
    } else if (!isValidEmail(email)) {
      setFieldError('email', 'Please enter a valid email address.');
      hasError = true;
    }

    if (!password) {
      setFieldError('password', 'Password is required.');
      hasError = true;
    }

    if (hasError) return;

    setLoading(true);

    try {
      // Adjust the endpoint to match your Express route
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, staysignedin }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError('form', data.message || 'Invalid email or password.');
        return;
      }

      // Success — redirect based on role, or to a default dashboard
      window.location.href = data.redirectUrl || '/dashboard';
    } catch (err) {
      setFieldError('form', 'Something went wrong. Please try again.');
      console.error('Login request failed:', err);
    } finally {
      setLoading(false);
    }
  });

  //Forgot Password modal (pops up in place — no new tab/page)
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const forgotPasswordOverlay = document.getElementById('forgotPasswordOverlay');
  const closeForgotPasswordBtn = document.getElementById('closeForgotPassword');
  const backToSignInBtn = document.getElementById('backToSignIn');
  const forgotPasswordForm = document.getElementById('forgot-password-form');
  const resetEmailInput = document.getElementById('reset-email');
  const resetSubmitBtn = document.getElementById('resetSubmitBtn');

  function openForgotPasswordModal() {
    forgotPasswordOverlay.hidden = false;
    document.body.classList.add('modal-open'); // dims/locks the page behind it
    resetEmailInput.focus();
  }

  function closeForgotPasswordModal() {
    forgotPasswordOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    clearErrors(forgotPasswordForm);
    forgotPasswordForm.reset();
  }

  // Open on "Forgot password?" click — prevents the default link navigation
  forgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    openForgotPasswordModal();
  });

  closeForgotPasswordBtn.addEventListener('click', closeForgotPasswordModal);
  backToSignInBtn.addEventListener('click', closeForgotPasswordModal);

  // Click on the dimmed backdrop (outside the card) also closes it
  forgotPasswordOverlay.addEventListener('click', (e) => {
    if (e.target === forgotPasswordOverlay) closeForgotPasswordModal();
  });

  // Esc key closes it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !forgotPasswordOverlay.hidden) {
      closeForgotPasswordModal();
    }
  });

  function setResetLoading(isLoading) {
    resetSubmitBtn.disabled = isLoading;
    resetSubmitBtn.querySelector('.btn-label').textContent = isLoading ? 'SENDING...' : 'SEND RESET LINK';
  }

  forgotPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(forgotPasswordForm);

    const email = resetEmailInput.value.trim();

    if (!email) {
      setFieldError('reset-email', 'Email address is required.');
      return;
    }
    if (!isValidEmail(email)) {
      setFieldError('reset-email', 'Please enter a valid email address.');
      return;
    }

    setResetLoading(true);

    try {
      // Adjust the endpoint to match your Express route
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError('reset-form', data.message || 'Something went wrong. Please try again.');
        return;
      }

      // Simple success state — swap this for a toast/snackbar if you have one
      resetSubmitBtn.querySelector('.btn-label').textContent = 'LINK SENT ✓';
    } catch (err) {
      setFieldError('reset-form', 'Something went wrong. Please try again.');
      console.error('Forgot password request failed:', err);
      setResetLoading(false);
    }

    
  });
});