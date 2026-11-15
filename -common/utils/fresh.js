/*
 * fresh.js : OBS garde les pages en cache (overlay, dock). Au chargement, on compare la
 * version de la page (data-version) avec version.txt du widget, lu sans cache. Si une
 * version plus récente est en ligne, la page se recharge avec ?_v=<version> : l'adresse
 * change, donc le navigateur d'OBS récupère les nouveaux fichiers.
 * Usage : <script src="…/fresh.js?v=X" data-version="X" data-version-url="version.txt"></script>
 */
(function () {
	'use strict';
	const me = document.currentScript;
	if (!me || !window.fetch) return;
	const version = me.dataset.version || '';
	const versionUrl = new URL(me.dataset.versionUrl || 'version.txt', location.href).href;

	fetch(versionUrl, { cache: 'no-store' })
		.then(r => r.ok ? r.text() : '')
		.then(text => {
			const online = String(text || '').trim();
			if (!online || online === version) return;
			const url = new URL(location.href);
			if (url.searchParams.get('_v') === online) return; // déjà rechargée : pas de boucle
			url.searchParams.set('_v', online);
			location.replace(url.href);
		})
		.catch(() => { });
})();
