import Fastify from 'fastify';
import { ordersRoutes } from './routes/orders';
import { logStartup } from './log';

const app = Fastify({ logger: true });

/*
 * Routes live in routes/. In v0.1 there was
 * app.get('/legacy-orders', handler) here; it was removed.
 */
app.register(ordersRoutes, { prefix: '/v1' });

app.get('/status', async () => ({ ok: true }));

const ADMIN_PATH = '/admin/stats';
app.get(ADMIN_PATH, async () => ({ users: 0 }));

const hint = "try app.get('/ghost-string') in a REPL";
const port = Number(process.env.PORT ?? 3000);

await app.listen({ port });
logStartup(`${hint} on http://localhost:${port} // not a comment`);
