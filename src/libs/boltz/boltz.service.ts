import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { crypto } from 'bitcoinjs-lib';
import { decode } from 'bolt11';
import { SwapTreeSerializer } from 'boltz-core';
import { ECPairFactory } from 'ecpair';
import { BoltzRestApi } from 'src/libs/boltz/boltz.rest';
import { SwapsRepoService } from 'src/repo/swaps/swaps.repo';
import {
  BoltzChain,
  BoltzChainSwapRequestType,
  BoltzReverseRequestType,
  BoltzSubmarineRequestType,
  BoltzSwapType,
  SwapProvider,
} from 'src/repo/swaps/swaps.types';
import { getSHA256Hash } from 'src/utils/crypto/crypto';
import * as ecc from 'tiny-secp256k1';

import { CustomLogger, Logger } from '../logging';
import { RedisService } from '../redis/redis.service';
import {
  BoltzChainSwapDirection,
  CovenantParams,
  SwapSingleChainInfoType,
} from './boltz.types';
import { BoltzWsService } from './boltzWs.service';

export const getClaimFeeKey = (swapId: string) => `swap-claim-fee-${swapId}`;

const ECPair = ECPairFactory(ecc);

@Injectable()
export class BoltzService {
  private covclaimUrl: string;

  constructor(
    private boltzRest: BoltzRestApi,
    private boltzWs: BoltzWsService,
    private swapRepo: SwapsRepoService,
    private configService: ConfigService,
    private redisService: RedisService,
    @Logger('BoltzService') private logger: CustomLogger,
  ) {
    this.covclaimUrl = this.configService.getOrThrow('urls.covclaim');
  }

  async createSubmarineSwap(invoice: string, wallet_account_id: string) {
    const swapInfo = await this.getSubmarineSwapInfo();
    const { limits } = swapInfo['L-BTC']['BTC'];

    const { satoshis } = decode(invoice);
    this.checkLimits(limits, satoshis || 0);

    const keys = ECPair.makeRandom();

    const request: BoltzSubmarineRequestType = {
      invoice,
      from: BoltzChain['L-BTC'],
      to: BoltzChain.BTC,
      refundPublicKey: keys.publicKey.toString('hex'),
      referralId: 'AMBOSS',
    };

    const response = await this.boltzRest.createSubmarineSwap(request);

    this.boltzWs.subscribeToSwap([response.id]);

    await this.swapRepo.createSwap(
      wallet_account_id,
      {
        provider: SwapProvider.BOLTZ,
        type: BoltzSwapType.SUBMARINE,

        payload: {
          ...request,
          privateKey: keys.privateKey?.toString('hex') || '',
        },
      },
      {
        provider: SwapProvider.BOLTZ,
        type: BoltzSwapType.SUBMARINE,
        payload: response,
      },
    );

    return response;
  }

  async createReverseSwap(swapInput: {
    address: string;
    amount: number;
    wallet_account_id: string;
    covenant?: boolean;
    description: string;
  }) {
    const {
      address,
      amount,
      wallet_account_id,
      covenant = true,
      description,
    } = swapInput;

    const swapInfo = await this.getReverseSwapInfo();
    const { limits } = swapInfo['BTC']['L-BTC'];

    this.checkLimits(limits, amount);

    const preimage = randomBytes(32);
    const keys = ECPair.makeRandom();

    const addressHash = crypto.sha256(Buffer.from(address));
    const addressSignature = keys.signSchnorr(addressHash);

    const request: BoltzReverseRequestType = {
      address,
      from: BoltzChain.BTC,
      to: BoltzChain['L-BTC'],
      claimCovenant: covenant,
      invoiceAmount: amount,
      preimageHash: getSHA256Hash(preimage),
      claimPublicKey: keys.publicKey.toString('hex'),
      referralId: 'AMBOSS',
      description,
      addressSignature: addressSignature.toString('hex'),
    };

    const response = await this.boltzRest.createReverseSwap(request);

    if (covenant && response.blindingKey) {
      const covParams = {
        address,
        preimage,
        claimPublicKey: keys.publicKey,
        blindingKey: Buffer.from(response.blindingKey, 'hex'),
        refundPublicKey: Buffer.from(response.refundPublicKey, 'hex'),
        tree: SwapTreeSerializer.deserializeSwapTree(response.swapTree),
      };
      await this.registerCovenant(covParams);
    }

    this.boltzWs.subscribeToSwap([response.id]);

    await this.swapRepo.createSwap(
      wallet_account_id,
      {
        provider: SwapProvider.BOLTZ,
        type: BoltzSwapType.REVERSE,

        payload: {
          ...request,
          preimage: preimage.toString('hex'),
          privateKey: keys.privateKey?.toString('hex') || '',
        },
      },
      {
        provider: SwapProvider.BOLTZ,
        type: BoltzSwapType.REVERSE,
        payload: response,
      },
    );

    return response;
  }

  private async getUserAmountChain(
    amountToReceive: number,
    chainSwapInfo: SwapSingleChainInfoType,
  ): Promise<{ pairHash: string; userLockAmount: number }> {
    const pairHash = chainSwapInfo.hash;
    const serverFee = chainSwapInfo.fees.minerFees.server;
    const claimFee = chainSwapInfo.fees.minerFees.user.claim;

    const payAmount = amountToReceive + serverFee + claimFee;

    const boltzFee = payAmount * (chainSwapInfo.fees.percentage / 100);

    return { pairHash, userLockAmount: payAmount + Math.ceil(boltzFee) };
  }

  async createChainSwap(swapInput: {
    address: string;
    amount: number;
    wallet_account_id: string;
    direction: BoltzChainSwapDirection;
  }) {
    const {
      address,
      amount,
      direction: { from, to },
      wallet_account_id,
    } = swapInput;

    const swapInfo = await this.getChainSwapInfo();
    let swapInfoByDirection;

    if (from == BoltzChain['L-BTC'] && to == BoltzChain['BTC']) {
      swapInfoByDirection = swapInfo[from][to];
    } else if (from == BoltzChain['BTC'] && to == BoltzChain['L-BTC']) {
      swapInfoByDirection = swapInfo[from][to];
    } else {
      throw new Error(`You cannot send and receive to the same chain`);
    }

    this.checkLimits(swapInfoByDirection.limits, amount);
    const { pairHash, userLockAmount } = await this.getUserAmountChain(
      amount,
      swapInfoByDirection,
    );

    // Create a random preimage for the swap; has to have a length of 32 bytes
    const preimage = randomBytes(32);
    const claimKeys = ECPairFactory(ecc).makeRandom();
    const refundKeys = ECPairFactory(ecc).makeRandom();

    const request: BoltzChainSwapRequestType = {
      userLockAmount,
      claimAddress: address,
      from,
      to,
      preimageHash: getSHA256Hash(preimage),
      claimPublicKey: claimKeys.publicKey.toString('hex'),
      refundPublicKey: refundKeys.publicKey.toString('hex'),
      referralId: 'AMBOSS',
      pairHash,
    };

    const response = await this.boltzRest.createChainSwap(request);

    await this.swapRepo.createSwap(
      wallet_account_id,
      {
        provider: SwapProvider.BOLTZ,
        type: BoltzSwapType.CHAIN,
        payload: {
          ...request,
          preimage: preimage.toString('hex'),
          claimPrivateKey: claimKeys.privateKey?.toString('hex') || '',
          refundPrivateKey: refundKeys.privateKey?.toString('hex') || '',
        },
      },
      {
        provider: SwapProvider.BOLTZ,
        type: BoltzSwapType.CHAIN,
        payload: response,
      },
    );

    const settingClaimFee = response.claimDetails.amount - amount;

    this.redisService.set(getClaimFeeKey(response.id), settingClaimFee, {
      ttl: 60 * 60 * 12,
    });

    this.boltzWs.subscribeToSwap([response.id]);

    return response;
  }

  async getReverseSwapInfo() {
    return this.boltzRest.getReverseSwapInfo();
  }

  async getChainSwapInfo() {
    return this.boltzRest.getChainSwapInfo();
  }

  async getSubmarineSwapInfo() {
    return this.boltzRest.getSubmarineSwapInfo();
  }

  private async registerCovenant(params: CovenantParams) {
    const body = {
      address: params.address,
      preimage: params.preimage.toString('hex'),
      tree: SwapTreeSerializer.serializeSwapTree(params.tree),
      blindingKey: params.blindingKey.toString('hex'),
      claimPublicKey: params.claimPublicKey.toString('hex'),
      refundPublicKey: params.refundPublicKey.toString('hex'),
    };

    const res = await fetch(`${this.covclaimUrl}/covenant`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.logger.info('Registered Convenant', { covRes: await res.text() });
  }

  private checkLimits(
    { minimal, maximal }: { minimal: number; maximal: number },
    amount: number,
  ): void {
    if (amount < minimal) {
      throw new Error(`Amount is too small, minimum is ${minimal}`);
    }

    if (amount > maximal) {
      throw new Error(`Amount is too big, maximum is ${maximal}`);
    }
  }
}
