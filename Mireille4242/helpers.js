// ==============================
// helpers.js (version clean)
// ==============================

// -------- URL params ----------
function GetIntParam(paramName, defaultValue) {
  const urlParams = new URLSearchParams(window.location.search);
  const value = urlParams.get(paramName);
  if (value === null) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function GetBooleanParam(paramName, defaultValue) {
  const urlParams = new URLSearchParams(window.location.search);
  const value = urlParams.get(paramName);
  if (value === null) return defaultValue;
  return value.toLowerCase() === "true";
}

function GetStringParam(paramName, defaultValue) {
  const urlParams = new URLSearchParams(window.location.search);
  const value = urlParams.get(paramName);
  return value === null ? defaultValue : value;
}

// -------- Overlay / Pilule utils ----------
/**
 * Lit une variable CSS (par défaut depuis :root)
 * @param {string} name ex: '--grad'
 * @param {Element} [el] élément cible (optionnel)
 */
function cssVar(name, el) {
  const target = el || document.documentElement;
  return getComputedStyle(target).getPropertyValue(name).trim();
}

/**
 * Écrit une variable CSS sur un élément
 * @param {Element} el élément cible
 * @param {string} name ex: '--state-bg'
 * @param {string} value valeur à appliquer
 */
function setCSSVar(el, name, value) {
  (el || document.documentElement).style.setProperty(name, value);
}

/**
 * Appelle `cb` à la fin de la transition CSS de `prop` sur `el`
 * avec un fallback timer si l’évènement n’arrive pas.
 * @param {Element} el
 * @param {string} prop ex: 'height', 'clip-path', 'opacity'
 * @param {number} ms durée attendue (pour le fallback)
 * @param {Function} cb callback
 */
function afterTransition(el, prop, ms, cb) {
  let done = false;
  const onEnd = (e) => {
    if (e.propertyName === prop && !done) {
      done = true;
      el.removeEventListener("transitionend", onEnd);
      cb && cb();
    }
  };
  el.addEventListener("transitionend", onEnd);
  setTimeout(() => {
    if (!done) {
      el.removeEventListener("transitionend", onEnd);
      cb && cb();
    }
  }, (ms || 0) + 50);


  
}
