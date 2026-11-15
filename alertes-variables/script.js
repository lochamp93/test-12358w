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

const Cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;

function TextKey(n, cle, type) {
	return n ? `sc${n}${Cap(cle)}${Cap(type)}Text` : `${cle}${Cap(type)}Text`;
}

// Texte pour une plateforme ; sans plateforme (tests du dock), la première qui gère ce type
function TextFor(n, platform, type) {
	const s = ws.values;
	let cle = PLATFORM_KEYS[platform];
	if (!cle || !(TextKey(n, cle, type) in s))
		cle = Object.values(PLATFORM_KEYS).find(c => TextKey(n, c, type) in s) || 'twitch';
	return s[TextKey(n, cle, type)] || '';
}

// Réglages de style d'un scénario (visuel propre) ou du scénario par défaut
function StyleOf(sc) {
	const s = ws.values;
	const own = sc && sc.visual === 'own';
	const k = (name) => own ? `sc${sc.n}${name[0].toUpperCase()}${name.slice(1)}` : name;
	const style = {};
	for (const name of ['font', 'fontSize', 'textColor', 'accentColor', 'textPosition', 'mediaHeight', 'animIn', 'animOut', 'duration'])
		style[name] = s[k(name)];
	// Texte d'une alerte : propre à la plateforme (twitchSubText, sc1TwitchSubText…)
	style.text = (info) => TextFor(sc && own ? sc.n : 0, info.platform, info.type);
	style.volume = sc && sc.sound === 'own' ? s[`sc${sc.n}Volume`] : s.volume;
	return style;
}

function FolderFiles(name) {
	const f = folderIndex[String(name || '').trim().toLowerCase()];
	return f ? f : null;
}

// Règles d'une alerte (anniversaires, paliers, montants…) : noms de fichiers à essayer en premier.
// Priorité : « exactement N » et type d'abonnement, puis « tous les N » (N le plus grand d'abord),
// puis « à partir de N » (N le plus grand d'abord).
function MatchingRules(info) {
	if (!info) return [];
	const tid = AlertId(info.platform, info.type);
	const prio = (r) => ({ exact: 0, prime: 0, tier1: 0, tier2: 0, tier3: 0, every: 1, atleast: 2 }[r.kind] ?? 3);
	return RulesOf(tid).filter(r => RuleMatches(info.type, r, info))
		.sort((x, y) => prio(x) - prio(y) || y.value - x.value);
}

function SpecialNames(info) {
	return MatchingRules(info).map(r => RuleFile(info.type, r));
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
	const special = SpecialNames(info);
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

///////////////////////////////////////////////
// SCÉNARIOS DANS LA PAGE DE PARAMÉTRAGE      //
// (liste des scénarios existants, nouveau, suppression)
///////////////////////////////////////////////

function PostToSettings(message) {
	if (!ws.demo || window.parent === window) return;
	try { window.parent.postMessage(message, '*'); } catch (e) { }
}

// « Scénario à modifier » : Par défaut, les scénarios existants (par leur nom), Nouveau scénario
function PostScenarioOptions() {
	const s = ws.values;
	const count = ScenarioCount();
	const options = [{ value: 'defaut', label: 'Par défaut' }];
	for (let n = 1; n <= count; n++) {
		const name = String(s[`sc${n}Name`] || '').trim();
		options.push({ value: String(n), label: name || `Scénario ${n} (sans nom)` });
	}
	if (count < 12) options.push({ value: 'new', label: '+ Nouveau scénario' });
	PostToSettings({ type: 'widget-options', id: 'editScenario', options });
}

// Réglages propres au scénario n (sc1Name, sc1Keywords…) : suffixes communs à tous les scénarios
function ScenarioSuffixes() {
	return ws.definition.settings
		.map(x => /^sc1([A-Z].*)$/.exec(x.id))
		.filter(Boolean)
		.map(m => m[1]);
}

function ManageScenarios(values, previous) {
	if (!ws.demo) return;
	const count = ScenarioCount();

	// « + Nouveau scénario » : un scénario de plus, vide, affiché aussitôt
	if (values.editScenario === 'new') {
		if (count >= 12) { PostToSettings({ type: 'widget-set', values: { editScenario: 'defaut' } }); return; }
		const n = count + 1;
		const reset = {};
		for (const suffix of ScenarioSuffixes()) {
			const def = ws.definition.settings.find(x => x.id === `sc${n}${suffix}`);
			if (def) reset[def.id] = def.defaultValue;
		}
		reset[`sc${n}Name`] = '';
		reset.scenarioCount = String(n);
		reset.editScenario = String(n);
		PostToSettings({ type: 'widget-set', values: reset });
		return;
	}

	// Un scénario désactivé n'est plus proposé : retour au scénario par défaut
	const edit = parseInt(values.editScenario, 10);
	if (edit > count) { PostToSettings({ type: 'widget-set', values: { editScenario: 'defaut' } }); return; }

	PostScenarioOptions();
	PostFilesInfo();
}

// Bouton « Supprimer ce scénario » : les scénarios suivants remontent d'un cran
window.DeleteScenario = function () {
	const s = ws.values;
	const count = ScenarioCount();
	const n = parseInt(s.editScenario, 10);
	if (!n || n > count) return;
	const changes = {};
	for (let k = n; k < count; k++)
		for (const suffix of ScenarioSuffixes())
			if (`sc${k + 1}${suffix}` in s) changes[`sc${k}${suffix}`] = s[`sc${k + 1}${suffix}`];
	for (const suffix of ScenarioSuffixes()) {
		const def = ws.definition.settings.find(x => x.id === `sc${count}${suffix}`);
		if (def) changes[def.id] = def.defaultValue;
	}
	changes.scenarioCount = String(count - 1);
	changes.editScenario = 'defaut';
	PostToSettings({ type: 'widget-set', values: changes });
};

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
		if (!TypeEnabled(type)) continue;
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

// Alertes activées par plateforme (twitchSub, kickFollow…). Sans plateforme (tests) :
// le type est actif s'il l'est sur au moins une plateforme activée.
const PLATFORM_KEYS = { Twitch: 'twitch', Kick: 'kick', YouTube: 'youtube', TikTok: 'tiktok' };

function TypeEnabled(type, platform) {
	const T = type[0].toUpperCase() + type.slice(1);
	if (platform && PLATFORM_KEYS[platform])
		return PlatformEnabled(platform) && ws.values[`${PLATFORM_KEYS[platform]}${T}`] === true;
	return Object.keys(PLATFORM_KEYS).some(p => PlatformEnabled(p) && ws.values[`${PLATFORM_KEYS[p]}${T}`] === true);
}

function PlatformEnabled(platform) {
	return ws.values[`platform${platform}`] !== false;
}

function Enqueue(info) {
	if (!TypeEnabled(info.type, info.platform)) return;
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
		RecordHistory(info);
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

	// Voix demandée tout de suite (Fish Audio prend une ou deux secondes), jouée après le son
	const ttsPromise = TtsWanted(info) ? RequestTts(TtsText(info)) : null;

	// Fichiers (lus par Streamer.bot, puis gardés en mémoire)
	const [visualURI, soundURI] = await Promise.all([RequestFile(media.visual), RequestFile(media.sound)]);
	const visual = visualURI || (ws.demo && !media.visual ? DemoVisual(info.type) : null);
	const muted = sbState.mute;
	// Volume : celui du scénario (ou maître), multiplié par celui de l'alerte
	const alertVolume = ws.values[`${AlertId(info.platform, info.type)}Volume`];
	const volume = Math.max(0, Math.min(100, Number(style.volume) || 0)) / 100 *
		Math.max(0, Math.min(100, alertVolume === undefined ? 100 : Number(alertVolume) || 0)) / 100;

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
	titleEl.innerHTML = FillTemplate(style.text(info), info);
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

	// Durée : réglage, prolongée jusqu'à la fin du son / de la vidéo si demandé, puis de la voix
	const t0 = Date.now();
	const elapsed = () => Date.now() - t0;
	let total = Math.max(1, Number(style.duration) || 1) * 1000;
	const [a, v] = await Promise.all([MediaDuration(audioEl), MediaDuration(videoEl)]);
	if (s.waitMedia) total = Math.max(total, a, v);
	if (ttsPromise) {
		const uri = await Promise.race([ttsPromise, skipped.then(() => null)]);
		if (uri && current && !sbState.mute) {
			// Le message est lu une fois le son (ou la vidéo) de l'alerte terminé
			const mediaEnd = audioEl || (videoEl && !videoEl.muted) ? Math.max(a, v) : 0;
			if (mediaEnd - elapsed() > 0) await Promise.race([wait(mediaEnd - elapsed() + 250), skipped]);
			if (current) {
				const ttsEl = new Audio(uri);
				ttsEl.volume = Math.max(0, Math.min(100, Number(s.ttsVolume) || 0)) / 100;
				current.tts = ttsEl;
				ttsEl.play().catch(e => console.warn('[Alertes variables] Voix bloquée :', e.message));
				const d = await MediaDuration(ttsEl);
				total = Math.max(total, elapsed() + d + 400);
			}
		}
	}
	await Promise.race([wait(Math.max(0, total - elapsed())), skipped]);

	// Sortie
	alertEl.className = alertEl.className.replace(/\b(in|out)-\w+/g, '').trim();
	if (style.animOut !== 'none') {
		void alertEl.offsetWidth;
		alertEl.classList.add(`out-${style.animOut}`);
		await Promise.race([wait(Number(s.animDuration) || 0), skipped.then(() => wait(50))]);
	}
	alertEl.classList.add('hidden');
	if (audioEl) { audioEl.pause(); audioEl.src = ''; }
	if (current && current.tts) { current.tts.pause(); current.tts.src = ''; }
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
	if (current.tts) current.tts.pause();
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
	if (!history.length && next.rapport && Array.isArray(next.rapport.historique))
		history = next.rapport.historique.filter(h => h && h.id && h.info).slice(0, HISTORY_MAX);

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

	PostFilesInfo();
	PostTtsStatus();
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
			types: ALERT_TYPES.filter(t => TypeEnabled(t)),
			enAttente: queue.length,
			enCours: !!current,
			botReply: ws.values.botReply,
			msgMute: ws.values.msgMute,
			msgUnmute: ws.values.msgUnmute,
			tests: TestOptions(),
			historique: history.slice(0, HISTORY_MAX)
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
		case 'tts': {
			if (data.erreur) {
				console.warn('[Alertes variables] Synthèse vocale :', data.erreur);
				if (ws.demo) PostToSettings({ type: 'widget-info', id: 'ttsKeyStatus', text: data.erreur, status: 'warn' });
			}
			const resolve = pendingFiles.get(data.requestId);
			if (resolve) { pendingFiles.delete(data.requestId); resolve(data.dataUri || null); }
			break;
		}
		case 'test':
			if (!ws.demo) RunDockTest(String(data.type || ''));
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
			PostFilesInfo();
			PostTtsStatus();
		}
	});

	sbClient.on('General.Custom', ({ data }) => OnCustom(data));

	for (const [source, type, alertType] of EVENT_MAP) {
		try {
			sbClient.on(`${source}.${type}`, ({ data }) => {
				const info = ParseEvent(source, type, alertType, data);
				// Abonnements d'une gift bomb : ils arrivent aussi un par un, seule la bombe s'affiche
				if ((type === 'GiftSub' || type === 'GiftSubscription') && info.fromBomb) return;
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
	window[`Test${Cap(type)}`] = function () {
		Enqueue(Object.assign({ type, test: true, platform: '' }, DEMO_INFO[type]));
	};
	// Boutons « Tester l'alerte » sous chaque alerte de chaque plateforme
	for (const platform of ['Twitch', 'Kick', 'YouTube', 'TikTok']) {
		window[`Test${platform}${Cap(type)}`] = function () {
			Enqueue(Object.assign({ type, test: true }, DEMO_INFO[type], { platform }));
		};
	}
}

//////////////////////////////////////////
// RÈGLES DES ALERTES ET FICHIERS          //
//////////////////////////////////////////

const RULE_MAX = 5;
const RULE_FIELDS = ['Name', 'Kind', 'Value'];
const PLATFORM_OF = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', tiktok: 'TikTok' };

// Identifiant d'une alerte : twitchResub, kickGift… (sans plateforme : Twitch)
function AlertId(platform, type) {
	return `${PLATFORM_KEYS[platform] || 'twitch'}${Cap(type)}`;
}

// Alertes qui ont des règles (d'après settings.json) : [{ tid, platform, type }]
function RuleAlerts() {
	const list = [];
	for (const x of ws.definition.settings) {
		const m = /^(twitch|kick|youtube|tiktok)([A-Z][a-z]+)RuleCount$/.exec(x.id);
		if (m) list.push({ tid: `${m[1]}${m[2]}`, platform: PLATFORM_OF[m[1]], type: m[2].toLowerCase() });
	}
	return list;
}

function RuleCount(tid) {
	return Math.max(0, Math.min(RULE_MAX, parseInt(ws.values[`${tid}RuleCount`], 10) || 0));
}

function RulesOf(tid) {
	const s = ws.values, out = [];
	for (let n = 1; n <= RuleCount(tid); n++)
		out.push({ n, name: String(s[`${tid}Rule${n}Name`] || '').trim(), kind: s[`${tid}Rule${n}Kind`],
			value: Math.max(0, Number(s[`${tid}Rule${n}Value`]) || 0) });
	return out;
}

// Nom de fichier d'une règle (sans extension)
function RuleFile(type, rule) {
	const N = rule.value;
	switch (type) {
		case 'sub': return `sub-${rule.kind}`;
		case 'resub':
			if (rule.kind === 'exact') return `sub-${N}mois`;
			if (rule.kind === 'atleast') return `sub-${N}mois-plus`;
			return `sub-tous-les-${N}mois`;
		default:
			return rule.kind === 'exact' ? `${type}-${N}` : `${type}-${N}-plus`;
	}
}

// Résumé lisible d'une règle (affiché si elle n'a pas de nom)
function RuleSummary(type, rule, platform) {
	const N = rule.value;
	const unit = { resub: 'mois', gift: 'abonnements', giftbomb: 'abonnements', raid: 'viewers',
		cheer: platform === 'Twitch' ? 'bits' : platform === 'TikTok' ? 'pièces' : '€' }[type] || '';
	if (type === 'sub') return { prime: 'Prime Gaming', tier1: 'Palier 1', tier2: 'Palier 2', tier3: 'Palier 3' }[rule.kind] || '';
	if (rule.kind === 'every') return `Tous les ${N} ${unit}`;
	if (rule.kind === 'exact') return `Exactement ${N} ${unit}`;
	return `À partir de ${N} ${unit}`;
}

// La règle s'applique-t-elle à cet événement ?
function RuleMatches(type, rule, info) {
	if (type === 'sub') return !!info.tier && info.tier === rule.kind;
	const x = Number({ resub: info.months, gift: info.count, giftbomb: info.count, cheer: info.value, raid: info.viewers }[type]) || 0;
	const N = rule.value;
	if (N <= 0) return false;
	if (rule.kind === 'exact') return x === N;
	if (rule.kind === 'every') return x > 0 && x % N === 0;
	return x >= N;
}

// Événement de test qui déclenche la règle
function RuleTestInfo(type, rule, platform) {
	const info = Object.assign({}, DEMO_INFO[type], { type, test: true, platform, ruleN: rule.n });
	const N = rule.value || 1;
	if (type === 'sub') info.tier = rule.kind;
	if (type === 'resub') info.months = N;
	if (type === 'gift' || type === 'giftbomb') info.count = N;
	if (type === 'raid') info.viewers = N;
	if (type === 'cheer') {
		info.value = N;
		info.bits = platform === 'Twitch' ? N : 0;
		info.amount = platform === 'Twitch' ? `${N} bits` : platform === 'TikTok' ? `${N} pièces` : `${N} €`;
	}
	return info;
}

// Boutons de la page de paramétrage : tester, supprimer, ajouter (une fonction par alerte et par règle)
function DefineRuleFunctions() {
	for (const { tid, platform, type } of RuleAlerts()) {
		for (let n = 1; n <= RULE_MAX; n++) {
			window[`TestRule_${tid}_${n}`] = function () {
				const rule = RulesOf(tid).find(r => r.n === n);
				if (rule) Enqueue(RuleTestInfo(type, rule, platform));
			};
			// Supprimer : les règles suivantes remontent d'un cran
			window[`DeleteRule_${tid}_${n}`] = function () {
				const s = ws.values, count = RuleCount(tid);
				if (n > count) return;
				const changes = {};
				for (let k = n; k < count; k++)
					for (const f of RULE_FIELDS)
						if (`${tid}Rule${k + 1}${f}` in s) changes[`${tid}Rule${k}${f}`] = s[`${tid}Rule${k + 1}${f}`];
				for (const f of RULE_FIELDS) {
					const def = ws.definition.settings.find(x => x.id === `${tid}Rule${count}${f}`);
					if (def) changes[def.id] = def.defaultValue;
				}
				changes[`${tid}RuleCount`] = String(count - 1);
				PostToSettings({ type: 'widget-set', values: changes });
			};
		}
		window[`AddRule_${tid}`] = function () {
			const count = RuleCount(tid);
			if (count >= RULE_MAX) return;
			const n = count + 1, changes = { [`${tid}RuleCount`]: String(n) };
			for (const f of RULE_FIELDS) {
				const def = ws.definition.settings.find(x => x.id === `${tid}Rule${n}${f}`);
				if (def) changes[def.id] = f === 'Name' ? '' : def.defaultValue;
			}
			PostToSettings({ type: 'widget-set', values: changes });
		};
	}
}

// « Fichiers » : une ligne image, une ligne son, avec un état
//   ok (vert) : fichier propre trouvé ; warn (orange) : fichier de repli ; error (rouge) : aucun fichier
function FileLine(found, label, preferred) {
	if (!found) return { label, text: 'aucun', status: 'error' };
	const def = String(ws.values.defaultFolder || 'defaut').trim().toLowerCase();
	const from = found.dossier.toLowerCase() === def ? 'défaut' : found.dossier;
	const base = found.fichier.replace(/\.[^.]+$/, '').toLowerCase();
	const status = preferred && !preferred.includes(base) ? 'warn' : 'ok';
	return { label, text: `${found.fichier} (${from})`, status };
}

// Fichiers d'une fenêtre « Fichiers » (alerte ou règle) : { lines, visual }
function FilesFor(id) {
	const sc = ActiveScenario().scenario;
	let m = /^(twitch|kick|youtube|tiktok)([A-Z][a-z]+)Files$/.exec(id);
	if (m) {
		const type = m[2].toLowerCase();
		const media = ResolveMedia(sc, type, { type, months: 1 });
		const names = [].concat(FILE_NAMES[type] || [type]).map(x => String(x).toLowerCase());
		return { visual: media.visual, lines: [FileLine(media.visual, 'Image', names), FileLine(media.sound, 'Son', names)] };
	}
	m = /^((twitch|kick|youtube|tiktok)([A-Z][a-z]+))Rule(\d)Files$/.exec(id);
	if (m) {
		const tid = m[1], type = m[3].toLowerCase(), n = Number(m[4]);
		const rule = RulesOf(tid).find(r => r.n === n);
		if (!rule) return null;
		const name = RuleFile(type, rule);
		const def = FolderFiles(String(ws.values.defaultFolder || 'defaut').trim());
		const base = ResolveMedia(sc, type, { type, months: 1 });
		const pick = (useOwn, ext, fallback) => {
			const own = useOwn && sc ? FolderFiles(sc.name) : null;
			const fo = own && FindNamed(own.fichiers, [name], ext);
			if (fo) return { dossier: own.nom, fichier: fo };
			const fd = def && FindNamed(def.fichiers, [name], ext);
			if (fd) return { dossier: def.nom, fichier: fd };
			return fallback; // sinon, ceux de l'alerte (orange)
		};
		const visual = pick(sc && sc.visual === 'own', VISUAL_EXT, base.visual);
		const sound = pick(sc && sc.sound === 'own', SOUND_EXT, base.sound);
		return { visual, lines: [FileLine(visual, 'Image', [name]), FileLine(sound, 'Son', [name])] };
	}
	return null;
}

function PostFilesInfo() {
	if (!ws.demo) return;
	const post = (id, data) => PostToSettings(Object.assign({ type: 'widget-info', id }, data));
	const ids = new Set(ws.definition.settings.filter(x => x.type === 'info').map(x => x.id));

	// Nom de fichier de chaque alerte (follow, sub…), même sans Streamer.bot
	for (const id of ids) {
		const m = /^(twitch|kick|youtube|tiktok)([A-Z][a-z]+)FileName$/.exec(id);
		if (m) post(id, { text: [].concat(FILE_NAMES[m[2].toLowerCase()] || [m[2].toLowerCase()])[0] });
	}

	// Nom de fichier et résumé de chaque règle, même sans Streamer.bot
	for (const { tid, platform, type } of RuleAlerts())
		for (const rule of RulesOf(tid)) {
			post(`${tid}Rule${rule.n}FileName`, { text: RuleFile(type, rule) });
			post(`${tid}Rule${rule.n}Summary`, { text: RuleSummary(type, rule, platform) });
		}

	if (!connected || !sbState.dossier || !sbState.dossierExiste) {
		const why = !connected ? 'Streamer.bot non connecté' : 'Choisissez le dossier source';
		ids.forEach(id => { if (id.endsWith('Files')) post(id, { lines: [{ text: why, status: 'warn' }], media: null }); });
		return;
	}
	for (const id of ids) {
		if (!id.endsWith('Files')) continue;
		const f = FilesFor(id);
		if (f) post(id, { lines: f.lines });
	}
}

// Fenêtre ouverte dans la page de paramétrage : aperçu de l'image (ou de la vidéo) de l'alerte
async function OnPopupOpened(popupId) {
	const id = `${popupId}Files`;
	const f = connected && sbState.dossierExiste ? FilesFor(id) : null;
	if (!f) return;
	const post = (data) => PostToSettings(Object.assign({ type: 'widget-info', id, lines: f.lines }, data));
	if (!f.visual) { post({ media: null }); return; }
	const uri = await RequestFile(f.visual);
	const ext = f.visual.fichier.split('.').pop().toLowerCase();
	post({ media: uri ? { src: uri, video: VIDEO_EXT.includes(ext) } : null });
}

//////////////////////////////////////////////
// DOCK : TESTS DISPONIBLES ET DERNIÈRES ALERTES //
//////////////////////////////////////////////

const HISTORY_MAX = 20; // dernières alertes gardées (dock), pas plus
let history = [];

function AlertLabel(platform, type) {
	const tid = AlertId(platform, type);
	const def = ws.definition.settings.find(x => x.id === tid);
	return `${platform || 'Twitch'} · ${def ? def.label : type}`;
}

function RuleLabel(type, rule, platform) {
	return rule.name || RuleSummary(type, rule, platform);
}

// Libellé d'une alerte jouée (historique du dock) : la plateforme puis le contenu, sans la règle :
// « Twitch · 100 bits », « Twitch · 25 abonnements offerts », « Twitch · Abonnement offert à Alice »
function PlayedLabel(info) {
	const platform = info.platform || 'Twitch';
	const n = (x) => Number(x) || 0;
	const plural = (k, one, many) => `${k} ${k > 1 ? many : one}`;
	const tierName = { prime: 'Prime Gaming', tier1: 'palier 1', tier2: 'palier 2', tier3: 'palier 3' }[info.tier];
	let what;
	switch (info.type) {
		case 'cheer': what = String(info.amount || (n(info.bits) ? plural(n(info.bits), 'bit', 'bits') : 'Don')); break;
		case 'giftbomb': what = n(info.count) ? `${plural(n(info.count), 'abonnement offert', 'abonnements offerts')}` : 'Abonnements offerts'; break;
		case 'gift': what = info.recipient ? `Abonnement offert à ${info.recipient}` : 'Abonnement offert'; break;
		case 'resub': what = n(info.months) ? `Réabonnement · ${n(info.months)} mois` : 'Réabonnement'; break;
		case 'raid': what = n(info.viewers) ? `Raid · ${plural(n(info.viewers), 'viewer', 'viewers')}` : 'Raid'; break;
		case 'sub': what = tierName ? `Abonnement ${tierName}` : 'Abonnement'; break;
		default: {
			const def = ws.definition.settings.find(x => x.id === AlertId(platform, info.type));
			what = def ? def.label : info.type;
		}
	}
	return `${platform} · ${what}`;
}

// Tests proposés dans le dock : chaque alerte activée, puis ses règles
function TestOptions() {
	const out = [];
	for (const [platform, cle] of Object.entries(PLATFORM_KEYS)) {
		if (!PlatformEnabled(platform)) continue;
		for (const type of ALERT_TYPES) {
			const tid = `${cle}${Cap(type)}`;
			if (ws.values[tid] !== true) continue;
			out.push({ id: `alert:${tid.toLowerCase()}`, label: AlertLabel(platform, type) });
			for (const rule of RulesOf(tid))
				out.push({ id: `rule:${tid.toLowerCase()}:${rule.n}`, label: `${AlertLabel(platform, type)} | ${RuleLabel(type, rule, platform)}` });
		}
	}
	return out;
}

function RecordHistory(info) {
	if (info.replay) return;
	const clean = Object.assign({}, info);
	delete clean.test;
	history.unshift({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		user: info.user, label: PlayedLabel(info), test: !!info.test, time: Date.now(), info: clean });
	history = history.slice(0, HISTORY_MAX);
}

// Commande « tester » du dock (Streamer.bot la transmet en minuscules) :
//   follow…            → ancien format : alerte par type
//   alert:<tid>        → alerte d'une plateforme
//   rule:<tid>:<n>     → règle d'une alerte
//   replay:<id>        → rejouer une alerte de l'historique
function RunDockTest(cmd) {
	const [kind, a, b] = cmd.split(':');
	if (ALERT_TYPES.includes(kind)) {
		Enqueue(Object.assign({ type: kind, test: true, platform: '' }, DEMO_INFO[kind]));
		return;
	}
	if (kind === 'replay') {
		const h = history.find(x => x.id.toLowerCase() === a);
		if (h) Enqueue(Object.assign({}, h.info, { replay: true, test: h.test }));
		return;
	}
	const m = /^(twitch|kick|youtube|tiktok)([a-z]+)$/.exec(a || '');
	if (!m) return;
	const platform = PLATFORM_OF[m[1]], type = m[2];
	if (!ALERT_TYPES.includes(type)) return;
	if (kind === 'alert') Enqueue(Object.assign({}, DEMO_INFO[type], { type, test: true, platform }));
	if (kind === 'rule') {
		const rule = RulesOf(AlertId(platform, type)).find(r => r.n === Number(b));
		if (rule) Enqueue(RuleTestInfo(type, rule, platform));
	}
}

/////////////////////////////////////
// SYNTHÈSE VOCALE (FISH AUDIO)     //
/////////////////////////////////////

// Message à lire ? (réglage général, réglage de l'alerte, message présent, son non coupé)
function TtsWanted(info) {
	const s = ws.values;
	if (!s.ttsEnabled || sbState.mute || !info || !info.message) return false;
	if (s[`${AlertId(info.platform, info.type)}Tts`] === false) return false;
	return !!TtsText(info);
}

// Texte lu : le message, sans les « Cheer100 » de Twitch ni les liens, limité en longueur
function TtsText(info) {
	let text = String(info.message || '');
	if (info.platform === 'Twitch' && info.type === 'cheer') text = text.replace(/\b[a-z]+\d+\b/gi, ' ');
	text = text.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
	const max = Math.max(20, Number(ws.values.ttsMaxLength) || 200);
	return text.length > max ? text.slice(0, max).replace(/\s+\S*$/, '') : text;
}

// Demande l'audio à Streamer.bot (qui appelle Fish Audio avec la clé qu'il garde) : data URI mp3
function RequestTts(text) {
	if (!text || !sbClient || !connected) return Promise.resolve(null);
	const s = ws.values;
	const requestId = `tts-${Date.now()}-${++requestCounter}`;
	return new Promise((resolve) => {
		const timer = setTimeout(() => { pendingFiles.delete(requestId); resolve(null); }, 30000);
		pendingFiles.set(requestId, (uri) => { clearTimeout(timer); resolve(uri); });
		DoAction({ mode: 'tts', texte: text, voix: String(s.ttsVoice || '').trim(), modele: String(s.ttsModel || ''), requestId });
	});
}

// Page de paramétrage : enregistrer la clé (puis vider le champ), tester la voix, état de la clé
window.SaveTtsKey = function () {
	const key = String(ws.values.ttsKeyInput || '').trim();
	if (!key) { PostToSettings({ type: 'widget-info', id: 'ttsKeyStatus', text: 'Collez d’abord la clé API', status: 'warn' }); return; }
	if (!connected) { PostToSettings({ type: 'widget-info', id: 'ttsKeyStatus', text: 'Streamer.bot non connecté', status: 'warn' }); return; }
	DoAction({ mode: 'cletts', cle: key });
	PostToSettings({ type: 'widget-set', values: { ttsKeyInput: '' } });
};

window.TestTts = async function () {
	const uri = await RequestTts('Merci pour le réabonnement, ça fait super plaisir !');
	if (!uri) return;
	const el = new Audio(uri);
	el.volume = Math.max(0, Math.min(100, Number(ws.values.ttsVolume) || 0)) / 100;
	el.play().catch(() => { });
};

function PostTtsStatus() {
	if (!ws.demo) return;
	const text = !connected ? 'Streamer.bot non connecté'
		: sbState.ttsCle ? 'Enregistrée dans Streamer.bot' : 'Aucune clé enregistrée';
	PostToSettings({ type: 'widget-info', id: 'ttsKeyStatus', text, status: connected && sbState.ttsCle ? 'ok' : 'warn' });
}

// Scénarios : « Reprendre le style du scénario par défaut » (page de paramétrage)
const STYLE_KEYS = ['font', 'fontSize', 'textColor', 'accentColor', 'textPosition', 'mediaHeight', 'animIn', 'animOut', 'duration'];
for (let n = 1; n <= 12; n++) {
	window[`ImportDefaultStyle_sc${n}`] = function () {
		const changes = {};
		for (const k of STYLE_KEYS)
			if (k in ws.values) changes[`sc${n}${Cap(k)}`] = ws.values[k];
		PostToSettings({ type: 'widget-set', values: changes });
	};
}

window.addEventListener('message', (e) => {
	if (e.data && e.data.type === 'widget-popup' && typeof e.data.id === 'string' && ws) OnPopupOpened(e.data.id);
});

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('settings/settings.json', (values, previous) => {
			ManageScenarios(values, previous);
			ConnectStreamerBot(); // ne reconnecte que si l'adresse ou le port ont changé
			if (values.actionName !== previous.actionName) DoAction({ mode: 'etat' });
			PreloadActive();
			Report();
		});
	} catch (e) {
		console.error('[Alertes variables] Réglages illisibles :', e);
		return;
	}
	DefineRuleFunctions();
	ManageScenarios(ws.values, {});
	ConnectStreamerBot();
})();
