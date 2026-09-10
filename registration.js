document.addEventListener('DOMContentLoaded', () => {

  // ===== Show/hide password toggle (Password + Confirm Password) =======
  const togglePwButtons = document.querySelectorAll('.toggle-pw');

  togglePwButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const input = document.getElementById(targetId);

      if (input.type === 'password') {
        input.type = 'text';
      } else {
        input.type = 'password';
      }
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

  function startCountdown() {
    secondsLeft = 300; // 5 minutes = 300 seconds

    clearInterval(countdownInterval); // stop any previous timer first
    countdownInterval = setInterval(() => {
      secondsLeft = secondsLeft - 1;

      let minutes = Math.floor(secondsLeft / 60);
      let seconds = secondsLeft % 60;

      // add a leading zero if the number is less than 10 (e.g. "4" -> "04")
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
    }, 1000); // runs every 1000ms = 1 second
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
    document.body.classList.add('modal-open'); // dims/locks the page behind it
    otpDigits.forEach((digit) => (digit.value = '')); // clear any leftover digits
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

    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const agree = document.getElementById('agree').checked;

    if (password !== confirmPassword) {
      alert('Passwords do not match.');
      return;
    }
    if (!agree) {
      alert('Please agree to the Terms of Service and Privacy Policy.');
      return;
    }

    const formData = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      dob: document.getElementById('dob').value || null,
      gender: document.getElementById('gender').value || null,
      civilStatus: document.getElementById('civilStatus').value || null,
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

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || 'Something went wrong. Please try again.');
        return;
      }

      currentUserId = data.userId; // save this — verify-otp needs it
      otpEmailDisplay.textContent = maskEmail(formData.email);
      openOtpModal();
    } catch (err) {
      console.error('Registration request failed:', err);
      alert('Something went wrong. Please try again.');
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
    const code = Array.from(otpDigits).map((digit) => digit.value).join('');

    if (code.length !== 6) {
      alert('Please enter all 6 digits.');
      return;
    }

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, code }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || 'Verification failed. Please try again.');
        return;
      }

      alert('Email verified! You can now sign in.');
      window.location.href = '/LoginPage.html';
    } catch (err) {
      console.error('OTP verification request failed:', err);
      alert('Something went wrong. Please try again.');
    }
  });

  // ---- Resend code ----
  resendLink.addEventListener('click', async (e) => {
    e.preventDefault();

    try {
      const response = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.message || 'Could not resend code. Please try again.');
        return;
      }

      startCountdown(); // bagong code = bagong 5-minute window
    } catch (err) {
      console.error('Resend OTP request failed:', err);
      alert('Something went wrong. Please try again.');
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
    // strip anything that's not a digit, then cap at 10 digits
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  });
 
  // also block non-numeric keys on the way in (paste is still caught
  // by the 'input' handler above, this just stops stray letters from
  // flashing on screen before getting stripped)
  contactNumberInput.addEventListener('keydown', (e) => {
    const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (allowedKeys.includes(e.key)) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
  });
}
 