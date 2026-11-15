# Génère alertes-variables/streamerbot/import.txt (code d'import Streamer.bot) depuis alertes-variables.cs
# Utilisation : python3 alertes-variables/outils/generer-import.py
import base64, gzip, json, os, uuid

ici = os.path.dirname(os.path.abspath(__file__))
source = open(os.path.join(ici, "..", "streamerbot", "alertes-variables.cs"), encoding="utf-8").read()

# Identifiants fixes : réimporter remplace l'action au lieu d'en créer une seconde
ACTION_ID = "5d0c2b7e-3f1a-4e8b-9a61-a1e7b0c4d2f3"
SUB_ID = "8b4f6e21-7c3d-4a59-b0e2-6f1d9c8a3e74"

export = {
    "meta": {"name": "Alertes variables", "author": "lochamp93", "version": "1.0.0",
             "description": "Moteur du widget Alertes variables (dossier source, son coupé, scénario forcé)",
             "autoRunAction": None, "minimumVersion": None},
    "data": {
        "actions": [{
            "id": ACTION_ID, "queue": "00000000-0000-0000-0000-000000000000", "enabled": True,
            "excludeFromHistory": True, "excludeFromPending": True,
            "name": "Alertes variables | Moteur", "group": "lochamp | Widgets",
            "alwaysRun": False, "randomAction": False, "concurrent": True, "triggers": [],
            "subActions": [{
                "name": None, "description": None,
                "references": ["..\\..\\..\\..\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\mscorlib.dll"],
                "byteCode": base64.b64encode(source.encode("utf-8")).decode("ascii"),
                "precompile": False, "delayStart": False, "saveResultToVariable": False, "saveToVariable": None,
                "id": SUB_ID, "weight": 0.0, "type": 99999, "parentId": None, "enabled": True, "index": 0
            }],
            "collapsedGroups": []
        }],
        "queues": [], "commands": [], "websocketServers": [], "websocketClients": [], "timers": []
    },
    "version": 24, "exportedFrom": "1.0.5", "minimumVersion": "1.0.0-alpha.1"
}
data = b"SBAE" + gzip.compress(json.dumps(export, separators=(",", ":")).encode("utf-8"))
open(os.path.join(ici, "..", "streamerbot", "import.txt"), "w").write(base64.b64encode(data).decode("ascii"))
print("import.txt écrit")
