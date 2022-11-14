/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import type { Blockchain } from './blockchain'
import { Assert } from './assert'
import { Event } from './event'
import { createRootLogger, Logger } from './logger'
import { LocalBlockHeader } from './primitives/blockheader'

/**
 * This is used to get a non synchronous chain of block events from the blockchain
 * As blocks are added and removed, this system will call onAdd() and onRemove() in
 * a guaranteed correct order. If you have this chain:
 *      G -> A1
 *
 * You'll get
 *  - onAdd(G)
 *  - onAdd(A1)
 *
 * If you then reorg and have received
 *      G -> A1
 *        -> B1 -> B2
 *
 * - onAdd(G)
 * - onAdd(A1)
 * - onRemove(A1)
 * - onAdd(B1)
 * - onAdd(B2)
 */
export class ChainProcessor {
  chain: Blockchain
  // TODO: Consider refactoring to store a BlockHeader rather than a hash + sequence
  hash: Buffer | null = null
  sequence: number | null = null
  logger: Logger
  onAdd = new Event<[block: LocalBlockHeader]>()
  onRemove = new Event<[block: LocalBlockHeader]>()

  constructor(options: { logger?: Logger; chain: Blockchain; head: Buffer | null }) {
    this.chain = options.chain
    this.logger = (options.logger ?? createRootLogger()).withTag('chainprocessor')
    this.hash = options.head
  }

  private async add(header: LocalBlockHeader): Promise<void> {
    await this.onAdd.emitAsync(header)
  }

  private async remove(header: LocalBlockHeader): Promise<void> {
    await this.onRemove.emitAsync(header)
  }

  async update({ signal }: { signal?: AbortSignal } = {}): Promise<{ hashChanged: boolean }> {
    const oldHash = this.hash

    if (!this.hash) {
      await this.add(this.chain.genesis)
      this.hash = this.chain.genesis.hash
      this.sequence = this.chain.genesis.sequence
    }

    // Freeze this value in case it changes while we're updating the head
    const chainHead = this.chain.head

    if (chainHead.hash.equals(this.hash)) {
      return { hashChanged: false }
    }

    const head = await this.chain.getHeader(this.hash)

    Assert.isNotNull(
      head,
      `Chain processor head not found in chain: ${this.hash.toString('hex')}`,
    )

    const { fork, isLinear } = await this.chain.findFork(head, chainHead)
    if (!fork) {
      return { hashChanged: false }
    }

    if (!isLinear) {
      const iter = this.chain.iterateFrom(head, fork, undefined, false)

      for await (const remove of iter) {
        if (signal?.aborted) {
          return { hashChanged: !oldHash || !this.hash.equals(oldHash) }
        }

        if (remove.hash.equals(fork.hash)) {
          continue
        }

        await this.remove(remove)
        this.hash = remove.previousBlockHash
        this.sequence = remove.sequence - 1
      }
    }

    const iter = this.chain.iterateTo(fork, chainHead, undefined, false)

    for await (const add of iter) {
      if (signal?.aborted) {
        return { hashChanged: !oldHash || !this.hash.equals(oldHash) }
      }

      if (add.hash.equals(fork.hash)) {
        continue
      }

      await this.add(add)
      this.hash = add.hash
      this.sequence = add.sequence
    }

    return { hashChanged: !oldHash || !this.hash.equals(oldHash) }
  }
}
