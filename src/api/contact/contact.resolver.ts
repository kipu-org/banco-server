import {
  Args,
  Mutation,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import {
  ContactMutations,
  CreateContactInput,
  LightningAddressResponseSchema,
  LnUrlCurrency,
  LnUrlCurrencyType,
  SendMessageInput,
  WalletContact,
  WalletContactParent,
  WalletContacts,
  WalletContactsParent,
  moneyAddressType,
} from './contact.types';
import { CurrentUser } from 'src/auth/auth.decorators';
import { ContactRepoService } from 'src/repo/contact/contact.repo';
import { GraphQLError } from 'graphql';
import { ConfigService } from '@nestjs/config';
import { WalletRepoService } from 'src/repo/wallet/wallet.repo';
import { fetch } from 'undici';
import { lightningAddressToUrl } from 'src/utils/lnurl';
import { LnurlService } from 'src/libs/lnurl/lnurl.service';
import { ContactService } from 'src/libs/contact/contact.service';
import { v5 } from 'uuid';
import { CustomLogger, Logger } from 'src/libs/logging';
import { LnUrlCurrencySchemaType } from 'src/libs/lnurl/lnurl.types';

@Resolver(LnUrlCurrency)
export class LnUrlCurrencyResolver {
  @ResolveField()
  id(@Parent() parent: LnUrlCurrencySchemaType) {
    return v5(JSON.stringify(parent), v5.URL);
  }
}

// @Resolver(LnUrlInfo)
// export class LnUrlInfoResolver {
//   @ResolveField()
//   id(@Parent() parent: LnUrlInfoParent) {
//     return v5(JSON.stringify(parent), v5.URL);
//   }

// @ResolveField()
// async min_sendable(@Parent() parent: LnUrlInfoParent) {
//   if (!parent.lnUrlInfo.minSendable) return 0;

//   const minSats = Math.floor(parent.lnUrlInfo.minSendable / 1000);

//   if (!parent.boltzInfo) return 0;

//   return Math.max(parent.boltzInfo['L-BTC'].BTC.limits.minimal, minSats);
// }

// @ResolveField()
// async max_sendable(@Parent() parent: LnUrlInfoParent) {
//   if (!parent.lnUrlInfo.maxSendable) return 0;

//   const maxSats = Math.ceil(parent.lnUrlInfo.maxSendable / 1000);

//   if (!parent.boltzInfo) return 0;

//   return Math.min(parent.boltzInfo['L-BTC'].BTC.limits.maximal, maxSats);
// }

// @ResolveField()
// async variable_fee_percentage(@Parent() parent: LnUrlInfoParent) {
//   return parent.boltzInfo?.['L-BTC'].BTC.fees.percentage || '0';
// }

// @ResolveField()
// async fixed_fee(@Parent() parent: LnUrlInfoParent) {
//   const boltzFee = parent.boltzInfo?.['L-BTC'].BTC.fees.minerFees || 0;
//   return boltzFee + 300;
// }

// @ResolveField()
// async currencies(@Parent() parent: LnUrlInfoParent) {
//   return parent.lnUrlInfo.currencies || [];
// }
// }

@Resolver(WalletContact)
export class WalletContactResolver {
  constructor(
    private lnurlService: LnurlService,
    private contactsRepo: ContactRepoService,
    private contactService: ContactService,
  ) {}

  @ResolveField()
  async encryption_pubkey(@Parent() parent: WalletContactParent) {
    if (!parent.money_address) return null;
    return this.lnurlService.getAddressPublicKey(parent.money_address);
  }

  @ResolveField()
  async messages(@Parent() parent: WalletContactParent) {
    const messages = await this.contactsRepo.getContactMessages(parent.id);
    return messages.map((m) => ({ ...m, payload: JSON.stringify(m.payload) }));
  }

  @ResolveField()
  async payment_options(
    @Parent() { money_address }: WalletContactParent,
  ): Promise<LnUrlCurrencyType[] | null> {
    if (!money_address) return null;
    const info = await this.contactService.getCurrencies(money_address);
    return info?.paymentOptions || null;
  }
}

@Resolver(WalletContacts)
export class WalletContactsResolver {
  constructor(private contactsRepo: ContactRepoService) {}

  @ResolveField()
  id(@Parent() { wallet_id }: WalletContactsParent) {
    return wallet_id;
  }

  @ResolveField()
  async find_many(@Parent() { wallet_id }: WalletContactsParent) {
    const walletInfo = await this.contactsRepo.getContactsForWallet(wallet_id);
    return walletInfo?.contacts || [];
  }

  @ResolveField()
  async find_one(
    @Args('id') id: string,
    @Parent() { wallet_id }: WalletContactsParent,
  ): Promise<WalletContactParent> {
    const contact = await this.contactsRepo.getWalletContact(id, wallet_id);

    if (!contact) {
      throw new GraphQLError('Contact not found');
    }

    return contact;
  }
}

@Resolver(ContactMutations)
export class ContactMutationsResolver {
  constructor(
    private config: ConfigService,
    private walletRepo: WalletRepoService,
    private contactService: ContactService,
    private contactsRepo: ContactRepoService,
    @Logger('ContactMutationsResolver') private logger: CustomLogger,
  ) {}

  @ResolveField()
  async send_message(
    @Args('input') input: SendMessageInput,
    @CurrentUser() { user_id }: any,
  ) {
    await this.contactService.sendMessage({
      ...input,
      account_id: user_id,
    });

    return { id: '' };
  }

  @ResolveField()
  async create(
    @Args('input') input: CreateContactInput,
    @CurrentUser() { user_id }: any,
  ) {
    if (!input.money_address) {
      throw new GraphQLError('No money address provided');
    }

    const money_address = input.money_address.toLowerCase();

    const isProd = this.config.getOrThrow('isProduction');

    if (isProd) {
      const result = moneyAddressType.safeParse(money_address);

      if (!result.success) {
        throw new GraphQLError(result.error.issues[0].message);
      }
    }

    const serverDomain = this.config.getOrThrow('server.domain');

    const [user, domain] = money_address.split('@');

    if (serverDomain === domain) {
      const wallet = await this.walletRepo.getWalletByLnAddress(user);

      if (!wallet) {
        throw new GraphQLError('Contact not found');
      }
    } else {
      try {
        const rawInfo = await fetch(lightningAddressToUrl(money_address));

        const info = await rawInfo.json();

        LightningAddressResponseSchema.parse(info);
      } catch (error) {
        this.logger.error('Error getting lnurl info', { error });
        throw new GraphQLError('Error checking if contact exists');
      }
    }

    return this.contactsRepo.upsertContactForAccount(
      user_id,
      input.wallet_id,
      money_address,
    );
  }
}

@Resolver()
export class MainContactResolver {
  @Mutation(() => ContactMutations)
  async contacts() {
    return {};
  }
}
