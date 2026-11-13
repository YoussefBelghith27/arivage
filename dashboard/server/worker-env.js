// Imported before index.js: process.env is not yet filled when index.js runs its top level on Workers
// (GOOGLE_CLIENT_ID is read there), so copy the text vars and secrets in.
import { env } from 'cloudflare:workers';

for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
