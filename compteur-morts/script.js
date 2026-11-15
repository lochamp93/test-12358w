// Compteur de morts — overlay
// Les réglages viennent de settings/settings.json (valeurs par défaut, bornes, conditions)
// et de l'URL. Aucune valeur par défaut n'est redéfinie ici.

const widgetEl = document.getElementById('widget');
const boxEl = document.getElementById('box');
const coreEl = document.getElementById('core');
const gameEl = document.getElementById('game');
const labelEl = document.getElementById('label');
const iconEl = document.getElementById('icon');
const countEl = document.getElementById('count');
const fontLinkEl = document.getElementById('googleFont');

let ws = null;            // réglages (module commun WidgetSettings)
let sbClient = null;      // client Streamer.bot
let sbHost = null, sbPort = null;
let demoTimer = null;
let state = null;         // { name, count } du jeu affiché
let hasData = false;

////////////////////
// RENDU / STYLES //
////////////////////

function HexToRgba(hex, opacityPercent) {
	let h = hex.replace('#', '');
	if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
	const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

function ApplySettings() {
	const s = ws.values;
	const on = (id) => ws.isActive(id); // un réglage masqué n'a pas d'effet

	// Police Google Fonts
	const font = String(s.font || '').trim();
	if (font) {
		const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;600;700;900&display=swap`;
		if (fontLinkEl.getAttribute('href') !== href) fontLinkEl.setAttribute('href', href);
		widgetEl.style.setProperty('--font', `'${font.replace(/'/g, '')}'`);
	} else {
		fontLinkEl.removeAttribute('href');
		widgetEl.style.setProperty('--font', 'inherit');
	}

	widgetEl.style.setProperty('--font-size', `${s.fontSize}px`);
	widgetEl.style.setProperty('--text-color', s.textColor);
	widgetEl.style.setProperty('--game-size', `${s.gameFontSize}px`);
	widgetEl.style.setProperty('--icon-size', `${s.iconSize}px`);
	widgetEl.style.setProperty('--anim-duration', `${s.animationDuration}ms`);

	// Alignement
	widgetEl.classList.remove('align-left', 'align-center', 'align-right');
	widgetEl.classList.add(`align-${s.align}`);

	// Contour / ombre
	boxEl.classList.toggle('outline', s.outline);
	widgetEl.style.setProperty('--outline-color', s.outlineColor);
	widgetEl.style.setProperty('--outline-width', `${s.outlineWidth}px`);
	boxEl.classList.toggle('shadow', s.shadow);
	widgetEl.style.setProperty('--shadow-color', s.shadowColor);
	widgetEl.style.setProperty('--shadow-blur', `${s.shadowBlur}px`);

	// Fond
	boxEl.classList.toggle('with-bg', s.background);
	widgetEl.style.setProperty('--bg-color', HexToRgba(s.bgColor, s.bgOpacity));
	widgetEl.style.setProperty('--bg-radius', `${s.bgRadius}px`);
	widgetEl.style.setProperty('--bg-padding', `${s.bgPadding}px`);

	// Libellé
	coreEl.className = '';
	if (s.showLabel) coreEl.classList.add(`label-${s.labelPosition}`);
	else coreEl.classList.add('label-hidden');
	labelEl.textContent = on('labelText') ? s.labelText : '';

	// Nom du jeu
	boxEl.classList.toggle('game-hidden', !s.showGame);
	boxEl.classList.toggle('game-below', on('gamePosition') && s.gamePosition === 'below');

	// Icône
	iconEl.innerHTML = '';
	if (s.icon === 'custom') {
		if (s.iconUrl.trim()) {
			const img = document.createElement('img');
			img.src = s.iconUrl.trim();
			img.alt = '';
			iconEl.appendChild(img);
		}
	} else if (DEATH_ICONS[s.icon]) {
		iconEl.innerHTML = DEATH_ICONS[s.icon];
	}

	RenderState(false);
}

function RenderState(animate, previousCount) {
	if (!state) return;
	gameEl.textContent = state.name;
	countEl.textContent = String(state.count);

	if (animate && previousCount !== undefined && previousCount !== state.count)
		PlayChangeAnimation(state.count > previousCount);
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
		widgetEl.style.setProperty('--count-color', isUp ? s.colorUp : s.colorDown);
		const hold = Math.max(500, (ws.isActive('animationDuration') ? s.animationDuration : 400) * 2);
		flashTimeout = setTimeout(() => widgetEl.style.setProperty('--count-color', 'var(--text-color)'), hold);
	}
}

function SetState(next) {
	if (!next) return;
	const previous = state;
	state = { name: next.name, count: next.count };
	const sameGame = previous && previous.name === state.name;
	RenderState(sameGame, sameGame ? previous.count : undefined);

	if (!hasData) {
		hasData = true;
		widgetEl.classList.remove('hidden');
	}
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
			if (parsed) SetState(parsed);
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
		onDisconnect: () => console.warn('[Compteur de morts] Déconnecté de Streamer.bot')
	});

	// Mise à jour quand l'action modifie la variable
	sbClient.on('Misc.GlobalVariableUpdated', ({ data }) => {
		const name = data && (data.name || (data.variable && data.variable.name));
		if (!name || name === ws.values.variableName) RefreshFromStreamerBot();
	});
	sbClient.on('General.Custom', ({ data }) => {
		if (data && data.source === 'compteurMorts' && (!data.variable || data.variable === ws.values.variableName)) {
			const parsed = ParseDeathData(data.data);
			if (parsed) SetState(parsed);
		}
	});
}

////////////
// DÉMO   //
////////////

function StartDemo() {
	if (demoTimer) return;
	demoTimer = CreateDemoFeed(SetState);
}

//////////////////
// DÉMARRAGE    //
//////////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', (values, previous) => {
			ApplySettings();
			if (!ws.demo) {
				ConnectStreamerBot(); // ne reconnecte que si l'adresse ou le port ont changé
				if (values.variableName !== previous.variableName) RefreshFromStreamerBot();
			}
		});
	} catch (e) {
		console.error('[Compteur de morts] Réglages illisibles :', e);
		return;
	}

	ApplySettings();

	if (ws.demo) StartDemo();
	else ConnectStreamerBot();
})();
