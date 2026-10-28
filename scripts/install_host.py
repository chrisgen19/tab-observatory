"""Build and register the companion for the current user. No administrator needed."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import venv

ROOT = Path(__file__).resolve().parents[1]
NAME = "com.tab_observatory.monitor"


def merged_origins(manifest_path, extension_ids):
    origins = set()
    for extension_id in extension_ids:
        if not re.fullmatch("[a-p]{32}", extension_id):
            raise ValueError(f"Invalid extension ID: {extension_id}. Expected 32 letters a–p.")
        origins.add(f"chrome-extension://{extension_id}/")
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or manifest.get("name") != NAME or manifest.get("type") != "stdio":
            raise ValueError("Existing companion manifest is invalid; it was left unchanged")
        existing = manifest.get("allowed_origins")
        if not isinstance(existing, list) or not all(
            isinstance(origin, str) and re.fullmatch(r"chrome-extension://[a-p]{32}/", origin)
            for origin in existing
        ):
            raise ValueError("Existing companion origins are invalid; registration was left unchanged")
        origins.update(existing)
    return sorted(origins)


def write_manifest(manifest_path, binary, origins):
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=manifest_path.parent, delete=False) as output:
            temporary = Path(output.name)
            json.dump({
                "name": NAME, "description": "Local Chrome process memory monitor",
                "path": str(binary), "type": "stdio", "allowed_origins": origins,
            }, output, indent=2)
        os.replace(temporary, manifest_path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def locations():
    if sys.platform == "win32":
        install = Path(os.environ["LOCALAPPDATA"]) / "TabObservatory"
        manifest = install / f"{NAME}.json"
    elif sys.platform == "darwin":
        install = Path.home() / "Library/Application Support/TabObservatory"
        manifest = Path.home() / "Library/Application Support/Google/Chrome/NativeMessagingHosts" / f"{NAME}.json"
    elif sys.platform.startswith("linux"):
        install = Path.home() / ".local/share/tab-observatory"
        manifest = Path.home() / ".config/google-chrome/NativeMessagingHosts" / f"{NAME}.json"
    else:
        raise SystemExit("Unsupported platform")
    return install, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extension_ids", nargs="*", help="One or more extension IDs; previously registered IDs are preserved")
    parser.add_argument("--register-only", action="store_true", help="Add profiles using the installed companion without rebuilding it")
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    install, manifest_path = locations()
    if args.uninstall:
        if args.extension_ids or args.register_only:
            parser.error("Use --uninstall by itself; it removes the companion for all profiles")
        if sys.platform == "win32":
            import winreg
            try:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"Software\Google\Chrome\NativeMessagingHosts\{NAME}")
            except FileNotFoundError:
                pass
        manifest_path.unlink(missing_ok=True)
        if install.exists():
            shutil.rmtree(install)
        print("Companion removed for all profiles. Remove each extension separately in chrome://extensions.")
        return
    if not args.extension_ids:
        parser.error("Supply the 32-letter Chrome extension ID(s) from the dashboard")
    try:
        origins = merged_origins(manifest_path, args.extension_ids)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    binary = install / "bin" / ("tab-observatory-host.exe" if sys.platform == "win32" else "tab-observatory-host")
    if args.register_only:
        if not binary.is_file():
            parser.error("No installed companion found. Run without --register-only first.")
    else:
        install.mkdir(parents=True, exist_ok=True)
        environment = install / "build-venv"
        venv.EnvBuilder(with_pip=True).create(environment)
        python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        subprocess.run([str(python), "-m", "pip", "install", "-r", str(ROOT / "companion/requirements.txt"), "pyinstaller==6.19.0"], check=True)
        build_dir = install / "build"
        build_dir.mkdir(exist_ok=True)
        subprocess.run([
            str(python), "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile",
            "--name", "tab-observatory-host", "--distpath", str(install / "bin"),
            "--workpath", str(build_dir), "--specpath", str(build_dir),
            str(ROOT / "companion/native_host.py"),
        ], check=True)
    write_manifest(manifest_path, binary, origins)
    if sys.platform == "win32":
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Google\Chrome\NativeMessagingHosts\{NAME}") as key:
            winreg.SetValueEx(key, "", 0, winreg.REG_SZ, str(manifest_path))
    print(f"Companion registered for {len(origins)} extension ID(s):")
    for origin in origins:
        print(f"  {origin}")
    print("Open each profile's dashboard and click Start monitoring.")


if __name__ == "__main__":
    main()
