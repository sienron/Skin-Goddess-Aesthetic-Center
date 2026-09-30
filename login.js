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

  const loginMfaOverlay = document.getElementById('loginMfaOverlay');
  const loginMfaForm = document.getElementById('loginMfaForm');
  const loginMfaDigits = loginMfaOverlay.querySelectorAll('.otp-digit');
  const loginMfaEmail = document.getElementById('loginMfaEmail');
  const rememberLoginDevice = document.getElementById('rememberLoginDevice');
  const loginMfaError = document.getElementById('loginMfaError');
  const loginMfaMessage = document.getElementById('loginMfaMessage');
  const loginMfaVerifyBtn = document.getElementById('loginMfaVerifyBtn');
  const loginMfaResendLink = document.getElementById('loginMfaResendLink');
  const loginMfaTimerValue = document.getElementById('loginMfaTimerValue');
  let loginMfaSecondsLeft = 0;
  let loginMfaCountdownInterval = null;

  function updateLoginMfaTimer() {
    const minutes = Math.floor(loginMfaSecondsLeft / 60).toString().padStart(2, '0');
    const seconds = (loginMfaSecondsLeft % 60).toString().padStart(2, '0');
    loginMfaTimerValue.textContent = `${minutes}:${seconds}`;
  }

  function startLoginMfaCountdown() {
    loginMfaSecondsLeft = 5 * 60;
    clearInterval(loginMfaCountdownInterval);
    updateLoginMfaTimer();
    loginMfaCountdownInterval = setInterval(() => {
      loginMfaSecondsLeft -= 1;
      updateLoginMfaTimer();
      if (loginMfaSecondsLeft <= 0) {
        clearInterval(loginMfaCountdownInterval);
      }
    }, 1000);
  }

  function stopLoginMfaCountdown() {
    clearInterval(loginMfaCountdownInterval);
  }

  function openLoginMfa(email) {
    loginMfaEmail.textContent = email;
    loginMfaDigits.forEach((digit) => { digit.value = ''; });
    rememberLoginDevice.checked = false;
    loginMfaError.textContent = '';
    loginMfaMessage.textContent = '';
    loginMfaOverlay.hidden = false;
    document.body.classList.add('modal-open');
    startLoginMfaCountdown();
    loginMfaDigits[0].focus();
  }

  function closeLoginMfa() {
    loginMfaOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    loginMfaError.textContent = '';
    loginMfaMessage.textContent = '';
    stopLoginMfaCountdown();
  }

  document.getElementById('closeLoginMfa').addEventListener('click', closeLoginMfa);
  document.getElementById('backToLoginMfa').addEventListener('click', (event) => {
    event.preventDefault();
    closeLoginMfa();
  });
  loginMfaOverlay.addEventListener('click', (event) => {
    if (event.target === loginMfaOverlay) closeLoginMfa();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !loginMfaOverlay.hidden) closeLoginMfa();
  });

  loginMfaDigits.forEach((digit, index) => {
    digit.addEventListener('input', () => {
      digit.value = digit.value.replace(/[^0-9]/g, '').slice(0, 1);
      if (digit.value && index < loginMfaDigits.length - 1) loginMfaDigits[index + 1].focus();
    });
    digit.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && !digit.value && index > 0) loginMfaDigits[index - 1].focus();
    });
  });

  loginMfaForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginMfaError.textContent = '';
    loginMfaMessage.textContent = '';
    const code = Array.from(loginMfaDigits).map((digit) => digit.value).join('');
    if (!/^\d{6}$/.test(code)) {
      loginMfaError.textContent = 'Enter all six digits.';
      return;
    }

    loginMfaVerifyBtn.disabled = true;
    loginMfaVerifyBtn.textContent = 'VERIFYING...';
    try {
      const response = await fetch('/api/auth/login/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, rememberDevice: rememberLoginDevice.checked }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        loginMfaError.textContent = data.message || 'Verification failed. Please try again.';
        return;
      }
      window.location.href = data.redirectUrl || '/index.html';
    } catch (error) {
      loginMfaError.textContent = 'Something went wrong. Please try again.';
      console.error('Login verification request failed:', error);
    } finally {
      loginMfaVerifyBtn.disabled = false;
      loginMfaVerifyBtn.textContent = 'VERIFY CODE';
    }
  });

  loginMfaResendLink.addEventListener('click', async (event) => {
    event.preventDefault();
    loginMfaError.textContent = '';
    loginMfaMessage.textContent = '';
    try {
      const response = await fetch('/api/auth/login/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        loginMfaError.textContent = data.message || 'Could not resend the code. Please try again.';
        return;
      }
      loginMfaDigits.forEach((digit) => { digit.value = ''; });
      loginMfaMessage.textContent = data.message || 'A new sign-in code has been sent.';
      startLoginMfaCountdown();
      loginMfaDigits[0].focus();
    } catch (error) {
      loginMfaError.textContent = 'Something went wrong. Please try again.';
      console.error('Login verification resend failed:', error);
    }
  });

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

      if (data.requiresMfa) {
        openLoginMfa(email);
        return;
      }

      // Success — open the dashboard assigned to the user's role.
      window.location.href = data.redirectUrl || '/index.html';
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

  function setResetLoading(isLoading) {
    resetSubmitBtn.disabled = isLoading;
    resetSubmitBtn.querySelector('.btn-label').textContent = isLoading ? 'SENDING...' : 'SEND RESET LINK';
  }

  function closeForgotPasswordModal() {
    forgotPasswordOverlay.hidden = true;
    document.body.classList.remove('modal-open');
    clearErrors(forgotPasswordForm);
    forgotPasswordForm.reset();
    setResetLoading(false); // re-enable + reset label back to "SEND RESET LINK"
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
        setResetLoading(false); // re-enable the button on failure
        return;
      }

      // Success — stays disabled with a confirmation label, nothing more to do here
      resetSubmitBtn.querySelector('.btn-label').textContent = 'LINK SENT ✓';
    } catch (err) {
      setFieldError('reset-form', 'Something went wrong. Please try again.');
      console.error('Forgot password request failed:', err);
      setResetLoading(false);
    }
  });
});