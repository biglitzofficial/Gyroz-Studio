# Gyroz Studio

Gyroz Studio is the operating system for a video production and digital marketing studio. The website and the API share one source of truth for clients, projects, shoots, deliverables, editing, publishing, invoices, attendance, and payroll.

A native staff app is not part of this phase. The same `/api/v1` routes are the contract a future mobile client should use.

## Run it

Install Node.js 22 or newer, then:

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

The development site is at http://localhost:5173 and the API at http://localhost:4000.

Production serves the built site and the API together on port 4000. Copy `.env.example` to `.env`, set `NODE_ENV=production`, and replace both JWT secrets with long random values. Then:

```bash
npm run build
npm start
```

Open http://localhost:4000 on this machine. Other devices on the studio network use this machine's address on port 4000. Sign in as the super admin and change the password from the account menu. Do not load the demo seed into a live studio.

Copy `.env.example` to `.env` for secrets and the site address. The database is Cloud Firestore in the `gyroz-studio` Firebase project. The API reads the service account JSON from the project folder, or from `FIREBASE_SERVICE_ACCOUNT` if you set it. Create a Firestore database in the Firebase console before the first start. Records stay in Firestore when the API restarts.

```bash
npm run seed
npm test
```

Seed refuses to run when `NODE_ENV=production` and will not overwrite an existing demo. A signed-in super admin can load the same demo into Firestore from Settings.

Development sign-in after seeding:

| Person | Email | Password |
| --- | --- | --- |
| Super admin | `superadmin@gyroz.studio` | `Admin@123` |
| Demo staff | `admin@gyroz.studio`, `arjun@gyroz.studio`, `kabir@gyroz.studio`, `leela@gyroz.studio`, `rafi@gyroz.studio` | `GyrozDemo!2026` |

Change these before any shared deployment. They are not a production login bypass.

## How the work is modeled

Money is stored in integer paise. Invoice totals, tax, discounts, and payroll are calculated on the server.

A client has many projects. A shoot registers many deliverables once; a second submission is rejected. Each deliverable has one editing task. Revisions increment `revisionCount` and do not create another deliverable. A reshoot points at the original deliverable. Only an approved charge with an amount can be pulled onto an invoice. Publishing requires a URL. Issuing an invoice does not record a payment, and an issued invoice cannot be edited in place.

Attendance codes expire, are single use, and do not authenticate the employee. Payroll uses the wage stored on the employee. The Sunday/holiday multiplier and statutory rates stay empty until they are set in Settings. Finalizing payroll is blocked when those rules are required and still blank.

Super admin access is a protected system role. Other roles, including future team leads, are permission records. Assignment limits are enforced in query filters, not only in the navigation.

Large footage should use object storage (`STORAGE_DRIVER=s3`). Local uploads accept proofs and smaller files and refuse anything over 80 MB. Instagram, YouTube, and similar networks are not integrated; publishing is a manual record with a place for a future adapter.

## Layout

- `client` — React, Vite, TypeScript, Tailwind
- `server` — Express, Cloud Firestore, Zod, JWT access tokens plus an httpOnly refresh cookie

Deploy the API and the site on the same origin, or proxy `/api` to the API, so the refresh cookie is sent.
