import { Module } from '@nestjs/common';
import { AmbossModule } from 'src/libs/amboss/amboss.module';
import { AccountRepoModule } from 'src/repo/account/account.module';

import {
  ReferralMutationsResolver,
  ReferralResolver,
} from './referral.resolver';

@Module({
  imports: [AmbossModule, AccountRepoModule],
  providers: [ReferralResolver, ReferralMutationsResolver],
})
export class ReferralModule {}
