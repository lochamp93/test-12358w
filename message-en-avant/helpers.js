// Message en avant : outils partagés par l'overlay et le dock
// (lecture de l'état Streamer.bot, rendu du texte avec emotes, collecte des événements Twitch,
// données de démonstration)

const MEA_VARIABLE = 'messageEnAvant';
const MEA_SOURCE = 'message-en-avant';

// Lit la valeur de la variable Streamer.bot (chaîne JSON) ; null si illisible
function ParseMea(raw) {
	let data = raw;
	if (typeof raw === 'string') {
		try { data = JSON.parse(raw); } catch (e) { data = null; }
	}
	if (!data || typeof data !== 'object') return null;
	data.config = data.config && typeof data.config === 'object' ? data.config : {};
	data.qa = Array.isArray(data.qa) ? data.qa : [];
	data.highlights = Array.isArray(data.highlights) ? data.highlights : [];
	data.queue = Array.isArray(data.queue) ? data.queue : [];
	data.current = data.current && typeof data.current === 'object' && data.current.id ? data.current : null;
	data.perle = data.perle && typeof data.perle === 'object' ? data.perle : { n: 0 };
	return data;
}

// Retrouve un message par son identifiant (affiché, questions, highlights)
function MeaFind(state, id) {
	if (!state || !id) return null;
	if (state.current && state.current.id === id) return state.current;
	return state.qa.find(x => x.id === id) || state.highlights.find(x => x.id === id) || null;
}

function MeaEscape(text) {
	return String(text === undefined || text === null ? '' : text)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Texte du message en HTML : morceaux { t: 'text', v } et { t: 'emote', v: nom, u: image }
function MeaPartsHTML(item) {
	const parts = Array.isArray(item && item.parts) && item.parts.length ? item.parts : [{ t: 'text', v: (item && item.text) || '' }];
	return parts.map(p => {
		if (p && p.t === 'emote' && /^https:\/\//.test(String(p.u || '')))
			return `<img class="emote" src="${MeaEscape(p.u)}" alt="${MeaEscape(p.v)}" title="${MeaEscape(p.v)}">`;
		return MeaEscape(p && p.v);
	}).join('');
}

// Longueur « lisible » du message (une emote compte pour 2 caractères)
function MeaTextLength(item) {
	const parts = Array.isArray(item && item.parts) && item.parts.length ? item.parts : [{ t: 'text', v: (item && item.text) || '' }];
	return parts.reduce((n, p) => n + (p && p.t === 'emote' ? 2 : String((p && p.v) || '').length), 0);
}

// Morceaux Twitch (Streamer.bot) vers le format court stocké dans la variable
function MeaPartsFromTwitch(parts, text) {
	if (!Array.isArray(parts) || !parts.length) return [{ t: 'text', v: String(text || '') }];
	const out = [];
	parts.forEach(p => {
		if (!p) return;
		const url = p.imageUrl || p.image || p.url || '';
		if ((p.type === 'emote' || p.emoji || p.type === 'cheer') && url) out.push({ t: 'emote', v: String(p.text || ''), u: String(url) });
		else {
			const v = String(p.text || '');
			const last = out[out.length - 1];
			if (last && last.t === 'text') last.v += v;
			else out.push({ t: 'text', v });
		}
	});
	return out.length ? out : [{ t: 'text', v: String(text || '') }];
}

// Avatar Twitch par decapi (mis en cache)
const meaAvatarCache = new Map();
async function MeaAvatar(login) {
	login = String(login || '').toLowerCase().trim();
	if (!login) return '';
	if (meaAvatarCache.has(login)) return meaAvatarCache.get(login);
	let url = '';
	try {
		const r = await fetch('https://decapi.me/twitch/avatar/' + encodeURIComponent(login));
		const t = (await r.text()).trim();
		if (/^https:\/\//.test(t)) url = t;
	} catch (e) { }
	meaAvatarCache.set(login, url);
	return url;
}

// Couleur d'avatar de secours (initiale) : dérivée du pseudo
function MeaInitialColor(name) {
	const colors = ['#FF375F', '#FF9F0A', '#FFD60A', '#30D158', '#64D2FF', '#0A84FF', '#5E5CE6', '#BF5AF2'];
	let h = 0;
	for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return colors[h % colors.length];
}

function MeaInitial(name) {
	const first = Array.from(String(name || '?').trim())[0] || '?';
	return first.toUpperCase();
}

/////////////////////////////////////////
// COLLECTE DES ÉVÉNEMENTS TWITCH      //
/////////////////////////////////////////

// Écoute les rachats de points de chaîne (Q&A) et les réponses avec la commande (Highlight).
// L'overlay et le dock collectent en même temps : l'action ignore les doublons (msgId).
const MeaCollector = (function () {
	let opts = null;
	const messages = new Map();   // msgId → message récent (pour retrouver le message d'origine d'une réponse)
	const users = new Map();      // login → { color, badges } vus dans le chat
	const MAX = 500;

	function remember(map, key, value) {
		if (!key) return;
		map.delete(key);
		map.set(key, value);
		while (map.size > MAX) map.delete(map.keys().next().value);
	}

	function badgeUrls(list) {
		return (Array.isArray(list) ? list : []).map(b => String((b && (b.imageUrl || b.image || b.url)) || '')).filter(u => /^https:\/\//.test(u)).slice(0, 6);
	}

	function badgeNames(list) {
		return (Array.isArray(list) ? list : []).map(b => String((b && (b.name || b.setId || b.type)) || b || '').toLowerCase());
	}

	// Modo ou streameuse (Streamer.bot : role 3 = modérateur, 4 = diffuseur)
	function isStaff(d) {
		const u = d.user || {};
		const m = typeof d.message === 'object' && d.message ? d.message : {};
		if (Number(u.role) >= 3) return true;
		if (u.isModerator || u.isBroadcaster || u.moderator || u.broadcaster || m.isModerator || m.isBroadcaster) return true;
		const names = badgeNames(u.badges || m.badges);
		return names.includes('moderator') || names.includes('broadcaster') || names.includes('lead_moderator');
	}

	// Rôle dans le chat : 1 viewer, 2 VIP, 3 modo, 4 streameuse
	function roleLevel(d) {
		const u = d.user || {};
		const m = typeof d.message === 'object' && d.message ? d.message : {};
		const names = badgeNames(u.badges || m.badges);
		let level = Number(u.role) || 1;
		if (names.includes('broadcaster') || u.isBroadcaster) level = Math.max(level, 4);
		if (names.includes('moderator') || names.includes('lead_moderator') || u.isModerator) level = Math.max(level, 3);
		if (names.includes('vip') || u.isVip) level = Math.max(level, 2);
		return level;
	}
	const PERLE_LEVELS = { all: 1, vip: 2, mod: 3, broadcaster: 4 };

	// Message du chat Twitch (Streamer.bot 0.2 et 1.0) au format du widget
	function fromTwitchChat(d) {
		const u = d.user || {};
		const m = typeof d.message === 'object' && d.message ? d.message : {};
		const text = typeof d.text === 'string' ? d.text : (typeof d.message === 'string' ? d.message : (m.message || m.text || ''));
		return {
			msgId: String(d.messageId || m.msgId || m.id || d.msgId || ''),
			userId: String(u.id || m.userId || d.userId || ''),
			login: String(u.login || m.username || d.userName || '').toLowerCase(),
			name: String(u.name || m.displayName || u.login || m.username || ''),
			color: String(u.color || m.color || ''),
			badges: badgeUrls(u.badges || m.badges),
			parts: MeaPartsFromTwitch(d.parts || m.parts, text),
			text: String(text || ''),
			at: Date.now(),
			reply: replyInfo(d)
		};
	}

	function replyInfo(d) {
		const m = typeof d.message === 'object' && d.message ? d.message : {};
		const r = d.reply || m.reply || null;
		if (!r || !(d.isReply || r.msgId || r.parentMsgId || r.parent_message_id)) return null;
		return {
			msgId: String(r.msgId || r.parentMsgId || r.parent_message_id || r.parentMessageId || r.id || ''),
			userId: String(r.userId || r.parentUserId || r.parent_user_id || ''),
			login: String(r.userLogin || r.parentUserLogin || r.parent_user_login || r.login || '').toLowerCase(),
			name: String(r.userName || r.parentUserName || r.parent_user_name || r.displayName || r.userLogin || ''),
			text: String(r.msgBody || r.parentMessageBody || r.parent_message_body || r.message || r.text || ''),
			threadMsgId: String(r.threadMsgId || r.threadParentMsgId || r.thread_message_id || r.threadMessageId || '')
		};
	}

	// Message « vu » à partir des infos de réponse (texte seul, sans emotes ni badges)
	function fromReply(reply) {
		const known = users.get(reply.login) || {};
		return {
			msgId: reply.msgId, userId: reply.userId || known.userId || '', login: reply.login, name: reply.name || known.name || reply.login,
			color: known.color || '', badges: known.badges || [], parts: [{ t: 'text', v: reply.text }], text: reply.text, reply: null
		};
	}

	// Texte d'une réponse sans le « @pseudo » du début (le fil montre déjà à qui elle répond)
	function withoutMention(msg, parentLogin, parentName) {
		const parts = (msg.parts || []).map(p => Object.assign({}, p));
		if (parts.length && parts[0].t === 'text') {
			const names = [parentLogin, parentName].filter(Boolean).map(n => '@' + String(n).toLowerCase());
			const v = parts[0].v;
			const hit = names.find(n => v.toLowerCase().startsWith(n));
			if (hit) parts[0].v = v.slice(hit.length).replace(/^[\s,:]+/, '');
		}
		return parts;
	}

	// Message sans infos de réponse mais qui commence par « @pseudo » : réponse au dernier message
	// de cette personne vu dans les 10 minutes précédentes (fils écrits à la main)
	function mentionParent(msg) {
		const m = /^@([A-Za-z0-9_]+)/.exec(String(msg.text || '').trim());
		if (!m) return null;
		const login = m[1].toLowerCase();
		const list = Array.from(messages.values());
		for (let i = list.length - 1; i >= 0; i--) {
			const x = list[i];
			if (x.msgId === msg.msgId || !(Number(x.at) < Number(msg.at))) continue;
			if (Number(msg.at) - Number(x.at) > 10 * 60 * 1000) break;
			if (x.login === login) return x;
		}
		return null;
	}

	// Fil de discussion d'un message : ses parents successifs jusqu'au message d'origine
	async function threadOf(src, max) {
		const chain = [src];
		const parentOf = new Map(); // msgId → parent (pour retirer le « @pseudo »)
		let cur = src;
		while (chain.length < 50) {
			let parent = null;
			if (cur.reply && cur.reply.msgId) parent = messages.get(cur.reply.msgId) || fromReply(cur.reply);
			else parent = mentionParent(cur);
			if (!parent || chain.some(x => x.msgId && x.msgId === parent.msgId)) break;
			parentOf.set(cur, parent);
			chain.unshift(parent);
			cur = parent;
		}
		// Message d'origine connu par son identifiant de fil, mais pas atteint en remontant
		const rootId = src.reply && src.reply.threadMsgId;
		const root = rootId ? messages.get(rootId) : null;
		if (root && chain[0].msgId !== rootId && !chain.includes(root)) chain.unshift(root);
		// Trop long : le message d'origine, puis les plus récents (les messages sautés sont signalés par des pointillés)
		let list = chain;
		let gap = false;
		if (list.length > max) { list = [chain[0]].concat(chain.slice(chain.length - (max - 1))); gap = true; }
		const out = [];
		for (let i = 0; i < list.length; i++) {
			const m = list[i];
			const parent = parentOf.get(m) || (m.reply ? { login: m.reply.login, name: m.reply.name } : null);
			out.push({
				name: m.name || m.login, login: m.login, color: m.color, badges: m.badges || [],
				avatar: await MeaAvatar(m.login),
				parts: i > 0 && parent ? withoutMention(m, parent.login, parent.name) : (m.parts || []),
				text: m.text, at: m.at || 0,
				gap: gap && i === 1
			});
		}
		return out;
	}

	// Texte de la commande : Twitch ajoute « @pseudo » au début d'une réponse
	function commandOf(text) {
		const words = String(text || '').trim().split(/\s+/).filter(Boolean);
		while (words.length && words[0].startsWith('@')) words.shift();
		return (words[0] || '').toLowerCase();
	}

	// Message d'origine d'une réponse : version complète (emotes, badges, couleur) si on l'a vu passer
	async function originalItem(reply, msg, prefix, kind) {
		const src = messages.get(reply.msgId) || fromReply(reply);
		const item = {
			id: prefix + (src.msgId || msg.msgId),
			kind,
			name: src.name || src.login,
			login: src.login,
			userId: src.userId,
			color: src.color,
			badges: src.badges,
			avatar: await MeaAvatar(src.login),
			parts: src.parts,
			text: src.text,
			at: src.at || Date.now(), // heure du message d'origine si on l'a vu passer
			by: msg.name || msg.login
		};
		// Perle d'une réponse : tout le fil sur la même image
		const cfg = opts && opts.getConfig();
		if (kind === 'perle' && cfg && cfg.perleThread) {
			const thread = await threadOf(src, Math.max(2, Number(cfg.perleThreadMax) || 3));
			if (thread.length > 1) item.thread = thread;
		}
		return item;
	}

	async function onChat(d) {
		if (!d) return;
		const msg = fromTwitchChat(d);
		if (msg.login) remember(users, msg.login, { color: msg.color, badges: msg.badges, userId: msg.userId, name: msg.name });

		const cfg = opts && opts.getConfig();
		const cmd = commandOf(msg.text);
		const highlightCmd = String((cfg && cfg.command) || '').trim().toLowerCase();
		const perleCmd = String((cfg && cfg.perleCommand) || '').trim().toLowerCase();
		const isHighlight = !!(cfg && cfg.highlight && highlightCmd && cmd === highlightCmd);
		const isPerle = !!(cfg && cfg.perles && perleCmd && cmd === perleCmd);
		const hideCmd = String((cfg && cfg.hideCommand) || '').trim().toLowerCase();

		// Commande pour masquer le message à l'écran (modo ou streameuse, sans réponse)
		if (hideCmd && cmd === hideCmd) {
			if (isStaff(d)) opts.send({ mode: 'hide', msgId: 'hd:' + msg.msgId });
			return;
		}

		if (!isHighlight && !isPerle) {
			// Message ordinaire : gardé en mémoire pour un éventuel highlight ou une perle
			if (msg.msgId) remember(messages, msg.msgId, msg);
			return;
		}
		const reply = replyInfo(d);
		if (!reply) return;
		if (isHighlight && !isStaff(d)) return;
		// Perle : rôle minimum choisi sur la page de paramétrage (tout le monde par défaut)
		if (!isHighlight && roleLevel(d) < (PERLE_LEVELS[cfg.perleWho] || 1)) return;

		if (isHighlight) {
			const item = await originalItem(reply, msg, 'hl:', 'highlight');
			opts.send({ mode: 'highlight', msgId: 'hl:' + msg.msgId, item: JSON.stringify(item) });
		} else {
			// Perle : envoyée sur Discord sans passer par l'overlay
			const item = await originalItem(reply, msg, 'pl:', 'perle');
			opts.send({ mode: 'perle', msgId: 'pl:' + msg.msgId, item: JSON.stringify(item), by: item.by, byLogin: msg.login, byStaff: isStaff(d) ? 'true' : 'false' });
		}
	}

	// Rachat de points de chaîne : plusieurs formes possibles selon la version de Streamer.bot
	async function onReward(d) {
		if (!d) return;
		const u = d.user && typeof d.user === 'object' ? d.user : {};
		const reward = d.reward && typeof d.reward === 'object' ? d.reward : {};
		const title = String(reward.title || reward.name || d.rewardName || d.rewardTitle || d.title || '').trim();
		const input = String(d.user_input || d.userInput || d.rawInput || d.input || d.message || '').trim();
		console.log(`[Message en avant] Rachat reçu : « ${title} »${input ? ' avec texte' : ' sans texte'}`, d);
		const cfg = opts && opts.getConfig();
		if (!cfg || !cfg.qa) return;
		const wanted = String(cfg.rewardName || '').trim().toLowerCase();
		if (!wanted || title.toLowerCase() !== wanted) return;
		if (!input) return;
		const login = String(d.user_login || d.userLogin || u.login || d.userName || '').toLowerCase();
		const name = String(d.user_name || d.displayName || u.name || u.display_name || d.user_display_name || (typeof d.user === 'string' ? d.user : '') || login);
		const known = users.get(login) || {};
		const rid = String(d.id || d.redemptionId || d.redemption_id || d.rewardRedemptionId || `${login}:${input}`);
		const item = {
			id: 'qa:' + rid,
			kind: 'qa',
			name,
			login,
			userId: String(d.user_id || d.userId || u.id || known.userId || ''),
			color: known.color || '',
			badges: known.badges || [],
			avatar: await MeaAvatar(login),
			parts: [{ t: 'text', v: input }],
			text: input,
			at: Date.now()
		};
		opts.send({ mode: 'qa', msgId: 'qa:' + rid, item: JSON.stringify(item) });
	}

	return {
		// opts : { sbClient, getConfig: () => { qa, rewardName, highlight, command, perles, perleCommand, hideCommand, perleWho, perleThread, perleThreadMax } | null, send: (args) => void }
		start(o) {
			opts = o;
			o.sbClient.on('Twitch.ChatMessage', ({ data }) => { onChat(data).catch(e => console.error('[Message en avant]', e)); });
			o.sbClient.on('Twitch.RewardRedemption', ({ data }) => { onReward(data).catch(e => console.error('[Message en avant]', e)); });
		}
	};
})();

////////////////////////////
// DONNÉES DE DÉMONSTRATION //
////////////////////////////

const MEA_DEMO_BADGES = {
	sub: 'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/2',
	vip: 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/2',
	mod: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/2'
};
const MEA_DEMO_EMOTES = {
	LUL: 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0',
	Kappa: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
	PogChamp: 'https://static-cdn.jtvnw.net/emoticons/v2/305954156/default/dark/2.0'
};

function MeaDemoItems() {
	const now = Date.now();
	return {
		question: {
			id: 'demo:qa', kind: 'qa', name: 'PixelPanda', login: 'pixelpanda', color: '#9B8CFF', badges: [MEA_DEMO_BADGES.sub],
			avatar: '', parts: [{ t: 'text', v: 'Tu comptes refaire un stream Silent Hill avant Noël ? Le dernier était incroyable' }], at: now
		},
		highlight: {
			id: 'demo:hl', kind: 'highlight', name: 'Biscotte', login: 'biscotte', color: '#FF7F50', badges: [MEA_DEMO_BADGES.vip, MEA_DEMO_BADGES.sub],
			avatar: '', parts: [{ t: 'text', v: 'elle a pris la porte de la cave pour la sortie de secours ' }, { t: 'emote', v: 'LUL', u: MEA_DEMO_EMOTES.LUL }, { t: 'text', v: ' ' }, { t: 'emote', v: 'LUL', u: MEA_DEMO_EMOTES.LUL }],
			at: now, by: 'Nougatine'
		},
		long: {
			id: 'demo:long', kind: 'qa', name: 'Le_Grand_Marmiton', login: 'le_grand_marmiton', color: '#30D158', badges: [MEA_DEMO_BADGES.mod],
			avatar: '', parts: [{ t: 'text', v: 'Question un peu longue : si tu devais choisir un seul jeu à refaire entièrement en aveugle, sans guide et sans le chat pour t’aider, avec seulement une lampe torche et trois sauvegardes, ce serait lequel et pourquoi ? Et est-ce que tu ferais un marathon ou plusieurs soirées ' }, { t: 'emote', v: 'Kappa', u: MEA_DEMO_EMOTES.Kappa }],
			at: now
		}
	};
}

// Fil de discussion d'exemple (aperçu de l'image Discord)
function MeaDemoThread() {
	const now = Date.now();
	const thread = [
		{ name: 'Biscotte', login: 'biscotte', color: '#FF7F50', badges: [MEA_DEMO_BADGES.vip], avatar: '', parts: [{ t: 'text', v: 'qui a mangé la dernière part de pizza ?' }], at: now - 240000 },
		{ name: 'Nougatine', login: 'nougatine', color: '#64D2FF', badges: [MEA_DEMO_BADGES.sub], avatar: '', parts: [{ t: 'text', v: 'c’est le chat, je le jure' }], at: now - 120000, gap: true },
		{ name: 'PixelPanda', login: 'pixelpanda', color: '#9B8CFF', badges: [MEA_DEMO_BADGES.mod], avatar: '', parts: [{ t: 'text', v: 'le chat a des miettes sur les moustaches ' }, { t: 'emote', v: 'LUL', u: MEA_DEMO_EMOTES.LUL }], at: now - 60000 }
	];
	return Object.assign({ id: 'demo:thread', kind: 'perle', thread }, thread[thread.length - 1]);
}

/////////////////////////////////////////////
// PALETTE DE L'AVATAR (façon nutty / Vibrant) //
/////////////////////////////////////////////

// Six teintes tirées d'une image : vibrant, muted, darkVibrant, darkMuted, lightVibrant, lightMuted
// (couleurs hexadécimales). Image illisible : palette dérivée de la couleur de secours.
const meaPaletteCache = new Map();

function MeaRgbToHsl(r, g, b) {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	let h = 0, s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
		h /= 6;
	}
	return [h, s, l];
}

function MeaHslToHex(h, s, l) {
	const f = (n) => {
		const k = (n + h * 12) % 12;
		const a = s * Math.min(l, 1 - l);
		const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(c * 255).toString(16).padStart(2, '0');
	};
	return '#' + f(0) + f(8) + f(4);
}

function MeaHexToRgb(hex) {
	let h = String(hex || '').replace('#', '');
	if (h.length === 3) h = h.split('').map(c => c + c).join('');
	const n = parseInt(h.slice(0, 6), 16);
	return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [94, 92, 230];
}

// Palette construite à partir d'une seule couleur (pseudo Twitch, ou repli)
function MeaPaletteFromColor(hex) {
	const [r, g, b] = MeaHexToRgb(hex || '#5E5CE6');
	const [h, s0] = MeaRgbToHsl(r, g, b);
	const s = Math.max(0.45, s0);
	return {
		vibrant: MeaHslToHex(h, s, 0.5), muted: MeaHslToHex(h, 0.25, 0.5),
		darkVibrant: MeaHslToHex(h, s, 0.26), darkMuted: MeaHslToHex(h, 0.22, 0.22),
		lightVibrant: MeaHslToHex(h, s, 0.74), lightMuted: MeaHslToHex(h, 0.25, 0.76)
	};
}

// Choix des teintes : mêmes cibles de saturation et de luminosité que Vibrant.js
function MeaPaletteFromPixels(data) {
	const buckets = new Map();
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 125) continue;
		const r = data[i], g = data[i + 1], b = data[i + 2];
		if (r > 250 && g > 250 && b > 250) continue;
		const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
		const x = buckets.get(key) || [0, 0, 0, 0];
		x[0] += r; x[1] += g; x[2] += b; x[3]++;
		buckets.set(key, x);
	}
	const swatches = [];
	let maxPop = 1;
	buckets.forEach(([r, g, b, n]) => {
		const rgb = [r / n, g / n, b / n];
		swatches.push({ rgb, hsl: MeaRgbToHsl(...rgb), pop: n });
		maxPop = Math.max(maxPop, n);
	});
	if (!swatches.length) return null;
	const targets = {
		vibrant: [0.5, 0.3, 0.7, 1, 0.35, 1],
		lightVibrant: [0.74, 0.55, 1, 1, 0.35, 1],
		darkVibrant: [0.26, 0, 0.45, 1, 0.35, 1],
		muted: [0.5, 0.3, 0.7, 0.3, 0, 0.4],
		lightMuted: [0.74, 0.55, 1, 0.3, 0, 0.4],
		darkMuted: [0.26, 0, 0.45, 0.3, 0, 0.4]
	};
	const used = new Set();
	const out = {};
	Object.entries(targets).forEach(([name, [tl, minL, maxL, ts, minS, maxS]]) => {
		let best = null, bestScore = -1;
		swatches.forEach(sw => {
			const [, s, l] = sw.hsl;
			if (used.has(sw) || s < minS || s > maxS || l < minL || l > maxL) return;
			const score = (1 - Math.abs(s - ts)) * 3 + (1 - Math.abs(l - tl)) * 6.5 + (sw.pop / maxPop) * 0.5;
			if (score > bestScore) { bestScore = score; best = sw; }
		});
		if (best) { used.add(best); out[name] = MeaHslToHex(...best.hsl); }
	});
	// Teintes manquantes : dérivées de la plus proche
	const base = out.vibrant || out.darkVibrant || out.lightVibrant || out.muted || out.darkMuted || out.lightMuted;
	if (!base) return null;
	const derived = MeaPaletteFromColor(base);
	Object.keys(targets).forEach(k => { if (!out[k]) out[k] = derived[k]; });
	return out;
}

function MeaPalette(url, fallbackColor) {
	const key = `${url || ''}|${fallbackColor || ''}`;
	if (meaPaletteCache.has(key)) return meaPaletteCache.get(key);
	const p = new Promise(resolve => {
		if (!url || !/^https:\/\//.test(url)) { resolve(MeaPaletteFromColor(fallbackColor)); return; }
		const img = new Image();
		img.crossOrigin = 'anonymous';
		const done = (pal) => resolve(pal || MeaPaletteFromColor(fallbackColor));
		img.onload = () => {
			try {
				const c = document.createElement('canvas');
				c.width = c.height = 48;
				const ctx = c.getContext('2d', { willReadFrequently: true });
				ctx.drawImage(img, 0, 0, 48, 48);
				done(MeaPaletteFromPixels(ctx.getImageData(0, 0, 48, 48).data));
			} catch (e) { done(null); }
		};
		img.onerror = () => done(null);
		setTimeout(() => done(null), 5000);
		img.src = url;
	});
	meaPaletteCache.set(key, p);
	return p;
}

// Contraste (WCAG) entre deux couleurs hexadécimales
function MeaContrast(a, b) {
	const lum = (hex) => {
		const v = MeaHexToRgb(hex).map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
		return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
	};
	const la = lum(a), lb = lum(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Mélange de deux couleurs (t : part de la seconde, de 0 à 1)
function MeaMix(a, b, t) {
	const x = MeaHexToRgb(a), y = MeaHexToRgb(b);
	return '#' + x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('');
}

// Couleurs d'un message selon le mode choisi : fond, pseudo, texte, accent (texte toujours lisible)
function MeaPaletteColors(pal, mode) {
	let bg, name, text, accent;
	if (mode === 'matteLight') {
		bg = pal.lightVibrant; name = pal.darkVibrant; text = MeaMix(pal.darkMuted, '#000000', 0.35); accent = pal.darkVibrant;
	} else if (mode === 'vibrant') {
		bg = MeaMix(pal.vibrant, '#000000', 0.35); name = '#FFFFFF'; text = '#FFFFFF'; accent = pal.lightVibrant;
	} else {
		bg = MeaMix(pal.darkMuted, '#000000', 0.55); name = pal.lightVibrant; text = MeaMix(pal.lightMuted, '#FFFFFF', 0.8); accent = pal.vibrant;
	}
	const readable = (fg, min) => (MeaContrast(fg, bg) >= min ? fg : (MeaContrast('#FFFFFF', bg) >= MeaContrast('#000000', bg) ? '#FFFFFF' : '#000000'));
	return { bg, name: readable(name, 3), text: readable(text, 4.5), accent };
}
