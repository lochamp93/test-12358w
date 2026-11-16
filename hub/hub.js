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

	function setSidebar(collapsed) {
		document.body.classList.toggle('sidebar-collapsed', collapsed);
		sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
		try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) { }
	}

	sidebarToggle.addEventListener('click', () => {
		setSidebar(!document.body.classList.contains('sidebar-collapsed'));
	});

	try { if (localStorage.getItem(SIDEBAR_KEY) === '1') setSidebar(true); } catch (e) { }

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
			frame.src = w.settings;
			document.title = w.name + ' · Widgets';
		}
		markCurrent();
		// Sur un écran étroit, la barre se referme après un choix
		if (window.matchMedia('(max-width: 700px)').matches) setSidebar(true);
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
