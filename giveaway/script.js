// Giveaway : overlay
// Les réglages viennent de settings/settings.json (valeurs par défaut, bornes, conditions)
// et de l'URL. Aucune valeur par défaut n'est redéfinie ici.
// Le tirage est fait par l'action Streamer.bot : l'overlay reçoit le résultat et joue
// le défilement jusqu'au nom déjà tiré.

const widgetEl = document.getElementById('widget');
const stageEl = document.getElementById('stage');
const photoEl = document.getElementById('prizePhoto');
const titleEl = document.getElementById('title');
const prizeNameEl = document.getElementById('prizeName');
const countEl = document.getElementById('count');
const wordEl = document.getElementById('word');
const rollLabelEl = document.getElementById('rollLabel');
const slotEl = document.getElementById('slot');
const stripEl = document.getElementById('strip');
const winnersEl = document.getElementById('winners');
const confettiEl = document.getElementById('confetti');

let ws = null;              // réglages (module commun WidgetSettings)
let sbClient = null, sbHost = null, sbPort = null;
let realState = null;       // état lu dans Streamer.bot
let demoState = null;       // état d'exemple (aperçu de la page de paramétrage)
let photoURL = '';
let photoVersion = null;
let lastDrawId = null;      // dernier tirage déjà joué (on ne rejoue pas à la reconnexion)
let shownDraw = null;       // tirage affiché { id, winners, deadline }
let playToken = 0;          // annule une animation en cours
let animating = false;
let winnerTimer = null;
let countdownTimer = null;
let realSeen = false;      // vraies valeurs déjà affichées (remplacent l'exemple)

const wait = (ms) => new Promise(r => setTimeout(r, ms));

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

// État affiché : le vrai, sauf dans l'aperçu quand aucun giveaway n'est en cours
function CurrentState() {
	if (ws && ws.demo && (!realState || realState.status === 'setup')) return demoState;
	return realState;
}

function ApplySettings() {
	const s = ws.values;
	const on = (id) => ws.isActive(id); // un réglage masqué n'a pas d'effet

	const font = String(s.font || '').trim().replace(/["']/g, '');
	SetVar('--font', font ? `"${font}"` : '"SF Pro Overlay"');
	SetVar('--font-size', `${s.fontSize}px`);
	SetVar('--text-color', s.textColor);
	SetVar('--secondary-color', s.secondaryColor);
	SetVar('--text-shadow', s.shadow ? `0 1px 2px ${HexToRgba(s.shadowColor, s.shadowOpacity)}` : 'none');
	SetVar('--photo-size', `${s.photoSize}px`);
	SetVar('--accent', s.accentColor);
	SetVar('--card-bg', HexToRgba(s.cardBg, s.cardBgOpacity));
	SetVar('--banner-bg', HexToRgba(s.bannerBg, s.bannerOpacity));
	SetVar('--banner-height', `${s.bannerHeight}px`);
	SetVar('--line-color', s.lineColor);
	SetVar('--in-ms', `${s.cardInDuration}ms`);
	SetVar('--out-ms', `${s.cardOutDuration}ms`);

	widgetEl.className = `layout-${s.layout}`;
	if (on('align')) widgetEl.classList.add(`align-${s.align}`);
	if (s.layout === 'banner') widgetEl.classList.add(`anim-${s.bannerAnim}`);
	if (s.layout === 'light' && !s.decorLine) widgetEl.classList.add('no-line');
	widgetEl.classList.toggle('hide-avatar', !s.showAvatar);
	widgetEl.classList.toggle('hide-platform', !s.showPlatform);

	RenderBefore();
	if (shownDraw && !animating) RenderWinners(shownDraw, false);
	if (!animating) SetView(ViewFor());
}

// Réglage « Afficher avant le tirage » du style en cours
function BeforeMode() {
	const s = ws.values;
	return s.layout === 'card' ? s.cardBeforeDraw : s.beforeDraw;
}

function RenderBefore() {
	const s = ws.values;
	const state = CurrentState();
	if (!state) return;
	const mode = BeforeMode();
	const showCount = mode === 'count' || mode === 'both';
	const showPrize = mode === 'prize' || mode === 'both';

	titleEl.textContent = ws.isActive('titleText') ? s.titleText : '';
	countEl.textContent = showCount ? GiveawayText(s.countText, state, GiveawayPool(state).length) : '';
	prizeNameEl.textContent = showPrize && s.showPrizeName ? (state.config.lot || '') : '';
	wordEl.textContent = ws.isActive('wordText') && state.status === 'open' ? GiveawayText(s.wordText, state, 0) : '';
	SetPhoto(photoEl, showPrize && s.showPrizePhoto ? CurrentPhoto() : '');
}

function SetPhoto(img, url) {
	img.classList.toggle('off', !url);
	if (url) { if (img.getAttribute('src') !== url) img.src = url; }
	else img.removeAttribute('src');
}

function CurrentPhoto() {
	const state = CurrentState();
	if (!state) return '';
	if (state.demo) return GiveawayDemoPhoto();
	return state.hasPhoto ? photoURL : '';
}

// Vue à afficher hors animation
function ViewFor() {
	const state = CurrentState();
	if (!state || state.status === 'setup') return 'none';
	if (shownDraw) return 'winners';
	if (state.status === 'finished') return 'none';
	return BeforeMode() === 'none' ? 'none' : 'before';
}

function SetView(view) {
	stageEl.dataset.view = view;
}

////////////////////////
// TIRAGE : ANIMATION //
////////////////////////

function Names(state) {
	const names = Object.values(state.participants).filter(p => !p.excluded).map(p => p.name);
	return names.length ? names : ['…'];
}

// Défilement vertical : départ très rapide, ralentissement progressif, arrêt sur le gagnant
function Roll(names, winnerName, durationMs, token) {
	return new Promise((resolve) => {
		const count = Math.max(12, Math.round(durationMs / 1000 * 10) + 10);
		const items = [];
		let previous = '';
		for (let i = 0; i < count - 1; i++) {
			let n = names[Math.floor(Math.random() * names.length)];
			if (names.length > 1 && n === previous) n = names[(names.indexOf(n) + 1) % names.length];
			items.push(n);
			previous = n;
		}
		items.push(winnerName);

		stripEl.innerHTML = '';
		const frag = document.createDocumentFragment();
		items.forEach(n => { const d = document.createElement('div'); d.textContent = n; frag.appendChild(d); });
		stripEl.appendChild(frag);
		stripEl.style.transform = 'translateY(0)';

		// Largeur fixe : celle du nom le plus long (pas de saut de mise en page)
		slotEl.style.width = '';
		const widest = Math.max(...Array.from(stripEl.children).map(c => c.scrollWidth));
		slotEl.style.width = `${widest + 4}px`;

		const itemH = stripEl.firstChild.offsetHeight || 40;
		const distance = (items.length - 1) * itemH;
		const start = performance.now();
		let lastIndex = 0;
		const tick = PrepareSound(ws.values.rollSound);

		function frame(now) {
			if (token !== playToken) return resolve(false);
			const t = Math.min(1, (now - start) / durationMs);
			const eased = 1 - Math.pow(1 - t, 4);
			const y = eased * distance;
			// Flou de vitesse au début, net à l'arrivée
			const speed = 4 * Math.pow(1 - t, 3) * distance / durationMs * 16; // pixels par image
			stripEl.style.transform = `translateY(${-y}px)`;
			stripEl.style.filter = speed > itemH * 0.6 ? `blur(${Math.min(3, speed / itemH)}px)` : 'none';
			const index = Math.floor(y / itemH + 0.5);
			if (index !== lastIndex) { lastIndex = index; tick(); }
			if (t < 1) requestAnimationFrame(frame);
			else { stripEl.style.filter = 'none'; resolve(true); }
		}
		requestAnimationFrame(frame);
	});
}

// Son court rejoué à chaque nom (limité pour ne pas saturer)
function PrepareSound(url) {
	url = String(url || '').trim();
	if (!url) return () => { };
	const base = new Audio(url);
	let last = 0;
	return () => {
		const now = performance.now();
		if (now - last < 45) return;
		last = now;
		const a = base.cloneNode();
		a.volume = ws.values.soundVolume / 100;
		a.play().catch(() => { });
	};
}

function PlaySound(url) {
	url = String(url || '').trim();
	if (!url) return;
	const a = new Audio(url);
	a.volume = ws.values.soundVolume / 100;
	a.play().catch(() => { });
}

async function PlayDraw(draw) {
	const token = ++playToken;
	const s = ws.values;
	const state = CurrentState();
	clearTimeout(winnerTimer);
	animating = true;

	const winners = draw.winners.filter(w => !w.confirmed || !draw.replacement);
	const useRoll = s.layout !== 'card' || s.cardRoll;

	if (useRoll && winners.length) {
		const names = Names(state);
		rollLabelEl.textContent = s.winnerLabel;
		SetView('roll');
		await wait(250);
		for (let i = 0; i < winners.length; i++) {
			const duration = (i === 0 ? s.rollDuration : Math.max(2, s.rollDuration * 0.6)) * 1000;
			const done = await Roll(names, winners[i].name, duration, token);
			if (!done) return;
			PlaySound(s.winSound);
			await wait(i < winners.length - 1 ? 1200 : 700);
			if (token !== playToken) return;
		}
	}

	shownDraw = draw;
	RenderWinners(draw, true);
	SetView('winners');
	if (!useRoll) PlaySound(s.winSound);
	if (s.confetti) Confetti();
	animating = false;
	ScheduleWinnerEnd(token);
}

// Fin de l'affichage du gagnant après la durée choisie (0 : reste affiché)
function ScheduleWinnerEnd(token) {
	clearTimeout(winnerTimer);
	const s = ws.values;
	if (!s.winnerDuration) return;
	winnerTimer = setTimeout(async () => {
		if (token !== playToken) return;
		if (s.layout === 'card') {
			winnersEl.querySelectorAll('.winner').forEach(el => {
				el.classList.remove('in-zoom', 'in-fade', 'in-slide', 'in-bounce');
				el.classList.add(`out-${s.cardOut}`);
			});
			await wait(s.cardOutDuration);
			if (token !== playToken) return;
		}
		shownDraw = null;
		RenderBefore();
		const next = ViewFor();
		SetView(s.layout !== 'card' && s.afterWinner === 'hide' ? 'none' : next);
	}, s.winnerDuration * 1000);
}

function RenderWinners(draw, animate) {
	const s = ws.values;
	const state = CurrentState();
	winnersEl.innerHTML = '';
	draw.winners.forEach((w, i) => {
		const el = document.createElement('div');
		el.className = 'winner' + (s.layout === 'card' ? ' card' : '');
		el.dataset.key = w.key;

		const wrap = document.createElement('span');
		wrap.className = 'avatar-wrap';
		const avatar = document.createElement('img');
		avatar.className = 'avatar empty';
		avatar.alt = '';
		wrap.appendChild(avatar);
		wrap.classList.add('no-avatar'); // retiré dès que l'avatar est chargé
		const icon = document.createElement('img');
		icon.className = 'platform';
		icon.alt = GIVEAWAY_PLATFORM_NAMES[w.platform] || '';
		icon.src = `icons/${w.platform}.png`;
		wrap.appendChild(icon);
		if (s.showAvatar) GiveawayAvatar(w).then(url => {
			if (!url) return;
			avatar.onload = () => { avatar.classList.remove('empty'); wrap.classList.remove('no-avatar'); };
			avatar.src = url;
		});

		const label = document.createElement('span');
		label.className = 'label';
		label.textContent = s.layout === 'light' && i > 0 ? '' : s.winnerLabel;

		const name = document.createElement('span');
		name.className = 'name';
		name.textContent = w.name;

		const status = document.createElement('span');
		status.className = 'status';

		el.append(wrap, label, name);

		// Carte : rappel du lot
		if (s.layout === 'card') {
			const prize = document.createElement('span');
			prize.className = 'prize';
			const url = s.showPrizePhoto ? CurrentPhoto() : '';
			if (url) { const img = document.createElement('img'); img.src = url; img.alt = ''; prize.appendChild(img); }
			if (s.showPrizeName && state && state.config.lot) prize.append(state.config.lot);
			el.appendChild(prize);
			const timer = document.createElement('span');
			timer.className = 'timer';
			timer.appendChild(document.createElement('i'));
			el.appendChild(timer);
		}
		el.appendChild(status);

		if (animate && s.layout === 'card') {
			el.classList.add(`in-${s.cardIn}`);
			el.style.animationDelay = `${i * 180}ms`;
		}
		winnersEl.appendChild(el);
	});
	UpdateConfirmations();
	clearInterval(countdownTimer);
	countdownTimer = setInterval(UpdateConfirmations, 250);
}

// Compte à rebours et confirmations (mis à jour à chaque événement et toutes les 250 ms)
function UpdateConfirmations() {
	if (!shownDraw) { clearInterval(countdownTimer); return; }
	const s = ws.values;
	const total = Math.max(1, (shownDraw.deadline - shownDraw.at) || 60000);
	const left = Math.max(0, shownDraw.deadline - Date.now());
	winnersEl.querySelectorAll('.winner').forEach(el => {
		const w = shownDraw.winners.find(x => x.key === el.dataset.key);
		if (!w) return;
		const status = el.querySelector('.status');
		const timer = el.querySelector('.timer');
		if (w.confirmed) {
			status.textContent = s.confirmedText;
			status.classList.add('done');
			if (timer) timer.classList.add('off');
		} else if (s.showCountdown) {
			const sec = Math.ceil(left / 1000);
			status.textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
			status.classList.remove('done');
			if (timer) { timer.classList.remove('off'); timer.firstChild.style.transform = `scaleX(${left / total})`; }
		} else {
			status.textContent = '';
			if (timer) timer.classList.add('off');
		}
	});
}

//////////////////
// CONFETTIS    //
//////////////////

function Confetti() {
	const ctx = confettiEl.getContext('2d');
	const W = confettiEl.width = confettiEl.offsetWidth;
	const H = confettiEl.height = confettiEl.offsetHeight;
	const colors = ['#ff375f', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ffffff'];
	const parts = Array.from({ length: 160 }, () => ({
		x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.55,
		vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 6,
		r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
		w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)]
	}));
	const start = performance.now();
	(function frame(now) {
		const t = now - start;
		ctx.clearRect(0, 0, W, H);
		parts.forEach(p => {
			p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
			ctx.save();
			ctx.globalAlpha = Math.max(0, 1 - t / 3500);
			ctx.translate(p.x, p.y); ctx.rotate(p.r);
			ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
			ctx.restore();
		});
		if (t < 3500) requestAnimationFrame(frame);
		else ctx.clearRect(0, 0, W, H);
	})(start);
}

/////////////////////////////
// MISE À JOUR DE L'ÉTAT   //
/////////////////////////////

function OnState(state) {
	const first = lastDrawId === null;
	if (first) lastDrawId = Number(state.drawId) || 0;

	// Remise à zéro : on arrête tout
	if (state.status === 'setup' && !state.demo) {
		playToken++;
		animating = false;
		shownDraw = null;
		clearTimeout(winnerTimer);
	}

	// Nouveau tirage : on joue le défilement
	if (state.draw && Number(state.draw.id) > lastDrawId && state.status === 'pending') {
		lastDrawId = Number(state.draw.id);
		RenderBefore();
		PlayDraw(state.draw);
		return;
	}

	// Première lecture pendant l'attente de confirmation : gagnant affiché sans animation
	if (first && state.status === 'pending' && state.draw) {
		shownDraw = state.draw;
		RenderWinners(shownDraw, false);
		ScheduleWinnerEnd(playToken);
	}

	// Confirmation reçue : mise à jour du tirage affiché
	if (shownDraw && state.draw && state.draw.id === shownDraw.id) {
		shownDraw = state.draw;
		UpdateConfirmations();
	}

	RenderBefore();
	if (!animating) SetView(ViewFor());
}

async function SetRealState(raw, event) {
	const parsed = ParseGiveaway(raw);
	if (!parsed) return;
	if (realState && Number(parsed.updated) < Number(realState.updated)) return; // ancienne valeur arrivée en retard
	realState = parsed;

	// Photo du lot : relue seulement quand elle change
	if (parsed.photoV !== photoVersion) {
		photoVersion = parsed.photoV;
		photoURL = parsed.hasPhoto ? await ReadPhoto() : '';
	}
	GiveawayChat.refresh();
	if (ws.demo && parsed.status === 'setup') { OnState(demoState); return; }
	// Premières vraies valeurs dans l'aperçu : elles remplacent l'exemple sans animation
	if (!realSeen) {
		realSeen = true;
		lastDrawId = null;
		playToken++;
		animating = false;
		shownDraw = null;
	}
	OnState(parsed);
}

async function ReadPhoto() {
	try {
		const r = await sbClient.getGlobal(GIVEAWAY_PHOTO_VARIABLE, true);
		return r && r.status === 'ok' && r.variable ? String(r.variable.value || '') : '';
	} catch (e) { return ''; }
}

//////////////////
// STREAMER.BOT //
//////////////////

async function RefreshFromStreamerBot() {
	if (!sbClient) return;
	try {
		const response = await sbClient.getGlobal(GIVEAWAY_VARIABLE, true);
		if (response && response.status === 'ok' && response.variable) SetRealState(response.variable.value);
	} catch (e) {
		console.error('[Giveaway] Lecture de la variable impossible :', e);
	}
}

function ConnectStreamerBot() {
	const host = ws.values.address;
	const port = ws.values.port;
	if (sbClient && host === sbHost && port === sbPort) return; // pas de reconnexion inutile

	if (sbClient) { try { sbClient.disconnect(); } catch (e) { } }
	sbHost = host;
	sbPort = port;

	sbClient = new StreamerbotClient({
		host,
		port,
		onConnect: () => {
			console.log(`[Giveaway] Connecté à Streamer.bot (${host}:${port})`);
			RefreshFromStreamerBot();
		},
		onDisconnect: () => console.warn('[Giveaway] Déconnecté de Streamer.bot')
	});

	sbClient.on('General.Custom', ({ data }) => {
		if (data && data.source === 'giveaway') SetRealState(data.data, data.event);
	});
	sbClient.on('Misc.GlobalVariableUpdated', ({ data }) => {
		const name = data && (data.name || (data.variable && data.variable.name));
		if (name === GIVEAWAY_VARIABLE && !realState) RefreshFromStreamerBot();
	});

	// Collecte des messages du chat (jamais depuis l'aperçu de la page de paramétrage)
	if (!ws.demo) {
		GiveawayChat.start({
			sbClient,
			getState: () => realState,
			send: (args) => sbClient.doAction({ name: ws.values.actionName }, args)
				.catch(e => console.error('[Giveaway] Action impossible :', e))
		});
	}
}

////////////////////////////////////////
// APERÇU : boutons de test (settings) //
////////////////////////////////////////

// Visuel seulement : rien n'est envoyé à Streamer.bot
window.PreviewDraw = function () {
	const state = CurrentState();
	if (!state) return;
	const count = Math.max(1, Math.min(Number(state.config.perDraw) || 1, 3));
	const winners = GiveawayDemoDraw(state, count);
	if (!winners.length) return;
	const now = Date.now();
	const draw = { id: -now, at: now, deadline: now + (Number(state.config.confirmSeconds) || 60) * 1000, winners };
	PlayDraw(draw).then(() => {
		// Démo : le premier gagnant confirme au bout de quelques secondes
		setTimeout(() => {
			if (shownDraw === draw) { draw.winners[0].confirmed = true; UpdateConfirmations(); }
		}, 4000);
	});
};

window.PreviewBefore = function () {
	playToken++;
	animating = false;
	shownDraw = null;
	clearTimeout(winnerTimer);
	RenderBefore();
	SetView(ViewFor());
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
		console.error('[Giveaway] Réglages illisibles :', e);
		return;
	}

	if (ws.demo) demoState = GiveawayDemoState();
	ApplySettings();
	if (ws.demo) OnState(demoState);
	ConnectStreamerBot();
})();
