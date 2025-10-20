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
const fontSize = GetIntParam("fontSize", 150);   // (tout en haut, bloc “Appearance”)

// === SubGoal / Icon (depuis la fenêtre de settings) ===
const subgoalTarget = GetIntParam("subGoal", null);   // null = on ne force rien si absent
const enableIcon    = GetBooleanParam("enableIcon", false);
const selectedIcon  = GetStringParam("SelectedIcon", ""); // ex: "mdi:heart"

// === SubGoal — apparence ===
const sgFont       = GetStringParam("font", "");                 // ex: "Inter" ou "Metropolis"
const sgFontSize   = GetIntParam("sgFontSize", null);            // taille en px (optionnel)
const sgVoidColor  = GetStringParam("fontbgColor", "");          // couleur “vide” (zone blanche/texte)
const sgGradIn     = GetStringParam("gradientIn",  "");          // couleur dégradé 1
const sgGradOut    = GetStringParam("gradientOut", "");          // couleur dégradé 2
const goalLabel    = GetStringParam("goalLabel", null);


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
  discord:   { enabled: enableDiscord,   cmd: discordCmd,   handle: discordHandle,   gradVar: '--g_discord',   icon: 'fa7-brands:discord' },
  instagram: { enabled: enableInstagram, cmd: instagramCmd, handle: instagramHandle, gradVar: '--g_instagram', icon: 'fa7-brands:instagram' },
  tiktok:    { enabled: enableTikTok,    cmd: tiktokCmd,    handle: tiktokHandle,    gradVar: '--g_tiktok',    icon: 'fa7-brands:tiktok' },
  twitch:    { enabled: enableTwitch,    cmd: twitchCmd,    handle: twitchHandle,    gradVar: '--g_twitch',    icon: 'fa7-brands:twitch' },
  twitter:   { enabled: enableTwitter,   cmd: twitterCmd,   handle: twitterHandle,   gradVar: '--g_twitter',   icon: 'fa7-brands:twitter' },
  youtube:   { enabled: enableYouTube,   cmd: youtubeCmd,   handle: youtubeHandle,   gradVar: '--g_youtube',   icon: 'fa7-brands:youtube' },
  youtubeVOD:{ enabled: enableYouTubeVOD,cmd: youtubeVodCmd,handle: youtubeVodHandle,gradVar: '--g_youtube',   icon: 'fa7-brands:youtube' },
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





///////////////////
// PAGE ELEMENTS //
///////////////////

const label = document.getElementById("ratingLabel");
const box = document.getElementById("ratingBox");
const ratingBoxBackground = document.getElementById("ratingBoxBackground");
const loadingBar = document.getElementById("loadingBar");
const ratingBoxWrapper = document.getElementById("ratingBoxWrapper");

// Set appearance
label.style.fontSize = `${fontSize}px`;



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

// met à jour le texte .sg_current + recalc formule (--value)
function applySubcountToDom(val) {
  const n = Math.max(0, parseInt(String(val), 10) || 0);
  document.querySelectorAll('.sg_current').forEach(el => { el.textContent = String(n); });

  // si ta fonction de formule est en place, on la réutilise
  if (typeof applySubgoalFormula === 'function') {
    applySubgoalFormula();
  } else {
    // mini-fallback local (sans toucher à tes anims)
    const pill   = document.querySelector('.pill_main');
    const sect   = pill?.querySelector('.pill_subgoal');
    const target = parseFloat(pill?.querySelector('.sg_target')?.textContent?.trim() || '1') || 1;
    const value  = Math.max(0, Math.min(1, 1 - (n / Math.max(1, target))));
    sect?.style.setProperty('--value', String(value));
  }
}

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


function _startVibeCore(duration) {
  // ← VÉRIFIER que ces lignes sont bien AU DÉBUT
  const vibe = document.querySelector('.pill_main .pill_vibemeter');
  vibe?.classList.remove('hold');

  const ratingBox = document.getElementById('ratingBox');
  const ratingBoxBg = document.getElementById('ratingBoxBackground');
  const pill = document.querySelector('.pill_main'); //new

  ratingBoxBg.style.animation = '';
  ratingBoxBg.style.opacity = '0';

  loadingBar.style.transition = 'none';
  loadingBar.style.transform  = 'scaleX(1)';
  loadingBar.style.opacity    = '0';

  // couleur de départ
  const startColor = 'rgba(255,0,0,1)';
  document.documentElement.style.setProperty('--vibeColor', startColor);

  
  if (ratingBox) ratingBox.style.backgroundColor = startColor;
  if (ratingBoxBg) ratingBoxBg.style.backgroundColor = startColor;

  if (isAcceptingSubmissions || isInFinalAnimation) return;
  VBM._running = true;
  isAcceptingSubmissions = true;

  // label invisible pendant le morph
  label.textContent = Number.isInteger(minRating) ? String(minRating) : minRating.toFixed(decimalPlaces);
  label.style.opacity = '0';


  // Messages
  client.sendMessage('twitch', `/me VIBE METER ! Entrez un nombre entre ${minRating} et ${maxRating}`, { bot: true });
  client.sendMessage('youtube', `VIBE METER ! Entrez un nombre entre ${minRating} et ${maxRating}`, { bot: true });

  // Reset des notes
  ratingsMap.clear();

  // ===== CHRONO : révélation du fond (gauche → droite) =====
  const dur = (typeof duration === 'number' ? duration : defaultDuration);
  document.documentElement.style.setProperty('--vibeDur', `${dur}s`);

  // reset visuel propre AVANT de lancer
  loadingBar.style.transition = 'none';
  loadingBar.style.transform  = 'scaleX(1)'; // tout voilé
  loadingBar.style.opacity    = '1';         // voile visible
  void loadingBar.offsetWidth;               // reflow

  // lance l'anim 1 → 0
  loadingBar.style.transition = `transform ${dur}s linear, opacity .2s`;
  requestAnimationFrame(() => {
    loadingBar.style.opacity   = '1';       // rendre le voile visible
    loadingBar.style.transform = 'scaleX(0)';
    label.style.opacity        = '1';       // remettre le chiffre quand le chrono part
  });


  // ===== décompte / arrêt automatique =====
    if (dur > 0) {
      setTimeout(() => { EndVibeMeter(); }, dur * 1000);

      // petit décompte “1…go” (optionnel)
      let countdown = Math.min(5, dur);
      setTimeout(() => {
        let count = countdown;
        const countdownInterval = setInterval(() => {
          count--;
          if (count <= 1) {
            clearInterval(countdownInterval);
            console.log("C'est parti !");
          }
        }, 1000);
      }, (dur - countdown) * 1000);
    }
  }


function _endVibeCore(silent = false) {
  // Si on n'était pas en collecte, juste remettre proprement l'UI
  if (!isAcceptingSubmissions) {
    if (!silent) {
      client.sendMessage('twitch', `/me Tapez "${chatCommand} on" pour lancer le Vibe Meter`, { bot: true });
      client.sendMessage('youtube', `Tapez "${chatCommand} on" pour lancer le Vibe Meter`, { bot: true });
    }
    HideWidget();
    document.dispatchEvent(new CustomEvent('vbm:hidden'));
    VBM._running = false;
    return;
  }

  isInFinalAnimation = true;
  isAcceptingSubmissions = false;

// ===== PULSE de fin derrière le chiffre =====
const PULSE_MS = 1000;   // 1s : durée du pulse (inchangé)
const HOLD_MS  = 3000;   // 3s : on MAINTIENT le carré après le pulse

// rendre le fond visible + lancer le pulse
ratingBoxBackground.style.opacity   = '.5';
ratingBoxBackground.style.animation = `pulse ${PULSE_MS/1000}s linear 0s forwards`;

// note finale
const finalRating = CalculateAverage();

// quand le pulse est fini + le hold écoulé → on envoie le verdict puis on MORPH BACK
setTimeout(() => {
		// Send a chat message
		client.sendMessage('twitch', `/me VIBE METER VERDICT: ${finalRating}/${maxRating}`, { bot: true });
		client.sendMessage('youtube', `VIBE METER VERDICT: ${finalRating}/${maxRating}`, { bot: true });

		console.log(`Final Rating: ${finalRating}`);


  // couper le pulse, garder le carré proprement visible le temps du morph
  ratingBoxBackground.style.animation = '';
  ratingBoxBackground.style.opacity   = '0';

  // IMPORTANT : on ne "HideWidget()" PAS ici. On laisse l’orchestrateur
  // déclencher le morph back (avec anim) via l’event ci-dessous.
  // Le wrapper vibemeter s’effacera tout seul quand data-state repasse à "subgoal".
  // → morph animé garanti, pas un fade-out sec.
  isInFinalAnimation = false;
  VBM._running = false;

  // reset chrono / voile pour le prochain run (évite le carré au 2e lancement)
  loadingBar.style.transition = 'none';
  loadingBar.style.transform  = 'scaleX(1)';
  loadingBar.style.opacity    = '0';

  // signal : l’orchestrateur écoute 'vbm:hidden' et lance runBackToSubgoal() (morph animé)
  document.dispatchEvent(new CustomEvent('vbm:hidden'));
}, PULSE_MS + HOLD_MS);

}

// ---- Wrappers appelés par le chat ----
function StartVibeMeter(duration){
  // on mémorise la durée demandée par !vibemeter 45, etc.
  window.VBM = window.VBM || {};
  window.VBM._pendingDuration = Number.isInteger(duration) ? duration : undefined;

  // on lance l’ANIM pilule -> vibemeter
  if (typeof window.setState === 'function') {
    window.setState('vibemeter');
  } else {
    // secours (dev) : si pas d’orchestrateur, on lance direct le cœur
    _startVibeCore(window.VBM._pendingDuration);
    window.VBM._pendingDuration = undefined;
  }
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

function UpdateRatingBox(newValue, duration = 200) {
  const start = parseFloat(label.textContent) || minRating;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const value = start + (newValue - start) * progress;

    label.textContent = Number.isInteger(value) ? value.toString() : value.toFixed(decimalPlaces);

    const clampedValue = Math.min(Math.max(value, minRating), maxRating);
    const range = maxRating - minRating;
    const percent = range === 0 ? 1 : (clampedValue - minRating) / range;

    const red = Math.round(255 * (1 - percent));
    const green = Math.round(255 * percent);
    const color = `rgba(${red}, ${green}, 0, 1)`;

    document.documentElement.style.setProperty('--vibeColor', color);
    box.style.backgroundColor = color;
    ratingBoxBackground.style.backgroundColor = color;
    
    // ← NOUVEAU : mettre à jour le fond de la pilule aussi
    const pill = document.querySelector('.pill_main');
    if (pill && pill.getAttribute('data-state') === 'vibemeter') {
      pill.style.background = color;
    }

    if (progress < 1) requestAnimationFrame(update);
  }

  requestAnimationFrame(update);
}

function ShowWidget() {
	ratingBoxWrapper.style.animation = `showWidget 0.5s ease-in-out forwards`;
}

function HideWidget() {
	ratingBoxWrapper.style.animation = `hideWidget 0.5s ease-in-out forwards`;
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


// charge une icône dans .soc_icon (même technique que setIconifyIcon)
async function setSocialIcon(name){
  const el = document.querySelector('.pill_socials .soc_icon');
  if (!el || !name) return;
  try {
    const url = `https://api.iconify.design/${encodeURIComponent(name)}.svg`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('icon not ok');
    let svg = (await res.text()).replace(/[\r\n]+/g, ' ').trim();
    const encoded = svg.replace(/"/g, '%22').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
    el.style.setProperty('--soc-icon-mask', `url("data:image/svg+xml;utf8,${encoded}")`);
  } catch {}
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
  setSocialIcon(cfg.icon);

  sect.hidden = false;
  socTxt.classList.remove('is-fade-in','is-fade-out');

  // ajuste la taille du handle pour qu'il tienne
  requestAnimationFrame(() => fitSocialHandle());
}

// === AUTOFIT du handle pour qu'il tienne dans la gélule ===
function fitSocialHandle() {
  const pill   = document.querySelector('.pill_main');
  const box    = pill?.querySelector('.pill_socials .soc_textbox');
  const iconEl = pill?.querySelector('.pill_socials .soc_icon');
  const handle = pill?.querySelector('.pill_socials .soc_handle');
  if (!pill || !box || !handle) return;

  // taille de base (celle que tu as dans le CSS)
  const basePx = parseFloat(getComputedStyle(box).fontSize) || 48;
  handle.style.fontSize = basePx + 'px';
  handle.style.transform = 'none';

  // largeur dispo = largeur pilule - paddings internes - icône - gap
  const cs       = getComputedStyle(box);
  const padLeft  = parseFloat(cs.paddingLeft)  || 0;
  const padRight = parseFloat(cs.paddingRight) || 0;
  const gap      = parseFloat(cs.columnGap || cs.gap) || 0;
  const iconW    = iconEl ? (iconEl.getBoundingClientRect().width || 0) : 0;

  const avail = box.getBoundingClientRect().width - padLeft - padRight - iconW - gap - 4; // marge
  const need  = handle.getBoundingClientRect().width;

  if (need <= avail) return; // ça tient déjà

  // ratio de réduction (limité)
  const ratio = Math.max(0.6, Math.min(1, avail / Math.max(1, need)));
  handle.style.transformOrigin = 'left center';
  handle.style.transform = `scale(${ratio})`;
}

// on ajuste à chaque préparation des socials + au resize
window.addEventListener('resize', () => { try { fitSocialHandle(); } catch {} });


function requestShowSocial(networkKey){
  // règle #1 : le vibemeter tue l’interaction socials (pendant ET après)
  if (isVibeBusy()) return;

  const cfg = SOCIALS[networkKey];
  if (!cfg || !cfg.enabled) return;

  socialsQueue.push(networkKey);
  if (!socialsPlaying) playNextSocial();
}

function playNextSocial(){
  if (socialsPlaying) return;
  if (!socialsQueue.length) return;

  // si le vibemeter démarre entre temps, on flush la queue
  if (isVibeBusy()) { socialsQueue.length = 0; return; }

  socialsPlaying = true;
  currentSocialKey = socialsQueue.shift();

  // lance la séquence anim Subgoal → Socials(currentSocialKey)
(window.startSocialsTransition || startSocialsTransition)(currentSocialKey, () => {
  socialsPlaying = false;
  currentSocialKey = null;
  if (!isVibeBusy()) playNextSocial();
  else socialsQueue.length = 0;
});
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

// === APPLY SETTINGS: label "SUB" -> goalLabel ===
if (goalLabel !== null) {
  // tes deux couches de texte ont .sg_descr
  pill.querySelectorAll('.sg_descr').forEach(el => { el.textContent = goalLabel; });
}


// === APPLY SETTINGS: label "SUB" → goalLabel ===
// Essaie plusieurs sélecteurs possibles (adapte si ton HTML est différent)
if (goalLabel !== null) {
  const nodes = pill.querySelectorAll('.sg_label, .sg-prefix, #goalLabel');
  if (nodes.length) {
    nodes.forEach(n => { n.textContent = goalLabel; });
  } else {
    // fallback si ton label est injecté via un data-attr dans le CSS
    const subgoalSection = pill.querySelector('.pill_subgoal');
    if (subgoalSection) subgoalSection.setAttribute('data-label', goalLabel);
  }
}

// recalcul immédiat de la barre si tu veux le faire maintenant
// (si tu préfères, tu peux ne PAS ajouter cette ligne : la formule est déjà appelée plus bas)
try { applySubgoalFormula && applySubgoalFormula(); } catch {}


// === APPLY SETTINGS: couleurs & police ===
// On pousse dans tes variables CSS existantes (ne casse pas les anims)
const root = document.documentElement;

// Dégradé (couleurs 1 & 2)
if (sgGradIn)  setCSSVar(root, '--color1', sgGradIn);
if (sgGradOut) setCSSVar(root, '--color2', sgGradOut);
// Met à jour le fond gradient calculé
if (sgGradIn || sgGradOut) {
  setCSSVar(root, '--grad', `linear-gradient(90deg, var(--color1), var(--color2))`);
}

// Couleur “crème/blanc” (utilisée pour zone blanche + texte blanc)
if (sgVoidColor) setCSSVar(root, '--color3', sgVoidColor);

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



// ==== DecAPI Subcount module (ADD-ONLY) ====
// NB: n'altère aucune anim. Met juste à jour .sg_current puis relance la formule.
function decapiSubcountUrl(channel){
  return `https://decapi.me/twitch/subcount/${encodeURIComponent(channel)}`;
}

// Nettoie une réponse texte DecAPI en entier
function parseDecapiInt(text){
  // Certains endpoints renvoient du texte type "1234" ou "Subs: 1,234"
  const m = String(text).replace(/[^\d]/g, "");
  const n = parseInt(m, 10);
  return Number.isFinite(n) ? n : null;
}

// Écrit la valeur dans le DOM et recalcule --value via ta fonction
function setSubcountInDom(n){
  document.querySelectorAll('.sg_current').forEach(el => { el.textContent = String(n); });
  if (typeof applySubgoalFormula === 'function') {
    applySubgoalFormula();
  } else {
    // mini-fallback si la fonction n'est pas définie : calcule vite fait 1 - n/target
    const pill   = document.querySelector('.pill_main');
    const sect   = pill?.querySelector('.pill_subgoal');
    const goalEl = pill?.querySelector('.sg_target');
    const target = Math.max(1, parseFloat(goalEl?.textContent?.trim() || "1") || 1);
    const value  = Math.max(0, Math.min(1, 1 - (n / target)));
    sect?.style.setProperty('--value', String(value));
  }
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

// Appliquer l'icône au chargement (si activée)
if (enableIcon && selectedIcon) {
  setIconifyIcon(selectedIcon);
} else {
  pill.querySelectorAll('.sg_icon').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
}

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
      const box = document.getElementById('ratingBox');
      const c = (box && (getComputedStyle(box).backgroundColor || box.style.backgroundColor)) || 'rgba(255,0,0,1)';
      return c.trim();
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
const CIRCLE_MS    = 420;   // contraction/expansion un poil plus long
const SPAWN_DELAY  = 120;   // pop du rond social plus prompt
const DISPLAY_SECS = 4.5;   // temps d’affichage

// Utilisation de ces easings dans le CSS via vars (voir plus bas)
document.documentElement.style.setProperty('--ease-inout',  E_IN_OUT);
document.documentElement.style.setProperty('--ease-spring',  E_SPRING);
document.documentElement.style.setProperty('--ease-pop',     E_POP);

  // --------------- Préparation spécifique VIBEMETER (inchangé) ---------------
  if (state === 'vibemeter') {
    const ratingBox = document.getElementById('ratingBox');
    const ratingBoxBg = document.getElementById('ratingBoxBackground');
    const loadingBar = document.getElementById('loadingBar');
    if (ratingBox)  { ratingBox.style.backgroundColor = 'rgba(255,0,0,1)'; ratingBox.style.opacity = '0'; }
    if (ratingBoxBg){ ratingBoxBg.style.opacity = '0'; ratingBoxBg.style.animation = ''; }
    if (loadingBar) { loadingBar.style.transition = 'none'; loadingBar.style.transform = 'scaleX(1)'; loadingBar.style.opacity = '0'; void loadingBar.offsetWidth; }
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
        // ---- COMPORTEMENT EXISTANT (Subgoal → Vibemeter) ----
        layers?.classList.add('is-hidden');
        setTimeout(() => {
          const target = fondSelonEtat(state);
          setCSSVar(pill,'--state-bg', target);
          setCSSVar(pill,'--bgAlpha','1');
          // ... puis
          // 1) si on va en vibemeter, on enlève "hidden" AVANT le morph
          if (state === 'vibemeter') {
            pill.querySelector('.pill_vibemeter')?.removeAttribute('hidden');
          }

          pill.setAttribute('data-state', state);

          afterTransition(pill,'height',600, () => {
            commitBaseBackground(target);
            if (state === 'vibemeter') {
              const ratingBox = document.getElementById('ratingBox');
              if (ratingBox) ratingBox.style.opacity = '1';
              const d = window.VBM?._pendingDuration;
              if (window.VBM) window.VBM._pendingDuration = undefined;
              _startVibeCore(d);
            }
          });
        }, FADE_MS);

} else if (state === 'socials') {
  // Subgoal → Socials (centre verrouillé + fade down/up)

  // 1) contraction en rond (on NE cache pas encore les layers)
  pill.classList.add('to-circle');

  // 2) quand la contraction est finie → FADE DOWN du rond subgoal
  afterTransition(pill, 'width', 420, () => {
    // on fait descendre/effacer les layers subgoal
    layers?.classList.remove('is-hidden');
    layers?.classList.add('is-fade-out');

    // prépare la section socials (couleurs/icone/handle)
    prepareSocials('instagram');

    // 3) à la fin du fade down → on masque subgoal et on montre le rond socials en remontant
    setTimeout(() => {
      layers?.classList.add('is-hidden');
      layers?.classList.remove('is-fade-out');

      const socials = pill.querySelector('.pill_socials');
      const socText = pill.querySelector('.pill_socials .soc_textbox');
      const g = cssVar('--g_instagram');

      setCSSVar(pill, '--state-bg', g);
      setCSSVar(pill, '--bgAlpha', '1');

      // rond socials : fade IN en remontant
      socials.style.opacity = '1';
      socials.style.transform = 'scale(1)';
      socText.classList.remove('is-fade-out');
      socText.classList.add('is-fade-in');

      // 4) déploiement rond → pilule, centré (stretch utilise maintenant translateX(-50%))
      pill.classList.remove('to-circle');
      pill.setAttribute('data-state', 'socials');
      pill.classList.add('stretch');

      afterTransition(pill, 'width', 420, () => {
      pill.classList.remove('stretch');
      commitBaseBackground(g);

      // ajuste la place du handle seulement si ça dépasse
      try { fitSocialHandle(); } catch {}

      const DISPLAY_SECS = 4;
      setTimeout(() => backFromSocialsToSubgoal(), DISPLAY_SECS * 1000);
      });
    }, 180); // durée du fade down
  });
}
    }, FADE_MS);
  }, FILL_MS);
}




// ======== Retour vers subgoal ========
function startSocialsTransition(networkKey, done){
  const pill    = document.querySelector('.pill_main');
  const section = pill.querySelector('.pill_subgoal');
  const layers  = pill.querySelector('.sg_layers');
  const textbox = pill.querySelector('.sg_textbox');

  if (!pill || !section) { done && done(); return; }

  // 1) remplir la barre
  section.style.setProperty('--value', '0');

  // 2) fade out du texte subgoal
  setTimeout(() => {
    textbox?.classList.add('is-hidden');

    // 3) contraction en rond (centre)
    setTimeout(() => {
      pill.classList.add('to-circle');

      // 4) fin de contraction → FADE DOWN du rond subgoal
      afterTransition(pill, 'width', 380, () => {
        layers?.classList.remove('is-hidden');
        layers?.classList.add('is-fade-out');

        // préparer socials
        prepareSocials(networkKey);

        // --- Auto-fit du texte Socials (réduit seulement si ça dépasse)
        let _fitBound = false;
        function fitSocialText(){
          const pill     = document.querySelector('.pill_main');
          const socials  = pill?.querySelector('.pill_socials');
          const box      = socials?.querySelector('.soc_textbox');
          const icon     = socials?.querySelector('.soc_icon');
          const handle   = socials?.querySelector('.soc_handle');
          if (!pill || !socials || !box || !icon || !handle) return;

          // reset d'abord (taille “normale”)
          socials.style.setProperty('--soc-scale', '1');

          // calcul de l'espace dispo pour le texte (sans l'icône)
          const styles = getComputedStyle(box);
          const padL = parseFloat(styles.paddingLeft) || 0;
          const padR = parseFloat(styles.paddingRight) || 0;
          const gap  = parseFloat(styles.columnGap || styles.gap) || 0;

          const totalW     = box.clientWidth;
          const iconW      = icon.getBoundingClientRect().width;
          const available  = totalW - padL - padR - iconW - gap;

          // largeur réelle du handle au scale=1
          const needed = handle.scrollWidth;

          if (available > 0 && needed > available){
            const scale = Math.max(0.6, available / needed); // borne mini 0.6 pour rester lisible
            socials.style.setProperty('--soc-scale', String(scale));
          } else {
            socials.style.setProperty('--soc-scale', '1');
          }

          // binder le resize une seule fois
          if (!_fitBound){
            window.addEventListener('resize', () => fitSocialText(), { passive:true });
            _fitBound = true;
          }
        }

        // 5) fin du fade down → FADE UP du rond socials
        setTimeout(() => {
          layers?.classList.add('is-hidden');
          layers?.classList.remove('is-fade-out');

          const socials = pill.querySelector('.pill_socials');
          const socText = pill.querySelector('.pill_socials .soc_textbox');
          const cfg  = SOCIALS[networkKey] || SOCIALS.instagram;
          const grad = cssVar(cfg.gradVar) || cssVar('--g_instagram');

          setCSSVar(pill, '--state-bg', grad);
          setCSSVar(pill, '--bgAlpha', '1');

          socials.style.opacity = '1';
          socials.style.transform = 'scale(1)';
          socText.classList.remove('is-fade-out');
          socText.classList.add('is-fade-in');

          // 6) déploiement rond → pilule (stretch centré)
          pill.classList.remove('to-circle');
          pill.setAttribute('data-state', 'socials');
          pill.classList.add('stretch');

          afterTransition(pill, 'width', 380, () => {
          pill.classList.remove('stretch');
          commitBaseBackground(grad);

          // ajuste seulement si nécessaire (sinon garde la taille normale)
          try { fitSocialHandle(); } catch {}

          const DISPLAY_SECS = 4;
          setTimeout(() => { backFromSocialsToSubgoal(done); }, DISPLAY_SECS * 1000);
          });
        }, 180);
      });
    }, 160);
  }, 260);
}

function backFromSocialsToSubgoal(done){
  const pill    = document.querySelector('.pill_main');
  const section = pill.querySelector('.pill_subgoal');
  const layers  = pill.querySelector('.sg_layers');
  const textbox = pill.querySelector('.sg_textbox');
  const socials = pill.querySelector('.pill_socials');
  const socText = socials?.querySelector('.soc_textbox');
  if (!pill || !section) { done && done(); return; }

  // 1) fade-out du contenu Socials
  if (socText){
    socText.classList.remove('is-fade-in');
    socText.classList.add('is-fade-out');
  }
    // remet l’échelle par défaut pour le prochain réseau
    document.querySelector('.pill_socials')?.style.setProperty('--soc-scale', '1');

  // 2) gélule socials → rond (centré)
  setTimeout(() => {
    pill.classList.add('to-circle');

    // 3) fade-out du rond social (descend)
    setTimeout(() => {
      socials.style.opacity   = '0';
      socials.style.transform = 'scale(.96) translateY(16px)';

      // 4) overlay → dégradé Subgoal
      setTimeout(() => {
        const grad = cssVar('--grad');
        setCSSVar(pill, '--state-bg', grad);
        setCSSVar(pill, '--bgAlpha', '1');

        // 5) rond → gélule subgoal (centré)
        setTimeout(() => {
          pill.classList.remove('to-circle');
          pill.setAttribute('data-state', 'subgoal');

          afterTransition(pill, 'width', 380, () => {
            // base = gradient subgoal
            commitBaseBackground(grad);

            // 6) ré-apparition progressive : texte PUIS barre (comme vibemeter→subgoal)
            socials.hidden = true;
            layers?.classList.remove('is-hidden');

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
