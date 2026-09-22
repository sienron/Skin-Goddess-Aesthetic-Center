/* ===== Treatment Notes (sticky notes beside the appointment modal) =====
   Adds a small trigger icon just outside the top-right corner of the
   appointment detail modal (#apptModalOverlay). Clicking it creates a new
   sticky note in the panel beside the modal. Each note can be:
     - recolored (color swatch button opens a small palette),
     - edited (pencil icon switches the note into a textarea),
     - removed (x icon).

    Notes are loaded and saved through the appointment notes API. This file
    self-guards: if the modal/trigger markup
   isn't on the page, it does nothing.
*/

(function () {
    const notesTriggerBtn = document.getElementById("notesTriggerBtn");
    const notesPanel = document.getElementById("notesPanel");
    const apptModalOverlay = document.getElementById("apptModalOverlay");
    const apptModal = document.getElementById("apptModal");

    if (!notesTriggerBtn || !notesPanel || !apptModalOverlay || !apptModal) return;

    const NOTE_COLORS = [
        { name: "Yellow", value: "#FFF3B0" },
        { name: "Pink", value: "#FFD3E0" },
        { name: "Blue", value: "#CFE8FF" },
        { name: "Green", value: "#D7F5D0" },
        { name: "Lavender", value: "#E4D9FF" },
    ];

    // Local cache for the currently loaded appointment; the database is authoritative.
    const NOTES_STORE = {};

    let currentApptId = null;
    let noteIdCounter = 1;

    function syncNotesMaxHeight() {
        const modalHeight = apptModal.getBoundingClientRect().height;
        if (modalHeight > 0) {
            notesPanel.style.setProperty("--notes-max-height", `${modalHeight}px`);
        }
    }

    if (typeof ResizeObserver === "function") {
        const modalResizeObserver = new ResizeObserver(syncNotesMaxHeight);
        modalResizeObserver.observe(apptModal);
    }

    function formatTimestamp(date) {
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
            " · " +
            date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }

    function getNotesForCurrentAppt() {
        if (currentApptId == null) return [];
        if (!NOTES_STORE[currentApptId]) NOTES_STORE[currentApptId] = [];
        return NOTES_STORE[currentApptId];
    }

    async function notesRequest(path, options = {}) {
        const response = await fetch(path, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });
        if (!response.ok) {
            let message = "Could not save treatment note.";
            try {
                const body = await response.json();
                message = body.message || message;
            } catch (_) {
                // Keep the default message when the server response is not JSON.
            }
            throw new Error(message);
        }
        return response.status === 204 ? null : response.json();
    }

    function notesPath(noteId = "") {
        return `/api/appointments/${encodeURIComponent(currentApptId)}/notes${noteId ? `/${encodeURIComponent(noteId)}` : ""}`;
    }

    async function loadNotes() {
        if (currentApptId == null) return;
        const notes = await notesRequest(notesPath());
        NOTES_STORE[currentApptId] = notes.map((note) => ({
            ...note,
            updatedAt: new Date(note.updatedAt),
        }));
    }

    function closeAllColorPickers(exceptEl) {
        notesPanel.querySelectorAll(".note-color-picker.show").forEach((picker) => {
            if (picker !== exceptEl) picker.classList.remove("show");
        });
    }

    function buildNoteElement(note) {
        const el = document.createElement("div");
        el.className = "sticky-note";
        el.dataset.noteId = note.id;
        el.style.backgroundColor = note.color;

        // ---- Header: color swatch, edit, close ----
        const header = document.createElement("div");
        header.className = "sticky-note-header";

        const colorBtn = document.createElement("button");
        colorBtn.type = "button";
        colorBtn.className = "sticky-note-icon-btn note-color-btn";
        colorBtn.setAttribute("aria-label", "Change note color");
        colorBtn.title = "Change color";
        const swatch = document.createElement("span");
        swatch.className = "sticky-note-color-swatch";
        swatch.style.backgroundColor = note.color;
        colorBtn.appendChild(swatch);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "sticky-note-icon-btn note-edit-btn";
        editBtn.setAttribute("aria-label", "Edit note");
        editBtn.title = "Edit";
        const editIcon = document.createElement("img");
        editIcon.src = "icons/edit.svg";
        editIcon.alt = "";
        editBtn.appendChild(editIcon);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "sticky-note-icon-btn note-close-btn";
        closeBtn.setAttribute("aria-label", "Remove note");
        closeBtn.title = "Remove";
        closeBtn.textContent = "\u00D7";

        header.append(colorBtn, editBtn, closeBtn);

        // ---- Color picker dropdown ----
        const picker = document.createElement("div");
        picker.className = "note-color-picker";
        NOTE_COLORS.forEach((c) => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "note-color-option";
            option.style.backgroundColor = c.value;
            option.title = c.name;
            option.setAttribute("aria-label", `Set color to ${c.name}`);
            if (c.value.toLowerCase() === note.color.toLowerCase()) option.classList.add("active");
            option.addEventListener("click", (e) => {
                e.stopPropagation();
                updateNote(note, { color: c.value }, () => {
                    note.color = c.value;
                    el.style.backgroundColor = c.value;
                    swatch.style.backgroundColor = c.value;
                    picker.querySelectorAll(".note-color-option").forEach((o) => o.classList.remove("active"));
                    option.classList.add("active");
                    picker.classList.remove("show");
                });
            });
            picker.appendChild(option);
        });

        // ---- Body: read view + edit view ----
        const textEl = document.createElement("p");
        textEl.className = "sticky-note-text";
        textEl.textContent = note.text || "Click the pencil to write a treatment note.";

        const textarea = document.createElement("textarea");
        textarea.className = "sticky-note-textarea";
        textarea.value = note.text || "";
        textarea.placeholder = "Write a treatment note...";

        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "sticky-note-save-btn";
        saveBtn.textContent = "SAVE";

        const meta = document.createElement("div");
        meta.className = "sticky-note-meta";
        meta.textContent = formatTimestamp(note.updatedAt);

        el.append(header, picker, textEl, textarea, saveBtn, meta);

        // ---- Interactions ----
        colorBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = picker.classList.contains("show");
            closeAllColorPickers();
            picker.classList.toggle("show", !isOpen);
        });

        function enterEditMode() {
            closeAllColorPickers();
            el.classList.add("editing");
            textarea.value = note.text || "";
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
        }

        async function commitEdit() {
            const text = textarea.value.trim();
            await updateNote(note, { text }, (savedNote) => {
                textEl.textContent = note.text || "Click the pencil to write a treatment note.";
                meta.textContent = formatTimestamp(note.updatedAt);
                el.classList.remove("editing");
            });
        }

        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (el.classList.contains("editing")) {
                void commitEdit().catch((error) => window.alert(error.message));
            } else {
                enterEditMode();
            }
        });

        saveBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            void commitEdit().catch((error) => window.alert(error.message));
        });

        textarea.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void commitEdit().catch((error) => window.alert(error.message));
            }
        });

        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!note.text || window.confirm("Remove this treatment note?")) {
                void notesRequest(notesPath(note.id), { method: "DELETE" })
                    .then(() => {
                        const list = getNotesForCurrentAppt();
                        const idx = list.findIndex((n) => n.id === note.id);
                        if (idx !== -1) list.splice(idx, 1);
                        el.remove();
                    })
                    .catch((error) => window.alert(error.message));
            }
        });

        return el;
    }

    async function updateNote(note, changes, onSuccess) {
        const savedNote = await notesRequest(notesPath(note.id), {
            method: "PATCH",
            body: JSON.stringify(changes),
        });
        Object.assign(note, savedNote, { updatedAt: new Date(savedNote.updatedAt) });
        onSuccess(note);
    }

    function renderNotesPanel() {
        notesPanel.replaceChildren();
        const notes = getNotesForCurrentAppt();
        notes.forEach((note) => notesPanel.appendChild(buildNoteElement(note)));
        notesPanel.setAttribute("aria-hidden", notes.length === 0 ? "true" : "false");
    }

    notesTriggerBtn.addEventListener("click", () => {
        if (currentApptId == null) return; // no appointment open yet

        void notesRequest(notesPath(), {
            method: "POST",
            body: JSON.stringify({ text: "", color: NOTE_COLORS[0].value }),
        })
            .then((savedNote) => {
                const note = { ...savedNote, updatedAt: new Date(savedNote.updatedAt) };
                getNotesForCurrentAppt().push(note);
                const el = buildNoteElement(note);
                notesPanel.appendChild(el);
                notesPanel.setAttribute("aria-hidden", "false");
                el.classList.add("editing");
                el.querySelector(".sticky-note-textarea").focus();
            })
            .catch((error) => window.alert(error.message));
    });

    document.addEventListener("click", (e) => {
        if (!notesPanel.contains(e.target)) closeAllColorPickers();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAllColorPickers();
    });

    // ---- Hook into the shared modal's open/close so the panel follows it ----
    // appointment-modal.js defines these globally; wrap them rather than
    // editing that shared file, so every page that includes this script
    // gets notes support without touching the modal's own logic.
    if (typeof window.openApptModal === "function") {
        const originalOpen = window.openApptModal;
        window.openApptModal = function (appt) {
            originalOpen(appt);
            currentApptId = appt.id;
            syncNotesMaxHeight();
            NOTES_STORE[currentApptId] = [];
            void loadNotes()
                .then(renderNotesPanel)
                .catch((error) => {
                    console.error(error);
                    renderNotesPanel();
                    window.alert(error.message);
                });
        };
    }

    if (typeof window.closeApptModal === "function") {
        const originalClose = window.closeApptModal;
        window.closeApptModal = function () {
            originalClose();
            closeAllColorPickers();
        };
    }
})();
