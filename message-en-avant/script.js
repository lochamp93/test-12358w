// Message en avant : overlay
// Les réglages viennent de settings/settings.json (valeurs par défaut, bornes, conditions)
// et de l'URL. Aucune valeur par défaut n'est redéfinie ici.
// Le message affiché, les listes et la file d'attente sont gérés par l'action Streamer.bot
// (variable globale « messageEnAvant ») : l'overlay affiche, transmet les événements Twitch,
// masque un highlight à la fin de sa durée et fait l'image des perles Discord.

const widgetEl = document.getElementById('widget');
const stageEl = document.getElementById('stage');
const captureEl = document.getElementById('capture');

let ws = null;               // réglages (module commun WidgetSettings)
let sbClient = null, sbHost = null, sbPort = null;
let connected = false;
let realState = null;        // contenu de la variable Streamer.bot
let shown = null;            // message affiché
let shownEl = null;
let expireTimer = null;
let previewItem = null;      // aperçu : exemple choisi avec les boutons
let previewForced = false;   // aperçu : l'exemple passe devant le vrai message
let previewHidden = false;
let lastPerleN = null;       // dernière demande de perle déjà vue
let perleDoing = null;
let configTimer = null;
const INSTANCE = Math.random().toString(36).slice(2, 10);

////////////////////
// RENDU / STYLES //
////////////////////

function HexToRgba(hex, opacityPercent) {
	let h = String(hex).replace('#', '');
	if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
	const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, opacityPercent)) / 100})`;
}

function SetVar(name, value) { widgetEl.style.setProperty(name, value); }

function ApplySettings() {
	const s = ws.values;
	const font = String(s.font || '').trim().replace(/["']/g, '');
	SetVar('--font', font ? `"${font}"` : '"SF Pro Overlay"');
	SetVar('--font-size', `${s.fontSize}px`);
	SetVar('--text-color', s.textColor);
	SetVar('--accent', s.accentColor);
	SetVar('--bg', HexToRgba(s.bgColor, s.bgOpacity));
	SetVar('--bg-solid', s.bgColor);
	SetVar('--bg-alpha', String(Math.max(0, Math.min(100, Number(s.bgOpacity))) / 100));
	SetVar('--in-ms', `${s.animInDuration}ms`);
	SetVar('--out-ms', `${s.animOutDuration}ms`);
	// Glissement : sens choisi (entrée : d'où arrive la carte ; sortie : où elle part)
	const D = { up: ['0', '45%'], down: ['0', '-45%'], left: ['45%', '0'], right: ['-45%', '0'] };
	const inD = D[s.animInDir] || D.up, outD = D[s.animOutDir] || D.down;
	SetVar('--in-dx', inD[0]); SetVar('--in-dy', inD[1]);
	SetVar('--out-dx', outD[0].startsWith('-') ? outD[0].slice(1) : (outD[0] === '0' ? '0' : '-' + outD[0]));
	SetVar('--out-dy', outD[1].startsWith('-') ? outD[1].slice(1) : (outD[1] === '0' ? '0' : '-' + outD[1]));

	widgetEl.className = LayoutClasses(s.layout) + ` card-${s.cardAlign}`;

	// Le message affiché suit les nouveaux réglages, sans animation
	if (shown && shownEl) {
		const el = BuildCard(shown);
		stageEl.replaceChild(el, shownEl);
		shownEl = el;
	}
	QueueConfig();
}

// Couleurs
function IsAvatarMode(mode) { return ['matteDark', 'matteLight', 'vibrant'].includes(mode); }

// Couleur lisible sur un fond donné (assombrie ou éclaircie au besoin)
function Readable(fg, bg, min) {
	if (MeaContrast(fg, bg) >= min) return fg;
	const dark = MeaContrast('#000000', bg) > MeaContrast('#FFFFFF', bg);
	for (let t = 0.2; t <= 1; t += 0.2) {
		const c = MeaMix(fg, dark ? '#000000' : '#FFFFFF', t);
		if (MeaContrast(c, bg) >= min) return c;
	}
	return dark ? '#000000' : '#FFFFFF';
}

// Fixe sombre, Fixe clair, Personnalisées : pseudo dans sa couleur Twitch (lisible), accent = pseudo
function FixedColors(mode, item, custom, layout) {
	const twitch = /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? item.color : '#BF94FF';
	if (mode === 'custom') return { bg: custom.bg, opacity: custom.opacity, name: custom.name, text: custom.text, accent: custom.accent };
	if (mode === 'fixedLight') {
		const n = Readable(twitch, '#FFFFFF', 3);
		return { bg: '#FFFFFF', opacity: 92, text: '#1C1C1E', name: n, accent: n };
	}
	const n = Readable(twitch, '#1C1C1E', 3);
	return { bg: '#1C1C1E', opacity: 85, text: '#FFFFFF', name: n, accent: n };
}

// Classes de mise en page d'un style (overlay, ou image Discord avec son propre style)
function LayoutClasses(layout) {
	const s = ws.values;
	// L'Écran d'appel est toujours centré
	const align = layout === 'call' ? 'center' : s.align;
	return [
		`layout-${layout}`,
		['minimal', 'ticket'].includes(layout) ? 'layout-card' : '',
		`align-${align}`,
		`in-${s.animIn}`,
		`out-${s.animOut}`,
		s.showAvatar ? '' : 'hide-avatar',
		s.showBadges ? '' : 'hide-badges',
		['card', 'bubble', 'ticket'].includes(layout) && s.colorMode === 'custom' && Number(s.bgOpacity) === 0 ? 'no-bg' : ''
	].filter(Boolean).join(' ');
}

// Style de l'image Discord : le sien, ou celui de l'overlay
function PerleLayout() {
	const v = ws.values.perleLayout;
	return v && v !== 'same' ? v : ws.values.layout;
}

// Étiquette du mode (vide : pas d'étiquette)
function LabelFor(item) {
	if (!ws.values.showLabel) return '';
	if (item.kind === 'qa') return ws.isActive('labelQa') ? String(ws.values.labelQa || '').trim() : '';
	if (item.kind === 'highlight') return ws.isActive('labelHighlight') ? String(ws.values.labelHighlight || '').trim() : '';
	return ''; // perle par commande : pas d'étiquette
}

function TextScale(item) {
	if (!ws.values.shrinkLong) return 1;
	const len = MeaTextLength(item);
	return len <= 80 ? 1 : Math.max(0.55, Math.sqrt(80 / len));
}

// el._ready : promesse tenue quand la photo est affichée (ou abandonnée), pour la capture
function AvatarEl(item, className) {
	const el = document.createElement('div');
	el.className = className;
	el.style.setProperty('--initial-bg', MeaInitialColor(item.name));
	const load = (url) => new Promise(resolve => {
		const img = document.createElement('img');
		img.crossOrigin = 'anonymous';
		img.alt = '';
		img.onload = () => { el.textContent = ''; el.appendChild(img); resolve(); };
		img.onerror = () => { el.textContent = MeaInitial(item.name); resolve(); };
		img.src = url;
	});
	if (item.avatar && /^https:\/\//.test(item.avatar)) {
		el._ready = load(item.avatar);
	} else {
		el.textContent = MeaInitial(item.name);
		// Avatar inconnu (déclencheur Streamer.bot) : récupéré par le pseudo
		el._ready = item.login ? MeaAvatar(item.login).then(url => (url ? load(url) : null)) : Promise.resolve();
	}
	return el;
}

// Carte du message (même structure pour les trois styles, mise en forme par le CSS)
function BuildCard(item, opts = {}) {
	const s = ws.values;
	const layout = opts.layout || s.layout;
	const card = document.createElement('div');
	card.className = `mea kind-${item.kind}`;
	card.dataset.id = item.id;
	card.style.setProperty('--text-scale', String(TextScale(item)));
	// Couleurs : mode de l'overlay, ou celui de la perle (opts.colorMode, opts.custom)
	const mode = opts.colorMode || s.colorMode;
	const custom = opts.custom || { name: s.nameColor, text: s.textColor, bg: s.bgColor, accent: s.accentColor, opacity: s.bgOpacity };
	const apply = (c) => {
		card.style.setProperty('--bg', HexToRgba(c.bg, c.opacity));
		card.style.setProperty('--bg-solid', c.bg);
		card.style.setProperty('--bg-alpha', String(Math.max(0, Math.min(100, Number(c.opacity))) / 100));
		card.style.setProperty('--name-color', c.name);
		card.style.setProperty('--text-color', c.text);
		card.style.setProperty('--accent', c.accent);
		// Texte foncé (modes clairs) : l'avatar flouté est éclairci au lieu d'être assombri
		card.classList.toggle('bg-light', MeaContrast(c.text, '#FFFFFF') > MeaContrast(c.text, '#000000'));
	};
	if (!IsAvatarMode(mode)) apply(FixedColors(mode, item, custom, layout));

	// Fond : avatar du viewer flouté et assombri (Carte, Bulle, Ticket)
	let bgAvatar = null;
	if (['card', 'bubble', 'ticket'].includes(layout) && s.bgMode === 'avatar') {
		bgAvatar = document.createElement('div');
		bgAvatar.className = 'bg-avatar';
		bgAvatar.appendChild(document.createElement('i'));
		card.classList.add('with-bg-avatar');
	}

	// Couleurs tirées de l'avatar (palette calculée une fois par avatar)
	card._ready = (async () => {
		const url = item.avatar || (item.login ? await MeaAvatar(item.login) : '');
		if (bgAvatar && url) bgAvatar.firstChild.style.backgroundImage = `url("${url}")`;
		if (!bgAvatar && !IsAvatarMode(mode)) return;
		const pal = await MeaPalette(url, item.color);
		if (IsAvatarMode(mode)) {
			const c = MeaPaletteColors(pal, mode);
			apply({ bg: c.bg, opacity: 85, name: c.name, text: c.text, accent: c.accent });
		}
		// Avatar flouté : la queue de la bulle (et la base sous le flou) prend la teinte du bord de l'image
		if (bgAvatar) card.style.setProperty('--tail-color', MeaMix(pal.average || pal.muted, card.classList.contains('bg-light') ? '#FFFFFF' : '#000000', 0.72));
	})().catch(() => { });

	card.appendChild(AvatarEl(item, 'avatar'));

	const body = document.createElement('div');
	body.className = 'body';

	const mark = document.createElement('div');
	mark.className = 'quote-mark';
	mark.textContent = '“';

	const head = document.createElement('div');
	head.className = 'head';
	const line = document.createElement('span');
	line.className = 'sign-line';
	const badges = document.createElement('span');
	badges.className = 'badges';
	(item.badges || []).forEach(u => {
		if (!/^https:\/\//.test(String(u))) return;
		const b = document.createElement('img');
		b.crossOrigin = 'anonymous';
		b.alt = '';
		b.src = u;
		b.onerror = () => b.remove();
		badges.appendChild(b);
	});
	const name = document.createElement('span');
	name.className = 'name';
	name.textContent = item.name || item.login || '';
	head.append(line, AvatarEl(item, 'avatar sign-avatar'), badges, name);
	// Image Discord : date et heure du message à côté du pseudo
	if (opts.date) {
		const date = document.createElement('span');
		date.className = 'date';
		const d = new Date(Number(opts.date) || Date.now());
		date.textContent = `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
		head.appendChild(date);
	}
	// Ticket : heure du message à droite
	const time = document.createElement('span');
	time.className = 'time';
	time.textContent = new Date(Number(item.at) || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	head.appendChild(time);
	const labelText = LabelFor(item);
	if (labelText) {
		const label = document.createElement('span');
		label.className = 'label';
		label.textContent = labelText;
		head.appendChild(label);
	}

	const bubble = document.createElement('div');
	bubble.className = 'bubble';
	// Fond de la bulle (style Bulle) : forme arrondie + queue, transparence appliquée à l'ensemble
	const bubbleBg = document.createElement('span');
	bubbleBg.className = 'bubble-bg';
	const bubbleShape = document.createElement('span');
	bubbleShape.className = 'bubble-shape';
	bubbleBg.appendChild(bubbleShape);
	bubble.appendChild(bubbleBg);
	const text = document.createElement('div');
	text.className = 'text';
	text.innerHTML = MeaPartsHTML(item);
	// Emote introuvable : son nom en texte
	text.querySelectorAll('img').forEach(img => { img.crossOrigin = 'anonymous'; img.onerror = () => img.replaceWith(document.createTextNode(img.alt)); });
	bubble.appendChild(text);

	body.append(mark, head, bubble);
	card.appendChild(body);
	if (bgAvatar) {
		// Carte : fond de toute la carte ; Bulle : fond de la bulle
		if (layout === 'bubble') bubbleShape.appendChild(bgAvatar);
		else card.insertBefore(bgAvatar, card.firstChild);
	}
	return card;
}

// Message à afficher maintenant
function TargetItem() {
	const real = realState ? realState.current : null;
	if (!ws.demo) return real;
	// Aperçu de la page de paramétrage : le vrai message s'il y en a un, sinon l'exemple
	if (previewForced || !real) return previewHidden ? null : previewItem;
	return real;
}

function Leave(el) {
	if (!el) return;
	el.classList.remove('enter');
	el.classList.add('leave');
	const done = () => { if (el.parentNode) el.parentNode.removeChild(el); };
	el.addEventListener('animationend', done, { once: true });
	setTimeout(done, (Number(ws.values.animOutDuration) || 400) + 200);
}

function Show(item) {
	clearTimeout(expireTimer);
	if (!item || (item.until && Number(item.until) <= Date.now())) {
		if (shownEl) Leave(shownEl);
		shown = null;
		shownEl = null;
		if (item && !ws.demo) SendExpire(item);
		return;
	}

	if (shown && shown.id === item.id && shownEl) {
		// Même message (mise à jour de l'état) : pas de nouvelle animation
		shown = item;
	} else {
		const replacing = !!shownEl;
		if (shownEl) Leave(shownEl);
		const el = BuildCard(item);
		// Remplacement : l'entrée commence quand la sortie de l'ancien message est finie
		if (replacing && ws.values.animOut !== 'none') {
			const wait = Number(ws.values.animOutDuration) || 0;
			el.style.animationDelay = `${wait}ms`;
			if (ws.values.animIn === 'none') { el.style.opacity = '0'; setTimeout(() => { el.style.opacity = ''; }, wait); }
		}
		el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
		el.style.visibility = 'hidden';
		stageEl.appendChild(el);
		const reveal = () => { if (el.style.visibility !== 'hidden') return; el.style.visibility = ''; el.classList.add('enter'); };
		Promise.race([el._ready, new Promise(r => setTimeout(r, 700))]).then(reveal);
		shown = item;
		shownEl = el;
	}

	// Highlight : masqué à la fin de sa durée
	if (item.until) {
		expireTimer = setTimeout(() => {
			if (!shown || shown.id !== item.id) return;
			Leave(shownEl);
			shown = null;
			shownEl = null;
			if (!ws.demo) SendExpire(item);
		}, Math.max(0, Number(item.until) - Date.now()));
	}
}

function Sync() { Show(TargetItem()); }

//////////////////
// STREAMER.BOT //
//////////////////

function Send(args) {
	if (!sbClient || !connected) return Promise.resolve(null);
	return sbClient.doAction({ name: ws.values.actionName }, args).catch(e => { console.error('[Message en avant] Action impossible :', e); return null; });
}

function SendExpire(item) { Send({ mode: 'expire', id: item.id }); }

// Réglages utiles à l'action et au dock (jamais l'URL du webhook)
function PublicConfig() {
	const s = ws.values;
	return {
		qa: !!s.qa,
		rewardName: String(s.rewardName || ''),
		highlight: !!s.highlight,
		command: String(s.command || ''),
		highlightDuration: Number(s.highlightDuration),
		conflict: ws.isActive('conflict') ? s.conflict : 'replace',
		queue: s.queue,
		perles: !!(s.perles && WebhookURL()),
		perleCommand: ws.isActive('perleCommand') ? String(s.perleCommand || '') : '',
		hideCommand: String(s.hideCommand || ''),
		perleWho: s.perleWho,
		perleCooldown: ws.isActive('perleCooldown') ? Number(s.perleCooldown) : 0,
		perleThread: !!(ws.isActive('perleThread') && s.perleThread),
		perleThreadMax: 3
	};
}

// L'overlay d'OBS publie ses réglages dans la variable (jamais l'aperçu de la page de paramétrage)
function QueueConfig() {
	if (ws.demo) return;
	clearTimeout(configTimer);
	configTimer = setTimeout(() => {
		if (!connected || !realState) return;
		const cfg = PublicConfig();
		const same = Object.keys(cfg).every(k => String(realState.config[k]) === String(cfg[k]));
		if (!same) Send({ mode: 'config', config: JSON.stringify(cfg) });
	}, 600);
}

function OnState(state) {
	const previous = realState;
	realState = state;
	// Aperçu : un nouveau vrai message passe devant l'exemple
	const prevId = previous && previous.current ? previous.current.id : null;
	const newId = state.current ? state.current.id : null;
	if (ws.demo && newId && newId !== prevId) previewForced = false;
	Sync();
	QueueConfig();
	if (!ws.demo) CheckPerle(state);
}

function SetRealState(raw) {
	const parsed = ParseMea(raw);
	if (!parsed) return;
	if (realState && Number(parsed.updated) < Number(realState.updated)) return; // ancienne valeur arrivée en retard
	OnState(parsed);
}

async function RefreshFromStreamerBot() {
	if (!sbClient) return;
	try {
		const response = await sbClient.getGlobal(MEA_VARIABLE, true);
		if (response && response.status === 'ok' && response.variable) { SetRealState(response.variable.value); return; }
	} catch (e) { }
	// Pas encore de variable : l'action la crée avec les réglages de l'overlay
	if (!ws.demo) Send({ mode: 'config', config: JSON.stringify(PublicConfig()) });
}

function ConnectStreamerBot() {
	const host = ws.values.address;
	const port = ws.values.port;
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
			console.log(`[Message en avant] Connecté à Streamer.bot (${host}:${port})`);
			RefreshFromStreamerBot();
			ReadChannel();
			if (ws.demo) PerleImage().then(data => SendImageState(data, data ? 'Enregistrée dans Streamer.bot' : '', 'ok'));
		},
		onDisconnect: () => { connected = false; console.warn('[Message en avant] Déconnecté de Streamer.bot'); }
	});

	sbClient.on('General.Custom', ({ data }) => {
		if (data && data.source === MEA_SOURCE) SetRealState(data.data);
	});
	sbClient.on('Misc.GlobalVariableUpdated', ({ data }) => {
		const name = data && (data.name || (data.variable && data.variable.name));
		if (name === MEA_VARIABLE && !realState) RefreshFromStreamerBot();
	});

	// Événements Twitch transmis à l'action (jamais depuis l'aperçu de la page de paramétrage)
	if (!ws.demo) {
		MeaCollector.start({
			sbClient,
			getConfig: () => ({
				qa: ws.values.qa, rewardName: ws.values.rewardName, highlight: ws.values.highlight, command: ws.values.command,
				perles: !!(ws.values.perles && WebhookURL()), perleCommand: ws.isActive('perleCommand') ? ws.values.perleCommand : '',
				hideCommand: ws.values.hideCommand, perleWho: ws.values.perleWho,
				perleThread: !!(ws.isActive('perleThread') && ws.values.perleThread), perleThreadMax: 3
			}),
			send: (args) => Send(args)
		});
	}
}

/////////////////////
// PERLES DISCORD  //
/////////////////////

function WebhookURL() {
	if (!ws.isActive('webhook')) return '';
	const url = String(ws.values.webhook || '').trim();
	return /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(url) ? url : '';
}

// Demande de perle venue du dock : une seule instance de l'overlay la traite
function CheckPerle(state) {
	const p = state.perle || {};
	const n = Number(p.n) || 0;
	if (lastPerleN === null) {
		// Première lecture : les anciennes demandes sont ignorées, sauf une demande toute récente
		const recent = p.status === 'pending' && Date.now() - Number(p.at || 0) < 15000;
		lastPerleN = recent ? n - 1 : n;
	}
	if (n > lastPerleN && p.status === 'pending') {
		lastPerleN = n;
		if (WebhookURL()) Send({ mode: 'perleClaim', n: String(n), by: INSTANCE });
	}
	if (p.status === 'claimed' && p.claimedBy === INSTANCE && perleDoing !== n) {
		perleDoing = n;
		const item = MeaFind(state, p.id) || p.item;
		if (!item) { Send({ mode: 'perleDone', n: String(n), ok: 'false', error: 'Message introuvable' }); return; }
		Perle(item, false, p.by ? { by: p.by, at: p.at } : null)
			.then(() => Send({ mode: 'perleDone', n: String(n), ok: 'true' }))
			.catch(e => {
				console.error('[Message en avant] Perle impossible :', e);
				Send({ mode: 'perleDone', n: String(n), ok: 'false', error: String((e && e.message) || e).slice(0, 200) });
			});
	}
}

function WaitImages(root) {
	const imgs = Array.from(root.querySelectorAll('img'));
	return Promise.all(imgs.map(img => (img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 4000); }))));
}

// Une seule capture à la fois (elles partagent #capture) : les demandes attendent leur tour
let captureQueue = Promise.resolve();
function Capture(item) {
	const run = captureQueue.then(() => CaptureNow(item));
	captureQueue = run.catch(() => { });
	return run;
}

// Image du message avec le style choisi pour Discord
async function CaptureNow(item) {
	if (!window.htmlToImage) throw new Error('Module de capture non chargé');
	const perleLayout = PerleLayout();
	captureEl.className = LayoutClasses(perleLayout);
	captureEl.style.cssText = widgetEl.style.cssText;
	captureEl.innerHTML = '';
	const v = ws.values;
	const frame = document.createElement('div');
	frame.className = 'perle-frame' + (v.perleLine === false ? ' no-line' : '');
	frame.style.width = '900px'; // largeur fixe (image deux fois plus grande pour la netteté)
	frame.style.background = ws.isActive('perleBgColor') ? v.perleBgColor : 'transparent';
	// Arrière-plan image : l'image fait la carte (centrée), le texte s'affiche par-dessus
	const bgImage = ws.isActive('perleImage') ? await PerleImage() : '';
	if (bgImage) {
		frame.classList.add('with-image');
		frame.style.background = `url("${bgImage}") center / cover no-repeat`;
	}
	// Couleurs de la perle : celles de l'overlay, ou un mode à elle
	const pc = v.perleColors && v.perleColors !== 'same' && v.perleColors !== 'image' ? v.perleColors : null;
	const cardOpts = { layout: perleLayout };
	if (pc) cardOpts.colorMode = pc;
	if (pc === 'custom') cardOpts.custom = { name: v.perleNameColor, text: v.perleTextColor, bg: v.perleCardColor, accent: v.perleAccentColor, opacity: 100 };
	const withDate = ws.isActive('perleDate') && v.perleDate;
	let card;
	if (Array.isArray(item.thread) && item.thread.length > 1) {
		// Fil de discussion : message d'origine en haut, réponses reliées par un trait
		card = document.createElement('div');
		card.className = 'mea-thread';
		item.thread.forEach((m, i) => {
			const one = Object.assign({ id: `${item.id}:${i}`, kind: 'perle' }, m);
			const c = BuildCard(one, Object.assign({ date: withDate ? (m.at || item.at || Date.now()) : 0 }, cardOpts));
			c.style.setProperty('--text-scale', '1'); // taille de police fixe, la hauteur s'adapte
			if (i > 0) {
				const row = document.createElement('div');
				row.className = 'thread-reply' + (m.gap ? ' gap' : '');
				row.appendChild(c);
				card.appendChild(row);
			} else card.appendChild(c);
		});
	} else {
		card = BuildCard(item, Object.assign({ date: withDate ? (item.at || Date.now()) : 0 }, cardOpts));
		card.style.setProperty('--text-scale', '1');
	}
	// Couleurs tirées des avatars : calculées avant la capture
	const cards = card.classList.contains('mea') ? [card] : Array.from(card.querySelectorAll('.mea'));
	const avatars = Array.from(card.querySelectorAll('.avatar')).map(a => a._ready);
	await Promise.race([Promise.all(cards.map(c => c._ready).concat(avatars)), new Promise(r => setTimeout(r, 6000))]);
	// Couleurs issues de l'image de fond (lisibilité jugée sur sa teinte moyenne)
	if (bgImage && v.perleColors === 'image') {
		const pal = await MeaPalette(bgImage, '#FFFFFF');
		const under = pal.average || pal.muted;
		// Bulle : teinte sombre de l'image, en transparence ; le texte est jugé sur le mélange obtenu
		const bubble = MeaMix(pal.darkMuted || under, '#000000', 0.25);
		const onBubble = MeaMix(under, bubble, 0.55);
		const bg = perleLayout === 'bubble' ? onBubble : under;
		const c = { name: Readable(pal.lightVibrant, bg, 3), text: Readable(MeaMix(pal.lightMuted, '#FFFFFF', 0.8), bg, 4.5), accent: pal.darkVibrant };
		frame.style.setProperty('--text-color', c.text);
		frame.style.setProperty('--perle-shadow', MeaContrast(c.text, '#000000') < 4.5 ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)');
		cards.forEach(x => {
			x.style.setProperty('--name-color', c.name); x.style.setProperty('--text-color', c.text); x.style.setProperty('--accent', c.accent);
			x.style.setProperty('--bg-solid', bubble); x.style.removeProperty('--tail-color');
		});
	} else if (bgImage) {
		// Bulle sur une image, autres couleurs : la bulle garde la couleur de carte du mode, en transparence
		cards.forEach(x => x.style.removeProperty('--tail-color'));
		if (cards[0]) frame.style.setProperty('--text-color', getComputedStyle(cards[0]).getPropertyValue('--text-color') || '#FFFFFF');
	} else if (cards[0]) frame.style.setProperty('--text-color', getComputedStyle(cards[0]).getPropertyValue('--text-color') || '#FFFFFF');
	frame.appendChild(card);
	// Filigrane : logo Twitch et nom de la chaîne, en bas à droite
	const mark = WatermarkText();
	if (ws.isActive('perleWatermark') && v.perleWatermark && mark) {
		const wm = document.createElement('div');
		wm.className = 'watermark';
		const logo = document.createElement('img');
		logo.alt = '';
		logo.src = '../-common/resources/icons/platforms/twitch.png';
		const t = document.createElement('span');
		t.textContent = mark;
		wm.append(logo, t);
		frame.appendChild(wm);
	}
	captureEl.appendChild(frame);
	try {
		await WaitImages(frame);
		// Image qui n'a pas pu se charger : retirée (emote : son nom en texte) pour ne pas laisser de trou
		frame.querySelectorAll('img').forEach(img => {
			if (img.naturalWidth) return;
			if (img.classList.contains('emote')) img.replaceWith(document.createTextNode(img.alt));
			else img.remove();
		});
		if (document.fonts && document.fonts.ready) await document.fonts.ready;
		// Le flou d'arrière-plan n'a pas de sens sur une image : le fond garde sa couleur et son opacité
		frame.querySelectorAll('.mea').forEach(c => { c.style.backdropFilter = 'none'; c.style.webkitBackdropFilter = 'none'; });
		const options = { pixelRatio: 2, cacheBust: false, imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' };
		return await window.htmlToImage.toBlob(frame, options);
	} finally {
		captureEl.innerHTML = '';
	}
}

// Image de fond des perles : gardée dans une variable Streamer.bot (trop lourde pour l'URL)
const PERLE_IMAGE_VARIABLE = 'messageEnAvantPerleImage';
let perleImageCache = { v: null, data: '' };
async function PerleImage() {
	const v = realState ? Number(realState.perleImageV) || 0 : 0;
	if (perleImageCache.v === v && perleImageCache.data) return perleImageCache.data;
	let data = '';
	try {
		const r = await sbClient.getGlobal(PERLE_IMAGE_VARIABLE, true);
		data = r && r.status === 'ok' && r.variable ? String(r.variable.value || '') : '';
	} catch (e) { }
	perleImageCache = { v, data };
	return data;
}

function SendImageState(data, text, status) {
	try { window.parent.postMessage({ type: 'widget-image-state', id: 'perleImage', data, text, status }, '*'); } catch (e) { }
}

// Page de paramétrage : image choisie ou retirée
window.addEventListener('message', async (event) => {
	const msg = event.data;
	if (!msg || msg.type !== 'widget-image' || msg.id !== 'perleImage') return;
	if (!sbClient || !connected) { SendImageState(msg.data, 'Streamer.bot n’est pas connecté : image non enregistrée', 'warn'); return; }
	SendImageState(msg.data, 'Enregistrement…', '');
	const r = await Send({ mode: 'perleImage', data: String(msg.data || '') });
	if (!r) { SendImageState(msg.data, 'Enregistrement impossible', 'warn'); return; }
	perleImageCache = { v: null, data: '' };
	SendImageState(msg.data, msg.data ? 'Enregistrée dans Streamer.bot' : '', 'ok');
});

// Nom de la chaîne (lu dans Streamer.bot) pour le filigrane
let channelName = '';
function WatermarkText() {
	if (channelName) return `twitch.tv/${channelName}`;
	return ws.demo ? 'twitch.tv/votre-chaine' : '';
}

async function ReadChannel() {
	try {
		const b = await sbClient.getBroadcaster();
		const t = b && b.platforms && b.platforms.twitch;
		if (t && (t.broadcastUser || t.broadcastUserName)) channelName = String(t.broadcastUser || t.broadcastUserName).toLowerCase();
	} catch (e) { }
}

function DiscordEscape(text) { return String(text || '').replace(/([\\*_~`|>#\[\]()-])/g, '\\$1'); }

// perledBy : { by, at } pour une perle demandée par commande dans le chat
async function Perle(item, test, perledBy) {
	const url = WebhookURL();
	if (!url) throw new Error('URL du webhook manquante ou invalide');
	const blob = await Capture(item);
	if (!blob) throw new Error('Image vide');
	const when = (ms) => {
		const d = new Date(Number(ms) || Date.now());
		return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
	};
	let content = '';
	if (perledBy && perledBy.by) content = `Perlé par **${DiscordEscape(perledBy.by)}** le ${when(perledBy.at)}`;
	else content = `Perle de **${DiscordEscape(item.name || item.login)}**, le ${when(item.at)}`;
	if (test) content = content ? `${content} (test)` : 'Test de perle depuis la page de paramétrage';
	const form = new FormData();
	form.append('payload_json', JSON.stringify({ content, allowed_mentions: { parse: [] } }));
	form.append('files[0]', blob, 'perle.png');
	const response = await fetch(url + (url.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', body: form });
	if (!response.ok) {
		let detail = '';
		try { detail = (await response.json()).message || ''; } catch (e) { }
		throw new Error(`Discord a refusé l’envoi (${response.status}${detail ? ' : ' + detail : ''})`);
	}
}

////////////////////////////////////////
// APERÇU : boutons de test (settings) //
////////////////////////////////////////

function PreviewShow(key) {
	const items = MeaDemoItems();
	const item = Object.assign({}, items[key], { id: `${items[key].id}:${Date.now()}`, at: Date.now() });
	if (item.kind === 'highlight' && Number(ws.values.highlightDuration) > 0) item.until = Date.now() + Number(ws.values.highlightDuration) * 1000;
	previewItem = item;
	previewForced = true;
	previewHidden = false;
	Sync();
}

window.PreviewQuestion = () => PreviewShow('question');
window.PreviewHighlight = () => PreviewShow('highlight');
window.PreviewLong = () => PreviewShow('long');
window.PreviewHide = function () {
	previewForced = true;
	previewHidden = true;
	Sync();
};

// Résultat du test d'envoi : petite notification dans l'aperçu
function PerleInfo(text, status) {
	let t = document.getElementById('previewToast');
	if (!t) { t = document.createElement('div'); t.id = 'previewToast'; document.body.appendChild(t); }
	t.textContent = text;
	t.dataset.status = status || '';
	t.classList.add('on');
	clearTimeout(PerleInfo.timer);
	if (status !== 'warn' || !/cours/.test(text)) PerleInfo.timer = setTimeout(() => t.classList.remove('on'), 4000);
}

// Aperçu de l'image Discord, sans l'envoyer (fenêtre par-dessus l'aperçu, un clic la ferme)
async function ShowPerlePreview(item) {
	let box = document.getElementById('perlePreview');
	if (!box) {
		box = document.createElement('div');
		box.id = 'perlePreview';
		box.addEventListener('click', () => { box.remove(); });
		document.body.appendChild(box);
	}
	box.innerHTML = '<span>Création de l’image…</span>';
	try {
		const blob = await Capture(item);
		const img = document.createElement('img');
		img.src = URL.createObjectURL(blob);
		const caption = document.createElement('span');
		caption.textContent = 'Image envoyée sur Discord (cliquez pour fermer)';
		box.innerHTML = '';
		box.append(img, caption);
	} catch (e) {
		box.innerHTML = '';
		const err = document.createElement('span');
		err.textContent = 'Image impossible : ' + ((e && e.message) || e);
		box.appendChild(err);
	}
}

window.PreviewPerleImage = () => ShowPerlePreview(shown || TargetItem() || MeaDemoItems().question);
window.PreviewPerleThread = () => ShowPerlePreview(MeaDemoThread());

window.PreviewPerle = async function () {
	const item = shown || TargetItem() || MeaDemoItems().question;
	if (!WebhookURL()) { PerleInfo('Collez d’abord l’URL du webhook Discord', 'warn'); return; }
	PerleInfo('Envoi en cours…', 'warn');
	try {
		await Perle(item, true);
		PerleInfo(`Envoyé à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, 'ok');
	} catch (e) {
		PerleInfo(String((e && e.message) || e), 'error');
	}
};

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', () => {
			ApplySettings();
			ConnectStreamerBot(); // ne reconnecte que si l'adresse ou le port ont changé
		});
	} catch (e) {
		console.error('[Message en avant] Réglages illisibles :', e);
		return;
	}

	if (ws.demo) previewItem = Object.assign({}, MeaDemoItems().question);
	ApplySettings();
	Sync();
	ConnectStreamerBot();
})();
