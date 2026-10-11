async function recordInventoryTransaction(client, {
  productId,
  productName,
  transactionType,
  quantity,
  previousStock,
  newStock,
  userId,
  appointmentId = null,
}) {
  await client.query(`
    INSERT INTO inventory_transactions
      (product_id, product_name, transaction_type, quantity, previous_stock,
       new_stock, created_by, created_at, appointment_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
  `, [
    productId,
    productName,
    transactionType,
    quantity,
    previousStock,
    newStock,
    userId,
    appointmentId,
  ]);
}

module.exports = { recordInventoryTransaction };
