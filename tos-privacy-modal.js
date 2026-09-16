// tos-privacy-modal.js
// Toggle logic para sa Terms of Service at Privacy Policy popups

const tosLink = document.getElementById('tosLink');
const privacyLink = document.getElementById('privacyLink');
const tosModal = document.getElementById('tosModal');
const privacyModal = document.getElementById('privacyModal');

if (tosLink && tosModal) {
  tosLink.addEventListener('click', (e) => {
    e.preventDefault();
    tosModal.classList.add('sg-modal-open');
  });
}

if (privacyLink && privacyModal) {
  privacyLink.addEventListener('click', (e) => {
    e.preventDefault();
    privacyModal.classList.add('sg-modal-open');
  });
}

document.querySelectorAll('.sg-modal-close').forEach((btn) => {
  btn.addEventListener('click', () => {
    btn.closest('.sg-modal-overlay').classList.remove('sg-modal-open');
  });
});

document.querySelectorAll('.sg-modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('sg-modal-open');
    }
  });
});