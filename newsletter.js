document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('.homepage-signup__form');
  const emailInput = document.getElementById('newsletterEmail');
  const submitButton = form?.querySelector('button[type="submit"]');
  const message = document.getElementById('newsletterMessage');

  if (!form || !emailInput || !submitButton || !message) return;

  const defaultButtonText = submitButton.textContent;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let isSubmitting = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    message.textContent = '';
    message.hidden = true;

    const email = emailInput.value.trim();
    if (email.length > 254 || !validEmail.test(email)) {
      message.textContent = 'Please enter a valid email address.';
      message.hidden = false;
      emailInput.setAttribute('aria-invalid', 'true');
      emailInput.focus();
      return;
    }

    emailInput.removeAttribute('aria-invalid');
    isSubmitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'SUBSCRIBING...';
    form.setAttribute('aria-busy', 'true');

    try {
      const response = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.message || 'We could not subscribe you right now. Please try again.');
      }

      if (data?.subscribed === true) {
        message.textContent = data.message || 'Thanks for subscribing!';
        emailInput.value = '';
      } else if (data?.alreadySubscribed === true) {
        message.textContent = data.message || 'This email is already subscribed.';
      } else {
        throw new Error('We could not confirm your subscription. Please try again.');
      }
      message.hidden = false;
    } catch (error) {
      message.textContent = error instanceof TypeError
        ? 'A network error occurred. Please check your connection and try again.'
        : error.message || 'We could not subscribe you right now. Please try again.';
      message.hidden = false;
    } finally {
      isSubmitting = false;
      submitButton.disabled = false;
      submitButton.textContent = defaultButtonText;
      form.removeAttribute('aria-busy');
    }
  });
});
