(() => {
    const batchButton = document.querySelector(".btn-batch-upload");
    if (!batchButton) return;

    const categories = [
        "Medical/Injection Supplies",
        "Disposables & Clinic Consumables",
        "Facial/Treatment Prep Products",
        "Facial Treatment Products (Professional Use)",
        "Skincare Products (Retail / Aftercare)",
        "Soaps & Cleansers",
        "Tools/Equipment/Misc."
    ];

    const modal = document.createElement("div");
    modal.className = "batch-upload-modal";
    modal.hidden = true;
    modal.innerHTML = `
        <section class="batch-upload-dialog" role="dialog" aria-modal="true" aria-labelledby="batchUploadTitle">
            <div class="batch-upload-heading">
                <h2 id="batchUploadTitle">Batch Upload Invoice</h2>
                <button class="batch-upload-close" type="button" aria-label="Close">×</button>
            </div>
            <p class="batch-upload-help">Place the invoice on a flat surface, use good lighting, and fill the frame.</p>
            <label class="batch-file-label" for="batchInvoiceFile">Invoice photo</label>
            <input id="batchInvoiceFile" type="file" accept="image/*">
            <div class="batch-camera-actions">
                <button class="batch-action-button batch-secondary batch-camera-start" type="button">Use camera</button>
            </div>
            <div class="batch-camera-wrap" hidden>
                <video class="batch-camera-video" autoplay playsinline muted></video>
                <div class="batch-camera-actions">
                    <button class="batch-action-button batch-camera-capture" type="button">Take photo</button>
                    <button class="batch-action-button batch-secondary batch-camera-stop" type="button">Close camera</button>
                </div>
            </div>
            <div class="batch-preview-wrap" hidden>
                <img class="batch-preview-image" alt="Selected invoice preview">
            </div>
            <p class="batch-upload-status" role="status" aria-live="polite"></p>
            <div class="batch-review-section" hidden>
                <div class="batch-review-heading">
                    <h3>Review items</h3>
                    <button class="batch-action-button batch-secondary batch-add-row" type="button">Add item</button>
                </div>
                <div class="batch-table-wrap">
                    <table class="batch-review-table">
                        <thead><tr>
                            <th>Product</th><th>Quantity</th><th>Unit price</th>
                            <th>Category</th><th>Expiry date</th><th>Match</th><th></th>
                        </tr></thead>
                        <tbody></tbody>
                    </table>
                </div>
                <details class="batch-raw-text" hidden>
                    <summary>Raw OCR text</summary>
                    <pre></pre>
                </details>
            </div>
            <div class="batch-actions">
                <button class="batch-action-button batch-secondary batch-cancel" type="button">Cancel</button>
                <button class="batch-action-button batch-scan" type="button" disabled>Scan invoice</button>
                <button class="batch-action-button batch-confirm" type="button" hidden>Confirm upload</button>
            </div>
        </section>`;
    document.body.appendChild(modal);

    const fileInput = modal.querySelector("#batchInvoiceFile");
    const cameraStartButton = modal.querySelector(".batch-camera-start");
    const cameraWrap = modal.querySelector(".batch-camera-wrap");
    const cameraVideo = modal.querySelector(".batch-camera-video");
    const cameraCaptureButton = modal.querySelector(".batch-camera-capture");
    const cameraStopButton = modal.querySelector(".batch-camera-stop");
    const previewWrap = modal.querySelector(".batch-preview-wrap");
    const previewImage = modal.querySelector(".batch-preview-image");
    const status = modal.querySelector(".batch-upload-status");
    const reviewSection = modal.querySelector(".batch-review-section");
    const tableBody = modal.querySelector("tbody");
    const scanButton = modal.querySelector(".batch-scan");
    const confirmButton = modal.querySelector(".batch-confirm");
    const rawTextDetails = modal.querySelector(".batch-raw-text");
    const rawText = rawTextDetails.querySelector("pre");
    let selectedFile = null;
    let previewUrl = "";
    let cameraStream = null;
    let rows = [];

    function validRow(row) {
        return Boolean(row.product_name.trim())
            && Number.isInteger(Number(row.quantity))
            && Number(row.quantity) > 0
            && String(row.unit_price).trim() !== ""
            && Number.isFinite(Number(row.unit_price))
            && Number(row.unit_price) >= 0
            && Boolean(row.category);
    }

    function setStatus(message, isError = false) {
        status.textContent = message;
        status.dataset.error = String(isError);
    }

    function showToast(message, isError = false) {
        const toast = document.createElement("div");
        toast.className = "batch-toast";
        toast.dataset.error = String(isError);
        toast.setAttribute("role", isError ? "alert" : "status");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        cameraVideo.srcObject = null;
        cameraWrap.hidden = true;
        cameraStartButton.disabled = false;
    }

    function setSelectedImage(file, source, fromCamera = false) {
        selectedFile = file;
        if (fromCamera) fileInput.value = "";
        scanButton.disabled = !selectedFile;
        reviewSection.hidden = true;
        confirmButton.hidden = true;
        scanButton.hidden = false;
        rows = [];
        tableBody.replaceChildren();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        previewImage.src = previewUrl;
        previewWrap.hidden = false;
        setStatus(source);
    }

    function closeModal() {
        stopCamera();
        modal.hidden = true;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = "";
        selectedFile = null;
        rows = [];
        fileInput.value = "";
        fileInput.disabled = false;
        previewWrap.hidden = true;
        previewImage.removeAttribute("src");
        reviewSection.hidden = true;
        confirmButton.hidden = true;
        scanButton.hidden = false;
        scanButton.disabled = true;
        confirmButton.disabled = false;
        tableBody.replaceChildren();
        rawTextDetails.hidden = true;
        rawText.textContent = "";
        setStatus("");
    }

    function addCell(row, content) {
        const cell = document.createElement("td");
        cell.appendChild(content);
        row.appendChild(cell);
        return cell;
    }

    function createInput(value, type, label, step) {
        const input = document.createElement("input");
        input.type = type;
        input.value = value ?? "";
        input.setAttribute("aria-label", label);
        if (type === "number") {
            input.min = "0";
            input.step = step;
        }
        return input;
    }

    function renderRows() {
        tableBody.replaceChildren();
        rows.forEach((item, index) => {
            const tableRow = document.createElement("tr");
            const isValid = validRow(item);
            tableRow.classList.toggle("batch-row--review", !isValid || item.needsReview);

            const nameInput = createInput(item.product_name, "text", "Product name");
            nameInput.maxLength = 255;
            const nameCell = addCell(tableRow, nameInput);
            const reason = document.createElement("small");
            reason.className = "batch-review-reason";
            reason.textContent = item.reviewReason || "Review the highlighted item details.";
            reason.hidden = isValid && !item.needsReview;
            nameCell.appendChild(reason);
            nameInput.addEventListener("input", () => {
                item.product_name = nameInput.value;
                item.needsReview = !validRow(item);
                updateRowState(tableRow, item, reason);
            });

            const quantityInput = createInput(item.quantity, "number", "Quantity", "1");
            quantityInput.addEventListener("input", () => {
                item.quantity = quantityInput.value;
                item.needsReview = !validRow(item);
                updateRowState(tableRow, item, reason);
            });
            addCell(tableRow, quantityInput);

            const priceInput = createInput(item.unit_price, "number", "Unit price", "0.01");
            priceInput.addEventListener("input", () => {
                item.unit_price = priceInput.value;
                item.needsReview = !validRow(item);
                updateRowState(tableRow, item, reason);
            });
            addCell(tableRow, priceInput);

            const categorySelect = document.createElement("select");
            categorySelect.setAttribute("aria-label", "Category");
            const emptyOption = document.createElement("option");
            emptyOption.value = "";
            emptyOption.textContent = "Choose category";
            categorySelect.appendChild(emptyOption);
            categories.forEach(category => {
                const option = document.createElement("option");
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
            categorySelect.value = item.category || "";
            categorySelect.addEventListener("change", () => {
                item.category = categorySelect.value;
                item.needsReview = !validRow(item);
                updateRowState(tableRow, item, reason);
            });
            addCell(tableRow, categorySelect);

            const expiryInput = createInput(item.expiry_date, "date", "Expiry date");
            expiryInput.addEventListener("input", () => {
                item.expiry_date = expiryInput.value || null;
            });
            addCell(tableRow, expiryInput);

            const matchCell = document.createElement("td");
            if (item.existing) {
                const badge = document.createElement("span");
                badge.className = "batch-existing-badge";
                badge.textContent = "Existing";
                matchCell.appendChild(badge);
            } else {
                matchCell.textContent = "New item";
            }
            tableRow.appendChild(matchCell);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "batch-row-delete";
            deleteButton.textContent = "Remove";
            deleteButton.setAttribute("aria-label", `Remove row ${index + 1}`);
            deleteButton.addEventListener("click", () => {
                rows.splice(index, 1);
                renderRows();
            });
            addCell(tableRow, deleteButton);
            tableBody.appendChild(tableRow);
        });
        confirmButton.disabled = !rows.length || rows.some(row => !validRow(row));
    }

    function updateRowState(tableRow, row, reason) {
        const isValid = validRow(row);
        tableRow.classList.toggle("batch-row--review", !isValid || row.needsReview);
        reason.hidden = isValid && !row.needsReview;
        confirmButton.disabled = rows.some(item => !validRow(item));
    }

    async function resizeImage(file) {
        let image;
        let imageWidth;
        let imageHeight;
        let closeImage = () => {};

        if ("createImageBitmap" in window) {
            try {
                image = await createImageBitmap(file, { imageOrientation: "from-image" });
                imageWidth = image.width;
                imageHeight = image.height;
                closeImage = () => image.close();
            } catch {
                image = null;
            }
        }
        if (!image) {
            const sourceUrl = URL.createObjectURL(file);
            try {
                image = new Image();
                image.src = sourceUrl;
                await image.decode();
                imageWidth = image.naturalWidth;
                imageHeight = image.naturalHeight;
            } finally {
                URL.revokeObjectURL(sourceUrl);
            }
        }

        const scale = Math.min(1, 2000 / Math.max(imageWidth, imageHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(imageWidth * scale));
        canvas.height = Math.max(1, Math.round(imageHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
            closeImage();
            throw new Error("Image resizing is not supported by this browser.");
        }
        try {
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
        } finally {
            closeImage();
        }

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => {
                if (result) resolve(result);
                else reject(new Error("The invoice image could not be resized."));
            }, "image/jpeg", 0.8);
        });
        if (blob.size > 10 * 1024 * 1024) {
            throw new Error("The resized invoice image is still over 10 MB. Please choose a smaller photo.");
        }
        return new File([blob], "invoice-upload.jpg", { type: "image/jpeg" });
    }

    batchButton.addEventListener("click", () => {
        modal.hidden = false;
        fileInput.focus();
    });
    modal.querySelector(".batch-upload-close").addEventListener("click", closeModal);
    modal.querySelector(".batch-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", event => {
        if (event.target === modal) closeModal();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) closeModal();
    });

    fileInput.addEventListener("change", () => {
        stopCamera();
        const file = fileInput.files[0] || null;
        if (!file) {
            selectedFile = null;
            scanButton.disabled = true;
            previewWrap.hidden = true;
            setStatus("");
            return;
        }
        setSelectedImage(file, "Photo selected. Select Scan invoice when ready.");
    });

    cameraStartButton.addEventListener("click", async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            setStatus("Camera access is unavailable here. Open the site over HTTPS on your phone, or choose a photo instead.", true);
            return;
        }

        cameraStartButton.disabled = true;
        setStatus("Requesting camera access...");
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: "environment" },
                    width: { ideal: 2000 },
                    height: { ideal: 2000 }
                }
            });
            cameraVideo.srcObject = cameraStream;
            cameraWrap.hidden = false;
            await cameraVideo.play();
            setStatus("Center the invoice in the camera, then take a photo.");
        } catch (error) {
            stopCamera();
            const message = error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
                ? "Camera permission was denied. Allow camera access in your browser settings, or choose a photo instead."
                : error.name === "NotFoundError" || error.name === "DevicesNotFoundError"
                    ? "No camera was found on this device. Choose a photo instead."
                    : "Could not open the camera. Use HTTPS, check browser permission, or choose a photo instead.";
            setStatus(message, true);
        }
    });

    cameraCaptureButton.addEventListener("click", async () => {
        const width = cameraVideo.videoWidth;
        const height = cameraVideo.videoHeight;
        if (!width || !height) {
            setStatus("The camera is not ready yet. Wait a moment and try again.", true);
            return;
        }

        cameraCaptureButton.disabled = true;
        const scale = Math.min(1, 2000 / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
            cameraCaptureButton.disabled = false;
            setStatus("Camera capture is not supported by this browser. Choose a photo instead.", true);
            return;
        }

        context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
        try {
            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob(result => {
                    if (result) resolve(result);
                    else reject(new Error("The camera photo could not be created. Please try again."));
                }, "image/jpeg", 0.8);
            });
            setSelectedImage(
                new File([blob], "invoice-camera.jpg", { type: "image/jpeg" }),
                "Camera photo ready. Select Scan invoice when ready.",
                true
            );
            stopCamera();
        } catch (error) {
            setStatus(error.message, true);
        } finally {
            cameraCaptureButton.disabled = false;
        }
    });

    cameraStopButton.addEventListener("click", () => {
        stopCamera();
        setStatus(selectedFile
            ? "Camera closed. Your selected photo is ready to scan."
            : "Camera closed. Choose a photo or open the camera to capture one.");
    });

    scanButton.addEventListener("click", async () => {
        if (!selectedFile) return;
        scanButton.disabled = true;
        fileInput.disabled = true;
        cameraStartButton.disabled = true;
        setStatus("Preparing and scanning invoice...");
        try {
            const resizedFile = await resizeImage(selectedFile);
            const formData = new FormData();
            formData.append("image", resizedFile);
            const response = await fetch("/api/inventory/batch-upload/scan", {
                method: "POST",
                body: formData
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || "The invoice could not be scanned.");
            rows = result.rows.map(row => ({
                ...row,
                quantity: row.quantity ?? "",
                unit_price: row.unit_price ?? "",
                category: row.category || "",
                expiry_date: row.expiry_date || null
            }));
            if (!rows.length) {
                throw new Error("No item rows were recognized. Please retake the photo with clearer lighting and framing.");
            }
            rawText.textContent = result.rawText || "";
            rawTextDetails.hidden = !result.rawText;
            reviewSection.hidden = false;
            scanButton.hidden = true;
            confirmButton.hidden = false;
            renderRows();
            setStatus(`${rows.length} row${rows.length === 1 ? "" : "s"} found. Review each item before confirming.`);
        } catch (error) {
            setStatus(error.message, true);
        } finally {
            fileInput.disabled = false;
            cameraStartButton.disabled = false;
            scanButton.disabled = !selectedFile;
        }
    });

    modal.querySelector(".batch-add-row").addEventListener("click", () => {
        rows.push({
            product_name: "",
            quantity: "",
            unit_price: "",
            category: "",
            expiry_date: null,
            existing: false,
            needsReview: true,
            reviewReason: "Enter the item details."
        });
        reviewSection.hidden = false;
        confirmButton.hidden = false;
        renderRows();
    });

    confirmButton.addEventListener("click", async () => {
        if (!rows.length || rows.some(row => !validRow(row))) {
            setStatus("Complete or remove every highlighted row before confirming.", true);
            return;
        }
        confirmButton.disabled = true;
        setStatus("Saving reviewed inventory...");
        try {
            const response = await fetch("/api/inventory/batch-upload/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rows: rows.map(row => ({
                        product_name: row.product_name.trim(),
                        quantity: Number(row.quantity),
                        unit_price: Number(row.unit_price),
                        category: row.category,
                        expiry_date: row.expiry_date || null
                    }))
                })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || "The reviewed items could not be saved.");

            const savedCount = result.products.length;
            closeModal();
            showToast(`${savedCount} inventory row${savedCount === 1 ? "" : "s"} saved successfully.`);
            const refreshFunctions = [
                "loadInventory",
                "loadRestockedToday",
                "loadDeductedToday",
                "loadLowStockToday",
                "loadLowStockCount",
                "loadCriticalStockCount",
                "loadCriticalStockToday",
                "loadOutOfStockCount",
                "loadOutOfStockToday",
                "loadExpiringSoonCount"
            ];
            await Promise.all(refreshFunctions
                .filter(name => typeof window[name] === "function")
                .map(name => window[name]()));
            window.dispatchEvent(new CustomEvent("inventory:batch-upload-confirmed"));
        } catch (error) {
            confirmButton.disabled = false;
            setStatus(error.message, true);
            showToast(error.message, true);
        }
    });
})();
