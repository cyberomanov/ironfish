/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { DecryptedNotesValue, DecryptedNotesValueEncoding, NOTE_SIZE } from './decryptedNotes'

describe('DecryptedNotesValueEncoding', () => {
  describe('with a null note index and nullifier hash', () => {
    it('serializes the object into a buffer and deserializes to the original object', () => {
      const encoder = new DecryptedNotesValueEncoding()

      const value: DecryptedNotesValue = {
        accountId: 'uuid',
        noteIndex: null,
        nullifierHash: null,
        spent: false,
        serializedNote: Buffer.alloc(NOTE_SIZE, 1),
        transactionHash: Buffer.alloc(32, 1),
      }
      const buffer = encoder.serialize(value)
      const deserializedValue = encoder.deserialize(buffer)
      expect(deserializedValue).toEqual(value)
    })
  })

  describe('with all fields defined', () => {
    it('serializes the object into a buffer and deserializes to the original object', () => {
      const encoder = new DecryptedNotesValueEncoding()

      const value: DecryptedNotesValue = {
        accountId: 'uuid',
        spent: true,
        noteIndex: 40,
        nullifierHash: Buffer.alloc(32, 1).toString('hex'),
        serializedNote: Buffer.alloc(NOTE_SIZE, 1),
        transactionHash: Buffer.alloc(32, 1),
      }
      const buffer = encoder.serialize(value)
      const deserializedValue = encoder.deserialize(buffer)
      expect(deserializedValue).toEqual(value)
    })
  })
})