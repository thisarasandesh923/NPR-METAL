# NPR Metal Crusher — Billing & Management System

> Production-grade, audit-compliant billing, payment collection, and operational management system for a real-world Sri Lankan metal crusher workshop.

---

## 1. Project Overview

The **NPR Metal Crusher Billing & Management System** streamlines daily operations for construction aggregates production and delivery:
- **Materials Supported:** 3/4" Aggregate, Dust (Crushed stone powder), 6×9 Rubble Aggregate, and ABC (Aggregate Base Course).
- **Core Operations:** Multi-material invoicing in cubic meters (m³), optional transport charges, append-only cash collection, customer receivables tracking, and cashier shift cash drawer reconciliation.
- **Role Enforcement:** Desktop-first fast cashier interface with zero edit/delete permissions on issued records; responsive owner management dashboard with price governance and financial audit trails.
- **Language & Standards:** 100% English user interface and A5 print engine, Sri Lankan Rupees (`LKR` / `Rs.`), and `Asia/Colombo` timezone reporting.

---

## 2. Technology Stack

- **Frontend:**
  - React 19 with strict TypeScript
  - Vite 8 build tool & development server
  - Tailwind CSS v4 with custom brand theming
  - Pixel-perfect A5 printable invoice layout (`@media print`)
- **Backend:**
  - Node.js (v20+ / v24+) with native ES Modules (`NodeNext`)
  - Express 5.3+ REST API
  - Strict TypeScript with Zod request validation
  - Server-side PostgreSQL session store with SHA-256 hashed tokens and `HttpOnly` cookies
- **Database:**
  - Supabase PostgreSQL (South Asia / Mumbai region)
  - Native driver: `pg` (node-postgres) with connection pooling
  - Forward-only versioned migrations located in `database/migrations/`
  - Database-enforced immutability triggers and financial check constraints

---

## 3. Repository Structure

```
NPR-Metal-Crusher-System/
├── .gitignore                 # Root exclusion rules (secrets, node_modules, build outputs)
├── AGENTS.md                  # Permanent architecture, security, and engineering rules
├── README.md                  # Project overview and setup instructions
├── database/
│   └── migrations/            # Version-controlled SQL migration scripts
├── docs/
│   ├── requirements.md        # Comprehensive business and technical requirements
│   ├── architecture.md        # Modular architecture, session security, and concurrency design
│   ├── database-design.md     # PostgreSQL schemas, ER model, constraints, and views
│   └── development-roadmap.md # Phased implementation roadmap & quality gates
├── backend/
│   ├── package.json           # Backend dependencies and scripts (Express 5, pg, tsx)
│   ├── tsconfig.json          # NodeNext ESM TypeScript configuration
│   ├── .env.example           # Sanitized environment variable template
│   └── src/
│       ├── app.ts             # Express application pipeline
│       ├── server.ts          # Server entrypoint and graceful shutdown
│       ├── db/
│       │   └── pool.ts        # PostgreSQL connection pool
│       └── scripts/
│           └── check-db.ts    # Connectivity verification script
└── frontend/
    ├── package.json           # Frontend dependencies and scripts (React 19, Tailwind v4)
    ├── tsconfig.json          # Strict React TypeScript configuration
    ├── vite.config.ts         # Vite server configuration with reverse proxy support
    └── src/
        ├── main.tsx           # React application mount
        ├── App.tsx            # Main prototype application
        └── index.css          # Tailwind CSS styling and theme
```

---

## 4. Local Development Setup

### 4.1 Prerequisites
- **Node.js:** v20.x or v24.x LTS
- **npm:** v10.x or v11.x
- **PostgreSQL Database:** Supabase PostgreSQL instance (or local PostgreSQL)

### 4.2 Backend Setup
1. Open a terminal in the `backend/` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables:
   - Copy `.env.example` to `.env`:
     ```bash
     copy .env.example .env
     ```
   - Set your PostgreSQL connection string in `DATABASE_URL`:
     ```env
     PORT=4000
     DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres?sslmode=require
     ```
4. Verify database connectivity:
   ```bash
   npm run db:check
   ```
5. Start the backend development server:
   ```bash
   npm run dev
   ```
   The backend API will run at `http://localhost:4000`. Health check endpoint: `http://localhost:4000/api/health`.

### 4.3 Frontend Setup
1. Open a terminal in the `frontend/` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Vite development server:
   ```bash
   npm run dev
   ```
   The frontend will run at `http://localhost:5173`.

---

## 5. Verification & Quality Gates

Every code change must pass all quality gates prior to code review:

```bash
# 1. Backend TypeScript Typecheck
npm --prefix backend run typecheck

# 2. Backend Production Build
npm --prefix backend run build

# 3. Frontend TypeScript Typecheck
npx --prefix frontend tsc --noEmit -p frontend/tsconfig.json

# 4. Frontend Production Build
npm --prefix frontend run build
```

---

## 6. Architecture & Engineering Documentation

For in-depth architectural and operational guidelines, refer to:
- [AGENTS.md](AGENTS.md): Permanent coding conventions, security protocols, and financial invariants.
- [docs/requirements.md](docs/requirements.md): Detailed business and functional requirements.
- [docs/architecture.md](docs/architecture.md): 4-tier layer design, session security, and concurrency controls.
- [docs/database-design.md](docs/database-design.md): Complete PostgreSQL schema, ER diagrams, triggers, and views.
- [docs/development-roadmap.md](docs/development-roadmap.md): Nine-phase development roadmap and acceptance criteria.
