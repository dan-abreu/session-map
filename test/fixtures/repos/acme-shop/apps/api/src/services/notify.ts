type Order = { id: string; email: string };

export class Notifier {
  send(order: Order): string {
    return `queued receipt for ${order.email}`;
  }
}

export const notifier = new Notifier();
