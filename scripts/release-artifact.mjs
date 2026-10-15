import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

export function manifestFromZip(bytes) {
  let end = -1;
  for (let position = bytes.length - 22; position >= Math.max(0, bytes.length - 65557); position--) {
    if (bytes.readUInt32LE(position) === 0x06054b50 && position + 22 + bytes.readUInt16LE(position + 20) === bytes.length) { end = position; break; }
  }
  assert.ok(end >= 0, 'Invalid ZIP end record.');
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'Split ZIP files are not supported.');
  assert.equal(bytes.readUInt16LE(end + 6), 0, 'Split ZIP files are not supported.');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralStart = bytes.readUInt32LE(end + 16);
  assert.ok(count > 0 && count < 1000, 'Unexpected ZIP entry count.');
  assert.equal(centralStart + centralSize, end, 'Invalid ZIP central directory.');
  let position = centralStart, manifest;
  const names = new Set();
  for (let entry = 0; entry < count; entry++) {
    assert.ok(position + 46 <= end, 'Truncated ZIP central directory.');
    assert.equal(bytes.readUInt32LE(position), 0x02014b50, 'Invalid ZIP directory entry.');
    const flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10);
    const compressedSize = bytes.readUInt32LE(position + 20), originalSize = bytes.readUInt32LE(position + 24);
    const nameSize = bytes.readUInt16LE(position + 28), extraSize = bytes.readUInt16LE(position + 30), commentSize = bytes.readUInt16LE(position + 32);
    const local = bytes.readUInt32LE(position + 42), next = position + 46 + nameSize + extraSize + commentSize;
    assert.ok(next <= end, 'Truncated ZIP entry.');
    const name = bytes.subarray(position + 46, position + 46 + nameSize).toString('utf8');
    assert.ok(name && !name.includes('\\') && !name.startsWith('/') && !/^[A-Za-z]:/.test(name)
      && !name.split('/').some(part => part === '..' || part === '.' || !part) && !names.has(name), 'Unsafe or duplicate ZIP path.');
    names.add(name);
    assert.equal(flags & 1, 0, 'Encrypted ZIP files are not supported.');
    assert.ok([0, 8].includes(method), 'Unsupported ZIP compression.');
    assert.ok(local + 30 <= centralStart, 'Invalid ZIP local header.');
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'Invalid ZIP local header.');
    const localNameSize = bytes.readUInt16LE(local + 26), localExtraSize = bytes.readUInt16LE(local + 28);
    const body = local + 30 + localNameSize + localExtraSize;
    assert.ok(body + compressedSize <= centralStart, 'Truncated ZIP file.');
    assert.equal(bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8'), name, 'ZIP headers disagree on file name.');
    if (name === 'manifest.json') {
      assert.ok(originalSize > 0 && originalSize < 1024 * 1024, 'Unexpected manifest size.');
      const compressed = bytes.subarray(body, body + compressedSize);
      const data = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 1024 * 1024 });
      assert.equal(data.length, originalSize, 'Manifest size mismatch.');
      manifest = JSON.parse(data.toString('utf8'));
    }
    position = next;
  }
  assert.equal(position, end, 'ZIP directory size mismatch.');
  assert.ok(manifest, 'ZIP must contain manifest.json at its root.');
  return manifest;
}
