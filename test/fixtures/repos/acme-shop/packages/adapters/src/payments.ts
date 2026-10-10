import Stripe from 'stripe';

const key = process.env.PAYMENTS_API_KEY ?? '';
const client = new Stripe(key);

export async function chargeCard(amount: number, token: string) {
  return client.paymentIntents.create({ amount, currency: 'usd', payment_method: token });
}
