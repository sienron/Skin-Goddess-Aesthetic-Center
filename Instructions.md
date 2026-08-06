This is a capstone project: a web-based appointment & inventory system with multiple user roles (Admin, Aesthetician, Inventory & Procurement Officer, Finance Officer, Staff, Client). Currently static HTML/CSS/JS — no backend wired up yet (planned stack per proposal: Node.js/Express, PostgreSQL, hosted on Render).

CSS convention: one shared style.css file, never split.

JS convention: split by reusability, not by page.

header.js — notification dropdown + logout, shared on every staff page.
appointment-modal.js — shared appointment detail modal, used by Admin/Staff/Aesthetician pages. Exposes global openApptModal(appt) / closeApptModal().
One thin page-specific file per page for logic unique to that page (e.g. appointments-aesthetician.js for calendar rendering/search/rating widget).
Every shared JS file self-guards with if (!element) return; at the top of each block, so it's safe to include on a page missing that markup — never assume an element exists.
Rule going forward: if logic is needed on 2+ pages, extract it into its own shared file; if only 1 page needs it, it stays in that page's file.

HTML convention:

Staff-facing header + sidebar (logo, page title, notifications, search, logout, role nav, rating widget) is reused across all staff pages — currently copy-pasted per page since there's no templating engine yet. Fine for now; revisit with a real template partial (e.g. EJS) once the backend exists.
Public client-facing header (logo, nav links, Book Now button, profile) is a completely separate, unrelated component — only for the client-facing site, never mixed with the staff shell.

File naming convention:

HTML files: PascalCase (e.g. AestheticianAppointmentPage.html, UserAppointment.html).
JS/CSS files: lowercase kebab-case (e.g. appointment-modal.js, header.js, style.css) — standard web convention, not a typo. Don't "fix" the casing to match HTML unless explicitly asked.

Working with me:

Before making changes, check the actual file/folder names and structure I've already given you (I'll attach relevant files) rather than assuming — don't reinvent conventions per chat.
When sharing files, state the exact filename in your message text, since the file-preview card UI reformats titles to sentence case for display — that's a display quirk, not the real filename.
Don't be a yes-man — flag tradeoffs, dependencies between files, or things that will break honestly, even if I don't ask.