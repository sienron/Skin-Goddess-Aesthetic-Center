const transactionBody = document.getElementById("transactionBody");
const transactionFooter = document.getElementById("transactionFooter");
const transactionPeriodFilter = document.getElementById("transactionPeriodFilter");
const transactionTypeFilter = document.getElementById("transactionTypeFilter");

let transactions = [];
let isLoadingTransactions = false;

function getPeriodStart(period){
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === "week") {
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    } else if (period === "month") {
        start.setDate(1);
    }

    return start;
}

function getFilteredTransactions(){
    const period = transactionPeriodFilter.value;
    const type = transactionTypeFilter.value;
    const transactionType = type === "deduct-stock" ? "Used in Service" : type;
    const periodStart = period === "all" ? null : getPeriodStart(period);

    return transactions.filter(transaction => {
        if (transactionType !== "all" && transaction.transaction_type !== transactionType) return false;
        if (!periodStart) return true;

        const date = new Date(transaction.created_at);
        return !Number.isNaN(date.getTime()) && date >= periodStart;
    });
}

function getTransactionClass(type){
    switch (type) {
        case "Restock": return "restock";
        case "Used in Service": return "used";
        case "Adjustment": return "adjustment";
        case "Expired": return "disposed";
        case "Deleted": return "deleted";
        default: return "adjustment";
    }
}

function renderTransactions(){
    const filteredTransactions = getFilteredTransactions();
    transactionBody.replaceChildren();

    if (!filteredTransactions.length) {
        const row = document.createElement("tr");
        const message = document.createElement("td");
        message.colSpan = 6;
        message.textContent = transactions.length
            ? "No transactions match the selected filters."
            : "No transaction records found.";
        row.appendChild(message);
        transactionBody.appendChild(row);
        transactionFooter.textContent = `Showing 0 of ${transactions.length} log entries`;
        return;
    }

    filteredTransactions.forEach(transaction => {
        const row = document.createElement("tr");
        const createdAt = new Date(transaction.created_at);
        const dateCell = document.createElement("td");
        const dateText = document.createElement("div");
        const timeText = document.createElement("small");

        dateText.textContent = Number.isNaN(createdAt.getTime())
            ? "Unknown date"
            : createdAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric"
            });
        timeText.textContent = Number.isNaN(createdAt.getTime())
            ? ""
            : createdAt.toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit"
            });
        dateCell.append(dateText, timeText);

        const productCell = document.createElement("td");
        productCell.textContent = transaction.product_name || "Unknown product";

        const actionCell = document.createElement("td");
        const action = document.createElement("span");
        action.className = `transaction ${getTransactionClass(transaction.transaction_type)}`;
        action.textContent = transaction.transaction_type;
        actionCell.appendChild(action);

        const stockChange = Number(transaction.new_stock) - Number(transaction.previous_stock);
        const quantityCell = document.createElement("td");
        quantityCell.className = stockChange > 0
            ? "transaction-quantity-increase"
            : stockChange < 0
                ? "transaction-quantity-decrease"
                : "";
        quantityCell.textContent = `${stockChange > 0 ? "+" : ""}${stockChange} unit${Math.abs(stockChange) === 1 ? "" : "s"}`;

        const stockCell = document.createElement("td");
        stockCell.textContent = `${transaction.new_stock} units`;

        const performedByCell = document.createElement("td");
        performedByCell.textContent = transaction.performed_by || "Unknown";

        row.append(dateCell, productCell, actionCell, quantityCell, stockCell, performedByCell);
        transactionBody.appendChild(row);
    });

    transactionFooter.textContent = `Showing ${filteredTransactions.length} of ${transactions.length} log entries`;
}

async function loadTransactions(){
    if (isLoadingTransactions) return;
    isLoadingTransactions = true;

    try {
        const response = await fetch("/api/inventory/transactions", { cache: "no-store" });
        if (!response.ok) {
            throw new Error("Failed to fetch transaction history.");
        }

        transactions = await response.json();
        renderTransactions();
    } catch (error) {
        console.error("Error loading transaction history:", error);
        transactionBody.replaceChildren();
        const row = document.createElement("tr");
        const message = document.createElement("td");
        message.colSpan = 6;
        message.textContent = "Unable to load transaction history.";
        row.appendChild(message);
        transactionBody.appendChild(row);
        transactionFooter.textContent = "Transaction history could not be loaded";
    } finally {
        isLoadingTransactions = false;
    }
}

transactionPeriodFilter.addEventListener("change", renderTransactions);
transactionTypeFilter.addEventListener("change", renderTransactions);

document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("invSidebar").classList.toggle("sidebar-open");
    document.getElementById("sidebarBackdrop").classList.toggle("show");
});

document.getElementById("sidebarBackdrop").addEventListener("click", () => {
    document.getElementById("invSidebar").classList.remove("sidebar-open");
    document.getElementById("sidebarBackdrop").classList.remove("show");
});

loadTransactions();
window.setInterval(loadTransactions, 5000);
