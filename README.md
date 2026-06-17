# Shopify Invoice Bundler

Embedded Shopify app for Pandora's Deck Box that combines multiple orders from one customer into a single printable invoice packet.

## What It Does

- Search Shopify customers by name, email, or phone
- Load that customer's recent orders in one place
- Select any mix of orders and generate one printable combined document
- Keep a history of generated bundles so they can be reopened and reprinted later
- Use the same custom OAuth + Railway deployment pattern as the store's other internal Shopify apps

## Stack

- Backend: Express.js + Shopify Admin API
- Frontend: single-page vanilla JS app
- Auth: offline-token Shopify OAuth with embedded-app iframe-safe redirects
- Storage: PostgreSQL on Railway, SQLite locally
- Hosting: Railway

## Setup

### 1. Create the Shopify App

In Shopify Dev Dashboard:

1. Create a new app.
2. Set App URL to `https://your-domain-or-railway-url/app`
3. Set Allowed redirection URL to `https://your-domain-or-railway-url/auth/callback`
4. Add these Admin API scopes:
	- `read_orders`
	- `read_customers`
5. Copy the app's Client ID and Client secret.

### 2. Deploy to Railway

1. Create a Railway project from this GitHub repo.
2. Add a PostgreSQL database.
3. Set these environment variables on the service:

```bash
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret
APP_URL=https://your-domain-or-railway-url
NODE_ENV=production
```

Railway will inject `DATABASE_URL` automatically when PostgreSQL is attached.

### 3. Update Shopify App URLs

After Railway gives you the real service URL, go back to Shopify Dev Dashboard and update:

- App URL: `https://your-real-url/app`
- Redirect URL: `https://your-real-url/auth/callback`

### 4. Install the App

Open:

```text
https://your-real-url/auth?shop=pandorasdeckbox.myshopify.com
```

Approve the scopes and the app will redirect back into Shopify Admin.

## Local Development

```bash
git clone https://github.com/pandorasdeckbox/shopify-invoice-bundler.git
cd shopify-invoice-bundler
npm install
cp .env.example .env
# Fill in Shopify credentials and a cloudflared APP_URL
npm run tunnel
npm run dev
```

Then open:

```text
http://localhost:3000/app?shop=pandorasdeckbox.myshopify.com
```

## Project Structure

```text
server.js            Express server, OAuth, Shopify API routes, print route
database.js          Railway PostgreSQL + local SQLite storage
invoiceRenderer.js   Combined invoice HTML renderer
public/index.html    Embedded app UI
railway.json         Railway deploy config
Procfile             Procfile fallback for Railway/Heroku-style runners
```
