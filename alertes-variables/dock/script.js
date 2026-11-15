// Alertes variables : dock de contrôle (OBS : Docks → Docks de navigateur personnalisés)
// Tout passe par l'action Streamer.bot : le dock, les overlays et les commandes du chat
// partagent donc le même état (son coupé, scénario forcé, dossier source).

const $ = (id) => document.getElementById(id);

let ws = null;
let sbClient = null, sbHost = null, sbPort = null;
let connected = false;
let actionFound = false;
let state = null;   // dernier état envoyé par l'action
let report = null;  // compte rendu de l'overlay (scénario actif, file d'attente…)

const CONNECTION_KEY = 'alertes-variables-dock-connection';
const TYPE_LABELS = { follow: 'Follow', sub: 'Abonnement', resub: 'Réabonnement', gift: 'Abonnements offerts', cheer: 'Bits / dons', raid: 'Raid' };

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
	const live = [];
	if (st.titre) live.push(`Titre : ${st.titre}`);
	if (st.categorie) live.push(`Catégorie : ${st.categorie}`);
	$('liveInfo').textContent = live.join(' • ') || (state ? 'Titre et catégorie inconnus (compte Twitch connecté dans Streamer.bot ?)' : '');

	// Son
	const mute = !!st.mute;
	$('muteButton').textContent = mute ? '🔇 Sons coupés · Réactiver' : '🔊 Sons actifs · Couper';
	$('muteButton').classList.toggle('muted-on', mute);

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

	// Dossier source : nom du dossier bien visible, chemin complet en dessous
	const folderName = st.dossier ? (st.dossier.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || st.dossier) : '';
	const nbScenarios = Object.keys(st.dossiers || {}).length;
	const folderOk = !!st.dossier && st.dossierExiste;
	$('folderBox').className = 'folder-box ' + (folderOk ? 'ok' : 'warn');
	$('folderName').textContent = !st.dossier ? 'Aucun dossier choisi'
		: (st.dossierExiste ? `${folderName} · ${nbScenarios} sous-dossier${nbScenarios > 1 ? 's' : ''}` : `${folderName} (introuvable)`);
	$('folderPath').textContent = st.dossier || 'Cliquez sur « Choisir le dossier » ou collez son chemin';

	RenderIssues();
}

function Escape(text) {
	return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Vérification des fichiers : dossiers manquants, types sans visuel ou sans son
function RenderIssues() {
	const list = $('issues');
	const items = [];
	const st = state || {};
	const add = (cls, text) => items.push(`<li class="${cls}">${Escape(text)}</li>`);

	if (!state) add('info', 'En attente de Streamer.bot…');
	else if (!st.dossier) add('warn', 'Choisissez le dossier source (un sous-dossier par scénario).');
	else if (!st.dossierExiste) add('warn', 'Le dossier source est introuvable sur ce PC.');
	else if (!report) add('info', 'Ouvrez l’overlay dans OBS pour vérifier les fichiers des scénarios.');
	else {
		const folders = {};
		for (const [name, files] of Object.entries(st.dossiers || {})) folders[name.toLowerCase()] = IndexFiles(files);
		const types = report.types || [];
		const defName = report.defaut || 'defaut';
		const def = folders[defName.toLowerCase()];

		if (!def) add('warn', `Dossier « ${defName} » (scénario par défaut) introuvable.`);
		else {
			for (const t of types) {
				const miss = [];
				if (!FindFile(def, t, VISUAL_EXT)) miss.push('image');
				if (!FindFile(def, t, SOUND_EXT)) miss.push('son');
				if (miss.length) add('warn', `${defName} : pas de ${miss.join(' ni de ')} pour « ${TYPE_LABELS[t]} » (ni ${FILE_NAMES[t][0]}.*, ni alerte.*).`);
			}
		}

		for (const sc of report.scenarios || []) {
			if (sc.visual !== 'own' && sc.sound !== 'own') continue;
			const folder = folders[sc.name.toLowerCase()];
			if (!folder) { add('warn', `Dossier « ${sc.name} » introuvable : le scénario utilise les fichiers par défaut.`); continue; }
			// Regroupé par scénario : « Horreur : son repris du défaut pour Follow, Raid »
			const noVisual = types.filter(t => sc.visual === 'own' && !FindFile(folder, t, VISUAL_EXT)).map(t => TYPE_LABELS[t]);
			const noSound = types.filter(t => sc.sound === 'own' && !FindFile(folder, t, SOUND_EXT)).map(t => TYPE_LABELS[t]);
			if (noVisual.length) add('info', `${sc.name} : image reprise du défaut pour ${noVisual.join(', ')}.`);
			if (noSound.length) add('info', `${sc.name} : son repris du défaut pour ${noSound.join(', ')}.`);
		}
		if (!items.length) add('ok', '✓ Tous les fichiers sont en place.');
	}
	list.innerHTML = items.join('');
}

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

document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', () => Send({ mode: 'tester', type: b.dataset.test })));

$('skipButton').addEventListener('click', () => Send({ mode: 'passer' }));

$('chooseFolderButton').addEventListener('click', () => {
	Toast('Fenêtre de choix ouverte sur le PC de Streamer.bot');
	Send({ mode: 'choisirDossier' });
});
$('refreshButton').addEventListener('click', () => AskState('actualiser'));

function SubmitFolder() {
	const path = $('folderInput').value.trim();
	if (!path) { Toast('Collez le chemin du dossier'); return; }
	Send({ mode: 'definirDossier', chemin: path });
	$('folderInput').value = '';
}
$('setFolderButton').addEventListener('click', SubmitFolder);
$('folderInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') SubmitFolder(); });

async function CopyImportCode() {
	try {
		const code = (await (await fetch('../streamerbot/import.txt', { cache: 'no-cache' })).text()).trim();
		await navigator.clipboard.writeText(code);
		Toast('Code d’import copié ! Collez-le dans Streamer.bot → Import');
	} catch (e) {
		Toast('Copie impossible : ouvrez streamerbot/import.txt');
	}
}
$('copyCodeButton').addEventListener('click', CopyImportCode);
$('copyCodeButton2').addEventListener('click', CopyImportCode);
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
