/* =========================================================
   INVENTORY MANAGEMENT JAVASCRIPT
   ========================================================= */

const searchInput = document.getElementById("searchInput");

const categoryFilter = document.getElementById("categoryFilter");
const stockFilter = document.getElementById("stockFilter");
const expiryFilter = document.getElementById("expiryFilter");
const statusFilter = document.getElementById("statusFilter");

const clearFilters = document.getElementById("clearFilters");

const inventoryBody = document.getElementById("inventoryBody");
const categoryStock = document.getElementById("categoryStock");
const lowStockAlerts = document.getElementById("lowStockAlerts");

const inventoryCategories = [
    { name: "Medical/Injection Supplies", label: "Medical Supplies" },
    { name: "Disposables & Clinic Consumables", label: "Consumables" },
    { name: "Facial/Treatment Prep Products", label: "Treatment Prep" },
    { name: "Facial Treatment Products (Professional Use)", label: "Professional" },
    { name: "Skincare Products (Retail / Aftercare)", label: "Retail" },
    { name: "Soaps & Cleansers", label: "Cleansers" },
    { name: "Tools/Equipment/Misc.", label: "Equipment" }
];

const totalProducts = document.getElementById("totalProducts");
const restockedToday = document.getElementById("restockedToday");
const deductedToday = document.getElementById("deductedToday");

const lowStockCount = document.getElementById("lowStockCount");
const lowStockToday = document.getElementById("lowStockToday");

const totalProductsCard = document.getElementById("totalProductsCard");
const lowStockCard = document.getElementById("lowStockCard");
const criticalStockCard = document.getElementById("criticalStockCard");
const outOfStockCard = document.getElementById("outOfStockCard");
const expiringSoonCard = document.getElementById("expiringSoonCard");

const criticalStockCount = document.getElementById("criticalStockCount");
const criticalStockToday = document.getElementById("criticalStockToday");

const outOfStockCount = document.getElementById("outOfStockCount");
const outOfStockToday = document.getElementById("outOfStockToday");

const expiringSoonCount = document.getElementById("expiringSoonCount");

const deleteModal = document.getElementById("deleteModal");
const deleteProductName = document.getElementById("deleteProductName");
const cancelDelete = document.getElementById("cancelDelete");
const confirmDelete = document.getElementById("confirmDelete");




const editModal =
    document.getElementById("editModal");

const closeEditModal =
    document.getElementById("closeEditModal");

const cancelEdit =
    document.getElementById("cancelEdit");

const saveEdit =
    document.getElementById("saveEdit");

const editProductName =
    document.getElementById("editProductName");

const editCategory =
    document.getElementById("editCategory");

const editExpiryDate =
    document.getElementById("editExpiryDate");

const editNoExpiration =
    document.getElementById("editNoExpiration");

const editStock =
    document.getElementById("editStock");

//ADD PRODUCT
const addProductButton =
    document.querySelector(".btn-add-product");

const addProductModal =
    document.getElementById("addProductModal");

const closeAddProductModal =
    document.getElementById("closeAddProductModal");

const cancelAddProduct =
    document.getElementById("cancelAddProduct");

const addExpiryDate =
    document.getElementById("addExpiryDate");

const addNoExpiration =
    document.getElementById("addNoExpiration");

const confirmAddProduct =
    document.getElementById("confirmAddProduct");

const addProductName =
    document.getElementById("addProductName");

const addCategory =
    document.getElementById("addCategory");

const addStock =
    document.getElementById("addStock");

function getEarliestExpirationDate(){
    const earliestDate = new Date();
    earliestDate.setDate(earliestDate.getDate() + 1);

    const year = earliestDate.getFullYear();
    const month = String(earliestDate.getMonth() + 1).padStart(2, "0");
    const day = String(earliestDate.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function setExpirationDateMinimum(){
    const minimumDate = getEarliestExpirationDate();
    addExpiryDate.min = minimumDate;
    editExpiryDate.min = minimumDate;
}

setExpirationDateMinimum();


let productToDelete = null;

let inventoryProducts = [];
let inventoryThresholds = null;

//getting Inventory data from Postgres after communicating with Express

async function loadInventory(){
    console.log("NEW INVENTORY JS IS RUNNING");

    try{

        const thresholdsResponse = await fetch("/api/inventory/thresholds");
        if(!thresholdsResponse.ok){
            throw new Error("Failed to fetch inventory thresholds.");
        }
        inventoryThresholds = await thresholdsResponse.json();

        const lowStockOption = stockFilter.querySelector('[value="low"]');
        if(lowStockOption){
            lowStockOption.textContent = `1–${inventoryThresholds.lowStock}`;
        }

        const response =
            await fetch("/api/inventory");

        if(!response.ok){

            throw new Error(
                "Failed to fetch inventory."
            );

        }

        inventoryProducts = await response.json();

        console.log(
            "Inventory loaded:",
            inventoryProducts
        );

        const totalStock = inventoryProducts.reduce(
            (total, product) => total + Number(product.stock_quantity),
            0
        );
        
        console.log("TOTAL STOCK:", totalStock);

        totalProducts.textContent = totalStock;
        
        renderInventory();

//added

    }

    catch(error){

        console.error(
            "Error loading inventory:",
            error
        );

    }

}

async function loadRestockedToday(){

    try{

        const response =
            await fetch("/api/inventory/restocked-today");

        if(!response.ok){

            throw new Error(
                "Failed to fetch today's restocks."
            );

        }

        const data =
            await response.json();

            

        restockedToday.textContent =
        `↑ ${data.total_restocked} ${data.total_restocked === 1 ? "unit" : "units"} restocked today`;

    }

    catch(error){

        console.error(
            "Error loading today's restocks:",
            error
        );

        restockedToday.textContent =
            "↑ 0 units restocked today";

    }

}

async function loadDeductedToday() {
    try {
        const response = await fetch("/api/inventory/deducted-today");

        if (!response.ok) {
            throw new Error("Failed to fetch deducted units.");
        }

        const data = await response.json();

        deductedToday.textContent =
            `↓ ${data.total_deducted} unit${data.total_deducted === 1 ? "" : "s"} deducted today`;

    } catch (error) {
        console.error("Error loading deducted units:", error);
    }
}

async function loadLowStockToday() {
    try {
        const response = await fetch("/api/inventory/low-stock-today");

        if (!response.ok) {
            throw new Error("Failed to fetch today's low-stock count.");
        }

        const data = await response.json();

        lowStockToday.textContent =
            `↑ ${data.new_low_stock} new today`;

    } catch (error) {
        console.error("Error loading today's low-stock count:", error);
    }
}

async function loadLowStockCount() {
    try {
        const response = await fetch("/api/inventory");

        if (!response.ok) {
            throw new Error("Failed to fetch inventory.");
        }

        const products = await response.json();

        const lowStockProducts = products.filter(product => {
            const stock = Number(product.stock_quantity);

            return (
                stock > inventoryThresholds.criticalStock &&
                stock <= inventoryThresholds.lowStock
            );
        });

        lowStockCount.textContent = lowStockProducts.length;

    } catch (error) {
        console.error("Error loading low-stock count:", error);
    }
}

async function loadCriticalStockCount() {
    try {
        const response = await fetch("/api/inventory");

        if (!response.ok) {
            throw new Error("Failed to fetch inventory.");
        }

        const products = await response.json();

        const criticalStockProducts = products.filter(product => {
            const stock = Number(product.stock_quantity);

            return (
                stock > 0 &&
                stock <= inventoryThresholds.criticalStock
            );
        });

        criticalStockCount.textContent = criticalStockProducts.length;

    } catch (error) {
        console.error("Error loading critical-stock count:", error);
    }
}



async function loadCriticalStockToday() {
    try {
        const response = await fetch("/api/inventory/critical-stock-today");

        if (!response.ok) {
            throw new Error("Failed to fetch today's critical-stock count.");
        }

        const data = await response.json();

        criticalStockToday.textContent =
            `↑ ${data.new_critical_stock} new today`;

    } catch (error) {
        console.error(
            "Error loading today's critical-stock count:",
            error
        );
    }
}

async function loadOutOfStockCount() {
    try {
        const response = await fetch("/api/inventory");

        if (!response.ok) {
            throw new Error("Failed to fetch inventory.");
        }

        const products = await response.json();

        const outOfStockProducts = products.filter(product => {
            return Number(product.stock_quantity) === 0;
        });

        outOfStockCount.textContent = outOfStockProducts.length;

    } catch (error) {
        console.error("Error loading out-of-stock count:", error);
    }
}

async function loadOutOfStockToday() {
    try {
        const response = await fetch("/api/inventory/out-of-stock-today");

        if (!response.ok) {
            throw new Error("Failed to fetch today's out-of-stock count.");
        }

        const data = await response.json();

        outOfStockToday.textContent =
            `↑ ${data.new_out_of_stock} new today`;

    } catch (error) {
        console.error(
            "Error loading today's out-of-stock count:",
            error
        );
    }
}

async function loadExpiringSoonCount() {
    try {
        const response = await fetch("/api/inventory");

        if (!response.ok) {
            throw new Error("Failed to fetch inventory.");
        }

        const products = await response.json();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const thirtyDaysFromNow = new Date(today);
        thirtyDaysFromNow.setDate(
            thirtyDaysFromNow.getDate() + 30
        );

        const expiringProducts = products.filter(product => {

            if (!product.expiry_date) {
                return false;
            }

            const [year, month, day] =
                product.expiry_date.split("-").map(Number);

            const expiryDate =
                new Date(year, month - 1, day);

            expiryDate.setHours(0, 0, 0, 0);

            return (
                expiryDate >= today &&
                expiryDate <= thirtyDaysFromNow
            );
        });

        expiringSoonCount.textContent =
            expiringProducts.length;

    } catch (error) {

        console.error(
            "Error loading expiring-soon count:",
            error
        );

    }
}

//translate JSON to JS table row
function renderInventory(){

    inventoryBody.innerHTML = "";

    inventoryProducts.forEach(product => {

        const row = document.createElement("tr");
        row.dataset.id = product.product_id;

        row.dataset.category = product.category;
        row.dataset.stock = product.stock_quantity;
        row.dataset.expiry =
            product.expiry_date || "none";

            let status;
            let statusClass;
            
            if(product.stock_quantity === 0){
            
                status = "out-of-stock";
                statusClass = "out-of-stock";
            
            }
            else if(product.stock_quantity <= inventoryThresholds.criticalStock){
            
                status = "critical";
                statusClass = "critical";
            
            }
            else if(product.stock_quantity <= inventoryThresholds.lowStock){
            
                status = "low";
                statusClass = "low-stock";
            
            }
            else{
            
                status = "in-stock";
                statusClass = "in-stock";
            
            }
            
            row.dataset.status = status;


        row.innerHTML = `
            <td>
                <div class="product-name">
                    ${product.product_name}
                </div>
            </td>

            <td>
                ${product.category}
            </td>

            <td>
                <div class="stock-control">

                    <span class="stock-number">
                        ${product.stock_quantity}
                    </span>

                    <button
                        class="action-btn decrease"
                        type="button"
                        title="Remove stock"
                    >
                        −
                    </button>

                    <button
                        class="action-btn increase"
                        type="button"
                        title="Add stock"
                    >
                        +
                    </button>

                </div>
            </td>

            <td>
                ${
                    product.expiry_date
                        ? product.expiry_date
                        : "No Expiration"
                }
            </td>

            <td>
                <div class="status ${statusClass}">
                    <span></span>
                    ${
                        status === "out-of-stock"
                            ? "OUT OF STOCK"
                            : status === "critical"
                                ? "CRITICAL"
                                : status === "low"
                                    ? "LOW STOCK"
                                    : "IN STOCK"
                    }
                </div>
            </td>

            <td>
            <div class="action-buttons">

                <button
                    class="action-btn edit"
                    type="button"
                    title="Edit product"
                >
                    Edit
                </button>

                <button
                    class="action-btn delete"
                    type="button"
                    title="Delete product"
                >
                    ×
                </button>

            </div>
        </td>
        `;

        inventoryBody.appendChild(row);

    });

    renderInventorySidebar();

}

function renderInventorySidebar(){
    categoryStock.replaceChildren();

    inventoryCategories.forEach(category => {
        const products = inventoryProducts.filter(
            product => product.category === category.name
        );
        const availableProducts = products.filter(
            product => Number(product.stock_quantity) > 0
        ).length;
        const percentage = products.length
            ? Math.round((availableProducts / products.length) * 100)
            : 0;

        const row = document.createElement("div");
        row.className = "category-row";

        const label = document.createElement("span");
        label.textContent = category.label;

        const progress = document.createElement("div");
        progress.className = "progress";
        progress.setAttribute("role", "progressbar");
        progress.setAttribute(
            "aria-label",
            `${category.label}: ${percentage}% of products available`
        );
        progress.setAttribute("aria-valuemin", "0");
        progress.setAttribute("aria-valuemax", "100");
        progress.setAttribute("aria-valuenow", String(percentage));

        const fill = document.createElement("div");
        fill.style.width = `${percentage}%`;
        progress.appendChild(fill);

        const value = document.createElement("strong");
        value.textContent = `${percentage}%`;

        row.append(label, progress, value);
        categoryStock.appendChild(row);
    });

    const alerts = inventoryProducts
        .map(product => {
            const stock = Number(product.stock_quantity);
            if (stock <= 0 || stock > inventoryThresholds.lowStock) return null;

            return {
                product,
                stock,
                critical: stock <= inventoryThresholds.criticalStock,
                since: Date.parse(product.stock_status_since || "") || 0
            };
        })
        .filter(Boolean)
        .sort((first, second) => second.since - first.since);

    lowStockAlerts.replaceChildren();

    if (!alerts.length) {
        const emptyState = document.createElement("p");
        emptyState.className = "empty-stock-alerts";
        emptyState.textContent = "No low-stock products";
        lowStockAlerts.appendChild(emptyState);
        return;
    }

    alerts.forEach(({ product, stock, critical }) => {
        const item = document.createElement("div");
        item.className = `alert-item${critical ? " critical-alert" : ""}`;

        const details = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = product.product_name;
        const stockDetails = document.createElement("small");
        const expiry = product.expiry_date
            ? ` · Expires ${new Date(`${product.expiry_date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : " · No expiration";
        stockDetails.textContent = `${stock} unit${stock === 1 ? "" : "s"}${expiry}`;
        details.append(name, stockDetails);

        const badge = document.createElement("span");
        badge.textContent = critical ? "CRIT" : "LOW";

        item.append(details, badge);
        lowStockAlerts.appendChild(item);
    });
}

/* =========================================================
   SEARCH + FILTER
   ========================================================= */

function filterInventory(){

    const summaryEmptyState =
        inventoryBody.querySelector(".summary-empty-state");

    if(summaryEmptyState){
        summaryEmptyState.remove();
    }

    const searchValue =
        searchInput.value.toLowerCase().trim();

        const categoryValue =
        categoryFilter.value.toLowerCase();

    const stockValue =
        stockFilter.value;

    const expiryValue =
        expiryFilter.value;

    const statusValue =
        statusFilter.value;


    const rows =
        inventoryBody.querySelectorAll("tr");


    rows.forEach(row => {

        const productName =
            row.querySelector(".product-name")
                .textContent
                .toLowerCase();

        const category =
            row.dataset.category.toLowerCase();

        const stock =
            Number(row.dataset.stock);

        const expiry =
            row.dataset.expiry.toLowerCase();

        const status =
            row.dataset.status.toLowerCase();


        /* SEARCH */

        const matchesSearch =
            productName.includes(searchValue) ||
            category.includes(searchValue) ||
            String(stock).includes(searchValue) ||
            expiry.includes(searchValue) ||
            status.includes(searchValue);


        /* CATEGORY */

        const matchesCategory =
            categoryValue === "all" || category === categoryValue;


        /* STOCK */

        let matchesStock = true;

        if(stockValue !== "all"){

            if(stockValue === "0"){
                matchesStock = stock === 0;
            }

            else if(stockValue === "low"){
                matchesStock =
                    stock > inventoryThresholds.criticalStock &&
                    stock <= inventoryThresholds.lowStock;
            }

            else if(stockValue === "21-40"){
                matchesStock = stock >= 21 && stock <= 40;
            }

            else if(stockValue === "41-60"){
                matchesStock = stock >= 41 && stock <= 60;
            }

            else if(stockValue === "61-80"){
                matchesStock = stock >= 61 && stock <= 80;
            }

            else if(stockValue === "81-100"){
                matchesStock = stock >= 81 && stock <= 100;
            }
        }


        /* EXPIRATION */

        let matchesExpiry = true;

        if(expiryValue !== "all"){

            if(expiryValue === "none"){

                matchesExpiry =
                    expiry === "none";
            }

            else{

                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const [year, month, day] = expiry.split("-").map(Number);
                const expiryDate = new Date(year, month - 1, day);
                expiryDate.setHours(0, 0, 0, 0);

                const difference = expiryDate - today;
                const days = difference / (1000 * 60 * 60 * 24);


                if(expiryValue === "expired"){

                    matchesExpiry =
                        days < 0;
                }

                else if(expiryValue === "30"){

                    matchesExpiry =
                        days >= 0 &&
                        days <= 30;
                }

                else if(expiryValue === "60"){

                    matchesExpiry =
                        days > 30 &&
                        days <= 60;
                }

                else if(expiryValue === "90"){

                    matchesExpiry =
                        days > 60 &&
                        days <= 90;
                }

                else if(expiryValue === "over90"){

                    matchesExpiry =
                        days > 90;
                }
            }
        }


        /* STATUS */

        const matchesStatus =
            statusValue === "all" ||
            status === statusValue;


        /* FINAL RESULT */

        if(
            matchesSearch &&
            matchesCategory &&
            matchesStock &&
            matchesExpiry &&
            matchesStatus
        ){

            row.style.display = "";

        }

        else{

            row.style.display = "none";

        }

    });

}

function showSummaryEmptyState(countElement, message){

    const countText = countElement.textContent.trim();
    const count = Number(countText);

    if(!countText || !Number.isFinite(count) || count !== 0){
        return;
    }

    const row = document.createElement("tr");
    row.className = "summary-empty-state";

    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = message;

    row.appendChild(cell);
    inventoryBody.appendChild(row);

}

lowStockCard.addEventListener("click", () => {

    // Clear existing filters
    searchInput.value = "";
    categoryFilter.value = "all";
    stockFilter.value = "all";
    expiryFilter.value = "all";

    // Show only low-stock products
    statusFilter.value = "low";

    filterInventory();

    showSummaryEmptyState(
        lowStockCount,
        "No low stock items found."
    );

    // Focus on the inventory table
    document
        .querySelector(".inventory-table-container")
        .scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

});

criticalStockCard.addEventListener("click", () => {

    // Clear existing filters
    searchInput.value = "";
    categoryFilter.value = "all";
    stockFilter.value = "all";
    expiryFilter.value = "all";

    // Show only critical-stock products
    statusFilter.value = "critical";

    filterInventory();

    showSummaryEmptyState(
        criticalStockCount,
        "No critical stock items found."
    );

    // Focus on the inventory table
    document
        .querySelector(".inventory-table-container")
        .scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

});

outOfStockCard.addEventListener("click", () => {

    // Clear existing filters
    searchInput.value = "";
    categoryFilter.value = "all";
    stockFilter.value = "all";
    expiryFilter.value = "all";

    // Show only out-of-stock products
    statusFilter.value = "out-of-stock";

    filterInventory();

    showSummaryEmptyState(
        outOfStockCount,
        "No out-of-stock items found."
    );

    // Focus on the inventory table
    document
        .querySelector(".inventory-table-container")
        .scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

});

expiringSoonCard.addEventListener("click", () => {

    // Clear existing filters
    searchInput.value = "";
    categoryFilter.value = "all";
    stockFilter.value = "all";
    statusFilter.value = "all";

    // Show products expiring within 30 days
    expiryFilter.value = "30";

    filterInventory();

    showSummaryEmptyState(
        expiringSoonCount,
        "No products are expiring within 30 days."
    );

    // Focus on the inventory table
    document
        .querySelector(".inventory-table-container")
        .scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

});

totalProductsCard.addEventListener("click", () => {

    // Clear all filters
    searchInput.value = "";
    categoryFilter.value = "all";
    stockFilter.value = "all";
    expiryFilter.value = "all";
    statusFilter.value = "all";

    // Show all products
    filterInventory();

    showSummaryEmptyState(
        totalProducts,
        "No products found."
    );

    // Focus on the inventory table
    document
        .querySelector(".inventory-table-container")
        .scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

});

/* =========================================================
   FILTER EVENT LISTENERS
   ========================================================= */

searchInput.addEventListener("input",filterInventory);

categoryFilter.addEventListener("change",filterInventory);

stockFilter.addEventListener("change",filterInventory);

expiryFilter.addEventListener("change",filterInventory);

statusFilter.addEventListener("change",filterInventory);


/* =========================================================
   CLEAR FILTERS
   ========================================================= */

clearFilters.addEventListener("click", () => {

    searchInput.value = "";

    categoryFilter.value = "all";
    stockFilter.value = "all";
    expiryFilter.value = "all";
    statusFilter.value = "all";

    filterInventory();

});


/* =========================================================
   ADD / MINUS STOCK
   ========================================================= */

   inventoryBody.addEventListener("click", async function(event){

    const button = event.target.closest(".action-btn");

    if(!button) return;

    const row = button.closest("tr");

    const stockNumber =
        row.querySelector(".stock-number");

    let stock =
        Number(stockNumber.textContent);


    /* =====================================================
       ADD STOCK
       ===================================================== */

    if(button.classList.contains("increase")){

        stock++;

        updateStock(row, stock);

        return;
    }


    /* =====================================================
       REMOVE STOCK
       ===================================================== */

    if(button.classList.contains("decrease")){

        if(stock > 0){

            stock--;

            updateStock(row, stock);

        }

        return;
    }


    /* =====================================================
       EDIT PRODUCT
       ===================================================== */

if(button.classList.contains("edit")){

    const productId =
        row.dataset.id;

    const product =
        inventoryProducts.find(
            item => item.product_id == productId
        );

    if(!product) return;

    setExpirationDateMinimum();

    /* Product Name */

    editProductName.value = product.product_name;

    editModal.dataset.productId = productId;


    /* Category */

    editCategory.value =
        product.category;


    /* Stock */

    editStock.value =
        product.stock_quantity;


    /* Expiration */

    if(product.expiry_date){

        editNoExpiration.checked =
            false;

        editExpiryDate.value =
            product.expiry_date;

        editExpiryDate.disabled =
            false;

    }

    else{

        editNoExpiration.checked =
            true;

        editExpiryDate.value =
            "";

        editExpiryDate.disabled =
            true;

    }

    editModal.dataset.originalExpiryDate =
        product.expiry_date || "";

    editModal.classList.add("show");

    return;
}




    /* =====================================================
       DELETE PRODUCT
       ===================================================== */

    if(button.classList.contains("delete")){

        const productName =
            row.querySelector(".product-name")
                .textContent
                .trim();

        const productId =
            row.dataset.id;

        productToDelete = {
            product_id: productId,
            product_name: productName
        };

        deleteProductName.textContent =
            productName;

        deleteModal.classList.add("show");

        return;
    }

});

//cancel button in DELETE MODAL
cancelDelete.addEventListener("click", () => {

    deleteModal.classList.remove("show");

    productToDelete = null;

});

confirmDelete.addEventListener("click", async () => {

    if(!productToDelete){
        return;
    }

    try{

        const response = await fetch(
            `/api/inventory/${productToDelete.product_id}`,
            {
                method: "DELETE"
            }
        );

        if(!response.ok){

            const errorData =
                await response.json();

            throw new Error(
                errorData.message ||
                "Failed to delete product."
            );

        }

        const result =
            await response.json();

        console.log(
            "Product deleted:",
            result
        );

        deleteModal.classList.remove("show");

        productToDelete = null;

        await loadInventory();
        await loadRestockedToday();
        await loadDeductedToday();
        await loadLowStockToday();
        await loadLowStockCount();
        await loadCriticalStockToday();
        await loadCriticalStockCount();
        await loadExpiringSoonCount();

    } catch(error){

        console.error(
            "Error deleting product:",
            error
        );

        alert(
            "Failed to delete product. Please try again."
        );

    }

});

deleteModal.addEventListener("click", (event) => {

    if(event.target === deleteModal){

        deleteModal.classList.remove("show");

        productToDelete = null;

    }

});

//NO EXPIRY RADIO BUTTON

editNoExpiration.addEventListener("change", () => {

    if(editNoExpiration.checked){

        editExpiryDate.value = "";
        editExpiryDate.disabled = true;

    }

    else{

        editExpiryDate.disabled = false;

    }

});

closeEditModal.addEventListener("click", () => {

    editModal.classList.remove("show");

});

cancelEdit.addEventListener("click", () => {

   editModal.classList.remove("show");

});

//Add Product event listeners =========================================

addProductButton.addEventListener("click", () => {

    setExpirationDateMinimum();

    addProductName.value = "";

    addCategory.value =
        "Medical/Injection Supplies";

    addExpiryDate.value = "";

    addNoExpiration.checked = false;

    addExpiryDate.disabled = false;

    addStock.value = 0;

    addProductModal.classList.add("show");

});

closeAddProductModal.addEventListener("click", () => {

    addProductModal.classList.remove("show");

});

cancelAddProduct.addEventListener("click", () => {

    addProductModal.classList.remove("show");

});

addProductModal.addEventListener("click", (event) => {

    if(event.target === addProductModal){

        addProductModal.classList.remove("show");

    }

});

addNoExpiration.addEventListener("change", () => {

    if(addNoExpiration.checked){

        addExpiryDate.value = "";
        addExpiryDate.disabled = true;

    } else {

        addExpiryDate.disabled = false;

    }

});

confirmAddProduct.addEventListener("click", async () => {

    const productName = addProductName.value.trim();
    const category = addCategory.value;
    const stock = Number(addStock.value);

    const expiryDate =
        addNoExpiration.checked
            ? null
            : addExpiryDate.value || null;

    // Check product name
    if(productName === ""){
        alert("Product name is required.");
        return;
    }

    // Check stock
    if(!Number.isInteger(stock) || stock < 0){
        alert("Stock must be a non-negative integer.");
        return;
    }

    if(expiryDate && expiryDate < getEarliestExpirationDate()){
        alert("Expiration date must be tomorrow or later.");
        return;
    }

    try {

        const response = await fetch("/api/inventory", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                product_name: productName,
                category: category,
                stock: stock,
                expiry_date: expiryDate
            })
        });

        if(!response.ok){

            const errorData = await response.json();

            throw new Error(
                errorData.message ||
                "Failed to add product."
            );
        }

        const newProduct = await response.json();

        console.log(
            "Product added:",
            newProduct
        );

        addProductModal.classList.remove("show");

        await loadInventory();
        await loadRestockedToday();
        await loadDeductedToday();
        await loadLowStockToday();
        await loadLowStockCount();
        await loadCriticalStockToday();
        await loadCriticalStockCount();
        await loadOutOfStockCount();
        await loadOutOfStockToday();
        await loadExpiringSoonCount();

    } catch(error) {

        console.error(
            "Error adding product:",
            error
        );

        alert(
            "Failed to add product. Please try again."
        );
    }

});



/* =========================================================
   SAVE EDIT
   ========================================================= */

   saveEdit.addEventListener("click", async () => {

    // Get the product currently being edited
    const productName = editProductName.value.trim();
    const category = editCategory.value;
    const stock = Number(editStock.value);

    // Get expiration date
    const expiryDate =
        editNoExpiration.checked
            ? null
            : editExpiryDate.value || null;


    // Basic validation
    if(productName === ""){

        alert("Product name is required.");
        return;

    }

    if(!Number.isInteger(stock) || stock < 0){

        alert("Stock must be a non-negative integer.");
        return;

    }

    const originalExpiryDate =
        editModal.dataset.originalExpiryDate || "";

    if(
        expiryDate &&
        expiryDate < getEarliestExpirationDate() &&
        expiryDate !== originalExpiryDate
    ){
        alert("Expiration date must be tomorrow or later.");
        return;
    }

    // Find the product ID from the open modal
    const productId =
    editModal.dataset.productId;

    if(!productId){

        alert("Product could not be identified.");
        return;

}


    try{

        const response = await fetch(
            `/api/inventory/${productId}`,
            {
                method: "PUT",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    product_name: productName,
                    category: category,
                    stock: stock,
                    expiry_date: expiryDate
                })
            }
        );


        if(!response.ok){

            const errorData =
                await response.json();

            throw new Error(
                errorData.message ||
                "Failed to update product."
            );

        }


        const updatedProduct =
            await response.json();

        console.log(
            "Product updated:",
            updatedProduct
        );


        // Close modal
        editModal.classList.remove("show");


        // Reload inventory from PostgreSQL
        await loadInventory();

        // Reload today's restocked total
        await loadRestockedToday();

        await loadDeductedToday();

    } catch(error){

        console.error(
            "Error updating product:",
            error
        );

        alert(
            "Failed to update product. Please try again."
        );

    }

    await loadInventory();
    await loadRestockedToday();
    await loadDeductedToday();
    await loadLowStockToday();
    await loadLowStockCount();
    await loadCriticalStockToday();
    await loadCriticalStockCount();
    await loadOutOfStockCount();
    await loadOutOfStockToday();
    await loadExpiringSoonCount();  

});

/* =========================================================
   UPDATE STOCK
   ========================================================= */

   async function updateStock(row, stock){

    const productId =
        row.dataset.id;


    try {

        const response =
            await fetch(`/api/inventory/${productId}/stock`, {

                method: "PUT",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    stock: stock
                })

            });


        if(!response.ok){

            throw new Error(
                "Failed to update stock."
            );

        }


        const updatedProduct =
            await response.json();


        row.dataset.stock =
            updatedProduct.stock_quantity;

        row.querySelector(".stock-number").textContent =
            updatedProduct.stock_quantity;


        const statusElement =
            row.querySelector(".status");


        /* Remove existing status classes */

        statusElement.classList.remove(
            "in-stock",
            "low-stock",
            "critical",
            "out-of-stock"
        );


        /* Determine new status */


        let newStatus;

        if(updatedProduct.stock_quantity === 0){
        
            newStatus = "out-of-stock";
        
            statusElement.classList.add(
                "out-of-stock"
            );
        
            statusElement.innerHTML =
                "<span></span> OUT OF STOCK";
        
        }
        
        else if(updatedProduct.stock_quantity <= inventoryThresholds.criticalStock){
        
            newStatus = "critical";
        
            statusElement.classList.add(
                "critical"
            );
        
            statusElement.innerHTML =
                "<span></span> CRITICAL";
        
        }
        
        else if(updatedProduct.stock_quantity <= inventoryThresholds.lowStock){
        
            newStatus = "low";
        
            statusElement.classList.add(
                "low-stock"
            );
        
            statusElement.innerHTML =
                "<span></span> LOW STOCK";
        
        }
        
        else{
        
            newStatus = "in-stock";
        
            statusElement.classList.add(
                "in-stock"
            );
        
            statusElement.innerHTML =
                "<span></span> IN STOCK";
        
        }


        row.dataset.status =
            newStatus;

            await loadRestockedToday();
            await loadDeductedToday();
            await loadLowStockToday();
            await loadLowStockCount();
            await loadInventory();
            filterInventory();
            await loadCriticalStockToday();
            await loadCriticalStockCount();
            await loadOutOfStockToday();
            await loadOutOfStockCount();
    } catch(error){

        console.error(
            "Error updating stock:",
            error
        );

        alert(
            "Failed to update stock. Please try again."
        );

    }

}
    //hiding sidebar
        const sidebarToggle = document.getElementById("sidebarToggle");
        const invSidebar = document.getElementById("invSidebar");
        const sidebarBackdrop = document.getElementById("sidebarBackdrop");

        sidebarToggle.addEventListener("click", () => {
            invSidebar.classList.toggle("sidebar-open");
            sidebarBackdrop.classList.toggle("show");
        });

        sidebarBackdrop.addEventListener("click", () => {
            invSidebar.classList.remove("sidebar-open");
            sidebarBackdrop.classList.remove("show");
        });

loadInventory();
loadRestockedToday();
loadDeductedToday();    
loadLowStockToday();
loadLowStockCount();
loadCriticalStockCount();
loadCriticalStockToday();
loadOutOfStockCount();
loadOutOfStockToday();
loadExpiringSoonCount();

if (new URLSearchParams(window.location.search).get('new') === '1') {
    addProductButton.click();
    window.history.replaceState(null, '', window.location.pathname);
}