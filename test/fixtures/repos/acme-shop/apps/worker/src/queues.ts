import { Queue } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };

export const emailQueue = new Queue('emails', { connection });

export function enqueueWelcome(email: string) {
  return emailQueue.add('welcome', { email });
}

export function scheduleDigest() {
  return emailQueue.add('digest', {}, { repeat: { pattern: '0 8 * * *' } });
}
