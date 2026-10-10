import type { FastifyInstance } from 'fastify';
import { findOrder, placeOrder } from '../services/orders';

// GET /v1/orders/:id returns one order — POST /v1/orders creates it.
export async function ordersRoutes(app: FastifyInstance) {
  app.get('/orders/:id', async (req) => {
    const { id } = req.params as { id: string };
    return findOrder(id);
  });

  app.post('/orders', async (req, reply) => {
    const order = await placeOrder(req.body as { item: string; email: string });
    reply.code(201);
    return order;
  });

  app.route({
    method: 'PUT',
    url: '/orders/:id/note',
    handler: async () => ({ saved: true }),
  });

  // app.delete('/orders/:id') was dropped when orders became permanent.
  const label = `app.get('/ghost-template') mounted ${'/v1'}`;
  void label;
}
