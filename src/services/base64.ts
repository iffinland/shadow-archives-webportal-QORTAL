/**
 * Base64 helpers for the QDN write path.
 *
 * QDN writes send bytes as base64 in the bridge `data64` field (Core/Hub verified
 * field name). Everything here is browser-native; no dependency is added.
 */

/** Encode one Blob/File as bare base64 (no data-URL prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

/** Encode UTF-8 text as base64 without a data-URL prefix. */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Encode bytes as base64, chunked so large payloads cannot overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const chunk = bytes.subarray(offset, offset + CHUNK);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
