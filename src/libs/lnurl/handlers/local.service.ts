import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { auto } from 'async';
import {
  AccountCurrency,
  CallbackLocalHandlerParams,
  CallbackLocalParams,
  GetLnurlAutoType,
  GetLnUrlInvoiceAutoType,
  GetLnUrlResponseAutoType,
} from 'src/api/lnurl/lnurl.types';
import { BoltzService } from 'src/libs/boltz/boltz.service';
import { ConfigSchemaType } from 'src/libs/config/validation';
import { CryptoService } from 'src/libs/crypto/crypto.service';
import { LiquidService } from 'src/libs/liquid/liquid.service';
import { CustomLogger, Logger } from 'src/libs/logging';
import { WalletRepoService } from 'src/repo/wallet/wallet.repo';
import {
  LiquidWalletAssets,
  WalletAccountType,
} from 'src/repo/wallet/wallet.types';
import { liquidAssetIds } from 'src/utils/crypto/crypto';

import {
  LnUrlResponseSchemaType,
  PaymentOptionCode,
  PaymentOptionNetwork,
} from '../lnurl.types';

@Injectable()
export class LnUrlLocalService {
  constructor(
    private config: ConfigService,
    private boltzService: BoltzService,
    private liquidService: LiquidService,
    private walletRepo: WalletRepoService,
    private cryptoService: CryptoService,
    @Logger('LnUrlLocalService') private logger: CustomLogger,
  ) {}

  async getResponse(
    props: CallbackLocalParams,
  ): Promise<LnUrlResponseSchemaType> {
    if (!props.account) {
      return {
        status: 'ERROR',
        reason: 'No account provided',
      };
    }

    const account = props.account.toLowerCase();

    if (!props.amount) {
      return {
        status: 'ERROR',
        reason: 'No amount provided',
      };
    }

    const amount = Number(props.amount);

    if (isNaN(amount)) {
      return {
        status: 'ERROR',
        reason: 'No amount provided',
      };
    }

    if (!!props.currency) {
      if (!props.network) {
        return {
          status: 'ERROR',
          reason: 'A network needs to be provided',
        };
      }

      return this.getChainResponse({
        account,
        amount,
        network: props.network,
        currency: props.currency,
      });
    }

    // The amount that comes in through LNURL for Lightning is in millisatoshis
    return this.getInvoiceResponse(account, Math.ceil(amount / 1000));
  }

  async getInfo(account: string) {
    return auto<GetLnurlAutoType>({
      getBoltzInfo: async () => {
        return this.boltzService.getReverseSwapInfo();
      },

      getAccountCurrencies: async () => {
        const currencies = await this.getCurrencies(account);
        return currencies.map((c) => {
          const { code, name, network, symbol } = c;
          return {
            code,
            name,
            network,
            symbol,
          };
        });
      },

      buildResponse: [
        'getAccountCurrencies',
        'getBoltzInfo',
        async ({
          getAccountCurrencies,
          getBoltzInfo,
        }: Pick<
          GetLnurlAutoType,
          'getAccountCurrencies' | 'getBoltzInfo'
        >): Promise<GetLnurlAutoType['buildResponse']> => {
          const domains =
            this.config.getOrThrow<ConfigSchemaType['server']['domains']>(
              'server.domains',
            );

          return {
            callback: `http://${domains[0]}/lnurlp/${account}`,
            minSendable: getBoltzInfo.BTC['L-BTC'].limits.minimal * 1000,
            maxSendable: getBoltzInfo.BTC['L-BTC'].limits.maximal * 1000,
            metadata: JSON.stringify([
              ['text/plain', `Payment to ${account}`],
              ['text/identifier', `${account}@${domains[0]}`],
            ]),
            currencies: getAccountCurrencies,
            tag: 'payRequest',
          };
        },
      ],
    }).then((result) => result.buildResponse);
  }

  async getCurrencies(account: string): Promise<AccountCurrency[]> {
    const wallet = await this.walletRepo.getWalletByLnAddress(account);

    if (!wallet?.wallet.wallet_account.length) {
      return [];
    }

    const hasLiquidAccount = wallet.wallet.wallet_account.find(
      (a) => a.details.type === WalletAccountType.LIQUID,
    );

    if (!hasLiquidAccount) return [];

    const currencies: AccountCurrency[] = [];

    currencies.push({
      code: PaymentOptionCode.BTC,
      name: LiquidWalletAssets.BTC.name,
      network: PaymentOptionNetwork.LIQUID,
      symbol: LiquidWalletAssets.BTC.symbol,
      wallet_account: hasLiquidAccount,
      asset_id: liquidAssetIds.mainnet.bitcoin,
      conversion_decimals: 8,
      // multiplier: 1000,
      // decimals: 8,
      // convertible: {
      //   min: 1,
      //   max: 100000000,
      // },
    });

    currencies.push({
      code: PaymentOptionCode.USDT,
      name: LiquidWalletAssets.USDT.name,
      network: PaymentOptionNetwork.LIQUID,
      symbol: LiquidWalletAssets.USDT.symbol,
      wallet_account: hasLiquidAccount,
      asset_id: liquidAssetIds.mainnet.tether,
      conversion_decimals: 0,
      // multiplier: 1000,
      // decimals: 8,
      // convertible: {
      //   min: 1,
      //   max: 100000000,
      // },
    });

    return currencies;
  }

  async getChainResponse({
    account,
    amount,
    network,
    currency,
  }: CallbackLocalHandlerParams): Promise<LnUrlResponseSchemaType> {
    return auto<GetLnUrlResponseAutoType>({
      checkCurrency: async () => {
        const currencies = await this.getCurrencies(account);

        if (!network) {
          throw new Error('A network needs to be provided');
        }

        if (!currencies.length) {
          throw new Error('No currencies are available');
        }

        const foundCurrency = currencies.find((c) => {
          return c.code === currency && c.network === network;
        });

        if (!foundCurrency) {
          throw new Error(
            `Currency ${currency} on network ${network} is not available`,
          );
        }

        return foundCurrency;
      },

      createPayload: [
        'checkCurrency',
        async ({ checkCurrency }): Promise<LnUrlResponseSchemaType> => {
          const descriptor = this.cryptoService.decryptString(
            checkCurrency.wallet_account.details.local_protected_descriptor,
          );

          const addressObject = await this.liquidService.getOnchainAddress(
            descriptor,
            true,
          );

          const address = addressObject.address().toString();

          const bip21 = [
            'liquidnetwork:',
            address,
            `?amount=${amount / 10 ** checkCurrency.conversion_decimals}`,
            `&assetid=${checkCurrency.asset_id}`,
          ].join('');

          return {
            pr: '',
            routes: [],
            onchain: {
              currency,
              network,
              address,
              bip21,
            },
          };
        },
      ],
    })
      .then((result) => {
        return result.createPayload;
      })
      .catch((error) => {
        this.logger.error('Error getting lnurl onchain response', { error });
        return {
          status: 'ERROR',
          reason: error.message,
        };
      });
  }

  async getInvoiceResponse(
    account: string,
    amount: number,
  ): Promise<LnUrlResponseSchemaType> {
    return auto<GetLnUrlInvoiceAutoType>({
      checkAmount: async () => {
        const boltzInfo = await this.boltzService.getReverseSwapInfo();

        const { maximal, minimal } = boltzInfo.BTC['L-BTC'].limits;

        if (maximal < amount) {
          throw new Error(
            `Amount ${amount} greater than maximum of ${maximal}`,
          );
        }

        if (minimal > amount) {
          throw new Error(
            `Amount ${amount} smaller than minimum of ${minimal}`,
          );
        }

        return amount;
      },

      createSwap: [
        'checkAmount',
        async ({ checkAmount }) => {
          const accountWallets =
            await this.walletRepo.getWalletByLnAddress(account);

          const liquidWalletAccounts =
            accountWallets?.wallet.wallet_account.filter(
              (w) => w.details.type === WalletAccountType.LIQUID,
            );

          if (!liquidWalletAccounts?.length) {
            throw new Error(`No wallet available`);
          }

          const walletAcc = liquidWalletAccounts[0];

          const descriptor = this.cryptoService.decryptString(
            walletAcc.details.local_protected_descriptor,
          );

          const address =
            await this.liquidService.getOnchainAddress(descriptor);

          return this.boltzService.createReverseSwap(
            address.address().toString(),
            checkAmount,
            walletAcc.id,
            false,
          );
        },
      ],

      createPayload: [
        'createSwap',
        async ({
          createSwap,
        }: Pick<GetLnUrlInvoiceAutoType, 'createSwap'>): Promise<
          GetLnUrlInvoiceAutoType['createPayload']
        > => {
          return {
            pr: createSwap.invoice,
            routes: [],
          };
        },
      ],
    })
      .then((result) => result.createPayload)
      .catch((error) => {
        this.logger.error('Error getting lnurl invoice response', { error });
        return {
          status: 'ERROR',
          reason: error.message,
        };
      });
  }
}
