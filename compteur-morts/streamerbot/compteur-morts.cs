// =====================================================================
//  Compteur de morts | Modifier : action Streamer.bot (sous-action « Execute C# Code »)
//  Un compteur par jeu, stocké dans une variable globale persistante (JSON).
//
//  Arguments acceptés (envoyés par le dock ou réglés dans l'action) :
//    mode    : add | sub | set | reset | select | auto | sync | delete | cover
//              (si absent, déduit de la commande : !addmort, !supmort, !setmort, !resetmort)
//    valeur  : nombre (mode set ; pour add/sub : pas, 1 par défaut)
//              URL d'image (mode cover ; vide = jaquette Twitch)
//    jeu     : nom du jeu à modifier (sinon : jeu choisi à la main, puis catégorie Twitch)
//    annonce : false pour ne pas écrire dans le chat (true par défaut)
//    msgId   : identifiant du message du chat (les doublons sont ignorés)
//
//  Jaquettes : l'action utilise la variable Streamer.bot %gameBoxArt% (catégorie
//  Twitch en cours) ; à défaut, elle interroge l'API Twitch une fois par jeu.
//
//  Après exécution, les arguments %jeu% et %morts% sont disponibles pour les
//  sous-actions suivantes (par exemple un texte OBS).
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
	const string VARIABLE = "compteursMorts";        // même nom que dans l'overlay et le dock
	const string ANCIENNE_VARIABLE = "compteurMort"; // ancien compteur unique, repris une seule fois
	const string MESSAGE = "💀 {jeu} : {morts} mort(s)";
	const string SANS_JEU = "Sans catégorie";
	// -------------------------------------

	// Messages du chat déjà traités : l'overlay peut être présent dans plusieurs scènes OBS,
	// chaque instance envoie la même commande, une seule doit compter
	static readonly object verrou = new object();
	static readonly Dictionary<string, bool> messagesTraites = new Dictionary<string, bool>();
	static readonly Queue<string> ordreMessages = new Queue<string>();

	public bool Execute()
	{
		string msgId = Arg("msgId").Trim();
		if (msgId != "")
		{
			lock (verrou)
			{
				if (messagesTraites.ContainsKey(msgId)) return true; // doublon ignoré
				messagesTraites[msgId] = true;
				ordreMessages.Enqueue(msgId);
				while (ordreMessages.Count > 200) messagesTraites.Remove(ordreMessages.Dequeue());
			}
		}
		lock (verrou) { return Executer(); }
	}

	bool Executer()
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
				if (nomJeu == SANS_JEU) nomJeu = "";
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

		// Jaquette officielle : variable Streamer.bot %gameBoxArt% si elle concerne ce jeu,
		// sinon API Twitch (une seule recherche par jeu)
		string nomTwitch, idTwitch, jaquetteTwitch;
		InfosTwitch(out nomTwitch, out idTwitch, out jaquetteTwitch);
		if (nomTwitch != "" && Cle(nomTwitch) == cle)
		{
			if (twitchId == "") twitchId = idTwitch;
			if (jaquetteTwitch != "") jeu["boxArt"] = jaquetteTwitch;
		}
		if (twitchId != "") jeu["twitchId"] = twitchId;
		CompleterJaquette(jeu, nomJeu);
		if (string.IsNullOrEmpty(jeu.Value<string>("boxArt")) && string.IsNullOrEmpty(jeu.Value<string>("cover")))
			JournaliserSourcesJaquette(nomJeu);

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
		string nom = jeu != null ? (jeu.Value<string>("name") ?? "") : "";
		return nom == SANS_JEU ? "" : nom; // « Sans catégorie » n'est jamais retenu comme jeu en cours
	}

	// Catégorie Twitch en cours : arguments du déclencheur, sinon infos de la chaîne
	string JeuTwitch(out string gameId)
	{
		string nom, jaquette;
		InfosTwitch(out nom, out gameId, out jaquette);
		if (nom == "")
			CPH.LogWarn("[Compteur de morts] Catégorie Twitch introuvable (compte diffuseur connecté dans Streamer.bot ?)");
		return nom;
	}

	// Catégorie Twitch en cours d'après les arguments de l'action :
	// arguments directs (%gameName%, %gameId%, %gameBoxArt%…) ou objets comme %broadcasterChannel.gameName%
	void InfosTwitch(out string nom, out string id, out string jaquette)
	{
		nom = PremierArg("gameName", "game", "targetUserGame");
		id = PremierArg("gameId", "targetUserGameId");
		jaquette = PremierArg("gameBoxArt", "boxArt", "targetUserGameBoxArt", "gameBoxArtUrl");

		// Clés « composées » (ex. broadcasterChannel.gameBoxArt) et objets imbriqués
		foreach (KeyValuePair<string, object> a in args)
		{
			if (a.Value == null) continue;
			string k = a.Key ?? "";
			string texte = a.Value as string;
			if (texte != null)
			{
				if (jaquette == "" && k.EndsWith("gameBoxArt", StringComparison.OrdinalIgnoreCase)) jaquette = texte.Trim();
				if (nom == "" && k.EndsWith(".gameName", StringComparison.OrdinalIgnoreCase)) nom = texte.Trim();
				if (id == "" && k.EndsWith(".gameId", StringComparison.OrdinalIgnoreCase)) id = texte.Trim();
				continue;
			}
			if (a.Value.GetType().IsPrimitive) continue;
			if (nom == "") nom = Texte(Membre(a.Value, "gameName"));
			if (id == "") id = Texte(Membre(a.Value, "gameId"));
			if (jaquette == "") jaquette = Texte(Membre(a.Value, "gameBoxArt"));
		}

		// Pas d'information dans les arguments (ex. clic dans le dock) : infos de la chaîne Twitch
		if (nom == "" || jaquette == "")
		{
			object infos = InfosChaine();
			if (infos != null)
			{
				string n = Texte(Membre(infos, "Game")); if (n == "") n = Texte(Membre(infos, "GameName"));
				if (nom == "") nom = n;
				// Infos de la chaîne parfois en retard sur Twitch : on ne les utilise que si elles
				// parlent bien du même jeu (sinon id et jaquette seraient ceux de l'ancien jeu)
				bool memeJeu = n != "" && string.Equals(n, nom, StringComparison.OrdinalIgnoreCase);
				if (id == "" && memeJeu) id = Texte(Membre(infos, "GameId"));
				if (jaquette == "" && memeJeu)
				{
					jaquette = Texte(Membre(infos, "GameBoxArt"));
					if (jaquette == "") jaquette = Texte(Membre(infos, "BoxArt"));
					if (jaquette == "") jaquette = Texte(Membre(infos, "GameBoxArtUrl"));
				}
			}
		}
	}

	object infosChaine;
	bool infosChaineLues;

	// Infos étendues de la chaîne (méthode Streamer.bot appelée par réflexion, une fois par exécution)
	object InfosChaine()
	{
		if (infosChaineLues) return infosChaine;
		infosChaineLues = true;
		try
		{
			string id = Arg("broadcastUserId");
			string login = Arg("broadcastUserName");
			if (login == "") login = Arg("broadcastUser");

			// Action lancée depuis le dock : on demande le compte diffuseur à Streamer.bot
			if (id == "" && login == "")
			{
				MethodInfo mb = CPH.GetType().GetMethod("TwitchGetBroadcaster", Type.EmptyTypes);
				object diffuseur = mb?.Invoke(CPH, null);
				id = Texte(Membre(diffuseur, "UserId"));
				login = Texte(Membre(diffuseur, "UserLogin"));
				if (login == "") login = Texte(Membre(diffuseur, "UserName"));
			}

			MethodInfo m = id != "" ? CPH.GetType().GetMethod("TwitchGetExtendedUserInfoById", new[] { typeof(string) }) : null;
			if (m != null) infosChaine = m.Invoke(CPH, new object[] { id });
			if (infosChaine == null && login != "")
			{
				MethodInfo ml = CPH.GetType().GetMethod("TwitchGetExtendedUserInfoByLogin", new[] { typeof(string) });
				if (ml != null) infosChaine = ml.Invoke(CPH, new object[] { login });
			}
		}
		catch (Exception e) { CPH.LogWarn("[Compteur de morts] Infos de la chaîne Twitch illisibles : " + e.Message); }
		return infosChaine;
	}

	// Écrit dans le log de Streamer.bot ce que l'action voit, pour comprendre une jaquette manquante
	void JournaliserSourcesJaquette(string nomJeu)
	{
		StringBuilder sb = new StringBuilder("[Compteur de morts] Aucune jaquette trouvée pour « " + nomJeu + " ». Arguments liés au jeu : ");
		bool vide = true;
		foreach (KeyValuePair<string, object> a in args)
		{
			string k = a.Key ?? "";
			string kl = k.ToLowerInvariant();
			bool interessant = kl.Contains("game") || kl.Contains("boxart") || kl.Contains("channel") || kl.Contains("category");
			if (!interessant) continue;
			string v = a.Value == null ? "null" : a.Value.ToString();
			if (v.Length > 120) v = v.Substring(0, 120) + "…";
			sb.Append(k).Append(" = ").Append(v).Append(" (").Append(a.Value == null ? "?" : a.Value.GetType().Name).Append(") ; ");
			vide = false;
		}
		if (vide) sb.Append("aucun");
		object infos = InfosChaine();
		if (infos != null)
		{
			sb.Append(" | Infos chaîne (").Append(infos.GetType().Name).Append(") : ");
			foreach (PropertyInfo p in infos.GetType().GetProperties())
			{
				string pl = p.Name.ToLowerInvariant();
				if (pl.Contains("game") || pl.Contains("art")) sb.Append(p.Name).Append(" = ").Append(Texte(Membre(infos, p.Name))).Append(" ; ");
			}
		}
		CPH.LogInfo(sb.ToString());
	}

	string PremierArg(params string[] noms)
	{
		foreach (string n in noms)
		{
			string v = Arg(n).Trim();
			if (v != "") return v;
		}
		return "";
	}

	static string Texte(object v) => v == null ? "" : v.ToString().Trim();

	// Lit un membre d'un objet quelconque (dictionnaire, JSON, propriété ou champ), sans tenir compte de la casse
	static object Membre(object obj, string nom)
	{
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
			JObject jo = obj as JObject;
			if (jo != null)
			{
				JToken t = jo.GetValue(nom, StringComparison.OrdinalIgnoreCase);
				return t == null ? null : t.ToString();
			}
			BindingFlags f = BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase;
			PropertyInfo p = obj.GetType().GetProperty(nom, f);
			if (p != null && p.GetIndexParameters().Length == 0) return p.GetValue(obj);
			FieldInfo fi = obj.GetType().GetField(nom, f);
			return fi?.GetValue(obj);
		}
		catch (Exception) { return null; }
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
			string url = "https://api.twitch.tv/helix/games?" + (id != "" ? "id=" + EncoderURL(id) : "name=" + EncoderURL(nom));

			string reponse = TelechargerTexte(url, clientId, token, 4000);
			if (string.IsNullOrEmpty(reponse)) return;

			JObject json = JObject.Parse(reponse);
			JArray liste = json["data"] as JArray;
			if (liste != null && liste.Count > 0)
			{
				jeu["twitchId"] = liste[0].Value<string>("id");
				jeu["boxArt"] = liste[0].Value<string>("box_art_url"); // modèle avec {width}x{height}
			}
		}
		catch (Exception e)
		{
			CPH.LogWarn("[Compteur de morts] Jaquette introuvable pour " + nom + " : " + e.Message);
		}
	}

	// Requête HTTP sans référence directe aux bibliothèques réseau (Streamer.bot ne les
	// expose pas au code C#) : WebClient ou HttpClient sont retrouvés par réflexion
	// parmi les bibliothèques déjà chargées par Streamer.bot.
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
		// 1) HttpClient (présent dans toutes les versions récentes de .NET)
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

		// 2) WebClient (anciennes versions)
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

	// Encodage d'URL (équivalent de Uri.EscapeDataString, sans System.dll)
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
