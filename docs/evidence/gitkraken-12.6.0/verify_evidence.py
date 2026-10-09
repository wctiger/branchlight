#!/usr/bin/env python3
"""Verify saved feature references against the original installed ASAR, read-only."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asar", type=Path, default=Path(
        "/Applications/GitKraken.app/Contents/Resources/app.asar"))
    args = parser.parse_args()
    evidence = Path(__file__).resolve().parent
    manifest = json.loads((evidence / "artifact-manifest.json").read_text())
    catalog = json.loads((evidence / "feature-evidence.json").read_text())
    digest = hashlib.sha256()
    with args.asar.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
        if digest.hexdigest() != manifest["original_sha256"]:
            raise ValueError("ASAR digest differs from the analyzed version")
        source.seek(0)
        header = struct.unpack("<4I", source.read(16))
        tree = json.loads(source.read(header[3]))
        base = 8 + header[1]
        members = {}
        for item in manifest["files"]:
            node = tree
            for component in item["path"].split("/"):
                node = node["files"][component]
            if node.get("unpacked") or "offset" not in node:
                raise ValueError(f"Expected packed member: {item['path']}")
            source.seek(base + int(node["offset"]))
            data = source.read(node["size"])
            actual = hashlib.sha256(data).hexdigest()
            declared = node.get("integrity", {}).get("hash")
            if len(data) != item["size"] or actual != item["sha256"]:
                raise ValueError(f"Manifest mismatch: {item['path']}")
            if item["integrity_verified"] and actual != declared:
                raise ValueError(f"ASAR integrity mismatch: {item['path']}")
            members[item["path"]] = data
    ids = set()
    refs = 0
    for feature in catalog["features"]:
        if feature["id"] in ids or not feature["evidence"]:
            raise ValueError("Duplicate feature ID or missing evidence")
        ids.add(feature["id"])
        for item in feature["evidence"]:
            value = json.loads(members[item["resource_path"]])
            for part in item["json_pointer"].split("/")[1:]:
                value = value[part.replace("~1", "/").replace("~0", "~")]
            if not isinstance(value, str):
                raise ValueError("Expected a text resource")
            needle = item["json_pointer"].rsplit("/", 1)[1].encode()
            for reference in item["code_references"]:
                data = members[reference["path"]]
                if data.count(needle) != reference["total_occurrences"]:
                    raise ValueError("Code occurrence count mismatch")
                for offset in reference["byte_offsets"]:
                    if data[offset:offset + len(needle)] != needle:
                        raise ValueError("Code byte offset mismatch")
                    refs += 1
    anchors = json.loads((evidence / "workflow-anchors.json").read_text())["anchors"]
    for anchor in anchors:
        data = members[anchor["path"]]
        needle = anchor["search_anchor"].encode()
        offset = anchor["byte_offset"]
        if data[offset:offset + len(needle)] != needle:
            raise ValueError("Workflow anchor byte offset mismatch")
    print(f"Verified {len(members)} packed files, {len(ids)} feature groups, "
          f"{refs} code byte references, and {len(anchors)} workflow anchors "
          f"against GitKraken {manifest['app_version']}.")
    print("This verifies artifact references, not runtime behavior or full application integrity.")


if __name__ == "__main__":
    main()
