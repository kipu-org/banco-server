import {
  Args,
  Context,
  Mutation,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { each } from 'async';
import { isAlphanumeric } from 'class-validator';
import { GraphQLError } from 'graphql';
import { CurrentUser } from 'src/auth/auth.decorators';
import { AmbossService } from 'src/libs/amboss/amboss.service';
import { encodeBip21 } from 'src/libs/bitcoin/bitcoin.utils';
import { BoltzService } from 'src/libs/boltz/boltz.service';
import { CryptoService } from 'src/libs/crypto/crypto.service';
import { ContextType } from 'src/libs/graphql/context.type';
import { LiquidService } from 'src/libs/liquid/liquid.service';
import { CustomLogger, Logger } from 'src/libs/logging';
import { RedlockService } from 'src/libs/redlock/redlock.service';
import { SideShiftService } from 'src/libs/sideshift/sideshift.service';
import {
  SideShiftCoin,
  SideShiftNetwork,
} from 'src/libs/sideshift/sideshift.types';
import { WalletService } from 'src/libs/wallet/wallet.service';
import { AccountRepo } from 'src/repo/account/account.repo';
import { BoltzChain } from 'src/repo/swaps/swaps.types';
import { WalletRepoService } from 'src/repo/wallet/wallet.repo';
import { LiquidWalletAssets } from 'src/repo/wallet/wallet.types';
import { toWithError } from 'src/utils/async';

import { WALLET_LIMIT } from '../wallet.const';
import {
  BroadcastLiquidTransactionInput,
  CreateLightingInvoiceInput,
  CreateOnchainAddress,
  CreateOnchainAddressInput,
  CreateWalletInput,
  OnchainAddressType,
  ReceiveSwap,
  ReceiveSwapInput,
  RefreshWalletInput,
  WalletMutations,
} from '../wallet.types';

@Resolver(WalletMutations)
export class WalletMutationsResolver {
  constructor(
    private walletRepo: WalletRepoService,
    private liquidService: LiquidService,
    private walletService: WalletService,
    private sideShiftService: SideShiftService,
    private cryptoService: CryptoService,
    private redlockService: RedlockService,
    private boltzService: BoltzService,
    private ambossService: AmbossService,
    private accountRepo: AccountRepo,
    @Logger('WalletMutationsResolver') private logger: CustomLogger,
  ) {}

  @ResolveField()
  async refresh_wallet(
    @Args('input') input: RefreshWalletInput,
    @CurrentUser() { user_id }: any,
  ): Promise<boolean> {
    try {
      return await this.refreshWallet(input, user_id);
    } catch (error) {
      if (error instanceof Error && error.message === 'Resource locked') {
        throw new GraphQLError(`Wallet scan is already in progress`);
      }
      this.logger.warn(`Wallet rescan error`, { error });
      throw new GraphQLError(`An unknown error has occured`);
    }
  }

  @ResolveField()
  async create_onchain_address(
    @Args('input') input: CreateOnchainAddressInput,
    @CurrentUser() { user_id }: any,
  ): Promise<CreateOnchainAddress> {
    const walletAccount = await this.walletRepo.getAccountWalletAccount(
      user_id,
      input.wallet_account_id,
    );

    if (!walletAccount) {
      throw new GraphQLError('Wallet account not found');
    }

    const descriptor = this.cryptoService.decryptString(
      walletAccount.details.local_protected_descriptor,
    );

    const liquidAddress = await this.liquidService.getOnchainAddress(
      descriptor,
      true,
    );

    const liquidAddressStr = liquidAddress.address().toString();

    const bip21 = encodeBip21({
      address: liquidAddressStr,
      symbol: OnchainAddressType.L_BTC,
      sats: input.amount,
      assetId: input.asset ? LiquidWalletAssets[input.asset].id : undefined,
    });

    return {
      address: liquidAddressStr,
      network: OnchainAddressType.L_BTC,
      bip21,
    };
  }

  @ResolveField()
  async create_onchain_address_swap(
    @Args('input') input: ReceiveSwapInput,
    @CurrentUser() { user_id }: any,
    @Context() { ip }: ContextType,
  ): Promise<ReceiveSwap> {
    const walletAccount = await this.walletRepo.getAccountWalletAccount(
      user_id,
      input.wallet_account_id,
    );

    if (!walletAccount) {
      throw new GraphQLError('Wallet account not found');
    }

    const descriptor = this.cryptoService.decryptString(
      walletAccount.details.local_protected_descriptor,
    );

    const address = await this.liquidService.getOnchainAddress(
      descriptor,
      true,
    );

    return this.constructSwap({
      userInput: input,
      ip,
      liquidAddress: address.address().toString(),
      walletAccountId: walletAccount.id,
    });
  }

  @ResolveField()
  async create(
    @Args('input') input: CreateWalletInput,
    @CurrentUser() { user_id }: any,
  ) {
    const walletCount = await this.walletRepo.countAccountWallets(user_id);
    if (walletCount >= WALLET_LIMIT) {
      throw new GraphQLError(`Wallet limit reached`);
    }

    return this.walletService.createWallet(user_id, input);
  }

  @ResolveField()
  async change_name(
    @Args('id') id: string,
    @Args('name') name: string,
    @CurrentUser() { user_id }: any,
  ) {
    if (!name) {
      throw new GraphQLError('No name was provided');
    }

    if (name.length > 20) {
      throw new GraphQLError('The name can be up to 20 characters long');
    }

    const wallet = await this.walletRepo.updateWalletName(user_id, id, name);

    if (!wallet) {
      throw new GraphQLError('No wallet found');
    }

    return true;
  }

  @ResolveField()
  async change_money_address(
    @Args('id') id: string,
    @Args('money_address_user') money_address_user: string,
    @CurrentUser() { user_id }: any,
  ) {
    if (!money_address_user) {
      throw new GraphQLError('No money address name was provided');
    }

    if (!isAlphanumeric(money_address_user)) {
      throw new GraphQLError(
        'Only letters and numbers can be used for the money address',
      );
    }

    if (money_address_user.length > 20) {
      throw new GraphQLError(
        'The money address name has to be shorter than 20 characters',
      );
    }

    if (money_address_user.length < 4) {
      throw new GraphQLError(
        'The money address name needs to be longer than 4 characters',
      );
    }

    const account = await this.accountRepo.findOneById(user_id);

    if (!account) {
      throw new GraphQLError('Account not found');
    }

    const referrals = await this.ambossService.getReferralCodes(account.email);

    if (!referrals.length) {
      throw new GraphQLError(
        'You need to refer at least five new friends to be able to change your money address',
      );
    }

    const amountOfReferrals = referrals.reduce((p, c) => {
      if (!c.current_uses) return p;
      return p + c.current_uses;
    }, 0);

    if (amountOfReferrals < 2) {
      throw new GraphQLError(
        'You need to refer at least two new friends to be able to change your money address',
      );
    }

    const wallet = await this.walletRepo.updateWalletMoneyAddress(
      user_id,
      id,
      money_address_user,
    );

    if (!wallet) {
      throw new GraphQLError('No wallet found');
    }

    return true;
  }

  @ResolveField()
  async broadcast_liquid_transaction(
    @Args('input') input: BroadcastLiquidTransactionInput,
    @CurrentUser() { user_id }: any,
  ) {
    this.logger.debug('Broadcasting new transaction', {
      account_id: input.wallet_account_id,
    });

    const walletAccount = await this.walletRepo.getAccountWalletAccount(
      user_id,
      input.wallet_account_id,
    );

    if (!walletAccount) {
      throw new GraphQLError('Wallet account not found');
    }

    const tx_id = await this.liquidService.broadcastPset(input.signed_pset);

    return { tx_id };
  }

  @ResolveField()
  async create_lightning_invoice(
    @Args('input')
    {
      amount,
      wallet_account_id,
      invoice_description,
    }: CreateLightingInvoiceInput,
    @CurrentUser() { user_id }: any,
  ) {
    const walletAccount = await this.walletRepo.getAccountWalletAccount(
      user_id,
      wallet_account_id,
    );

    if (!walletAccount) {
      throw new GraphQLError('Wallet account not found');
    }

    const boltzInfo = await this.boltzService.getReverseSwapInfo();

    const { maximal, minimal } = boltzInfo.BTC['L-BTC'].limits;

    if (amount > maximal) {
      throw new GraphQLError(`Maximum amount is ${maximal} sats`);
    }

    if (amount < minimal) {
      throw new GraphQLError(`Mimimum amount is ${minimal} sats`);
    }

    const descriptor = this.cryptoService.decryptString(
      walletAccount.details.local_protected_descriptor,
    );

    const address = await this.liquidService.getOnchainAddress(
      descriptor,
      true,
    );

    const description =
      invoice_description ||
      `Pay to ${walletAccount.walletOnAccount.money_address_user}`;

    try {
      const swap = await this.boltzService.createReverseSwap({
        address: address.address().toString(),
        amount,
        wallet_account_id: walletAccount.id,
        covenant: false,
        description,
      });

      return { payment_request: swap.invoice };
    } catch (error) {
      this.logger.error('Error creating invoice', { error });
      throw new GraphQLError('Error creating invoice');
    }
  }

  private async refreshWallet(
    input: RefreshWalletInput,
    user_id: string,
  ): Promise<boolean> {
    const walletScanKey = `walletScan-${input.wallet_id}`;

    return this.redlockService.using<boolean>(walletScanKey, async () => {
      const wallet = await this.walletRepo.getAccountWallet(
        user_id,
        input.wallet_id,
      );

      if (!wallet) {
        throw new GraphQLError('Wallet account not found');
      }

      if (!wallet.wallet.wallet_account.length) {
        return true;
      }

      await each(wallet.wallet.wallet_account, async (w) => {
        const descriptor = this.cryptoService.decryptString(
          w.details.local_protected_descriptor,
        );

        await this.liquidService.getUpdatedWallet(
          descriptor,
          input.full_scan ? 'full' : 'partial',
        );
      });

      return true;
    });
  }

  private async constructSwap(input: {
    userInput: ReceiveSwapInput;
    liquidAddress: string;
    walletAccountId: string;
    ip?: string;
  }): Promise<ReceiveSwap> {
    const { ip, liquidAddress, userInput, walletAccountId } = input;

    // Make an exception for receiving onchain bitcoin, we can use Boltz
    if (
      userInput.deposit_coin == SideShiftCoin.BTC &&
      userInput.deposit_network == SideShiftNetwork.bitcoin
    ) {
      if (!userInput.amount) {
        throw new GraphQLError(`Cannot recieve without amount`);
      }
      const [swap, error] = await toWithError(
        this.boltzService.createChainSwap({
          address: liquidAddress,
          amount: userInput.amount,
          wallet_account_id: walletAccountId,
          direction: { from: BoltzChain.BTC, to: BoltzChain['L-BTC'] },
        }),
      );

      if (error) {
        this.logger.error('Error creating address', { swap, error });
        throw new GraphQLError(error.message);
      }

      return {
        id: swap.id,
        coin: userInput.deposit_coin,
        min: swap.lockupDetails.amount.toString(),
        max: swap.lockupDetails.amount.toString(),
        network: SideShiftNetwork.bitcoin,
        receive_address: swap.lockupDetails.lockupAddress,
        bip21: swap.lockupDetails.bip21,
      };
    }

    const [swap, error] = await toWithError(
      this.sideShiftService.createVariableSwap(
        {
          depositCoin: userInput.deposit_coin,
          depositNetwork: userInput.deposit_network,
          settleCoin: SideShiftCoin.BTC,
          settleNetwork: SideShiftNetwork.liquid,
          settleAddress: liquidAddress,
        },
        walletAccountId,
        ip,
      ),
    );

    if (error) {
      this.logger.error('Error creating address', { swap, error });
      throw new GraphQLError('Error creating address');
    }

    return {
      id: swap.id,
      coin: swap.depositCoin as SideShiftCoin,
      min: swap.depositMin,
      max: swap.depositMax,
      network: swap.depositNetwork as SideShiftNetwork,
      receive_address: swap.depositAddress,
      bip21: undefined,
    };
  }
}

@Resolver()
export class MainWalletMutationsResolver {
  @Mutation(() => WalletMutations)
  async wallets() {
    return {};
  }
}
