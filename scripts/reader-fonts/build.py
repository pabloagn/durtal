#!/usr/bin/env python3
"""Generate licensed v1 WOFF2 subsets with the pinned one-off fontTools environment."""

import argparse
import hashlib
import json
from pathlib import Path
import tempfile

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
import zopfli

from acquire import verify


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def points(ranges: str) -> set[int]:
    result = set()
    for value in ranges.split(","):
        first, _, last = value.removeprefix("U+").partition("-")
        result.update(range(int(first, 16), int(last or first, 16) + 1))
    return result


def css_range(codepoints: set[int]) -> str:
    spans = []
    first = previous = None
    for point in sorted(codepoints):
        if previous is not None and point != previous + 1:
            spans.append((first, previous))
            first = point
        if first is None:
            first = point
        previous = point
    if first is not None:
        spans.append((first, previous))
    return ",".join(
        f"U+{first:04X}" if first == last else f"U+{first:04X}-{last:04X}"
        for first, last in spans
    )


def rename(font: TTFont, family: str, style: str) -> None:
    # The internal names, CSS family and PostScript prefix all use the reader namespace.
    suffix = "Italic" if style == "italic" else "Regular"
    postscript = family.replace(" ", "") + "-" + suffix
    values = {1: family, 2: suffix, 3: f"Durtal reader v1;{postscript}",
              4: family + " " + suffix, 6: postscript, 16: family, 17: suffix,
              25: family.replace(" ", "")}
    for record in font["name"].names:
        if record.nameID in values:
            record.string = values[record.nameID].encode(record.getEncoding())
    for name_id, value in values.items():
        font["name"].setName(value, name_id, 3, 1, 0x409)


def features(font: TTFont) -> list[str]:
    if "GSUB" not in font or not font["GSUB"].table.FeatureList:
        return []
    return sorted({record.FeatureTag for record in font["GSUB"].table.FeatureList.FeatureRecord})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--metric-ttfs", type=Path, required=True)
    args = parser.parse_args()
    expected_tools = ("4.63.0", "1.2.0", "0.4.1")
    tools = (fontTools.__version__, brotli.__version__, zopfli.__version__)
    if tools != expected_tools:
        raise ValueError(f"Expected pinned tool versions {expected_tools}, got {tools}")
    here = Path(__file__).parent
    source_data = (here / "upstream-sources.json").read_bytes()
    policy_data = (here / "subsets.json").read_bytes()
    sources = json.loads(source_data)
    policy = json.loads(policy_data)
    for item in sources["inputs"]:
        file = args.inputs / item["family"] / item["file"]
        verify(file.read_bytes(), item["bytes"], item["sha256"], str(file))
    ranges = {key: points(value) for key, value in policy["ranges"].items()}
    # Basic-Latin punctuation is served by Latin, not duplicated in latin-ext.
    ranges["latin-ext"] -= ranges["latin"]
    # Ukrainian/central Asian characters belong to the Cyrillic base subset.
    ranges["cyrillic-ext"] -= ranges["cyrillic"]
    args.metric_ttfs.mkdir(parents=True, exist_ok=True)
    output = {"version": policy["version"], "tools": dict(zip(
        ["fontTools", "brotli", "zopfli"], tools)),
        "sourceManifestSha256": digest(source_data), "policySha256": digest(policy_data),
        "policy": policy, "files": [], "licences": []}
    with tempfile.TemporaryDirectory(prefix="durtal-reader-fonts-") as scratch:
        for folder, info in policy["families"].items():
            destination = args.assets / folder
            destination.mkdir(parents=True, exist_ok=True)
            licence = (args.inputs / folder / "OFL.txt").read_bytes()
            (destination / "OFL.txt").write_bytes(licence)
            output["licences"].append({"path": f"/fonts/reader/v1/{folder}/OFL.txt",
                "bytes": len(licence), "sha256": digest(licence)})
            for style in ["roman", "italic"]:
                source = args.inputs / folder / info[style]
                font = TTFont(source, recalcTimestamp=False)
                original_points = set(font.getBestCmap())
                original_features = features(font)
                if any(axis.axisTag == "opsz" for axis in font["fvar"].axes):
                    instantiateVariableFont(font, {"opsz": policy["opticalSize"]}, inplace=True)
                rename(font, info["family"], style)
                prepared = Path(scratch) / f"{folder}-{style}.ttf"
                font.save(prepared)
                font.close()
                for label, codepoints in ranges.items():
                    filename = f"{folder}-{style}-{label}.woff2"
                    target = destination / filename
                    arguments = [str(prepared), "--output-file=" + str(target),
                        "--flavor=woff2", "--layout-features=" + policy["layoutFeatures"],
                        "--unicodes=" + css_range(codepoints), "--no-recalc-timestamp",
                        "--canonical-order", "--name-IDs=" + policy["nameIDs"],
                        "--name-languages=" + policy["nameLanguages"]]
                    if not policy["hinting"]:
                        arguments.append("--no-hinting")
                    subset.main(arguments)
                    shipped = TTFont(target, recalcTimestamp=False)
                    actual = set(shipped.getBestCmap())
                    if actual != original_points & codepoints:
                        raise ValueError(f"Selected Unicode coverage changed: {filename}")
                    present_features = features(shipped)
                    if label == "latin" and folder != "inter":
                        for feature in ["smcp", "c2sc", "onum", "liga"]:
                            if feature in original_features and feature not in present_features:
                                raise ValueError(f"Lost Latin feature {feature}: {filename}")
                    axes = {axis.axisTag: {"min": axis.minValue, "default": axis.defaultValue,
                        "max": axis.maxValue} for axis in shipped["fvar"].axes}
                    data = target.read_bytes()
                    output["files"].append({"id": info["id"], "family": folder,
                        "cssFamily": info["family"], "style": style, "subset": label,
                        "path": f"/fonts/reader/v1/{folder}/{filename}", "bytes": len(data),
                        "sha256": digest(data), "unicodeRange": css_range(codepoints),
                        "codepoints": len(actual), "features": present_features, "axes": axes})
                    if label == "latin" and style == "roman":
                        # Measure an exact decoded copy of the shipped file, never a different source.
                        shipped.flavor = None
                        shipped.save(args.metric_ttfs / f"{info['id']}.ttf")
                    shipped.close()
                    print(f"{filename}: {len(data)} bytes", flush=True)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(output, indent=2) + "\n")


if __name__ == "__main__":
    main()
