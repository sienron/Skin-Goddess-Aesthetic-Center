document.addEventListener('DOMContentLoaded', () => {

  // ===== Show/hide password toggle (Password + Confirm Password) =======
  const togglePwButtons = document.querySelectorAll('.toggle-pw');

  togglePwButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const input = document.getElementById(targetId);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // ===== OTP / Email Verification modal (shown after CREATE ACCOUNT) ===
  const otpModal = document.getElementById('otpModal');
  const registerForm = document.getElementById('registerForm');

  if (!otpModal || !registerForm) return; // self-guard: safe if this page's markup isn't present

  const modalClose = otpModal.querySelector('.auth-modal-close');
  const backToLogin = otpModal.querySelector('.back-to-signin');
  const otpDigits = otpModal.querySelectorAll('.otp-digit');
  const timerValue = otpModal.querySelector('.otp-timer-value');
  const resendLink = otpModal.querySelector('.otp-resend a');
  const verifyBtn = otpModal.querySelector('.btn-gold.btn-block');
  const otpEmailDisplay = document.getElementById('otpEmailDisplay');

  let secondsLeft = 0;
  let countdownInterval = null;
  let currentUserId = null; // set after a successful register response

  // ===== Inline error helpers (same pattern as reset-password.js) =====
  function setFieldError(fieldName, message) {
    const errorEl = document.querySelector(`[data-error-for="${fieldName}"]`);
    const field = document.getElementById(fieldName);
    const group = field ? field.closest('.field') : null;
    if (errorEl) errorEl.textContent = message || '';
    if (group) group.classList.toggle('has-error', Boolean(message));
  }

  function clearErrors(scope) {
    const root = scope || document;
    root.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    root.querySelectorAll('.field').forEach((el) => el.classList.remove('has-error'));
  }

  function startCountdown() {
    secondsLeft = 300; // 5 minutes = 300 seconds

    clearInterval(countdownInterval); // stop any previous timer first
    countdownInterval = setInterval(() => {
      secondsLeft = secondsLeft - 1;

      let minutes = Math.floor(secondsLeft / 60);
      let seconds = secondsLeft % 60;

      if (seconds < 10) {
        seconds = '0' + seconds;
      }
      if (minutes < 10) {
        minutes = '0' + minutes;
      }

      timerValue.textContent = minutes + ':' + seconds;

      if (secondsLeft <= 0) {
        clearInterval(countdownInterval);
        timerValue.textContent = '00:00';
      }
    }, 1000);
  }

  function stopCountdown() {
    clearInterval(countdownInterval);
  }

  function maskEmail(email) {
    const [localPart, domain] = email.split('@');
    if (localPart.length <= 2) {
      return localPart[0] + '****@' + domain;
    }
    const firstChar = localPart[0];
    const lastChar = localPart[localPart.length - 1];
    return firstChar + '****' + lastChar + '@' + domain;
  }

  function openOtpModal() {
    otpModal.hidden = false;
    document.body.classList.add('modal-open');
    otpDigits.forEach((digit) => (digit.value = ''));
    otpDigits[0].focus();
    startCountdown();
  }

  function closeOtpModal() {
    otpModal.hidden = true;
    document.body.classList.remove('modal-open');
    stopCountdown();
  }

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(registerForm);
    setFieldError('form', '');

    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const agree = document.getElementById('agree').checked;

    let hasError = false;

    const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/;
    if (!passwordPattern.test(password)) {
      setFieldError('password', 'Password must be at least 8 characters, contain both letters and numbers, and must not include special characters.');
      hasError = true;
    }

    if (password !== confirmPassword) {
      setFieldError('confirmPassword', 'Passwords do not match.');
      hasError = true;
    }

    if (!agree) {
      setFieldError('agree', 'Please agree to the Terms of Service and Privacy Policy.');
      hasError = true;
    }

    if (hasError) return;

    const formData = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      dob: document.getElementById('dob').value || null,
      gender: document.getElementById('gender').value || null,
      contactNumber: document.getElementById('contactNumber').value.trim(),
      address: document.getElementById('address').value.trim(),
      allergies: document.getElementById('allergies').value.trim(),
      conditions: document.getElementById('conditions').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: password,
    };

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError('form', data.message || 'Something went wrong. Please try again.');
        return;
      }

      currentUserId = data.userId; // save this — verify-otp needs it
      otpEmailDisplay.textContent = maskEmail(formData.email);
      openOtpModal();
    } catch (err) {
      console.error('Registration request failed:', err);
      setFieldError('form', 'Something went wrong. Please try again.');
    }
  });

  modalClose.addEventListener('click', closeOtpModal);
  backToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    closeOtpModal();
  });

  // Click on the dimmed backdrop (outside the card) also closes it
  otpModal.addEventListener('click', (e) => {
    if (e.target === otpModal) closeOtpModal();
  });

  // Esc key closes it
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !otpModal.hidden) {
      closeOtpModal();
    }
  });

  // ---- Verify Code button ----
  verifyBtn.addEventListener('click', async () => {
    const errorEl = otpModal.querySelector('[data-error-for="otp"]');
    if (errorEl) errorEl.textContent = '';

    const code = Array.from(otpDigits).map((digit) => digit.value).join('');

    if (code.length !== 6) {
      if (errorEl) errorEl.textContent = 'Please enter all 6 digits.';
      return;
    }

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, code }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (errorEl) errorEl.textContent = data.message || 'Verification failed. Please try again.';
        return;
      }

      // Inline success instead of alert — swap modal content, then redirect
      const modalBox = otpModal.querySelector('.otp-modal');
      modalBox.innerHTML = `
        <div class="modal-icon" style="background:#2e7d32;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
        </div>
        <h2 class="modal-title">Email verified!</h2>
        <p class="modal-subtitle">You can now sign in to your account.</p>
      `;

      setTimeout(() => {
        window.location.href = '/LoginPage.html';
      }, 1500);
    } catch (err) {
      console.error('OTP verification request failed:', err);
      if (errorEl) errorEl.textContent = 'Something went wrong. Please try again.';
    }
  });

  // ---- Resend code ----
  resendLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const errorEl = otpModal.querySelector('[data-error-for="otp"]');
    if (errorEl) errorEl.textContent = '';

    try {
      const response = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (errorEl) errorEl.textContent = data.message || 'Could not resend code. Please try again.';
        return;
      }

      startCountdown();
    } catch (err) {
      console.error('Resend OTP request failed:', err);
      if (errorEl) errorEl.textContent = 'Something went wrong. Please try again.';
    }
  });

  // Auto-advance to the next digit box, auto-backspace to the previous one
  otpDigits.forEach((digit, index) => {
    digit.addEventListener('input', () => {
      digit.value = digit.value.replace(/[^0-9]/g, '');
      if (digit.value && index < otpDigits.length - 1) {
        otpDigits[index + 1].focus();
      }
    });

    digit.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !digit.value && index > 0) {
        otpDigits[index - 1].focus();
      }
    });
  });

});


const contactNumberInput = document.getElementById('contactNumber');
if (contactNumberInput) {
  contactNumberInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  });

  contactNumberInput.addEventListener('keydown', (e) => {
    const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (allowedKeys.includes(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });
}