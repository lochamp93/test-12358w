// /orbix-12/settings/script.js  (LOADER)
const widgetContainer = document.getElementById('widgetContainer');

// Chemin vers le core réutilisable (note le _common)
const settingsPageURL = '../../-common/core/settings-core';

const currentURL = window.location.href;
let baseURL = currentURL;
if (baseURL.endsWith('index.html')) baseURL = baseURL.replace('index.html', '');

// Construit les paramètres que le core attend
const settingsJSON = '?settingsJson=' + baseURL + 'settings.json';
const widgetURL    = '&widgetURL='    + baseURL.replace('/settings', '');

widgetContainer.src = settingsPageURL + settingsJSON + widgetURL;
