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

const THEMES = {
	// Nappes floues qui dérivent lentement
	brouillard(ctx, w, h, t, set, o) {
		const n = [4, 6, 9][o.density];
		const blobs = Particles('brouillard', n, (r, i) => ({
			ax: r(), ay: r(), fx: 0.03 + r() * 0.05, fy: 0.03 + r() * 0.05,
			px: r() * 6.28, py: r() * 6.28, size: 0.45 + r() * 0.45,
			tone: i % 3, alpha: 0.45 + r() * 0.3
		}));
		const big = Math.max(w, h);
		ctx.globalCompositeOperation = 'source-over';
		for (const b of blobs) {
			const x = w * (0.5 + 0.55 * Math.sin(t * b.fx * 6.28 + b.px) * (0.4 + b.ax * 0.6));
			const y = h * (0.5 + 0.55 * Math.cos(t * b.fy * 6.28 + b.py) * (0.4 + b.ay * 0.6));
			const rad = big * b.size;
			const col = b.tone === 0 ? set.mid : b.tone === 1 ? set.hi : MixRgb(set.mid, set.bg, 0.4);
			const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
			g.addColorStop(0, Rgba(col, b.alpha));
			g.addColorStop(0.55, Rgba(col, b.alpha * 0.35));
			g.addColorStop(1, Rgba(col, 0));
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, w, h);
		}
	},

	// Lignes fluides qui ondulent (courbes de Bézier)
	vagues(ctx, w, h, t, set, o) {
		const n = [6, 12, 20][o.density];
		const lines = Particles('vagues', n, (r) => ({ ph: r() * 6.28, f: 0.6 + r() * 0.8, amp: 0.5 + r() * 0.8 }));
		ctx.lineWidth = Math.max(1, o.lineWidth * o.unit);
		ctx.lineCap = 'round';
		const seg = 4;
		lines.forEach((l, i) => {
			const k = n === 1 ? 0.5 : i / (n - 1);
			const baseY = h * (0.15 + 0.7 * k);
			const amp = h * 0.12 * l.amp;
			ctx.strokeStyle = Rgba(MixRgb(set.mid, set.hi, k), 0.55 + 0.35 * Math.sin(t * 0.4 + l.ph) ** 2);
			ctx.beginPath();
			const yAt = (x) => baseY + amp * Math.sin(x / w * 6.28 * l.f + t * 0.5 + l.ph) * Math.cos(t * 0.23 + k * 3);
			ctx.moveTo(-w * 0.05, yAt(-w * 0.05));
			for (let s = 0; s < seg; s++) {
				const x0 = -w * 0.05 + (w * 1.1) * s / seg;
				const x1 = -w * 0.05 + (w * 1.1) * (s + 1) / seg;
				const cx1 = x0 + (x1 - x0) / 3, cx2 = x0 + (x1 - x0) * 2 / 3;
				ctx.bezierCurveTo(cx1, yAt(cx1), cx2, yAt(cx2), x1, yAt(x1));
			}
			ctx.stroke();
		});
	},

	// Halo : grandes bandes floues qui tournent et se croisent sur un fond sombre
	// (inspiré des fonds animés des lecteurs de musique). Dessiné en basse résolution
	// avec un gros flou, puis agrandi : rendu très doux et léger pour la carte graphique.
	halo(ctx, w, h, t, set, o) {
		const n = Math.max(2, Math.min(6, Math.round(o.haloCount || 4)));
		const bars = Particles('halo', n, (r, i) => ({
			px: r(), py: r(), fx: 0.03 + r() * 0.05, fy: 0.03 + r() * 0.05, ph: r() * 6.28,
			ang: r() * 6.28, spin: (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.5),
			width: 0.3 + r() * 0.22, tone: i % 3
		}));
		const layer = o.layer;
		// Calque plus grand que l'écran (marge de 25 %) : le flou ne crée pas de liseré sur les bords
		const lw = Math.max(24, Math.round(w / 10)), lh = Math.max(24, Math.round(h / 10));
		const mx = Math.round(lw * 0.25), my = Math.round(lh * 0.25);
		if (layer.width !== lw + 2 * mx || layer.height !== lh + 2 * my) { layer.width = lw + 2 * mx; layer.height = lh + 2 * my; }
		const lc = layer.getContext('2d');
		lc.save();
		lc.clearRect(0, 0, layer.width, layer.height);
		lc.translate(mx, my);
		const small = Math.min(lw, lh), diag = Math.hypot(lw, lh);
		const blur = { doux: 0.1, fort: 0.16, tres: 0.24 }[o.haloBlur] || 0.16;
		lc.filter = `blur(${Math.max(1, small * blur)}px)`;
		const size = (o.haloSize || 100) / 100;
		for (const b of bars) {
			// Vitesse de rotation qui varie : accélérations et ralentissements doux
			const a = b.ang + b.spin * t + 0.9 * Math.sin(t * 0.31 + b.ph) + 0.5 * Math.sin(t * 0.83 + b.ph * 2);
			// Pivot qui se déplace, parfois hors de l'écran (bandes qui entrent par un coin)
			const cx = lw * (-0.15 + 1.3 * (0.5 + 0.5 * Math.sin(t * b.fx * 6.28 + b.ph + b.px * 6.28)));
			const cy = lh * (-0.15 + 1.3 * (0.5 + 0.5 * Math.cos(t * b.fy * 6.28 + b.ph + b.py * 6.28)));
			const col = b.tone === 0 ? set.mid : b.tone === 1 ? set.hi : MixRgb(set.mid, set.hi, 0.5);
			lc.fillStyle = Rgba(col, 0.9);
			lc.save();
			lc.translate(cx, cy);
			lc.rotate(a);
			const bw = small * b.width * size;
			lc.fillRect(-diag, -bw / 2, diag * 2, bw);
			lc.restore();
		}
		lc.restore();
		// Fond : voile noir par-dessus la teinte sombre (le noir fait ressortir la couleur)
		if (o.background && o.haloBlack > 0) {
			ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, o.haloBlack / 100)})`;
			ctx.fillRect(0, 0, w, h);
		}
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(layer, mx, my, lw, lh, 0, 0, w, h);
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

	// Bulles qui fusionnent (lampe à lave) : dessinées sur un calque, puis filtre « gooey »
	lave(ctx, w, h, t, set, o) {
		const n = [6, 10, 16][o.density];
		const blobs = Particles('lave', n, (r) => ({ x: r(), f: 0.02 + r() * 0.04, ph: r() * 6.28, s: 0.06 + r() * 0.09, tone: r() < 0.5 }));
		const layer = o.layer;
		if (layer.width !== w || layer.height !== h) { layer.width = w; layer.height = h; }
		const lc = layer.getContext('2d');
		lc.clearRect(0, 0, w, h);
		const big = Math.min(w, h);
		for (const b of blobs) {
			const y = h * (0.5 + 0.48 * Math.sin(t * b.f * 6.28 + b.ph));
			const x = w * (b.x + 0.05 * Math.sin(t * 0.3 + b.ph));
			lc.fillStyle = Rgba(b.tone ? set.mid : set.hi, 1);
			lc.beginPath();
			lc.arc(x, y, b.s * big, 0, 6.2832);
			lc.fill();
		}
		// Bas et haut de la « lampe » : de la matière qui stagne
		lc.fillStyle = Rgba(set.mid, 1);
		lc.fillRect(0, h * 0.97, w, h * 0.03);
		lc.fillRect(0, 0, w, h * 0.03);
		ctx.save();
		ctx.filter = 'url(#goo)';
		ctx.drawImage(layer, 0, 0);
		ctx.restore();
	}
};
