document.addEventListener('DOMContentLoaded', () => {
  const launcher = document.getElementById('faqChatLauncher');
  const panel = document.getElementById('faqChatPanel');
  const closeButton = document.getElementById('faqChatClose');
  const form = document.getElementById('faqChatForm');
  const input = document.getElementById('faqChatInput');
  const messages = document.getElementById('faqChatMessages');

  if (!launcher || !panel || !closeButton || !form || !input || !messages) return;

  const answers = [
    {
      keywords: ['appointment', 'book', 'booking', 'schedule', 'reserve'],
      answer: 'You can book an appointment online from the Book Now button. Choose a service and an available time to get started.'
    },
    {
      keywords: ['hour', 'hours', 'open', 'close', 'time', 'saturday', 'sunday'],
      answer: 'The clinic is open Monday to Saturday, 9:00 AM to 6:00 PM.'
    },
    {
      keywords: ['where', 'location', 'address', 'directions', 'cavite', 'imus'],
      answer: 'We are at 2nd floor, KW Plaza Building, Pasong Buaya 2, Imus, Cavite, Philippines 4103.'
    },
    {
      keywords: ['contact', 'phone', 'call', 'email', 'reach'],
      answer: 'Call us at +63 945 611 9436 or email info@skingoddess.ph. Our hours are Monday to Saturday, 9:00 AM to 6:00 PM.'
    },
    {
      keywords: ['service', 'treatment', 'facial', 'laser', 'skin', 'whitening', 'anti-aging', 'nail', 'lash'],
      answer: 'We offer facials, skin brightening, anti-aging treatments, laser services, nail and lash services, and more. Visit Services to explore the treatments.'
    },
    {
      keywords: ['price', 'cost', 'how much', 'fee', 'payment', 'pay'],
      answer: 'Treatment prices vary by service. Please check the Services page for starting prices, or contact us at +63 945 611 9436 for details.'
    },
    {
      keywords: ['cancel', 'cancellation', 'reschedule', 'change appointment'],
      answer: 'For help changing or cancelling a booking, please contact the clinic at +63 945 611 9436 or info@skingoddess.ph.'
    },
    {
      keywords: ['login', 'log in', 'sign in', 'password', 'account', 'forgot'],
      answer: 'If you cannot sign in, use Forgot password? on this page to request a reset link. Check your spam folder if it does not arrive.'
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
    const normalized = question.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const words = new Set(normalized.split(/\s+/).filter(Boolean));
    let bestMatch = null;
    let bestScore = 0;

    answers.forEach((item) => {
      const score = item.keywords.reduce((total, keyword) => {
        const phrase = keyword.toLowerCase();
        return total + (phrase.includes(' ')
          ? (normalized.includes(phrase) ? 2 : 0)
          : (words.has(phrase) ? 1 : 0));
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