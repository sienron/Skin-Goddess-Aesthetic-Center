/* ===== UserAppointment.html — page-specific logic =====
   Service selection, calendar rendering, time-slot selection, and the
   live booking summary. Scoped to this page only (client-facing booking
   flow), per the "one thin page-specific file per page" convention.

   BACKEND TODO:
   - Services: replace the hardcoded .service-card markup in
     UserAppointment.html with data fetched from GET /api/services, then
     call renderServices(data) instead of relying on the static HTML.
   - Availability: replace generatePlaceholderAvailability() with a call to
     GET /api/availability?month=YYYY-MM (and ideally scoped by service id,
     since different services may need different durations/slots).
   - Submission: wire the submit handler below to POST /api/appointments
     with { serviceName, servicePrice, date, time, firstName, lastName,
     email, phone, paymentMethod }.
*/
(function () {
    const serviceList = document.getElementById("serviceList");
    const calendarMonthLabel = document.getElementById("calendarMonthLabel");
    const calendarDays = document.getElementById("calendarDays");
    const calendarPrev = document.getElementById("calendarPrev");
    const calendarNext = document.getElementById("calendarNext");
    const slotsHeading = document.getElementById("slotsHeading");
    const slotsContainer = document.getElementById("slotsContainer");
    const detailsForm = document.getElementById("detailsForm");

    // Self-guard: if this page's booking markup isn't present, do nothing.
    if (!serviceList || !calendarDays || !detailsForm) return;

    const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const MORNING_SLOTS = ["9:00 AM", "10:00 AM", "11:00 AM"];
    const AFTERNOON_SLOTS = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
    const ALL_SLOTS = MORNING_SLOTS.concat(AFTERNOON_SLOTS);

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

    const initiallySelectedCard = serviceList.querySelector(".service-card.selected");
    let selectedService = {
        id: initiallySelectedCard ? initiallySelectedCard.dataset.serviceId : null,
        name: initiallySelectedCard ? initiallySelectedCard.dataset.service : null,
        price: initiallySelectedCard ? Number(initiallySelectedCard.dataset.price) : 0,
        reservationFee: initiallySelectedCard ? Number(initiallySelectedCard.dataset.reservationFee || 100) : 100
    };

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
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

    /* ===== Service selection ===== */
    function renderServices(services) {
        serviceList.replaceChildren();

        services.forEach(service => {
            const card = document.createElement("div");
            card.className = "service-card";
            card.dataset.serviceId = service.service_id;
            card.dataset.service = service.service_name;
            card.dataset.price = service.service_price;
            card.dataset.reservationFee = service.reservation_fee;

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

        const firstCard = serviceList.querySelector(".service-card");
        if (firstCard) {
            firstCard.classList.add("selected");
            selectedService = {
                id: firstCard.dataset.serviceId,
                name: firstCard.dataset.service,
                price: Number(firstCard.dataset.price),
                reservationFee: Number(firstCard.dataset.reservationFee)
            };
        }

        serviceList.querySelectorAll(".service-card").forEach((card) => {
            card.addEventListener("click", () => {
                serviceList.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
                card.classList.add("selected");
                selectedService = {
                    id: card.dataset.serviceId,
                    name: card.dataset.service,
                    price: Number(card.dataset.price),
                    reservationFee: Number(card.dataset.reservationFee)
                };
                selectedDate = null;
                selectedTime = null;
                setBookingStatus("");
                fetchAvailability();
            });
        });
    }

    async function fetchServices() {
        try {
            const response = await fetch("/api/services");
            if (!response.ok) throw new Error("Failed to fetch services");

            renderServices(await response.json());
            if (selectedService && selectedService.id) {
                fetchAvailability();
            }
        } catch (error) {
            console.error("Error fetching services:", error);
        }
    }

    /* ===== Calendar ===== */
    function renderCalendar() {
        calendarMonthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
        calendarDays.innerHTML = "";

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
            const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
            const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const isSunday = date.getDay() === 0;
            const key = formatAvailabilityKey(viewYear, viewMonth, day);
            const daySlots = currentAvailability[key] || [];
            const isSelectable = !isPast && !isSunday;

            if (isSelectable) {
                cell.classList.add("available");
                if (daySlots.length > 0) {
                    cell.addEventListener("click", () => selectDate(day));
                } else {
                    cell.classList.add("disabled");
                    cell.title = "No available slots for this date";
                }
            }

            if (isToday) cell.classList.add("today");
            if (selectedDate && selectedDate.year === viewYear && selectedDate.month === viewMonth && selectedDate.day === day) {
                cell.classList.add("selected");
            }

            if (!isSelectable && !isToday) {
                cell.classList.add("disabled");
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
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        selectedDate = null;
        selectedTime = null;
        setBookingStatus("");
        fetchAvailability();
    });

    calendarNext.addEventListener("click", () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        selectedDate = null;
        selectedTime = null;
        setBookingStatus("");
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
       The reservation fee + payment now happen on the next page
       (AppointmentSummary.html, via PayMongo), so this handler just
       validates the booking, stashes it, and hands off. The actual
       POST /api/appointments call should happen once PayMongo confirms
       payment on the summary page — see appointment-summary.js. */
    detailsForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!selectedDate || !selectedTime) {
            setBookingStatus("Please select a date and time for your appointment.", "error");
            return;
        }

        if (!detailsForm.reportValidity()) {
            setBookingStatus("Please complete your details before confirming.", "error");
            return;
        }

        const confirmBtn = document.getElementById("confirmBtn");
        if (confirmBtn) confirmBtn.disabled = true;
        setBookingStatus("Booking your appointment...", "info");

        const payload = {
            serviceId: selectedService.id,
            date: `${selectedDate.year}-${String(selectedDate.month + 1).padStart(2, "0")}-${String(selectedDate.day).padStart(2, "0")}`,
            time: selectedTime
        };

        try {
            const response = await fetch("/api/appointments", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({}));

            if (response.status === 401) {
                window.location.href = "/LoginPage.html";
                return;
            }

            if (response.status === 409 || (data && data.message === "That time slot was just taken. Please choose another.")) {
                setBookingStatus("That slot was just taken", "error");
                selectedTime = null;
                renderSlots();
                await fetchAvailability();
                if (confirmBtn) confirmBtn.disabled = false;
                return;
            }

            if (!response.ok) {
                throw new Error(data.message || "Could not create appointment.");
            }

            setBookingStatus("Appointment booked successfully.", "success");
            selectedDate = null;
            selectedTime = null;
            renderCalendar();
            renderSlots();
        } catch (error) {
            setBookingStatus(error.message || "Could not create appointment.", "error");
        } finally {
            if (document.getElementById("confirmBtn")) {
                document.getElementById("confirmBtn").disabled = false;
            }
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

        sameAsUserCheckbox.addEventListener("change", () => {
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