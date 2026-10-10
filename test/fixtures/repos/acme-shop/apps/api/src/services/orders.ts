import { notifier } from './notify';

type OrderInput = { item: string; email: string };

function normalize(input: OrderInput): OrderInput {
  return { item: input.item.trim(), email: input.email.toLowerCase() };
}

export async function placeOrder(input: OrderInput) {
  const clean = normalize(input);
  const order = { id: `ord_${Date.now()}`, ...clean };
  await notifier.send(order);
  return order;
}

export async function findOrder(id: string) {
  return { id, item: 'unknown' };
}
