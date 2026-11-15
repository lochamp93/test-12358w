/*
 * fresh.js : OBS garde les pages en cache et les laisse tourner pendant des heures (overlay,
 * dock). Au chargement puis toutes les 2 minutes, on compare la version de la page
 * (data-version) avec version.txt du widget, lu sans cache. Si une version plus récente est
 * en ligne, la page se recharge avec ?_v=<version> : l'adresse change, donc le navigateur
 * d'OBS récupère les nouveaux fichiers.
 * La page peut retarder le rechargement (ex. alerte en cours) : window.FreshCanReload = () => booléen.
 * Usage : <script src="…/fresh.js?v=X" data-version="X" data-version-url="version.txt"></script>
 */
(function () {
	'use strict';
	const me = document.currentScript;
	if (!me || !window.fetch) return;
	const version = me.dataset.version || '';
	const versionUrl = new URL(me.dataset.versionUrl || 'version.txt', location.href).href;
	const INTERVAL = 2 * 60 * 1000;
	let pending = '';

	function reload(online) {
		const url = new URL(location.href);
		if (url.searchParams.get('_v') === online) return; // déjà rechargée : pas de boucle
		url.searchParams.set('_v', online);
		location.replace(url.href);
	}

	function tryReload() {
		if (!pending) return;
		const can = typeof window.FreshCanReload === 'function' ? window.FreshCanReload() : true;
		if (can) reload(pending);
		else setTimeout(tryReload, 5000); // occupée : on réessaie dans 5 s
	}

	function check() {
		fetch(versionUrl, { cache: 'no-store' })
			.then(r => r.ok ? r.text() : '')
			.then(text => {
				const online = String(text || '').trim();
				if (!online || online === version || pending) return;
				pending = online;
				tryReload();
			})
			.catch(() => { });
	}

	check();
	setInterval(check, INTERVAL);
})();
