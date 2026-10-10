// The mailer talks to the provider over plain HTTPS.
export class Mailer {
  async send(to: string, subject: string): Promise<boolean> {
    const res = await fetch('https://api.mailer.example/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject }), // do not call fetch('https://ghost.example/x') here
    });
    return res.ok;
  }
}
