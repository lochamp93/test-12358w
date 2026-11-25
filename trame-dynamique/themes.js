// Trame dynamique : thèmes de trame (dessin dans un canvas 2D)
// Chaque thème : draw(ctx, w, h, t, set, o)
//   t   : temps en secondes (déjà multiplié par la vitesse)
//   set : { bg, mid, hi } couleurs [r,g,b]
//   o   : { density: 0|1|2, unit: taille d'un pixel 1080p, lineWidth, shapeKind, layer, seed }

const DENSITY = { faible: 0, moyenne: 1, forte: 2 };

// Particules générées une fois par thème et par densité (positions reproductibles)
const particleCache = new Map();
function Particles(key, count, make) {
	const k = `${key}-${count}`;
	if (!particleCache.has(k)) {
		const rnd = SeededRandom(count * 7919 + key.length * 104729);
		particleCache.set(k, Array.from({ length: count }, (_, i) => make(rnd, i)));
	}
	return particleCache.get(k);
}

// Bruit de valeur lissé (pour le brouillard « coton »)
const NOISE_PERM = (() => {
	const rnd = SeededRandom(9001);
	const p = Array.from({ length: 256 }, (_, i) => i);
	for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
	const vals = Array.from({ length: 256 }, () => rnd());
	return { p: p.concat(p), vals };
})();
function Noise2(x, y) {
	const xi = Math.floor(x), yi = Math.floor(y);
	const xf = x - xi, yf = y - yi;
	const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
	const P = NOISE_PERM.p, V = NOISE_PERM.vals;
	const X = xi & 255, Y = yi & 255;
	const a = V[P[P[X] + Y]], b = V[P[P[X + 1] + Y]];
	const c = V[P[P[X] + Y + 1]], d = V[P[P[X + 1] + Y + 1]];
	return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function Fbm(x, y) {
	let sum = 0, amp = 0.5, f = 1, norm = 0;
	for (let i = 0; i < 4; i++) { sum += amp * Noise2(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
	return sum / norm;
}
function Smooth(a, b, x) { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); }

// Rebond entre 0 et 1 (onde triangle) : points qui ricochent sur les bords
function Bounce(u) { const m = ((u % 2) + 2) % 2; return m < 1 ? m : 2 - m; }

// Horloges internes du thème Halo
const haloClock = { t: null, move: 0, spin: 0 };

const THEMES = {
	// Brouillard « coton » : nuages doux qui roulent lentement
	// (bruit calculé en basse résolution, puis agrandi et lissé)
	brouillard(ctx, w, h, t, set, o) {
		const layer = o.layer;
		const gw = 160, gh = Math.max(8, Math.round(160 * h / w));
		if (layer.width !== gw || layer.height !== gh) { layer.width = gw; layer.height = gh; }
		const lc = layer.getContext('2d');
		const img = lc.createImageData(gw, gh);
		const d = img.data;
		const scale = [1.6, 2.4, 3.4][o.density] / gw; // taille des nuages
		const bg = set.bg, mid = set.mid, hi = set.hi;
		for (let y = 0; y < gh; y++) {
			for (let x = 0; x < gw; x++) {
				const nx = x * scale, ny = y * scale;
				// Deux couches qui dérivent dans des sens opposés : effet de volume
				const n1 = Fbm(nx + t * 0.045, ny + t * 0.018);
				const n2 = Fbm(nx * 1.7 - t * 0.03 + 40, ny * 1.7 + t * 0.025 + 17);
				const v = Smooth(0.26, 0.8, n1 * 0.65 + n2 * 0.35);
				const lit = Smooth(0.42, 0.86, n2 * 0.6 + n1 * 0.4);
				const k = (y * gw + x) * 4;
				// Couleur : fond → teinte → clair selon l'épaisseur du nuage
				const tc = Tone(set, lit);
				const r = tc[0], g = tc[1], b = tc[2];
				if (o.background) {
					d[k] = bg[0] + (r - bg[0]) * v; d[k + 1] = bg[1] + (g - bg[1]) * v; d[k + 2] = bg[2] + (b - bg[2]) * v; d[k + 3] = 255;
				} else {
					d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = v * 235;
				}
			}
		}
		lc.putImageData(img, 0, 0);
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.filter = `blur(${Math.max(1, w / 220)}px)`;
		ctx.drawImage(layer, -2, -2, w + 4, h + 4);
		ctx.restore();
	},

	// Bézier : courbes qui ricochent sur les bords avec leur traînée,
	// comme l'écran de veille « Bézier » de Windows 95
	vagues(ctx, w, h, t, set, o) {
		const curves = [2, 4, 7][o.density];
		const trail = [18, 24, 30][o.density];
		const items = Particles('bezier', curves, (r) => ({
			pts: Array.from({ length: 7 }, () => ({ x: r() * 2, y: r() * 2, vx: 0.05 + r() * 0.09, vy: 0.05 + r() * 0.09 })),
			ph: r() * 6.28
		}));
		const lwidth = Math.max(1, o.lineWidth * o.unit);
		ctx.save();
		ctx.lineWidth = lwidth;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		items.forEach((c, ci) => {
			for (let i = trail - 1; i >= 0; i--) {
				const tt = t - i * 0.06;
				const P = c.pts.map(p => [Bounce(p.x + p.vx * tt) * w, Bounce(p.y + p.vy * tt) * h]);
				const fade = 1 - i / trail;
				// La couleur glisse lentement entre la teinte et sa version claire
				const k = 0.5 + 0.5 * Math.sin(tt * 0.25 + c.ph + ci);
				const col = set.count > 1 ? MixRgb(ToneAt(set, ci), ToneAt(set, ci + 1), k * 0.5) : Tone(set, k);
				ctx.strokeStyle = Rgba(col, (i === 0 ? 1 : 0.55) * fade * fade);
				if (i === 0) { ctx.shadowColor = Rgba(col, 0.9); ctx.shadowBlur = lwidth * 5; } else ctx.shadowBlur = 0;
				ctx.beginPath();
				ctx.moveTo(P[0][0], P[0][1]);
				ctx.bezierCurveTo(P[1][0], P[1][1], P[2][0], P[2][1], P[3][0], P[3][1]);
				ctx.bezierCurveTo(P[4][0], P[4][1], P[5][0], P[5][1], P[6][0], P[6][1]);
				ctx.stroke();
			}
		});
		ctx.restore();
	},

	// Halo : grandes formes organiques et molles qui fusionnent sur un fond sombre
	// (inspiré des fonds animés des lecteurs de musique). Champ de « métaballes » calculé
	// en basse résolution : les formes se rejoignent et se séparent naturellement, bords doux.
	// Alternance de phases calmes (formes dans les coins qui dérivent) et de phases agitées
	// (une grande masse qui gonfle et tourbillonne).
	halo(ctx, w, h, t, set, o) {
		const n = Math.max(2, Math.min(6, Math.round(o.haloCount || 4)));
		const blobs = Particles('halo2', n, (r) => ({
			sx: r() * 100, sy: r() * 100, sr: r() * 100,
			// point d'ancrage au repos : plutôt près des bords et des coins
			ax: r() < 0.5 ? -0.1 + r() * 0.3 : 0.8 + r() * 0.3,
			ay: r() < 0.5 ? -0.1 + r() * 0.35 : 0.75 + r() * 0.35,
			size: 0.3 + r() * 0.2,
			sub: r() * 6.28
		}));
		const layer = o.layer;
		const gw = 128, gh = Math.max(8, Math.round(128 * h / w));
		if (layer.width !== gw || layer.height !== gh) { layer.width = gw; layer.height = gh; }
		const lc = layer.getContext('2d');
		const img = lc.createImageData(gw, gh);
		const d = img.data;

		// Énergie : 0 = calme, 1 = agité (varie lentement et sans à-coups)
		const energy = Smooth(0.42, 0.72, Noise2(t * 0.07, 3.7) * 0.7 + Noise2(t * 0.19, 9.1) * 0.3);
		// Horloges qui avancent pas à pas (vitesse = énergie) : jamais de saut, quelle que soit
		// la durée depuis le lancement (multiplier le temps total par une vitesse variable
		// donnait des accélérations folles au bout de quelques minutes)
		const dt = haloClock.t === null ? 0 : Math.max(0, Math.min(0.1, t - haloClock.t));
		haloClock.t = t;
		haloClock.move += dt * (0.05 + energy * 0.22);
		haloClock.spin += dt * (0.2 + energy * 0.9);
		const size = (o.haloSize || 100) / 100;
		const aspect = w / h;

		// Position et rayon de chaque forme (2 points par forme : formes allongées, en haricot)
		const pts = [];
		for (const b of blobs) {
			const wander = (0.12 + energy * 0.55) * (0.5 + o.amplitude * 0.5);
			const cx = b.ax + (Noise2(b.sx + haloClock.move, 1.3) - 0.5) * 2 * wander + (0.5 - b.ax) * energy * 0.6;
			const cy = b.ay + (Noise2(b.sy + haloClock.move, 7.9) - 0.5) * 2 * wander + (0.5 - b.ay) * energy * 0.6;
			const rad = b.size * size * (0.75 + energy * 0.75 * o.amplitude) * (1 - 0.3 * o.amplitude + 0.6 * o.amplitude * Noise2(b.sr + t * 0.3, 4.2));
			const a = b.sub + haloClock.spin;
			const off = rad * 0.6;
			const col = set.count > 1 ? ToneAt(set, pts.length / 2) : set.mid;
			pts.push([cx + Math.cos(a) * off / aspect, cy + Math.sin(a) * off, rad * 0.8, col]);
			pts.push([cx - Math.cos(a) * off / aspect, cy - Math.sin(a) * off, rad * 0.65, col]);
		}

		// Douceur des bords : plus la bande de transition est large, plus c'est flou
		const soft = { doux: 0.3, fort: 0.4, tres: 0.48 }[o.haloBlur] || 0.4;
		const lo = 0.5 - soft, hiT = 0.5 + soft;
		const bg = set.bg;
		const black = o.background ? Math.min(1, (o.haloBlack || 0) / 100) : 0;
		const base = [bg[0] * (1 - black), bg[1] * (1 - black), bg[2] * (1 - black)];

		for (let y = 0; y < gh; y++) {
			const py = (y + 0.5) / gh;
			for (let x = 0; x < gw; x++) {
				// Léger gauchissement de l'espace : contours irréguliers, pas des cercles
				const px = (x + 0.5) / gw + (Noise2(x * 0.05 + t * 0.15, y * 0.05) - 0.5) * 0.12;
				const qy = py + (Noise2(x * 0.05 + 50, y * 0.05 - t * 0.12) - 0.5) * 0.12;
				// Champ de présence, et couleur mélangée selon la part de chaque forme
				let f = 0, cr = 0, cg = 0, cb = 0;
				for (let i = 0; i < pts.length; i++) {
					const dx = (px - pts[i][0]) * aspect, dy = qy - pts[i][1];
					const rr = pts[i][2] * pts[i][2];
					const e = Math.exp(-(dx * dx + dy * dy) / rr);
					f += e; cr += e * pts[i][3][0]; cg += e * pts[i][3][1]; cb += e * pts[i][3][2];
				}
				const inv = f > 1e-6 ? 1 / f : 0;
				const mid = [cr * inv, cg * inv, cb * inv];
				const v = Smooth(lo, hiT, f);          // présence de la forme
				const core = Smooth(hiT, 1.6, f);  // cœur à peine plus clair
				const r = mid[0] + (255 - mid[0]) * core * 0.08;
				const g = mid[1] + (255 - mid[1]) * core * 0.08;
				const bl = mid[2] + (255 - mid[2]) * core * 0.08;
				const k = (y * gw + x) * 4;
				if (o.background) {
					d[k] = base[0] + (r - base[0]) * v; d[k + 1] = base[1] + (g - base[1]) * v; d[k + 2] = base[2] + (bl - base[2]) * v; d[k + 3] = 255;
				} else {
					d[k] = r; d[k + 1] = g; d[k + 2] = bl; d[k + 3] = v * 255;
				}
			}
		}
		lc.putImageData(img, 0, 0);
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.filter = `blur(${Math.max(1, w / 70)}px)`;
		const m = Math.ceil(w / 40); // déborde un peu : pas de liseré sur les bords
		ctx.drawImage(layer, -m, -m, w + 2 * m, h + 2 * m);
		ctx.restore();
	},

	// Rideaux lumineux qui se tordent, montent, descendent et changent de taille.
	// Ils peuvent sortir du cadre (haut ou bas) et ne couvrent pas toujours toute la largeur.
	// Dessinés en basse résolution sur un calque (avec marge), puis agrandis et lissés.
	aurore(ctx, w, h, t, set, o) {
		const n = [3, 5, 8][o.density];
		const amp = o.amplitude;
		const bands = Particles('aurore2', n, (r, i) => ({
			ph: r() * 6.28, f: 0.5 + r(), fy: 0.03 + r() * 0.05, fl: 0.04 + r() * 0.06, fx: 0.02 + r() * 0.04,
			y: 0.15 + r() * 0.5, len: 0.35 + r() * 0.4, tone: r(), up: i % 3 === 2
		}));
		const layer = o.layer;
		const lw = Math.max(16, Math.round(w / 6)), lh = Math.max(16, Math.round(h / 6));
		const my = Math.round(lh * 0.5); // marge verticale : les rideaux peuvent dépasser du cadre
		if (layer.width !== lw || layer.height !== lh + 2 * my) { layer.width = lw; layer.height = lh + 2 * my; }
		const lc = layer.getContext('2d');
		lc.clearRect(0, 0, layer.width, layer.height);
		lc.globalCompositeOperation = 'lighter';
		for (const b of bands) {
			const col = Tone(set, b.tone);
			// Hauteur du rideau dans le cadre : dérive lente, plus ou moins large selon l'amplitude
			const yc = b.y + 0.42 * amp * Math.sin(t * b.fy * 6.28 + b.ph) + 0.12 * amp * Math.sin(t * b.fy * 15 + b.ph * 2);
			// Longueur qui respire : du rideau court au grand voile qui sort du cadre
			const lenK = b.len * (0.55 + 0.75 * amp * (0.5 + 0.5 * Math.sin(t * b.fl * 6.28 + b.ph * 3)));
			// Zone éclairée horizontalement : le rideau ne couvre pas toujours toute la largeur
			const cx = 0.5 + 0.45 * Math.sin(t * b.fx * 6.28 + b.ph * 1.7);
			const spread = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * b.fx * 9 + b.ph));
			for (let x = 0; x < lw; x++) {
				const u = x / lw;
				const env = Math.exp(-((u - cx) ** 2) / (2 * spread * spread));
				const top = my + lh * (yc + 0.1 * Math.sin(u * 6.28 * b.f + t * 0.35 + b.ph) + 0.05 * Math.sin(u * 17 + t * 0.9));
				const len = lh * lenK * (0.6 + 0.4 * Math.sin(u * 9 + t * 0.5 + b.ph));
				const a = 0.26 * env * (0.5 + 0.5 * Math.sin(u * 5 + t * 0.6 + b.ph));
				if (a < 0.004) continue;
				// Rideau vers le bas (lumière en haut) ou vers le haut (lumière en bas)
				const y0 = b.up ? top - len : top, y1 = b.up ? top : top + len;
				const g = lc.createLinearGradient(0, b.up ? y1 : y0, 0, b.up ? y0 : y1);
				g.addColorStop(0, Rgba(col, 0));
				g.addColorStop(0.15, Rgba(col, a));
				g.addColorStop(1, Rgba(col, 0));
				lc.fillStyle = g;
				lc.fillRect(x, y0, 1, len);
			}
		}
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.filter = `blur(${Math.max(1, w / 400)}px)`;
		ctx.drawImage(layer, 0, my, lw, lh, 0, 0, w, h);
		ctx.restore();
	},

	// Cercles lumineux flous qui flottent
	bokeh(ctx, w, h, t, set, o) {
		const n = [18, 36, 64][o.density];
		const dots = Particles('bokeh', n, (r) => ({ x: r(), y: r(), s: 0.02 + r() * 0.07, v: 0.01 + r() * 0.03, ph: r() * 6.28, tone: r(), a: 0.18 + r() * 0.35 }));
		const big = Math.max(w, h);
		for (const d of dots) {
			const y = ((d.y - t * d.v) % 1 + 1) % 1;
			const x = d.x + 0.02 * Math.sin(t * 0.5 + d.ph);
			const px = x * w, py = y * h * 1.2 - h * 0.1, rad = d.s * big * (1 + 0.8 * o.amplitude * (Noise2(d.ph * 10 + t * 0.15, 2.2) - 0.35));
			const col = Tone(set, d.tone);
			const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
			const a = d.a * (0.6 + 0.4 * Math.sin(t + d.ph));
			g.addColorStop(0, Rgba(col, a));
			g.addColorStop(0.7, Rgba(col, a * 0.7));
			g.addColorStop(1, Rgba(col, 0));
			ctx.fillStyle = g;
			ctx.beginPath();
			ctx.arc(px, py, rad, 0, 6.2832);
			ctx.fill();
		}
	},

	// Mosaïque : grille de gros pixels qui s'allument et s'éteignent en vagues (écran LED)
	mosaique(ctx, w, h, t, set, o) {
		const cell = Math.max(4, o.pixelSize * o.unit);
		const gap = Math.min(cell * 0.45, Math.max(0, o.pixelGap * o.unit));
		const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
		const ox = (w - cols * cell) / 2, oy = (h - rows * cell) / 2;
		const ci = cols / 2, cj = rows / 2;
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				let v;
				if (o.waveShape === 'cercle') v = Math.sin(Math.hypot(i - ci, j - cj) * 0.45 - t * 2.2);
				else if (o.waveShape === 'aleatoire') v = Noise2(i * 0.22 + t * 0.35, j * 0.22 - t * 0.2) * 2 - 1;
				else v = Math.sin((i + j) * 0.32 - t * 2) * 0.7 + Math.sin(i * 0.11 - t * 0.7) * 0.3;
				const on = Smooth(-0.2, 0.9, v);
				if (on < 0.03) continue;
				const tone = Noise2(i * 0.08 + t * 0.05, j * 0.08 + 11);
				ctx.fillStyle = Rgba(Tone(set, tone), 0.25 + 0.75 * on);
				const sz = (cell - gap) * (0.55 + 0.45 * on);
				ctx.fillRect(ox + i * cell + (cell - sz) / 2, oy + j * cell + (cell - sz) / 2, sz, sz);
			}
		}
	},

	// Plasma rétro : couleurs liquides des démos des années 90, en gros pixels tramés
	plasma(ctx, w, h, t, set, o) {
		const cell = Math.max(3, o.pixelSize * o.unit);
		const gw = Math.max(4, Math.ceil(w / cell)), gh = Math.max(4, Math.ceil(h / cell));
		const layer = o.layer;
		if (layer.width !== gw || layer.height !== gh) { layer.width = gw; layer.height = gh; }
		const lc = layer.getContext('2d');
		const img = lc.createImageData(gw, gh);
		const d = img.data;
		const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
		const dither = { aucune: 0, legere: 0.08, forte: 0.18 }[o.plasmaDither] ?? 0.08;
		const steps = [set.bg, MixRgb(set.bg, set.list[0], 0.5)].concat(set.count > 1 ? set.list.slice(0, set.count) : [set.mid, set.hi]);
		const levels = steps.length;
		const k = 26 / Math.max(gw, gh);
		for (let y = 0; y < gh; y++) {
			for (let x = 0; x < gw; x++) {
				const X = x * k, Y = y * k;
				let v = Math.sin(X + t) + Math.sin((Y + t) * 0.8) + Math.sin((X + Y + t * 1.3) * 0.6)
					+ Math.sin(Math.hypot(X - 13 + 5 * Math.sin(t * 0.3), Y - 8 + 4 * Math.cos(t * 0.4)) * 0.7);
				v = (v + 4) / 8; // 0..1
				v += (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * dither;
				// Couleurs franches de la palette, sans mélange (rendu rétro à palette limitée)
				const q = Math.max(0, Math.min(levels - 1, Math.floor(v * levels)));
				const c = steps[q];
				const i = (y * gw + x) * 4;
				d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = o.background || q > 0 ? 255 : 0;
			}
		}
		lc.putImageData(img, 0, 0);
		ctx.save();
		ctx.imageSmoothingEnabled = false; // pixels nets
		ctx.drawImage(layer, 0, 0, gw * cell, gh * cell);
		ctx.restore();
	},

	// Disco : tout l'écran est couvert de facettes carrées, comme la surface d'une boule à
	// facettes. Les facettes reflètent la lumière au hasard (couleurs de la palette), et un
	// reflet plus large balaie lentement la surface, comme quand la boule tourne.
	disco(ctx, w, h, t, set, o) {
		const size = Math.max(6, o.discoSize * o.unit);
		const gap = Math.max(1, size * 0.08);
		const cols = Math.ceil(w / size) + 1, rows = Math.ceil(h / size) + 1;
		const ox = (w - cols * size) / 2, oy = (h - rows * size) / 2;
		const freq = { faible: 0.82, moyen: 0.72, fort: 0.6 }[o.discoSparkle] ?? 0.72;
		const base = MixRgb(set.bg, [0, 0, 0], 0.35);
		// Fond : joints sombres entre les facettes
		ctx.fillStyle = Rgba(MixRgb(set.bg, [0, 0, 0], 0.7), o.background ? 1 : 0.85);
		ctx.fillRect(0, 0, w, h);
		const sweep = t * 0.12; // reflet large qui balaie (rotation de la boule)
		for (let j = 0; j < rows; j++) {
			for (let i = 0; i < cols; i++) {
				const seed = i * 73.1 + j * 37.7;
				// Chaque facette a une inclinaison propre : teinte et éclat de base
				const tilt = Noise2(i * 0.9 + 3.3, j * 0.9 + 7.7);
				const tone = Noise2(i * 0.31 + 50, j * 0.31 + 20);
				// Reflet qui balaie en diagonale
				// Un seul grand reflet : sa position avance en diagonale et revient
				const u = (i / cols) * 0.75 + (j / rows) * 0.25;
				const pos = ((sweep % 1.6) + 1.6) % 1.6 - 0.3;
				const sw = Math.exp(-Math.pow((u - pos) / 0.12, 2)) * 0.5;
				// Éclat aléatoire : la facette « attrape » la lumière un court instant
				const flash = Smooth(freq, 1, Noise2(seed * 0.13 + t * 1.6, seed * 0.07 - t * 0.9));
				const lum = 0.1 + 0.2 * tilt + sw + flash * 0.9;
				const col = Tone(set, tone);
				const c = lum < 0.5 ? MixRgb(base, col, lum * 2) : MixRgb(col, [255, 255, 255], Math.min(0.75, (lum - 0.5) * 1.1));
				const x = ox + i * size, y = oy + j * size;
				ctx.fillStyle = Rgba(c, 1);
				ctx.fillRect(x + gap / 2, y + gap / 2, size - gap, size - gap);
				if (flash > 0.55) {
					// Petite étoile sur les éclats les plus forts
					const L = size * (0.6 + flash);
					ctx.save();
					ctx.globalCompositeOperation = 'lighter';
					ctx.fillStyle = `rgba(255,255,255,${(flash - 0.55) * 1.6})`;
					const cx = x + size / 2, cy = y + size / 2, th = Math.max(1, size * 0.06);
					ctx.fillRect(cx - L, cy - th / 2, L * 2, th);
					ctx.fillRect(cx - th / 2, cy - L, th, L * 2);
					ctx.restore();
				}
			}
		}
	},

	// Matrix : colonnes de caractères qui tombent, tête claire et traînée qui s'éteint
	matrix(ctx, w, h, t, set, o) {
		const size = Math.max(8, o.matrixSize * o.unit);
		const chars = o.matrixChars;
		const cols = Math.ceil(w / size);
		const rows = Math.ceil(h / size) + 1;
		const fill = [0.45, 0.8, 1][o.density];
		const streams = [1, 1, 3][o.density]; // forte : plusieurs pluies par colonne
		ctx.save();
		ctx.font = `600 ${Math.round(size * 0.9)}px 'SF Mono', Consolas, 'Courier New', monospace`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		const light = MixRgb(set.hi, [255, 255, 255], 0.55);
		for (let c = 0; c < cols * streams; c++) {
			const rnd = SeededRandom(c * 104729 + 7);
			if (rnd() > fill) continue;
			const speed = 6 + rnd() * 10;              // cases par seconde
			const len = 8 + Math.floor(rnd() * (o.density === 2 ? 26 : 18));   // longueur de la traînée
			const ph = rnd() * 50, tone = rnd();
			const cycle = rows + len + 4 + Math.floor(rnd() * 12);
			const head = ((t * speed + ph * cycle) % cycle);
			const col = Tone(set, tone);
			const x = (c % cols) * size + size / 2;
			for (let k = 0; k < len; k++) {
				const row = Math.floor(head) - k;
				if (row < 0 || row >= rows) continue;
				// Le caractère d'une case change de temps en temps
				const n = Math.floor(Noise2((c % cols) * 3.1 + row * 0.7, Math.floor(t * 3 + c) * 0.5) * 9973 + (c % cols) * 31 + row * 17);
				const ch = chars[n % chars.length];
				const a = k === 0 ? 1 : Math.pow(1 - k / len, 1.4) * 0.9;
				ctx.fillStyle = k === 0 ? Rgba(light, 1) : Rgba(col, a);
				if (k === 0) { ctx.shadowColor = Rgba(col, 0.9); ctx.shadowBlur = size * 0.6; } else ctx.shadowBlur = 0;
				ctx.fillText(ch, x, row * size);
			}
		}
		ctx.restore();
	},

	// Starfield : étoiles qui foncent vers l'écran (écran de veille de Windows 95)
	starfield(ctx, w, h, t, set, o) {
		const n = [150, 300, 550][o.density];
		const stars = Particles('stars', n, (r) => ({ x: r() * 2 - 1, y: r() * 2 - 1, z: r(), v: 0.15 + r() * 0.2, tone: r() }));
		const cx = w / 2, cy = h / 2, f = Math.max(w, h) * 0.5;
		ctx.save();
		ctx.lineCap = 'round';
		for (const s of stars) {
			const z = 1 - (((s.z + t * s.v) % 1) + 1) % 1; // 1 = loin, 0 = tout près
			const zz = Math.max(0.02, z);
			const zPrev = Math.min(1, zz + s.v * 0.08);  // position un peu avant : la traînée
			const x1 = cx + s.x / zz * f * 0.5, y1 = cy + s.y / zz * f * 0.5;
			const x0 = cx + s.x / zPrev * f * 0.5, y0 = cy + s.y / zPrev * f * 0.5;
			if (x1 < -50 || x1 > w + 50 || y1 < -50 || y1 > h + 50) continue;
			const near = 1 - z;
			const col = MixRgb(Tone(set, s.tone), [255, 255, 255], 0.35 * near);
			ctx.strokeStyle = Rgba(col, Math.min(1, 0.15 + near * 1.1));
			ctx.lineWidth = Math.max(1, (0.6 + near * 3.2) * o.unit);
			ctx.beginPath();
			ctx.moveTo(x0, y0);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}
		ctx.restore();
	},

	// Synthwave : grille rétro en perspective qui défile, soleil en dégradé
	synthwave(ctx, w, h, t, set, o) {
		const hor = h * 0.56;
		const c1 = set.list[0], c2 = set.count > 1 ? set.list[1] : set.hi;
		ctx.save();
		// Ciel : lueur au-dessus de l'horizon
		const sky = ctx.createLinearGradient(0, 0, 0, hor);
		sky.addColorStop(0, Rgba(c1, 0));
		sky.addColorStop(1, Rgba(c1, 0.35));
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, w, hor);
		// Soleil rayé
		const R = Math.min(w, h) * 0.22, sx = w / 2, sy = hor - R * 0.35;
		const sun = ctx.createLinearGradient(0, sy - R, 0, sy + R);
		sun.addColorStop(0, Rgba(MixRgb(c2, [255, 255, 255], 0.3), 1));
		sun.addColorStop(1, Rgba(c1, 1));
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, w, hor);
		ctx.clip();
		ctx.beginPath();
		ctx.arc(sx, sy, R, 0, 6.2832);
		ctx.fillStyle = sun;
		ctx.shadowColor = Rgba(c2, 0.8);
		ctx.shadowBlur = R * 0.4;
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.globalCompositeOperation = 'destination-out';
		for (let i = 0; i < 7; i++) {
			const yy = sy + R * (0.05 + i * 0.14) + ((t * 6) % (R * 0.14));
			ctx.fillRect(sx - R, yy, R * 2, R * 0.035 * (1 + i * 0.5));
		}
		ctx.restore();
		// Grille au sol
		const lineCol = MixRgb(c2, [255, 255, 255], 0.15);
		ctx.strokeStyle = Rgba(lineCol, 0.9);
		ctx.shadowColor = Rgba(c2, 0.9);
		ctx.shadowBlur = 8 * o.unit;
		ctx.lineWidth = Math.max(1, o.lineWidth * o.unit);
		const scroll = (t * 0.6) % 1;
		for (let i = 0; i < 18; i++) {
			const z = (i + 1 - scroll) / 18; // 0 = horizon
			const y = hor + (h - hor) * Math.pow(z, 2.2);
			ctx.globalAlpha = Math.min(1, z * 2);
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
		}
		ctx.globalAlpha = 1;
		for (let i = -14; i <= 14; i++) {
			ctx.beginPath();
			ctx.moveTo(w / 2 + i * w * 0.02, hor);
			ctx.lineTo(w / 2 + i * w * 0.16, h);
			ctx.stroke();
		}
		ctx.restore();
	},

	// Ondes : cercles qui se propagent comme des gouttes sur l'eau
	ondes(ctx, w, h, t, set, o) {
		const n = [3, 5, 8][o.density];
		const drops = Particles('ondes', n, (r) => ({ x: r(), y: r(), period: 4 + r() * 4, ph: r() * 10, tone: r() }));
		const maxR = Math.hypot(w, h) * 0.55;
		ctx.save();
		ctx.lineWidth = Math.max(1, o.lineWidth * o.unit);
		for (const d of drops) {
			const cx = w * (d.x + 0.05 * Math.sin(t * 0.1 + d.ph)), cy = h * (d.y + 0.05 * Math.cos(t * 0.12 + d.ph));
			const col = Tone(set, d.tone);
			for (let k = 0; k < 4; k++) {
				const age = (((t + d.ph) / d.period + k / 4) % 1);
				const r = age * maxR;
				ctx.strokeStyle = Rgba(col, (1 - age) * (1 - age) * 0.9);
				ctx.beginPath();
				ctx.arc(cx, cy, Math.max(0.1, r), 0, 6.2832);
				ctx.stroke();
			}
		}
		ctx.restore();
	},

	// Crêtes : lignes empilées qui ondulent comme des montagnes (style « Unknown Pleasures »)
	cretes(ctx, w, h, t, set, o) {
		const n = [18, 30, 48][o.density];
		const top = h * 0.12, span = h * 0.8, step = span / n;
		const pts = 90;
		ctx.save();
		ctx.lineWidth = Math.max(1, o.lineWidth * o.unit);
		ctx.lineJoin = 'round';
		for (let i = 0; i < n; i++) {
			const y0 = top + i * step;
			const ridge = new Path2D();
			for (let p = 0; p <= pts; p++) {
				const u = p / pts;
				const env = Math.exp(-Math.pow((u - 0.5) / 0.2, 2)); // relief surtout au centre
				const v = Fbm(u * 6 + i * 0.37, t * 0.25 + i * 0.13);
				const y = y0 - env * Math.pow(v, 2.2) * step * 7;
				p ? ridge.lineTo(u * w, y) : ridge.moveTo(u * w, y);
			}
			// Fond sous la ligne : cache les lignes de derrière (sans tracer les bords du cadre)
			const under = new Path2D(ridge);
			under.lineTo(w, h + 10); under.lineTo(0, h + 10); under.closePath();
			if (o.background) { ctx.fillStyle = Rgba(set.bg, 1); ctx.fill(under); }
			else { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(under); ctx.restore(); }
			ctx.strokeStyle = Rgba(Tone(set, i / Math.max(1, n - 1)), 1);
			ctx.stroke(ridge);
		}
		ctx.restore();
	},

	// Dégradé fluide : dégradé maillé très doux qui ondule lentement
	degrade(ctx, w, h, t, set, o) {
		const layer = o.layer;
		const gw = 48, gh = Math.max(4, Math.round(48 * h / w));
		if (layer.width !== gw || layer.height !== gh) { layer.width = gw; layer.height = gh; }
		const lc = layer.getContext('2d');
		const img = lc.createImageData(gw, gh);
		const d = img.data;
		const cols = [set.list[0], set.list[1], set.list[2], set.count > 1 ? set.list[0] : set.hi, set.bg];
		const P = cols.map((c, i) => [0.5 + 0.45 * Math.sin(t * (0.05 + i * 0.013) + i * 1.9), 0.5 + 0.45 * Math.cos(t * (0.04 + i * 0.011) + i * 2.7), c]);
		const aspect = w / h;
		for (let y = 0; y < gh; y++) {
			for (let x = 0; x < gw; x++) {
				const px = x / (gw - 1), py = y / (gh - 1);
				let sw = 0, r = 0, g = 0, b = 0;
				for (const p of P) {
					const dd = ((px - p[0]) * aspect) ** 2 + (py - p[1]) ** 2;
					const wgt = 1 / (dd * dd + 0.002);
					sw += wgt; r += wgt * p[2][0]; g += wgt * p[2][1]; b += wgt * p[2][2];
				}
				const i = (y * gw + x) * 4;
				d[i] = r / sw; d[i + 1] = g / sw; d[i + 2] = b / sw; d[i + 3] = 255;
			}
		}
		lc.putImageData(img, 0, 0);
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.filter = `blur(${Math.max(1, w / 60)}px)`;
		const m = Math.ceil(w / 20);
		ctx.drawImage(layer, -m, -m, w + 2 * m, h + 2 * m);
		ctx.restore();
	}
};
