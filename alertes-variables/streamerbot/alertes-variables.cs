// =====================================================================
//  Alertes variables | Moteur : action Streamer.bot (sous-action « Execute C# Code »)
//  Aucun déclencheur à ajouter : l'overlay et le dock appellent cette action.
//
//  Elle lit le dossier source des alertes sur le PC, garde l'état partagé
//  (son coupé, scénario forcé) et renvoie le titre et la catégorie du live.
//
//  Argument « mode » :
//    etat            état complet (dossier, sous-dossiers et fichiers, son, titre, catégorie)
//    actualiser      idem, en demandant aux overlays de relire les fichiers
//    choisirDossier  ouvre la fenêtre Windows de choix du dossier source
//    definirDossier  chemin du dossier dans l'argument « chemin »
//    fichier         envoie un fichier (« dossier », « fichier », « requestId »)
//    mute / unmute   coupe ou réactive les sons (« user », « plateforme », « annonce », « message », « msgId »)
//    forcer          force un scénario (« scenario », vide = automatique)
//    tester          joue une alerte de test dans les overlays (« type »)
//    passer          termine l'alerte en cours
//    rapport         compte rendu de l'overlay pour le dock (« rapport », JSON)
//
//  Les réponses sont envoyées à l'overlay et au dock par WebSocket (General.Custom,
//  source « alertesVariables »).
// =====================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public class CPHInline
{
	// ---------- À personnaliser ----------
	const string VAR_DOSSIER = "alertesVariablesDossier"; // variables globales persistantes
	const string VAR_MUTE = "alertesVariablesMute";
	const string VAR_FORCE = "alertesVariablesForce";
	const string VAR_RAPPORT = "alertesVariablesRapport"; // non persistante
	const long TAILLE_MAX = 25L * 1024 * 1024;           // 25 Mo par fichier
	// -------------------------------------

	static readonly object verrou = new object();
	static readonly Dictionary<string, bool> messagesTraites = new Dictionary<string, bool>();
	static readonly List<string> ordreMessages = new List<string>(); // (Queue<T> n'est pas disponible dans Streamer.bot)

	// Titre et catégorie gardés quelques secondes (évite d'interroger Twitch à chaque appel)
	static string titreCache = "", categorieCache = "";
	static DateTime cacheDate = DateTime.MinValue;

	static readonly string[] EXTENSIONS = { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".apng", ".svg", ".webm", ".mp4", ".mp3", ".ogg", ".wav", ".m4a" };

	public bool Execute()
	{
		string mode = Arg("mode").Trim().ToLowerInvariant();
		try
		{
			switch (mode)
			{
				case "":
				case "etat": EnvoyerEtat(false); return true;
				case "actualiser": cacheDate = DateTime.MinValue; EnvoyerEtat(true); return true;
				case "choisirdossier": ChoisirDossier(); return true;
				case "definirdossier": DefinirDossier(Arg("chemin")); return true;
				case "fichier": EnvoyerFichier(); return true;
				case "mute": return Muet(true);
				case "unmute": return Muet(false);
				case "forcer":
					CPH.SetGlobalVar(VAR_FORCE, Arg("scenario").Trim(), true);
					EnvoyerEtat(false);
					return true;
				case "tester":
					Diffuser(new Dictionary<string, object> { { "kind", "test" }, { "type", Arg("type").Trim().ToLowerInvariant() } });
					return true;
				case "passer":
					Diffuser(new Dictionary<string, object> { { "kind", "passer" } });
					return true;
				case "rapport":
					CPH.SetGlobalVar(VAR_RAPPORT, Arg("rapport"), false);
					Diffuser(new Dictionary<string, object> { { "kind", "rapport" }, { "rapport", new JsonBrut(RapportValide(Arg("rapport"))) } });
					return true;
				default:
					CPH.LogWarn("[Alertes variables] Mode inconnu : " + mode);
					return false;
			}
		}
		catch (Exception e)
		{
			CPH.LogWarn("[Alertes variables] " + mode + " : " + e.Message);
			Erreur(e.Message);
			return false;
		}
	}

	// ---------- État ----------

	void EnvoyerEtat(bool vider)
	{
		string dossier = Dossier();
		bool existe = dossier != "" && Directory.Exists(dossier);

		Dictionary<string, object> sousDossiers = new Dictionary<string, object>();
		if (existe)
		{
			foreach (string d in Directory.GetDirectories(dossier))
			{
				List<object> fichiers = new List<object>();
				foreach (string f in Directory.GetFiles(d))
				{
					string ext = Path.GetExtension(f).ToLowerInvariant();
					if (Array.IndexOf(EXTENSIONS, ext) >= 0) fichiers.Add(Path.GetFileName(f));
					if (fichiers.Count >= 300) break;
				}
				sousDossiers[Path.GetFileName(d)] = fichiers;
			}
		}

		string titre, categorie;
		InfosLive(out titre, out categorie);

		Diffuser(new Dictionary<string, object>
		{
			{ "kind", "etat" },
			{ "vider", vider },
			{ "dossier", dossier },
			{ "dossierExiste", existe },
			{ "dossiers", sousDossiers },
			{ "mute", Mute() },
			{ "force", LireTexte(VAR_FORCE, true) },
			{ "titre", titre },
			{ "categorie", categorie },
			{ "rapport", new JsonBrut(RapportValide(LireTexte(VAR_RAPPORT, false))) }
		});
	}

	string Dossier() => LireTexte(VAR_DOSSIER, true).Trim();

	bool Mute() => LireTexte(VAR_MUTE, true).Trim().ToLowerInvariant() == "true";

	// ---------- Dossier source ----------

	void DefinirDossier(string chemin)
	{
		chemin = (chemin ?? "").Trim().Trim('"');
		if (chemin != "" && !Directory.Exists(chemin))
		{
			Erreur("Dossier introuvable : " + chemin);
			return;
		}
		CPH.SetGlobalVar(VAR_DOSSIER, chemin, true);
		string relu = Dossier();
		if (relu != chemin)
			CPH.LogWarn("[Alertes variables] Le dossier n’a pas été enregistré (relu : « " + relu + " »)");
		else
			CPH.LogInfo("[Alertes variables] Dossier source enregistré : " + chemin);
		EnvoyerEtat(true);
	}

	// Fenêtre Windows de choix du dossier (WinForms chargé par réflexion, dans un thread STA)
	void ChoisirDossier()
	{
		string choisi = null;
		string erreur = null;
		string depart = Dossier();

		Thread t = new Thread(() =>
		{
			try
			{
				// 1) Fenêtre moderne de l'Explorateur Windows (la même que Chrome, l'Explorateur…)
				string moderne = ChoisirDossierModerne(depart);
				if (moderne != null) { choisi = moderne == "" ? null : moderne; return; }

				// 2) Fenêtre WPF « OpenFolderDialog » (.NET 8)
				string wpf = ChoisirDossierWpf(depart);
				if (wpf != null) { choisi = wpf == "" ? null : wpf; return; }

				// 3) Ancienne fenêtre WinForms « FolderBrowserDialog »
				Assembly wf = ChargerAssembly("System.Windows.Forms",
					"System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089");
				if (wf == null) throw new Exception("System.Windows.Forms indisponible");
				Type typeDialogue = wf.GetType("System.Windows.Forms.FolderBrowserDialog", true);
				Type typeForm = wf.GetType("System.Windows.Forms.Form", true);
				Type typeOwner = wf.GetType("System.Windows.Forms.IWin32Window", true);

				object form = Activator.CreateInstance(typeForm);
				typeForm.GetProperty("TopMost").SetValue(form, true);
				typeForm.GetProperty("ShowInTaskbar").SetValue(form, false);
				typeForm.GetProperty("Opacity").SetValue(form, 0.0);
				typeForm.GetMethod("Show", Type.EmptyTypes).Invoke(form, null);
				typeForm.GetMethod("Activate").Invoke(form, null);

				object dialogue = Activator.CreateInstance(typeDialogue);
				typeDialogue.GetProperty("Description").SetValue(dialogue, "Dossier source des Alertes variables (un sous-dossier par scénario)");
				PropertyInfo nouveau = typeDialogue.GetProperty("ShowNewFolderButton");
				if (nouveau != null) nouveau.SetValue(dialogue, true);
				if (depart != "" && Directory.Exists(depart)) typeDialogue.GetProperty("SelectedPath").SetValue(dialogue, depart);

				object resultat = typeDialogue.GetMethod("ShowDialog", new[] { typeOwner }).Invoke(dialogue, new[] { form });
				if (resultat != null && resultat.ToString() == "OK")
					choisi = (string)typeDialogue.GetProperty("SelectedPath").GetValue(dialogue);

				(dialogue as IDisposable)?.Dispose();
				typeForm.GetMethod("Close").Invoke(form, null);
				(form as IDisposable)?.Dispose();
			}
			catch (Exception e)
			{
				erreur = (e.InnerException ?? e).Message;
			}
		});
		t.SetApartmentState(ApartmentState.STA);
		t.IsBackground = true;
		t.Start();
		t.Join(TimeSpan.FromMinutes(10));

		if (erreur != null)
		{
			CPH.LogWarn("[Alertes variables] Fenêtre de choix impossible : " + erreur);
			Erreur("La fenêtre de choix du dossier n’a pas pu s’ouvrir. Collez le chemin du dossier dans le dock.");
			return;
		}
		if (string.IsNullOrEmpty(choisi)) { CPH.LogInfo("[Alertes variables] Choix du dossier annulé"); EnvoyerEtat(false); return; }
		CPH.SetGlobalVar(VAR_DOSSIER, choisi, true);
		string relu = Dossier();
		if (relu != choisi.Trim())
			CPH.LogWarn("[Alertes variables] Le dossier n’a pas été enregistré (variable « " + VAR_DOSSIER + " » : « " + relu + " »)");
		else
			CPH.LogInfo("[Alertes variables] Dossier source enregistré : " + choisi);
		EnvoyerEtat(true);
	}

	// ---------- Fenêtre moderne de choix de dossier (COM IFileOpenDialog, mode dossier) ----------

	[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
	class FileOpenDialogCom { }

	[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IShellItem
	{
		void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
		void GetParent(out IShellItem ppsi);
		void GetDisplayName(uint sigdnName, out IntPtr ppszName);
		void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
		void Compare(IShellItem psi, uint hint, out int piOrder);
	}

	[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
	interface IFileDialog
	{
		[PreserveSig] int Show(IntPtr parent);
		void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
		void SetFileTypeIndex(uint iFileType);
		void GetFileTypeIndex(out uint piFileType);
		void Advise(IntPtr pfde, out uint pdwCookie);
		void Unadvise(uint dwCookie);
		void SetOptions(uint fos);
		void GetOptions(out uint pfos);
		void SetDefaultFolder(IShellItem psi);
		void SetFolder(IShellItem psi);
		void GetFolder(out IShellItem ppsi);
		void GetCurrentSelection(out IShellItem ppsi);
		void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
		void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
		void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
		void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
		void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
		void GetResult(out IShellItem ppsi);
		void AddPlace(IShellItem psi, int fdap);
		void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
		void Close(int hr);
		void SetClientGuid(ref Guid guid);
		void ClearClientData();
		void SetFilter(IntPtr pFilter);
	}

	[DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
	static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [In] ref Guid riid, out IShellItem ppv);

	[DllImport("user32.dll")]
	static extern IntPtr GetForegroundWindow();

	// Chemin choisi, "" si annulé, null si la fenêtre n'est pas disponible
	static string ChoisirDossierModerne(string depart)
	{
		IFileDialog dialogue;
		try { dialogue = (IFileDialog)new FileOpenDialogCom(); }
		catch (Exception) { return null; }
		try
		{
			const uint FOS_PICKFOLDERS = 0x20, FOS_FORCEFILESYSTEM = 0x40, FOS_PATHMUSTEXIST = 0x800;
			uint options;
			dialogue.GetOptions(out options);
			dialogue.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST);
			dialogue.SetTitle("Dossier source des Alertes variables (celui qui contient « defaut »)");
			dialogue.SetOkButtonLabel("Choisir ce dossier");
			if (depart != "" && Directory.Exists(depart))
			{
				try
				{
					Guid iidShellItem = typeof(IShellItem).GUID;
					IShellItem dossier;
					SHCreateItemFromParsingName(depart, IntPtr.Zero, ref iidShellItem, out dossier);
					dialogue.SetFolder(dossier);
				}
				catch (Exception) { }
			}

			int hr = dialogue.Show(GetForegroundWindow());
			if (hr != 0) return ""; // annulé (ou fermé)

			IShellItem resultat;
			dialogue.GetResult(out resultat);
			IntPtr ptr;
			resultat.GetDisplayName(0x80058000, out ptr); // SIGDN_FILESYSPATH
			string chemin = Marshal.PtrToStringUni(ptr);
			Marshal.FreeCoTaskMem(ptr);
			return chemin ?? "";
		}
		catch (Exception) { return null; }
		finally { Marshal.ReleaseComObject(dialogue); }
	}

	// Charge une bibliothèque par son nom court, puis par son nom complet (null si absente)
	static Assembly ChargerAssembly(params string[] noms)
	{
		foreach (Assembly deja in AppDomain.CurrentDomain.GetAssemblies())
			foreach (string n in noms)
				if (deja.GetName().Name == n.Split(',')[0].Trim()) return deja;
		foreach (string n in noms)
		{
			try { return Assembly.Load(n); } catch (Exception) { }
		}
		return null;
	}

	// Fenêtre WPF (Microsoft.Win32.OpenFolderDialog) : chemin choisi, "" si annulé, null si indisponible
	static string ChoisirDossierWpf(string depart)
	{
		Assembly pf = ChargerAssembly("PresentationFramework");
		Type type = pf?.GetType("Microsoft.Win32.OpenFolderDialog", false);
		if (type == null) return null;
		object dialogue = Activator.CreateInstance(type);
		type.GetProperty("Title")?.SetValue(dialogue, "Dossier source des Alertes variables (un sous-dossier par scénario)");
		if (depart != "" && Directory.Exists(depart)) type.GetProperty("InitialDirectory")?.SetValue(dialogue, depart);
		object ok = type.GetMethod("ShowDialog", Type.EmptyTypes).Invoke(dialogue, null);
		if (ok is bool && (bool)ok) return (string)type.GetProperty("FolderName").GetValue(dialogue) ?? "";
		return "";
	}

	// ---------- Fichiers ----------

	void EnvoyerFichier()
	{
		string sousDossier = Arg("dossier").Trim();
		string fichier = Arg("fichier").Trim();
		string requestId = Arg("requestId");
		Dictionary<string, object> rep = new Dictionary<string, object>
		{
			{ "kind", "fichier" }, { "requestId", requestId }, { "dossier", sousDossier }, { "fichier", fichier }
		};

		string racine = Dossier();
		if (racine == "" || !Directory.Exists(racine)) { rep["erreur"] = "Dossier source non défini"; Diffuser(rep); return; }

		// Sécurité : le fichier doit rester dans le dossier source
		string baseComplete = Path.GetFullPath(racine).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
		string chemin = Path.GetFullPath(Path.Combine(racine, sousDossier, fichier));
		string ext = Path.GetExtension(chemin).ToLowerInvariant();
		if (!chemin.StartsWith(baseComplete, StringComparison.OrdinalIgnoreCase) || Array.IndexOf(EXTENSIONS, ext) < 0)
		{
			rep["erreur"] = "Fichier refusé"; Diffuser(rep); return;
		}
		if (!File.Exists(chemin)) { rep["erreur"] = "Fichier introuvable"; Diffuser(rep); return; }

		FileInfo info = new FileInfo(chemin);
		if (info.Length > TAILLE_MAX)
		{
			rep["erreur"] = "Fichier trop lourd (" + (info.Length / 1048576) + " Mo, maximum " + (TAILLE_MAX / 1048576) + " Mo)";
			Diffuser(rep);
			return;
		}

		rep["dataUri"] = "data:" + TypeMime(ext) + ";base64," + Convert.ToBase64String(File.ReadAllBytes(chemin));
		Diffuser(rep);
	}

	static string TypeMime(string ext)
	{
		switch (ext)
		{
			case ".png": return "image/png";
			case ".jpg": case ".jpeg": return "image/jpeg";
			case ".gif": return "image/gif";
			case ".webp": return "image/webp";
			case ".apng": return "image/apng";
			case ".svg": return "image/svg+xml";
			case ".webm": return "video/webm";
			case ".mp4": return "video/mp4";
			case ".mp3": return "audio/mpeg";
			case ".ogg": return "audio/ogg";
			case ".wav": return "audio/wav";
			case ".m4a": return "audio/mp4";
			default: return "application/octet-stream";
		}
	}

	// ---------- Son coupé ----------

	bool Muet(bool couper)
	{
		// Une même commande peut arriver de plusieurs overlays (plusieurs scènes OBS) : une seule compte
		string msgId = Arg("msgId").Trim();
		if (msgId != "")
		{
			lock (verrou)
			{
				if (messagesTraites.ContainsKey(msgId)) return true;
				messagesTraites[msgId] = true;
				ordreMessages.Add(msgId);
				while (ordreMessages.Count > 200) { messagesTraites.Remove(ordreMessages[0]); ordreMessages.RemoveAt(0); }
			}
		}

		CPH.SetGlobalVar(VAR_MUTE, couper ? "true" : "false", true);

		if (Arg("annonce").Trim().ToLowerInvariant() == "true")
		{
			string message = Arg("message");
			string qui = Arg("user").Trim();
			if (qui == "") qui = Arg("broadcastUser").Trim();
			if (qui == "") qui = "la régie";
			message = message.Replace("{user}", qui).Trim();
			if (message != "") EnvoyerChat(message, Arg("plateforme").Trim().ToLowerInvariant());
		}

		EnvoyerEtat(false);
		return true;
	}

	void EnvoyerChat(string message, string plateforme)
	{
		try
		{
			if (plateforme == "kick" && Appeler("SendKickMessage", message)) return;
			if (plateforme == "youtube" && (Appeler("SendYouTubeMessageToLatestMonitored", message) || Appeler("SendYouTubeMessage", message))) return;
			CPH.SendMessage(message, true);
		}
		catch (Exception e) { CPH.LogWarn("[Alertes variables] Message du bot impossible : " + e.Message); }
	}

	// Appelle une méthode de CPH si elle existe dans cette version de Streamer.bot
	bool Appeler(string nom, string message)
	{
		foreach (MethodInfo m in CPH.GetType().GetMethods())
		{
			if (m.Name != nom) continue;
			ParameterInfo[] p = m.GetParameters();
			if (p.Length == 0 || p[0].ParameterType != typeof(string)) continue;
			object[] valeurs = new object[p.Length];
			valeurs[0] = message;
			for (int i = 1; i < p.Length; i++)
				valeurs[i] = p[i].HasDefaultValue ? p[i].DefaultValue : (p[i].ParameterType == typeof(bool) ? (object)true : null);
			m.Invoke(CPH, valeurs);
			return true;
		}
		return false;
	}

	// ---------- Titre et catégorie (Twitch) ----------

	void InfosLive(out string titre, out string categorie)
	{
		// Valeurs transmises par l'overlay (événement Stream Update) : prioritaires et mémorisées
		string titreArg = Arg("title").Trim(), categorieArg = Arg("gameName").Trim();
		if (titreArg != "" || categorieArg != "")
		{
			if (titreArg != "") titreCache = titreArg;
			if (categorieArg != "") categorieCache = categorieArg;
			cacheDate = DateTime.UtcNow;
		}
		if ((DateTime.UtcNow - cacheDate).TotalSeconds < 10)
		{
			titre = titreCache; categorie = categorieCache;
			return;
		}
		titre = ""; categorie = "";
		try
		{
			string id = Arg("broadcastUserId").Trim();
			if (id == "")
			{
				MethodInfo mb = CPH.GetType().GetMethod("TwitchGetBroadcaster", Type.EmptyTypes);
				object diffuseur = mb?.Invoke(CPH, null);
				id = Texte(Membre(diffuseur, "UserId"));
			}
			string token = Propriete(CPH, "TwitchOAuthToken");
			string clientId = Propriete(CPH, "TwitchClientId");
			if (id != "" && token != "" && clientId != "")
			{
				string json = TelechargerTexte("https://api.twitch.tv/helix/channels?broadcaster_id=" + id, clientId, token, 4000);
				titre = ValeurJson(json, "title");
				categorie = ValeurJson(json, "game_name");
			}
		}
		catch (Exception e) { CPH.LogWarn("[Alertes variables] Titre et catégorie illisibles : " + e.Message); }

		// Twitch injoignable : on garde les dernières valeurs connues
		if (titre == "") titre = titreCache;
		if (categorie == "") categorie = categorieCache;

		titreCache = titre; categorieCache = categorie; cacheDate = DateTime.UtcNow;
	}

	// Lit "cle": "valeur" dans une réponse JSON simple (premier résultat)
	static string ValeurJson(string json, string cle)
	{
		if (string.IsNullOrEmpty(json)) return "";
		int i = json.IndexOf("\"" + cle + "\"", StringComparison.Ordinal);
		if (i < 0) return "";
		i = json.IndexOf(':', i);
		if (i < 0) return "";
		i++;
		while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
		if (i >= json.Length || json[i] != '"') return "";
		StringBuilder sb = new StringBuilder();
		for (i++; i < json.Length; i++)
		{
			char c = json[i];
			if (c == '"') break;
			if (c == '\\' && i + 1 < json.Length)
			{
				char n = json[++i];
				switch (n)
				{
					case 'n': sb.Append('\n'); break;
					case 't': sb.Append('\t'); break;
					case 'r': break;
					case 'u':
						if (i + 4 < json.Length) { sb.Append((char)Convert.ToInt32(json.Substring(i + 1, 4), 16)); i += 4; }
						break;
					default: sb.Append(n); break;
				}
			}
			else sb.Append(c);
		}
		return sb.ToString();
	}

	// Requête HTTP par réflexion (Streamer.bot n'expose pas directement les bibliothèques réseau)
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
		return "";
	}

	// ---------- Envoi aux overlays et au dock ----------

	void Diffuser(Dictionary<string, object> donnees)
	{
		donnees["source"] = "alertesVariables";
		CPH.WebsocketBroadcastJson(Json(donnees));
	}

	void Erreur(string message)
	{
		try { Diffuser(new Dictionary<string, object> { { "kind", "erreur" }, { "message", message } }); } catch (Exception) { }
	}

	// Le rapport de l'overlay est réinséré tel quel : on vérifie seulement qu'il ressemble à un objet JSON
	static string RapportValide(string json)
	{
		json = (json ?? "").Trim();
		return json.StartsWith("{") && json.EndsWith("}") ? json : "null";
	}

	class JsonBrut
	{
		public readonly string Valeur;
		public JsonBrut(string v) { Valeur = v; }
	}

	// Petit sérialiseur JSON (dictionnaires, listes, textes, nombres, booléens)
	static string Json(object v)
	{
		StringBuilder sb = new StringBuilder();
		EcrireJson(sb, v);
		return sb.ToString();
	}

	static void EcrireJson(StringBuilder sb, object v)
	{
		if (v == null) { sb.Append("null"); return; }
		if (v is JsonBrut) { sb.Append(((JsonBrut)v).Valeur); return; }
		if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
		if (v is string) { EcrireTexte(sb, (string)v); return; }
		if (v is int || v is long || v is double || v is float)
		{
			sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture));
			return;
		}
		IDictionary d = v as IDictionary;
		if (d != null)
		{
			sb.Append('{');
			bool premier = true;
			foreach (DictionaryEntry e in d)
			{
				if (!premier) sb.Append(',');
				premier = false;
				EcrireTexte(sb, Convert.ToString(e.Key));
				sb.Append(':');
				EcrireJson(sb, e.Value);
			}
			sb.Append('}');
			return;
		}
		IEnumerable l = v as IEnumerable;
		if (l != null)
		{
			sb.Append('[');
			bool premier = true;
			foreach (object o in l)
			{
				if (!premier) sb.Append(',');
				premier = false;
				EcrireJson(sb, o);
			}
			sb.Append(']');
			return;
		}
		EcrireTexte(sb, v.ToString());
	}

	static void EcrireTexte(StringBuilder sb, string s)
	{
		sb.Append('"');
		foreach (char c in s)
		{
			switch (c)
			{
				case '"': sb.Append("\\\""); break;
				case '\\': sb.Append("\\\\"); break;
				case '\n': sb.Append("\\n"); break;
				case '\r': sb.Append("\\r"); break;
				case '\t': sb.Append("\\t"); break;
				default:
					if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
					else sb.Append(c);
					break;
			}
		}
		sb.Append('"');
	}

	// ---------- Outils ----------

	// Lit une variable globale texte (en string d'abord, puis en object selon la version de Streamer.bot)
	string LireTexte(string nom, bool persistante)
	{
		try
		{
			string t = CPH.GetGlobalVar<string>(nom, persistante);
			if (!string.IsNullOrEmpty(t)) return t;
		}
		catch (Exception) { }
		try
		{
			object v = CPH.GetGlobalVar<object>(nom, persistante);
			return v == null ? "" : v.ToString();
		}
		catch (Exception) { return ""; }
	}

	static string Texte(object v) => v == null ? "" : v.ToString().Trim();

	static string Propriete(object obj, string nom)
	{
		if (obj == null) return "";
		PropertyInfo p = obj.GetType().GetProperty(nom);
		object v = p?.GetValue(obj);
		return v == null ? "" : v.ToString();
	}

	static object Membre(object obj, string nom)
	{
		if (obj == null) return null;
		try
		{
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
