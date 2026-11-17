// Giveaway : outils partagés par l'overlay et le dock
// (lecture de l'état Streamer.bot, collecte des messages du chat, données de démonstration)

const GIVEAWAY_VARIABLE = 'giveaway';
const GIVEAWAY_PHOTO_VARIABLE = 'giveawayPhoto';
const GIVEAWAY_PLATFORMS = ['twitch', 'kick', 'youtube', 'tiktok'];
const GIVEAWAY_PLATFORM_NAMES = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', tiktok: 'TikTok' };

// Lit la valeur de la variable Streamer.bot (chaîne JSON) ; null si illisible
function ParseGiveaway(raw) {
	let data = raw;
	if (typeof raw === 'string') {
		try { data = JSON.parse(raw); } catch (e) { data = null; }
	}
	if (!data || typeof data !== 'object' || typeof data.status !== 'string') return null;
	data.config = data.config || {};
	data.participants = data.participants || {};
	data.history = Array.isArray(data.history) ? data.history : [];
	if (!Array.isArray(data.config.platforms)) data.config.platforms = GIVEAWAY_PLATFORMS.slice();
	return data;
}

// Personnes en lice (ni exclues, ni déjà tirées) et leur chance de gagner au prochain tirage
function GiveawayPool(state) {
	const luck = Math.max(1, Number(state.config.subLuck) || 1);
	const pool = Object.entries(state.participants)
		.filter(([, p]) => !p.excluded && !p.drawn)
		.map(([key, p]) => ({ key, ...p, weight: p.sub ? luck : 1 }));
	const total = pool.reduce((t, p) => t + p.weight, 0);
	pool.forEach(p => { p.chance = total ? p.weight / total : 0; });
	return pool;
}

// Remplace {count}, {mot}, {lot} dans un texte de l'overlay
function GiveawayText(template, state, count) {
	return String(template || '')
		.replace(/\{count\}/g, String(count))
		.replace(/\{mot\}/g, state && state.config.word ? state.config.word : '…')
		.replace(/\{lot\}/g, state && state.config.lot ? state.config.lot : '');
}

// Avatar manquant : Twitch par decapi, Kick par son API publique
const giveawayAvatarCache = new Map();
async function GiveawayAvatar(winner) {
	if (winner.avatar) return winner.avatar;
	const login = String(winner.login || winner.name || '').toLowerCase();
	const key = `${winner.platform}:${login}`;
	if (giveawayAvatarCache.has(key)) return giveawayAvatarCache.get(key);
	let url = '';
	try {
		if (winner.platform === 'twitch' && login) {
			const r = await fetch('https://decapi.me/twitch/avatar/' + encodeURIComponent(login));
			const t = (await r.text()).trim();
			if (/^https?:\/\//.test(t)) url = t;
		} else if (winner.platform === 'kick' && login) {
			const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(login.replace(/_/g, '-')));
			if (r.ok) url = ((await r.json()).user || {}).profile_pic || '';
		}
	} catch (e) { }
	giveawayAvatarCache.set(key, url);
	return url;
}

/////////////////////////////////////
// COLLECTE DES MESSAGES DU CHAT   //
/////////////////////////////////////

// Écoute Twitch et YouTube (Streamer.bot), Kick (Pusher) et TikTok (TikFinity).
// Seuls les messages utiles sont transmis à l'action : mot du giveaway pendant les
// inscriptions, ou message d'une personne tirée qui doit confirmer.
// Plusieurs pages peuvent collecter en même temps : l'action ignore les doublons (msgId).
const GiveawayChat = (function () {
	let opts = null;
	let kickSocket = null, kickChannel = '', kickTimer = null;
	let tiktokSocket = null, tiktokTimer = null, tiktokWanted = false;

	function eligible(state, platform) {
		return state && Array.isArray(state.config.platforms) && state.config.platforms.includes(platform);
	}

	function handle(msg) {
		const state = opts && opts.getState();
		if (!state || !msg || !msg.platform || !(msg.userId || msg.login)) return;
		const key = `${msg.platform}:${msg.userId || msg.login}`;
		let useful = false;

		if (state.status === 'open' && eligible(state, msg.platform)) {
			const word = String(state.config.word || '').trim().toLowerCase();
			const text = String(msg.text || '').trim().toLowerCase();
			useful = !!word && (state.config.match === 'exact' ? text === word : text.includes(word));
		} else if (state.status === 'pending' && state.draw && Array.isArray(state.draw.winners)) {
			useful = state.draw.winners.some(w => w.key === key && !w.confirmed);
		}
		if (!useful) return;

		const msgId = msg.msgId || `${key}:${Math.floor(Date.now() / 3000)}:${String(msg.text || '').slice(0, 40)}`;
		opts.send({
			mode: 'chat',
			platform: msg.platform,
			userId: String(msg.userId || ''),
			login: String(msg.login || '').toLowerCase(),
			name: String(msg.name || msg.login || ''),
			text: String(msg.text || ''),
			msgId: String(msgId),
			sub: msg.sub ? 'true' : 'false',
			avatar: String(msg.avatar || '')
		});
	}

	function badgeNames(list) {
		return (Array.isArray(list) ? list : []).map(b => String(b && (b.name || b.setId || b.type || b) || '').toLowerCase());
	}

	// Twitch (Streamer.bot 0.2 et 1.0)
	function fromTwitch(d) {
		if (!d) return null;
		const m = typeof d.message === 'object' && d.message ? d.message : {};
		const u = d.user || {};
		const badges = badgeNames(u.badges || m.badges);
		return {
			platform: 'twitch',
			userId: u.id || m.userId || d.userId,
			login: u.login || m.username || d.userName,
			name: u.name || m.displayName || u.login || m.username,
			text: typeof d.text === 'string' ? d.text : (typeof d.message === 'string' ? d.message : (m.message || m.text || '')),
			msgId: d.messageId || m.msgId || m.id || d.msgId,
			sub: !!(u.subscribed || u.isSubscribed || m.subscriber || badges.includes('subscriber') || badges.includes('founder'))
		};
	}

	function fromYouTube(d) {
		if (!d) return null;
		const u = d.user || {};
		return {
			platform: 'youtube',
			userId: u.id || d.userId,
			login: u.name || d.userName,
			name: u.name || d.userName,
			text: typeof d.message === 'string' ? d.message : (d.text || ''),
			msgId: d.eventId || d.messageId || d.id,
			sub: !!(u.isSponsor || u.isMember),
			avatar: u.profileImageUrl || ''
		};
	}

	// Kick : événement Pusher (ChatMessageEvent) ou Streamer.bot (Kick.ChatMessage)
	function fromKick(d) {
		if (!d) return null;
		const s = d.sender || d.user || {};
		const badges = badgeNames((s.identity && s.identity.badges) || s.badges);
		return {
			platform: 'kick',
			userId: s.id || s.userId,
			login: s.slug || s.login || s.username,
			name: s.username || s.name || s.slug,
			text: d.content || d.text || (typeof d.message === 'string' ? d.message : ''),
			msgId: d.id || d.messageId,
			sub: !!(s.isSubscribed || s.subscribed || badges.includes('subscriber') || badges.includes('founder')),
			avatar: s.profile_pic || s.profilePicture || ''
		};
	}

	function fromTikTok(d) {
		if (!d) return null;
		return {
			platform: 'tiktok',
			userId: d.userId || d.uniqueId,
			login: d.uniqueId || d.nickname,
			name: d.nickname || d.uniqueId,
			text: d.comment || '',
			msgId: d.msgId,
			sub: !!(d.isSubscriber || (Array.isArray(d.userBadges) && d.userBadges.some(b => /sub/i.test(String(b.type || b.name || ''))))),
			avatar: d.profilePictureUrl || ''
		};
	}

	// ---------- Kick (Pusher) ----------
	async function kickConnect(channel) {
		kickChannel = channel;
		if (kickSocket) { try { kickSocket.onclose = null; kickSocket.close(); } catch (e) { } kickSocket = null; }
		clearTimeout(kickTimer);
		if (!channel) return;
		let chatroomId = null;
		try {
			const r = await fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(channel.replace(/_/g, '-')));
			if (r.ok) chatroomId = ((await r.json()).chatroom || {}).id;
		} catch (e) { }
		if (kickChannel !== channel) return;
		if (!chatroomId) {
			console.warn(`[Giveaway] Chaîne Kick « ${channel} » introuvable, nouvel essai dans 60 s`);
			kickTimer = setTimeout(() => kickConnect(channel), 60000);
			return;
		}
		const sock = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false');
		kickSocket = sock;
		sock.onmessage = (ev) => {
			try {
				const p = JSON.parse(ev.data);
				if (p.event === 'pusher:connection_established') {
					sock.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: `chatrooms.${chatroomId}.v2` } }));
					return;
				}
				if (String(p.event || '').split('\\').pop() === 'ChatMessageEvent') handle(fromKick(JSON.parse(p.data)));
			} catch (e) { }
		};
		sock.onclose = () => {
			if (kickSocket === sock) kickTimer = setTimeout(() => kickConnect(kickChannel), 5000);
		};
	}

	// ---------- TikTok (TikFinity) ----------
	function tiktokConnect() {
		if (!tiktokWanted || tiktokSocket) return;
		let sock;
		try { sock = new WebSocket('ws://localhost:21213/'); } catch (e) { return; }
		tiktokSocket = sock;
		sock.onmessage = (ev) => {
			try {
				const p = JSON.parse(ev.data);
				if (p.event === 'chat') handle(fromTikTok(p.data));
			} catch (e) { }
		};
		const retry = () => {
			if (tiktokSocket === sock) tiktokSocket = null;
			clearTimeout(tiktokTimer);
			if (tiktokWanted) tiktokTimer = setTimeout(tiktokConnect, 5000);
		};
		sock.onclose = retry;
		sock.onerror = () => { try { sock.close(); } catch (e) { } };
	}

	return {
		// opts : { sbClient, getState: () => état, send: (args) => void }
		start(o) {
			opts = o;
			o.sbClient.on('Twitch.ChatMessage', ({ data }) => handle(fromTwitch(data)));
			o.sbClient.on('YouTube.Message', ({ data }) => handle(fromYouTube(data)));
			// Kick natif de Streamer.bot (si disponible) : sinon Pusher, ci-dessous
			o.sbClient.on('Kick.ChatMessage', ({ data }) => { if (!kickSocket) handle(fromKick(data)); });
			this.refresh();
		},
		// À appeler quand l'état change : connexion Kick / TikTok selon les plateformes choisies
		refresh() {
			const state = opts && opts.getState();
			if (!state) return;
			const active = state.status === 'open' || state.status === 'pending';
			const kick = active && eligible(state, 'kick') ? String(state.config.kickChannel || '').trim().toLowerCase() : '';
			if (kick !== kickChannel) kickConnect(kick);
			tiktokWanted = active && eligible(state, 'tiktok');
			if (tiktokWanted) tiktokConnect();
			else if (tiktokSocket) { const s = tiktokSocket; tiktokSocket = null; try { s.close(); } catch (e) { } }
		}
	};
})();

////////////////////////////
// DONNÉES DE DÉMONSTRATION //
////////////////////////////

// Image de lot fictive (SVG généré, aucune image externe)
function GiveawayDemoPhoto() {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5e5ce6"/><stop offset="1" stop-color="#bf5af2"/></linearGradient></defs><rect width="400" height="400" rx="60" fill="url(#g)"/><rect x="90" y="170" width="220" height="150" rx="14" fill="#fff" fill-opacity=".92"/><rect x="74" y="128" width="252" height="56" rx="12" fill="#fff"/><rect x="185" y="128" width="30" height="192" fill="#ff375f"/><path d="M200 128c-30-58-92-54-86-18 4 22 50 22 86 18zm0 0c30-58 92-54 86-18-4 22-50 22-86 18z" fill="none" stroke="#ff375f" stroke-width="16" stroke-linejoin="round"/></svg>`;
	return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function GiveawayDemoState() {
	const names = [
		['twitch', 'PixelPanda', true], ['kick', 'LunaStreams', false], ['youtube', 'Le Grand Marmiton', true],
		['tiktok', 'mimi.cosplay', false], ['twitch', 'xX_DarkSasuke_Xx', false], ['twitch', 'Biscotte', true],
		['youtube', 'Camille R.', false], ['kick', 'TurboGamer93', false], ['twitch', 'Nougatine', false],
		['tiktok', 'julien_officiel', true], ['twitch', 'CaptainCroissant', false], ['twitch', 'Zoé', false]
	];
	const now = Date.now();
	const participants = {};
	names.forEach(([platform, name, sub], i) => {
		const login = name.toLowerCase().replace(/[^a-z0-9_.]/g, '');
		participants[`${platform}:${login}`] = {
			platform, id: '', login, name, sub, entries: 1, excluded: i === 8, drawn: false, avatar: '',
			joined: now - (names.length - i) * 15000,
			msg: { text: i % 3 === 0 ? 'giveaway svp 🙏 j’ai trop besoin de ce clavier' : 'giveaway', time: now - (names.length - i) * 15000 }
		};
	});
	participants['twitch:nougatine'].entries = 4;
	return {
		version: 1, demo: true, status: 'open', drawId: 0, won: 0, photoV: 0, hasPhoto: true, history: [],
		config: {
			lot: 'Clavier mécanique', lots: 3, perDraw: 1, word: 'giveaway', match: 'contains', maxEntries: 3,
			subLuck: 2, followMin: 0, followUnit: 'days', platforms: GIVEAWAY_PLATFORMS.slice(), kickChannel: '',
			confirmSeconds: 60, excluded: ''
		},
		participants, draw: null
	};
}

// Tirage pondéré local (aperçu de la page de paramétrage et dock en démo)
function GiveawayDemoDraw(state, count) {
	const pool = GiveawayPool(state);
	const winners = [];
	for (let i = 0; i < count && pool.length; i++) {
		const total = pool.reduce((t, p) => t + p.weight, 0);
		let r = Math.random() * total, k = pool.length - 1;
		for (let j = 0; j < pool.length; j++) { r -= pool[j].weight; if (r < 0) { k = j; break; } }
		const p = pool.splice(k, 1)[0];
		winners.push({ key: p.key, name: p.name, login: p.login, platform: p.platform, avatar: p.avatar || '', sub: !!p.sub, msg: p.msg || {}, confirmed: false });
	}
	return winners;
}
