# Monk Hagen
<<<<<<< Updated upstream
Monk Hagen e-commerce website
=======

Premium streetwear storefront — Angular 20 frontend with a Node.js/Express + MongoDB API in the same application.

## Stack
Angular 20 · Node.js 22 · Express · MongoDB + Mongoose · JWT auth · Cloudinary (product images)

## Pages
Home (video hero bar + categories, arrivals, testimonials, newsletter), Products (category image blocks + filters), Product Details, Cart + Checkout, Login/Register, Admin dashboard, About Us.

## Backend structure
```
server/
  config/      db (mongoose) + cloudinary
  models/      Product, Category, User, Order  (schema validation)
  controllers/ product, category, auth, order, upload
  middleware/  auth (JWT), error handler, asyncHandler
  routes/      products, categories, auth, orders, upload
  seed.js      seeds categories, products, demo users
  index.js     app bootstrap
```

## Setup

1. Use Node.js 22 (Angular 20 requires Node v20.19+ or v22.12+):

   ```bash
   nvm use 22
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Make sure MongoDB is running locally (or set an Atlas URI). Copy the env file
   and adjust values:

   ```bash
   cp .env.example .env
   ```

   Key values: `MONGODB_URI`, `JWT_SECRET`, and the `CLOUDINARY_*` keys (optional —
   needed only for image uploads from the admin panel).

4. Seed the database:

   ```bash
   npm run seed
   ```

## Run it

### Development (frontend + API together)

```bash
npm run dev
```

- Angular dev server: http://localhost:4200 (proxies `/api` to the backend)
- Express API: http://localhost:3000

### Production-style (build + serve from Node)

```bash
npm run start:prod
```

Then open http://localhost:3000 — Express serves the built Angular app and the API.

## API endpoints
- `GET/POST/PUT/DELETE /api/products` (+ `/categories`, `/:idOrSlug`)
- `GET/POST/PUT/DELETE /api/categories`
- `POST /api/auth/register|login`, `GET /api/auth/me`
- `POST /api/orders`, `GET /api/orders/mine`, `GET /api/orders` (admin)
- `POST /api/upload` (admin, Cloudinary)

## Demo accounts
- Admin: `admin@monkhagen.com` / `admin123`
- Customer: `demo@monkhagen.com` / `demo123`

> Set a strong `JWT_SECRET` and add Cloudinary credentials before deploying.

---

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.3.30.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
>>>>>>> Stashed changes
