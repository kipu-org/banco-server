import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { account } from '@prisma/client';
import formData from 'form-data';
import { readFileSync } from 'fs';
import Handlebars from 'handlebars';
import Mailgun, { MailgunMessageData } from 'mailgun.js';
import { IMailgunClient } from 'mailgun.js/Interfaces';
import path from 'path';
import { AccountRepo } from 'src/repo/account/account.repo';

import { CustomLogger, Logger } from '../logging';
import { BackupMail, BackupMailPassChange, SignupMail } from './mail.template';
import {
  MailTo,
  SendBackupChangePassDetails,
  SendBackupDetails,
  SendEmailProps,
  SendSignupDetails,
} from './mail.types';

@Injectable()
export class MailService {
  private mailgun?: {
    client: IMailgunClient;
    domain: string;
  };
  private recoverUrl: string;

  constructor(
    private configService: ConfigService,
    private accountRepo: AccountRepo,
    @Logger(MailService.name) private logger: CustomLogger,
  ) {
    const apiKey = this.configService.get<string>(`mailgun.apiKey`);
    const domain = this.configService.get<string>(`mailgun.domain`);
    this.recoverUrl = this.configService.getOrThrow<string>(
      `server.recoveryPageUrl`,
    );

    if (!apiKey || !domain) return;

    const mailgun = new Mailgun(formData);

    this.mailgun = {
      client: mailgun.client({
        username: 'api',
        key: apiKey,
      }),
      domain,
    };
  }

  async sendBackupMail(props: SendBackupDetails) {
    const { email, password_hint } = await this.getRecipient(props.to);

    const { subject, html } = BackupMail({
      backup: {
        ['Date Created']: new Date().toUTCString(),
        ['Password Hint']: password_hint || '',
        ['Wallet Name']: props.walletName,
        ['Encrypted Mnemonic']: props.encryptedMnemonic,
        ['Recovery Link']: this.recoverUrl,
      },
    });

    await this.send({
      email,
      subject,
      variables: {
        content: html,
      },
    });
  }

  async sendBackupMailPassChange(props: SendBackupChangePassDetails) {
    const { email, password_hint } = await this.getRecipient(props.to);

    const { subject, html } = BackupMailPassChange({
      encryptedMnemonic: props.encryptedMnemonic,
      recoverLink: this.recoverUrl,
      date: new Date().toUTCString(),
      newPasswordHint: password_hint || '',
      walletName: props.walletName,
    });

    await this.send({
      email,
      subject,
      variables: {
        content: html,
      },
    });
  }

  async sendSignupMail(props: SendSignupDetails) {
    const { email, password_hint } = await this.getRecipient(props.to);

    const { subject, html } = SignupMail({
      backup: {
        'Recovery Link': this.recoverUrl,
        'Date Created': new Date().toUTCString(),
        'Password Hint': password_hint || '',
        'Encrypted Mnemonic': props.encryptedMnemonic,
        'Wallet Name': props.walletName,
      },
    });

    await this.send({
      email,
      subject,
      variables: {
        content: html,
      },
    });
  }

  private async send({ subject, email, variables }: SendEmailProps) {
    if (!this.mailgun) return;

    const htmlTemplate = readFileSync(
      path.resolve('./mail/templates/banco.html'),
      'utf8',
    );

    const template = Handlebars.compile(htmlTemplate);
    const finalMessage = template(variables);

    const data: MailgunMessageData = {
      from: `BancoLibre <noreply@${this.mailgun.domain}>`,
      to: [email],
      subject,
      html: finalMessage,
    };

    await this.mailgun.client.messages
      .create(this.mailgun.domain, data)
      .then((res) => this.logger.silly('Email sent', { res }))
      .catch((err) => this.logger.error('Error sending email', { err }));
  }

  private async getRecipient({ email, id }: MailTo): Promise<account> {
    if (email) {
      const account = await this.accountRepo.findOne(email);

      if (account) return account;
    }

    if (id) {
      const account = await this.accountRepo.findOneById(id);

      if (account) return account;
    }
    this.logger.warn(`Could not find account`, { email, id });

    throw new Error(`Cannot get account`);
  }
}