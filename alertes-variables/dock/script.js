// Alertes variables : dock de contrôle (OBS : Docks → Docks de navigateur personnalisés)
// Tout passe par l'action Streamer.bot : le dock, les overlays et les commandes du chat
// partagent donc le même état (son coupé, scénario forcé, dossier source).

const $ = (id) => document.getElementById(id);

let ws = null;
let sbClient = null, sbHost = null, sbPort = null;
let lastVoiceError = null; // dernière erreur de voix déjà signalée
let lastFolder = null; // dernier dossier source affiché (pour la confirmation)
let connected = false;
let actionFound = false;
let state = null;   // dernier état envoyé par l'action
let report = null;  // compte rendu de l'overlay (scénario actif, file d'attente…)

const CONNECTION_KEY = 'alertes-variables-dock-connection';
const TYPE_LABELS = { follow: 'Follow', sub: 'Abonnement', resub: 'Réabonnement', gift: 'Abonnement offert', giftbomb: 'Gift bomb', cheer: 'Bits / dons', raid: 'Raid' };

function Toast(text) {
	const el = $('toast');
	el.textContent = text;
	el.classList.add('show');
	clearTimeout(Toast.t);
	Toast.t = setTimeout(() => el.classList.remove('show'), 3000);
}

///////////////
// AFFICHAGE //
///////////////

function Render() {
	const s = ws.values;
	if (window.DockImport) DockImport.update({ connected, actionFound });
	$('status').textContent = connected ? 'Connecté' : 'Déconnecté';
	$('status').className = 'status ' + (connected ? 'on' : 'off');
	$('panelDisconnected').hidden = connected;
	$('sbTarget').textContent = `${s.address}:${s.port}`;
	$('panelMissingAction').hidden = !connected || actionFound;
	$('missingActionName').textContent = s.actionName;
	$('panelNoOverlay').hidden = !connected || !actionFound || !!report;
	$('main').classList.toggle('disabled', !(connected && actionFound));

	const st = state || {};
	const r = report || {};

	// Scénario actif
	$('scenarioName').textContent = report ? (r.scenario || `Par défaut (${r.defaut || 'defaut'})`) : '-';
	$('scenarioReason').textContent = report ? r.raison || '' : '';

	// Son
	const mute = !!st.mute;
	// État du son (texte non cliquable) et bouton rond : haut-parleur barré pour couper,
	// haut-parleur avec onde pour réactiver
	$('soundStatus').textContent = mute ? 'Sons coupés' : 'Sons actifs';
	$('soundStatus').className = 'sound-status ' + (mute ? 'off' : 'on');
	$('muteButton').classList.toggle('muted-on', mute);
	$('muteButton').title = mute ? 'Réactiver les sons' : 'Couper les sons';

	// Forcer un scénario
	const select = $('forceSelect');
	const options = [{ value: '', label: 'Automatique (règles du titre et de la catégorie)' }];
	if (report) {
		options.push({ value: r.defaut || 'defaut', label: `Par défaut (${r.defaut || 'defaut'})` });
		for (const sc of r.scenarios || []) options.push({ value: sc.name, label: sc.name });
	}
	if (st.force && !options.some(o => o.value.toLowerCase() === st.force.toLowerCase()))
		options.push({ value: st.force, label: `${st.force} (introuvable)` });
	const html = options.map(o => `<option value="${Escape(o.value)}">${Escape(o.label)}</option>`).join('');
	if (select.dataset.html !== html) { select.innerHTML = html; select.dataset.html = html; }
	const forced = options.find(o => o.value.toLowerCase() === String(st.force || '').toLowerCase());
	select.value = forced ? forced.value : '';

	// File d'attente
	const waiting = Number(r.enAttente) || 0;
	$('queueInfo').textContent = report
		? (r.enCours ? `Alerte en cours${waiting ? ` + ${waiting} en attente` : ''}` : (waiting ? `${waiting} en attente` : 'Vide'))
		: '-';

	// Confirmation quand le dossier source change
	if (st.dossier && lastFolder !== null && st.dossier !== lastFolder)
		Toast(st.dossierExiste ? `Dossier enregistré : ${st.dossier}` : `Dossier introuvable : ${st.dossier}`);
	if (state) lastFolder = st.dossier || '';

	// Témoin « Dossier » à côté de « Connecté » : vert si le dossier source est trouvé
	// (le dossier se choisit dans la page de paramétrage)
	const folderOk = !!st.dossier && st.dossierExiste;
	const nbScenarios = Object.keys(st.dossiers || {}).length;
	$('folderStatus').className = 'status ' + (!state ? 'off' : folderOk ? 'on' : 'warn');
	$('folderStatus').title = !state ? 'Dossier source : en attente de Streamer.bot'
		: !st.dossier ? 'Aucun dossier source : choisissez-le dans la page de paramétrage'
		: folderOk ? `${st.dossier} · ${nbScenarios} sous-dossier${nbScenarios > 1 ? 's' : ''}`
		: `Dossier introuvable : ${st.dossier}`;

	RenderTests();
	RenderHistory();

	// Erreur de synthèse vocale signalée par l'overlay (une seule fois par erreur)
	const ve = r.voixErreur;
	if (ve && ve.time && ve.time !== lastVoiceError) {
		if (lastVoiceError !== null) Toast(`Voix : ${ve.message}`);
		lastVoiceError = ve.time;
	} else if (lastVoiceError === null && report) lastVoiceError = 0;
}

function Escape(text) {
	return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Tests proposés : ceux que l'overlay déclare (alertes activées et leurs règles)
const LEGACY_TESTS = [['follow', 'Follow'], ['sub', 'Abonnement'], ['resub', 'Réabonnement'],
	['gift', 'Abonnement offert'], ['giftbomb', 'Gift bomb'], ['cheer', 'Bits / dons'], ['raid', 'Raid']];

function RenderTests() {
	const select = $('testSelect');
	const tests = report && Array.isArray(report.tests)
		? report.tests.map(t => [t.id, t.label])
		: LEGACY_TESTS;
	const key = JSON.stringify(tests);
	if (select.dataset.key === key) return;
	select.dataset.key = key;
	const current = select.value;
	select.innerHTML = tests.length
		? tests.map(([id, label]) => `<option value="${Escape(id)}">${Escape(label)}</option>`).join('')
		: '<option value="">Aucune alerte activée</option>';
	if (tests.some(([id]) => id === current)) select.value = current;
	$('testButton').disabled = !tests.length;
}

// Dernières alertes jouées : pseudo, alerte, heure et bouton pour la rejouer
const REPLAY_ICON = '<svg viewBox="0 0 25 30" aria-hidden="true"><path d="M12.21 29.7C18.95 29.7 24.42 24.23 24.42 17.49C24.42 10.73 18.95 5.28 12.21 5.28C11.56 5.28 10.93 5.33 10.32 5.43L13.55 2.27C13.79 2.02 13.92 1.71 13.92 1.35C13.92 0.6 13.34 0 12.62 0C12.22 0 11.92 0.150002 11.67 0.400002L6.05 6.1C5.79 6.37 5.64 6.73 5.64 7.08C5.64 7.47 5.77 7.78 6.05 8.08L11.67 13.73C11.92 13.96 12.22 14.11 12.6 14.11C13.34 14.11 13.92 13.52 13.92 12.78C13.92 12.43 13.79 12.11 13.53 11.88L9.85 8.23C10.61 8.04 11.4 7.94 12.21 7.94C17.47 7.94 21.74 12.21 21.74 17.47C21.74 22.74 17.47 27 12.21 27C6.94 27 2.68 22.74 2.68 17.47C2.68 16.73 2.06 16.13 1.34 16.13C0.6 16.13 0 16.73 0 17.47C0 24.23 5.45 29.7 12.21 29.7Z"/></svg>';

// Photo de profil : celle de l'événement, sinon (Twitch) recherchée une fois via decapi.me ;
// à défaut, l'initiale du pseudo. Pas de recherche pour les tests.
const avatarCache = new Map(); // login → URL ('' si introuvable)

function AvatarFor(info, isTest) {
	if (info.avatar) return info.avatar;
	if (isTest || (info.platform && info.platform !== 'Twitch')) return '';
	const login = String(info.user || '').trim().toLowerCase();
	if (!/^[a-z0-9_]{2,25}$/.test(login)) return '';
	if (avatarCache.has(login)) return avatarCache.get(login);
	avatarCache.set(login, '');
	fetch(`https://decapi.me/twitch/avatar/${encodeURIComponent(login)}`)
		.then(r => r.ok ? r.text() : '')
		.then(t => {
			const url = String(t || '').trim();
			if (/^https:\/\//.test(url)) { avatarCache.set(login, url); RenderHistory(); }
		})
		.catch(() => { });
	return '';
}

function RenderHistory() {
	const list = $('history');
	const items = report && Array.isArray(report.historique) ? report.historique : [];
	if (!report) { list.innerHTML = '<li class="history-empty">Ouvrez l’overlay dans OBS pour voir les dernières alertes.</li>'; return; }
	if (!items.length) { list.innerHTML = '<li class="history-empty">Aucune alerte pour l’instant.</li>'; return; }
	list.innerHTML = items.map(h => {
		const info = h.info || {};
		const avatar = AvatarFor(info, h.test);
		const initial = Escape((String(h.user || '?').trim()[0] || '?').toUpperCase());
		// Initiale toujours dessous ; la photo se pose par-dessus et s'efface si elle ne charge pas
		const avatarHtml = `<span class="history-avatar initial">${initial}${avatar
			? `<img src="${Escape(avatar)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span>`;
		const time = new Date(h.time || Date.now()).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
		return `<li class="history-item">
			${avatarHtml}
			<div class="history-text">
				<span class="history-user">${Escape(h.user || 'Anonyme')}</span>
				<span class="history-label">${Escape(h.label || '')}${h.test ? ' · test' : ''} · ${time}</span>
			</div>
			<button type="button" class="round-btn small" data-replay="${Escape(h.id)}" title="Rejouer l’alerte">${REPLAY_ICON}</button>
		</li>`;
	}).join('');
}

// « Effacer » : vide la liste des dernières alertes (deux clics)
$('clearHistory').addEventListener('click', () => {
	const btn = $('clearHistory');
	if (!btn.classList.contains('confirming')) {
		btn.classList.add('confirming');
		btn.textContent = 'Confirmer';
		clearTimeout(btn._t);
		btn._t = setTimeout(() => { btn.classList.remove('confirming'); btn.textContent = 'Effacer'; }, 3000);
		return;
	}
	clearTimeout(btn._t);
	btn.classList.remove('confirming');
	btn.textContent = 'Effacer';
	// L'overlay vide sa liste ; le dock vide aussi celle gardée par Streamer.bot (overlay ancien ou absent)
	Send({ mode: 'tester', type: 'effacer:historique' });
	if (report) {
		report = Object.assign({}, report, { historique: [] });
		Send({ mode: 'rapport', rapport: JSON.stringify(report) });
		Render();
	}
});

$('history').addEventListener('click', (e) => {
	const btn = e.target.closest('[data-replay]');
	if (btn) Send({ mode: 'tester', type: `replay:${btn.dataset.replay}` });
});

/////////////
// ACTIONS //
/////////////

async function Send(args) {
	if (!sbClient || !connected) { Toast('Streamer.bot n’est pas connecté'); return; }
	try {
		const response = await sbClient.doAction({ name: ws.values.actionName }, args);
		if (response && response.status && response.status !== 'ok')
			Toast('Erreur Streamer.bot : ' + (response.error || response.status));
	} catch (e) {
		console.error(e);
		Toast('Impossible de lancer l’action');
	}
}

function OnCustom(data) {
	if (!data || data.source !== 'alertesVariables') return;
	if (data.kind === 'etat') {
		state = data;
		if (data.rapport) report = data.rapport;
		Render();
	} else if (data.kind === 'rapport') {
		report = data.rapport || null;
		Render();
	} else if (data.kind === 'erreur') {
		Toast(data.message);
	}
}

//////////////////
// STREAMER.BOT //
//////////////////

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
	if (actionFound) AskState();
}

// Demande l'état ; si l'action ne répond pas, on l'indique (code C# non compilé, action désactivée…)
let stateTimer = null;
function AskState(mode = 'etat') {
	clearTimeout(stateTimer);
	const before = state;
	Send({ mode });
	stateTimer = setTimeout(() => {
		if (state === before && connected && actionFound)
			Toast('L’action ne répond pas : vérifiez dans Streamer.bot qu’elle est activée et que le code C# compile (onglet Compiling Log).');
		if (!state) { $('issues').innerHTML = '<li class="warn">L’action « ' + Escape(ws.values.actionName) + ' » ne répond pas. Ouvrez-la dans Streamer.bot : elle doit être activée et le code C# doit afficher « Compiled successfully ».</li>'; }
	}, 4000);
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
			try { localStorage.setItem(CONNECTION_KEY, JSON.stringify({ address: host, port })); } catch (e) { }
			CheckAction();
		},
		onDisconnect: () => {
			connected = false;
			Render();
		}
	});

	sbClient.on('General.Custom', ({ data }) => OnCustom(data));
	sbClient.on('Application.ActionAdded', CheckAction);
	sbClient.on('Application.ActionUpdated', CheckAction);
	sbClient.on('Application.ActionDeleted', CheckAction);
}

/////////////////////
// INTERACTIONS UI //
/////////////////////

$('muteButton').addEventListener('click', () => {
	const mute = !(state && state.mute);
	const r = report || {};
	Send({
		mode: mute ? 'mute' : 'unmute',
		annonce: r.botReply === false ? 'false' : 'true',
		message: (mute ? r.msgMute : r.msgUnmute) || '',
		plateforme: 'twitch'
	});
});

$('forceSelect').addEventListener('change', (e) => Send({ mode: 'forcer', scenario: e.target.value }));

$('testButton').addEventListener('click', () => Send({ mode: 'tester', type: $('testSelect').value }));

$('skipButton').addEventListener('click', () => Send({ mode: 'passer' }));



	// Le code d’import est sur la page de paramétrage (section Streamer.bot, réglage « Code d’import »)
$('recheckButton').addEventListener('click', CheckAction);

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('dock.json', () => { ConnectStreamerBot(); CheckAction(); Render(); });
	} catch (e) {
		console.error('[Dock] Réglages illisibles :', e);
		return;
	}

	// Connexion : paramètres de l'URL, sinon dernière connexion réussie mémorisée dans le dock
	const urlParams = new URL(window.location.href).searchParams;
	try {
		const saved = JSON.parse(localStorage.getItem(CONNECTION_KEY) || 'null');
		if (saved && !urlParams.has('address') && saved.address) ws.values.address = saved.address;
		if (saved && !urlParams.has('port') && saved.port) ws.values.port = Number(saved.port) || ws.values.port;
	} catch (e) { }
	$('sbAddressInput').value = ws.values.address;
	$('sbPortInput').value = ws.values.port;
	$('sbConnectButton').addEventListener('click', () => {
		ws.values.address = $('sbAddressInput').value.trim() || '127.0.0.1';
		ws.values.port = Number($('sbPortInput').value) || 8080;
		ConnectStreamerBot();
		Render();
	});

	Render();
	ConnectStreamerBot();
})();
