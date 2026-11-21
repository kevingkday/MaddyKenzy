(() => {
  const grid = document.getElementById('games-grid');
  const emptyState = document.getElementById('empty-state');
  const controls = document.getElementById('shelf-controls');
  const searchInput = document.getElementById('game-search');
  const gameCount = document.getElementById('game-count');

  const installDialog = document.getElementById('install-dialog');
  const openGuideBtn = document.getElementById('install-guide-btn');
  const closeGuideBtn = document.getElementById('close-dialog-btn');
  const doneGuideBtn = document.getElementById('done-dialog-btn');

  let allGames = [];

  function createGameCard(game) {
    const card = document.createElement('article');
    card.className = 'game-card';

    const top = document.createElement('div');
    top.className = 'card-top';

    const icon = document.createElement('img');
    icon.className = 'game-icon';
    icon.src = game.icon;
    icon.alt = `${game.title} icon`;
    icon.width = 78;
    icon.height = 78;
    icon.loading = 'lazy';

    const heading = document.createElement('div');
    heading.className = 'card-heading';

    const title = document.createElement('h2');
    title.className = 'game-title';
    title.textContent = game.title;
    heading.appendChild(title);

    if (Array.isArray(game.tags) && game.tags.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'tag-row';
      game.tags.forEach((label) => {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = label;
        tags.appendChild(chip);
      });
      heading.appendChild(tags);
    }

    top.append(icon, heading);

    const desc = document.createElement('p');
    desc.className = 'game-desc';
    desc.textContent = game.description || '';

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const playLink = document.createElement('a');
    playLink.className = 'btn btn-primary';
    playLink.href = game.path;
    playLink.textContent = 'Play Game';
    if (game.accent) {
      playLink.style.backgroundColor = game.accent;
      playLink.style.borderBottomColor = 'rgba(0, 0, 0, 0.28)';
    }

    actions.appendChild(playLink);
    card.append(top, desc, actions);
    return card;
  }

  function renderGames(games) {
    grid.replaceChildren(...games.map(createGameCard));
    emptyState.hidden = games.length > 0;
    if (gameCount) {
      gameCount.textContent = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;
    }
  }

  function filterGames() {
    const query = (searchInput.value || '').trim().toLowerCase();
    if (!query) {
      renderGames(allGames);
      return;
    }
    const filtered = allGames.filter((game) => {
      const haystack = [
        game.title,
        game.description,
        ...(Array.isArray(game.tags) ? game.tags : [])
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
    renderGames(filtered);
  }

  async function init() {
    try {
      const response = await fetch('games.json', { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      allGames = await response.json();
      if (allGames.length > 3) {
        controls.hidden = false;
      }
      renderGames(allGames);
    } catch (error) {
      emptyState.hidden = false;
      emptyState.textContent = 'Could not load games.json. Make sure this site is served over HTTP/HTTPS.';
      console.error('Failed to load games.json:', error);
    }
  }

  searchInput?.addEventListener('input', filterGames);

  openGuideBtn?.addEventListener('click', () => {
    installDialog?.showModal();
  });
  closeGuideBtn?.addEventListener('click', () => {
    installDialog?.close();
  });
  doneGuideBtn?.addEventListener('click', () => {
    installDialog?.close();
  });
  installDialog?.addEventListener('click', (event) => {
    if (event.target === installDialog) {
      installDialog.close();
    }
  });

  init();
})();
