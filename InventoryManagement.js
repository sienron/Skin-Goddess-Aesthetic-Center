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

        if(product.stock_quantity <= 5){
            status = "critical";
        }
        else if(product.stock_quantity <= 20){
            status = "low";
        }
        else{
            status = "in-stock";
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

                    <button
                        class="action-btn decrease"
                        type="button"
                    >
                        −
                    </button>

                    <span class="stock-number">
                        ${product.stock_quantity}
                    </span>

                    <button
                        class="action-btn increase"
                        type="button"
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
                <div class="status ${status}">
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
                <button
                    class="action-btn delete"
                    type="button"
                >
                    ×
                </button>
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
        categoryFilter.value;

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

                const today =
                    new Date();

                const expiryDate =
                    new Date(expiry);

                const difference =
                    expiryDate - today;

                const days =
                    difference /
                    (1000 * 60 * 60 * 24);


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

            //stops the function from executing if the button is not found.
            //if the button is found, the function continues.

    const row = button.closest("tr");

             //finds the closest row to the button
             
    const stockNumber = row.querySelector(".stock-number");


    let stock = Number(stockNumber.textContent);


    /* ADD */

    if(button.classList.contains("increase")){

        stock++;

        updateStock(row, stock);

    }


    /* MINUS */

    if(button.classList.contains("decrease")){

        if(stock > 0){

            stock--;

            updateStock(row, stock);

        }

    }


    /* DELETE */

    if(button.classList.contains("delete")){

        const productName =
            row.querySelector(".product-name")
                .textContent
                .trim();


        const productId =
            row.dataset.id;


        const confirmed =
            confirm(
                `Are you sure you want to delete "${productName}"?\n\nThis action cannot be undone.`
            );


        if(confirmed){

            try{

                const response =
                    await fetch(`/api/inventory/${productId}`, {

                        method: "DELETE"

                    });


                if(!response.ok){

                    throw new Error(
                        "Failed to delete product."
                    );

                }


                row.remove();


            } catch(error){

                console.error(
                    "Error deleting product:",
                    error
                );

                alert(
                    "Failed to delete product. Please try again."
                );

            }

        }

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

loadInventory();