// Compteur de morts — dock de contrôle (à ajouter dans OBS : Docks → Docks de navigateur personnalisés)
// Toutes les modifications passent par l'action Streamer.bot : le dock, l'overlay et
// les commandes du chat partagent donc toujours la même valeur.

const $ = (id) => document.getElementById(id);

const els = {
	status: $('status'),
	panelDisconnected: $('panelDisconnected'),
	sbTarget: $('sbTarget'),
	panelMissingAction: $('panelMissingAction'),
	missingActionName: $('missingActionName'),
	main: $('main'),
	gameName: $('gameName'),
	modeBadge: $('modeBadge'),
	countDisplay: $('countDisplay'),
	minus: $('minusButton'),
	plus: $('plusButton'),
	setInput: $('setInput'),
	setButton: $('setButton'),
	reset: $('resetButton'),
	announce: $('announceToggle'),
	gameSection: $('gameSection'),
	gameInput: $('gameInput'),
	gameOptions: $('gameOptions'),
	selectGame: $('selectGameButton'),
	auto: $('autoButton'),
	listSection: $('listSection'),
	gameList: $('gameList'),
	emptyList: $('emptyList'),
	toast: $('toast')
};

let ws = null;
let sbClient = null, sbHost = null, sbPort = null;
let connected = false;
let actionFound = false;
let data = { games: {}, current: '', manual: false }; // contenu de la variable Streamer.bot

const ANNOUNCE_KEY = 'compteur-morts-dock-announce';
let openCoverEditor = null; // clé du jeu dont l'éditeur de jaquette est ouvert

// Miniature : jaquette perso, sinon modèle Twitch en petite taille
function CoverThumb(g) {
	if (g.cover) return g.cover;
	if (g.boxArt) return g.boxArt.replace('{width}', '60').replace('{height}', '80');
	return '';
}

///////////////
// AFFICHAGE //
///////////////

function Toast(text) {
	els.toast.textContent = text;
	els.toast.classList.add('show');
	clearTimeout(Toast.t);
	Toast.t = setTimeout(() => els.toast.classList.remove('show'), 2500);
}

function CurrentGame() {
	return data.games[data.current] || null;
}

function Render() {
	const s = ws.values;
	const demo = ws.demo && !connected; // aperçu sans Streamer.bot : exemple local

	document.documentElement.style.setProperty('--dock-accent', s.accentColor);
	els.minus.textContent = `−${s.step}`;
	els.plus.textContent = `+${s.step}`;

	// Bandeaux d'état
	els.status.textContent = demo ? 'Démo' : (connected ? 'Connecté' : 'Déconnecté');
	els.status.className = 'status ' + (demo || connected ? 'on' : 'off');
	els.panelDisconnected.hidden = demo || connected;
	els.sbTarget.textContent = `${s.address}:${s.port}`;
	els.panelMissingAction.hidden = demo || !connected || actionFound;
	els.missingActionName.textContent = s.actionName;
	els.main.classList.toggle('disabled', !demo && !(connected && actionFound));

	// Jeu en cours
	const game = CurrentGame();
	els.gameName.textContent = game ? game.name : 'Aucun jeu (catégorie Twitch au prochain clic)';
	els.countDisplay.textContent = game ? String(game.count) : '0';
	els.modeBadge.textContent = data.manual ? 'Choix manuel' : 'Catégorie Twitch';
	els.modeBadge.classList.toggle('manual', !!data.manual);

	// Sections conditionnelles
	els.gameSection.hidden = !s.allowManualGame;
	els.auto.disabled = !data.manual;
	els.listSection.hidden = !s.showGameList;

	// Liste des jeux (triée par dernière modification)
	const entries = Object.entries(data.games)
		.sort((a, b) => String(b[1].updated || '').localeCompare(String(a[1].updated || '')) || String(a[1].name).localeCompare(String(b[1].name)));

	els.gameOptions.innerHTML = '';
	els.gameList.innerHTML = '';
	for (const [key, g] of entries) {
		const opt = document.createElement('option');
		opt.value = g.name;
		els.gameOptions.appendChild(opt);

		const item = document.createElement('div');
		item.className = 'game-item' + (key === data.current ? ' current' : '');

		// Miniature de la jaquette (perso, sinon Twitch)
		const thumb = document.createElement('span');
		thumb.className = 'thumb';
		const thumbURL = CoverThumb(g);
		if (thumbURL) {
			const img = document.createElement('img');
			img.src = thumbURL;
			img.alt = '';
			img.onerror = () => img.remove();
			thumb.appendChild(img);
		}
		item.appendChild(thumb);

		const name = document.createElement('span');
		name.className = 'name';
		name.textContent = g.name;
		name.title = g.name;

		const count = document.createElement('span');
		count.className = 'count';
		count.textContent = String(g.count);

		item.append(name, count);

		if (s.allowManualGame && key !== data.current) {
			const choose = document.createElement('button');
			choose.type = 'button';
			choose.textContent = 'Choisir';
			choose.addEventListener('click', () => Send('select', { jeu: g.name }));
			item.appendChild(choose);
		}

		const coverBtn = document.createElement('button');
		coverBtn.type = 'button';
		coverBtn.textContent = '🖼';
		coverBtn.title = 'Jaquette personnalisée';
		coverBtn.classList.toggle('active', openCoverEditor === key);
		coverBtn.addEventListener('click', () => {
			openCoverEditor = openCoverEditor === key ? null : key;
			Render();
		});
		item.appendChild(coverBtn);

		const del = document.createElement('button');
		del.type = 'button';
		del.textContent = '🗑';
		del.title = 'Supprimer ce compteur';
		WithConfirmation(del, true, '🗑 ?', () => Send('delete', { jeu: g.name, annonce: 'false' }));
		item.appendChild(del);

		els.gameList.appendChild(item);

		// Éditeur de jaquette (une seule ouverte à la fois)
		if (openCoverEditor === key) {
			const editor = document.createElement('div');
			editor.className = 'cover-editor';

			const input = document.createElement('input');
			input.type = 'text';
			input.placeholder = 'URL de l’image (vide = jaquette Twitch)';
			input.value = g.cover || '';

			const save = document.createElement('button');
			save.type = 'button';
			save.textContent = 'OK';
			const submit = () => {
				openCoverEditor = null;
				Send('cover', { jeu: g.name, valeur: input.value.trim(), annonce: 'false' });
			};
			save.addEventListener('click', submit);
			input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

			editor.append(input, save);

			if (g.cover) {
				const reset = document.createElement('button');
				reset.type = 'button';
				reset.textContent = 'Twitch';
				reset.title = 'Revenir à la jaquette Twitch';
				reset.addEventListener('click', () => {
					openCoverEditor = null;
					Send('cover', { jeu: g.name, valeur: '', annonce: 'false' });
				});
				editor.appendChild(reset);
			}

			const hint = document.createElement('p');
			hint.className = 'muted';
			hint.textContent = g.boxArt ? 'Jaquette Twitch trouvée automatiquement.' : 'Aucune jaquette Twitch trouvée pour ce jeu.';
			editor.appendChild(hint);

			els.gameList.appendChild(editor);
			if (document.activeElement === document.body) input.focus();
		}
	}
	els.emptyList.hidden = entries.length > 0;
}

// Bouton à double clic de confirmation (sans boîte de dialogue, qui bloque les docks OBS)
function WithConfirmation(button, enabled, confirmText, action) {
	const original = button.textContent;
	button.addEventListener('click', () => {
		const needConfirm = typeof enabled === 'function' ? enabled() : enabled;
		if (!needConfirm || button.classList.contains('confirming')) {
			button.classList.remove('confirming');
			button.textContent = original;
			action();
			return;
		}
		button.classList.add('confirming');
		button.textContent = confirmText;
		setTimeout(() => {
			button.classList.remove('confirming');
			button.textContent = original;
		}, 3000);
	});
}

/////////////
// ACTIONS //
/////////////

async function Send(mode, extra = {}) {
	const args = { mode, annonce: els.announce.checked ? 'true' : 'false', ...extra };

	// Les modifications portent sur le jeu affiché dans le dock
	if (['add', 'sub', 'set', 'reset'].includes(mode) && !args.jeu) {
		const game = CurrentGame();
		if (game) args.jeu = game.name;
	}

	if (ws.demo && !connected) {
		DemoApply(args);
		Render();
		return;
	}

	if (!sbClient || !connected) {
		Toast('Streamer.bot n’est pas connecté');
		return;
	}

	try {
		const response = await sbClient.doAction({ name: ws.values.actionName }, args);
		if (response && response.status && response.status !== 'ok')
			Toast('Erreur Streamer.bot : ' + (response.error || response.status));
	} catch (e) {
		console.error(e);
		Toast('Impossible de lancer l’action');
	}
	// Filet de sécurité si l'événement de mise à jour n'arrive pas
	setTimeout(RefreshData, 600);
}

// Reproduit la logique de l'action C# pour l'aperçu (mode démo)
function DemoApply(args) {
	const key = (name) => name.trim().toLowerCase();
	const name = (args.jeu || (CurrentGame() || {}).name || 'Elden Ring').trim();
	const k = key(name);
	if (args.mode === 'delete') {
		delete data.games[k];
		if (data.current === k) data.current = '';
		return;
	}
	if (args.mode === 'cover') {
		if (data.games[k]) {
			if (args.valeur) data.games[k].cover = args.valeur; else delete data.games[k].cover;
		}
		return;
	}
	if (!data.games[k]) data.games[k] = { name, count: 0 };
	const g = data.games[k];
	const step = Math.max(1, parseInt(args.valeur, 10) || 1);
	switch (args.mode) {
		case 'add': g.count += step; break;
		case 'sub': g.count = Math.max(0, g.count - step); break;
		case 'set': g.count = Math.max(0, parseInt(args.valeur, 10) || 0); break;
		case 'reset': g.count = 0; break;
		case 'select': data.manual = true; break;
		case 'auto': data.manual = false; break;
	}
	if (['add', 'sub', 'set', 'reset'].includes(args.mode)) g.updated = new Date().toISOString();
	data.current = k;
	if (['add', 'sub', 'set', 'reset'].includes(args.mode) && args.annonce === 'true')
		Toast(`Chat : 💀 ${g.name} : ${g.count} mort(s)`);
}

function DemoData() {
	const now = Date.now();
	return {
		current: 'elden ring',
		manual: false,
		games: {
			'elden ring': { name: 'Elden Ring', count: 87, updated: new Date(now).toISOString() },
			'world of warcraft': { name: 'World of Warcraft', count: 12, updated: new Date(now - 86400000).toISOString() },
			'hollow knight: silksong': { name: 'Hollow Knight: Silksong', count: 143, updated: new Date(now - 3 * 86400000).toISOString() }
		}
	};
}

//////////////////
// STREAMER.BOT //
//////////////////

function SetData(raw) {
	let parsed = raw;
	if (typeof raw === 'string') {
		try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
	}
	if (parsed && typeof parsed === 'object' && parsed.games && typeof parsed.games === 'object') {
		data = { games: parsed.games, current: parsed.current || '', manual: !!parsed.manual };
	}
	Render();
}

async function RefreshData() {
	if (!sbClient || !connected) return;
	try {
		const response = await sbClient.getGlobal(ws.values.variableName, true);
		if (response && response.status === 'ok' && response.variable) SetData(response.variable.value);
		else Render();
	} catch (e) {
		console.error('[Dock] Lecture de la variable impossible :', e);
	}
}

async function CheckAction() {
	if (!sbClient || !connected) return;
	try {
		const response = await sbClient.getActions();
		const wanted = ws.values.actionName.trim().toLowerCase();
		actionFound = (response.actions || []).some(a => String(a.name).trim().toLowerCase() === wanted);
	} catch (e) {
		actionFound = false;
	}
	Render();
}

function ConnectStreamerBot() {
	const { address: host, port } = ws.values;
	if (sbClient && host === sbHost && port === sbPort) return; // pas de reconnexion inutile

	if (sbClient) { try { sbClient.disconnect(); } catch (e) { } }
	sbHost = host;
	sbPort = port;
	connected = false;

	sbClient = new StreamerbotClient({
		host,
		port,
		onConnect: () => {
			connected = true;
			CheckAction();
			RefreshData();
		},
		onDisconnect: () => {
			connected = false;
			Render();
		}
	});

	sbClient.on('Misc.GlobalVariableUpdated', ({ data: ev }) => {
		const name = ev && (ev.name || (ev.variable && ev.variable.name));
		if (!name || name === ws.values.variableName) RefreshData();
	});
	sbClient.on('General.Custom', ({ data: ev }) => {
		if (ev && ev.source === 'compteurMorts' && (!ev.variable || ev.variable === ws.values.variableName))
			SetData(ev.data);
	});
	// Une action créée ou renommée : on revérifie
	sbClient.on('Application.ActionAdded', CheckAction);
	sbClient.on('Application.ActionUpdated', CheckAction);
	sbClient.on('Application.ActionDeleted', CheckAction);
}

/////////////////////
// INTERACTIONS UI //
/////////////////////

els.plus.addEventListener('click', () => Send('add', { valeur: String(ws.values.step) }));
els.minus.addEventListener('click', () => Send('sub', { valeur: String(ws.values.step) }));

function SubmitSet() {
	const v = parseInt(els.setInput.value, 10);
	if (!Number.isFinite(v) || v < 0) { Toast('Entrez un nombre positif'); return; }
	Send('set', { valeur: String(v) });
	els.setInput.value = '';
}
els.setButton.addEventListener('click', SubmitSet);
els.setInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') SubmitSet(); });

WithConfirmation(els.reset, () => ws.values.confirmReset, 'Confirmer la remise à zéro ?', () => Send('reset'));

function SubmitGame() {
	const name = els.gameInput.value.trim();
	if (!name) { Toast('Entrez le nom du jeu'); return; }
	Send('select', { jeu: name, annonce: 'false' });
	els.gameInput.value = '';
}
els.selectGame.addEventListener('click', SubmitGame);
els.gameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') SubmitGame(); });
els.auto.addEventListener('click', () => Send('auto', { annonce: 'false' }));

els.announce.addEventListener('change', () => {
	try { localStorage.setItem(ANNOUNCE_KEY, els.announce.checked ? 'true' : 'false'); } catch (e) { }
});

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', (values, previous) => {
			if (values.announce !== previous.announce) els.announce.checked = values.announce;
			ConnectStreamerBot();
			if (values.actionName !== previous.actionName) CheckAction();
			if (values.variableName !== previous.variableName) RefreshData();
			Render();
		});
	} catch (e) {
		console.error('[Dock] Réglages illisibles :', e);
		return;
	}

	// Annonce : choix mémorisé dans le dock, sinon réglage de l'URL
	let stored = null;
	try { stored = localStorage.getItem(ANNOUNCE_KEY); } catch (e) { }
	els.announce.checked = stored === null ? ws.values.announce : stored === 'true';

	// Copie du code C# de l'action
	document.getElementById('copyCodeButton').addEventListener('click', async () => {
		try {
			const code = await (await fetch('../streamerbot/compteur-morts.cs', { cache: 'no-cache' })).text();
			await navigator.clipboard.writeText(code);
			Toast('Code C# copié !');
		} catch (e) {
			Toast('Copie impossible : ouvrez streamerbot/compteur-morts.cs');
		}
	});
	document.getElementById('recheckButton').addEventListener('click', CheckAction);

	if (ws.demo) data = DemoData(); // remplacé par les vraies données dès la connexion
	ConnectStreamerBot();
	Render();
})();
