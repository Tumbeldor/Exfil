import { type Profile, newProfile, normalizeProfile } from '../shared/profile';

const KEY = 'exfil.profile.v1';
let memoryCopy: string | null = null;

/** Liest einen Eintrag und übernimmt Daten, die noch unter dem alten Namen (vor „Exfil“) gespeichert sind. */
export function readStored(key: string, legacyKey: string): string | null {
  const raw = localStorage.getItem(key);
  if (raw !== null) return raw;
  const old = localStorage.getItem(legacyKey);
  if (old !== null) {
    try {
      localStorage.setItem(key, old);
      localStorage.removeItem(legacyKey);
    } catch {
      /* bleibt dann unter dem alten Namen lesbar */
    }
  }
  return old;
}

export function loadProfile(): Profile | null {
  try {
    const raw = readStored(KEY, 'xl.profile.v1') ?? memoryCopy;
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
    localStorage.removeItem('xl.profile.v1');
  } catch {
    /* ignorieren */
  }
}
