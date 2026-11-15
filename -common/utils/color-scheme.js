/*
 * color-scheme.js : thème clair/sombre des pages de paramétrage et des docks (DA Apple)
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

	// Icônes lune / soleil (SF Symbols fournis, voir -common/resources/icons)
	const ICONS =
		'<svg class="icon-moon" viewBox="0 0 28 28" aria-hidden="true"><path d="M14.37 27.7299C20.3 27.7299 25.19 24.1599 27.37 19.4599C27.93 18.2799 27.14 17.5399 26.1 17.9299C25.02 18.3199 23.32 18.6699 21.8 18.6699C13.81 18.6699 9.25 14.0999 9.25 6.09994C9.25 4.57994 9.61 2.82994 10.13 1.57994C10.61 0.399942 9.77 -0.35006 8.62 0.16994C3.68 2.32994 0 7.36994 0 13.3499C0 21.2899 6.44 27.7299 14.37 27.7299ZM14.37 25.1999C7.83 25.1999 2.53 19.8799 2.53 13.3499C2.53 9.55994 4.43 6.32994 6.97 4.34994C6.82 5.04994 6.74 5.69994 6.74 6.42994C6.86 15.5199 12.37 21.0399 21.45 21.1699C22.08 21.1699 22.68 21.0999 23.18 21.0199C21.19 23.4899 18.03 25.1999 14.37 25.1999Z"/></svg>' +
		'<svg class="icon-sun" viewBox="0 0 31 31" aria-hidden="true"><path d="M15.2 5.58C15.94 5.58 16.57 4.95 16.57 4.21V1.37C16.57 0.610001 15.94 0 15.2 0C14.46 0 13.83 0.610001 13.83 1.37V4.21C13.83 4.95 14.46 5.58 15.2 5.58ZM22.01 8.43C22.54 8.94 23.42 8.95 23.95 8.42L25.97 6.4C26.48 5.88 26.48 4.99 25.96 4.47C25.44 3.95 24.57 3.95 24.03 4.47L22.01 6.51C21.49 7.03 21.49 7.9 22.01 8.43ZM8.36 8.43C8.9 7.91 8.9 7.01 8.39 6.51L6.37 4.47C5.86 3.96 4.97 3.95 4.45 4.47C3.93 4.99 3.92 5.88 4.43 6.38L6.45 8.42C6.97 8.94 7.84 8.94 8.36 8.43ZM15.2 22.37C19.14 22.37 22.34 19.17 22.34 15.23C22.34 11.29 19.14 8.08 15.2 8.08C11.26 8.08 8.05 11.29 8.05 15.23C8.05 19.17 11.26 22.37 15.2 22.37ZM15.2 19.85C12.64 19.85 10.58 17.79 10.58 15.23C10.58 12.67 12.64 10.61 15.2 10.61C17.76 10.61 19.82 12.67 19.82 15.23C19.82 17.79 17.76 19.85 15.2 19.85ZM24.84 15.23C24.84 15.97 25.45 16.58 26.21 16.58H29.04C29.79 16.58 30.4 15.97 30.4 15.23C30.4 14.48 29.79 13.86 29.04 13.86H26.21C25.45 13.86 24.84 14.48 24.84 15.23ZM5.56 15.23C5.56 14.48 4.95 13.86 4.19 13.86H1.36C0.61 13.86 0 14.48 0 15.23C0 15.97 0.61 16.58 1.36 16.58H4.19C4.95 16.58 5.56 15.97 5.56 15.23ZM8.39 22.05C7.86 21.53 6.97 21.52 6.45 22.04L4.43 24.05C3.91 24.57 3.91 25.44 4.41 25.96C4.95 26.49 5.84 26.51 6.35 25.99L8.36 23.97C8.9 23.45 8.9 22.57 8.39 22.05ZM22.01 22.05C21.49 22.57 21.49 23.45 22.01 23.97L24.05 26C24.57 26.52 25.44 26.49 25.97 25.98C26.49 25.46 26.49 24.58 25.96 24.06L23.94 22.04C23.42 21.52 22.53 21.53 22.01 22.05ZM15.2 24.88C14.46 24.88 13.83 25.5 13.83 26.25V29.09C13.83 29.83 14.46 30.46 15.2 30.46C15.94 30.46 16.57 29.83 16.57 29.09V26.25C16.57 25.5 15.94 24.88 15.2 24.88Z"/></svg>';

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
