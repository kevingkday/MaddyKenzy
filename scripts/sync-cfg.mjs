// Copies public/game.json into index.html as the built-in fallback, so the game
// still runs if game.json can't be fetched (offline first launch, previews).
import fs from 'node:fs';
const DIR = `site/games/${process.env.GAME || process.argv[2] || 'itsy-big-show'}`;
const cfg = JSON.parse(fs.readFileSync(`${DIR}/game.json`, 'utf8'));
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8');
const out = html.replace(/\/\*CFG\*\/[\s\S]*?\/\*END\*\//, `/*CFG*/${JSON.stringify(cfg)}/*END*/`);
if (out === html && !html.includes(`/*CFG*/${JSON.stringify(cfg)}/*END*/`)) throw new Error('CFG marker not found in index.html');
fs.writeFileSync(`${DIR}/index.html`, out);
console.log('synced game.json v' + cfg.version + ' into index.html');
