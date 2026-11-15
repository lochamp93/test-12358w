// Compteur de morts — outils de l'overlay (icônes, données de démonstration, lecture du JSON)

const DEATH_ICONS = {
	skull: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.9 2 3 5.7 3 10.4c0 2.7 1.3 5 3.4 6.5V20c0 1.1.9 2 2 2h.6v-2.2h1.6V22h2.8v-2.2h1.6V22h.6c1.1 0 2-.9 2-2v-3.1c2.1-1.5 3.4-3.8 3.4-6.5C21 5.7 17.1 2 12 2Zm-3.6 12.2a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Zm3.6 2.6-1.2-2.2h2.4L12 16.8Zm3.6-2.6a2.3 2.3 0 1 1 0-4.6 2.3 2.3 0 0 1 0 4.6Z"/></svg>`,
	cross: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v6h6v4h-6v10h-4V12H4V8h6V2Z"/></svg>`
};

// Lit la valeur de la variable Streamer.bot (chaîne JSON) et renvoie { name, count } du jeu en cours
function ParseDeathData(raw) {
	let data = raw;
	if (typeof raw === 'string') {
		try { data = JSON.parse(raw); } catch (e) { data = null; }
	}
	if (!data || typeof data !== 'object' || typeof data.games !== 'object' || data.games === null)
		return null;

	const current = data.games[data.current];
	if (current) return { name: String(current.name || ''), count: Number(current.count) || 0 };

	return { name: '', count: 0 };
}

// Données de démonstration (aperçu de la page de paramétrage, sans Streamer.bot)
function CreateDemoFeed(onUpdate) {
	const games = [
		{ name: 'Elden Ring', count: 87 },
		{ name: 'World of Warcraft', count: 12 },
		{ name: 'Hollow Knight: Silksong', count: 143 }
	];
	let index = 0;
	let tick = 0;

	onUpdate({ ...games[index] });

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
		onUpdate({ ...games[index] });
	}, 2200);
}
