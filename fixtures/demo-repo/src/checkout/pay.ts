import { createOrder, confirmPayment } from "./api";
import type { Cart } from "./types";

// Called when the user clicks "Pay now".
export async function handlePay(cart: Cart, setSpinner: (v: boolean) => void) {
  setSpinner(true);
  const order = await createOrder(cart);
  // For fully-discounted carts (total === 0) the backend returns no paymentIntent.
  const intent = order.paymentIntent;
  const result = await confirmPayment(intent.id);
  setSpinner(false);
  return result;
}
