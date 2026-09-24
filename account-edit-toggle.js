/* ===== Account page: view/edit mode toggle ===== */
(function () {
  // Profile information
  const profileEditBtn = document.getElementById('profileEditBtn');
  const profileCancelBtn = document.getElementById('profileCancelBtn');
  const profileActions = document.getElementById('profileFormActions');
  const profileSuccess = document.getElementById('profile-success');

  const profileFields = [
    'firstName',
    'lastName',
    'email',
    'contactNumber'
  ];

  let profileOriginalValues = {};

  function enterProfileViewMode() {
    profileFields.forEach((id) => {
      const input = document.getElementById(id);

      if (input) {
        input.disabled = true;
      }
    });

    if (profileActions) {
      profileActions.hidden = true;
    }

    if (profileEditBtn) {
      profileEditBtn.hidden = false;
    }
  }

  function enterProfileEditMode() {
    profileOriginalValues = {};

    profileFields.forEach((id) => {
      const input = document.getElementById(id);

      if (input) {
        profileOriginalValues[id] = input.value;
        input.disabled = false;
      }
    });

    if (profileActions) {
      profileActions.hidden = true;
    }

    if (profileEditBtn) {
      profileEditBtn.hidden = true;
    }

    if (profileSuccess) {
      profileSuccess.hidden = true;
    }

    const firstInput = document.getElementById('firstName');

    if (firstInput) {
      firstInput.focus();
    }
  }

  function checkProfileChanged() {
    const changed = profileFields.some((id) => {
      const input = document.getElementById(id);

      return input &&
        input.value !== profileOriginalValues[id];
    });

    if (profileActions) {
      profileActions.hidden = !changed;
    }
  }

  function cancelProfileEdit() {
    profileFields.forEach((id) => {
      const input = document.getElementById(id);

      if (input && profileOriginalValues[id] !== undefined) {
        input.value = profileOriginalValues[id];
      }
    });

    enterProfileViewMode();
  }

  if (profileEditBtn) {
    profileEditBtn.addEventListener('click', enterProfileEditMode);
  }

  if (profileCancelBtn) {
    profileCancelBtn.addEventListener('click', cancelProfileEdit);
  }

  profileFields.forEach((id) => {
    const input = document.getElementById(id);

    if (input) {
      input.addEventListener('input', checkProfileChanged);
    }
  });

  enterProfileViewMode();

  // Return to view mode after a successful profile update.
  if (profileSuccess) {
    new MutationObserver(() => {
      if (!profileSuccess.hidden) {
        enterProfileViewMode();
      }
    }).observe(profileSuccess, {
      attributes: true,
      attributeFilter: ['hidden']
    });
  }

  // Change password
  const passwordForm = document.getElementById('password-form');
  const passwordEditBtn = document.getElementById('passwordEditBtn');
  const passwordCancelBtn = document.getElementById('passwordCancelBtn');

  function closePasswordForm() {
    if (passwordForm) {
      passwordForm.hidden = true;
      passwordForm.reset();
    }

    if (passwordEditBtn) {
      passwordEditBtn.hidden = false;
    }
  }

  function openPasswordForm() {
    if (passwordForm) {
      passwordForm.hidden = false;
    }

    if (passwordEditBtn) {
      passwordEditBtn.hidden = true;
    }

    const currentPassword = document.getElementById('currentPassword');

    if (currentPassword) {
      currentPassword.focus();
    }
  }

  if (passwordEditBtn) {
    passwordEditBtn.addEventListener('click', openPasswordForm);
  }

  if (passwordCancelBtn) {
    passwordCancelBtn.addEventListener('click', closePasswordForm);
  }

  // Show/hide password buttons
  document.querySelectorAll('.toggle-password').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const input = document.getElementById(targetId);

      if (!input) {
        return;
      }

      const isPassword = input.type === 'password';

      input.type = isPassword ? 'text' : 'password';

      button.setAttribute(
        'aria-label',
        isPassword ? 'Hide password' : 'Show password'
      );
    });
  });
})();