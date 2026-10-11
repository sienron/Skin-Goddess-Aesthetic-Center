(() => {
    const transactionBody = document.getElementById("transactionBody");
    const transactionFooter = document.getElementById("transactionFooter");
    const transactionPeriodFilter = document.getElementById("transactionPeriodFilter");
    const transactionTypeFilter = document.getElementById("transactionTypeFilter");
    const transactionsExport = document.getElementById("exportTransactions");
    let transactions = [];
    let isLoadingTransactions = false;

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
        const selectedType = transactionTypeFilter.value;
        const transactionType = selectedType === "deduct-stock" ? "Used in Service" : selectedType;
        const periodStart = transactionPeriodFilter.value === "all"
            ? null
            : getPeriodStart(transactionPeriodFilter.value);

        return transactions.filter(transaction => {
            if (transactionType !== "all" && transaction.transaction_type !== transactionType) return false;
            if (!periodStart) return true;
            const date = new Date(transaction.created_at);
            return !Number.isNaN(date.getTime()) && date >= periodStart;
        });
    }

    function getStockChange(transaction) {
        const newStock = Number(transaction.new_stock);
        const previousStock = Number(transaction.previous_stock);

        return Number.isFinite(newStock) && Number.isFinite(previousStock)
            ? newStock - previousStock
            : null;
    }

    function getTransactionClass(type) {
        switch (type) {
            case "Restock": return "restock";
            case "Sale": return "used";
            case "Sale Reversed": return "restock";
            case "Used in Service": return "used";
            case "Adjustment": return "adjustment";
            case "Expired": return "disposed";
            case "Deleted": return "deleted";
            default: return "adjustment";
        }
    }

    function renderTransactions() {
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
            transactionFooter.textContent = transactions.length
                ? "No transactions match the selected filters."
                : "No transaction records found.";
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

            const stockChange = getStockChange(transaction);
            const quantityCell = document.createElement("td");
            quantityCell.className = stockChange > 0
                ? "transaction-quantity-increase"
                : stockChange < 0 ? "transaction-quantity-decrease" : "";
            quantityCell.textContent = stockChange === null
                ? "Unavailable"
                : `${stockChange > 0 ? "+" : ""}${stockChange} unit${Math.abs(stockChange) === 1 ? "" : "s"}`;

            const stockCell = document.createElement("td");
            stockCell.textContent = transaction.new_stock === null || transaction.new_stock === undefined
                ? "Unavailable"
                : `${transaction.new_stock} units`;

            const performedByCell = document.createElement("td");
            performedByCell.textContent = transaction.performed_by || "Unknown";
            row.append(dateCell, productCell, actionCell, quantityCell, stockCell, performedByCell);
            transactionBody.appendChild(row);
        });

        transactionFooter.textContent = `Showing ${filteredTransactions.length} of ${transactions.length} log entries`;
    }

    function getLocalDateForFilename(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getExcelDate(value) {
        const sourceDate = new Date(value);
        if (Number.isNaN(sourceDate.getTime())) {
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

    function getSelectedFilterLabel(select, allLabel) {
        return select.value === "all"
            ? allLabel
            : select.selectedOptions[0]?.textContent.trim() || select.value;
    }

    async function exportFilteredTransactions() {
        const filteredTransactions = getFilteredTransactions();
        if (!filteredTransactions.length) {
            renderTransactions();
            alert("No transactions match the selected filters. No report was generated.");
            return;
        }

        try {
            if (!window.ExcelJS) {
                throw new Error("ExcelJS did not load.");
            }

            const generatedAt = new Date();
            const workbook = new window.ExcelJS.Workbook();
            workbook.creator = "Skin Goddess Aesthetic Center";
            workbook.lastModifiedBy = "Skin Goddess Aesthetic Center";
            workbook.created = generatedAt;
            workbook.modified = generatedAt;
            workbook.subject = "Stock Transaction Report";

            const worksheet = workbook.addWorksheet("Stock Transaction Report");
            worksheet.properties.defaultRowHeight = 19;
            worksheet.properties.tabColor = { argb: "FFB58B4C" };
            worksheet.columns = [
                { width: 25 },
                { width: 32 },
                { width: 22 },
                { width: 17 },
                { width: 18 },
                { width: 28 }
            ];

            const setMergedRowStyle = (rowNumber, fill, font, alignment) => {
                worksheet.getRow(rowNumber).eachCell({ includeEmpty: true }, cell => {
                    cell.fill = fill;
                    cell.font = font;
                    cell.alignment = alignment;
                });
            };

            const summaryMetrics = [
                ["Transactions Listed", filteredTransactions.length],
                ["Total Units Added", filteredTransactions.reduce((total, transaction) => {
                    const change = getStockChange(transaction);
                    return total + (change > 0 ? change : 0);
                }, 0)],
                ["Total Units Deducted", filteredTransactions.reduce((total, transaction) => {
                    const change = getStockChange(transaction);
                    return total + (change < 0 ? Math.abs(change) : 0);
                }, 0)]
            ];

            const headerRow = worksheet.getRow(1);
            headerRow.values = [
                "Date & Time",
                "Product",
                "Action",
                "Qty Change",
                "Stock After",
                "Performed By"
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

            filteredTransactions.forEach(transaction => {
                const change = getStockChange(transaction);
                const createdAt = getExcelDate(transaction.created_at);
                const stockAfter = Number(transaction.new_stock);
                const row = worksheet.addRow([
                    createdAt,
                    transaction.product_name || "Unknown product",
                    transaction.transaction_type || "Unknown",
                    change,
                    Number.isFinite(stockAfter) ? stockAfter : "Unavailable",
                    transaction.performed_by || "Unknown"
                ]);
                row.eachCell(cell => {
                    cell.alignment = { vertical: "middle", wrapText: true };
                    cell.border = {
                        bottom: { style: "hair", color: { argb: "FFD7DEE5" } }
                    };
                });

                if (row.number % 2 === 0) {
                    row.eachCell(cell => {
                        cell.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: { argb: "FFF7F9FB" }
                        };
                    });
                }

                row.getCell(1).numFmt = "mmm d, yyyy h:mm AM/PM";
                row.getCell(4).numFmt = '+#,##0;-#,##0;0';
                row.getCell(5).numFmt = "#,##0";
                row.getCell(4).alignment = { horizontal: "center", vertical: "middle" };

                const quantityCell = row.getCell(4);
                if (change > 0) {
                    quantityCell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "FFE2F0D9" }
                    };
                    quantityCell.font = { bold: true, color: { argb: "FF38761D" } };
                } else if (change < 0) {
                    quantityCell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "FFFCE4E4" }
                    };
                    quantityCell.font = { bold: true, color: { argb: "FF9B1C1C" } };
                }
            });

            const reportStartRow = worksheet.lastRow.number + 3;
            worksheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: reportStartRow - 3, column: 6 }
            };

            worksheet.mergeCells(`A${reportStartRow}:F${reportStartRow}`);
            worksheet.getCell(`A${reportStartRow}`).value = "SKIN GODDESS AESTHETIC CENTER";
            worksheet.getRow(reportStartRow).height = 30;
            setMergedRowStyle(
                reportStartRow,
                { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } },
                { name: "Aptos Display", size: 16, bold: true, color: { argb: "FFFFFFFF" } },
                { horizontal: "center", vertical: "middle" }
            );

            const reportTitleRow = reportStartRow + 1;
            worksheet.mergeCells(`A${reportTitleRow}:F${reportTitleRow}`);
            worksheet.getCell(`A${reportTitleRow}`).value = "Stock Transaction Report";
            worksheet.getRow(reportTitleRow).height = 27;
            worksheet.getCell(`A${reportTitleRow}`).font = {
                name: "Aptos Display",
                size: 18,
                bold: true,
                color: { argb: "FF17324D" }
            };
            worksheet.getCell(`A${reportTitleRow}`).alignment = { horizontal: "center", vertical: "middle" };

            const generatedAtRow = reportStartRow + 2;
            worksheet.mergeCells(`A${generatedAtRow}:F${generatedAtRow}`);
            worksheet.getCell(`A${generatedAtRow}`).value = `Generated: ${generatedAt.toLocaleString()}`;
            worksheet.getCell(`A${generatedAtRow}`).font = {
                italic: true,
                color: { argb: "FF526171" }
            };
            worksheet.getCell(`A${generatedAtRow}`).alignment = { horizontal: "center" };

            const filtersTitleRow = reportStartRow + 4;
            worksheet.mergeCells(`A${filtersTitleRow}:F${filtersTitleRow}`);
            worksheet.getCell(`A${filtersTitleRow}`).value = "Applied Filters";
            worksheet.getRow(filtersTitleRow).height = 23;
            setMergedRowStyle(
                filtersTitleRow,
                { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF3" } },
                { bold: true, size: 12, color: { argb: "FF17324D" } },
                { vertical: "middle" }
            );

            const filterHeaderRow = filtersTitleRow + 1;
            worksheet.mergeCells(`A${filterHeaderRow}:B${filterHeaderRow}`);
            worksheet.mergeCells(`C${filterHeaderRow}:F${filterHeaderRow}`);
            worksheet.getCell(`A${filterHeaderRow}`).value = "Filter";
            worksheet.getCell(`C${filterHeaderRow}`).value = "Selected Value";
            [worksheet.getCell(`A${filterHeaderRow}`), worksheet.getCell(`C${filterHeaderRow}`)].forEach(cell => {
                cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FF294A63" }
                };
                cell.alignment = { vertical: "middle", wrapText: true };
            });
            worksheet.getRow(filterHeaderRow).height = 25;

            const filters = [
                ["Time Period", getSelectedFilterLabel(transactionPeriodFilter, "All Time")],
                ["Transaction Type", getSelectedFilterLabel(transactionTypeFilter, "All Types")]
            ];
            filters.forEach(([label, value], index) => {
                const rowNumber = filterHeaderRow + 1 + index;
                worksheet.mergeCells(`A${rowNumber}:B${rowNumber}`);
                worksheet.mergeCells(`C${rowNumber}:F${rowNumber}`);
                const labelCell = worksheet.getCell(`A${rowNumber}`);
                labelCell.value = label;
                labelCell.font = { bold: true, color: { argb: "FF394957" } };
                const valueCell = worksheet.getCell(`C${rowNumber}`);
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
            worksheet.mergeCells(`A${summaryTitleRow}:F${summaryTitleRow}`);
            worksheet.getCell(`A${summaryTitleRow}`).value = "Summary";
            worksheet.getRow(summaryTitleRow).height = 23;
            setMergedRowStyle(
                summaryTitleRow,
                { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF3" } },
                { bold: true, size: 12, color: { argb: "FF17324D" } },
                { vertical: "middle" }
            );

            summaryMetrics.forEach(([label, value], index) => {
                const rowNumber = summaryTitleRow + 1 + index;
                worksheet.mergeCells(rowNumber, 1, rowNumber, 4);
                const labelCell = worksheet.getCell(rowNumber, 1);
                labelCell.value = label;
                labelCell.font = { bold: true, color: { argb: "FF394957" } };
                labelCell.alignment = { vertical: "middle", wrapText: true };
                const valueCell = worksheet.getCell(rowNumber, 5);
                valueCell.value = value;
                valueCell.font = { bold: true, color: { argb: "FF17324D" } };
                valueCell.numFmt = "#,##0";
                valueCell.alignment = { horizontal: "center", vertical: "middle" };
                worksheet.getRow(rowNumber).height = 25;
            });

            worksheet.views = [{
                state: "frozen",
                ySplit: 1,
                topLeftCell: "A2",
                activeCell: "A2",
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
            link.download = `SkinGoddess_Stock_Transaction_Report_${getLocalDateForFilename(generatedAt)}.xlsx`;
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
        } catch (error) {
            console.error("Error exporting stock transaction report:", error);
            alert("Stock transactions could not be exported. Please try again.");
        }
    }

    async function loadTransactions() {
        if (isLoadingTransactions) return;
        isLoadingTransactions = true;

        try {
            const response = await fetch("/api/inventory/transactions", { cache: "no-store" });
            if (!response.ok) throw new Error("Failed to fetch transaction history.");
            const data = await response.json();
            transactions = Array.isArray(data) ? data : [];
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

    window.addEventListener("inventory:batch-upload-confirmed", loadTransactions);
    transactionPeriodFilter.addEventListener("change", renderTransactions);
    transactionTypeFilter.addEventListener("change", renderTransactions);
    transactionsExport.addEventListener("click", exportFilteredTransactions);

    const sidebarToggle = document.getElementById("sidebarToggle");
    const invSidebar = document.getElementById("invSidebar");
    const sidebarBackdrop = document.getElementById("sidebarBackdrop");
    if (sidebarToggle && invSidebar && sidebarBackdrop) {
        sidebarToggle.addEventListener("click", () => {
            invSidebar.classList.toggle("sidebar-open");
            sidebarBackdrop.classList.toggle("show");
        });

        sidebarBackdrop.addEventListener("click", () => {
            invSidebar.classList.remove("sidebar-open");
            sidebarBackdrop.classList.remove("show");
        });
    }

    loadTransactions();
    window.setInterval(loadTransactions, 5000);
})();
