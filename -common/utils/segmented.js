/*
 * segmented.js : segmented control (avec -common/styles/segmented.css)
 *
 * Usage :
 *   const seg = Segmented.create(document.getElementById('tabs'), {
 *     options: [{ value: 'qa', label: 'Questions' }, { value: 'highlights', label: 'Highlights' }],
 *     value: 'qa',
 *     size: 'small' | 'large',          // facultatif, small par défaut
 *     onChange: (value) => { ... }
 *   });
 *   seg.set('highlights');               // change l'option active (sans appeler onChange)
 *   seg.setCount('qa', 3);               // petit compteur à côté du libellé (vide : masqué)
 *   seg.setDisabled(true);
 *   seg.value                            // option active
 *
 * Clavier : flèches gauche et droite, Début et Fin.
 */
(function () {
	'use strict';

	function create(container, opts) {
		const options = (opts && opts.options) || [];
		const el = container || document.createElement('div');
		el.classList.add('segmented');
		if (opts && opts.size === 'large') el.classList.add('large');
		el.setAttribute('role', 'tablist');
		el.innerHTML = '';
		el.style.setProperty('--seg-count', String(Math.max(1, options.length)));

		const thumb = document.createElement('span');
		thumb.className = 'segmented-thumb';
		el.appendChild(thumb);

		const buttons = options.map((o, i) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'segment';
			b.dataset.value = String(o.value);
			b.setAttribute('role', 'tab');
			const label = document.createElement('span');
			label.className = 'segment-label';
			label.textContent = o.label;
			const count = document.createElement('span');
			count.className = 'segment-count';
			b.append(label, count);
			b.addEventListener('click', () => choose(i, true));
			el.appendChild(b);
			return b;
		});

		let index = -1;
		const api = {
			el,
			get value() { return index >= 0 ? String(options[index].value) : null; },
			set(value) {
				const i = options.findIndex(o => String(o.value) === String(value));
				if (i >= 0) choose(i, false);
			},
			setCount(value, n) {
				const b = buttons.find(x => x.dataset.value === String(value));
				if (b) b.querySelector('.segment-count').textContent = n === undefined || n === null || n === '' ? '' : String(n);
			},
			setLabel(value, text) {
				const b = buttons.find(x => x.dataset.value === String(value));
				if (b) b.querySelector('.segment-label').textContent = text;
			},
			setDisabled(on) { el.classList.toggle('disabled', !!on); }
		};

		function choose(i, notify) {
			if (i === index) return;
			index = i;
			el.style.setProperty('--seg-index', String(i));
			buttons.forEach((b, j) => {
				b.classList.toggle('active', j === i);
				b.setAttribute('aria-selected', j === i ? 'true' : 'false');
				b.tabIndex = j === i ? 0 : -1;
			});
			if (notify && opts && typeof opts.onChange === 'function') opts.onChange(String(options[i].value));
		}

		el.addEventListener('keydown', (e) => {
			let i = index;
			if (e.key === 'ArrowRight') i = Math.min(options.length - 1, index + 1);
			else if (e.key === 'ArrowLeft') i = Math.max(0, index - 1);
			else if (e.key === 'Home') i = 0;
			else if (e.key === 'End') i = options.length - 1;
			else return;
			e.preventDefault();
			choose(i, true);
			buttons[i].focus();
		});

		// Position de départ sans animation
		el.classList.add('no-transition');
		const start = options.findIndex(o => opts && String(o.value) === String(opts.value));
		choose(start >= 0 ? start : 0, false);
		requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('no-transition')));
		return api;
	}

	window.Segmented = { create };
})();
