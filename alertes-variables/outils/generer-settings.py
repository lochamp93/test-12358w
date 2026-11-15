# Génère alertes-variables/settings/settings.json (12 scénarios identiques).
# Utilisation : python3 alertes-variables/outils/generer-settings.py
import json
import os

NB_SCENARIOS = 12

TYPES = [
    ("follow", "Follow", "{user} vient de suivre la chaîne !"),
    ("sub", "Abonnement", "{user} vient de s’abonner !"),
    ("resub", "Réabonnement", "{user} se réabonne depuis {months} mois !"),
    ("gift", "Abonnements offerts", "{user} offre {count} abonnement(s) !"),
    ("cheer", "Bits / dons", "{user} envoie {amount} !"),
    ("raid", "Raid", "{user} débarque avec {viewers} viewers !"),
]

ANIM_IN = [
    ("fade", "Fondu"), ("slideUp", "Glissement vers le haut"), ("slideDown", "Glissement vers le bas"),
    ("slideLeft", "Glissement depuis la droite"), ("slideRight", "Glissement depuis la gauche"),
    ("zoom", "Zoom"), ("bounce", "Rebond"), ("shake", "Secousse"), ("none", "Aucune"),
]
ANIM_OUT = [
    ("fade", "Fondu"), ("slideUp", "Glissement vers le haut"), ("slideDown", "Glissement vers le bas"),
    ("slideLeft", "Glissement vers la gauche"), ("slideRight", "Glissement vers la droite"),
    ("zoom", "Zoom arrière"), ("none", "Aucune"),
]
TEXT_POS = [("below", "Sous l’image"), ("above", "Au-dessus de l’image"), ("over", "Sur l’image")]

PLACEHOLDERS = "Variables : {user}, {months}, {count}, {amount}, {viewers}"


def opts(pairs):
    return [{"value": v, "label": l} for v, l in pairs]


S = []


def add(**kw):
    kw.setdefault("description", "")
    S.append(kw)


# ---------- Connexion ----------
add(id="address", label="Adresse Streamer.bot", description="Adresse du serveur WebSocket de Streamer.bot",
    type="text", defaultValue="127.0.0.1", group="Connexion")
add(id="port", label="Port Streamer.bot", type="number", min=1, max=65535, defaultValue=8080, group="Connexion")
add(id="actionName", label="Action Streamer.bot",
    description="Nom de l’action importée depuis le dock (lit le dossier, le son coupé, le titre et la catégorie)",
    type="text", defaultValue="Alertes variables | Moteur", group="Connexion")

# ---------- Dossier source ----------
add(id="folderInfo", label="Dossier sélectionné", type="info", defaultValue="Connexion à Streamer.bot…",
    group="Dossier source")
add(id="chooseFolder", label="Choisir le dossier source", type="button", callFunction="ChooseFolder", group="Dossier source")
add(id="refreshFolders", label="Actualiser les dossiers", type="button", callFunction="RefreshFolders", group="Dossier source")

# Les sections par plateforme sont générées plus bas (après le style des scénarios)
PLATEFORMES = [
    ("Twitch", "twitch", [("follow", "Follow"), ("sub", "Abonnement"), ("resub", "Réabonnement"),
                          ("gift", "Abonnements offerts"), ("cheer", "Bits"), ("raid", "Raid")]),
    ("Kick", "kick", [("follow", "Follow"), ("sub", "Abonnement"), ("resub", "Réabonnement"),
                      ("gift", "Abonnements offerts")]),
    ("YouTube", "youtube", [("follow", "Nouvel abonné"), ("sub", "Nouveau membre"), ("resub", "Palier de membre"),
                            ("gift", "Abonnements offerts"), ("cheer", "Super Chat / Super Sticker")]),
    ("TikTok", "tiktok", [("follow", "Follow"), ("sub", "Abonnement"), ("cheer", "Cadeaux")]),
]
NB_REGLES_SUB = 6

add(id="alertGap", label="Pause entre deux alertes", description="En secondes", type="number",
    min=0, max=30, step=0.5, defaultValue=1, group="Réglages des alertes")


# ---------- Organisation par scénario ----------
# « Scénario à modifier » (aperçu seulement) : seules les sections du scénario choisi s'affichent,
# et les tests de l'aperçu utilisent ce scénario.
add(id="editScenario", label="Scénario à modifier",
    description="Affiche les réglages de ce scénario ; les tests de l’aperçu l’utilisent",
    type="select", options=opts([("defaut", "Par défaut")] + [(str(n), f"Scénario {n}") for n in range(1, NB_SCENARIOS + 1)]
                               + [("new", "+ Nouveau scénario")]),
    defaultValue="defaut", previewOnly=True, group="Scénarios")
# Nombre de scénarios : géré par « Nouveau scénario » et « Supprimer ce scénario » (jamais affiché)
add(id="scenarioCount", label="Nombre de scénarios actifs",
    type="select", options=[{"value": str(n), "label": str(n)} for n in range(0, NB_SCENARIOS + 1)],
    defaultValue="1", group="Scénarios", hidden=True)

DEF = {"id": "editScenario", "value": "defaut"}


def vis(n):
    return {"all": [{"id": "editScenario", "value": str(n)},
                    {"id": "scenarioCount", "value": [str(k) for k in range(n, NB_SCENARIOS + 1)]}]}


def style_settings(prefix, cond):
    """Réglages de style ; prefix = '' pour le scénario par défaut, 'sc1' sinon."""
    def i(name):
        return name if not prefix else prefix + name[0].upper() + name[1:]

    g = "Style"
    add(id=i("font"), label="Police", description="Police installée ou Google Fonts. <a href=\"ms-settings:fonts\">voir les polices</a>",
        type="font", defaultValue="SF Pro Display", group=g, showIf=cond)
    add(id=i("fontSize"), label="Taille du texte", description="En pixels", type="number", min=8, max=300,
        defaultValue=42, group=g, showIf=cond)
    add(id=i("textColor"), label="Couleur du texte", type="color", defaultValue="#ffffff", group=g, showIf=cond)
    add(id=i("accentColor"), label="Couleur du pseudo", description="Couleur de {user} et des nombres", type="color",
        defaultValue="#ff4d6d", group=g, showIf=cond)
    add(id=i("textPosition"), label="Position du texte", type="select", options=opts(TEXT_POS), defaultValue="below",
        group=g, showIf=cond)
    add(id=i("mediaHeight"), label="Hauteur de l’image", description="En pixels (largeur automatique)", type="number",
        min=20, max=2000, defaultValue=320, group=g, showIf=cond)
    add(id=i("animIn"), label="Animation d’entrée", type="select", options=opts(ANIM_IN), defaultValue="bounce",
        group=g, showIf=cond)
    add(id=i("animOut"), label="Animation de sortie", type="select", options=opts(ANIM_OUT), defaultValue="fade",
        group=g, showIf=cond)
    add(id=i("duration"), label="Durée d’affichage", description="En secondes", type="number", min=1, max=120,
        step=0.5, defaultValue=6, group=g, showIf=cond)


# ---------- Scénario par défaut ----------
add(id="defaultFolder", label="Dossier du scénario par défaut",
    description="Sous-dossier du dossier source", type="text", datalist="alertes-dossiers",
    defaultValue="defaut", group="Visuel et son", showIf=DEF)
add(id="volume", label="Volume", description="En %", type="number", min=0, max=100, defaultValue=80,
    group="Visuel et son", showIf=DEF)
add(id="waitMedia", label="Attendre la fin du son ou de la vidéo",
    description="L’alerte reste affichée tant que le son ou la vidéo joue", type="checkbox", defaultValue=True,
    group="Visuel et son", showIf=DEF)
style_settings("", DEF)
add(id="animDuration", label="Durée des animations", description="En millisecondes", type="number", min=0, max=5000,
    defaultValue=600, group="Style", showIf=DEF)
add(id="textShadow", label="Ombre du texte", type="checkbox", defaultValue=True, group="Style", showIf=DEF)
add(id="showMessage", label="Afficher le message du viewer", description="Réabonnements, bits et dons",
    type="checkbox", defaultValue=True, group="Style", showIf=DEF)
add(id="messageSize", label="Taille du message", description="En pixels", type="number", min=8, max=200,
    defaultValue=26, group="Style", showIf="showMessage")

# ---------- Scénarios 1 à 12 ----------
EXEMPLES = {1: ("Horreur", "horreur, horror, peur", "")}

for n in range(1, NB_SCENARIOS + 1):
    p = f"sc{n}"
    v = vis(n)
    name, kw, cats = EXEMPLES.get(n, ("", "", ""))
    add(id=f"{p}Name", label="Nom du scénario (= nom du dossier)",
        description="Choisissez parmi les dossiers détectés, ou tapez le nom exact du sous-dossier",
        type="text", datalist="alertes-dossiers", defaultValue=name, group="Déclenchement", showIf=v)
    add(id=f"{p}Keywords", label="Mots-clés du titre",
        description="Séparés par des virgules (majuscules et accents ignorés)", type="text", defaultValue=kw,
        group="Déclenchement", showIf=v)
    add(id=f"{p}Categories", label="Catégories", description="Séparées par des virgules, ex. : Just Chatting, Minecraft",
        type="text", defaultValue=cats, group="Déclenchement", showIf=v)
    add(id=f"{p}Match", label="Combinaison", type="select",
        options=opts([("any", "Mot-clé OU catégorie"), ("all", "Mot-clé ET catégorie")]), defaultValue="any",
        group="Déclenchement", showIf=v)
    add(id=f"{p}Visual", label="Visuel et style", type="select",
        options=opts([("default", "Ceux du scénario par défaut"), ("own", "Propres au scénario")]),
        defaultValue="default", group="Visuel et son", showIf=v)
    add(id=f"{p}Sound", label="Son", type="select",
        options=opts([("default", "Celui du scénario par défaut"), ("own", "Son propre au scénario")]),
        defaultValue="own", group="Visuel et son", showIf=v)
    add(id=f"{p}Volume", label="Volume", description="En %", type="number", min=0, max=100, defaultValue=80,
        group="Visuel et son", showIf={"id": f"{p}Sound", "value": "own"})
    style_settings(p, {"id": f"{p}Visual", "value": "own"})

# Supprimer le scénario affiché (pas le scénario par défaut), en bas des sections du scénario
add(id="deleteScenario", label="Supprimer ce scénario", type="button", callFunction="DeleteScenario", confirm=True,
    danger=True, bare=True, group="Gérer le scénario", showIf={"id": "editScenario", "notValue": "defaut"})

# ---------- Plateformes : chaque alerte et ses détails imbriqués ----------
TEXTES = {t: text for t, _, text in TYPES}
SCOPES = [("", {"id": "editScenario", "value": "defaut"})] + \
         [(f"sc{n}", {"id": f"sc{n}Visual", "value": "own"}) for n in range(1, NB_SCENARIOS + 1)]

for nom, cle, types in PLATEFORMES:
    add(id=f"platform{nom}", label=f"Alertes {nom}", type="checkbox", defaultValue=True, group=nom)
    for t, label in types:
        T = t.capitalize()
        tid = f"{cle}{T}"
        # alias « alertSub »… : les anciennes URL (un réglage par type) restent valables
        add(id=tid, label=label, type="checkbox", defaultValue=True, group=nom,
            showIf=f"platform{nom}", aliases=[f"alert{T}"])
        # Texte (scénario par défaut, puis chaque scénario à visuel propre)
        for prefix, scope in SCOPES:
            ident = f"{cle}{T}Text" if not prefix else f"{prefix}{cle.capitalize()}{T}Text"
            ancien = f"text{T}" if not prefix else f"{prefix}Text{T}"
            add(id=ident, label="Texte", description=PLACEHOLDERS, type="text", defaultValue=TEXTES[t],
                group=nom, indent=1, showIf={"all": [{"id": tid}, scope]}, aliases=[ancien])
        add(id=f"{tid}Files", label="Fichiers", type="info", defaultValue="Connexion à Streamer.bot…",
            group=nom, indent=1, showIf=tid)
        if cle == "twitch" and t == "cheer":
            add(id="minBits", label="Bits minimum", description="En dessous, pas d’alerte", type="number",
                min=1, max=100000, defaultValue=1, group=nom, indent=1, showIf=tid)
        if cle == "twitch" and t == "raid":
            add(id="minRaid", label="Viewers minimum", type="number", min=1, max=100000, defaultValue=1,
                group=nom, indent=1, showIf=tid)
        add(id=f"{tid}Test", label="Tester l’alerte", type="button", callFunction=f"Test{nom}{T}",
            group=nom, indent=1, showIf=tid)

        # Abonnements spéciaux (anniversaires) sous Twitch > Abonnement, avec « + Ajouter une règle »
        if cle == "twitch" and t == "sub":
            for n in range(1, NB_REGLES_SUB + 1):
                v = {"all": [{"id": tid}, {"id": "subRuleCount", "value": [str(k) for k in range(n, NB_REGLES_SUB + 1)]}]}
                add(id=f"subRule{n}Name", label=f"Règle {n} : nom", description="Pour vous repérer (ex. Anniversaire)",
                    type="text", defaultValue="Anniversaire" if n == 1 else "", group=nom, indent=2, showIf=v)
                add(id=f"subRule{n}Kind", label="Quand", type="select",
                    options=opts([("exact", "Exactement N mois"), ("every", "Tous les N mois")]),
                    defaultValue="every" if n == 1 else "exact", group=nom, indent=2, showIf=v)
                add(id=f"subRule{n}Months", label="Nombre de mois (N)", type="number", min=1, max=240,
                    defaultValue=12 if n == 1 else 9, group=nom, indent=2, showIf=v)
                add(id=f"subRule{n}Files", label="Fichiers", type="info", defaultValue="",
                    group=nom, indent=2, showIf=v)
                add(id=f"subRule{n}Test", label="Tester la règle", type="button", callFunction=f"TestSubRule{n}",
                    group=nom, indent=2, showIf=v)
                add(id=f"subRule{n}Delete", label="Supprimer la règle", type="button", callFunction=f"DeleteSubRule{n}",
                    confirm=True, danger=True, group=nom, indent=2, showIf=v)
            add(id="addSubRule", label="+ Ajouter une règle (ex. tous les 12 mois)", type="button",
                callFunction="AddSubRule", group=nom, indent=1,
                showIf={"all": [{"id": tid}, {"id": "subRuleCount", "value": [str(k) for k in range(0, NB_REGLES_SUB)]}]})
            add(id="subRuleCount", label="Nombre de règles", type="select",
                options=[{"value": str(k), "label": str(k)} for k in range(NB_REGLES_SUB + 1)],
                defaultValue="0", group=nom, hidden=True)

# ---------- Commandes de chat ----------
add(id="cmdEnabled", label="Activer les commandes", type="checkbox", defaultValue=True, group="Commandes de chat")
add(id="cmdMute", label="Commande pour couper le son", description="Plusieurs possibles, séparées par des virgules",
    type="text", defaultValue="!mutealerte, !mutealert", group="Commandes de chat", showIf="cmdEnabled")
add(id="cmdUnmute", label="Commande pour réactiver le son", description="Plusieurs possibles, séparées par des virgules",
    type="text", defaultValue="!unmutealerte, !unmutealert", group="Commandes de chat", showIf="cmdEnabled")
add(id="cmdPermission", label="Qui peut l’utiliser", type="select",
    options=opts([("30", "Streamer et modos"), ("40", "Streamer seul"), ("20", "Streamer, modos et VIP")]),
    defaultValue="30", group="Commandes de chat", showIf="cmdEnabled")
add(id="muteEffect", label="Effet du mute", type="select",
    options=opts([("sound", "Couper seulement le son"), ("all", "Masquer aussi les alertes")]),
    defaultValue="sound", group="Commandes de chat")
add(id="botReply", label="Réponse du bot dans le chat", type="checkbox", defaultValue=True, group="Commandes de chat")
add(id="msgMute", label="Message au mute", description="{user} : qui a coupé le son", type="text",
    defaultValue="🔇 Sons des alertes coupés par {user}", group="Commandes de chat", showIf="botReply")
add(id="msgUnmute", label="Message à l’unmute", description="{user} : qui a réactivé le son", type="text",
    defaultValue="🔊 Sons des alertes réactivés par {user}", group="Commandes de chat", showIf="botReply")

# Ordre des sections : les commandes de chat avant les scénarios
ORDRE = ["Dossier source", "Scénarios", "Déclenchement", "Visuel et son", "Style",
         "Twitch", "Kick", "YouTube", "TikTok", "Réglages des alertes", "Commandes de chat", "Connexion",
         "Gérer le scénario"]
S.sort(key=lambda s: ORDRE.index(s["group"]) if s["group"] in ORDRE else len(ORDRE))

out = {
    "title": "Alertes variables",
    "design": "apple",
    "showLogo": False,
    "checkerPreview": True,
    "livePreview": True,
    "demo": True,
    "compactURL": True,
    "settings": S,
}
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "settings", "settings.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent="\t")
    f.write("\n")
print(len(S), "réglages écrits dans", os.path.normpath(path))
