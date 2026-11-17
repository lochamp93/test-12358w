// =====================================================================
//  Giveaway | Gérer : action Streamer.bot (sous-action « Execute C# Code »)
//  Toute la logique du giveaway (inscriptions, tirage pondéré, confirmation)
//  vit ici. L'état est gardé dans une variable globale persistante (JSON),
//  lue par l'overlay et le dock.
//
//  Arguments acceptés (envoyés par le dock ou l'overlay) :
//    mode : config | photo | open | close | draw | noshow | chat | remove | add | reset | clearHistory
//    config  : JSON partiel des réglages (mode config)
//    photo   : image du lot en data URL ou URL, vide pour retirer (mode photo)
//    platform, userId, login, name, text, msgId, sub, avatar : message du chat (mode chat)
//    key     : participant·e à retirer (mode remove)
//
//  Les messages du chat sont collectés par l'overlay et le dock (Twitch, YouTube,
//  Kick, TikTok) : plusieurs instances peuvent envoyer le même message, les doublons
//  sont ignorés grâce à msgId.
// =====================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
	// ---------- À personnaliser ----------
	const string VARIABLE = "giveaway";            // même nom que dans l'overlay et le dock
	const string VARIABLE_PHOTO = "giveawayPhoto"; // image du lot (séparée pour alléger les mises à jour)
	// -------------------------------------

	static readonly object verrou = new object();
	static readonly Dictionary<string, bool> messagesTraites = new Dictionary<string, bool>();
	static readonly Queue<string> ordreMessages = new Queue<string>();
	// Ancienneté de follow déjà vérifiée (clé : id Twitch, valeur : date de follow ou MinValue)
	static readonly Dictionary<string, DateTime> follows = new Dictionary<string, DateTime>();
	static readonly Random hasard = new Random();

	public bool Execute()
	{
		string msgId = Arg("msgId").Trim();
		if (msgId != "")
		{
			string cleMsg = Arg("platform") + ":" + msgId;
			lock (verrou)
			{
				if (messagesTraites.ContainsKey(cleMsg)) return true; // doublon ignoré
				messagesTraites[cleMsg] = true;
				ordreMessages.Enqueue(cleMsg);
				while (ordreMessages.Count > 500) messagesTraites.Remove(ordreMessages.Dequeue());
			}
		}
		lock (verrou)
		{
			try { return Executer(); }
			catch (Exception e)
			{
				CPH.LogError("[Giveaway] " + e.Message + "\n" + e.StackTrace);
				return false;
			}
		}
	}

	bool Executer()
	{
		string mode = Arg("mode").ToLowerInvariant();
		JObject data = Charger();
		JObject cfg = (JObject)data["config"];
		string statut = data.Value<string>("status");

		switch (mode)
		{
			case "config":
			{
				JObject partiel = null;
				try { partiel = JObject.Parse(Arg("config")); } catch (Exception) { }
				if (partiel == null) return false;
				foreach (JProperty p in partiel.Properties())
					if (ConfigParDefaut()[p.Name] != null) cfg[p.Name] = p.Value;
				Normaliser(cfg);
				Sauver(data, "update");
				return true;
			}
			case "photo":
			{
				string photo = Arg("photo").Trim();
				CPH.SetGlobalVar(VARIABLE_PHOTO, photo, true);
				data["photoV"] = data.Value<long>("photoV") + 1;
				data["hasPhoto"] = photo != "";
				Sauver(data, "photo");
				return true;
			}
			case "open":
			{
				if (statut != "setup") return false;
				if ((cfg.Value<string>("word") ?? "").Trim() == "")
				{
					CPH.LogWarn("[Giveaway] Impossible d'ouvrir : aucun mot à écrire dans le chat.");
					return false;
				}
				data["status"] = "open";
				data["openedAt"] = Maintenant();
				Sauver(data, "update");
				Annoncer(cfg, Modele(cfg, "msgOpen", null));
				return true;
			}
			case "close":
			{
				if (statut != "open") return false;
				data["status"] = "closed";
				Sauver(data, "update");
				return true;
			}
			case "draw":
				return Tirer(data, false);
			case "noshow":
				return Tirer(data, true);
			case "chat":
				return MessageChat(data);
			case "remove":
			{
				JObject parts = (JObject)data["participants"];
				parts.Remove(Arg("key"));
				Sauver(data, "update");
				return true;
			}
			case "add":
			{
				// Ajout à la main depuis le dock (inscriptions ouvertes ou closes)
				string nom = Arg("name").Trim();
				if (nom == "" || statut == "setup") return false;
				string plateforme = Arg("platform").Trim().ToLowerInvariant();
				if (plateforme == "") plateforme = "twitch";
				string cle = plateforme + ":" + nom.ToLowerInvariant();
				JObject parts = (JObject)data["participants"];
				if (parts[cle] == null)
					parts[cle] = new JObject
					{
						["platform"] = plateforme, ["id"] = "", ["login"] = nom.ToLowerInvariant(), ["name"] = nom,
						["avatar"] = "", ["sub"] = Arg("sub") == "true", ["entries"] = 1, ["excluded"] = false,
						["drawn"] = false, ["manual"] = true, ["joined"] = Maintenant()
					};
				Sauver(data, "update");
				return true;
			}
			case "reset":
			{
				JArray historique = data["history"] as JArray ?? new JArray();
				long tirages = data.Value<long>("drawId");
				data = Nouveau();
				data["history"] = historique;
				data["drawId"] = tirages; // l'overlay ne rejoue pas un ancien tirage
				CPH.SetGlobalVar(VARIABLE_PHOTO, "", true);
				data["photoV"] = Maintenant();
				Sauver(data, "reset");
				return true;
			}
			case "clearhistory":
				data["history"] = new JArray();
				Sauver(data, "update");
				return true;
			default:
				CPH.LogWarn("[Giveaway] Mode inconnu : " + mode);
				return false;
		}
	}

	// ---------- Messages du chat : inscription ou confirmation ----------

	bool MessageChat(JObject data)
	{
		JObject cfg = (JObject)data["config"];
		string statut = data.Value<string>("status");
		string plateforme = Arg("platform").Trim().ToLowerInvariant();
		string userId = Arg("userId").Trim();
		string login = Arg("login").Trim().ToLowerInvariant();
		string nom = Arg("name").Trim();
		string texte = Arg("text");
		if (nom == "") nom = login;
		if (plateforme == "" || (userId == "" && login == "")) return false;
		string cle = plateforme + ":" + (userId != "" ? userId : login);

		// Confirmation : n'importe quel message de la personne tirée, avant la fin du délai
		if (statut == "pending")
		{
			JObject tirage = data["draw"] as JObject;
			if (tirage == null) return true;
			long limite = tirage.Value<long>("deadline");
			foreach (JObject g in (JArray)tirage["winners"])
			{
				if (g.Value<string>("key") != cle || g.Value<bool>("confirmed")) continue;
				if (Maintenant() > limite) return true; // trop tard
				g["confirmed"] = true;
				g["confirmText"] = texte;
				g["confirmTime"] = Maintenant();
				data["won"] = data.Value<int>("won") + 1;

				JArray historique = data["history"] as JArray;
				historique.Insert(0, new JObject
				{
					["lot"] = cfg.Value<string>("lot"), ["name"] = g.Value<string>("name"),
					["platform"] = g.Value<string>("platform"), ["at"] = Maintenant()
				});
				while (historique.Count > 50) historique.RemoveAt(historique.Count - 1);

				bool tous = true;
				foreach (JObject autre in (JArray)tirage["winners"]) if (!autre.Value<bool>("confirmed")) tous = false;
				if (tous) data["status"] = data.Value<int>("won") >= cfg.Value<int>("lots") ? "finished" : "confirmed";
				Sauver(data, "confirm");
				Annoncer(cfg, Modele(cfg, "msgConfirm", new List<string> { g.Value<string>("name") }));
				return true;
			}
			return true;
		}

		if (statut != "open") return true;

		// Plateforme éligible ?
		bool eligible = false;
		foreach (JToken p in (JArray)cfg["platforms"]) if ((string)p == plateforme) eligible = true;
		if (!eligible) return true;

		// Mot à écrire
		string mot = (cfg.Value<string>("word") ?? "").Trim().ToLowerInvariant();
		string t = (texte ?? "").Trim().ToLowerInvariant();
		bool exact = cfg.Value<string>("match") == "exact";
		if (mot == "" || (exact ? t != mot : !t.Contains(mot))) return true;

		// Exclus d'office (bots, modos…)
		foreach (string ex in (cfg.Value<string>("excluded") ?? "").Split(','))
		{
			string e = ex.Trim().TrimStart('@').ToLowerInvariant();
			if (e != "" && (e == login || e == nom.ToLowerInvariant())) return true;
		}

		JObject parts = (JObject)data["participants"];
		JObject part = parts[cle] as JObject;
		bool abonne = Arg("sub").ToLowerInvariant() == "true";

		if (part == null)
		{
			// Ancienneté de follow minimale (Twitch seulement)
			if (plateforme == "twitch" && !FollowSuffisant(cfg, userId, login)) return true;
			part = new JObject
			{
				["platform"] = plateforme, ["id"] = userId, ["login"] = login, ["name"] = nom,
				["avatar"] = Arg("avatar"), ["sub"] = abonne, ["entries"] = 0, ["excluded"] = false,
				["drawn"] = false, ["joined"] = Maintenant(),
				["msg"] = new JObject { ["text"] = texte, ["time"] = Maintenant() }
			};
			parts[cle] = part;
		}
		part["entries"] = part.Value<int>("entries") + 1;
		if (abonne) part["sub"] = true;
		if (string.IsNullOrEmpty(part.Value<string>("avatar")) && Arg("avatar") != "") part["avatar"] = Arg("avatar");
		// Anti-spam : au-delà du maximum, la personne est exclue
		if (part.Value<int>("entries") > cfg.Value<int>("maxEntries")) part["excluded"] = true;

		Sauver(data, "update");
		return true;
	}

	bool FollowSuffisant(JObject cfg, string userId, string login)
	{
		int n = cfg.Value<int>("followMin");
		if (n <= 0) return true;
		string unite = cfg.Value<string>("followUnit");
		TimeSpan minimum = unite == "months" ? TimeSpan.FromDays(30 * n) : unite == "weeks" ? TimeSpan.FromDays(7 * n) : TimeSpan.FromDays(n);

		DateTime depuis;
		if (!follows.TryGetValue(userId != "" ? userId : login, out depuis))
		{
			depuis = DateFollow(userId);
			if (depuis == DateTime.MaxValue) return true; // vérification impossible : on accepte
			follows[userId != "" ? userId : login] = depuis;
		}
		if (depuis == DateTime.MinValue) return false; // ne suit pas la chaîne
		return DateTime.UtcNow - depuis >= minimum;
	}

	// Date de follow via l'API Twitch (droit moderator:read:followers du compte diffuseur)
	// MinValue : ne suit pas ; MaxValue : vérification impossible
	DateTime DateFollow(string userId)
	{
		try
		{
			if (userId == "") return DateTime.MaxValue;
			string token = Propriete(CPH, "TwitchOAuthToken");
			string clientId = Propriete(CPH, "TwitchClientId");
			MethodInfo mb = CPH.GetType().GetMethod("TwitchGetBroadcaster", Type.EmptyTypes);
			string diffuseur = Texte(Membre(mb?.Invoke(CPH, null), "UserId"));
			if (token == "" || clientId == "" || diffuseur == "") return DateTime.MaxValue;
			string url = "https://api.twitch.tv/helix/channels/followers?broadcaster_id=" + EncoderURL(diffuseur) + "&user_id=" + EncoderURL(userId);
			string reponse = TelechargerTexte(url, clientId, token, 4000);
			if (string.IsNullOrEmpty(reponse)) return DateTime.MaxValue;
			JArray liste = JObject.Parse(reponse)["data"] as JArray;
			if (liste == null || liste.Count == 0) return DateTime.MinValue;
			DateTime d;
			if (DateTime.TryParse(liste[0].Value<string>("followed_at") ?? "", null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out d))
				return d;
		}
		catch (Exception e) { CPH.LogWarn("[Giveaway] Vérification du follow impossible : " + e.Message); }
		return DateTime.MaxValue;
	}

	// ---------- Tirage ----------

	bool Tirer(JObject data, bool remplacement)
	{
		JObject cfg = (JObject)data["config"];
		string statut = data.Value<string>("status");
		JObject parts = (JObject)data["participants"];
		JObject ancien = data["draw"] as JObject;
		int aTirer;

		if (remplacement)
		{
			// Pas de réponse : on remplace les personnes qui n'ont pas confirmé (elles restent exclues)
			if (statut != "pending" || ancien == null) return false;
			aTirer = 0;
			foreach (JObject g in (JArray)ancien["winners"]) if (!g.Value<bool>("confirmed")) aTirer++;
		}
		else
		{
			if (statut == "open") { data["status"] = "closed"; statut = "closed"; } // le tirage ferme les inscriptions
			if (statut != "closed" && statut != "confirmed") return false;
			aTirer = cfg.Value<int>("perDraw");
		}

		int restants = cfg.Value<int>("lots") - data.Value<int>("won");
		aTirer = Math.Min(aTirer, restants);

		// Personnes en lice et poids (abonné·es : coefficient choisi)
		List<JObject> lice = new List<JObject>();
		List<string> cles = new List<string>();
		double coef = Math.Max(1, cfg.Value<double>("subLuck"));
		foreach (JProperty p in parts.Properties())
		{
			JObject part = (JObject)p.Value;
			if (part.Value<bool>("excluded") || part.Value<bool>("drawn")) continue;
			lice.Add(part);
			cles.Add(p.Name);
		}
		aTirer = Math.Min(aTirer, lice.Count);
		if (aTirer <= 0)
		{
			data["lastError"] = lice.Count == 0 ? "Personne n’est en lice" : "Tous les lots ont été gagnés";
			Sauver(data, "update");
			return false;
		}
		data.Remove("lastError");

		JArray gagnants = new JArray();
		for (int i = 0; i < aTirer; i++)
		{
			double total = 0;
			foreach (JObject part in lice) total += part.Value<bool>("sub") ? coef : 1;
			double r = hasard.NextDouble() * total;
			int choix = lice.Count - 1;
			for (int j = 0; j < lice.Count; j++)
			{
				r -= lice[j].Value<bool>("sub") ? coef : 1;
				if (r < 0) { choix = j; break; }
			}
			JObject g = lice[choix];
			g["drawn"] = true;
			if (string.IsNullOrEmpty(g.Value<string>("avatar")) && g.Value<string>("platform") == "twitch")
				g["avatar"] = AvatarTwitch(g.Value<string>("id"), g.Value<string>("login"));
			gagnants.Add(new JObject
			{
				["key"] = cles[choix], ["name"] = g.Value<string>("name"), ["login"] = g.Value<string>("login"),
				["platform"] = g.Value<string>("platform"), ["avatar"] = g.Value<string>("avatar") ?? "",
				["sub"] = g.Value<bool>("sub"), ["msg"] = g["msg"] ?? new JObject(), ["confirmed"] = false
			});
			lice.RemoveAt(choix);
			cles.RemoveAt(choix);
		}

		// Remplacement : on garde les personnes déjà confirmées dans ce tirage
		if (remplacement)
		{
			JArray gardes = new JArray();
			foreach (JObject g in (JArray)ancien["winners"]) if (g.Value<bool>("confirmed")) gardes.Add(g);
			foreach (JToken g in gagnants) gardes.Add(g);
			gagnants = gardes;
		}

		long id = data.Value<long>("drawId") + 1;
		data["drawId"] = id;
		data["draw"] = new JObject
		{
			["id"] = id, ["at"] = Maintenant(),
			["deadline"] = Maintenant() + 1000L * cfg.Value<int>("confirmSeconds"),
			["winners"] = gagnants, ["replacement"] = remplacement
		};
		data["status"] = "pending";
		Sauver(data, "draw");

		List<string> noms = new List<string>();
		foreach (JObject g in gagnants) if (!g.Value<bool>("confirmed")) noms.Add(g.Value<string>("name"));
		Annoncer(cfg, Modele(cfg, noms.Count > 1 ? "msgDrawMany" : "msgDraw", noms));
		return true;
	}

	string AvatarTwitch(string id, string login)
	{
		try
		{
			object infos = null;
			MethodInfo m = id != "" ? CPH.GetType().GetMethod("TwitchGetExtendedUserInfoById", new[] { typeof(string) }) : null;
			if (m != null) infos = m.Invoke(CPH, new object[] { id });
			if (infos == null && login != "")
			{
				MethodInfo ml = CPH.GetType().GetMethod("TwitchGetExtendedUserInfoByLogin", new[] { typeof(string) });
				if (ml != null) infos = ml.Invoke(CPH, new object[] { login });
			}
			return Texte(Membre(infos, "ProfileImageUrl"));
		}
		catch (Exception) { return ""; }
	}

	// ---------- Messages du bot ----------

	string Modele(JObject cfg, string cle, List<string> noms)
	{
		string modele = cfg.Value<string>(cle) ?? "";
		if (modele.Trim() == "") return "";
		string mentions = "";
		if (noms != null) foreach (string n in noms) mentions += (mentions == "" ? "" : " ") + "@" + n;
		return modele
			.Replace("{mot}", cfg.Value<string>("word") ?? "")
			.Replace("{lot}", (cfg.Value<string>("lot") ?? "").Trim() == "" ? "un lot" : cfg.Value<string>("lot"))
			.Replace("{secondes}", cfg.Value<int>("confirmSeconds").ToString())
			.Replace("{pseudo}", mentions)
			.Replace("{pseudos}", mentions);
	}

	// Les messages partent du compte bot configuré dans Streamer.bot
	void Annoncer(JObject cfg, string message)
	{
		if (string.IsNullOrWhiteSpace(message)) return;
		bool twitch = false, youtube = false, kick = false;
		foreach (JToken p in (JArray)cfg["platforms"])
		{
			if ((string)p == "twitch") twitch = true;
			if ((string)p == "youtube") youtube = true;
			if ((string)p == "kick") kick = true;
		}
		if (twitch) CPH.SendMessage(message, true);
		// YouTube et Kick : selon la version de Streamer.bot (ignoré si la méthode n'existe pas)
		if (youtube) Appeler(new[] { "SendYouTubeMessageToLatestMonitored", "SendYouTubeMessage" }, message);
		if (kick) Appeler(new[] { "SendKickMessage" }, message);
	}

	void Appeler(string[] methodes, string message)
	{
		foreach (string nom in methodes)
		{
			try
			{
				foreach (MethodInfo m in CPH.GetType().GetMethods())
				{
					if (m.Name != nom) continue;
					ParameterInfo[] ps = m.GetParameters();
					if (ps.Length == 0 || ps[0].ParameterType != typeof(string)) continue;
					object[] valeurs = new object[ps.Length];
					valeurs[0] = message;
					for (int i = 1; i < ps.Length; i++)
						valeurs[i] = ps[i].HasDefaultValue ? ps[i].DefaultValue : (ps[i].ParameterType == typeof(bool) ? (object)true : null);
					m.Invoke(CPH, valeurs);
					return;
				}
			}
			catch (Exception e) { CPH.LogWarn("[Giveaway] Envoi " + nom + " impossible : " + e.Message); }
		}
	}

	// ---------- Données ----------

	static JObject ConfigParDefaut()
	{
		return new JObject
		{
			["lot"] = "",
			["lots"] = 1,
			["perDraw"] = 1,
			["word"] = "",
			["match"] = "contains",
			["maxEntries"] = 1,
			["subLuck"] = 1,
			["followMin"] = 0,
			["followUnit"] = "days",
			["platforms"] = new JArray("twitch", "kick", "youtube", "tiktok"),
			["kickChannel"] = "",
			["confirmSeconds"] = 60,
			["excluded"] = "",
			["msgOpen"] = "GIVEAWAY ouvert ! Écrivez « {mot} » dans le chat pour participer. Lot : {lot}",
			["msgDraw"] = "{pseudo} tu as été tiré·e au sort ! Écris un message dans le chat dans les {secondes} secondes pour confirmer que tu veux le lot.",
			["msgDrawMany"] = "{pseudos} vous avez été tiré·es au sort ! Écrivez un message dans le chat dans les {secondes} secondes pour confirmer que vous voulez le lot.",
			["msgConfirm"] = "Félicitations {pseudo} qui remporte {lot} ! Un modo te contacte très vite."
		};
	}

	static void Normaliser(JObject cfg)
	{
		Func<string, int, int, int> borne = (cle, min, max) =>
		{
			int v;
			if (!int.TryParse(Convert.ToString(cfg[cle]), out v)) v = ConfigParDefaut().Value<int>(cle);
			v = Math.Max(min, Math.Min(max, v));
			cfg[cle] = v;
			return v;
		};
		borne("lots", 1, 999);
		borne("perDraw", 1, 99);
		borne("maxEntries", 1, 999);
		borne("followMin", 0, 999);
		borne("confirmSeconds", 10, 600);
		int luck = borne("subLuck", 1, 5);
		if (luck != 1 && luck != 2 && luck != 3 && luck != 5) cfg["subLuck"] = 1;
		if (cfg.Value<string>("match") != "exact") cfg["match"] = "contains";
		string u = cfg.Value<string>("followUnit");
		if (u != "weeks" && u != "months") cfg["followUnit"] = "days";
		if (!(cfg["platforms"] is JArray)) cfg["platforms"] = new JArray("twitch", "kick", "youtube", "tiktok");
	}

	static JObject Nouveau()
	{
		return new JObject
		{
			["version"] = 1,
			["status"] = "setup",
			["config"] = ConfigParDefaut(),
			["participants"] = new JObject(),
			["draw"] = null,
			["drawId"] = 0,
			["won"] = 0,
			["photoV"] = 0,
			["hasPhoto"] = false,
			["history"] = new JArray()
		};
	}

	JObject Charger()
	{
		JObject data = null;
		try
		{
			string json = CPH.GetGlobalVar<string>(VARIABLE, true);
			if (!string.IsNullOrWhiteSpace(json)) data = JObject.Parse(json);
		}
		catch (Exception e) { CPH.LogWarn("[Giveaway] Variable illisible, elle sera recréée : " + e.Message); }
		JObject neuf = Nouveau();
		if (data == null) return neuf;
		// Complète les clés manquantes (ancienne version de la variable)
		foreach (JProperty p in neuf.Properties()) if (data[p.Name] == null) data[p.Name] = p.Value;
		if (!(data["config"] is JObject)) data["config"] = ConfigParDefaut();
		JObject cfg = (JObject)data["config"];
		foreach (JProperty p in ConfigParDefaut().Properties()) if (cfg[p.Name] == null) cfg[p.Name] = p.Value;
		Normaliser(cfg);
		if (!(data["participants"] is JObject)) data["participants"] = new JObject();
		if (!(data["history"] is JArray)) data["history"] = new JArray();
		return data;
	}

	void Sauver(JObject data, string evenement)
	{
		data["updated"] = Maintenant();
		CPH.SetGlobalVar(VARIABLE, data.ToString(Formatting.None), true);
		// Prévient l'overlay et le dock (en plus de l'événement « Global Variable Updated »)
		try
		{
			JObject msg = new JObject { ["source"] = "giveaway", ["event"] = evenement, ["variable"] = VARIABLE, ["data"] = data };
			CPH.WebsocketBroadcastJson(msg.ToString(Formatting.None));
		}
		catch (Exception) { }
	}

	static long Maintenant() => (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;

	// ---------- Requêtes HTTP (repris du Compteur de morts) ----------

	static Type TrouverType(string nomComplet, params string[] assemblies)
	{
		foreach (string a in assemblies)
		{
			Type t = Type.GetType(nomComplet + ", " + a, false);
			if (t != null) return t;
		}
		foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
		{
			Type t = asm.GetType(nomComplet, false);
			if (t != null) return t;
		}
		return null;
	}

	static string TelechargerTexte(string url, string clientId, string token, int delaiMs)
	{
		Type typeHttp = TrouverType("System.Net.Http.HttpClient", "System.Net.Http");
		if (typeHttp != null)
		{
			object client = Activator.CreateInstance(typeHttp);
			try
			{
				object entetes = typeHttp.GetProperty("DefaultRequestHeaders").GetValue(client);
				MethodInfo ajouter = entetes.GetType().GetMethod("Add", new[] { typeof(string), typeof(string) });
				ajouter.Invoke(entetes, new object[] { "Client-Id", clientId });
				ajouter.Invoke(entetes, new object[] { "Authorization", "Bearer " + token });
				MethodInfo get = typeHttp.GetMethod("GetStringAsync", new[] { typeof(string) });
				Task<string> tache = (Task<string>)get.Invoke(client, new object[] { url });
				return tache.Wait(delaiMs) ? tache.Result : "";
			}
			finally { (client as IDisposable)?.Dispose(); }
		}

		Type typeClient = TrouverType("System.Net.WebClient", "System, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089", "System.Net.WebClient");
		if (typeClient == null) return "";
		object wc = Activator.CreateInstance(typeClient);
		try
		{
			typeClient.GetProperty("Encoding").SetValue(wc, Encoding.UTF8);
			object h = typeClient.GetProperty("Headers").GetValue(wc);
			MethodInfo add = h.GetType().GetMethod("Add", new[] { typeof(string), typeof(string) });
			add.Invoke(h, new object[] { "Client-Id", clientId });
			add.Invoke(h, new object[] { "Authorization", "Bearer " + token });
			MethodInfo dl = typeClient.GetMethod("DownloadString", new[] { typeof(string) });
			Task<string> t2 = Task.Run(() => (string)dl.Invoke(wc, new object[] { url }));
			return t2.Wait(delaiMs) ? t2.Result : "";
		}
		finally { (wc as IDisposable)?.Dispose(); }
	}

	static string EncoderURL(string texte)
	{
		StringBuilder sb = new StringBuilder();
		foreach (byte b in Encoding.UTF8.GetBytes(texte))
		{
			char c = (char)b;
			if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~')
				sb.Append(c);
			else
				sb.Append('%').Append(b.ToString("X2"));
		}
		return sb.ToString();
	}

	// ---------- Outils ----------

	static string Propriete(object obj, string nom)
	{
		if (obj == null) return "";
		PropertyInfo p = obj.GetType().GetProperty(nom);
		object v = p?.GetValue(obj);
		return v == null ? "" : v.ToString();
	}

	static string Texte(object v) => v == null ? "" : v.ToString().Trim();

	static object Membre(object obj, string nom)
	{
		if (obj == null) return null;
		try
		{
			IDictionary<string, object> dg = obj as IDictionary<string, object>;
			if (dg != null)
			{
				foreach (KeyValuePair<string, object> e in dg)
					if (string.Equals(e.Key, nom, StringComparison.OrdinalIgnoreCase)) return e.Value;
				return null;
			}
			IDictionary d = obj as IDictionary;
			if (d != null)
			{
				foreach (DictionaryEntry e in d)
					if (string.Equals(Convert.ToString(e.Key), nom, StringComparison.OrdinalIgnoreCase)) return e.Value;
				return null;
			}
			BindingFlags f = BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase;
			PropertyInfo p = obj.GetType().GetProperty(nom, f);
			if (p != null && p.GetIndexParameters().Length == 0) return p.GetValue(obj);
			FieldInfo fi = obj.GetType().GetField(nom, f);
			return fi?.GetValue(obj);
		}
		catch (Exception) { return null; }
	}

	string Arg(string nom)
	{
		object v;
		return args.TryGetValue(nom, out v) && v != null ? v.ToString() : "";
	}
}
