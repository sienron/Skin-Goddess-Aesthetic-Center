document.addEventListener('DOMContentLoaded', () => {
    const queueList = document.getElementById('appointmentReviewQueueList');
    const dialog = document.getElementById('appointmentReviewDialog');
    if (!queueList || !dialog) return;

    const queueMessage = document.getElementById('appointmentReviewQueueMessage');
    const dialogMessage = document.getElementById('appointmentReviewDialogMessage');
    const selectedList = document.getElementById('appointmentReviewSelectedList');
    const otherList = document.getElementById('appointmentReviewOtherList');
    const finalStep = document.getElementById('appointmentReviewFinalStep');
    const selectedListWrap = document.getElementById('appointmentReviewProductLists');
    const reviewButton = document.getElementById('reviewAppointmentProducts');
    const confirmButton = document.getElementById('confirmAppointmentProducts');
    const backButton = document.getElementById('backAppointmentReview');
    const saveButton = document.getElementById('saveAppointmentReviewDraft');
    const attestation = document.getElementById('appointmentReviewAttestation');
    let appointment = null;
    let products = [];
    let selection = new Map();
    let searchTerm = '';
    let saveTimer = null;
    let draftDirty = false;
    let finalItems = [];

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function formatManilaDateTime(value) {
        return new Intl.DateTimeFormat('en-US', {
            dateStyle: 'short',
            timeStyle: 'medium',
            timeZone: 'Asia/Manila'
        }).format(new Date(value));
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
        const text = await response.text();
        let result;
        try {
            result = text ? JSON.parse(text) : {};
        } catch {
            throw new Error(`Request failed (${response.status}).`);
        }
        if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
        return result;
    }

    function selectedItems() {
        return [...selection.entries()].map(([productId, item]) => ({
            productId,
            quantity: item.quantity === '' || item.quantity === null ? null : Number(item.quantity),
            isSuggested: Boolean(item.isSuggested),
            suggestionDefaultQuantity: item.suggestionDefaultQuantity ?? null
        })).sort((left, right) => left.productId - right.productId);
    }

    async function saveDraft(confirmed = false) {
        if (!appointment) return;
        window.clearTimeout(saveTimer);
        saveTimer = null;
        const result = await requestJson(`/api/appointments/inventory-officer/${appointment.appointment_id}/review`, {
            method: 'PUT',
            body: JSON.stringify({ selectedItems: selectedItems(), confirmed })
        });
        draftDirty = false;
        dialogMessage.textContent = result.message;
        dialogMessage.classList.remove('is-error');
        return result;
    }

    function scheduleDraftSave() {
        draftDirty = true;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => {
            try {
                await saveDraft(false);
            } catch (error) {
                dialogMessage.textContent = `Draft could not be saved: ${error.message}`;
                dialogMessage.classList.add('is-error');
            }
        }, 350);
    }

    function renderQueue(items = []) {
        queueList.replaceChildren();
        if (!items.length) {
            queueList.appendChild(el('p', 'appointment-review-queue__empty', 'No appointments are currently In Progress.'));
            return;
        }
        const table = el('div', 'appointment-review-queue__table');
        items.forEach((item) => {
            const row = el('article', 'appointment-review-queue__row');
            const info = el('div', 'appointment-review-queue__info');
            info.append(
                el('strong', 'appointment-review-queue__client', item.client),
                el('span', 'appointment-review-queue__service', item.service),
                el('span', '', `${item.date} · ${item.start} · ${item.assigned_to}`)
            );
            const status = el(
                'span',
                `appointment-review-status${item.review_status === 'confirmed' ? ' is-confirmed' : ''}`,
                item.review_status === 'confirmed' ? 'Products Reviewed' : 'Pending Review'
            );
            const open = el('button', 'btn btn-export', item.review_status === 'confirmed' ? 'View / Edit Review' : 'Review Products');
            open.type = 'button';
            open.addEventListener('click', () => openReview(item));
            row.append(info, status, open);
            table.appendChild(row);
        });
        queueList.appendChild(table);
    }

    async function loadQueue() {
        queueMessage.textContent = 'Loading appointments…';
        queueMessage.classList.remove('is-error');
        try {
            const items = await requestJson('/api/appointments/inventory-officer/reviews');
            renderQueue(items);
            queueMessage.textContent = `${items.filter((item) => item.review_status === 'pending').length} pending review · ${items.filter((item) => item.review_status === 'confirmed').length} confirmed`;
        } catch (error) {
            queueMessage.textContent = error.message || 'Could not load appointments awaiting review.';
            queueMessage.classList.add('is-error');
        }
    }

    function renderProductList(list, available, emptyText) {
        list.replaceChildren();
        if (!available.length) {
            list.appendChild(el('p', 'appointment-review-product-list__empty', emptyText));
            return;
        }
        available.forEach((product) => {
            const productId = Number(product.product_id);
            const current = selection.get(productId);
            const stock = Number(product.stock_quantity);
            const quantity = Number(current?.quantity);
            const insufficient = current && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > stock);
            const row = el(`article`, `appointment-review-product${insufficient ? ' has-stock-warning' : ''}`);
            const checkbox = el('input');
            checkbox.type = 'checkbox';
            checkbox.checked = Boolean(current);
            checkbox.setAttribute('aria-label', `Select ${product.product_name}`);
            const details = el('div', 'appointment-review-product__details');
            details.append(
                el('strong', '', product.product_name),
                el('span', '', `${product.category} · Current stock: ${stock}${stock <= 0 ? ' · Out of stock' : ''}`)
            );
            if (product.is_suggested) {
                details.appendChild(el('span', 'appointment-review-product__tag', 'Service suggestion'));
            }
            const quantityLabel = el('label', 'appointment-review-product__quantity', 'Actual quantity used');
            const quantityInput = el('input');
            quantityInput.type = 'number';
            quantityInput.min = '1';
            quantityInput.step = '1';
            quantityInput.value = current?.quantity ?? '';
            quantityInput.disabled = !current;
            quantityInput.setAttribute('aria-label', `Actual quantity used for ${product.product_name}`);
            quantityLabel.appendChild(quantityInput);
            row.append(checkbox, details, quantityLabel);
            if (insufficient) {
                row.appendChild(el('p', 'appointment-review-product__warning',
                    stock <= 0 ? 'Out of stock. This item cannot be confirmed while selected.' : `Only ${stock} units are available.`));
            }
            list.appendChild(row);

            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    selection.set(productId, {
                        quantity: product.default_quantity == null ? '' : Number(product.default_quantity),
                        isSuggested: Boolean(product.is_suggested),
                        suggestionDefaultQuantity: product.default_quantity == null
                            ? null
                            : Number(product.default_quantity)
                    });
                } else {
                    selection.delete(productId);
                }
                renderProducts();
                scheduleDraftSave();
            });
            quantityInput.addEventListener('input', () => {
                const item = selection.get(productId);
                if (!item) return;
                item.quantity = quantityInput.value;
                const parsedQuantity = Number(item.quantity);
                const quantityIsInvalid = !Number.isSafeInteger(parsedQuantity)
                    || parsedQuantity < 1
                    || parsedQuantity > stock;
                row.classList.toggle('has-stock-warning', quantityIsInvalid);
                let warning = row.querySelector('.appointment-review-product__warning');
                if (quantityIsInvalid) {
                    if (!warning) {
                        warning = el('p', 'appointment-review-product__warning');
                        row.appendChild(warning);
                    }
                    warning.textContent = stock <= 0
                        ? 'Out of stock. This item cannot be confirmed while selected.'
                        : parsedQuantity > stock
                            ? `Only ${stock} units are available.`
                            : 'Enter a positive whole-number quantity.';
                } else if (warning) {
                    warning.remove();
                }
                scheduleDraftSave();
            });
        });
    }

    function renderProducts() {
        const query = searchTerm.trim().toLowerCase();
        const matches = (product) => !query
            || `${product.product_name} ${product.category}`.toLowerCase().includes(query);
        const visible = products.filter(matches);
        renderProductList(
            selectedList,
            visible.filter((product) => selection.has(Number(product.product_id))),
            'No selected products match your search.'
        );
        renderProductList(
            otherList,
            visible.filter((product) => !selection.has(Number(product.product_id))),
            'No other inventory products match your search.'
        );
    }

    function showEditor() {
        finalStep.hidden = true;
        selectedListWrap.hidden = false;
        document.querySelector('.appointment-review-search').hidden = false;
        reviewButton.hidden = false;
        saveButton.hidden = false;
        backButton.hidden = true;
        confirmButton.hidden = true;
        confirmButton.disabled = true;
    }

    function showFinalReview() {
        finalItems = selectedItems();
        const list = document.getElementById('appointmentReviewFinalList');
        list.replaceChildren();
        if (!finalItems.length) {
            list.appendChild(el('li', '', 'No products selected. Confirm that no inventory items were used.'));
        } else {
            finalItems.forEach((item) => {
                const product = products.find((entry) => Number(entry.product_id) === item.productId);
                const stock = Number(product?.stock_quantity);
                const line = `${product?.product_name || 'Inventory product'} — ${item.quantity} unit(s)`;
                list.appendChild(el('li', '', stock < item.quantity
                    ? `${line} · Insufficient stock (${stock} available)`
                    : `${line} · ${stock} in stock`));
            });
        }
        finalStep.hidden = false;
        selectedListWrap.hidden = true;
        document.querySelector('.appointment-review-search').hidden = true;
        reviewButton.hidden = true;
        saveButton.hidden = true;
        backButton.hidden = false;
        confirmButton.hidden = false;
        confirmButton.disabled = !attestation.checked;
    }

    async function openReview(queueItem) {
        try {
            const review = await requestJson(`/api/appointments/inventory-officer/${queueItem.appointment_id}/review`);
            appointment = queueItem;
            products = review.products;
            selection = new Map(review.products
                .filter((product) => product.is_selected)
                .map((product) => [Number(product.product_id), {
                    quantity: product.selected_quantity ?? '',
                    isSuggested: Boolean(product.selected_is_suggested),
                    suggestionDefaultQuantity: product.selected_suggestion_default_quantity == null
                        ? null
                        : Number(product.selected_suggestion_default_quantity)
                }]));
            searchTerm = '';
            document.getElementById('appointmentReviewSearch').value = '';
            document.getElementById('appointmentReviewDialogTitle').textContent = review.appointment.service;
            document.getElementById('appointmentReviewDialogSubtitle').textContent =
                `${review.appointment.client} · ${review.appointment.date} · ${review.appointment.assigned_to}`;
            dialogMessage.textContent = review.reviewStatus === 'confirmed'
                ? `Confirmed by ${review.reviewedBy || 'Inventory Officer'}${review.reviewedAt ? ` on ${formatManilaDateTime(review.reviewedAt)}` : ''}. Editing the selection will reset confirmation.`
                : 'Check the suggested products against what was actually used and enter each quantity.';
            dialogMessage.classList.remove('is-error');
            draftDirty = false;
            attestation.checked = false;
            showEditor();
            renderProducts();
            dialog.showModal();
        } catch (error) {
            queueMessage.textContent = error.message || 'Could not load the product review.';
            queueMessage.classList.add('is-error');
        }
    }

    async function closeReview() {
        window.clearTimeout(saveTimer);
        saveTimer = null;
        if (draftDirty) {
            try {
                await saveDraft(false);
            } catch (error) {
                dialogMessage.textContent = `Draft could not be saved: ${error.message}`;
                dialogMessage.classList.add('is-error');
                return;
            }
        }
        dialog.close();
    }

    document.getElementById('appointmentReviewSearch').addEventListener('input', (event) => {
        searchTerm = event.target.value;
        renderProducts();
    });
    document.getElementById('refreshAppointmentReviews').addEventListener('click', loadQueue);
    document.getElementById('closeAppointmentReview').addEventListener('click', closeReview);
    document.getElementById('cancelAppointmentReview').addEventListener('click', closeReview);
    saveButton.addEventListener('click', async () => {
        saveButton.disabled = true;
        try {
            await saveDraft(false);
            await loadQueue();
        } catch (error) {
            dialogMessage.textContent = error.message || 'Could not save the review draft.';
            dialogMessage.classList.add('is-error');
        } finally {
            saveButton.disabled = false;
        }
    });
    reviewButton.addEventListener('click', async () => {
        const invalid = selectedItems().find((item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1);
        if (invalid) {
            const product = products.find((item) => Number(item.product_id) === invalid.productId);
            dialogMessage.textContent = `Enter a positive whole-number quantity for ${product?.product_name || 'each selected product'}.`;
            dialogMessage.classList.add('is-error');
            return;
        }
        try {
            await saveDraft(false);
            attestation.checked = false;
            showFinalReview();
        } catch (error) {
            dialogMessage.textContent = error.message || 'Could not save the review draft.';
            dialogMessage.classList.add('is-error');
        }
    });
    backButton.addEventListener('click', showEditor);
    attestation.addEventListener('change', () => {
        confirmButton.disabled = !attestation.checked;
    });
    confirmButton.addEventListener('click', async () => {
        if (!attestation.checked) return;
        confirmButton.disabled = true;
        backButton.disabled = true;
        try {
            const result = await saveDraft(true);
            dialogMessage.textContent = result.message;
            await loadQueue();
            window.setTimeout(() => dialog.close(), 600);
        } catch (error) {
            dialogMessage.textContent = error.message || 'Could not confirm product use.';
            dialogMessage.classList.add('is-error');
            showEditor();
        } finally {
            backButton.disabled = false;
            confirmButton.disabled = !attestation.checked;
        }
    });

    loadQueue();
});
