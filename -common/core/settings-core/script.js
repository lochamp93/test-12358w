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



// Page affichée dans le hub (index.html à la racine) : classe « in-hub » sur la page.
try {
	if (window.top !== window && window.top.document.documentElement.hasAttribute('data-hub'))
		document.documentElement.classList.add('in-hub');
} catch (e) { /* autre origine : rien à faire */ }

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
			// Le design est connu : la page peut s'afficher (évite le flash de l'ancien style)
			document.documentElement.classList.add('settings-ready');
			if (window.ColorScheme) window.ColorScheme.initToggles();

			// Réglage "type": "import-string" : champ « Code d’import » (copie du code d’import)
			importFields = [];

			// Logo masqué si settings.json contient "showLogo": false
			// "showNuttyLink": false : pas de lien « Découvrez les widgets de nutty » pour ce widget
			const nuttyLink = document.getElementById('membershipsButton');
			if (nuttyLink) nuttyLink.style.display = (data.showNuttyLink === false || data.nuttyLink === 'icon') ? 'none' : '';
			// "nuttyLink": "icon" : lien discret vers nutty, bouton rond avec son logo
			SetupNuttyIconLink(data.nuttyLink === 'icon');

			// "subtitle" : texte à côté du titre, qui peut reprendre un réglage (ex. "{editScenario}")
			let subtitle = document.getElementById('widgetSubtitle');
			const titleLabel = document.getElementById('widgetTitle');
			if (data.subtitle && !subtitle && titleLabel) {
				subtitle = document.createElement('span');
				subtitle.id = 'widgetSubtitle';
				titleLabel.insertAdjacentElement('afterend', subtitle);
			}
			if (subtitle) {
				subtitle.dataset.labelTemplate = data.subtitle || '';
				subtitle.style.display = data.subtitle ? '' : 'none';
			}

			// "dock": true (ou chemin relatif au widget) : bouton pour ouvrir le dock dans une nouvelle fenêtre
			const dockButton = document.getElementById('openDockButton');
			if (dockButton) dockButton.style.display = data.dock ? '' : 'none';

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
				if (document.documentElement.classList.contains('apple') && !groupDiv.classList.contains('setting-group-bare')) {
					// DA Apple : le titre fait partie de la section et la replie (chevron)
					MakeCollapsibleGroup(groupDiv, groupHeader, groupName, Object.keys(groupedSettings).indexOf(groupName) === 0);
				}
				else groupHeader.textContent = groupName;
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
					let colorHexElement = null;
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
							// DA Apple : champ texte pour saisir le code hexa, synchronisé avec le sélecteur
							if (document.documentElement.classList.contains('apple'))
								colorHexElement = MakeColorHexField(inputElement, setting.label);
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
						case 'image':
							// Image choisie sur l'ordinateur, réduite puis transmise à l'aperçu (postMessage),
							// qui l'enregistre où il veut (ex. variable Streamer.bot). Jamais dans l'URL.
							inputElement = MakeImageField(setting);
							break;
						case 'import-string':
							// Code d’import Streamer.bot : icône « Copier », état « Code à importer » / « Code importé » sous le libellé
							inputElement = MakeImportField(setting, labelDescriptionDiv);
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
							// "infoAction": { "label": "Effacer", "callFunction": "…", "confirm": true } : lien bleu à côté de l'info,
							// affiché ou masqué par l'aperçu ({ type: 'widget-info', …, showAction: true|false })
							if (setting.infoAction) {
								const act = setting.infoAction;
								extraElement = document.createElement('button');
								extraElement.type = 'button';
								extraElement.className = 'info-action';
								extraElement.id = `${setting.id}Action`;
								extraElement.textContent = act.label || 'Effacer';
								extraElement.addEventListener('click', () => {
									if (act.confirm && !ConfirmClick(extraElement, act.label || 'Effacer')) return;
									if (act.callFunction) CallPreview(act.callFunction);
								});
							}
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

					// "inputWidth": 72 : champ étroit (en pixels), pour laisser la place à la description
					if (setting.inputWidth && inputElement && inputElement.tagName === 'INPUT') {
						inputElement.style.width = `${Number(setting.inputWidth)}px`;
						inputElement.style.flex = '0 0 auto';
					}
					// "placeholder" : texte gris affiché quand le champ est vide
					if (setting.placeholder && inputElement && inputElement.tagName === 'INPUT') inputElement.placeholder = setting.placeholder;

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
					if (colorHexElement) settingItemContent.appendChild(colorHexElement);
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

// Champ hexa à côté d'un sélecteur de couleur (DA Apple).
// Il n'a pas d'id de réglage : il ne lit et n'écrit que le sélecteur, qui reste la seule valeur
// enregistrée et transmise dans l'URL (aucun changement pour les URL existantes).
function MakeColorHexField(colorInput, label) {
	const hex = document.createElement('input');
	hex.type = 'text';
	hex.className = 'color-hex';
	hex.maxLength = 7;
	hex.spellcheck = false;
	hex.autocomplete = 'off';
	hex.setAttribute('aria-label', (label ? label + ' : ' : '') + 'code hexadécimal');
	hex.value = String(colorInput.value || '').toUpperCase();
	hex._colorInput = colorInput;

	// Accepte « FF5C8A », « #ff5c8a » ou la forme courte « #F5A »
	const normalize = (raw) => {
		let v = String(raw || '').trim().replace(/^#?/, '#');
		if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map(c => c + c).join('');
		return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
	};

	hex.addEventListener('input', (event) => {
		event.stopPropagation();
		const v = normalize(hex.value);
		hex.classList.toggle('invalid', v === null && hex.value.trim() !== '');
		if (v === null || v === colorInput.value) return;
		colorInput.value = v;
		colorInput.dispatchEvent(new Event('input', { bubbles: true }));
	});

	// En quittant le champ : on réaffiche la valeur réelle du sélecteur
	hex.addEventListener('blur', () => {
		hex.classList.remove('invalid');
		hex.value = String(colorInput.value || '').toUpperCase();
	});

	hex.addEventListener('keydown', (event) => { if (event.key === 'Enter') hex.blur(); });

	colorInput.addEventListener('input', () => {
		if (document.activeElement !== hex) hex.value = String(colorInput.value || '').toUpperCase();
	});

	return hex;
}

// Remet les champs hexa d'accord avec leur sélecteur (après « Par défaut » ou « Charger »)
function SyncColorHexFields() {
	document.querySelectorAll('input.color-hex').forEach(hex => {
		if (hex._colorInput && document.activeElement !== hex) {
			hex.value = String(hex._colorInput.value || '').toUpperCase();
			hex.classList.remove('invalid');
		}
	});
}

function RefreshWidgetPreview() {
	SyncColorHexFields();
	UpdateImportActionButton();
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
		sbActionNames = null;
		UpdateImportActionButton();
	}
});

async function GetSBActions() {
	const response = await client.getActions();

	console.debug(response);

	// Noms des actions, pour le champ « Code d’import » (« Importé » si l’action existe)
	sbActionNames = (response && Array.isArray(response.actions)) ? response.actions.map(a => String(a.name || '').trim().toLowerCase()) : [];
	UpdateImportActionButton();

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
	// État d'un réglage « image » envoyé par l'aperçu (miniature, texte d'état)
	if (event.source === widgetPreview.contentWindow && event.data && event.data.type === 'widget-image-state' && typeof event.data.id === 'string')
		SetImageFieldState(event.data.id, String(event.data.data || ''), event.data.text || '', event.data.status || '');

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
			// Aperçu d'une image ou d'une vidéo sous l'info : { media: { src, video: true|false } } ;
			// media: null l'efface ; sans "media", l'aperçu déjà affiché est conservé
			if ('media' in event.data) el._media = event.data.media;
			if (el._media && el._media.src && el.tagName !== 'INPUT') {
				const m = el._media;
				const node = document.createElement(m.video ? 'video' : 'img');
				node.className = 'info-media';
				node.src = m.src;
				if (m.video) { node.muted = true; node.loop = true; node.autoplay = true; node.playsInline = true; }
				el.appendChild(node);
			}
			el.dataset.status = event.data.status || '';
			if (event.data.title) el.title = String(event.data.title);
			if ('showAction' in event.data) {
				const action = document.getElementById(`${event.data.id}Action`);
				if (action) action.style.display = event.data.showAction ? '' : 'none';
			}
			RefreshActionLabels();
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

// Ouvre le dock du widget (settings.json : "dock": true → <widget>/dock/) dans une fenêtre à sa taille
function OpenDock() {
	if (!settingsData || !settingsData.dock) return;
	const base = widgetURL.endsWith('/') ? widgetURL : widgetURL + '/';
	const url = new URL(settingsData.dock === true ? 'dock/' : String(settingsData.dock), base).href;
	const win = window.open(url, '_blank', 'popup,width=460,height=860');
	if (!win) window.open(url, '_blank');
}

// Réglages sans valeur (jamais dans l’URL) : boutons, infos, lignes d’actions
function IsValueless(setting) {
	return setting.type === 'button' || setting.type === 'info' || setting.type === 'actions' || setting.type === 'import-string' || setting.type === 'image';
}

// Réglage « image » : miniature, « Choisir une image », corbeille.
// L'image est réduite ("maxWidth" et "maxHeight", 2000 px par défaut) puis envoyée à l'aperçu :
//   { type: 'widget-image', id, data: 'data:image/…' }  (data vide : retirer l'image)
// L'aperçu renvoie l'état pour la miniature : { type: 'widget-image-state', id, data, text, status }
function MakeImageField(setting) {
	const wrap = document.createElement('span');
	wrap.className = 'image-field';
	wrap.id = setting.id;
	const thumb = document.createElement('img');
	thumb.className = 'image-thumb';
	thumb.alt = '';
	thumb.hidden = true;
	const choose = document.createElement('button');
	choose.type = 'button';
	choose.className = 'link-button image-choose';
	choose.textContent = 'Choisir une image';
	const remove = document.createElement('button');
	remove.type = 'button';
	remove.className = 'image-remove';
	remove.title = 'Retirer l’image';
	remove.setAttribute('aria-label', 'Retirer l’image');
	remove.innerHTML = ACTION_ICONS.trash;
	remove.hidden = true;
	const file = document.createElement('input');
	file.type = 'file';
	file.accept = 'image/png,image/jpeg,image/webp';
	file.hidden = true;
	file.addEventListener('input', (e) => e.stopPropagation()); // pas de valeur dans l'URL
	const send = (data) => {
		try { widgetPreview.contentWindow.postMessage({ type: 'widget-image', id: setting.id, data }, '*'); } catch (e) { }
	};
	choose.addEventListener('click', () => file.click());
	file.addEventListener('change', async () => {
		const f = file.files[0];
		file.value = '';
		if (!f) return;
		try {
			const data = await ResizeImageFile(f, Number(setting.maxWidth) || 2000, Number(setting.maxHeight) || 2000);
			SetImageFieldState(setting.id, data);
			send(data);
		} catch (e) { SetImageFieldState(setting.id, '', 'Image illisible', 'warn'); }
	});
	remove.addEventListener('click', () => { SetImageFieldState(setting.id, ''); send(''); });
	wrap.append(thumb, choose, remove, file);
	return wrap;
}

function SetImageFieldState(id, data, text, status) {
	const wrap = document.getElementById(id);
	if (!wrap || !wrap.classList.contains('image-field')) return;
	const thumb = wrap.querySelector('.image-thumb');
	thumb.hidden = !data;
	if (data) thumb.src = data; else thumb.removeAttribute('src');
	wrap.querySelector('.image-remove').hidden = !data;
	wrap.querySelector('.image-choose').textContent = data ? 'Changer' : 'Choisir une image';
	let note = wrap.querySelector('.image-note');
	if (text) {
		if (!note) { note = document.createElement('span'); note.className = 'image-note'; wrap.appendChild(note); }
		note.textContent = text;
		note.dataset.status = status || '';
	} else if (note) note.remove();
}

// Réduit une image (canvas) ; garde le PNG s'il a de la transparence, sinon JPEG
function ResizeImageFile(f, maxW, maxH) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = reject;
		reader.onload = () => {
			const img = new Image();
			img.onerror = reject;
			img.onload = () => {
				const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
				const c = document.createElement('canvas');
				c.width = Math.max(1, Math.round(img.naturalWidth * k));
				c.height = Math.max(1, Math.round(img.naturalHeight * k));
				const ctx = c.getContext('2d');
				ctx.drawImage(img, 0, 0, c.width, c.height);
				let alpha = false;
				if (f.type === 'image/png' || f.type === 'image/webp') {
					const d = ctx.getImageData(0, 0, c.width, c.height).data;
					for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break; }
				}
				resolve(alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88));
			};
			img.src = reader.result;
		};
		reader.readAsDataURL(f);
	});
}

// Libellé à trous : « Règle 1 : {nomRegle|resumeRegle|sans nom} » : chaque élément entre | est
// l'id d'un réglage (sa valeur, le texte de l'option choisie ou de l'info) ; le premier non vide l'emporte.
// Un élément qui n'est l'id d'aucun réglage est pris comme texte.
function FillLabelTemplate(template) {
	return String(template || '').replace(/\{([^{}]+)\}/g, (m, inner) => {
		for (const part of inner.split('|')) {
			const el = document.getElementById(part);
			if (!el) {
				if (/^[A-Za-z0-9_]+$/.test(part) && settingsMap.has(part)) {
					const v = String(settingsMap.get(part) ?? '').trim();
					if (v) return v;
					continue;
				}
				if (part) return part;
				continue;
			}
			let v;
			if (el.type === 'checkbox') v = String(el.checked);
			else if (el.tagName === 'SELECT') v = el.selectedOptions[0] ? el.selectedOptions[0].textContent : el.value;
			else if (el.tagName === 'INPUT') v = el.value;
			else v = el.textContent;
			v = String(v || '').trim();
			if (v) return v;
		}
		return '';
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
	// L'aperçu peut alors envoyer ce qui est utile à la fenêtre (ex. image de l'alerte) :
	// { type: 'widget-popup', id: '<popup>' }
	try { widgetPreview.contentWindow.postMessage({ type: 'widget-popup', id }, '*'); } catch (e) { }
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



//////////////////////////////////////////
// CODE D’IMPORT STREAMER.BOT (RÉGLAGE)  //
//////////////////////////////////////////

// Réglage { "id": "importString", "type": "import-string", "label": "Code d’import" } :
// bouton icône « Copier » ; un clic copie le code d’import de l’action.
// Le fichier vient de "url" sur le réglage, sinon de "importAction" dans settings.json
// (chemin relatif à settings.json). Si l’action (réglage "actionName", ou "importActionSetting")
// existe dans Streamer.bot, la description passe de « Code à importer » à « Code importé ». Aucune valeur dans l’URL.
let importFields = [];
let sbActionNames = null; // null : liste inconnue (Streamer.bot non connecté)

function MakeImportField(setting, labelDescriptionDiv) {
	// Bouton icône « Copier » (bleu) à droite de la ligne
	const field = document.createElement('button');
	field.type = 'button';
	field.id = setting.id;
	field.className = 'import-copy-button';
	field.dataset.url = setting.url || (settingsData && settingsData.importAction) || '';
	field.innerHTML = ACTION_ICONS.copy;
	field.addEventListener('click', () => CopyImportString(field));

	// État sous le libellé : point de couleur + « Code à importer » ou « Code importé »
	const status = document.createElement('p');
	status.className = 'import-status';
	status.innerHTML = '<span class="info-dot" data-status="warn"></span><span class="import-status-text">Code à importer</span>';
	if (labelDescriptionDiv) labelDescriptionDiv.appendChild(status);
	field._status = status;

	importFields.push(field);
	setTimeout(UpdateImportActionButton, 0);
	return field;
}

function CurrentImportActionName() {
	const id = (settingsData && settingsData.importActionSetting) || 'actionName';
	const el = document.getElementById(id);
	if (el && el.value) return String(el.value).trim();
	const def = settingsData && settingsData.settings ? settingsData.settings.find(st => st.id === id) : null;
	return def ? String(def.defaultValue || '').trim() : '';
}

function UpdateImportActionButton() {
	if (!importFields.length) return;
	const name = CurrentImportActionName().toLowerCase();
	const installed = Array.isArray(sbActionNames) && name !== '' && sbActionNames.includes(name);
	importFields.forEach(field => {
		field.classList.toggle('installed', installed);
		field.setAttribute('aria-label', 'Copier le code d’import');
		field.title = installed
			? 'L’action est déjà dans Streamer.bot (clic : copier le code quand même)'
			: 'Copier le code d’import, puis dans Streamer.bot : Import, coller dans Import String, Import';
		if (field._status) {
			field._status.querySelector('.info-dot').dataset.status = installed ? 'ok' : 'warn';
			field._status.querySelector('.import-status-text').textContent = installed ? 'Code importé' : 'Code à importer';
		}
	});
}

async function CopyImportString(field) {
	try {
		const url = new URL(field.dataset.url, new URL(settingsJson, location.href)).href;
		const response = await fetch(url, { cache: 'no-cache' });
		if (!response.ok) throw new Error('HTTP ' + response.status);
		await navigator.clipboard.writeText((await response.text()).trim());
		// Petit retour visuel : coche pendant 1,5 s
		field.innerHTML = ACTION_ICONS.check;
		field.classList.add('copied');
		setTimeout(() => { field.innerHTML = ACTION_ICONS.copy; field.classList.remove('copied'); }, 1500);
		ShowSettingsToast('Code d’import copié. Dans Streamer.bot : Import, colle le code dans Import String, puis Import.');
	} catch (e) {
		ShowSettingsToast('Copie impossible : ouvre le fichier streamerbot/import.txt du widget.');
	}
}

////////////////////////////
// SECTIONS REPLIABLES    //
////////////////////////////

// DA Apple : le titre de la section est un bouton avec chevron. L’état replié est gardé
// par widget dans le stockage du navigateur (page de paramétrage uniquement).
// Première visite : la première section est dépliée, les autres repliées.
function CollapsedGroupsKey() { return `${keyPrefix}-collapsed-groups`; }

function ReadCollapsedGroups() {
	try {
		const raw = localStorage.getItem(CollapsedGroupsKey());
		return raw ? JSON.parse(raw) : null;
	} catch (e) { return null; }
}

function WriteCollapsedGroups() {
	try {
		const names = Array.from(settingsPanel.querySelectorAll('.setting-group.collapsible'))
			.map(g => ({ name: g.dataset.groupName, collapsed: g.classList.contains('collapsed') }));
		localStorage.setItem(CollapsedGroupsKey(), JSON.stringify(names));
	} catch (e) { /* stockage indisponible */ }
}

function MakeCollapsibleGroup(groupDiv, header, groupName, isFirst) {
	groupDiv.classList.add('collapsible');
	groupDiv.dataset.groupName = groupName;
	const saved = ReadCollapsedGroups();
	const entry = Array.isArray(saved) ? saved.find(e => e.name === groupName) : null;
	const collapsed = entry ? entry.collapsed : !isFirst;
	groupDiv.classList.toggle('collapsed', collapsed);

	const toggle = document.createElement('button');
	toggle.type = 'button';
	toggle.className = 'group-toggle';
	toggle.setAttribute('aria-expanded', String(!collapsed));
	toggle.innerHTML = '<span class="group-title"></span>'
		+ '<svg class="group-chevron" viewBox="0 0 28 16" aria-hidden="true"><path d="M14 15.6c.5 0 .9-.2 1.3-.6L27.4 3.1c.4-.4.6-.8.6-1.3C28 .8 27.2 0 26.2 0c-.5 0-1 .2-1.3.5L14 11.3 3.1.5C2.7.2 2.3 0 1.8 0 .8 0 0 .8 0 1.8c0 .5.2.9.6 1.3L12.7 15c.4.4.8.6 1.3.6z"/></svg>';
	toggle.querySelector('.group-title').textContent = groupName;
	toggle.addEventListener('click', () => {
		const nowCollapsed = !groupDiv.classList.contains('collapsed');
		groupDiv.classList.toggle('collapsed', nowCollapsed);
		toggle.setAttribute('aria-expanded', String(!nowCollapsed));
		WriteCollapsedGroups();
	});
	header.appendChild(toggle);
}

// Petite notification en bas au centre (disparaît seule)
function ShowSettingsToast(text) {
	let toast = document.getElementById('settingsToast');
	if (!toast) {
		toast = document.createElement('div');
		toast.id = 'settingsToast';
		toast.setAttribute('role', 'status');
		document.body.appendChild(toast);
	}
	toast.textContent = text;
	toast.classList.add('show');
	clearTimeout(ShowSettingsToast._t);
	ShowSettingsToast._t = setTimeout(() => toast.classList.remove('show'), 4000);
}

// Bouton rond avec le logo de nutty (settings.json : "nuttyLink": "icon")
function SetupNuttyIconLink(enabled) {
	let link = document.getElementById('nuttyIconLink');
	if (!enabled) { if (link) link.remove(); return; }
	if (link || !widgetUrlInputWrapper) return;
	link = document.createElement('a');
	link.id = 'nuttyIconLink';
	link.href = 'https://nutty.gg';
	link.target = '_blank';
	link.rel = 'noopener';
	link.title = 'Découvrez les widgets de nutty';
	link.setAttribute('aria-label', 'Découvrez les widgets de nutty');
	link.innerHTML = '<img src="../../resources/nutty-logo.png" alt="" />';
	widgetUrlInputWrapper.insertBefore(link, widgetUrlInputWrapper.firstChild);
}
