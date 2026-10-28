import { type Profile, newProfile, normalizeProfile } from '../shared/profile';

const KEY = 'xl.profile.v1';
let memoryCopy: string | null = null;

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY) ?? memoryCopy;
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch (e) {
    console.warn('Profil konnte nicht geladen werden', e);
    return null;
  }
}

export function saveProfile(p: Profile) {
  const raw = JSON.stringify(p);
  memoryCopy = raw;
  try {
    localStorage.setItem(KEY, raw);
  } catch (e) {
    console.warn('Profil konnte nicht gespeichert werden', e);
  }
}

export function createProfile(name: string): Profile {
  const p = newProfile(name);
  saveProfile(p);
  return p;
}

export function deleteProfile() {
  memoryCopy = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignorieren */
  }
}
