// Marks the run as failed so the grown-ups screen can say so. The live game is untouched.
import { api } from './improve-api.mjs';
await api('/api/internal/run', { family: process.env.FAMILY, run: process.env.RUN, status: 'failed', message: 'The review did not pass its checks, so there is no suggestion this time. The game is unchanged.' }).catch(() => {});
