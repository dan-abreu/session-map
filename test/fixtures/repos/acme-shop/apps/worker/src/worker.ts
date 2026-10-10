import { Worker } from 'bullmq';
import { renderWelcome } from './templates';

const connection = { host: 'localhost', port: 6379 };

export async function processEmail(job: { data: { email: string } }) {
  return renderWelcome(job.data.email);
}

export const worker = new Worker('emails', processEmail, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
});
