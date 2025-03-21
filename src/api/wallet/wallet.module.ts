import { Module } from '@nestjs/common';
import { AmbossModule } from 'src/libs/amboss/amboss.module';
import { BoltzRestModule } from 'src/libs/boltz/boltz.module';
import { EsploraServiceModule } from 'src/libs/esplora/esplora.module';
import { FiatModule } from 'src/libs/fiat/fiat.module';
import { LiquidModule } from 'src/libs/liquid/liquid.module';
import { MailModule } from 'src/libs/mail/mail.module';
import { RedlockModule } from 'src/libs/redlock/redlock.module';
import { SideShiftModule } from 'src/libs/sideshift/sideshift.module';
import { WalletServiceModule } from 'src/libs/wallet/wallet.module';
import { AccountRepoModule } from 'src/repo/account/account.module';
import { WalletRepoModule } from 'src/repo/wallet/wallet.module';

import {
  MainWalletMutationsResolver,
  WalletMutationsResolver,
} from './resolvers/mutations.resolver';
import {
  FiatInfoResolver,
  LiquidAccountResolver,
  MainWalletQueriesResolver,
  MoneyAddressResolver,
  SimpleWalletAccountResolver,
  SimpleWalletResolver,
  WalletAccountResolver,
  WalletDetailsResolver,
  WalletLiquidAssetInfoResolver,
  WalletLiquidAssetResolver,
  WalletLiquidTransactionResolver,
  WalletQueriesResolver,
  WalletResolver,
} from './resolvers/queries.resolver';

@Module({
  imports: [
    WalletServiceModule,
    WalletRepoModule,
    EsploraServiceModule,
    LiquidModule,
    FiatModule,
    SideShiftModule,
    RedlockModule,
    MailModule,
    BoltzRestModule,
    AmbossModule,
    AccountRepoModule,
  ],
  providers: [
    MainWalletMutationsResolver,
    WalletMutationsResolver,
    WalletLiquidTransactionResolver,
    WalletLiquidAssetInfoResolver,
    WalletLiquidAssetResolver,
    SimpleWalletAccountResolver,
    WalletAccountResolver,
    WalletResolver,
    SimpleWalletResolver,
    WalletQueriesResolver,
    MainWalletQueriesResolver,
    LiquidAccountResolver,
    WalletDetailsResolver,
    FiatInfoResolver,
    MoneyAddressResolver,
  ],
})
export class WalletModule {}
