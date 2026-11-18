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
			text: String(text || '')
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
			text: String(r.msgBody || r.parentMessageBody || r.parent_message_body || r.message || r.text || '')
		};
	}

	// Texte de la commande : Twitch ajoute « @pseudo » au début d'une réponse
	function commandOf(text) {
		const words = String(text || '').trim().split(/\s+/).filter(Boolean);
		while (words.length && words[0].startsWith('@')) words.shift();
		return (words[0] || '').toLowerCase();
	}

	// Message d'origine d'une réponse : version complète (emotes, badges, couleur) si on l'a vu passer
	async function originalItem(reply, msg, prefix, kind) {
		const seen = messages.get(reply.msgId);
		const known = users.get(reply.login) || {};
		const src = seen || {
			msgId: reply.msgId, userId: reply.userId || known.userId || '', login: reply.login, name: reply.name || known.name || reply.login,
			color: known.color || '', badges: known.badges || [], parts: [{ t: 'text', v: reply.text }], text: reply.text
		};
		return {
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
			at: Date.now(),
			by: msg.name || msg.login
		};
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

		if (!isHighlight && !isPerle) {
			// Message ordinaire : gardé en mémoire pour un éventuel highlight ou une perle
			if (msg.msgId) remember(messages, msg.msgId, msg);
			return;
		}
		const reply = replyInfo(d);
		if (!reply || !isStaff(d)) return;

		if (isHighlight) {
			const item = await originalItem(reply, msg, 'hl:', 'highlight');
			opts.send({ mode: 'highlight', msgId: 'hl:' + msg.msgId, item: JSON.stringify(item) });
		} else {
			// Perle : envoyée sur Discord sans passer par l'overlay
			const item = await originalItem(reply, msg, 'pl:', 'perle');
			opts.send({ mode: 'perle', msgId: 'pl:' + msg.msgId, item: JSON.stringify(item), by: item.by });
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
		// opts : { sbClient, getConfig: () => { qa, rewardName, highlight, command, perles, perleCommand } | null, send: (args) => void }
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
