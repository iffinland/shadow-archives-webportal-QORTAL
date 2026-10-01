import { describe, expect, it } from 'vitest';

import {
  buildQtubeVideoMetadata,
  isValidQtubeVideoMetadata,
  isValidQtubeVideoReference,
  parseQtubeMetadataIdentifier,
  parseQtubeVideoIdentifier,
  QTUBE_CATEGORY_OTHER_ID,
  QTUBE_METADATA_IDENTIFIER_SUFFIX,
  QTUBE_VIDEO_DISCOVERY_REQUEST,
  QTUBE_VIDEO_IDENTIFIER_BASE,
  qtubeCategoryIdFor,
  qtubeCommentsId,
  qtubeCoreMetadataDescription,
  qtubeMetadataIdentifier,
  qtubeVideoIdentifier,
  QTUBE_TOP_LEVEL_CATEGORIES,
} from './qtubeVideoContract';

const ID = 'abcdefghijkl';

/* -------------------------------------------------------------------------- */
/* Identifier family                                                          */
/* -------------------------------------------------------------------------- */

describe('Q-Tube identifier family', () => {
  it('builds the exact current Q-Tube identifier shapes', () => {
    expect(QTUBE_VIDEO_IDENTIFIER_BASE).toBe('qtube_vid_');
    expect(QTUBE_METADATA_IDENTIFIER_SUFFIX).toBe('_metadata');
    expect(qtubeVideoIdentifier(ID)).toBe('qtube_vid_abcdefghijkl');
    expect(qtubeMetadataIdentifier(ID)).toBe('qtube_vid_abcdefghijkl_metadata');
  });

  it('round-trips the media identifier and the metadata identifier', () => {
    expect(parseQtubeVideoIdentifier(qtubeVideoIdentifier(ID))).toBe(ID);
    expect(parseQtubeMetadataIdentifier(qtubeMetadataIdentifier(ID))).toBe(ID);
  });

  it('keeps the two parsers disjoint so a metadata id is never a media id', () => {
    expect(parseQtubeVideoIdentifier(qtubeMetadataIdentifier(ID))).toBeNull();
    expect(parseQtubeMetadataIdentifier(qtubeVideoIdentifier(ID))).toBeNull();
  });

  it('rejects foreign and malformed identifiers', () => {
    expect(parseQtubeMetadataIdentifier('saw_vid_abcdefghijkl')).toBeNull();
    expect(parseQtubeMetadataIdentifier('qtube_vid_abc_metadata')).toBeNull();
    expect(parseQtubeMetadataIdentifier('qtube_vid_abcdefghijkl')).toBeNull();
    expect(parseQtubeVideoIdentifier('qtube_vid_abc')).toBeNull();
    expect(parseQtubeVideoIdentifier('qtube_playlist_abcdefghijkl')).toBeNull();
    expect(parseQtubeMetadataIdentifier(null)).toBeNull();
    expect(parseQtubeVideoIdentifier(undefined)).toBeNull();
  });

  it('leaves room for Q-Tube-owned identifiers outside this app id shape', () => {
    // Q-Tube's own ids are their own; the Shadow Archives parser only claims
    // identifiers that carry a Shadow Archives stable id.
    expect(
      parseQtubeMetadataIdentifier('qtube_vid_9-11-predicted-in-the-media_9uye3r_metadata'),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Validity gate (mirrors q-tube/src/utils/checkStructure.ts)                  */
/* -------------------------------------------------------------------------- */

function validPayload(): Record<string, unknown> {
  return {
    title: 'Harbour at dusk',
    version: 1,
    fullDescription: 'A wide shot from the pier.',
    htmlDescription: 'A wide shot from the pier.',
    videoImage: 'data:image/webp;base64,AAAA',
    videoReference: {
      name: 'Shadow Archives',
      identifier: qtubeVideoIdentifier(ID),
      service: 'VIDEO',
    },
    extracts: ['data:image/webp;base64,AAAA'],
    commentsId: qtubeCommentsId('abcde'),
    category: '9',
    subcategory: '',
    code: 'abcde',
    videoType: 'video/mp4',
    filename: 'harbour.mp4',
    fileSize: 4096,
    duration: 12.5,
  };
}

describe('isValidQtubeVideoMetadata — Q-Tube parity', () => {
  it('accepts a payload with every field Q-Tube writes', () => {
    expect(isValidQtubeVideoMetadata(validPayload())).toBe(true);
  });

  it('requires title, videoReference and filename (the Q-Tube required fields)', () => {
    for (const field of ['title', 'videoReference', 'filename'] as const) {
      const payload = validPayload();
      delete payload[field];
      expect(isValidQtubeVideoMetadata(payload), `missing ${field}`).toBe(false);
    }
    expect(isValidQtubeVideoMetadata({ ...validPayload(), title: '   ' })).toBe(false);
    expect(isValidQtubeVideoMetadata({ ...validPayload(), filename: '' })).toBe(false);
  });

  it('rejects a videoReference that is not a Qortal service reference', () => {
    expect(
      isValidQtubeVideoMetadata({
        ...validPayload(),
        videoReference: { name: 'n', identifier: 'i', service: 'NOT_A_SERVICE' },
      }),
    ).toBe(false);
    expect(
      isValidQtubeVideoMetadata({
        ...validPayload(),
        videoReference: { name: '', identifier: 'i', service: 'VIDEO' },
      }),
    ).toBe(false);
  });

  it('treats duration and fileSize as optional (legacy Q-Tube videos)', () => {
    const legacy = validPayload();
    delete legacy.duration;
    delete legacy.fileSize;
    expect(isValidQtubeVideoMetadata(legacy)).toBe(true);
  });

  it('rejects a negative or non-numeric duration when present', () => {
    expect(isValidQtubeVideoMetadata({ ...validPayload(), duration: -1 })).toBe(false);
    expect(isValidQtubeVideoMetadata({ ...validPayload(), duration: 'twelve' })).toBe(false);
    expect(isValidQtubeVideoMetadata({ ...validPayload(), duration: Number.NaN })).toBe(false);
  });

  it('never throws on hostile input', () => {
    for (const value of [null, undefined, 0, 'x', [], true]) {
      expect(isValidQtubeVideoMetadata(value)).toBe(false);
    }
  });

  it('validates a bare media reference independently', () => {
    expect(isValidQtubeVideoReference({ name: 'n', identifier: 'i', service: 'VIDEO' })).toBe(true);
    expect(isValidQtubeVideoReference({ name: 'n', identifier: '', service: 'VIDEO' })).toBe(false);
    expect(isValidQtubeVideoReference(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Metadata construction                                                      */
/* -------------------------------------------------------------------------- */

describe('buildQtubeVideoMetadata', () => {
  it('produces a payload that passes the validity gate and points at the media resource', () => {
    const payload = buildQtubeVideoMetadata({
      title: '  Harbour at dusk  ',
      description: 'A wide shot from the pier.',
      thumbnailDataUrl: 'data:image/webp;base64,AAAA',
      media: { name: 'Shadow Archives', identifier: qtubeVideoIdentifier(ID), service: 'VIDEO' },
      categoryId: 9,
      code: 'abcde',
      videoType: 'video/mp4',
      filename: 'harbour.mp4',
      fileSize: 4096,
      durationSeconds: 12.5,
    });
    expect(payload.title).toBe('Harbour at dusk');
    expect(payload.version).toBe(1);
    expect(isValidQtubeVideoMetadata(payload)).toBe(true);
    expect(payload.videoReference.identifier).toBe('qtube_vid_abcdefghijkl');
    expect(payload.commentsId).toBe('qtube_vid__cm_abcde');
    expect(payload.extracts).toHaveLength(1);
    expect(payload.extracts[0]).toBe('data:image/webp;base64,AAAA');
  });

  it('falls back to plain text for htmlDescription and never claims a frame without a poster', () => {
    const payload = buildQtubeVideoMetadata({
      title: 'T',
      description: 'Plain description',
      thumbnailDataUrl: null,
      media: { name: 'n', identifier: 'i', service: 'VIDEO' },
      categoryId: 99,
      code: 'abcde',
      videoType: 'video/mp4',
      filename: 'f.mp4',
      fileSize: 1,
      durationSeconds: 1,
    });
    expect(payload.htmlDescription).toBe('Plain description');
    expect(payload.videoImage).toBeNull();
    expect(payload.extracts).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Category mirror                                                            */
/* -------------------------------------------------------------------------- */

describe('Q-Tube category mapping', () => {
  it('mirrors the pinned numeric table', () => {
    expect(QTUBE_TOP_LEVEL_CATEGORIES[0]).toEqual({ id: 1, name: 'Movies' });
    expect(QTUBE_TOP_LEVEL_CATEGORIES.at(-1)).toEqual({ id: 99, name: 'Other' });
    expect(QTUBE_CATEGORY_OTHER_ID).toBe(99);
  });

  it('maps Shadow Archives labels onto the Q-Tube id case-insensitively', () => {
    expect(qtubeCategoryIdFor(['Qortal'])).toBe(26);
    expect(qtubeCategoryIdFor(['qortal'])).toBe(26);
    expect(qtubeCategoryIdFor(['News & Politics'])).toBe(9);
    expect(qtubeCategoryIdFor(['news and politics'])).toBe(9);
    expect(qtubeCategoryIdFor(['DIY & Crafts'])).toBe(14);
  });

  it('prefers the first matching label and otherwise falls back to Other', () => {
    expect(qtubeCategoryIdFor(['Archive', 'Music', 'Qortal'])).toBe(3);
    expect(qtubeCategoryIdFor(['Archive', 'Unsorted'])).toBe(99);
    expect(qtubeCategoryIdFor([])).toBe(99);
  });
});

describe('qtubeCoreMetadataDescription', () => {
  it('writes the exact marker Q-Tube category filtering searches for', () => {
    const description = qtubeCoreMetadataDescription({
      categoryId: 9,
      code: 'abcde',
      description: 'A wide shot from the pier.',
    });
    expect(description).toBe('**category:9;subcategory:;code:abcde**A wide shot from the pier.');
  });

  it('bounds the plain-text tail to 150 characters', () => {
    const description = qtubeCoreMetadataDescription({
      categoryId: 99,
      code: 'abcde',
      description: 'x'.repeat(400),
    });
    expect(description.length).toBe('**category:99;subcategory:;code:abcde**'.length + 150);
  });
});

describe('QTUBE_VIDEO_DISCOVERY_REQUEST', () => {
  it('is the exact discovery query shape Q-Tube issues', () => {
    expect(QTUBE_VIDEO_DISCOVERY_REQUEST).toEqual({
      service: 'DOCUMENT',
      identifier: 'qtube_vid_',
      mode: 'ALL',
      reverse: true,
      limit: 20,
      offset: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Live-shape regression                                                      */
/* -------------------------------------------------------------------------- */

describe('live Q-Tube publication shape', () => {
  it('accepts a real harvested Q-Tube metadata payload unchanged', () => {
    // Field-for-field the shape returned by a live read-only node for
    // `decenter/qtube_vid_9-11-predicted-in-the-media_9uye3r_metadata`
    // (node `127.0.0.1:24991`, Core 6.1.9, 2026-09-13).
    const live = {
      title: '9/11 Predicted in the Media',
      version: 1,
      fullDescription: 'A look back at the media coverage.',
      htmlDescription: 'A look back at the media coverage.',
      videoImage: 'data:image/webp;base64,UklGRg==',
      videoReference: {
        name: 'decenter',
        identifier: 'qtube_vid_9-11-predicted-in-the-media_9uye3r',
        service: 'VIDEO',
      },
      extracts: ['data:image/webp;base64,UklGRg=='],
      commentsId: 'qtube_vid__cm_9uye3r',
      category: '9',
      subcategory: '',
      code: '9uye3r',
      videoType: 'video/mp4',
      filename: '9-11.mp4',
      fileSize: 123456,
      duration: 512.5,
    };
    expect(isValidQtubeVideoMetadata(live)).toBe(true);
    // ...and it is not mistaken for a Shadow Archives artifact.
    expect(parseQtubeMetadataIdentifier(live.videoReference.identifier + '_metadata')).toBeNull();
  });
});
