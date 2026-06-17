function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMoney(amount, currency = 'USD') {
  const numericAmount = Number(amount || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function renderAddress(address) {
  if (!address) return '<span class="muted">Not provided</span>';

  const lines = [
    address.name,
    address.company,
    address.address1,
    address.address2,
    [address.city, address.province, address.zip].filter(Boolean).join(', '),
    address.country,
    address.phone,
  ].filter(Boolean);

  return lines.map(line => `<div>${escapeHtml(line)}</div>`).join('');
}

function renderOrderLines(order) {
  return order.lineItems.map(item => {
    const subtitle = [item.variantTitle, item.sku ? `SKU ${item.sku}` : ''].filter(Boolean).join(' • ');

    return `
      <tr>
        <td>
          <div class="item-title">${escapeHtml(item.title)}</div>
          ${subtitle ? `<div class="item-meta">${escapeHtml(subtitle)}</div>` : ''}
        </td>
        <td class="num">${item.quantity}</td>
        <td class="num">${formatMoney(item.unitPrice, order.currency)}</td>
        <td class="num">${formatMoney(item.lineTotal, order.currency)}</td>
      </tr>
    `;
  }).join('');
}

export function renderBundleDocument(bundle) {
  const createdAt = bundle.created_at || new Date().toISOString();
  const shopInfo = bundle.shopInfo || {};
  const currency = bundle.currency || bundle.orders[0]?.currency || 'USD';

  const orderSections = bundle.orders.map(order => `
    <section class="order-card">
      <div class="order-head">
        <div>
          <div class="eyebrow">Order</div>
          <h2>${escapeHtml(order.name)}</h2>
          <div class="order-meta">Placed ${escapeHtml(formatDate(order.createdAt))}</div>
        </div>
        <div class="status-stack">
          <span class="pill">${escapeHtml(order.displayFinancialStatus || 'Unknown payment')}</span>
          <span class="pill muted-pill">${escapeHtml(order.displayFulfillmentStatus || 'Unfulfilled')}</span>
        </div>
      </div>

      <div class="address-grid">
        <div class="address-card">
          <div class="eyebrow">Ship To</div>
          ${renderAddress(order.shippingAddress)}
        </div>
        <div class="address-card">
          <div class="eyebrow">Bill To</div>
          ${renderAddress(order.billingAddress)}
        </div>
      </div>

      <table class="line-table">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Unit</th>
            <th class="num">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${renderOrderLines(order)}
        </tbody>
      </table>

      <div class="totals-grid">
        <div>
          ${order.note ? `<div class="note-box"><span class="eyebrow">Order Note</span><p>${escapeHtml(order.note)}</p></div>` : ''}
          ${order.shippingLines.length ? `<div class="shipping-box"><span class="eyebrow">Shipping Lines</span>${order.shippingLines.map(line => `<div>${escapeHtml(line.title)} <span class="money">${formatMoney(line.price, order.currency)}</span></div>`).join('')}</div>` : ''}
        </div>
        <div class="totals-card">
          <div class="totals-row"><span>Subtotal</span><strong>${formatMoney(order.subtotalPrice, order.currency)}</strong></div>
          <div class="totals-row"><span>Shipping</span><strong>${formatMoney(order.shippingPrice, order.currency)}</strong></div>
          <div class="totals-row"><span>Tax</span><strong>${formatMoney(order.taxPrice, order.currency)}</strong></div>
          <div class="totals-row grand"><span>Order Total</span><strong>${formatMoney(order.totalPrice, order.currency)}</strong></div>
        </div>
      </div>
    </section>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bundle.customer_name || 'Customer')} Bundle</title>
  <style>
    :root {
      --paper: #f7f0df;
      --paper-2: #fffaf0;
      --ink: #2c241b;
      --muted: #726758;
      --border: #c7b89c;
      --accent: #8f4b2a;
      --accent-soft: #ead8bf;
      --shadow: rgba(44, 36, 27, 0.12);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top, #efe0c3 0%, #e3d2b0 36%, #d5c09c 100%);
      color: var(--ink);
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      padding: 14px 18px;
      background: rgba(247, 240, 223, 0.94);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
    }

    .toolbar button {
      border: 1px solid var(--ink);
      background: var(--ink);
      color: var(--paper-2);
      padding: 10px 16px;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .document {
      max-width: 960px;
      margin: 28px auto 40px;
      padding: 0 18px;
    }

    .sheet {
      background: linear-gradient(180deg, var(--paper-2) 0%, var(--paper) 100%);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: 0 22px 44px var(--shadow);
      overflow: hidden;
    }

    .hero {
      padding: 34px;
      background:
        linear-gradient(145deg, rgba(143, 75, 42, 0.12), transparent 45%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0));
      border-bottom: 1px solid var(--border);
    }

    .hero-top {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 28px;
    }

    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }

    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(32px, 5vw, 50px); line-height: 0.95; }
    h2 { font-size: 24px; margin-bottom: 6px; }
    .subtitle { color: var(--muted); margin-top: 10px; max-width: 52ch; }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
    }

    .summary-card, .address-card, .totals-card, .note-box, .shipping-box {
      background: rgba(255, 255, 255, 0.45);
      border: 1px solid rgba(143, 75, 42, 0.15);
      border-radius: 18px;
      padding: 16px;
    }

    .summary-value {
      font-size: 28px;
      font-weight: 700;
      margin-top: 6px;
    }

    .summary-caption {
      color: var(--muted);
      margin-top: 8px;
      font-size: 14px;
    }

    .body {
      padding: 26px 34px 34px;
    }

    .order-card {
      padding: 26px 0;
      border-bottom: 1px solid var(--border);
    }

    .order-card:last-child { border-bottom: none; padding-bottom: 0; }

    .order-head {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 18px;
    }

    .order-meta, .muted, .item-meta {
      color: var(--muted);
    }

    .status-stack {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .pill {
      border: 1px solid rgba(143, 75, 42, 0.2);
      background: var(--accent-soft);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 13px;
      white-space: nowrap;
    }

    .muted-pill {
      background: rgba(255, 255, 255, 0.7);
    }

    .address-grid, .totals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }

    .line-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      border: 1px solid var(--border);
      border-radius: 18px;
      overflow: hidden;
    }

    .line-table th,
    .line-table td {
      padding: 14px 16px;
      text-align: left;
      border-bottom: 1px solid rgba(199, 184, 156, 0.6);
    }

    .line-table thead th {
      background: rgba(143, 75, 42, 0.08);
      font-size: 12px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    .line-table tbody tr:last-child td {
      border-bottom: none;
    }

    .num {
      text-align: right;
      white-space: nowrap;
    }

    .item-title {
      font-weight: 700;
      margin-bottom: 4px;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid rgba(199, 184, 156, 0.6);
    }

    .totals-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .totals-row.grand {
      font-size: 20px;
      padding-top: 12px;
    }

    .money {
      float: right;
      font-weight: 700;
    }

    .note-box p {
      margin-top: 8px;
      line-height: 1.5;
      white-space: pre-wrap;
    }

    @media (max-width: 720px) {
      .hero,
      .body { padding: 22px; }

      .hero-top,
      .order-head {
        flex-direction: column;
      }

      .status-stack {
        justify-content: flex-start;
      }
    }

    @media print {
      body {
        background: white;
      }

      .toolbar {
        display: none;
      }

      .document {
        margin: 0;
        max-width: none;
        padding: 0;
      }

      .sheet {
        border: none;
        box-shadow: none;
        border-radius: 0;
      }

      .order-card {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">Print</button>
    <button onclick="window.close()">Close</button>
  </div>

  <main class="document">
    <section class="sheet">
      <header class="hero">
        <div class="hero-top">
          <div>
            <div class="eyebrow">Combined Invoice Packet</div>
            <h1>${escapeHtml(bundle.customer_name || 'Customer Orders')}</h1>
            <p class="subtitle">${escapeHtml(bundle.customer_email || 'No email on file')} • Generated ${escapeHtml(formatDate(createdAt))}</p>
          </div>
          <div class="summary-card">
            <div class="eyebrow">Prepared By</div>
            <h3>${escapeHtml(shopInfo.name || bundle.shop || 'Shopify Store')}</h3>
            <div class="muted">${escapeHtml(shopInfo.email || '')}</div>
            <div class="muted">${escapeHtml(shopInfo.phone || '')}</div>
          </div>
        </div>

        <div class="summary-grid">
          <div class="summary-card">
            <div class="eyebrow">Orders</div>
            <div class="summary-value">${bundle.order_count}</div>
            <div class="summary-caption">Selected orders in this print run</div>
          </div>
          <div class="summary-card">
            <div class="eyebrow">Items</div>
            <div class="summary-value">${bundle.total_items}</div>
            <div class="summary-caption">Total quantity across all orders</div>
          </div>
          <div class="summary-card">
            <div class="eyebrow">Combined Total</div>
            <div class="summary-value">${formatMoney(bundle.total_amount, currency)}</div>
            <div class="summary-caption">Grand total across all included orders</div>
          </div>
        </div>
      </header>

      <div class="body">
        ${orderSections}
      </div>
    </section>
  </main>
</body>
</html>`;
}