// Compteur de morts — outils de l'overlay (icônes, jaquettes, données de démonstration)

const DEATH_ICONS = {
	skull: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.9 2 3 5.7 3 10.4c0 2.7 1.3 5 3.4 6.5V20c0 1.1.9 2 2 2h.6v-2.2h1.6V22h2.8v-2.2h1.6V22h.6c1.1 0 2-.9 2-2v-3.1c2.1-1.5 3.4-3.8 3.4-6.5C21 5.7 17.1 2 12 2Zm-3.6 12.2a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Zm3.6 2.6-1.2-2.2h2.4L12 16.8Zm3.6-2.6a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z"/></svg>`,
	cross: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v6h6v4h-6v10h-4V12H4V8h6V2Z"/></svg>`
};

// Lit la valeur de la variable Streamer.bot (chaîne JSON) et renvoie le jeu en cours
// { name, count, cover (jaquette personnalisée), boxArt (modèle Twitch avec {width}x{height}) }
function ParseDeathData(raw) {
	let data = raw;
	if (typeof raw === 'string') {
		try { data = JSON.parse(raw); } catch (e) { data = null; }
	}
	if (!data || typeof data !== 'object' || typeof data.games !== 'object' || data.games === null)
		return null;

	const g = data.games[data.current];
	if (!g) return { name: '', count: 0, cover: '', boxArt: '' };

	return {
		name: String(g.name || ''),
		count: Number(g.count) || 0,
		cover: String(g.cover || ''),
		boxArt: String(g.boxArt || '')
	};
}

// Adresse de la jaquette à afficher : jaquette perso > jaquette Twitch > image de secours
function ResolveCoverURL(game, fallback, coverWidth) {
	if (game && game.cover) return game.cover;
	if (game && game.boxArt) {
		// Résolution doublée pour rester net à l'écran
		const w = Math.round(Math.max(40, coverWidth) * 2);
		const h = Math.round(w * 4 / 3);
		return game.boxArt.replace('{width}', w).replace('{height}', h);
	}
	return (fallback || '').trim();
}

// Jaquettes fictives pour la démo (SVG généré, aucune image externe)
function DemoCover(title, c1, c2) {
	const words = title.split(' ');
	const lines = words.map((w, i) => `<text x="150" y="${330 + i * 34 - (words.length - 1) * 17}" font-family="Segoe UI, sans-serif" font-size="30" font-weight="800" fill="#fff" text-anchor="middle">${w.toUpperCase()}</text>`).join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="300" height="400" fill="url(#g)"/><circle cx="150" cy="150" r="78" fill="#fff" fill-opacity=".14"/><circle cx="150" cy="150" r="46" fill="#000" fill-opacity=".25"/>${lines}</svg>`;
	return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Données de démonstration (aperçu de la page de paramétrage, sans Streamer.bot)
function CreateDemoFeed(onUpdate) {
	const games = [
		{ name: 'Elden Ring', count: 87, cover: DemoCover('Démo Ring', '#3b2a12', '#c9a227') },
		{ name: 'World of Warcraft', count: 12, cover: DemoCover('Démo Craft', '#0d2b4d', '#3fa7ff') },
		{ name: 'Hades II', count: 18, cover: DemoCover('Démo Hadès', '#0b3b33', '#38d6a8') }
	];
	let index = 0;
	let tick = 0;

	onUpdate({ ...games[index], boxArt: '' });

	return setInterval(() => {
		tick++;
		if (tick % 6 === 0) {
			index = (index + 1) % games.length; // changement de catégorie
		}
		else {
			const g = games[index];
			const delta = Math.random() < 0.8 ? 1 : -1;
			g.count = Math.max(0, g.count + delta);
		}
		onUpdate({ ...games[index], boxArt: '' });
	}, 2200);
}
