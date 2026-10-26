export interface Cart { items: { price: number; qty: number }[]; discount: number; coupon?: string }
export interface Order { id: string; total: number; paymentIntent?: { id: string } }
