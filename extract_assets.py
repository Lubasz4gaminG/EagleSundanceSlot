"""Read the original disc image without installing or executing its software."""
from pathlib import Path
import argparse
import hashlib
import json
import struct
import zlib

ROOT = Path(__file__).resolve().parent


def logical_read(disc, sector, length):
    result = bytearray()
    while len(result) < length:
        disc.seek(sector * 2352 + 24)
        part = disc.read(min(2048, length - len(result)))
        if not part:
            raise ValueError("Incomplete disc image")
        result.extend(part)
        sector += 1
    return bytes(result)


def installer(path):
    with path.open('rb') as disc:
        pvd = logical_read(disc, 16, 2048)
        if pvd[:7] != b'\x01CD001\x01':
            raise ValueError('Expected the MODE2/2352 Casino Mega Collection disc')
        directory = logical_read(disc, struct.unpack_from('<I', pvd, 158)[0],
                                 struct.unpack_from('<I', pvd, 166)[0])
        at = 0
        while at < len(directory):
            length = directory[at]
            if not length:
                at = (at // 2048 + 1) * 2048
                continue
            record = directory[at:at + length]
            name = record[33:33 + record[32]].decode('ascii', 'replace')
            if name.upper().split(';')[0] == 'SETUP.EXE':
                return logical_read(disc, struct.unpack_from('<I', record, 2)[0],
                                    struct.unpack_from('<I', record, 10)[0])
            at += length
    raise ValueError('SETUP.EXE was not found on the disc')


def streams(data):
    # Wise's raw DEFLATE streams each end with a little-endian CRC32.
    offset = 15033
    for index in range(16):
        decoder = zlib.decompressobj(-15)
        position, parts, size = offset, [], 0
        while not decoder.eof:
            part = data[position:position + 65536]
            if not part:
                raise ValueError('Truncated installer stream')
            position += len(part)
            unpacked = decoder.decompress(part, 512 * 1024 * 1024 - size + 1)
            size += len(unpacked)
            if size > 512 * 1024 * 1024:
                raise ValueError('Unexpected stream size')
            parts.append(unpacked)
        end = position - len(decoder.unused_data)
        unpacked = b''.join(parts)
        if zlib.crc32(unpacked) != struct.unpack_from('<I', data, end)[0]:
            raise ValueError(f'CRC mismatch in stream {index}')
        if index in (12, 15):
            yield index, unpacked
        offset = end + 4


def entries(data):
    count = struct.unpack_from('<I', data)[0]
    table_end = 32 + count * 288
    if table_end > len(data):
        raise ValueError('Invalid resource directory')
    for index in range(count):
        at = 32 + index * 288
        name = data[at:at + 256].split(b'\0')[0].decode('ascii')
        start, _, size = struct.unpack_from('<III', data, at + 256)
        if not table_end <= start <= start + size <= len(data):
            raise ValueError('Resource lies outside the bundle')
        yield name, data[start:start + size]


def game_data(exe):
    pe = struct.unpack_from('<I', exe, 60)[0]
    optional = pe + 24
    base = struct.unpack_from('<I', exe, optional + 28)[0]
    sections = optional + struct.unpack_from('<H', exe, pe + 20)[0]

    def read(address, size):
        for index in range(struct.unpack_from('<H', exe, pe + 6)[0]):
            at = sections + index * 40
            _, va, length, offset = struct.unpack_from('<IIII', exe, at + 8)
            relative = address - base - va
            if 0 <= relative and relative + size <= length:
                return exe[offset + relative:offset + relative + size]
        raise ValueError('Game table address outside executable')

    payouts = [list(struct.unpack('<6h', read(0x549c90 + i * 12, 12))) for i in range(28)]
    reels = [list(struct.unpack('<28h', read(0x54a228 + i * 56, 56))) for i in range(5)]
    if payouts[0] != [0, 0, 0, 0, 0, 4000] or any(not 0 <= s <= 7 for r in reels for s in r):
        raise ValueError('This edition has different game data')
    return dict(reels=reels, payouts=payouts,
                lines=[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
                       [0,0,1,2,2],[2,2,1,0,0],[0,1,2,1,0],
                       [2,1,0,1,2],[1,0,0,0,1],[1,2,2,2,1]],
                denominations=[5,25,100,500,2500,10000],
                bonusValues=[0,1,1,1,1,1,1,2,2,2,3,3,4,5])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('disc', nargs='?', type=Path, default=Path.home() / 'Downloads' /
                        'CasinoMegaCollection' / 'Casino Mega Collection (2015).bin')
    args = parser.parse_args()
    assets = ROOT / 'assets'
    assets.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index, data in streams(installer(args.disc)):
        if index == 12:
            rules = game_data(data)
            (assets / 'game-data.js').write_text('"use strict";\nconst WOLF_DATA = ' +
                json.dumps(rules, separators=(',', ':')) + ';\n', encoding='utf-8')
            continue
        for source, payload in entries(data):
            lower = source.lower().replace('\\', '/')
            name = lower.rsplit('/', 1)[-1]
            selected = ('/games/slots/' in lower and lower.count('/games/slots/') == 1
                        and '/' not in lower.split('/games/slots/')[1]
                        and name.endswith('.png')) or name == 'guide_slots.xml'
            if not selected:
                continue
            (assets / name).write_bytes(payload)
            manifest.append(dict(file=name, source=source, bytes=len(payload),
                                 sha256=hashlib.sha256(payload).hexdigest()))
    (assets / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f'Extracted {len(manifest)} Siberian Wolf/shared resources and original game tables.')


if __name__ == '__main__':
    main()
