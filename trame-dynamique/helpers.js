// Trame dynamique : outils de couleur et de palette

// Les 6 rôles de Vibrant, dans l'ordre d'affichage de l'aperçu
const ROLES = ['Vibrant', 'Muted', 'DarkVibrant', 'DarkMuted', 'LightVibrant', 'LightMuted'];
const ROLE_LABELS = {
	Vibrant: 'Vibrant', Muted: 'Muted', DarkVibrant: 'Dark Vibrant',
	DarkMuted: 'Dark Muted', LightVibrant: 'Light Vibrant', LightMuted: 'Light Muted'
};

// Rôles choisis par chaque ambiance (le mono prend le premier, le duo les deux premiers)
const AMBIANCES = {
	vive: ['Vibrant', 'DarkVibrant', 'LightVibrant'],
	douce: ['Muted', 'DarkMuted', 'LightMuted'],
	sombre: ['DarkVibrant', 'DarkMuted', 'Vibrant']
};

///////////////
// COULEURS  //
///////////////

function HexToRgb(hex) {
	let h = String(hex || '').replace('#', '').trim();
	if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
	const n = parseInt(h.slice(0, 6), 16);
	if (!Number.isFinite(n)) return [0, 0, 0];
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function RgbToHex(rgb) {
	return '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// Mélange de deux couleurs [r,g,b] (k = 0 : a, k = 1 : b)
function MixRgb(a, b, k) {
	return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Luminance perçue (0 à 1)
function Luma(rgb) {
	return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
}

// Distance entre deux couleurs (0 à ~442)
function ColorDistance(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function Rgba(rgb, alpha) {
	return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${alpha})`;
}

//////////////////////////////
// CHOIX DES TEINTES        //
//////////////////////////////

// Rôles à utiliser selon le nombre de couleurs, le mode (auto / manuel) et l'ambiance.
// Garde-fou : si deux teintes sont identiques ou trop proches (Vibrant recopie parfois
// un rôle qu'il n'a pas trouvé), on prend le rôle restant le plus différent.
function PickRoles(palette, s) {
	const count = s.colorCount === 'trio' ? 3 : s.colorCount === 'duo' ? 2 : 1;
	const wanted = s.colorPick === 'manual'
		? [s.role1, s.role2, s.role3]
		: (AMBIANCES[s.ambiance] || AMBIANCES.vive);

	const picked = [];
	for (let i = 0; i < count; i++) {
		let role = wanted[i];
		const tooClose = (r) => !palette[r] || picked.some(p => palette[p] && ColorDistance(HexToRgb(palette[p]), HexToRgb(palette[r])) < 28);
		if (tooClose(role)) {
			// Rôle restant le plus éloigné des teintes déjà prises
			let best = null, bestD = -1;
			for (const r of ROLES) {
				if (picked.includes(r) || !palette[r]) continue;
				const d = picked.length
					? Math.min(...picked.map(p => ColorDistance(HexToRgb(palette[p]), HexToRgb(palette[r]))))
					: 999;
				if (d > bestD) { bestD = d; best = r; }
			}
			if (best && (picked.length === 0 || bestD >= 28 || !palette[role])) role = best;
		}
		if (palette[role]) picked.push(role);
	}
	return picked;
}

// Jeu de travail des thèmes : bg (la plus sombre), mid, hi (la plus claire)
// + list (les teintes utilisées pour les éléments)
function BuildWorkingSet(hexColors, count, autoShades) {
	const cols = hexColors.map(HexToRgb);
	if (!cols.length) cols.push([138, 92, 246]);

	let bg, mid, hi;
	if (cols.length === 1) {
		const c = cols[0];
		if (autoShades) {
			bg = MixRgb(c, [0, 0, 0], 0.62);
			mid = c;
			hi = MixRgb(c, [255, 255, 255], 0.38);
		} else {
			bg = c; mid = c; hi = c;
		}
	} else {
		const sorted = cols.slice().sort((a, b) => Luma(a) - Luma(b));
		bg = sorted[0];
		hi = sorted[sorted.length - 1];
		mid = sorted.length === 3 ? sorted[1] : MixRgb(bg, hi, 0.5);
	}
	return { bg, mid, hi };
}

// Transition douce d'un jeu de couleurs vers un autre
function LerpSet(a, b, k) {
	return { bg: MixRgb(a.bg, b.bg, k), mid: MixRgb(a.mid, b.mid, k), hi: MixRgb(a.hi, b.hi, k) };
}

// Couleurs personnalisées : palette « fictive » pour l'affichage de l'aperçu
function CustomPalette(s) {
	const list = [s.color1];
	if (s.colorCount !== 'mono') list.push(s.color2);
	if (s.colorCount === 'trio') list.push(s.color3);
	return list;
}

/////////////////////////
// HASARD REPRODUCTIBLE //
/////////////////////////

// Générateur pseudo-aléatoire à graine : les trames restent identiques d'un chargement à l'autre
function SeededRandom(seed) {
	let a = seed >>> 0;
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

///////////////////////
// IMAGES DE JAQUETTE //
///////////////////////

// Jaquette Twitch : par identifiant de catégorie (fiable) ou par nom (anciennes URL)
function BoxArtURL(game, w = 285, h = 380) {
	if (!game) return '';
	if (game.boxArt) {
		const u = String(game.boxArt);
		if (u.includes('{width}')) return u.replace('{width}', w).replace('{height}', h);
		return u.replace(/-\d+x\d+(\.[a-z]+)(\?.*)?$/i, `-${w}x${h}$1`);
	}
	if (game.id) return `https://static-cdn.jtvnw.net/ttv-boxart/${encodeURIComponent(game.id)}-${w}x${h}.jpg`;
	if (game.name) return `https://static-cdn.jtvnw.net/ttv-boxart/${encodeURIComponent(game.name)}-${w}x${h}.jpg`;
	return '';
}
