"""Verify that the installable APK includes the complete exported application."""
import hashlib
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    apk = Path(sys.argv[1])
    assets = ROOT / "apps/android/app/src/main/assets"
    expected = {"assets/" + file.relative_to(assets).as_posix()
                for file in (assets / "_next").rglob("*") if file.is_file()}
    if not expected:
        raise RuntimeError("No exported Next.js runtime was found")
    with zipfile.ZipFile(apk) as archive:
        packaged = set(archive.namelist())
        missing = (expected | {"assets/index.html", "assets/connect.html", "AndroidManifest.xml", "classes.dex"}) - packaged
        if missing:
            raise RuntimeError(f"APK is missing application assets: {sorted(missing)[:12]}")
        forbidden = [name for name in packaged if name.endswith((".env", ".db", ".keystore", ".jks"))]
        if forbidden:
            raise RuntimeError(f"Private runtime files were packaged: {forbidden}")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    apk.with_suffix(".apk.sha256").write_text(f"{digest}  {apk.name}\n", encoding="utf-8")
    print(f"Verified {len(expected)} bundled web assets; SHA-256 written beside the APK.")


if __name__ == "__main__":
    main()
