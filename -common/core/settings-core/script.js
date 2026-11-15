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

			// Vider le panneau des paramètres
			settingsPanel.innerHTML = '';

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

				const groupHeader = document.createElement('h2');
				groupHeader.textContent = groupName;
				groupDiv.appendChild(groupHeader);

				groupedSettings[groupName].forEach(setting => {
					const settingItem = document.createElement('div');
					settingItem.classList.add('setting-item');
					settingItem.id = `item-${setting.id}`;

					const labelDescriptionDiv = document.createElement('div');

					if (setting.label) {
						const label = document.createElement('label');
						label.textContent = setting.label;
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
					switch (setting.type) {
						case 'text':
							inputElement = document.createElement('input');
							inputElement.type = 'text';
							inputElement.id = setting.id; // Added setting ID
							inputElement.value = settingsMap.has(setting.id) ? settingsMap.get(setting.id) : setting.defaultValue;
							inputElement.autocomplete = 'new-password';
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
						case 'button':
							inputElement = document.createElement('button');
							inputElement.id = setting.id; // Added setting ID
							inputElement.textContent = setting.label;

							inputElement.addEventListener('click', () => {
								widgetPreview.contentWindow[setting.callFunction]();

								const defaultBackgroundColor = "#2e2e2e";
								const defaultTextColor = "white";

								inputElement.style.transitionDuration = '0s'
								inputElement.style.backgroundColor = "#2196f3"
								inputElement.style.color = "#ffffff";

								setTimeout(() => {
									inputElement.style.transitionDuration = '0.2s'
									inputElement.style.backgroundColor = defaultBackgroundColor;
									inputElement.style.color = defaultTextColor;
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

					if (setting.type == 'button') {
						settingItem.style.display = 'block'
						settingItem.appendChild(settingItemContent);
					}
					else {
						settingItem.appendChild(labelDescriptionDiv);
						settingItem.appendChild(settingItemContent);
					}

					groupDiv.appendChild(settingItem);
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

			function UpdateSettingItemVisibility() {
				data.settings.forEach(setting => {
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

							// Retrouver l’objet parent (pour continuer à remonter)
							const parentId = typeof currentSetting.showIf === 'string' ? currentSetting.showIf : currentSetting.showIf.id;
							currentSetting = data.settings.find(s => s.id === parentId) || {};
							depth++;
						}

						const item = document.getElementById(`item-${setting.id}`);
						if (item) item.style.display = shouldShow ? 'flex' : 'none';
					}
				});

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
		if (setting.type === 'button') return; // Ignorer les boutons

		let inputElement = document.getElementById(setting.id);
		if (!inputElement) return;

		if (setting.type === 'checkbox') {
			settings[setting.id] = inputElement.checked;
		} else {
			settings[setting.id] = inputElement.value;
		}
	});

	// Construire la chaîne de paramètres (URLSearchParams gère couleurs, espaces, virgules…)
	const searchParams = new URLSearchParams();
	Object.entries(settings).forEach(([key, value]) => searchParams.set(key, value));
	const paramString = searchParams.toString();

	console.debug('Chaîne de paramètres :', paramString);

	// URL copiée pour OBS : jamais de paramètre demo
	widgetUrlInput.value = widgetURL + "?" + paramString;

	// URL de l’aperçu : demo=true si settings.json le demande ("demo": true)
	const previewParams = new URLSearchParams(searchParams);
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

	loadURLBox.value = '';

	loadSettingsBox.style.visibility = 'hidden';
	loadSettingsBox.style.opacity = 0;
}

function OpenMembershipPage() {
	window.open("https://nutty.gg/collections/member-exclusive-widgets", '_blank').focus();
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
	if (event.origin === new URL(widgetPreview.src).origin && event.data === 'iframe-interacted') {
		iframeHasBeenInteractedWith = true;
		console.log('Interaction avec l’iframe détectée !');
		unmuteLabel.style.display = 'none';
	}
});




// Charger les paramètres depuis le local storage
LoadSettingsFromStorage();

// Charger les paramètres par défaut
LoadJSON(settingsJson);
