document.addEventListener('DOMContentLoaded', () => {
  const profileForm = document.getElementById('profile-form');
  const firstNameInput = document.getElementById('firstName');
  const lastNameInput = document.getElementById('lastName');
  const emailInput = document.getElementById('email');
  const contactNumberInput = document.getElementById('contactNumber');
  const profileSubmitBtn = document.getElementById('profileSubmitBtn');
  const profileSuccess = document.getElementById('profile-success');

  const passwordForm = document.getElementById('password-form');
  const currentPasswordInput = document.getElementById('currentPassword');
  const newPasswordInput = document.getElementById('newPassword');
  const confirmNewPasswordInput = document.getElementById('confirmNewPassword');
  const passwordSubmitBtn = document.getElementById('passwordSubmitBtn');
  const passwordSuccess = document.getElementById('password-success');

  function setFieldError(scope, fieldName, message) {
    const errorEl = scope.querySelector(`[data-error-for="${fieldName}"]`);
    const group = document.getElementById(`${fieldName}-group`);
    if (errorEl) errorEl.textContent = message || '';
    if (group) group.classList.toggle('has-error', Boolean(message));
  }

  function clearErrors(scope) {
    scope.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    scope.querySelectorAll('.auth-form-group').forEach((el) => el.classList.remove('has-error'));
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  if (contactNumberInput) {
    contactNumberInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
    });
  }

  // ---- Load current profile info ----
  let originalEmail = '';

  fetch('/api/auth/profile')
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((data) => {
      firstNameInput.value = data.firstName || '';
      lastNameInput.value = data.lastName || '';
      emailInput.value = data.email || '';
      contactNumberInput.value = data.contactNumber || '';
      originalEmail = data.email || '';
    })
    .catch(() => {
      setFieldError(profileForm, 'profile-form', 'Could not load your profile. Please refresh the page.');
    });

  // ---- Email verification modal wiring ----
  const emailOtpModal = document.getElementById('emailOtpModal');
  const emailOtpClose = document.getElementById('emailOtpClose');
  const emailOtpDisplay = document.getElementById('emailOtpDisplay');
  const emailOtpInputs = document.querySelectorAll('#emailOtpInputs .otp-digit');
  const emailOtpVerifyBtn = document.getElementById('emailOtpVerifyBtn');
  const emailOtpResend = document.getElementById('emailOtpResend');
  const emailOtpError = document.querySelector('[data-error-for="email-otp"]');

  let pendingNewEmail = '';

  function maskEmail(value) {
    const [localPart, domain] = value.split('@');
    if (!domain) return value;
    if (localPart.length <= 2) return localPart[0] + '****@' + domain;
    return localPart[0] + '****' + localPart[localPart.length - 1] + '@' + domain;
  }

  function openEmailOtpModal(newEmail) {
    pendingNewEmail = newEmail;
    emailOtpDisplay.textContent = maskEmail(newEmail);
    emailOtpInputs.forEach((d) => (d.value = ''));
    emailOtpError.textContent = '';
    emailOtpModal.hidden = false;
    document.body.classList.add('modal-open');
    emailOtpInputs[0].focus();
  }

  function closeEmailOtpModal() {
    emailOtpModal.hidden = true;
    document.body.classList.remove('modal-open');
    emailInput.value = originalEmail; // revert visible field until confirmed
  }

  emailOtpClose.addEventListener('click', closeEmailOtpModal);

  emailOtpInputs.forEach((digit, index) => {
    digit.addEventListener('input', () => {
      digit.value = digit.value.replace(/[^0-9]/g, '');
      if (digit.value && index < emailOtpInputs.length - 1) {
        emailOtpInputs[index + 1].focus();
      }
    });
    digit.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !digit.value && index > 0) {
        emailOtpInputs[index - 1].focus();
      }
    });
  });

  emailOtpVerifyBtn.addEventListener('click', async () => {
    emailOtpError.textContent = '';
    const code = Array.from(emailOtpInputs).map((d) => d.value).join('');

    if (code.length !== 6) {
      emailOtpError.textContent = 'Please enter all 6 digits.';
      return;
    }

    try {
      const response = await fetch('/api/auth/confirm-email-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        emailOtpError.textContent = data.message || 'Verification failed. Please try again.';
        return;
      }

      originalEmail = data.newEmail;
      emailInput.value = data.newEmail;
      emailOtpModal.hidden = true;
      document.body.classList.remove('modal-open');
      profileSuccess.hidden = false;
    } catch (err) {
      console.error('Confirm email change failed:', err);
      emailOtpError.textContent = 'Something went wrong. Please try again.';
    }
  });

  emailOtpResend.addEventListener('click', async (e) => {
    e.preventDefault();
    emailOtpError.textContent = '';
    try {
      const response = await fetch('/api/auth/request-email-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail: pendingNewEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        emailOtpError.textContent = data.message || 'Could not resend code.';
      }
    } catch (err) {
      emailOtpError.textContent = 'Something went wrong. Please try again.';
    }
  });

  // ---- Update profile (name/contact save immediately; email triggers verification) ----
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(profileForm);
    profileSuccess.hidden = true;

    const firstName = firstNameInput.value.trim();
    const lastName = lastNameInput.value.trim();
    const email = emailInput.value.trim();
    const contactNumber = contactNumberInput.value.trim();

    let hasError = false;

    if (!firstName) {
      setFieldError(profileForm, 'firstName', 'First name is required.');
      hasError = true;
    }
    if (!lastName) {
      setFieldError(profileForm, 'lastName', 'Last name is required.');
      hasError = true;
    }
    if (!email) {
      setFieldError(profileForm, 'email', 'Email address is required.');
      hasError = true;
    } else if (!isValidEmail(email)) {
      setFieldError(profileForm, 'email', 'Please enter a valid email address.');
      hasError = true;
    }

    if (hasError) return;

    profileSubmitBtn.disabled = true;
    profileSubmitBtn.querySelector('.btn-label').textContent = 'SAVING...';

    const emailChanged = email.toLowerCase() !== originalEmail.toLowerCase();

    try {
      // Save name/contact number immediately — email is handled separately
      const response = await fetch('/api/auth/update-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, contactNumber }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError(profileForm, 'profile-form', data.message || 'Something went wrong. Please try again.');
        return;
      }

      if (emailChanged) {
        const emailResponse = await fetch('/api/auth/request-email-change', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newEmail: email }),
        });
        const emailData = await emailResponse.json().catch(() => ({}));

        if (!emailResponse.ok) {
          setFieldError(profileForm, 'email', emailData.message || 'Could not send verification code.');
          emailInput.value = originalEmail;
          return;
        }

        openEmailOtpModal(email);
      } else {
        profileSuccess.hidden = false;
      }
    } catch (err) {
      setFieldError(profileForm, 'profile-form', 'Something went wrong. Please try again.');
      console.error('Update profile failed:', err);
    } finally {
      profileSubmitBtn.disabled = false;
      profileSubmitBtn.querySelector('.btn-label').textContent = 'SAVE CHANGES';
    }
  });

  // ---- Change password ----
  const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/;

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(passwordForm);
    passwordSuccess.hidden = true;

    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmNewPassword = confirmNewPasswordInput.value;

    let hasError = false;

    if (!currentPassword) {
      setFieldError(passwordForm, 'currentPassword', 'Current password is required.');
      hasError = true;
    }

    if (!newPassword) {
      setFieldError(passwordForm, 'newPassword', 'New password is required.');
      hasError = true;
    } else if (!passwordPattern.test(newPassword)) {
      setFieldError(passwordForm, 'newPassword', 'Password must be at least 8 characters, contain both letters and numbers, and must not include special characters.');
      hasError = true;
    }

    if (!confirmNewPassword) {
      setFieldError(passwordForm, 'confirmNewPassword', 'Please confirm your new password.');
      hasError = true;
    } else if (newPassword !== confirmNewPassword) {
      setFieldError(passwordForm, 'confirmNewPassword', 'Passwords do not match.');
      hasError = true;
    }

    if (hasError) return;

    passwordSubmitBtn.disabled = true;
    passwordSubmitBtn.querySelector('.btn-label').textContent = 'CHANGING...';

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFieldError(passwordForm, 'password-form', data.message || 'Something went wrong. Please try again.');
        return;
      }

      passwordSuccess.hidden = false;
      passwordForm.reset();
    } catch (err) {
      setFieldError(passwordForm, 'password-form', 'Something went wrong. Please try again.');
      console.error('Change password failed:', err);
    } finally {
      passwordSubmitBtn.disabled = false;
      passwordSubmitBtn.querySelector('.btn-label').textContent = 'CHANGE PASSWORD';
    }
  });
});