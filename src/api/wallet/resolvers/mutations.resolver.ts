import { Args, Mutation, ResolveField, Resolver } from '@nestjs/graphql';
import {
  BroadcastLiquidTransactionInput,
  CreateOnchainAddressInput,
  CreateWalletInput,
  RefreshWalletInput,
  WalletMutations,
} from '../wallet.types';
import { CurrentUser } from 'src/auth/auth.decorators';
import { WalletRepoService } from 'src/repo/wallet/wallet.repo';
import { each } from 'async';
import { GraphQLError } from 'graphql';
import { LiquidService, getUpdateKey } from 'src/libs/liquid/liquid.service';
import { RedisService } from 'src/libs/redis/redis.service';
import { WalletService } from 'src/libs/wallet/wallet.service';

@Resolver(WalletMutations)
export class WalletMutationsResolver {
  constructor(
    private redis: RedisService,
    private walletRepo: WalletRepoService,
    private liquidService: LiquidService,
    private walletService: WalletService,
  ) {}

  @ResolveField()
  async refresh_wallet(
    @Args('input') input: RefreshWalletInput,
    @CurrentUser() { user_id }: any,
  ) {
    const wallet = await this.walletRepo.getAccountWallet(
      user_id,
      input.wallet_id,
    );

    if (!wallet) {
      throw new GraphQLError('Wallet account not found');
    }

    if (!wallet.wallet.wallet_account.length) {
      return;
    }

    await each(wallet.wallet.wallet_account, async (w) => {
      await this.liquidService.getUpdatedWallet(
        w.details.descriptor,
        input.full_scan ? 'full' : 'partial',
      );
    });

    return true;
  }

  @ResolveField()
  async create_onchain_address(
    @Args('input') input: CreateOnchainAddressInput,
    @CurrentUser() { user_id }: any,
  ) {
    const walletAccount = await this.walletRepo.getAccountWalletAccount(
      user_id,
      input.wallet_account_id,
    );

    if (!walletAccount) {
      throw new GraphQLError('Wallet account not found');
    }

    const address = await this.liquidService.getOnchainAddress(
      walletAccount.details.descriptor,
    );

    return { address: address.address().toString() };
  }

  @ResolveField()
  async create(
    @Args('input') input: CreateWalletInput,
    @CurrentUser() { user_id }: any,
  ) {
    return this.walletService.createWallet(user_id, input);
  }

  @ResolveField()
  async broadcast_liquid_transaction(
    @Args('input') input: BroadcastLiquidTransactionInput,
    @CurrentUser() { user_id }: any,
  ) {
    const walletAccount = await this.walletRepo.getAccountWalletAccount(
      user_id,
      input.wallet_account_id,
    );

    if (!walletAccount) {
      throw new GraphQLError('Wallet account not found');
    }

    const tx_id = await this.liquidService.broadcastPset(input.signed_pset);

    await this.redis.delete(getUpdateKey(walletAccount.details.descriptor));

    return { tx_id };
  }
}

@Resolver()
export class MainWalletMutationsResolver {
  @Mutation(() => WalletMutations)
  async wallets() {
    return {};
  }
}
