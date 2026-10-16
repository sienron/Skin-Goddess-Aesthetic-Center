/* ===== UserAppointment.html — page-specific logic =====
   Service selection, live availability, time-slot selection, and booking
   summary. Appointments are created only after verified PayMongo payment.
*/
(function () {
    const categorySelect = document.getElementById("serviceCategorySelect");
    const serviceSearch = document.getElementById("serviceSearch");
    const serviceList = document.getElementById("serviceList");
    const calendarMonthLabel = document.getElementById("calendarMonthLabel");
    const calendarDays = document.getElementById("calendarDays");
    const calendarPrev = document.getElementById("calendarPrev");
    const calendarNext = document.getElementById("calendarNext");
    const slotsHeading = document.getElementById("slotsHeading");
    const slotsContainer = document.getElementById("slotsContainer");
    const detailsForm = document.getElementById("detailsForm");

    // Self-guard: if this page's booking markup isn't present, do nothing.
    if (!categorySelect || !serviceList || !calendarDays || !detailsForm) return;

    const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const MORNING_SLOTS = ["9:00 AM", "10:00 AM", "11:00 AM"];
    const AFTERNOON_SLOTS = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
    const ALL_SLOTS = MORNING_SLOTS.concat(AFTERNOON_SLOTS);
    const MAX_ADVANCE_DAYS = 60;

    function getManilaNow() {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).formatToParts(new Date());

        const values = Object.fromEntries(
            parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
        );

        return {
            year: Number(values.year),
            month: Number(values.month) - 1,
            day: Number(values.day),
            hour: Number(values.hour),
            minute: Number(values.minute)
        };
    }

    function slotToMinutes(slot) {
        const match = slot.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!match) return null;

        let hour = Number(match[1]);
        const minute = Number(match[2]);
        const period = match[3].toUpperCase();

        if (period === "AM" && hour === 12) hour = 0;
        if (period === "PM" && hour !== 12) hour += 12;

        return hour * 60 + minute;
    }

    function isSlotInPast(dateObj, slot) {
        const now = getManilaNow();
        const slotDate = new Date(dateObj.year, dateObj.month, dateObj.day);
        const today = new Date(now.year, now.month, now.day);

        if (slotDate < today) return true;
        if (slotDate > today) return false;

        const slotMinutes = slotToMinutes(slot);
        const nowMinutes = now.hour * 60 + now.minute;
        return slotMinutes !== null && slotMinutes <= nowMinutes;
    }

    let allServices = [];
    let selectedService = { id: null, name: null, price: 0, reservationFee: 100 };

    const today = getManilaNow();
    let viewYear = today.year;
    let viewMonth = today.month;
    let selectedDate = null; // { year, month, day }
    let selectedTime = null;
    let currentAvailability = {};
    let availabilityRequestId = 0;

    function setBookingStatus(message, kind = "info") {
        const statusEl = document.getElementById("bookingStatusMessage");
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = `booking-status-message ${kind}`;
    }

    function formatAvailabilityKey(year, monthIndex, day) {
        return `${year}-${monthIndex}-${day}`;
    }

    async function fetchAvailability() {
        if (!selectedService || !selectedService.id) {
            currentAvailability = {};
            renderCalendar();
            renderSlots();
            return;
        }

        const requestId = ++availabilityRequestId;
        const monthParam = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;

        try {
            slotsHeading.textContent = "LOADING AVAILABILITY...";
            const response = await fetch(`/api/availability?month=${monthParam}&serviceId=${selectedService.id}`);

            if (response.status === 401) {
                window.location.href = "/LoginPage.html";
                return;
            }

            if (!response.ok) {
                throw new Error("Could not load availability.");
            }

            const availability = await response.json();
            if (requestId !== availabilityRequestId) return;

            currentAvailability = availability || {};

            if (selectedDate) {
                const selectedKey = formatAvailabilityKey(selectedDate.year, selectedDate.month, selectedDate.day);
                const daySlots = currentAvailability[selectedKey] || [];
                if (daySlots.length === 0 || (selectedTime && !daySlots.includes(selectedTime))) {
                    selectedDate = null;
                    selectedTime = null;
                }
            }

            renderCalendar();
            renderSlots();
        } catch (error) {
            if (requestId !== availabilityRequestId) return;
            currentAvailability = {};
            renderCalendar();
            renderSlots();
            slotsHeading.textContent = "AVAILABILITY UNAVAILABLE";
        }
    }

    /* ===== Service selection =====
       Two-step flow: a category dropdown (e.g. "IPL Hair Removal") narrows
       the variant list (e.g. "Full Legs") rendered below it in the same
       card, instead of showing every service flat. */
    function renderServiceVariants(services, selectFirst = true) {
        serviceList.replaceChildren();

        if (services.length === 0) {
            const placeholder = document.createElement("p");
            placeholder.className = "service-list-placeholder";
            const isSearching = Boolean(serviceSearch && serviceSearch.value.trim());
            placeholder.textContent = isSearching
                ? "No services match your search."
                : "No options available for this treatment yet.";
            serviceList.appendChild(placeholder);
            if (!isSearching) selectedService = { id: null, name: null, price: 0, reservationFee: 100 };
            return;
        }

        services.forEach(service => {
            const card = document.createElement("div");
            card.className = "service-card";
            card.dataset.serviceId = service.service_id;
            card.dataset.service = service.service_name;
            card.dataset.price = service.service_price;
            card.dataset.reservationFee = service.reservation_fee;
            card.dataset.category = service.category || "Other";

            const name = document.createElement("span");
            name.className = "service-name";
            name.textContent = service.service_name;

            const description = document.createElement("span");
            description.className = "service-desc";
            description.textContent = `${service.duration_minutes} min - ${service.description || ""}`;

            const price = document.createElement("span");
            price.className = "service-price";
            price.textContent = `PHP ${Number(service.service_price).toLocaleString("en-US")}`;

            const reservationFee = document.createElement("span");
            reservationFee.className = "service-reservation-fee";
            reservationFee.textContent = `Reservation fee: PHP ${Number(service.reservation_fee).toLocaleString("en-US")}`;

            const check = document.createElement("span");
            check.className = "service-check";
            check.textContent = "✓";

            card.append(name, description, price, reservationFee, check);
            serviceList.appendChild(card);
        });

        const serviceCards = [...serviceList.querySelectorAll(".service-card")];
        let selectedCard = serviceCards.find((card) => card.dataset.serviceId === String(selectedService.id));
        if (!selectedCard && selectFirst) selectedCard = serviceCards[0];
        if (selectedCard) {
            selectedCard.classList.add("selected");
            if (selectFirst && selectedCard.dataset.serviceId !== String(selectedService.id)) {
                selectedService = {
                    id: selectedCard.dataset.serviceId,
                    name: selectedCard.dataset.service,
                    price: Number(selectedCard.dataset.price),
                    reservationFee: Number(selectedCard.dataset.reservationFee)
                };
            }
        }

        serviceList.querySelectorAll(".service-card").forEach((card) => {
            card.addEventListener("click", () => {
                serviceList.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
                card.classList.add("selected");
                categorySelect.value = card.dataset.category;
                selectedService = {
                    id: card.dataset.serviceId,
                    name: card.dataset.service,
                    price: Number(card.dataset.price),
                    reservationFee: Number(card.dataset.reservationFee)
                };
                selectedDate = null;
                selectedTime = null;
                setBookingStatus("");
                renderCalendar();
                fetchAvailability();
            });
        });
    }

    async function fetchServices() {
        try {
            const response = await fetch("/api/services");
            if (!response.ok) throw new Error("Failed to fetch services");

            allServices = await response.json();
            populateCategorySelect(allServices);

            if (categorySelect.value) {
                renderServiceVariants(servicesForCategory(categorySelect.value));
            }

            if (selectedService && selectedService.id) {
                fetchAvailability();
            }
        } catch (error) {
            console.error("Error fetching services:", error);
        }
    }

    function populateCategorySelect(services) {
        const categories = [];
        services.forEach((service) => {
            const category = service.category || "Other";
            if (!categories.includes(category)) categories.push(category);
        });

        categorySelect.replaceChildren();

        if (categories.length === 0) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "No treatments available";
            categorySelect.appendChild(option);
            return;
        }

        categories.forEach((category) => {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            categorySelect.appendChild(option);
        });
    }

    function servicesForCategory(category) {
        return allServices.filter((service) => (service.category || "Other") === category);
    }

    categorySelect.addEventListener("change", () => {
        if (serviceSearch) serviceSearch.value = "";
        renderServiceVariants(servicesForCategory(categorySelect.value));
        selectedDate = null;
        selectedTime = null;
        setBookingStatus("");
        fetchAvailability();
    });

    serviceSearch?.addEventListener("input", () => {
        const query = serviceSearch.value.trim().toLowerCase();
        if (!query) {
            renderServiceVariants(servicesForCategory(categorySelect.value));
            return;
        }
        renderServiceVariants(
            allServices.filter((service) => String(service.service_name || "").toLowerCase().includes(query)),
            false
        );
    });

    /* ===== Calendar ===== */
    function renderCalendar() {
        calendarMonthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
        calendarDays.innerHTML = "";
        const now = getManilaNow();
        const todayDate = new Date(now.year, now.month, now.day);
        const latestBookableDate = new Date(now.year, now.month, now.day + MAX_ADVANCE_DAYS);
        calendarPrev.disabled = viewYear < now.year
            || (viewYear === now.year && viewMonth <= now.month);
        const latestNavigableMonth = new Date(now.year, now.month + 2, 1);
        calendarNext.disabled = viewYear > latestNavigableMonth.getFullYear()
            || (viewYear === latestNavigableMonth.getFullYear() && viewMonth >= latestNavigableMonth.getMonth());

        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

        for (let i = 0; i < firstWeekday; i++) {
            const empty = document.createElement("div");
            empty.className = "calendar-day empty";
            calendarDays.appendChild(empty);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const cell = document.createElement("div");
            cell.className = "calendar-day";
            cell.textContent = day;

            const date = new Date(viewYear, viewMonth, day);
            const isToday = viewYear === now.year && viewMonth === now.month && day === now.day;
            const isPast = date < todayDate;
            const isBeyondBookingWindow = date > latestBookableDate;
            const key = formatAvailabilityKey(viewYear, viewMonth, day);
            const daySlots = currentAvailability[key] || [];

            // Bookings close at 4 PM Manila time, so today stops being selectable past that cutoff.
            const isPastCutoffToday = isToday && (now.hour * 60 + now.minute) >= 16 * 60;
            const isSelectable = !isPast && !isBeyondBookingWindow && !isPastCutoffToday;

            if (isSelectable && daySlots.length > 0) {
                cell.classList.add("available");
                cell.addEventListener("click", () => selectDate(day));
            } else {
                cell.classList.add("disabled");
                if (isBeyondBookingWindow) cell.title = "Appointments can only be booked up to 60 days in advance";
                else if (isSelectable) cell.title = "No available slots for this date";
            }

            if (isToday) cell.classList.add("today");
            if (selectedDate && selectedDate.year === viewYear && selectedDate.month === viewMonth && selectedDate.day === day) {
                cell.classList.add("selected");
            }

            calendarDays.appendChild(cell);
        }
    }

    function selectDate(day) {
        selectedDate = { year: viewYear, month: viewMonth, day };
        selectedTime = null;
        renderCalendar();
        renderSlots();
    }

    calendarPrev.addEventListener("click", () => {
        const now = getManilaNow();
        if (viewYear < now.year || (viewYear === now.year && viewMonth <= now.month)) return;
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        selectedDate = null;
        selectedTime = null;
        setBookingStatus("");
        renderCalendar();
        fetchAvailability();
    });

    calendarNext.addEventListener("click", () => {
        const now = getManilaNow();
        const latestNavigableMonth = new Date(now.year, now.month + 2, 1);
        if (viewYear > latestNavigableMonth.getFullYear()
            || (viewYear === latestNavigableMonth.getFullYear() && viewMonth >= latestNavigableMonth.getMonth())) return;
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        selectedDate = null;
        selectedTime = null;
        setBookingStatus("");
        renderCalendar();
        fetchAvailability();
    });

    /* ===== Time slots ===== */
    function renderSlots() {
        slotsContainer.innerHTML = "";

        if (!selectedDate) {
            slotsHeading.textContent = "SELECT A DATE TO SEE AVAILABLE SLOTS";
            return;
        }

const key = formatAvailabilityKey(selectedDate.year, selectedDate.month, selectedDate.day);
            const available = currentAvailability[key] || [];
            const dateLabel = `${MONTH_NAMES[selectedDate.month].slice(0, 3).toUpperCase()} ${selectedDate.day}`;

            slotsHeading.textContent = `AVAILABLE SLOTS ${dateLabel}`;

            function buildGroup(label, slots) {
                const heading = document.createElement("p");
                heading.className = "slots-period";
                heading.textContent = label;
                slotsContainer.appendChild(heading);

                const grid = document.createElement("div");
                grid.className = "slot-grid";

                slots.forEach((slot) => {
                    const btn = document.createElement("button");
                    btn.type = "button";
                    btn.className = "slot-btn";
                    btn.textContent = slot;

                    const isAvailable = available.includes(slot) && !isSlotInPast(selectedDate, slot);
                if (!isAvailable) {
                    btn.classList.add("disabled");
                    btn.disabled = true;
                } else {
                    if (selectedTime === slot) btn.classList.add("selected");
                    btn.addEventListener("click", () => {
                        selectedTime = slot;
                        renderSlots();
                    });
                }

                grid.appendChild(btn);
            });

            slotsContainer.appendChild(grid);
        }

        buildGroup("MORNING", MORNING_SLOTS);
        buildGroup("AFTERNOON", AFTERNOON_SLOTS);
    }

     /* ===== Submission =====
         Keep the appointment uncreated until checkout reports payment success.
         Checkout redirects to PayMongo; appointments are created only after a verified payment. */
     detailsForm.addEventListener("submit", (e) => {
        e.preventDefault();

        if (!selectedDate || !selectedTime) {
            setBookingStatus("Please select a date and time for your appointment.", "error");
            return;
        }

        if (!detailsForm.reportValidity()) {
            setBookingStatus("Please complete your details before confirming.", "error");
            return;
        }

        const booking = {
            serviceId: Number(selectedService.id),
            service: selectedService.name,
            servicePrice: selectedService.price,
            reservationFee: selectedService.reservationFee,
            date: `${selectedDate.year}-${String(selectedDate.month + 1).padStart(2, "0")}-${String(selectedDate.day).padStart(2, "0")}`,
            time: selectedTime,
            firstName: document.getElementById("firstName").value.trim(),
            lastName: document.getElementById("lastName").value.trim(),
            email: document.getElementById("email").value.trim(),
            phone: document.getElementById("phone").value.trim(),
            total: selectedService.reservationFee
        };

        try {
            localStorage.setItem("sg_pending_booking", JSON.stringify(booking));
            window.location.href = "AppointmentSummary.html";
        } catch (error) {
            setBookingStatus("Could not prepare the appointment summary.", "error");
        }
    });

    const sameAsUserCheckbox = document.getElementById("sameAsUserCheckbox");
    if (sameAsUserCheckbox) {
        const firstNameInput = document.getElementById("firstName");
        const lastNameInput = document.getElementById("lastName");
        const emailInput = document.getElementById("email");
        const phoneInput = document.getElementById("phone");

        function clearDetailFields() {
            if (firstNameInput) firstNameInput.value = "";
            if (lastNameInput) lastNameInput.value = "";
            if (emailInput) emailInput.value = "";
            if (phoneInput) phoneInput.value = "";
        }

        function autofillUserDetails() {
            fetch("/api/auth/me")
                .then((response) => {
                    if (!response.ok) throw new Error("Not logged in");
                    return response.json();
                })
                .then((data) => {
                    if (!data) return;
                    if (firstNameInput && data.firstName) firstNameInput.value = data.firstName;
                    if (lastNameInput && data.lastName) lastNameInput.value = data.lastName;
                    if (emailInput && data.email) emailInput.value = data.email;
                    if (phoneInput && data.contactNumber) phoneInput.value = data.contactNumber;
                })
                .catch(() => {
                    clearDetailFields();
                });
        }

        function setDetailFieldsDisabled(disabled) {
            [firstNameInput, lastNameInput, emailInput, phoneInput].forEach((input) => {
                if (input) input.disabled = disabled;
            });
        }

        sameAsUserCheckbox.addEventListener("change", () => {
            setDetailFieldsDisabled(sameAsUserCheckbox.checked);
            if (sameAsUserCheckbox.checked) {
                autofillUserDetails();
            } else {
                clearDetailFields();
            }
        });
    }

    fetchServices();
    renderCalendar();
    renderSlots();
})();