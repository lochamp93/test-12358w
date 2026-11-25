// Trame dynamique : outils de couleur et de palette

// Les 6 rôles (mêmes noms que Vibrant), dans l'ordre d'affichage de l'aperçu
const ROLES = ['Vibrant', 'Muted', 'DarkVibrant', 'DarkMuted', 'LightVibrant', 'LightMuted'];
// Couleurs dominantes : les plus présentes dans l'image
const DOMINANTS = ['Dominant1', 'Dominant2', 'Dominant3'];
// Accents : petites touches de couleur vive (un logo rouge, un mot orange…)
const ACCENTS = ['Accent1', 'Accent2'];
const ALL_KEYS = DOMINANTS.concat(ACCENTS, ROLES);
const ROLE_LABELS = {
	Vibrant: 'Vibrant', Muted: 'Muted', DarkVibrant: 'Dark Vibrant',
	DarkMuted: 'Dark Muted', LightVibrant: 'Light Vibrant', LightMuted: 'Light Muted',
	Dominant1: 'Dominante 1', Dominant2: 'Dominante 2', Dominant3: 'Dominante 3',
	Accent1: 'Accent 1', Accent2: 'Accent 2'
};

// Rôles choisis par chaque ambiance (le mono prend le premier, le duo les deux premiers)
const AMBIANCES = {
	dominantes: ['Dominant1', 'Dominant2', 'Dominant3'],
	mixte: ['Dominant1', 'Accent1', 'Dominant2'],
	accents: ['Accent1', 'Accent2', 'Dominant1'],
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
// ANALYSE D'UNE IMAGE      //
//////////////////////////////

function RgbToHsl(c) {
	const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [h / 6, s, l];
}

// Cibles des 6 rôles (mêmes repères que Vibrant : luminosité et saturation)
const ROLE_TARGETS = {
	Vibrant: { l: [0.3, 0.5, 0.7], s: [0.35, 1, 1] },
	LightVibrant: { l: [0.55, 0.74, 1], s: [0.35, 1, 1] },
	DarkVibrant: { l: [0, 0.26, 0.45], s: [0.35, 1, 1] },
	Muted: { l: [0.3, 0.5, 0.7], s: [0, 0.3, 0.4] },
	LightMuted: { l: [0.55, 0.74, 1], s: [0, 0.3, 0.4] },
	DarkMuted: { l: [0, 0.26, 0.45], s: [0, 0.3, 0.4] }
};

// Analyse les couleurs réellement présentes dans une image.
// Contrairement à Vibrant, aucune couleur n'est inventée : un rôle sans couleur
// assez présente dans l'image reste vide (ex. pas de « Vibrant » sur une pochette en noir et blanc),
// et la place occupée par chaque couleur pèse lourd dans le choix.
async function AnalyseImageColors(src) {
	const img = new Image();
	if (!/^data:/.test(src)) img.crossOrigin = 'anonymous';
	img.src = src;
	await img.decode();
	const S = 72;
	const c = document.createElement('canvas');
	c.width = S; c.height = S;
	const cx = c.getContext('2d', { willReadFrequently: true });
	cx.drawImage(img, 0, 0, S, S);
	const data = cx.getImageData(0, 0, S, S).data; // échoue si le serveur de l'image refuse (CORS)

	const px = [];
	for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 200) px.push([data[i], data[i + 1], data[i + 2]]);
	if (px.length < 20) throw new Error('image vide ou transparente');

	// Regroupement des pixels en 10 couleurs (k-moyennes, départ reproductible)
	const K = 10, rnd = SeededRandom(42);
	const centers = [px[Math.floor(rnd() * px.length)].slice()];
	while (centers.length < K) {
		let best = null, bestD = -1;
		for (let j = 0; j < 400; j++) {
			const p = px[Math.floor(rnd() * px.length)];
			const d = Math.min(...centers.map(cc => ColorDistance(cc, p)));
			if (d > bestD) { bestD = d; best = p; }
		}
		centers.push(best.slice());
	}
	const assign = new Array(px.length).fill(0);
	for (let it = 0; it < 10; it++) {
		const sums = centers.map(() => [0, 0, 0, 0]);
		for (let i = 0; i < px.length; i++) {
			let bi = 0, bd = Infinity;
			for (let k = 0; k < K; k++) {
				const cc = centers[k];
				const d = (px[i][0] - cc[0]) ** 2 + (px[i][1] - cc[1]) ** 2 + (px[i][2] - cc[2]) ** 2;
				if (d < bd) { bd = d; bi = k; }
			}
			assign[i] = bi;
			const sm = sums[bi]; sm[0] += px[i][0]; sm[1] += px[i][1]; sm[2] += px[i][2]; sm[3]++;
		}
		sums.forEach((sm, k) => { if (sm[3]) centers[k] = [sm[0] / sm[3], sm[1] / sm[3], sm[2] / sm[3]]; });
	}
	let clusters = centers.map((rgb, k) => ({ rgb, n: assign.filter(a => a === k).length })).filter(cl => cl.n > 0);
	// Fusion des couleurs presque identiques
	clusters.sort((a, b) => b.n - a.n);
	const merged = [];
	for (const cl of clusters) {
		const twin = merged.find(m => ColorDistance(m.rgb, cl.rgb) < 22);
		if (twin) { twin.rgb = MixRgb(twin.rgb, cl.rgb, cl.n / (twin.n + cl.n)); twin.n += cl.n; }
		else merged.push({ rgb: cl.rgb.slice(), n: cl.n });
	}
	const total = px.length;
	clusters = merged.map(cl => {
		const [h, s0, l] = RgbToHsl(cl.rgb);
		const s = (l < 0.08 || l > 0.94) ? 0 : s0; // noir et blanc : pas de saturation
		return { rgb: cl.rgb, hex: RgbToHex(cl.rgb), share: cl.n / total, h, s, l };
	});
	const maxShare = Math.max(...clusters.map(cl => cl.share));

	// Les 6 rôles : la couleur la plus proche de la cible, avec un fort poids pour sa présence
	const roles = {};
	const taken = new Set();
	for (const role of ['Vibrant', 'LightVibrant', 'DarkVibrant', 'Muted', 'LightMuted', 'DarkMuted']) {
		const T = ROLE_TARGETS[role];
		let best = null, bestScore = -Infinity;
		for (const cl of clusters) {
			if (taken.has(cl) || cl.share < 0.02) continue;
			if (cl.l < T.l[0] || cl.l > T.l[2] || cl.s < T.s[0] || cl.s > T.s[2]) continue;
			const score = (1 - Math.abs(cl.s - T.s[1])) * 3 + (1 - Math.abs(cl.l - T.l[1])) * 6 + (cl.share / maxShare) * 4;
			if (score > bestScore) { bestScore = score; best = cl; }
		}
		if (best) { roles[role] = best.hex; taken.add(best); }
	}

	// Dominantes : les couleurs qui occupent le plus de place (hors noir et blanc presque purs,
	// invisibles sur un fond sombre), sauf si l'image n'a rien d'autre
	let dom = clusters.filter(cl => cl.share >= 0.03 && cl.l >= 0.1 && cl.l <= 0.93);
	if (!dom.length) dom = clusters.slice();
	dom.sort((a, b) => b.share - a.share);
	dom.slice(0, 3).forEach((cl, i) => { roles[DOMINANTS[i]] = cl.hex; });

	// Accents : on cherche à part les pixels vifs (bien saturés), même s'ils sont peu nombreux,
	// et on les regroupe par teinte. Une teinte compte dès 0,3 % de l'image.
	const BINS = 24;
	const bins = Array.from({ length: BINS }, () => ({ n: 0, r: 0, g: 0, b: 0, s: 0 }));
	for (const p of px) {
		const [hh, ss, ll] = RgbToHsl(p);
		if (ss < 0.25 || ll < 0.18 || ll > 0.85) continue;
		const bn = bins[Math.floor(hh * BINS) % BINS];
		bn.n++; bn.r += p[0]; bn.g += p[1]; bn.b += p[2]; bn.s += ss;
	}
	// Chaque tranche de teinte est une candidate ; les plus vives et les plus présentes passent devant
	// Une dominante déjà colorée et proche en couleur n'a pas besoin d'être répétée en accent
	const domRgb = dom.slice(0, 3).filter(cl => cl.s > 0.25).map(cl => cl.rgb);
	const accents = bins
		.filter(bn => bn.n / total >= 0.003)
		.map(bn => ({ rgb: [bn.r / bn.n, bn.g / bn.n, bn.b / bn.n], score: bn.n * Math.pow(bn.s / bn.n, 3) }))
		.filter(a => domRgb.every(d => ColorDistance(d, a.rgb) > 60)) // pas une simple dominante
		.sort((a, b) => b.score - a.score);
	const kept = [];
	for (const a of accents) {
		if (kept.every(k => ColorDistance(k.rgb, a.rgb) > 60)) kept.push(a);
		if (kept.length === 2) break;
	}
	kept.forEach((a, i) => { roles[ACCENTS[i]] = RgbToHex(a.rgb); });
	return roles;
}

//////////////////////////////
// CHOIX DES TEINTES        //
//////////////////////////////

// Teintes retenues, dans l'ordre : 1 = couleur principale, puis 2 et 3.
// Si un rôle demandé n'existe pas dans l'image, ou s'il est trop proche d'une teinte déjà
// prise, on prend la couleur disponible la plus différente des précédentes.
function PickRoles(palette, s) {
	const count = s.colorCount === 'trio' ? 3 : s.colorCount === 'duo' ? 2 : 1;
	const wanted = s.colorPick === 'manual'
		? [s.role1, s.role2, s.role3]
		: (AMBIANCES[s.ambiance] || AMBIANCES.vive);
	const rgb = (k) => HexToRgb(palette[k]);
	const picked = [];
	for (let i = 0; i < count; i++) {
		let role = wanted[i];
		const ok = (r) => palette[r] && !picked.includes(r) && picked.every(p => ColorDistance(rgb(p), rgb(r)) >= 40);
		if (!ok(role)) {
			// D'abord les autres rôles de l'ambiance, puis toutes les couleurs trouvées
			const pool = wanted.concat(ALL_KEYS).filter((r, j, a) => a.indexOf(r) === j && palette[r] && !picked.includes(r));
			let best = null, bestD = -1;
			for (const r of pool) {
				const d = picked.length ? Math.min(...picked.map(p => ColorDistance(rgb(p), rgb(r)))) : 999;
				if (ok(r)) { best = r; break; }
				if (d > bestD) { bestD = d; best = r; }
			}
			role = best;
		}
		if (role && palette[role]) picked.push(role);
	}
	return picked;
}

// Jeu de travail des thèmes :
//   list : les teintes dans l'ordre choisi (toujours 3 entrées), count : 1 à 3
//   mid  : teinte 1 (principale), hi : teinte 2 (ou version claire de la 1 en mono)
//   bg   : fond, version assombrie de la teinte la plus sombre
function BuildWorkingSet(hexColors, autoShades) {
	const cols = hexColors.map(HexToRgb);
	if (!cols.length) cols.push([138, 92, 246]);
	const darkest = cols.slice().sort((a, b) => Luma(a) - Luma(b))[0];
	if (cols.length === 1) {
		const c = cols[0];
		const light = autoShades ? MixRgb(c, [255, 255, 255], 0.38) : c;
		const dark = autoShades ? MixRgb(c, [0, 0, 0], 0.62) : c;
		return { bg: dark, mid: c, hi: light, list: [c, light, MixRgb(c, light, 0.5)], count: 1 };
	}
	const list = cols.length === 2 ? [cols[0], cols[1], MixRgb(cols[0], cols[1], 0.5)] : cols.slice(0, 3);
	return { bg: MixRgb(darkest, [0, 0, 0], 0.55), mid: cols[0], hi: cols[1], list, count: cols.length };
}

// Teinte le long de la palette (k de 0 à 1) : 1 → 2 → 3
function Tone(set, k) {
	k = Math.max(0, Math.min(1, k));
	if (set.count < 3) return MixRgb(set.list[0], set.list[1], k);
	return k < 0.5 ? MixRgb(set.list[0], set.list[1], k * 2) : MixRgb(set.list[1], set.list[2], (k - 0.5) * 2);
}

// Teinte n° i (forme, bulle…) : on alterne entre les teintes choisies
function ToneAt(set, i) {
	return set.count === 1 ? (i % 2 ? set.hi : set.mid) : set.list[i % set.count];
}

// Transition douce d'un jeu de couleurs vers un autre
function LerpSet(a, b, k) {
	return {
		bg: MixRgb(a.bg, b.bg, k), mid: MixRgb(a.mid, b.mid, k), hi: MixRgb(a.hi, b.hi, k),
		list: a.list.map((c, i) => MixRgb(c, b.list[i], k)),
		count: k < 0.5 ? a.count : b.count
	};
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
