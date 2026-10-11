#!/usr/bin/env python3
"""Render Copix Desktop icons from repo-root icon.png.

macOS .icns: scale the tile to 824px and center it on a 1024px transparent
canvas (Apple Dock grid), then derive every icns size from that canvas.
Windows .ico: the same tile, edge to edge, at 16, 32, 48, and 256.
"""

from __future__ import annotations

import shutil
import struct
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "icon.png"
MAC_BUILD = REPO / "macOS" / "studio" / "build"
WIN_BUILD = REPO / "Windows" / "studio" / "build"
WIN_RESOURCES = REPO / "Windows" / "resources"

CANVAS = 1024
TILE = 824
ORIGIN = (CANVAS - TILE) // 2  # 100

# PNG-backed icns types. Retina codes repeat a pixel size under the @2x OSType.
ICNS_TYPES = (
    (b"icp4", 16),
    (b"icp5", 32),
    (b"ic11", 32),  # 16x16@2x
    (b"icp6", 64),
    (b"ic12", 64),  # 32x32@2x
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic13", 256),  # 128x128@2x
    (b"ic09", 512),
    (b"ic14", 512),  # 256x256@2x
    (b"ic10", 1024),  # 512x512@2x
)

ICO_SIZES = (16, 32, 48, 256)


def png_bytes(image: Image.Image) -> bytes:
    buf = BytesIO()
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def scale(image: Image.Image, size: int) -> Image.Image:
    if image.size == (size, size):
        return image
    return image.resize((size, size), Image.Resampling.LANCZOS)


def macos_frame(tile: Image.Image, size: int) -> Image.Image:
    """Place the tile at the 824/1024 Dock ratio on a transparent square."""
    tile_px = round(TILE * size / CANVAS)
    origin = (size - tile_px) // 2
    fitted = scale(tile, tile_px)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(fitted, (origin, origin), fitted)
    return canvas


def write_icns(tile: Image.Image, dest: Path) -> None:
    encoded: dict[int, bytes] = {}
    chunks: list[bytes] = []
    for ostype, size in ICNS_TYPES:
        if size not in encoded:
            encoded[size] = png_bytes(macos_frame(tile, size))
        data = encoded[size]
        chunks.append(ostype + struct.pack(">I", 8 + len(data)) + data)
    body = b"".join(chunks)
    dest.write_bytes(b"icns" + struct.pack(">I", 8 + len(body)) + body)


def dib32(image: Image.Image) -> bytes:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.tobytes()
    xor_rows = []
    and_rows = []
    mask_stride = ((width + 31) // 32) * 4
    for y in range(height - 1, -1, -1):
        xor = bytearray()
        mask = bytearray(mask_stride)
        for x in range(width):
            index = (y * width + x) * 4
            red, green, blue, alpha = pixels[index : index + 4]
            xor += bytes((blue, green, red, alpha))
            if alpha == 0:
                mask[x // 8] |= 0x80 >> (x % 8)
        xor_rows.append(bytes(xor))
        and_rows.append(bytes(mask))
    xor_data = b"".join(xor_rows)
    and_data = b"".join(and_rows)
    header = struct.pack(
        "<IiiHHIIiiII",
        40,
        width,
        height * 2,
        1,
        32,
        0,
        len(xor_data) + len(and_data),
        0,
        0,
        0,
        0,
    )
    return header + xor_data + and_data


def write_ico(tile: Image.Image, dest: Path) -> None:
    blobs: list[bytes] = []
    for size in ICO_SIZES:
        image = scale(tile, size)
        if size >= 256:
            blobs.append(png_bytes(image))
        else:
            blobs.append(dib32(image))

    count = len(blobs)
    header = struct.pack("<HHH", 0, 1, count)
    directory = bytearray()
    offset = 6 + 16 * count
    for size, blob in zip(ICO_SIZES, blobs):
        dimension = 0 if size >= 256 else size
        directory += struct.pack(
            "<BBBBHHII",
            dimension,
            dimension,
            0,
            0,
            1,
            32,
            len(blob),
            offset,
        )
        offset += len(blob)
    dest.write_bytes(header + bytes(directory) + b"".join(blobs))


def save_png(image: Image.Image, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    image.save(dest, format="PNG", optimize=True)


def copy_bytes(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dest)


def assert_macos(canvas: Image.Image) -> None:
    if canvas.size != (CANVAS, CANVAS):
        raise SystemExit(f"macOS canvas is {canvas.size}, expected 1024x1024")
    alpha = canvas.getchannel("A")
    border = max(
        alpha.crop((0, 0, CANVAS, ORIGIN)).getextrema()[1],
        alpha.crop((0, CANVAS - ORIGIN, CANVAS, CANVAS)).getextrema()[1],
        alpha.crop((0, 0, ORIGIN, CANVAS)).getextrema()[1],
        alpha.crop((CANVAS - ORIGIN, 0, CANVAS, CANVAS)).getextrema()[1],
    )
    if border != 0:
        raise SystemExit("macOS canvas border is not transparent")
    center = alpha.getpixel((CANVAS // 2, CANVAS // 2))
    if center == 0:
        raise SystemExit("macOS canvas center is empty")


def assert_icns(path: Path) -> None:
    data = path.read_bytes()
    if data[:4] != b"icns":
        raise SystemExit("icon.icns missing icns magic")
    total = struct.unpack(">I", data[4:8])[0]
    if total != len(data):
        raise SystemExit("icon.icns length header does not match the file")
    found: dict[bytes, int] = {}
    cursor = 8
    while cursor < len(data):
        ostype = data[cursor : cursor + 4]
        length = struct.unpack(">I", data[cursor + 4 : cursor + 8])[0]
        payload = data[cursor + 8 : cursor + length]
        if payload[:8] != b"\x89PNG\r\n\x1a\n":
            raise SystemExit(f"{ostype!r} is not a PNG chunk")
        with Image.open(BytesIO(payload)) as image:
            found[ostype] = image.size[0]
            if image.size[0] != image.size[1]:
                raise SystemExit(f"{ostype!r} is not square")
            if image.convert("RGBA").getpixel((0, 0))[3] != 0:
                raise SystemExit(f"{ostype!r} lost the Dock margin")
        cursor += length
    expected = {ostype: size for ostype, size in ICNS_TYPES}
    if found != expected:
        raise SystemExit(f"icns types {found!r} != {expected!r}")


def assert_ico(path: Path) -> None:
    data = path.read_bytes()
    reserved, kind, count = struct.unpack_from("<HHH", data, 0)
    if (reserved, kind, count) != (0, 1, len(ICO_SIZES)):
        raise SystemExit(f"unexpected ICO header in {path.name}")
    sizes = []
    for index in range(count):
        width, height, _colors, _reserved, _planes, _bits, nbytes, offset = struct.unpack_from(
            "<BBBBHHII", data, 6 + 16 * index
        )
        blob = data[offset : offset + nbytes]
        reported = 256 if width == 0 else width
        sizes.append(reported)
        if height not in (0, reported) and not (reported == 256 and height == 0):
            if height != reported:
                raise SystemExit(f"ICO entry {index} dimension mismatch")
        if blob[:8] == b"\x89PNG\r\n\x1a\n":
            with Image.open(BytesIO(blob)) as image:
                if image.size != (reported, reported):
                    raise SystemExit(f"ICO png {index} is {image.size}")
        else:
            header_size, dib_w, dib_h, _planes, bit_count = struct.unpack_from("<IiiHH", blob, 0)
            if header_size != 40 or dib_w != reported or dib_h != reported * 2 or bit_count != 32:
                raise SystemExit(f"ICO dib {index} header is unexpected")
    if tuple(sizes) != ICO_SIZES:
        raise SystemExit(f"ICO sizes {sizes} != {list(ICO_SIZES)}")


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"Missing {SOURCE}")
    with Image.open(SOURCE) as opened:
        tile = opened.convert("RGBA")
    if tile.size != (CANVAS, CANVAS):
        raise SystemExit(f"{SOURCE.name} is {tile.size}, expected 1024x1024")

    canvas = macos_frame(tile, CANVAS)
    assert_macos(canvas)

    MAC_BUILD.mkdir(parents=True, exist_ok=True)
    WIN_BUILD.mkdir(parents=True, exist_ok=True)

    save_png(tile, MAC_BUILD / "icon-source.png")
    save_png(canvas, MAC_BUILD / "icon.png")
    write_icns(tile, MAC_BUILD / "icon.icns")
    assert_icns(MAC_BUILD / "icon.icns")

    # In-app mark stays the full tile. Dock padding belongs only on the .icns canvas.
    for folder in (MAC_BUILD, WIN_BUILD):
        save_png(scale(tile, 150), folder / "Copix_150.png")
        save_png(scale(tile, 70), folder / "Copix_70.png")

    save_png(tile, MAC_BUILD.parent / "public" / "favicon.png")
    save_png(tile, WIN_BUILD / "icon.png")
    save_png(tile, WIN_BUILD.parent / "public" / "favicon.png")

    write_ico(tile, WIN_BUILD / "icon.ico")
    copy_bytes(WIN_BUILD / "icon.ico", WIN_BUILD / "installerIcon.ico")
    copy_bytes(WIN_BUILD / "icon.ico", MAC_BUILD / "icon.ico")
    copy_bytes(WIN_BUILD / "icon.ico", MAC_BUILD / "installerIcon.ico")
    assert_ico(WIN_BUILD / "icon.ico")
    assert_ico(WIN_BUILD / "installerIcon.ico")

    if WIN_RESOURCES.is_dir():
        copy_bytes(WIN_BUILD / "icon.png", WIN_RESOURCES / "icon.png")
        copy_bytes(WIN_BUILD / "icon.ico", WIN_RESOURCES / "icon.ico")
        copy_bytes(WIN_BUILD / "Copix_150.png", WIN_RESOURCES / "Copix_150.png")
        copy_bytes(WIN_BUILD / "Copix_70.png", WIN_RESOURCES / "Copix_70.png")

    print(f"macOS icon.png {CANVAS}px with {TILE}px tile at ({ORIGIN},{ORIGIN})")
    print(f"macOS icon.icns types: {', '.join(f'{t.decode()}:{s}' for t, s in ICNS_TYPES)}")
    print(f"Windows icon.ico sizes: {', '.join(str(s) for s in ICO_SIZES)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - surface generator failures
        print(exc, file=sys.stderr)
        raise
