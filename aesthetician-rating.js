(function () {
    const averageEl = document.getElementById("ratingAverage");
    const starsEl = document.getElementById("ratingStars");
    const reviewCountEl = document.getElementById("ratingReviewCount");
    const breakdownEl = document.getElementById("ratingBreakdown");
    if (!averageEl || !starsEl || !reviewCountEl || !breakdownEl) return;

    const data = {
        average: 4.9,
        totalReviews: 42,
        breakdown: { 5: 36, 4: 5, 3: 1, 2: 0, 1: 0 },
    };

    averageEl.textContent = data.average.toFixed(1);
    reviewCountEl.textContent = `from ${data.totalReviews} client reviews`;

    starsEl.replaceChildren();
    for (let index = 0; index < 5; index += 1) {
        const star = document.createElement("span");
        star.className = index < Math.round(data.average) ? "rating-star filled" : "rating-star";
        star.textContent = "★";
        starsEl.appendChild(star);
    }

    breakdownEl.replaceChildren();
    for (let star = 5; star >= 1; star -= 1) {
        const row = document.createElement("div");
        row.className = "rating-breakdown-row";
        const count = data.breakdown[star] || 0;
        const percentage = (count / data.totalReviews) * 100;
        row.innerHTML = `<span class="rating-breakdown-label">${star} ★</span><span class="rating-breakdown-track"><span class="rating-breakdown-fill" style="width: ${percentage}%"></span></span><span class="rating-breakdown-count">${count}</span>`;
        breakdownEl.appendChild(row);
    }
})();
