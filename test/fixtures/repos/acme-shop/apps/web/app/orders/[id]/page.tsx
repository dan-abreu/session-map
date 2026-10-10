import { fetchOrder } from '../../../lib/api';

export default async function OrderPage({ params }: { params: { id: string } }) {
  const order = await fetchOrder(params.id);
  return <section>Order {order.id}</section>;
}
