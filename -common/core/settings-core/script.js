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
	fetch(settingsJson, { cache: 'no-cache' }) // toujours la dernière définition des réglages
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
					let extraBeforeElement = null;
					switch (setting.type) {
						case 'actions':
							// Ligne « libellé + boutons ronds à icône » :
							// "buttons": [{ "icon": "play"|"gear"|"trash"…, "title": "…", "callFunction": "…",
							//               "popup": "<id>", "popupTitle": "…", "style": "accent"|"danger", "confirm": true }]
							inputElement = MakeActionButtons(setting);
							inputElement.id = setting.id;
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
							// "buttons" sur un interrupteur : boutons ronds à gauche de l'interrupteur,
							// visibles seulement quand il est activé (tester, paramétrer…)
							if (Array.isArray(setting.buttons) && setting.buttons.length) {
								extraBeforeElement = MakeActionButtons(setting);
								extraBeforeElement.dataset.forToggle = setting.id;
							}
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
								// Bouton rond « copier » (icône document sur document), coche une fois copié
								extraElement.className = 'copy-info-button';
								extraElement.title = 'Copier';
								extraElement.setAttribute('aria-label', 'Copier');
								extraElement.dataset.icon = 'copy';
								extraElement.innerHTML = ACTION_ICONS.copy;
								extraElement.addEventListener('click', () => {
									const done = () => {
										extraElement.innerHTML = ACTION_ICONS.check;
										extraElement.classList.add('copied');
										setTimeout(() => { extraElement.innerHTML = ACTION_ICONS.copy; extraElement.classList.remove('copied'); }, 1500);
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
							// "link": true : bouton discret façon lien (ex. « Ajouter une règle »)
							if (setting.link) inputElement.classList.add('link-button');

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

					if (extraBeforeElement) settingItemContent.appendChild(extraBeforeElement);
					settingItemContent.appendChild(inputElement);
					if (extraElement) settingItemContent.appendChild(extraElement);
					if (setting.type === 'actions') settingItem.classList.add('setting-item-actions');
					if (setting.copyable) settingItem.classList.add('setting-item-copy');
					// "sub": true : ligne rattachée à la précédente (règles sous une alerte), même alignement
					if (setting.sub) settingItem.classList.add('setting-item-sub');
					if (extraBeforeElement) settingItem.classList.add('setting-item-with-actions');

					if (setting.type == 'button') {
						if (setting.link) settingItem.classList.add('setting-item-link');
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
				document.querySelectorAll('.setting-actions[data-for-toggle]').forEach(div => {
					const box = document.getElementById(div.dataset.forToggle);
					div.classList.toggle('off', !(box && box.checked));
				});

				// Une section dont tous les réglages sont masqués disparaît aussi (titre compris)
				settingsPanel.querySelectorAll('.setting-group').forEach(group => {
					const items = Array.from(group.querySelectorAll('.setting-item'));
					const anyVisible = items.some(item => item.style.display !== 'none');
					group.style.display = items.length === 0 || anyVisible ? '' : 'none';
				});
			}

			UpdateSettingItemVisibility();
			EnsureIcons();
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
			else if (Array.isArray(event.data.lines)) {
				// { lines: [{ label: 'Image', text: 'sub.gif (défaut)', status: 'ok'|'warn'|'error' }] }
				// une ligne par élément, avec un point de couleur
				el.textContent = '';
				el.classList.add('setting-info-lines');
				event.data.lines.forEach(line => {
					const row = document.createElement('div');
					row.className = 'info-line';
					const dot = document.createElement('span');
					dot.className = 'info-dot';
					dot.dataset.status = line.status || '';
					const label = document.createElement('span');
					label.className = 'info-label';
					label.textContent = line.label ? `${line.label} : ` : '';
					const text = document.createElement('span');
					text.className = 'info-text';
					text.textContent = String(line.text || '');
					row.append(dot, label, text);
					el.appendChild(row);
				});
			}
			else {
				el.classList.remove('setting-info-lines');
				el.textContent = String(event.data.text || '');
			}
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




// Icônes des boutons d'action ("actions") : -common/utils/icons.js (play, gear, trash, copy…)
const ACTION_ICONS = new Proxy({}, { get: (t, name) => (window.UIIcon ? window.UIIcon(String(name)) : '') });

// Boutons ronds à icône d'une ligne d'actions ou d'un interrupteur
function MakeActionButtons(setting) {
	const div = document.createElement('div');
	div.className = 'setting-actions';
	(setting.buttons || []).forEach(b => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'icon-button' + (b.style ? ` ${b.style}` : '');
		btn.dataset.icon = b.icon || '';
		btn.innerHTML = ACTION_ICONS[b.icon] || '';
		btn.title = b.title || '';
		btn.dataset.title = b.title || '';
		btn.setAttribute('aria-label', b.title || b.icon || '');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			if (b.confirm && !ConfirmClick(btn)) return;
			if (b.popup) OpenPopup(b.popup, b.popupTitle || setting.labelTemplate || setting.label);
			if (b.callFunction) CallPreview(b.callFunction);
		});
		div.appendChild(btn);
	});
	return div;
}

// Les icônes viennent de -common/utils/icons.js. Si la page (ancienne version en cache)
// ne l'a pas chargé, on le charge ici puis on dessine les icônes restées vides.
function PaintIcons() {
	if (!window.UIIcon) return;
	document.querySelectorAll('[data-icon]').forEach(el => {
		if (!el.innerHTML.trim() && el.dataset.icon) el.innerHTML = window.UIIcon(el.dataset.icon);
	});
}

let iconsLoading = false;
function EnsureIcons() {
	if (window.UIIcon) { PaintIcons(); return; }
	if (iconsLoading) return;
	iconsLoading = true;
	const script = document.createElement('script');
	script.src = new URL('../../utils/icons.js?v=' + Date.now(), document.baseURI).href;
	script.onload = PaintIcons;
	document.head.appendChild(script);
}

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
