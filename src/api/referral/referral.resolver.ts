import { Args, Mutation, ResolveField, Resolver } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { CurrentUser } from 'src/auth/auth.decorators';
import { AmbossService } from 'src/libs/amboss/amboss.service';
import { AccountRepo } from 'src/repo/account/account.repo';

import { CreateReferralInput, ReferralMutations } from './referral.types';

@Resolver(ReferralMutations)
export class ReferralMutationsResolver {
  constructor(
    private ambossService: AmbossService,
    private accountRepo: AccountRepo,
  ) {}

  @ResolveField()
  async create(
    @CurrentUser() { user_id }: any,
    @Args('input') { max_allowed_uses, referral_code }: CreateReferralInput,
  ) {
    const account = await this.accountRepo.findOneById(user_id);

    if (!account) {
      throw new GraphQLError('Account not found.');
    }

    return this.ambossService.createReferralCode({
      email: account.email,
      max_allowed_uses,
      referral_code,
    });
  }
}

@Resolver()
export class ReferralResolver {
  @Mutation(() => ReferralMutations)
  async referrals() {
    return {};
  }
}
