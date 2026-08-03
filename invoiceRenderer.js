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

function normalizeAddress(address) {
  if (!address) return null;

  const fields = [
    'name',
    'company',
    'address1',
    'address2',
    'city',
    'province',
    'zip',
    'country',
    'phone',
  ];

  return fields.map(field => String(address[field] ?? '').trim()).join('|');
}

function getPreferredAddress(addresses) {
  const rankedAddresses = [];
  const addressCounts = new Map();

  for (const address of addresses) {
    const normalized = normalizeAddress(address);
    if (normalized === null) continue;

    if (!addressCounts.has(normalized)) {
      addressCounts.set(normalized, rankedAddresses.length);
      rankedAddresses.push({
        address,
        count: 1,
      });
      continue;
    }

    rankedAddresses[addressCounts.get(normalized)].count += 1;
  }

  if (!rankedAddresses.length) return null;

  return rankedAddresses.reduce((best, candidate) => {
    if (!best || candidate.count > best.count) {
      return candidate;
    }

    return best;
  }, null)?.address ?? null;
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

function renderBundleSheet(bundle, extraClass = '') {
  const createdAt = bundle.created_at || new Date().toISOString();
  const shopInfo = bundle.shopInfo || {};
  const currency = bundle.currency || bundle.orders[0]?.currency || 'USD';
  const preferredShippingAddress = getPreferredAddress(bundle.orders.map(order => order.shippingAddress));
  const preferredBillingAddress = getPreferredAddress(bundle.orders.map(order => order.billingAddress));
  const hasBundleAddressBlock = Boolean(preferredShippingAddress || preferredBillingAddress);

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

  return `
    <section class="sheet ${extraClass}">
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

        ${hasBundleAddressBlock ? `
        <div class="address-grid bundle-address-grid${preferredShippingAddress && preferredBillingAddress ? '' : ' single-address-grid'}">
          ${preferredShippingAddress ? `
          <div class="address-card">
            <div class="eyebrow">Ship To</div>
            ${renderAddress(preferredShippingAddress)}
          </div>
          ` : ''}
          ${preferredBillingAddress ? `
          <div class="address-card">
            <div class="eyebrow">Bill To</div>
            ${renderAddress(preferredBillingAddress)}
          </div>
          ` : ''}
        </div>
        ` : ''}
      </header>

      <div class="body">
        ${orderSections}
      </div>
    </section>
  `;
}

function renderDocumentShell(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
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
      font-size: 13px;
      line-height: 1.25;
    }

    .toolbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      padding: 10px 14px;
      background: rgba(247, 240, 223, 0.94);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
    }

    .toolbar button {
      border: 1px solid var(--ink);
      background: var(--ink);
      color: var(--paper-2);
      padding: 8px 12px;
      border-radius: 999px;
      font: inherit;
      cursor: pointer;
    }

    .document {
      max-width: 960px;
      margin: 16px auto 24px;
      padding: 0 12px;
    }

    .sheet {
      background: linear-gradient(180deg, var(--paper-2) 0%, var(--paper) 100%);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: 0 14px 28px var(--shadow);
      overflow: hidden;
    }

    .sheet.page-break {
      margin-top: 16px;
    }

    .hero {
      padding: 18px 20px 14px;
      background:
        linear-gradient(145deg, rgba(143, 75, 42, 0.12), transparent 45%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0));
      border-bottom: 1px solid var(--border);
    }

    .hero-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .eyebrow {
      font-size: 9px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }

    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(22px, 3.6vw, 32px); line-height: 1; }
    h2 { font-size: 18px; margin-bottom: 2px; }
    h3 { font-size: 15px; }
    .subtitle { color: var(--muted); margin-top: 4px; max-width: 52ch; font-size: 12px; }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .summary-card, .address-card, .totals-card, .note-box, .shipping-box {
      background: rgba(255, 255, 255, 0.45);
      border: 1px solid rgba(143, 75, 42, 0.15);
      border-radius: 12px;
      padding: 10px 12px;
    }

    .address-card {
      font-size: 11px;
      line-height: 1.2;
    }

    .summary-value {
      font-size: 20px;
      font-weight: 700;
      margin-top: 2px;
    }

    .summary-caption {
      color: var(--muted);
      margin-top: 3px;
      font-size: 11px;
    }

    .body {
      padding: 12px 20px 16px;
    }

    .order-card {
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }

    .order-card:last-child { border-bottom: none; padding-bottom: 0; }

    .order-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .order-meta, .muted, .item-meta {
      color: var(--muted);
    }

    .order-meta, .muted {
      font-size: 11px;
    }

    .item-meta {
      font-size: 10px;
      line-height: 1.2;
    }

    .status-stack {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
    }

    .pill {
      border: 1px solid rgba(143, 75, 42, 0.2);
      background: var(--accent-soft);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 11px;
      white-space: nowrap;
    }

    .muted-pill {
      background: rgba(255, 255, 255, 0.7);
    }

    .address-grid, .totals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .bundle-address-grid {
      margin-top: 8px;
      margin-bottom: 0;
    }

    .single-address-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .line-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      font-size: 11px;
    }

    .line-table th,
    .line-table td {
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid rgba(199, 184, 156, 0.6);
      vertical-align: top;
    }

    .line-table thead th {
      background: rgba(143, 75, 42, 0.08);
      font-size: 9px;
      letter-spacing: 0.1em;
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
      margin-bottom: 1px;
      line-height: 1.2;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px solid rgba(199, 184, 156, 0.6);
    }

    .totals-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .totals-row.grand {
      font-size: 15px;
      padding-top: 6px;
    }

    .money {
      float: right;
      font-weight: 700;
    }

    .note-box p {
      margin-top: 4px;
      line-height: 1.25;
      white-space: pre-wrap;
      font-size: 11px;
    }

    .shipping-box,
    .note-box,
    .address-card,
    .totals-card {
      break-inside: avoid;
    }

    @media (max-width: 720px) {
      .hero,
      .body { padding: 16px; }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      .hero-top,
      .order-head {
        flex-direction: column;
      }

      .status-stack {
        justify-content: flex-start;
      }
    }

    @media print {
      @page {
        size: auto;
        margin: 0.32in;
      }

      body {
        background: white;
        font-size: 10px;
        line-height: 1.15;
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

      .hero {
        padding: 10px 0 8px;
      }

      .body {
        padding: 8px 0 0;
      }

      .hero-top {
        margin-bottom: 8px;
        gap: 8px;
      }

      h1 {
        font-size: 18px;
      }

      h2 {
        font-size: 13px;
      }

      h3 {
        font-size: 12px;
      }

      .subtitle,
      .summary-caption,
      .order-meta,
      .muted,
      .item-meta,
      .note-box p {
        font-size: 9px;
      }

      .summary-grid {
        gap: 6px;
      }

      .summary-card,
      .address-card,
      .totals-card,
      .note-box,
      .shipping-box {
        padding: 6px 8px;
        border-radius: 8px;
      }

      .address-card {
        font-size: 9px;
      }

      .summary-value {
        font-size: 15px;
      }

      .order-card {
        padding: 8px 0;
      }

      .order-head,
      .address-grid,
      .totals-grid {
        margin-bottom: 6px;
      }

      .address-grid,
      .totals-grid {
        gap: 6px;
      }

      .bundle-address-grid {
        margin-top: 6px;
      }

      .pill {
        padding: 2px 6px;
        font-size: 9px;
      }

      .line-table {
        margin-bottom: 6px;
        font-size: 9px;
      }

      .line-table th,
      .line-table td {
        padding: 4px 5px;
      }

      .line-table thead th {
        font-size: 8px;
      }

      .totals-row {
        padding: 2px 0;
      }

      .totals-row.grand {
        font-size: 11px;
        padding-top: 4px;
      }

      .sheet.page-break {
        margin-top: 0;
        page-break-before: always;
      }

      .sheet.page-break:first-of-type {
        page-break-before: auto;
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
    ${content}
  </main>
</body>
</html>`;
}

export function renderBundleDocument(bundle) {
  return renderDocumentShell(`${bundle.customer_name || 'Customer'} Bundle`, renderBundleSheet(bundle));
}

export function renderBundleBatchDocument(bundles) {
  const sheets = bundles.map((bundle, index) => renderBundleSheet(bundle, index === 0 ? '' : 'page-break')).join('');
  return renderDocumentShell('Combined Bundles', sheets);
}