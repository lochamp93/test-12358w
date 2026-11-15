// Alertes variables — outils de l'overlay : lecture des événements, règles, fichiers

const ALERT_TYPES = ['follow', 'sub', 'resub', 'gift', 'cheer', 'raid'];

// Noms de fichiers acceptés pour chaque type (sans extension), dans l'ordre de préférence
const FILE_NAMES = {
	follow: ['follow'],
	sub: ['sub', 'abonnement'],
	resub: ['resub', 'reabonnement'],
	gift: ['gift', 'subgift'],
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
	['Twitch', 'GiftBomb', 'gift'],
	['Twitch', 'Cheer', 'cheer'],
	['Twitch', 'Raid', 'raid'],
	['Kick', 'Follow', 'follow'],
	['Kick', 'Subscription', 'sub'],
	['Kick', 'Resubscription', 'resub'],
	['Kick', 'GiftSubscription', 'gift'],
	['Kick', 'MassGiftSubscription', 'gift'],
	['YouTube', 'NewSubscriber', 'follow'],
	['YouTube', 'NewSponsor', 'sub'],
	['YouTube', 'MemberMileStone', 'resub'],
	['YouTube', 'MembershipGift', 'gift'],
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

	const message = String(Pick(d, ['message.message', 'message.text', 'text', 'message', 'userMessage', 'comment']) || '');

	// Twitch : chaque abonnement d'un « gift bomb » arrive aussi seul — on garde uniquement le total
	const fromBomb = !!(d.fromCommunitySubGift || d.isFromGiftBomb || d.fromGiftBomb || d.communityGift || d.isCommunityGift);

	return { platform: source, eventType, type, user: String(user), months, count, amount, bits, viewers, message, fromBomb };
}

// Remplit un texte d'alerte : {user} et les nombres prennent la couleur du pseudo
function FillTemplate(template, info) {
	const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
	const values = { user: info.user, months: info.months, count: info.count, amount: info.amount, viewers: info.viewers };
	return esc(template).replace(/\{(user|months|count|amount|viewers)\}/g, (m, k) => `<span class="accent">${esc(values[k])}</span>`);
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
	const emoji = { follow: '💜', sub: '⭐', resub: '🔁', gift: '🎁', cheer: '💎', raid: '🚀' }[type] || '🔔';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><radialGradient id="g"><stop offset="0" stop-color="#ff4d6d" stop-opacity=".55"/><stop offset="1" stop-color="#ff4d6d" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="url(#g)"/><text x="100" y="128" font-size="96" text-anchor="middle">${emoji}</text></svg>`;
	return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const DEMO_INFO = {
	follow: { user: 'Viewer_Test', months: 1, count: 1, amount: '', viewers: 0, message: '' },
	sub: { user: 'Viewer_Test', months: 1, count: 1, amount: '', viewers: 0, message: '' },
	resub: { user: 'Viewer_Test', months: 14, count: 1, amount: '', viewers: 0, message: 'Toujours là pour les lives horreur 👻' },
	gift: { user: 'Viewer_Test', months: 1, count: 5, amount: '', viewers: 0, message: '' },
	cheer: { user: 'Viewer_Test', months: 1, count: 1, amount: '500 bits', bits: 500, viewers: 0, message: 'Prends ça pour le courage !' },
	raid: { user: 'Viewer_Test', months: 1, count: 1, amount: '', viewers: 42, message: '' }
};
