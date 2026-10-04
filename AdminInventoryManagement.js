(() => {
    const transactionBody = document.getElementById("transactionBody");
    const transactionFooter = document.getElementById("transactionFooter");
    const periodFilter = document.getElementById("transactionPeriodFilter");
    const typeFilter = document.getElementById("transactionTypeFilter");
    const transactionsExport = document.getElementById("exportTransactions");
    const inventoryExport = document.getElementById("exportInventory");
    let transactions = [];

    function getPeriodStart(period) {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        if (period === "week") {
            start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        } else if (period === "month") {
            start.setDate(1);
        }
        return start;
    }

    function getFilteredTransactions() {
        const selectedType = typeFilter.value;
        const transactionType = selectedType === "deduct-stock" ? "Used in Service" : selectedType;
        const periodStart = periodFilter.value === "all" ? null : getPeriodStart(periodFilter.value);

        return transactions.filter(transaction => {
            if (transactionType !== "all" && transaction.transaction_type !== transactionType) return false;
            if (!periodStart) return true;
            const date = new Date(transaction.created_at);
            return !Number.isNaN(date.getTime()) && date >= periodStart;
        });
    }

    function getTransactionClass(type) {
        switch (type) {
            case "Restock": return "restock";
            case "Used in Service": return "used";
            case "Expired":
            case "Deleted": return "disposed";
            default: return "adjustment";
        }
    }

    function renderTransactions() {
        const filteredTransactions = getFilteredTransactions();
        transactionBody.replaceChildren();

        if (!filteredTransactions.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 6;
            cell.textContent = transactions.length
                ? "No transactions match the selected filters."
                : "No transaction records found.";
            row.appendChild(cell);
            transactionBody.appendChild(row);
            transactionFooter.textContent = `Showing 0 of ${transactions.length} log entries`;
            return;
        }

        filteredTransactions.forEach(transaction => {
            const row = document.createElement("tr");
            const createdAt = new Date(transaction.created_at);
            const stockChange = Number(transaction.new_stock) - Number(transaction.previous_stock);
            const dateCell = document.createElement("td");
            const dateText = document.createElement("div");
            const timeText = document.createElement("small");
            dateText.textContent = Number.isNaN(createdAt.getTime())
                ? "Unknown date"
                : createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            timeText.textContent = Number.isNaN(createdAt.getTime())
                ? ""
                : createdAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            dateCell.append(dateText, timeText);

            const productCell = document.createElement("td");
            productCell.textContent = transaction.product_name || "Unknown product";

            const actionCell = document.createElement("td");
            const action = document.createElement("span");
            action.className = `transaction ${getTransactionClass(transaction.transaction_type)}`;
            action.textContent = transaction.transaction_type || "Unknown";
            actionCell.appendChild(action);

            const quantityCell = document.createElement("td");
            quantityCell.className = stockChange > 0
                ? "transaction-quantity-increase"
                : stockChange < 0 ? "transaction-quantity-decrease" : "";
            quantityCell.textContent = `${stockChange > 0 ? "+" : ""}${stockChange} unit${Math.abs(stockChange) === 1 ? "" : "s"}`;

            const stockCell = document.createElement("td");
            stockCell.textContent = `${transaction.new_stock} units`;

            const performerCell = document.createElement("td");
            performerCell.textContent = transaction.performed_by || "Unknown";
            row.append(dateCell, productCell, actionCell, quantityCell, stockCell, performerCell);
            transactionBody.appendChild(row);
        });

        transactionFooter.textContent = `Showing ${filteredTransactions.length} of ${transactions.length} log entries`;
    }

    function downloadCsv(filename, rows) {
        const csv = rows
            .map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
            .join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function loadTransactions() {
        try {
            const response = await fetch("/api/inventory/transactions");
            if (!response.ok) throw new Error("Failed to fetch transaction history.");
            const data = await response.json();
            transactions = Array.isArray(data) ? data : [];
            renderTransactions();
        } catch (error) {
            console.error("Error loading transaction history:", error);
            transactionBody.replaceChildren();
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 6;
            cell.textContent = "Unable to load transaction history.";
            row.appendChild(cell);
            transactionBody.appendChild(row);
            transactionFooter.textContent = "Transaction history could not be loaded";
        }
    }

    periodFilter.addEventListener("change", renderTransactions);
    typeFilter.addEventListener("change", renderTransactions);
    transactionsExport.addEventListener("click", () => {
        const rows = [["Date & Time", "Product", "Action", "Quantity Change", "Stock After", "Performed By"]];
        getFilteredTransactions().forEach(transaction => {
            const createdAt = new Date(transaction.created_at);
            const dateTime = Number.isNaN(createdAt.getTime()) ? "Unknown date" : createdAt.toLocaleString();
            const stockChange = Number(transaction.new_stock) - Number(transaction.previous_stock);
            rows.push([dateTime, transaction.product_name, transaction.transaction_type, stockChange, transaction.new_stock, transaction.performed_by]);
        });
        downloadCsv("stock-transaction-log.csv", rows);
    });

    inventoryExport.addEventListener("click", async () => {
        try {
            const response = await fetch("/api/inventory");
            if (!response.ok) throw new Error("Failed to fetch inventory.");
            const products = await response.json();
            const rows = [["Product Name", "Category", "Stock", "Expiry Date"]];
            products.forEach(product => rows.push([
                product.product_name,
                product.category,
                product.stock_quantity,
                product.expiry_date || "No Expiration"
            ]));
            downloadCsv("inventory-products.csv", rows);
        } catch (error) {
            console.error("Error exporting inventory:", error);
            alert("Inventory could not be exported. Please try again.");
        }
    });

    loadTransactions();
})();