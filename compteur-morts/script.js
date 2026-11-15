// Compteur de morts : overlay
// Les réglages viennent de settings/settings.json (valeurs par défaut, bornes, conditions)
// et de l'URL. Aucune valeur par défaut n'est redéfinie ici.

const widgetEl = document.getElementById('widget');
const boxEl = document.getElementById('box');
const coreEl = document.getElementById('core');
const gameEl = document.getElementById('game');
const labelEl = document.getElementById('label');
const iconEl = document.getElementById('icon');
const countEl = document.getElementById('count');
const coverEl = document.getElementById('cover');
const fontLinkEl = document.getElementById('googleFont');

let ws = null;            // réglages (module commun WidgetSettings)
let sbClient = null;      // client Streamer.bot
let sbHost = null, sbPort = null;
let liveData = false;     // true dès que Streamer.bot a fourni de vraies valeurs
let state = null;         // jeu affiché { name, count, cover, boxArt }
let hasData = false;
let swapToken = 0;
let currentCoverURL = null;

////////////////////
// RENDU / STYLES //
////////////////////

function HexToRgba(hex, opacityPercent) {
	let h = hex.replace('#', '');
	if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
	const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

function SetVar(name, value) {
	widgetEl.style.setProperty(name, value);
}

function ApplySettings() {
	const s = ws.values;
	const on = (id) => ws.isActive(id); // un réglage masqué n'a pas d'effet
	const layout = s.layout;

	// Police Google Fonts
	const font = String(s.font || '').trim();
	if (font) {
		const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;600;700;800;900&display=swap`;
		if (fontLinkEl.getAttribute('href') !== href) fontLinkEl.setAttribute('href', href);
		SetVar('--font', `'${font.replace(/'/g, '')}'`);
	} else {
		fontLinkEl.removeAttribute('href');
		SetVar('--font', 'inherit');
	}

	SetVar('--font-size', `${s.fontSize}px`);
	SetVar('--text-color', s.textColor);
	SetVar('--game-size', `${s.gameFontSize}px`);
	SetVar('--label-size', `${s.labelFontSize}px`);
	SetVar('--icon-size', `${s.iconSize}px`);
	SetVar('--anim-duration', `${s.animationDuration}ms`);

	// Position
	widgetEl.classList.remove('align-left', 'align-center', 'align-right');
	widgetEl.classList.add(`align-${s.align}`);

	// Classes du style (on repart de zéro à chaque application)
	const keep = ['swap-out', 'swap-in', 'swap-slide', 'no-cover-image'].filter(c => boxEl.classList.contains(c));
	boxEl.className = `layout-${layout}`;
	keep.forEach(c => boxEl.classList.add(c));

	// Contour / ombre
	boxEl.classList.toggle('outline', s.outline);
	SetVar('--outline-color', s.outlineColor);
	SetVar('--outline-width', `${s.outlineWidth}px`);
	boxEl.classList.toggle('shadow', s.shadow);
	SetVar('--shadow-color', HexToRgba(s.shadowColor, s.shadowOpacity));
	SetVar('--shadow-blur', `${s.shadowBlur}px`);

	// Libellé
	coreEl.className = s.showLabel ? `label-${s.labelPosition}` : 'label-hidden';
	labelEl.textContent = on('labelText') ? s.labelText : '';

	// Nom du jeu (réglage propre au style Carte, ou commun aux deux autres)
	const showGame = layout === 'card' ? s.cardShowGame : s.showGame;
	boxEl.classList.toggle('game-hidden', !showGame);
	boxEl.classList.add(`game-${on('gamePosition') ? s.gamePosition : 'above'}`);

	// Icône (Classique et Minimal)
	iconEl.innerHTML = '';
	if (on('icon')) {
		if (s.icon === 'custom') {
			if (on('iconUrl') && s.iconUrl.trim()) {
				const img = document.createElement('img');
				img.src = s.iconUrl.trim();
				img.alt = '';
				iconEl.appendChild(img);
			}
		} else if (DEATH_ICONS[s.icon]) {
			iconEl.innerHTML = DEATH_ICONS[s.icon];
		}
	}

	// Style Texte : fond optionnel et texte secondaire atténué
	if (layout === 'minimal') {
		boxEl.classList.toggle('muted', s.mutedText);
		boxEl.classList.toggle('with-bg', s.background);
		SetVar('--bg-color', HexToRgba(s.bgColor, s.bgOpacity));
		SetVar('--bg-radius', `${s.bgRadius}px`);
		SetVar('--bg-padding', `${s.bgPadding}px`);
	}

	// Style Carte
	if (layout === 'card') {
		boxEl.classList.add(`bg-${s.cardBackground}`);
		boxEl.classList.toggle('show-cover', s.showCover);
		boxEl.classList.toggle('no-cover', !s.showCover);
		boxEl.classList.toggle('cover-right', on('coverPosition') && s.coverPosition === 'right');
		SetVar('--cover-width', `${s.coverWidth}px`);
		SetVar('--border-width', s.border ? `${s.borderWidth}px` : '0px');
		SetVar('--border-color', s.borderColor);
		SetVar('--card-bg', s.cardBackground === 'color' ? HexToRgba(s.cardBgColor, s.cardBgOpacity) : 'rgba(0, 0, 0, 0.55)');
	}

	// Style Minimal
	if (layout === 'minimal') {
		boxEl.classList.toggle('with-line', s.decorLine);
		boxEl.classList.toggle('line-below', on('linePosition') && s.linePosition === 'below');
		SetVar('--line-color', s.lineColor);
		SetVar('--line-length', `${s.lineLength}px`);
	}

	RenderText();
	UpdateCover(state);
}

function RenderText() {
	if (!state) return;
	// Séparateur entre le nom du jeu et le compteur quand ils sont sur la même ligne
	const s = ws.values;
	const sep = ws.isActive('gameSeparator') ? s.gameSeparator.trim() : '';
	if (sep && s.gamePosition === 'left') gameEl.textContent = `${state.name} ${sep}`;
	else if (sep && s.gamePosition === 'right') gameEl.textContent = `${sep} ${state.name}`;
	else gameEl.textContent = state.name;
	countEl.textContent = String(state.count);
}

// Jaquette : préchargée avant affichage pour éviter un cadre vide
function CoverURLFor(game) {
	const s = ws.values;
	if (s.layout !== 'card') return '';
	const fallback = ws.isActive('fallbackCover') ? s.fallbackCover : '';
	return ResolveCoverURL(game, fallback, s.coverWidth);
}

function PreloadImage(url) {
	return new Promise((resolve) => {
		if (!url) return resolve(false);
		const img = new Image();
		const timer = setTimeout(() => resolve(false), 4000);
		img.onload = () => { clearTimeout(timer); resolve(true); };
		img.onerror = () => { clearTimeout(timer); resolve(false); };
		img.src = url;
	});
}

function SetCoverImage(url) {
	currentCoverURL = url;
	boxEl.classList.toggle('no-cover-image', !url);
	if (url) {
		coverEl.src = url;
		SetVar('--cover-url', `url("${url.replace(/"/g, '%22')}")`);
	} else {
		coverEl.removeAttribute('src');
		SetVar('--cover-url', 'none');
	}
}

async function UpdateCover(game) {
	const url = CoverURLFor(game);
	if (url === currentCoverURL) return;
	if (!url) { SetCoverImage(''); return; }

	let ok = await PreloadImage(url);
	let finalURL = url;
	if (!ok) {
		// Jaquette introuvable : image de secours, sinon carte sans jaquette
		const fallback = ws.isActive('fallbackCover') ? ws.values.fallbackCover.trim() : '';
		finalURL = fallback && fallback !== url && await PreloadImage(fallback) ? fallback : '';
	}
	if (CoverURLFor(state) === url) SetCoverImage(finalURL);
}

let flashTimeout = null;

function PlayChangeAnimation(isUp) {
	const s = ws.values;

	if (s.animation !== 'none') {
		countEl.classList.remove('anim-pulse', 'anim-bounce', 'anim-flip', 'anim-slide');
		void countEl.offsetWidth; // relance l'animation
		countEl.classList.add(`anim-${s.animation}`);
	}

	if (s.flashColors) {
		clearTimeout(flashTimeout);
		SetVar('--count-color', isUp ? s.colorUp : s.colorDown);
		const hold = Math.max(500, (ws.isActive('animationDuration') ? s.animationDuration : 400) * 2);
		flashTimeout = setTimeout(() => SetVar('--count-color', 'var(--text-color)'), hold);
	}
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Changement de jeu animé : sortie, mise à jour (jaquette préchargée), entrée
async function SwapGame(next) {
	const token = ++swapToken;
	const anim = ws.values.gameChangeAnim;
	const url = CoverURLFor(next);
	const preload = PreloadImage(url);

	boxEl.classList.toggle('swap-slide', anim === 'slide');
	boxEl.classList.add('swap-out');
	await Promise.all([wait(260), Promise.race([preload, wait(1500)])]);
	if (token !== swapToken) return;

	state = next;
	RenderText();
	await UpdateCover(state);
	if (token !== swapToken) return;

	boxEl.classList.remove('swap-out');
	boxEl.classList.add('swap-in');
	void boxEl.offsetWidth;
	boxEl.classList.remove('swap-in');
}

function SetState(next) {
	if (!next) return;
	next = { name: next.name || '', count: Number(next.count) || 0, cover: next.cover || '', boxArt: next.boxArt || '' };
	const previous = state;

	if (!hasData) {
		state = next;
		RenderText();
		UpdateCover(state);
		hasData = true;
		widgetEl.classList.remove('hidden');
		return;
	}

	if (previous && previous.name !== next.name) {
		if (ws.values.gameChangeAnim !== 'none') { SwapGame(next); return; }
		swapToken++;
		state = next;
		RenderText();
		UpdateCover(state);
		return;
	}

	state = next;
	RenderText();
	UpdateCover(state); // la jaquette a pu être ajoutée ou changée depuis le dock
	if (previous && previous.count !== next.count) PlayChangeAnimation(next.count > previous.count);
}

//////////////////
// STREAMER.BOT //
//////////////////

async function RefreshFromStreamerBot() {
	if (!sbClient) return;
	try {
		const response = await sbClient.getGlobal(ws.values.variableName, true);
		if (response && response.status === 'ok' && response.variable) {
			const parsed = ParseDeathData(response.variable.value);
			if (parsed) ShowLive(parsed);
		} else if (ws.demo) {
			// Aperçu : pas encore de compteur dans Streamer.bot, on garde l'exemple
		} else {
			// Variable pas encore créée : on affiche 0 en attendant la première action
			SetState(state || { name: '', count: 0 });
		}
	} catch (e) {
		console.error('[Compteur de morts] Lecture de la variable impossible :', e);
	}
}

function ConnectStreamerBot() {
	const host = ws.values.address;
	const port = ws.values.port;
	if (sbClient && host === sbHost && port === sbPort) return; // pas de reconnexion inutile

	if (sbClient) {
		try { sbClient.disconnect(); } catch (e) { }
	}
	sbHost = host;
	sbPort = port;

	sbClient = new StreamerbotClient({
		host,
		port,
		onConnect: () => {
			console.log(`[Compteur de morts] Connecté à Streamer.bot (${host}:${port})`);
			RefreshFromStreamerBot();
		},
		onDisconnect: () => {
			console.warn('[Compteur de morts] Déconnecté de Streamer.bot');
		}
	});

	// Mise à jour quand l'action modifie la variable
	sbClient.on('Misc.GlobalVariableUpdated', ({ data }) => {
		const name = data && (data.name || (data.variable && data.variable.name));
		if (!name || name === ws.values.variableName) RefreshFromStreamerBot();
	});
	// Commandes du chat (pas dans l'aperçu de la page de paramétrage)
	sbClient.on('Twitch.ChatMessage', ({ data }) => { if (!ws.demo) HandleChatCommand(data); });

	sbClient.on('General.Custom', ({ data }) => {
		if (data && data.source === 'compteurMorts' && (!data.variable || data.variable === ws.values.variableName)) {
			const parsed = ParseDeathData(data.data);
			if (parsed) ShowLive(parsed);
		}
	});
}

// Vraies valeurs : la première arrive sans animation (remplace l'exemple de l'aperçu)
function ShowLive(game) {
	if (!liveData && ws.demo) {
		liveData = true;
		swapToken++;
		state = null;
		hasData = false;
	}
	liveData = true;
	SetState(game);
}

////////////////////////////////////////
// APERÇU : boutons de test (settings) //
////////////////////////////////////////

// Appelées par les boutons « Tester » de la page de paramétrage (visuel seulement,
// rien n'est envoyé à Streamer.bot)
let demoIndex = 0;

window.PreviewTestCount = function () {
	if (!state) return;
	SetState({ ...state, count: state.count + 1 });
};

window.PreviewTestGame = function () {
	demoIndex = (demoIndex + 1) % DEMO_GAMES.length;
	const next = { ...DEMO_GAMES[demoIndex] };
	if (state && state.name === next.name) next.name += ' ';
	SetState(next);
};

///////////////////////
// COMMANDES DU CHAT //
///////////////////////

// Niveau de l'auteur : 40 streamer, 30 modo, 20 VIP, 15 abonné, 10 viewer
// (accepte les différentes formes d'événement selon la version de Streamer.bot)
function ChatPermissionLevel(data) {
	const m = data && typeof data.message === 'object' ? data.message : {};
	const u = Object.assign({}, m, data.user || {});
	const role = Number(u.role) || 1;
	const badges = (u.badges || m.badges || []).map(b => String(b.name || b.setId || b).toLowerCase());
	if (role >= 4 || u.isBroadcaster || badges.includes('broadcaster')) return 40;
	if (role >= 3 || u.isModerator || badges.includes('moderator')) return 30;
	if (role >= 2 || u.isVip || badges.includes('vip')) return 20;
	if (u.subscribed || u.subscriber || u.isSubscribed || badges.includes('subscriber')) return 15;
	return 10;
}

function ChatText(data) {
	if (!data) return '';
	if (typeof data.message === 'string') return data.message;
	if (data.message && typeof data.message.message === 'string') return data.message.message;
	if (typeof data.text === 'string') return data.text;
	if (data.message && typeof data.message.text === 'string') return data.message.text;
	return '';
}

function ChatMessageId(data) {
	const m = data && typeof data.message === 'object' ? data.message : {};
	return String(m.msgId || m.id || data.msgId || data.messageId || data.id || '');
}

function HandleChatCommand(data) {
	const s = ws.values;
	const text = ChatText(data).trim();
	const [first, ...rest] = text.split(/\s+/);
	const word = (first || '').toLowerCase();
	if (!word) return;

	const commands = [
		{ cmd: s.cmdAdd, mode: 'add' },
		{ cmd: s.cmdSub, mode: 'sub' },
		{ cmd: s.cmdSet, mode: 'set' },
		{ cmd: s.cmdReset, mode: 'reset' }
	];
	const match = commands.find(c => c.cmd && c.cmd.trim().toLowerCase() === word);
	if (!match) return;

	const level = ChatPermissionLevel(data);
	if (level < Number(s.permissionLevel)) {
		console.info(`[Compteur de morts] ${word} ignorée : permission insuffisante (${level} < ${s.permissionLevel})`);
		return;
	}

	const args = { mode: match.mode, annonce: 'true', msgId: ChatMessageId(data) };
	if (match.mode === 'set') {
		const n = parseInt(rest[0], 10);
		if (!Number.isFinite(n) || n < 0) return;
		args.valeur = String(n);
	}

	console.info(`[Compteur de morts] Commande ${word} → action « ${s.actionName} »`, args);
	sbClient.doAction({ name: s.actionName }, args)
		.then(r => { if (r && r.status && r.status !== 'ok') console.error('[Compteur de morts] Streamer.bot a refusé l’action :', r); })
		.catch(e => console.error('[Compteur de morts] Action impossible :', e));
}

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', (values, previous) => {
			ApplySettings();
			ConnectStreamerBot(); // ne reconnecte que si l'adresse ou le port ont changé
			if (values.variableName !== previous.variableName) RefreshFromStreamerBot();
		});
	} catch (e) {
		console.error('[Compteur de morts] Réglages illisibles :', e);
		return;
	}

	ApplySettings();

	// Aperçu : exemple fixe en attendant les vraies valeurs de Streamer.bot
	if (ws.demo) {
		SetState({ ...DEMO_GAMES[0] });
	}
	ConnectStreamerBot();
})();
