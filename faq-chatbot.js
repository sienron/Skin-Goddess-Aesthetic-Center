document.addEventListener('DOMContentLoaded', async () => {
  let launcher = document.getElementById('faqChatLauncher');

  if (!launcher) {
    const mount = document.querySelector('[data-faq-chatbot-mount]');
    if (!mount) return;

    try {
      const response = await fetch('/faq-chatbot-widget.html');
      if (!response.ok) return;
      mount.innerHTML = await response.text();
      launcher = document.getElementById('faqChatLauncher');
    } catch (error) {
      return;
    }
  }

  const panel = document.getElementById('faqChatPanel');
  const closeButton = document.getElementById('faqChatClose');
  const form = document.getElementById('faqChatForm');
  const input = document.getElementById('faqChatInput');
  const messages = document.getElementById('faqChatMessages');

  if (!launcher || !panel || !closeButton || !form || !input || !messages) return;

  const answers = [
    {
      keywords: ['reschedule', 'rescheduling', 'change appointment', 'change my booking', 'move my appointment'],
      answer: 'To reschedule, contact the clinic at +63 945 611 9436 or info@skingoddess.ph with your appointment details and preferred new time.'
    },
    {
      keywords: ['cancel', 'cancellation', 'cancel appointment', 'cancel booking'],
      answer: 'Please contact the clinic at +63 945 611 9436 or info@skingoddess.ph to request a cancellation at least 24 hours in advance.'
    },
    {
      keywords: ['reservation fee', 'down payment', 'downpayment', 'deposit', 'reserve fee'],
      answer: 'The reservation fee depends on the service you choose. You can see the exact fee on the booking page and checkout before paying; payment is used to reserve your selected slot.'
    },
    {
      keywords: ['available appointment slots', 'available time slots', 'available slots', 'availability', 'slot', 'slots'],
      answer: 'Available times update on the booking page. Select a service and date under Book Now to see the current open slots.'
    },
    {
      keywords: ['book an appointment', 'how to book', 'book appointment', 'booking', 'appointment', 'book', 'reserve'],
      answer: 'Choose Book Now, select a service and available date and time, then enter your details and complete checkout to reserve your appointment.'
    },
    {
      keywords: ['clinic schedule', 'operating hours', 'business hours', 'schedule', 'hours', 'open', 'close', 'saturday', 'sunday'],
      answer: 'The clinic is open Monday to Saturday, 9:00 AM to 6:00 PM, and closed on Sundays.'
    },
    {
      keywords: ['service', 'services', 'treatment', 'treatments', 'facial', 'laser', 'skin', 'whitening', 'anti-aging', 'nail', 'lash', 'eyelash', 'ipl'],
      answer: 'We offer facial and skin treatments, laser and IPL services, anti-aging treatments, nail and lash services, and more. Visit Services to browse the available treatments.'
    },
    {
      keywords: ['price', 'prices', 'cost', 'how much', 'service fee', 'treatment fee'],
      answer: 'Prices vary by treatment and service option. Visit Services to review listed prices, or choose a service on the booking page to see its price and reservation fee.'
    },
    {
      keywords: ['where', 'location', 'address', 'directions', 'cavite', 'imus'],
      answer: 'We are at 2nd floor, KW Plaza Building, Pasong Buaya 2, Imus, Cavite, Philippines 4103.'
    },
    {
      keywords: ['contact', 'phone', 'call', 'email', 'reach'],
      answer: 'Call us at +63 945 611 9436 or email info@skingoddess.ph. We are open Monday to Saturday, 9:00 AM to 6:00 PM.'
    },
    {
      keywords: ['before treatment', 'prepare', 'preparation', 'before appointment', 'what to do before'],
      answer: 'Preparation depends on the treatment. Arrive with clean skin when possible, share any allergies or relevant medications with your provider, and follow any treatment-specific instructions from the clinic.'
    },
    {
      keywords: ['aftercare', 'after care', 'after treatment', 'recovery', 'what to do after'],
      answer: 'Aftercare depends on your treatment. Follow your provider’s instructions, use gentle care, protect treated skin from the sun, and contact the clinic if you have a concerning reaction.'
    },
    {
      keywords: ['login', 'log in', 'sign in', 'password', 'account', 'forgot'],
      answer: 'To reset your password, open the sign-in page and choose Forgot password? to request a reset link. Check your spam folder if it does not arrive.'
    }
  ];

  function appendMessage(text, sender) {
    const message = document.createElement('p');
    message.className = `faq-chat-message faq-chat-message--${sender}`;
    message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  }

  function findAnswer(question) {
    const normalized = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const words = new Set(normalized.split(/\s+/).filter(Boolean));
    let bestMatch = null;
    let bestScore = 0;

    answers.forEach((item) => {
      const score = item.keywords.reduce((best, keyword) => {
        const phrase = keyword.toLowerCase();
        const matchScore = phrase.includes(' ')
          ? (normalized.includes(phrase) ? phrase.split(' ').length : 0)
          : (words.has(phrase) ? 1 : 0);
        return Math.max(best, matchScore);
      }, 0);

      if (score > bestScore) {
        bestMatch = item;
        bestScore = score;
      }
    });

    return bestMatch?.answer || 'I could not find an exact match. Please call +63 945 611 9436 or email info@skingoddess.ph and our team can help.';
  }

  function closeChat() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) input.focus();
  });

  closeButton.addEventListener('click', closeChat);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closeChat();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    appendMessage(question, 'user');
    appendMessage(findAnswer(question), 'bot');
    input.value = '';
    input.focus();
  });
});