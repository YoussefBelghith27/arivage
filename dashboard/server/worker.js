// Cloudflare entry. Static files (dist/) are served by Workers static assets; only /api/* reaches this code
// (wrangler.jsonc, run_worker_first). One Durable Object holds the SQLite data and runs the same Express app.
import { DurableObject } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { createServer } from 'node:http';
import './worker-env.js';
import { createApp } from './index.js';
import { doDb } from './do-db.js';
import { migrate } from './db.js';

export class Database extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // A single instance (idFromName main), so its in-memory login limiter covers every request.
    this.http = httpServerHandler(createServer(createApp(migrate(doDb(ctx.storage)))));
  }

  fetch(request) {
    return this.http.fetch(request);
  }
}

export default {
  fetch(request, env) {
    // Express reads the client IP from X-Forwarded-For (trust proxy 1). Set it from Cloudflare's own header,
    // replacing any value the client sent, so the login rate limiter and the [security] log can't be spoofed.
    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '127.0.0.1');
    return env.DB.get(env.DB.idFromName('main')).fetch(new Request(request, { headers }));
  },
};
