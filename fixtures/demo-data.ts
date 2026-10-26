// SYNTHETIC fixture data for demo mode. Never mixed with real integration output:
// every evidence item built from this file is flagged `synthetic: true`.

export const DEMO_SAMPLES = [
  { label: "Checkout spinner (diagnosable)", text: "Checkout keeps spinning after clicking pay. I used a 100% off coupon.", userId: "u_1042" },
  { label: "Unknown user (NO_SESSION)", text: "Checkout keeps spinning after clicking pay.", userId: "u_9999" },
  { label: "Vague report (NO_DIAGNOSIS)", text: "The app feels kind of slow sometimes, not sure when." },
  { label: "Not a bug (SKIPPED)", text: "Thanks team, great release! Lunch at 1?" },
];

export const DEMO_POSTHOG_EVENTS = [
  { distinct_id: "u_1042", event: "checkout_started", timestamp: "2026-10-20T10:01:02Z", properties: { cart_total: 49 } },
  { distinct_id: "u_1042", event: "coupon_applied", timestamp: "2026-10-20T10:01:20Z", properties: { code: "FREE100", discount: 49 } },
  { distinct_id: "u_1042", event: "pay_clicked", timestamp: "2026-10-20T10:01:31Z", properties: { cart_total: 0 } },
  { distinct_id: "u_1042", event: "$exception", timestamp: "2026-10-20T10:01:32Z", properties: { message: "TypeError: Cannot read properties of undefined (reading 'id')" } },
];

export const DEMO_SENTRY_ISSUES = [
  {
    id: "DEMO-1",
    title: "TypeError: Cannot read properties of undefined (reading 'id')",
    userId: "u_1042",
    count: 17,
    lastSeen: "2026-10-20T10:01:32Z",
    frames: [
      { filename: "src/checkout/pay.ts", function: "handlePay", lineno: 10, context_line: "  const result = await confirmPayment(intent.id);" },
    ],
    breadcrumbs: [
      { timestamp: "2026-10-20T10:01:20Z", category: "ui.click", message: "apply coupon FREE100" },
      { timestamp: "2026-10-20T10:01:31Z", category: "ui.click", message: "button#pay-now" },
      { timestamp: "2026-10-20T10:01:31Z", category: "xhr", message: "POST /orders -> 200 (paymentIntent: null)" },
    ],
  },
];
