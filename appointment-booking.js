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
    const paymentMethod = document.getElementById("paymentMethod");

    const summaryService = document.getElementById("summaryService");
    const summaryDate = document.getElementById("summaryDate");
    const summaryTime = document.getElementById("summaryTime");
    const summaryPayment = document.getElementById("summaryPayment");
    const summaryTotal = document.getElementById("summaryTotal");

    // Self-guard: if this page's booking markup isn't present, do nothing.
    if (!serviceList || !calendarDays || !detailsForm) return;

    const BOOKING_FEE = 300;
    const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const MORNING_SLOTS = ["9:00 AM", "10:00 AM", "11:00 AM"];
    const AFTERNOON_SLOTS = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
    const ALL_SLOTS = MORNING_SLOTS.concat(AFTERNOON_SLOTS);

    const initiallySelectedCard = serviceList.querySelector(".service-card.selected");
    let selectedService = {
        name: initiallySelectedCard ? initiallySelectedCard.dataset.service : null,
        price: initiallySelectedCard ? Number(initiallySelectedCard.dataset.price) : 0
    };

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
    let selectedDate = null; // { year, month, day }
    let selectedTime = null;
    let currentAvailability = {};

    /* ===== Placeholder availability =====
       Deterministic pseudo-random availability so the calendar looks
       populated without a backend. Swap for a real API response later —
       keep the same shape: { "YYYY-M-D": ["9:00 AM", "1:00 PM", ...] }. */
    function generatePlaceholderAvailability(year, month) {
        const availability = {};
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const isSunday = date.getDay() === 0;

            if (isPast || isSunday) continue;

            // FOR NOW: every remaining day is treated as available, so the
            // calendar renders every day as a clickable gold circle.
            // Once real availability data (or a proper "some days are full")
            // scenario is needed, swap the line below for the sparse pattern:
            //   if (day % 6 !== 1) continue;

            availability[`${year}-${month}-${day}`] = ALL_SLOTS.slice(0, 4 + (day % 4));
        }

        return availability;
    }

    /* ===== Service selection ===== */
    function renderServices() {
        // Placeholder markup already in the DOM; this just wires up clicks.
        // When backend-driven, build the .service-card elements here from
        // the fetched services array before attaching listeners.
        serviceList.querySelectorAll(".service-card").forEach((card) => {
            card.addEventListener("click", () => {
                serviceList.querySelectorAll(".service-card").forEach((c) => c.classList.remove("selected"));
                card.classList.add("selected");
                selectedService = {
                    name: card.dataset.service,
                    price: Number(card.dataset.price)
                };
                updateSummary();
            });
        });
    }

    /* ===== Calendar ===== */
    function renderCalendar() {
        calendarMonthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
        calendarDays.innerHTML = "";
        currentAvailability = generatePlaceholderAvailability(viewYear, viewMonth);

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

            const isToday = viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate();
            const key = `${viewYear}-${viewMonth}-${day}`;
            const isAvailable = Boolean(currentAvailability[key]);

            if (isAvailable) {
                cell.classList.add("available");
                cell.addEventListener("click", () => selectDate(day));
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
        updateSummary();
    }

    calendarPrev.addEventListener("click", () => {
        viewMonth -= 1;
        if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
        renderCalendar();
    });

    calendarNext.addEventListener("click", () => {
        viewMonth += 1;
        if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
        renderCalendar();
    });

    /* ===== Time slots ===== */
    function renderSlots() {
        slotsContainer.innerHTML = "";

        if (!selectedDate) {
            slotsHeading.textContent = "SELECT A DATE TO SEE AVAILABLE SLOTS";
            return;
        }

        const key = `${selectedDate.year}-${selectedDate.month}-${selectedDate.day}`;
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

                const isAvailable = available.includes(slot);
                if (!isAvailable) {
                    btn.classList.add("disabled");
                    btn.disabled = true;
                } else {
                    if (selectedTime === slot) btn.classList.add("selected");
                    btn.addEventListener("click", () => {
                        selectedTime = slot;
                        renderSlots();
                        updateSummary();
                    });
                }

                grid.appendChild(btn);
            });

            slotsContainer.appendChild(grid);
        }

        buildGroup("MORNING", MORNING_SLOTS);
        buildGroup("AFTERNOON", AFTERNOON_SLOTS);
    }

    /* ===== Live summary ===== */
    function updateSummary() {
        summaryService.textContent = selectedService.name || "\u2014";

        if (selectedDate) {
            const dateObj = new Date(selectedDate.year, selectedDate.month, selectedDate.day);
            summaryDate.textContent = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            summaryDate.classList.remove("not-selected");
        } else {
            summaryDate.textContent = "Not selected";
            summaryDate.classList.add("not-selected");
        }

        if (selectedTime) {
            summaryTime.textContent = selectedTime;
            summaryTime.classList.remove("not-selected");
        } else {
            summaryTime.textContent = "Not selected";
            summaryTime.classList.add("not-selected");
        }

        if (paymentMethod && paymentMethod.value) {
            summaryPayment.textContent = paymentMethod.options[paymentMethod.selectedIndex].textContent;
            summaryPayment.classList.remove("not-selected");
        } else if (summaryPayment) {
            summaryPayment.textContent = "Not selected";
            summaryPayment.classList.add("not-selected");
        }

        const total = (selectedService.price || 0) + BOOKING_FEE;
        summaryTotal.textContent = `₱${total.toLocaleString("en-US")}`;
    }

    if (paymentMethod) {
        paymentMethod.addEventListener("change", updateSummary);
    }

    /* ===== Submission =====
       No backend yet, so this just validates required fields exist and
       logs the payload. Replace the body with a real POST /api/appointments
       call once the backend is wired up. */
    detailsForm.addEventListener("submit", (e) => {
        e.preventDefault();

        if (!selectedDate || !selectedTime) {
            alert("Please select a date and time for your appointment.");
            return;
        }

        const payload = {
            service: selectedService.name,
            price: selectedService.price,
            date: selectedDate,
            time: selectedTime,
            firstName: document.getElementById("firstName").value,
            lastName: document.getElementById("lastName").value,
            email: document.getElementById("email").value,
            phone: document.getElementById("phone").value,
            paymentMethod: paymentMethod ? paymentMethod.value : null
        };

        console.log("Booking submitted (placeholder — no backend yet):", payload);
        alert("Appointment request captured. (Backend integration pending — nothing was actually saved yet.)");
    });

    renderServices();
    renderCalendar();
    renderSlots();
    updateSummary();
})();