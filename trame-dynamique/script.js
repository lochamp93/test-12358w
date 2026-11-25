// Trame dynamique : overlay
// Les réglages viennent de settings/settings.json (valeurs par défaut, bornes, conditions)
// et de l'URL. Aucune valeur par défaut n'est redéfinie ici.

const areaEl = document.getElementById('area');
const stageEl = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const videoEl = document.getElementById('video');
const panelEl = document.getElementById('palettePanel');
const panelImgEl = document.getElementById('paletteImage');
const cardsEl = document.getElementById('paletteCards');
const gooBlurEl = document.getElementById('gooBlur');

let ws = null;                 // réglages (module commun WidgetSettings)

// Palette analysée : { Vibrant: '#…', Muted: '#…', … } (null : rien d'analysé)
let palette = null;
let paletteImage = '';         // image analysée (vignette de l'aperçu)
let usedRoles = [];            // rôles retenus (numérotés dans l'aperçu)

// Couleurs de travail des thèmes, avec transition douce
let currentSet = null, fromSet = null, targetSet = null;
let transitionStart = 0, transitionDuration = 0;

// Calques hors écran
const layerCanvas = document.createElement('canvas');   // lave
const fillCanvas = document.createElement('canvas');    // remplissage de la vidéo
const maskCanvas = document.createElement('canvas');    // masque de la vidéo
let noisePattern = null;

/////////////////////
// MESSAGES APERÇU //
/////////////////////

// Infos affichées dans la page de paramétrage (seulement dans l'aperçu)
// ?debug=true dans l'URL (OBS) : l'état s'affiche en bas à gauche de la source
const debugEl = (() => {
	if (!/^(true|1|oui)$/i.test(new URLSearchParams(location.search).get('debug') || '')) return null;
	const el = document.createElement('div');
	el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9;padding:8px 12px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;font:600 20px/1.3 sans-serif;max-width:80vw';
	document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el));
	if (document.body) document.body.appendChild(el);
	return el;
})();

function PostInfo(id, text, status) {
	if (debugEl && id === 'paletteStatus') {
		const src = ws ? ws.values.paletteSource : '';
		debugEl.textContent = `[${src}] ${text}`;
		debugEl.style.color = status === 'warn' ? '#ffb340' : '#fff';
	}
	if (!ws || !ws.demo || window.parent === window) return;
	try { window.parent.postMessage({ type: 'widget-info', id, text, status: status || '' }, '*'); } catch (e) { }
}

let lastStatus = '';
function SetStatus(text, status) {
	const key = `${status}|${text}`;
	if (key === lastStatus) return;
	lastStatus = key;
	PostInfo('paletteStatus', text, status);
	if (status === 'warn') console.warn('[Trame dynamique]', text);
}

///////////////////////
// ANALYSE D'IMAGE   //
///////////////////////

const paletteCache = new Map();  // une analyse par image
let analyseToken = 0;

// Analyse une image avec Vibrant et applique sa palette
async function AnalyseImage(src, label) {
	if (!src) return;
	const token = ++analyseToken;
	try {
		let result = paletteCache.get(src);
		if (!result) {
			if (typeof Vibrant === 'undefined') throw new Error('Vibrant.js indisponible');
			const swatches = await Vibrant.from(src).maxColorCount(64).getPalette();
			result = {};
			for (const role of ROLES) if (swatches[role]) result[role] = swatches[role].getHex();
			if (!Object.keys(result).length) throw new Error('aucune couleur trouvée');
			paletteCache.set(src, result);
			if (paletteCache.size > 30) paletteCache.delete(paletteCache.keys().next().value);
		}
		if (token !== analyseToken) return; // une analyse plus récente a été lancée
		palette = result;
		paletteImage = src;
		SetStatus(`Couleurs de ${label}`, 'ok');
		UpdateColors();
	} catch (e) {
		if (token !== analyseToken) return;
		console.warn('[Trame dynamique] Analyse impossible :', src, e);
		SetStatus(`Impossible d’analyser l’image de ${label}`, 'warn');
		palette = null;
		paletteImage = '';
		UpdateColors();
	}
}

// Plus aucune image : couleur de secours
function ClearPalette(statusText, status) {
	analyseToken++;
	palette = null;
	paletteImage = '';
	if (statusText) SetStatus(statusText, status);
	UpdateColors();
}

///////////////////////////
// CHOIX DES COULEURS    //
///////////////////////////

function UpdateColors() {
	const s = ws.values;
	let hexes;
	let mono = s.colorCount === 'mono';

	if (s.paletteSource === 'perso' && !PreviewOverride()) {
		hexes = CustomPalette(s);
		usedRoles = [];
	} else if (palette) {
		usedRoles = PickRoles(palette, s);
		hexes = usedRoles.map(r => palette[r]);
	} else {
		usedRoles = [];
		hexes = [s.fallbackColor];
		mono = true;
	}

	const autoShades = mono ? (s.colorCount !== 'mono' || s.autoShades) : true;
	const next = BuildWorkingSet(hexes, hexes.length, autoShades);

	if (!currentSet) {
		currentSet = next;
		targetSet = next;
	} else {
		fromSet = currentSet;
		targetSet = next;
		transitionStart = performance.now();
		const instant = s.paletteSource === 'perso' && !PreviewOverride();
		transitionDuration = instant ? 300 : Math.max(0, Number(s.transitionDuration) || 0) * 1000;
	}

	RenderPalettePanel(hexes);
}

// Couleur de travail à l'instant présent (transition en cours)
function CurrentColors(now) {
	if (!targetSet) return null;
	if (fromSet && transitionDuration > 0) {
		const k = Math.min(1, (now - transitionStart) / transitionDuration);
		const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // douce au départ et à l'arrivée
		currentSet = LerpSet(fromSet, targetSet, e);
		if (k >= 1) fromSet = null;
	} else currentSet = targetSet;
	return currentSet;
}

///////////////////////////////
// APERÇU : COLONNE PALETTE  //
///////////////////////////////

function RenderPalettePanel(hexes) {
	const show = ws.demo && ws.values.previewPalette;
	panelEl.hidden = !show;
	if (!show) { Resize(); return; }

	panelImgEl.hidden = !paletteImage;
	if (paletteImage && panelImgEl.getAttribute('src') !== paletteImage) panelImgEl.src = paletteImage;

	// Couleurs personnalisées : les couleurs choisies ; sinon les 6 rôles de Vibrant
	let cards;
	if (ws.values.paletteSource === 'perso' && !PreviewOverride())
		cards = hexes.map((hex, i) => ({ role: `Couleur ${i + 1}`, hex, num: i + 1 }));
	else if (palette)
		cards = ROLES.filter(r => palette[r]).map(r => ({ role: ROLE_LABELS[r], hex: palette[r], num: usedRoles.indexOf(r) + 1 }));
	else
		cards = [{ role: 'Couleur de secours', hex: ws.values.fallbackColor, num: 1 }];

	cardsEl.innerHTML = '';
	for (const c of cards) {
		const rgb = HexToRgb(c.hex);
		// Texte : teinte plus sombre de la même couleur (plus claire si la carte est très sombre)
		const ink = Luma(rgb) > 0.32 ? RgbToHex(MixRgb(rgb, [0, 0, 0], 0.55)) : RgbToHex(MixRgb(rgb, [255, 255, 255], 0.5));
		const card = document.createElement('div');
		card.className = 'pcard' + (c.num ? '' : ' unused');
		card.style.background = c.hex;
		card.innerHTML = `<span class="role"></span><span class="hex"></span>${c.num ? '<span class="num"></span>' : ''}`;
		card.querySelector('.role').textContent = c.role;
		card.querySelector('.role').style.color = ink;
		card.querySelector('.hex').textContent = c.hex.toUpperCase();
		card.querySelector('.hex').style.color = ink;
		const num = card.querySelector('.num');
		if (num) { num.textContent = c.num; num.style.background = ink; num.style.color = c.hex; }
		cardsEl.appendChild(card);
	}
	Resize();
}

/////////////////////////////
// SOURCES DE LA PALETTE   //
/////////////////////////////

let sourceTimers = [];
let sourceKey = '';

function ClearSourceTimers() {
	sourceTimers.forEach(t => clearInterval(t));
	sourceTimers = [];
}

// Aperçu : image ou jeu de test à la place de la source réelle
let previewImageData = '';
function PreviewOverride() {
	if (!ws.demo) return '';
	const p = ws.values.previewSource;
	if (p === 'image' || p === 'jeu') return p;
	return '';
}

// (Re)démarre la source si un réglage qui la concerne a changé
function StartSource(force) {
	const s = ws.values;
	const key = JSON.stringify([s.paletteSource, s.channel, s.smtcBridgeAddress, s.smtcBridgePort, s.includedApps, s.excludedApps,
		s.whenIdle, s.address, s.port, PreviewOverride(), s.previewGame, previewImageData.length]);
	if (!force && key === sourceKey) return;
	sourceKey = key;
	ClearSourceTimers();
	currentMusicKey = null;

	const override = PreviewOverride();
	if (override === 'image') {
		if (previewImageData) AnalyseImage(previewImageData, 'l’image de test');
		else ClearPalette('Choisissez une image de test', 'warn');
		return;
	}
	if (override === 'jeu') {
		const name = String(s.previewGame || '').trim();
		if (name) AnalyseImage(BoxArtURL({ name }), `« ${name} »`);
		else ClearPalette('Tapez le nom d’un jeu', 'warn');
		return;
	}

	switch (s.paletteSource) {
		case 'jeu': StartGameSource(); break;
		case 'chaine': StartChannelSource(); break;
		case 'musique': StartMusicSource(); break;
		default: ClearPalette('Couleurs personnalisées', 'ok');
	}
}

// --- Chaîne Twitch (réglage, sinon chaîne connectée à Streamer.bot) ---

let broadcasterName = '';
async function ResolveChannel() {
	const manual = String(ws.values.channel || '').trim().replace(/^@/, '');
	if (manual) return manual.toLowerCase();
	if (broadcasterName) return broadcasterName;
	if (sbClient && sbConnected) {
		try {
			const r = await sbClient.getBroadcaster();
			const tw = r && r.platforms && r.platforms.twitch;
			const name = tw && (tw.broadcastUserName || tw.broadcastUser || tw.broadcasterUserName);
			if (name) broadcasterName = String(name).toLowerCase();
		} catch (e) { }
	}
	return broadcasterName;
}

async function FetchText(url) {
	const r = await fetch(url, { cache: 'no-store' });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return (await r.text()).trim();
}

// --- Artwork du jeu ---

let currentGame = null; // { name, id, boxArt }

function StartGameSource() {
	ConnectStreamerBot();
	currentGame = null; // nouvelle source : la jaquette sera de nouveau analysée
	const refresh = async () => {
		const channel = await ResolveChannel();
		if (!channel) { SetStatus('Chaîne inconnue : renseignez-la ou connectez Streamer.bot', 'warn'); return; }
		try {
			const name = await FetchText(`https://decapi.me/twitch/game/${encodeURIComponent(channel)}`);
			if (!name || /not found|error|no user/i.test(name)) throw new Error(name);
			SetGame({ name });
		} catch (e) {
			SetStatus(`Catégorie de ${channel} introuvable`, 'warn');
		}
	};
	refresh();
	sourceTimers.push(setInterval(refresh, 120000)); // filet de sécurité : toutes les 2 minutes
}

function SetGame(game) {
	if (!game || !game.name) return;
	const same = currentGame && currentGame.name === game.name && (!game.id || currentGame.id === game.id);
	currentGame = Object.assign({}, currentGame && currentGame.name === game.name ? currentGame : {}, game);
	if (same && palette) return;
	AnalyseImage(BoxArtURL(currentGame), `« ${currentGame.name} »`);
}

// --- Photo de profil de la chaîne ---

function StartChannelSource() {
	ConnectStreamerBot();
	const load = async () => {
		const channel = await ResolveChannel();
		if (!channel) { SetStatus('Chaîne inconnue : renseignez-la ou connectez Streamer.bot', 'warn'); return false; }
		try {
			const url = await FetchText(`https://decapi.me/twitch/avatar/${encodeURIComponent(channel)}`);
			if (!/^https?:\/\//.test(url)) throw new Error(url);
			AnalyseImage(url, `la chaîne ${channel}`);
			return true;
		} catch (e) {
			SetStatus(`Photo de profil de ${channel} introuvable`, 'warn');
			return false;
		}
	};
	// Si Streamer.bot n'est pas encore connecté, on réessaie quelques fois
	let tries = 0;
	const attempt = async () => {
		if (await load() || ++tries > 10) ClearSourceTimers();
	};
	attempt();
	sourceTimers.push(setInterval(attempt, 5000));
}

// --- Musique en cours (SMTC Bridge de nutty) ---

let currentMusicKey = null;
let lastAppsText = '';

function StartMusicSource() {
	const s = ws.values;
	const url = `http://${s.smtcBridgeAddress}:${s.smtcBridgePort}/now-playing`;
	const poll = async () => {
		let data;
		try {
			const r = await fetch(url, { cache: 'no-store' });
			data = await r.json();
		} catch (e) {
			SetStatus('SMTC Bridge ne répond pas : lancez-le sur le PC', 'warn');
			PostApps('SMTC Bridge ne répond pas');
			return;
		}
		if (data.error) { SetStatus(`SMTC Bridge : ${data.error}`, 'warn'); return; }
		const sessions = Array.isArray(data.sessions) ? data.sessions : [];
		PostApps(sessions.length ? [...new Set(sessions.map(x => x.source_app_id).filter(Boolean))].join(', ') : 'Aucune application ne joue de média');

		const session = PickMusicSession(data, sessions);
		if (!session) {
			if (ws.values.whenIdle === 'fallback' && currentMusicKey !== '') {
				currentMusicKey = '';
				ClearPalette('Rien ne joue : couleur de secours', 'ok');
			} else if (currentMusicKey === null) SetStatus('Rien ne joue pour le moment', 'ok');
			return;
		}
		const m = session.media_properties || {};
		const key = `${m.Title}|${m.Artist}|${(m.Thumbnail || '').length}`;
		if (key === currentMusicKey) return;
		currentMusicKey = key;
		const label = [m.Title, m.Artist].filter(Boolean).join(' · ') || session.source_app_id;
		if (m.Thumbnail) AnalyseImage(m.Thumbnail, `« ${label} »`);
		else SetStatus(`« ${label} » n’a pas de pochette`, 'warn');
	};
	poll();
	sourceTimers.push(setInterval(poll, 1000));
}

function PostApps(text) {
	if (text === lastAppsText) return;
	lastAppsText = text;
	PostInfo('detectedApps', text, '');
}

// Lecture en cours : Windows renvoie 4 (Playing) ou le texte « Playing » selon les versions
function IsPlaying(session) {
	const st = session && session.playback_info ? session.playback_info.PlaybackStatus : null;
	return st === 4 || String(st).toLowerCase() === 'playing';
}

// Même logique que le widget de nutty : applications incluses par ordre de priorité,
// sinon la session active de Windows, sinon la première qui joue
function PickMusicSession(data, sessions) {
	const list = (t) => String(t || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
	const included = list(ws.values.includedApps);
	const excluded = list(ws.values.excludedApps);
	const valid = sessions.filter(x => !excluded.some(e => String(x.source_app_id || '').toLowerCase().includes(e)));

	if (included.length) {
		for (const app of included) {
			const found = valid.find(x => String(x.source_app_id || '').toLowerCase().includes(app) && IsPlaying(x));
			if (found) return found;
		}
		return null;
	}
	const current = valid.find(x => x.source_app_id === data.current_session_id && IsPlaying(x));
	return current || valid.find(IsPlaying) || null;
}

// --- Streamer.bot : changement de catégorie en direct ---

let sbClient = null, sbHost = null, sbPort = null, sbConnected = false;

function ConnectStreamerBot() {
	if (typeof StreamerbotClient === 'undefined') return;
	const host = ws.values.address;
	const port = ws.values.port;
	if (sbClient && host === sbHost && port === sbPort) return; // pas de reconnexion inutile
	if (sbClient) { try { sbClient.disconnect(); } catch (e) { } }
	sbHost = host;
	sbPort = port;
	sbConnected = false;
	broadcasterName = '';

	sbClient = new StreamerbotClient({
		host,
		port,
		onConnect: () => {
			sbConnected = true;
			console.log(`[Trame dynamique] Connecté à Streamer.bot (${host}:${port})`);
			if (['jeu', 'chaine'].includes(ws.values.paletteSource) && !PreviewOverride()) StartSource(true);
		},
		onDisconnect: () => { sbConnected = false; }
	});

	// Nouvelle catégorie sur Twitch
	sbClient.on('Twitch.StreamUpdate', ({ data }) => {
		if (ws.values.paletteSource !== 'jeu' || PreviewOverride() || !data) return;
		const name = data.gameName || data.categoryName || (data.game && data.game.name) || (data.category && data.category.name);
		const id = data.gameId || data.categoryId || (data.game && data.game.id) || (data.category && data.category.id);
		const boxArt = data.gameBoxArt || data.boxArt || '';
		if (name) SetGame({ name: String(name), id: id ? String(id) : '', boxArt: String(boxArt || '') });
	});
}

////////////////////
// VIDÉO IMPORTÉE //
////////////////////

let videoUrl = '';
let videoFrameReady = false;

function SetupVideo() {
	const s = ws.values;
	const wanted = ws.isActive('videoUrl') ? String(s.videoUrl || '').trim() : '';
	if (wanted !== videoUrl) {
		videoUrl = wanted;
		videoFrameReady = false;
		if (wanted) {
			videoEl.src = wanted;
			videoEl.play().catch(() => { });
			SetStatusVideo('Chargement de la vidéo…', '');
		} else {
			videoEl.removeAttribute('src');
			videoEl.load();
			if (ws.isActive('videoUrl')) SetStatusVideo('Aperçu : masque d’exemple. Collez l’URL de votre boucle', '');
		}
	}
	if (wanted) videoEl.playbackRate = Math.max(0.25, (Number(s.videoRate) || 100) / 100);
}

function SetStatusVideo(text, status) { PostInfo('paletteStatus', text, status); lastStatus = ''; }

videoEl.addEventListener('error', () => { if (videoUrl) SetStatusVideo('Vidéo illisible : vérifiez l’URL et le format (MP4 H.264 ou WebM)', 'warn'); });
videoEl.addEventListener('loadeddata', () => { SetStatusVideo('Vidéo chargée', 'ok'); });

// Le masque n'est mis à jour qu'à chaque nouvelle image de la vidéo : au moment de la boucle,
// la dernière image reste affichée pendant le retour au début (pas de flash, pas de saut)
function UpdateMaskFromVideo(w, h) {
	if (maskCanvas.width !== w || maskCanvas.height !== h) { maskCanvas.width = w; maskCanvas.height = h; videoFrameReady = false; }
	const mc = maskCanvas.getContext('2d');
	mc.save();
	mc.clearRect(0, 0, w, h);
	mc.filter = ws.values.videoBackground === 'noir' ? 'url(#lumaToAlpha)' : 'none';
	// La vidéo couvre la zone (comme « remplir » dans OBS)
	const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
	const k = Math.max(w / vw, h / vh);
	mc.drawImage(videoEl, (w - vw * k) / 2, (h - vh * k) / 2, vw * k, vh * k);
	mc.restore();
	videoFrameReady = true;
}

function WatchVideoFrames() {
	const onFrame = () => {
		if (videoEl.videoWidth && canvas.width) UpdateMaskFromVideo(canvas.width, canvas.height);
		if ('requestVideoFrameCallback' in videoEl) videoEl.requestVideoFrameCallback(onFrame);
	};
	if ('requestVideoFrameCallback' in videoEl) videoEl.requestVideoFrameCallback(onFrame);
	else videoEl.addEventListener('timeupdate', onFrame);
}

// Masque d'exemple (aperçu sans vidéo) : un anneau et des points blancs qui respirent
function DemoMask(w, h, t) {
	if (maskCanvas.width !== w || maskCanvas.height !== h) { maskCanvas.width = w; maskCanvas.height = h; }
	const mc = maskCanvas.getContext('2d');
	mc.clearRect(0, 0, w, h);
	const r = Math.min(w, h) * (0.3 + 0.04 * Math.sin(t * 1.4));
	mc.strokeStyle = '#fff';
	mc.lineWidth = Math.min(w, h) * 0.07;
	mc.beginPath();
	mc.arc(w / 2, h / 2, r, 0, 6.2832);
	mc.stroke();
	mc.fillStyle = '#fff';
	for (let i = 0; i < 8; i++) {
		const a = t * 0.6 + i * 0.785;
		mc.beginPath();
		mc.arc(w / 2 + Math.cos(a) * r * 1.45, h / 2 + Math.sin(a) * r * 1.45, Math.min(w, h) * 0.03, 0, 6.2832);
		mc.fill();
	}
}

///////////////
// RENDU     //
///////////////

let formatW = 2560, formatH = 1440;

function ReadFormat() {
	const s = ws.values;
	if (s.format === 'custom') { formatW = s.customWidth; formatH = s.customHeight; }
	else {
		const [w, h] = String(s.format).split('x').map(Number);
		if (w && h) { formatW = w; formatH = h; }
	}
}

// Taille du canvas : la source entière dans OBS ; dans l'aperçu, le format choisi réduit à l'écran
function Resize() {
	if (!ws) return;
	ReadFormat();
	let cssW, cssH;
	if (ws.demo) {
		const pad = 48;
		const availW = Math.max(40, areaEl.clientWidth - pad);
		const availH = Math.max(40, areaEl.clientHeight - pad);
		const k = Math.min(availW / formatW, availH / formatH);
		cssW = Math.max(1, Math.floor(formatW * k));
		cssH = Math.max(1, Math.floor(formatH * k));
		stageEl.style.width = `${cssW}px`;
		stageEl.style.height = `${cssH}px`;
	} else {
		stageEl.style.width = '';
		stageEl.style.height = '';
		cssW = stageEl.clientWidth || window.innerWidth;
		cssH = stageEl.clientHeight || window.innerHeight;
	}
	const q = (Number(ws.values.quality) || 100) / 100;
	const dpr = ws.demo ? Math.min(2, window.devicePixelRatio || 1) : 1;
	const w = Math.max(1, Math.round(cssW * q * dpr));
	const h = Math.max(1, Math.round(cssH * q * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
		gooBlurEl.setAttribute('stdDeviation', String(Math.max(4, Math.min(w, h) * 0.022)));
	}
}

// Pixels de la source → pixels du canvas
function PxScale() {
	return ws.demo ? canvas.width / formatW : canvas.width / Math.max(1, stageEl.clientWidth || window.innerWidth);
}

// Texture de grain (générée une fois)
function NoisePattern() {
	if (noisePattern) return noisePattern;
	const n = document.createElement('canvas');
	n.width = n.height = 256;
	const nc = n.getContext('2d');
	const img = nc.createImageData(256, 256);
	const rnd = SeededRandom(1234);
	for (let i = 0; i < img.data.length; i += 4) {
		const v = rnd() < 0.5 ? 0 : 255;
		img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
		img.data[i + 3] = Math.round(rnd() * 255);
	}
	nc.putImageData(img, 0, 0);
	noisePattern = ctx.createPattern(n, 'repeat');
	return noisePattern;
}

// Chemin d'un rectangle arrondi (sans dépendre de ctx.roundRect)
function RoundRectPath(c, x, y, w, h, r) {
	r = Math.max(0, Math.min(r, w / 2, h / 2));
	c.moveTo(x + r, y);
	c.arcTo(x + w, y, x + w, y + h, r);
	c.arcTo(x + w, y + h, x, y + h, r);
	c.arcTo(x, y + h, x, y, r);
	c.arcTo(x, y, x + w, y, r);
	c.closePath();
}

// Découpe la trame selon la forme choisie
function ApplyShape(w, h) {
	const s = ws.values;
	if (s.shape === 'plein') return;
	const k = PxScale();
	const m = (Number(s.margin) || 0) * k;
	const x = m, y = m, sw = Math.max(1, w - 2 * m), sh = Math.max(1, h - 2 * m);
	ctx.save();
	ctx.globalCompositeOperation = 'destination-in';
	if (ws.isActive('featherSize')) ctx.filter = `blur(${Math.max(0.5, s.featherSize * k / 2)}px)`;
	ctx.fillStyle = '#000';
	ctx.beginPath();
	switch (s.shape) {
		case 'arrondi': RoundRectPath(ctx, x, y, sw, sh, s.radius * k); break;
		case 'pilule': RoundRectPath(ctx, x, y, sw, sh, Math.min(sw, sh) / 2); break;
		case 'cercle': ctx.ellipse(x + sw / 2, y + sh / 2, Math.min(sw, sh) / 2, Math.min(sw, sh) / 2, 0, 0, 6.2832); break;
		case 'cadre': {
			const fw = Math.min(s.frameWidth * k, sw / 2, sh / 2);
			RoundRectPath(ctx, x, y, sw, sh, s.radius * k);
			RoundRectPath(ctx, x + fw, y + fw, sw - 2 * fw, sh - 2 * fw, Math.max(0, s.radius * k - fw));
			break;
		}
	}
	ctx.fill('evenodd');
	ctx.restore();
}

// Dessine un thème (fond plein éventuel compris) dans un contexte
function DrawTheme(c, name, w, h, t, set, withBackground) {
	c.save();
	c.clearRect(0, 0, w, h);
	if (withBackground) { c.fillStyle = Rgba(set.bg, 1); c.fillRect(0, 0, w, h); }
	const s = ws.values;
	const fn = THEMES[name] || THEMES.brouillard;
	// Proportions plein écran : l'animation est calculée pour un écran 16:9 puis recadrée
	// (un format vertical ou étroit montre une partie de l'animation, sans l'écraser)
	let vw = w, vh = h;
	if (s.keepRatio) {
		const R = 16 / 9;
		if (w / h < R) { vh = h; vw = h * R; } else { vw = w; vh = w / R; }
		c.translate((w - vw) / 2, (h - vh) / 2);
	}
	fn(c, vw, vh, t, set, {
		density: DENSITY[s.density] ?? 1,
		unit: PxScale(),
		lineWidth: Number(s.lineWidth) || 2,
		shapeKind: s.shapeKind,
		haloCount: Number(s.haloCount) || 4,
		haloSize: Number(s.haloSize) || 100,
		haloBlur: s.haloBlur,
		haloBlack: withBackground ? Number(s.haloBlack) || 0 : 0,
		lavaBlur: s.lavaBlur,
		background: withBackground,
		layer: layerCanvas
	});
	c.restore();
}

let animTime = 0, lastFrame = 0, lastDraw = 0;

function Frame(now) {
	requestAnimationFrame(Frame);
	if (!ws) return;
	const fps = Number(ws.values.fps) || 30;
	if (now - lastDraw < 1000 / fps - 2) return;
	const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
	lastFrame = now;
	lastDraw = now;

	const s = ws.values;
	animTime += dt * (ws.isActive('speed') ? (Number(s.speed) || 0) / 100 : 1);
	const t = animTime;
	const set = CurrentColors(now);
	if (!set) return;
	const w = canvas.width, h = canvas.height;

	if (s.theme === 'video') DrawVideo(w, h, t, set);
	else DrawTheme(ctx, s.theme, w, h, t, set, s.background);

	// Grain : seulement là où la trame est dessinée
	if (s.grain) {
		ctx.save();
		ctx.globalCompositeOperation = 'source-atop';
		ctx.globalAlpha = Math.min(1, (Number(s.grainAmount) || 0) / 100 * 0.6);
		ctx.translate(Math.floor(Math.random() * 256), Math.floor(Math.random() * 256));
		ctx.fillStyle = NoisePattern();
		ctx.fillRect(-256, -256, w + 512, h + 512);
		ctx.restore();
	}

	ApplyShape(w, h);
}

function DrawVideo(w, h, t, set) {
	const s = ws.values;
	if (fillCanvas.width !== w || fillCanvas.height !== h) { fillCanvas.width = w; fillCanvas.height = h; }
	const fc = fillCanvas.getContext('2d');

	// 1. Remplissage du blanc
	if (s.videoFill === 'trame') DrawTheme(fc, s.videoTheme, w, h, t, set, true);
	else {
		fc.save();
		fc.globalCompositeOperation = 'source-over';
		fc.clearRect(0, 0, w, h);
		if (s.videoFill === 'couleur') fc.fillStyle = Rgba(set[s.videoTone] || set.mid, 1);
		else {
			// Dégradé qui tourne lentement
			const a = t * 0.25;
			const cx = w / 2, cy = h / 2, r = Math.hypot(w, h) / 2;
			const g = fc.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
			g.addColorStop(0, Rgba(set.mid, 1));
			g.addColorStop(0.5, Rgba(set.hi, 1));
			g.addColorStop(1, Rgba(MixRgb(set.mid, set.bg, 0.4), 1));
			fc.fillStyle = g;
		}
		fc.fillRect(0, 0, w, h);
		fc.restore();
	}

	// 2. Masque : la vidéo, ou un exemple dans l'aperçu tant qu'aucune vidéo n'est chargée
	let hasMask = false;
	if (videoUrl && videoEl.videoWidth) {
		if (!videoFrameReady || maskCanvas.width !== w) UpdateMaskFromVideo(w, h);
		hasMask = true;
	} else if (!videoUrl && ws.demo) {
		DemoMask(w, h, t);
		hasMask = true;
	}

	ctx.save();
	ctx.clearRect(0, 0, w, h);
	if (s.background) { ctx.fillStyle = Rgba(set.bg, 1); ctx.fillRect(0, 0, w, h); }
	if (hasMask) {
		fc.save();
		fc.globalCompositeOperation = 'destination-in';
		fc.drawImage(maskCanvas, 0, 0);
		fc.restore();
		ctx.drawImage(fillCanvas, 0, 0);
	}
	ctx.restore();
}

///////////////////////////
// RÉGLAGES              //
///////////////////////////

let previewGameTimer = null;

function ApplySettings(previous) {
	const s = ws.values;
	document.body.classList.toggle('demo', !!ws.demo);
	canvas.style.opacity = String(Math.max(0, Math.min(100, Number(s.opacity))) / 100);
	SetupVideo();
	Resize();

	// Nom du jeu de test : on attend la fin de la saisie
	if (previous && previous.previewGame !== s.previewGame && PreviewOverride() === 'jeu') {
		clearTimeout(previewGameTimer);
		previewGameTimer = setTimeout(() => { StartSource(); UpdateColors(); }, 700);
	} else {
		StartSource();
		UpdateColors();
	}
	if (['jeu', 'chaine'].includes(s.paletteSource)) ConnectStreamerBot(); // ne reconnecte que si l'adresse ou le port changent
}

// Image de test envoyée par la page de paramétrage
window.addEventListener('message', (event) => {
	const msg = event.data;
	if (!msg || msg.type !== 'widget-image' || msg.id !== 'previewImage') return;
	previewImageData = msg.data || '';
	try { window.parent.postMessage({ type: 'widget-image-state', id: 'previewImage', data: previewImageData }, '*'); } catch (e) { }
	if (PreviewOverride() === 'image') StartSource(true);
});

window.addEventListener('resize', Resize);

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', (values, previous) => ApplySettings(previous));
	} catch (e) {
		console.error('[Trame dynamique] Réglages illisibles :', e);
		return;
	}
	WatchVideoFrames();
	ApplySettings(null);
	requestAnimationFrame(Frame);
})();
