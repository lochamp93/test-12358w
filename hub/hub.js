/*
 * hub.js : liste des widgets (hub/widgets.json) et affichage de leur page de paramétrage.
 * Les pages de paramétrage ne sont pas copiées : le hub les affiche dans un cadre.
 * L'onglet ouvert est inscrit dans l'adresse (#identifiant) pour pouvoir partager un lien direct.
 */
(function () {
	'use strict';

	const list = document.getElementById('widgetList');
	const frame = document.getElementById('settingsFrame');
	const empty = document.getElementById('hubEmpty');
	const search = document.getElementById('hubSearch');
	const emptySearch = document.getElementById('emptySearch');
	const sidebarToggle = document.getElementById('sidebarToggle');

	const SIDEBAR_KEY = 'hub-sidebar-collapsed';
	let widgets = [];
	let currentId = null;

	// ---------- Barre latérale repliable (état mémorisé) ----------

	// Page de paramétrage affichée (cadre dans le cadre), ou null si pas encore prête
	function settingsDocument() {
		try {
			const inner = frame.contentWindow.document.getElementById('widgetContainer');
			return inner && inner.contentWindow ? inner.contentWindow.document : null;
		} catch (e) { return null; }
	}

	// Barre repliée : la page décale son titre pour laisser la place au bouton
	function syncSettingsPage(animate) {
		const doc = settingsDocument();
		if (!doc) return;
		const root = doc.documentElement;
		if (!animate) root.classList.add('hub-no-anim');
		root.classList.toggle('hub-collapsed', document.body.classList.contains('sidebar-collapsed'));
		if (!animate) requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('hub-no-anim')));
	}

	function setSidebar(collapsed) {
		document.body.classList.toggle('sidebar-collapsed', collapsed);
		syncSettingsPage(true);
		sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
		try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) { }
	}

	sidebarToggle.addEventListener('click', () => {
		setSidebar(!document.body.classList.contains('sidebar-collapsed'));
	});

	// État mémorisé appliqué sans animation, puis animations activées
	document.body.classList.add('no-anim');
	try { if (localStorage.getItem(SIDEBAR_KEY) === '1') setSidebar(true); } catch (e) { }
	requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('no-anim')));

	// ---------- Liste des widgets ----------

	function renderList() {
		list.innerHTML = '';
		widgets.forEach(w => {
			const li = document.createElement('li');
			li.dataset.search = w.name.toLocaleLowerCase('fr');
			const a = document.createElement('a');
			a.href = '#' + encodeURIComponent(w.id);
			a.dataset.id = w.id;
			const icon = document.createElement('span');
			icon.className = 'widget-icon';
			icon.setAttribute('aria-hidden', 'true');
			// Adresse complète : une url() relative dans une variable CSS serait lue depuis hub/
			const iconUrl = new URL(`-common/resources/icons/${w.icon}.svg`, document.baseURI).href;
			icon.style.setProperty('--icon', `url("${iconUrl}")`);
			const label = document.createElement('span');
			label.textContent = w.name;
			a.append(icon, label);
			li.appendChild(a);
			list.appendChild(li);
		});
	}

	function markCurrent() {
		list.querySelectorAll('a').forEach(a => {
			if (a.dataset.id === currentId) a.setAttribute('aria-current', 'page');
			else a.removeAttribute('aria-current');
		});
	}

	// ---------- Affichage d'un widget ----------

	function open(id) {
		const w = widgets.find(x => x.id === id) || widgets[0];
		if (!w) { frame.hidden = true; empty.hidden = false; return; }
		empty.hidden = true;
		frame.hidden = false;
		if (w.id !== currentId) {
			currentId = w.id;
			frame.classList.add('loading');
			frame.src = w.settings;
			WaitForSettingsReady();
			document.title = w.name + ' · Widgets';
		}
		markCurrent();
		// Sur un écran étroit, la barre se referme après un choix
		if (window.matchMedia('(max-width: 700px)').matches) setSidebar(true);
	}

	// La page de paramétrage est dans un cadre lui-même dans le cadre du hub :
	// on attend qu'elle ait appliqué son design avant de l'afficher (pas de flash)
	let readyTimer = null;
	function WaitForSettingsReady() {
		clearInterval(readyTimer);
		const started = Date.now();
		readyTimer = setInterval(() => {
			let ready = false;
			try {
				const inner = frame.contentWindow.document.getElementById('widgetContainer');
				const doc = inner && inner.contentWindow && inner.contentWindow.document;
				ready = !!(doc && doc.documentElement.classList.contains('settings-ready'));
			} catch (e) { ready = true; }
			if (ready || Date.now() - started > 4000) {
				clearInterval(readyTimer);
				syncSettingsPage(false);
				frame.classList.remove('loading');
			}
		}, 50);
	}

	function idFromHash() {
		return decodeURIComponent(location.hash.replace(/^#/, ''));
	}

	window.addEventListener('hashchange', () => open(idFromHash()));

	// ---------- Recherche (filtre dès la frappe) ----------

	search.addEventListener('input', () => {
		const q = search.value.trim().toLocaleLowerCase('fr');
		let shown = 0;
		list.querySelectorAll('li').forEach(li => {
			const ok = !q || li.dataset.search.includes(q);
			li.hidden = !ok;
			if (ok) shown++;
		});
		emptySearch.hidden = shown > 0;
	});

	// ---------- Chargement ----------

	fetch('hub/widgets.json', { cache: 'no-cache' })
		.then(r => r.json())
		.then(data => {
			// Ordre alphabétique automatique
			widgets = (data.widgets || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'fr'));
			renderList();
			open(idFromHash());
			if (!location.hash && widgets[0]) history.replaceState(null, '', '#' + encodeURIComponent(widgets[0].id));
		})
		.catch(err => {
			console.error('Impossible de lire hub/widgets.json', err);
			empty.hidden = false;
			empty.querySelector('p').textContent = 'La liste des widgets est introuvable.';
		});
})();
