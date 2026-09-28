#!/usr/bin/env python3
"""Build the lightweight NCE3 resource catalog used by the static player."""

import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "catalog.json"
REPOSITORY = "magang0425/NCE"
BRANCH = "master"
RESOURCE_PATH = "NCE3"
LYRIC_CDN = f"https://cdn.jsdelivr.net/gh/{REPOSITORY}@{BRANCH}/{RESOURCE_PATH}"
AUDIO_CDN = (
    "https://cdn.jsdelivr.net/gh/tangx/New-Concept-English@main/"
    "%E6%96%B0%E6%A6%82%E5%BF%B5%E8%8B%B1%E8%AF%AD%E7%AC%AC3%E5%86%8C"
    "%E7%BE%8E%E9%9F%B3%EF%BC%88MP3%2BLRC%EF%BC%89/"
    "NCE3-%E7%BE%8E%E9%9F%B3-%28MP3%2BLRC%29"
)
TREE_API = f"https://data.jsdelivr.com/v1/package/gh/{REPOSITORY}@{BRANCH}/flat"
FALLBACK_BOOK = "https://nce.mleo.site/NCE3/book.json"
FALLBACK_AUDIO = "https://nce.mleo.site/NCE3"
TIME_RE = re.compile(r"^\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]")
FILE_RE = re.compile(r"^NCE3/(\d{2})－(.+)\.lrc$")


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "nce3-catalog-builder/2.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def fetch_lesson(path: str) -> dict:
    url = f"https://cdn.jsdelivr.net/gh/{REPOSITORY}@{BRANCH}/{urllib.parse.quote(path)}"
    text = fetch(url).decode("utf-8-sig")
    match = FILE_RE.match(path)
    if not match:
        raise ValueError(f"unexpected lesson path: {path}")
    number, title = match.groups()
    timed_lines = [line.strip() for line in text.splitlines() if TIME_RE.match(line.strip())]
    untranslated = [line for line in timed_lines if "|" not in line or not line.rsplit("|", 1)[1].strip()]
    if untranslated:
        raise ValueError(f"{path} contains {len(untranslated)} untranslated timed lines")
    return {
        "num": int(number),
        "title": title,
        "file": f"{number}－{title}",
        "lineCount": len(timed_lines),
    }


def main() -> None:
    tree = json.loads(fetch(TREE_API))
    fallback_book = json.loads(fetch(FALLBACK_BOOK))
    fallback_files = {
        int(unit["filename"][:2]): unit["filename"]
        for unit in fallback_book["units"]
    }
    paths = sorted(
        item["name"].lstrip("/")
        for item in tree["files"]
        if FILE_RE.match(item["name"].lstrip("/"))
    )
    if len(paths) != 60:
        raise RuntimeError(f"expected 60 NCE3 lessons, found {len(paths)}")

    with ThreadPoolExecutor(max_workers=10) as pool:
        units = list(pool.map(fetch_lesson, paths))
    for unit in units:
        unit["audioFallbackFile"] = fallback_files[unit["num"]]

    catalog = {
        "version": 2,
        "key": "NCE3-US",
        "name": "新概念英语第三册",
        "accent": "美音",
        "generatedAt": date.today().isoformat(),
        "lineCount": sum(unit["lineCount"] for unit in units),
        "resources": {
            "lyrics": LYRIC_CDN,
            "audio": AUDIO_CDN,
            "audioFallback": FALLBACK_AUDIO,
        },
        "attribution": {
            "lyrics": "magang0425/NCE",
            "audio": "tangx/New-Concept-English",
            "delivery": "jsDelivr",
        },
        "units": units,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT}: {len(units)} lessons, {catalog['lineCount']} lines")


if __name__ == "__main__":
    main()
