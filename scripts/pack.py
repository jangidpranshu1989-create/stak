"""Pack the Stak source into text bundles (===FILE:path=== ... ===END===) + a zip. Usage: python3 scripts/pack.py"""
import os, zipfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "export")
SKIP_DIRS = {"node_modules", ".git", "export", "dist", "build", ".gradle", ".idea", ".kotlin", "screenshots"}
SKIP_FILES = {"package-lock.json", "data.db", "data.db-shm", "data.db-wal", "server.log", ".env"}
BUNDLES = {
    "stak-server.txt": ["server"],
    "stak-client.txt": ["client"],
    "stak-docs.txt": ["shared", "docs", "scripts", "README.md", "prompts.md", ".env.example", "package.json", ".gitignore", "Dockerfile", "docker-compose.yml", "render.yaml", ".dockerignore"],
    "stak-android.txt": ["stak-android"],
}
def walk(p, skip_dist=False):
    full = os.path.join(ROOT, p)
    if os.path.isfile(full): yield p; return
    for d, dirs, files in os.walk(full):
        dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS or (x == "dist" and not skip_dist))
        for f in sorted(files):
            if f not in SKIP_FILES: yield os.path.relpath(os.path.join(d, f), ROOT)
os.makedirs(OUT, exist_ok=True)
allfiles = []
for name, parts in BUNDLES.items():
    chunks = []
    for part in parts:
        for rel in walk(part):
            if rel.endswith((".jks", ".keystore", ".apk", ".aab")) or "local.properties" in rel: continue
            try: txt = open(os.path.join(ROOT, rel), encoding="utf-8").read()
            except UnicodeDecodeError:
                allfiles.append(rel); continue  # binary (icons, gradle wrapper jar): zip only
            chunks.append(f"===FILE:{rel}===\n{txt}{'' if txt.endswith(chr(10)) else chr(10)}===END===\n")
            allfiles.append(rel)
    data = "".join(chunks)
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(data)
    print(f"{name}: {len(chunks)} files, {len(data.encode()) / 1024:.0f} KB")
# public/ is identical to client/dist; include it in the zip so it runs as-is
with zipfile.ZipFile(os.path.join(OUT, "stak-source.zip"), "w", zipfile.ZIP_DEFLATED) as z:
    for rel in allfiles + list(walk("public")) + [f for f in walk("stak-android/docs/screenshots") if f.endswith(".png")]:
        z.write(os.path.join(ROOT, rel), os.path.join("stak", rel))
print("stak-source.zip:", os.path.getsize(os.path.join(OUT, "stak-source.zip")) // 1024, "KB")
