// =====================================================================
//  Compteur de morts | Modifier — action Streamer.bot (sous-action « Execute C# Code »)
//  Un compteur par jeu, stocké dans une variable globale persistante (JSON).
//
//  Arguments acceptés (envoyés par le dock ou réglés dans l'action) :
//    mode    : add | sub | set | reset | select | auto | sync | delete | cover
//              (si absent, déduit de la commande : !addmort, !supmort, !setmort, !resetmort)
//    valeur  : nombre (mode set ; pour add/sub : pas, 1 par défaut)
//              URL d'image (mode cover ; vide = jaquette Twitch)
//    jeu     : nom du jeu à modifier (sinon : jeu choisi à la main, puis catégorie Twitch)
//    annonce : false pour ne pas écrire dans le chat (true par défaut)
//
//  Jaquettes : l'action récupère l'image officielle de la catégorie via l'API Twitch
//  (compte Twitch connecté dans Streamer.bot), une fois par jeu.
//
//  Après exécution, les arguments %jeu% et %morts% sont disponibles pour les
//  sous-actions suivantes (par exemple un texte OBS).
// =====================================================================
using System;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
	// ---------- À personnaliser ----------
	const string VARIABLE = "compteursMorts";        // même nom que dans l'overlay et le dock
	const string ANCIENNE_VARIABLE = "compteurMort"; // ancien compteur unique, repris une seule fois
	const string MESSAGE = "💀 {jeu} : {morts} mort(s)";
	const string SANS_JEU = "Sans catégorie";
	// -------------------------------------

	public bool Execute()
	{
		string mode = Arg("mode").ToLowerInvariant();
		if (mode == "")
			mode = ModeDepuisCommande(Arg("command"));
		if (mode == "")
		{
			CPH.LogWarn("[Compteur de morts] Aucun mode reconnu (argument mode ou commande).");
			return false;
		}

		JObject data = Charger();
		JObject jeux = (JObject)data["games"];

		string nomJeu;
		string twitchId = "";
		switch (mode)
		{
			case "sync":   // changement de catégorie sur Twitch
			case "auto":   // le dock repasse en suivi automatique
				data["manual"] = false;
				nomJeu = JeuTwitch(out twitchId);
				if (nomJeu == "") nomJeu = JeuCourant(data);
				break;
			case "select": // le dock choisit un jeu à la main
				nomJeu = Arg("jeu").Trim();
				if (nomJeu == "") return false;
				data["manual"] = true;
				break;
			default:
				nomJeu = Arg("jeu").Trim();
				if (nomJeu == "")
				{
					bool manuel = data.Value<bool?>("manual") ?? false;
					nomJeu = manuel ? JeuCourant(data) : JeuTwitch(out twitchId);
					if (nomJeu == "") nomJeu = manuel ? JeuTwitch(out twitchId) : JeuCourant(data);
				}
				break;
		}
		if (nomJeu == "") nomJeu = SANS_JEU;

		string cle = Cle(nomJeu);

		// Suppression d'un compteur
		if (mode == "delete")
		{
			jeux.Remove(Cle(Arg("jeu").Trim() == "" ? nomJeu : Arg("jeu").Trim()));
			if (data.Value<string>("current") == cle) data["current"] = "";
			Sauver(data);
			return true;
		}

		JObject jeu = jeux[cle] as JObject;
		if (jeu == null)
		{
			if (mode == "cover") return false; // jeu inconnu
			jeu = new JObject { ["name"] = nomJeu, ["count"] = 0 };
			jeux[cle] = jeu;
		}

		// Jaquette personnalisée (depuis le dock) : ne change ni le compteur ni le jeu affiché
		if (mode == "cover")
		{
			string url = Arg("valeur").Trim();
			if (url == "") jeu.Remove("cover"); else jeu["cover"] = url;
			Sauver(data);
			return true;
		}

		// Jaquette officielle Twitch (une seule recherche par jeu)
		if (twitchId != "") jeu["twitchId"] = twitchId;
		CompleterJaquette(jeu, nomJeu);

		// Reprise de l'ancien compteur unique (une seule fois, sur le premier jeu utilisé)
		if (!(data.Value<bool?>("migrated") ?? false))
		{
			data["migrated"] = true;
			int ancien = LireAncienCompteur();
			if (ancien > 0 && jeu.Value<int>("count") == 0)
				jeu["count"] = ancien;
		}

		int morts = jeu.Value<int>("count");
		int pas = Math.Max(1, ArgInt("valeur", 1));
		bool modifie = true;

		switch (mode)
		{
			case "add": morts += pas; break;
			case "sub": morts = Math.Max(0, morts - pas); break;
			case "set":
				string brut = Arg("valeur");
				if (brut == "") brut = Arg("rawInput");
				int v;
				if (!int.TryParse(brut.Trim(), out v)) { CPH.LogWarn("[Compteur de morts] Valeur invalide : " + brut); return false; }
				morts = Math.Max(0, v);
				break;
			case "reset": morts = 0; break;
			default: modifie = false; break; // select, auto, sync : changement de jeu seulement
		}

		jeu["name"] = nomJeu;
		jeu["count"] = morts;
		if (modifie) jeu["updated"] = DateTime.UtcNow.ToString("o");
		data["current"] = cle;
		Sauver(data);

		CPH.SetArgument("jeu", nomJeu);
		CPH.SetArgument("morts", morts);

		if (modifie && Arg("annonce").ToLowerInvariant() != "false")
			CPH.SendMessage(MESSAGE.Replace("{jeu}", nomJeu).Replace("{morts}", morts.ToString()), true);

		return true;
	}

	// ---------- Données ----------

	JObject Charger()
	{
		JObject data = null;
		try
		{
			string json = CPH.GetGlobalVar<string>(VARIABLE, true);
			if (!string.IsNullOrWhiteSpace(json)) data = JObject.Parse(json);
		}
		catch (Exception e) { CPH.LogWarn("[Compteur de morts] Variable illisible, elle sera recréée : " + e.Message); }

		if (data == null) data = new JObject();
		if (!(data["games"] is JObject)) data["games"] = new JObject();
		if (data["current"] == null) data["current"] = "";
		if (data["manual"] == null) data["manual"] = false;
		data["version"] = 1;
		return data;
	}

	void Sauver(JObject data)
	{
		CPH.SetGlobalVar(VARIABLE, data.ToString(Formatting.None), true);
		// Prévient l'overlay et le dock (en plus de l'événement « Global Variable Updated »)
		try
		{
			JObject msg = new JObject { ["source"] = "compteurMorts", ["variable"] = VARIABLE, ["data"] = data };
			CPH.WebsocketBroadcastJson(msg.ToString(Formatting.None));
		}
		catch (Exception) { }
	}

	int LireAncienCompteur()
	{
		try
		{
			object v = CPH.GetGlobalVar<object>(ANCIENNE_VARIABLE, true);
			int n;
			if (v != null && int.TryParse(v.ToString(), out n)) return n;
		}
		catch (Exception) { }
		return 0;
	}

	string JeuCourant(JObject data)
	{
		string cle = data.Value<string>("current") ?? "";
		JObject jeu = data["games"][cle] as JObject;
		return jeu != null ? (jeu.Value<string>("name") ?? "") : "";
	}

	// Catégorie Twitch en cours : arguments du déclencheur, sinon infos de la chaîne
	string JeuTwitch(out string gameId)
	{
		gameId = "";
		foreach (string cle in new[] { "gameName", "game", "targetUserGame" })
		{
			string v = Arg(cle).Trim();
			if (v != "")
			{
				gameId = Arg(cle == "targetUserGame" ? "targetUserGameId" : "gameId").Trim();
				return v;
			}
		}
		try
		{
			string id = Arg("broadcastUserId");
			if (id == "") return "";
			MethodInfo m = CPH.GetType().GetMethod("TwitchGetExtendedUserInfoById", new[] { typeof(string) });
			if (m == null) return "";
			object info = m.Invoke(CPH, new object[] { id });
			string jeu = Propriete(info, "Game");
			gameId = Propriete(info, "GameId");
			return jeu.Trim();
		}
		catch (Exception e)
		{
			CPH.LogWarn("[Compteur de morts] Catégorie Twitch introuvable : " + e.Message);
			return "";
		}
	}

	// Récupère l'adresse de la jaquette via l'API Twitch (jeton du compte connecté dans Streamer.bot)
	void CompleterJaquette(JObject jeu, string nom)
	{
		if (!string.IsNullOrEmpty(jeu.Value<string>("boxArt"))) return;

		// Pas plus d'une tentative par heure et par jeu si Twitch ne répond pas
		DateTime essai;
		if (DateTime.TryParse(jeu.Value<string>("boxArtTried") ?? "", null, System.Globalization.DateTimeStyles.RoundtripKind, out essai)
			&& (DateTime.UtcNow - essai.ToUniversalTime()).TotalHours < 1)
			return;
		jeu["boxArtTried"] = DateTime.UtcNow.ToString("o");

		try
		{
			string token = Propriete(CPH, "TwitchOAuthToken");
			string clientId = Propriete(CPH, "TwitchClientId");
			if (token == "" || clientId == "") return;

			string id = jeu.Value<string>("twitchId") ?? "";
			string url = "https://api.twitch.tv/helix/games?" + (id != "" ? "id=" + Uri.EscapeDataString(id) : "name=" + Uri.EscapeDataString(nom));

			HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
			req.Method = "GET";
			req.Timeout = 3000;
			req.ReadWriteTimeout = 3000;
			req.Headers.Add("Client-Id", clientId);
			req.Headers.Add("Authorization", "Bearer " + token);

			using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
			using (StreamReader reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
			{
				JObject json = JObject.Parse(reader.ReadToEnd());
				JArray liste = json["data"] as JArray;
				if (liste != null && liste.Count > 0)
				{
					jeu["twitchId"] = liste[0].Value<string>("id");
					jeu["boxArt"] = liste[0].Value<string>("box_art_url"); // modèle avec {width}x{height}
				}
			}
		}
		catch (Exception e)
		{
			CPH.LogWarn("[Compteur de morts] Jaquette introuvable pour " + nom + " : " + e.Message);
		}
	}

	// ---------- Outils ----------

	static string Propriete(object obj, string nom)
	{
		if (obj == null) return "";
		PropertyInfo p = obj.GetType().GetProperty(nom);
		object v = p?.GetValue(obj);
		return v == null ? "" : v.ToString();
	}

	static string Cle(string nom) => nom.Trim().ToLowerInvariant();

	static string ModeDepuisCommande(string commande)
	{
		switch ((commande ?? "").Trim().ToLowerInvariant())
		{
			case "!addmort": return "add";
			case "!supmort": return "sub";
			case "!setmort": return "set";
			case "!resetmort": return "reset";
			default: return "";
		}
	}

	string Arg(string nom)
	{
		object v;
		return args.TryGetValue(nom, out v) && v != null ? v.ToString() : "";
	}

	int ArgInt(string nom, int defaut)
	{
		int n;
		return int.TryParse(Arg(nom).Trim(), out n) ? n : defaut;
	}
}
