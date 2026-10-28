"""Create a portable source bundle, excluding local dependencies and browser data."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
output = root / "dist/tab-observatory-0.1.0.zip"
output.parent.mkdir(exist_ok=True)
files = [root / name for name in ["README.md", "package.json", "package-lock.json", ".gitignore"]]
for directory in ["extension", "companion", "scripts", "tests", ".github"]:
    files.extend(p for p in (root / directory).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, Path("tab-observatory") / file.relative_to(root))
print(output)
