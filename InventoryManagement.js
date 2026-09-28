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

const deleteModal = document.getElementById("deleteModal");
const deleteProductName = document.getElementById("deleteProductName");
const cancelDelete = document.getElementById("cancelDelete");
const confirmDelete = document.getElementById("confirmDelete");
/*
const closeDeleteModal =
    document.getElementById("closeDeleteModal"); */

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


let productToDelete = null;

let inventoryProducts = [];

//getting Inventory data from Postgres after communicating with Express
async function loadInventory(){

    try{

        const response =
            await fetch("/api/inventory");

        if(!response.ok){

            throw new Error(
                "Failed to fetch inventory."
            );

        }

        inventoryProducts =
            await response.json();

        console.log(
            "Inventory loaded:",
            inventoryProducts
        );
        //added
        renderInventory();
    }

    catch(error){

        console.error(
            "Error loading inventory:",
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
            
            if(product.stock_quantity <= 5){
            
                status = "critical";
                statusClass = "critical";
            
            }
            else if(product.stock_quantity <= 20){
            
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
                        status === "critical"
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

}

/* =========================================================
   SEARCH + FILTER
   ========================================================= */

function filterInventory(){

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

            else if(stockValue === "1-20"){
                matchesStock = stock >= 1 && stock <= 20;
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


    } catch(error){

        console.error(
            "Error updating product:",
            error
        );

        alert(
            "Failed to update product. Please try again."
        );

    }

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
            "critical"
        );


        /* Determine new status */

        let newStatus;


        if(updatedProduct.stock_quantity <= 5){

            newStatus = "critical";

            statusElement.classList.add(
                "critical"
            );

            statusElement.innerHTML =
                "<span></span> CRITICAL";

        }

        else if(updatedProduct.stock_quantity <= 20){

            newStatus = "low"; //previously low-stock but oriiginally low

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


        filterInventory();


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