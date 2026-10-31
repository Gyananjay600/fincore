CREATE TABLE funding_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    wallet_id BIGINT UNSIGNED NOT NULL,
    amount_paise BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    source ENUM('SIMULATED_TEST') NOT NULL DEFAULT 'SIMULATED_TEST',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_funding_wallet_created (wallet_id, created_at),
    CONSTRAINT fk_funding_wallet
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)
        ON DELETE RESTRICT,
    CONSTRAINT chk_funding_amount_positive CHECK (amount_paise > 0)
) ENGINE=InnoDB;

ALTER TABLE ledger_entries
    MODIFY COLUMN transfer_id BIGINT UNSIGNED NULL;