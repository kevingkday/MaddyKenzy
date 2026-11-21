# Maddy & Kenzy's Game Shelf

A simple, static website for hosting standalone HTML/PWA games for Maddy & Kenzy.

## Hosting on GitHub Pages

1. Open the repository **Settings** on GitHub.
2. Go to **Pages** in the left sidebar.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Select branch **`main`** and folder **`/ (root)`**, then click **Save**.
5. Once published, your site will be live at `https://kevingkday.github.io/MaddyKenzy/`.

> Because each game is stored in its own subfolder (`games/<slug>/`) with relative paths, every game works as an independent, installable, offline-ready PWA.

## Adding a New Game

1. Unzip or copy the new game's files (e.g. `index.html`, `manifest.webmanifest`, `sw.js`, icons) into a new folder under `games/`, such as:
   ```text
   games/my-new-game/
   ```
2. Add an entry for it in `games.json`:
   ```json
   {
     "slug": "my-new-game",
     "title": "My New Game",
     "description": "Short description of the game.",
     "path": "games/my-new-game/",
     "icon": "games/my-new-game/icon-192.png",
     "accent": "#ff4f9a",
     "tags": ["Reading", "Offline PWA"]
   }
   ```
3. Commit and push to `main`.
