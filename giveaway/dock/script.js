// Giveaway : dock de contrôle (à ajouter dans OBS : Docks → Docks de navigateur personnalisés)
// Toutes les modifications passent par l'action Streamer.bot « Giveaway | Gérer » : le dock,
// l'overlay et le chat partagent donc toujours le même état.

const $ = (id) => document.getElementById(id);

let ws = null;
let sbClient = null, sbHost = null, sbPort = null;
let connected = false;
let actionFound = false;
let state = null;            // contenu de la variable Streamer.bot
let photoURL = '';
let photoVersion = null;
let demo = false;            // ?demo=true : fonctionnement local, sans Streamer.bot
let countdownTimer = null;
let createSent = false;      // création de la variable déjà demandée

const CONNECTION_KEY = 'giveaway-dock-connection';
const TRASH = '<svg viewBox="0 0 27 31" aria-hidden="true"><path d="M7.21 30.85H19.77C21.86 30.85 23.22 29.58 23.31 27.48L24.24 7.77H25.75C26.43 7.77 26.96 7.26 26.96 6.57C26.96 5.9 26.43 5.38 25.75 5.38H19.66V3.33C19.66 1.24 18.34 0 16.07 0H10.87C8.62 0 7.28 1.24 7.28 3.33V5.38H1.2C0.55 5.38 0 5.9 0 6.57C0 7.26 0.55 7.77 1.2 7.77H2.72L3.65 27.49C3.75 29.6 5.09 30.85 7.21 30.85ZM9.79 3.45C9.79 2.74 10.28 2.29 11.05 2.29H15.89C16.65 2.29 17.15 2.74 17.15 3.45V5.38H9.79V3.45ZM7.47 28.43C6.71 28.43 6.17 27.89 6.13 27.08L5.2 7.77H21.71L20.82 27.08C20.8 27.89 20.25 28.43 19.47 28.43H7.47ZM9.45 26.23C10.02 26.23 10.39 25.86 10.38 25.33L9.97 11C9.95 10.45 9.57 10.1 9.03 10.1C8.45 10.1 8.08 10.47 8.1 11L8.51 25.33C8.52 25.88 8.9 26.23 9.45 26.23ZM13.48 26.23C14.06 26.23 14.44 25.86 14.44 25.33V11C14.44 10.47 14.06 10.1 13.48 10.1C12.91 10.1 12.53 10.47 12.53 11V25.33C12.53 25.86 12.91 26.23 13.48 26.23ZM17.52 26.23C18.06 26.23 18.43 25.88 18.45 25.33L18.87 11C18.88 10.47 18.5 10.1 17.94 10.1C17.39 10.1 17.01 10.45 17 11L16.57 25.33C16.56 25.86 16.94 26.23 17.52 26.23Z"/></svg>';

const PHASES = {
	setup: ['Fermé', ''],
	open: ['Inscriptions ouvertes', 'green'],
	closed: ['Inscriptions closes', 'blue'],
	pending: ['Gagnant·e tiré · en attente', 'blue'],
	confirmed: ['Gagnant·e confirmé', 'green'],
	finished: ['Tous les lots gagnés', 'green'],
	ended: ['Giveaway terminé', '']
};

// État affiché tant que la variable Streamer.bot n'existe pas encore (créée au premier envoi)
function DefaultState() {
	return {
		version: 1, status: 'setup', drawId: 0, won: 0, photoV: 0, hasPhoto: false, history: [], participants: {}, draw: null,
		config: {
			lot: '', lots: 1, perDraw: 1, word: '', match: 'contains', maxEntries: 1, subLuck: 1, followMin: 0,
			followUnit: 'days', platforms: GIVEAWAY_PLATFORMS.slice(), kickChannel: '', confirmSeconds: 60, excluded: '',
			msgOpen: 'GIVEAWAY ouvert ! Écrivez « {mot} » dans le chat pour participer. Lot : {lot}',
			msgDraw: '{pseudo} tu as été tiré·e au sort ! Écris un message dans le chat dans les {secondes} secondes pour confirmer que tu veux le lot.',
			msgConfirm: 'Félicitations {pseudo} qui remporte {lot} ! Un modo te contacte très vite.'
		}
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
	Toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}

// Bouton à double clic de confirmation (sans boîte de dialogue, qui bloque les docks OBS)
function WithConfirmation(button, confirmHTML, action) {
	const original = button.innerHTML;
	button.addEventListener('click', () => {
		if (button.classList.contains('confirming')) {
			button.classList.remove('confirming');
			button.innerHTML = original;
			action();
			return;
		}
		button.classList.add('confirming');
		button.innerHTML = confirmHTML;
		setTimeout(() => { button.classList.remove('confirming'); button.innerHTML = original; }, 3000);
	});
}

function Avatar(p, big) {
	const el = document.createElement('span');
	el.className = 'avatar' + (big ? ' big' : '');
	el.textContent = String(p.name || '?').trim().charAt(0).toUpperCase();
	const set = (url) => {
		if (!url) return;
		el.textContent = '';
		const img = document.createElement('img');
		img.className = 'photo';
		img.alt = '';
		img.src = url;
		img.onerror = () => img.remove();
		el.prepend(img);
		AddPlatform();
	};
	function AddPlatform() {
		if (el.querySelector('img.platform')) return;
		const icon = document.createElement('img');
		icon.className = 'platform';
		icon.alt = GIVEAWAY_PLATFORM_NAMES[p.platform] || '';
		icon.src = `../icons/${p.platform}.png`;
		el.appendChild(icon);
	}
	AddPlatform();
	if (p.avatar) set(p.avatar);
	else if (big || p.platform === 'twitch' || p.platform === 'kick') GiveawayAvatar(p).then(set);
	return el;
}

function Clock(ms) {
	const d = new Date(Number(ms) || Date.now());
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ChatLine(el, who, sub, text, time) {
	el.innerHTML = '';
	const t = document.createElement('span'); t.className = 'time'; t.textContent = Clock(time);
	el.appendChild(t);
	if (sub) { const b = document.createElement('span'); b.className = 'badge sub'; b.title = 'Abonné·e'; el.appendChild(b); }
	const w = document.createElement('span'); w.className = 'who'; w.textContent = who + ' :';
	el.append(w, document.createTextNode(' ' + (text || '')));
}

////////////
// RENDU  //
////////////

function Render() {
	const s = ws.values;
	const live = demo || (connected && actionFound);

	$('status').className = 'status ' + (demo || connected ? 'on' : 'off');
	$('status').title = demo ? 'Démo (sans Streamer.bot)' : (connected ? 'Connecté à Streamer.bot' : 'Déconnecté de Streamer.bot');
	$('panelDisconnected').hidden = demo || connected;
	$('sbTarget').textContent = `${s.address}:${s.port}`;
	$('panelMissingAction').hidden = demo || !connected || actionFound;
	$('missingActionName').textContent = s.actionName;
	$('main').classList.toggle('disabled', !live || !state);
	if (!state) return;

	const cfg = state.config;
	const [phaseText, phaseColor] = PHASES[state.status] || PHASES.setup;
	$('phase').textContent = phaseText;
	$('phase').className = 'phase ' + phaseColor;

	RenderConfig(cfg);
	RenderDraw(cfg);
	RenderParticipants();
	RenderHistory();
}

// Réglages : on ne réécrit pas un champ en cours de saisie
function RenderConfig(cfg) {
	document.querySelectorAll('[data-key]').forEach(el => {
		if (document.activeElement === el) return;
		const v = cfg[el.dataset.key];
		el.value = v === undefined || v === null ? '' : String(v);
	});
	const locked = state.status !== 'setup';
	$('cfgWord').disabled = locked;
	$('cfgMatch').disabled = locked;

	// Plateformes
	const box = $('platformToggles');
	if (!box.children.length) {
		GIVEAWAY_PLATFORMS.forEach(p => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'platform-toggle';
			b.dataset.platform = p;
			b.title = GIVEAWAY_PLATFORM_NAMES[p];
			b.innerHTML = `<img src="../icons/${p}.png" alt="${GIVEAWAY_PLATFORM_NAMES[p]}">`;
			b.addEventListener('click', () => {
				const list = new Set(state.config.platforms);
				if (list.has(p)) list.delete(p); else list.add(p);
				if (!list.size) { Toast('Gardez au moins une plateforme'); return; }
				SendConfig({ platforms: GIVEAWAY_PLATFORMS.filter(x => list.has(x)) });
			});
			box.appendChild(b);
		});
	}
	box.querySelectorAll('.platform-toggle').forEach(b => {
		const on = cfg.platforms.includes(b.dataset.platform);
		b.classList.toggle('off', !on);
		b.setAttribute('aria-pressed', on ? 'true' : 'false');
		b.title = `${GIVEAWAY_PLATFORM_NAMES[b.dataset.platform]} : ${on ? 'éligible' : 'non éligible'}`;
	});
	$('kickLine').hidden = !cfg.platforms.includes('kick');

	// Photo
	const url = state.hasPhoto ? (demo ? (photoURL || GiveawayDemoPhoto()) : photoURL) : '';
	$('photoThumb').hidden = !url;
	if (url && $('photoThumb').getAttribute('src') !== url) $('photoThumb').src = url;
	$('photoRemove').hidden = !url;
	$('photoChoose').textContent = url ? 'Changer' : 'Choisir une image';

	// Ajout manuel : seulement une fois les inscriptions ouvertes
	$('addRow').hidden = state.status === 'setup';
	const sel = $('addPlatform');
	if (sel.options.length !== cfg.platforms.length || Array.from(sel.options).some((o, i) => o.value !== cfg.platforms[i])) {
		sel.innerHTML = cfg.platforms.map(p => `<option value="${p}">${GIVEAWAY_PLATFORM_NAMES[p]}</option>`).join('');
	}
}

function RenderDraw(cfg) {
	const won = Number(state.won) || 0;
	const lots = Number(cfg.lots) || 1;
	const left = Math.max(0, lots - won);
	const pool = GiveawayPool(state);
	$('wonCount').textContent = won;
	$('lotsCount').textContent = lots;
	$('lotsLeft').textContent = left ? `${left} restant${left > 1 ? 's' : ''}` : 'Tous les lots ont été gagnés';
	$('progressBar').style.transform = `scaleX(${Math.min(1, won / lots)})`;

	// Gagnant·es du tirage en cours
	const draw = state.draw && ['pending', 'confirmed', 'finished'].includes(state.status) ? state.draw : null;
	$('winnerBlock').hidden = !draw;
	if (draw) RenderWinner(draw, pool.length);

	// Boutons
	const st = state.status;
	const reg = $('registrationButton');
	const primary = $('primaryButton');
	const perDraw = Math.max(1, Math.min(Number(cfg.perDraw) || 1, left, pool.length || 1));
	const many = perDraw > 1 ? ` · ${perDraw} gagnant·es` : '';
	let hint = '';

	// Inscriptions : Ouvrir → Fermer → Inscriptions closes
	reg.disabled = false;
	reg.classList.toggle('accent', st === 'setup' || st === 'ended');
	if (st === 'setup' || st === 'ended') {
		reg.textContent = 'Ouvrir les inscriptions';
		if (!String(cfg.word || '').trim()) { reg.disabled = true; hint = 'Choisissez le mot à écrire dans le chat pour ouvrir les inscriptions.'; }
		else if (st === 'ended') hint = 'Rouvrir les inscriptions lance un nouveau giveaway : la liste des participant·es repart de zéro.';
	} else if (st === 'open') {
		reg.textContent = 'Fermer les inscriptions';
	} else {
		reg.textContent = 'Inscriptions closes';
		reg.disabled = true;
	}

	// Fermer le giveaway : l'overlay disparaît
	$('endButton').disabled = st === 'setup' || st === 'ended';

	// Tirage. Plusieurs gagnant·es : tirés l'un après l'autre avec « Suivant »
	const size = draw ? (Number(draw.size) || draw.winners.length) : 0;
	const roundOpen = st === 'pending' && draw && draw.winners.length < size;
	primary.hidden = !(['open', 'closed', 'confirmed', 'finished'].includes(st) || roundOpen);
	primary.disabled = false;
	primary.dataset.mode = 'draw';
	const firstMany = Math.max(1, Math.min(Number(cfg.perDraw) || 1, left, pool.length || 1));
	const ofMany = firstMany > 1 ? ` (1/${firstMany})` : '';
	if (st === 'open' || st === 'closed') {
		primary.textContent = 'Tirer au sort' + ofMany;
		if (!pool.length) { primary.disabled = true; hint = 'Personne n’est encore en lice.'; }
		else if (st === 'open') hint = 'Le tirage ferme d’abord les inscriptions.';
	} else if (roundOpen) {
		primary.dataset.mode = 'next';
		primary.textContent = `Suivant (${draw.winners.length + 1}/${size})`;
		if (!pool.length) { primary.textContent = 'Terminer ce tirage'; hint = 'Plus personne n’est en lice.'; }
	} else if (st === 'confirmed') {
		primary.textContent = 'Tirer le lot suivant' + ofMany;
		if (!pool.length) { primary.disabled = true; hint = 'Plus personne n’est en lice.'; }
	} else if (st === 'finished') {
		primary.textContent = 'Tous les lots ont été gagnés';
		primary.disabled = true;
		hint = 'Fermez le giveaway pour faire disparaître l’overlay.';
	}
	if (state.lastError && ['closed', 'confirmed'].includes(st)) hint = state.lastError;
	$('drawHint').textContent = hint;

	// Pas de réponse : remplace les personnes dont le délai est écoulé
	const waiting = draw && st === 'pending' ? draw.winners.filter(w => !w.confirmed) : [];
	const late = waiting.filter(w => Date.now() > Deadline(w, draw));
	$('noshowButton').hidden = !waiting.length;
	$('noshowButton').textContent = 'Pas de réponse : tirer un autre gagnant·e';

	clearInterval(countdownTimer);
	$('countdown').hidden = true;
	if (state.status === 'pending') {
		countdownTimer = setInterval(UpdateCountdown, 250);
		UpdateCountdown();
	}
}

const Deadline = (w, draw) => Number(w.deadline || (draw && draw.deadline) || 0);

function Remaining(ms) {
	const sec = Math.ceil(ms / 1000);
	return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

// Le ou la dernier·e tiré·e en grand, les précédent·es en dessous
function RenderWinner(draw, poolCount) {
	const winners = draw.winners;
	const first = winners[winners.length - 1];
	const others = winners.slice(0, -1).reverse();
	const main = $('winnerMain');
	main.innerHTML = '';
	const row = document.createElement('div');
	row.className = 'winner-main';
	row.appendChild(Avatar(first, true));
	const info = document.createElement('div');
	info.style.minWidth = '0';
	const name = document.createElement('div');
	name.className = 'winner-name';
	name.textContent = first.name;
	const sub = document.createElement('div');
	sub.className = 'winner-sub';
	const size = Number(draw.size) || winners.length;
	const parts = [GIVEAWAY_PLATFORM_NAMES[first.platform], first.sub ? 'abonné·e' : 'non abonné·e', `${poolCount} encore en lice`];
	if (size > 1) parts.unshift(`${winners.length}/${size}`);
	sub.textContent = parts.join(' · ');
	if (first.confirmed) { const ok = document.createElement('span'); ok.className = 'ok'; ok.textContent = ' · confirmé'; sub.appendChild(ok); }
	info.append(name, sub);
	row.appendChild(info);
	main.appendChild(row);

	$('alsoDrawn').hidden = !others.length;
	const list = $('alsoList');
	list.innerHTML = '';
	others.forEach(w => {
		const it = document.createElement('div');
		it.className = 'also-item';
		it.appendChild(Avatar(w));
		const n = document.createElement('span'); n.textContent = w.name;
		const st = document.createElement('span');
		st.className = 'state' + (w.confirmed ? ' ok' : '');
		st.dataset.key = w.key;
		st.textContent = w.confirmed ? 'confirmé' : 'en attente';
		it.append(n, st);
		list.appendChild(it);
	});

	const msg = first.msg || {};
	$('winMessage').hidden = !msg.text;
	if (msg.text) ChatLine($('winMessageLine'), first.name, first.sub, msg.text, msg.time);

	$('confirmMessage').hidden = !first.confirmed;
	if (first.confirmed) ChatLine($('confirmMessageLine'), first.name, first.sub, first.confirmText, first.confirmTime);
}

// Comptes à rebours : celui du dernier·e tiré·e en grand, ceux des autres dans la liste
function UpdateCountdown() {
	const draw = state && state.draw;
	if (!draw || state.status !== 'pending' || !draw.winners.length) { $('countdown').hidden = true; return; }
	const now = Date.now();
	const first = draw.winners[draw.winners.length - 1];
	const deadline = Deadline(first, draw);
	const total = Math.max(1, deadline - (Number(first.at) || Number(draw.at) || deadline - 60000));
	const left = Math.max(0, deadline - now);
	$('countdown').hidden = !!first.confirmed;
	$('countdown').classList.toggle('late', left <= 0);
	$('countdownText').textContent = left > 0 ? Remaining(left) : 'Temps écoulé';
	$('countdownBar').style.transform = `scaleX(${left / total})`;
	document.querySelectorAll('#alsoList .state').forEach(el => {
		const w = draw.winners.find(x => x.key === el.dataset.key);
		if (!w) return;
		const l = Deadline(w, draw) - now;
		el.textContent = w.confirmed ? 'confirmé' : (l > 0 ? `en attente · ${Remaining(l)}` : 'temps écoulé');
		el.classList.toggle('late', !w.confirmed && l <= 0);
	});
}

function RenderParticipants() {
	// Exclu·es d'office : ni affiché·es, ni compté·es
	const all = Object.entries(state.participants).map(([key, p]) => ({ key, ...p })).filter(p => !GiveawayIsBanned(state, p));
	const pool = GiveawayPool(state);
	const chances = new Map(pool.map(p => [p.key, p.chance]));
	const luck = Number(state.config.subLuck) || 1;
	const max = Number(state.config.maxEntries) || 1;
	const excluded = all.filter(p => p.excluded).length;
	const subs = all.filter(p => p.sub && !p.excluded && !p.drawn).length;
	$('summary').textContent = all.length
		? `${pool.length} en lice · ${subs} abonné·e${subs > 1 ? 's' : ''} · ${excluded} exclu${excluded > 1 ? 's' : ''}`
		: '';

	const current = new Set(state.draw && state.status === 'pending' ? state.draw.winners.filter(w => !w.confirmed).map(w => w.key) : []);
	const q = $('search').value.trim().toLowerCase();
	const list = all
		.filter(p => !q || String(p.name).toLowerCase().includes(q) || String(p.login).toLowerCase().includes(q))
		.sort((a, b) => (current.has(b.key) - current.has(a.key)) || (Number(b.joined) || 0) - (Number(a.joined) || 0))
		.slice(0, 300);

	const box = $('participantList');
	box.innerHTML = '';
	list.forEach(p => {
		const row = document.createElement('div');
		row.className = 'person' + (p.excluded ? ' excluded' : '') + (current.has(p.key) ? ' current' : '');
		row.appendChild(Avatar(p));
		const info = document.createElement('div');
		info.className = 'info';
		const name = document.createElement('span'); name.className = 'pseudo'; name.textContent = p.name;
		const meta = document.createElement('span'); meta.className = 'meta';
		meta.textContent = `${p.sub ? `abonné·e · ×${luck}` : 'non abonné·e'} · ${p.entries}/${max} envoi${max > 1 ? 's' : ''}`;
		info.append(name, meta);
		const chance = document.createElement('span');
		chance.className = 'chance';
		if (p.excluded) { chance.textContent = 'exclu'; chance.classList.add('red'); }
		else if (p.drawn) chance.textContent = 'tiré';
		else chance.textContent = `${((chances.get(p.key) || 0) * 100).toFixed(1).replace('.', ',')} %`;
		const del = document.createElement('button');
		del.type = 'button';
		del.className = 'ui-icon row-icon trash';
		del.innerHTML = TRASH;
		del.title = 'Retirer (cliquez deux fois)';
		WithConfirmation(del, TRASH, () => Send('remove', { key: p.key }));
		row.append(info, chance, del);
		box.appendChild(row);
	});
	$('emptyList').hidden = all.length > 0;
	$('emptyList').textContent = state.status === 'setup'
		? 'Ouvre les inscriptions : les participant·es apparaissent ici en direct.'
		: 'Personne pour l’instant.';
}

function RenderHistory() {
	const box = $('historyList');
	box.innerHTML = '';
	state.history.forEach(h => {
		const row = document.createElement('div');
		row.className = 'history-item';
		row.appendChild(Avatar({ name: h.name, platform: h.platform }));
		const info = document.createElement('div'); info.className = 'info';
		const n = document.createElement('span'); n.textContent = h.name;
		const d = new Date(Number(h.at) || 0);
		const m = document.createElement('span'); m.className = 'meta';
		m.textContent = `${h.lot || 'Lot'} · ${d.toLocaleDateString('fr-FR')} ${Clock(h.at)}`;
		info.append(n, m);
		row.appendChild(info);
		box.appendChild(row);
	});
	$('emptyHistory').hidden = state.history.length > 0;
	$('clearHistory').hidden = !state.history.length;
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

function SendConfig(partial) {
	Send('config', { config: JSON.stringify(partial) });
}

// Champs de réglage : envoi après une courte pause de saisie
const pendingConfig = {};
let configTimer = null;
function QueueConfig(el, immediate) {
	let v = el.value;
	if (el.type === 'number' || el.dataset.key === 'subLuck') {
		if (v.trim() === '') return;
		v = Number(v);
		if (!Number.isFinite(v)) return;
	}
	pendingConfig[el.dataset.key] = v;
	clearTimeout(configTimer);
	configTimer = setTimeout(() => {
		const partial = Object.assign({}, pendingConfig);
		Object.keys(pendingConfig).forEach(k => delete pendingConfig[k]);
		SendConfig(partial);
	}, immediate ? 0 : 500);
}

// Photo du lot : réduite à 400 px puis envoyée à Streamer.bot (rien n'est hébergé)
function ResizeImage(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = reject;
		reader.onload = () => {
			const img = new Image();
			img.onerror = reject;
			img.onload = () => {
				const scale = Math.min(1, 400 / Math.max(img.width, img.height));
				const c = document.createElement('canvas');
				c.width = Math.round(img.width * scale);
				c.height = Math.round(img.height * scale);
				const ctx = c.getContext('2d');
				ctx.drawImage(img, 0, 0, c.width, c.height);
				// PNG si l'image a de la transparence, sinon JPEG (plus léger)
				const data = ctx.getImageData(0, 0, c.width, c.height).data;
				let alpha = false;
				for (let i = 3; i < data.length; i += 16) if (data[i] < 250) { alpha = true; break; }
				resolve(alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86));
			};
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	});
}

///////////////////////////////////////////
// DÉMO : même logique que l'action C#   //
///////////////////////////////////////////

function LocalApply(a) {
	const cfg = state.config;
	const now = Date.now();
	const pool = () => GiveawayPool(state);
	const save = () => { state.updated = now; Render(); };
	switch (a.mode) {
		case 'config': Object.assign(cfg, JSON.parse(a.config)); break;
		case 'photo': photoURL = a.photo; state.hasPhoto = !!a.photo; break;
		case 'open':
			if (!String(cfg.word || '').trim()) return;
			if (state.status === 'ended') { state.participants = {}; state.draw = null; state.won = 0; }
			state.status = 'open';
			Toast('Chat : ' + Message('msgOpen', []));
			break;
		case 'close': state.status = 'closed'; break;
		case 'end': state.status = 'ended'; break;
		case 'draw':
		case 'next':
		case 'noshow': {
			const pickOne = () => {
				const [w] = GiveawayDemoDraw(state, 1);
				if (!w) return null;
				state.participants[w.key].drawn = true;
				w.at = now; w.deadline = now + cfg.confirmSeconds * 1000;
				return w;
			};
			let count = 1;
			if (a.mode === 'draw') {
				if (state.status === 'open') state.status = 'closed';
				const size = Math.min(Number(cfg.perDraw) || 1, cfg.lots - state.won, pool().length);
				if (size <= 0) { state.lastError = 'Personne n’est en lice'; break; }
				state.draw = { round: ((state.draw && state.draw.round) || 0) + 1, size, winners: [] };
			} else if (a.mode === 'noshow') {
				const waiting = state.draw.winners.filter(w => !w.confirmed);
				const gone = waiting.find(w => now > w.deadline) || waiting[waiting.length - 1];
				if (!gone) break;
				state.draw.winners = state.draw.winners.filter(w => w !== gone);
			}
			const names = [];
			for (let i = 0; i < count; i++) { const w = pickOne(); if (!w) break; state.draw.winners.push(w); names.push(w.name); }
			if (names.length < count || !pool().length && a.mode === 'next' && !names.length) state.draw.size = state.draw.winners.length;
			delete state.lastError;
			state.drawId = (Number(state.drawId) || 0) + 1;
			state.draw.id = state.drawId;
			LocalStatus();
			if (names.length) Toast('Chat : ' + Message('msgDraw', names));
			// Démo : chaque gagnant·e confirme au bout de 5 s
			const keys = state.draw.winners.filter(w => !w.confirmed).map(w => w.key);
			setTimeout(() => keys.forEach(k => LocalApply({ mode: 'chat', confirmKey: k, text: 'oui merci !!' })), 5000);
			break;
		}
		case 'chat': {
			if (state.status !== 'pending' || !state.draw) return;
			const w = state.draw.winners.find(x => x.key === a.confirmKey && !x.confirmed);
			if (!w || now > w.deadline) return;
			w.confirmed = true; w.confirmText = a.text; w.confirmTime = now;
			state.won++;
			state.history.unshift({ lot: cfg.lot, name: w.name, platform: w.platform, at: now });
			LocalStatus();
			Toast('Chat : ' + Message('msgConfirm', [w.name]));
			break;
		}
		case 'remove': delete state.participants[a.key]; break;
		case 'add': {
			const key = `${a.platform}:${a.name.toLowerCase()}`;
			if (!state.participants[key]) state.participants[key] = { platform: a.platform, id: '', login: a.name.toLowerCase(), name: a.name, sub: false, entries: 1, excluded: false, drawn: false, manual: true, joined: now };
			break;
		}
		case 'reset': {
			const history = state.history;
			state = GiveawayDemoState();
			state.status = 'setup';
			state.participants = {};
			state.history = history;
			state.hasPhoto = false;
			photoURL = '';
			break;
		}
		case 'clearHistory': state.history = []; break;
	}
	save();
}

// Même règle que l'action : pending tant que le tirage n'est pas complet et confirmé
function LocalStatus() {
	const d = state.draw;
	if (!d) { if (state.status === 'pending') state.status = 'closed'; return; }
	const done = d.winners.length >= d.size && d.winners.every(w => w.confirmed);
	state.status = !done ? 'pending' : (state.won >= state.config.lots ? 'finished' : 'confirmed');
}

function Message(key, names) {
	const cfg = state.config;
	const defaults = {
		msgOpen: 'GIVEAWAY ouvert ! Écrivez « {mot} » dans le chat pour participer. Lot : {lot}',
		msgDraw: '{pseudo} tu as été tiré·e au sort !',
		msgConfirm: 'Félicitations {pseudo} qui remporte {lot} !'
	};
	const mentions = names.map(n => '@' + n).join(' ');
	return String(cfg[key] !== undefined ? cfg[key] : defaults[key])
		.replace(/\{mot\}/g, cfg.word).replace(/\{lot\}/g, cfg.lot || 'un lot')
		.replace(/\{secondes\}/g, cfg.confirmSeconds).replace(/\{pseudos?\}/g, mentions);
}

//////////////////
// STREAMER.BOT //
//////////////////

async function SetState(raw) {
	const parsed = ParseGiveaway(raw);
	if (!parsed) return;
	if (state && !demo && Number(parsed.updated) < Number(state.updated)) return;
	state = parsed;
	if (parsed.photoV !== photoVersion) {
		photoVersion = parsed.photoV;
		photoURL = '';
		if (parsed.hasPhoto && sbClient) {
			try {
				const r = await sbClient.getGlobal(GIVEAWAY_PHOTO_VARIABLE, true);
				photoURL = r && r.status === 'ok' && r.variable ? String(r.variable.value || '') : '';
			} catch (e) { }
		}
	}
	GiveawayChat.refresh();
	Render();
}

async function RefreshData() {
	if (!sbClient || !connected) return;
	try {
		const response = await sbClient.getGlobal(GIVEAWAY_VARIABLE, true);
		if (response && response.status === 'ok' && response.variable && response.variable.value) { SetState(response.variable.value); return; }
	} catch (e) {
		// Variable absente : Streamer.bot répond par une erreur
	}
	// Pas encore de giveaway : état par défaut, la variable est créée par l'action
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
		if (ev && ev.source === 'giveaway') SetState(ev.data);
	});
	sbClient.on('Application.ActionAdded', CheckAction);
	sbClient.on('Application.ActionUpdated', CheckAction);
	sbClient.on('Application.ActionDeleted', CheckAction);

	// Le dock collecte aussi les messages du chat (l'action ignore les doublons de l'overlay)
	GiveawayChat.start({
		sbClient,
		getState: () => (actionFound ? state : null),
		send: (args) => sbClient.doAction({ name: ws.values.actionName }, args).catch(() => { })
	});
}

/////////////////////
// INTERACTIONS UI //
/////////////////////

function Bind() {
	document.querySelectorAll('[data-key]').forEach(el => {
		const immediate = el.tagName === 'SELECT';
		el.addEventListener(immediate ? 'change' : 'input', () => QueueConfig(el, immediate));
		if (!immediate) el.addEventListener('change', () => QueueConfig(el, true));
	});

	$('registrationButton').addEventListener('click', () => {
		if (state.status === 'setup' || state.status === 'ended') Send('open');
		else if (state.status === 'open') Send('close');
	});
	$('primaryButton').addEventListener('click', () => Send($('primaryButton').dataset.mode || 'draw'));
	WithConfirmation($('endButton'), 'Confirmer ?', () => Send('end'));
	$('noshowButton').addEventListener('click', () => Send('noshow'));
	WithConfirmation($('resetButton'), 'Confirmer la réinitialisation ?', () => Send('reset'));

	$('photoChoose').addEventListener('click', () => $('photoFile').click());
	$('photoFile').addEventListener('change', async () => {
		const file = $('photoFile').files[0];
		$('photoFile').value = '';
		if (!file) return;
		try { Send('photo', { photo: await ResizeImage(file) }); }
		catch (e) { Toast('Image illisible'); }
	});
	$('photoUrl').addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		const url = $('photoUrl').value.trim();
		if (!/^https?:\/\//i.test(url)) { Toast('Collez une adresse qui commence par https://'); return; }
		Send('photo', { photo: url });
		$('photoUrl').value = '';
	});
	$('photoRemove').innerHTML = TRASH;
	$('photoRemove').addEventListener('click', () => Send('photo', { photo: '' }));

	$('search').addEventListener('input', () => state && RenderParticipants());
	$('addToggle').addEventListener('click', () => { $('addForm').hidden = !$('addForm').hidden; if (!$('addForm').hidden) $('addName').focus(); });
	const add = () => {
		const name = $('addName').value.trim();
		if (!name) return;
		Send('add', { name, platform: $('addPlatform').value });
		$('addName').value = '';
	};
	$('addSubmit').addEventListener('click', add);
	$('addName').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
	$('clearHistory').addEventListener('click', () => Send('clearHistory'));
	$('recheckButton').addEventListener('click', CheckAction);
}

///////////////
// DÉMARRAGE //
///////////////

(async function Init() {
	try {
		ws = await WidgetSettings.load('dock.json', () => { ConnectStreamerBot(); Render(); });
	} catch (e) {
		console.error('[Giveaway] Réglages du dock illisibles :', e);
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

	Bind();
	demo = ws.demo;
	if (demo) {
		state = GiveawayDemoState();
		state.config.msgOpen = 'GIVEAWAY ouvert ! Écrivez « {mot} » dans le chat pour participer. Lot : {lot}';
		state.config.msgDraw = '{pseudo} tu as été tiré·e au sort ! Écris un message dans le chat dans les {secondes} secondes pour confirmer que tu veux le lot.';
		state.config.msgConfirm = 'Félicitations {pseudo} qui remporte {lot} ! Un modo te contacte très vite.';
		Render();
		return;
	}
	ConnectStreamerBot();
	Render();
})();
