/* ===== Account page: view/edit mode toggle ===== */
(function () {
  // Profile information
  const profileEditBtn = document.getElementById('profileEditBtn');
  const profileCancelBtn = document.getElementById('profileCancelBtn');
  const profileSubmitBtn = document.getElementById('profileSubmitBtn');
  const profileActions = document.getElementById('profileFormActions');
  const profileSuccess = document.getElementById('profile-success');

  const profileFields = [
    'firstName',
    'lastName',
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

    if (profileSubmitBtn) {
      profileSubmitBtn.disabled = true;
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
      profileActions.hidden = false;
    }

    if (profileSubmitBtn) {
      profileSubmitBtn.disabled = true;
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

    if (profileSubmitBtn) {
      profileSubmitBtn.disabled = !changed;
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

  document.getElementById('profile-form')?.addEventListener('profile:statechange', checkProfileChanged);

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

  const personalDetailsForm = document.getElementById('personal-details-form');
  const personalDetailsView = document.getElementById('profilePersonalDetailsView');
  const personalDetailsEditBtn = document.getElementById('personalDetailsEditBtn');
  const personalDetailsCancelBtn = document.getElementById('personalDetailsCancelBtn');
  const personalDetailsSubmitBtn = document.getElementById('personalDetailsSubmitBtn');
  const personalDetailsActions = document.getElementById('personalDetailsFormActions');
  const personalDetailsSuccess = document.getElementById('personal-details-success');
  const personalDetailsFields = [
    'profileDateOfBirthInput',
    'profileGenderInput',
    'profileAddressInput',
  ];
  let personalDetailsOriginalValues = {};

  function enterPersonalDetailsViewMode() {
    personalDetailsFields.forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.disabled = true;
    });
    if (personalDetailsView) personalDetailsView.hidden = false;
    if (personalDetailsForm) personalDetailsForm.hidden = true;
    if (personalDetailsActions) personalDetailsActions.hidden = true;
    if (personalDetailsSubmitBtn) personalDetailsSubmitBtn.disabled = true;
    if (personalDetailsEditBtn) personalDetailsEditBtn.hidden = false;
  }

  function enterPersonalDetailsEditMode() {
    personalDetailsOriginalValues = {};
    personalDetailsFields.forEach((id) => {
      const input = document.getElementById(id);
      if (input) {
        personalDetailsOriginalValues[id] = input.value;
        input.disabled = false;
      }
    });
    if (personalDetailsView) personalDetailsView.hidden = true;
    if (personalDetailsForm) personalDetailsForm.hidden = false;
    if (personalDetailsActions) personalDetailsActions.hidden = false;
    if (personalDetailsSubmitBtn) personalDetailsSubmitBtn.disabled = true;
    if (personalDetailsEditBtn) personalDetailsEditBtn.hidden = true;
    if (personalDetailsSuccess) personalDetailsSuccess.hidden = true;
    document.getElementById('profileDateOfBirthInput')?.focus();
  }

  function checkPersonalDetailsChanged() {
    const changed = personalDetailsFields.some((id) => {
      const input = document.getElementById(id);
      return input && input.value !== personalDetailsOriginalValues[id];
    });
    if (personalDetailsSubmitBtn) personalDetailsSubmitBtn.disabled = !changed;
  }

  function cancelPersonalDetailsEdit() {
    personalDetailsFields.forEach((id) => {
      const input = document.getElementById(id);
      if (input && personalDetailsOriginalValues[id] !== undefined) {
        input.value = personalDetailsOriginalValues[id];
      }
    });
    enterPersonalDetailsViewMode();
  }

  personalDetailsEditBtn?.addEventListener('click', enterPersonalDetailsEditMode);
  personalDetailsCancelBtn?.addEventListener('click', cancelPersonalDetailsEdit);
  personalDetailsFields.forEach((id) => {
    const input = document.getElementById(id);
    input?.addEventListener('input', checkPersonalDetailsChanged);
    input?.addEventListener('change', checkPersonalDetailsChanged);
  });
  enterPersonalDetailsViewMode();

  if (personalDetailsSuccess) {
    new MutationObserver(() => {
      if (!personalDetailsSuccess.hidden) enterPersonalDetailsViewMode();
    }).observe(personalDetailsSuccess, {
      attributes: true,
      attributeFilter: ['hidden'],
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