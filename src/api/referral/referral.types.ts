import { Field, InputType, ObjectType } from '@nestjs/graphql';

import { Nullable } from '../api.types';

@InputType()
export class CreateReferralInput {
  @Field(() => String, { nullable: true })
  referral_code?: Nullable<string>;

  @Field(() => Number, { nullable: true })
  max_allowed_uses?: Nullable<number>;
}

@ObjectType()
export class CreateReferralResult {
  @Field()
  success: boolean;
}

@ObjectType()
export class ReferralMutations {
  @Field(() => CreateReferralResult)
  create: CreateReferralResult;
}
