# Provisional appointment inventory mapping review

The mapping interface is intentionally not preloaded with enabled product defaults. The configured `skin_goddess_test` database contained service names, categories, descriptions, and inventory product names/categories, but no service recipes, usage quantities, or existing service-to-product mapping. No per-service quantity could be verified from those records.

Migration `035-appointment-inventory-review.js` creates a few **disabled, quantity-free candidate links** only when the existing service and product names directly support a possible relationship:

| Service/product name evidence | Candidate rationale | State |
| --- | --- | --- |
| Service name contains “Acne” + `Acne Buster Toner` | Both names identify acne-related topical care; actual service use is unverified. | Disabled; quantity unset; clinic review required |
| Service name contains “Acne” + `Acne Topical Solution` | Both names identify acne-related topical care; the database does not say whether this is used in treatment or aftercare. | Disabled; quantity unset; clinic review required |
| Service name contains “Drip” + `Macroset (IV Set)` | The product is explicitly labeled as an IV set; actual use for each drip protocol is unverified. | Disabled; quantity unset; clinic review required |
| Service name contains “Shot” + `3cc Syringe` | A syringe is a plausible shot supply, but the correct syringe type and whether it is used are unverified. | Disabled; quantity unset; clinic review required |

These are review candidates, not clinic procedures or approved defaults. The app only preselects a mapping after an admin enters a positive whole-number quantity and enables it in Content Management. The clinic should verify each candidate and add or remove defaults based on its actual protocols. Other services have no seeded candidates because the available metadata does not support a specific product choice.

Changing a service's defaults affects future review drafts. An appointment's first product-review opening snapshots its enabled defaults into a persisted draft; reopening preserves that selection. The admin can explicitly refresh suggestions to replace the draft selection with the latest defaults. Confirmed deductions are stored separately and are never rewritten by mapping changes.

Confirmed deductions are immutable through this workflow, and the appointment-level record prevents a second deduction. An audited correction/reversal interface is not included in this implementation; if a confirmed deduction is wrong, do not edit or delete its transaction rows or process the appointment again. A separate compensating adjustment with a recorded reason and administrator identity requires a future correction workflow.
