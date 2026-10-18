# Appointment inventory suggestions

The supplied service-product list is encoded as 321 distinct candidate pairs in `migrations/039-appointment-inventory-mappings.js`. Migration `040-enable-service-inventory-suggestions.js` enables or inserts only pairs whose service name and category and product name resolve uniquely in the existing catalog. It does not create services or products. Existing mapping quantities, review notes, and administrator attribution are preserved on reruns; newly inserted suggestions have no default quantity.

The six enabled candidates for **Anti-Aging Drip** are:

- Macroset (IV Set)
- 10cc Syringe
- 3cc Syringe
- Cannula
- Scalp Vein Set
- Sterile Water

These are suggestions, not a record of what was consumed during a particular appointment. The Inventory Officer must verify actual products and enter the actual quantities before confirmation. Quantities remain unconfirmed where none were explicitly configured.

The Inventory Officer's appointment-review queue preselects every enabled mapping regardless of current stock, shows its current stock, and labels zero stock as out of stock. The officer can adjust the selection and actual quantities, save a draft, and explicitly confirm the final products used. Confirmation records the officer and time in the existing review-draft audit columns and validates current stock, but does not deduct stock. Editing a confirmed selection resets its confirmation; simply reopening or saving an unchanged selection preserves it.

An Admin sees whether product use is pending or confirmed and can complete an In Progress appointment only after an officer has confirmed the review. The Admin does not repeat the product review. At completion, the server revalidates the confirmed quantities against locked, current stock, deducts inventory, logs appointment-linked transactions, and completes the appointment in one transaction. A unique appointment deduction record prevents duplicate deductions, and a failed operation rolls back the related changes.

Candidate labels that do not resolve uniquely to an existing service and product are intentionally skipped by the migration rather than mapped to a different catalog item.
