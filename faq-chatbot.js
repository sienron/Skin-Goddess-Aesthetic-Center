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
  const status = panel?.querySelector('.faq-chat-status');
  const sendButton = form?.querySelector('button[type="submit"]');
  const suggestions = panel?.querySelector('.faq-chat-suggestions');
  const chatHistoryKey = 'sg_faq_chat_history';
  const maxChatHistoryMessages = 100;

  if (!launcher || !panel || !closeButton || !form || !input || !messages || !status || !sendButton || !suggestions) return;

  const suggestionCatalog = [
    { id: 'services', label: 'Services & prices', question: 'What services and prices do you offer?' },
    { id: 'booking', label: 'Book appointment', question: 'How can I book an appointment?' },
    { id: 'availability', label: 'Available times', question: 'How do I check available appointment times?' },
    { id: 'hours', label: 'Clinic hours', question: 'What are your opening hours?' },
    { id: 'location', label: 'Clinic location', question: 'Where is the clinic located?' },
    { id: 'reschedule', label: 'Change appointment', question: 'How can I change or cancel an appointment?' },
    { id: 'preparation', label: 'Before a treatment', question: 'How should I prepare before a treatment?' },
    { id: 'aftercare', label: 'Treatment aftercare', question: 'What should I do after a treatment?' },
    { id: 'account', label: 'Account help', question: 'How can I reset my password?' },
    { id: 'contact', label: 'Contact the clinic', question: 'How can I contact the clinic?' },
  ];
  const suggestionsByContext = {
    general: ['services', 'booking', 'hours', 'location'],
    services: ['services', 'booking', 'availability', 'contact'],
    booking: ['availability', 'services', 'reschedule', 'hours'],
    availability: ['booking', 'hours', 'services', 'contact'],
    schedule: ['hours', 'availability', 'booking', 'location'],
    location: ['location', 'hours', 'contact', 'booking'],
    treatment: ['aftercare', 'preparation', 'services', 'contact'],
    preparation: ['preparation', 'aftercare', 'services', 'contact'],
    account: ['account', 'booking', 'reschedule', 'contact'],
    payment: ['services', 'booking', 'contact', 'availability'],
    contact: ['contact', 'location', 'hours', 'services'],
  };
  const selectedSuggestionIds = new Set();

  const pageLinks = [
    { phrases: ['my appointments', 'appointments page', 'appointment page', 'appointments'], href: '/MyAppointments.html' },
    { phrases: ['appointment booking', 'booking page', 'book an appointment', 'book now'], href: '/UserAppointment.html' },
    { phrases: ['account page', 'my account'], href: '/UserAccount.html' },
    { phrases: ['services page', 'services'], href: '/ServicesPage.html' },
    { phrases: ['contact us page', 'contact page', 'contact us'], href: '/ContactUsPage.html' },
    { phrases: ['about us page', 'about us'], href: '/AboutUsPage.html' },
    { phrases: ['sign in page', 'login page', 'sign in', 'log in'], href: '/LoginPage.html' },
  ].flatMap(({ phrases, href }) => phrases.map((phrase) => ({ phrase, href })))
    .sort((left, right) => right.phrase.length - left.phrase.length);
  const richTextPattern = new RegExp(
    `\\*\\*([^*\\n]+)\\*\\*|\\b(${pageLinks.map(({ phrase }) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi',
  );

  function createMessage(text, sender) {
    const message = document.createElement('p');
    message.className = `faq-chat-message faq-chat-message--${sender}`;
    if (sender === 'user') {
      message.textContent = text;
      return message;
    }

    let lastIndex = 0;
    for (const match of text.matchAll(richTextPattern)) {
      const matchedIndex = match.index;
      if (matchedIndex > lastIndex) {
        message.append(document.createTextNode(text.slice(lastIndex, matchedIndex)));
      }
      if (match[1]) {
        const strong = document.createElement('strong');
        strong.textContent = match[1];
        message.append(strong);
      } else {
        const matchedPhrase = match[2];
        const link = document.createElement('a');
        link.href = pageLinks.find(({ phrase }) => phrase.toLowerCase() === matchedPhrase.toLowerCase()).href;
        link.textContent = matchedPhrase;
        message.append(link);
      }
      lastIndex = matchedIndex + match[0].length;
    }
    message.append(document.createTextNode(text.slice(lastIndex)));
    return message;
  }

  function scrollToLatestMessage() {
    window.requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }

  function detectSuggestionContext() {
    const userMessages = messages.querySelectorAll('.faq-chat-message--user');
    const latestQuestion = userMessages[userMessages.length - 1]?.textContent || '';
    const text = latestQuestion.toLowerCase();

    if (/\b(cancel|cancell?ation|reschedul|change my appointment)\b/.test(text)) return 'booking';
    if (/\b(available|availability|time slots?|open slots?)\b/.test(text)) return 'availability';
    if (/\b(book|booking|appointment|reservation|reserve)\b/.test(text)) return 'booking';
    if (/\b(aftercare|after care|recovery|after treatment)\b/.test(text)) return 'treatment';
    if (/\b(before treatment|prepar(e|ation)|before appointment)\b/.test(text)) return 'preparation';
    if (/\b(service|services|treatment|price|prices|cost)\b/.test(text)) return 'services';
    if (/\b(hours?|schedule|open|closed|close)\b/.test(text)) return 'schedule';
    if (/\b(where|location|address|directions)\b/.test(text)) return 'location';
    if (/\b(password|login|log in|sign in|account)\b/.test(text)) return 'account';
    if (/\b(contact|phone|call|email|reach)\b/.test(text)) return 'contact';
    if (/\b(payment|deposit|reservation fee|down ?payment)\b/.test(text)) return 'payment';
    return 'general';
  }

  function renderSuggestions() {
    const suggestedIds = suggestionsByContext[detectSuggestionContext()];
    const fragment = document.createDocumentFragment();
    suggestionCatalog
      .filter(({ id }) => suggestedIds.includes(id) && !selectedSuggestionIds.has(id))
      .forEach(({ id, label, question }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.suggestionId = id;
        button.dataset.question = question;
        button.textContent = label;
        fragment.append(button);
      });
    suggestions.replaceChildren(fragment);
    suggestions.setAttribute('aria-label', 'Suggested questions');
  }

  function saveChatHistory() {
    const history = Array.from(messages.querySelectorAll('.faq-chat-message'))
      .map((message) => ({
        text: message.textContent || '',
        sender: message.classList.contains('faq-chat-message--user') ? 'user' : 'bot',
      }))
      .slice(-maxChatHistoryMessages);

    try {
      sessionStorage.setItem(chatHistoryKey, JSON.stringify(history));
    } catch (error) {
      console.warn('Could not save chatbot history:', error);
    }
  }

  function restoreChatHistory() {
    let history;
    try {
      history = JSON.parse(sessionStorage.getItem(chatHistoryKey) || '[]');
    } catch (error) {
      return;
    }

    if (!Array.isArray(history)) return;
    const validMessages = history
      .filter((message) => message && typeof message.text === 'string' && ['user', 'bot'].includes(message.sender))
      .slice(-maxChatHistoryMessages);
    if (!validMessages.length) return;

    messages.replaceChildren();
    validMessages.forEach(({ text, sender }) => messages.append(createMessage(text, sender)));
    const previousQuestions = new Set(
      validMessages
        .filter(({ sender }) => sender === 'user')
        .map(({ text }) => text.trim().toLowerCase()),
    );
    suggestionCatalog.forEach(({ id, question }) => {
      if (previousQuestions.has(question.toLowerCase())) selectedSuggestionIds.add(id);
    });
    scrollToLatestMessage();
  }

  function appendMessage(text, sender) {
    const message = createMessage(text, sender);
    messages.append(message);
    scrollToLatestMessage();
    saveChatHistory();
  }

  function showThinkingMessage() {
    const message = createMessage('Thinking...', 'bot');
    message.classList.add('faq-chat-message--thinking');
    message.setAttribute('role', 'status');
    messages.append(message);
    scrollToLatestMessage();
    return message;
  }

  restoreChatHistory();
  renderSuggestions();

  function closeChat() {
    panel.hidden = true;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  launcher.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) {
      scrollToLatestMessage();
      input.focus();
    }
  });

  closeButton.addEventListener('click', closeChat);
  suggestions.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-question][data-suggestion-id]');
    if (!button || !suggestions.contains(button)) return;
    selectedSuggestionIds.add(button.dataset.suggestionId);
    renderSuggestions();
    input.value = button.dataset.question;
    form.requestSubmit();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) closeChat();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    appendMessage(question, 'user');
    renderSuggestions();
    input.value = '';
    input.disabled = true;
    sendButton.disabled = true;
    const thinkingMessage = showThinkingMessage();

    try {
      const history = Array.from(messages.querySelectorAll('.faq-chat-message'))
        .filter((message) => !message.classList.contains('faq-chat-message--thinking'))
        .map((message) => ({
          role: message.classList.contains('faq-chat-message--user') ? 'user' : 'assistant',
          content: message.textContent || '',
        }))
        .filter((message) => message.content.trim())
        .slice(-12);
      const response = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'The AI assistant is temporarily unavailable. Please try again shortly.');
      }
      if (typeof result.answer !== 'string' || !result.answer.trim()) {
        throw new Error('The AI assistant returned an invalid response. Please try again.');
      }
      thinkingMessage.remove();
      appendMessage(result.answer.trim(), 'bot');
      renderSuggestions();
    } catch (error) {
      thinkingMessage.remove();
      appendMessage(
        error instanceof Error ? error.message : 'The AI assistant is temporarily unavailable. Please try again shortly.',
        'bot',
      );
      renderSuggestions();
    } finally {
      status.textContent = 'AI assistant';
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  });
});