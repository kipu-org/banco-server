import { Injectable } from '@nestjs/common';
import { wallet_account } from '@prisma/client';
import { auto } from 'async';
import Big from 'big.js';
import { GraphQLError } from 'graphql';
import { BoltzRestApi } from 'src/libs/boltz/boltz.rest';
import { BoltzService } from 'src/libs/boltz/boltz.service';
import {
  checkMagicRouteHintInfo,
  decodeBip21Url,
  findMagicRoutingHint,
} from 'src/libs/boltz/boltz.utils';
import { CryptoService } from 'src/libs/crypto/crypto.service';
import {
  DEFAULT_LIQUID_FEE_MSAT,
  LiquidService,
} from 'src/libs/liquid/liquid.service';
import { LnUrlIsomorphicService } from 'src/libs/lnurl/handlers/isomorphic.service';
import {
  isLnUrlError,
  PaymentOptionCode,
  PaymentOptionNetwork,
} from 'src/libs/lnurl/lnurl.types';
import { CustomLogger, Logger } from 'src/libs/logging';
import { SwapsRepoService } from 'src/repo/swaps/swaps.repo';
import { BoltzChain, BoltzSwapType } from 'src/repo/swaps/swaps.types';
import { toWithError } from 'src/utils/async';
import { getLiquidAssetId } from 'src/utils/crypto/crypto';

import {
  PayBitcoinAddressInput,
  PayLightningAddressAuto,
  PayLiquidAddressInput,
  PayLnAddressPayload,
  ProcessInvoiceAuto,
} from './pay.types';

@Injectable()
export class PayService {
  constructor(
    private swapRepo: SwapsRepoService,
    private boltzRest: BoltzRestApi,
    private boltzService: BoltzService,
    private liquidService: LiquidService,
    private cryptoService: CryptoService,
    private isomorphicLnurl: LnUrlIsomorphicService,
    @Logger('PayService') private logger: CustomLogger,
  ) {}

  async payLiquidAddress(
    wallet_account: wallet_account,
    input: PayLiquidAddressInput,
  ) {
    const descriptor = this.cryptoService.decryptString(
      wallet_account.details.local_protected_descriptor,
    );

    const pset = await this.liquidService.createPset(descriptor, input);

    const base_64 = pset.toString();

    return { base_64 };
  }

  async payLightningInvoice(
    invoice: string,
    wallet_account: wallet_account,
  ): Promise<{ base_64: string }> {
    return await auto<ProcessInvoiceAuto>({
      checkInvoice: async (): Promise<ProcessInvoiceAuto['checkInvoice']> => {
        try {
          return findMagicRoutingHint(invoice);
        } catch (error) {
          throw new Error('Invalid Lightning Invoice');
        }
      },

      getAddressFromRouteHint: [
        'checkInvoice',
        async ({
          checkInvoice,
        }: Pick<ProcessInvoiceAuto, 'checkInvoice'>): Promise<
          ProcessInvoiceAuto['getAddressFromRouteHint']
        > => {
          if (!checkInvoice.magicRoutingHint) return;

          const info = await this.boltzRest.getMagicRouteHintInfo(invoice);

          return checkMagicRouteHintInfo(
            checkInvoice.magicRoutingHint,
            info,
            checkInvoice.decoded,
          );
        },
      ],

      getAddressFromSwap: [
        'getAddressFromRouteHint',
        async ({
          getAddressFromRouteHint,
        }: Pick<ProcessInvoiceAuto, 'getAddressFromRouteHint'>): Promise<
          ProcessInvoiceAuto['getAddressFromSwap']
        > => {
          if (!!getAddressFromRouteHint) return;

          const savedSwap =
            await this.swapRepo.getReverseSwapByInvoice(invoice);

          if (!!savedSwap) {
            if (savedSwap.response.type !== BoltzSwapType.SUBMARINE) {
              throw 'invalid swap type';
            }

            return decodeBip21Url(savedSwap.response.payload.bip21);
          }

          const swap = await this.boltzService.createSubmarineSwap(
            invoice,
            wallet_account.id,
          );

          return decodeBip21Url(swap.bip21);
        },
      ],

      constructTransaction: [
        'getAddressFromRouteHint',
        'getAddressFromSwap',
        async ({
          getAddressFromRouteHint,
          getAddressFromSwap,
        }: Pick<
          ProcessInvoiceAuto,
          'getAddressFromRouteHint' | 'getAddressFromSwap'
        >): Promise<ProcessInvoiceAuto['constructTransaction']> => {
          const info = getAddressFromRouteHint || getAddressFromSwap;

          if (!info) {
            throw 'no address found to pay invoice';
          }

          const amountSats = Math.ceil(info.amount * 10 ** 8);

          const descriptor = this.cryptoService.decryptString(
            wallet_account.details.local_protected_descriptor,
          );

          const pset = await this.liquidService.createPset(descriptor, {
            fee_rate: DEFAULT_LIQUID_FEE_MSAT,
            recipients: [
              {
                address: info.address,
                amount: amountSats + '',
                asset_id: info.asset,
              },
            ],
          });

          const base_64 = pset.toString();

          return { base_64 };
        },
      ],
    }).then((results) => results.constructTransaction);
  }

  async payOnchainLiquidAddress({
    amount,
    address,
    asset_id,
    wallet_account,
  }: {
    amount: number;
    address: string;
    asset_id: string;
    wallet_account: wallet_account;
  }): Promise<{ base_64: string }> {
    this.logger.debug('Creating transaction', {
      amount,
      address,
      asset_id,
      wallet_account,
    });

    const descriptor = this.cryptoService.decryptString(
      wallet_account.details.local_protected_descriptor,
    );

    const pset = await this.liquidService.createPset(descriptor, {
      fee_rate: DEFAULT_LIQUID_FEE_MSAT,
      recipients: [
        {
          address,
          amount: amount + '',
          asset_id,
        },
      ],
    });

    const base_64 = pset.toString();

    return { base_64 };
  }

  async payLightningAddress({
    money_address,
    amount,
    wallet_account,
    payment_option,
  }: PayLnAddressPayload): Promise<{ base_64: string }> {
    return await auto<PayLightningAddressAuto>({
      getLnAddressInfo: async (): Promise<
        PayLightningAddressAuto['getLnAddressInfo']
      > => {
        const [info, error] = await toWithError(
          this.isomorphicLnurl.getCurrencies(money_address),
        );

        if (error || !info) {
          this.logger.error('Error getting address info', {
            error,
            money_address,
          });

          throw new GraphQLError('Error getting address info');
        }

        return info;
      },

      getPaymentOption: [
        'getLnAddressInfo',
        async ({
          getLnAddressInfo,
        }: Pick<PayLightningAddressAuto, 'getLnAddressInfo'>): Promise<
          PayLightningAddressAuto['getPaymentOption']
        > => {
          if (!payment_option) {
            const defaultOption = getLnAddressInfo.paymentOptions.find(
              (p) =>
                p.code === PaymentOptionCode.LIGHTNING &&
                p.network === PaymentOptionNetwork.BITCOIN,
            );

            if (!defaultOption) {
              throw new Error('Payment option not found for this address');
            }

            return defaultOption;
          }

          const findOption = getLnAddressInfo.paymentOptions.find(
            (p) =>
              p.code === payment_option.code &&
              p.network === payment_option.network,
          );

          if (!findOption) {
            throw new Error('Payment option not found for this address');
          }

          return findOption;
        },
      ],

      amountCheck: [
        'getPaymentOption',
        async ({
          getPaymentOption,
        }: Pick<PayLightningAddressAuto, 'getPaymentOption'>): Promise<
          PayLightningAddressAuto['amountCheck']
        > => {
          const { min_sendable, max_sendable } = getPaymentOption;

          const minNullOrUndefined = min_sendable == null;
          const maxNullOrUndefined = max_sendable == null;

          const requestedAmount = new Big(amount);

          if (!maxNullOrUndefined && requestedAmount.gt(max_sendable)) {
            throw new GraphQLError(
              `Amount ${amount} is bigger than max of ${max_sendable}`,
            );
          }

          if (!minNullOrUndefined && requestedAmount.lt(min_sendable)) {
            throw new GraphQLError(
              `Amount ${amount} is smaller than min of ${min_sendable}`,
            );
          }
        },
      ],

      pay: [
        'getPaymentOption',
        'amountCheck',
        async ({
          getPaymentOption,
        }: Pick<PayLightningAddressAuto, 'getPaymentOption'>): Promise<
          PayLightningAddressAuto['pay']
        > => {
          const { code, network } = getPaymentOption;

          const uniqueId = `${code}-${network}`;

          this.logger.debug('Creating transaction', { uniqueId });

          switch (uniqueId) {
            case `${PaymentOptionCode.LIGHTNING}-${PaymentOptionNetwork.BITCOIN}`: {
              const [addressResult, addressError] = await toWithError(
                this.isomorphicLnurl.getInvoiceResponse(money_address, amount),
              );

              if (
                addressError ||
                !addressResult ||
                isLnUrlError(addressResult) ||
                !addressResult.pr
              ) {
                this.logger.error('Error processing payment', {
                  addressResult,
                  addressError,
                  money_address,
                });

                throw new Error('Unable to process Lightning payment');
              }

              const [info, error] = await toWithError(
                this.payLightningInvoice(addressResult.pr, wallet_account),
              );

              if (error) {
                this.logger.error('Error processing payment', {
                  error,
                  invoice_info: addressResult,
                });
                throw new GraphQLError('Error processing payment');
              }

              return info;
            }

            case `${PaymentOptionCode.BTC}-${PaymentOptionNetwork.LIQUID}`:
            case `${PaymentOptionCode.USDT}-${PaymentOptionNetwork.LIQUID}`: {
              const [result, error] = await toWithError(
                this.isomorphicLnurl.getChainResponse(money_address, {
                  amount,
                  currency: code,
                  network,
                }),
              );

              if (
                error ||
                !result ||
                isLnUrlError(result) ||
                !result.onchain?.address
              ) {
                this.logger.error('Error processing payment', {
                  result,
                  error,
                  money_address,
                });
                throw new Error('Error processing payment');
              }

              const [onchainInfo, onchainError] = await toWithError(
                this.payOnchainLiquidAddress({
                  amount,
                  address: result.onchain.address,
                  asset_id: getLiquidAssetId(code),
                  wallet_account,
                }),
              );

              if (onchainError || !onchainInfo) {
                this.logger.error('Error processing payment', {
                  onchainInfo,
                  onchainError,
                });
                throw new Error('Error processing payment');
              }

              return onchainInfo;
            }

            default:
              throw new Error('This payment option is unavailable');
          }
        },
      ],
    }).then((results) => results.pay);
  }

  async payBitcoinAddress(
    wallet_account: wallet_account,
    input: PayBitcoinAddressInput,
  ) {
    const swap = await this.boltzService.createChainSwap({
      address: input.recipient.address,
      amount: +input.recipient.amount,
      wallet_account_id: wallet_account.id,
      direction: {
        from: BoltzChain['L-BTC'],
        to: BoltzChain.BTC,
      },
    });

    const { address, amount, asset } = decodeBip21Url(swap.lockupDetails.bip21);

    const descriptor = this.cryptoService.decryptString(
      wallet_account.details.local_protected_descriptor,
    );
    const pset = await this.liquidService.createPset(descriptor, {
      recipients: [
        {
          address,
          amount: (amount * 100_000_000).toString(),
          asset_id: asset,
        },
      ],
    });

    return { base_64: pset.toString() };
  }
}
