// AdminAppointment.html page-specific JS
// Renders the appointments table with status tabs, search, and pagination.
// The mobile sidebar drawer is handled by admin-dashboard.js.
// Appointment data is loaded from the admin API and refreshed periodically.
// Filter / Export / New Appointment / View / Edit / Rebook remain separate actions.

document.addEventListener('DOMContentLoaded', () => {
  const tbody = document.getElementById('aptTableBody');
  const tabsWrap = document.getElementById('aptTabs');
  const footerText = document.getElementById('aptFooterText');
  const pagination = document.getElementById('aptPagination');
  const searchInput = document.getElementById('aptSearchInput');
  const todayChip = document.getElementById('aptTodayChip');
  const dateRangeSelect = document.getElementById('aptDateRange');

  if (!tbody || !tabsWrap || !footerText || !pagination) return;

  const PAGE_SIZE = 7;

  const STATUS_LABELS = {
    'pending': 'PENDING',
    'confirmed': 'CONFIRMED',
    'in-progress': 'IN PROGRESS',
    'completed': 'COMPLETED',
    'cancelled': 'CANCELLED',
    'no-show': 'NO SHOW'
  };

  let APPOINTMENTS = [];
  let isLoading = true;
  let loadError = '';
  let appointmentLoadPromise = null;

  function manilaDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year + '-' + values.month + '-' + values.day;
  }

  function displayDate(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    if (!year || !month || !day) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  function displayTime(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return 'Time unavailable';
    const hour = Number(match[1]);
    return (hour % 12 || 12) + ':' + match[2] + ' ' + (hour >= 12 ? 'PM' : 'AM');
  }

  function clientAge(dateOfBirth) {
    if (!dateOfBirth) return '';
    const [birthYear, birthMonth, birthDay] = dateOfBirth.slice(0, 10).split('-').map(Number);
    if (!birthYear || !birthMonth || !birthDay) return '';
    const [year, month, day] = manilaDateKey().split('-').map(Number);
    let age = year - birthYear;
    if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
    return age >= 0 ? String(age) : '';
  }

  function normalizeAppointment(record) {
    const id = String(record.appointment_id ?? record.id ?? '');
    const dateKey = String(record.date ?? record.appointment_date ?? '').slice(0, 10);
    const gender = String(record.gender || '').trim();
    const genderLabel = gender.toLowerCase() === 'female' ? 'F'
      : gender.toLowerCase() === 'male' ? 'M' : gender;
    const age = clientAge(record.date_of_birth || record.dob || '');
    const previousCount = Number(record.previous_appointment_count) || 0;
    const profileParts = [genderLabel, age].filter(Boolean);
    const profile = [profileParts.join(', '), previousCount ? 'Returning' : 'New Patient'].filter(Boolean).join(' · ');

    return {
      id,
      ref: 'APT-' + id.padStart(4, '0'),
      client: String(record.client || `${record.first_name || ''} ${record.last_name || ''}`.trim() || 'Client'),
      profile,
      service: String(record.service || record.service_name || 'Service unavailable'),
      serviceId: String(record.service_id || ''),
      staffId: String(record.assigned_staff_id || ''),
      duration: (Number(record.duration_minutes) || 0) + ' min',
      dateKey,
      date: displayDate(dateKey),
      time: displayTime(record.start || record.appointment_time),
      assignedTo: String(record.assigned_to || record.aesthetician || 'Unassigned'),
      status: String(record.status || record.appointment_status || '').toLowerCase().replace(/_/g, '-'),
      isToday: dateKey === manilaDateKey(),
      fee: Number(record.fee ?? record.booked_service_price) || 0,
      depositAmount: Number(record.deposit_amount ?? record.depositAmount ?? record.booked_reservation_fee) || 0,
      paymentStatus: String(record.payment_status || 'unpaid').toLowerCase(),
      contact: String(record.contact || record.contact_number || '—'),
      cancellationRequestStatus: record.cancellation_request_status || null,
      cancellationReason: record.cancellation_reason || '',
      cancellationDescription: record.cancellation_description || '',
      inventoryDeductionConfirmedAt: record.inventory_deduction_confirmed_at || null
    };
  }

  const state = { status: 'all', todayOnly: false, month: manilaDateKey().slice(0, 7), query: '', page: 1 };

  // ---------- helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function readApiResponse(response) {
    const bodyText = await response.text();
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch (error) {
      return { message: response.status === 401 || response.status === 403 ? 'Your admin session is no longer valid. Please sign in again.' : `Request failed (${response.status}).` };
    }
  }

  function getInitials(name) {
    return name.split(' ').slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
  }

  function stackCell(main, sub, mainClass) {
    const td = el('td');
    td.appendChild(el('span', mainClass || '', main));
    td.appendChild(el('span', 'apt-sub', sub));
    return td;
  }

  function getFiltered() {
    const query = state.query.trim().toLowerCase();
    return APPOINTMENTS.filter((a) => {
      if (state.status !== 'all' && a.status !== state.status) return false;
      if (a.dateKey.slice(0, 7) !== state.month) return false;
      if (state.todayOnly && !a.isToday) return false;
      if (!query) return true;
      return [a.ref, a.client, a.service, a.assignedTo].some((v) => v.toLowerCase().includes(query));
    });
  }

  const detailsModal = document.getElementById('appointmentDetailsModal');
  const editModal = document.getElementById('appointmentEditModal');
  const productsModal = document.getElementById('appointmentProductsModal');
  const productConfirmDialog = document.getElementById('appointmentProductsConfirmDialog');
  const appointmentAlertOverlay = document.getElementById('appointmentAlertOverlay');
  const appointmentAlertTitle = document.getElementById('appointmentAlertTitle');
  const appointmentAlertMessage = document.getElementById('appointmentAlertMessage');
  const appointmentAlertOk = document.getElementById('appointmentAlertOk');
  let selectedAppointment = null;

  function showAppointmentAlert(message, options = {}) {
    if (!appointmentAlertOverlay || !appointmentAlertMessage || !appointmentAlertTitle || !appointmentAlertOk) {
      window.alert(message);
      return;
    }
    const { title = 'Appointment Updated', tone = 'success' } = options;
    appointmentAlertTitle.textContent = title;
    appointmentAlertMessage.textContent = message;
    appointmentAlertOverlay.classList.toggle('apt-alert-overlay--error', tone === 'error');
    appointmentAlertOverlay.hidden = false;
    appointmentAlertOk.focus();
  }

  function hideAppointmentAlert() {
    if (!appointmentAlertOverlay) return;
    appointmentAlertOverlay.hidden = true;
    appointmentAlertOverlay.classList.remove('apt-alert-overlay--error');
  }

  appointmentAlertOk?.addEventListener('click', hideAppointmentAlert);
  appointmentAlertOverlay?.addEventListener('click', (event) => {
    if (event.target === appointmentAlertOverlay) hideAppointmentAlert();
  });

  let editingAppointment = null;
  let editStaffRequestId = 0;
  let productReview = null;
  let productSelection = new Map();
  let productSearchTerm = '';
  let draftSaveTimer = null;

  function setAppointmentModalOpen(modal, isOpen) {
    modal?.classList.toggle('apt-modal-overlay--open', isOpen);
    document.body.classList.toggle('modal-open', Boolean(
      detailsModal?.classList.contains('apt-modal-overlay--open')
      || editModal?.classList.contains('apt-modal-overlay--open')
      || productsModal?.classList.contains('apt-modal-overlay--open')
    ));
  }

  function openAppointmentDetails(appointment) {
    selectedAppointment = appointment;
    document.getElementById('appointmentDetailsSubtitle').textContent = appointment.ref;
    document.getElementById('appointmentDetailsReference').textContent = appointment.ref;
    document.getElementById('appointmentDetailsClient').textContent = appointment.client;
    document.getElementById('appointmentDetailsService').textContent = appointment.service;
    document.getElementById('appointmentDetailsDate').textContent = `${appointment.date} · ${appointment.time}`;
    document.getElementById('appointmentDetailsStaff').textContent = appointment.assignedTo;
    document.getElementById('appointmentDetailsStatus').textContent = STATUS_LABELS[appointment.status] || appointment.status.toUpperCase();
    const message = document.getElementById('appointmentDetailsMessage');
    const reviewButton = document.getElementById('appointmentProductsReviewBtn');
    reviewButton.hidden = appointment.status !== 'in-progress';
    if (appointment.status === 'in-progress') {
      message.textContent = 'This appointment is In Progress. Review and confirm products used to deduct inventory and complete it.';
      message.classList.remove('appointment-inventory-message--error');
    } else if (appointment.inventoryDeductionConfirmedAt) {
      message.textContent = `Inventory was deducted and confirmed at ${new Date(appointment.inventoryDeductionConfirmedAt).toLocaleString()}.`;
      message.classList.remove('appointment-inventory-message--error');
    } else if (appointment.status === 'completed') {
      message.textContent = 'This appointment was completed before the product-review workflow was enabled. It cannot be deducted again through this workflow.';
      message.classList.add('appointment-inventory-message--error');
    } else {
      message.textContent = 'Product review is available only after the assigned staff member starts the service.';
      message.classList.remove('appointment-inventory-message--error');
    }
    setAppointmentModalOpen(detailsModal, true);
  }

  async function loadEditServices(selectedServiceId) {
    const serviceSelect = document.getElementById('appointmentEditService');
    const response = await fetch('/api/services', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const services = await readApiResponse(response);
    if (!response.ok) throw new Error(services.message || services.error || 'Could not load services.');
    if (!Array.isArray(services)) throw new Error('The services response was invalid.');

    serviceSelect.replaceChildren(el('option', '', 'Choose a service'));
    services.forEach((service) => {
      const option = el('option', '', `${service.service_name} (${service.duration_minutes} min)`);
      option.value = String(service.service_id);
      serviceSelect.appendChild(option);
    });
    if (selectedServiceId && !services.some((service) => String(service.service_id) === selectedServiceId)) {
      const currentService = el('option', '', 'Current service (unavailable)');
      currentService.value = selectedServiceId;
      serviceSelect.appendChild(currentService);
    }
    serviceSelect.value = selectedServiceId;
  }

  async function updateEditStaff(preferredStaffId = '') {
    const requestId = ++editStaffRequestId;
    const serviceSelect = document.getElementById('appointmentEditService');
    const dateInput = document.getElementById('appointmentEditDate');
    const timeSelect = document.getElementById('appointmentEditTime');
    const staffSelect = document.getElementById('appointmentEditStaff');
    const message = document.getElementById('appointmentEditMessage');
    const serviceId = serviceSelect.value;
    const date = dateInput.value;
    const time = timeSelect.value;
    staffSelect.replaceChildren(el('option', '', 'Choose a service, date, and time first'));
    staffSelect.disabled = true;

    if (!editingAppointment || !serviceId || !date || !time) return;
    staffSelect.replaceChildren(el('option', '', 'Loading available staff…'));
    message.textContent = 'Checking qualified staff availability…';
    message.classList.remove('appointment-inventory-message--error');
    try {
      const params = new URLSearchParams({
        serviceId,
        date,
        time,
        appointmentId: editingAppointment.id
      });
      const response = await fetch(`/api/appointments/admin/walk-in-options?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const staff = await readApiResponse(response);
      if (requestId !== editStaffRequestId) return;
      if (!response.ok) throw new Error(staff.message || 'Could not check staff availability.');
      if (!Array.isArray(staff)) throw new Error('The available staff response was invalid.');

      staffSelect.replaceChildren(el('option', '', staff.length ? 'Choose available staff' : 'No staff available for this slot'));
      staff.forEach((person) => {
        const roleLabel = person.role === 'nail_tech' ? 'Nail Tech' : 'Aesthetician';
        const option = el('option', '', `${person.full_name || 'Staff member'} — ${roleLabel}`);
        option.value = String(person.user_id);
        staffSelect.appendChild(option);
      });
      const isOriginalSchedule = serviceId === editingAppointment.serviceId
        && date === editingAppointment.dateKey
        && time === editingAppointment.time;
      if (isOriginalSchedule && preferredStaffId
        && !staff.some((person) => String(person.user_id) === preferredStaffId)) {
        const currentStaff = el('option', '', editingAppointment.assignedTo);
        currentStaff.value = preferredStaffId;
        staffSelect.appendChild(currentStaff);
      }
      staffSelect.disabled = staff.length === 0;
      if (staff.some((person) => String(person.user_id) === preferredStaffId)
        || (isOriginalSchedule && preferredStaffId)) {
        staffSelect.value = preferredStaffId;
      }
      message.textContent = staff.length
        ? 'Only qualified staff available for this service and time are listed.'
        : 'No qualified staff are available for this time. Choose another date or time.';
      message.classList.toggle('appointment-inventory-message--error', staff.length === 0);
    } catch (error) {
      if (requestId !== editStaffRequestId) return;
      staffSelect.replaceChildren(el('option', '', 'Current staff (availability could not be checked)'));
      if (preferredStaffId) {
        staffSelect.options[0].value = preferredStaffId;
        staffSelect.value = preferredStaffId;
        staffSelect.disabled = false;
      }
      message.textContent = error.message || 'Could not check staff availability.';
      message.classList.add('appointment-inventory-message--error');
    }
  }

  async function openAppointmentEdit(appointment, rebook = false) {
    editStaffRequestId += 1;
    editingAppointment = appointment;
    const dateInput = document.getElementById('appointmentEditDate');
    const timeSelect = document.getElementById('appointmentEditTime');
    const serviceSelect = document.getElementById('appointmentEditService');
    const staffSelect = document.getElementById('appointmentEditStaff');
    const statusSelect = document.getElementById('appointmentEditStatus');
    const statusField = statusSelect.closest('.appointment-edit-fields__status');
    const serviceField = serviceSelect.closest('.form-group');
    const message = document.getElementById('appointmentEditMessage');
    const saveButton = document.getElementById('appointmentEditSave');
    document.getElementById('appointmentEditTitle').textContent = rebook ? 'Rebook Appointment' : 'Edit Appointment';
    saveButton.textContent = rebook ? 'Create Rebooked Appointment' : 'Save Changes';
    document.getElementById('appointmentEditSubtitle').textContent = appointment.ref;
    document.getElementById('appointmentEditReference').textContent = appointment.ref;
    document.getElementById('appointmentEditClient').textContent = appointment.client;
    document.getElementById('appointmentEditServiceSummary').textContent = appointment.service;
    dateInput.value = rebook ? '' : appointment.dateKey;
    timeSelect.value = rebook ? '' : appointment.time;
    statusSelect.value = rebook ? 'confirmed' : appointment.status;
    statusSelect.querySelector('option[value="completed"]').disabled = true;
    statusField.hidden = rebook;
    serviceField.hidden = rebook;
    document.getElementById('appointmentRebookNotice').hidden = !rebook;
    if (rebook) {
      const [year, month, day] = manilaDateKey().split('-').map(Number);
      dateInput.min = manilaDateKey();
      dateInput.max = new Date(Date.UTC(year, month - 1, day + 60)).toISOString().slice(0, 10);
    } else {
      dateInput.removeAttribute('min');
      dateInput.removeAttribute('max');
    }
    const needsCompletionHint = appointment.status === 'in-progress';
    statusField.classList.toggle('appointment-edit-fields__status--completion-hint', needsCompletionHint);
    if (needsCompletionHint) {
      statusSelect.setAttribute('aria-describedby', 'appointmentEditCompletionHint');
    } else {
      statusSelect.removeAttribute('aria-describedby');
    }
    message.textContent = '';
    message.classList.remove('appointment-inventory-message--error');
    saveButton.disabled = true;
    serviceSelect.replaceChildren(el('option', '', 'Loading services…'));
    staffSelect.replaceChildren(el('option', '', 'Choose a service, date, and time first'));
    staffSelect.disabled = true;
    [dateInput, timeSelect, serviceSelect].forEach((field) => { field.disabled = true; });
    setAppointmentModalOpen(editModal, true);

    const isInProgress = appointment.status === 'in-progress';
    if (rebook) {
      message.textContent = 'Choose a new date and time. Staff availability will be checked again when you confirm.';
    } else if (isInProgress) {
      message.textContent = 'Schedule, service, and staff cannot be changed while this appointment is In Progress.';
    }

    try {
      await loadEditServices(appointment.serviceId);
      if (rebook) {
        serviceSelect.value = appointment.serviceId;
        serviceSelect.disabled = true;
        dateInput.disabled = false;
        timeSelect.disabled = false;
        saveButton.disabled = false;
      } else if (isInProgress) {
        serviceSelect.disabled = true;
        staffSelect.replaceChildren(el('option', '', appointment.assignedTo));
        staffSelect.options[0].value = appointment.staffId;
        staffSelect.value = appointment.staffId;
        staffSelect.disabled = true;
      } else {
        [dateInput, timeSelect, serviceSelect].forEach((field) => { field.disabled = false; });
        await updateEditStaff(appointment.staffId);
      }
      saveButton.disabled = false;
    } catch (error) {
      message.textContent = error.message || 'Could not prepare the appointment editor.';
      message.classList.add('appointment-inventory-message--error');
    }
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    const result = await readApiResponse(response);
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
    return result;
  }

  function selectedProductItems() {
    return [...productSelection.entries()].map(([productId, selection]) => ({
      productId,
      quantity: selection.quantity === '' || selection.quantity === null ? null : Number(selection.quantity),
      isSuggested: Boolean(selection.isSuggested),
      suggestionDefaultQuantity: selection.suggestionDefaultQuantity ?? null
    }));
  }

  function getProductSelectionProblem() {
    for (const product of productReview?.products || []) {
      const selection = productSelection.get(Number(product.product_id));
      if (!selection) continue;
      if (Number(product.stock_quantity) <= 0) {
        return `${product.product_name} is out of stock and cannot be selected.`;
      }
      if (!Number.isSafeInteger(Number(selection.quantity)) || selection.quantity === '' || Number(selection.quantity) < 1) {
        return `Enter a positive whole-number quantity for ${product.product_name}.`;
      }
      if (Number(selection.quantity) > Number(product.stock_quantity)) {
        return `${product.product_name} has only ${product.stock_quantity} units available.`;
      }
    }
    return '';
  }

  async function saveProductReviewDraft(showSavedMessage = false, reviewed = false) {
    if (!selectedAppointment || !productReview) return;
    const selectedItems = selectedProductItems();
    await requestJson(`/api/appointments/admin/${selectedAppointment.id}/inventory-review-draft`, {
      method: 'PUT',
      body: JSON.stringify({ selectedItems, reviewed })
    });
    if (showSavedMessage) {
      document.getElementById('appointmentProductsMessage').textContent = 'Your selection has been saved as a draft. No stock has been changed.';
    }
  }

  function scheduleProductDraftSave() {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(async () => {
      try {
        await saveProductReviewDraft();
      } catch (error) {
        document.getElementById('appointmentProductsMessage').textContent = `Draft could not be saved: ${error.message}`;
        document.getElementById('appointmentProductsMessage').classList.add('appointment-inventory-message--error');
      }
    }, 300);
  }

  function updateProductSelectionStatus() {
    const message = document.getElementById('appointmentProductsMessage');
    const issue = getProductSelectionProblem();
    message.textContent = issue || '';
    message.classList.toggle('appointment-inventory-message--error', Boolean(issue));
    document.getElementById('appointmentProductsReview').disabled = Boolean(issue);
  }

  function renderProductSelection() {
    if (!productReview) return;
    document.getElementById('appointmentProductsMappingNotice').textContent = productReview.mappingConfigured
      ? ''
      : 'No verified product mapping is configured for this procedure. Admins should confirm the products and quantities in Content Management. You may still complete the appointment without deducting inventory.';
    const query = productSearchTerm.trim().toLowerCase();
    const matchesSearch = (product) => (
      !query || `${product.product_name} ${product.category}`.toLowerCase().includes(query)
    );
    const selectedProducts = productReview.products.filter((product) => (
      productSelection.has(Number(product.product_id)) && matchesSearch(product)
    ));
    const otherProducts = productReview.products.filter((product) => (
      !productSelection.has(Number(product.product_id)) && matchesSearch(product)
    ));
    const hasConfiguredSuggestions = productReview.products.some((product) => product.is_suggested);

    function renderProductList(list, products, emptyMessage) {
      list.textContent = '';
      if (!products.length) {
        list.appendChild(el('p', 'cm-empty', emptyMessage));
        return;
      }
      products.forEach((product) => {
        const productId = Number(product.product_id);
        const selection = productSelection.get(productId);
        const row = el('article', 'appointment-product-row');
        const checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = Boolean(selection);
        checkbox.disabled = Number(product.stock_quantity) <= 0 && !selection;
        checkbox.setAttribute('aria-label', `Select ${product.product_name}`);
        const details = el('div', 'appointment-product-row__details');
        details.appendChild(el('strong', '', product.product_name));
        details.appendChild(el('span', '', Number(product.stock_quantity) <= 0
          ? `${product.category} · Out of stock`
          : `${product.category} · Current stock: ${product.stock_quantity}`));
        if (!product.is_suggested && selection) {
          details.appendChild(el('span', 'appointment-product-tag appointment-product-tag--manual', 'Manually added'));
        }
        const quantityLabel = el('label', 'appointment-product-row__quantity', 'Quantity to deduct');
        const quantityInput = el('input');
        quantityInput.type = 'number';
        quantityInput.min = '1';
        quantityInput.step = '1';
        quantityInput.value = selection?.quantity ?? '';
        quantityInput.disabled = !selection;
        quantityInput.setAttribute('aria-label', `Quantity to deduct for ${product.product_name}`);
        quantityLabel.appendChild(quantityInput);
        row.append(checkbox, details, quantityLabel);
        list.appendChild(row);

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            productSelection.set(productId, {
              quantity: product.is_suggested && product.default_quantity != null
                ? Number(product.default_quantity)
                : '',
              isSuggested: Boolean(product.is_suggested),
              suggestionDefaultQuantity: product.is_suggested && product.default_quantity != null
                ? Number(product.default_quantity)
                : null
            });
          } else {
            productSelection.delete(productId);
          }
          renderProductSelection();
          scheduleProductDraftSave();
        });
        quantityInput.addEventListener('input', () => {
          const current = productSelection.get(productId);
          if (!current) return;
          current.quantity = quantityInput.value;
          updateProductSelectionStatus();
          scheduleProductDraftSave();
        });
      });
    }

    renderProductList(
      document.getElementById('appointmentProductsSelectedList'),
      selectedProducts,
      query ? 'No selected products match your search.'
        : hasConfiguredSuggestions ? 'No products selected yet.'
          : 'No configured suggestions for this service. Select products manually.'
    );
    renderProductList(
      document.getElementById('appointmentProductsOtherList'),
      otherProducts,
      query ? 'No other products match your search.' : 'No other inventory products.'
    );
    updateProductSelectionStatus();
  }

  function showProductReviewStep() {
    const reviewList = document.getElementById('appointmentProductsReviewList');
    reviewList.textContent = '';
    const selected = selectedProductItems();
    if (!selected.length) {
      reviewList.appendChild(el('li', '', 'No products selected. The appointment will be completed without changing inventory.'));
    } else {
      selected.forEach((item) => {
        const product = productReview.products.find((entry) => Number(entry.product_id) === item.productId);
        reviewList.appendChild(el('li', '', `${product?.product_name || 'Inventory product'} — ${item.quantity} unit(s)${item.isSuggested ? ' (suggested)' : ' (manually added)'}`));
      });
    }
    document.querySelectorAll('.appointment-products-section').forEach((section) => { section.hidden = true; });
    document.getElementById('appointmentProductsLists').hidden = true;
    document.querySelector('.appointment-products-toolbar').hidden = true;
    document.querySelector('.appointment-inventory-note').hidden = true;
    document.getElementById('appointmentProductsReviewStep').hidden = false;
    document.getElementById('appointmentProductsReview').hidden = true;
    document.getElementById('appointmentProductsBack').hidden = false;
    document.getElementById('appointmentProductsConfirm').hidden = false;
  }

  function showProductEditorStep() {
    document.querySelectorAll('.appointment-products-section').forEach((section) => { section.hidden = false; });
    document.getElementById('appointmentProductsLists').hidden = false;
    document.querySelector('.appointment-products-toolbar').hidden = false;
    document.querySelector('.appointment-inventory-note').hidden = false;
    document.getElementById('appointmentProductsReviewStep').hidden = true;
    document.getElementById('appointmentProductsReview').hidden = false;
    document.getElementById('appointmentProductsBack').hidden = true;
    document.getElementById('appointmentProductsConfirm').hidden = true;
  }

  async function loadProductReview() {
    if (!selectedAppointment || selectedAppointment.status !== 'in-progress') return;
    const result = await requestJson(`/api/appointments/admin/${selectedAppointment.id}/inventory-review`);
    productReview = result;
    productSelection = new Map();
    result.products.forEach((product) => {
      if (product.is_selected) {
        productSelection.set(Number(product.product_id), {
          quantity: product.selected_quantity ?? '',
          isSuggested: Boolean(product.is_suggested),
          suggestionDefaultQuantity: product.is_suggested && product.default_quantity != null
            ? Number(product.default_quantity)
            : null
        });
      }
    });
    return result;
  }

  async function openProductReview() {
    if (!selectedAppointment || selectedAppointment.status !== 'in-progress') return;
    try {
      const result = await loadProductReview();
      productSearchTerm = '';
      document.getElementById('appointmentProductsSearch').value = '';
      document.getElementById('appointmentProductsSubtitle').textContent = `${result.appointment.client} · ${result.appointment.service}`;
      const message = document.getElementById('appointmentProductsMessage');
      message.textContent = '';
      message.classList.remove('appointment-inventory-message--error');
      showProductEditorStep();
      renderProductSelection();
      if (result.removedUnavailableSelection) {
        message.textContent = 'Previously selected out-of-stock products were removed. Review the updated selection before confirming.';
      }
      setAppointmentModalOpen(productsModal, true);
    } catch (error) {
      document.getElementById('appointmentDetailsMessage').textContent = error.message;
      document.getElementById('appointmentDetailsMessage').classList.add('appointment-inventory-message--error');
    }
  }

  async function closeProductReview() {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    try {
      await saveProductReviewDraft();
      document.getElementById('appointmentProductsMessage').classList.remove('appointment-inventory-message--error');
    } catch (error) {
      document.getElementById('appointmentDetailsMessage').textContent = `Product selections may not be saved: ${error.message}`;
      document.getElementById('appointmentDetailsMessage').classList.add('appointment-inventory-message--error');
    }
    setAppointmentModalOpen(productsModal, false);
  }

  tbody.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-action="view"]');
    const editButton = event.target.closest('[data-action="edit"]');
    const rebookButton = event.target.closest('[data-action="rebook"]');
    const target = viewButton || editButton || rebookButton;
    if (!target) return;
    const appointment = APPOINTMENTS.find((item) => item.ref === target.dataset.ref);
    if (!appointment) return;
    if (viewButton) openAppointmentDetails(appointment);
    else openAppointmentEdit(appointment, Boolean(rebookButton));
  });

  document.getElementById('appointmentDetailsClose').addEventListener('click', () => {
    setAppointmentModalOpen(detailsModal, false);
  });
  document.getElementById('appointmentDetailsDone').addEventListener('click', () => {
    setAppointmentModalOpen(detailsModal, false);
  });
  detailsModal.addEventListener('click', (event) => {
    if (event.target === detailsModal) setAppointmentModalOpen(detailsModal, false);
  });
  const appointmentEditForm = document.getElementById('appointmentEditForm');
  const appointmentEditDate = document.getElementById('appointmentEditDate');
  const appointmentEditTime = document.getElementById('appointmentEditTime');
  const appointmentEditService = document.getElementById('appointmentEditService');
  const appointmentEditStaff = document.getElementById('appointmentEditStaff');
  const appointmentEditStatus = document.getElementById('appointmentEditStatus');
  const appointmentEditMessage = document.getElementById('appointmentEditMessage');
  const appointmentEditSave = document.getElementById('appointmentEditSave');

  [appointmentEditService, appointmentEditDate, appointmentEditTime].forEach((field) => {
    field.addEventListener('change', () => updateEditStaff(editingAppointment?.staffId || ''));
  });
  document.getElementById('appointmentEditClose').addEventListener('click', () => {
    editStaffRequestId += 1;
    setAppointmentModalOpen(editModal, false);
  });
  document.getElementById('appointmentEditCancel').addEventListener('click', () => {
    editStaffRequestId += 1;
    setAppointmentModalOpen(editModal, false);
  });
  editModal.addEventListener('click', (event) => {
    if (event.target === editModal) {
      editStaffRequestId += 1;
      setAppointmentModalOpen(editModal, false);
    }
  });
  appointmentEditForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingAppointment || !appointmentEditForm.reportValidity()) return;
    const rebooking = document.getElementById('appointmentRebookNotice').hidden === false;
    const scheduleFieldsChanged = appointmentEditDate.value !== editingAppointment.dateKey
      || appointmentEditTime.value !== editingAppointment.time
      || appointmentEditService.value !== editingAppointment.serviceId;
    const staffId = appointmentEditStaff.value || (!scheduleFieldsChanged ? editingAppointment.staffId : '');
    const scheduleChanged = scheduleFieldsChanged || staffId !== editingAppointment.staffId;
    const statusChanged = appointmentEditStatus.value !== editingAppointment.status;
    if (!scheduleChanged && !statusChanged) {
      appointmentEditMessage.textContent = 'There are no changes to save.';
      appointmentEditMessage.classList.remove('appointment-inventory-message--error');
      return;
    }

    appointmentEditSave.disabled = true;
    appointmentEditMessage.textContent = 'Saving appointment…';
    appointmentEditMessage.classList.remove('appointment-inventory-message--error');
    try {
      if (rebooking) {
        if (!staffId) throw new Error('Choose an available staff member.');
        const result = await requestJson(`/api/appointments/admin/${editingAppointment.id}/rebook`, {
          method: 'POST',
          body: JSON.stringify({
            date: appointmentEditDate.value,
            time: appointmentEditTime.value,
            staffId
          })
        });
        await loadAppointments();
        const newId = String(result.appointment.appointment_id);
        const created = APPOINTMENTS.find((item) => item.id === newId);
        if (created) {
          state.status = 'all';
          state.todayOnly = false;
          state.query = '';
          state.month = created.dateKey.slice(0, 7);
          state.page = Math.max(1, Math.ceil((getFiltered().findIndex((item) => item.id === newId) + 1) / PAGE_SIZE));
          if (searchInput) searchInput.value = '';
          render();
        }
        setAppointmentModalOpen(editModal, false);
        return;
      } else if (appointmentEditStatus.value === 'cancelled') {
        if (scheduleChanged) {
          throw new Error('Save schedule, service, or staff changes before cancelling the appointment.');
        }
        await requestJson(`/api/appointments/${editingAppointment.id}/cancel`, { method: 'POST' });
      } else {
        if (!staffId) throw new Error('Choose an available staff member.');
        await requestJson(`/api/appointments/admin/${editingAppointment.id}/edit`, {
          method: 'PUT',
          body: JSON.stringify({
            date: appointmentEditDate.value,
            time: appointmentEditTime.value,
            serviceId: appointmentEditService.value,
            staffId,
            status: appointmentEditStatus.value
          })
        });
      }
      await loadAppointments();
      setAppointmentModalOpen(editModal, false);
    } catch (error) {
      appointmentEditMessage.textContent = error.message || 'Could not update the appointment.';
      appointmentEditMessage.classList.add('appointment-inventory-message--error');
    } finally {
      appointmentEditSave.disabled = false;
    }
  });
  document.getElementById('appointmentProductsReviewBtn').addEventListener('click', openProductReview);
  document.getElementById('appointmentProductsClose').addEventListener('click', closeProductReview);
  document.getElementById('appointmentProductsCancel').addEventListener('click', closeProductReview);
  productsModal.addEventListener('click', (event) => {
    if (event.target === productsModal) closeProductReview();
  });
  document.getElementById('appointmentProductsSearch').addEventListener('input', (event) => {
    productSearchTerm = event.target.value;
    renderProductSelection();
  });
  document.getElementById('appointmentProductsReview').addEventListener('click', async () => {
    const issue = getProductSelectionProblem();
    if (issue) {
      updateProductSelectionStatus();
      return;
    }
    const button = document.getElementById('appointmentProductsReview');
    button.disabled = true;
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    try {
      await saveProductReviewDraft(false, false);
      showProductReviewStep();
    } catch (error) {
      document.getElementById('appointmentProductsMessage').textContent = error.message;
      document.getElementById('appointmentProductsMessage').classList.add('appointment-inventory-message--error');
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('appointmentProductsBack').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await saveProductReviewDraft();
      showProductEditorStep();
    } catch (error) {
      document.getElementById('appointmentProductsMessage').textContent = error.message;
      document.getElementById('appointmentProductsMessage').classList.add('appointment-inventory-message--error');
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('appointmentProductsConfirm').addEventListener('click', () => {
    const issue = getProductSelectionProblem();
    if (issue) {
      document.getElementById('appointmentProductsMessage').textContent = issue;
      document.getElementById('appointmentProductsMessage').classList.add('appointment-inventory-message--error');
      showProductEditorStep();
      return;
    }
    const selectedItems = selectedProductItems();
    const confirmationMessage = document.getElementById('appointmentProductsConfirmMessage');
    const confirmationList = document.getElementById('appointmentProductsConfirmList');
    confirmationMessage.textContent = selectedItems.length
      ? 'Deduct the following products from inventory and mark this appointment as completed?'
      : 'No products are selected. Complete this appointment without changing inventory?';
    confirmationList.textContent = '';
    confirmationList.hidden = !selectedItems.length;
    selectedItems.forEach((item) => {
      const product = productReview.products.find((entry) => Number(entry.product_id) === item.productId);
      confirmationList.appendChild(el('li', '', `${product?.product_name || 'Inventory product'} — ${item.quantity} unit(s)`));
    });
    productConfirmDialog.showModal();
    document.getElementById('appointmentProductsConfirmCancel').focus();
  });
  document.getElementById('appointmentProductsConfirmCancel').addEventListener('click', () => {
    productConfirmDialog.close();
  });
  document.getElementById('appointmentProductsConfirmProceed').addEventListener('click', async () => {
    const button = document.getElementById('appointmentProductsConfirm');
    const proceedButton = document.getElementById('appointmentProductsConfirmProceed');
    productConfirmDialog.close();
    button.disabled = true;
    proceedButton.disabled = true;
    try {
      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
      await saveProductReviewDraft(false, true);
      const result = await requestJson(`/api/appointments/admin/${selectedAppointment.id}/complete-with-inventory`, {
        method: 'POST',
        body: JSON.stringify({ selectedItems: selectedProductItems() })
      });
      window.clearTimeout(draftSaveTimer);
      setAppointmentModalOpen(productsModal, false);
      setAppointmentModalOpen(detailsModal, false);
      await loadAppointments();
      showAppointmentAlert(result.message, { title: 'Appointment completed', tone: 'success' });
    } catch (error) {
      const message = document.getElementById('appointmentProductsMessage');
      try {
        await loadProductReview();
        renderProductSelection();
      } catch (reloadError) {
        console.error('Could not refresh appointment product stock after completion failed:', reloadError);
      }
      showProductEditorStep();
      message.textContent = error.message;
      message.classList.add('appointment-inventory-message--error');
    } finally {
      button.disabled = false;
      proceedButton.disabled = false;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (productConfirmDialog?.open) return;
    if (!appointmentAlertOverlay?.hidden) {
      hideAppointmentAlert();
    } else if (productsModal.classList.contains('apt-modal-overlay--open')) {
      closeProductReview();
    } else if (editModal.classList.contains('apt-modal-overlay--open')) {
      setAppointmentModalOpen(editModal, false);
    } else if (detailsModal.classList.contains('apt-modal-overlay--open')) {
      setAppointmentModalOpen(detailsModal, false);
    }
  });

  // ---------- rendering ----------

  function buildRow(a) {
    const tr = el('tr', 'apt-row');
    if (a.status === 'in-progress') tr.classList.add('apt-row--live');
    if (a.status === 'cancelled') tr.classList.add('apt-row--muted');

    const refTd = el('td');
    const refBox = el('div', 'apt-ref');
    refBox.appendChild(el('strong', '', a.ref));
    refBox.appendChild(el('span', '', a.isToday ? 'Today' : a.date.split(',')[0]));
    refTd.appendChild(refBox);

    const clientTd = el('td');
    const clientBox = el('div', 'um-user-cell');
    const avatar = el('div', 'um-avatar', getInitials(a.client));
    if (a.status === 'cancelled') avatar.classList.add('um-avatar--muted');
    const clientInfo = el('div');
    clientInfo.appendChild(el('span', 'apt-name', a.client));
    clientInfo.appendChild(el('span', 'apt-sub', a.profile));
    clientBox.appendChild(avatar);
    clientBox.appendChild(clientInfo);
    clientTd.appendChild(clientBox);

    const serviceTd = stackCell(a.service, a.duration, 'apt-name');
    const dateTd = stackCell(a.date, a.time, 'apt-name');
    const assignedTd = el('td', '', a.assignedTo);

    const statusTd = el('td');
    const statusClass = a.status;
    statusTd.appendChild(el('span', 'apt-status apt-status--' + statusClass, STATUS_LABELS[a.status] || a.status.toUpperCase()));

    const actionTd = el('td');
    const actions = el('div', 'apt-actions');
    const viewBtn = el('button', 'apt-action apt-action--view', 'View');
    viewBtn.type = 'button';
    viewBtn.dataset.action = 'view';
    viewBtn.dataset.ref = a.ref;
    const isClosed = a.status === 'completed' || a.status === 'cancelled' || a.status === 'no-show';
    const secondBtn = el('button', 'apt-action', isClosed ? 'Rebook' : 'Edit');
    secondBtn.classList.add(isClosed ? 'apt-action--rebook' : 'apt-action--edit');
    secondBtn.type = 'button';
    secondBtn.dataset.action = isClosed ? 'rebook' : 'edit';
    secondBtn.dataset.ref = a.ref;
    actions.appendChild(viewBtn);
    actions.appendChild(secondBtn);
    actionTd.appendChild(actions);

    [refTd, clientTd, serviceTd, dateTd, assignedTd, statusTd, actionTd].forEach((td) => tr.appendChild(td));
    return tr;
  }

  function renderTabs() {
    const monthAppointments = APPOINTMENTS.filter((appointment) => appointment.dateKey.startsWith(state.month));
    tabsWrap.querySelectorAll('.um-tab').forEach((tab) => {
      const key = tab.dataset.status;
      const count = key === 'all' ? monthAppointments.length : monthAppointments.filter((a) => a.status === key).length;
      tab.textContent = tab.dataset.label + ' (' + count + ')';
      tab.classList.toggle('um-tab--active', key === state.status);
    });
    if (todayChip) todayChip.hidden = !state.todayOnly;
  }

  function renderPagination(totalPages) {
    pagination.textContent = '';

    const makeBtn = (label, page, disabled, active) => {
      const btn = el('button', active ? 'active' : '', label);
      btn.type = 'button';
      btn.disabled = disabled;
      btn.addEventListener('click', () => {
        state.page = page;
        render();
      });
      return btn;
    };

    pagination.appendChild(makeBtn('‹', state.page - 1, state.page === 1, false));
    for (let p = 1; p <= totalPages; p++) {
      pagination.appendChild(makeBtn(String(p), p, false, p === state.page));
    }
    pagination.appendChild(makeBtn('›', state.page + 1, state.page === totalPages, false));
  }

  function render() {
    const filtered = getFiltered();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);

    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    tbody.textContent = '';
    if (isLoading && APPOINTMENTS.length === 0) {
      const tr = el('tr');
      const td = el('td', 'apt-empty', 'Loading appointments…');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else if (loadError && APPOINTMENTS.length === 0) {
      const tr = el('tr');
      const td = el('td', 'apt-empty', loadError);
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else if (pageRows.length === 0) {
      const tr = el('tr');
      const td = el('td', 'apt-empty', 'No appointments match this filter.');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      pageRows.forEach((a) => tbody.appendChild(buildRow(a)));
    }

    footerText.textContent = isLoading && APPOINTMENTS.length === 0
      ? 'Loading appointments…'
      : 'Showing ' + pageRows.length + ' of ' + filtered.length + ' appointments';
    renderTabs();
    renderPagination(totalPages);
    renderSummary();
    renderInsights();
  }

  function renderSummary() {
    const values = {
      aptTodayCount: APPOINTMENTS.filter((appointment) => appointment.isToday).length,
      aptConfirmedCount: APPOINTMENTS.filter((appointment) => appointment.status === 'confirmed').length,
      aptCancelledCount: APPOINTMENTS.filter((appointment) => appointment.status === 'cancelled').length
    };
    Object.entries(values).forEach(([id, value]) => {
      const target = document.getElementById(id);
      if (target) target.textContent = String(value);
    });
  }

  function renderInsights() {
    const timeline = document.getElementById('aptTimelineList');
    const timelineDate = document.getElementById('aptTimelineDate');
    const breakdown = document.getElementById('aptBreakdown');
    const totalCount = document.getElementById('aptTotalCount');
    const topServices = document.getElementById('aptTopServices');
    const today = manilaDateKey();
    const monthKey = state.month;
    const monthAppointments = APPOINTMENTS.filter((appointment) => appointment.dateKey.startsWith(monthKey));

    if (dateRangeSelect) {
      const [currentYear, currentMonth] = today.slice(0, 7).split('-').map(Number);
      const latestMonth = new Date(Date.UTC(currentYear, currentMonth - 1 + 2, 1)).toISOString().slice(0, 7);
      const availableMonths = new Set([state.month]);
      APPOINTMENTS.forEach((appointment) => {
        const appointmentMonth = appointment.dateKey.slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(appointmentMonth) && appointmentMonth <= latestMonth) {
          availableMonths.add(appointmentMonth);
        }
      });
      for (let offset = -12; offset <= 2; offset += 1) {
        availableMonths.add(new Date(Date.UTC(currentYear, currentMonth - 1 + offset, 1)).toISOString().slice(0, 7));
      }
      dateRangeSelect.replaceChildren();
      [...availableMonths].sort().forEach((month) => {
        const [year, monthNumber] = month.split('-').map(Number);
        const monthName = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
          .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
        const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
        const option = el('option', '', `${monthName} 1 – ${monthName} ${lastDay}, ${year}`);
        option.value = month;
        dateRangeSelect.appendChild(option);
      });
      dateRangeSelect.value = state.month;
    }

    if (timelineDate) {
      timelineDate.textContent = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', timeZone: 'UTC'
      }).format(new Date(`${today}T00:00:00Z`));
    }
    if (timeline) {
      timeline.textContent = '';
      const todaysAppointments = APPOINTMENTS.filter((appointment) => appointment.isToday);
      if (!todaysAppointments.length) {
        timeline.appendChild(el(
          'li',
          'apt-timeline__item apt-timeline__item--empty',
          isLoading ? 'Loading appointments…' : 'No appointments today.'
        ));
      } else {
        todaysAppointments.slice(0, 6).forEach((appointment) => {
          const timelineClass = appointment.status === 'completed' ? 'done'
            : appointment.status === 'in-progress' ? 'live' : 'upcoming';
          const item = el('li', 'apt-timeline__item apt-timeline__item--' + timelineClass);
          item.appendChild(el('span', 'apt-timeline__dot'));
          item.appendChild(el('span', 'apt-timeline__time', appointment.time));
          const event = el('div', 'apt-timeline__event', appointment.client + ' · ' + appointment.service);
          event.appendChild(el('small', '', STATUS_LABELS[appointment.status] || appointment.status.toUpperCase()));
          item.appendChild(event);
          timeline.appendChild(item);
        });
      }
    }

    if (breakdown) {
      const statusRows = [
        ['completed', 'Completed', 'var(--um-role-client)'],
        ['confirmed', 'Confirmed', 'var(--um-status-active)'],
        ['in-progress', 'In progress', 'var(--um-role-doctor)'],
        ['cancelled', 'Cancelled', '#B96B6B'],
        ['no-show', 'No show', '#8a4545']
      ];
      breakdown.textContent = '';
      if (!APPOINTMENTS.length) {
        breakdown.appendChild(el(
          'p',
          'apt-sub apt-insight-empty',
          isLoading ? 'Loading appointment statuses…' : 'No appointments recorded.'
        ));
      } else {
        statusRows.forEach(([status, label, color]) => {
          const count = APPOINTMENTS.filter((appointment) => appointment.status === status).length;
          if (!count) return;
          const percent = Math.round((count / APPOINTMENTS.length) * 100);
          const row = el('div', 'apt-breakdown__row');
          const values = el('div');
          values.appendChild(el('span', '', label));
          values.appendChild(el('span', '', String(count)));
          const bar = el('div', 'apt-bar');
          bar.setAttribute('role', 'progressbar');
          bar.setAttribute('aria-label', label + ': ' + count + ' of ' + APPOINTMENTS.length + ' appointments');
          bar.setAttribute('aria-valuemin', '0');
          bar.setAttribute('aria-valuemax', '100');
          bar.setAttribute('aria-valuenow', String(percent));
          const fill = el('i');
          fill.style.width = percent + '%';
          fill.style.background = color;
          bar.appendChild(fill);
          row.appendChild(values);
          row.appendChild(bar);
          breakdown.appendChild(row);
        });
      }
    }

    if (totalCount) totalCount.textContent = String(APPOINTMENTS.length) + ' appointments';
    if (topServices) {
      const counts = new Map();
      monthAppointments.forEach((appointment) => counts.set(appointment.service, (counts.get(appointment.service) || 0) + 1));
      const leaders = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      topServices.textContent = '';
      if (!leaders.length) {
        topServices.appendChild(el(
          'li',
          'apt-insight-empty',
          isLoading ? 'Loading services…' : 'No bookings this month.'
        ));
      } else {
        leaders.forEach(([service, count], index) => {
          const row = el('li');
          row.appendChild(el('span', '', (index + 1) + '. ' + service));
          row.appendChild(el('strong', '', count + (count === 1 ? ' booking' : ' bookings')));
          topServices.appendChild(row);
        });
      }
    }
  }

  async function loadAppointments() {
    if (appointmentLoadPromise) return appointmentLoadPromise;
    const pendingLoad = (async () => {
      try {
        const advanceResponse = await fetch('/api/appointments/admin/advance-started', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        const advanceResult = await readApiResponse(advanceResponse);
        if (!advanceResponse.ok) {
          throw new Error(advanceResult.message || `Could not update started appointments (HTTP ${advanceResponse.status}).`);
        }

        const response = await fetch('/api/appointments/admin', {
          headers: { Accept: 'application/json' },
          cache: 'no-store'
        });
        const responseText = await response.text();
        let body;
        try {
          body = responseText ? JSON.parse(responseText) : {};
        } catch (error) {
          console.error('Admin appointments endpoint returned a non-JSON response.', {
            status: response.status,
            body: responseText
          });
          throw new Error(`Could not load appointments (HTTP ${response.status}; invalid response).`);
        }
        if (!response.ok) {
          throw new Error(body?.message || `Could not load appointments (HTTP ${response.status}).`);
        }
        const records = body;
        if (!Array.isArray(records)) throw new Error('The appointments response was invalid.');
        APPOINTMENTS = records.map(normalizeAppointment);
        loadError = '';
      } catch (error) {
        loadError = error.message || 'Could not load appointments.';
        console.error('Could not load admin appointments:', error);
      } finally {
        isLoading = false;
        render();
        if (cancelledModal?.classList.contains('apt-modal-overlay--open')) renderCancelledModal();
      }
    })();
    appointmentLoadPromise = pendingLoad;
    try {
      await pendingLoad;
    } finally {
      if (appointmentLoadPromise === pendingLoad) appointmentLoadPromise = null;
    }
  }

  // ---------- events ----------

  tabsWrap.addEventListener('click', (event) => {
    const tab = event.target.closest('.um-tab');
    if (!tab) return;
    state.status = tab.dataset.status;
    state.todayOnly = false;
    state.page = 1;
    render();
  });

  dateRangeSelect?.addEventListener('change', () => {
    state.month = dateRangeSelect.value;
    state.todayOnly = false;
    state.page = 1;
    render();
  });

  // "View" links on the summary cards
  document.querySelectorAll('[data-apt-filter]').forEach((link) => {
    link.addEventListener('click', () => {
      const key = link.dataset.aptFilter;
      state.page = 1;
      if (key === 'today') {
        state.status = 'all';
        state.todayOnly = true;
        state.month = manilaDateKey().slice(0, 7);
      } else {
        state.status = key;
        state.todayOnly = false;
      }
      render();
      const card = document.getElementById('aptTableCard');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (todayChip) {
    todayChip.addEventListener('click', () => {
      state.todayOnly = false;
      state.page = 1;
      render();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.query = searchInput.value;
      state.page = 1;
      render();
    });
  }

  render();

  // ---------- Cancelled Appointments modal ----------

  const cancelledModal = document.getElementById('aptCancelledModal');
  const cancelledViewBtn = document.getElementById('aptCancelledViewBtn');
  const cancelledClose = document.getElementById('aptCancelledClose');
  const cancelledBody = document.getElementById('aptCancelledBody');
  const cancelledPills = document.getElementById('aptCancelledPills');
  const cancelledSubtitle = document.getElementById('aptCancelledSubtitle');
  const reasonList = document.getElementById('aptReasonList');
  const sumCollected = document.getElementById('aptSumCollected');
  const sumRefunded = document.getElementById('aptSumRefunded');
  const sumForfeited = document.getElementById('aptSumForfeited');
  const cancellationRequestsModal = document.getElementById('cancellationRequestsModal');
  const cancellationRequestsBtn = document.getElementById('cancellationRequestsBtn');
  const cancellationRequestsClose = document.getElementById('cancellationRequestsClose');
  const cancellationRequestsList = document.getElementById('cancellationRequestsList');
  const cancellationRequestsSubtitle = document.getElementById('cancellationRequestsSubtitle');

  if (!cancelledModal || !cancelledViewBtn || !cancelledBody || !cancelledPills || !reasonList) return;

  function formatFee(amount) {
    return '₱' + amount.toLocaleString('en-US');
  }

  function formatMoney(amount) {
    return '₱' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function buildCancelledRow(a) {
    const tr = el('tr', 'apt-cancel-row');

    const refTd = el('td');
    const refBox = el('div', 'apt-ref');
    refBox.appendChild(el('strong', '', a.ref));
    refBox.appendChild(el('span', '', a.date));
    refTd.appendChild(refBox);

    const clientTd = el('td');
    const clientBox = el('div', 'um-user-cell');
    clientBox.appendChild(el('div', 'um-avatar um-avatar--muted', getInitials(a.client)));
    const clientInfo = el('div');
    clientInfo.appendChild(el('span', 'apt-name', a.client));
    clientInfo.appendChild(el('span', 'apt-sub', a.profile));
    clientBox.appendChild(clientInfo);
    clientTd.appendChild(clientBox);

    const serviceTd = stackCell(a.service, a.duration + ' · ' + formatFee(a.fee), 'apt-name');
    const schedTd = el('td');
    schedTd.appendChild(el('span', 'apt-name', a.date + ' · ' + a.time));

    const statusTd = el('td');
    statusTd.appendChild(el('span', 'apt-status apt-status--cancelled', STATUS_LABELS[a.status] || a.status.toUpperCase()));

    const paymentTd = el('td');
    const paymentStatus = a.paymentStatus;
    const paymentLabel = paymentStatus.replace(/_/g, ' ').toUpperCase();
    const isSettled = paymentStatus === 'paid' || paymentStatus === 'refunded';
    paymentTd.appendChild(el('span', 'apt-status ' + (isSettled ? 'apt-status--confirmed' : 'apt-status--cancelled'), paymentLabel));
    paymentTd.appendChild(el('span', 'apt-sub', formatFee(a.depositAmount) + ' reservation fee'));

    [refTd, clientTd, serviceTd, schedTd, statusTd, paymentTd].forEach((td) => tr.appendChild(td));
    return tr;
  }

  function renderCancelledModal() {
    const cancelledAppointments = APPOINTMENTS.filter((appointment) => appointment.status === 'cancelled');
    const total = cancelledAppointments.length;
    const paid = cancelledAppointments.filter((appointment) => appointment.paymentStatus === 'paid');
    const refunded = cancelledAppointments.filter((appointment) => appointment.paymentStatus === 'refunded');
    const outstanding = cancelledAppointments.filter((appointment) => ['unpaid', 'pending', 'failed'].includes(appointment.paymentStatus));
    const sumDeposits = (list) => list.reduce((acc, appointment) => acc + appointment.depositAmount, 0);
    cancelledSubtitle.textContent = 'All recorded dates · ' + total + ' cancelled';

    cancelledPills.textContent = '';
    cancelledPills.appendChild(el('span', 'apt-pill apt-pill--red', total + ' Cancelled'));
    cancelledPills.appendChild(el('span', 'apt-pill apt-pill--gold', paid.length + ' Paid'));
    cancelledPills.appendChild(el('span', 'apt-pill apt-pill--gold', refunded.length + ' Refunded'));

    cancelledBody.textContent = '';
    if (isLoading && !APPOINTMENTS.length) {
      const row = el('tr');
      row.appendChild(el('td', 'apt-empty', 'Loading cancelled appointments…'));
      row.firstChild.colSpan = 6;
      cancelledBody.appendChild(row);
    } else if (!total) {
      const row = el('tr');
      row.appendChild(el('td', 'apt-empty', 'No cancelled appointments found.'));
      row.firstChild.colSpan = 6;
      cancelledBody.appendChild(row);
    } else {
      cancelledAppointments.forEach((appointment) => cancelledBody.appendChild(buildCancelledRow(appointment)));
    }

    sumCollected.textContent = formatMoney(sumDeposits(paid));
    sumRefunded.textContent = formatMoney(sumDeposits(refunded));
    sumForfeited.textContent = formatMoney(sumDeposits(outstanding));

    reasonList.textContent = '';
    const paymentStatuses = ['paid', 'refunded', 'pending', 'unpaid', 'failed'];
    paymentStatuses.forEach((status) => {
      const count = cancelledAppointments.filter((appointment) => appointment.paymentStatus === status).length;
      if (!count || !total) return;
      const percent = Math.round((count / total) * 100);
      const row = el('div', 'apt-reason-row');
      const track = el('span', 'apt-reason-track');
      const fill = el('i', 'apt-reason-fill apt-reason-fill--' + (status === 'paid' || status === 'refunded' ? 'personal' : 'noshow'));
      fill.style.width = percent + '%';
      track.appendChild(fill);
      row.appendChild(el('span', '', status.charAt(0).toUpperCase() + status.slice(1)));
      row.appendChild(track);
      row.appendChild(el('span', 'apt-reason-count', count + ' (' + percent + '%)'));
      reasonList.appendChild(row);
    });
    if (!total) reasonList.appendChild(el('p', 'apt-sub', 'Payment totals will appear when cancellations are recorded.'));
  }

  function openCancelledModal() {
    renderCancelledModal();
    cancelledModal.classList.add('apt-modal-overlay--open');
    document.body.classList.add('modal-open');
    if (cancelledClose) cancelledClose.focus();
  }

  function closeCancelledModal() {
    cancelledModal.classList.remove('apt-modal-overlay--open');
    document.body.classList.remove('modal-open');
    cancelledViewBtn.focus();
  }

  function formatRequestDate(value) {
    if (!value) return 'Date unavailable';
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function renderCancellationRequests(requests) {
    cancellationRequestsList.textContent = '';
    cancellationRequestsSubtitle.textContent = requests.length + (requests.length === 1 ? ' pending request' : ' pending requests');
    if (!requests.length) {
      cancellationRequestsList.appendChild(el('p', 'apt-sub cancellation-requests-empty', 'No pending cancellation requests.'));
      return;
    }
    requests.forEach((request) => {
      const card = el('article', 'cancellation-request-card');
      const requestType = request.request_type || 'cancellation';
      const title = el('div', 'cancellation-request-card__title');
      title.appendChild(el('strong', '', (requestType === 'reschedule' ? 'Reschedule' : 'Cancellation') + ' · ' + (request.client || 'Client')));
      title.appendChild(el('span', 'apt-sub', 'Appointment #' + request.appointment_id));
      card.appendChild(title);
      card.appendChild(el('p', 'apt-sub', [request.service, request.date, request.start, request.aesthetician].filter(Boolean).join(' · ')));
      if (requestType === 'reschedule') {
        card.appendChild(el('p', 'cancellation-request-card__reason', 'Proposed schedule: ' + [request.requested_date, request.requested_time].filter(Boolean).join(' · ')));
      }
      card.appendChild(el('p', 'cancellation-request-card__reason', 'Reason: ' + (request.request_reason || '—')));
      card.appendChild(el('p', 'cancellation-request-card__description', request.request_description || '—'));
      card.appendChild(el('p', 'apt-sub', 'Requested ' + formatRequestDate(request.requested_at)));
      const actions = el('div', 'cancellation-request-card__actions');
      const reject = el('button', 'um-btn um-btn--ghost', 'Reject');
      const allow = el('button', 'um-btn um-btn--primary', 'Allow');
      [reject, allow].forEach((button) => {
        button.type = 'button';
        button.addEventListener('click', async () => {
          reject.disabled = true;
          allow.disabled = true;
          try {
            const response = await fetch(`/api/appointments/${request.appointment_id}/cancellation-request/review`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decision: button === allow ? 'allow' : 'reject', requestType })
            });
            const data = await readApiResponse(response);
            if (!response.ok) throw new Error(data.message || 'Could not review request.');
            await loadCancellationRequests();
            await loadAppointments();
          } catch (error) {
            showAppointmentAlert(error.message, { title: 'Request update failed', tone: 'error' });
            reject.disabled = false;
            allow.disabled = false;
          }
        });
      });
      actions.append(reject, allow);
      card.appendChild(actions);
      cancellationRequestsList.appendChild(card);
    });
  }

  async function loadCancellationRequests() {
    const response = await fetch('/api/appointments/admin/cancellation-requests', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.message || 'Could not load cancellation requests.');
    renderCancellationRequests(Array.isArray(data) ? data : []);
  }

  async function openCancellationRequests() {
    cancellationRequestsModal.classList.add('apt-modal-overlay--open');
    document.body.classList.add('modal-open');
    cancellationRequestsList.textContent = '';
    cancellationRequestsList.appendChild(el('p', 'apt-sub cancellation-requests-empty', 'Loading requests…'));
    try { await loadCancellationRequests(); } catch (error) { cancellationRequestsList.textContent = ''; cancellationRequestsList.appendChild(el('p', 'apt-sub cancellation-requests-empty', error.message)); }
    cancellationRequestsClose.focus();
  }

  function closeCancellationRequests() {
    cancellationRequestsModal.classList.remove('apt-modal-overlay--open');
    document.body.classList.remove('modal-open');
  }

  cancelledViewBtn.addEventListener('click', openCancelledModal);
  if (cancelledClose) cancelledClose.addEventListener('click', closeCancelledModal);

  cancelledModal.addEventListener('click', (event) => {
    if (event.target === cancelledModal) closeCancelledModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cancelledModal.classList.contains('apt-modal-overlay--open')) {
      closeCancelledModal();
    }
  });

  cancellationRequestsBtn.addEventListener('click', openCancellationRequests);
  cancellationRequestsClose.addEventListener('click', closeCancellationRequests);
  cancellationRequestsModal.addEventListener('click', (event) => {
    if (event.target === cancellationRequestsModal) closeCancellationRequests();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && cancellationRequestsModal.classList.contains('apt-modal-overlay--open')) closeCancellationRequests();
  });

  const newAppointmentBtn = document.getElementById('newAppointmentBtn');
  const newAppointmentModal = document.getElementById('newAppointmentModal');
  const newAppointmentForm = document.getElementById('newAppointmentForm');
  const newAppointmentClose = document.getElementById('newAppointmentClose');
  const newAppointmentCancel = document.getElementById('newAppointmentCancel');
  const newAppointmentClientName = document.getElementById('newAppointmentClientName');
  const newAppointmentReference = document.getElementById('newAppointmentReference');
  const newAppointmentService = document.getElementById('newAppointmentService');
  const newAppointmentDate = document.getElementById('newAppointmentDate');
  const newAppointmentTime = document.getElementById('newAppointmentTime');
  const newAppointmentStaff = document.getElementById('newAppointmentStaff');
  const newAppointmentMessage = document.getElementById('newAppointmentMessage');
  const newAppointmentSubmit = document.getElementById('newAppointmentSubmit');
  let walkInServicesLoaded = false;
  let walkInStaffRequestId = 0;

  function setWalkInMessage(message, kind = '') {
    newAppointmentMessage.textContent = message;
    newAppointmentMessage.className = 'booking-status-message' + (kind ? ` ${kind}` : '');
  }

  async function loadWalkInServices() {
    if (walkInServicesLoaded) return;
    const response = await fetch('/api/services', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    const services = await readApiResponse(response);
    if (!response.ok) throw new Error(services.message || services.error || 'Could not load services.');
    if (!Array.isArray(services)) throw new Error('The services response was invalid.');
    if (services.length === 0) throw new Error('No active services are available.');

    services.forEach((service) => {
      const option = el('option', '', `${service.service_name} (${service.duration_minutes} min)`);
      option.value = String(service.service_id);
      newAppointmentService.appendChild(option);
    });
    walkInServicesLoaded = true;
  }

  async function updateWalkInStaff() {
    const requestId = ++walkInStaffRequestId;
    const serviceId = newAppointmentService.value;
    const date = newAppointmentDate.value;
    const time = newAppointmentTime.value;
    newAppointmentStaff.replaceChildren(el('option', '', 'Choose a service, date, and time first'));
    newAppointmentStaff.disabled = true;

    if (!serviceId || !date || !time) {
      setWalkInMessage('');
      return;
    }

    newAppointmentStaff.replaceChildren(el('option', '', 'Loading available staff…'));
    setWalkInMessage('Checking staff availability…', 'info');
    try {
      const params = new URLSearchParams({ serviceId, date, time });
      const response = await fetch(`/api/appointments/admin/walk-in-options?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      const staff = await readApiResponse(response);
      if (requestId !== walkInStaffRequestId) return;
      if (!response.ok) throw new Error(staff.message || 'Could not check staff availability.');
      if (!Array.isArray(staff)) throw new Error('The available staff response was invalid.');

      newAppointmentStaff.replaceChildren(el('option', '', staff.length ? 'Choose available staff' : 'No staff available for this slot'));
      staff.forEach((person) => {
        const roleLabel = person.role === 'nail_tech' ? 'Nail Tech' : 'Aesthetician';
        const option = el('option', '', `${person.full_name || 'Staff member'} — ${roleLabel}`);
        option.value = String(person.user_id);
        newAppointmentStaff.appendChild(option);
      });
      newAppointmentStaff.disabled = staff.length === 0;
      setWalkInMessage(
        staff.length ? 'Only qualified staff available for this service and time are listed.' : 'No qualified staff are available for this time. Choose another date or time.',
        staff.length ? 'info' : 'error'
      );
    } catch (error) {
      if (requestId !== walkInStaffRequestId) return;
      newAppointmentStaff.replaceChildren(el('option', '', 'Staff availability could not be loaded'));
      setWalkInMessage(error.message || 'Could not check staff availability.', 'error');
    }
  }

  function closeNewAppointmentModal() {
    newAppointmentModal.classList.remove('apt-modal-overlay--open');
    document.body.classList.remove('modal-open');
    newAppointmentBtn.focus();
  }

  async function openNewAppointmentModal() {
    newAppointmentForm.reset();
    newAppointmentReference.value = 'Generated after saving';
    newAppointmentForm.dataset.saved = '';
    newAppointmentForm.querySelectorAll('input:not([readonly]), select').forEach((field) => { field.disabled = false; });
    newAppointmentSubmit.disabled = false;
    newAppointmentSubmit.textContent = 'Save Appointment';
    newAppointmentStaff.replaceChildren(el('option', '', 'Choose a service, date, and time first'));
    newAppointmentStaff.disabled = true;
    setWalkInMessage('');

    const today = manilaDateKey();
    const [year, month, day] = today.split('-').map(Number);
    const latest = new Date(Date.UTC(year, month - 1, day + 60)).toISOString().slice(0, 10);
    newAppointmentDate.min = today;
    newAppointmentDate.max = latest;
    newAppointmentModal.classList.add('apt-modal-overlay--open');
    document.body.classList.add('modal-open');
    newAppointmentClientName.focus();
    try {
      await loadWalkInServices();
    } catch (error) {
      setWalkInMessage(error.message || 'Could not load services.', 'error');
    }
  }

  newAppointmentBtn.addEventListener('click', openNewAppointmentModal);
  newAppointmentClose.addEventListener('click', closeNewAppointmentModal);
  newAppointmentCancel.addEventListener('click', closeNewAppointmentModal);
  newAppointmentModal.addEventListener('click', (event) => {
    if (event.target === newAppointmentModal) closeNewAppointmentModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && newAppointmentModal.classList.contains('apt-modal-overlay--open')) {
      closeNewAppointmentModal();
    }
  });
  [newAppointmentService, newAppointmentDate, newAppointmentTime].forEach((field) => {
    field.addEventListener('change', updateWalkInStaff);
  });

  newAppointmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (newAppointmentForm.dataset.saved === 'true' || !newAppointmentForm.reportValidity()) return;

    newAppointmentSubmit.disabled = true;
    setWalkInMessage('Saving appointment…', 'info');
    try {
      const response = await fetch('/api/appointments/admin/walk-in', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: newAppointmentClientName.value,
          serviceId: newAppointmentService.value,
          date: newAppointmentDate.value,
          time: newAppointmentTime.value,
          staffId: newAppointmentStaff.value
        })
      });
      const result = await readApiResponse(response);
      if (!response.ok) throw new Error(result.message || 'Could not create the appointment.');

      newAppointmentForm.dataset.saved = 'true';
      newAppointmentReference.value = result.referenceNumber;
      newAppointmentForm.querySelectorAll('input:not([readonly]), select').forEach((field) => { field.disabled = true; });
      newAppointmentSubmit.textContent = 'Appointment Saved';
      setWalkInMessage(`${result.message} Reference number: ${result.referenceNumber}. Payment is unpaid and due in cash on-site.`, 'success');

      await loadAppointments();
      let createdIndex = APPOINTMENTS.findIndex((appointment) => appointment.id === String(result.appointment.appointment_id));
      if (createdIndex < 0) {
        await loadAppointments();
        createdIndex = APPOINTMENTS.findIndex((appointment) => appointment.id === String(result.appointment.appointment_id));
      }
      state.status = 'all';
      state.todayOnly = false;
      state.query = '';
      if (createdIndex >= 0) state.month = APPOINTMENTS[createdIndex].dateKey.slice(0, 7);
      const visibleIndex = getFiltered().findIndex((appointment) => appointment.id === String(result.appointment.appointment_id));
      state.page = visibleIndex >= 0 ? Math.floor(visibleIndex / PAGE_SIZE) + 1 : 1;
      if (searchInput) searchInput.value = '';
      render();
    } catch (error) {
      setWalkInMessage(error.message || 'Could not create the appointment.', 'error');
      newAppointmentSubmit.disabled = false;
    }
  });

  loadAppointments();
  window.setInterval(() => {
    if (!document.hidden) loadAppointments();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadAppointments();
  });

  if (new URLSearchParams(window.location.search).get('new') === '1') {
    newAppointmentBtn.click();
    window.history.replaceState(null, '', window.location.pathname);
  }
});