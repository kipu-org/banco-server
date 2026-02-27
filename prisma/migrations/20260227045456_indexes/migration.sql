-- CreateIndex
CREATE INDEX "account_2fa_account_id_idx" ON "account_2fa"("account_id");

-- CreateIndex
CREATE INDEX "account_passkey_account_id_idx" ON "account_passkey"("account_id");

-- CreateIndex
CREATE INDEX "contact_money_address_idx" ON "contact"("money_address");

-- CreateIndex
CREATE INDEX "wallet_on_accounts_account_id_idx" ON "wallet_on_accounts"("account_id");
