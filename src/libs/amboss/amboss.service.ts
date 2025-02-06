import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { CustomLogger, Logger } from '../logging';
import {
  AmbossCanSignup,
  ambossCanSignupSchema,
  AmbossReferralCode,
  ambossReferralCodeSchema,
  AmbossUseOrCreateReferralCode,
  ambossUseOrCreateReferralCodeSchema,
} from './amboss.types';

@Injectable()
export class AmbossService {
  private baseUrl?: string;
  private secret?: string;
  private hasAmbossAccess: boolean;

  constructor(
    private config: ConfigService,
    @Logger(AmbossService.name) private logger: CustomLogger,
  ) {
    const isProduction = this.config.get('isProduction');
    this.baseUrl = this.config.get('amboss.url');
    this.secret = this.config.get('amboss.secret');
    this.hasAmbossAccess = !!this.baseUrl && !!this.secret && isProduction;
  }

  async getReferralCodes(email: string): Promise<AmbossReferralCode[]> {
    if (!this.hasAmbossAccess) return [];

    const response = await this.get(
      `referral?email=${encodeURIComponent(email)}`,
    );

    const parsed = z
      .array(ambossReferralCodeSchema.passthrough())
      .safeParse(response);

    if (parsed.error) {
      this.logger.error(`Invalid response for referral codes`, {
        response,
        email,
      });
      return [];
    }

    return parsed.data;
  }

  async useReferralCode(
    code: string,
    email: string,
  ): Promise<AmbossUseOrCreateReferralCode> {
    if (!this.hasAmbossAccess) return { success: false };

    const response = await this.post(
      `referral/${encodeURIComponent(code)}/use?email=${encodeURIComponent(email)}`,
    );

    const parsed = ambossUseOrCreateReferralCodeSchema
      .passthrough()
      .safeParse(response);

    if (parsed.error) {
      this.logger.error(`Invalid response for use referral code`, {
        response,
        code,
      });
      throw new Error(response.message || 'Unable to use referral code');
    }

    return parsed.data;
  }

  async createReferralCode({
    email,
    referral_code,
    max_allowed_uses = 100_000,
  }: {
    email: string;
    referral_code?: string | undefined | null;
    max_allowed_uses?: number | undefined | null;
  }): Promise<AmbossUseOrCreateReferralCode> {
    if (!this.hasAmbossAccess) return { success: false };

    const response = await this.post(`referral`, {
      email,
      max_allowed_uses,
      referral_code,
    });

    const parsed = ambossUseOrCreateReferralCodeSchema
      .passthrough()
      .safeParse(response);

    if (parsed.error) {
      this.logger.error(`Invalid response for use referral code`, {
        response,
        referral_code,
      });
      throw new Error(response.message || 'Unable to create referral code');
    }

    return parsed.data;
  }

  async canSignup(
    email: string,
    referralCode?: string,
  ): Promise<AmbossCanSignup> {
    if (!this.config.getOrThrow<boolean>('isProduction')) {
      return { can_signup: true, using_referral_code: !!referralCode };
    }

    if (!this.hasAmbossAccess) return { can_signup: false };

    const referralCodeParam = referralCode
      ? `&referral-code=${encodeURIComponent(referralCode)}`
      : ``;
    const response = await this.get(
      `account/can-signup?email=${encodeURIComponent(email)}${referralCodeParam}`,
    );

    const parsed = ambossCanSignupSchema.passthrough().safeParse(response);

    if (parsed.error) {
      this.logger.error(`Invalid response for can signup`, {
        response,
        email,
      });
      throw new Error(response.message || 'Unable to sign up');
    }

    return parsed.data;
  }

  private async get(endpoint: string) {
    if (!this.baseUrl || !this.secret) {
      throw new Error(`Amboss service is not available`);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: { 'amboss-banco-secret': this.secret },
    });

    return response.json();
  }

  private async post(endpoint: string, body?: any) {
    if (!this.baseUrl || !this.secret) {
      throw new Error(`Amboss service is not available`);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'amboss-banco-secret': this.secret,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return response.json();
  }
}
