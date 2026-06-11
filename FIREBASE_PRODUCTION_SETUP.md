# Zaplin Firebase Production Setup

1. In Firebase Console, enable **Authentication** with Email/Password and Google providers.
2. Add the Hostinger domain under Authentication > Settings > Authorized domains.
3. Create Firestore Database and Firebase Storage in production mode.
4. Publish `firestore.rules` and `storage.rules` from this package.
5. Register the first admin in Firebase Authentication, copy that user's UID, then create:

   Collection: `admins`  
   Document ID: the Firebase Auth UID  
   Fields: `active: true`, `email: "admin@example.com"`

6. Sign in with that account, open `admin.html`, and click **Migrate Local Data to Firestore** once.

Shared Firestore collections are `products`, `categories`, `brands`, `banners`, `coupons`, `deals`, `orders`, `settings`, `policies`, `homepage`, and `admins`.

Uploaded images are stored in Firebase Storage under `products/`, `categories/`, `brands/`, `banners/`, and `logos/`. Carts and customer profile preferences intentionally remain device-local.

For a different Firebase project, edit only `assets/js/firebase-config.js`.

---

## ⚠️ API Key Security — REQUIRED Before Going Live

Firebase Web API keys are visible in the browser by design, but **must be restricted to your domain** to prevent quota abuse and auth attacks from unauthorized origins.

### Step 1 — Restrict the API key to your domain

1. Go to **Google Cloud Console → APIs & Services → Credentials**  
   https://console.cloud.google.com/apis/credentials?project=YOUR_PROJECT_ID

2. Click on the **Browser key (auto created by Firebase)** (or the key named after your app).

3. Under **Application restrictions**, select **HTTP referrers (websites)**.

4. Add your production domain patterns:
   ```
   https://yourdomain.com/*
   https://www.yourdomain.com/*
   ```
   Also add `http://localhost/*` only during development, and **remove it before production**.

5. Click **Save**.

### Step 2 — Restrict the key to only the APIs it needs

Under **API restrictions**, select **Restrict key**, then enable only:
- Identity Toolkit API
- Cloud Firestore API
- Firebase Storage API
- Token Service API

This ensures the key cannot be used to call unrelated Google APIs even if it leaks.

### Step 3 — Enable Firebase App Check (recommended)

Firebase App Check uses attestation providers (reCAPTCHA v3 for web) to ensure only your app can access Firestore and Storage — even with a valid API key.

1. In Firebase Console → **App Check**, register your web app with reCAPTCHA v3.
2. Enforce App Check on Firestore and Storage once registered.

> Without domain restriction + Firestore rules, a leaked key can be used to read your catalog
> data and trigger Firebase quota limits. Firestore security rules alone are insufficient if the
> key has no referrer restrictions.
