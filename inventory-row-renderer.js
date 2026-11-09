(function initializeInventoryRowRenderer(global) {
    function createInventoryProductRow(product, status, statusLabel) {
        const row = document.createElement("tr");
        row.dataset.id = product.product_id;
        row.dataset.category = product.category;
        row.dataset.stock = product.stock_quantity;
        row.dataset.expiry = product.expiry_date || "none";
        row.dataset.status = status;

        const nameCell = document.createElement("td");
        const name = document.createElement("div");
        name.className = "product-name";
        name.textContent = product.product_name;
        nameCell.appendChild(name);
        row.appendChild(nameCell);

        const categoryCell = document.createElement("td");
        categoryCell.textContent = product.category;
        row.appendChild(categoryCell);

        const stockCell = document.createElement("td");
        const stockControl = document.createElement("div");
        stockControl.className = "stock-control";
        const stockNumber = document.createElement("span");
        stockNumber.className = "stock-number";
        stockNumber.textContent = product.stock_quantity;
        stockControl.appendChild(stockNumber);
        stockControl.appendChild(createButton("action-btn decrease", "Remove stock", "−"));
        stockControl.appendChild(createButton("action-btn increase", "Add stock", "+"));
        stockCell.appendChild(stockControl);
        row.appendChild(stockCell);

        const expiryCell = document.createElement("td");
        expiryCell.textContent = product.expiry_date || "No Expiration";
        row.appendChild(expiryCell);

        const statusCell = document.createElement("td");
        const statusElement = document.createElement("div");
        statusElement.className = `status ${status === "low" ? "low-stock" : status}`;
        statusElement.appendChild(document.createElement("span"));
        statusElement.appendChild(document.createTextNode(` ${statusLabel.toUpperCase()}`));
        statusCell.appendChild(statusElement);
        row.appendChild(statusCell);

        const actionsCell = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "action-buttons";
        actions.appendChild(createButton("action-btn edit", "Edit product", "Edit"));
        actions.appendChild(createButton("action-btn delete", "Delete product", "×"));
        actionsCell.appendChild(actions);
        row.appendChild(actionsCell);

        return row;
    }

    function createButton(className, title, label) {
        const button = document.createElement("button");
        button.className = className;
        button.type = "button";
        button.title = title;
        button.textContent = label;
        return button;
    }

    global.InventoryRowRenderer = { createInventoryProductRow };
}(window));
