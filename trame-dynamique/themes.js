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
				const r = mid[0] + (hi[0] - mid[0]) * lit, g = mid[1] + (hi[1] - mid[1]) * lit, b = mid[2] + (hi[2] - mid[2]) * lit;
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
		const curves = [1, 2, 3][o.density];
		const trail = 16;
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
				const tt = t - i * 0.09;
				const P = c.pts.map(p => [Bounce(p.x + p.vx * tt) * w, Bounce(p.y + p.vy * tt) * h]);
				const fade = 1 - i / trail;
				// La couleur glisse lentement entre la teinte et sa version claire
				const k = 0.5 + 0.5 * Math.sin(tt * 0.25 + c.ph + ci);
				const col = MixRgb(set.mid, set.hi, k);
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
		const size = (o.haloSize || 100) / 100;
		const aspect = w / h;

		// Position et rayon de chaque forme (2 points par forme : formes allongées, en haricot)
		const pts = [];
		for (const b of blobs) {
			const wander = 0.12 + energy * 0.55;
			const spd = 0.05 + energy * 0.22;
			const cx = b.ax + (Noise2(b.sx + t * spd, 1.3) - 0.5) * 2 * wander + (0.5 - b.ax) * energy * 0.6;
			const cy = b.ay + (Noise2(b.sy + t * spd, 7.9) - 0.5) * 2 * wander + (0.5 - b.ay) * energy * 0.6;
			const rad = b.size * size * (0.75 + energy * 0.75) * (0.85 + 0.3 * Noise2(b.sr + t * 0.3, 4.2));
			const a = b.sub + t * (0.2 + energy * 0.9);
			const off = rad * 0.6;
			pts.push([cx + Math.cos(a) * off / aspect, cy + Math.sin(a) * off, rad * 0.8]);
			pts.push([cx - Math.cos(a) * off / aspect, cy - Math.sin(a) * off, rad * 0.65]);
		}

		// Douceur des bords : plus la bande de transition est large, plus c'est flou
		const soft = { doux: 0.3, fort: 0.4, tres: 0.48 }[o.haloBlur] || 0.4;
		const lo = 0.5 - soft, hiT = 0.5 + soft;
		const bg = set.bg, mid = set.mid, hi = set.hi;
		const black = o.background ? Math.min(1, (o.haloBlack || 0) / 100) : 0;
		const base = [bg[0] * (1 - black), bg[1] * (1 - black), bg[2] * (1 - black)];

		for (let y = 0; y < gh; y++) {
			const py = (y + 0.5) / gh;
			for (let x = 0; x < gw; x++) {
				// Léger gauchissement de l'espace : contours irréguliers, pas des cercles
				const px = (x + 0.5) / gw + (Noise2(x * 0.05 + t * 0.15, y * 0.05) - 0.5) * 0.12;
				const qy = py + (Noise2(x * 0.05 + 50, y * 0.05 - t * 0.12) - 0.5) * 0.12;
				let f = 0;
				for (let i = 0; i < pts.length; i++) {
					const dx = (px - pts[i][0]) * aspect, dy = qy - pts[i][1];
					const rr = pts[i][2] * pts[i][2];
					f += Math.exp(-(dx * dx + dy * dy) / rr);
				}
				const v = Smooth(lo, hiT, f);          // présence de la forme
				const core = Smooth(hiT, 1.6, f);  // cœur à peine plus clair
				const r = mid[0] + (hi[0] - mid[0]) * core * 0.15;
				const g = mid[1] + (hi[1] - mid[1]) * core * 0.15;
				const bl = mid[2] + (hi[2] - mid[2]) * core * 0.15;
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

	// Rideaux lumineux qui se tordent doucement
	// Dessinés en basse résolution sur un calque, puis agrandis : le lissage fond les colonnes
	aurore(ctx, w, h, t, set, o) {
		const n = [3, 5, 8][o.density];
		const bands = Particles('aurore', n, (r) => ({ ph: r() * 6.28, f: 0.5 + r(), y: 0.2 + r() * 0.35, len: 0.35 + r() * 0.35, tone: r() }));
		const layer = o.layer;
		const lw = Math.max(16, Math.round(w / 6)), lh = Math.max(16, Math.round(h / 6));
		if (layer.width !== lw || layer.height !== lh) { layer.width = lw; layer.height = lh; }
		const lc = layer.getContext('2d');
		lc.clearRect(0, 0, lw, lh);
		lc.globalCompositeOperation = 'lighter';
		for (const b of bands) {
			const col = MixRgb(set.mid, set.hi, b.tone);
			for (let x = 0; x < lw; x++) {
				const u = x / lw;
				const top = lh * (b.y + 0.08 * Math.sin(u * 6.28 * b.f + t * 0.35 + b.ph) + 0.04 * Math.sin(u * 17 + t * 0.9));
				const len = lh * b.len * (0.6 + 0.4 * Math.sin(u * 9 + t * 0.5 + b.ph));
				const a = 0.22 * (0.5 + 0.5 * Math.sin(u * 5 + t * 0.6 + b.ph));
				const g = lc.createLinearGradient(0, top, 0, top + len);
				g.addColorStop(0, Rgba(col, 0));
				g.addColorStop(0.15, Rgba(col, a));
				g.addColorStop(1, Rgba(col, 0));
				lc.fillStyle = g;
				lc.fillRect(x, top, 1, len);
			}
		}
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.filter = `blur(${Math.max(1, w / 400)}px)`;
		ctx.drawImage(layer, 0, 0, w, h);
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
			const px = x * w, py = y * h * 1.2 - h * 0.1, rad = d.s * big;
			const col = MixRgb(set.mid, set.hi, d.tone);
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

	// Formes géométriques qui flottent et tournent
	geometrique(ctx, w, h, t, set, o) {
		const n = [14, 28, 50][o.density];
		const items = Particles('geometrique', n, (r) => ({ x: r(), y: r(), s: 0.025 + r() * 0.06, vx: (r() - 0.5) * 0.02, vy: (r() - 0.5) * 0.02, rot: r() * 6.28, vr: (r() - 0.5) * 0.5, tone: r(), fill: r() < 0.45, a: 0.35 + r() * 0.45 }));
		const sides = { triangles: 3, hexagones: 6, losanges: 4, cercles: 0 }[o.shapeKind] ?? 3;
		const big = Math.min(w, h) * 0.5 + Math.max(w, h) * 0.5;
		ctx.lineWidth = Math.max(1, 2 * o.unit);
		ctx.lineJoin = 'round';
		for (const it of items) {
			const x = (((it.x + it.vx * t) % 1) + 1) % 1 * w;
			const y = (((it.y + it.vy * t) % 1) + 1) % 1 * h;
			const rad = it.s * big * 0.5;
			const col = Rgba(MixRgb(set.mid, set.hi, it.tone), it.a);
			ctx.beginPath();
			if (sides === 0) ctx.arc(x, y, rad, 0, 6.2832);
			else {
				const a0 = it.rot + it.vr * t;
				for (let i = 0; i <= sides; i++) {
					const a = a0 + i * 6.2832 / sides;
					const rr = sides === 4 && i % 2 ? rad * 0.62 : rad; // losange : un axe plus court
					const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
					i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
				}
				ctx.closePath();
			}
			if (it.fill) { ctx.fillStyle = col; ctx.fill(); }
			else { ctx.strokeStyle = col; ctx.stroke(); }
		}
	},

	// Lave : bulles molles qui montent, se déforment et fusionnent (lampe à lave)
	// Calque à mi-résolution, filtre « gooey » puis flou pour des bords doux
	lave(ctx, w, h, t, set, o) {
		const n = [4, 7, 11][o.density];
		const blobs = Particles('lave2', n, (r) => ({ x: 0.1 + r() * 0.8, f: 0.012 + r() * 0.025, ph: r() * 6.28, s: 0.11 + r() * 0.11, tone: r() < 0.55, wob: 0.6 + r() * 0.8 }));
		const layer = o.layer;
		const lw = Math.max(16, Math.round(w / 2)), lh = Math.max(16, Math.round(h / 2));
		if (layer.width !== lw || layer.height !== lh) { layer.width = lw; layer.height = lh; }
		const lc = layer.getContext('2d');
		lc.clearRect(0, 0, lw, lh);
		const big = Math.min(lw, lh);
		const blob = (x, y, rad, col, ph) => {
			// Bulle déformée : 3 cercles qui oscillent autour du centre
			lc.fillStyle = Rgba(col, 1);
			for (let j = 0; j < 3; j++) {
				const a = ph + j * 2.1 + t * 0.4;
				lc.beginPath();
				lc.arc(x + Math.cos(a) * rad * 0.35, y + Math.sin(a * 1.3) * rad * 0.45, rad * (0.62 + 0.12 * Math.sin(t * 0.7 + ph + j)), 0, 6.2832);
				lc.fill();
			}
		};
		for (const b of blobs) {
			const y = lh * (0.5 + 0.55 * Math.sin(t * b.f * 6.28 + b.ph));
			const x = lw * (b.x + 0.06 * Math.sin(t * 0.25 * b.wob + b.ph));
			blob(x, y, b.s * big, b.tone ? set.mid : set.hi, b.ph);
		}
		// Bas et haut de la lampe : des masses molles, pas des bandes droites
		for (let i = 0; i < 8; i++) {
			const x = lw * (i + 0.5) / 8;
			blob(x + Math.sin(t * 0.3 + i) * big * 0.06, lh * (1.1 + 0.03 * Math.sin(t * 0.5 + i * 1.3)), big * 0.26, set.mid, i * 1.7);
			if (i % 2) blob(x + Math.cos(t * 0.27 + i) * big * 0.06, -lh * 0.1, big * 0.2, set.mid, i * 2.3);
		}
		const soft = { leger: 0.006, moyen: 0.014, fort: 0.026 }[o.lavaBlur] || 0.014;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.filter = `url(#goo) blur(${Math.max(1, Math.min(w, h) * soft)}px)`;
		ctx.drawImage(layer, 0, 0, w, h);
		ctx.restore();
	}

};
