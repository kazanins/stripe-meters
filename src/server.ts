import crypto from "crypto";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import Stripe from "stripe";
import path from "path";

dotenv.config();

type UserRecord = { customerId: string; subscriptionId: string; active: boolean };

type SubscribeBody = { userId: string; email?: string };

type UsageBody = { userId: string; value?: number };

const users = new Map<string, UserRecord>();
const processedWebhookEventIds = new Set<string>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = requireEnv("STRIPE_WEBHOOK_SECRET");
const PRICE_ID = requireEnv("PRICE_ID");
const METER_EVENT_NAME = requireEnv("METER_EVENT_NAME");
const APP_URL = process.env.APP_URL || "http://localhost:4242";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

const app = express();
const publicDir = path.join(process.cwd(), "public");

const jsonParser = bodyParser.json();
app.use((req, res, next) => {
  if (req.path === "/webhook") {
    return next();
  }
  return jsonParser(req, res, next);
});
app.use(express.static(publicDir));

app.get("/status", (req: Request, res: Response) => {
  const userId = String(req.query.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }
  const record = users.get(userId);
  if (!record) {
    return res.status(404).json({ error: "unknown userId" });
  }
  return res.json(record);
});

app.post("/subscribe", async (req: Request<{}, {}, SubscribeBody>, res: Response) => {
  const userId = req.body.userId?.trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const existing = users.get(userId);
  if (existing) {
    return res.json({
      customerId: existing.customerId,
      subscriptionId: existing.subscriptionId,
      status: existing.active ? "active" : "inactive",
      reused: true,
    });
  }

  const customer = await stripe.customers.create({
    email: req.body.email,
    metadata: { userId },
  });

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: PRICE_ID }],
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  });

  // Real apps should attach a payment method via Checkout or a SetupIntent.
  const active = subscription.status === "active";
  users.set(userId, {
    customerId: customer.id,
    subscriptionId: subscription.id,
    active,
  });

  return res.json({
    customerId: customer.id,
    subscriptionId: subscription.id,
    status: subscription.status,
  });
});

app.post("/usage", async (req: Request<{}, {}, UsageBody>, res: Response) => {
  const userId = req.body.userId?.trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const record = users.get(userId);
  if (!record) {
    return res.status(404).json({ error: "unknown userId" });
  }

  const value = req.body.value ?? 1;
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: "value must be a positive number" });
  }

  const idempotencyKey = req.header("Idempotency-Key") ?? crypto.randomUUID();

  const meterEvent = await stripe.billing.meterEvents.create(
    {
      event_name: METER_EVENT_NAME,
      timestamp: Math.floor(Date.now() / 1000),
      payload: {
        stripe_customer_id: record.customerId,
        value: String(value),
        user_id: userId,
      },
    },
    { idempotencyKey }
  );

  return res.json({
    idempotencyKey,
    requestId: meterEvent.lastResponse?.requestId ?? null,
  });
});

app.get("/invoice/preview", async (req: Request, res: Response) => {
  const userId = String(req.query.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  const record = users.get(userId);
  if (!record) {
    return res.status(404).json({ error: "unknown userId" });
  }

  const invoice = await stripe.invoices.retrieveUpcoming({
    customer: record.customerId,
    subscription: record.subscriptionId,
  });

  const lines = invoice.lines.data.map((line) => ({
    description: line.description,
    amount: line.amount,
    quantity: line.quantity,
    period: line.period,
  }));

  return res.json({
    total: invoice.total,
    currency: invoice.currency,
    lines,
  });
});

app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || Array.isArray(signature)) {
      return res.status(400).send("Missing Stripe signature");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(400).send(`Webhook signature verification failed: ${message}`);
    }

    if (processedWebhookEventIds.has(event.id)) {
      return res.json({ received: true, duplicate: true });
    }
    processedWebhookEventIds.add(event.id);

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (customerId) {
        for (const record of users.values()) {
          if (record.customerId === customerId) {
            record.active = true;
          }
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id;
      if (customerId) {
        for (const record of users.values()) {
          if (record.customerId === customerId) {
            record.active = false;
          }
        }
      }
    }

    return res.json({ received: true });
  }
);

app.get("/", (_req: Request, res: Response) => {
  return res.sendFile(path.join(publicDir, "index.html"));
});

const port = Number(process.env.PORT || 4242);
app.listen(port, () => {
  console.log(`Listening on ${APP_URL} (port ${port})`);
});
