const invoiceLinesEl = document.getElementById("invoiceLines");
const invoiceTotalEl = document.getElementById("invoiceTotal");
const invoiceCurrencyEl = document.getElementById("invoiceCurrency");
const userBadgeEl = document.getElementById("userBadge");
const subscriptionStatusEl = document.getElementById("subscriptionStatus");
const statusDotEl = document.getElementById("statusDot");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const billedCountEl = document.getElementById("billedCount");
const avgEventCostEl = document.getElementById("avgEventCost");
const chartAreaEl = document.getElementById("chartArea");
const chartSvgEl = document.getElementById("chartSvg");
const chartStartEl = document.getElementById("chartStart");
const chartEndEl = document.getElementById("chartEnd");
const latestEventEl = document.getElementById("latestEvent");

const userId = `demo_${crypto.randomUUID()}`;
userBadgeEl.textContent = `user: ${userId}`;

const minuteBuckets = new Map();
let billedCount = 0;
let unitAmount = null;
let unitCurrency = null;

function formatAmount(amount, currency) {
  if (amount == null || currency == null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

async function subscribeUser() {
  setLatestEvent("Creating customer + subscription...");
  const res = await fetch("/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }

  const data = await res.json();
  subscriptionStatusEl.textContent = `subscription: ${data.status}`;
  statusDotEl.style.background = data.status === "active" ? "#24b47e" : "#f3b02a";
  setLatestEvent(`Subscribed: ${data.subscriptionId}`);
}

function bucketKey(date) {
  const stamp = new Date(date);
  stamp.setSeconds(0, 0);
  return stamp.toISOString();
}

function formatMinuteLabel(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setLatestEvent(message) {
  latestEventEl.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  latestEventEl.classList.remove("pulse");
  void latestEventEl.offsetWidth;
  latestEventEl.classList.add("pulse");
}

function updateCounts(value) {
  billedCount += value;
  billedCountEl.textContent = `${billedCount}`;
  renderAvgCost();
}

function updateBucket(value) {
  const key = bucketKey(new Date());
  const current = minuteBuckets.get(key) || 0;
  minuteBuckets.set(key, current + value);
}

function renderChart() {
  const now = new Date();
  const minutes = [];
  for (let i = 11; i >= 0; i -= 1) {
    const point = new Date(now.getTime() - i * 60 * 1000);
    point.setSeconds(0, 0);
    minutes.push(point);
  }

  const values = minutes.map((minute) => minuteBuckets.get(bucketKey(minute)) || 0);
  const maxValue = 20;
  const width = 600;
  const height = 150;
  const barWidth = 36;
  const gap = 10;
  const chartWidth = values.length * (barWidth + gap) - gap;
  const offsetX = Math.max(0, (width - chartWidth) / 2);

  const bars = values
    .map((value, index) => {
      const barHeight = (value / maxValue) * (height - 10);
      const x = offsetX + index * (barWidth + gap);
      const y = height - barHeight;
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="#635bff" />`;
    })
    .join("");

  chartSvgEl.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#f7f9ff"></rect>
      <line x1="24" y1="${height - 10}" x2="${width - 24}" y2="${height - 10}" stroke="#dbe3f3" stroke-width="2" />
      ${bars}
    </svg>
  `;

  chartStartEl.textContent = formatMinuteLabel(minutes[0]);
  chartEndEl.textContent = formatMinuteLabel(minutes[minutes.length - 1]);
}

function renderAvgCost() {
  if (unitAmount != null && unitCurrency) {
    avgEventCostEl.textContent = formatAmount(unitAmount, unitCurrency);
    return;
  }
  avgEventCostEl.textContent = "--";
}

async function sendUsage() {
  const key = `usage-${userId}-${Date.now()}`;
  const res = await fetch("/usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ userId, value: 1 }),
  });

  if (!res.ok) {
    const err = await res.text();
    if (err.includes("unknown userId")) {
      await subscribeUser();
      return sendUsage();
    }
    setLatestEvent(`Usage failed: ${err}`);
    return;
  }

  const data = await res.json();
  const label = data.meterEventId ? `meter ${data.meterEventId}` : `key ${data.idempotencyKey}`;
  updateCounts(1);
  updateBucket(1);
  renderChart();
  setLatestEvent(`Usage sent (${label})`);
}

async function refreshInvoice() {
  const res = await fetch(`/invoice/preview?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) {
    const err = await res.text();
    if (err.includes("unknown userId")) {
      await subscribeUser();
      return refreshInvoice();
    }
    setLatestEvent(`Invoice preview failed: ${err}`);
    return;
  }

  const data = await res.json();
  invoiceCurrencyEl.textContent = data.currency ? data.currency.toUpperCase() : "--";
  invoiceTotalEl.textContent = formatAmount(data.total, data.currency);

  invoiceLinesEl.innerHTML = "";
  unitAmount = null;
  unitCurrency = data.currency || null;
  data.lines.forEach((line) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${line.description || "Usage"}</td>
      <td>${line.quantity ?? "-"}</td>
      <td>${formatAmount(line.amount, data.currency)}</td>
    `;
    invoiceLinesEl.appendChild(row);
    if (unitAmount == null && line.quantity && line.amount != null && line.quantity > 0) {
      unitAmount = Math.round(line.amount / line.quantity);
    }
  });
  renderAvgCost();
}

let usageTimer = null;

async function boot() {
  try {
    await subscribeUser();
    await refreshInvoice();
    renderChart();

    const startUsage = () => {
      if (usageTimer) return;
      usageTimer = setInterval(async () => {
        await sendUsage();
        await refreshInvoice();
      }, 5000);
      startBtn.disabled = true;
      stopBtn.disabled = false;
      setLatestEvent("Usage stream started");
    };

    const stopUsage = () => {
      if (!usageTimer) return;
      clearInterval(usageTimer);
      usageTimer = null;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      setLatestEvent("Usage stream stopped");
    };

    startBtn.addEventListener("click", startUsage);
    stopBtn.addEventListener("click", stopUsage);

    startUsage();
  } catch (err) {
    setLatestEvent(`Startup error: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

boot();
