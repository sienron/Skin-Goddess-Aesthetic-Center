const contactForm = document.getElementById('contactForm');
const customerTicketList = document.getElementById('customerTicketList');

async function loadCustomerTickets() {
  if (!customerTicketList) return;
  customerTicketList.replaceChildren();

  try {
    const response = await fetch('/api/inquiries/mine');
    const tickets = await response.json();
    if (!response.ok) throw new Error(tickets.message || 'Could not load your tickets.');

    if (!tickets.length) {
      const empty = document.createElement('p');
      empty.className = 'client-appointment-empty';
      empty.textContent = 'You have no conversations yet.';
      customerTicketList.appendChild(empty);
      return;
    }

    tickets.forEach((ticket) => {
      const card = document.createElement('article');
      card.className = 'profile-ticket';

      const header = document.createElement('div');
      header.className = 'profile-ticket__header';
      const subject = document.createElement('h3');
      subject.textContent = String(ticket.inquiry_type || 'other').replace(/-/g, ' ');
      const status = document.createElement('span');
      status.className = `profile-ticket__status${ticket.replied_at ? ' is-replied' : ''}`;
      status.textContent = ticket.replied_at ? 'Replied' : 'Awaiting reply';
      header.append(subject, status);

      const meta = document.createElement('p');
      meta.className = 'profile-ticket__meta';
      meta.textContent = `Reference #${ticket.inquiry_id} · ${new Date(ticket.created_at).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric',
      })}`;

      const message = document.createElement('p');
      message.className = 'profile-ticket__message';
      message.textContent = ticket.message;
      card.append(header, meta, message);

      if (ticket.admin_reply) {
        const reply = document.createElement('div');
        reply.className = 'profile-ticket__reply';
        const replyHeading = document.createElement('h4');
        replyHeading.textContent = 'Clinic reply';
        const replyMessage = document.createElement('p');
        replyMessage.textContent = ticket.admin_reply;
        reply.append(replyHeading, replyMessage);
        card.appendChild(reply);
      }

      customerTicketList.appendChild(card);
    });
  } catch (error) {
    const failure = document.createElement('p');
    failure.className = 'client-appointment-empty';
    failure.textContent = error.message || 'Could not load your tickets.';
    customerTicketList.appendChild(failure);
  }
}

loadCustomerTickets();

if (!contactForm) {
  // Self-guard: safe to include on pages without this form
} else {
  const formStatus = document.getElementById('formStatus');

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = contactForm.elements.namedItem('firstName').value.trim();
    const lastName = contactForm.elements.namedItem('lastName').value.trim();
    const email = contactForm.elements.namedItem('email').value.trim();
    const phone = contactForm.elements.namedItem('phone').value.trim();
    const subject = contactForm.elements.namedItem('subject').value;
    const message = contactForm.elements.namedItem('message').value.trim();

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
    const submitLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Sending...';
    showStatus('Sending your message...', 'pending');

    try {
      const response = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, phone, subject, message }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'We could not send your inquiry.');

      const ticketReference = data.inquiryId ? ` Your reference number is #${data.inquiryId}.` : '';
      showStatus(`Message sent!${ticketReference} We'll get back to you as soon as we can.`, 'success');
      contactForm.reset();
      await loadCustomerTickets();
    } catch (error) {
      showStatus(error.message || 'We could not send your inquiry. Please try again.', 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = submitLabel;
    }
  });

  function showStatus(text, type) {
    formStatus.textContent = text;
    formStatus.className = `form-status ${type}`;
  }
}
