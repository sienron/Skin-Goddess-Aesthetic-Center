// contact-us.js — logic specific to ContactUs.html only.
// Move this into a shared file later if a 2nd page needs the same form logic.

const contactForm = document.getElementById('contactForm');
if (!contactForm) {
  // Self-guard: safe to include on pages without this form
} else {
  const formStatus = document.getElementById('formStatus');

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const subject = document.getElementById('subject').value;
    const message = document.getElementById('message').value.trim();

    // Basic client-side validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!firstName || !lastName || !email || !subject || !message) {
      showStatus('Please fill out all required fields.', 'error');
      return;
    }

    if (!emailPattern.test(email)) {
      showStatus('Please enter a valid email address.', 'error');
      return;
    }

    const submitButton = contactForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    showStatus('Sending your message...', '');

    try {
      const response = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, phone, subject, message }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'We could not send your inquiry.');

      showStatus("Message sent! We'll get back to you as soon as we can.", 'success');
      contactForm.reset();
    } catch (error) {
      showStatus(error.message || 'We could not send your inquiry. Please try again.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  function showStatus(text, type) {
    formStatus.textContent = text;
    formStatus.className = `form-status ${type}`;
  }
}
