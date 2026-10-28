"""Create a portable bundle: sources plus the built extension, excluding local dependencies and browser data."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
if not (root / "extension/manifest.json").is_file():
    raise SystemExit("extension/manifest.json is missing. Run npm run build first.")
version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
output = root / f"dist/tab-observatory-{version}.zip"
output.parent.mkdir(exist_ok=True)
files = [root / name for name in [
    "README.md", "package.json", "package-lock.json", ".gitignore",
    "dashboard.html", "vite.config.ts", "tsconfig.json",
]]
for directory in ["extension", "src", "public", "companion", "scripts", "tests", ".github"]:
    files.extend(p for p in (root / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, Path("tab-observatory") / file.relative_to(root))
print(output)
