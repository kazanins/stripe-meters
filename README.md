# Stripe Metered Billing Demo

Minimal Node.js + TypeScript demo for Stripe Meters + Meter Events with a small UI.

## Prereqs
- Node.js 18+ (20+ recommended)
- A Stripe test account

## Setup
```bash
npm install
cp .env.example .env
```

Fill in `.env` with your Stripe keys and IDs:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRICE_ID`
- `METER_EVENT_NAME`
- `APP_URL` (optional)

### How to get these values
**`STRIPE_WEBHOOK_SECRET`**  
Create a webhook endpoint in the Stripe Dashboard and copy the signing secret (`whsec_...`).  
For local dev, `stripe listen --forward-to localhost:4242/webhook` prints a `whsec_...` you can use.

**`PRICE_ID`**  
Create a recurring price in Stripe that uses a **metered** usage type and is attached to a Meter.  
Copy the price ID (looks like `price_...`).

**`METER_EVENT_NAME`**  
In Stripe, create a Meter and note its **event name**.  
Your meter events must use this exact name.

## Run
```bash
npm run dev
```
Open http://localhost:4242

## Webhooks (local)
```bash
stripe listen --forward-to localhost:4242/webhook
```
Copy the `whsec_...` into `STRIPE_WEBHOOK_SECRET` and restart the server.

## Notes
- Meter events are processed asynchronously, so invoice preview can lag.
- The "Pay with stablecoins" button is just a visual placeholder.
