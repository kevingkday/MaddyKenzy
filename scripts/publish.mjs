// Saves the tested candidate as a suggestion waiting for the parent (nothing goes live until they apply it).
import fs from 'node:fs';
import { api } from './improve-api.mjs';
const c = JSON.parse(fs.readFileSync('.candidate.json', 'utf8'));
const r = await api('/api/internal/propose', c);
console.log(`Suggestion saved as version ${r.version}, waiting for the parent.`);
