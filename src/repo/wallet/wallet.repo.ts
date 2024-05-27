import { Injectable } from '@nestjs/common';
import { GetAccountWalletsResult } from 'src/api/wallet/wallet.types';
import { PrismaService } from 'src/libs/prisma/prisma.service';
import { WalletAccountDetailsType, WalletDetailsType } from './wallet.types';
import { Secp256k1KeyPairType } from '../account/account.types';
import { lnAddressGenerator } from 'src/utils/names/names';

@Injectable()
export class WalletRepoService {
  constructor(private prisma: PrismaService) {}

  async countAccountWallets(account_id: string) {
    return this.prisma.wallet_on_accounts.count({ where: { account_id } });
  }

  async getAccountWallets(
    account_id: string,
  ): Promise<GetAccountWalletsResult[]> {
    return this.prisma.wallet_on_accounts.findMany({
      where: { account_id },
      include: { wallet: { include: { wallet_account: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async getAccountWallet(
    account_id: string,
    wallet_id: string,
  ): Promise<GetAccountWalletsResult | null> {
    return this.prisma.wallet_on_accounts.findUnique({
      where: { account_id_wallet_id: { wallet_id, account_id } },
      include: { wallet: { include: { wallet_account: true } } },
    });
  }

  async getAccountWalletAccount(account_id: string, wallet_account_id: string) {
    const walletAccount = await this.prisma.wallet_account.findUnique({
      where: { id: wallet_account_id },
      include: { wallet: true },
    });

    if (!walletAccount) return null;

    // Check that this wallet account is owned by this user
    const walletOnAccount = await this.prisma.wallet_on_accounts.findUnique({
      where: {
        account_id_wallet_id: {
          account_id,
          wallet_id: walletAccount.wallet_id,
        },
      },
    });

    if (!walletOnAccount) return null;

    return walletAccount;
  }

  async createNewWallet({
    account_id,
    is_owner,
    name,
    details,
    secp256k1_key_pair,
  }: {
    account_id: string;
    is_owner: boolean;
    name: string;
    details: WalletDetailsType;
    secp256k1_key_pair: Secp256k1KeyPairType;
  }) {
    return this.prisma.wallet.create({
      data: {
        name,
        accounts: {
          create: {
            is_owner,
            secp256k1_key_pair,
            details,
            account: { connect: { id: account_id } },
            lightning_address: lnAddressGenerator(),
          },
        },
      },
    });
  }

  async createNewAccount(
    name: string,
    wallet_id: string,
    details: WalletAccountDetailsType,
  ) {
    return this.prisma.wallet_account.create({
      data: { wallet_id, details, name },
    });
  }
}
