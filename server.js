import express from 'express';
import { ApiVersion, LogSeverity, Session, shopifyApi } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getBundleById,
  getBundleHistory,
  initDatabase,
  saveBundleHistory,
  sessionStorage,
} from './database.js';
import { renderBundleBatchDocument, renderBundleDocument } from './invoiceRenderer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_ENV = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'APP_URL'];
const missing = REQUIRED_ENV.filter(name => !process.env[name]);

if (missing.length) {
  console.error(`\n❌ Missing required environment variables: ${missing.join(', ')}`);
  console.error('   Set these in Railway or .env, then restart the app.\n');
  process.exit(1);
}

await initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const oauthStateStorage = new Map();
const OAUTH_SCOPES = ['read_orders', 'read_customers'];

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const dataString = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${timestamp}] [${level}] ${message}${dataString}`);
}

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: OAUTH_SCOPES,
  hostName: process.env.APP_URL?.replace(/https?:\/\//, '') || 'localhost',
  hostScheme: 'https',
  apiVersion: ApiVersion.January25,
  isEmbeddedApp: true,
  sessionStorage,
  logger: { level: IS_PRODUCTION ? LogSeverity.Warning : LogSeverity.Debug },
  useOnlineTokens: false,
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

async function verifySession(req, res) {
  const shop = req.query.shop || req.body?.shop;
  if (!shop) {
    res.status(400).json({ error: 'Missing shop parameter' });
    return null;
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    res.status(400).json({ error: 'Invalid shop parameter' });
    return null;
  }

  const session = await sessionStorage.loadSession(`offline_${sanitizedShop}`);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated. Please reinstall the app.', authUrl: `/auth?shop=${encodeURIComponent(sanitizedShop)}` });
    return null;
  }

  req.shopifySession = session;
  return session;
}

function gidToNumeric(gid) {
  return String(gid || '').split('/').pop();
}

function normalizeStatusValue(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replaceAll(/\s+/g, '_');
}

function moneyAmount(moneySet) {
  return Number(moneySet?.shopMoney?.amount || 0);
}

function moneyCurrency(moneySet) {
  return moneySet?.shopMoney?.currencyCode || 'USD';
}

function mapAddress(address) {
  if (!address) return null;

  return {
    name: address.name || '',
    company: address.company || '',
    address1: address.address1 || '',
    address2: address.address2 || '',
    city: address.city || '',
    province: address.province || '',
    zip: address.zip || '',
    country: address.country || '',
    phone: address.phone || '',
  };
}

function mapLineItem(item, currency) {
  const unitPrice = moneyAmount(item.originalUnitPriceSet);
  const lineTotal = item.discountedTotalSet
    ? moneyAmount(item.discountedTotalSet)
    : unitPrice * Number(item.quantity || 0);

  return {
    title: item.title || 'Untitled item',
    variantTitle: item.variantTitle || '',
    sku: item.sku || '',
    quantity: Number(item.quantity || 0),
    unitPrice,
    lineTotal,
    currency,
  };
}

function mapOrder(orderNode) {
  const currency = moneyCurrency(orderNode.totalPriceSet);
  const lineItems = (orderNode.lineItems?.nodes || []).map(item => mapLineItem(item, currency));
  const displayFulfillmentStatus = orderNode.displayFulfillmentStatus || 'Unfulfilled';

  return {
    id: orderNode.id,
    numericId: gidToNumeric(orderNode.id),
    name: orderNode.name,
    email: orderNode.email || orderNode.customer?.email || '',
    createdAt: orderNode.createdAt,
    displayFinancialStatus: orderNode.displayFinancialStatus || 'Unknown',
    displayFulfillmentStatus,
    fulfillmentStatusCode: normalizeStatusValue(displayFulfillmentStatus),
    note: orderNode.note || '',
    currency,
    subtotalPrice: moneyAmount(orderNode.subtotalPriceSet),
    shippingPrice: moneyAmount(orderNode.totalShippingPriceSet),
    taxPrice: moneyAmount(orderNode.totalTaxSet),
    totalPrice: moneyAmount(orderNode.totalPriceSet),
    shippingAddress: mapAddress(orderNode.shippingAddress),
    billingAddress: mapAddress(orderNode.billingAddress),
    shippingLines: (orderNode.shippingLines?.nodes || []).map(line => ({
      title: line.title || 'Shipping',
      price: moneyAmount(line.originalPriceSet),
    })),
    customer: orderNode.customer ? {
      id: orderNode.customer.id,
      displayName: orderNode.customer.displayName || '',
      email: orderNode.customer.email || '',
    } : null,
    lineItems,
    totalQuantity: lineItems.reduce((sum, item) => sum + item.quantity, 0),
  };
}

function getBundleIdentity(order) {
  const customerId = order.customer?.id || '';
  const email = String(order.customer?.email || order.email || '').trim().toLowerCase();
  const displayName = order.customer?.displayName
    || order.shippingAddress?.name
    || order.billingAddress?.name
    || order.email
    || order.name;

  if (customerId) {
    return {
      key: `customer:${customerId}`,
      customerId,
      displayName,
      email: order.customer?.email || order.email || '',
    };
  }

  if (email) {
    return {
      key: `guest-email:${email}`,
      customerId: '',
      displayName,
      email: order.email || '',
    };
  }

  return {
    key: `guest-order:${order.id}`,
    customerId: '',
    displayName,
    email: order.email || '',
  };
}

function isBundlableOpenOrder(order, includeOnHold = true) {
  if (['UNFULFILLED', 'PARTIALLY_FULFILLED'].includes(order.fulfillmentStatusCode)) return true;
  if (includeOnHold && order.fulfillmentStatusCode === 'ON_HOLD') return true;
  return false;
}

function groupOrdersByBundle(orders) {
  const bundles = new Map();

  for (const order of orders) {
    const identity = getBundleIdentity(order);
    if (!bundles.has(identity.key)) {
      bundles.set(identity.key, {
        key: identity.key,
        customer: {
          id: identity.customerId,
          displayName: identity.displayName,
          email: identity.email,
        },
        currency: order.currency,
        orderIds: [],
        orders: [],
        order_count: 0,
        total_items: 0,
        total_amount: 0,
        has_on_hold_orders: false,
      });
    }

    const bundle = bundles.get(identity.key);
    bundle.orderIds.push(order.id);
    bundle.orders.push(order);
    bundle.order_count += 1;
    bundle.total_items += order.totalQuantity;
    bundle.total_amount += Number(order.totalPrice || 0);
    bundle.has_on_hold_orders = bundle.has_on_hold_orders || order.fulfillmentStatusCode === 'ON_HOLD';
  }

  return [...bundles.values()]
    .map(bundle => ({
      ...bundle,
      orders: bundle.orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      total_amount: Number(bundle.total_amount.toFixed(2)),
      newest_order_at: bundle.orders.reduce((latest, order) => latest > order.createdAt ? latest : order.createdAt, bundle.orders[0]?.createdAt || null),
    }))
    .sort((a, b) => {
      if (b.order_count !== a.order_count) return b.order_count - a.order_count;
      return new Date(b.newest_order_at || 0) - new Date(a.newest_order_at || 0);
    });
}

function buildCustomerSearchQuery(raw) {
  const query = String(raw || '').trim();
  if (!query) return '';
  if (query.includes('@')) return `email:${query}`;
  if (/^\+?[\d\s().-]+$/.test(query)) return `phone:${query}`;
  return query;
}

async function getGraphqlClient(session) {
  return new shopify.clients.Graphql({ session });
}

async function fetchShopInfo(session) {
  const client = new shopify.clients.Rest({ session });
  const response = await client.get({ path: 'shop' });
  const shop = response.body.shop;

  return {
    name: shop.name,
    email: shop.email,
    phone: shop.phone,
    myshopifyDomain: shop.myshopify_domain,
  };
}

async function fetchSelectedOrders(session, orderIds) {
  const client = await getGraphqlClient(session);
  const query = `
    query BundleOrders($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          email
          createdAt
          note
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          shippingAddress {
            name
            company
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          billingAddress {
            name
            company
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          shippingLines(first: 10) {
            nodes {
              title
              originalPriceSet { shopMoney { amount currencyCode } }
            }
          }
          customer {
            id
            displayName
            email
          }
          lineItems(first: 100) {
            nodes {
              title
              variantTitle
              sku
              quantity
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  `;

  const response = await client.request(query, { variables: { ids: orderIds } });
  return (response?.data?.nodes || []).filter(Boolean).map(mapOrder);
}

async function fetchOpenOrders(session, includeOnHold = true) {
  const client = await getGraphqlClient(session);
  const orders = [];
  let hasNextPage = true;
  let cursor = null;

  const query = `
    query OpenOrders($query: String!, $first: Int!, $after: String) {
      orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          email
          createdAt
          note
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          shippingAddress {
            name
            company
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          billingAddress {
            name
            company
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          shippingLines(first: 10) {
            nodes {
              title
              originalPriceSet { shopMoney { amount currencyCode } }
            }
          }
          customer {
            id
            displayName
            email
          }
          lineItems(first: 100) {
            nodes {
              title
              variantTitle
              sku
              quantity
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              discountedTotalSet { shopMoney { amount currencyCode } }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  while (hasNextPage) {
    const response = await client.request(query, {
      variables: {
        query: 'status:open',
        first: 100,
        after: cursor,
      },
    });

    const connection = response?.data?.orders;
    const nodes = connection?.nodes || [];
    orders.push(...nodes.map(mapOrder).filter(order => isBundlableOpenOrder(order, includeOnHold)));

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor || null;
  }

  return orders;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', async (req, res) => {
  const { shop, host } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return res.status(400).send('Invalid shop parameter');
  }

  const session = await sessionStorage.loadSession(`offline_${sanitizedShop}`);
  if (!session) {
    const authUrl = `/auth?shop=${encodeURIComponent(sanitizedShop)}${host ? `&host=${encodeURIComponent(String(host))}` : ''}`;
    return res.send(`<!DOCTYPE html><html><head><script>window.top.location.href=${JSON.stringify(authUrl)};<\/script></head><body>Redirecting...</body></html>`);
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/app', async (req, res) => {
  const { shop, host } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return res.status(400).send('Invalid shop parameter');
  }

  const session = await sessionStorage.loadSession(`offline_${sanitizedShop}`);
  if (!session) {
    const authUrl = `/auth?shop=${encodeURIComponent(sanitizedShop)}${host ? `&host=${encodeURIComponent(String(host))}` : ''}`;
    return res.send(`<!DOCTYPE html><html><head><script>window.top.location.href=${JSON.stringify(authUrl)};<\/script></head><body>Redirecting...</body></html>`);
  }

  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/exitiframe', (req, res) => {
  const { shop } = req.query;
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }

  const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
  if (!sanitizedShop) {
    return res.status(400).send('Invalid shop parameter');
  }

  const redirectUri = `https://${sanitizedShop}/admin/apps/${process.env.SHOPIFY_API_KEY}/auth?shop=${encodeURIComponent(sanitizedShop)}`;
  return res.send(`<!DOCTYPE html><html><head><script>window.top.location.href=${JSON.stringify(redirectUri)};</script></head><body>Redirecting...</body></html>`);
});

app.get('/auth', async (req, res) => {
  try {
    const { shop } = req.query;
    if (!shop) {
      return res.status(400).send('Missing shop parameter');
    }

    const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
    if (!sanitizedShop) {
      return res.status(400).send('Invalid shop parameter');
    }

    const state = crypto.randomBytes(16).toString('hex');
    oauthStateStorage.set(sanitizedShop, state);

    const authUrl = `https://${sanitizedShop}/admin/oauth/authorize?` + new URLSearchParams({
      client_id: process.env.SHOPIFY_API_KEY,
      scope: OAUTH_SCOPES.join(','),
      redirect_uri: `${process.env.APP_URL}/auth/callback`,
      state,
    }).toString();

    log('INFO', 'OAuth started', { shop: sanitizedShop });
    return res.redirect(authUrl);
  } catch (error) {
    log('ERROR', 'Auth error', { error: error.message });
    return res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { shop, code, state } = req.query;
    if (!shop || !code || !state) {
      throw new Error('Missing required OAuth parameters');
    }

    const sanitizedShop = shopify.utils.sanitizeShop(shop, true);
    if (!sanitizedShop) {
      throw new Error('Invalid shop parameter');
    }

    const storedState = oauthStateStorage.get(sanitizedShop);
    if (storedState !== state) {
      throw new Error('Invalid OAuth state parameter');
    }
    oauthStateStorage.delete(sanitizedShop);

    const tokenResponse = await fetch(`https://${sanitizedShop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const body = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${body}`);
    }

    const tokenData = await tokenResponse.json();
    const session = new Session({
      id: `offline_${sanitizedShop}`,
      shop: sanitizedShop,
      state: '',
      isOnline: false,
      scope: tokenData.scope,
      accessToken: tokenData.access_token,
    });

    await sessionStorage.storeSession(session);
    log('INFO', 'OAuth completed', { shop: sanitizedShop });
    return res.redirect(`https://${sanitizedShop}/admin/apps/${process.env.SHOPIFY_API_KEY}`);
  } catch (error) {
    log('ERROR', 'OAuth callback error', { error: error.message });
    return res.status(500).send(`Authentication failed: ${error.message}`);
  }
});

app.get('/api/shop', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const shopInfo = await fetchShopInfo(session);
    res.json(shopInfo);
  } catch (error) {
    log('ERROR', 'Failed to fetch shop info', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch shop info' });
  }
});

app.get('/api/open-bundles', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const includeOnHold = String(req.query.includeOnHold || 'true') !== 'false';
    const orders = await fetchOpenOrders(session, includeOnHold);
    const bundles = groupOrdersByBundle(orders);

    res.json({
      includeOnHold,
      orderCount: orders.length,
      bundleCount: bundles.length,
      bundles,
    });
  } catch (error) {
    log('ERROR', 'Open bundle scan failed', { error: error.message });
    res.status(500).json({ error: 'Failed to scan open orders' });
  }
});

app.get('/api/customers/search', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const client = await getGraphqlClient(session);
    const query = `
      query SearchCustomers($query: String!, $first: Int!) {
        customers(first: $first, query: $query, sortKey: LAST_ORDER_DATE, reverse: true) {
          nodes {
            id
            displayName
            firstName
            lastName
            email
            phone
            defaultAddress {
              city
              province
              country
            }
          }
        }
      }
    `;

    const response = await client.request(query, {
      variables: {
        query: buildCustomerSearchQuery(q),
        first: 15,
      },
    });

    const customers = (response?.data?.customers?.nodes || []).map(customer => ({
      id: customer.id,
      numericId: gidToNumeric(customer.id),
      displayName: customer.displayName || [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.email || 'Unnamed customer',
      email: customer.email || '',
      phone: customer.phone || '',
      location: [customer.defaultAddress?.city, customer.defaultAddress?.province, customer.defaultAddress?.country].filter(Boolean).join(', '),
    }));

    res.json({ customers });
  } catch (error) {
    log('ERROR', 'Customer search failed', { error: error.message });
    res.status(500).json({ error: 'Failed to search customers' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const customerId = String(req.query.customerId || '');
    if (!customerId) {
      return res.status(400).json({ error: 'Missing customerId parameter' });
    }

    const client = await getGraphqlClient(session);
    const query = `
      query CustomerOrders($customerId: ID!) {
        customer(id: $customerId) {
          id
          displayName
          email
          orders(first: 100, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              email
              createdAt
              note
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              subtotalPriceSet { shopMoney { amount currencyCode } }
              totalShippingPriceSet { shopMoney { amount currencyCode } }
              totalTaxSet { shopMoney { amount currencyCode } }
              shippingAddress {
                name
                company
                address1
                address2
                city
                province
                zip
                country
                phone
              }
              billingAddress {
                name
                company
                address1
                address2
                city
                province
                zip
                country
                phone
              }
              shippingLines(first: 10) {
                nodes {
                  title
                  originalPriceSet { shopMoney { amount currencyCode } }
                }
              }
              customer {
                id
                displayName
                email
              }
              lineItems(first: 100) {
                nodes {
                  title
                  variantTitle
                  sku
                  quantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  discountedTotalSet { shopMoney { amount currencyCode } }
                }
              }
            }
          }
        }
      }
    `;

    const response = await client.request(query, {
      variables: { customerId },
    });

    const customer = response?.data?.customer;
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const orders = (customer.orders?.nodes || []).map(mapOrder);
    res.json({
      customer: {
        id: customer.id,
        displayName: customer.displayName || 'Customer',
        email: customer.email || '',
      },
      orders,
    });
  } catch (error) {
    log('ERROR', 'Order fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.post('/api/bundles', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const orderIds = Array.isArray(req.body.orderIds)
      ? req.body.orderIds.map(value => String(value)).filter(Boolean)
      : [];

    if (!orderIds.length) {
      return res.status(400).json({ error: 'Select at least one order' });
    }

    const orders = await fetchSelectedOrders(session, orderIds);
    if (!orders.length) {
      return res.status(404).json({ error: 'No orders found for the selected IDs' });
    }

    const customerIds = [...new Set(orders.map(order => order.customer?.id).filter(Boolean))];
    if (customerIds.length > 1) {
      return res.status(400).json({ error: 'All selected orders must belong to the same customer' });
    }

    const customerName = orders[0]?.customer?.displayName || 'Customer';
    const customerEmail = orders[0]?.customer?.email || '';
    const totalItems = orders.reduce((sum, order) => sum + order.totalQuantity, 0);
    const totalAmount = orders.reduce((sum, order) => sum + order.totalPrice, 0).toFixed(2);

    const bundleId = await saveBundleHistory(session.shop, {
      customer_name: customerName,
      customer_email: customerEmail,
      order_count: orders.length,
      total_items: totalItems,
      total_amount: totalAmount,
      orders,
    });

    res.json({
      id: bundleId,
      url: `/print/${bundleId}?shop=${encodeURIComponent(session.shop)}`,
    });
  } catch (error) {
    log('ERROR', 'Bundle generation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to generate bundle document' });
  }
});

app.post('/api/bundles/print-all', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const groups = Array.isArray(req.body.groups)
      ? req.body.groups.map(group => Array.isArray(group) ? group.map(value => String(value)).filter(Boolean) : []).filter(group => group.length)
      : [];

    if (!groups.length) {
      return res.status(400).json({ error: 'No bundle groups were provided' });
    }

    const uniqueOrderIds = [...new Set(groups.flat())];
    const allOrders = await fetchSelectedOrders(session, uniqueOrderIds);
    const orderMap = new Map(allOrders.map(order => [order.id, order]));
    const bundleIds = [];
    const bundles = [];

    for (const group of groups) {
      const orders = group.map(orderId => orderMap.get(orderId)).filter(Boolean);
      if (!orders.length) continue;

      const identities = [...new Set(orders.map(order => getBundleIdentity(order).key))];
      if (identities.length > 1) {
        return res.status(400).json({ error: 'Each print group must contain orders from only one bundled customer' });
      }

      const customerName = getBundleIdentity(orders[0]).displayName || 'Customer';
      const customerEmail = getBundleIdentity(orders[0]).email || '';
      const totalItems = orders.reduce((sum, order) => sum + order.totalQuantity, 0);
      const totalAmount = orders.reduce((sum, order) => sum + order.totalPrice, 0).toFixed(2);
      const bundleId = await saveBundleHistory(session.shop, {
        customer_name: customerName,
        customer_email: customerEmail,
        order_count: orders.length,
        total_items: totalItems,
        total_amount: totalAmount,
        orders,
      });

      bundleIds.push(bundleId);
      bundles.push({
        id: bundleId,
        url: `/print/${bundleId}?shop=${encodeURIComponent(session.shop)}`,
        customer_name: customerName,
        customer_email: customerEmail,
      });
    }

    if (!bundleIds.length) {
      return res.status(404).json({ error: 'No printable bundles were generated' });
    }

    res.json({
      bundleIds,
      bundles,
      printAllUrl: `/print/all?shop=${encodeURIComponent(session.shop)}&ids=${bundleIds.join(',')}`,
    });
  } catch (error) {
    log('ERROR', 'Batch bundle generation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to generate print-all bundle set' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const history = await getBundleHistory(session.shop, 25);
    res.json({
      history: history.map(entry => ({
        id: entry.id,
        customer_name: entry.customer_name,
        customer_email: entry.customer_email,
        order_count: entry.order_count,
        total_items: entry.total_items,
        total_amount: entry.total_amount,
        created_at: entry.created_at,
      })),
    });
  } catch (error) {
    log('ERROR', 'Failed to load history', { error: error.message });
    res.status(500).json({ error: 'Failed to load history' });
  }
});

app.get('/print/all', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const ids = String(req.query.ids || '')
      .split(',')
      .map(value => Number(value.trim()))
      .filter(value => Number.isInteger(value) && value > 0);

    if (!ids.length) {
      return res.status(400).send('Missing bundle ids');
    }

    const bundles = (await Promise.all(ids.map(id => getBundleById(session.shop, id)))).filter(Boolean);
    if (!bundles.length) {
      return res.status(404).send('No bundles found');
    }

    const shopInfo = await fetchShopInfo(session);
    const html = renderBundleBatchDocument(bundles.map(bundle => ({
      ...bundle,
      shop: session.shop,
      shopInfo,
      currency: bundle.orders[0]?.currency || 'USD',
    })));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    log('ERROR', 'Failed to render print-all document', { error: error.message });
    res.status(500).send(`Failed to render print-all bundle: ${error.message}`);
  }
});

app.get('/print/:id', async (req, res) => {
  try {
    const session = await verifySession(req, res);
    if (!session) return;

    const bundleId = Number(req.params.id);
    if (!Number.isInteger(bundleId)) {
      return res.status(400).send('Invalid bundle id');
    }

    const bundle = await getBundleById(session.shop, bundleId);
    if (!bundle) {
      return res.status(404).send('Bundle not found');
    }

    const shopInfo = await fetchShopInfo(session);
    const html = renderBundleDocument({
      ...bundle,
      shop: session.shop,
      shopInfo,
      currency: bundle.orders[0]?.currency || 'USD',
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    log('ERROR', 'Failed to render print document', { error: error.message });
    res.status(500).send(`Failed to render bundle: ${error.message}`);
  }
});

app.listen(PORT, () => {
  log('INFO', `Server listening on port ${PORT}`, { appUrl: process.env.APP_URL });
});