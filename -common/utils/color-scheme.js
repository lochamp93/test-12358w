/*
 * color-scheme.js — thème clair/sombre des pages de paramétrage et des docks (DA Apple)
 *
 * - Par défaut, suit le thème du système (prefers-color-scheme).
 * - Le choix de l'utilisateur est mémorisé (localStorage, partagé par tous les widgets
 *   du site) et appliqué à toutes les pages ouvertes.
 * - Tout élément portant l'attribut data-scheme-toggle bascule le thème au clic.
 * - Événement « colorschemechange » émis sur window à chaque changement.
 */
(function () {
	'use strict';

	const KEY = 'ui-color-scheme';
	const root = document.documentElement;
	const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

	function stored() {
		try { return localStorage.getItem(KEY); } catch (e) { return null; }
	}

	function current() {
		const s = stored();
		if (s === 'light' || s === 'dark') return s;
		return media && media.matches ? 'dark' : 'light';
	}

	function apply(scheme) {
		root.setAttribute('data-scheme', scheme);
		window.dispatchEvent(new CustomEvent('colorschemechange', { detail: scheme }));
	}

	function set(scheme) {
		try { localStorage.setItem(KEY, scheme); } catch (e) { }
		apply(scheme);
	}

	function toggle() {
		set(current() === 'dark' ? 'light' : 'dark');
	}

	// Icônes soleil / lune (SVG maison)
	const ICONS =
		'<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"/></svg>' +
		'<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';

	function initToggles() {
		document.querySelectorAll('[data-scheme-toggle]').forEach(el => {
			if (!el.dataset.schemeReady) {
				el.dataset.schemeReady = '1';
				if (!el.innerHTML.trim()) el.innerHTML = ICONS;
				el.title = 'Basculer entre le mode clair et le mode sombre';
				el.addEventListener('click', toggle);
			}
		});
	}

	apply(current());

	// Thème du système modifié (si l'utilisateur n'a rien choisi)
	if (media && media.addEventListener)
		media.addEventListener('change', () => { if (!stored()) apply(current()); });

	// Choix fait dans un autre onglet ou une autre page du site
	window.addEventListener('storage', (e) => { if (e.key === KEY) apply(current()); });

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initToggles);
	else initToggles();

	window.ColorScheme = { current, set, toggle, initToggles };
})();
