import type { Cart, Order } from "./types";

export async function createOrder(cart: Cart): Promise<Order> {
  const total = cart.items.reduce((s, i) => s + i.price * i.qty, 0) - cart.discount;
  // No payment intent is created when nothing is owed.
  const paymentIntent = total > 0 ? { id: `pi_${Date.now()}` } : undefined;
  return { id: "ord_1", total, paymentIntent } as Order;
}

export async function confirmPayment(intentId: string) {
  return { ok: true, intentId };
}
