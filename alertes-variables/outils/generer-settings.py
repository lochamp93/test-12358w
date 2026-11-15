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
add(id="chooseFolder", label="Choisir le dossier source", type="button", callFunction="ChooseFolder", group="Dossier source")
add(id="refreshFolders", label="Actualiser les dossiers", type="button", callFunction="RefreshFolders", group="Dossier source")

# ---------- Aperçu ----------
for t, label, _ in TYPES:
    add(id=f"test{t.capitalize()}", label=f"Tester : {label}", type="button",
        callFunction=f"Test{t.capitalize()}", group="Tester dans l’aperçu")

# ---------- Alertes ----------
for t, label, _ in TYPES:
    add(id=f"alert{t.capitalize()}", label=label, type="checkbox", defaultValue=True, group="Alertes")
add(id="minBits", label="Bits minimum", description="En dessous, pas d’alerte", type="number",
    min=1, max=100000, defaultValue=1, group="Alertes", showIf="alertCheer")
add(id="minRaid", label="Viewers minimum pour un raid", type="number", min=1, max=100000, defaultValue=1,
    group="Alertes", showIf="alertRaid")
add(id="alertGap", label="Pause entre deux alertes", description="En secondes", type="number",
    min=0, max=30, step=0.5, defaultValue=1, group="Alertes")

# ---------- Plateformes ----------
for p, l in [("Twitch", "Twitch"), ("Kick", "Kick"), ("YouTube", "YouTube"), ("TikTok", "TikTok")]:
    add(id=f"platform{p}", label=l, type="checkbox", defaultValue=True, group="Plateformes")

# ---------- Style d'un scénario (défaut ou scénario n) ----------


def style_settings(prefix, group, cond):
    """Réglages de style ; prefix = '' pour le scénario par défaut, 'sc1' sinon."""
    def i(name):
        return name if not prefix else prefix + name[0].upper() + name[1:]

    def c(extra=None):
        if extra is None:
            return cond
        return extra

    add(id=i("font"), label="Police", description="Police installée ou Google Fonts — <a href=\"ms-settings:fonts\">voir les polices</a>",
        type="font", defaultValue="SF Pro Display", group=group, **({"showIf": cond} if cond else {}))
    add(id=i("fontSize"), label="Taille du texte", description="En pixels", type="number", min=8, max=300,
        defaultValue=42, group=group, **({"showIf": cond} if cond else {}))
    add(id=i("textColor"), label="Couleur du texte", type="color", defaultValue="#ffffff", group=group,
        **({"showIf": cond} if cond else {}))
    add(id=i("accentColor"), label="Couleur du pseudo", description="Couleur de {user} et des nombres", type="color",
        defaultValue="#ff4d6d", group=group, **({"showIf": cond} if cond else {}))
    add(id=i("textPosition"), label="Position du texte", type="select", options=opts(TEXT_POS), defaultValue="below",
        group=group, **({"showIf": cond} if cond else {}))
    add(id=i("mediaHeight"), label="Hauteur de l’image", description="En pixels (largeur automatique)", type="number",
        min=20, max=2000, defaultValue=320, group=group, **({"showIf": cond} if cond else {}))
    add(id=i("animIn"), label="Animation d’entrée", type="select", options=opts(ANIM_IN), defaultValue="bounce",
        group=group, **({"showIf": cond} if cond else {}))
    add(id=i("animOut"), label="Animation de sortie", type="select", options=opts(ANIM_OUT), defaultValue="fade",
        group=group, **({"showIf": cond} if cond else {}))
    add(id=i("duration"), label="Durée d’affichage", description="En secondes", type="number", min=1, max=120,
        step=0.5, defaultValue=6, group=group, **({"showIf": cond} if cond else {}))
    for t, label, text in TYPES:
        show = {"id": f"alert{t.capitalize()}"}
        add(id=i(f"text{t.capitalize()}"), label=f"Texte : {label}", description=PLACEHOLDERS,
            type="text", defaultValue=text, group=group + " — textes",
            showIf={"any": [show]} if not cond else show_and(cond, show))


def show_and(cond, show):
    # Les textes dépendent du type d'alerte ET du visuel propre au scénario :
    # le visuel est la condition principale (sa chaîne inclut le nombre de scénarios),
    # le type d'alerte est vérifié par l'overlay (un texte d'alerte désactivée n'a pas d'effet).
    return cond


# ---------- Scénario par défaut ----------
style_settings("", "Scénario par défaut", None)
add(id="animDuration", label="Durée des animations", description="En millisecondes", type="number", min=0, max=5000,
    defaultValue=600, group="Scénario par défaut")
add(id="waitMedia", label="Attendre la fin du son ou de la vidéo",
    description="L’alerte reste affichée tant que le son ou la vidéo joue", type="checkbox", defaultValue=True,
    group="Scénario par défaut")
add(id="volume", label="Volume", description="En %", type="number", min=0, max=100, defaultValue=80,
    group="Scénario par défaut")
add(id="textShadow", label="Ombre du texte", type="checkbox", defaultValue=True, group="Scénario par défaut")
add(id="showMessage", label="Afficher le message du viewer", description="Réabonnements, bits et dons",
    type="checkbox", defaultValue=True, group="Scénario par défaut")
add(id="messageSize", label="Taille du message", description="En pixels", type="number", min=8, max=200,
    defaultValue=26, group="Scénario par défaut", showIf="showMessage")
add(id="defaultFolder", label="Dossier du scénario par défaut",
    description="Sous-dossier du dossier source", type="text", datalist="alertes-dossiers",
    defaultValue="defaut", group="Scénario par défaut")

# ---------- Scénarios ----------
add(id="scenarioCount", label="Nombre de scénarios",
    description="Chaque scénario a son sous-dossier, du même nom, dans le dossier source. Le premier scénario dont la règle correspond est utilisé.",
    type="select", options=[{"value": str(n), "label": str(n)} for n in range(0, NB_SCENARIOS + 1)],
    defaultValue="1", group="Scénarios")

EXEMPLES = {1: ("Horreur", "horreur, horror, peur", "")}

for n in range(1, NB_SCENARIOS + 1):
    g = f"Scénario {n}"
    p = f"sc{n}"
    visible = {"id": "scenarioCount", "value": [str(k) for k in range(n, NB_SCENARIOS + 1)]}
    name, kw, cats = EXEMPLES.get(n, ("", "", ""))
    add(id=f"{p}Name", label="Nom du scénario (= nom du dossier)",
        description="Choisissez parmi les dossiers détectés, ou tapez le nom exact du sous-dossier",
        type="text", datalist="alertes-dossiers", defaultValue=name, group=g, showIf=visible)
    add(id=f"{p}Keywords", label="Mots-clés du titre",
        description="Séparés par des virgules (majuscules et accents ignorés)", type="text", defaultValue=kw,
        group=g, showIf=visible)
    add(id=f"{p}Categories", label="Catégories", description="Séparées par des virgules, ex. : Just Chatting, Minecraft",
        type="text", defaultValue=cats, group=g, showIf=visible)
    add(id=f"{p}Match", label="Combinaison", type="select",
        options=opts([("any", "Mot-clé OU catégorie"), ("all", "Mot-clé ET catégorie")]), defaultValue="any",
        group=g, showIf=visible)
    add(id=f"{p}Visual", label="Visuel", type="select",
        options=opts([("default", "Celui du scénario par défaut"), ("own", "Visuel propre au scénario")]),
        defaultValue="default", group=g, showIf=visible)
    add(id=f"{p}Sound", label="Son", type="select",
        options=opts([("default", "Celui du scénario par défaut"), ("own", "Son propre au scénario")]),
        defaultValue="own", group=g, showIf=visible)
    add(id=f"{p}Volume", label="Volume", description="En %", type="number", min=0, max=100, defaultValue=80,
        group=g, showIf={"id": f"{p}Sound", "value": "own"})
    style_settings(p, g, {"id": f"{p}Visual", "value": "own"})

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

# Textes du scénario par défaut : showIf = type d'alerte activé
for s in S:
    if s["id"].startswith("text") and isinstance(s.get("showIf"), dict) and "any" in s["showIf"]:
        s["showIf"] = s["showIf"]["any"][0]

# Ordre des sections : les commandes de chat avant les scénarios
ORDRE = ["Connexion", "Dossier source", "Tester dans l’aperçu", "Alertes", "Plateformes", "Commandes de chat"]
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
