#!/usr/bin/env python3
"""Shrink a raw Meshy .glb into a Midway booth prop (spec section 8, "Mandatory Mobile Optimization").

  python3 scripts/optimize-midway-glb.py RAW.glb OUT.glb --texture 512|1024

- Textures are resized to at most --texture pixels and re-encoded as WebP (EXT_texture_webp, which
  Three.js's GLTFLoader reads); normal maps keep more quality than colour maps.
- The model is centred on X/Z with its base at y = 0 and scaled so its largest side is 1 unit; each
  booth then fits the prop to the size it needs, so the files never have to agree on real-world scale.
- Geometry is left as Meshy made it (already at the spec's polygon budget). Draco compression is not
  applied: no encoder is available without npm packages, and the props stay under the 3 MB budget
  without it. Warns if a file is over 3 MB.

Needs only Python 3, Pillow and NumPy.
"""
import argparse
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

BUDGET = 3 * 1024 * 1024


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<III', data[:12])
    if magic != 0x46546C67 or version != 2:
        raise SystemExit(f'{path}: not a glTF 2.0 binary')
    off = 12
    doc = None
    blob = b''
    while off < len(data):
        length, kind = struct.unpack('<II', data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if kind == 0x4E4F534A:
            doc = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
        off += 8 + length
    return doc, blob


def view_bytes(doc, blob, index):
    v = doc['bufferViews'][index]
    start = v.get('byteOffset', 0)
    return blob[start:start + v['byteLength']]


def accessor_array(doc, blob, index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride')
    item = np.dtype(dtype).itemsize * comps
    if stride and stride != item:
        raw = np.frombuffer(blob, dtype=np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)[:, :item]
        return np.frombuffer(raw.tobytes(), dtype=dtype).reshape(a['count'], comps)
    return np.frombuffer(blob, dtype=dtype, count=a['count'] * comps, offset=start).reshape(a['count'], comps)


def texture_roles(doc):
    roles = {}
    for m in doc.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        for key, role in (('baseColorTexture', 'color'), ('metallicRoughnessTexture', 'data')):
            if key in pbr:
                roles[doc['textures'][pbr[key]['index']]['source']] = role
        for key, role in (('normalTexture', 'normal'), ('occlusionTexture', 'data'), ('emissiveTexture', 'color')):
            if key in m:
                roles[doc['textures'][m[key]['index']]['source']] = role
    return roles


def optimize(src, dst, max_size):
    doc, blob = read_glb(src)
    roles = texture_roles(doc)

    # 1. new images
    new_images = {}
    for i, im in enumerate(doc.get('images', [])):
        img = Image.open(io.BytesIO(view_bytes(doc, blob, im['bufferView'])))
        img = img.convert('RGBA' if img.mode in ('RGBA', 'LA', 'P') else 'RGB')
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        out = io.BytesIO()
        role = roles.get(i, 'color')
        img.save(out, 'WEBP', quality=92 if role == 'normal' else 80, method=6)
        new_images[i] = out.getvalue()

    # 2. rebuild the binary chunk: every non-image view as is, then the new images
    image_views = {im['bufferView'] for im in doc.get('images', [])}
    parts = []
    size = 0
    remap = {}
    def push(raw):
        nonlocal size
        pad = (-size) % 4
        if pad:
            parts.append(b'\0' * pad)
            size += pad
        at = size
        parts.append(raw)
        size += len(raw)
        return at
    views = []
    for i, v in enumerate(doc['bufferViews']):
        if i in image_views:
            continue
        nv = dict(v)
        nv['byteOffset'] = push(view_bytes(doc, blob, i))
        remap[i] = len(views)
        views.append(nv)
    for i, im in enumerate(doc.get('images', [])):
        at = push(new_images[i])
        views.append({'buffer': 0, 'byteOffset': at, 'byteLength': len(new_images[i])})
        im['bufferView'] = len(views) - 1
        im['mimeType'] = 'image/webp'
    for a in doc['accessors']:
        if 'bufferView' in a:
            a['bufferView'] = remap[a['bufferView']]
    doc['bufferViews'] = views
    doc['buffers'] = [{'byteLength': size}]

    # textures point at their WebP through EXT_texture_webp
    for t in doc.get('textures', []):
        src_index = t.pop('source')
        t.setdefault('extensions', {})['EXT_texture_webp'] = {'source': src_index}
    for key in ('extensionsUsed', 'extensionsRequired'):
        doc[key] = sorted(set(doc.get(key, [])) | {'EXT_texture_webp'})

    # 3. base at y = 0, centred on X/Z, largest side 1 unit (applied as a wrapper node)
    lo = np.array([np.inf] * 3)
    hi = -lo
    for m in doc['meshes']:
        for p in m['primitives']:
            pos = accessor_array(doc, blob if False else b''.join(parts), p['attributes']['POSITION'])
            lo = np.minimum(lo, pos.min(axis=0))
            hi = np.maximum(hi, pos.max(axis=0))
    scale = 1.0 / float(max(hi - lo))
    centre = (lo + hi) / 2
    t = [-centre[0] * scale, -lo[1] * scale, -centre[2] * scale]
    scene = doc['scenes'][doc.get('scene', 0)]
    doc['nodes'].append({'name': 'midway-fit', 'children': list(scene['nodes']), 'translation': t, 'scale': [scale] * 3})
    scene['nodes'] = [len(doc['nodes']) - 1]
    doc.setdefault('asset', {})['generator'] = 'Meshy + belpire-site optimize-midway-glb.py'

    # 4. write
    body = b''.join(parts)
    body += b'\0' * ((-len(body)) % 4)
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * ((-len(text)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(body))
    out += struct.pack('<II', len(text), 0x4E4F534A) + text
    out += struct.pack('<II', len(body), 0x004E4942) + body
    open(dst, 'wb').write(out)
    return len(out), (hi - lo) * scale


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--texture', type=int, default=1024, choices=[512, 1024])
    a = ap.parse_args()
    size, dims = optimize(a.src, a.dst, a.texture)
    print(f'{a.dst}: {size / 1024:.0f} KB, {dims[0]:.2f} x {dims[1]:.2f} x {dims[2]:.2f}')
    if size > BUDGET:
        print(f'warning: {a.dst} is over the 3 MB budget', file=sys.stderr)


if __name__ == '__main__':
    main()
