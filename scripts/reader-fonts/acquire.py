#!/usr/bin/env python3
"""Acquire hash-pinned upstream font sources. This does not subset fonts."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile


def verify(data: bytes, size: int, digest: str, label: str) -> bytes:
    if len(data) != size or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"Source size or SHA-256 differs: {label}")
    return data


def acquire(url: str, size: int, digest: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Durtal-font-audit"})
    with urllib.request.urlopen(request, timeout=40) as response:
        # Stop at the expected size plus one; do not accept an unbounded response.
        return verify(response.read(size + 1), size, digest, url)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).parent / "upstream-sources.json").read_text())
    archive_data = None
    for item in manifest["inputs"]:
        target = args.output / item["family"] / item["file"]
        if target.exists():
            data = verify(target.read_bytes(), item["bytes"], item["sha256"], str(target))
        elif args.verify_only:
            raise FileNotFoundError(target)
        else:
            if "member" in item:
                if archive_data is None:
                    release = manifest["sourceReleases"]["inter"]
                    archive_data = acquire(
                        item["url"], release["archiveBytes"], release["archiveSha256"]
                    )
                with zipfile.ZipFile(io.BytesIO(archive_data)) as archive:
                    info = archive.getinfo(item["member"])
                    if info.file_size != item["bytes"]:
                        raise ValueError(f"Archive member size differs: {info.filename}")
                    # Read one known member; never extract archive paths.
                    data = verify(
                        archive.read(info), item["bytes"], item["sha256"], item["member"]
                    )
            else:
                data = acquire(item["url"], item["bytes"], item["sha256"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(f"{item['family']}/{item['file']}: {len(data)} bytes, SHA-256 verified")


if __name__ == "__main__":
    main()
