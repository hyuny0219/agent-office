"""README 스크린샷 렌더러. screenshot-frames.mts가 쓴 JSON을 읽어 터미널처럼 그린다.

셀마다 '▀'(U+2580)이면 위 반은 글자색, 아래 반은 배경색으로 칠하고, 그 밖의 글자는 배경을 칠한 뒤
Menlo로 쓴다(한글 목록은 Apple SD Gothic Neo). 정지 화면 PNG와 움직이는 GIF를 docs/에 쓴다.

사용: python3 scripts/render-screenshot.py frames.json docs   (Pillow 필요)
"""
import base64
import json
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

CW, CH = 9, 18
PAD = 12
BG = (24, 25, 38)
MONO = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 14)
HANGUL = ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc', 14)
LIST_FG = (200, 200, 215)


def rgb(c: int) -> tuple[int, int, int]:
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def draw_raster(img: Image.Image, cells: bytes, cols: int, rows: int) -> None:
    d = ImageDraw.Draw(img)
    words = struct.unpack(f'<{cols * rows * 3}I', cells)
    for cy in range(rows):
        for cx in range(cols):
            i = (cy * cols + cx) * 3
            ch, fg, bg = words[i], words[i + 1], words[i + 2]
            x, y = PAD + cx * CW, PAD + cy * CH
            if ch == 0x2580:
                d.rectangle([x, y, x + CW - 1, y + CH // 2 - 1], fill=rgb(fg))
                d.rectangle([x, y + CH // 2, x + CW - 1, y + CH - 1], fill=rgb(bg))
            else:
                d.rectangle([x, y, x + CW - 1, y + CH - 1], fill=rgb(bg))
                if ch != 32:
                    d.text((x, y + 1), chr(ch), font=MONO, fill=rgb(fg))


def draw_list(img: Image.Image, lines: list[str], top: int) -> None:
    d = ImageDraw.Draw(img)
    for n, line in enumerate(lines):
        x, y = PAD, top + n * (CH + 2)
        for ch in line:
            font = HANGUL if ord(ch) > 0x2000 else MONO
            d.text((x, y), ch, font=font, fill=LIST_FG)
            x += d.textlength(ch, font=font)


def main() -> None:
    data = json.loads(Path(sys.argv[1]).read_text())
    out = Path(sys.argv[2])
    cols, rows, frames, lines = data['columns'], data['rows'], data['frames'], data['list']
    width = PAD * 2 + cols * CW
    plan_h = PAD + rows * CH
    still_h = plan_h + PAD + len(lines) * (CH + 2) + PAD

    # 정지 화면: 사람들이 다 자리에 앉은 뒤의 한 장 + 패널 아래 목록
    still = Image.new('RGB', (width, still_h), BG)
    draw_raster(still, base64.b64decode(frames[-1]), cols, rows)
    draw_list(still, lines, plan_h + PAD)
    still.save(out / 'office.png', optimize=True)

    # 움직이는 화면: 평면도만, 실제와 같은 0.2초 간격
    gif = []
    for f in frames:
        img = Image.new('RGB', (width, plan_h + PAD), BG)
        draw_raster(img, base64.b64decode(f), cols, rows)
        gif.append(img.convert('P', palette=Image.ADAPTIVE, colors=128))
    gif[0].save(out / 'office.gif', save_all=True, append_images=gif[1:], duration=200, loop=0, optimize=True)


if __name__ == '__main__':
    main()
