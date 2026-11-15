// Alertes variables : overlay
// Les réglages viennent de settings/settings.json et de l'URL (aucune valeur par défaut ici).
// Les médias sont lus dans un dossier du PC par l'action Streamer.bot « Alertes variables | Moteur » :
//   <dossier source>/<nom du scénario>/<type>.<ext>   (ex. Horreur/sub.mp3, Horreur/alerte.gif)

const alertEl = document.getElementById('alert');
const mediaWrapEl = document.getElementById('mediaWrap');
const titleEl = document.getElementById('alertTitle');
const messageEl = document.getElementById('alertMessage');
const fontLinkEl = document.getElementById('googleFont');

let ws = null;                 // réglages (module commun WidgetSettings)
let sbClient = null, sbHost = null, sbPort = null;
let connected = false;

// État partagé par Streamer.bot (dossier, son coupé, scénario forcé, titre, catégorie)
let sbState = { dossier: '', dossierExiste: false, mute: false, force: '', titre: '', categorie: '', dossiers: {} };
let folderIndex = {};          // { nomDossierMinuscule: { nom, fichiers: { nomMinuscule: nomRéel } } }

const queue = [];
let playing = false;
let current = null;            // alerte en cours { audio, video, skip }
let lastReport = '';

const fileCache = new Map();   // "dossier/fichier" → data URI
const pendingFiles = new Map(); // requestId → resolve
let requestCounter = 0;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

//////////////////////
// SCÉNARIOS / RÈGLES //
//////////////////////

function ScenarioCount() {
	return Math.max(0, Math.min(12, parseInt(ws.values.scenarioCount, 10) || 0));
}

// Liste des scénarios configurés (ceux qui ont un nom)
function Scenarios() {
	const s = ws.values;
	const list = [];
	for (let n = 1; n <= ScenarioCount(); n++) {
		const name = String(s[`sc${n}Name`] || '').trim();
		if (!name) continue;
		list.push({
			n, name,
			keywords: SplitList(s[`sc${n}Keywords`]),
			categories: SplitList(s[`sc${n}Categories`]),
			match: s[`sc${n}Match`],
			visual: s[`sc${n}Visual`],
			sound: s[`sc${n}Sound`]
		});
	}
	return list;
}

// Scénario actif : forcé depuis le dock, sinon la première règle qui correspond, sinon le défaut
function ActiveScenario() {
	const list = Scenarios();

	// Aperçu de la page de paramétrage : le scénario en cours de modification
	if (ws.demo && ws.values.editScenario) {
		const edit = String(ws.values.editScenario);
		if (edit === 'defaut') return { scenario: null, reason: 'Scénario en cours de modification' };
		const editing = list.find(sc => String(sc.n) === edit);
		if (editing) return { scenario: editing, reason: 'Scénario en cours de modification' };
	}
	const force = Normalize(sbState.force);
	if (force) {
		const forced = list.find(sc => Normalize(sc.name) === force);
		if (forced) return { scenario: forced, reason: 'Choisi dans le dock' };
		if (force === Normalize(ws.values.defaultFolder) || force === 'defaut')
			return { scenario: null, reason: 'Choisi dans le dock' };
	}

	const title = Normalize(sbState.titre);
	const category = Normalize(sbState.categorie);
	for (const sc of list) {
		const kwHit = sc.keywords.find(k => title.includes(k));
		const catHit = sc.categories.find(c => c === category);
		const hasKw = sc.keywords.length > 0, hasCat = sc.categories.length > 0;
		if (!hasKw && !hasCat) continue;
		let ok;
		if (sc.match === 'all') ok = (!hasKw || kwHit) && (!hasCat || catHit);
		else ok = !!(kwHit || catHit);
		if (ok) {
			const parts = [];
			if (kwHit) parts.push(`titre contient « ${kwHit} »`);
			if (catHit) parts.push(`catégorie « ${sbState.categorie} »`);
			return { scenario: sc, reason: parts.join(' et ') };
		}
	}
	return { scenario: null, reason: 'Aucune règle ne correspond' };
}

// Réglages de style d'un scénario (visuel propre) ou du scénario par défaut
function StyleOf(sc) {
	const s = ws.values;
	const own = sc && sc.visual === 'own';
	const k = (name) => own ? `sc${sc.n}${name[0].toUpperCase()}${name.slice(1)}` : name;
	const style = {};
	for (const name of ['font', 'fontSize', 'textColor', 'accentColor', 'textPosition', 'mediaHeight', 'animIn', 'animOut', 'duration'])
		style[name] = s[k(name)];
	style.texts = {};
	for (const t of ALERT_TYPES) style.texts[t] = s[k(`text${t[0].toUpperCase()}${t.slice(1)}`)];
	style.volume = sc && sc.sound === 'own' ? s[`sc${sc.n}Volume`] : s.volume;
	return style;
}

function FolderFiles(name) {
	const f = folderIndex[String(name || '').trim().toLowerCase()];
	return f ? f : null;
}

// Abonnements spéciaux : noms de fichiers à essayer en premier pour ce nombre de mois
//   « Exactement N mois » → sub-Nmois ; « Tous les N mois » → sub-tous-les-Nmois
function SpecialSubNames(info) {
	if (!info || (info.type !== 'sub' && info.type !== 'resub')) return [];
	const s = ws.values;
	const count = Number(s.subRuleCount) || 0;
	const months = Number(info.months) || 0;
	const exact = [], every = [];
	for (let n = 1; n <= count; n++) {
		const N = Number(s[`subRule${n}Months`]) || 0;
		if (N <= 0 || months <= 0) continue;
		if (s[`subRule${n}Kind`] === 'exact' && months === N) exact.push(`sub-${N}mois`);
		if (s[`subRule${n}Kind`] === 'every' && months % N === 0) every.push(`sub-tous-les-${N}mois`);
	}
	return [...exact, ...every.sort((a, b) => parseInt(b.match(/\d+/)) - parseInt(a.match(/\d+/)))];
}

function FindNamed(folderFiles, names, extensions) {
	if (!folderFiles) return null;
	for (const name of names)
		for (const ext of extensions) {
			const real = folderFiles[`${name}.${ext}`];
			if (real) return real;
		}
	return null;
}

// Fichiers à jouer : visuel et son, avec secours en cascade
//   abonnement spécial (scénario, puis défaut) → dossier du scénario (type, puis « alerte »)
//   → dossier par défaut (type, puis « alerte »)
function ResolveMedia(sc, type, info) {
	const defName = String(ws.values.defaultFolder || 'defaut').trim();
	const def = FolderFiles(defName);
	const special = SpecialSubNames(info);
	const pick = (useOwn, extensions) => {
		if (special.length) {
			const own = useOwn && sc ? FolderFiles(sc.name) : null;
			const fo = own && FindNamed(own.fichiers, special, extensions);
			if (fo) return { dossier: own.nom, fichier: fo };
			const fd = def && FindNamed(def.fichiers, special, extensions);
			if (fd) return { dossier: def.nom, fichier: fd };
		}
		if (useOwn && sc) {
			const folder = FolderFiles(sc.name);
			const f = folder && FindFile(folder.fichiers, type, extensions);
			if (f) return { dossier: folder.nom, fichier: f };
		}
		const f = def && FindFile(def.fichiers, type, extensions);
		return f ? { dossier: def.nom, fichier: f } : null;
	};
	return {
		visual: pick(sc && sc.visual === 'own', VISUAL_EXT),
		sound: pick(sc && sc.sound === 'own', SOUND_EXT)
	};
}

//////////////
// FICHIERS //
//////////////

function RequestFile(ref) {
	if (!ref) return Promise.resolve(null);
	const key = `${ref.dossier}/${ref.fichier}`.toLowerCase();
	if (fileCache.has(key)) return Promise.resolve(fileCache.get(key));
	if (inFlight.has(key)) return inFlight.get(key);
	if (!sbClient || !connected) return Promise.resolve(null);

	const requestId = `av-${Date.now()}-${++requestCounter}`;
	const promise = new Promise((resolve) => {
		const timer = setTimeout(() => { pendingFiles.delete(requestId); resolve(null); }, 15000);
		pendingFiles.set(requestId, (uri) => { clearTimeout(timer); resolve(uri); });
		DoAction({ mode: 'fichier', dossier: ref.dossier, fichier: ref.fichier, requestId });
	}).finally(() => inFlight.delete(key));
	inFlight.set(key, promise);
	return promise;
}

const inFlight = new Map(); // fichiers en cours de lecture (une seule demande par fichier)

// Préchargement des fichiers du scénario actif et du défaut (alertes instantanées ensuite)
let preloadToken = 0;
async function PreloadActive() {
	if (ws.demo && !connected) return;
	const token = ++preloadToken;
	const { scenario } = ActiveScenario();
	for (const type of ALERT_TYPES) {
		if (!ws.values[`alert${type[0].toUpperCase()}${type.slice(1)}`]) continue;
		const media = ResolveMedia(scenario, type);
		for (const ref of [media.visual, media.sound]) {
			if (token !== preloadToken) return;
			if (ref) await RequestFile(ref);
		}
	}
}

/////////////
// ALERTES //
/////////////

function TypeEnabled(type) {
	return ws.values[`alert${type[0].toUpperCase()}${type.slice(1)}`] === true;
}

function PlatformEnabled(platform) {
	return ws.values[`platform${platform}`] !== false;
}

function Enqueue(info) {
	if (!TypeEnabled(info.type)) return;
	if (info.platform && !PlatformEnabled(info.platform)) return;
	if (info.type === 'cheer' && info.platform === 'Twitch' && info.bits && info.bits < ws.values.minBits) return;
	if (info.type === 'raid' && info.viewers && info.viewers < ws.values.minRaid) return;
	if (sbState.mute && ws.values.muteEffect === 'all' && !info.test) return;
	queue.push(info);
	Report();
	if (!playing) PlayQueue();
}

async function PlayQueue() {
	playing = true;
	while (queue.length) {
		const info = queue.shift();
		Report();
		try { await PlayAlert(info); } catch (e) { console.error('[Alertes variables] Erreur pendant l’alerte :', e); }
		await wait(Math.max(0, Number(ws.values.alertGap) || 0) * 1000);
	}
	playing = false;
	Report();
}

function ApplyFont(font) {
	font = String(font || '').trim();
	if (font) {
		const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;500;700;800;900&display=swap`;
		if (fontLinkEl.getAttribute('href') !== href) fontLinkEl.setAttribute('href', href);
		alertEl.style.setProperty('--font', `'${font.replace(/'/g, '')}'`);
	} else {
		alertEl.style.setProperty('--font', 'inherit');
	}
}

function MediaDuration(el) {
	return new Promise((resolve) => {
		if (!el) return resolve(0);
		if (Number.isFinite(el.duration) && el.duration > 0) return resolve(el.duration * 1000);
		const done = () => resolve(Number.isFinite(el.duration) ? el.duration * 1000 : 0);
		el.addEventListener('loadedmetadata', done, { once: true });
		el.addEventListener('error', () => resolve(0), { once: true });
		setTimeout(() => resolve(0), 3000);
	});
}

async function PlayAlert(info) {
	const s = ws.values;
	const { scenario } = ActiveScenario();
	const style = StyleOf(scenario);
	const media = ResolveMedia(scenario, info.type, info);

	// Fichiers (lus par Streamer.bot, puis gardés en mémoire)
	const [visualURI, soundURI] = await Promise.all([RequestFile(media.visual), RequestFile(media.sound)]);
	const visual = visualURI || (ws.demo && !media.visual ? DemoVisual(info.type) : null);
	const muted = sbState.mute;
	const volume = Math.max(0, Math.min(100, Number(style.volume) || 0)) / 100;

	// Mise en forme
	ApplyFont(style.font);
	alertEl.style.setProperty('--font-size', `${style.fontSize}px`);
	alertEl.style.setProperty('--text-color', style.textColor);
	alertEl.style.setProperty('--accent-color', style.accentColor);
	alertEl.style.setProperty('--media-height', `${style.mediaHeight}px`);
	alertEl.style.setProperty('--message-size', `${s.messageSize}px`);
	alertEl.style.setProperty('--anim-ms', `${s.animDuration}ms`);
	alertEl.classList.toggle('shadow', s.textShadow);
	alertEl.classList.remove('pos-below', 'pos-above', 'pos-over');
	alertEl.classList.add(`pos-${style.textPosition}`);

	// Visuel
	mediaWrapEl.innerHTML = '';
	let videoEl = null;
	if (visual) {
		if (media.visual && IsVideo(media.visual.fichier)) {
			videoEl = document.createElement('video');
			videoEl.src = visual;
			videoEl.playsInline = true;
			// La vidéo garde son propre son seulement s'il n'y a pas de fichier son
			videoEl.muted = muted || !!soundURI;
			videoEl.volume = volume;
			mediaWrapEl.appendChild(videoEl);
		} else {
			const img = document.createElement('img');
			img.src = visual;
			img.alt = '';
			mediaWrapEl.appendChild(img);
		}
	}

	// Textes
	titleEl.innerHTML = FillTemplate(style.texts[info.type] || '', info);
	const showMsg = s.showMessage && ['resub', 'cheer'].includes(info.type) && info.message;
	messageEl.textContent = showMsg ? info.message : '';

	// Son
	let audioEl = null;
	if (soundURI && !muted) {
		audioEl = new Audio(soundURI);
		audioEl.volume = volume;
	}

	const skip = {};
	const skipped = new Promise(r => { skip.resolve = r; });
	current = { audio: audioEl, video: videoEl, skip: skip.resolve };

	// Entrée
	alertEl.className = alertEl.className.replace(/\b(in|out)-\w+/g, '').trim();
	alertEl.classList.remove('hidden');
	void alertEl.offsetWidth;
	if (style.animIn !== 'none') alertEl.classList.add(`in-${style.animIn}`);
	if (videoEl) videoEl.play().catch(() => { videoEl.muted = true; videoEl.play().catch(() => { }); });
	if (audioEl) audioEl.play().catch(e => console.warn('[Alertes variables] Son bloqué :', e.message));

	// Durée : réglage, prolongée jusqu'à la fin du son / de la vidéo si demandé
	let total = Math.max(1, Number(style.duration) || 1) * 1000;
	if (s.waitMedia) {
		const [a, v] = await Promise.all([MediaDuration(audioEl), MediaDuration(videoEl)]);
		total = Math.max(total, a, v);
	}
	await Promise.race([wait(total), skipped]);

	// Sortie
	alertEl.className = alertEl.className.replace(/\b(in|out)-\w+/g, '').trim();
	if (style.animOut !== 'none') {
		void alertEl.offsetWidth;
		alertEl.classList.add(`out-${style.animOut}`);
		await Promise.race([wait(Number(s.animDuration) || 0), skipped.then(() => wait(50))]);
	}
	alertEl.classList.add('hidden');
	if (audioEl) { audioEl.pause(); audioEl.src = ''; }
	if (videoEl) videoEl.pause();
	mediaWrapEl.innerHTML = '';
	current = null;
}

function SkipCurrent() {
	if (current && current.skip) current.skip();
}

// Son coupé pendant une alerte : on arrête le son tout de suite
function ApplyMuteToCurrent() {
	if (!current || !sbState.mute) return;
	if (current.audio) current.audio.pause();
	if (current.video) current.video.muted = true;
}

//////////////////
// STREAMER.BOT //
//////////////////

function DoAction(args) {
	if (!sbClient || !connected) return Promise.resolve(null);
	return sbClient.doAction({ name: ws.values.actionName }, args)
		.then(r => {
			if (r && r.status && r.status !== 'ok') console.error('[Alertes variables] Streamer.bot a refusé l’action :', r);
			return r;
		})
		.catch(e => { console.error('[Alertes variables] Action impossible :', e); return null; });
}

function SetState(next) {
	const wasMuted = sbState.mute;
	sbState = Object.assign({}, sbState, next);

	folderIndex = {};
	for (const [name, files] of Object.entries(sbState.dossiers || {}))
		folderIndex[name.toLowerCase()] = { nom: name, fichiers: IndexFiles(files) };

	// Aperçu : la page de paramétrage propose les dossiers détectés dans les champs « Nom du scénario »
	// et affiche le dossier source sélectionné
	if (ws.demo && window.parent !== window) {
		try {
			window.parent.postMessage({ type: 'widget-datalist', id: 'alertes-dossiers', options: Object.keys(sbState.dossiers || {}) }, '*');
			PostFolderInfo();
		} catch (e) { }
	}

	if (sbState.mute && !wasMuted) ApplyMuteToCurrent();
	PreloadActive();
	Report();
}

// Nom du dossier source pour la page de paramétrage (réglage « Dossier sélectionné »)
function FolderSummary(st) {
	if (!st.dossier) return { text: 'Aucun dossier choisi', status: 'warn', title: '' };
	const name = st.dossier.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || st.dossier;
	if (!st.dossierExiste) return { text: `${name} (introuvable)`, status: 'warn', title: st.dossier };
	const n = Object.keys(st.dossiers || {}).length;
	return { text: `${name} · ${n} scénario${n > 1 ? 's' : ''}`, status: n ? 'ok' : 'warn', title: st.dossier };
}

function PostFolderInfo(text) {
	if (!ws.demo || window.parent === window) return;
	const info = text ? { text, status: 'warn', title: '' } : FolderSummary(sbState);
	window.parent.postMessage({ type: 'widget-info', id: 'folderInfo', ...info }, '*');
}

// Compte rendu pour le dock (scénario actif, file d'attente, scénarios configurés)
let reportTimer = null;
function Report() {
	if (ws.demo || !connected) return;
	clearTimeout(reportTimer);
	reportTimer = setTimeout(() => {
		const active = ActiveScenario();
		const report = {
			scenario: active.scenario ? active.scenario.name : '',
			raison: active.reason,
			defaut: String(ws.values.defaultFolder || 'defaut'),
			scenarios: Scenarios().map(sc => ({ name: sc.name, visual: sc.visual, sound: sc.sound })),
			types: ALERT_TYPES.filter(TypeEnabled),
			enAttente: queue.length,
			enCours: !!current,
			botReply: ws.values.botReply,
			msgMute: ws.values.msgMute,
			msgUnmute: ws.values.msgUnmute
		};
		const json = JSON.stringify(report);
		if (json === lastReport) return;
		lastReport = json;
		DoAction({ mode: 'rapport', rapport: json });
	}, 300);
}

function OnCustom(data) {
	if (!data || data.source !== 'alertesVariables') return;
	switch (data.kind) {
		case 'etat':
			if (data.vider) fileCache.clear(); // dossier actualisé : les fichiers ont pu changer
			SetState(data);
			break;
		case 'fichier': {
			const key = `${data.dossier}/${data.fichier}`.toLowerCase();
			if (data.dataUri) fileCache.set(key, data.dataUri);
			else if (data.erreur) console.warn('[Alertes variables] Fichier illisible :', data.dossier, data.fichier, data.erreur);
			const resolve = pendingFiles.get(data.requestId);
			if (resolve) { pendingFiles.delete(data.requestId); resolve(data.dataUri || null); }
			break;
		}
		case 'test':
			if (!ws.demo && ALERT_TYPES.includes(data.type)) Enqueue(Object.assign({ type: data.type, test: true, platform: '' }, DEMO_INFO[data.type]));
			break;
		case 'passer':
			if (!ws.demo) SkipCurrent();
			break;
		case 'erreur':
			console.warn('[Alertes variables] Streamer.bot :', data.message);
			if (/dossier/i.test(String(data.message || ''))) PostFolderInfo(String(data.message));
			break;
	}
}

// Titre / catégorie modifiés sur Twitch
function OnStreamUpdate({ data }) {
	const d = data || {};
	const title = Pick(d, ['title', 'status', 'streamTitle', 'broadcastTitle']);
	const category = Pick(d, ['gameName', 'game.name', 'category.name', 'categoryName', 'game']);
	const next = {};
	if (title !== undefined) next.titre = String(title);
	if (category !== undefined) next.categorie = String(category);
	if (Object.keys(next).length) SetState(next);
	// L'action mémorise ces valeurs pour les autres overlays et le dock
	const args = { mode: 'etat' };
	if (next.titre) args.title = next.titre;
	if (next.categorie) args.gameName = next.categorie;
	DoAction(args);
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
			lastReport = '';
			console.log(`[Alertes variables] Connecté à Streamer.bot (${host}:${port})`);
			DoAction({ mode: 'etat' });
			Report();
		},
		onDisconnect: () => {
			connected = false;
			console.warn('[Alertes variables] Déconnecté de Streamer.bot');
			PostFolderInfo('Streamer.bot non connecté');
		}
	});

	sbClient.on('General.Custom', ({ data }) => OnCustom(data));

	for (const [source, type, alertType] of EVENT_MAP) {
		try {
			sbClient.on(`${source}.${type}`, ({ data }) => {
				const info = ParseEvent(source, type, alertType, data);
				if ((type === 'GiftSub') && info.fromBomb) return;
				Enqueue(info);
			});
		} catch (e) { /* événement inconnu de cette version de Streamer.bot */ }
	}

	for (const ev of ['Twitch.StreamUpdate', 'Twitch.BroadcastUpdate', 'Twitch.StreamUpdateGameOnConnect']) {
		try { sbClient.on(ev, OnStreamUpdate); } catch (e) { }
	}

	// Commandes du chat (pas dans l'aperçu de la page de paramétrage)
	for (const [ev, platform] of [['Twitch.ChatMessage', 'twitch'], ['Kick.ChatMessage', 'kick'], ['YouTube.Message', 'youtube']]) {
		try { sbClient.on(ev, ({ data }) => { if (!ws.demo) HandleChatCommand(data, platform); }); } catch (e) { }
	}
}

// Filet de sécurité : l'état est relu régulièrement (titre modifié hors Streamer.bot, etc.)
setInterval(() => { if (connected) DoAction({ mode: 'etat' }); }, 120000);

///////////////////////
// COMMANDES DU CHAT //
///////////////////////

// Niveau de l'auteur : 40 streamer, 30 modo, 20 VIP, 10 viewer
function ChatPermissionLevel(data) {
	const m = data && typeof data.message === 'object' ? data.message : {};
	const u = Object.assign({}, m, data.user || {});
	const role = Number(u.role) || 1;
	const badges = (u.badges || m.badges || []).map(b => String(b.name || b.setId || b).toLowerCase());
	if (role >= 4 || u.isBroadcaster || u.isOwner || badges.includes('broadcaster')) return 40;
	if (role >= 3 || u.isModerator || badges.includes('moderator')) return 30;
	if (role >= 2 || u.isVip || badges.includes('vip')) return 20;
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

function ChatUser(data) {
	const m = data && typeof data.message === 'object' ? data.message : {};
	return String(Pick(data || {}, ['user.name', 'user.display_name', 'user.displayName', 'displayName', 'userName', 'user.login'])
		|| m.displayName || m.username || 'un modo');
}

function ChatMessageId(data) {
	const m = data && typeof data.message === 'object' ? data.message : {};
	return String(m.msgId || m.id || data.msgId || data.messageId || data.id || '');
}

function HandleChatCommand(data, platform) {
	const s = ws.values;
	if (!s.cmdEnabled) return;
	const word = (ChatText(data).trim().split(/\s+/)[0] || '').toLowerCase();
	if (!word.startsWith('!')) return;

	const list = (text) => String(text || '').split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
	let mode = '';
	if (list(s.cmdMute).includes(word)) mode = 'mute';
	else if (list(s.cmdUnmute).includes(word)) mode = 'unmute';
	if (!mode) return;

	if (ChatPermissionLevel(data) < Number(s.cmdPermission)) {
		console.info(`[Alertes variables] ${word} ignorée : permission insuffisante`);
		return;
	}

	DoAction({
		mode,
		user: ChatUser(data),
		plateforme: platform,
		msgId: ChatMessageId(data),
		annonce: s.botReply ? 'true' : 'false',
		message: mode === 'mute' ? s.msgMute : s.msgUnmute
	});
}

////////////////////////////////////////////
// BOUTONS DE LA PAGE DE PARAMÉTRAGE      //
////////////////////////////////////////////

window.ChooseFolder = function () {
	if (!connected) { console.warn('[Alertes variables] Streamer.bot n’est pas connecté'); return; }
	DoAction({ mode: 'choisirDossier' });
};

window.RefreshFolders = function () {
	DoAction({ mode: 'actualiser' });
};

for (const type of ALERT_TYPES) {
	window[`Test${type[0].toUpperCase()}${type.slice(1)}`] = function () {
		Enqueue(Object.assign({ type, test: true, platform: '' }, DEMO_INFO[type]));
	};
}

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', (values, previous) => {
			ConnectStreamerBot(); // ne reconnecte que si l'adresse ou le port ont changé
			if (values.actionName !== previous.actionName) DoAction({ mode: 'etat' });
			PreloadActive();
			Report();
		});
	} catch (e) {
		console.error('[Alertes variables] Réglages illisibles :', e);
		return;
	}
	ConnectStreamerBot();
})();
