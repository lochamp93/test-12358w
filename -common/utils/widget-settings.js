/*
 * widget-settings.js : lecture des réglages d'un widget (module commun, optionnel)
 *
 * settings.json est la définition unique des réglages : ce module en lit les
 * valeurs par défaut, les types et les bornes, puis interprète les paramètres
 * de l'URL. Un paramètre absent ou invalide prend sa valeur par défaut.
 *
 * Utilisation dans un overlay :
 *   const ws = await WidgetSettings.load('settings/settings.json', (nouveaux, anciens) => { ... });
 *   ws.values.fontSize      // valeur typée (nombre, booléen, chaîne)
 *   ws.isActive('iconSize') // false si le réglage est masqué par une condition showIf
 *   ws.demo                 // true si l'URL contient demo=true (aperçu de la page de paramétrage)
 *
 * Mise à jour en direct : la page de paramétrage (settings-core) envoie
 * { type: 'widget-settings', params: 'a=1&b=2' } par postMessage quand
 * settings.json contient "livePreview": true. Le callback reçoit alors les
 * nouvelles valeurs sans rechargement de la page.
 */
(function () {
	'use strict';

	const TRUE_VALUES = ['true', '1', 'yes', 'on', 'oui'];
	const FALSE_VALUES = ['false', '0', 'no', 'off', 'non'];
	const COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

	// Lit la valeur brute d'un réglage dans l'URL (nom principal, puis alias)
	function readRaw(setting, params) {
		if (params.has(setting.id)) return params.get(setting.id);
		for (const alias of (setting.aliases || [])) {
			if (params.has(alias)) return params.get(alias);
		}
		return null;
	}

	// Convertit une valeur brute selon le type déclaré dans settings.json
	function parseValue(setting, raw) {
		const def = setting.defaultValue;
		if (raw === null || raw === undefined) return def;
		const str = String(raw).trim();

		switch (setting.type) {
			case 'checkbox': {
				const v = str.toLowerCase();
				if (TRUE_VALUES.includes(v)) return true;
				if (FALSE_VALUES.includes(v)) return false;
				return def;
			}
			case 'number': {
				if (str === '') return def;
				let n = Number(str.replace(',', '.'));
				if (!Number.isFinite(n)) return def;
				if (setting.min !== undefined && setting.min !== '' && n < Number(setting.min)) n = Number(setting.min);
				if (setting.max !== undefined && setting.max !== '' && n > Number(setting.max)) n = Number(setting.max);
				return n;
			}
			case 'select': {
				const options = (setting.options || []).map(o => String(typeof o === 'object' ? o.value : o));
				return options.includes(str) ? str : def;
			}
			case 'color':
				return COLOR_RE.test(str) ? str : def;
			case 'button':
				return undefined;
			default:
				return String(raw);
		}
	}

	// Interprète tous les réglages à partir d'un URLSearchParams
	function parseAll(definition, params) {
		const values = {};
		for (const setting of definition.settings || []) {
			if (setting.type === 'button' || setting.type === 'info') continue;
			values[setting.id] = parseValue(setting, readRaw(setting, params));
		}
		return values;
	}

	// Une condition showIf est-elle remplie ? (gère la chaîne de dépendances)
	function conditionMet(definition, values, showIf, depth) {
		if (!showIf || depth > 20) return true;
		if (Array.isArray(showIf.any))
			return showIf.any.some(c => conditionMet(definition, values, c, depth + 1));
		if (Array.isArray(showIf.all))
			return showIf.all.every(c => conditionMet(definition, values, c, depth + 1));
		const cond = typeof showIf === 'string' ? { id: showIf } : showIf;
		const parent = (definition.settings || []).find(s => s.id === cond.id);
		if (!parent) return true;
		const v = values[cond.id];
		let ok;
		if (cond.value !== undefined) {
			const accepted = Array.isArray(cond.value) ? cond.value : [cond.value];
			ok = accepted.map(String).includes(String(v));
		} else if (cond.notValue !== undefined) {
			const refused = Array.isArray(cond.notValue) ? cond.notValue : [cond.notValue];
			ok = !refused.map(String).includes(String(v));
		} else {
			ok = v === true;
		}
		return ok && conditionMet(definition, values, parent.showIf, depth + 1);
	}

	function isActive(definition, values, id) {
		const setting = (definition.settings || []).find(s => s.id === id);
		return setting ? conditionMet(definition, values, setting.showIf, 0) : false;
	}

	async function load(jsonUrl, onChange) {
		const response = await fetch(jsonUrl, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Impossible de lire ${jsonUrl} (${response.status})`);
		const definition = await response.json();

		const urlParams = new URL(window.location.href).searchParams;
		const state = {
			definition,
			values: parseAll(definition, urlParams),
			demo: TRUE_VALUES.includes(String(urlParams.get('demo') || '').toLowerCase()),
			isActive(id) { return isActive(definition, state.values, id); }
		};

		// Mises à jour en direct depuis la page de paramétrage
		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (!msg || msg.type !== 'widget-settings' || typeof msg.params !== 'string') return;
			const previous = state.values;
			state.values = parseAll(definition, new URLSearchParams(msg.params));
			if (typeof onChange === 'function') onChange(state.values, previous);
		});

		return state;
	}

	window.WidgetSettings = { load, parseAll, parseValue, isActive, conditionMet };
})();
