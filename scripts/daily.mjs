// Nightly: 1) scorecard every family game (what did applied changes do?)
//          2) review games with new play -> safety checks -> save suggestion (+ voice clips)
//          3) rethink each game's playbook when enough results have been measured
// One failure doesn't stop the others.
import { execSync } from 'node:child_process';
import { api } from './improve-api.mjs';
// families created before encryption get their family key and encrypted notes (no-op once done)
try { const r = await api('/api/internal/encrypt-existing', {}); console.log(`Encryption check: ${r.done.length} family(s) up to date.`); }
catch (e) { console.log('Encryption check skipped: ' + e.message); }
const { games } = await api('/api/internal/families');
for (const g of games) {
  try { execSync('node scripts/scorecard.mjs', { env: { ...process.env, FAMILY: g.family, GAME: g.game }, stdio: 'inherit' }); }
  catch { console.log('Scorecard failed for one game; continuing.'); }
}
const { due } = await api(`/api/internal/pending?min=${process.env.MIN_NEW_EVENTS || 20}`);
console.log(`${due.length} game(s) with new play to review.`);
let failed = 0;
for (const d of due) {
  const env = { ...process.env, FAMILY: d.family, GAME: d.game, RUN: String(d.run), MANUAL: 'false', GITHUB_OUTPUT: '' };
  try {
    execSync('git checkout -- site', { stdio: 'ignore' });
    execSync('rm -f .candidate.json && node scripts/improve.mjs && if [ -f .candidate.json ]; then node scripts/test.mjs && node scripts/publish.mjs; fi', { env, stdio: 'inherit', shell: '/bin/bash' });
    // clips for the suggested config's new words, plus any lines that fell back to the iPad voice
    execSync('if [ -f .candidate.json ]; then CONFIG_FILE=.candidate.json node scripts/voice.mjs; else node scripts/voice.mjs; fi', { env, stdio: 'inherit', shell: '/bin/bash' });
  } catch {
    failed++;
    execSync('node scripts/fail.mjs', { env, stdio: 'inherit' });
  }
}
for (const g of games.filter(g => !g.private)) {
  try { execSync('node scripts/meta.mjs', { env: { ...process.env, FAMILY: g.family, GAME: g.game, RUN: '', FORCE: '' }, stdio: 'inherit' }); }
  catch { console.log('Playbook rethink failed for one game; continuing.'); }
}
execSync('git checkout -- site', { stdio: 'ignore' });
console.log(`Done. ${due.length - failed} reviewed, ${failed} failed.`);
