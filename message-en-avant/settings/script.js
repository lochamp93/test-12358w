//   (LOADER)
const widgetContainer = document.getElementById('widgetContainer');
// Chemin vers le core réutilisable (note le _common)
const settingsPageURL = '../../-common/core/settings-core';
const currentURL = window.location.href;

let settingsJSON;
let baseURL = currentURL;

if (baseURL.endsWith("index.html"))
    baseURL = baseURL.replace("index.html", "");
// Construit les paramètres que le core attend
settingsJSON = "?settingsJson=" + baseURL + "settings.json";

const lastSlashIndex = baseURL.lastIndexOf("/");
let widgetURL = "&widgetURL=" + baseURL.replace("/settings", "");

console.debug("Window Ref: " + window.location.href);
console.debug("Base URL: " + baseURL);
console.debug("Settings JSON: " + settingsJSON);
console.debug("Widget URL: " + widgetURL);

// &t=… : la page du moteur n'est jamais reprise d'un ancien cache du navigateur
widgetContainer.src = settingsPageURL + settingsJSON + widgetURL + "&t=" + Date.now();
