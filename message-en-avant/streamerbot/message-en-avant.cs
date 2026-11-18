// =====================================================================
//  Message en avant | Gérer : action Streamer.bot (sous-action « Execute C# Code »)
//  Gère le message affiché sur l'overlay, la liste des questions Q&A, l'historique
//  des highlights, la file d'attente et les demandes de perle Discord.
//  L'état est gardé dans une variable globale persistante (JSON), lue par
//  l'overlay et le dock.
//
//  Aucun déclencheur à ajouter : l'overlay et le dock écoutent eux-mêmes les rachats
//  de points de chaîne et les messages du chat, puis appellent cette action.
//  Plusieurs pages peuvent envoyer le même événement : les doublons sont ignorés (msgId).
//
//  Arguments acceptés :
//    mode : config | qa | highlight | show | hide | expire | remove | clear | perle | perleClaim | perleDone | reset
//    config : JSON des réglages publiés par l'overlay (mode config)
//    item   : JSON du message (modes qa et highlight)
//    msgId  : identifiant de l'événement (anti-doublon)
//    id     : identifiant d'un message (modes show, expire, remove, perle)
//    list   : qa | highlights (mode clear)
//    n, by, ok, error : suivi d'une perle (modes perleClaim et perleDone)
// =====================================================================
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
	// ---------- À personnaliser ----------
	const string VARIABLE = "messageEnAvant";   // même nom que dans l'overlay et le dock
	const int MAX_QUESTIONS = 200;
	const int MAX_HIGHLIGHTS = 100;
	// -------------------------------------

	static readonly object verrou = new object();
	static readonly Dictionary<string, bool> evenementsTraites = new Dictionary<string, bool>();
	static readonly List<string> ordreEvenements = new List<string>();

	public bool Execute()
	{
		string msgId = Arg("msgId").Trim();
		lock (verrou)
		{
			if (msgId != "")
			{
				if (evenementsTraites.ContainsKey(msgId)) return true; // doublon ignoré
				evenementsTraites[msgId] = true;
				ordreEvenements.Add(msgId);
				while (ordreEvenements.Count > 500) { evenementsTraites.Remove(ordreEvenements[0]); ordreEvenements.RemoveAt(0); }
			}
			try { return Executer(); }
			catch (Exception e)
			{
				CPH.LogError("[Message en avant] " + e.Message + "\n" + e.StackTrace);
				return false;
			}
		}
	}

	bool Executer()
	{
		string mode = Arg("mode").Trim().ToLowerInvariant();
		JObject data = Charger();
		JObject cfg = (JObject)data["config"];

		switch (mode)
		{
			case "config":
			{
				JObject partiel = null;
				try { partiel = JObject.Parse(Arg("config")); } catch (Exception) { }
				if (partiel != null)
					foreach (JProperty p in partiel.Properties())
						if (ConfigParDefaut()[p.Name] != null) cfg[p.Name] = p.Value;
				Sauver(data, "config");
				return true;
			}
			case "qa":
			{
				if (!cfg.Value<bool>("qa")) return true;
				JObject item = LireMessage("qa");
				if (item == null) return false;
				Ajouter((JArray)data["qa"], item, MAX_QUESTIONS);
				Sauver(data, "qa");
				return true;
			}
			case "highlight":
			{
				if (!cfg.Value<bool>("highlight")) return true;
				JObject item = LireMessage("highlight");
				if (item == null) return false;
				Ajouter((JArray)data["highlights"], item, MAX_HIGHLIGHTS);
				ArriveeHighlight(data, cfg, item);
				Sauver(data, "highlight");
				return true;
			}
			case "show":
			{
				JObject item = Trouver(data, Arg("id"));
				if (item == null) return false;
				data["resume"] = null;
				RetirerDeLaFile(data, item.Value<string>("id"));
				Afficher(data, cfg, item);
				Sauver(data, "show");
				return true;
			}
			case "hide":
			{
				// Masquer à la main : pas de retour à la question, la file d'attente continue
				data["resume"] = null;
				Suivant(data, cfg);
				Sauver(data, "hide");
				return true;
			}
			case "expire":
			{
				JObject cur = data["current"] as JObject;
				if (cur == null || cur.Value<string>("id") != Arg("id")) return true;
				long fin = cur.Value<long?>("until") ?? 0;
				if (fin == 0 || Maintenant() < fin - 1500) return true; // trop tôt (horloge d'une autre page)
				Suivant(data, cfg);
				Sauver(data, "expire");
				return true;
			}
			case "remove":
			{
				string id = Arg("id");
				Retirer((JArray)data["qa"], id);
				Retirer((JArray)data["highlights"], id);
				RetirerDeLaFile(data, id);
				if (data.Value<string>("resume") == id) data["resume"] = null;
				JObject cur = data["current"] as JObject;
				if (cur != null && cur.Value<string>("id") == id) Suivant(data, cfg);
				Sauver(data, "remove");
				return true;
			}
			case "clear":
			{
				string liste = Arg("list") == "highlights" ? "highlights" : "qa";
				data[liste] = new JArray();
				JArray file = (JArray)data["queue"];
				for (int i = file.Count - 1; i >= 0; i--)
					if (Trouver(data, file[i].ToString()) == null) file.RemoveAt(i);
				Sauver(data, "clear");
				return true;
			}
			case "perle":
			{
				JObject item = Trouver(data, Arg("id"));
				if (item == null) return false;
				JObject perle = data["perle"] as JObject ?? new JObject();
				long n = (perle.Value<long?>("n") ?? 0) + 1;
				data["perle"] = new JObject
				{
					["n"] = n, ["id"] = item.Value<string>("id"), ["item"] = item.DeepClone(),
					["status"] = "pending", ["at"] = Maintenant()
				};
				Sauver(data, "perle");
				return true;
			}
			case "perleclaim":
			{
				JObject perle = data["perle"] as JObject;
				if (perle == null || perle.Value<string>("status") != "pending" || perle.Value<long>("n").ToString() != Arg("n")) return true;
				perle["status"] = "claimed";
				perle["by"] = Arg("by");
				perle["claimedAt"] = Maintenant();
				Sauver(data, "perle");
				return true;
			}
			case "perledone":
			{
				JObject perle = data["perle"] as JObject;
				if (perle == null || perle.Value<long>("n").ToString() != Arg("n")) return true;
				bool ok = Arg("ok") == "true";
				perle["status"] = ok ? "ok" : "error";
				perle["error"] = ok ? "" : Arg("error");
				perle["doneAt"] = Maintenant();
				perle.Remove("item");
				Sauver(data, "perle");
				return true;
			}
			case "reset":
			{
				JObject neuf = Nouveau();
				neuf["config"] = cfg;
				Sauver(neuf, "reset");
				return true;
			}
		}
		CPH.LogWarn("[Message en avant] Mode inconnu : « " + mode + " »");
		return false;
	}

	// ---------- Affichage ----------

	// Highlight reçu pendant qu'un autre message est affiché : selon les réglages de l'overlay
	void ArriveeHighlight(JObject data, JObject cfg, JObject item)
	{
		JObject cur = data["current"] as JObject;
		string id = item.Value<string>("id");
		if (cur == null) { Afficher(data, cfg, item); return; }
		if (cur.Value<string>("kind") == "qa")
		{
			string conflit = cfg.Value<string>("conflict") ?? "return";
			if (conflit == "wait") { MettreEnFile(data, id); return; }
			if (conflit == "return") data["resume"] = cur.Value<string>("id");
			Afficher(data, cfg, item);
			return;
		}
		if ((cfg.Value<string>("queue") ?? "queue") == "replace") Afficher(data, cfg, item);
		else MettreEnFile(data, id);
	}

	void Afficher(JObject data, JObject cfg, JObject item)
	{
		JObject copie = (JObject)item.DeepClone();
		long maintenant = Maintenant();
		copie["shownAt"] = maintenant;
		if (copie.Value<string>("kind") == "highlight")
		{
			double duree = cfg.Value<double?>("highlightDuration") ?? 15;
			if (duree < 3) duree = 3;
			copie["until"] = maintenant + (long)(duree * 1000);
		}
		else copie.Remove("until");
		data["current"] = copie;
		item["shown"] = true;
	}

	// Fin du message affiché : prochain highlight en attente, sinon retour à la question, sinon rien
	void Suivant(JObject data, JObject cfg)
	{
		JArray file = (JArray)data["queue"];
		while (file.Count > 0)
		{
			string id = file[0].ToString();
			file.RemoveAt(0);
			JObject suivant = Trouver(data, id);
			if (suivant != null) { Afficher(data, cfg, suivant); return; }
		}
		string reprise = data.Value<string>("resume");
		data["resume"] = null;
		JObject question = string.IsNullOrEmpty(reprise) ? null : Trouver(data, reprise);
		if (question != null) { Afficher(data, cfg, question); return; }
		data["current"] = null;
	}

	void MettreEnFile(JObject data, string id)
	{
		JArray file = (JArray)data["queue"];
		foreach (JToken t in file) if (t.ToString() == id) return;
		file.Add(id);
	}

	void RetirerDeLaFile(JObject data, string id)
	{
		JArray file = (JArray)data["queue"];
		for (int i = file.Count - 1; i >= 0; i--) if (file[i].ToString() == id) file.RemoveAt(i);
	}

	// ---------- Listes ----------

	JObject LireMessage(string kind)
	{
		JObject item = null;
		try { item = JObject.Parse(Arg("item")); } catch (Exception) { }
		if (item == null || string.IsNullOrEmpty(item.Value<string>("id"))) return null;
		item["kind"] = kind;
		item["shown"] = false;
		item.Remove("until");
		if (item.Value<long?>("at") == null) item["at"] = Maintenant();
		// Taille raisonnable (le texte d'un message Twitch fait 500 caractères au plus)
		string texte = item.Value<string>("text") ?? "";
		if (texte.Length > 600) item["text"] = texte.Substring(0, 600);
		JArray morceaux = item["parts"] as JArray;
		if (morceaux != null) while (morceaux.Count > 200) morceaux.RemoveAt(morceaux.Count - 1);
		return item;
	}

	void Ajouter(JArray liste, JObject item, int max)
	{
		Retirer(liste, item.Value<string>("id"));
		liste.Insert(0, item);
		while (liste.Count > max) liste.RemoveAt(liste.Count - 1);
	}

	void Retirer(JArray liste, string id)
	{
		for (int i = liste.Count - 1; i >= 0; i--)
			if ((liste[i] as JObject) != null && liste[i].Value<string>("id") == id) liste.RemoveAt(i);
	}

	JObject Trouver(JObject data, string id)
	{
		if (string.IsNullOrEmpty(id)) return null;
		foreach (string nom in new[] { "qa", "highlights" })
			foreach (JToken t in (JArray)data[nom])
				if (t is JObject && t.Value<string>("id") == id) return (JObject)t;
		return null;
	}

	// ---------- Variable ----------

	JObject ConfigParDefaut()
	{
		return new JObject
		{
			["qa"] = true, ["rewardName"] = "Q&A", ["highlight"] = true, ["command"] = "!highlight",
			["highlightDuration"] = 15, ["conflict"] = "return", ["queue"] = "queue", ["perles"] = false
		};
	}

	JObject Nouveau()
	{
		return new JObject
		{
			["version"] = 1, ["updated"] = 0, ["config"] = ConfigParDefaut(), ["current"] = null,
			["qa"] = new JArray(), ["highlights"] = new JArray(), ["queue"] = new JArray(),
			["resume"] = null, ["perle"] = new JObject { ["n"] = 0 }
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
		catch (Exception e) { CPH.LogWarn("[Message en avant] Variable illisible, elle sera recréée : " + e.Message); }
		JObject neuf = Nouveau();
		if (data == null) return neuf;
		foreach (JProperty p in neuf.Properties()) if (data[p.Name] == null) data[p.Name] = p.Value;
		if (!(data["config"] is JObject)) data["config"] = ConfigParDefaut();
		JObject cfg = (JObject)data["config"];
		foreach (JProperty p in ConfigParDefaut().Properties()) if (cfg[p.Name] == null) cfg[p.Name] = p.Value;
		foreach (string nom in new[] { "qa", "highlights", "queue" }) if (!(data[nom] is JArray)) data[nom] = new JArray();
		if (!(data["perle"] is JObject)) data["perle"] = new JObject { ["n"] = 0 };
		return data;
	}

	void Sauver(JObject data, string evenement)
	{
		data["updated"] = Maintenant();
		CPH.SetGlobalVar(VARIABLE, data.ToString(Formatting.None), true);
		// Prévient l'overlay et le dock (en plus de l'événement « Global Variable Updated »)
		try
		{
			JObject msg = new JObject { ["source"] = "message-en-avant", ["event"] = evenement, ["variable"] = VARIABLE, ["data"] = data };
			CPH.WebsocketBroadcastJson(msg.ToString(Formatting.None));
		}
		catch (Exception) { }
	}

	static long Maintenant() => (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;

	string Arg(string nom)
	{
		object v;
		return args.TryGetValue(nom, out v) && v != null ? v.ToString() : "";
	}
}
