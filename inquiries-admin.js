document.addEventListener('DOMContentLoaded', () => {
  const listElement = document.getElementById('inquiryList');
  const detailElement = document.getElementById('inquiryDetail');
  const countElement = document.getElementById('inquiryCount');
  const searchInput = document.getElementById('inquirySearch');
  let inquiries = [];
  let selectedId = null;
  let activeFilter = 'all';

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatDate(value) {
    return new Date(value).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  function visibleInquiries() {
    const query = searchInput.value.trim().toLowerCase();
    return inquiries.filter((inquiry) => {
      const isReplied = Boolean(inquiry.replied_at);
      const matchesFilter = activeFilter === 'all'
        || (activeFilter === 'replied' && isReplied)
        || (activeFilter === 'unanswered' && !isReplied);
      const searchable = `${inquiry.first_name} ${inquiry.last_name} ${inquiry.email} ${inquiry.message}`.toLowerCase();
      return matchesFilter && searchable.includes(query);
    });
  }

  function renderList() {
    const visible = visibleInquiries();
    listElement.replaceChildren();
    countElement.textContent = `${visible.length} ${visible.length === 1 ? 'inquiry' : 'inquiries'}`;

    if (!visible.length) {
      listElement.append(makeElement('p', 'inquiries-list-empty', inquiries.length ? 'No inquiries match this filter.' : 'No inquiries have been received yet.'));
      return;
    }

    visible.forEach((inquiry) => {
      const button = makeElement('button', `inquiry-list-item${inquiry.inquiry_id === selectedId ? ' inquiry-list-item--selected' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(inquiry.inquiry_id === selectedId));
      button.addEventListener('click', () => {
        selectedId = inquiry.inquiry_id;
        renderList();
        renderDetail(inquiry);
      });

      const heading = makeElement('span', 'inquiry-list-heading');
      heading.append(makeElement('strong', '', `${inquiry.first_name} ${inquiry.last_name}`));
      heading.append(makeElement('time', '', formatDate(inquiry.created_at)));
      button.append(heading);
      button.append(makeElement('span', 'inquiry-list-email', inquiry.email));
      button.append(makeElement('span', 'inquiry-list-preview', inquiry.message));
      const footer = makeElement('span', 'inquiry-list-footer');
      footer.append(makeElement('span', 'inquiry-type', inquiry.inquiry_type));
      footer.append(makeElement('span', `inquiry-state${inquiry.replied_at ? ' inquiry-state--replied' : ''}`, inquiry.replied_at ? 'Replied' : 'Needs reply'));
      button.append(footer);
      listElement.append(button);
    });
  }

  function renderDetail(inquiry) {
    detailElement.replaceChildren();
    const header = makeElement('header', 'inquiry-detail-header');
    header.append(makeElement('p', 'inquiry-detail-eyebrow', `INQUIRY #${inquiry.inquiry_id} · ${inquiry.inquiry_type.toUpperCase()}`));
    header.append(makeElement('h2', '', `${inquiry.first_name} ${inquiry.last_name}`));
    header.append(makeElement('p', 'inquiry-detail-date', `Received ${formatDate(inquiry.created_at)}`));
    detailElement.append(header);

    const contact = makeElement('div', 'inquiry-contact');
    const emailLink = makeElement('a', '', inquiry.email);
    emailLink.href = `mailto:${inquiry.email}`;
    contact.append(emailLink);
    if (inquiry.phone) contact.append(makeElement('span', '', inquiry.phone));
    detailElement.append(contact);

    const messageSection = makeElement('section', 'inquiry-message-section');
    messageSection.append(makeElement('h3', '', 'Customer message'));
    messageSection.append(makeElement('p', 'inquiry-message-body', inquiry.message));
    detailElement.append(messageSection);

    if (inquiry.admin_reply) {
      const previousReply = makeElement('section', 'inquiry-previous-reply');
      previousReply.append(makeElement('h3', '', `Last reply · ${formatDate(inquiry.replied_at)}`));
      previousReply.append(makeElement('p', '', inquiry.admin_reply));
      detailElement.append(previousReply);
    }

    const form = makeElement('form', 'inquiry-reply-form');
    form.append(makeElement('label', '', 'Reply to customer'));
    const textarea = makeElement('textarea', 'inquiry-reply-input');
    textarea.name = 'reply';
    textarea.rows = 5;
    textarea.maxLength = 5000;
    textarea.required = true;
    textarea.placeholder = 'Write a helpful response...';
    textarea.value = inquiry.admin_reply || '';
    form.append(textarea);
    const actions = makeElement('div', 'inquiry-reply-actions');
    const status = makeElement('p', 'inquiry-reply-status');
    status.setAttribute('role', 'status');
    const submit = makeElement('button', 'um-btn um-btn--primary', 'Send reply');
    submit.type = 'submit';
    actions.append(status, submit);
    form.append(actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = 'Sending...';
      status.className = 'inquiry-reply-status';
      try {
        const response = await fetch(`/api/inquiries/${inquiry.inquiry_id}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reply: textarea.value }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Could not send reply.');
        status.textContent = data.message;
        status.classList.add('inquiry-reply-status--success');
        await loadInquiries(inquiry.inquiry_id);
      } catch (error) {
        status.textContent = error.message || 'Could not send reply.';
        status.classList.add('inquiry-reply-status--error');
      } finally {
        submit.disabled = false;
      }
    });
    detailElement.append(form);
  }

  async function loadInquiries(preferredId = selectedId) {
    listElement.replaceChildren(makeElement('p', 'inquiries-list-empty', 'Loading inquiries...'));
    try {
      const response = await fetch('/api/inquiries');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not load inquiries.');
      inquiries = data;
      selectedId = inquiries.some((inquiry) => inquiry.inquiry_id === preferredId)
        ? preferredId
        : (inquiries[0]?.inquiry_id ?? null);
      renderList();
      const selected = inquiries.find((inquiry) => inquiry.inquiry_id === selectedId);
      if (selected) renderDetail(selected);
      else detailElement.replaceChildren(makeElement('div', 'inquiry-detail-empty', 'Select an inquiry to read the message and reply.'));
    } catch (error) {
      listElement.replaceChildren(makeElement('p', 'inquiries-list-empty inquiries-list-empty--error', error.message || 'Could not load inquiries.'));
      countElement.textContent = 'Unable to load';
    }
  }

  document.querySelectorAll('.inquiry-filter').forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter;
      document.querySelectorAll('.inquiry-filter').forEach((filterButton) => {
        filterButton.classList.toggle('inquiry-filter--active', filterButton === button);
      });
      renderList();
    });
  });
  searchInput.addEventListener('input', renderList);
  document.getElementById('refreshInquiries').addEventListener('click', () => loadInquiries());
  loadInquiries();
});