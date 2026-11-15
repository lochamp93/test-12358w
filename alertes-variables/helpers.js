// Alertes variables : outils de l'overlay : lecture des événements, règles, fichiers

// gift : abonnement offert à une personne ; giftbomb : plusieurs abonnements offerts à la communauté
const ALERT_TYPES = ['follow', 'sub', 'resub', 'gift', 'giftbomb', 'cheer', 'raid'];

// Noms de fichiers acceptés pour chaque type (sans extension), dans l'ordre de préférence
const FILE_NAMES = {
	follow: ['follow'],
	sub: ['sub', 'abonnement'],
	resub: ['resub', 'reabonnement', 'sub'], // sans fichier dédié : celui de l'abonnement
	gift: ['gift', 'subgift'],
	giftbomb: ['giftbomb', 'bomb', 'gift', 'subgift'], // sans fichier dédié : celui de l'abonnement offert
	cheer: ['cheer', 'bits', 'don'],
	raid: ['raid']
};
const FALLBACK_NAME = 'alerte';

const VISUAL_EXT = ['webm', 'mp4', 'gif', 'webp', 'apng', 'png', 'jpg', 'jpeg', 'svg'];
const VIDEO_EXT = ['webm', 'mp4'];
const SOUND_EXT = ['mp3', 'ogg', 'wav', 'm4a'];

// Événements Streamer.bot → type d'alerte (un événement inconnu de la version installée est ignoré)
const EVENT_MAP = [
	['Twitch', 'Follow', 'follow'],
	['Twitch', 'Sub', 'sub'],
	['Twitch', 'ReSub', 'resub'],
	['Twitch', 'GiftSub', 'gift'],
	['Twitch', 'GiftBomb', 'giftbomb'],
	['Twitch', 'Cheer', 'cheer'],
	['Twitch', 'Raid', 'raid'],
	['Kick', 'Follow', 'follow'],
	['Kick', 'Subscription', 'sub'],
	['Kick', 'Resubscription', 'resub'],
	['Kick', 'GiftSubscription', 'gift'],
	['Kick', 'MassGiftSubscription', 'giftbomb'],
	['YouTube', 'NewSubscriber', 'follow'],
	['YouTube', 'NewSponsor', 'sub'],
	['YouTube', 'MemberMileStone', 'resub'],
	['YouTube', 'MembershipGift', 'giftbomb'],
	['YouTube', 'GiftMembershipReceived', 'gift'],
	['YouTube', 'SuperChat', 'cheer'],
	['YouTube', 'SuperSticker', 'cheer'],
	['TikTok', 'Follow', 'follow'],
	['TikTok', 'Subscribe', 'sub'],
	['TikTok', 'Gift', 'cheer']
];

// Texte normalisé pour comparer : minuscules, sans accents, espaces réduits
function Normalize(text) {
	return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function SplitList(text) {
	return String(text || '').split(',').map(Normalize).filter(Boolean);
}

// Lit la première valeur présente parmi plusieurs chemins ("user.name", "message.bits"…)
function Pick(obj, paths) {
	for (const path of paths) {
		let v = obj;
		for (const key of path.split('.')) {
			if (v === null || v === undefined) break;
			v = v[key];
		}
		if (v !== null && v !== undefined && v !== '' && typeof v !== 'object') return v;
	}
	return undefined;
}

// Extrait les infos utiles d'un événement Streamer.bot, quelle que soit la plateforme
function ParseEvent(source, eventType, type, data) {
	const d = data || {};
	const user = Pick(d, ['user.display_name', 'user.displayName', 'user.name', 'displayName', 'display_name',
		'userName', 'user_name', 'username', 'user.login', 'from_broadcaster_user_name', 'fromBroadcasterUserName',
		'from_broadcaster.name', 'from.name', 'author.name', 'name']) || 'Anonyme';

	const months = Number(Pick(d, ['cumulativeMonths', 'cumulative_months', 'cumulative', 'months',
		'duration_months', 'monthsSubscribed', 'user.months', 'milestone'])) || 1;

	let count = Number(Pick(d, ['total', 'gifts', 'count', 'amount', 'totalGifts', 'quantity', 'giftCount'])) || 1;
	if (eventType === 'GiftSub' || eventType === 'GiftSubscription') count = Number(Pick(d, ['total', 'count'])) || 1;

	let amount;
	if (source === 'Twitch') {
		const bits = Number(Pick(d, ['bits', 'message.bits', 'amount'])) || 0;
		amount = `${bits} bit${bits > 1 ? 's' : ''}`;
	} else {
		amount = String(Pick(d, ['amountString', 'formattedAmount', 'amountDisplay', 'amount', 'diamondCount', 'repeatCount', 'value']) || '');
	}
	const bits = Number(Pick(d, ['bits', 'message.bits'])) || 0;

	const viewers = Number(Pick(d, ['viewers', 'viewerCount', 'viewer_count', 'viewersCount'])) || 0;

	// Montant en nombre (règles « à partir de N ») : bits, pièces TikTok ou montant d'un Super Chat
	let value = bits;
	if (!value) {
		const raw = Pick(d, ['diamondCount', 'coins', 'amount', 'microAmount', 'value', 'amountString', 'formattedAmount']);
		value = typeof raw === 'number' ? raw : parseFloat(String(raw || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
		if (Pick(d, ['microAmount']) && raw === Pick(d, ['microAmount'])) value = value / 1000000;
		if (source === 'TikTok') value *= Number(Pick(d, ['repeatCount'])) || 1;
	}

	// Type d'abonnement (règles d'Abonnement) : prime, tier1, tier2, tier3
	const tierRaw = String(Pick(d, ['subTier', 'sub_tier', 'tier', 'subPlan', 'sub_plan', 'plan']) ?? '').toLowerCase();
	let tier = '';
	if (d.isPrime || d.is_prime || tierRaw.includes('prime')) tier = 'prime';
	else if (/3000|3/.test(tierRaw)) tier = 'tier3';
	else if (/2000|2/.test(tierRaw)) tier = 'tier2';
	else if (/1000|1/.test(tierRaw) || tierRaw === '0') tier = 'tier1';

	// Personne qui reçoit l'abonnement offert ({recipient}) ; plusieurs : noms séparés par des virgules
	let recipient = Pick(d, ['recipient.display_name', 'recipient.displayName', 'recipient.name', 'recipientUser.name',
		'recipientUser.display_name', 'recipient_display_name', 'recipientDisplayName', 'recipientUserName',
		'recipient_user_name', 'recipientName', 'giftee.name', 'giftee.username', 'recipient']);
	const many = ['recipients', 'giftees', 'gifted_usernames', 'giftedUsernames'].map(k => d[k]).find(Array.isArray);
	if (!recipient && Array.isArray(many))
		recipient = many.map(x => (x && typeof x === 'object') ? (x.display_name || x.displayName || x.username || x.name || '') : x)
			.filter(Boolean).join(', ');
	recipient = typeof recipient === 'object' ? '' : String(recipient || '');

	// Photo de profil si l'événement la fournit (sinon le dock la cherche ou affiche l'initiale)
	const avatar = String(Pick(d, ['user.profileImageUrl', 'user.profile_image_url', 'user.profilePicture',
		'user.profilePictureUrl', 'user.avatar', 'profileImageUrl', 'profile_image_url', 'profilePictureUrl',
		'author.profileImageUrl', 'author.profileImage', 'avatar', 'userAvatar']) || '');

	const message = String(Pick(d, ['message.message', 'message.text', 'text', 'message', 'userMessage', 'comment']) || '');

	// Twitch : chaque abonnement d'un « gift bomb » arrive aussi seul : on garde uniquement le total
	const fromBomb = !!(d.fromCommunitySubGift || d.isFromGiftBomb || d.fromGiftBomb || d.communityGift || d.isCommunityGift);

	return { platform: source, eventType, type, user: String(user), recipient, avatar, months, count, amount, bits, value, tier, viewers, message, fromBomb };
}

// Remplit un texte d'alerte : {user} et les nombres prennent la couleur du pseudo
function FillTemplate(template, info) {
	const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
	const values = { user: info.user, recipient: info.recipient || '', months: info.months, count: info.count, amount: info.amount, viewers: info.viewers };
	return esc(template).replace(/\{(user|recipient|months|count|amount|viewers)\}/g, (m, k) => `<span class="accent">${esc(values[k])}</span>`);
}

// Fichiers d'un dossier : { nomEnMinuscules: nomRéel }
function IndexFiles(list) {
	const index = {};
	for (const f of list || []) index[String(f).toLowerCase()] = String(f);
	return index;
}

// Cherche le fichier d'un type dans un dossier : nom du type, puis « alerte »
function FindFile(folderFiles, type, extensions, withFallbackName = true) {
	if (!folderFiles) return null;
	const names = [...(FILE_NAMES[type] || [type])];
	if (withFallbackName) names.push(FALLBACK_NAME);
	for (const name of names) {
		for (const ext of extensions) {
			const real = folderFiles[`${name}.${ext}`];
			if (real) return real;
		}
	}
	return null;
}

function IsVideo(fileName) {
	const ext = String(fileName || '').split('.').pop().toLowerCase();
	return VIDEO_EXT.includes(ext);
}

// Visuel de démonstration (SVG généré) quand aucun fichier n'est disponible dans l'aperçu
function DemoVisual(type) {
	const emoji = { follow: '💜', sub: '⭐', resub: '🔁', gift: '🎁', giftbomb: '💣', cheer: '💎', raid: '🚀' }[type] || '🔔';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><radialGradient id="g"><stop offset="0" stop-color="#ff4d6d" stop-opacity=".55"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="url(#g)"/><text x="100" y="128" font-size="96" text-anchor="middle">${emoji}</text></svg>`;
	return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const DEMO_INFO = {
	follow: { user: 'Viewer_Test', months: 1, count: 1, amount: '', viewers: 0, message: '' },
	sub: { user: 'Viewer_Test', months: 1, count: 1, amount: '', viewers: 0, message: '', tier: 'tier1' },
	resub: { user: 'Viewer_Test', months: 14, count: 1, amount: '', viewers: 0, message: 'Toujours là pour les lives horreur 👻' },
	gift: { user: 'Viewer_Test', recipient: 'Viewer_Chanceux', months: 1, count: 1, amount: '', viewers: 0, message: '' },
	giftbomb: { user: 'Viewer_Test', months: 1, count: 5, amount: '', viewers: 0, message: '' },
	cheer: { user: 'Viewer_Test', months: 1, count: 1, amount: '500 bits', bits: 500, value: 500, viewers: 0, message: 'Prends ça pour le courage !' },
	raid: { user: 'Viewer_Test', months: 1, count: 1, amount: '', viewers: 42, message: '' }
};
