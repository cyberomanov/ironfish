/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

jest.mock('ws')
jest.mock('../network')

import '../testUtilities/matchers/blockchain'
import { BlockHeader } from '../primitives'
import { Target } from '../primitives/target'
import {
  createNodeTest,
  useBlockWithTx,
  useMinerBlockFixture,
  useTxSpendsFixture,
} from '../testUtilities'
import { makeBlockAfter } from '../testUtilities/helpers/blockchain'
import { VerificationResultReason } from './verifier'

describe('Verifier', () => {
  describe('Transaction', () => {
    const nodeTest = createNodeTest()

    it('rejects if the transaction cannot be deserialized', () => {
      expect(() =>
        nodeTest.chain.verifier.verifyNewTransaction(Buffer.alloc(32, 'hello')),
      ).toThrowError('Transaction cannot deserialize')

      expect(() =>
        nodeTest.chain.verifier.verifyNewTransaction(
          Buffer.from(JSON.stringify({ not: 'valid' })),
        ),
      ).toThrowError('Transaction cannot deserialize')
    })

    it('extracts a valid transaction', async () => {
      const { transaction: tx } = await useTxSpendsFixture(nodeTest.node)
      const serialized = nodeTest.strategy.transactionSerde.serialize(tx)

      const transaction = nodeTest.chain.verifier.verifyNewTransaction(serialized)

      expect(tx.equals(transaction)).toBe(true)
    }, 60000)
  })

  describe('Block', () => {
    const nodeTest = createNodeTest()

    it('extracts a valid block', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      const serialized = nodeTest.strategy.blockSerde.serialize(block)

      const result = await nodeTest.node.chain.verifier.verifyNewBlock(
        serialized,
        nodeTest.node.workerPool,
      )

      expect(result.block.header.hash.equals(block.header.hash)).toBe(true)

      expect(result.serializedBlock.header.previousBlockHash).toEqual(
        serialized.header.previousBlockHash,
      )
    })

    it('rejects a invalid network block', async () => {
      // should have invalid target
      nodeTest.verifier.enableVerifyTarget = true

      const block = await useMinerBlockFixture(nodeTest.chain)
      const serializedBlock = nodeTest.chain.strategy.blockSerde.serialize(block)

      await expect(
        nodeTest.chain.verifier.verifyNewBlock(serializedBlock, nodeTest.node.workerPool),
      ).rejects.toEqual('Block is invalid')
    })

    it('rejects a block with an invalid header', async () => {
      // should have invalid target
      nodeTest.verifier.enableVerifyTarget = true

      const block = await useMinerBlockFixture(nodeTest.chain)

      expect(await nodeTest.chain.verifier.verifyBlock(block)).toMatchObject({
        reason: VerificationResultReason.HASH_NOT_MEET_TARGET,
        valid: false,
      })
    })

    it('rejects a block with an invalid transaction', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)

      jest.spyOn(nodeTest.verifier, 'verifyTransaction').mockResolvedValue({
        valid: false,
        reason: VerificationResultReason.VERIFY_TRANSACTION,
      })

      expect(await nodeTest.chain.verifier.verifyBlock(block)).toMatchObject({
        reason: VerificationResultReason.VERIFY_TRANSACTION,
        valid: false,
      })
    })

    it('rejects a block with incorrect transaction fee', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      block.header.minersFee = BigInt(-1)

      expect(await nodeTest.verifier.verifyBlock(block)).toMatchObject({
        reason: VerificationResultReason.INVALID_MINERS_FEE,
        valid: false,
      })
    })

    it('accepts a valid block', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      const verification = await nodeTest.chain.verifier.verifyBlock(block)
      expect(verification.valid).toBe(true)
    })
  })

  describe('BlockHeader', () => {
    const nodeTest = createNodeTest()
    let header: BlockHeader

    beforeEach(async () => {
      header = (await useMinerBlockFixture(nodeTest.chain)).header
    })

    it('validates a valid transaction', () => {
      expect(nodeTest.verifier.verifyBlockHeader(header).valid).toBe(true)
    })

    it('fails validation when target is invalid', () => {
      nodeTest.verifier.enableVerifyTarget = true

      expect(nodeTest.verifier.verifyBlockHeader(header)).toMatchObject({
        reason: VerificationResultReason.HASH_NOT_MEET_TARGET,
        valid: false,
      })
    })

    it('fails validation when timestamp is in future', () => {
      jest.spyOn(global.Date, 'now').mockImplementationOnce(() => 1598467858637)
      header.timestamp = new Date(1598467898637)

      expect(nodeTest.verifier.verifyBlockHeader(header)).toMatchObject({
        reason: VerificationResultReason.TOO_FAR_IN_FUTURE,
        valid: false,
      })
    })

    it('fails validation if graffiti field is not equal to 32 bytes', () => {
      header.graffiti = Buffer.alloc(31)

      expect(nodeTest.verifier.verifyBlockHeader(header)).toMatchObject({
        reason: VerificationResultReason.GRAFFITI,
        valid: false,
      })

      header.graffiti = Buffer.alloc(33)

      expect(nodeTest.verifier.verifyBlockHeader(header)).toMatchObject({
        reason: VerificationResultReason.GRAFFITI,
        valid: false,
      })
    })
  })

  describe('hasValidSpends', () => {
    const nodeTest = createNodeTest()

    it('says the block with no spends is valid', async () => {
      const { chain, strategy } = nodeTest
      strategy.disableMiningReward()
      const block = await makeBlockAfter(chain, chain.head)
      expect((await chain.verifier.hasValidSpends(block)).valid).toBe(true)
    })

    it('says the block with spends is valid', async () => {
      const { chain } = nodeTest
      const { block } = await useBlockWithTx(nodeTest.node)
      expect((await chain.verifier.hasValidSpends(block)).valid).toBe(true)
      expect(Array.from(block.spends())).toHaveLength(1)
    }, 60000)

    it('is invalid with DOUBLE_SPEND as the reason', async () => {
      const { chain } = nodeTest
      const { block } = await useBlockWithTx(nodeTest.node)

      const spends = Array.from(block.spends())
      jest.spyOn(block, 'spends').mockImplementationOnce(function* () {
        for (const spend of spends) {
          yield spend
          yield spend
        }
      })

      expect(await chain.verifier.hasValidSpends(block)).toEqual({
        valid: false,
        reason: VerificationResultReason.DOUBLE_SPEND,
      })
    }, 60000)

    it('is invalid with ERROR as the reason', async () => {
      const { block } = await useBlockWithTx(nodeTest.node)

      const spends = Array.from(block.spends())
      jest.spyOn(block, 'spends').mockImplementationOnce(function* () {
        for (const spend of spends) {
          yield spend
        }
      })

      jest
        .spyOn(nodeTest.chain.notes, 'getCount')
        .mockImplementationOnce(() => Promise.resolve(0))

      expect(await nodeTest.verifier.hasValidSpends(block)).toEqual({
        valid: false,
        reason: VerificationResultReason.ERROR,
      })
    }, 60000)

    it('a block that spends a note in a previous block is invalid with INVALID_SPEND as the reason', async () => {
      const { chain } = nodeTest
      const { block, previous } = await useBlockWithTx(nodeTest.node)

      const nullifier = Buffer.alloc(32)

      await chain.nullifiers.add(nullifier)
      previous.header.nullifierCommitment.commitment = await chain.nullifiers.rootHash()
      previous.header.nullifierCommitment.size = 2

      await chain.nullifiers.add(nullifier)
      block.header.nullifierCommitment.commitment = await chain.nullifiers.rootHash()
      block.header.nullifierCommitment.size = 3

      jest.spyOn(block, 'spends').mockImplementationOnce(function* () {
        yield { nullifier, commitment: Buffer.from('1-1'), size: 1 }
        yield { nullifier, commitment: Buffer.from('1-1'), size: 1 }
      })

      expect(await chain.verifier.hasValidSpends(block)).toEqual({
        valid: false,
        reason: VerificationResultReason.INVALID_SPEND,
      })
    }, 60000)

    it('a block that spends a note never in the tree is invalid with INVALID_SPEND as the reason', async () => {
      const { chain } = nodeTest
      const { block } = await useBlockWithTx(nodeTest.node)

      const nullifier = Buffer.alloc(32)
      jest.spyOn(block, 'spends').mockImplementationOnce(function* () {
        yield { nullifier, commitment: Buffer.from('noooo'), size: 1 }
      })

      expect(await chain.verifier.hasValidSpends(block)).toEqual({
        valid: false,
        reason: VerificationResultReason.INVALID_SPEND,
      })
    }, 60000)
  })

  describe('validAgainstPrevious', () => {
    const nodeTest = createNodeTest()

    it('is valid', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)

      expect(
        nodeTest.verifier.isValidAgainstPrevious(block, nodeTest.chain.genesis),
      ).toMatchObject({
        valid: true,
      })
    }, 30000)

    it('is invalid when the target is wrong', async () => {
      nodeTest.verifier.enableVerifyTarget = true
      const block = await useMinerBlockFixture(nodeTest.chain)
      block.header.target = Target.minTarget()

      expect(
        nodeTest.verifier.isValidAgainstPrevious(block, nodeTest.chain.genesis),
      ).toMatchObject({
        valid: false,
        reason: VerificationResultReason.INVALID_TARGET,
      })
    }, 30000)

    it("is invalid when the note commitments aren't the same size", async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      block.header.noteCommitment.size = 1000

      expect(
        nodeTest.verifier.isValidAgainstPrevious(block, nodeTest.chain.genesis),
      ).toMatchObject({
        valid: false,
        reason: VerificationResultReason.NOTE_COMMITMENT_SIZE,
      })
    }, 30000)

    it("is invalid when the nullifier commitments aren't the same size", async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      block.header.nullifierCommitment.size = 1000

      expect(
        nodeTest.verifier.isValidAgainstPrevious(block, nodeTest.chain.genesis),
      ).toMatchObject({
        valid: false,
        reason: VerificationResultReason.NULLIFIER_COMMITMENT_SIZE,
      })
    }, 30000)

    it('Is invalid when the timestamp is in past', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      block.header.timestamp = new Date(0)

      expect(
        nodeTest.verifier.isValidAgainstPrevious(block, nodeTest.chain.genesis),
      ).toMatchObject({
        valid: false,
        reason: VerificationResultReason.BLOCK_TOO_OLD,
      })
    }, 30000)

    it('Is invalid when the sequence is wrong', async () => {
      const block = await useMinerBlockFixture(nodeTest.chain)
      block.header.sequence = 9999

      expect(
        nodeTest.verifier.isValidAgainstPrevious(block, nodeTest.chain.genesis),
      ).toMatchObject({
        valid: false,
        reason: VerificationResultReason.SEQUENCE_OUT_OF_ORDER,
      })
    }, 30000)
  })

  describe('blockMatchesTree', () => {
    const nodeTest = createNodeTest()

    it('is true for block that passes all checks', async () => {
      await expect(
        nodeTest.verifier.blockMatchesTrees(nodeTest.chain.genesis),
      ).resolves.toMatchObject({
        valid: true,
      })
    })

    it("is false if there aren't enough notes in the tree", async () => {
      await nodeTest.chain.notes.truncate((await nodeTest.chain.notes.size()) - 1)

      await expect(
        nodeTest.verifier.blockMatchesTrees(nodeTest.chain.genesis),
      ).resolves.toMatchObject({
        valid: false,
        reason: VerificationResultReason.NOTE_COMMITMENT_SIZE,
      })
    })

    it("is false if there aren't enough nullifiers in the tree", async () => {
      await nodeTest.chain.nullifiers.truncate((await nodeTest.chain.nullifiers.size()) - 1)

      await expect(
        nodeTest.verifier.blockMatchesTrees(nodeTest.chain.genesis),
      ).resolves.toMatchObject({
        valid: false,
        reason: VerificationResultReason.NULLIFIER_COMMITMENT_SIZE,
      })
    })

    it('is false if the note hash is incorrect', async () => {
      nodeTest.chain.genesis.noteCommitment.commitment = Buffer.alloc(
        nodeTest.chain.genesis.noteCommitment.commitment.length,
        'NOOO',
      )

      await expect(
        nodeTest.verifier.blockMatchesTrees(nodeTest.chain.genesis),
      ).resolves.toMatchObject({
        valid: false,
        reason: VerificationResultReason.NOTE_COMMITMENT,
      })
    })

    it('is false for block that has incorrect nullifier hash', async () => {
      nodeTest.chain.genesis.nullifierCommitment.commitment = Buffer.alloc(
        nodeTest.chain.genesis.nullifierCommitment.commitment.length,
        'NOOO',
      )

      await expect(
        nodeTest.verifier.blockMatchesTrees(nodeTest.chain.genesis),
      ).resolves.toMatchObject({
        valid: false,
        reason: VerificationResultReason.NULLIFIER_COMMITMENT,
      })
    })
  })
})
