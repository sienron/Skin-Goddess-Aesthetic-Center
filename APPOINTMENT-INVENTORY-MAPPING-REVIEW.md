# Appointment inventory suggestions

The supplied service-product list is encoded as 321 distinct candidate pairs in `migrations/039-appointment-inventory-mappings.js`. Migration `040-enable-service-inventory-suggestions.js` enables or inserts only pairs whose service name and category and product name resolve uniquely in the existing catalog. It does not create services or products. Existing mapping quantities, review notes, and administrator attribution are preserved on reruns; newly inserted suggestions have no default quantity.

The six enabled candidates for **Anti-Aging Drip** are:

- Macroset (IV Set)
- 10cc Syringe
- 3cc Syringe
- Cannula
- Scalp Vein Set
- Sterile Water

These are suggestions, not a record of what was consumed during a particular appointment. The administrator must verify actual products and enter the actual quantities before confirmation. Quantities remain unconfirmed where none were explicitly configured.

The review modal preselects every enabled mapping regardless of current stock, shows its current stock, and labels zero stock as out of stock. Saved selections and quantities are retained when the review is reopened; missing inventory products cannot be retained and are reported. Drafts may preserve a selection whose current stock is insufficient so the administrator can review it, but final confirmation validates every selected quantity against locked, current stock. Invalid confirmation leaves the appointment and inventory unchanged. Successful deductions, transaction logging, and appointment completion run in one transaction, and a unique appointment deduction record prevents duplicate deductions.

Candidate labels that do not resolve uniquely to an existing service and product are intentionally skipped by the migration rather than mapped to a different catalog item.
