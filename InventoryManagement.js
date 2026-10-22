/* =========================================================
   INVENTORY MANAGEMENT JAVASCRIPT
   ========================================================= */

const searchInput = document.getElementById("searchInput");

const categoryFilter = document.getElementById("categoryFilter");
const stockFilter = document.getElementById("stockFilter");
const expiryFilter = document.getElementById("expiryFilter");
const statusFilter = document.getElementById("statusFilter");

const clearFilters = document.getElementById("clearFilters");
const exportInventoryButton = document.getElementById("exportInventory");

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
const expiredItemsCard = document.getElementById("expiredItemsCard");
const expiredItemsCount = document.getElementById("expiredItemsCount");

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

function getStockStatus(product){
    const stock = Number(product.stock_quantity);

    if(!Number.isFinite(stock)){
        return "unavailable";
    }

    if(stock === 0){
        return "out-of-stock";
    }

    if(stock <= inventoryThresholds.criticalStock){
        return "critical";
    }

    if(stock <= inventoryThresholds.lowStock){
        return "low";
    }

    return "in-stock";
}

function getStockStatusLabel(product){
    switch(getStockStatus(product)){
        case "out-of-stock": return "Out of Stock";
        case "critical": return "Critical";
        case "low": return "Low Stock";
        case "in-stock": return "In Stock";
        default: return "Unavailable";
    }
}

function getExpirationDays(expiryValue, referenceDate = new Date()){
    if(!expiryValue){
        return null;
    }

    const [year, month, day] = String(expiryValue).split("-").map(Number);
    const expiryDate = new Date(year, month - 1, day);

    if(
        Number.isNaN(expiryDate.getTime()) ||
        expiryDate.getFullYear() !== year ||
        expiryDate.getMonth() !== month - 1 ||
        expiryDate.getDate() !== day
    ){
        return Number.NaN;
    }

    expiryDate.setHours(0, 0, 0, 0);
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    return (expiryDate - today) / (1000 * 60 * 60 * 24);
}

function getExpirationStatus(product, referenceDate = new Date()){
    if(!product.expiry_date){
        return "No Expiration";
    }

    const days = getExpirationDays(product.expiry_date, referenceDate);

    if(!Number.isFinite(days)){
        return "Unavailable";
    }

    if(days < 0){
        return "Expired";
    }

    if(days <= 30){
        return "Within 30 Days";
    }

    if(days <= 60){
        return "31–60 Days";
    }

    if(days <= 90){
        return "61–90 Days";
    }

    return "More Than 90 Days";
}

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
        updateExpiredItemsCount();

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

function updateExpiredItemsCount(){
    const expiredProducts = inventoryProducts.filter(product => {
        return getExpirationDays(product.expiry_date) < 0;
    });

    expiredItemsCount.textContent = String(expiredProducts.length);
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

        const expiringProducts = products.filter(product => {
            const days = getExpirationDays(product.expiry_date, today);
            return Number.isFinite(days) && days >= 0 && days <= 30;
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

            const status = getStockStatus(product);
            const statusClass = status === "low" ? "low-stock" : status;
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
                    ${getStockStatusLabel(product).toUpperCase()}
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
    filterInventory();

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

function getFilteredInventoryProducts(){
    const searchValue = searchInput.value.toLowerCase().trim();
    const categoryValue = categoryFilter.value.toLowerCase();
    const stockValue = stockFilter.value;
    const expiryValue = expiryFilter.value;
    const statusValue = statusFilter.value;
    const today = new Date();

    return inventoryProducts.filter(product => {
        const productName = String(product.product_name || "").toLowerCase();
        const category = String(product.category || "").trim().toLowerCase();
        const stock = Number(product.stock_quantity);
        const expiry = String(product.expiry_date || "none").toLowerCase();
        const status = getStockStatus(product);

        const matchesSearch =
            productName.includes(searchValue) ||
            category.includes(searchValue) ||
            String(product.stock_quantity).includes(searchValue) ||
            expiry.includes(searchValue) ||
            status.includes(searchValue);
        const matchesCategory =
            categoryValue === "all" || category === categoryValue.trim();

        let matchesStock = true;
        if(stockValue === "0"){
            matchesStock = stock === 0;
        }else if(stockValue === "low"){
            matchesStock =
                stock > 0 &&
                stock <= inventoryThresholds.lowStock;
        }else if(stockValue === "21-40"){
            matchesStock = stock >= 21 && stock <= 40;
        }else if(stockValue === "41-60"){
            matchesStock = stock >= 41 && stock <= 60;
        }else if(stockValue === "61-80"){
            matchesStock = stock >= 61 && stock <= 80;
        }else if(stockValue === "81-100"){
            matchesStock = stock >= 81 && stock <= 100;
        }

        let matchesExpiry = true;
        if(expiryValue === "none"){
            matchesExpiry = expiry === "none";
        }else if(expiryValue !== "all"){
            const days = getExpirationDays(product.expiry_date, today);

            if(!Number.isFinite(days)){
                matchesExpiry = false;
            }else if(expiryValue === "expired"){
                matchesExpiry = days < 0;
            }else if(expiryValue === "30"){
                matchesExpiry = days >= 0 && days <= 30;
            }else if(expiryValue === "60"){
                matchesExpiry = days > 30 && days <= 60;
            }else if(expiryValue === "90"){
                matchesExpiry = days > 60 && days <= 90;
            }else if(expiryValue === "over90"){
                matchesExpiry = days > 90;
            }
        }

        const matchesStatus =
            statusValue === "all" || status === statusValue;

        return (
            matchesSearch &&
            matchesCategory &&
            matchesStock &&
            matchesExpiry &&
            matchesStatus
        );
    });
}

function filterInventory(){
    const summaryEmptyState =
        inventoryBody.querySelector(".summary-empty-state");

    if(summaryEmptyState){
        summaryEmptyState.remove();
    }

    const matchingProductIds = new Set(
        getFilteredInventoryProducts().map(product => String(product.product_id))
    );

    inventoryBody.querySelectorAll("tr").forEach(row => {
        row.style.display = matchingProductIds.has(row.dataset.id) ? "" : "none";
    });
}

function updateStockSummaryFromInventory() {
    const totalStock = inventoryProducts.reduce(
        (total, product) => total + Number(product.stock_quantity),
        0
    );
    const lowStockProducts = inventoryProducts.filter(product => {
        const stock = Number(product.stock_quantity);
        return stock > inventoryThresholds.criticalStock
            && stock <= inventoryThresholds.lowStock;
    });
    const criticalStockProducts = inventoryProducts.filter(product => {
        const stock = Number(product.stock_quantity);
        return stock > 0 && stock <= inventoryThresholds.criticalStock;
    });
    const outOfStockProducts = inventoryProducts.filter(
        product => Number(product.stock_quantity) === 0
    );

    totalProducts.textContent = totalStock;
    lowStockCount.textContent = lowStockProducts.length;
    criticalStockCount.textContent = criticalStockProducts.length;
    outOfStockCount.textContent = outOfStockProducts.length;
    renderInventorySidebar();
    filterInventory();
}

function getSelectedFilterLabel(select){
    if(select.value === "all"){
        return "All";
    }

    return select.selectedOptions[0]?.textContent.trim() || select.value;
}

function getExcelDate(value){
    if(!value){
        return "Unavailable";
    }

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    const sourceDate = dateOnly
        ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
        : new Date(value);

    if(Number.isNaN(sourceDate.getTime())){
        return "Unavailable";
    }

    if(
        dateOnly &&
        (
            sourceDate.getFullYear() !== Number(dateOnly[1]) ||
            sourceDate.getMonth() !== Number(dateOnly[2]) - 1 ||
            sourceDate.getDate() !== Number(dateOnly[3])
        )
    ){
        return "Unavailable";
    }

    return new Date(Date.UTC(
        sourceDate.getFullYear(),
        sourceDate.getMonth(),
        sourceDate.getDate(),
        sourceDate.getHours(),
        sourceDate.getMinutes(),
        sourceDate.getSeconds(),
        sourceDate.getMilliseconds()
    ));
}

function getLocalDateForFilename(date){
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

async function exportFilteredInventory(){
    const products = getFilteredInventoryProducts();

    if(!products.length){
        alert("No inventory products match the current search and filters.");
        return;
    }

    try{
        if(!window.ExcelJS){
            throw new Error("ExcelJS did not load.");
        }

        const generatedAt = new Date();
        const workbook = new window.ExcelJS.Workbook();
        workbook.creator = "Skin Goddess Aesthetic Center";
        workbook.lastModifiedBy = "Skin Goddess Aesthetic Center";
        workbook.created = generatedAt;
        workbook.modified = generatedAt;
        workbook.subject = "Inventory Management Report";

        const worksheet = workbook.addWorksheet("Inventory Report");
        worksheet.properties.defaultRowHeight = 19;
        worksheet.properties.tabColor = { argb: "FFB58B4C" };
        worksheet.columns = [
            { width: 14 },
            { width: 32 },
            { width: 34 },
            { width: 17 },
            { width: 19 },
            { width: 21 },
            { width: 23 },
            { width: 23 }
        ];

        const setMergedRowStyle = (rowNumber, fill, font, alignment) => {
            worksheet.getRow(rowNumber).eachCell({ includeEmpty: true }, cell => {
                cell.fill = fill;
                cell.font = font;
                cell.alignment = alignment;
            });
        };

        const filters = [
            ["Search", searchInput.value.trim() || "All"],
            ["Category", getSelectedFilterLabel(categoryFilter)],
            ["Stock Range", getSelectedFilterLabel(stockFilter)],
            ["Expiration Range", getSelectedFilterLabel(expiryFilter)],
            ["Stock Status", getSelectedFilterLabel(statusFilter)]
        ];

        const totalUnits = products.reduce((total, product) => {
            const quantity = Number(product.stock_quantity);
            return total + (Number.isFinite(quantity) ? quantity : 0);
        }, 0);
        const summaryMetrics = [
            ["Total products listed", products.length],
            ["Total units in stock", totalUnits],
            ["Out-of-stock products", products.filter(product => getStockStatus(product) === "out-of-stock").length],
            ["Critical-stock products", products.filter(product => getStockStatus(product) === "critical").length],
            ["Low-stock products", products.filter(product => getStockStatus(product) === "low").length],
            ["Products expiring within 30 days", products.filter(product => {
                const days = getExpirationDays(product.expiry_date, generatedAt);
                return Number.isFinite(days) && days >= 0 && days <= 30;
            }).length]
        ];

        const headerRowNumber = 1;
        const headerRow = worksheet.getRow(headerRowNumber);
        headerRow.values = [
            "Product ID",
            "Product Name",
            "Category",
            "Stock Quantity",
            "Stock Status",
            "Expiration Date",
            "Expiration Status",
            "Last Updated"
        ];
        headerRow.height = 30;
        headerRow.eachCell(cell => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF294A63" }
            };
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            cell.border = {
                bottom: { style: "medium", color: { argb: "FFB58B4C" } }
            };
        });

        products.forEach(product => {
            const stockValue = Number(product.stock_quantity);
            const row = worksheet.addRow([
                product.product_id ?? "Unavailable",
                product.product_name || "Unavailable",
                product.category || "Unavailable",
                Number.isFinite(stockValue) ? stockValue : "Unavailable",
                getStockStatusLabel(product),
                product.expiry_date
                    ? getExcelDate(product.expiry_date)
                    : "No Expiration",
                getExpirationStatus(product, generatedAt),
                getExcelDate(product.updated_at)
            ]);
            row.eachCell(cell => {
                cell.alignment = { vertical: "middle", wrapText: true };
                cell.border = {
                    bottom: { style: "hair", color: { argb: "FFD7DEE5" } }
                };
            });

            if(row.number % 2 === 0){
                row.eachCell(cell => {
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "FFF7F9FB" }
                    };
                });
            }

            row.getCell(4).numFmt = "#,##0";
            row.getCell(6).numFmt = "mmm d, yyyy";
            row.getCell(8).numFmt = "mmm d, yyyy h:mm AM/PM";

            const stockStatusCell = row.getCell(5);
            const stockStatus = stockStatusCell.value;
            if(stockStatus === "Critical" || stockStatus === "Out of Stock"){
                stockStatusCell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFCE4E4" }
                };
                stockStatusCell.font = { bold: true, color: { argb: "FF9B1C1C" } };
            }else if(stockStatus === "Low Stock"){
                stockStatusCell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFFF2CC" }
                };
                stockStatusCell.font = { bold: true, color: { argb: "FF805B00" } };
            }

            if(row.getCell(7).value === "Expired"){
                row.getCell(7).font = { bold: true, color: { argb: "FF9B1C1C" } };
            }else if(row.getCell(7).value === "Within 30 Days"){
                row.getCell(7).font = { bold: true, color: { argb: "FF805B00" } };
            }
        });

        worksheet.autoFilter = {
            from: { row: headerRowNumber, column: 1 },
            to: { row: headerRowNumber, column: 8 }
        };

        const reportStartRow = worksheet.lastRow.number + 3;
        worksheet.mergeCells(`A${reportStartRow}:H${reportStartRow}`);
        worksheet.getCell(`A${reportStartRow}`).value = "SKIN GODDESS AESTHETIC CENTER";
        worksheet.getRow(reportStartRow).height = 30;
        setMergedRowStyle(
            reportStartRow,
            { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } },
            { name: "Aptos Display", size: 16, bold: true, color: { argb: "FFFFFFFF" } },
            { horizontal: "center", vertical: "middle" }
        );

        const reportTitleRow = reportStartRow + 1;
        worksheet.mergeCells(`A${reportTitleRow}:H${reportTitleRow}`);
        worksheet.getCell(`A${reportTitleRow}`).value = "Inventory Management Report";
        worksheet.getRow(reportTitleRow).height = 27;
        worksheet.getCell(`A${reportTitleRow}`).font = {
            name: "Aptos Display",
            size: 18,
            bold: true,
            color: { argb: "FF17324D" }
        };
        worksheet.getCell(`A${reportTitleRow}`).alignment = { horizontal: "center", vertical: "middle" };

        const generatedAtRow = reportStartRow + 2;
        worksheet.mergeCells(`A${generatedAtRow}:H${generatedAtRow}`);
        worksheet.getCell(`A${generatedAtRow}`).value = `Generated: ${generatedAt.toLocaleString()}`;
        worksheet.getCell(`A${generatedAtRow}`).font = {
            italic: true,
            color: { argb: "FF526171" }
        };
        worksheet.getCell(`A${generatedAtRow}`).alignment = { horizontal: "center" };

        const filtersTitleRow = reportStartRow + 4;
        worksheet.mergeCells(`A${filtersTitleRow}:H${filtersTitleRow}`);
        worksheet.getCell(`A${filtersTitleRow}`).value = "Applied Filters";
        worksheet.getRow(filtersTitleRow).height = 23;
        setMergedRowStyle(
            filtersTitleRow,
            { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF3" } },
            { bold: true, size: 12, color: { argb: "FF17324D" } },
            { vertical: "middle" }
        );

        const filterHeaderRow = filtersTitleRow + 1;
        worksheet.mergeCells(`A${filterHeaderRow}:C${filterHeaderRow}`);
        worksheet.mergeCells(`D${filterHeaderRow}:H${filterHeaderRow}`);
        worksheet.getCell(`A${filterHeaderRow}`).value = "Filter";
        worksheet.getCell(`D${filterHeaderRow}`).value = "Selected Value";
        [worksheet.getCell(`A${filterHeaderRow}`), worksheet.getCell(`D${filterHeaderRow}`)].forEach(cell => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF294A63" }
            };
            cell.alignment = { vertical: "middle", wrapText: true };
        });
        worksheet.getRow(filterHeaderRow).height = 25;

        filters.forEach(([label, value], index) => {
            const rowNumber = filterHeaderRow + 1 + index;
            worksheet.mergeCells(`A${rowNumber}:C${rowNumber}`);
            worksheet.mergeCells(`D${rowNumber}:H${rowNumber}`);
            const labelCell = worksheet.getCell(`A${rowNumber}`);
            labelCell.value = label;
            labelCell.font = { bold: true, color: { argb: "FF394957" } };
            const valueCell = worksheet.getCell(`D${rowNumber}`);
            valueCell.value = value;
            [labelCell, valueCell].forEach(cell => {
                cell.alignment = { vertical: "middle", wrapText: true };
                cell.border = {
                    bottom: { style: "hair", color: { argb: "FFD7DEE5" } }
                };
            });
            worksheet.getRow(rowNumber).height = 25;
        });

        const summaryTitleRow = filterHeaderRow + filters.length + 2;
        worksheet.mergeCells(`A${summaryTitleRow}:H${summaryTitleRow}`);
        worksheet.getCell(`A${summaryTitleRow}`).value = "Summary";
        worksheet.getRow(summaryTitleRow).height = 23;
        setMergedRowStyle(
            summaryTitleRow,
            { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF3" } },
            { bold: true, size: 12, color: { argb: "FF17324D" } },
            { vertical: "middle" }
        );

        summaryMetrics.forEach(([label, value], index) => {
            const rowNumber = summaryTitleRow + 1 + Math.floor(index / 2);
            const startColumn = index % 2 === 0 ? 1 : 5;
            worksheet.mergeCells(rowNumber, startColumn, rowNumber, startColumn + 2);
            const labelCell = worksheet.getCell(rowNumber, startColumn);
            labelCell.value = label;
            labelCell.font = { bold: true, color: { argb: "FF394957" } };
            labelCell.alignment = { vertical: "middle", wrapText: true };
            const valueCell = worksheet.getCell(rowNumber, startColumn + 3);
            valueCell.value = value;
            valueCell.font = { bold: true, color: { argb: "FF17324D" } };
            valueCell.numFmt = "#,##0";
            valueCell.alignment = { horizontal: "center", vertical: "middle" };
            worksheet.getRow(rowNumber).height = 25;
        });

        worksheet.views = [{
            state: "frozen",
            ySplit: 1,
            topLeftCell: `A${headerRowNumber + 1}`,
            activeCell: `A${headerRowNumber + 1}`,
            activePane: "bottomLeft",
            showGridLines: false,
            zoomScale: 90,
            zoomScaleNormal: 90
        }];
        worksheet.pageSetup = {
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        };

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = `SkinGoddess_Inventory_Report_${getLocalDateForFilename(generatedAt)}.xlsx`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }catch(error){
        console.error("Error exporting inventory report:", error);
        alert("Inventory could not be exported. Please try again.");
    }
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

expiredItemsCard.addEventListener("click", () => {
    searchInput.value = "";
    categoryFilter.value = "all";
    stockFilter.value = "all";
    statusFilter.value = "all";
    expiryFilter.value = "expired";

    filterInventory();
    showSummaryEmptyState(expiredItemsCount, "No Product is expired.");

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

exportInventoryButton.addEventListener("click", exportFilteredInventory);


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

    /* =====================================================
       ADD STOCK
       ===================================================== */

    if(button.classList.contains("increase")){

        updateStock(row, 1);

        return;
    }


    /* =====================================================
       REMOVE STOCK
       ===================================================== */

    if(button.classList.contains("decrease")){

        const stock = Number(row.dataset.stock);
        if(Number.isFinite(stock) && stock > 0){
            updateStock(row, -1, true);

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
    editModal.dataset.originalStock = product.stock_quantity;


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
    const originalStock = Number(editModal.dataset.originalStock);
    const stockAdjustment = stock - originalStock;

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

    if(!Number.isInteger(stock) || stock < 0 || !Number.isSafeInteger(stockAdjustment)){

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
                    stock_adjustment: stockAdjustment,
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

   async function updateStock(row, stockAdjustment, deductOne = false){

    const productId =
        row.dataset.id;
    const stockButtons = row.querySelectorAll(".action-btn.increase, .action-btn.decrease");
    stockButtons.forEach(button => {
        button.disabled = true;
    });


    try {

        const response = await fetch(
            deductOne
                ? `/api/inventory/${productId}/deduct`
                : `/api/inventory/${productId}/stock`,
            {
                method: deductOne ? "POST" : "PUT",
                headers: deductOne ? {} : { "Content-Type": "application/json" },
                ...(deductOne ? {} : { body: JSON.stringify({ stock_adjustment: stockAdjustment }) })
            }
        );

        const responseBody = await response.json();
        if(!response.ok){
            throw new Error(responseBody.message || "Failed to update stock.");
        }

        const updatedProduct = responseBody;
        const product = inventoryProducts.find(
            item => String(item.product_id) === String(productId)
        );
        if (product) {
            product.stock_quantity = updatedProduct.stock_quantity;
        }


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

        updateStockSummaryFromInventory();

        void Promise.all([
            loadRestockedToday(),
            loadDeductedToday(),
            loadLowStockToday(),
            loadCriticalStockToday(),
            loadOutOfStockToday()
        ]);
    } catch(error){

        console.error(
            "Error updating stock:",
            error
        );

        alert(error.message || "Failed to update stock. Please try again.");

    } finally {
        stockButtons.forEach(button => {
            button.disabled = false;
        });
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