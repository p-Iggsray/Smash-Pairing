#!/usr/bin/env python3
"""Build fighter icons: resize source 200x200 PNGs to 128x128 WebP."""
import os
import sys
from PIL import Image

SRC_DIR = "/tmp/ssbu-icons-alt"
DEST_DIR = "/home/user/Random-Pair-Generator/assets/fighters"
SIZE = 128
QUALITY = 85

# (my_id, source_filename). Default mapping is kebab-id -> CamelCase + "1.png";
# special-cases are listed explicitly.
SPECIAL = {
    "ice-climbers": "IceClimbersPopo1.png",   # Popo is canonical leader
    "rosalina-and-luma": "Rosalina1.png",     # Luma is implied
    "mii-brawler": "MiiBrawler.png",          # no costume number
    "mii-swordfighter": "MiiSwordfighter.png",
    "mii-gunner": "MiiGunner.png",
    "pac-man": "Pac-Man1.png",                # repo keeps the hyphen
}

FIGHTERS = [
    "mario", "donkey-kong", "link", "samus", "dark-samus", "yoshi", "kirby",
    "fox", "pikachu", "luigi", "ness", "captain-falcon", "jigglypuff",
    "peach", "daisy", "bowser", "ice-climbers", "sheik", "zelda", "dr-mario",
    "pichu", "falco", "marth", "lucina", "young-link", "ganondorf", "mewtwo",
    "roy", "chrom", "mr-game-and-watch", "meta-knight", "pit", "dark-pit",
    "zero-suit-samus", "wario", "snake", "ike", "pokemon-trainer",
    "diddy-kong", "lucas", "sonic", "king-dedede", "olimar", "lucario", "rob",
    "toon-link", "wolf", "villager", "mega-man", "wii-fit-trainer",
    "rosalina-and-luma", "little-mac", "greninja", "mii-brawler",
    "mii-swordfighter", "mii-gunner", "palutena", "pac-man", "robin", "shulk",
    "bowser-jr", "duck-hunt", "ryu", "ken", "cloud", "corrin", "bayonetta",
    "inkling", "ridley", "simon", "richter", "king-k-rool", "isabelle",
    "incineroar", "piranha-plant", "joker", "hero", "banjo-and-kazooie",
    "terry", "byleth", "min-min", "steve", "sephiroth", "pyra", "mythra",
    "kazuya", "sora",
]


def default_source(my_id: str) -> str:
    return "".join(part.capitalize() for part in my_id.split("-")) + "1.png"


def main() -> int:
    os.makedirs(DEST_DIR, exist_ok=True)
    missing = []
    total_bytes = 0
    for fid in FIGHTERS:
        src_name = SPECIAL.get(fid, default_source(fid))
        src_path = os.path.join(SRC_DIR, src_name)
        if not os.path.exists(src_path):
            missing.append((fid, src_name))
            continue
        with Image.open(src_path) as im:
            im = im.convert("RGBA")
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
            dest = os.path.join(DEST_DIR, f"{fid}.webp")
            im.save(dest, "WEBP", quality=QUALITY, method=6)
            total_bytes += os.path.getsize(dest)
    if missing:
        print("MISSING:")
        for m in missing:
            print(f"  {m[0]} (looked for {m[1]})")
        return 1
    print(f"Built {len(FIGHTERS)} icons -> {DEST_DIR}")
    print(f"Total size: {total_bytes / 1024:.1f} KiB (avg {total_bytes / len(FIGHTERS):.0f} bytes/file)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
