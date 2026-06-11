import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const app = getApps()[0] || initializeApp(window.ZAPLIN_FIREBASE_CONFIG);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

window.ZAPLIN_FIREBASE_APP = app;
window.ZAPLIN_FIREBASE_AUTH = auth;

const getValue = (selector) => document.querySelector(selector)?.value.trim() || '';
const showMessage = (message, isError = true) => {
  const note = document.querySelector('[data-auth-message]');
  if (!note) return;
  note.hidden = false;
  note.textContent = message;
  note.classList.toggle('error', isError);
};
const saveProfile = (profile) => {
  localStorage.setItem('zaplin_profile', JSON.stringify(profile));
};
const redirectHome = () => {
  const next = new URLSearchParams(location.search).get('next');
  window.location.href = next === 'admin.html' ? 'admin.html' : 'index.html';
};
const friendlyError = (error) => {
  const code = error?.code || '';
  if (code.includes('popup-closed-by-user')) return 'Google sign in was closed before completion.';
  if (code.includes('unauthorized-domain')) return 'This domain is not authorized in Firebase Authentication settings.';
  if (code.includes('invalid-credential')) return 'Email or password is incorrect.';
  if (code.includes('email-already-in-use')) return 'This email is already registered. Please login instead.';
  if (code.includes('weak-password')) return 'Password should be at least 6 characters.';
  if (code.includes('operation-not-allowed')) return 'Enable this sign-in provider in Firebase Authentication.';
  return error?.message || 'Authentication failed. Please try again.';
};

document.querySelector('[data-login-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    showMessage('Signing in...', false);
    await signInWithEmailAndPassword(auth, getValue('[data-login-email]'), getValue('[data-login-password]'));
    redirectHome();
  } catch (error) {
    showMessage(friendlyError(error));
  }
});

document.querySelector('[data-register-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = getValue('[data-register-password]');
  const confirm = getValue('[data-register-confirm]');
  if (password !== confirm) {
    showMessage('Passwords do not match.');
    return;
  }
  const profile = {
    business: getValue('[data-register-business]'),
    owner: getValue('[data-register-owner]'),
    mobile: getValue('[data-register-mobile]'),
    email: getValue('[data-register-email]'),
    city: getValue('[data-register-city]'),
    gst: getValue('[data-register-gst]'),
  };
  try {
    showMessage('Creating account...', false);
    const credential = await createUserWithEmailAndPassword(auth, profile.email, password);
    await updateProfile(credential.user, { displayName: profile.owner || profile.business });
    saveProfile(profile);
    redirectHome();
  } catch (error) {
    showMessage(friendlyError(error));
  }
});

document.querySelector('[data-google-auth]')?.addEventListener('click', async () => {
  try {
    showMessage('Opening Google sign in...', false);
    const credential = await signInWithPopup(auth, googleProvider);
    const user = credential.user;
    saveProfile({
      business: user.displayName || '',
      owner: user.displayName || '',
      mobile: user.phoneNumber || '',
      email: user.email || '',
      city: '',
      gst: '',
    });
    redirectHome();
  } catch (error) {
    showMessage(friendlyError(error));
  }
});
