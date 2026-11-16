#!/usr/bin/env python3
"""Refresh inat-project/oregonflora-benton.json from OregonFlora.

The biodiversity challenge page compares the project's species with OregonFlora's
Benton County checklist (https://oregonflora.org/checklists/checklist.php?cl=14955).
OregonFlora does not allow browsers on other sites to read its data, so the page
uses this saved copy instead. Run this from the repository root whenever the
checklist changes, then commit the result:

    python3 scripts/update_oregonflora_checklist.py
"""
import datetime
import json
import pathlib
import urllib.request

CHECKLIST_ID = 14955
API = f"https://oregonflora.org/checklists/rpc/api.php?clid={CHECKLIST_ID}"
PAGE = f"https://oregonflora.org/checklists/checklist.php?cl={CHECKLIST_ID}"
OUTPUT = pathlib.Path(__file__).resolve().parent.parent / "inat-project" / "oregonflora-benton.json"


def main():
    # OregonFlora turns away requests that do not look like they come from a browser.
    request = urllib.request.Request(API, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        checklist = json.load(response)

    names = sorted({taxon["sciname"].strip() for taxon in checklist["taxa"] if taxon.get("sciname")})
    if len(names) < 500:
        raise SystemExit(f"Only {len(names)} names came back; leaving {OUTPUT.name} untouched.")

    snapshot = {
        "source": PAGE,
        "title": checklist.get("title", ""),
        "authors": checklist.get("authors", ""),
        "fetched": datetime.date.today().isoformat(),
        "names": names,
    }
    OUTPUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"Wrote {len(names)} names to {OUTPUT}")


if __name__ == "__main__":
    main()
