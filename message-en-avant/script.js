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
	SetVar('--in-ms', `${s.animInDuration}ms`);
	SetVar('--out-ms', `${s.animOutDuration}ms`);

	widgetEl.className = [
		`layout-${s.layout}`,
		`align-${s.align}`,
		`in-${s.animIn}`,
		`out-${s.animOut}`,
		s.showAvatar ? '' : 'hide-avatar',
		s.showBadges ? '' : 'hide-badges'
	].filter(Boolean).join(' ');

	// Le message affiché suit les nouveaux réglages, sans animation
	if (shown && shownEl) {
		const el = BuildCard(shown);
		stageEl.replaceChild(el, shownEl);
		shownEl = el;
	}
	QueueConfig();
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

function AvatarEl(item, className) {
	const el = document.createElement('div');
	el.className = className;
	el.style.setProperty('--initial-bg', MeaInitialColor(item.name));
	if (item.avatar && /^https:\/\//.test(item.avatar)) {
		const img = document.createElement('img');
		img.crossOrigin = 'anonymous';
		img.alt = '';
		img.src = item.avatar;
		img.onerror = () => { img.remove(); el.textContent = MeaInitial(item.name); };
		el.appendChild(img);
	} else {
		el.textContent = MeaInitial(item.name);
		// Avatar inconnu (déclencheur Streamer.bot) : récupéré par le pseudo
		if (item.login) MeaAvatar(item.login).then(url => {
			if (!url) return;
			const img = document.createElement('img');
			img.crossOrigin = 'anonymous';
			img.alt = '';
			img.onload = () => { el.textContent = ''; el.appendChild(img); };
			img.src = url;
		});
	}
	return el;
}

// Carte du message (même structure pour les trois styles, mise en forme par le CSS)
function BuildCard(item, opts = {}) {
	const s = ws.values;
	const card = document.createElement('div');
	card.className = `mea kind-${item.kind}`;
	card.dataset.id = item.id;
	card.style.setProperty('--text-scale', String(TextScale(item)));
	card.style.setProperty('--name-color', s.nameColorMode === 'fixed' ? s.nameColor : (item.color || s.textColor));

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
	const labelText = LabelFor(item);
	if (labelText) {
		const label = document.createElement('span');
		label.className = 'label';
		label.textContent = labelText;
		head.appendChild(label);
	}

	const bubble = document.createElement('div');
	bubble.className = 'bubble';
	const text = document.createElement('div');
	text.className = 'text';
	text.innerHTML = MeaPartsHTML(item);
	// Emote introuvable : son nom en texte
	text.querySelectorAll('img').forEach(img => { img.crossOrigin = 'anonymous'; img.onerror = () => img.replaceWith(document.createTextNode(img.alt)); });
	bubble.appendChild(text);

	body.append(mark, head, bubble);
	card.appendChild(body);
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
			if (ws.values.animIn === 'none') { el.style.visibility = 'hidden'; setTimeout(() => { el.style.visibility = ''; }, wait); }
		}
		el.classList.add('enter');
		el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
		stageEl.appendChild(el);
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
		perleThreadMax: Number(s.perleThreadMax)
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
				perleThread: !!(ws.isActive('perleThread') && ws.values.perleThread), perleThreadMax: ws.values.perleThreadMax
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

// Image du message avec le style de l'overlay
async function Capture(item) {
	if (!window.htmlToImage) throw new Error('Module de capture non chargé');
	captureEl.className = widgetEl.className;
	captureEl.style.cssText = widgetEl.style.cssText;
	captureEl.innerHTML = '';
	const frame = document.createElement('div');
	frame.className = 'perle-frame';
	frame.style.background = ws.isActive('perleBgColor') ? ws.values.perleBgColor : 'transparent';
	const withDate = ws.isActive('perleDate') && ws.values.perleDate;
	let card;
	if (Array.isArray(item.thread) && item.thread.length > 1) {
		// Fil de discussion : message d'origine en haut, réponses reliées par un trait
		card = document.createElement('div');
		card.className = 'mea-thread';
		// Même taille de texte pour tout le fil : celle du message le plus long
		const scale = Math.min(...item.thread.map(m => TextScale(m)));
		item.thread.forEach((m, i) => {
			const one = Object.assign({ id: `${item.id}:${i}`, kind: 'perle' }, m);
			const c = BuildCard(one, { date: withDate ? (m.at || item.at || Date.now()) : 0 });
			c.style.setProperty('--text-scale', String(scale));
			if (i > 0) {
				const row = document.createElement('div');
				row.className = 'thread-reply' + (m.gap ? ' gap' : '');
				row.appendChild(c);
				card.appendChild(row);
			} else card.appendChild(c);
		});
	} else card = BuildCard(item, { date: withDate ? (item.at || Date.now()) : 0 });
	frame.appendChild(card);
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
	else if (ws.values.caption) content = `Perle de **${DiscordEscape(item.name || item.login)}**, le ${when(item.at)}`;
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

function PerleInfo(text, status) {
	try { window.parent.postMessage({ type: 'widget-info', id: 'perleInfo', lines: [{ label: '', text, status }] }, '*'); } catch (e) { }
}

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
