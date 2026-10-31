
-- FinCore Phase 4: Wallets and transfer ledger
-- All monetary amounts are stored in paise.

CREATE TABLE wallets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    balance_paise BIGINT UNSIGNED NOT NULL DEFAULT 0,
    status ENUM('ACTIVE', 'FROZEN', 'CLOSED')
        NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_wallet_user_currency (user_id, currency),
    KEY idx_wallet_user_status (user_id, status),

    CONSTRAINT fk_wallet_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_wallet_balance_nonnegative
        CHECK (balance_paise >= 0)
) ENGINE=InnoDB;


CREATE TABLE transfers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sender_wallet_id BIGINT UNSIGNED NOT NULL,
    recipient_wallet_id BIGINT UNSIGNED NOT NULL,
    amount_paise BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',

    idempotency_key VARCHAR(128) NOT NULL,
    request_hash CHAR(64) NOT NULL,

    status ENUM('PROCESSING', 'COMPLETED', 'FAILED')
        NOT NULL DEFAULT 'PROCESSING',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME(3) NULL,

    PRIMARY KEY (id),

    UNIQUE KEY uq_transfer_idempotency
        (sender_wallet_id, idempotency_key),

    KEY idx_transfer_sender_created
        (sender_wallet_id, created_at),

    KEY idx_transfer_recipient_created
        (recipient_wallet_id, created_at),

    CONSTRAINT fk_transfer_sender
        FOREIGN KEY (sender_wallet_id) REFERENCES wallets(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_transfer_recipient
        FOREIGN KEY (recipient_wallet_id) REFERENCES wallets(id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_transfer_amount_positive
        CHECK (amount_paise > 0),

    CONSTRAINT chk_transfer_different_wallets
        CHECK (sender_wallet_id <> recipient_wallet_id)
) ENGINE=InnoDB;


CREATE TABLE ledger_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    transfer_id BIGINT UNSIGNED NOT NULL,
    wallet_id BIGINT UNSIGNED NOT NULL,

    entry_type ENUM('DEBIT', 'CREDIT') NOT NULL,
    amount_paise BIGINT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_ledger_transfer_wallet_type
        (transfer_id, wallet_id, entry_type),

    KEY idx_ledger_wallet_created (wallet_id, created_at),

    CONSTRAINT fk_ledger_transfer
        FOREIGN KEY (transfer_id) REFERENCES transfers(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_ledger_wallet
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_ledger_amount_positive
        CHECK (amount_paise > 0)
) ENGINE=InnoDB;
