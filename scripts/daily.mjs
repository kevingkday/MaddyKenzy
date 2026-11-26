// Daily review: for every family game with new play since its last review,
// run review -> safety checks -> save suggestion. One failure doesn't stop the others.
import { execSync } from 'node:child_process';
import { api } from './improve-api.mjs';
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
execSync('git checkout -- site', { stdio: 'ignore' });
console.log(`Done. ${due.length - failed} reviewed, ${failed} failed.`);
