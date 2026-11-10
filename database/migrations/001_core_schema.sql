-- Up Migration
-- =============================================================================
-- Migration 001: Core Identity, Session, Customer, and Material Schema
-- Project: NPR Metal Crusher — Billing & Management System
-- Note: Forward-only transactional schema migration.
-- =============================================================================

-- 1. System Users (Owner & Cashiers — no public registration)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'CASHIER')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_username_length CHECK (length(trim(username)) >= 3),
    CONSTRAINT chk_users_full_name_length CHECK (length(trim(full_name)) >= 2)
);

-- Enforce case-insensitive username uniqueness with a single index
CREATE UNIQUE INDEX uq_users_username_lower ON users (LOWER(username));

-- 2. Zero-Knowledge Server-Side Session Store (SHA-256 token hashes only)
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_user_sessions_token_hash_len CHECK (length(token_hash) = 64)
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 3. Customer Directory
-- Provisional Decision: Customer phone numbers are indexed for search/duplicate
-- warnings, not constrained as globally unique, allowing shared company/site phones.
CREATE TABLE customers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    location VARCHAR(255) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_customers_name_len CHECK (length(trim(name)) >= 2),
    CONSTRAINT chk_customers_phone_len CHECK (length(trim(phone)) >= 7),
    CONSTRAINT chk_customers_location_len CHECK (length(trim(location)) >= 2)
);

CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name_lower ON customers(LOWER(name));

-- 4. Materials Catalog (3/4, Dust, 6x9, ABC)
CREATE TABLE materials (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    unit VARCHAR(10) NOT NULL DEFAULT 'm³',
    current_unit_price NUMERIC(12, 2) NOT NULL CHECK (current_unit_price >= 0.00),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_materials_unit CHECK (unit = 'm³'),
    CONSTRAINT chk_materials_name_len CHECK (length(trim(name)) >= 1)
);

-- 5. Auditable Material Price Change History
CREATE TABLE material_price_history (
    id BIGSERIAL PRIMARY KEY,
    material_id INT NOT NULL REFERENCES materials(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    old_price NUMERIC(12, 2) NOT NULL CHECK (old_price >= 0.00),
    new_price NUMERIC(12, 2) NOT NULL CHECK (new_price >= 0.00),
    changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_material_price_history_material_created
    ON material_price_history(material_id, created_at DESC);
