/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { Asset } from '@ironfish/rust-nodejs'
import {
  CurrencyUtils,
  GetAccountTransactionsResponse,
  TimeUtils,
  TransactionType,
} from '@ironfish/sdk'
import { CliUx, Flags } from '@oclif/core'
import { IronfishCommand } from '../../command'
import { RemoteFlags } from '../../flags'

export class TransactionsCommand extends IronfishCommand {
  static description = `Display the account transactions`

  static flags = {
    ...RemoteFlags,
    ...CliUx.ux.table.flags(),
    hash: Flags.string({
      char: 't',
      description: 'Transaction hash to get details for',
    }),
    limit: Flags.integer({
      description: 'Number of latest transactions to get details for',
    }),
    confirmations: Flags.integer({
      description: 'Number of block confirmations needed to confirm a transaction',
    }),
  }

  static args = [
    {
      name: 'account',
      parse: (input: string): Promise<string> => Promise.resolve(input.trim()),
      required: false,
      description: 'Name of the account',
    },
  ]

  async start(): Promise<void> {
    const { flags, args } = await this.parse(TransactionsCommand)
    const account = args.account as string | undefined

    const client = await this.sdk.connectRpc()
    const response = client.getAccountTransactionsStream({
      account,
      hash: flags.hash,
      limit: flags.limit,
      confirmations: flags.confirmations,
    })

    let showHeader = true
    let rowNumber = 1

    for await (const transaction of response.contentStream()) {
      const transactionHeader = this.getTransactionHeader(transaction, rowNumber++)

      const transactionRows: TransactionRow[] = []
      for (const { assetId, delta } of transaction.assetBalanceDeltas) {
        if (assetId === Asset.nativeId().toString('hex')) {
          continue
        }

        transactionRows.push({ assetId, amount: BigInt(delta) })
      }

      CliUx.ux.table(
        [transactionHeader, ...transactionRows],
        {
          rowNumber: {
            header: '#',
            minWidth: 4,
          },
          timestamp: {
            header: 'Timestamp',
            get: (row) => (row.timestamp ? TimeUtils.renderString(row.timestamp) : ''),
            minWidth: 26,
            extended: true,
          },
          status: {
            header: 'Status',
            minWidth: 12,
          },
          type: {
            header: 'Type',
            minWidth: 8,
          },
          hash: {
            header: 'Hash',
          },
          assetId: {
            header: 'Asset ID',
          },
          amount: {
            header: 'Net Amount',
            get: (row) => (row.amount !== 0n ? CurrencyUtils.renderIron(row.amount) : ''),
            minWidth: 20,
          },
          feePaid: {
            header: 'Fee Paid ($IRON)',
            get: (row) =>
              row.feePaid && row.feePaid !== 0n ? CurrencyUtils.renderIron(row.feePaid) : '',
            minWidth: 20,
          },
          notesCount: {
            header: 'Notes',
            minWidth: 5,
            extended: true,
          },
          spendsCount: {
            header: 'Spends',
            minWidth: 5,
            extended: true,
          },
          mintsCount: {
            header: 'Mints',
            minWidth: 5,
            extended: true,
          },
          burnsCount: {
            header: 'Burns',
            minWidth: 5,
            extended: true,
          },
          expiration: {
            header: 'Expiration',
          },
        },
        {
          printLine: this.log.bind(this),
          ...flags,
          'no-header': !showHeader,
        },
      )

      showHeader = false
    }
  }

  getTransactionHeader(
    transaction: GetAccountTransactionsResponse,
    rowNumber?: number,
  ): TransactionRow {
    const assetId = Asset.nativeId().toString('hex')

    const nativeAssetBalanceDelta = transaction.assetBalanceDeltas.find(
      (d) => d.assetId === assetId,
    )

    let amount = BigInt(nativeAssetBalanceDelta?.delta ?? '0')

    let feePaid = BigInt(transaction.fee)

    if (transaction.type !== TransactionType.SEND) {
      feePaid = 0n
    } else {
      amount += feePaid
    }

    return {
      ...transaction,
      rowNumber,
      assetId,
      amount,
      feePaid,
    }
  }
}

type TransactionRow = {
  rowNumber?: number
  timestamp?: number
  status?: string
  type?: string
  hash?: string
  assetId: string
  amount: bigint
  feePaid?: bigint
  notesCount?: number
  spendsCount?: number
  mintsCount?: number
  burnsCount?: number
  expiration?: number
}
