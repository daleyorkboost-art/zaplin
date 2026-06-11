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
