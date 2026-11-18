// Message en avant : dock OBS
// Choisir la question à afficher, afficher ou masquer le message, perler sur Discord.
// L'état vit dans la variable Streamer.bot « messageEnAvant » (action « Message en avant | Gérer »).
// Lien unique : aucun réglage ici (adresse et port modifiables par l'URL, ?port=8081).

const $ = (id) => document.getElementById(id);

let ws = null;
let sbClient = null, sbHost = null, sbPort = null;
let connected = false;
let actionFound = false;
let state = null;            // contenu de la variable Streamer.bot
let demo = false;            // ?demo=true : fonctionnement local, sans Streamer.bot
let tab = 'qa';
let selectedId = null;
let tabs = null;
let createSent = false;
let lastPerle = null;        // dernière demande de perle suivie { n, status }
let perleTimer = null;
let expireTimer = null;
let tickTimer = null;

const CONNECTION_KEY = 'message-en-avant-dock-connection';
const TRASH = '<svg viewBox="0 0 27 31" aria-hidden="true"><path d="M7.21 30.85H19.77C21.86 30.85 23.22 29.58 23.31 27.48L24.24 7.77H25.75C26.43 7.77 26.96 7.26 26.96 6.57C26.96 5.9 26.43 5.38 25.75 5.38H19.66V3.33C19.66 1.24 18.34 0 16.07 0H10.87C8.62 0 7.28 1.24 7.28 3.33V5.38H1.2C0.55 5.38 0 5.9 0 6.57C0 7.26 0.55 7.77 1.2 7.77H2.72L3.65 27.49C3.75 29.6 5.09 30.85 7.21 30.85ZM9.79 3.45C9.79 2.74 10.28 2.29 11.05 2.29H15.89C16.65 2.29 17.15 2.74 17.15 3.45V5.38H9.79V3.45ZM7.47 28.43C6.71 28.43 6.17 27.89 6.13 27.08L5.2 7.77H21.71L20.82 27.08C20.8 27.89 20.25 28.43 19.47 28.43H7.47ZM9.45 26.23C10.02 26.23 10.39 25.86 10.38 25.33L9.97 11C9.95 10.45 9.57 10.1 9.03 10.1C8.45 10.1 8.08 10.47 8.1 11L8.51 25.33C8.52 25.88 8.9 26.23 9.45 26.23ZM13.48 26.23C14.06 26.23 14.44 25.86 14.44 25.33V11C14.44 10.47 14.06 10.1 13.48 10.1C12.91 10.1 12.53 10.47 12.53 11V25.33C12.53 25.86 12.91 26.23 13.48 26.23ZM17.52 26.23C18.06 26.23 18.43 25.88 18.45 25.33L18.87 11C18.88 10.47 18.5 10.1 17.94 10.1C17.39 10.1 17.01 10.45 17 11L16.57 25.33C16.56 25.86 16.94 26.23 17.52 26.23Z"/></svg>';

function DefaultState() {
	return {
		version: 1, updated: 0, current: null, qa: [], highlights: [], queue: [], resume: null, perle: { n: 0 },
		config: { qa: true, rewardName: 'Q&A', highlight: true, command: '!highlight', highlightDuration: 15, conflict: 'return', queue: 'queue', perles: false, perleCommand: '!perle', hideCommand: '!hide', perleWho: 'all', perleCooldown: 30 }
	};
}

///////////////
// OUTILS UI //
///////////////

function Toast(text) {
	const t = $('toast');
	t.textContent = text;
	t.classList.add('show');
	clearTimeout(Toast.t);
	Toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

// Bouton à double clic de confirmation (sans boîte de dialogue, qui bloque les docks OBS)
function WithConfirmation(button, confirmHTML, action) {
	button.addEventListener('click', (e) => {
		e.stopPropagation();
		if (button.classList.contains('confirming')) {
			button.classList.remove('confirming');
			button.innerHTML = button.dataset.original;
			action();
			return;
		}
		button.dataset.original = button.innerHTML;
		button.classList.add('confirming');
		button.innerHTML = confirmHTML;
		setTimeout(() => {
			if (!button.classList.contains('confirming')) return;
			button.classList.remove('confirming');
			button.innerHTML = button.dataset.original;
		}, 3000);
	});
}

function Clock(ms) {
	const d = new Date(Number(ms) || Date.now());
	return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function Avatar(item) {
	const el = document.createElement('span');
	el.className = 'avatar';
	el.style.background = MeaInitialColor(item.name);
	if (item.avatar && /^https:\/\//.test(item.avatar)) {
		const img = document.createElement('img');
		img.alt = '';
		img.src = item.avatar;
		img.onerror = () => { img.remove(); el.textContent = MeaInitial(item.name); };
		el.appendChild(img);
	} else {
		el.textContent = MeaInitial(item.name);
		if (item.login) MeaAvatar(item.login).then(url => {
			if (!url) return;
			const img = document.createElement('img');
			img.alt = '';
			img.onload = () => { el.textContent = ''; el.appendChild(img); };
			img.src = url;
		});
	}
	return el;
}

// Ligne de message (liste et carte « À l'écran »)
function MessageEl(item, opts = {}) {
	const row = document.createElement('div');
	row.className = 'msg';
	row.dataset.id = item.id;
	row.appendChild(Avatar(item));

	const info = document.createElement('div');
	info.className = 'info';
	const top = document.createElement('div');
	top.className = 'top';
	const badges = document.createElement('span');
	badges.className = 'badges';
	(item.badges || []).slice(0, 3).forEach(u => {
		const b = document.createElement('img');
		b.alt = '';
		b.src = u;
		b.onerror = () => b.remove();
		badges.appendChild(b);
	});
	const who = document.createElement('span');
	who.className = 'who';
	who.textContent = item.name || item.login;
	if (item.color) who.style.color = item.color;
	top.append(badges, who);
	if (opts.tag) {
		const tag = document.createElement('span');
		tag.className = 'tag';
		tag.textContent = opts.tag;
		top.appendChild(tag);
	}
	const meta = document.createElement('span');
	meta.className = 'meta';
	meta.textContent = Clock(item.at);
	top.appendChild(meta);

	const text = document.createElement('div');
	text.className = 'text';
	text.innerHTML = MeaPartsHTML(item);
	text.querySelectorAll('img').forEach(img => { img.onerror = () => img.replaceWith(document.createTextNode(img.alt)); });
	info.append(top, text);
	if (item.kind === 'highlight' && item.by) {
		const by = document.createElement('span');
		by.className = 'by';
		by.textContent = `Mis en avant par ${item.by}`;
		info.appendChild(by);
	}
	row.appendChild(info);
	return row;
}

////////////
// RENDU  //
////////////

function Render() {
	const ready = demo || (connected && actionFound);
	$('status').classList.toggle('on', demo || connected);
	$('panelDisconnected').hidden = demo || connected;
	$('sbTarget').textContent = `${ws.values.address}:${ws.values.port}`;
	$('panelMissingAction').hidden = demo || !connected || actionFound;
	$('missingActionName').textContent = ws.values.actionName;
	$('main').classList.toggle('disabled', !ready);
	if (!state) state = DefaultState();

	RenderNow();
	RenderList();
}

// Liste de l'onglet affiché : questions de la plus ancienne à la plus récente (ordre de réponse),
// highlights du plus récent au plus ancien
function TabList() {
	return tab === 'qa' ? state.qa.slice().reverse() : state.highlights;
}

// Message affiché dans la carte : la sélection, sinon le message à l'écran
function FocusItem() {
	return MeaFind(state, selectedId) || state.current;
}

function KindLabel(item) { return item.kind === 'qa' ? 'Question' : 'Highlight'; }

function RenderNow() {
	const cur = state.current;
	const focus = FocusItem();
	const onScreen = !!(cur && focus && cur.id === focus.id);
	const box = $('nowItem');
	box.innerHTML = '';
	box.classList.toggle('on', onScreen);
	box.classList.toggle('selection', !!focus && !onScreen);
	if (focus) box.appendChild(MessageEl(onScreen ? cur : focus, { tag: KindLabel(focus) }));
	else {
		const empty = document.createElement('div');
		empty.className = 'empty';
		empty.textContent = 'Rien à l’écran';
		box.appendChild(empty);
	}
	$('nowCaption').textContent = focus && !onScreen ? 'Sélection' : 'À l’écran';
	$('nowCaption').classList.toggle('live', onScreen);
	$('nowTime').textContent = onScreen && cur.shownAt ? `depuis ${Clock(cur.shownAt)}` : '';
	$('nowOther').textContent = focus && !onScreen ? (cur ? `À l’écran : ${cur.name} (${KindLabel(cur).toLowerCase()})` : 'Rien à l’écran') : '';

	// File d'attente et retour à la question
	const hints = [];
	if (state.queue.length) hints.push(state.queue.length === 1 ? '1 highlight en attente' : `${state.queue.length} highlights en attente`);
	const resume = state.resume ? MeaFind(state, state.resume) : null;
	if (resume) hints.push(`Ensuite : retour à la question de ${resume.name}`);
	$('nowHint').textContent = hints.join(' · ');

	// Œil : afficher le message de la carte, ou le masquer s'il est déjà à l'écran
	const eye = $('eyeButton');
	eye.disabled = !focus;
	eye.classList.toggle('on', onScreen);
	SetIcon(eye, onScreen ? 'eye' : 'eye.slash');
	const eyeTitle = onScreen ? 'Masquer de l’overlay' : (focus && focus.shown ? 'Afficher à nouveau sur l’overlay' : 'Afficher sur l’overlay');
	eye.title = eyeTitle;
	eye.setAttribute('aria-label', eyeTitle);

	// Chevrons : message précédent ou suivant de l'onglet
	const list = TabList();
	const idx = focus ? list.findIndex(x => x.id === focus.id) : -1;
	$('prevButton').disabled = idx <= 0;
	$('nextButton').disabled = !list.length || idx >= list.length - 1;

	// Perle
	const perlesOn = !!state.config.perles || demo;
	$('perleButton').disabled = !focus || !perlesOn || PerleBusy();
	$('perleOff').hidden = perlesOn;

	UpdateTimer();
	ScheduleExpire();
}

function SetIcon(button, name) {
	if (button.dataset.drawn === name) return;
	button.dataset.drawn = name;
	button.innerHTML = window.UIIcon ? UIIcon(name) : '';
}

function Step(delta) {
	const list = TabList();
	if (!list.length) return;
	const focus = FocusItem();
	const idx = focus ? list.findIndex(x => x.id === focus.id) : -1;
	const next = idx < 0 ? (delta > 0 ? 0 : -1) : idx + delta;
	if (next < 0 || next >= list.length) return;
	selectedId = list[next].id;
	// Un message est à l'écran : le suivant le remplace directement (sortie puis entrée sur l'overlay)
	if (state.current) Send('show', { manual: 'true', id: selectedId });
	else Render();
	const row = document.querySelector(`#list .msg[data-id="${CSS.escape(selectedId)}"]`);
	if (row) row.scrollIntoView({ block: 'nearest' });
}

function PerleBusy() {
	const p = state.perle || {};
	return (p.status === 'pending' || p.status === 'claimed') && Date.now() - Number(p.at || 0) < 15000;
}

// Barre de temps restant d'un highlight
function UpdateTimer() {
	clearInterval(tickTimer);
	const cur = state.current;
	const on = !!(cur && cur.until && cur.shownAt);
	$('nowTimer').hidden = !on;
	if (!on) return;
	const tick = () => {
		const total = Math.max(1, Number(cur.until) - Number(cur.shownAt));
		const left = Math.max(0, Number(cur.until) - Date.now());
		$('nowTimerBar').style.transform = `scaleX(${left / total})`;
		if (left <= 0) clearInterval(tickTimer);
	};
	tick();
	tickTimer = setInterval(tick, 250);
}

// Filet de sécurité : si aucun overlay ne masque le highlight à la fin de sa durée
function ScheduleExpire() {
	clearTimeout(expireTimer);
	const cur = state.current;
	if (!cur || !cur.until) return;
	expireTimer = setTimeout(() => {
		if (state.current && state.current.id === cur.id) Send('expire', { id: cur.id });
	}, Math.max(0, Number(cur.until) - Date.now()) + 2500);
}

function RenderList() {
	const list = TabList();
	tabs.setCount('qa', state.qa.filter(x => !x.shown).length || '');
	tabs.setCount('highlights', state.highlights.length || '');

	const box = $('list');
	box.innerHTML = '';
	const cur = state.current;
	list.forEach(item => {
		const isCurrent = !!(cur && cur.id === item.id);
		const row = MessageEl(item, { tag: isCurrent ? 'À l’écran' : '' });
		row.classList.toggle('shown', !!item.shown && !isCurrent);
		row.classList.toggle('current', isCurrent);
		row.classList.toggle('selected', item.id === selectedId);
		// Un clic affiche le message (s'il n'est pas déjà à l'écran)
		row.addEventListener('click', () => {
			selectedId = item.id;
			if (isCurrent) { Render(); return; }
			Send('show', { manual: 'true', id: item.id });
		});

		const actions = document.createElement('span');
		actions.className = 'row-actions';
		if (tab === 'highlights' && (state.config.perles || demo)) {
			const d = document.createElement('button');
			d.type = 'button';
			d.className = 'ui-icon row-icon discord';
			d.title = 'Perler sur Discord';
			d.innerHTML = '<img src="../../-common/resources/icons/platforms/discord.png" alt="">';
			d.addEventListener('click', (e) => { e.stopPropagation(); RequestPerle(item.id); });
			actions.appendChild(d);
		}
		const del = document.createElement('button');
		del.type = 'button';
		del.className = 'ui-icon row-icon trash';
		del.title = 'Supprimer';
		del.innerHTML = TRASH;
		WithConfirmation(del, TRASH, () => { if (selectedId === item.id) selectedId = null; Send('remove', { id: item.id }); });
		actions.appendChild(del);
		row.appendChild(actions);
		box.appendChild(row);
	});

	const enabled = tab === 'qa' ? state.config.qa : state.config.highlight;
	let empty = '';
	if (!list.length) {
		if (!enabled) empty = tab === 'qa' ? 'Le mode Q&A est désactivé sur la page de paramétrage.' : 'Le mode Highlight est désactivé sur la page de paramétrage.';
		else if (tab === 'qa') empty = `Les questions posées avec la récompense « ${state.config.rewardName || 'Q&A'} » apparaissent ici.`;
		else empty = `Les messages mis en avant avec ${state.config.command || '!highlight'} (en réponse à un message) apparaissent ici.`;
	}
	$('emptyList').textContent = empty;
	$('emptyList').hidden = !empty;
	$('clearButton').hidden = !list.length;
}

/////////////
// ACTIONS //
/////////////

async function Send(mode, extra = {}) {
	const args = { mode, ...extra };
	if (demo) { LocalApply(args); return; }
	if (!sbClient || !connected) { Toast('Streamer.bot n’est pas connecté'); return; }
	try {
		const response = await sbClient.doAction({ name: ws.values.actionName }, args);
		if (response && response.status && response.status !== 'ok')
			Toast('Erreur Streamer.bot : ' + (response.error || response.status));
	} catch (e) {
		console.error(e);
		Toast('Impossible de lancer l’action');
	}
	setTimeout(RefreshData, 700); // filet de sécurité si l'événement n'arrive pas
}

function RequestPerle(id) {
	if (!id) return;
	if (PerleBusy()) { Toast('Une perle est déjà en cours d’envoi'); return; }
	Send('perle', { id });
}

// Suivi de la demande de perle (réponse de l'overlay)
function TrackPerle() {
	const p = state.perle || {};
	const n = Number(p.n) || 0;
	if (lastPerle === null) { lastPerle = { n, status: p.status }; return; }
	if (n === lastPerle.n && p.status === lastPerle.status) return;
	lastPerle = { n, status: p.status };
	clearTimeout(perleTimer);
	if (p.status === 'pending' || p.status === 'claimed') {
		Toast('Envoi sur Discord…');
		perleTimer = setTimeout(() => {
			const q = state.perle || {};
			if (Number(q.n) === n && (q.status === 'pending' || q.status === 'claimed'))
				Toast('Aucun overlay n’a répondu : vérifiez que la source est active dans OBS et que le webhook est renseigné');
			Render();
		}, 15000);
	} else if (p.status === 'ok') Toast('Perle envoyée sur Discord');
	else if (p.status === 'error') Toast('Échec de la perle : ' + (p.error || 'erreur inconnue'));
}

// Démo : mêmes règles que l'action, en local
function LocalApply(a) {
	const find = (id) => MeaFind(state, id);
	const manual = a.manual === 'true';
	const show = (item) => {
		const copy = Object.assign({}, item, { shownAt: Date.now() });
		if (copy.kind === 'highlight' && !manual) copy.until = Date.now() + 15000; else delete copy.until;
		item.shown = true;
		state.current = copy;
	};
	const next = () => {
		while (state.queue.length) { const it = find(state.queue.shift()); if (it) { show(it); return; } }
		const r = state.resume ? find(state.resume) : null;
		state.resume = null;
		if (r) show(r); else state.current = null;
	};
	switch (a.mode) {
		case 'show': { const it = find(a.id); if (it) { state.resume = null; state.queue = state.queue.filter(x => x !== a.id); show(it); } break; }
		case 'hide': state.resume = null; next(); break;
		case 'expire': if (state.current && state.current.id === a.id) next(); break;
		case 'remove':
			state.qa = state.qa.filter(x => x.id !== a.id);
			state.highlights = state.highlights.filter(x => x.id !== a.id);
			state.queue = state.queue.filter(x => x !== a.id);
			if (state.current && state.current.id === a.id) next();
			break;
		case 'clear': if (a.list === 'highlights') state.highlights = []; else state.qa = []; break;
		case 'perle':
			state.perle = { n: (Number(state.perle.n) || 0) + 1, id: a.id, status: 'pending', at: Date.now() };
			TrackPerle();
			setTimeout(() => { state.perle.status = 'ok'; TrackPerle(); Render(); }, 1200);
			break;
	}
	state.updated = Date.now();
	Render();
}

function DemoState() {
	const s = DefaultState();
	s.config.perles = true;
	const items = MeaDemoItems();
	const now = Date.now();
	const qa = [
		Object.assign({}, items.question, { id: 'qa:1', at: now - 60000 }),
		Object.assign({}, items.long, { id: 'qa:2', at: now - 240000, shown: true }),
		{ id: 'qa:3', kind: 'qa', name: 'Nougatine', login: 'nougatine', color: '#64D2FF', badges: [], avatar: '', parts: [{ t: 'text', v: 'Quel est ton setup micro ?' }], at: now - 420000 }
	];
	const highlights = [Object.assign({}, items.highlight, { id: 'hl:1', at: now - 30000, shown: true })];
	s.qa = qa;
	s.highlights = highlights;
	s.current = Object.assign({}, qa[1], { shownAt: now - 90000 });
	return s;
}

//////////////////
// STREAMER.BOT //
//////////////////

function SetState(raw) {
	const parsed = ParseMea(raw);
	if (!parsed) return;
	if (state && Number(parsed.updated) < Number(state.updated)) return;
	state = parsed;
	if (selectedId && !MeaFind(state, selectedId)) selectedId = null;
	TrackPerle();
	Render();
}

async function RefreshData() {
	if (!sbClient || !connected) return;
	try {
		const response = await sbClient.getGlobal(MEA_VARIABLE, true);
		if (response && response.status === 'ok' && response.variable && response.variable.value) { SetState(response.variable.value); return; }
	} catch (e) {
		// Variable absente : Streamer.bot répond par une erreur
	}
	if (!state) { state = DefaultState(); Render(); }
	if (actionFound && !createSent) { createSent = true; Send('config', { config: '{}' }); }
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
	if (actionFound) RefreshData();
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
			try { localStorage.setItem(CONNECTION_KEY, JSON.stringify({ address: host, port })); } catch (e) { }
			CheckAction();
		},
		onDisconnect: () => { connected = false; Render(); }
	});

	sbClient.on('General.Custom', ({ data: ev }) => {
		if (ev && ev.source === MEA_SOURCE) SetState(ev.data);
	});
	sbClient.on('Application.ActionAdded', CheckAction);
	sbClient.on('Application.ActionUpdated', CheckAction);
	sbClient.on('Application.ActionDeleted', CheckAction);

	// Le dock transmet aussi les événements Twitch (l'action ignore les doublons de l'overlay),
	// avec les réglages publiés par l'overlay
	MeaCollector.start({
		sbClient,
		getConfig: () => (actionFound && state ? state.config : null),
		send: (args) => sbClient.doAction({ name: ws.values.actionName }, args).catch(() => { })
	});
}

/////////////////////
// INTERACTIONS UI //
/////////////////////

function Bind() {
	tabs = Segmented.create($('tabs'), {
		options: [{ value: 'qa', label: 'Questions' }, { value: 'highlights', label: 'Highlights' }],
		value: tab,
		onChange: (v) => { tab = v; selectedId = null; Render(); }
	});

	document.querySelectorAll('button.round[data-icon]').forEach(b => SetIcon(b, b.dataset.icon));
	$('prevButton').addEventListener('click', () => Step(-1));
	$('nextButton').addEventListener('click', () => Step(1));
	$('eyeButton').addEventListener('click', () => {
		const focus = FocusItem();
		if (!focus) return;
		if (state.current && state.current.id === focus.id) Send('hide');
		else Send('show', { manual: 'true', id: focus.id });
	});
	$('perleButton').addEventListener('click', () => { const f = FocusItem(); if (f) RequestPerle(f.id); });
	// « Effacer » : vide la liste de l'onglet (deux clics)
	$('clearButton').addEventListener('click', () => {
		const btn = $('clearButton');
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
		selectedId = null;
		Send('clear', { list: tab });
	});
	$('recheckButton').addEventListener('click', CheckAction);
}

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('dock.json', () => { ConnectStreamerBot(); Render(); });
	} catch (e) {
		console.error('[Message en avant] Réglages du dock illisibles :', e);
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

	demo = ws.demo;
	Bind();
	if (demo) { state = DemoState(); lastPerle = { n: 0 }; Render(); return; }
	state = DefaultState();
	Render();
	ConnectStreamerBot();
})();
