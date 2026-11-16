/*
 * dock-import.js : bouton « Importer l’action » commun à tous les docks (en-tête).
 * Bleu tant que l’action Streamer.bot du widget n’est pas détectée : un clic copie le code
 * d’import (Import String). Grisé et inactif dès que le dock est connecté et que l’action existe.
 *
 * Usage, dans le dock :
 *   <script src="../../-common/utils/dock-import.js?v=X"></script>
 *   DockImport.init({ url: '../streamerbot/import.txt', toast: Toast });
 *   DockImport.update({ connected, actionFound });   // à chaque changement d’état
 */
(function () {
	'use strict';
	const ICON = '<svg viewBox="0 0 25 30" aria-hidden="true"><path d="M7.65 13.6C7.04 13.6 6.53 14.06 6.53 14.69C6.53 15.02 6.67 15.27 6.9 15.5L11.4 19.83C11.73 20.15 12.01 20.26 12.36 20.26C12.68 20.26 12.98 20.15 13.31 19.83L17.8 15.5C18.03 15.27 18.17 15.02 18.17 14.69C18.17 14.06 17.65 13.6 17.03 13.6C16.72 13.6 16.4 13.74 16.18 13.98L14.23 16.06L13.5 16.95L13.61 14.9V1.23C13.61 0.56 13.04 0 12.36 0C11.66 0 11.08 0.56 11.08 1.23V14.9L11.21 16.95L10.47 16.06L8.51 13.98C8.3 13.74 7.97 13.6 7.65 13.6ZM5.86 29.51H18.84C22.6 29.51 24.7 27.41 24.7 23.65V13.11C24.7 9.35 22.6 7.24 18.84 7.24H16.18V9.92H18.77C20.85 9.92 22.02 11.1 22.02 13.17V23.58C22.02 25.66 20.85 26.83 18.77 26.83H5.93C3.85 26.83 2.68 25.66 2.68 23.58V13.17C2.68 11.1 3.85 9.92 5.93 9.92H8.5V7.24H5.86C2.09 7.24 0 9.35 0 13.11V23.65C0 27.41 2.09 29.51 5.86 29.51Z"/></svg>';
	let button = null;
	let options = { url: '../streamerbot/import.txt', toast: null };

	function notify(text) {
		if (typeof options.toast === 'function') options.toast(text);
		else console.log('[Dock] ' + text);
	}

	async function copy() {
		if (!button || button.disabled) return;
		try {
			const response = await fetch(new URL(options.url, location.href).href, { cache: 'no-cache' });
			if (!response.ok) throw new Error('HTTP ' + response.status);
			await navigator.clipboard.writeText((await response.text()).trim());
			notify('Code d’import copié : dans Streamer.bot, cliquez sur Import, collez-le dans Import String, puis Import');
		} catch (e) {
			notify('Copie impossible : ouvrez le fichier streamerbot/import.txt du widget');
		}
	}

	function create() {
		const header = document.getElementById('header');
		if (!header) return null;
		const b = document.createElement('button');
		b.type = 'button';
		b.id = 'importActionButton';
		b.className = 'dock-import needed';
		b.innerHTML = ICON + '<span>Importer l’action</span>';
		b.addEventListener('click', copy);
		// Placé juste avant les pastilles d’état (sinon en fin d’en-tête)
		const firstStatus = header.querySelector('.status');
		header.insertBefore(b, firstStatus || null);
		return b;
	}

	window.DockImport = {
		init(opts) {
			options = Object.assign(options, opts || {});
			if (!button) button = create();
			this.update({ connected: false, actionFound: false });
		},
		update(stateOrConnected, maybeFound) {
			if (!button) button = create();
			if (!button) return;
			const s = typeof stateOrConnected === 'object' ? stateOrConnected : { connected: stateOrConnected, actionFound: maybeFound };
			const installed = !!(s.connected && s.actionFound);
			button.disabled = installed;
			button.classList.toggle('needed', !installed);
			button.querySelector('span').textContent = installed ? 'Action installée' : 'Importer l’action';
			button.title = installed
				? 'L’action Streamer.bot de ce widget est installée'
				: (s.connected ? 'Action introuvable dans Streamer.bot : cliquez pour copier le code d’import'
					: 'Cliquez pour copier le code d’import Streamer.bot');
		},
		copy
	};
})();
