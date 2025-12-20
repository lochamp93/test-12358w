////////////////
// PARAMETERS //
////////////////

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

let sbDebugMode = true;
const sbServerAddress = urlParams.get("address") || "127.0.0.1";
const sbServerPort = urlParams.get("port") || "8080";
const sbServerPassword = urlParams.get("password") || "cumming";

// General
const chatCommand = urlParams.get("chatCommand") || "!vibemeter";
const permissionLevel = GetIntParam("permissionLevel", 30);
const minRating = GetIntParam("minRating", 0);
const maxRating = GetIntParam("maxRating", 10);
const defaultDuration = GetIntParam("defaultDuration", 60);

// Appearance
const decimalPlaces = GetIntParam("decimalPlaces", 1);

// === SubGoal — data (texte + target) ===
const subGoalLabel  = GetStringParam("subGoalLabel", ""); // remplace "vidéo origami"
const subgoalTarget = GetIntParam("subGoal", null);       // remplace "800" (objectif)

// === SubGoal — apparence ===
const sgFont       = GetStringParam("font", "");
const sgFontSize   = GetIntParam("sgFontSize", null);

const subTitleColor     = GetStringParam("subTitleColor", "");
const subCurrentColor   = GetStringParam("subCurrentColor", "");
const subSeparatorColor = GetStringParam("subSeparatorColor", "");
const subGoalColor      = GetStringParam("subGoalColor", "");
const decorLineColor    = GetStringParam("decorLineColor", "");

// Apply couleurs (inchangé)
if (subTitleColor)     document.documentElement.style.setProperty('--c-title',  subTitleColor);
if (subCurrentColor)   document.documentElement.style.setProperty('--c-current', subCurrentColor);
if (subSeparatorColor) document.documentElement.style.setProperty('--c-sep',    subSeparatorColor);
if (subGoalColor)      document.documentElement.style.setProperty('--c-target', subGoalColor);
if (decorLineColor)    document.documentElement.style.setProperty('--c-line',   decorLineColor);
// Apply police (NOUVEAU)
if (sgFont && sgFont.trim() !== '') {
  document.documentElement.style.setProperty('--ui-font', sgFont + ', system-ui, -apple-system, sans-serif');
}



// ==== DecAPI config (Subcount) ====
const decapiEnabled   = urlParams.get("decapi") !== "false";      // activé par défaut
const decapiUsername  = urlParams.get("decapiUsername") || urlParams.get("username") || "";
const decapiEverySecs = parseInt(urlParams.get("decapiSecs") || "60", 10); // poll 60s

// ===== Socials: lecture depuis settings =====
const enableDiscord    = GetBooleanParam('enableDiscord',   false);
const discordCmd       = GetStringParam('Discordcommand',   '!discord');
const discordHandle    = GetStringParam('Discordchannel',   'discord.gg/feur');

const enableInstagram  = GetBooleanParam('enableInstagram', false);
const instagramCmd     = GetStringParam('Instagramcommand', '!instagram');
const instagramHandle  = GetStringParam('Instagramchannel', 'lochamp93');

const enableTikTok     = GetBooleanParam('enableTikTok',    false);
const tiktokCmd        = GetStringParam('TikTokcommand',    '!tiktok');
const tiktokHandle     = GetStringParam('TikTokchannel',    '@lochamp93');

const enableTwitch     = GetBooleanParam('enableTwitch',    false);
const twitchCmd        = GetStringParam('Twitchcommand',    '!twitch');
const twitchHandle     = GetStringParam('Twitchchannel',    'lochamp93');

const enableTwitter    = GetBooleanParam('enableTwitter',   false);
const twitterCmd       = GetStringParam('Twittercommand',   '!twitter');
const twitterHandle    = GetStringParam('Twitterchannel',   '@lochamp93');

const enableYouTube    = GetBooleanParam('enableYouTube',   false);
const youtubeCmd       = GetStringParam('YouTubecommand',   '!youtube');
const youtubeHandle    = GetStringParam('YouTubechannel',   '@lochamp93');

const enableYouTubeVOD = GetBooleanParam('enableYouTubeVOD', false);
// si tu renommes côté settings, remplace ces 2 lignes par YouTubeVODcommand/YouTubeVODchannel
const youtubeVodCmd    = GetStringParam('YouTubeVODcommand', GetStringParam('YouTubecommand', '!replay'));
const youtubeVodHandle = GetStringParam('YouTubeVODchannel', GetStringParam('YouTubechannel', '@lochamp93 VOD'));

// Table de vérité des réseaux
const SOCIALS = {
  discord:    { enabled: enableDiscord,    cmd: discordCmd,    handle: discordHandle },
  instagram:  { enabled: enableInstagram,  cmd: instagramCmd,  handle: instagramHandle },
  tiktok:     { enabled: enableTikTok,     cmd: tiktokCmd,     handle: tiktokHandle },
  twitch:     { enabled: enableTwitch,     cmd: twitchCmd,     handle: twitchHandle },
  twitter:    { enabled: enableTwitter,    cmd: twitterCmd,    handle: twitterHandle },
  youtube:    { enabled: enableYouTube,    cmd: youtubeCmd,    handle: youtubeHandle },
  youtubeVOD: { enabled: enableYouTubeVOD, cmd: youtubeVodCmd, handle: youtubeVodHandle },
};




/////////////////
// GLOBAL VARS //
/////////////////

const ratingsMap = new Map();
let isAcceptingSubmissions = false;
let isInFinalAnimation = false;

// état public minimal du vibemeter
window.VBM = window.VBM || {};
VBM._running = false;
VBM.isRunning = () => VBM._running;

// --- File d'attente socials ---
const socialsQueue = [];
let   socialsPlaying = false;
let   currentSocialKey = null;

// vrai si vibemeter est en morph/actif
function isVibeBusy(){
  const pill = document.querySelector('.pill_main');
  const state = pill?.getAttribute('data-state');
  return (VBM && VBM.isRunning && VBM.isRunning()) || state === 'vibemeter' || isInFinalAnimation;
}

const SOC_MIN_SCALE = 0.8; // 0.8 au lieu de 0.60 pour éviter de trop rapetisser

/////////////////////////////
// MINIMAL BAR (NEW WIDGET) //
/////////////////////////////

function getStatusBar(){
  return document.querySelector('.statusBar');
}

function setBarMode(mode){ 
  const bar = getStatusBar();
  if (!bar) return;
  bar.setAttribute('data-mode', mode); // "subgoal" | "vibe" | "social"
}

// === RING (nouvelle classe: .vibeRingProgress) ===
function initVibeRing(){
  const circle = document.querySelector('.vibeRingProgress');
  if (!circle) return null;

  const r = parseFloat(circle.getAttribute('r')) || 15.5;
  const C = 2 * Math.PI * r;

  circle.style.strokeDasharray = `0 ${C}`;
  circle.dataset.circumference = String(C);
  return circle;
}

function setVibeRingProgress(el, t){
  if (!el) return;

  const C = parseFloat(el.dataset.circumference || "0") || 0;
  const frac = Math.max(0, Math.min(1, t));
  const filled = frac * C;

  el.style.strokeDasharray = `${filled} ${Math.max(0, C - filled)}`;
}

// === VALUE (nouvelle classe: .vibeValue) ===
function UpdateRatingBox(newValue, duration = 200){
  const valueEl = document.querySelector('.vibeValue');
  if (!valueEl) return;

  const start = parseFloat(valueEl.textContent) || minRating;
  const startTime = performance.now();

  function update(now){
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const value = start + (newValue - start) * progress;

    valueEl.textContent = Number.isInteger(value) ? value.toString() : value.toFixed(decimalPlaces);

    // on garde ta couleur calculée (même si ton CSS minimal ne l'utilise pas directement)
    const clampedValue = Math.min(Math.max(value, minRating), maxRating);
    const range = maxRating - minRating;
    const percent = range === 0 ? 1 : (clampedValue - minRating) / range;
    const red = Math.round(255 * (1 - percent));
    const green = Math.round(255 * percent);
    const color = `rgba(${red}, ${green}, 0, 1)`;
    document.documentElement.style.setProperty('--vibeColor', color);

    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

// === SHOW/HIDE = switch de mode (pas le legacy wrapper) ===
function ShowWidget(){
  setBarMode('vibe');
}

function HideWidget(){
  setBarMode('subgoal');
}



///////////////////
// PAGE ELEMENTS //
///////////////////

const label = document.getElementById("ratingLabel");
const box = document.getElementById("ratingBox");
const ratingBoxBackground = document.getElementById("ratingBoxBackground");
const loadingBar = document.getElementById("loadingBar");
const ratingBoxWrapper = document.getElementById("ratingBoxWrapper");


///////////////////////////////
// STATUS BAR MODE SWITCHING //
///////////////////////////////

const statusBar = document.querySelector('.statusBar');

const panels = {
  subgoal: document.querySelector('.panel--subgoal'),
  social:  document.querySelector('.panel--social'),
  vibe:    document.querySelector('.panel--vibe'),
};

function setStatusMode(mode){
  if (!statusBar) return;

  statusBar.setAttribute('data-mode', mode);

  for (const [key, panel] of Object.entries(panels)) {
    if (!panel) continue;
    const active = (key === mode);

    // IMPORTANT : on n'utilise PAS hidden ici, sinon le CSS ne peut pas afficher
    panel.removeAttribute('hidden');
    panel.setAttribute('aria-hidden', String(!active));
  }
}


/////////////////////////
// STREAMER.BOT CLIENT //
/////////////////////////

const client = new StreamerbotClient({
	host: sbServerAddress,
	port: sbServerPort,
	password: sbServerPassword,

	onConnect: (data) => {
		console.log(`Streamer.bot successfully connected to ${sbServerAddress}:${sbServerPort}`)
		console.debug(data);
		SetConnectionStatus(true);
	},

	onDisconnect: () => {
		console.error(`Streamer.bot disconnected from ${sbServerAddress}:${sbServerPort}`)
		SetConnectionStatus(false);
	}
});

client.on('Twitch.ChatMessage', (response) => {
	console.debug(response.data);
	try {
		TwitchChatMessage(response.data);
	}
	catch (error) {
		console.error(error);
	}
})

client.on('YouTube.Message', (response) => {
	console.debug(response.data);
	try {
		YouTubeMessage(response.data);
	}
	catch (error) {
		console.error(error);
	}
})

// --- SUBCOUNT (Globals) : init + live update ---
// lit la valeur initiale persistée (si existe) puis se met à jour en temps réel

async function initSubcountFromGlobal() {
  try {
    // wrapper si la lib expose getGlobal(), sinon fallback sur request()
    if (typeof client.getGlobal === 'function') {
      const res = await client.getGlobal('subcount', true); // persisted
      const v = res?.variable?.value ?? res?.variable?.val ?? res?.variable?.data;
      if (v != null) applySubcountToDom(v);
    } else {
      const res = await client.request({ request: 'GetGlobal', variable: 'subcount', persisted: true });
      const v = res?.variables?.subcount?.value ?? res?.variables?.subcount?.val ?? res?.variables?.subcount?.data;
      if (v != null) applySubcountToDom(v);
    }
  } catch (err) {
    console.debug('[subcount] no initial global yet?', err);
  }
}

// === FONCTIONS POUR METTRE À JOUR LE SUBGOAL ===
function applySubGoalLabelToDom(label) {
  if (!label || label.trim() === '') return;
  document.querySelectorAll('.subgoalTitle').forEach(el => {
    el.textContent = label;
  });
}

function applySubGoalTargetToDom(target) {
  if (target === null || target === undefined) return;
  document.querySelectorAll('.subgoalTarget').forEach(el => {
    el.textContent = String(target);
  });
}

function applySubcountToDom(count) {
  console.log('🔄 Mise à jour subgoalCurrent:', count); // Debug
  
  const elements = document.querySelectorAll('.subgoalCurrent');
  console.log('📊 Éléments trouvés:', elements.length); // Debug
  
  elements.forEach(el => {
    el.textContent = String(count);
    console.log('✅ Valeur mise à jour:', el.textContent); // Debug
  });
}

// Initialiser le titre et la cible au chargement
applySubGoalLabelToDom(subGoalLabel);
applySubGoalTargetToDom(subgoalTarget);

// ==== DecAPI Subcount module ====
function decapiSubcountUrl(channel){
  return `https://decapi.me/twitch/subcount/${encodeURIComponent(channel)}`;
}

// Nettoie une réponse texte DecAPI en entier
function parseDecapiInt(text){
  const m = String(text).replace(/[^\d]/g, "");
  const n = parseInt(m, 10);
  return Number.isFinite(n) ? n : null;
}

async function fetchDecapiSubcountOnce(username, timeoutMs = 4500){
  if (!username) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(decapiSubcountUrl(username), {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal
    });
    if (!resp.ok) return null;
    const txt = await resp.text();
    const n = parseDecapiInt(txt);
    console.log('📥 DecAPI reçu:', txt, '→ parsé:', n); // Debug
    return n;
  } catch(e){
    console.debug('[DecAPI] fetch failed (CORS/timeout?)', e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

let _decapiTimer = null;
async function startDecapiPolling(){
  if (!decapiEnabled || !decapiUsername) {
    console.warn('⚠️ DecAPI désactivé ou pas de username');
    return;
  }

  console.log('🚀 Démarrage DecAPI polling pour:', decapiUsername);

  // 1re lecture immédiate
  const first = await fetchDecapiSubcountOnce(decapiUsername);
  if (first != null) {
    console.log('✅ Premier fetch DecAPI réussi:', first);
    applySubcountToDom(first);
  } else {
    console.warn('❌ Premier fetch DecAPI échoué');
  }

  // Poll toutes les 60s
  const every = Math.max(15, decapiEverySecs) * 1000;
  clearInterval(_decapiTimer);
  _decapiTimer = setInterval(async () => {
    const n = await fetchDecapiSubcountOnce(decapiUsername);
    if (n != null) applySubcountToDom(n);
  }, every);
}

// Lancement auto
startDecapiPolling();

// écouter les updates des variables globales (quand tes actions Streamer.bot changent subcount)
client.on('Misc.GlobalVariableUpdated', (evt) => {
  try {
    const { name, variable, variableName, newValue } = evt?.data || {};
    const varName = name || variableName || variable?.name;
    if (varName === 'subcount') {
      // newValue peut être string/number/obj selon l’action — on normalise
      const v = (variable?.value ?? newValue ?? variable?.val ?? variable?.data);
      applySubcountToDom(v);
    }
  } catch (e) {
    console.warn('[subcount] update error', e);
  }
});

// au moment de la connexion WS, on tente une lecture initiale
client.options.onConnect = (info) => {
  try { initSubcountFromGlobal(); } catch {}
  SetConnectionStatus(true);
};


/////////////////////////
// QUICK RATING WIDGET //
/////////////////////////

function TwitchChatMessage(data) {
	const platform = `twitch`;
	const userID = data.user.id;
	const message = data.message.message;

	CheckInput(platform, userID, message, data);
}

function YouTubeMessage(data) {
	const platform = `twitch`;
	const userID = data.user.id;
	const message = data.message;

	CheckInput(platform, userID, message, data);
}

function CheckInput(platform, userID, message, data) {
  // 0) Vibemeter commandes
  if (message.startsWith(chatCommand)) {
    if (!IsThisUserAllowedToTypeCommandsReturnTrueIfTheyCanReturnFalseIfTheyCannot(permissionLevel, data, platform))
      return;
    const parameters = message.split(' ');
    switch (parameters[1]) {
      case "on":  StartVibeMeter(); return;
      case "off": EndVibeMeter();   return;
      default:
        if (Number.isInteger(Number(parameters[1]))) { StartVibeMeter(parseInt(parameters[1])); return; }
    }
  }

  // 1) Socials commandes (ignorées si vibemeter est en cours)
  const msg = message.trim().toLowerCase();
  for (const [key, cfg] of Object.entries(SOCIALS)) {
    if (!cfg.enabled) continue;
    if (msg === String(cfg.cmd).toLowerCase()) {
      if (!isVibeBusy()) requestShowSocial(key); // si Vibe busy → drop silencieux
      return;                                    // ne pas traiter comme note
    }
  }

  // 2) Vibe ratings
  if (!isNumeric(message)) return;
  const rating = Number(message);
  if (rating < minRating || rating > maxRating) return;
  ratingsMap.set(`${platform}-${userID}`, rating);
  console.log(`${userID}: ${rating}`);
  try { CalculateAverage(); } catch (error) { console.error(error); }
}

/////////////////////////////
// MINIMAL BAR (NEW WIDGET) //
/////////////////////////////

function getStatusBar(){
  return document.querySelector('.statusBar');
}

function setBarMode(mode){
  const bar = getStatusBar();
  if (!bar) return;
  bar.setAttribute('data-mode', mode); // "subgoal" | "vibe" | "social"
}

// === RING (nouvelle classe: .vibeRingProgress) ===
function initVibeRing(){
  const circle = document.querySelector('.vibeRingProgress');
  if (!circle) return null;

  const r = parseFloat(circle.getAttribute('r')) || 15.5;
  const C = 2 * Math.PI * r;

  circle.style.strokeDasharray = `0 ${C}`;
  circle.dataset.circumference = String(C);
  return circle;
}

function setVibeRingProgress(el, t){
  if (!el) return;

  const C = parseFloat(el.dataset.circumference || "0") || 0;
  const frac = Math.max(0, Math.min(1, t));
  const filled = frac * C;

  el.style.strokeDasharray = `${filled} ${Math.max(0, C - filled)}`;
}

// === VALUE (nouvelle classe: .vibeValue) ===
function UpdateRatingBox(newValue, duration = 200){
  const valueEl = document.querySelector('.vibeValue');
  if (!valueEl) return;

  const start = parseFloat(valueEl.textContent) || minRating;
  const startTime = performance.now();

  function update(now){
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const value = start + (newValue - start) * progress;

    valueEl.textContent = Number.isInteger(value) ? value.toString() : value.toFixed(decimalPlaces);

    const clampedValue = Math.min(Math.max(value, minRating), maxRating);
    const range = maxRating - minRating;
    const percent = range === 0 ? 1 : (clampedValue - minRating) / range;
    const red = Math.round(255 * (1 - percent));
    const green = Math.round(255 * percent);
    const color = `rgba(${red}, ${green}, 0, 1)`;
    document.documentElement.style.setProperty('--vibeColor', color);

    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function ShowWidget(){ setBarMode('vibe'); }
function HideWidget(){ setBarMode('subgoal'); }


function _startVibeCore(duration) {
  // afficher panel vibe
  ShowWidget();

  if (isAcceptingSubmissions || isInFinalAnimation) return;
  VBM._running = true;
  isAcceptingSubmissions = true;

  // reset value
  const valueEl = document.querySelector('.vibeValue');
  if (valueEl) {
    const startTxt = Number.isInteger(minRating) ? String(minRating) : minRating.toFixed(decimalPlaces);
    valueEl.textContent = startTxt;
  }

  // reset ring
  const ring = initVibeRing();
  setVibeRingProgress(ring, 0);

  // Messages
  client.sendMessage('twitch', `/me VIBE METER ! Entrez un nombre entre ${minRating} et ${maxRating}`, { bot: true });
  client.sendMessage('youtube', `VIBE METER ! Entrez un nombre entre ${minRating} et ${maxRating}`, { bot: true });

  // Reset des notes
  ratingsMap.clear();

  const dur = (typeof duration === 'number' ? duration : defaultDuration);

  // animation du ring
  const t0 = performance.now();
  (function tick(now){
    if (!VBM._running) return;
    const elapsed = (now - t0) / 1000;
    const frac = dur > 0 ? Math.min(elapsed / dur, 1) : 1;
    setVibeRingProgress(ring, frac);
    if (frac < 1) requestAnimationFrame(tick);
  })(t0);

  // arrêt auto
  if (dur > 0) {
    setTimeout(() => { EndVibeMeter(); }, dur * 1000);
  }
}

function _endVibeCore(silent = false) {
if (!isAcceptingSubmissions) {
  if (!silent) {
    client.sendMessage('twitch', `/me Tapez "${chatCommand} on" pour lancer le Vibe Meter`, { bot: true });
    client.sendMessage('youtube', `Tapez "${chatCommand} on" pour lancer le Vibe Meter`, { bot: true });
  }

  // ✅ revient visuellement au subgoal
  setStatusMode('subgoal');

  // tu peux laisser HideWidget si tu veux, mais dans ton CSS il est display:none
  // HideWidget();

  document.dispatchEvent(new CustomEvent('vbm:hidden'));
  VBM._running = false;
  return;
}

  isInFinalAnimation = true;
  isAcceptingSubmissions = false;

  const finalRating = CalculateAverage();

  client.sendMessage('twitch', `/me VIBE METER VERDICT: ${finalRating}/${maxRating}`, { bot: true });
  client.sendMessage('youtube', `VIBE METER VERDICT: ${finalRating}/${maxRating}`, { bot: true });

  isInFinalAnimation = false;
  VBM._running = false;

  // ✅ on laisse le résultat visible 3 secondes
  setTimeout(() => {
    // reset ring APRES l'affichage du verdict
    const ring = document.querySelector('.vibeRingProgress');
    if (ring) {
      const C = parseFloat(ring.dataset.circumference || "0") || 0;
      if (C > 0) ring.style.strokeDasharray = `0 ${C}`;
    }

    HideWidget();
    document.dispatchEvent(new CustomEvent('vbm:hidden'));
  }, 5000);
}



function StartVibeMeter(duration){
  // ✅ coupe net socials (queue + anim en cours)
  cancelSocialsQueue({ clearQueue: true });

  window.VBM = window.VBM || {};
  window.VBM._pendingDuration = Number.isInteger(duration) ? duration : undefined;

  // ✅ passe en mode VIBE (affichage)
  setStatusMode('vibe');

  // démarre le core
  const d = window.VBM?._pendingDuration;
  if (window.VBM) window.VBM._pendingDuration = undefined;
  _startVibeCore(d);
}



function EndVibeMeter(silent=false){
  // on garde ta logique d’origine pour arrêter le widget
  _endVibeCore(silent);
}

// Exposition publique (si ailleurs on appelle VBM.StartVibeMeter/EndVibeMeter)
window.VBM = window.VBM || {};
VBM.StartVibeMeter = (dur) => StartVibeMeter(dur);
VBM.EndVibeMeter   = (silent=false) => EndVibeMeter(silent);


// expose proprement
VBM.StartVibeMeter = (dur) => StartVibeMeter(dur);
VBM.EndVibeMeter   = (silent=false) => EndVibeMeter(silent);


//////////////////////
// HELPER FUNCTIONS //
//////////////////////

function CalculateAverage() {

	// Literally 4th grade mathematics
	let sum = 0;
	let count = 0;
	for (const [key, value] of ratingsMap) {
		sum += value;
		count++;
	}

	const average = count > 0 ? sum / count : 0;
	console.debug(`Note actuelle : ${average}`);

	// Update the label
	UpdateRatingBox(average);

	return average;
}

function IsThisUserAllowedToTypeCommandsReturnTrueIfTheyCanReturnFalseIfTheyCannot(targetPermissions, data, platform) {
	return GetPermissionLevel(data, platform) >= targetPermissions;
}

function GetPermissionLevel(data, platform) {
	switch (platform) {
		case 'twitch':
			if (data.message.role >= 4)
				return 40;
			else if (data.message.role >= 3)
				return 30;
			else if (data.message.role >= 2)
				return 20;
			else if (data.message.role >= 2 || data.message.subscriber)
				return 15;
			else
				return 10;
		case 'youtube':
			if (data.user.isOwner)
				return 40;
			else if (data.user.isModerator)
				return 30;
			else if (data.user.isSponsor)
				return 15;
			else
				return 10;
	}
}

function isNumeric(str) {
	return /^-?\d+(\.\d+)?$/.test(str);
}


///////////////////////////////////
// STREAMER.BOT WEBSOCKET STATUS //
///////////////////////////////////

// This function sets the visibility of the Streamer.bot status label on the overlay
function SetConnectionStatus(connected) {
	let statusContainer = document.getElementById("statusContainer");
	if (connected) {
		statusContainer.style.background = "#2FB774";
		statusContainer.innerText = "Connecté !";
		statusContainer.style.opacity = 1;
		setTimeout(() => {
			statusContainer.style.transition = "all 2s ease";
			statusContainer.style.opacity = 0;
		}, 10);
	}
	else {
		statusContainer.style.background = "#D12025";
		statusContainer.innerText = "Connexion...";
		statusContainer.style.transition = "";
		statusContainer.style.opacity = 1;
	}
}


function setSocialIcon(networkKey){
  const iconEl = document.querySelector('.socialIcon');
  if (!iconEl || !networkKey) return;

  // alias si besoin (youtubeVOD doit utiliser youtube.svg)
  const key = (networkKey === 'youtubeVOD') ? 'youtube' : networkKey;

  const url = `./icons/${key}.svg`;

  iconEl.style.setProperty('--soc-icon-mask', `url("${url}")`);
}




function prepareSocials(networkKey){
  const cfg = SOCIALS[networkKey] || SOCIALS.instagram;
  const sect   = document.querySelector('.pill_socials');
  const socBg  = sect?.querySelector('.soc_bg');
  const socTxt = sect?.querySelector('.soc_textbox');
  const handle = sect?.querySelector('.soc_handle');
  if (!sect || !socBg || !socTxt || !handle) return;

  sect.dataset.network = networkKey;
  const grad = cssVar(cfg.gradVar) || cssVar('--g_instagram');
  socBg.style.background = grad;
  handle.textContent = String(cfg.handle || '').trim();
  setSocialIcon(networkKey);


  sect.hidden = false;
  sect.removeAttribute('hidden');
  socTxt?.removeAttribute('aria-hidden');

  // Reset COMPLET des classes et transforms
  socTxt.className = 'soc_textbox'; // reset propre
  socTxt.style.transform = '';      // efface tout transform résiduel
  socTxt.style.opacity = '0';

// ➜ PREFIT immédiat (aucune anim)
sect.classList.add('no-anim');
fitSocialHandle();                         // met --soc-scale
requestAnimationFrame(() => {
  sect.classList.remove('no-anim');
});
}

// === AUTOFIT du handle pour qu'il tienne dans la gélule ===
// règle : on réserve un padding DROITE identique au padding GAUCHE
function fitSocialHandle() {
  const pill    = document.querySelector('.pill_main');
  const socials = pill?.querySelector('.pill_socials');
  const box     = socials?.querySelector('.soc_textbox');
  const iconEl  = socials?.querySelector('.soc_icon');
  const handle  = socials?.querySelector('.soc_handle');
  if (!pill || !socials || !box || !handle) return 1;

  // 0) reset : mesure à taille normale (scale = 1)
  socials.style.setProperty('--soc-scale', '1');
  // important : aucun transform sur le handle
  handle.style.transform = '';
  void handle.offsetWidth;

  // 1) mesures
  const cs       = getComputedStyle(box);
  const padLeft  = parseFloat(cs.paddingLeft)  || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const gap      = parseFloat(cs.columnGap || cs.gap) || 0;
  const iconW    = iconEl ? iconEl.getBoundingClientRect().width || 0 : 0;
  const boxW     = box.getBoundingClientRect().width;

  // 2) largeur utile et réserve un padding droit = padLeft
  const usable   = Math.max(0, boxW - padLeft - padRight);
  const rightPadWanted = padLeft;

  // 3) espace dispo pour le handle
  const avail = Math.max(0, usable - iconW - gap - rightPadWanted);

  // 4) largeur réelle du handle (à scale=1)
  const need = handle.scrollWidth;

  // 5) scale (réduit seulement si nécessaire)
  const scale = (need <= avail) ? 1 : Math.max(SOC_MIN_SCALE, avail / Math.max(1, need));
  socials.style.setProperty('--soc-scale', String(scale));
  return scale;
}




// on ajuste à chaque préparation des socials + au resize
window.addEventListener('resize', () => { try { fitSocialHandle(); } catch {} });


const SOCIAL_DISPLAY_MS = 5000; // ajuste ici

function fillSocialPanel(networkKey){
  const cfg = SOCIALS[networkKey];
  if (!cfg) return false;

  const panel  = document.querySelector('.panel--social');
  const handle = panel?.querySelector('.socialHandle');
  const iconEl = panel?.querySelector('.socialIcon');
  if (!panel || !handle || !iconEl) return false;

  handle.textContent = String(cfg.handle || '').trim();
  setSocialIcon(networkKey);

  panel.dataset.network = networkKey;
  return true;
}

function raf() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCssMs(varName, fallback = 0) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Durée de "sortie" (prends la plus longue des 2 transitions)
function getPanelOutMs() {
  const op = getCssMs('--panel-op-ms', 320);
  const mv = getCssMs('--panel-move-ms', 420);
  return Math.max(op, mv);
}

// Délai d’entrée (chez toi = --panel-in-delay)
function getPanelInDelayMs() {
  return getCssMs('--panel-in-delay', getPanelOutMs());
}


let socialsWorkerRunning = false;
let socialsToken = 0;

function cancelSocialsQueue({ clearQueue = true } = {}) {
  socialsToken++; // invalide le worker en cours
  socialsWorkerRunning = false;
  currentSocialKey = null;

  // stoppe une anim de swap en cours
  const panel = document.querySelector('.panel--social');
  panel?.classList.remove('is-swapping-out', 'is-swapping-in');

  if (clearQueue) socialsQueue.length = 0;
}


function getSocSwapOutMs(){ return getCssMs('--soc-swap-out-ms', 220); }
function getSocSwapInMs(){  return getCssMs('--soc-swap-in-ms', 320); }

function requestShowSocial(networkKey){
  if (isVibeBusy()) return;

  const cfg = SOCIALS[networkKey];
  if (!cfg || !cfg.enabled) return;

  socialsQueue.push(networkKey);
  if (!socialsWorkerRunning) runSocialsQueue();
}

async function runSocialsQueue(){
  socialsWorkerRunning = true;
  const myToken = ++socialsToken;

  const OUT_MS = getSocSwapOutMs();
  const IN_MS  = getSocSwapInMs();

  // Si on n'est pas déjà en social, on y va (premier affichage)
  if (!isVibeBusy()) setStatusMode('social');

  while (socialsQueue.length && myToken === socialsToken) {
    if (isVibeBusy()) break;

    const nextKey = socialsQueue.shift();
    currentSocialKey = nextKey;

    const panel = document.querySelector('.panel--social');
    if (!panel) break;

    // 1) OUT (sur le contenu du panel social)
    panel.classList.remove('is-swapping-in');
    panel.classList.add('is-swapping-out');
    await sleep(OUT_MS);
    await raf();

    if (isVibeBusy() || myToken !== socialsToken) break;

    // 2) swap contenu pendant que c'est "invisible"
    fillSocialPanel(nextKey);

    // 3) IN
    panel.classList.remove('is-swapping-out');

    // reset animation (sinon parfois ça rejoue pas)
    void panel.offsetHeight;

    panel.classList.add('is-swapping-in');
    await sleep(IN_MS);
    panel.classList.remove('is-swapping-in');

    if (isVibeBusy() || myToken !== socialsToken) break;

    // 4) display
    await sleep(SOCIAL_DISPLAY_MS);
  }

  if (isVibeBusy()) socialsQueue.length = 0;

  socialsWorkerRunning = false;
  currentSocialKey = null;

  // si plus rien à afficher, retour subgoal
  if (!isVibeBusy()) setStatusMode('subgoal');
}




// ===============================
//      ORCHESTRATION "PILULE" > IIFE
// ===============================
(() => {
  // --- Sélecteurs pilule ---
  const pill     = document.querySelector('.pill_main');
  if (!pill) return;

  const section  = pill.querySelector('.pill_subgoal');
  const textbox  = pill.querySelector('.sg_textbox');
  const layers   = pill.querySelector('.sg_layers');
  const mask     = pill.querySelector('.sg_progress-mask');
  const whiteLay = pill.querySelector('.sg_layer-white'); // <-- ajout
  const vibe    = pill.querySelector('.pill_vibemeter'); // <-- NEW

// === APPLY SETTINGS: cible subgoal ===
if (subgoalTarget !== null) {
  pill.querySelectorAll('.sg_target').forEach(el => { el.textContent = String(subgoalTarget); });
}

// === APPLY SETTINGS: texte Sub Goal (titre) ===
if (subGoalLabel) {
  pill.querySelectorAll('.sg_descr').forEach(el => { el.textContent = subGoalLabel; });
}


// recalcul immédiat de la barre si tu veux le faire maintenant
// (si tu préfères, tu peux ne PAS ajouter cette ligne : la formule est déjà appelée plus bas)
try { applySubgoalFormula && applySubgoalFormula(); } catch {}


// === APPLY SETTINGS: couleurs & police ===
// On pousse dans tes variables CSS existantes (ne casse pas les anims)
const root = document.documentElement;

// Police (ta var --font est déjà utilisée par .sg_text)
if (sgFont) setCSSVar(root, '--font', sgFont + ', system-ui, -apple-system, sans-serif');

// Taille de police spécifique au SubGoal (sans toucher au vibemeter)
if (Number.isFinite(sgFontSize)) {
  pill.querySelectorAll('.sg_text').forEach(el => { el.style.fontSize = `${sgFontSize}px`; });
}


// === SUBGOAL FORMULA ===
// Calcule --value = clamp01(1 - subcount/subgoal) à partir du texte
function applySubgoalFormula() {
  if (!section) return;
  const curEl = pill.querySelector('.sg_current');
  const tarEl = pill.querySelector('.sg_target');

  const subcount = Math.max(0, parseFloat(curEl?.textContent?.trim() || '0') || 0);
  const subgoal  = Math.max(1, parseFloat(tarEl?.textContent?.trim() || '1') || 1);

  let value = 1 - (subcount / subgoal);
  // clamp 0..1
  value = Math.max(0, Math.min(1, value));

  section.style.setProperty('--value', String(value));
}



// === ICONIFY (mdi:...) via CSS MASK (permet dégradé) ===
async function setIconifyIcon(name){
  const icons = pill.querySelectorAll('.sg_text .sg_icon');
  if (!icons.length) return;

  // Rien saisi → on cache les spans
  if (!name) {
    icons.forEach(el => {
      el.style.display = 'none';
      el.style.removeProperty('--icon-mask');
      el.innerHTML = '';
    });
    return;
  }

  try {
    const url = `https://api.iconify.design/${encodeURIComponent(name)}.svg`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('icon not ok');

    let svg = await res.text();

    // Nettoyage rapide (enlève éventuels entêtes, espaces)
    svg = svg.replace(/[\r\n]+/g, ' ').trim();

    // Encodage pour data: URL
    const encoded = svg
      .replace(/"/g, '%22')
      .replace(/#/g, '%23')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E');

    const dataUrl = `url("data:image/svg+xml;utf8,${encoded}")`;

    icons.forEach(el => {
      el.style.display = '';                 // visible
      el.innerHTML = '';                     // on n’injecte plus le SVG inline
      el.style.setProperty('--icon-mask', dataUrl); // masque appliqué
    });
  } catch (e) {
    console.debug('[iconify] load failed', e);
    icons.forEach(el => {
      el.style.display = 'none';
      el.style.removeProperty('--icon-mask');
      el.innerHTML = '';
    });
  }
}




function setSubcountInDom(n){
  document.querySelectorAll('.sg_current').forEach(el => { el.textContent = String(n); });
  applySubgoalFormula();
}


async function fetchDecapiSubcountOnce(username, timeoutMs = 4500){
  if (!username) return null;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(decapiSubcountUrl(username), {
      method: 'GET',
      cache: 'no-store',
      signal: ctrl.signal
    });
    if (!resp.ok) return null;
    const txt = await resp.text();
    const n = parseDecapiInt(txt);
    return n;
  } catch(e){
    // CORS / réseau → on log et on laissera un fallback SB si tu l'actives plus tard
    console.debug('[DecAPI] fetch failed (CORS/timeout?)', e);
    return null;
  } finally {
    clearTimeout(t);
  }
}

let _decapiTimer = null;
async function startDecapiPolling(){
  if (!decapiEnabled || !decapiUsername) return;

  // 1re lecture immédiate
  const first = await fetchDecapiSubcountOnce(decapiUsername);
  if (first != null) setSubcountInDom(first);

  // Poll soft (éviter 10s, 60s est plus “propre” pour un service tiers)
  const every = Math.max(15, decapiEverySecs) * 1000;
  clearInterval(_decapiTimer);
  _decapiTimer = setInterval(async () => {
    const n = await fetchDecapiSubcountOnce(decapiUsername);
    if (n != null) setSubcountInDom(n);
  }, every);
}

// Lancement auto (si activé par URL)
startDecapiPolling();


// Observe les changements de texte sur sg_current / sg_target
const mo = new MutationObserver(() => applySubgoalFormula());
pill.querySelectorAll('.sg_current, .sg_target').forEach(node => {
  mo.observe(node, { characterData: true, childList: true, subtree: true });
});
// Run au chargement
applySubgoalFormula();


// === END SUBGOAL FORMULA ===


  // Timings : doivent matcher le CSS
  const RESIZE_MS = 600;   // height/width .6s
  const XFADE_MS  = 600;   // overlay .6s

  // Valeur de départ de la barre
  const START_VALUE = parseFloat(
    getComputedStyle(section).getPropertyValue('--value')
  ) || 0.15;

  // Helpers overlay couleur
  function setOverlay(bg){ setCSSVar(pill, '--state-bg', bg); }
  function fadeOverlay(show, cb){
    setCSSVar(pill, '--bgAlpha', show ? '1' : '0');
    if (cb) setTimeout(cb, XFADE_MS);
  }
function fondSelonEtat(state){
  if (state === 'vibemeter'){
    return '#000'; // overlay neutre pendant le morph vers vibemeter
  }
  if (state === 'socials') return cssVar('--g_tiktok') || '#000';
  return cssVar('--grad');
}
  function masquerUI(){
    textbox?.classList.add('is-hidden');
    layers?.classList.add('is-hidden');
    mask?.classList.add('is-hidden');
  }
  function afficherUI(){
    textbox?.classList.remove('is-hidden');
    layers?.classList.remove('is-hidden');
    mask?.classList.remove('is-hidden');
  }
  function commitBaseBackground(targetBg){
    const safe = (targetBg && targetBg.trim()) || cssVar('--grad');
    pill.style.background = safe;
    setCSSVar(pill, '--bgAlpha', '0');
  }

// ======== Aller vers vibemeter / socials ========
function toAltState(state){
  // Easing types
  const E_IN_OUT  = 'cubic-bezier(.22, .61, .36, 1)';   // smooth standard
  const E_SPRING  = 'cubic-bezier(.2, .8, .2, 1.2)';    // léger overshoot
  const E_POP     = 'cubic-bezier(.34, 1.56, .64, 1)';  // pop élastique

  // Timings
  const FILL_MS      = 260;   // barre → plus rapide
  const FADE_MS      = 160;   // fade texte
  const CIRCLE_MS    = 420;   // contraction/expansion
  const SPAWN_DELAY  = 120;   // pop du rond social
  const DISPLAY_SECS = 4.5;   // temps d’affichage

  // Utilisation de ces easings dans le CSS via vars
  document.documentElement.style.setProperty('--ease-inout',  E_IN_OUT);
  document.documentElement.style.setProperty('--ease-spring', E_SPRING);
  document.documentElement.style.setProperty('--ease-pop',    E_POP);

  // --------------- Préparation spécifique VIBEMETER ---------------
  if (state === 'vibemeter') {
    const ratingBox = document.getElementById('ratingBox');
    const ratingBoxBg = document.getElementById('ratingBoxBackground');
    const loadingBar = document.getElementById('loadingBar');

    // IMPORTANT: on met le wrapper dans un état "caché" propre
    // et on le forcera en visible au bon timing juste après le morph.
    try { HideWidget(); } catch {}

    if (ratingBox)  { ratingBox.style.opacity = '0'; }
    if (ratingBoxBg){ ratingBoxBg.style.opacity = '0'; ratingBoxBg.style.animation = ''; }
    if (loadingBar) {
      loadingBar.style.transition = 'none';
      loadingBar.style.transform  = 'scaleX(1)';
      loadingBar.style.opacity    = '0';
      void loadingBar.offsetWidth;
    }

    // SÉCURITÉ: lever un hidden qui traînerait sur la section vibemeter
    pill.querySelector('.pill_vibemeter')?.removeAttribute('hidden');
  }

  // --------------- Step 1: --value → 0 (remplir) ---------------
  const sgSection = pill.querySelector('.pill_subgoal');
  if (sgSection) sgSection.style.setProperty('--value', '0');

  setTimeout(() => {
    // --------------- Step 2: fade out texte Subgoal ---------------
    textbox?.classList.add('is-hidden');

    setTimeout(() => {
      // À partir d'ici, branche selon l'état cible
      if (state === 'vibemeter') {
        // ---- Subgoal → Vibemeter ----
        layers?.classList.add('is-hidden');

        setTimeout(() => {
          const target = fondSelonEtat(state);
          setCSSVar(pill,'--state-bg', target);
          setCSSVar(pill,'--bgAlpha','1');

          // On verrouille l’état
          pill.setAttribute('data-state', state);

          // Après le morph de taille -> on SHOW réellement le widget
          afterTransition(pill,'height',600, () => {
            commitBaseBackground(target);

            // ✅ C’EST LE FIX : rendre le wrapper visible
            // (sinon ton vibemeter tourne “dans le vide”)
            try { ShowWidget(); } catch {}

            // Et on s’assure que le carré est visible
            const ratingBox = document.getElementById('ratingBox');
            if (ratingBox) ratingBox.style.opacity = '1';

            const d = window.VBM?._pendingDuration;
            if (window.VBM) window.VBM._pendingDuration = undefined;

            _startVibeCore(d);
          });
        }, FADE_MS);

      } else if (state === 'socials') {
        // ---- Subgoal → Socials ----

        // 1) contraction en rond (on NE cache pas encore les layers)
        pill.classList.add('to-circle');

        // 2) fin de la contraction → fade down du rond subgoal
        afterTransition(pill, 'width', 420, () => {
          layers?.classList.remove('is-hidden');
          layers?.classList.add('is-fade-out');

          // prépare socials (pose déjà --soc-scale)
          prepareSocials('instagram');

          // 3) fin du fade down → on cache subgoal et on révèle le rond socials
          setTimeout(() => {
            layers?.classList.add('is-hidden');
            layers?.classList.remove('is-fade-out');

            const socials  = pill.querySelector('.pill_socials');
            const socText  = pill.querySelector('.pill_socials .soc_textbox');
            const g        = cssVar('--g_instagram');

            socials.removeAttribute('hidden');
            socials.hidden = false;
            socials.style.opacity = '1';
            socials.style.visibility = 'visible';
            socText?.removeAttribute('aria-hidden');

            socText.style.opacity = '';
            socText.style.transform = '';

            // overlay
            setCSSVar(pill, '--state-bg', g);
            setCSSVar(pill, '--bgAlpha', '1');

            // 4) rond → pilule (stretch)
            pill.classList.remove('to-circle');
            pill.setAttribute('data-state', 'socials');
            pill.classList.add('stretch');

            afterTransition(pill, 'width', 420, () => {
              socials.classList.add('no-anim');
              socials.style.setProperty('--soc-scale', '1');
              fitSocialHandle();
              socText.classList.add('is-visible');
              requestAnimationFrame(() => socials.classList.remove('no-anim'));

              pill.classList.remove('stretch');
              commitBaseBackground(g);

              const DISPLAY_SECS = 4;
              setTimeout(() => backFromSocialsToSubgoal(), DISPLAY_SECS * 1000);
            });

          }, 180);
        });
      }

    }, FADE_MS);
  }, FILL_MS);
}





function runBackToSubgoal(){
  const pill    = document.querySelector('.pill_main');
  const vibe    = pill.querySelector('.pill_vibemeter');
  const section = pill.querySelector('.pill_subgoal');
  const layers  = pill.querySelector('.sg_layers');
  const textbox = pill.querySelector('.sg_textbox');
  const whiteLay = pill.querySelector('.sg_layer-white');

  const ratingBox   = document.getElementById('ratingBox');
  const ratingBoxBg = document.getElementById('ratingBoxBackground');

  // garder le carré visible pendant le morph
  vibe?.classList.add('hold');

  // masquer TOUS les éléments du vibemeter
  if (whiteLay)   whiteLay.style.opacity = '0';
  if (ratingBox)  ratingBox.style.opacity = '0';
  if (ratingBoxBg) ratingBoxBg.style.opacity = '0';

  // ✅ FIX: on force le wrapper à disparaître (sinon état “fantôme”)
  try { HideWidget(); } catch {}

  // A) overlay vers subgoal
  const grad = cssVar('--grad');
  setCSSVar(pill, '--state-bg', grad);
  setCSSVar(pill, '--bgAlpha', '1');

  // B) morph
  pill.setAttribute('data-state', 'subgoal');

  // C) après morph
  afterTransition(pill, 'height', 600, () => {
    commitBaseBackground(grad);
    setCSSVar(pill, '--bgAlpha', '1');

    // réinitialiser --value à 0 SANS animation
    section.classList.add('no-anim');
    section.style.setProperty('--value', '0');
    section.offsetWidth;

    // montrer les layers
    layers?.classList.remove('is-hidden');
    if (whiteLay) whiteLay.style.opacity = '1';

    // fade-in texte
    requestAnimationFrame(() => {
      textbox?.classList.remove('is-hidden');

      // puis barre
      setTimeout(() => {
        section.classList.remove('no-anim');
        section.style.setProperty('--value', String(START_VALUE));

        // FIN : couper overlay et hold
        setTimeout(() => {
          setCSSVar(pill, '--bgAlpha', '0');
          vibe?.classList.remove('hold');

          // Réappliquer la vraie valeur calculée (sans anim)
          section.classList.add('no-anim');
          try { applySubgoalFormula(); } catch {}
          section.offsetWidth;
          section.classList.remove('no-anim');

          // (optionnel mais propre) : re-cacher la section vibemeter si ton HTML la met hidden
          // vibe?.setAttribute('hidden', 'hidden');

        }, 100);
      }, 320);
    });
  });
}

function backFromSocialsToSubgoal(done){
  const pill    = document.querySelector('.pill_main');
  const section = pill.querySelector('.pill_subgoal');
  const layers  = pill.querySelector('.sg_layers');
  const textbox = pill.querySelector('.sg_textbox');
  const socials = pill.querySelector('.pill_socials');
  const socText = socials?.querySelector('.soc_textbox');
  const handle  = socials?.querySelector('.soc_handle');
  if (!pill || !section) { done && done(); return; }

  // 1) fade-out du contenu Socials (slide down)
  if (socText){
    socText.classList.remove('is-visible');
  }

  // 2) gélule socials → rond (centré)
  setTimeout(() => {
    pill.classList.add('to-circle');

    // 3) fade-out du rond social (descend)
    setTimeout(() => {
      socials.style.opacity   = '0';
      socials.style.transform = 'scale(.96)';

      // 4) overlay → dégradé Subgoal
      setTimeout(() => {
        const grad = cssVar('--grad');
        setCSSVar(pill, '--state-bg', grad);
        setCSSVar(pill, '--bgAlpha', '1');

        // 5) rond → gélule subgoal (centré)
        setTimeout(() => {
          // Reset complet des transforms socials
          pill.classList.remove('to-circle');
          pill.setAttribute('data-state', 'subgoal');
        
          afterTransition(pill, 'width', 380, () => {
            // base = gradient subgoal
            commitBaseBackground(grad);

            // 6) ré-apparition progressive : texte PUIS barre
            socials.hidden = true;

            // --- RESET SÉCURITÉ (à insérer ici) ---
            // Si un inline transform traînait sur le handle, on l'efface explicitement
            const _handle = socials?.querySelector('.soc_handle');
            if (_handle) _handle.style.transform = '';
            // petit reset sécurité (au cas où un inline aurait traîné)
            const handle = socials?.querySelector('.soc_handle');
            if (handle) handle.style.transform = '';
            socials.style.setProperty('--soc-scale', '1');

            layers?.classList.remove('is-hidden');
            
            // Reset complet des socials MAINTENANT (après hidden)
            if (socText) {
              socText.className = 'soc_textbox';
              socText.style.transform = '';
              socText.style.opacity = '0';
            }
            if (handle) {
              handle.style.transform = '';
            }
            socials.style.setProperty('--soc-scale', '1');
            socials.style.transform = '';

            // 6a) texte : fade-in
            textbox?.classList.remove('is-hidden');

            // 6b) barre : 0 → valeur courante
            section.classList.add('no-anim');
            section.style.setProperty('--value','0');
            section.offsetWidth;               // reflow
            section.classList.remove('no-anim');

            // petit délai pour que le texte soit visible avant la barre
            setTimeout(() => {
              try { applySubgoalFormula && applySubgoalFormula(); } catch {}
              // coupe l’overlay doucement
              setTimeout(() => setCSSVar(pill, '--bgAlpha', '0'), 100);
              done && done();
            }, 300);
          });
        }, 150);
      }, 150);
    }, 180);
  }, 180);
}



function runBackToSubgoal(){
  const pill    = document.querySelector('.pill_main');
  const vibe    = pill.querySelector('.pill_vibemeter');
  const section = pill.querySelector('.pill_subgoal');
  const layers  = pill.querySelector('.sg_layers');
  const textbox = pill.querySelector('.sg_textbox');
  const whiteLay = pill.querySelector('.sg_layer-white');
  const ratingBox = document.getElementById('ratingBox');
  const ratingBoxBg = document.getElementById('ratingBoxBackground'); // ← NOUVEAU

  // garder le carré visible pendant le morph
  vibe?.classList.add('hold');

  // masquer TOUS les éléments du vibemeter
  if (whiteLay) whiteLay.style.opacity = '0';
  if (ratingBox) ratingBox.style.opacity = '0';
  if (ratingBoxBg) ratingBoxBg.style.opacity = '0'; // ← NOUVEAU

  // A) overlay vers subgoal
  const grad = cssVar('--grad');
  setCSSVar(pill, '--state-bg', grad);
  setCSSVar(pill, '--bgAlpha', '1');

  // B) morph
  pill.setAttribute('data-state', 'subgoal');

  // C) après morph
  afterTransition(pill, 'height', 600, () => {
    commitBaseBackground(grad);
    setCSSVar(pill, '--bgAlpha', '1');

    // réinitialiser --value à 0 SANS animation
    section.classList.add('no-anim');
    section.style.setProperty('--value', '0');
    section.offsetWidth;

    // montrer les layers
    layers?.classList.remove('is-hidden');
    if (whiteLay) whiteLay.style.opacity = '1';

    // fade-in texte
    requestAnimationFrame(() => {
      textbox?.classList.remove('is-hidden');

      // puis barre
      setTimeout(() => {
        section.classList.remove('no-anim');
        section.style.setProperty('--value', String(START_VALUE));

        // FIN : couper overlay et hold
        setTimeout(() => {
          setCSSVar(pill, '--bgAlpha', '0');
          vibe?.classList.remove('hold');
          
        // === SUBGOAL FORMULA ===
        // Réappliquer la vraie valeur calculée (sans anim) à la fin du morph
        section.classList.add('no-anim');
        applySubgoalFormula();           // <-- calcule et écrit --value
        section.offsetWidth;             // force reflow
        section.classList.remove('no-anim');
        // === END SUBGOAL FORMULA ===


          // ← SUPPRIMÉ : on ne remet PAS ratingBox visible ici
          // Il sera remis visible au PROCHAIN lancement dans toAltState
        }, 100);
      }, 320);
    });
  });
}
  
// ======== Écouteur global : quand le widget est vraiment caché ========
document.addEventListener('vbm:hidden', () => {
  if (pill?.getAttribute('data-state') === 'vibemeter') {
    runBackToSubgoal();
  }
});

// ======== API simple pour tes boutons de test ========
window.setState = function setState(state){
  if (state === 'vibemeter' || state === 'socials'){
    toAltState(state);
    return;
  }

  if (state === 'subgoal'){
    const wasVibe = pill.getAttribute('data-state') === 'vibemeter';
    // Si le widget tourne encore, on lui demande un stop SILENCIEUX,
    // puis on laissera l’event 'vbm:hidden' faire le retour animé.
    if (wasVibe && VBM && VBM.isRunning && VBM.isRunning()){
      VBM.EndVibeMeter(true);
      return;
    }
    // sinon on revient direct
    runBackToSubgoal();
    return;
  }
};

// ... juste AVANT la fermeture de l’IIFE ...
window.startSocialsTransition    = startSocialsTransition;
window.backFromSocialsToSubgoal  = backFromSocialsToSubgoal;


})(); // <-- fermeture propre de l'IIFE
