// Paramètres de recherche
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const settingsJson = urlParams.get("settingsJson") || "";
const widgetURL = urlParams.get("widgetURL") || "";
const showUnmuteIndicator = GetBooleanParam("showUnmuteIndicator", false);

// Éléments de la page
const widgetUrlInputWrapper = document.getElementById('widgetUrlInputWrapper');
const widgetUrlInput = document.getElementById('widgetUrlInput');
const urlLabel = document.getElementById('urlLabel');
const settingsPanel = document.getElementById('settingsPanel');
const widgetPreview = document.getElementById('widgetPreview');
const loadURLBox = document.getElementById('loadUrlBox');
const loadDefaultsBox = document.getElementById('loadDefaultsWrapper');
const loadSettingsBox = document.getElementById('loadSettingsWrapper');
const unmuteLabel = document.getElementById('unmute-label');

// Variables globales
let settingsData = '';
let settingsMap = new Map();

// Construire le préfixe de clé du local storage pour que chaque widget ait ses propres paramètres
const parts = widgetURL.replace(/\/+$/, '').split('/');
const keyPrefix = parts[parts.length - 1];

// Afficher/masquer l’indicateur de réactivation du son
if (showUnmuteIndicator)
	unmuteLabel.style.display = 'inline';

// Texte d’indice pour l’entrée “Charger l’URL”
loadUrlBox.placeholder = `${widgetURL}?...`



/////////////////////////////
// CHARGER DE SETTINGS.JSON //
/////////////////////////////

function LoadJSON(settingsJson) {
	fetch(settingsJson)
		.then(response => response.json())
		.then(data => {
			settingsData = data;

			// Nom du widget (optionnel) : titre de l’onglet et en-tête de la page.
			// Sans "title" dans settings.json, rien ne change pour les widgets existants.
			if (data.title) {
				document.title = data.title;
				try { if (parent && parent !== window) parent.document.title = data.title; } catch (e) { /* autre origine */ }
				const titleLabel = document.getElementById('widgetTitle');
				if (titleLabel) titleLabel.textContent = data.title;
			}

			// DA Apple (clair/sombre) si settings.json contient "design": "apple"
			document.documentElement.classList.toggle('apple', data.design === 'apple');
			if (window.ColorScheme) window.ColorScheme.initToggles();

			// Logo masqué si settings.json contient "showLogo": false
			const headerLogo = document.getElementById('headerLogo');
			if (headerLogo) headerLogo.style.display = data.showLogo === false ? 'none' : '';

			// Fond en damier pour l’aperçu si settings.json contient "checkerPreview": true
			document.getElementById('widget-preview-wrapper').classList.toggle('checker', data.checkerPreview === true);

			// Vider le panneau des paramètres (et les fenêtres de réglages)
			settingsPanel.innerHTML = '';
			document.querySelectorAll('dialog.settings-popup').forEach(d => d.remove());

			const groupedSettings = {};

			// Grouper les paramètres par la propriété 'group'
			data.settings.forEach(setting => {
				if (!groupedSettings[setting.group]) {
					groupedSettings[setting.group] = [];
				}
				groupedSettings[setting.group].push(setting);
			});

			// Afficher les paramètres pour chaque groupe
			for (const groupName in groupedSettings) {
				const groupDiv = document.createElement('div');
				groupDiv.classList.add('setting-group');
				// Section sans cadre ni titre si tous ses réglages ont "bare": true (ex. bouton seul en bas)
				if (groupedSettings[groupName].every(s => s.bare)) groupDiv.classList.add('setting-group-bare');

				const groupHeader = document.createElement('h2');
				groupHeader.textContent = groupName;
				groupDiv.appendChild(groupHeader);

				groupedSettings[groupName].forEach(setting => {
					const settingItem = document.createElement('div');
					settingItem.classList.add('setting-item');
					settingItem.id = `item-${setting.id}`;
					// "indent": 1 | 2 : réglage imbriqué sous le précédent (détails d’une alerte…)
					if (setting.indent) settingItem.classList.add(`indent-${setting.indent}`);

					const labelDescriptionDiv = document.createElement('div');

					if (setting.label || setting.labelTemplate) {
						const label = document.createElement('label');
						label.textContent = setting.label || '';
						// "labelTemplate" : libellé qui reprend la valeur d’un autre réglage
						if (setting.labelTemplate) label.dataset.labelTemplate = setting.labelTemplate;
						labelDescriptionDiv.appendChild(label);
					}

					if (setting.description) {
						const description = document.createElement('p');
						description.innerHTML = setting.description;
						labelDescriptionDiv.appendChild(description);
					}

					const settingItemContent = document.createElement('div');
					settingItemContent.classList.add('setting-item-content');

					let inputElement;
					let extraElement = null;
					switch (setting.type) {
						case 'actions':
							// Ligne « libellé + boutons ronds à icône » :
							// "buttons": [{ "icon": "play"|"gear"|"trash"…, "title": "…", "callFunction": "…",
							//               "popup": "<id>", "popupTitle": "…", "style": "accent"|"danger", "confirm": true }]
							inputElement = document.createElement('div');
							inputElement.id = setting.id;
							inputElement.className = 'setting-actions';
							(setting.buttons || []).forEach(b => {
								const btn = document.createElement('button');
								btn.type = 'button';
								btn.className = 'icon-button' + (b.style ? ` ${b.style}` : '');
								btn.innerHTML = ACTION_ICONS[b.icon] || '';
								btn.title = b.title || '';
								btn.dataset.title = b.title || '';
								btn.setAttribute('aria-label', b.title || b.icon || '');
								btn.addEventListener('click', () => {
									if (b.confirm && !ConfirmClick(btn)) return;
									if (b.popup) OpenPopup(b.popup, b.popupTitle || setting.labelTemplate || setting.label);
									if (b.callFunction) CallPreview(b.callFunction);
								});
								inputElement.appendChild(btn);
							});
							break;
						case 'text':
							inputElement = document.createElement('input');
							inputElement.type = 'text';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							inputElement.autocomplete = 'new-password';
							// Suggestions optionnelles ("datalist": "id") : remplies par l’aperçu via postMessage
							if (setting.datalist) {
								inputElement.setAttribute('list', setting.datalist);
								inputElement.autocomplete = 'off';
							}
							break;
						case 'password':
							inputElement = document.createElement('input');
							inputElement.type = 'password';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							inputElement.autocomplete = 'new-password';
							break;
						case 'checkbox':
							const labelDiv = document.createElement('label');
							labelDiv.classList.add('switch');
							checkBoxElement = document.createElement('input');
							checkBoxElement.type = 'checkbox';
							checkBoxElement.id = setting.id;
							checkBoxElement.checked = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							labelDiv.appendChild(checkBoxElement);

							const slider = document.createElement('span');
							slider.classList.add('slider');
							slider.classList.add('round');
							labelDiv.appendChild(slider);

							// Inverser l’état et mettre à jour la visibilité
							labelDiv.addEventListener('click', () => {
								checkBoxElement.checked = !checkBoxElement.checked;
								UpdateSettingItemVisibility();
							});
							inputElement = labelDiv;
							break;
						case 'select':
							inputElement = document.createElement('select');
							inputElement.id = setting.id; // Added setting ID
							setting.options.forEach(option => {
								const optionElement = document.createElement('option');
								optionElement.value = option.value;
								optionElement.textContent = option.label;
								if (option === setting.defaultValue) {
									optionElement.selected = true;
								}
								inputElement.appendChild(optionElement);
							});
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							break;
						case 'color':
							inputElement = document.createElement('input');
							inputElement.type = 'color';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							break;
						case 'number':
							inputElement = document.createElement('input');
							inputElement.type = 'number';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							inputElement.min = setting.min;
							inputElement.max = setting.max;
							inputElement.step = setting.step;
							break;
						case 'sb-actions':
							inputElement = document.createElement('input');
							inputElement.type = 'text';
							inputElement.placeholder = 'Tapez pour rechercher...';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							inputElement.setAttribute('list', 'streamer-bot-actions');
							inputElement.autocomplete = 'off';
							break;
						case 'font':
							// Police système : liste des polices installées (API Local Font Access de Chrome),
							// chargée au premier clic dans le champ (le navigateur demande l’autorisation)
							inputElement = document.createElement('input');
							inputElement.type = 'text';
							inputElement.id = setting.id;
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							inputElement.placeholder = 'Tapez pour rechercher...';
							inputElement.autocomplete = 'off';
							inputElement.setAttribute('list', 'local-fonts');
							inputElement.addEventListener('mousedown', LoadLocalFonts);
							inputElement.addEventListener('focus', LoadLocalFonts);
							break;
						case 'info':
							// Texte d'information mis à jour par l'aperçu :
							// { type: 'widget-info', id: '<id>', text: '…', status: 'ok' | 'warn' }
							if (setting.copyable) {
								// "copyable": true : champ en lecture seule + bouton « Copier »
								inputElement = document.createElement('input');
								inputElement.type = 'text';
								inputElement.readOnly = true;
								inputElement.id = setting.id;
								inputElement.className = 'setting-info copyable';
								inputElement.value = setting.defaultValue || '';
								inputElement.addEventListener('focus', () => inputElement.select());
								extraElement = document.createElement('button');
								extraElement.type = 'button';
								extraElement.className = 'copy-info-button';
								extraElement.textContent = 'Copier';
								extraElement.addEventListener('click', () => {
									const done = () => {
										extraElement.textContent = 'Copié';
										setTimeout(() => { extraElement.textContent = 'Copier'; }, 1500);
									};
									if (navigator.clipboard) navigator.clipboard.writeText(inputElement.value).then(done, () => { inputElement.select(); document.execCommand('copy'); done(); });
									else { inputElement.select(); document.execCommand('copy'); done(); }
								});
								break;
							}
							inputElement = document.createElement('span');
							inputElement.id = setting.id;
							inputElement.className = 'setting-info';
							inputElement.textContent = setting.defaultValue || '';
							break;
						case 'button':
							inputElement = document.createElement('button');
							inputElement.id = setting.id; // Added setting ID
							inputElement.textContent = setting.label;
							if (setting.danger) inputElement.classList.add('danger');

							inputElement.addEventListener('click', () => {
								// "confirm": true : un second clic dans les 3 secondes est demandé
								if (setting.confirm && !ConfirmClick(inputElement, setting.label)) return;

								widgetPreview.contentWindow[setting.callFunction]();

								const defaultBackgroundColor = "#2e2e2e";
								const defaultTextColor = "white";

								inputElement.style.transitionDuration = '0s'
								inputElement.style.backgroundColor = "#2196f3"
								inputElement.style.color = "#ffffff";

								setTimeout(() => {
									inputElement.style.transitionDuration = '0.2s'
									// DA Apple : on rend la main au thème (clair ou sombre)
									const apple = document.documentElement.classList.contains('apple');
									inputElement.style.backgroundColor = apple ? '' : defaultBackgroundColor;
									inputElement.style.color = apple ? '' : defaultTextColor;
								}, 100);
							});
							break;
						default:
							inputElement = document.createElement('input');
							inputElement.type = 'text';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
					}

					// Enregistrer la valeur par défaut
					if (!settingsMap.has(setting.id))
						settingsMap.set(setting.id, setting.defaultValue);

					// Rafraîchir l’aperçu à chaque changement
					inputElement.addEventListener('input', function (event) {
						const settingElement = document.getElementById(setting.id);
						if (setting.type == 'checkbox')
							settingsMap.set(setting.id, settingElement.checked);
						else
							settingsMap.set(setting.id, settingElement.value);

						SaveSettingsToStorage();
						UpdateSettingItemVisibility();
						RefreshWidgetPreview();
					});

					settingItemContent.appendChild(inputElement);
					if (extraElement) settingItemContent.appendChild(extraElement);
					if (setting.type === 'actions') settingItem.classList.add('setting-item-actions');
					if (setting.copyable) settingItem.classList.add('setting-item-copy');

					if (setting.type == 'button') {
						settingItem.style.display = 'block'
						settingItem.appendChild(settingItemContent);
					}
					else {
						settingItem.appendChild(labelDescriptionDiv);
						settingItem.appendChild(settingItemContent);
					}

					// "popup": "<id>" : réglage rangé dans une fenêtre plutôt que dans la liste
					if (setting.popup) GetPopup(setting.popup).querySelector('.settings-popup-body').appendChild(settingItem);
					else groupDiv.appendChild(settingItem);
				});

				settingsPanel.appendChild(groupDiv);
			}

			// showIf accepte :
			//   "idInterrupteur"                               → visible si l’interrupteur est activé (format d’origine)
			//   { "id": "idListe", "value": "slide" }           → visible si la liste vaut "slide"
			//   { "id": "idListe", "value": ["slide", "fade"] } → visible si la liste vaut l’une de ces valeurs
			//   { "id": "idListe", "notValue": "none" }         → visible si la liste ne vaut pas "none"
			//   { "id": "idInterrupteur" }                      → identique au format d’origine
			// Les dépendances en chaîne sont suivies : un réglage est masqué si l’un de ses parents l’est.
			function ShowIfConditionMet(showIf) {
				// { "any": [cond1, cond2] } : visible si au moins une condition (avec sa chaîne) est remplie
				if (showIf && Array.isArray(showIf.any))
					return showIf.any.some(c => ConditionChainMet(c));
				// { "all": [cond1, cond2] } : visible si toutes les conditions (avec leur chaîne) sont remplies
				if (showIf && Array.isArray(showIf.all))
					return showIf.all.every(c => ConditionChainMet(c));

				const cond = typeof showIf === 'string' ? { id: showIf } : showIf;
				const parentInput = document.getElementById(cond.id);
				if (!parentInput) return false;

				if (cond.value !== undefined || cond.notValue !== undefined) {
					const current = parentInput.type === 'checkbox' ? String(parentInput.checked) : String(parentInput.value);
					if (cond.value !== undefined) {
						const accepted = (Array.isArray(cond.value) ? cond.value : [cond.value]).map(String);
						return accepted.includes(current);
					}
					const refused = (Array.isArray(cond.notValue) ? cond.notValue : [cond.notValue]).map(String);
					return !refused.includes(current);
				}

				return parentInput.checked === true;
			}

			// Une condition et toute la chaîne de ses parents
			function ConditionChainMet(showIf, depth = 0) {
				if (!showIf || depth > 20) return true;
				if (!ShowIfConditionMet(showIf)) return false;
				if (Array.isArray(showIf.any) || Array.isArray(showIf.all)) return true; // chaque branche a déjà vérifié sa chaîne
				const parentId = typeof showIf === 'string' ? showIf : showIf.id;
				const parent = data.settings.find(s => s.id === parentId);
				return parent ? ConditionChainMet(parent.showIf, depth + 1) : true;
			}

			function UpdateSettingItemVisibility() {
				data.settings.forEach(setting => {
					// "hidden": true : réglage jamais affiché (géré par le widget), mais présent dans l’URL
					if (setting.hidden) {
						const hiddenItem = document.getElementById(`item-${setting.id}`);
						if (hiddenItem) hiddenItem.style.display = 'none';
						return;
					}
					if (setting.showIf) {
						let shouldShow = true;

						// Remonter la chaîne de dépendances showIf
						let currentSetting = setting;
						let depth = 0;
						while (currentSetting.showIf && depth < 20) {
							if (!ShowIfConditionMet(currentSetting.showIf)) {
								shouldShow = false;
								break;
							}

							// Condition « any » : chaque branche a déjà vérifié sa propre chaîne
							if (Array.isArray(currentSetting.showIf.any) || Array.isArray(currentSetting.showIf.all)) break;

							// Retrouver l’objet parent (pour continuer à remonter)
							const parentId = typeof currentSetting.showIf === 'string' ? currentSetting.showIf : currentSetting.showIf.id;
							currentSetting = data.settings.find(s => s.id === parentId) || {};
							depth++;
						}

						const item = document.getElementById(`item-${setting.id}`);
						if (item) item.style.display = shouldShow ? 'flex' : 'none';
					}
				});

				RefreshActionLabels();

				// Une section dont tous les réglages sont masqués disparaît aussi (titre compris)
				settingsPanel.querySelectorAll('.setting-group').forEach(group => {
					const items = Array.from(group.querySelectorAll('.setting-item'));
					const anyVisible = items.some(item => item.style.display !== 'none');
					group.style.display = items.length === 0 || anyVisible ? '' : 'none';
				});
			}

			UpdateSettingItemVisibility();
			RefreshWidgetPreview();
			SaveSettingsToStorage();
		})
		.catch(error => console.error('Erreur lors du chargement des paramètres :', error));
}

// Liste des polices installées, partagée par tous les champs de type 'font'
let localFontsPromise = null;

function LoadLocalFonts() {
	if (localFontsPromise) return localFontsPromise;
	if (!('queryLocalFonts' in window)) {
		console.warn('Ce navigateur ne permet pas de lister les polices installées (Chrome ou Edge requis).');
		return Promise.resolve();
	}

	localFontsPromise = window.queryLocalFonts()
		.then(fonts => {
			const families = [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b));
			let datalist = document.getElementById('local-fonts');
			if (!datalist) {
				datalist = document.createElement('datalist');
				datalist.id = 'local-fonts';
				document.body.appendChild(datalist);
			}
			datalist.innerHTML = '';
			families.forEach(family => {
				const option = document.createElement('option');
				option.value = family;
				datalist.appendChild(option);
			});
		})
		.catch(err => {
			console.warn('Accès aux polices refusé :', err);
			localFontsPromise = null; // on pourra redemander au prochain clic
		});

	return localFontsPromise;
}

function SaveSettingsToStorage() {
	console.debug(settingsMap);
	const settingsArray = Array.from(settingsMap.entries());
	const settingsArrayString = JSON.stringify(settingsArray);
	localStorage.setItem(`${keyPrefix}-settings`, settingsArrayString);
}

function LoadSettingsFromStorage() {
	// Récupérer les paramètres depuis le local storage
	const settingsMapString = localStorage.getItem(`${keyPrefix}-settings`);
	if (settingsMapString) {
		const settingsMapArray = JSON.parse(settingsMapString);
		settingsMap = new Map(settingsMapArray);
	}
}

function LoadDefaultSettings() {
	localStorage.removeItem(`${keyPrefix}-settings`);
	settingsMap = new Map();
	LoadJSON(settingsJson);

	loadDefaultsBox.style.visibility = 'hidden';
	loadDefaultsBox.style.opacity = 0;
}

function RefreshWidgetPreview() {
	const settings = {};
	settingsData.settings.forEach(setting => {
		if (IsValueless(setting)) return; // Ignorer les boutons, infos et lignes d’actions

		let inputElement = document.getElementById(setting.id);
		if (!inputElement) return;

		if (setting.type === 'checkbox') {
			settings[setting.id] = inputElement.checked;
		} else {
			settings[setting.id] = inputElement.value;
		}
	});

	// Construire la chaîne de paramètres (URLSearchParams gère couleurs, espaces, virgules…)
	// "compactURL": true dans settings.json : seuls les réglages différents de leur valeur
	// par défaut vont dans l’URL (le widget lit les autres dans settings.json). Sinon : tout.
	const defaults = {};
	if (settingsData.compactURL === true)
		settingsData.settings.forEach(setting => { defaults[setting.id] = setting.defaultValue; });

	// Réglages "previewOnly": true : utilisés par l’aperçu, jamais dans l’URL copiée pour OBS
	const previewOnly = new Set(settingsData.settings.filter(s => s.previewOnly).map(s => s.id));

	const searchParams = new URLSearchParams();
	Object.entries(settings).forEach(([key, value]) => {
		if (previewOnly.has(key)) return;
		if (settingsData.compactURL === true && key in defaults && String(value) === String(defaults[key])) return;
		searchParams.set(key, value);
	});
	const paramString = searchParams.toString();

	console.debug('Chaîne de paramètres :', paramString);

	// URL copiée pour OBS : jamais de paramètre demo
	widgetUrlInput.value = paramString ? widgetURL + "?" + paramString : widgetURL;

	// URL de l’aperçu : demo=true si settings.json le demande ("demo": true)
	const previewParams = new URLSearchParams(searchParams);
	previewOnly.forEach(key => { if (key in settings) previewParams.set(key, settings[key]); });
	if (settingsData.demo === true)
		previewParams.set('demo', 'true');
	const previewURL = widgetURL + "?" + previewParams.toString();

	// Aperçu en direct sans rechargement si settings.json contient "livePreview": true
	// (le widget écoute alors les messages 'widget-settings'). Sinon : comportement d’origine.
	latestPreviewParams = previewParams.toString();
	if (settingsData.livePreview === true && previewInitialised) {
		SendSettingsToPreview();
	}
	else {
		previewInitialised = true;
		widgetPreview.src = previewURL;
	}

	UpdateStreamerBotConnection();
}

// Aperçu en direct : dernier jeu de paramètres envoyé à l’iframe
let previewInitialised = false;
let latestPreviewParams = '';

function SendSettingsToPreview() {
	if (!widgetPreview.contentWindow) return;
	widgetPreview.contentWindow.postMessage({ type: 'widget-settings', params: latestPreviewParams }, '*');
}

// Si des réglages changent pendant le chargement de l’iframe, on les renvoie une fois chargée
widgetPreview.addEventListener('load', () => {
	if (settingsData && settingsData.livePreview === true)
		SendSettingsToPreview();
});

// Ne reconnecte la page de paramétrage à Streamer.bot que si l’adresse ou le port changent
let lastSbHost = null;
let lastSbPort = null;

function UpdateStreamerBotConnection() {
	let addressElement = document.getElementById('address');
	let portElement = document.getElementById('port');

	if (addressElement && portElement)
		client.options.host = addressElement.value;

	if (portElement)
		client.options.port = portElement.value;

	if (client.options.host === lastSbHost && String(client.options.port) === String(lastSbPort))
		return;

	lastSbHost = client.options.host;
	lastSbPort = client.options.port;
	// La promesse est interceptée : Streamer.bot fermé ne doit pas lever d’erreur dans la page
	Promise.resolve(client.connect()).catch(err => console.warn('Streamer.bot injoignable :', err && err.message ? err.message : err));
}



//////////////////
// STREAMER.BOT //
//////////////////

// Connexion à Streamer.bot et récupération de la liste des actions
let sbServerAddress = '127.0.0.1';
let sbServerPort = '8080';
let client = new StreamerbotClient({
	host: sbServerAddress,
	port: sbServerPort,

	onConnect: (data) => {
		console.log(`Streamer.bot connecté avec succès à ${sbServerAddress}:${sbServerPort}`)
		console.debug(data);

		// Récupérer la liste des actions
		GetSBActions();
	},

	onDisconnect: () => {
		console.error(`Streamer.bot déconnecté de ${sbServerAddress}:${sbServerPort}`)
	}
});

async function GetSBActions() {
	const response = await client.getActions();

	console.debug(response);

	const datalistElement = document.createElement('datalist');
	datalistElement.id = 'streamer-bot-actions';

	for (const action of response.actions) {
		const option = document.createElement('option');
		option.value = action.name;
		datalistElement.appendChild(option);
	}

	document.body.appendChild(datalistElement);
}



/////////////////////////
// ÉVÉNEMENTS BOUTONS  //
/////////////////////////

function CopyURLToClipboard() {
	// Copier dans le presse-papiers
	navigator.clipboard.writeText(widgetUrlInput.value);

	// Créer le message "Copié !"
	const copiedMessage = document.createElement('span');
	copiedMessage.textContent = 'Copié dans le presse-papiers !';
	copiedMessage.style.textAlign = 'center';
	copiedMessage.style.fontWeight = 'absolute';
	copiedMessage.style.position = 'absolute';
	copiedMessage.style.top = '50%';
	copiedMessage.style.left = '50%';
	copiedMessage.style.transform = 'translate(-50%, -50%)';
	copiedMessage.style.backgroundColor = '#00dd63'; // Vert
	copiedMessage.style.color = 'white';
	copiedMessage.style.padding = '5px 10px';
	copiedMessage.style.borderRadius = '5px';
	copiedMessage.style.fontWeight = '500';
	copiedMessage.style.zIndex = '2'; // au-dessus de l’input/label
	copiedMessage.style.opacity = '0'; // départ en transparence
	copiedMessage.style.transition = 'opacity 0.2s ease-in-out';

	widgetUrlInputWrapper.appendChild(copiedMessage);

	// Forcer un reflow pour déclencher la transition
	void copiedMessage.offsetWidth;

	// Fondu entrant
	copiedMessage.style.opacity = '1';

	// Disparition puis retrait après 3 s
	setTimeout(() => {
		copiedMessage.style.opacity = '0';
		setTimeout(() => {
			widgetUrlInputWrapper.removeChild(copiedMessage);
		}, 500); // attendre la fin du fondu
	}, 5000);
}

function CloseDefaultsPopup() {
	loadDefaultsBox.style.visibility = 'hidden';
	loadDefaultsBox.style.opacity = 0;
};

function CloseSettings() {
	loadSettingsBox.style.visibility = 'hidden';
	loadSettingsBox.style.opacity = 0;
};

function LoadSettings() {
	const url = new URL(loadURLBox.value);

	// URL compacte : un réglage absent de l’URL reprend sa valeur par défaut
	if (settingsData && settingsData.compactURL === true) {
		settingsData.settings.forEach(setting => {
			if (IsValueless(setting)) return;
			const el = document.getElementById(setting.id);
			if (!el) return;
			if (el.type === 'checkbox') el.checked = setting.defaultValue === true;
			else el.value = setting.defaultValue;
			settingsMap.set(setting.id, setting.defaultValue);
		});
	}

	url.searchParams.forEach((value, key) => {

		// Alias : un ancien nom de paramètre déclaré dans settings.json ("aliases": [...])
		if (settingsData && settingsData.settings) {
			const aliased = settingsData.settings.find(s => Array.isArray(s.aliases) && s.aliases.includes(key));
			if (aliased && !url.searchParams.has(aliased.id))
				key = aliased.id;
		}

		const inputElement = document.getElementById(key);
		if (inputElement != null) {
			if (inputElement.type == 'checkbox')
				inputElement.checked = ['true', '1', 'yes', 'on', 'oui'].includes(value.toLocaleLowerCase());
			else
				inputElement.value = value;
			inputElement.dispatchEvent(new Event('input', { bubbles: true })); // Déclenche le rafraîchissement (bubbles : nécessaire pour les interrupteurs)
		}
	});

	// URL compacte sans paramètre : rafraîchir quand même le formulaire, l’aperçu et le lien
	if (settingsData && settingsData.compactURL === true) {
		const first = settingsData.settings.find(st => !IsValueless(st) && document.getElementById(st.id));
		if (first) document.getElementById(first.id).dispatchEvent(new Event('input', { bubbles: true }));
	}

	loadURLBox.value = '';

	loadSettingsBox.style.visibility = 'hidden';
	loadSettingsBox.style.opacity = 0;
}

function OpenMembershipPage() {
	window.open("https://nutty.gg", '_blank').focus();
}

function OpenLoadDefaultsPopup() {
	loadDefaultsBox.style.visibility = 'visible';
	loadDefaultsBox.style.opacity = 1;
}

function OpenLoadSettingsPopup() {
	loadSettingsBox.style.visibility = 'visible';
	loadSettingsBox.style.opacity = 1;
}



//////////////////////
// FONCTIONS AIDE   //
//////////////////////

// Gérer la première interaction avec la fenêtre
window.addEventListener('message', (event) => {
	// Suggestions envoyées par l’aperçu : { type: 'widget-datalist', id: 'liste', options: ['a', 'b'] }
	// (utilisées par les champs texte qui déclarent "datalist": "liste" dans settings.json)
	if (event.source === widgetPreview.contentWindow && event.data && event.data.type === 'widget-datalist'
		&& typeof event.data.id === 'string' && Array.isArray(event.data.options)) {
		let datalist = document.getElementById(event.data.id);
		if (!datalist) {
			datalist = document.createElement('datalist');
			datalist.id = event.data.id;
			document.body.appendChild(datalist);
		}
		datalist.innerHTML = '';
		event.data.options.forEach(value => {
			const option = document.createElement('option');
			option.value = String(value);
			datalist.appendChild(option);
		});
		return;
	}

	// Choix d'une liste déroulante fournis par l'aperçu :
	// { type: 'widget-options', id: '<id>', options: [{ value, label }] }
	if (event.source === widgetPreview.contentWindow && event.data && event.data.type === 'widget-options'
		&& typeof event.data.id === 'string' && Array.isArray(event.data.options)) {
		const select = document.getElementById(event.data.id);
		if (select && select.tagName === 'SELECT') {
			const current = select.value;
			select.innerHTML = '';
			event.data.options.forEach(o => {
				const option = document.createElement('option');
				option.value = String(o.value);
				option.textContent = String(o.label);
				select.appendChild(option);
			});
			if ([...select.options].some(o => o.value === current)) select.value = current;
		}
		return;
	}

	// Valeurs de réglages modifiées par l'aperçu (ex. « Nouveau scénario ») :
	// { type: 'widget-set', values: { id: valeur, … } } ; formulaire, aperçu et URL sont mis à jour
	if (event.source === widgetPreview.contentWindow && event.data && event.data.type === 'widget-set'
		&& event.data.values && typeof event.data.values === 'object') {
		let last = null;
		for (const [id, value] of Object.entries(event.data.values)) {
			const el = document.getElementById(id);
			if (!el) continue;
			if (el.type === 'checkbox') el.checked = value === true || String(value) === 'true';
			else {
				if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === String(value))) {
					const option = document.createElement('option');
					option.value = String(value);
					option.textContent = String(value);
					el.appendChild(option);
				}
				el.value = String(value);
			}
			settingsMap.set(id, el.type === 'checkbox' ? el.checked : el.value);
			last = el;
		}
		if (last) last.dispatchEvent(new Event('input', { bubbles: true })); // sauvegarde, visibilité, aperçu, URL
		return;
	}

	// Texte d'information envoyé par l'aperçu (réglages de type "info")
	if (event.source === widgetPreview.contentWindow && event.data && event.data.type === 'widget-info'
		&& typeof event.data.id === 'string') {
		const el = document.getElementById(event.data.id);
		if (el && el.classList.contains('setting-info')) {
			if (el.tagName === 'INPUT') el.value = String(event.data.text || '');
			else el.textContent = String(event.data.text || '');
			el.dataset.status = event.data.status || '';
			if (event.data.title) el.title = String(event.data.title);
		}
		return;
	}

	if (event.origin === new URL(widgetPreview.src).origin && event.data === 'iframe-interacted') {
		iframeHasBeenInteractedWith = true;
		console.log('Interaction avec l’iframe détectée !');
		unmuteLabel.style.display = 'none';
	}
});




// Icônes des boutons d'action ("actions") : play, gear, trash, forward, mute, unmute
const ACTION_ICONS = {
	play: '<svg viewBox="0 0 22 24" aria-hidden="true"><path d="M0 21.53C0 23.02 0.89 23.75 1.94 23.75C2.4 23.75 2.88 23.61 3.35 23.35L19.49 13.93C20.67 13.25 21.15 12.71 21.15 11.88C21.15 11.03 20.67 10.51 19.49 9.83L3.35 0.389999C2.88 0.129999 2.4 0 1.94 0C0.89 0 0 0.72 0 2.23V21.53Z"/></svg>',
	gear: '<svg viewBox="0 0 30 30" aria-hidden="true"><path d="M13.27 29.04H15.77C16.58 29.04 17.18 28.56 17.36 27.77L18.06 24.85C18.52 24.69 18.97 24.51 19.38 24.32L21.93 25.88C22.6 26.3 23.38 26.24 23.94 25.68L25.69 23.93C26.25 23.36 26.33 22.56 25.88 21.87L24.33 19.36C24.52 18.93 24.72 18.5 24.85 18.07L27.78 17.38C28.57 17.18 29.05 16.6 29.05 15.79V13.33C29.05 12.52 28.57 11.93 27.78 11.74L24.88 11.05C24.72 10.55 24.52 10.12 24.36 9.75L25.91 7.18C26.33 6.48 26.29 5.73 25.71 5.15L23.94 3.4C23.36 2.88 22.64 2.76 21.97 3.17L19.38 4.76C18.99 4.57 18.55 4.39 18.06 4.22L17.36 1.27C17.17 0.479999 16.58 0 15.77 0H13.27C12.45 0 11.86 0.479999 11.67 1.28L10.99 4.2C10.51 4.36 10.05 4.54 9.64 4.74L7.07 3.17C6.4 2.76 5.66 2.84 5.1 3.4L3.32 5.15C2.75 5.73 2.7 6.48 3.13 7.18L4.67 9.75C4.51 10.12 4.32 10.55 4.17 11.05L1.27 11.74C0.48 11.93 0 12.52 0 13.33V15.79C0 16.6 0.48 17.18 1.27 17.38L4.19 18.07C4.33 18.5 4.51 18.93 4.7 19.36L3.16 21.87C2.72 22.56 2.79 23.36 3.35 23.93L5.1 25.68C5.66 26.24 6.45 26.3 7.12 25.88L9.65 24.32C10.06 24.51 10.51 24.69 10.99 24.85L11.67 27.77C11.86 28.56 12.45 29.04 13.27 29.04ZM14.52 19.3C11.88 19.3 9.73 17.16 9.73 14.52C9.73 11.88 11.88 9.73 14.52 9.73C17.16 9.73 19.3 11.88 19.3 14.52C19.3 17.16 17.16 19.3 14.52 19.3Z"/></svg>',
	trash: '<svg viewBox="0 0 27 31" aria-hidden="true"><path d="M7.21 30.85H19.77C21.86 30.85 23.22 29.58 23.31 27.48L24.24 7.77H25.75C26.43 7.77 26.96 7.26 26.96 6.57C26.96 5.9 26.43 5.38 25.75 5.38H19.66V3.33C19.66 1.24 18.34 0 16.07 0H10.87C8.62 0 7.28 1.24 7.28 3.33V5.38H1.2C0.55 5.38 0 5.9 0 6.57C0 7.26 0.55 7.77 1.2 7.77H2.72L3.65 27.49C3.75 29.6 5.09 30.85 7.21 30.85ZM9.79 3.45C9.79 2.74 10.28 2.29 11.05 2.29H15.89C16.65 2.29 17.15 2.74 17.15 3.45V5.38H9.79V3.45ZM9.29 26.61C8.7 26.61 8.31 26.26 8.29 25.68L7.88 10.81C7.86 10.24 8.25 9.87 8.85 9.87C9.41 9.87 9.82 10.22 9.83 10.81L10.26 25.67C10.28 26.23 9.89 26.61 9.29 26.61ZM13.48 26.61C12.89 26.61 12.48 26.25 12.48 25.68V10.81C12.48 10.24 12.89 9.87 13.48 9.87C14.07 9.87 14.48 10.24 14.48 10.81V25.68C14.48 26.25 14.07 26.61 13.48 26.61ZM17.68 26.61C17.08 26.61 16.68 26.25 16.7 25.67L17.13 10.81C17.15 10.24 17.54 9.87 18.12 9.87C18.72 9.87 19.1 10.24 19.09 10.81L18.66 25.68C18.64 26.26 18.25 26.61 17.68 26.61Z"/></svg>',
	forward: '<svg viewBox="0 0 27 22" aria-hidden="true"><path d="M0 19.52C0 20.96 0.84 21.64 1.86 21.64C2.29 21.64 2.76 21.52 3.2 21.27L17.74 12.8C18.58 12.32 19.04 11.9 19.22 11.36V19.62C19.22 20.92 19.88 21.58 21.19 21.58H24.39C25.67 21.58 26.34 20.92 26.34 19.62V2.02C26.34 0.7 25.67 0.0600014 24.39 0.0600014H21.19C19.89 0.0600014 19.22 0.73 19.22 2.02V10.3C19.04 9.76 18.58 9.34 17.74 8.86L3.2 0.380001C2.76 0.120001 2.29 0 1.86 0C0.84 0 0 0.700001 0 2.13V19.52Z"/></svg>',
	mute: '<svg viewBox="0 0 27 27" aria-hidden="true"><path d="M19.47 15.57V1.83C19.47 0.82 18.71 0 17.68 0C16.98 0 16.49 0.3 15.73 0.99L10.43 5.93C10.37 5.98 10.29 6.03 10.22 6.03H9.9L19.47 15.57ZM24.24 25.78C24.66 26.21 25.36 26.21 25.77 25.78C26.19 25.36 26.19 24.67 25.77 24.25L1.86 0.35C1.43 -0.0699996 0.740002 -0.0699996 0.310002 0.35C-0.0999976 0.76 -0.0999976 1.47 0.310002 1.9L24.24 25.78ZM5.77 18.02H9.62C9.76 18.02 9.86 18.04 9.94 18.13L15.73 23.53C16.43 24.18 16.99 24.46 17.69 24.46C18.47 24.46 19.07 24.07 19.33 23.27L3.44 7.38C2.98 7.88 2.75 8.65 2.75 9.65V14.84C2.75 16.96 3.77 18.02 5.77 18.02Z"/></svg>',
	unmute: '<svg viewBox="0 0 26 25" aria-hidden="true"><path d="M14.95 24.46C15.96 24.46 16.7 23.72 16.7 22.71V1.83C16.7 0.82 15.96 0 14.93 0C14.23 0 13.74 0.28 12.98 0.99L7.27 6.37C7.19 6.44 7.08 6.48 6.95 6.48H3.07C1.08 6.48 0 7.58 0 9.7V14.79C0 16.89 1.08 18.02 3.07 18.02H6.95C7.08 18.02 7.19 18.04 7.27 18.13L12.98 23.53C13.67 24.18 14.24 24.46 14.95 24.46ZM21.57 18.29C22.14 18.66 22.91 18.54 23.32 17.93C24.43 16.47 25.07 14.38 25.07 12.22C25.07 10.06 24.43 7.98 23.32 6.49C22.91 5.9 22.14 5.77 21.57 6.16C20.91 6.6 20.79 7.39 21.31 8.16C22.08 9.24 22.5 10.69 22.5 12.22C22.5 13.74 22.06 15.19 21.31 16.28C20.8 17.06 20.91 17.84 21.57 18.29Z"/></svg>',
};

// Réglages sans valeur (jamais dans l’URL) : boutons, infos, lignes d’actions
function IsValueless(setting) {
	return setting.type === 'button' || setting.type === 'info' || setting.type === 'actions';
}

// Libellé à trous : « Règle 1 : {subRule1Name|sans nom} » → valeur actuelle du réglage, sinon le texte après |
function FillLabelTemplate(template) {
	return String(template || '').replace(/\{([A-Za-z0-9_]+)(?:\|([^}]*))?\}/g, (m, id, fallback) => {
		const el = document.getElementById(id);
		let v = el ? (el.type === 'checkbox' ? String(el.checked) : el.value) : settingsMap.get(id);
		v = String(v == null ? '' : v).trim();
		if (el && el.tagName === 'SELECT' && el.selectedOptions[0]) v = el.selectedOptions[0].textContent;
		return v || fallback || '';
	});
}

function RefreshActionLabels() {
	document.querySelectorAll('[data-label-template]').forEach(el => {
		el.textContent = FillLabelTemplate(el.dataset.labelTemplate);
	});
}

// Fenêtres de réglages ("popup": "<id>") : les réglages concernés s’affichent dans une fenêtre
// ouverte par un bouton d’action { "icon": "gear", "popup": "<id>" }
function GetPopup(id) {
	let dialog = document.getElementById(`popup-${id}`);
	if (dialog) return dialog;
	dialog = document.createElement('dialog');
	dialog.id = `popup-${id}`;
	dialog.className = 'settings-popup';
	dialog.innerHTML = '<h3 class="settings-popup-title"></h3><div class="settings-popup-body"></div>' +
		'<div class="settings-popup-footer"><button type="button" class="settings-popup-close">Terminé</button></div>';
	dialog.querySelector('.settings-popup-close').addEventListener('click', () => dialog.close());
	// Clic en dehors de la fenêtre : fermeture
	dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
	document.body.appendChild(dialog);
	return dialog;
}

function OpenPopup(id, titleTemplate) {
	const dialog = GetPopup(id);
	const title = dialog.querySelector('.settings-popup-title');
	title.dataset.labelTemplate = titleTemplate || '';
	title.textContent = FillLabelTemplate(titleTemplate || '');
	if (!dialog.open) dialog.showModal();
}

// Bouton avec confirmation : un second clic dans les 3 secondes est demandé
function ConfirmClick(button, restoreText) {
	if (!button.classList.contains('confirming')) {
		button.classList.add('confirming');
		if (restoreText !== undefined) button.textContent = 'Cliquez à nouveau pour confirmer';
		else button.title = 'Cliquez à nouveau pour confirmer';
		clearTimeout(button._confirmTimer);
		button._confirmTimer = setTimeout(() => {
			button.classList.remove('confirming');
			if (restoreText !== undefined) button.textContent = restoreText;
			else button.title = button.dataset.title || '';
		}, 3000);
		return false;
	}
	clearTimeout(button._confirmTimer);
	button.classList.remove('confirming');
	if (restoreText !== undefined) button.textContent = restoreText;
	else button.title = button.dataset.title || '';
	return true;
}

function CallPreview(name) {
	const fn = widgetPreview.contentWindow && widgetPreview.contentWindow[name];
	if (typeof fn === 'function') fn();
}

// Charger les paramètres depuis le local storage
LoadSettingsFromStorage();

// Charger les paramètres par défaut
LoadJSON(settingsJson);
